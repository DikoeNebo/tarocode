/**
 * Minimal CDP client for Cursor background paste (no focus steal).
 * Uses Node built-in fetch + WebSocket (Electron/Node 22+).
 */
const DEFAULT_PORT = 9222;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, timeoutMs = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.seq = 0;
    this.pending = new Map();
    this.buf = "";
  }

  async connect() {
    if (this.ws && this.ws.readyState === 1) return;
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error("CDP connect timeout")), 8000);
      this.ws.onopen = () => {
        clearTimeout(to);
        resolve();
      };
      this.ws.onerror = () => {
        clearTimeout(to);
        reject(new Error("CDP WebSocket error"));
      };
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    this.ws.onclose = () => {
      for (const [, p] of this.pending) p.reject(new Error("CDP closed"));
      this.pending.clear();
      this.ws = null;
    };
  }

  async send(method, params = {}, timeoutMs = 10000) {
    await this.connect();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (result?.exceptionDetails) {
      const t =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "evaluate failed";
      throw new Error(t);
    }
    return result?.result?.value;
  }

  close() {
    try {
      if (this.ws) this.ws.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

class CdpClient {
  constructor(port = DEFAULT_PORT) {
    this.port = Number(port) || DEFAULT_PORT;
    /** @type {Map<string, CdpSession>} */
    this.sessions = new Map();
  }

  baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  async listRawTargets() {
    return fetchJson(`${this.baseUrl()}/json/list`);
  }

  async probe() {
    try {
      const list = await this.listRawTargets();
      const pages = (list || []).filter(
        (t) =>
          t.type === "page" &&
          t.webSocketDebuggerUrl &&
          /cursor|workbench|vscode-app/i.test(
            `${t.title || ""} ${t.url || ""} ${t.webSocketDebuggerUrl || ""}`
          )
      );
      // Prefer workbench pages; fall back to any page with cursor in title/url
      let targets = pages;
      if (!targets.length) {
        targets = (list || []).filter(
          (t) => t.type === "page" && t.webSocketDebuggerUrl
        );
      }
      return {
        ok: true,
        port: this.port,
        open: true,
        targetCount: targets.length,
        targets: targets.map((t) => ({
          id: t.id,
          title: t.title || "",
          url: t.url || "",
          webSocketDebuggerUrl: t.webSocketDebuggerUrl,
        })),
      };
    } catch (e) {
      return {
        ok: false,
        port: this.port,
        open: false,
        error: String(e.message || e),
        hint: "cdp_closed",
      };
    }
  }

  async getSession(cdpTargetId) {
    const probe = await this.probe();
    if (!probe.open) throw new Error("CDP порт закрыт — запустите Cursor для фона");
    let target = (probe.targets || []).find((t) => t.id === cdpTargetId);
    if (!target && probe.targets?.length === 1) target = probe.targets[0];
    if (!target) {
      // Prefer title containing Agents / Cursor / folder
      target =
        (probe.targets || []).find((t) => /Agents|Cursor/i.test(t.title)) ||
        probe.targets?.[0];
    }
    if (!target?.webSocketDebuggerUrl) {
      throw new Error("CDP: окно Cursor не найдено");
    }
    const key = target.id;
    let session = this.sessions.get(key);
    if (!session) {
      session = new CdpSession(target.webSocketDebuggerUrl);
      this.sessions.set(key, session);
    }
    await session.connect();
    try {
      await session.send("Runtime.enable", {});
    } catch {
      /* may already be enabled */
    }
    return { session, target };
  }

  /**
   * List chat-like UI entries inside Cursor workbench DOM.
   * @returns {Promise<{ok:boolean, chats?: Array<{id:string,title:string,kind:string}>, error?: string, cdpTargetId?: string}>}
   */
  async listChats(cdpTargetId) {
    try {
      const { session, target } = await this.getSession(cdpTargetId);
      const chats = await session.evaluate(`(() => {
        const out = [];
        const seen = new Set();
        const skip = /^(New Agent|New Chat|Agents|Cursor|See more|Pin|Unpin|Archive|Automations|Customize|Repositories|Search|Hide Sidebar|Go Back|Go Forward|Open Workspace)$/i;
        const cleanTitle = (raw) => {
          let t = String(raw || '').trim().replace(/\\s+/g, ' ');
          // Sidebar concatenates title + relative time ("5m", "1d", "now")
          t = t.replace(/\\s*(?:now|\\d+\\s*[smhd]|\\d+\\s*мин(?:ут[аы]?)?)\\s*$/i, '').trim();
          return t;
        };
        const titleOf = (el) => {
          const label =
            el.querySelector('.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, [class*="menu-button-label"]') ||
            el.querySelector('[class*="label-title"]');
          if (label) {
            const t = cleanTitle(label.textContent || '');
            if (t) return t;
          }
          const aria = cleanTitle(el.getAttribute('aria-label') || '');
          if (aria && aria.length <= 120) return aria;
          return cleanTitle((el.textContent || '').slice(0, 160));
        };
        const push = (id, title, kind) => {
          const t = cleanTitle(title);
          if (!t || t.length < 2 || t.length > 120) return;
          if (skip.test(t)) return;
          const key = id || (kind + '|' + t);
          if (seen.has(key) || seen.has('title|' + t)) return;
          seen.add(key);
          seen.add('title|' + t);
          out.push({ id: key, title: t, kind: kind || 'item' });
        };

        // Current Cursor Agents sidebar (glass UI)
        document.querySelectorAll(
          '.glass-sidebar-agent-menu-btn, .glass-sidebar-agent-list-container .ui-sidebar-menu-button'
        ).forEach((el, idx) => {
          const t = titleOf(el);
          push('agent#' + idx + ':' + t.slice(0, 40), t, 'agent-sidebar');
        });

        // Legacy / alternate layouts
        const sels = [
          '.agent-sidebar-cell',
          '[class*="agent-sidebar"] [role="button"]',
          '[aria-id="chat-horizontal-tab"]',
          '.composer-tab-label',
          '[class*="composer-tab"]',
        ];
        for (const sel of sels) {
          document.querySelectorAll(sel).forEach((el, idx) => {
            const composerId =
              el.getAttribute('data-composer-id') ||
              el.closest('[data-composer-id]')?.getAttribute('data-composer-id');
            const title = titleOf(el);
            push(composerId || (sel + '#' + idx + ':' + title.slice(0, 40)), title, sel);
          });
        }

        // Active composer as last resort (id only — textContent is the whole chat)
        if (!out.length) {
          const comp = document.querySelector('[data-composer-id]');
          if (comp) {
            push(comp.getAttribute('data-composer-id'), 'Текущий агент', 'current-composer');
          }
        }
        return out.slice(0, 60);
      })()`);
      return {
        ok: true,
        chats: Array.isArray(chats) ? chats : [],
        cdpTargetId: target.id,
        windowTitle: target.title || "",
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  }

  async selectChat(cdpTargetId, chat) {
    const { session } = await this.getSession(cdpTargetId);
    const chatId = chat?.id || chat?.chatId || "";
    const chatTitle = chat?.title || chat?.chatTitle || "";
    const ok = await session.evaluate(`(() => {
      const wantId = ${JSON.stringify(chatId)};
      const wantTitle = ${JSON.stringify(chatTitle)};
      const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ')
        .replace(/\\s*(?:now|\\d+\\s*[smhd])\\s*$/i, '').trim();
      const titleOf = (el) => {
        const label = el.querySelector(
          '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, [class*="menu-button-label"]'
        );
        if (label) return norm(label.textContent || '');
        const aria = norm(el.getAttribute('aria-label') || '');
        if (aria && aria.length <= 120) return aria;
        return norm((el.textContent || '').slice(0, 160));
      };
      const click = (el) => {
        if (!el) return false;
        el.scrollIntoView({ block: 'nearest' });
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        if (typeof el.click === 'function') el.click();
        return true;
      };
      if (wantId && wantId !== 'Текущий агент' && !wantId.includes('|') && !wantId.startsWith('agent#') && !/[\\"']/.test(wantId)) {
        const byComp = document.querySelector('[data-composer-id="' + wantId + '"]');
        if (byComp && click(byComp)) return true;
      }
      const nodes = document.querySelectorAll(
        '.glass-sidebar-agent-menu-btn, .glass-sidebar-agent-list-container .ui-sidebar-menu-button, .agent-sidebar-cell, [aria-id="chat-horizontal-tab"], .composer-tab-label, [class*="agent-sidebar"] [role="button"], [class*="composer-tab"]'
      );
      const wt = norm(wantTitle);
      for (const el of nodes) {
        const t = titleOf(el);
        if (wantId && (wantId.endsWith(':' + t.slice(0, 40)) || wantId.includes(t))) {
          if (click(el)) return true;
        }
        if (wt && t === wt) {
          if (click(el)) return true;
        }
      }
      if (wt) {
        for (const el of nodes) {
          const t = titleOf(el);
          if (t && (t.startsWith(wt.slice(0, 24)) || wt.startsWith(t.slice(0, 24)))) {
            if (click(el)) return true;
          }
        }
      }
      // "Текущий агент" / already open — no sidebar click needed
      if (!wt || wt === 'Текущий агент' || wantId === 'Текущий агент') {
        if (document.querySelector('[data-composer-id], [contenteditable="true"]')) return true;
      }
      return false;
    })()`);
    if (!ok) throw new Error("chat_not_found");
    await sleep(200);
    return { ok: true };
  }

  async insertText(cdpTargetId, text, { submit = false } = {}) {
    const { session } = await this.getSession(cdpTargetId);
    const payload = String(text ?? "");
    const result = await session.evaluate(`(async () => {
      const text = ${JSON.stringify(payload)};
      const submit = ${submit ? "true" : "false"};
      const pickEditor = () => {
        const sels = [
          '.aislash-editor-input',
          '[data-lexical-editor="true"][contenteditable="true"]',
          '.tiptap.ProseMirror[contenteditable="true"]',
          '.ui-prompt-input-editor__input[contenteditable="true"]',
          '[class*="aislash"] [contenteditable="true"]',
          '[class*="composer"] [contenteditable="true"]',
          '[class*="ai-input"] textarea',
          'textarea[placeholder]',
          '[role="textbox"][contenteditable="true"]',
        ];
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return el;
        }
        const all = [...document.querySelectorAll('[contenteditable="true"], textarea')];
        return all.find((el) => el.offsetParent !== null) || null;
      };
      const el = pickEditor();
      if (!el) return { ok: false, error: 'input_not_found' };
      el.focus();
      if (el.isContentEditable) {
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
        } catch (e) {
          el.textContent = text;
          el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        }
      } else {
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (submit) {
        await new Promise((r) => setTimeout(r, 80));
        const sendBtn =
          document.querySelector('button[aria-label="Send"]') ||
          document.querySelector('.send-with-mode') ||
          document.querySelector('[class*="send-with-mode"]') ||
          document.querySelector('button[aria-label*="Send"]');
        if (sendBtn) sendBtn.click();
        else {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
        }
      }
      return { ok: true };
    })()`);
    if (!result?.ok) throw new Error(result?.error || "insert_failed");
    return { ok: true };
  }

  async sendToChat(cdpTargetId, chat, text, { submit = false } = {}) {
    await this.selectChat(cdpTargetId, chat);
    await sleep(150);
    return this.insertText(cdpTargetId, text, { submit });
  }

  closeAll() {
    for (const s of this.sessions.values()) s.close();
    this.sessions.clear();
  }
}

let singleton = null;

function getCdpClient(port) {
  const p = Number(port) || DEFAULT_PORT;
  if (!singleton || singleton.port !== p) {
    if (singleton) singleton.closeAll();
    singleton = new CdpClient(p);
  }
  return singleton;
}

module.exports = {
  DEFAULT_PORT,
  CdpClient,
  getCdpClient,
};
