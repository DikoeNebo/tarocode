/**
 * Safe deck/settings paths, atomic writes, import validation.
 * Keep pure (no Electron) so node:test can require this module.
 */
const path = require("path");
const fs = require("fs");

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_DECK_IMPORT_BYTES = 512 * 1024;
const MAX_CARDS = 8;
const MAX_TITLE = 80;
const MAX_DESC = 200;
const MAX_PROMPT = 100_000;
const MAX_NAME = 80;
const ALLOWED_HOTKEYS = new Set(["", "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);

/** Default phone-remote HTTP port (unprivileged, fixed for Tailscale Serve docs). */
const DEFAULT_REMOTE_PORT = 17865;

const SETTINGS_WHITELIST = [
  "autoEnter",
  "pauseMs",
  "showHotkey",
  "panelScale",
  "editMode",
  "targets",
  "activeDeckId",
  "dock",
  "edgeHover",
  "edgeThreshold",
  "hideDelayMs",
  "uiOpacity",
  "titleOpacity",
  "showCardPreview",
  "cardTarotFontPx",
  "cardActionFontPx",
  "preserveFocus",
  "cdpPort",
  "firstRunDone",
  "uiLocale",
  "arcanaLocale",
  "remoteEnabled",
  "remotePort",
  "remoteToken",
  "remoteAccessMode",
];

function safeId(id, label = "id") {
  const s = String(id ?? "").trim();
  if (!SAFE_ID_RE.test(s)) {
    const err = new Error(`invalid ${label}`);
    err.code = "invalid_id";
    throw err;
  }
  return s;
}

function trySafeId(id) {
  try {
    return safeId(id);
  } catch {
    return null;
  }
}

function resolveInside(dir, name) {
  const root = path.resolve(dir);
  const resolved = path.resolve(root, name);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    const err = new Error("path_escape");
    err.code = "path_escape";
    throw err;
  }
  return resolved;
}

function deckFilePath(decksDir, deckId) {
  const id = safeId(deckId, "deck id");
  return resolveInside(decksDir, `${id}.json`);
}

function safeTarotFilePath(tarotRoot, name) {
  const base = path.basename(String(name || ""));
  if (!base || base === "." || base === "..") {
    const err = new Error("invalid tarot name");
    err.code = "invalid_tarot";
    throw err;
  }
  if (!/^[a-zA-Z0-9_.-]+\.(jpg|jpeg|png|webp)$/i.test(base)) {
    const err = new Error("invalid tarot name");
    err.code = "invalid_tarot";
    throw err;
  }
  return resolveInside(tarotRoot, base);
}

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, json, "utf8");
  try {
    if (fs.existsSync(filePath)) {
      const bak = `${filePath}.bak`;
      try {
        fs.copyFileSync(filePath, bak);
      } catch {
        /* ignore backup failure */
      }
    }
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function pickSettingsPartial(partial) {
  if (!partial || typeof partial !== "object") return {};
  const out = {};
  for (const key of SETTINGS_WHITELIST) {
    if (Object.prototype.hasOwnProperty.call(partial, key)) {
      out[key] = partial[key];
    }
  }
  return out;
}

function clampStr(s, max) {
  return String(s ?? "").slice(0, max);
}

function normalizeCard(raw, index) {
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("invalid card"), { code: "invalid_card" });
  }
  let id = trySafeId(raw.id);
  if (!id) id = `card-${Date.now()}-${index}`;
  const hotkey = String(raw.hotkey || "");
  if (!ALLOWED_HOTKEYS.has(hotkey)) {
    throw Object.assign(new Error("invalid hotkey"), { code: "invalid_hotkey" });
  }
  const image = clampStr(raw.image || "magician", 80);
  if (image.includes("..") || image.includes("/") || image.includes("\\")) {
    throw Object.assign(new Error("invalid image"), { code: "invalid_image" });
  }
  return {
    id,
    title: clampStr(raw.title || "Без названия", MAX_TITLE) || "Без названия",
    description: clampStr(raw.description || "", MAX_DESC),
    prompt: clampStr(raw.prompt || "", MAX_PROMPT),
    image,
    hotkey,
  };
}

/**
 * Validate and normalize a deck from import or save.
 * @param {object} raw
 * @param {{ existingIds?: Set<string>, forceNewId?: boolean, sourceBytes?: number, allowEmpty?: boolean }} opts
 */
function normalizeDeck(raw, opts = {}) {
  if (opts.sourceBytes != null && opts.sourceBytes > MAX_DECK_IMPORT_BYTES) {
    throw Object.assign(new Error("file too large"), { code: "too_large" });
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw Object.assign(new Error("invalid deck"), { code: "invalid_deck" });
  }
  let id = trySafeId(raw.id);
  const existing = opts.existingIds || new Set();
  if (!id || opts.forceNewId || existing.has(id)) {
    id = `imported-${Date.now()}`;
  }
  const cardsRaw = Array.isArray(raw.cards) ? raw.cards.slice(0, MAX_CARDS) : [];
  if (!cardsRaw.length && !opts.allowEmpty) {
    throw Object.assign(new Error("deck needs cards"), { code: "empty_cards" });
  }
  const cards = cardsRaw.map((c, i) => normalizeCard(c, i));
  return {
    id,
    name: clampStr(raw.name || "Импорт", MAX_NAME) || "Импорт",
    cards,
  };
}

function listExistingDeckIds(decksDir) {
  if (!fs.existsSync(decksDir)) return new Set();
  const ids = new Set();
  for (const f of fs.readdirSync(decksDir)) {
    if (!f.endsWith(".json") || f.endsWith(".bak")) continue;
    const base = path.basename(f, ".json");
    if (trySafeId(base)) ids.add(base);
  }
  return ids;
}

module.exports = {
  SAFE_ID_RE,
  MAX_DECK_IMPORT_BYTES,
  MAX_CARDS,
  DEFAULT_REMOTE_PORT,
  SETTINGS_WHITELIST,
  safeId,
  trySafeId,
  resolveInside,
  deckFilePath,
  safeTarotFilePath,
  atomicWriteJson,
  pickSettingsPartial,
  normalizeCard,
  normalizeDeck,
  listExistingDeckIds,
};
