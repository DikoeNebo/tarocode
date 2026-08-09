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
const {
  normalizeComposerChrome,
  normalizeClarifications,
  SUBMIT_BUTTON_SELECTOR,
} = require("./cdp-composer");

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
   * Expand collapsed workspace sections and click "See more" so more chats
   * appear in the Agents sidebar DOM. Only for explicit user refresh / pick.
   */
  async revealSidebarChats(session) {
    await session.evaluate(`(() => {
      for (const head of document.querySelectorAll(
        '.glass-sidebar-workspace-section-root .ui-sidebar-section-head[aria-expanded="false"]'
      )) {
        try { head.click(); } catch (_) {}
      }
      return true;
    })()`);
    await sleep(450);
    for (let round = 0; round < 6; round++) {
      const clicked = await session.evaluate(`(() => {
        let n = 0;
        for (const btn of document.querySelectorAll('.ui-sidebar-paginated-menu-toggle')) {
          const t = String(btn.textContent || '').trim();
          if (/see more|show more|ещё|еще|more/i.test(t)) {
            try { btn.click(); n++; } catch (_) {}
          }
        }
        return n;
      })()`);
      if (!clicked) break;
      await sleep(400);
    }
  }

  /**
   * List chat-like UI entries inside Cursor workbench DOM.
   * @param {string} cdpTargetId
   * @param {{ revealAll?: boolean }} [opts] revealAll expands projects + "See more" first
   * @returns {Promise<{ok:boolean, chats?: Array, projects?: Array, error?: string, cdpTargetId?: string}>}
   */
  async listChats(cdpTargetId, opts = {}) {
    try {
      const { session, target } = await this.getSession(cdpTargetId);
      if (opts.revealAll === true) {
        try {
          await this.revealSidebarChats(session);
        } catch {
          /* still try to read whatever is visible */
        }
      }
      const raw = await session.evaluate(`(() => {
        const outChats = [];
        const projects = [];
        const seen = new Set();
        const skip = /^(New Agent|New Chat|Agents|Cursor|See more|Show more|Pin|Unpin|Archive|Automations|Customize|Repositories|Search|Hide Sidebar|Go Back|Go Forward|Open Workspace|Ещё|Еще)$/i;
        const cleanTitle = (raw) => {
          let t = String(raw || '').trim().replace(/\\s+/g, ' ');
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
        const pushChat = (list, id, title, kind, project) => {
          const t = cleanTitle(title);
          if (!t || t.length < 2 || t.length > 120) return null;
          if (skip.test(t)) return null;
          const key = (project ? project + '|' : '') + (id || (kind + '|' + t));
          const titleKey = (project ? 'p|' + project + '|' : 'title|') + t;
          if (seen.has(key) || seen.has(titleKey)) return null;
          seen.add(key);
          seen.add(titleKey);
          const chat = {
            id: key,
            title: t,
            kind: kind || 'item',
            project: project || '',
          };
          list.push(chat);
          if (list !== outChats) outChats.push(chat);
          return chat;
        };

        const sections = document.querySelectorAll('.glass-sidebar-workspace-section-root');
        if (sections.length) {
          sections.forEach((sec, si) => {
            const titleEl = sec.querySelector(
              '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
            );
            const projectName =
              cleanTitle(titleEl ? titleEl.textContent : '') || ('Project ' + (si + 1));
            const head = sec.querySelector('.ui-sidebar-section-head');
            const expanded = head
              ? head.getAttribute('aria-expanded') === 'true' ||
                head.getAttribute('data-section-expanded') === 'true'
              : true;
            const hasMore = !![...sec.querySelectorAll('.ui-sidebar-paginated-menu-toggle')].find(
              (b) => /see more|show more|ещё|еще|more/i.test(String(b.textContent || ''))
            );
            const projectChats = [];
            sec.querySelectorAll('.glass-sidebar-agent-menu-btn').forEach((el, idx) => {
              const t = titleOf(el);
              pushChat(
                projectChats,
                'p:' + projectName + '|a#' + idx + ':' + t.slice(0, 40),
                t,
                'agent-sidebar',
                projectName
              );
            });
            projects.push({
              id: 'proj:' + projectName,
              name: projectName,
              expanded,
              hasMore,
              chats: projectChats,
            });
          });
        } else {
          // Legacy / alternate layouts (flat)
          document.querySelectorAll(
            '.glass-sidebar-agent-menu-btn, .glass-sidebar-agent-list-container .ui-sidebar-menu-button'
          ).forEach((el, idx) => {
            const t = titleOf(el);
            pushChat(outChats, 'agent#' + idx + ':' + t.slice(0, 40), t, 'agent-sidebar', '');
          });
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
              pushChat(
                outChats,
                composerId || (sel + '#' + idx + ':' + title.slice(0, 40)),
                title,
                sel,
                ''
              );
            });
          }
          if (!outChats.length) {
            const comp = document.querySelector('[data-composer-id]');
            if (comp) {
              pushChat(
                outChats,
                comp.getAttribute('data-composer-id'),
                ${JSON.stringify(CURRENT_AGENT_SENTINEL)},
                'current-composer',
                ''
              );
            }
          }
        }
        return {
          projects,
          chats: outChats.slice(0, 240),
        };
      })()`);
      const projects = Array.isArray(raw?.projects) ? raw.projects : [];
      const chats = Array.isArray(raw?.chats)
        ? raw.chats
        : Array.isArray(raw)
          ? raw
          : [];
      return {
        ok: true,
        projects,
        chats,
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
    const projectName = chat?.project || chat?.projectName || "";
    const ok = await session.evaluate(`(() => {
      const wantId = ${JSON.stringify(chatId)};
      const wantTitle = ${JSON.stringify(chatTitle)};
      const wantProject = ${JSON.stringify(projectName)};
      const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ')
        .replace(/\\s*(?:now|\\d+\\s*[smhd]|\\d+\\s*мин(?:ут[аы]?)?)\\s*$/i, '').trim();
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
      const projectOf = (el) => {
        const sec = el.closest('.glass-sidebar-workspace-section-root');
        if (!sec) return '';
        const titleEl = sec.querySelector(
          '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
        );
        return norm(titleEl ? titleEl.textContent : '');
      };
      if (wantId && wantId !== 'Текущий агент' && !wantId.includes('|') && !wantId.startsWith('agent#') && !wantId.startsWith('p:') && !/[\\"']/.test(wantId)) {
        const byComp = document.querySelector('[data-composer-id="' + wantId + '"]');
        if (byComp && click(byComp)) return true;
      }
      // Prefer agent buttons inside the matching project section
      const roots = wantProject
        ? [...document.querySelectorAll('.glass-sidebar-workspace-section-root')].filter((sec) => {
            const titleEl = sec.querySelector(
              '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
            );
            return norm(titleEl ? titleEl.textContent : '') === norm(wantProject);
          })
        : [document];
      const collect = (root) =>
        root.querySelectorAll(
          '.glass-sidebar-agent-menu-btn, .glass-sidebar-agent-list-container .ui-sidebar-menu-button, .agent-sidebar-cell, [aria-id="chat-horizontal-tab"], .composer-tab-label, [class*="agent-sidebar"] [role="button"], [class*="composer-tab"]'
        );
      const wt = norm(wantTitle);
      for (const root of roots) {
        for (const el of collect(root)) {
          if (el.classList?.contains('ui-sidebar-paginated-menu-toggle')) continue;
          const t = titleOf(el);
          if (wantId && (wantId.endsWith(':' + t.slice(0, 40)) || wantId.includes('|a#') && wantId.includes(t.slice(0, 40)))) {
            if (click(el)) return true;
          }
          if (wt && t === wt) {
            if (click(el)) return true;
          }
        }
      }
      // Global fallback (legacy flat ids)
      const nodes = document.querySelectorAll(
        '.glass-sidebar-agent-menu-btn, .glass-sidebar-agent-list-container .ui-sidebar-menu-button, .agent-sidebar-cell, [aria-id="chat-horizontal-tab"], .composer-tab-label, [class*="agent-sidebar"] [role="button"], [class*="composer-tab"]'
      );
      for (const el of nodes) {
        if (el.classList?.contains('ui-sidebar-paginated-menu-toggle')) continue;
        const t = titleOf(el);
        if (wantProject && projectOf(el) && projectOf(el) !== norm(wantProject)) continue;
        if (wantId && (wantId.endsWith(':' + t.slice(0, 40)) || wantId.includes(t))) {
          if (click(el)) return true;
        }
        if (wt && t === wt) {
          if (click(el)) return true;
        }
      }
      if (wt) {
        for (const el of nodes) {
          if (el.classList?.contains('ui-sidebar-paginated-menu-toggle')) continue;
          const t = titleOf(el);
          if (wantProject && projectOf(el) && projectOf(el) !== norm(wantProject)) continue;
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
            ${JSON.stringify(SUBMIT_BUTTON_SELECTOR)}
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
              ${JSON.stringify(SUBMIT_BUTTON_SELECTOR)}
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
   * Create a new Cursor agent/chat inside a named Agents sidebar project.
   * DOM heuristics only — Cursor UI may change.
   * @param {string} cdpTargetId
   * @param {string} projectName
   * @returns {Promise<{ok:boolean, chat?: object, error?: string, hint?: string}>}
   */
  async createChatInProject(cdpTargetId, projectName) {
    const project = String(projectName || "").trim();
    if (!project) {
      return { ok: false, error: "project_required", hint: "project_required" };
    }
    try {
      const { session } = await this.getSession(cdpTargetId);
      try {
        await this.revealSidebarChats(session);
      } catch {
        /* continue with visible DOM */
      }

      const before = await session.evaluate(`(() => {
        const want = ${JSON.stringify(project)};
        const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
        const sections = [...document.querySelectorAll('.glass-sidebar-workspace-section-root')];
        const sec = sections.find((s) => {
          const titleEl = s.querySelector(
            '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
          );
          return norm(titleEl ? titleEl.textContent : '') === norm(want);
        });
        if (!sec) return { ok: false, error: 'project_not_found' };
        const head = sec.querySelector('.ui-sidebar-section-head');
        const expanded = head
          ? head.getAttribute('aria-expanded') === 'true' ||
            head.getAttribute('data-section-expanded') === 'true'
          : true;
        if (!expanded && head) {
          try { head.click(); } catch (_) {}
        }
        const titles = [];
        sec.querySelectorAll('.glass-sidebar-agent-menu-btn').forEach((el) => {
          const label = el.querySelector(
            '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, [class*="menu-button-label"]'
          );
          const t = norm(label ? label.textContent : el.getAttribute('aria-label') || el.textContent);
          if (t) titles.push(t.slice(0, 80));
        });
        const composer =
          document.querySelector('[data-composer-id]')?.getAttribute('data-composer-id') || '';
        return { ok: true, titles, composer };
      })()`);

      if (!before?.ok) {
        return {
          ok: false,
          error: before?.error || "project_not_found",
          hint: "project_not_found",
        };
      }

      await sleep(200);

      const clicked = await session.evaluate(`(() => {
        const want = ${JSON.stringify(project)};
        const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ');
        const newRe = /^(new\\s*agent|new\\s*chat|новый\\s*агент|новый\\s*чат|\\+)$/i;
        const sections = [...document.querySelectorAll('.glass-sidebar-workspace-section-root')];
        const sec = sections.find((s) => {
          const titleEl = s.querySelector(
            '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
          );
          return norm(titleEl ? titleEl.textContent : '') === norm(want);
        });
        if (!sec) return { ok: false, error: 'project_not_found' };
        const click = (el) => {
          if (!el) return false;
          el.scrollIntoView({ block: 'nearest' });
          el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          if (typeof el.click === 'function') el.click();
          return true;
        };
        const candidates = [];
        const head = sec.querySelector('.ui-sidebar-section-head');
        if (head) {
          for (const el of head.querySelectorAll('button, [role="button"], a, [class*="icon"]')) {
            const aria = norm(el.getAttribute('aria-label') || el.getAttribute('title') || '');
            const t = norm(el.textContent || '');
            if (newRe.test(aria) || newRe.test(t) || aria.includes('new') || t === '+') {
              candidates.push(el);
            }
          }
        }
        for (const el of sec.querySelectorAll(
          'button, [role="button"], .glass-sidebar-agent-menu-btn, .ui-sidebar-menu-button'
        )) {
          const aria = norm(el.getAttribute('aria-label') || el.getAttribute('title') || '');
          const label = el.querySelector(
            '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, [class*="menu-button-label"]'
          );
          const t = norm(label ? label.textContent : el.textContent || '');
          if (newRe.test(aria) || newRe.test(t)) candidates.push(el);
        }
        // Prefer explicit New Agent / New Chat over bare "+"
        const ranked = candidates.filter(Boolean);
        ranked.sort((a, b) => {
          const score = (el) => {
            const aria = norm(el.getAttribute('aria-label') || '');
            const t = norm(el.textContent || '');
            if (/new\\s*agent|новый\\s*агент/i.test(aria + ' ' + t)) return 0;
            if (/new\\s*chat|новый\\s*чат/i.test(aria + ' ' + t)) return 1;
            return 2;
          };
          return score(a) - score(b);
        });
        for (const el of ranked) {
          if (click(el)) return { ok: true };
        }
        return { ok: false, error: 'new_chat_button_not_found' };
      })()`);

      if (!clicked?.ok) {
        return {
          ok: false,
          error: clicked?.error || "new_chat_button_not_found",
          hint: clicked?.error || "new_chat_button_not_found",
        };
      }

      let chat = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        await sleep(250 + attempt * 50);
        const after = await session.evaluate(`(() => {
          const want = ${JSON.stringify(project)};
          const beforeTitles = ${JSON.stringify(before.titles || [])};
          const beforeComposer = ${JSON.stringify(before.composer || "")};
          const norm = (s) => String(s || '').trim().replace(/\\s+/g, ' ')
            .replace(/\\s*(?:now|\\d+\\s*[smhd]|\\d+\\s*мин(?:ут[аы]?)?)\\s*$/i, '').trim();
          const newTitleRe = /^(new\\s*agent|new\\s*chat|новый\\s*агент|новый\\s*чат)$/i;
          const sections = [...document.querySelectorAll('.glass-sidebar-workspace-section-root')];
          const sec = sections.find((s) => {
            const titleEl = s.querySelector(
              '.ui-sidebar-section-head .ui-sidebar-label-row-title, .ui-sidebar-label-row-title'
            );
            return norm(titleEl ? titleEl.textContent : '') === norm(want);
          });
          const titleOf = (el) => {
            const label = el.querySelector(
              '.ui-sidebar-menu-button-label, .ui-sidebar-label-row-title, [class*="menu-button-label"]'
            );
            if (label) return norm(label.textContent || '');
            const aria = norm(el.getAttribute('aria-label') || '');
            if (aria && aria.length <= 120) return aria;
            return norm((el.textContent || '').slice(0, 160));
          };
          const composerEl = document.querySelector('[data-composer-id]');
          const composerId = composerEl
            ? composerEl.getAttribute('data-composer-id') || ''
            : '';
          const hasComposer = !!(
            composerEl ||
            document.querySelector('[contenteditable="true"]')
          );
          if (sec) {
            const btns = [...sec.querySelectorAll('.glass-sidebar-agent-menu-btn')];
            const scored = [];
            for (let idx = 0; idx < btns.length; idx++) {
              const el = btns[idx];
              const t = titleOf(el);
              if (!t) continue;
              let rank = -1;
              if (newTitleRe.test(t)) rank = 0;
              else if (!beforeTitles.includes(t)) rank = 1;
              if (rank < 0) continue;
              scored.push({
                rank,
                chat: {
                  id: 'p:' + want + '|a#' + idx + ':' + t.slice(0, 40),
                  title: t,
                  kind: 'agent-sidebar',
                  project: want,
                  composerId,
                },
              });
            }
            scored.sort((a, b) => a.rank - b.rank);
            if (scored[0]) {
              return { ok: true, chat: scored[0].chat, hasComposer };
            }
          }
          if (hasComposer && composerId && composerId !== beforeComposer) {
            return {
              ok: true,
              chat: {
                id: composerId,
                title: ${JSON.stringify(CURRENT_AGENT_SENTINEL)},
                kind: 'current-composer',
                project: want,
                composerId,
              },
              hasComposer,
            };
          }
          if (hasComposer) {
            return {
              ok: true,
              chat: {
                id: composerId || 'p:' + want + '|new',
                title: ${JSON.stringify(CURRENT_AGENT_SENTINEL)},
                kind: 'current-composer',
                project: want,
                composerId,
              },
              hasComposer,
            };
          }
          return { ok: false, hasComposer: false };
        })()`);
        if (after?.ok && after.chat) {
          chat = after.chat;
          break;
        }
      }

      if (!chat) {
        return {
          ok: false,
          error: "composer_not_ready",
          hint: "composer_not_ready",
        };
      }
      return { ok: true, chat };
    } catch (e) {
      return { ok: false, error: String(e.message || e), hint: "create_chat_failed" };
    }
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
      let composer = normalizeComposerChrome({ generating: raw?.generating === true });
      let clarifications = [];
      try {
        const chrome = await this.getComposerChrome(cdpTargetId);
        if (chrome?.ok) {
          composer = chrome.composer;
          clarifications = chrome.clarifications || [];
        }
      } catch {
        /* chrome scrape is best-effort */
      }
      return {
        ok: true,
        messages,
        hash: hashTranscript(messages),
        count: messages.length,
        generating: raw?.generating === true || composer.generating === true,
        composer,
        clarifications,
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

  /**
   * Read composer mode / submit label / model / clarifying question widgets.
   */
  async getComposerChrome(cdpTargetId) {
    const { session } = await this.getSession(cdpTargetId);
    const raw = await session.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
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
      const submitSel = ${JSON.stringify(SUBMIT_BUTTON_SELECTOR)};
      const submitBtns = [...document.querySelectorAll(submitSel)].filter(visible);
      let submitLabel = '';
      for (const btn of submitBtns) {
        const label = clean(
          btn.getAttribute('aria-label') ||
          btn.getAttribute('title') ||
          btn.innerText ||
          btn.textContent
        );
        if (label) {
          submitLabel = label;
          break;
        }
      }
      // Mode control near send-with-mode
      let modeLabel = '';
      const modeRoots = [
        ...document.querySelectorAll(
          '.send-with-mode, [class*="send-with-mode"], [class*="mode-selector"], [class*="composer-mode"], [data-testid*="mode" i]'
        ),
      ].filter(visible);
      for (const root of modeRoots) {
        const btn =
          root.matches('button') ? root :
          root.querySelector('button, [role="button"], [aria-haspopup="menu"], [aria-haspopup="listbox"]');
        const label = clean(
          (btn || root).getAttribute('aria-label') ||
          (btn || root).innerText ||
          (btn || root).textContent
        );
        if (label && !/^(send|build)$/i.test(label)) {
          modeLabel = label.split(/\\n/)[0].slice(0, 40);
          break;
        }
      }
      if (!modeLabel) {
        const modeBtn = [...document.querySelectorAll('button, [role="button"]')].find((el) => {
          if (!visible(el)) return false;
          const t = clean(el.getAttribute('aria-label') || el.innerText || '').toLowerCase();
          return /\\b(agent|plan|ask|edit)\\b/.test(t) && t.length < 48;
        });
        if (modeBtn) {
          modeLabel = clean(modeBtn.getAttribute('aria-label') || modeBtn.innerText);
        }
      }
      let modelLabel = '';
      const modelBtn = [...document.querySelectorAll('button, [role="button"], [aria-haspopup]')].find((el) => {
        if (!visible(el)) return false;
        const t = clean(el.getAttribute('aria-label') || el.innerText || '');
        const low = t.toLowerCase();
        if (t.length < 2 || t.length > 64) return false;
        if (/send|build|agent|plan|stop|cancel|mic|attach|image/.test(low)) return false;
        if (/model|gpt|claude|composer|sonnet|opus|gemini|grok/.test(low)) return true;
        // Heuristic: model chips often sit left of send in composer footer
        const nearComposer = !!el.closest('[class*="composer"], [class*="prompt"], [class*="aislash"], form');
        return nearComposer && /[A-Za-z].*\\d|v\\d|[-_]/.test(t) && t.split(' ').length <= 4;
      });
      if (modelBtn) {
        modelLabel = clean(modelBtn.getAttribute('aria-label') || modelBtn.innerText).split(/\\n/)[0];
      }

      const generating = [
        'button[aria-label*="stop" i]',
        'button[aria-label*="cancel" i]',
        '[data-testid*="stop" i]',
      ].some((sel) =>
        [...document.querySelectorAll(sel)].some((el) => visible(el) && !el.disabled)
      );

      // Clarifying / ask-user widgets in the transcript area
      const clarifications = [];
      const qRoots = [
        ...document.querySelectorAll(
          '[class*="ask-user"], [class*="ask_user"], [class*="clarif"], [data-testid*="question" i], [data-testid*="ask" i], [role="group"][aria-label*="question" i], [class*="quiz"], [class*="choice-group"]'
        ),
      ].filter(visible);
      const seen = new Set();
      for (let i = 0; i < qRoots.length && clarifications.length < 6; i++) {
        const root = qRoots[i];
        if (root.closest('[contenteditable="true"], textarea, [class*="prompt-input"]')) continue;
        const promptEl =
          root.querySelector('h1,h2,h3,h4,p,[class*="question"],[class*="prompt"],legend') || root;
        const prompt = clean(promptEl.innerText || promptEl.textContent).slice(0, 500);
        if (!prompt || prompt.length < 3) continue;
        const key = prompt.toLowerCase().slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);
        const optionEls = [
          ...root.querySelectorAll(
            'button, [role="button"], [role="radio"], [role="option"], label, input[type="radio"] + span, [class*="option"]'
          ),
        ].filter((el) => visible(el) && !el.disabled);
        const options = [];
        const optSeen = new Set();
        for (let j = 0; j < optionEls.length && options.length < 12; j++) {
          const el = optionEls[j];
          const label = clean(el.getAttribute('aria-label') || el.innerText || el.textContent).slice(0, 200);
          if (!label || label.length < 1) continue;
          if (/^(send|build|cancel|skip|stop)$/i.test(label)) continue;
          const ok = label.toLowerCase();
          if (optSeen.has(ok)) continue;
          optSeen.add(ok);
          options.push({ id: 'opt-' + j, label });
        }
        // Fallback: adjacent buttons under a question-looking heading
        if (!options.length) {
          const sibButtons = [...root.querySelectorAll('button')].filter(visible);
          for (let j = 0; j < sibButtons.length && options.length < 8; j++) {
            const label = clean(sibButtons[j].innerText || '').slice(0, 200);
            if (label && label.length < 120) options.push({ id: 'opt-' + j, label });
          }
        }
        clarifications.push({
          id: 'q-' + i,
          prompt,
          options,
        });
      }

      // Also: message bubbles that look like "pick one" with button rows
      if (!clarifications.length) {
        const msgBlocks = [...document.querySelectorAll(
          '[data-message-role="assistant"], [data-role="assistant"], [class*="assistant"], [class*="agent-message"]'
        )].filter(visible).slice(-4);
        for (let i = 0; i < msgBlocks.length; i++) {
          const block = msgBlocks[i];
          const buttons = [...block.querySelectorAll('button')].filter((b) => {
            if (!visible(b) || b.disabled) return false;
            const t = clean(b.innerText || b.getAttribute('aria-label') || '');
            return t && t.length < 100 && !/^(send|build|copy|retry)$/i.test(t);
          });
          if (buttons.length < 2) continue;
          const prompt = clean(
            (block.querySelector('p,h1,h2,h3,h4') || block).innerText || ''
          ).slice(0, 400);
          if (!prompt) continue;
          clarifications.push({
            id: 'msg-q-' + i,
            prompt,
            options: buttons.slice(0, 10).map((b, j) => ({
              id: 'opt-' + j,
              label: clean(b.innerText || b.getAttribute('aria-label') || ''),
            })),
          });
          break;
        }
      }

      return {
        modeLabel,
        submitLabel,
        modelLabel,
        generating,
        clarifications,
      };
    })()`);

    const composer = normalizeComposerChrome({
      modeLabel: raw?.modeLabel,
      submitLabel: raw?.submitLabel,
      modelLabel: raw?.modelLabel,
      generating: raw?.generating === true,
    });
    const clarifications = normalizeClarifications(raw?.clarifications);
    return { ok: true, composer, clarifications };
  }

  async setComposerMode(cdpTargetId, mode) {
    const want = String(mode || "agent").toLowerCase();
    const { session } = await this.getSession(cdpTargetId);
    const raw = await session.evaluate(`(async () => {
      const want = ${JSON.stringify(want)};
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const matchWant = (label) => {
        const t = clean(label).toLowerCase();
        if (want === 'plan') return /\\bplan\\b|план/.test(t);
        if (want === 'ask') return /\\bask\\b|вопрос/.test(t);
        if (want === 'edit') return /\\bedit\\b|редакт/.test(t);
        return /\\bagent\\b|агент/.test(t) || (!/\\b(plan|ask|edit)\\b/.test(t) && t.includes('agent'));
      };
      // Already selected?
      const modeRoots = [
        ...document.querySelectorAll(
          '.send-with-mode, [class*="send-with-mode"], [class*="mode-selector"], [class*="composer-mode"], button, [role="button"]'
        ),
      ].filter(visible);
      for (const el of modeRoots) {
        const label = clean(el.getAttribute('aria-label') || el.innerText || '');
        if (matchWant(label) && label.length < 48 && !/send|build/i.test(label)) {
          // If this looks like the current mode chip (not a menu item), done.
          if (el.getAttribute('aria-expanded') === 'false' || el.getAttribute('aria-haspopup')) {
            // open menu
            el.click();
            await new Promise((r) => setTimeout(r, 180));
            break;
          }
        }
      }
      // Open any mode dropdown near composer
      const openers = [...document.querySelectorAll(
        '[aria-haspopup="menu"], [aria-haspopup="listbox"], .send-with-mode button, [class*="send-with-mode"] button, [class*="mode"] button'
      )].filter(visible);
      for (const opener of openers) {
        const lab = clean(opener.getAttribute('aria-label') || opener.innerText || '').toLowerCase();
        if (/send|build|stop|mic|attach/.test(lab) && !/agent|plan|ask|mode/.test(lab)) continue;
        if (/agent|plan|ask|edit|mode/.test(lab) || opener.closest('.send-with-mode, [class*="send-with-mode"], [class*="mode"]')) {
          opener.click();
          await new Promise((r) => setTimeout(r, 200));
          break;
        }
      }
      const items = [
        ...document.querySelectorAll(
          '[role="menuitem"], [role="option"], [role="menuitemradio"], [data-radix-collection-item], div[role="button"], button'
        ),
      ].filter(visible);
      for (const item of items) {
        const label = clean(item.getAttribute('aria-label') || item.innerText || '');
        if (!label || label.length > 64) continue;
        if (matchWant(label)) {
          item.click();
          return { ok: true, mode: want, label };
        }
      }
      return { ok: false, error: 'mode_not_found', mode: want };
    })()`);
    if (!raw?.ok) {
      return { ok: false, error: raw?.error || "mode_not_found", hint: "mode_ui_missing" };
    }
    await sleep(150);
    const chrome = await this.getComposerChrome(cdpTargetId);
    return { ok: true, mode: want, composer: chrome.composer };
  }

  async setComposerModel(cdpTargetId, model) {
    const want = String(model || "").trim();
    if (!want) return { ok: false, error: "model_required", hint: "model_required" };
    const { session } = await this.getSession(cdpTargetId);
    const raw = await session.evaluate(`(async () => {
      const want = ${JSON.stringify(want)};
      const wantLow = want.toLowerCase();
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const openers = [...document.querySelectorAll('button, [role="button"], [aria-haspopup]')].filter((el) => {
        if (!visible(el)) return false;
        const t = clean(el.getAttribute('aria-label') || el.innerText || '');
        const low = t.toLowerCase();
        if (!t || t.length > 64) return false;
        if (/send|build|stop|cancel|mic|attach/.test(low)) return false;
        return /model|gpt|claude|composer|sonnet|opus|gemini|grok/.test(low) ||
          (!!el.closest('[class*="composer"], [class*="prompt"], form') && /[A-Za-z].*\\d/.test(t));
      });
      if (!openers.length) return { ok: false, error: 'model_ui_missing' };
      openers[0].click();
      await new Promise((r) => setTimeout(r, 220));
      const items = [...document.querySelectorAll(
        '[role="menuitem"], [role="option"], [data-radix-collection-item], button, [role="button"]'
      )].filter(visible);
      for (const item of items) {
        const label = clean(item.getAttribute('aria-label') || item.innerText || '');
        if (!label) continue;
        const low = label.toLowerCase();
        if (low === wantLow || low.includes(wantLow) || wantLow.includes(low)) {
          item.click();
          return { ok: true, model: label };
        }
      }
      return { ok: false, error: 'model_not_found' };
    })()`);
    if (!raw?.ok) {
      return {
        ok: false,
        error: raw?.error || "model_ui_missing",
        hint: raw?.error || "model_ui_missing",
      };
    }
    await sleep(120);
    const chrome = await this.getComposerChrome(cdpTargetId);
    return { ok: true, model: raw.model, composer: chrome.composer };
  }

  async answerClarification(cdpTargetId, { clarificationId, optionId, text } = {}) {
    const { session } = await this.getSession(cdpTargetId);
    const wantText = String(text || "").trim();
    const wantOpt = String(optionId || "").trim();
    const wantQ = String(clarificationId || "").trim();
    const raw = await session.evaluate(`(() => {
      const wantText = ${JSON.stringify(wantText)};
      const wantOpt = ${JSON.stringify(wantOpt)};
      const wantQ = ${JSON.stringify(wantQ)};
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };
      const qRoots = [
        ...document.querySelectorAll(
          '[class*="ask-user"], [class*="ask_user"], [class*="clarif"], [data-testid*="question" i], [data-testid*="ask" i], [role="group"], [class*="quiz"], [class*="choice-group"], [data-message-role="assistant"], [data-role="assistant"], [class*="agent-message"]'
        ),
      ].filter(visible);
      let root = null;
      if (wantQ) {
        const idx = Number(String(wantQ).replace(/\\D+/g, ''));
        if (!Number.isNaN(idx) && qRoots[idx]) root = qRoots[idx];
      }
      if (!root) root = qRoots[qRoots.length - 1] || null;
      if (!root && !wantText) return { ok: false, error: 'clarification_not_found' };

      if (wantOpt || wantText) {
        const buttons = [...(root || document).querySelectorAll('button, [role="button"], [role="radio"], [role="option"]')].filter(visible);
        const targetLabel = wantText || wantOpt;
        for (const btn of buttons) {
          const label = clean(btn.getAttribute('aria-label') || btn.innerText || '');
          const idGuess = clean(btn.getAttribute('data-option-id') || btn.id || '');
          if (
            (wantOpt && (idGuess === wantOpt || label === wantOpt || ('opt-' + buttons.indexOf(btn)) === wantOpt)) ||
            (targetLabel && label.toLowerCase() === targetLabel.toLowerCase()) ||
            (targetLabel && label.toLowerCase().includes(targetLabel.toLowerCase()))
          ) {
            btn.click();
            return { ok: true, clicked: label };
          }
        }
      }
      return { ok: false, error: 'option_not_found' };
    })()`);

    if (raw?.ok) return { ok: true, clicked: raw.clicked };

    // Fallback: type the answer into composer and submit
    if (wantText) {
      return this.insertText(cdpTargetId, wantText, { submit: true });
    }
    return {
      ok: false,
      error: raw?.error || "clarification_not_found",
      hint: "clarification_not_found",
    };
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

/**
 * Validate IPC payload for creating a chat in a project (unit-tested).
 * @param {unknown} payload
 * @returns {{ok:true, cdpTargetId:string, projectName:string}|{ok:false, error:string, hint:string}}
 */
function normalizeCreateChatRequest(payload) {
  const cdpTargetId = String(
    payload?.cdpTargetId || payload?.id || ""
  ).trim();
  const projectName = String(
    payload?.projectName || payload?.project || ""
  ).trim();
  if (!cdpTargetId) {
    return { ok: false, error: "cdp_target_required", hint: "cdp_target_required" };
  }
  if (!projectName) {
    return { ok: false, error: "project_required", hint: "project_required" };
  }
  return { ok: true, cdpTargetId, projectName };
}

module.exports = {
  DEFAULT_PORT,
  CdpClient,
  getCdpClient,
  normalizeCreateChatRequest,
  CURRENT_AGENT_SENTINEL,
};
