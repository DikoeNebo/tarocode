/**
 * Minimal CDP client for Cursor background paste (no focus steal).
 * Uses Node built-in fetch + WebSocket (Electron/Node 22+).
 */
const { t } = require("./i18n");
const {
  normalizeTranscriptMessages,
  hashTranscript,
  dedupeTranscriptMessages,
} = require("./cdp-transcript");

const DEFAULT_PORT = 9222;
/** Stable sentinel for "already open composer" — do not localize (matching). */
const CURRENT_AGENT_SENTINEL = "Текущий агент";

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
    if (!probe.open) throw new Error(t("cdp.portClosed"));
    const wantId = String(cdpTargetId || "");
    let target = (probe.targets || []).find((t) => t.id === wantId);
    // Only auto-pick when exactly one window and no specific id was stored
    if (!target && !wantId && probe.targets?.length === 1) {
      target = probe.targets[0];
    }
    if (!target?.webSocketDebuggerUrl) {
      throw new Error(
        wantId ? t("cdp.windowMissingReselect") : t("cdp.windowMissing")
      );
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
            push(comp.getAttribute('data-composer-id'), ${JSON.stringify(CURRENT_AGENT_SENTINEL)}, 'current-composer');
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
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const isMessageChrome = (el) =>
        !!el.closest(
          '[data-message-role], [data-role="user"], [data-role="assistant"], [class*="composer-message"], [class*="chat-message"], [class*="agent-message"], [class*="message-bubble"], .markdown-root, .anysphere-markdown-container-root'
        );
      const pickEditor = () => {
        const sels = [
          '.aislash-editor-input',
          '.ui-prompt-input-editor__input[contenteditable="true"]',
          '[class*="aislash-editor"] [contenteditable="true"]',
          '[class*="prompt-input"] [contenteditable="true"]',
          '[data-lexical-editor="true"][contenteditable="true"]',
          '.tiptap.ProseMirror[contenteditable="true"]',
          '[class*="composer"] [contenteditable="true"]',
          '[class*="ai-input"] textarea',
          'textarea[placeholder]',
          '[role="textbox"][contenteditable="true"]',
        ];
        const candidates = [];
        for (const sel of sels) {
          for (const el of document.querySelectorAll(sel)) {
            if (!visible(el)) continue;
            if (isMessageChrome(el) && !el.closest('[class*="prompt"], [class*="aislash"], [class*="ai-input"]')) {
              continue;
            }
            candidates.push(el);
          }
          if (candidates.length) break;
        }
        if (!candidates.length) {
          for (const el of document.querySelectorAll('[contenteditable="true"], textarea')) {
            if (!visible(el)) continue;
            if (isMessageChrome(el)) continue;
            candidates.push(el);
          }
        }
        if (!candidates.length) return null;
        // Prefer the lowest editor on screen — the prompt box, not a mid-chat widget.
        candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
        return candidates[0];
      };
      const el = pickEditor();
      if (!el) return { ok: false, error: 'input_not_found' };
      el.focus();
      if (el.isContentEditable) {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(el);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('selectAll', false, null);
          const okInsert = document.execCommand('insertText', false, text);
          if (!okInsert) {
            el.textContent = '';
            document.execCommand('insertText', false, text);
          }
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
        const sendCandidates = [
          ...document.querySelectorAll(
            'button[aria-label="Send"], button[aria-label*="Send" i], button[data-testid*="send" i], .send-with-mode, [class*="send-with-mode"] button, form button[type="submit"]'
          ),
        ];
        const sendBtn = sendCandidates.find((btn) => {
          const style = window.getComputedStyle(btn);
          const rect = btn.getBoundingClientRect();
          return (
            !btn.disabled &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        });
        if (sendBtn) sendBtn.click();
        else {
          const mods = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
          el.dispatchEvent(new KeyboardEvent('keydown', { ...mods, ctrlKey: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', mods));
          el.dispatchEvent(new KeyboardEvent('keyup', mods));
        }
      }

      const normalize = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const readEditor = () => {
        const cur = pickEditor();
        if (!cur) return '';
        return normalize(cur.isContentEditable ? (cur.innerText || cur.textContent) : cur.value);
      };
      const draftStillThere = () => {
        const left = readEditor();
        const needle = normalize(text);
        if (!submit || !needle) return false;
        if (!left) return false;
        // Composer still holds our draft (send did not clear it).
        if (left === needle) return true;
        const head = needle.slice(0, Math.min(48, needle.length));
        if (head.length >= 12 && left.startsWith(head)) return true;
        if (needle.length >= 24 && left.includes(needle.slice(0, 24)) && left.length <= needle.length + 8) {
          return true;
        }
        return false;
      };

      if (submit) {
        const clickSend = async () => {
          await new Promise((r) => setTimeout(r, 60));
          const sendCandidates = [
            ...document.querySelectorAll(
              'button[aria-label="Send"], button[aria-label*="Send" i], button[data-testid*="send" i], .send-with-mode, [class*="send-with-mode"] button, form button[type="submit"]'
            ),
          ];
          const sendBtn = sendCandidates.find((btn) => {
            const style = window.getComputedStyle(btn);
            const rect = btn.getBoundingClientRect();
            return (
              !btn.disabled &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            );
          });
          if (sendBtn) sendBtn.click();
          else {
            const cur = pickEditor() || el;
            const mods = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
            cur.dispatchEvent(new KeyboardEvent('keydown', { ...mods, ctrlKey: true }));
            cur.dispatchEvent(new KeyboardEvent('keydown', mods));
            cur.dispatchEvent(new KeyboardEvent('keyup', mods));
          }
        };
        // First submit already clicked above — wait and verify; retry once if draft remains.
        await new Promise((r) => setTimeout(r, 280));
        if (draftStillThere()) {
          await clickSend();
          await new Promise((r) => setTimeout(r, 350));
        }
        // If Cursor still shows the draft, treat as soft warning — many builds keep
        // text until the model starts. Do not fail the whole paste (phone would restore it).
        if (draftStillThere()) {
          return { ok: true, submitted: true, warning: 'inserted_not_sent' };
        }
      }
      return { ok: true, submitted: !!submit };
    })()`);
    if (!result?.ok) throw new Error(result?.error || "insert_failed");
    return {
      ok: true,
      submitted: result?.submitted === true,
      warning: result?.warning || "",
    };
  }

  async sendToChat(cdpTargetId, chat, text, { submit = false } = {}) {
    await this.selectChat(cdpTargetId, chat);
    await sleep(150);
    return this.insertText(cdpTargetId, text, { submit });
  }

  /**
   * Read chat messages already loaded in the active Cursor composer DOM.
   * Does not scroll or force-load older history.
   * @returns {Promise<{ok:boolean, messages?: Array<{id:string,role:string,text:string}>, hash?: string, generating?: boolean, error?: string}>}
   */
  async readTranscript(
    cdpTargetId,
    chat,
    { maxMessages = 80, maxChars = 12000, select = true } = {}
  ) {
    try {
      // select=false for SSE polls — avoid re-clicking the sidebar every few seconds
      if (
        select &&
        (chat?.id || chat?.chatId || chat?.title || chat?.chatTitle)
      ) {
        await this.selectChat(cdpTargetId, chat);
        await sleep(120);
      }
      const { session } = await this.getSession(cdpTargetId);
      const maxMsg = Math.max(1, Math.min(200, Number(maxMessages) || 80));
      const maxCh = Math.max(500, Math.min(40000, Number(maxChars) || 12000));
      const raw = await session.evaluate(`(() => {
        const clean = (s) => String(s || '')
          .replace(/\\r\\n/g, '\\n')
          .replace(/[ \\t\\f\\v]+\\n/g, '\\n')
          .replace(/\\n[ \\t\\f\\v]+/g, '\\n')
          .replace(/[ \\t\\f\\v]{2,}/g, ' ')
          .replace(/\\n{3,}/g, '\\n\\n')
          .trim();
        const roleOf = (el) => {
          const aria = (el.getAttribute('data-message-role') ||
            el.getAttribute('data-role') ||
            el.getAttribute('aria-label') || '').toLowerCase();
          if (/user|human|you/.test(aria)) return 'user';
          if (/assistant|agent|ai|model|bot/.test(aria)) return 'assistant';
          const cls = String(el.className || '').toLowerCase();
          if (/\\buser\\b|human/.test(cls) && !/assistant|agent/.test(cls)) return 'user';
          if (/assistant|agent|ai-message|bubble-ai|model/.test(cls)) return 'assistant';
          const side = el.closest('[data-message-role], [data-role], [class*="human-message"], [class*="user-message"]');
          if (side) {
            const sAria = (side.getAttribute('data-message-role') || side.getAttribute('data-role') || '').toLowerCase();
            if (/user|human/.test(sAria)) return 'user';
            if (/assistant|agent|ai|model/.test(sAria)) return 'assistant';
            const sCls = String(side.className || '').toLowerCase();
            if (/user|human/.test(sCls) && !/assistant|agent/.test(sCls)) return 'user';
          }
          return 'assistant';
        };
        const textOf = (el) => {
          const skipSel = [
            '[class*="thought"]',
            '[class*="thinking"]',
            '[class*="tool-call"]',
            '[class*="tool_call"]',
            '[class*="composer-tool"]',
            '[data-testid*="tool"]',
            '[data-testid*="thought"]',
            '[contenteditable="true"]',
            'textarea',
            'button',
            'nav',
          ].join(',');
          const parts = [...el.querySelectorAll(
            '.anysphere-markdown-container-root, .markdown-root, [class*="markdown-root"], pre, p, li, h1, h2, h3, h4'
          )].filter((n) => !n.closest(skipSel));
          // Prefer direct block children text to avoid repeating nested markdown copies.
          const blocks = parts.filter((n) => !parts.some((o) => o !== n && o.contains(n)));
          if (blocks.length) {
            return clean(blocks.map((n) => n.innerText || n.textContent || '').filter(Boolean).join('\\n\\n'));
          }
          // Clone and strip chrome before reading plain text.
          const clone = el.cloneNode(true);
          for (const n of clone.querySelectorAll(skipSel)) n.remove();
          return clean(clone.innerText || clone.textContent || '');
        };
        const isChromeNode = (el) => {
          const cls = String(el.className || '').toLowerCase();
          const aria = String(el.getAttribute('aria-label') || '').toLowerCase();
          if (/thought|thinking|tool-call|tool_call|status-row/.test(cls)) return true;
          if (/thought|thinking/.test(aria)) return true;
          const sample = clean((el.innerText || '').slice(0, 80));
          if (/^(Thought|Thinking|Read|Edited|Grepped|Агент|Agent)\\b/i.test(sample) && sample.length < 60) {
            return true;
          }
          return false;
        };
        const roots = [
          '[data-message-role]',
          '[data-role="user"], [data-role="assistant"]',
          '[class*="composer-message"]',
          '[class*="agent-message"]',
          '[class*="chat-message"]',
          '[class*="message-bubble"]',
          '[class*="aislash-message"]',
        ];
        let nodes = [];
        for (const sel of roots) {
          const found = [...document.querySelectorAll(sel)];
          if (found.length) {
            nodes = found;
            break;
          }
        }
        // Keep outermost message nodes only (drop nested wrappers).
        nodes = nodes.filter((el) => !nodes.some((other) => other !== el && other.contains(el)));
        const out = [];
        const seenKeys = new Set();
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          // Skip composer / input chrome
          if (el.closest('[contenteditable="true"], textarea, [class*="prompt-input"], [class*="aislash-editor"]')) {
            continue;
          }
          if (isChromeNode(el)) continue;
          const text = textOf(el);
          if (!text || text.length < 1) continue;
          const role = roleOf(el);
          const key = role + '|' + text.replace(/\\s+/g, ' ').toLowerCase().slice(0, 500);
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);
          out.push({ id: 'm' + i + ':' + role + ':' + text.slice(0, 24), role, text });
        }
        const generatingSelectors = [
          'button[aria-label*="stop" i]',
          'button[title*="stop" i]',
          'button[aria-label*="cancel" i]',
          'button[title*="cancel" i]',
          '[data-testid*="stop" i]',
          '[data-testid*="cancel" i]',
          '[aria-busy="true"][class*="composer"]',
          '[aria-busy="true"][class*="agent"]',
        ];
        const generating = generatingSelectors.some((sel) =>
          [...document.querySelectorAll(sel)].some((el) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const label = clean(
              el.getAttribute('aria-label') ||
              el.getAttribute('title') ||
              el.getAttribute('data-testid')
            ).toLowerCase();
            const belongsToChat = !!el.closest(
              '[data-composer-id], [class*="composer"], [class*="chat"], [class*="agent"]'
            );
            return (belongsToChat || /(stop|cancel).*(generat|response|agent)/.test(label)) &&
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0 &&
              !el.disabled;
          })
        );
        return { messages: out, generating };
      })()`);
      const messages = normalizeTranscriptMessages(
        dedupeTranscriptMessages(Array.isArray(raw?.messages) ? raw.messages : []),
        { maxMessages: maxMsg, maxChars: maxCh }
      );
      return {
        ok: true,
        messages,
        hash: hashTranscript(messages),
        count: messages.length,
        generating: raw?.generating === true,
      };
    } catch (e) {
      const msg = String(e.message || e);
      if (/chat_not_found/i.test(msg)) {
        return { ok: false, error: "chat_not_found", hint: "chat_missing" };
      }
      if (/CDP|ECONNREFUSED|fetch|port/i.test(msg)) {
        return { ok: false, error: msg, hint: "cdp_closed" };
      }
      return { ok: false, error: msg };
    }
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
