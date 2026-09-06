/**
 * Pure helpers to re-attach saved Cursor chats after CDP window ids change.
 * Chrome debugger ids are ephemeral; title + project are the durable identity.
 * Agent index a#N is a rename fallback (Cursor often retitles chats).
 */

function normChatText(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*(?:now|\d+\s*[smhd]|\d+\s*мин(?:ут[аы]?)?)\s*$/i, "")
    .trim()
    .toLowerCase();
}

/** @returns {number|null} sidebar agent index from ids like p:proj|a#20:Title */
function parseAgentIndex(chatId) {
  const m = String(chatId || "").match(/\|a#(\d+)(?::|$)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** @returns {string} project name embedded in p:Name|… ids */
function parseProjectFromChatId(chatId) {
  const s = String(chatId || "");
  const m = s.match(/(?:^|\|)p:([^|]+)\|/i);
  return m ? String(m[1] || "").trim() : "";
}

function chatIdentity(chat) {
  const id = String(chat?.id || chat?.chatId || "").trim();
  const project =
    normChatText(chat?.project || chat?.projectName || "") ||
    normChatText(parseProjectFromChatId(id));
  return {
    id,
    title: normChatText(chat?.title || chat?.chatTitle || ""),
    project,
    agentIndex: parseAgentIndex(id),
  };
}

/**
 * Higher is better. 0 = not a match.
 * @param {object} listed
 * @param {object} want
 */
function scoreChatMatch(listed, want) {
  const a = chatIdentity(listed);
  const b = chatIdentity(want);
  if (!b.id && !b.title && b.agentIndex == null) return 0;
  if (b.project && a.project && b.project !== a.project) return 0;
  if (b.id && a.id && a.id === b.id) return 100;
  const titleA = a.title;
  const titleB = b.title;
  if (titleB && titleA === titleB) {
    return b.project && a.project === b.project ? 90 : 70;
  }
  if (titleB && titleA && (titleA.startsWith(titleB.slice(0, 24)) || titleB.startsWith(titleA.slice(0, 24)))) {
    return b.project && a.project === b.project ? 55 : 40;
  }
  // Cursor renames agents — keep the same sidebar slot when titles diverge.
  if (
    b.agentIndex != null &&
    a.agentIndex != null &&
    b.agentIndex === a.agentIndex &&
    (!b.project || !a.project || b.project === a.project)
  ) {
    return b.project && a.project === b.project ? 62 : 45;
  }
  // Title fragment embedded in the opposite id (legacy / truncated ids).
  if (titleA && b.id && b.id.toLowerCase().includes(titleA.slice(0, 40))) return 50;
  if (titleB && a.id && a.id.toLowerCase().includes(titleB.slice(0, 40))) return 50;
  return 0;
}

/**
 * @param {Array} chats
 * @param {object} want
 * @returns {object|null}
 */
function findBestChat(chats, want) {
  const list = Array.isArray(chats) ? chats : [];
  let best = null;
  let bestScore = 0;
  for (const c of list) {
    const n = scoreChatMatch(c, want);
    if (n > bestScore) {
      bestScore = n;
      best = c;
    }
  }
  return bestScore >= 40 ? best : null;
}

function windowIdMatches(target, storedId) {
  const want = String(storedId || "");
  if (!want || !target) return false;
  if (String(target.id || "") === want) return true;
  const ws = String(target.webSocketDebuggerUrl || "");
  return ws.includes(want);
}

/**
 * Pick a CDP page for a stored window id.
 * If the id vanished (Cursor restart), use the only remaining window.
 * @returns {{ target: object|null, reason: string }}
 */
function pickCdpWindow(targets, storedId) {
  const list = (Array.isArray(targets) ? targets : []).filter(
    (t) => t && (t.id || t.webSocketDebuggerUrl)
  );
  const want = String(storedId || "");
  if (want) {
    const exact = list.find((t) => windowIdMatches(t, want));
    if (exact) return { target: exact, reason: "exact" };
  }
  if (list.length === 1) {
    return { target: list[0], reason: want ? "healed-single" : "single" };
  }
  if (!list.length) return { target: null, reason: "none" };
  return { target: null, reason: want ? "stale" : "ambiguous" };
}

function transcriptFailHint(errorMessage) {
  const msg = String(errorMessage || "");
  if (/chat_not_found/i.test(msg)) return "chat_missing";
  if (
    /windowMissing|window not found|окно Cursor не найдено|вікно Cursor не знайдено/i.test(
      msg
    )
  ) {
    return "window_missing";
  }
  if (
    /ECONNREFUSED|cdp_closed|portClosed|port closed|порт CDP|CDP closed|CDP connect timeout|CDP WebSocket|CDP timeout/i.test(
      msg
    )
  ) {
    return "cdp_closed";
  }
  return "";
}

/**
 * Cursor sidebar `.agent-status-dot` labels → stable Keycode status ids.
 * @returns {''|'draft'|'running'|'needs-attention'|'done-unseen'|'done-seen'}
 */
function normalizeAgentStatus(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (!s) return "";
  if (s === "running" || s === "generating" || s === "working") return "running";
  if (
    s === "needs-attention" ||
    s === "waiting" ||
    s === "awaiting" ||
    s === "needs-input"
  ) {
    return "needs-attention";
  }
  if (s === "done-unseen" || s === "unread" || s === "done-unread") {
    return "done-unseen";
  }
  if (s === "done-seen" || s === "done" || s === "idle" || s === "ready") {
    return "done-seen";
  }
  if (s === "draft") return "draft";
  return "";
}

module.exports = {
  normChatText,
  parseAgentIndex,
  parseProjectFromChatId,
  chatIdentity,
  scoreChatMatch,
  findBestChat,
  windowIdMatches,
  pickCdpWindow,
  transcriptFailHint,
  normalizeAgentStatus,
};
