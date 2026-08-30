/**
 * Safe deck/settings paths, atomic writes, import validation.
 * Keep pure (no Electron) so node:test can require this module.
 */
const path = require("path");
const fs = require("fs");

const SAFE_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_DECK_IMPORT_BYTES = 512 * 1024;
const MAX_CARDS = 9;
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
  /** Side docks: "table" (3×4 grid, default) | "strip" (classic column) */
  "sideCardLayout",
  /** Desktop paste: "broadcast" (preset or enabled) | "solo" (activeTargetId) */
  "pasteMode",
  "activeTargetId",
  "activePresetId",
  "targetPresets",
  /** Deck strip chat pane: open/closed + height px */
  "deckTranscriptOpen",
  "deckTranscriptHeightPx",
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
  "targetsWindowBounds",
  "targetsWindowMaximized",
  "uiLocale",
  "arcanaLocale",
  "remoteEnabled",
  "remotePort",
  "remoteToken",
  "remoteAccessMode",
  /** Experimental A/B: "cdp" (IDE chats) | "sdk" (Cursor API agent) */
  "cursorBackend",
  "cursorApiKey",
  "cursorSdkCwd",
  "cursorSdkAgentId",
  "cursorSdkModel",
  /** Named SDK projects: [{ id, name, cwd, chats[{id,name,agentId}], activeChatId, agentId? }] */
  "sdkProjects",
  "activeSdkProjectId",
  /** Bumps rewrite stock phase decks from locale packs (KEYCODE_SCORE etc.) */
  "stockDeckRev",
];

const MAX_SDK_PROJECTS = 12;
const MAX_SDK_CHATS_PER_PROJECT = 16;
const MAX_TARGET_PRESETS = 4;

/**
 * Cursor API / SDK backend is implemented but shelved from the product UI.
 * Set KEYCODE_ENABLE_SDK=1 to re-enable Settings toggle + routing (future).
 */
function isCursorSdkEnabled() {
  return process.env.KEYCODE_ENABLE_SDK === "1";
}

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

function newSdkEntityId(prefix, existingIds = new Set()) {
  let id = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  while (existingIds.has(id)) {
    id = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return id;
}

/**
 * @returns {{id:string,name:string,agentId:string}}
 */
function normalizeSdkChat(raw, { existingIds = new Set() } = {}) {
  let id = trySafeId(raw?.id);
  if (!id || existingIds.has(id)) {
    id = newSdkEntityId("chat", existingIds);
  }
  const name = clampStr(raw?.name || "Chat", MAX_NAME).trim() || "Chat";
  const agentId = String(raw?.agentId || "").trim().slice(0, 128);
  return { id, name, agentId };
}

/**
 * @returns {Array<{id:string,name:string,agentId:string}>}
 */
function normalizeSdkChats(list, { legacyAgentId = "" } = {}) {
  const out = [];
  const ids = new Set();
  if (Array.isArray(list)) {
    for (const item of list) {
      if (out.length >= MAX_SDK_CHATS_PER_PROJECT) break;
      if (!item || typeof item !== "object") continue;
      const c = normalizeSdkChat(item, { existingIds: ids });
      ids.add(c.id);
      out.push(c);
    }
  }
  if (!out.length) {
    const c = normalizeSdkChat(
      { id: "main", name: "Chat", agentId: legacyAgentId },
      { existingIds: ids }
    );
    out.push(c);
  }
  return out;
}

function normalizeSdkProject(raw, { existingIds = new Set() } = {}) {
  let id = trySafeId(raw?.id);
  if (!id || existingIds.has(id)) {
    id = newSdkEntityId("proj", existingIds);
  }
  const cwd = String(raw?.cwd || "").trim().slice(0, 500);
  const baseName = cwd
    ? path.basename(cwd.replace(/[\\/]+$/, "")) || "Project"
    : "Project";
  const name = clampStr(raw?.name || baseName, MAX_NAME).trim() || baseName;
  const legacyAgentId = String(raw?.agentId || "").trim().slice(0, 128);
  const chats = normalizeSdkChats(raw?.chats, { legacyAgentId });
  let activeChatId = trySafeId(raw?.activeChatId) || "";
  if (!chats.some((c) => c.id === activeChatId)) {
    activeChatId = chats[0].id;
  }
  const activeChat = chats.find((c) => c.id === activeChatId) || chats[0];
  // Mirror active chat agentId for older readers / desktop strip.
  return {
    id,
    name,
    cwd,
    chats,
    activeChatId,
    agentId: activeChat?.agentId || "",
  };
}

/**
 * @param {unknown} list
 * @returns {Array<{id:string,name:string,cwd:string,chats:Array,activeChatId:string,agentId:string}>}
 */
function normalizeSdkProjects(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const item of list) {
    if (out.length >= MAX_SDK_PROJECTS) break;
    if (!item || typeof item !== "object") continue;
    const p = normalizeSdkProject(item, { existingIds: ids });
    if (!p.cwd) continue;
    ids.add(p.id);
    out.push(p);
  }
  return out;
}

function newPresetId(existingIds = new Set()) {
  let id = `preset-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  while (existingIds.has(id)) {
    id = `preset-${Math.random().toString(36).slice(2, 10)}`;
  }
  return id;
}

/**
 * @returns {{id:string,name:string,targetIds:string[]}}
 */
function normalizeTargetPreset(raw, { existingIds = new Set() } = {}) {
  let id = trySafeId(raw?.id);
  if (!id || existingIds.has(id)) {
    id = newPresetId(existingIds);
  }
  const name = clampStr(raw?.name || "Set", MAX_NAME).trim() || "Set";
  const targetIds = [];
  const seen = new Set();
  if (Array.isArray(raw?.targetIds)) {
    for (const tid of raw.targetIds) {
      const sid = trySafeId(tid);
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      targetIds.push(sid);
    }
  }
  return { id, name, targetIds };
}

/**
 * @param {unknown} list
 * @returns {Array<{id:string,name:string,targetIds:string[]}>}
 */
function normalizeTargetPresets(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const ids = new Set();
  for (const item of list) {
    if (out.length >= MAX_TARGET_PRESETS) break;
    if (!item || typeof item !== "object") continue;
    const p = normalizeTargetPreset(item, { existingIds: ids });
    ids.add(p.id);
    out.push(p);
  }
  return out;
}

function normalizePasteMode(mode) {
  return String(mode || "").toLowerCase() === "solo" ? "solo" : "broadcast";
}

/**
 * Resolve desktop paste destinations from settings.
 * @param {object} settings
 * @returns {{ targets: Array, reason?: string }}
 */
function resolvePasteTargets(settings = {}) {
  const all = Array.isArray(settings.targets) ? settings.targets : [];
  const byId = new Map(all.map((t) => [t?.id, t]).filter(([id]) => id));
  const mode = normalizePasteMode(settings.pasteMode);

  if (mode === "solo") {
    const id = trySafeId(settings.activeTargetId) || "";
    const t = id ? byId.get(id) : null;
    if (!t) return { targets: [], reason: "no_active_target" };
    return { targets: [t] };
  }

  const presets = normalizeTargetPresets(settings.targetPresets);
  const presetId = trySafeId(settings.activePresetId) || "";
  const preset = presetId ? presets.find((p) => p.id === presetId) : null;
  if (preset) {
    const targets = [];
    for (const tid of preset.targetIds) {
      const t = byId.get(tid);
      if (t) targets.push(t);
    }
    return { targets, reason: targets.length ? undefined : "empty_preset" };
  }

  return { targets: all.filter((t) => t && t.enabled) };
}

/**
 * Keep preset/active ids valid after target edits; normalize paste fields.
 * @returns {{ pasteMode: string, activeTargetId: string, activePresetId: string, targetPresets: Array, changed: boolean }}
 */
function migratePasteRouting(settings = {}) {
  const validTargetIds = new Set(
    (Array.isArray(settings.targets) ? settings.targets : [])
      .map((t) => trySafeId(t?.id))
      .filter(Boolean)
  );
  const targetPresets = normalizeTargetPresets(settings.targetPresets).map((p) => ({
    ...p,
    targetIds: p.targetIds.filter((id) => validTargetIds.has(id)),
  }));

  const pasteMode = normalizePasteMode(settings.pasteMode);
  let activeTargetId = trySafeId(settings.activeTargetId) || "";
  if (activeTargetId && !validTargetIds.has(activeTargetId)) activeTargetId = "";

  let activePresetId = trySafeId(settings.activePresetId) || "";
  if (activePresetId && !targetPresets.some((p) => p.id === activePresetId)) {
    activePresetId = "";
  }

  const next = {
    pasteMode,
    activeTargetId,
    activePresetId,
    targetPresets,
  };
  const before = {
    pasteMode: settings.pasteMode,
    activeTargetId: settings.activeTargetId || "",
    activePresetId: settings.activePresetId || "",
    targetPresets: settings.targetPresets || [],
  };
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  return { ...next, changed };
}

/**
 * Migrate legacy cursorSdkCwd → sdkProjects[0]; project.agentId → chats[]; fix active id.
 * @returns {{ projects: Array, activeSdkProjectId: string, changed: boolean }}
 */
function migrateSdkProjects(settings = {}) {
  const before = JSON.stringify(settings.sdkProjects || []);
  let projects = normalizeSdkProjects(settings.sdkProjects);
  let changed = before !== JSON.stringify(projects);
  const legacyCwd = String(settings.cursorSdkCwd || "").trim();
  if (!projects.length && legacyCwd) {
    projects = [
      normalizeSdkProject({
        id: "default",
        name: path.basename(legacyCwd.replace(/[\\/]+$/, "")) || "Project",
        cwd: legacyCwd,
        agentId: settings.cursorSdkAgentId || "",
      }),
    ];
    changed = true;
  }
  let active = trySafeId(settings.activeSdkProjectId) || "";
  if (projects.length) {
    if (!projects.some((p) => p.id === active)) {
      active = projects[0].id;
      changed = true;
    }
  } else if (active) {
    active = "";
    changed = true;
  }
  return { projects, activeSdkProjectId: active, changed };
}

module.exports = {
  SAFE_ID_RE,
  MAX_DECK_IMPORT_BYTES,
  MAX_CARDS,
  MAX_SDK_PROJECTS,
  MAX_SDK_CHATS_PER_PROJECT,
  MAX_TARGET_PRESETS,
  DEFAULT_REMOTE_PORT,
  isCursorSdkEnabled,
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
  normalizeSdkChat,
  normalizeSdkChats,
  normalizeSdkProject,
  normalizeSdkProjects,
  migrateSdkProjects,
  normalizePasteMode,
  normalizeTargetPreset,
  normalizeTargetPresets,
  resolvePasteTargets,
  migratePasteRouting,
  listExistingDeckIds,
};
