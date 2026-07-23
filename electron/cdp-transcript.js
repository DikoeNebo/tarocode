/**
 * Pure helpers for Cursor chat transcript normalization (testable without CDP).
 */

const MAX_MESSAGES_DEFAULT = 80;
const MAX_CHARS_DEFAULT = 12000;
const MAX_SINGLE = 4000;

/** Keep paragraph breaks; collapse only horizontal runs of spaces/tabs. */
function cleanTranscriptText(s) {
  return String(s || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n[ \t\f\v]+/g, "\n")
    .replace(/[ \t\f\v]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function textKey(text) {
  return cleanTranscriptText(text).replace(/\s+/g, " ").toLowerCase();
}

/**
 * Strip Cursor agent chrome that leaks into DOM text:
 * Thought blocks, tool rows (Read/Edited/…), lone «Агент» labels, diff stats.
 */
function stripAgentUiChrome(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inThought = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (!inThought && out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    if (/^Thought\b/i.test(t) || /^Thinking\b/i.test(t)) {
      inThought = true;
      continue;
    }
    if (inThought) {
      if (/^for\s+\d+\s*s\b/i.test(t)) continue;
      if (/^(Read|Edited|Grepped|Searched|Running|Shell|Deleted|Wrote|StrReplace|TodoWrite|CallMcpTool|Browse|Agent|Агент)\b/i.test(t)) {
        continue;
      }
      // Real reply prose after a thought block.
      if (t.length >= 28 && !/^(for\s+\d+)/i.test(t)) {
        inThought = false;
        out.push(line);
      }
      continue;
    }
    if (/^(Агент|Agent)$/i.test(t)) continue;
    if (
      /^(Read|Edited|Grepped|Searched|Running|Shell|Deleted|Wrote|StrReplace|TodoWrite|CallMcpTool|Browse)\b/i.test(
        t
      ) &&
      t.length < 160
    ) {
      continue;
    }
    // "remote.js L380-479" / path tool crumbs
    if (/^[\w./\\-]+\.(js|ts|tsx|jsx|html|css|md|json)\b.*\bL\d+/i.test(t) && t.length < 120) {
      continue;
    }
    // "+4 -3" diff counters
    if (/^[+\-]\d+(\s+[+\-]\d+)?\s*$/.test(t)) continue;
    out.push(line);
  }
  return cleanTranscriptText(out.join("\n"));
}

/** True when the whole bubble is UI chrome, not a real chat message. */
function isUiChromeMessage(text) {
  const cleaned = stripAgentUiChrome(text);
  if (!cleaned) return true;
  const key = textKey(cleaned);
  if (key.length < 2) return true;
  if (/^(thought|thinking|агент|agent)(\s+for\s+\d+s)?$/i.test(key)) return true;
  if (
    /^(read|edited|grepped|searched|running|shell|deleted|wrote)\b/i.test(key) &&
    key.length < 100
  ) {
    return true;
  }
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const noise = lines.filter((l) =>
      /^(Thought|Thinking|Read|Edited|Grepped|Searched|Running|Shell|Deleted|Wrote|StrReplace|TodoWrite|CallMcpTool|Агент|Agent)\b/i.test(
        l
      )
    );
    if (noise.length / lines.length >= 0.55) return true;
  }
  return false;
}

/**
 * @param {Array<{id?: string, role?: string, text?: string}>} messages
 * @param {{ maxMessages?: number, maxChars?: number }} [opts]
 */
function normalizeTranscriptMessages(messages, opts = {}) {
  const maxMessages = Math.max(1, Math.min(200, Number(opts.maxMessages) || MAX_MESSAGES_DEFAULT));
  const maxChars = Math.max(500, Math.min(40000, Number(opts.maxChars) || MAX_CHARS_DEFAULT));
  const out = [];
  let total = 0;
  const list = Array.isArray(messages) ? messages : [];
  for (let i = 0; i < list.length; i++) {
    const raw = list[i] || {};
    let text = stripAgentUiChrome(raw.text);
    if (!text || isUiChromeMessage(text)) continue;
    if (text.length > MAX_SINGLE) text = text.slice(0, MAX_SINGLE) + "…";
    if (total + text.length > maxChars) {
      const room = maxChars - total;
      if (room < 40) break;
      text = text.slice(0, room) + "…";
    }
    total += text.length;
    let role = String(raw.role || "assistant").toLowerCase();
    if (role !== "user" && role !== "assistant") role = "assistant";
    const id = String(raw.id || `m${i}:${role}:${text.slice(0, 24)}`);
    out.push({ id, role, text });
    if (out.length >= maxMessages) break;
  }
  return out;
}

/** Stable change-detection hash (no crypto; safe to expose to clients). */
function hashTranscript(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let h = list.length + "|";
  for (const m of list) {
    const role = m?.role || "";
    const text = String(m?.text || "");
    h += role + ":" + text.length + ":" + text.slice(-16) + ";";
  }
  return String(h.length) + ":" + h.slice(0, 180);
}

/**
 * Drop exact duplicates and nested/partial copies of the same reply.
 * Cursor DOM often exposes the same bubble via parent + markdown children.
 */
function dedupeTranscriptMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const prepared = [];
  for (const m of list) {
    const role = m?.role === "user" ? "user" : "assistant";
    const text = stripAgentUiChrome(m?.text);
    if (!text || isUiChromeMessage(text)) continue;
    prepared.push({
      id: String(m.id || ""),
      role,
      text,
      key: textKey(text),
    });
  }

  // Pass 1: drop exact key duplicates (keep first).
  const exact = [];
  const seen = new Set();
  for (const m of prepared) {
    if (seen.has(m.role + "|" + m.key)) continue;
    seen.add(m.role + "|" + m.key);
    exact.push(m);
  }

  // Pass 2: drop shorter messages fully contained in a longer same-role neighbor.
  const out = [];
  for (let i = 0; i < exact.length; i++) {
    const m = exact[i];
    let drop = false;
    for (let j = 0; j < exact.length; j++) {
      if (i === j) continue;
      const other = exact[j];
      if (other.role !== m.role) continue;
      if (other.key === m.key) continue;
      if (
        other.key.includes(m.key) &&
        other.key.length > m.key.length + 24
      ) {
        drop = true;
        break;
      }
    }
    if (drop) continue;

    const prev = out[out.length - 1];
    if (prev && prev.role === m.role && prev.key === m.key) continue;
    if (
      prev &&
      prev.role === m.role &&
      prev.key.includes(m.key) &&
      prev.key.length > m.key.length + 20
    ) {
      continue;
    }
    if (
      prev &&
      prev.role === m.role &&
      m.key.includes(prev.key) &&
      m.key.length > prev.key.length + 20
    ) {
      out[out.length - 1] = {
        id: m.id || prev.id,
        role: m.role,
        text: m.text,
        key: m.key,
      };
      continue;
    }
    out.push({
      id: m.id || `${m.role}:${m.key.slice(0, 32)}`,
      role: m.role,
      text: m.text,
      key: m.key,
    });
  }
  return out.map(({ id, role, text }) => ({ id, role, text }));
}

module.exports = {
  MAX_MESSAGES_DEFAULT,
  MAX_CHARS_DEFAULT,
  cleanTranscriptText,
  stripAgentUiChrome,
  isUiChromeMessage,
  normalizeTranscriptMessages,
  hashTranscript,
  dedupeTranscriptMessages,
};
