/**
 * Rule-based next-card suggestions from a Cursor chat transcript.
 * No AI — parses KEYCODE_SCORE / last pasted card prompt.
 * Callers freeze the previous list while generating === true.
 */

const MATCH_PREFIX = 120;

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cardIds(cards) {
  return new Set((cards || []).map((c) => c && c.id).filter(Boolean));
}

/** Prefer fix; pro decks use the same id. */
function pickFixId(ids) {
  if (ids.has("fix")) return "fix";
  return null;
}

/**
 * @param {string} text
 * @returns {number | null}
 */
function parseScore(text) {
  const s = String(text || "");
  const key = s.match(/KEYCODE_SCORE\s*:\s*(\d{1,2})\b/i);
  if (key) {
    const n = Number(key[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
  }
  const patterns = [
    /Балл оценки проекта\s*:\s*(\d{1,2})\s*\/\s*10/i,
    /Project quality score\s*:\s*(\d{1,2})\s*\/\s*10/i,
    /балл[а-яё\s]*:\s*(\d{1,2})\s*\/\s*10/i,
    /(?:quality\s+)?score\s*:\s*(\d{1,2})\s*\/\s*10/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 10) return n;
    }
  }
  return null;
}

/**
 * @param {Array<{ role?: string, text?: string }>} messages
 * @returns {number | null}
 */
function latestScore(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (String(m?.role || "").toLowerCase() !== "assistant") continue;
    const score = parseScore(m.text);
    if (score != null) return score;
  }
  return null;
}

/**
 * @param {string} text
 * @returns {'pass' | 'fail' | null}
 */
function parseTestOutcome(text) {
  const s = String(text || "");
  if (
    /ТЕСТ\s+ПРОЙДЕН/i.test(s) ||
    /TEST\s+PASSED/i.test(s) ||
    /\bgreen\b/i.test(s)
  ) {
    if (/красн|fail|\bred\b|блокер|blocker/i.test(s) && !/ТЕСТ\s+ПРОЙДЕН|TEST\s+PASSED/i.test(s)) {
      return "fail";
    }
    return "pass";
  }
  if (/красн|\bfail\b|\bred\b|блокер|blocker|не пройден|test\s+failed/i.test(s)) {
    return "fail";
  }
  return null;
}

/**
 * @param {Array<{ role?: string, text?: string }>} messages
 * @returns {'pass' | 'fail' | null}
 */
function latestTestOutcome(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (String(m?.role || "").toLowerCase() !== "assistant") continue;
    const o = parseTestOutcome(m.text);
    if (o) return o;
  }
  return null;
}

/**
 * Match one user message text to a deck card prompt.
 * @param {string} userTextNorm
 * @param {Array<{ id: string, prompt?: string }>} cards
 * @param {Set<string>} [skipIds]
 * @returns {string | null}
 */
function matchCardIdFromText(userTextNorm, cards, skipIds) {
  if (!userTextNorm) return null;
  let best = null;
  let bestLen = 0;
  for (const card of cards || []) {
    if (!card?.id || !card.prompt) continue;
    if (skipIds && skipIds.has(card.id)) continue;
    const prompt = normText(card.prompt);
    if (prompt.length < 24) continue;
    const prefix = prompt.slice(0, MATCH_PREFIX);
    if (userTextNorm.startsWith(prefix) || userTextNorm.includes(prefix)) {
      if (prefix.length > bestLen) {
        best = card.id;
        bestLen = prefix.length;
      }
      continue;
    }
    // Shorter unique head for truncated DOM paste
    const short = prompt.slice(0, 64);
    if (
      short.length >= 24 &&
      (userTextNorm.startsWith(short) || userTextNorm.includes(short))
    ) {
      if (short.length > bestLen) {
        best = card.id;
        bestLen = short.length;
      }
    }
  }
  return best;
}

/**
 * Match the latest user message to a deck card prompt.
 * @param {Array<{ role?: string, text?: string }>} messages
 * @param {Array<{ id: string, prompt?: string }>} cards
 * @returns {string | null}
 */
function detectLastCardId(messages, cards) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i]?.role || "").toLowerCase() !== "user") continue;
    return matchCardIdFromText(normText(list[i].text), cards);
  }
  return null;
}

/**
 * Last pasted work card, skipping orientation cards like summary.
 * Walks user messages from newest to oldest.
 * @param {Array<{ role?: string, text?: string }>} messages
 * @param {Array<{ id: string, prompt?: string }>} cards
 * @param {string[]} [skip]
 * @returns {string | null}
 */
function detectLastWorkCardId(messages, cards, skip = ["summary"]) {
  const skipIds = new Set(skip);
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i]?.role || "").toLowerCase() !== "user") continue;
    const id = matchCardIdFromText(normText(list[i].text), cards, skipIds);
    if (id) return id;
  }
  return null;
}

/**
 * Build up to 1 primary + 2 secondary suggestions present in the deck.
 * @param {string | null} primary
 * @param {string[]} secondary
 * @param {Set<string>} ids
 * @returns {Array<{ cardId: string, rank: 1 | 2 }>}
 */
function packSuggestions(primary, secondary, ids) {
  /** @type {Array<{ cardId: string, rank: 1 | 2 }>} */
  const out = [];
  const used = new Set();
  if (primary && ids.has(primary)) {
    out.push({ cardId: primary, rank: 1 });
    used.add(primary);
  }
  for (const id of secondary || []) {
    if (out.length >= 3) break;
    if (!id || !ids.has(id) || used.has(id)) continue;
    out.push({ cardId: id, rank: 2 });
    used.add(id);
  }
  // If primary missing, promote first available secondary
  if (!out.some((s) => s.rank === 1) && out.length) {
    out[0] = { cardId: out[0].cardId, rank: 1 };
    for (let i = 1; i < out.length; i++) {
      out[i] = { cardId: out[i].cardId, rank: 2 };
    }
  }
  return out.slice(0, 3);
}

/**
 * @param {{ messages?: Array, cards?: Array }} opts
 * @returns {Array<{ cardId: string, rank: 1 | 2 }>}
 */
function suggestNextCards(opts = {}) {
  const messages = opts.messages || [];
  const cards = opts.cards || [];
  const ids = cardIds(cards);
  if (!ids.size) return [];

  // Summary is orientation-only: continue the loop from the prior work card.
  const lastCardId =
    detectLastWorkCardId(messages, cards) || detectLastCardId(messages, cards);
  const score = latestScore(messages);
  const testOutcome = latestTestOutcome(messages);
  const fixId = pickFixId(ids);

  if (!lastCardId || lastCardId === "summary") {
    return packSuggestions("plan", ["fullcycle"], ids);
  }

  switch (lastCardId) {
    case "plan":
      return packSuggestions("evaluate", ["improve"], ids);

    case "improve":
    case "evaluate": {
      if (score != null && score <= 6) {
        return packSuggestions(fixId, ["polish", "improve"], ids);
      }
      if (score != null && score <= 8) {
        return packSuggestions("work", ["polish", "test"], ids);
      }
      if (score != null && score >= 9) {
        return packSuggestions("work", ["backup"], ids);
      }
      // No score yet after evaluate — nudge re-read / work
      return packSuggestions("work", ["evaluate", "test"], ids);
    }

    case "work":
      return packSuggestions("test", [], ids);

    case "test": {
      const failed =
        testOutcome === "fail" || (score != null && score < 7);
      if (failed) {
        return packSuggestions(fixId, ["evaluate"], ids);
      }
      if (testOutcome === "pass" || score != null) {
        if (score != null && score >= 9) {
          return packSuggestions("backup", ["plan"], ids);
        }
        if (score != null && score >= 7) {
          return packSuggestions("work", ["polish"], ids);
        }
        if (testOutcome === "pass") {
          return packSuggestions("work", ["polish"], ids);
        }
      }
      return packSuggestions("test", ["evaluate"], ids);
    }

    case "fix":
      return packSuggestions("test", ["evaluate"], ids);

    case "polish": {
      if (score != null && score >= 9) {
        return packSuggestions("backup", [], ids);
      }
      return packSuggestions("polish", ["evaluate"], ids);
    }

    case "backup":
      return packSuggestions("plan", [], ids);

    case "fullcycle": {
      if (score != null && score < 7) {
        return packSuggestions(fixId, ["evaluate"], ids);
      }
      if (score != null && score >= 7) {
        return packSuggestions("polish", ["backup"], ids);
      }
      return packSuggestions("evaluate", ["polish"], ids);
    }

    default:
      return packSuggestions("plan", ["fullcycle"], ids);
  }
}

module.exports = {
  suggestNextCards,
  parseScore,
  latestScore,
  detectLastCardId,
  detectLastWorkCardId,
  parseTestOutcome,
  MATCH_PREFIX,
};
