/**
 * Rule-based next-card suggestions from a Cursor chat transcript.
 * No AI — parses KEYCODE_SCORE / KEYCODE_GATE / KEYCODE_NEXT / last pasted card.
 * Callers freeze the previous list while generating === true.
 */

const MATCH_PREFIX = 120;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const WORK_DECK_IDS = new Set(["lazy-v1", "pro-v1"]);
const PHASE_FIRST = {
  "validate-v1": "problem",
  "spec-v1": "brief",
  "lazy-v1": "plan",
  "pro-v1": "plan",
  "release-v1": "release-plan",
};

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cardIds(cards) {
  return new Set((cards || []).map((c) => c && c.id).filter(Boolean));
}

function catalogCardIds(deck) {
  return cardIds(deck && deck.cards);
}

function hasCard(catalog, deckId, cardId) {
  if (!deckId || !cardId) return false;
  if (!SAFE_ID_RE.test(deckId) || !SAFE_ID_RE.test(cardId)) return false;
  const deck = catalog && catalog[deckId];
  if (deck) return catalogCardIds(deck).has(cardId);
  return false;
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
 * @param {string} text
 * @returns {'PASS' | 'FAIL' | null}
 */
function parseGate(text) {
  const m = String(text || "").match(/KEYCODE_GATE\s*:\s*(PASS|FAIL)\b/i);
  if (!m) return null;
  return m[1].toUpperCase() === "PASS" ? "PASS" : "FAIL";
}

/**
 * Strict `KEYCODE_NEXT: deck-id/card-id`. Dots and titles are ignored.
 * @param {string} text
 * @returns {{ deckId: string, cardId: string } | null}
 */
function parseNext(text) {
  const m = String(text || "").match(
    /KEYCODE_NEXT\s*:\s*([a-zA-Z0-9_-]{1,64})\/([a-zA-Z0-9_-]{1,64})\b/
  );
  if (!m) return null;
  return { deckId: m[1], cardId: m[2] };
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
 * Signals belong only to the assistant reply after the last work-card paste,
 * before the next user message. Stale gates/scores from earlier cards are ignored.
 * @param {Array<{ role?: string, text?: string }>} messages
 * @param {Array<{ id: string, prompt?: string }>} cards
 * @returns {{ lastCardId: string | null, reply: string }}
 */
function searchCards(activeCards, catalog) {
  const out = [];
  const seen = new Set();
  const add = (card) => {
    if (!card?.id || !card.prompt) return;
    const key = `${card.id}\0${normText(card.prompt).slice(0, 64)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(card);
  };
  for (const c of activeCards || []) add(c);
  for (const deck of Object.values(catalog || {})) {
    for (const c of deck.cards || []) add(c);
  }
  return out;
}

function lastWorkReply(messages, cards, catalog) {
  const list = Array.isArray(messages) ? messages : [];
  const skipIds = new Set(["summary"]);
  const pool = searchCards(cards, catalog);
  let workIdx = -1;
  let lastCardId = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (String(list[i]?.role || "").toLowerCase() !== "user") continue;
    const id = matchCardIdFromText(normText(list[i].text), pool, skipIds);
    if (id) {
      workIdx = i;
      lastCardId = id;
      break;
    }
  }
  if (workIdx < 0) {
    return { lastCardId: detectLastCardId(messages, pool), reply: "" };
  }
  let nextUser = list.length;
  for (let i = workIdx + 1; i < list.length; i++) {
    if (String(list[i]?.role || "").toLowerCase() === "user") {
      nextUser = i;
      break;
    }
  }
  let reply = "";
  for (let i = nextUser - 1; i > workIdx; i--) {
    if (String(list[i]?.role || "").toLowerCase() === "assistant") {
      reply = String(list[i].text || "");
      break;
    }
  }
  return { lastCardId, reply };
}

/**
 * Build up to 1 primary + 2 secondary suggestions.
 * Items: { deckId, cardId }. Foreign deckId is kept for the cross-deck hint.
 * @param {Array<{ deckId?: string, cardId: string }>} items
 * @param {object} opts
 * @returns {Array<{ cardId: string, rank: 1 | 2, deckId: string }>}
 */
function packSuggestions(items, opts = {}) {
  const activeDeckId = opts.deckId || "";
  const ids = opts.ids || new Set();
  const catalog = opts.catalog || {};
  const hasCatalog = catalog && Object.keys(catalog).length > 0;
  /** @type {Array<{ cardId: string, rank: 1 | 2, deckId: string }>} */
  const out = [];
  const used = new Set();
  for (const item of items || []) {
    if (out.length >= 3) break;
    const cardId = item && item.cardId;
    if (!cardId) continue;
    const deckId = item.deckId || activeDeckId || "";
    const key = `${deckId}/${cardId}`;
    if (used.has(key)) continue;
    const foreign = deckId && activeDeckId && deckId !== activeDeckId;
    if (foreign) {
      if (hasCatalog && !hasCard(catalog, deckId, cardId)) continue;
    } else if (!ids.has(cardId)) {
      continue;
    }
    used.add(key);
    out.push({
      cardId,
      deckId: deckId || activeDeckId,
      rank: out.length === 0 ? 1 : 2,
    });
  }
  return out;
}

function sug(deckId, cardId) {
  return { deckId, cardId };
}

function workLoopItems(lastCardId, score, testOutcome, ids, deckId) {
  const fixId = pickFixId(ids);
  const d = deckId || "";
  const item = (id) => sug(d, id);

  if (!lastCardId || lastCardId === "summary") {
    return [item("plan"), item("fullcycle")];
  }

  switch (lastCardId) {
    case "plan":
      return [item("evaluate"), item("improve")];

    case "improve":
    case "evaluate": {
      if (score != null && score <= 6) {
        return [item(fixId), item("polish"), item("improve")];
      }
      if (score != null && score <= 8) {
        return [item("work"), item("polish"), item("test")];
      }
      if (score != null && score >= 9) {
        return [item("work"), item("backup")];
      }
      return [item("work"), item("evaluate"), item("test")];
    }

    case "work":
      return [item("test")];

    case "test": {
      const failed = testOutcome === "fail" || (score != null && score < 7);
      if (failed) {
        return [item(fixId), item("evaluate")];
      }
      if (testOutcome === "pass" || score != null) {
        if (score != null && score >= 9) {
          return [item("backup"), item("plan")];
        }
        if (score != null && score >= 7) {
          return [item("work"), item("polish")];
        }
        if (testOutcome === "pass") {
          return [item("work"), item("polish")];
        }
      }
      return [item("test"), item("evaluate")];
    }

    case "fix":
      return [item("test"), item("evaluate")];

    case "polish": {
      if (score != null && score >= 9) {
        return [item("backup")];
      }
      return [item("polish"), item("evaluate")];
    }

    case "backup":
      return [item("plan")];

    case "fullcycle": {
      if (score != null && score < 7) {
        return [item(fixId), item("evaluate")];
      }
      if (score != null && score >= 7) {
        return [item("polish"), item("backup")];
      }
      return [item("evaluate"), item("polish")];
    }

    default:
      return [item("plan"), item("fullcycle")];
  }
}

function validateItems(lastCardId, gate, deckId) {
  const d = deckId || "validate-v1";
  const item = (id) => sug(d, id);
  if (!lastCardId || lastCardId === "summary") {
    return [item("problem"), item("validation-cycle")];
  }
  switch (lastCardId) {
    case "problem":
      return [item("evidence-plan")];
    case "evidence-plan":
      return [item("interview"), item("experiment")];
    case "interview":
      return [item("market"), item("evidence-review")];
    case "market":
      return [item("experiment")];
    case "experiment":
      return [item("evidence-review")];
    case "evidence-review":
    case "validation-cycle":
      if (gate === "FAIL") return [item("pivot")];
      if (gate === "PASS") return [sug("spec-v1", "brief")];
      return [item("evidence-review")];
    case "pivot":
      return [item("evidence-plan")];
    default:
      return [item("problem"), item("validation-cycle")];
  }
}

function specItems(lastCardId, score, gate, deckId) {
  const d = deckId || "spec-v1";
  const item = (id) => sug(d, id);
  if (!lastCardId || lastCardId === "summary") {
    return [item("brief")];
  }
  switch (lastCardId) {
    case "brief":
      return [item("scope")];
    case "scope":
      return [item("ux")];
    case "ux":
      return [item("data-contracts")];
    case "data-contracts":
      return [item("architecture")];
    case "architecture":
      return [item("project-rules")];
    case "project-rules":
      return [item("risk-review")];
    case "risk-review":
      if (score != null && score < 7) return [item("brief"), item("scope")];
      return [item("readiness")];
    case "readiness":
      if (gate === "FAIL") return [item("brief")];
      if (gate === "PASS") {
        return [sug("lazy-v1", "plan"), sug("pro-v1", "plan")];
      }
      return [item("readiness")];
    default:
      return [item("brief")];
  }
}

function releaseItems(lastCardId, score, gate, testOutcome, deckId) {
  const d = deckId || "release-v1";
  const item = (id) => sug(d, id);
  const proFix = sug("pro-v1", "fix");
  if (!lastCardId || lastCardId === "summary") {
    return [item("release-plan")];
  }
  switch (lastCardId) {
    case "release-plan":
      return [item("quality-audit")];
    case "quality-audit": {
      const failed = testOutcome === "fail" || (score != null && score < 7) || gate === "FAIL";
      if (failed) return [proFix, item("quality-audit")];
      return [item("security-audit")];
    }
    case "security-audit":
      if (gate === "FAIL") return [proFix];
      return [item("package")];
    case "package":
      return [item("docs")];
    case "docs":
      return [item("operations")];
    case "operations":
      return [item("release-gate")];
    case "release-gate":
      if (gate === "FAIL") return [proFix, item("quality-audit")];
      if (gate === "PASS") return [item("launch")];
      return [item("release-gate")];
    case "launch":
      return [sug("validate-v1", "evidence-review")];
    default:
      return [item("release-plan")];
  }
}

function failFallback(deckId, lastCardId) {
  if (deckId === "validate-v1") return sug(deckId, "pivot");
  if (deckId === "spec-v1") return sug(deckId, "brief");
  if (WORK_DECK_IDS.has(deckId)) return sug(deckId, "fix");
  if (deckId === "release-v1") {
    if (lastCardId === "release-gate" || lastCardId === "quality-audit" || lastCardId === "security-audit") {
      return sug("pro-v1", "fix");
    }
    return sug(deckId, "release-plan");
  }
  return null;
}

function phaseItems(deckId, lastCardId, score, gate, testOutcome, ids) {
  if (deckId === "validate-v1") return validateItems(lastCardId, gate, deckId);
  if (deckId === "spec-v1") return specItems(lastCardId, score, gate, deckId);
  if (deckId === "release-v1") {
    return releaseItems(lastCardId, score, gate, testOutcome, deckId);
  }
  return workLoopItems(lastCardId, score, testOutcome, ids, deckId);
}

/**
 * @param {{
 *   messages?: Array,
 *   cards?: Array,
 *   deckId?: string,
 *   catalog?: Record<string, { id?: string, cards?: Array }>
 * }} opts
 * @returns {Array<{ cardId: string, rank: 1 | 2, deckId: string }>}
 */
function suggestNextCards(opts = {}) {
  const messages = opts.messages || [];
  const cards = opts.cards || [];
  const deckId = opts.deckId || "";
  const catalog = opts.catalog || {};
  const ids = cardIds(cards);
  if (!ids.size) return [];

  const { lastCardId, reply } = lastWorkReply(messages, cards, catalog);
  const score = parseScore(reply);
  const gate = parseGate(reply);
  const testOutcome = parseTestOutcome(reply);
  const hasCatalog = catalog && Object.keys(catalog).length > 0;
  const rawNext = parseNext(reply);
  const next =
    rawNext &&
    (hasCatalog
      ? hasCard(catalog, rawNext.deckId, rawNext.cardId)
      : (!deckId || rawNext.deckId === deckId) && ids.has(rawNext.cardId))
      ? rawNext
      : null;

  /** @type {Array<{ deckId?: string, cardId: string }>} */
  let items = [];
  if (next) {
    items.push(sug(next.deckId, next.cardId));
  } else if (gate === "FAIL") {
    const fb = failFallback(deckId, lastCardId);
    if (fb) items.push(fb);
  }

  items = items.concat(phaseItems(deckId, lastCardId, score, gate, testOutcome, ids));

  if (!items.length) {
    const first = PHASE_FIRST[deckId];
    if (first && ids.has(first)) items.push(sug(deckId, first));
  }

  return packSuggestions(items, { deckId, ids, catalog });
}

module.exports = {
  suggestNextCards,
  parseScore,
  parseGate,
  parseNext,
  latestScore,
  detectLastCardId,
  detectLastWorkCardId,
  parseTestOutcome,
  MATCH_PREFIX,
};
