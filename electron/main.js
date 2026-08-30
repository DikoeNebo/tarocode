const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  clipboard,
  screen,
  dialog,
  shell,
  protocol,
  net,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pathToFileURL } = require("url");
const { getUiaClient } = require("./uia-client");
const {
  getCdpClient,
  DEFAULT_PORT: DEFAULT_CDP_PORT,
  normalizeCreateChatRequest,
} = require("./cdp-client");
const { suggestNextCards } = require("./card-suggestions");
/** Rewrite bundled hobby/pro decks from locale packs when this increases. */
const STOCK_DECK_REV = 4;
const {
  getCursorSdkClient,
  SDK_LIVE_CHAT_ID,
  DEFAULT_MODEL_ID,
} = require("./cursor-sdk-client");
const {
  launchCursorForIntegration,
  launchOrRestartCursorWithCdp,
  installCursorCdpShortcut,
  isCursorRunning,
  resolveCursorExe,
  ACCESSIBILITY_FLAG,
  DEFAULT_CDP_PORT: SETUP_CDP_PORT,
} = require("./cursor-setup");
const {
  safeId,
  trySafeId,
  deckFilePath,
  safeTarotFilePath,
  atomicWriteJson,
  pickSettingsPartial,
  normalizeDeck,
  listExistingDeckIds,
  MAX_DECK_IMPORT_BYTES,
  DEFAULT_REMOTE_PORT,
  normalizeSdkProjects,
  migrateSdkProjects,
  normalizeSdkProject,
  normalizeSdkChat,
  MAX_SDK_PROJECTS,
  MAX_SDK_CHATS_PER_PROJECT,
  isCursorSdkEnabled,
  normalizePasteMode,
  normalizeTargetPresets,
  resolvePasteTargets,
  migratePasteRouting,
} = require("./data-store");
const { PasteQueue } = require("./paste-queue");
const {
  createRemoteServer,
  generateRemoteToken,
} = require("./remote-server");
const log = require("./logger");
const i18n = require("./i18n");
const donateConfig = require("./donate-config");
const {
  clicksPath,
  recordClick,
  computeStats,
  publicConfig,
  resolveAllowedUrl,
} = require("./donate-stats");

const pasteQueue = new PasteQueue();
/** @type {ReturnType<typeof createRemoteServer> | null} */
let remoteServer = null;

const execFileAsync = promisify(execFile);

// Isolate smoke runs from the real user profile (settings/decks).
if (process.env.KEYCODE_SMOKE_I18N === "1") {
  const smokeDir = path.join(
    require("os").tmpdir(),
    `keycode-smoke-${process.pid}`
  );
  fs.mkdirSync(smokeDir, { recursive: true });
  app.setPath("userData", smokeDir);
  console.log("[smoke-i18n] userData", smokeDir);
}

// Direct spawn of Cursor.exe can emit EACCES async; don't crash the deck.
process.on("uncaughtException", (err) => {
  const msg = String(err && err.message ? err.message : err);
  const code = err && err.code ? String(err.code) : "";
  if (
    (code === "EACCES" || code === "EPERM" || /EACCES|EPERM/.test(msg)) &&
    /spawn/i.test(msg)
  ) {
    console.error("[keycode] spawn error (ignored):", msg);
    return;
  }
  console.error("[keycode] uncaughtException:", err);
  try {
    dialog.showErrorBox("Error", `Uncaught Exception:\n${msg}`);
  } catch {
    /* app may be quitting */
  }
});

const UIA_ERROR_KEYS = {
  element_not_found: "err.element_not_found",
  not_chat: "err.not_chat",
  not_input: "err.not_input",
  window_not_found: "err.window_not_found",
  chat_not_found: "err.chat_not_found",
  chat_ambiguous: "err.chat_ambiguous",
  chat_select_failed: "err.chat_select_failed",
  input_not_found: "err.input_not_found",
  input_ambiguous: "err.input_ambiguous",
  input_focus_failed: "err.input_focus_failed",
  focus_mismatch: "err.focus_mismatch",
  chrome_only: "err.chrome_only",
  no_cursor: "err.no_cursor",
};

function t(key, vars) {
  return i18n.t(key, vars);
}

function uiaErr(code, fallback) {
  if (!code) return fallback || t("err.uia");
  const key = UIA_ERROR_KEYS[code];
  return key ? t(key) : String(code);
}

function systemLocale() {
  try {
    return app.getLocale();
  } catch {
    return "en";
  }
}

function refreshLocaleFromSettings(settings) {
  const ui = i18n.resolveUiLocale(settings?.uiLocale ?? "system", systemLocale());
  i18n.setActiveUiLocale(ui);
  return ui;
}

function syncBundledDecks(locale, { onlyIfMissing = false } = {}) {
  for (const deckId of i18n.STOCK_DECK_IDS) {
    const dest = path.join(decksDir(), `${deckId}.json`);
    if (onlyIfMissing && fs.existsSync(dest)) continue;
    const src = i18n.bundledDeckPath(locale, deckId);
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, dest);
      } catch (e) {
        log.warn("syncBundledDecks", String(e.message || e));
      }
    }
  }
}

function i18nPayload(settings = readSettings()) {
  return i18n.buildI18nPayload(settings, systemLocale());
}

function isCursorLikeTarget(t) {
  const blob = [
    t?.processName,
    t?.fullTitle,
    t?.match,
    t?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\bcursor\b/.test(blob);
}

function locatorKey(loc) {
  if (!loc) return "";
  return [
    loc.controlType || "",
    loc.name || "",
    loc.automationId || "",
    loc.className || "",
  ].join("|");
}

/** Migrate legacy Cursor targets toward CDP rebind when needed. */
function migrateTargets(targets) {
  let changed = false;
  const next = (targets || []).map((t) => {
    if (t.driver === "cdp") return t;
    if (t.driver === "uia-quiet") return t;
    if (t.driver === "uia" && !t.needsCdpRebind) {
      changed = true;
      return {
        ...t,
        needsCdpRebind: true,
        enabled: false,
      };
    }
    if (t.driver === "win32-field" && !t.needsUiaRebind && !t.needsCdpRebind) {
      if (isCursorLikeTarget(t)) {
        changed = true;
        return {
          ...t,
          needsCdpRebind: true,
          needsUiaRebind: true,
          enabled: false,
        };
      }
      return t;
    }
    const cursorLike = isCursorLikeTarget(t);
    if (cursorLike && !t.chatLocator && t.driver !== "cdp") {
      changed = true;
      return {
        ...t,
        driver: "win32-field",
        needsUiaRebind: true,
        needsCdpRebind: true,
        enabled: false,
      };
    }
    if (!t.driver) {
      changed = true;
      return { ...t, driver: "win32-field" };
    }
    return t;
  });
  return { targets: next, changed };
}

/** Project root (dev folder or packaged app.asar). */
const appRoot = () => app.getAppPath();

/** @type {BrowserWindow | null} */
let deckWindow = null;
/** @type {BrowserWindow | null} */
let settingsWindow = null;
/** @type {BrowserWindow | null} */
let targetsWindow = null;
/** @type {BrowserWindow | null} */
let pickWindow = null;
/** @type {BrowserWindow | null} */
let chatPickWindow = null;

const userDataDir = () => path.join(app.getPath("userData"), "keycode-data");
const decksDir = () => path.join(userDataDir(), "decks");
const settingsPath = () => path.join(userDataDir(), "settings.json");

const defaultSettings = {
  autoEnter: false,
  pauseMs: 350,
  showHotkey: "F9",
  panelScale: 1,
  editMode: false,
  targets: [],
  targetsWindowBounds: null,
  targetsWindowMaximized: false,
  activeDeckId: "validate-v1",
  /** @type {'top'|'bottom'|'left'|'right'} */
  dock: "right",
  /** Side docks: "table" (default 3×4 grid) | "strip" (classic full-height column) */
  sideCardLayout: "table",
  /** Edge hover popup */
  edgeHover: true,
  edgeThreshold: 14,
  hideDelayMs: 450,
  /** 0.05–1: panel/cards opacity; title separate */
  uiOpacity: 0.8,
  titleOpacity: 1,
  /** Hover tooltip with description + prompt */
  showCardPreview: true,
  cardTarotFontPx: 16,
  cardActionFontPx: 13,
  /** Never steal OS focus from games / other apps (CDP / quiet UIA only) */
  preserveFocus: true,
  cdpPort: SETUP_CDP_PORT || DEFAULT_CDP_PORT || 9222,
  /** First-run onboarding shown once */
  firstRunDone: false,
  /** "system" or locale code (en, ru, …) */
  uiLocale: "system",
  /** "en" (default), "ui", or locale code for Rider–Waite titles */
  arcanaLocale: "en",
  /** Phone remote: LAN Wi-Fi default; Tailscale mode later */
  remoteEnabled: false,
  remotePort: DEFAULT_REMOTE_PORT,
  remoteToken: "",
  remoteAccessMode: "lan",
  /** Shelved A/B: "cdp" | "sdk" — sdk only when KEYCODE_ENABLE_SDK=1 */
  cursorBackend: "cdp",
  cursorApiKey: "",
  cursorSdkCwd: "",
  cursorSdkAgentId: "",
  cursorSdkModel: DEFAULT_MODEL_ID,
  /** @type {Array<{id:string,name:string,cwd:string,agentId:string}>} */
  sdkProjects: [],
  activeSdkProjectId: "",
  /** Desktop paste routing: broadcast (preset/enabled) | solo (one chat) */
  pasteMode: "broadcast",
  activeTargetId: "",
  activePresetId: "",
  /** @type {Array<{id:string,name:string,targetIds:string[]}>} */
  targetPresets: [],
  /** Deck strip chat transcript pane */
  deckTranscriptOpen: true,
  deckTranscriptHeightPx: 168,
  /** Last applied stock deck pack revision (see STOCK_DECK_REV). */
  stockDeckRev: 0,
};

/** Manual pin (F9) — stays open until unpinned */
let pinnedOpen = false;
/** Settings panel expanded (gear) */
let expandedMode = false;
/** Full-screen deck editor */
let fullscreenEditMode = false;
/** @type {ReturnType<typeof setInterval> | null} */
let edgePollTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let hideDelayTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let concealAnimTimer = null;
/** Pause edge-hover while picking target / pasting */
let edgeHoverPaused = false;
/** Deck renderer finished first load — edge hover stays off until then */
let deckUiReady = false;
/** Keep deck open while card preview popup is visible */
let previewHoldOpen = false;
/** Keep deck open while quit/card modal is visible (don't edge-hide) */
let modalHoldOpen = false;
/** Keep deck open while cursor is over cards/buttons (ignore-mouse = false) */
let mouseCaptureOpen = false;
/** Keep deck visible while settings window is open */
let settingsHeldPin = false;
let settingsRestorePinned = false;
/** Keep deck visible while targets window is open */
let targetsHeldPin = false;
let targetsRestorePinned = false;

const CONCEAL_ANIM_MS = 300;

function ensureData() {
  fs.mkdirSync(decksDir(), { recursive: true });
  try {
    log.initLogger(userDataDir());
  } catch {
    /* ignore */
  }
  if (!fs.existsSync(settingsPath())) {
    atomicWriteJson(settingsPath(), defaultSettings);
  }
  // Seed bundled decks if missing (locale pack → hobby + pro)
  let seedLocale = "en";
  try {
    if (fs.existsSync(settingsPath())) {
      const s = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
      seedLocale = i18n.resolveUiLocale(s.uiLocale || "system", systemLocale());
    } else {
      seedLocale = i18n.resolveUiLocale("system", systemLocale());
    }
  } catch {
    seedLocale = "en";
  }
  syncBundledDecks(seedLocale, { onlyIfMissing: true });
  // migrate: pin used to disable edgeHover in settings — fix broken auto-show
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    let changed = false;
    if (s.showHotkey === "CommandOrControl+Shift+L") {
      s.showHotkey = "F9";
      changed = true;
    }
    if (s.edgeHover === false) {
      s.edgeHover = true;
      changed = true;
    }
    if (Number(s.stockDeckRev || 0) < STOCK_DECK_REV) {
      const ui = i18n.resolveUiLocale(s.uiLocale || "system", systemLocale());
      syncBundledDecks(ui, { onlyIfMissing: false });
      s.stockDeckRev = STOCK_DECK_REV;
      changed = true;
    }
    if (changed) {
      atomicWriteJson(settingsPath(), s);
    }
  } catch {
    /* ignore */
  }
}

function readSettings() {
  ensureData();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    const merged = { ...defaultSettings, ...raw };
    const mig = migrateTargets(merged.targets || []);
    if (mig.changed) {
      merged.targets = mig.targets;
    } else {
      merged.targets = mig.targets;
    }
    const sdkMig = migrateSdkProjects(merged);
    merged.sdkProjects = sdkMig.projects;
    merged.activeSdkProjectId = sdkMig.activeSdkProjectId;
    const pasteMig = migratePasteRouting(merged);
    merged.pasteMode = pasteMig.pasteMode;
    merged.activeTargetId = pasteMig.activeTargetId;
    merged.activePresetId = pasteMig.activePresetId;
    merged.targetPresets = pasteMig.targetPresets;
    let sdkUiOff = false;
    if (!isCursorSdkEnabled() && merged.cursorBackend === "sdk") {
      merged.cursorBackend = "cdp";
      sdkUiOff = true;
    }
    let sideLayoutMig = false;
    const sideRaw = String(merged.sideCardLayout || "").toLowerCase();
    if (sideRaw !== "strip" && sideRaw !== "table") {
      // Legacy "wheel" (and unknown) → tarot table
      merged.sideCardLayout = "table";
      sideLayoutMig = true;
    }
    if (mig.changed || sdkMig.changed || pasteMig.changed || sdkUiOff || sideLayoutMig) {
      try {
        atomicWriteJson(settingsPath(), merged);
      } catch {
        /* ignore */
      }
    }
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

function writeSettings(partial) {
  const safe = pickSettingsPartial(partial);
  const next = { ...readSettings(), ...safe };
  if (safe.activeDeckId != null) {
    const id = trySafeId(safe.activeDeckId);
    if (!id) delete next.activeDeckId;
    else next.activeDeckId = id;
  }
  if (safe.remotePort != null) {
    const p = Number(safe.remotePort);
    next.remotePort = Number.isFinite(p)
      ? Math.min(65535, Math.max(1024, Math.round(p)))
      : DEFAULT_REMOTE_PORT;
  }
  if (safe.remoteEnabled != null) {
    next.remoteEnabled = safe.remoteEnabled === true;
  }
  if (safe.remoteToken != null) {
    const tok = String(safe.remoteToken || "").trim();
    // Only accept generated-looking tokens (ignore empty / short values)
    if (tok.length >= 16 && tok.length <= 128) next.remoteToken = tok;
    else next.remoteToken = readSettings().remoteToken || "";
  }
  if (safe.remoteAccessMode != null) {
    next.remoteAccessMode =
      String(safe.remoteAccessMode).toLowerCase() === "tailscale" ? "tailscale" : "lan";
  }
  if (safe.sideCardLayout != null) {
    next.sideCardLayout =
      String(safe.sideCardLayout).toLowerCase() === "strip" ? "strip" : "table";
  }
  if (safe.targetsWindowBounds != null) {
    const b = safe.targetsWindowBounds;
    const nums = ["x", "y", "width", "height"].map((key) => Number(b?.[key]));
    if (nums.every(Number.isFinite)) {
      next.targetsWindowBounds = {
        x: Math.round(Math.min(100000, Math.max(-100000, nums[0]))),
        y: Math.round(Math.min(100000, Math.max(-100000, nums[1]))),
        width: Math.round(Math.min(10000, Math.max(400, nums[2]))),
        height: Math.round(Math.min(10000, Math.max(420, nums[3]))),
      };
    }
  }
  if (safe.targetsWindowMaximized != null) {
    next.targetsWindowMaximized = safe.targetsWindowMaximized === true;
  }
  if (safe.pasteMode != null) {
    next.pasteMode = normalizePasteMode(safe.pasteMode);
  }
  if (safe.activeTargetId != null) {
    next.activeTargetId = trySafeId(safe.activeTargetId) || "";
  }
  if (safe.activePresetId != null) {
    next.activePresetId = trySafeId(safe.activePresetId) || "";
  }
  if (safe.targetPresets != null) {
    next.targetPresets = normalizeTargetPresets(safe.targetPresets);
  }
  if (safe.deckTranscriptOpen != null) {
    next.deckTranscriptOpen = safe.deckTranscriptOpen !== false;
  }
  if (safe.deckTranscriptHeightPx != null) {
    const h = Number(safe.deckTranscriptHeightPx);
    next.deckTranscriptHeightPx = Number.isFinite(h)
      ? Math.min(420, Math.max(80, Math.round(h)))
      : 168;
  }
  // Drop stale preset/active ids when targets change
  if (
    safe.targets != null ||
    safe.targetPresets != null ||
    safe.activeTargetId != null ||
    safe.activePresetId != null ||
    safe.pasteMode != null
  ) {
    const pasteMig = migratePasteRouting(next);
    next.pasteMode = pasteMig.pasteMode;
    next.activeTargetId = pasteMig.activeTargetId;
    next.activePresetId = pasteMig.activePresetId;
    next.targetPresets = pasteMig.targetPresets;
  }
  atomicWriteJson(settingsPath(), next);
  return next;
}

function assertTrustedSender(event) {
  try {
    const wc = event?.sender;
    if (!wc || wc.isDestroyed()) return false;
    const url = String(wc.getURL?.() || "");
    if (!url.startsWith("file:")) return false;
    const owned = [
      deckWindow,
      settingsWindow,
      targetsWindow,
      pickWindow,
      chatPickWindow,
    ];
    if (owned.some((w) => w && !w.isDestroyed() && w.webContents === wc)) {
      return true;
    }
    // Fallback: URL under app root / asar
    const appPath = path.resolve(appRoot());
    let filePath = decodeURIComponent(url.replace(/^file:\/+/i, ""));
    if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
    const resolved = path.resolve(filePath);
    const prefix = appPath.endsWith(path.sep) ? appPath : appPath + path.sep;
    return resolved === appPath || resolved.startsWith(prefix);
  } catch {
    return false;
  }
}

function listDecks() {
  ensureData();
  const files = fs
    .readdirSync(decksDir())
    .filter((f) => f.endsWith(".json") && !f.endsWith(".bak.json") && !f.endsWith(".bak"));
  return files
    .map((f) => {
      try {
        const base = path.basename(f, ".json");
        if (!trySafeId(base)) return null;
        const d = JSON.parse(fs.readFileSync(path.join(decksDir(), f), "utf8"));
        return {
          id: trySafeId(d.id) || base,
          name: d.name || base,
          file: f,
          cardCount: Array.isArray(d.cards) ? d.cards.length : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort(i18n.compareDeckOrder);
}

function loadDeck(id) {
  ensureData();
  const safe = trySafeId(id);
  if (!safe) {
    const first = listDecks()[0];
    if (!first) return { id: "empty", name: t("err.emptyDeck"), cards: [] };
    return loadDeck(first.id);
  }
  let file;
  try {
    file = deckFilePath(decksDir(), safe);
  } catch {
    const first = listDecks()[0];
    if (!first) return { id: "empty", name: t("err.emptyDeck"), cards: [] };
    return loadDeck(first.id);
  }
  if (!fs.existsSync(file)) {
    const first = listDecks()[0];
    if (!first) return { id: "empty", name: t("err.emptyDeck"), cards: [] };
    return loadDeck(first.id);
  }
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeDeck(
      { ...d, id: safe, name: d.name || safe },
      { forceNewId: false, existingIds: new Set(), allowEmpty: true }
    );
  } catch (e) {
    log.warn("loadDeck failed", String(e.message || e));
    return { id: safe, name: safe, cards: [] };
  }
}

function saveDeck(deck) {
  ensureData();
  const normalized = normalizeDeck(deck || {}, {
    existingIds: new Set(),
    forceNewId: !trySafeId(deck?.id),
  });
  const file = deckFilePath(decksDir(), normalized.id);
  atomicWriteJson(file, normalized);
  return normalized;
}

function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function sendPinState() {
  sendDeck("pin-changed", { pinned: pinnedOpen });
}

/** Safe IPC to deck renderer — skips during quit or after destroy */
function sendDeck(channel, payload) {
  if (app.isQuitting) return;
  if (!deckWindow || deckWindow.isDestroyed()) return;
  const wc = deckWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  if (payload !== undefined) wc.send(channel, payload);
  else wc.send(channel);
}

function dialogParent() {
  if (targetsWindow && !targetsWindow.isDestroyed()) return targetsWindow;
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow;
  if (deckWindow && !deckWindow.isDestroyed()) return deckWindow;
  return null;
}

function broadcastStateChanged() {
  sendDeck("state-changed");
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("state-changed");
  }
  if (targetsWindow && !targetsWindow.isDestroyed()) {
    targetsWindow.webContents.send("state-changed");
  }
  if (chatPickWindow && !chatPickWindow.isDestroyed()) {
    chatPickWindow.webContents.send("state-changed");
  }
  notifyRemoteDeckChanged();
}

function broadcastTargetsUpdated() {
  const targets = readSettings().targets || [];
  sendDeck("targets-updated", targets);
  if (targetsWindow && !targetsWindow.isDestroyed()) {
    targetsWindow.webContents.send("targets-updated", targets);
  }
}

function closeSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  settingsWindow.close();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  edgeHoverPaused = true;
  settingsRestorePinned = pinnedOpen;
  if (!pinnedOpen) {
    settingsHeldPin = true;
    pinnedOpen = true;
    setDeckVisible(true);
    sendPinState();
  }
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.webContents.send("settings-open");
  }

  const width = 980;
  const height = 720;
  const wa = workArea();
  const x = Math.round(wa.x + (wa.width - width) / 2);
  const y = Math.round(wa.y + (wa.height - height) / 2);

  settingsWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 760,
    minHeight: 520,
    title: t("settings.winTitle"),
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    // Без parent к колоде: иначе always-on-top колоды держит настройки поверх всех окон
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  settingsWindow.once("ready-to-show", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
    }
  });

  settingsWindow.loadFile(path.join(appRoot(), "src", "settings.html"));

  settingsWindow.on("closed", () => {
    settingsWindow = null;
    edgeHoverPaused = false;
    if (settingsHeldPin) {
      settingsHeldPin = false;
      pinnedOpen = settingsRestorePinned;
      if (!pinnedOpen && !app.isQuitting) {
        setDeckVisible(false, { force: true });
      }
      sendPinState();
    }
    sendDeck("settings-closed");
    broadcastStateChanged();
  });
}

function closeTargetsWindow() {
  if (!targetsWindow || targetsWindow.isDestroyed()) return;
  if (app.isQuitting) {
    targetsHeldPin = false;
    targetsWindow.removeAllListeners("closed");
  }
  targetsWindow.close();
}

function closeChatPickWindow() {
  if (!chatPickWindow || chatPickWindow.isDestroyed()) return;
  chatPickWindow.close();
  chatPickWindow = null;
}

function targetsWindowPlacement(settings) {
  const fallbackWidth = 480;
  const fallbackHeight = 560;
  const saved = settings?.targetsWindowBounds;
  const valid =
    saved &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(Number(saved[key])));
  if (valid) {
    const bounds = {
      x: Math.round(Number(saved.x)),
      y: Math.round(Number(saved.y)),
      width: Math.min(10000, Math.max(400, Math.round(Number(saved.width)))),
      height: Math.min(10000, Math.max(420, Math.round(Number(saved.height)))),
    };
    const display = screen.getAllDisplays().find(({ workArea: wa }) => {
      const overlapWidth = Math.min(bounds.x + bounds.width, wa.x + wa.width) -
        Math.max(bounds.x, wa.x);
      const overlapHeight = Math.min(bounds.y + bounds.height, wa.y + wa.height) -
        Math.max(bounds.y, wa.y);
      return overlapWidth >= 80 && overlapHeight >= 80;
    });
    if (display) {
      const wa = display.workArea;
      const width = Math.min(bounds.width, wa.width);
      const height = Math.min(bounds.height, wa.height);
      return {
        x: Math.min(wa.x + wa.width - width, Math.max(wa.x, bounds.x)),
        y: Math.min(wa.y + wa.height - height, Math.max(wa.y, bounds.y)),
        width,
        height,
      };
    }
  }
  const wa = workArea();
  const width = Math.min(fallbackWidth, wa.width);
  const height = Math.min(fallbackHeight, wa.height);
  return {
    x: Math.round(wa.x + (wa.width - width) / 2),
    y: Math.round(wa.y + (wa.height - height) / 2),
    width,
    height,
  };
}

function saveTargetsWindowPlacement() {
  if (!targetsWindow || targetsWindow.isDestroyed()) return;
  writeSettings({
    targetsWindowBounds: targetsWindow.getNormalBounds(),
    targetsWindowMaximized: targetsWindow.isMaximized(),
  });
}

function openChatPickWindow() {
  if (chatPickWindow && !chatPickWindow.isDestroyed()) {
    chatPickWindow.focus();
    return;
  }
  const width = 460;
  const height = 580;
  const wa = workArea();
  const x = Math.round(wa.x + (wa.width - width) / 2);
  const y = Math.round(wa.y + (wa.height - height) / 2);
  chatPickWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 380,
    minHeight: 440,
    title: t("chatPick.winTitle"),
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  chatPickWindow.setAlwaysOnTop(true, "floating");
  // Dictation (Web Speech) needs media permission in this window.
  chatPickWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      callback(permission === "media" || permission === "microphone");
    }
  );
  chatPickWindow.once("ready-to-show", () => {
    if (!chatPickWindow || chatPickWindow.isDestroyed()) return;
    // Prefer inactive show so a game does not lose focus when adding chats mid-play.
    if (readSettings().preserveFocus !== false) {
      chatPickWindow.showInactive();
    } else {
      chatPickWindow.show();
      chatPickWindow.focus();
    }
  });
  chatPickWindow.loadFile(path.join(appRoot(), "src", "chat-pick.html"));
  chatPickWindow.on("closed", () => {
    chatPickWindow = null;
    broadcastTargetsUpdated();
  });
}

function openTargetsWindow() {
  if (targetsWindow && !targetsWindow.isDestroyed()) {
    if (targetsWindow.isMinimized()) targetsWindow.restore();
    if (!targetsWindow.isVisible()) targetsWindow.show();
    targetsWindow.focus();
    return;
  }
  edgeHoverPaused = true;
  targetsRestorePinned = pinnedOpen;
  if (!pinnedOpen) {
    targetsHeldPin = true;
    pinnedOpen = true;
    setDeckVisible(true);
    sendPinState();
  }
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.webContents.send("targets-open");
  }

  const settings = readSettings();
  const bounds = targetsWindowPlacement(settings);

  targetsWindow = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 420,
    title: t("targets.winTitle"),
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    alwaysOnTop: false,
    frame: true,
    thickFrame: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  targetsWindow.once("ready-to-show", () => {
    if (targetsWindow && !targetsWindow.isDestroyed()) {
      targetsWindow.show();
      if (settings.targetsWindowMaximized === true) targetsWindow.maximize();
      targetsWindow.focus();
    }
  });

  targetsWindow.loadFile(path.join(appRoot(), "src", "targets.html"));
  targetsWindow.on("close", saveTargetsWindowPlacement);

  targetsWindow.on("closed", () => {
    targetsWindow = null;
    edgeHoverPaused = false;
    if (targetsHeldPin) {
      targetsHeldPin = false;
      pinnedOpen = targetsRestorePinned;
      sendPinState();
      // Keep cards visible — user closes targets to send prompts
      if (!app.isQuitting) {
        setDeckVisible(true, { inactive: true });
      }
    }
    sendDeck("targets-closed");
    broadcastStateChanged();
  });
}

/** Base: 5×24px corner buttons + 4×2px gaps; card height 2:3 */
function stripMetrics(scale) {
  const s = Math.min(1.5, Math.max(0.75, Number(scale) || 1));
  const btn = Math.round(24 * s);
  const gap = Math.max(1, Math.round(2 * s));
  // Must match src/styles.css --deck-strip-w (5 corner buttons)
  const strip = 5 * btn + 4 * gap;
  const cardH = Math.round((strip * 3) / 2);
  const titlebarH = Math.max(btn, Math.round(28 * s));
  const cardGap = Math.max(1, Math.round(2 * s));
  return { scale: s, btn, gap, strip, cardH, titlebarH, cardGap };
}

function currentStrip() {
  return stripMetrics(readSettings().panelScale);
}

function dockLayout(dock, expanded = expandedMode, scaleOverride = null) {
  const wa = workArea();
  const metrics =
    scaleOverride != null ? stripMetrics(scaleOverride) : currentStrip();
  const { strip: cardStrip, cardH, titlebarH, scale } = metrics;
  const previewLane = expanded ? 0 : 300;
  const chrome = expanded ? 240 : 0;
  const pad = 6;

  switch (dock) {
    case "top": {
      // Карты + боковой список; ниже — полоса под описание
      const tipLane = expanded ? 0 : 400;
      const height = titlebarH + cardH + 4 + tipLane + chrome + pad * 2;
      return {
        x: wa.x,
        y: wa.y,
        width: wa.width,
        height: Math.min(height + (expanded ? 40 : 0), Math.floor(wa.height * 0.65)),
        horizontal: true,
        expanded,
      };
    }
    case "bottom": {
      const tipLane = expanded ? 0 : 400;
      const height = titlebarH + cardH + 4 + tipLane + chrome + pad * 2;
      const h = Math.min(height + (expanded ? 40 : 0), Math.floor(wa.height * 0.65));
      return {
        x: wa.x,
        y: wa.y + wa.height - h,
        width: wa.width,
        height: h,
        horizontal: true,
        expanded,
      };
    }
    case "left": {
      const sideLayout =
        String(readSettings().sideCardLayout || "table").toLowerCase() === "strip"
          ? "strip"
          : "table";
      const tableGap = Math.max(2, Math.round(4 * scale));
      const tableCard = Math.round(cardStrip * 0.85);
      const tableW =
        sideLayout === "table" ? tableCard * 3 + tableGap * 2 : cardStrip;
      const w = tableW + previewLane + pad + chrome;
      return {
        x: wa.x,
        y: wa.y,
        width: w,
        height: wa.height,
        horizontal: false,
        expanded,
      };
    }
    case "right":
    default: {
      const sideLayout =
        String(readSettings().sideCardLayout || "table").toLowerCase() === "strip"
          ? "strip"
          : "table";
      const tableGap = Math.max(2, Math.round(4 * scale));
      const tableCard = Math.round(cardStrip * 0.85);
      const tableW =
        sideLayout === "table" ? tableCard * 3 + tableGap * 2 : cardStrip;
      const w = tableW + previewLane + pad + chrome;
      return {
        x: wa.x + wa.width - w,
        y: wa.y,
        width: w,
        height: wa.height,
        horizontal: false,
        expanded,
      };
    }
  }
}

function pointInBounds(p, b) {
  return (
    p.x >= b.x &&
    p.x <= b.x + b.width &&
    p.y >= b.y &&
    p.y <= b.y + b.height
  );
}

function isNearDockEdge(point, dock, threshold) {
  const wa = workArea();
  const t = Math.max(6, threshold || 14);
  switch (dock) {
    case "top":
      return (
        point.y >= wa.y &&
        point.y <= wa.y + t &&
        point.x >= wa.x &&
        point.x <= wa.x + wa.width
      );
    case "bottom":
      return (
        point.y >= wa.y + wa.height - t &&
        point.y <= wa.y + wa.height &&
        point.x >= wa.x &&
        point.x <= wa.x + wa.width
      );
    case "left":
      return (
        point.x >= wa.x &&
        point.x <= wa.x + t &&
        point.y >= wa.y &&
        point.y <= wa.y + wa.height
      );
    case "right":
    default:
      return (
        point.x >= wa.x + wa.width - t &&
        point.x <= wa.x + wa.width &&
        point.y >= wa.y &&
        point.y <= wa.y + wa.height
      );
  }
}

function startEdgeHoverWatch() {
  if (edgePollTimer) clearInterval(edgePollTimer);
  edgePollTimer = setInterval(() => {
    try {
      tickEdgeHover();
    } catch (e) {
      console.warn(e);
    }
  }, 70);
}

function deckKeepOpenBounds() {
  if (!deckWindow || deckWindow.isDestroyed()) return null;
  const b = deckWindow.getBounds();
  if (expandedMode || fullscreenEditMode) return b;
  // Полоса/стол карт (не вся зона превью)
  const settings = readSettings();
  const dock = settings.dock || "right";
  const sideTable =
    String(settings.sideCardLayout || "table").toLowerCase() !== "strip";
  const m = currentStrip();
  const tableGap = Math.max(2, Math.round(4 * m.scale));
  const tableCard = Math.round(m.strip * 0.85);
  const tableW = sideTable ? tableCard * 3 + tableGap * 2 : m.strip;
  const strip = tableW + 12;
  const barH = m.titlebarH + m.cardH + 10;
  // Table stack: controls + card grid (centered vertically).
  const tableH = Math.round(tableCard * 1.5 * 4 + tableGap * 3);
  // Hub: corner buttons row + deck pager + padding (must cover hover on ⚙/◎/💬)
  const controlsH = Math.round(96 * m.scale);
  const clusterH = Math.min(b.height, tableH + controlsH + 24);
  const clusterY = b.y + Math.round((b.height - clusterH) / 2);
  switch (dock) {
    case "left":
      return sideTable
        ? { x: b.x, y: clusterY, width: strip, height: clusterH }
        : { x: b.x, y: b.y, width: strip, height: b.height };
    case "right":
      return sideTable
        ? {
            x: b.x + b.width - strip,
            y: clusterY,
            width: strip,
            height: clusterH,
          }
        : {
            x: b.x + b.width - strip,
            y: b.y,
            width: strip,
            height: b.height,
          };
    case "top":
      return { x: b.x, y: b.y, width: b.width, height: barH };
    case "bottom":
      return { x: b.x, y: b.y + b.height - barH, width: b.width, height: barH };
    default:
      return b;
  }
}

function setDeckIgnoreMouse(ignore) {
  if (!deckWindow || deckWindow.isDestroyed()) return;
  try {
    deckWindow.setIgnoreMouseEvents(!!ignore, { forward: true });
  } catch {
    /* ignore */
  }
}

/** Курсор в координатах клиентской области окна колоды */
function cursorInDeckClient() {
  if (!deckWindow || deckWindow.isDestroyed()) return null;
  const p = screen.getCursorScreenPoint();
  const b = deckWindow.getContentBounds();
  return { x: p.x - b.x, y: p.y - b.y };
}

function tickEdgeHover() {
  if (!deckUiReady || edgeHoverPaused || app.isQuitting || fullscreenEditMode) return;
  const settings = readSettings();
  if (settings.edgeHover === false) return;
  if (pinnedOpen) return;
  if (pickWindow && !pickWindow.isDestroyed()) return;

  const point = screen.getCursorScreenPoint();
  const dock = settings.dock || "right";
  const near = isNearDockEdge(point, dock, settings.edgeThreshold);
  const keepBounds = deckKeepOpenBounds();
  let overPanel = false;
  if (deckWindow && deckWindow.isVisible() && keepBounds) {
    overPanel = pointInBounds(point, keepBounds);
  }

  if (near || overPanel || previewHoldOpen || modalHoldOpen || mouseCaptureOpen) {
    if (hideDelayTimer) {
      clearTimeout(hideDelayTimer);
      hideDelayTimer = null;
    }
    if (deckWindow && !deckWindow.isVisible()) {
      setDeckVisible(true, { inactive: true, reason: "edge" });
    }
    return;
  }

  if (deckWindow && deckWindow.isVisible() && !hideDelayTimer) {
    hideDelayTimer = setTimeout(() => {
      hideDelayTimer = null;
      if (
        pinnedOpen ||
        edgeHoverPaused ||
        previewHoldOpen ||
        modalHoldOpen ||
        mouseCaptureOpen
      )
        return;
      const p = screen.getCursorScreenPoint();
      const s = readSettings();
      if (isNearDockEdge(p, s.dock || "right", s.edgeThreshold)) return;
      const kb = deckKeepOpenBounds();
      if (deckWindow && deckWindow.isVisible() && kb && pointInBounds(p, kb))
        return;
      setDeckVisible(false, { reason: "edge-leave" });
    }, settings.hideDelayMs || 450);
  }
}

function applyDock(dock, expanded = expandedMode, scaleOverride = null) {
  if (fullscreenEditMode) return;
  const d = dock || readSettings().dock || "right";
  const layout = dockLayout(d, expanded, scaleOverride);

  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.setBounds({
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    });
    deckWindow.webContents.send("dock-changed", {
      dock: d,
      horizontal: layout.horizontal,
      expanded: layout.expanded,
    });
  }
}

function createDeckWindow() {
  const layout = dockLayout(readSettings().dock || "right");

  deckWindow = new BrowserWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: false,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  deckWindow.setAlwaysOnTop(true, "screen-saver");
  deckWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  deckWindow.loadFile(path.join(appRoot(), "src", "index.html"));

  // OS focus — not document.hasFocus() (unreliable with click-through / always-on-top)
  const pushDeckFocus = () => {
    if (!deckWindow || deckWindow.isDestroyed()) return;
    const focused = deckWindow.isFocused();
    if (!focused) previewHoldOpen = false;
    sendDeck("deck-focus-changed", { focused });
  };
  deckWindow.on("focus", pushDeckFocus);
  deckWindow.on("blur", pushDeckFocus);
  deckWindow.on("show", pushDeckFocus);
  deckWindow.on("hide", () => {
    previewHoldOpen = false;
    sendDeck("deck-focus-changed", { focused: false });
  });

  deckWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      setDeckVisible(false);
    }
  });

  deckWindow.on("closed", () => {
    deckWindow = null;
  });

  deckWindow.webContents.on("did-finish-load", () => {
    deckUiReady = false;
    const d = readSettings().dock || "right";
    const lay = dockLayout(d, expandedMode);
    deckWindow.webContents.send("dock-changed", {
      dock: d,
      horizontal: lay.horizontal,
      expanded: lay.expanded,
    });
    sendPinState();
    if (deckWindow.isVisible()) {
      deckWindow.webContents.send("deck-reveal");
    }
  });
}

function markDeckUiReady() {
  if (deckUiReady) return;
  deckUiReady = true;
  startEdgeHoverWatch();
  scheduleCdpStartupNudge();
}

/** Once per process: if CDP closed, ask the deck UI to offer launch/restart. */
let cdpStartupNudgeSent = false;
function scheduleCdpStartupNudge() {
  if (cdpStartupNudgeSent) return;
  cdpStartupNudgeSent = true;
  setTimeout(async () => {
    try {
      const settings = readSettings();
      const port = settings.cdpPort || DEFAULT_CDP_PORT;
      const cdp = getCdpClient(port);
      const probe = await cdp.probe();
      if (probe.open) return;
      const running = await isCursorRunning();
      if (deckWindow && !deckWindow.isDestroyed()) {
        deckWindow.webContents.send("cdp-nudge", {
          cursorRunning: running,
          port,
        });
      }
    } catch (err) {
      log.warn("cdp-startup-nudge", String(err.message || err));
    }
  }, 1800);
}

function cancelConcealAnim() {
  if (concealAnimTimer) {
    clearTimeout(concealAnimTimer);
    concealAnimTimer = null;
  }
}

function shutdownApp() {
  if (app.isQuitting) return;
  app.isQuitting = true;
  if (edgePollTimer) {
    clearInterval(edgePollTimer);
    edgePollTimer = null;
  }
  if (hideDelayTimer) {
    clearTimeout(hideDelayTimer);
    hideDelayTimer = null;
  }
  cancelConcealAnim();
  clearShortcuts();
  closePickWindow();
  settingsHeldPin = false;
  targetsHeldPin = false;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.removeAllListeners("closed");
    settingsWindow.close();
    settingsWindow = null;
  }
  if (targetsWindow && !targetsWindow.isDestroyed()) {
    targetsWindow.removeAllListeners("closed");
    targetsWindow.close();
    targetsWindow = null;
  }
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.removeAllListeners("close");
    deckWindow.destroy();
    deckWindow = null;
  }
  app.quit();
}

/** @type {ReturnType<typeof setTimeout> | null} */
let revealDelayTimer = null;

function cancelRevealDelay() {
  if (revealDelayTimer) {
    clearTimeout(revealDelayTimer);
    revealDelayTimer = null;
  }
}

function setDeckVisible(visible, opts = {}) {
  if (!deckWindow || deckWindow.isDestroyed()) return;
  if (app.isQuitting && !visible) return;
  const wc = deckWindow.webContents;
  if (!wc || wc.isDestroyed()) return;

  if (visible) {
    cancelConcealAnim();
    cancelRevealDelay();
    applyDock(readSettings().dock || "right", expandedMode);
    // Сначала окно в «свёрнутом» состоянии UI, потом плавный reveal
    if (!opts.silent) {
      sendDeck("deck-conceal");
    }
    // Снова поверх всех — некоторые приложения (Cursor) могут перехватывать z-order
    try {
      deckWindow.setAlwaysOnTop(true, "screen-saver");
    } catch {
      /* ignore */
    }
    if (opts.inactive && typeof deckWindow.showInactive === "function") {
      deckWindow.showInactive();
    } else {
      deckWindow.show();
      if (!opts.inactive) deckWindow.focus();
    }
    if (!opts.silent) {
      const reveal = () => {
        if (!deckWindow || deckWindow.isDestroyed() || !deckWindow.isVisible()) return;
        sendDeck("deck-reveal");
      };
      // Дать кадру отрисоваться скрытым, затем выезд карт
      revealDelayTimer = setTimeout(() => {
        revealDelayTimer = null;
        reveal();
      }, 40);
      if (wc.isLoading()) {
        wc.once("did-finish-load", () => {
          cancelRevealDelay();
          revealDelayTimer = setTimeout(() => {
            revealDelayTimer = null;
            reveal();
          }, 40);
        });
      }
    }
  } else {
    if (!opts.force && pinnedOpen && opts.reason === "edge-leave") return;
    // Уже скрыто — не шлём conceal (иначе мигание при старте)
    if (!deckWindow.isVisible()) {
      cancelConcealAnim();
      cancelRevealDelay();
      return;
    }
    cancelConcealAnim();
    cancelRevealDelay();
    if (opts.silent) {
      deckWindow.hide();
      if (opts.reason !== "edge-leave" && opts.unpin !== false && opts.force) {
        pinnedOpen = false;
        expandedMode = false;
      }
      return;
    }
    sendDeck("deck-conceal");
    concealAnimTimer = setTimeout(() => {
      concealAnimTimer = null;
      if (!deckWindow || deckWindow.isDestroyed()) return;
      if (pinnedOpen && opts.reason === "edge-leave") return;
      deckWindow.hide();
      if (opts.reason !== "edge-leave" && opts.unpin !== false && opts.force) {
        pinnedOpen = false;
        expandedMode = false;
      }
    }, CONCEAL_ANIM_MS);
  }
}

function setFullscreenEdit(on) {
  fullscreenEditMode = !!on;
  if (!deckWindow || deckWindow.isDestroyed()) return;

  if (fullscreenEditMode) {
    pinnedOpen = true;
    expandedMode = true;
    cancelConcealAnim();
    const wa = workArea();
    deckWindow.setBounds(wa);
    deckWindow.show();
    deckWindow.focus();
    deckWindow.webContents.send("deck-reveal");
    deckWindow.webContents.send("fullscreen-edit", { on: true });
    deckWindow.webContents.send("panel-expanded", { expanded: true });
  } else {
    expandedMode = false;
    applyDock(readSettings().dock || "right", false);
    deckWindow.webContents.send("fullscreen-edit", { on: false });
    deckWindow.webContents.send("panel-expanded", { expanded: false });
  }
  return { on: fullscreenEditMode };
}

function toggleDeck() {
  if (!deckWindow) return;
  if (pinnedOpen || deckWindow.isVisible()) {
    pinnedOpen = false;
    expandedMode = false;
    fullscreenEditMode = false;
    setDeckVisible(false, { force: true });
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("fullscreen-edit", { on: false });
      deckWindow.webContents.send("panel-expanded", { expanded: false });
    }
  } else {
    pinnedOpen = true;
    setDeckVisible(true, { inactive: false });
  }
  sendPinState();
}

function clearShortcuts() {
  if (!app.isReady()) return;
  try {
    globalShortcut.unregisterAll();
  } catch {
    /* ignore — e.g. second instance quitting before ready */
  }
}

function registerShortcuts() {
  if (!app.isReady()) return;
  clearShortcuts();
  const settings = readSettings();
  const hotkey = settings.showHotkey || "F9";
  const failed = [];
  try {
    const ok = globalShortcut.register(hotkey, () => {
      toggleDeck();
    });
    if (!ok) failed.push(hotkey);
  } catch (e) {
    log.warn("show hotkey failed", String(e.message || e));
    failed.push(hotkey);
    try {
      globalShortcut.register("F9", () => toggleDeck());
    } catch {
      /* ignore */
    }
  }

  const deck = loadDeck(settings.activeDeckId);
  for (const card of deck.cards || []) {
    if (!card.hotkey) continue;
    try {
      const ok = globalShortcut.register(card.hotkey, () => {
        pasteQueue.enqueue(() => pasteCardById(card.id));
      });
      if (!ok) failed.push(card.hotkey);
    } catch (e) {
      log.warn("card hotkey failed", String(card.hotkey));
      failed.push(card.hotkey);
    }
  }
  if (failed.length && deckWindow && !deckWindow.isDestroyed()) {
    sendDeck("toast", {
      type: "error",
      message: t("toast.hotkeyBusy", { keys: failed.join(", ") }),
    });
  }
}

function parseWindowLine(line) {
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const [hwnd, pid, processName, ...rest] = parts;
  const title = rest.join("\t").trim();
  return {
    hwnd,
    pid,
    processName: (processName || "").trim(),
    title,
  };
}

function isOwnAppWindow(win) {
  const t = `${win.title || ""} ${win.processName || ""}`;
  return /keycode|lazy.?coder/i.test(t);
}

function windowDisplayTitle(win) {
  if (win.title) return win.title;
  if (win.processName) return win.processName;
  return t("msg.windowN", { n: String(win.hwnd).slice(-4) });
}

async function listWindows() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  public static List<string> List() {
    var list = new List<string>();
    EnumWindows((hWnd, l) => {
      if (!IsWindowVisible(hWnd)) return true;
      int style = GetWindowLong(hWnd, -16);
      if ((style & 0x40000000) != 0) return true; // WS_CHILD
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      string proc = "";
      try { proc = Process.GetProcessById((int)pid).ProcessName; } catch {}
      int len = GetWindowTextLength(hWnd);
      var sb = new StringBuilder(Math.Max(len, 1) + 1);
      if (len > 0) GetWindowText(hWnd, sb, sb.Capacity);
      string title = sb.ToString();
      // Keep titled windows; also untitled top-level of chat apps (rare)
      bool chatProc = proc.Equals("Cursor", StringComparison.OrdinalIgnoreCase)
        || proc.Equals("Code", StringComparison.OrdinalIgnoreCase)
        || proc.IndexOf("chrome", StringComparison.OrdinalIgnoreCase) >= 0
        || proc.IndexOf("msedge", StringComparison.OrdinalIgnoreCase) >= 0
        || proc.IndexOf("firefox", StringComparison.OrdinalIgnoreCase) >= 0;
      if (len == 0 && !chatProc) return true;
      list.Add(hWnd.ToInt64() + "\\t" + pid + "\\t" + proc + "\\t" + title);
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[WinEnum]::List() | ForEach-Object { $_ }
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }
    );
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseWindowLine)
      .filter((w) => w && !isOwnAppWindow(w));
  } catch (e) {
    console.error(e);
    return [];
  }
}

const POINT_DUP_PX = 12;

function pointsNear(a, b, threshold = POINT_DUP_PX) {
  if (!a || !b) return false;
  const dx = Number(a.x) - Number(b.x);
  const dy = Number(a.y) - Number(b.y);
  return dx * dx + dy * dy <= threshold * threshold;
}

function normalizePoint(p) {
  if (!p || p.x == null || p.y == null) return null;
  return { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) };
}

/** Electron renderer often gives DIP; Win32/UIA need physical pixels when DPI ≠ 100%. */
function toPhysicalScreenPoint(screenX, screenY) {
  try {
    const dip = {
      x: Math.round(Number(screenX) || 0),
      y: Math.round(Number(screenY) || 0),
    };
    if (typeof screen.dipToScreenPoint === "function") {
      const phys = screen.dipToScreenPoint(dip);
      return {
        x: Math.round(phys.x),
        y: Math.round(phys.y),
      };
    }
    return dip;
  } catch {
    return {
      x: Math.round(Number(screenX) || 0),
      y: Math.round(Number(screenY) || 0),
    };
  }
}

/** True physical cursor via Win32 — most reliable after pick overlay hides. */
async function getPhysicalCursorPos() {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CursorPos {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  public static string Read() {
    POINT p;
    if (!GetCursorPos(out p)) return "";
    return p.X.ToString() + "," + p.Y.ToString();
  }
}
"@
[CursorPos]::Read()
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const m = String(stdout || "")
      .trim()
      .match(/^(-?\d+)\s*,\s*(-?\d+)$/);
    if (!m) return null;
    return { x: Number(m[1]), y: Number(m[2]) };
  } catch {
    return null;
  }
}

function uniquePoints(points) {
  const out = [];
  const seen = new Set();
  for (const p of points) {
    if (!p || p.x == null || p.y == null) continue;
    const pt = { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) };
    const key = `${pt.x},${pt.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pt);
  }
  return out;
}

async function windowFromPointPhysical(screenX, screenY) {
  const sx = Math.round(Number(screenX) || 0);
  const sy = Math.round(Number(screenY) || 0);
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class WinPoint {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static string At(int x, int y) {
    POINT pt; pt.X = x; pt.Y = y;
    IntPtr h = WindowFromPoint(pt);
    if (h == IntPtr.Zero) return "";
    IntPtr root = GetAncestor(h, 2); // GA_ROOT
    if (root != IntPtr.Zero) h = root;
    POINT client; client.X = x; client.Y = y;
    ScreenToClient(h, ref client);
    uint pid; GetWindowThreadProcessId(h, out pid);
    string proc = "";
    try { proc = Process.GetProcessById((int)pid).ProcessName; } catch {}
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(Math.Max(len, 1) + 1);
    if (len > 0) GetWindowText(h, sb, sb.Capacity);
    return h.ToInt64() + "\\t" + pid + "\\t" + proc + "\\t" + client.X + "\\t" + client.Y + "\\t" + sb.ToString();
  }
}
"@
[WinPoint]::At(${sx}, ${sy})
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const line = (stdout || "").trim();
    if (!line) return null;
    const parts = line.split("\t");
    if (parts.length < 5) return null;
    const [hwnd, pid, processName, cx, cy, ...rest] = parts;
    const win = {
      hwnd,
      pid,
      processName: (processName || "").trim(),
      title: rest.join("\t").trim(),
      clientX: Number(cx),
      clientY: Number(cy),
    };
    if (isOwnAppWindow(win)) return null;
    if (!win.title && !win.processName) return null;
    return win;
  } catch (e) {
    console.error(e);
    return null;
  }
}

/** DIP screen coords from Electron → physical → window under point. */
async function windowFromPoint(screenX, screenY) {
  const phys = toPhysicalScreenPoint(screenX, screenY);
  return windowFromPointPhysical(phys.x, phys.y);
}

async function getWindowClientSize(hwnd) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinSize {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  public static string Size(long hwndVal) {
    RECT r;
    if (!GetClientRect((IntPtr)hwndVal, out r)) return "";
    return (r.Right - r.Left) + "\\t" + (r.Bottom - r.Top);
  }
}
"@
[WinSize]::Size(${Number(hwnd)}L)
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const [w, h] = (stdout || "").trim().split("\t").map(Number);
    if (!w || !h) return null;
    return { width: w, height: h };
  } catch {
    return null;
  }
}

function resolveTargetWindow(target, windows) {
  if (target.hwnd) {
    const byHwnd = windows.find((w) => String(w.hwnd) === String(target.hwnd));
    if (byHwnd) return byHwnd;
  }
  if (target.fullTitle) {
    const exact = windows.find((w) => w.title === target.fullTitle);
    if (exact) return exact;
  }
  const match = (target.match || "").toLowerCase();
  if (match.length >= 4) {
    const hits = windows.filter((w) =>
      windowDisplayTitle(w).toLowerCase().includes(match)
    );
    if (hits.length === 1) return hits[0];
  }
  return null;
}

function findDuplicateFieldTarget(targets, hwnd, inputPoint, focusPoint) {
  return (targets || []).find((t) => {
    if (t.driver === "uia") return false;
    if (String(t.hwnd) !== String(hwnd)) return false;
    if (!pointsNear(t.inputPoint, inputPoint)) return false;
    const a = t.focusPoint || null;
    const b = focusPoint || null;
    if (!a && !b) return true;
    if (!a || !b) return false;
    return pointsNear(a, b);
  });
}

function upsertTargetFromField({
  win,
  inputPoint,
  focusPoint = null,
  legacy = false,
}) {
  const settings = readSettings();
  const display = windowDisplayTitle(win);
  const input = normalizePoint(inputPoint);
  const focus = normalizePoint(focusPoint);
  if (!input) {
    return { ok: false, error: t("err.noInputField") };
  }

  const existing = findDuplicateFieldTarget(
    settings.targets,
    win.hwnd,
    input,
    focus
  );
  if (existing) {
    const targets = (settings.targets || []).map((t) =>
      t.id === existing.id
        ? {
            ...t,
            enabled: true,
            fullTitle: display,
            match: display,
            hwnd: win.hwnd,
            processName: win.processName || t.processName,
            inputPoint: input,
            focusPoint: focus,
            legacy: !!legacy,
            driver: "win32-field",
            needsUiaRebind: false,
          }
        : t
    );
    writeSettings({ targets });
    return {
      ok: true,
      duplicate: true,
      target: {
        ...existing,
        fullTitle: display,
        inputPoint: input,
        focusPoint: focus,
      },
    };
  }

  const brand =
    display.match(
      /Cursor|ChatGPT|Claude|Grok|VS Code|Code|Windsurf|Chrome|Edge|Firefox|Copilot/i
    )?.[0] ||
    win.processName ||
    display.slice(0, 24);
  const name = uniqueTargetName(brand, settings.targets || []);
  const target = {
    id: `tgt-${Date.now()}`,
    name,
    match: display,
    hwnd: win.hwnd,
    enabled: true,
    fullTitle: display,
    processName: win.processName || "",
    inputPoint: input,
    focusPoint: focus,
    legacy: !!legacy,
    driver: "win32-field",
    needsUiaRebind: false,
  };
  writeSettings({ targets: [...(settings.targets || []), target] });
  return { ok: true, duplicate: false, target };
}

function findDuplicateQuietTarget(targets, hwnd, inputLocator) {
  const key = locatorKey(inputLocator);
  if (!key || !hwnd) return null;
  return (targets || []).find(
    (t) =>
      t.driver === "uia-quiet" &&
      String(t.hwnd) === String(hwnd) &&
      locatorKey(t.inputLocator) === key
  );
}

function upsertTargetFromQuietUia({
  hwnd,
  windowName,
  processName,
  inputLocator,
}) {
  const settings = readSettings();
  if (!hwnd || !inputLocator) {
    return { ok: false, error: t("err.saveQuietFail") };
  }
  const display = windowName || processName || t("err.fieldDefault");
  const existing = findDuplicateQuietTarget(
    settings.targets,
    hwnd,
    inputLocator
  );
  if (existing) {
    const targets = (settings.targets || []).map((t) =>
      t.id === existing.id
        ? {
            ...t,
            enabled: true,
            driver: "uia-quiet",
            needsUiaRebind: false,
            needsCdpRebind: false,
            hwnd: String(hwnd),
            fullTitle: display,
            match: display,
            processName: processName || t.processName || "",
            inputLocator,
          }
        : t
    );
    writeSettings({ targets });
    return {
      ok: true,
      duplicate: true,
      target: targets.find((t) => t.id === existing.id),
    };
  }
  const brand =
    display.match(
      /Notepad|Блокнот|Cursor|ChatGPT|Chrome|Edge|Firefox|Code/i
    )?.[0] ||
    processName ||
    display.slice(0, 24);
  const name = uniqueTargetName(brand, settings.targets || []);
  const target = {
    id: `tgt-${Date.now()}`,
    name,
    match: display,
    hwnd: String(hwnd),
    enabled: true,
    fullTitle: display,
    processName: processName || "",
    driver: "uia-quiet",
    needsUiaRebind: false,
    needsCdpRebind: false,
    inputLocator,
  };
  writeSettings({ targets: [...(settings.targets || []), target] });
  return { ok: true, duplicate: false, target };
}

function findDuplicateUiaTarget(targets, chatLocator) {
  const key = locatorKey(chatLocator);
  if (!key) return null;
  return (targets || []).find(
    (t) => t.driver === "uia" && locatorKey(t.chatLocator) === key
  );
}

function upsertTargetFromUia({
  hwnd,
  windowName,
  processName,
  chatLocator,
  inputLocator,
  chatName,
}) {
  const settings = readSettings();
  if (!chatLocator || !inputLocator) {
    return { ok: false, error: t("err.saveChatFail") };
  }
  const display = windowName || "Cursor";
  const existing = findDuplicateUiaTarget(settings.targets, chatLocator);
  if (existing) {
    const targets = (settings.targets || []).map((t) =>
      t.id === existing.id
        ? {
            ...t,
            enabled: true,
            driver: "uia",
            needsUiaRebind: false,
            hwnd: String(hwnd),
            fullTitle: display,
            match: display,
            processName: processName || t.processName || "Cursor",
            chatLocator,
            inputLocator,
            chatName: chatName || t.chatName || chatLocator.name || "",
          }
        : t
    );
    writeSettings({ targets });
    return {
      ok: true,
      duplicate: true,
      target: targets.find((t) => t.id === existing.id),
    };
  }

  const baseName =
    (chatName || chatLocator.name || "").trim().slice(0, 40) || t("err.cursorChat");
  const name = uniqueTargetName(baseName, settings.targets || []);
  const target = {
    id: `tgt-${Date.now()}`,
    name,
    match: display,
    hwnd: String(hwnd),
    enabled: true,
    fullTitle: display,
    processName: processName || "Cursor",
    driver: "uia",
    needsUiaRebind: false,
    chatLocator,
    inputLocator,
    chatName: chatName || chatLocator.name || "",
  };
  writeSettings({ targets: [...(settings.targets || []), target] });
  return { ok: true, duplicate: false, target };
}

/** @deprecated window-only add — creates legacy fallback input point */
async function upsertTargetFromWindow(win) {
  const size = await getWindowClientSize(win.hwnd);
  const inputPoint = size
    ? { x: Math.round(size.width / 2), y: Math.round(size.height * 0.82) }
    : { x: 200, y: 400 };
  return upsertTargetFromField({
    win,
    inputPoint,
    focusPoint: null,
    legacy: true,
  });
}

function uniqueTargetName(base, targets) {
  const root = String(base || t("err.chatDefault")).trim() || t("err.chatDefault");
  const taken = new Set((targets || []).map((t) => t.name));
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root} · ${n}`)) n += 1;
  return `${root} · ${n}`;
}

/** After UIA already focused the input: only Ctrl+V (+ Enter). */
async function pasteClipboardKeys(autoEnter, pauseMs) {
  const pause = Math.max(80, Number(pauseMs) || 350);
  const doEnter = autoEnter === true;
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinKeys {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void KeyDown(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void KeyUp(byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
  public static string Paste(bool enter, int pauseMs) {
    System.Threading.Thread.Sleep(pauseMs);
    KeyDown(0x11); KeyDown(0x56);
    System.Threading.Thread.Sleep(40);
    KeyUp(0x56); KeyUp(0x11);
    if (enter) {
      System.Threading.Thread.Sleep(100);
      KeyDown(0x0D); System.Threading.Thread.Sleep(30); KeyUp(0x0D);
    }
    System.Threading.Thread.Sleep(200);
    return "OK";
  }
}
"@
[WinKeys]::Paste($${doEnter}, ${pause})
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const status = (stdout || "").trim().split(/\r?\n/).pop();
    if (status === "OK") return { ok: true };
    return { ok: false, error: status || t("err.pasteFail") };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function focusAndPasteUia(target, text, autoEnter, pauseMs) {
  const uia = getUiaClient();
  const hwnd = target.hwnd;
  if (!hwnd) return { ok: false, error: t("err.noHwnd") };
  if (!target.chatLocator || !target.inputLocator) {
    return { ok: false, error: t("err.noUiaLocators") };
  }

  try {
    const probe = await uia.probe(hwnd);
    if (probe.status === "chrome_only" || probe.accessible === false) {
      return {
        ok: false,
        error: uiaErr("chrome_only"),
        needsAccessibility: true,
      };
    }

    const sel = await uia.selectChat(hwnd, target.chatLocator);
    if (!sel.ok) {
      return { ok: false, error: uiaErr(sel.error, t("err.chatNotSelected")) };
    }

    await new Promise((r) => setTimeout(r, 150));

    const focus = await uia.focusInput(hwnd, target.inputLocator);
    if (!focus.ok || focus.focused === false) {
      return {
        ok: false,
        error: uiaErr(focus.error || "focus_mismatch"),
      };
    }

    clipboard.writeText(text);
    const paste = await pasteClipboardKeys(autoEnter, pauseMs);
    return paste;
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

async function focusAndPaste(hwnd, text, autoEnter, pauseMs, points = {}) {
  clipboard.writeText(text);
  const pause = Math.max(250, Number(pauseMs) || 350);
  const doEnter = autoEnter === true;
  const focus = normalizePoint(points.focusPoint);
  const input = normalizePoint(points.inputPoint);
  const focusX = focus ? focus.x : -1;
  const focusY = focus ? focus.y : -1;
  const inputX = input ? input.x : -1;
  const inputY = input ? input.y : -1;

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPaste {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void KeyDown(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void KeyUp(byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
  static uint ThreadOf(IntPtr h) { uint pid; return GetWindowThreadProcessId(h, out pid); }
  public static bool ForceFocus(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    uint fgThread = fg != IntPtr.Zero ? ThreadOf(fg) : 0;
    uint cur = GetCurrentThreadId();
    uint targetThread = ThreadOf(h);
    if (fgThread != 0) AttachThreadInput(cur, fgThread, true);
    if (targetThread != 0 && targetThread != fgThread) AttachThreadInput(cur, targetThread, true);
    ShowWindow(h, 9);
    BringWindowToTop(h);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    bool ok = SetForegroundWindow(h);
    if (fgThread != 0) AttachThreadInput(cur, fgThread, false);
    if (targetThread != 0 && targetThread != fgThread) AttachThreadInput(cur, targetThread, false);
    return ok || GetForegroundWindow() == h;
  }
  public static void ClickClient(IntPtr h, int cx, int cy) {
    if (cx < 0 || cy < 0) return;
    POINT pt; pt.X = cx; pt.Y = cy;
    ClientToScreen(h, ref pt);
    SetCursorPos(pt.X, pt.Y);
    System.Threading.Thread.Sleep(30);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); // LEFTDOWN
    System.Threading.Thread.Sleep(20);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); // LEFTUP
    System.Threading.Thread.Sleep(40);
  }
  public static string Paste(long hwndVal, int pauseMs, bool enter, int fx, int fy, int ix, int iy) {
    IntPtr h = (IntPtr)hwndVal;
    if (!ForceFocus(h)) return "FAIL_FOCUS";
    System.Threading.Thread.Sleep(pauseMs);
    if (GetForegroundWindow() != h) {
      ForceFocus(h);
      System.Threading.Thread.Sleep(Math.Min(200, pauseMs));
      if (GetForegroundWindow() != h) return "FAIL_FOCUS";
    }
    if (fx >= 0 && fy >= 0) {
      ClickClient(h, fx, fy);
      System.Threading.Thread.Sleep(220);
    }
    if (ix >= 0 && iy >= 0) {
      ClickClient(h, ix, iy);
      System.Threading.Thread.Sleep(120);
    }
    KeyDown(0x11); KeyDown(0x56);
    System.Threading.Thread.Sleep(40);
    KeyUp(0x56); KeyUp(0x11);
    if (enter) {
      System.Threading.Thread.Sleep(100);
      KeyDown(0x0D); System.Threading.Thread.Sleep(30); KeyUp(0x0D);
    }
    System.Threading.Thread.Sleep(400);
    return "OK";
  }
}
"@
[WinPaste]::Paste(${Number(hwnd)}L, ${pause}, $${doEnter}, ${focusX}, ${focusY}, ${inputX}, ${inputY})
`;

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const status = (stdout || "").trim().split(/\r?\n/).pop();
    if (status === "OK") return { ok: true };
    if (status === "FAIL_FOCUS") {
      return { ok: false, error: t("err.activateFail") };
    }
    return { ok: false, error: status || t("err.pasteFail") };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function upsertTargetFromCdp({
  cdpTargetId,
  windowTitle,
  chatId,
  chatTitle,
  port,
  projectName,
}) {
  const settings = readSettings();
  const portN = Number(port) || settings.cdpPort || DEFAULT_CDP_PORT;
  const existing = (settings.targets || []).find(
    (t) =>
      t.driver === "cdp" &&
      String(t.cdpTargetId) === String(cdpTargetId) &&
      String(t.chatId) === String(chatId)
  );
  if (existing) {
    const targets = (settings.targets || []).map((t) =>
      t.id === existing.id
        ? {
            ...t,
            enabled: true,
            needsCdpRebind: false,
            needsUiaRebind: false,
            port: portN,
            cdpTargetId,
            chatId,
            chatTitle: chatTitle || t.chatTitle,
            projectName:
              projectName != null && projectName !== ""
                ? String(projectName)
                : t.projectName || "",
            fullTitle: windowTitle || t.fullTitle,
            match: windowTitle || t.match,
            name: t.name,
          }
        : t
    );
    writeSettings({ targets });
    return {
      ok: true,
      duplicate: true,
      target: targets.find((t) => t.id === existing.id),
    };
  }
  const project = String(projectName || "").trim();
  const baseTitle = (chatTitle || "").trim().slice(0, 40) || t("err.cursorChat");
  const base = project
    ? `${project.slice(0, 24)} · ${baseTitle}`.slice(0, 48)
    : baseTitle;
  const name = uniqueTargetName(base, settings.targets || []);
  const target = {
    id: `tgt-${Date.now()}`,
    name,
    driver: "cdp",
    enabled: true,
    needsCdpRebind: false,
    needsUiaRebind: false,
    port: portN,
    cdpTargetId: String(cdpTargetId || ""),
    chatId: String(chatId || ""),
    chatTitle: chatTitle || "",
    projectName: project,
    fullTitle: windowTitle || "Cursor",
    match: windowTitle || "Cursor",
    processName: "Cursor",
  };
  writeSettings({ targets: [...(settings.targets || []), target] });
  return { ok: true, duplicate: false, target };
}

function persistHealedCdpTarget(savedTargetId, healed) {
  const nextId = String(healed?.cdpTargetId || "").trim();
  const saved = String(savedTargetId || "").trim();
  if (!saved || !nextId) return;
  const settings = readSettings();
  let changed = false;
  const targets = (settings.targets || []).map((t) => {
    if (t.id !== saved || t.driver !== "cdp") return t;
    const chatId =
      healed.chatId != null && String(healed.chatId).trim()
        ? String(healed.chatId)
        : t.chatId;
    if (String(t.cdpTargetId) === nextId && String(t.chatId) === String(chatId)) {
      return t;
    }
    changed = true;
    return {
      ...t,
      cdpTargetId: nextId,
      chatId,
      needsCdpRebind: false,
    };
  });
  if (changed) writeSettings({ targets });
}

function cursorBackendOf(settings) {
  // Product UI uses CDP only until SDK is finished; keep code paths behind the flag.
  if (!isCursorSdkEnabled()) return "cdp";
  return settings?.cursorBackend === "sdk" ? "sdk" : "cdp";
}

function encodeSdkChatRef(projectId, chatId) {
  return `sdk|${encodeURIComponent(String(projectId || ""))}|${encodeURIComponent(
    String(chatId || "")
  )}`;
}

/** @deprecated Prefer encodeSdkChatRef; kept for one-part legacy ids. */
function encodeSdkProjectRef(projectId) {
  return `sdk|${encodeURIComponent(String(projectId || ""))}`;
}

/**
 * Parse phone/desktop SDK ref: sdk|projectId|chatId or legacy sdk|projectId.
 * @returns {{ projectId: string, chatId: string } | null}
 */
function parseSdkChatRef(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (s === SDK_LIVE_CHAT_ID || s === "sdk|default" || s === "sdk") {
    return { projectId: "", chatId: "" };
  }
  if (!s.startsWith("sdk|")) return null;
  const parts = s.split("|");
  const decode = (x) => {
    try {
      return decodeURIComponent(x || "");
    } catch {
      return String(x || "");
    }
  };
  if (parts.length >= 3) {
    return { projectId: decode(parts[1]), chatId: decode(parts[2]) };
  }
  if (parts.length === 2) {
    return { projectId: decode(parts[1]), chatId: "" };
  }
  return { projectId: "", chatId: "" };
}

function parseSdkProjectId(raw) {
  const ref = parseSdkChatRef(raw);
  return ref ? ref.projectId : null;
}

function findSdkProject(settings, projectId) {
  const projects = normalizeSdkProjects(settings?.sdkProjects);
  if (!projects.length) return null;
  const want = trySafeId(projectId) || String(projectId || "").trim();
  if (want) {
    const hit = projects.find((p) => p.id === want);
    if (hit) return hit;
  }
  const active = trySafeId(settings?.activeSdkProjectId) || "";
  return projects.find((p) => p.id === active) || projects[0] || null;
}

function findSdkChat(project, chatId) {
  const chats = Array.isArray(project?.chats) ? project.chats : [];
  if (!chats.length) return null;
  const want = trySafeId(chatId) || String(chatId || "").trim();
  if (want) {
    const hit = chats.find((c) => c.id === want);
    if (hit) return hit;
  }
  const active = trySafeId(project?.activeChatId) || "";
  return chats.find((c) => c.id === active) || chats[0] || null;
}

function sdkOptsFromSettings(settings, projectId, chatId) {
  const project = findSdkProject(settings, projectId);
  const chat = findSdkChat(project, chatId);
  return {
    apiKey: String(settings?.cursorApiKey || ""),
    cwd: String(project?.cwd || settings?.cursorSdkCwd || ""),
    agentId: String(
      chat?.agentId ||
        project?.agentId ||
        (!project ? settings?.cursorSdkAgentId : "") ||
        ""
    ),
    modelId: String(settings?.cursorSdkModel || DEFAULT_MODEL_ID) || DEFAULT_MODEL_ID,
    projectId: project?.id || "",
    chatId: chat?.id || "",
  };
}

function persistSdkAgentId(projectId, chatId, agentId) {
  const settings = readSettings();
  const id = String(agentId || "").trim();
  if (!id) return settings;
  const projects = normalizeSdkProjects(settings.sdkProjects).map((p) => {
    if (p.id !== projectId) return p;
    const chats = (p.chats || []).map((c) =>
      c.id === chatId || (!chatId && c.id === p.activeChatId)
        ? { ...c, agentId: id }
        : c
    );
    const activeChatId = chatId || p.activeChatId || chats[0]?.id || "";
    return {
      ...p,
      chats,
      activeChatId,
      agentId: chats.find((c) => c.id === activeChatId)?.agentId || id,
    };
  });
  const patch = { sdkProjects: projects, cursorSdkAgentId: id };
  if (projectId) {
    const p = projects.find((x) => x.id === projectId);
    if (p?.cwd) patch.cursorSdkCwd = p.cwd;
  }
  return writeSettings(patch);
}

function mapSdkError(codeOrMsg) {
  const s = String(codeOrMsg || "");
  if (s === "sdk_need_key") return t("err.sdkNeedKey");
  if (s === "sdk_need_cwd" || s === "sdk_bad_cwd") return t("err.sdkNeedCwd");
  if (s === "busy") return t("err.sdkBusy");
  return s || t("err.sdkSendFailed");
}

async function pasteViaSdk(text, projectId, chatId) {
  const settings = readSettings();
  const sdk = getCursorSdkClient();
  const opts = sdkOptsFromSettings(settings, projectId, chatId);
  const r = await sdk.send(text, opts);
  if (r.agentId && r.agentId !== opts.agentId) {
    persistSdkAgentId(opts.projectId, opts.chatId, r.agentId);
  }
  if (!r.ok) {
    return {
      ok: false,
      error: mapSdkError(r.error || r.hint),
      hint: r.hint || r.error,
    };
  }
  return {
    ok: true,
    agentId: r.agentId,
    projectId: opts.projectId,
    chatId: opts.chatId,
  };
}

async function pasteViaCdp(target, text, autoEnter, cdpPort) {
  const port = Number(target.port) || Number(cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  try {
    const r = await cdp.sendToChat(
      target.cdpTargetId,
      {
        id: target.chatId,
        title: target.chatTitle,
        project: target.projectName || "",
      },
      text,
      { submit: autoEnter === true }
    );
    if (target.id && r?.cdpTargetId) {
      persistHealedCdpTarget(target.id, { cdpTargetId: r.cdpTargetId });
    }
    return {
      ok: true,
      warning:
        r?.warning === "inserted_not_sent" ? t("err.insertedNotSent") : "",
      cdpTargetId: r?.cdpTargetId || target.cdpTargetId,
    };
  } catch (e) {
    const msg = String(e.message || e);
    if (/CDP порт|cdp_closed|fetch|ECONNREFUSED/i.test(msg)) {
      return {
        ok: false,
        error: t("err.cdpClosedSettings"),
        needsCdp: true,
      };
    }
    if (/chat_not_found/i.test(msg)) {
      return { ok: false, error: t("err.chatMissingReselect") };
    }
    if (/input_not_found/i.test(msg)) {
      return { ok: false, error: t("err.cursorInputMissing") };
    }
    if (/inserted_not_sent/i.test(msg)) {
      return { ok: false, error: t("err.insertedNotSent"), insertedNotSent: true };
    }
    return { ok: false, error: msg };
  }
}

/** Quiet ValuePattern write — no SetForegroundWindow. */
async function pasteQuietUia(target, text, autoEnter) {
  const uia = getUiaClient();
  try {
    const hwnd = target.hwnd;
    if (!hwnd || !target.inputLocator) {
      return { ok: false, error: t("err.noQuietLocator") };
    }
    const res = await uia.request(
      "setValue",
      {
        hwnd: String(hwnd),
        locator: target.inputLocator,
        value: String(text ?? ""),
      },
      8000
    );
    if (!res?.ok) {
      return {
        ok: false,
        error: uiaErr(res?.error, t("err.noBackgroundText")),
      };
    }
    if (autoEnter === true) {
      return {
        ok: true,
        warning: t("err.pastedNoEnter"),
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: t("err.appNoBackground"),
    };
  }
}

async function pasteCardById(cardId) {
  const settings = readSettings();
  const deck = loadDeck(settings.activeDeckId);
  const card = (deck.cards || []).find((c) => c.id === cardId);
  if (!card) return { ok: false, error: t("err.cardMissing") };

  const resolved = resolvePasteTargets(settings);
  const enabled = resolved.targets;
  const useSdk = cursorBackendOf(settings) === "sdk";
  if (!enabled.length && !useSdk) {
    let message = t("toast.noTargets");
    if (resolved.reason === "no_active_target") message = t("toast.pickSoloChat");
    else if (resolved.reason === "empty_preset") message = t("toast.emptyPreset");
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("toast", {
        type: "error",
        message,
      });
    }
    return { ok: false, error: "no targets" };
  }

  const preserveFocus = settings.preserveFocus !== false;
  const windows = preserveFocus ? [] : await listWindows();
  const results = [];
  const needsClipboard = !preserveFocus;
  const prevClip = needsClipboard ? clipboard.readText() : "";

  edgeHoverPaused = true;
  const deckWasVisible =
    deckWindow && !deckWindow.isDestroyed() && deckWindow.isVisible();

  // In no-focus mode keep deck visible (inactive) — do not steal game focus.
  if (!preserveFocus) {
    if (deckWasVisible) {
      setDeckVisible(false, { force: true, unpin: false, silent: true });
    } else if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.setAlwaysOnTop(false);
    }
  }

  const gapMs = Math.max(350, Number(settings.pauseMs) || 350);
  let legacyWarned = false;

  try {
    const useSdkLoop = cursorBackendOf(settings) === "sdk";
    if (useSdkLoop) {
      const project = findSdkProject(settings, settings.activeSdkProjectId);
      const chat = findSdkChat(project, project?.activeChatId);
      const r = await pasteViaSdk(
        card.prompt || "",
        project?.id || settings.activeSdkProjectId,
        chat?.id
      );
      const label = project
        ? `${project.name}${chat?.name ? ` · ${chat.name}` : ""}`
        : t("remote.sdkAgent");
      results.push({
        target: label,
        ...r,
      });
    }

    for (const target of enabled) {
      // SDK mode replaces CDP targets; still paste quiet/focus fields.
      if (useSdkLoop && target.driver === "cdp") continue;

      if (target.needsCdpRebind || (preserveFocus && target.driver !== "cdp" && target.driver !== "uia-quiet")) {
        if (target.needsCdpRebind || (isCursorLikeTarget(target) && target.driver !== "cdp")) {
          results.push({
            target: target.name,
            ok: false,
            error: t("err.rebindCdp"),
          });
          continue;
        }
      }

      if (target.driver === "cdp") {
        const r = await pasteViaCdp(
          target,
          card.prompt || "",
          settings.autoEnter === true,
          settings.cdpPort
        );
        results.push({ target: target.name, ...r });
        await new Promise((r) => setTimeout(r, gapMs));
        continue;
      }

      if (preserveFocus) {
        if (target.driver === "uia-quiet") {
          const r = await pasteQuietUia(
            target,
            card.prompt || "",
            settings.autoEnter === true
          );
          results.push({ target: target.name, ...r });
        } else {
          results.push({
            target: target.name,
            ok: false,
            error:
              t("err.noBackgroundDisableFocus"),
          });
        }
        await new Promise((r) => setTimeout(r, gapMs));
        continue;
      }

      // —— focus-allowed legacy paths ——
      if (target.needsUiaRebind) {
        results.push({
          target: target.name,
          ok: false,
          error: t("err.rebindCursorChat"),
        });
        continue;
      }

      const win = resolveTargetWindow(target, windows);
      if (!win) {
        results.push({
          target: target.name,
          ok: false,
          error: t("err.window_not_found"),
        });
        continue;
      }

      const display = windowDisplayTitle(win);

      if (target.driver === "uia") {
        if (String(target.hwnd) !== String(win.hwnd) || target.fullTitle !== display) {
          const next = (settings.targets || []).map((t) =>
            t.id === target.id
              ? {
                  ...t,
                  hwnd: win.hwnd,
                  fullTitle: display,
                  match: display,
                  processName: win.processName || t.processName,
                }
              : t
          );
          writeSettings({ targets: next });
          settings.targets = next;
          target.hwnd = win.hwnd;
        }

        const r = await focusAndPasteUia(
          { ...target, hwnd: win.hwnd },
          card.prompt || "",
          settings.autoEnter === true,
          settings.pauseMs
        );
        results.push({ target: target.name, ...r });
        await new Promise((r) => setTimeout(r, gapMs));
        continue;
      }

      let inputPoint = normalizePoint(target.inputPoint);
      const focusPoint = normalizePoint(target.focusPoint);

      if (focusPoint && inputPoint && pointsNear(focusPoint, inputPoint)) {
        results.push({
          target: target.name,
          ok: false,
          error: t("err.bindFailField"),
        });
        continue;
      }

      if (!inputPoint) {
        const size = await getWindowClientSize(win.hwnd);
        inputPoint = size
          ? {
              x: Math.round(size.width / 2),
              y: Math.round(size.height * 0.82),
            }
          : { x: 200, y: 400 };
        if (!legacyWarned && deckWindow && !deckWindow.isDestroyed()) {
          legacyWarned = true;
          deckWindow.webContents.send("toast", {
            type: "error",
            message: t("toast.rebindFieldAim"),
          });
        }
      }

      if (
        String(target.hwnd) !== String(win.hwnd) ||
        target.fullTitle !== display ||
        !normalizePoint(target.inputPoint)
      ) {
        const next = (settings.targets || []).map((t) =>
          t.id === target.id
            ? {
                ...t,
                hwnd: win.hwnd,
                fullTitle: display,
                match: display,
                processName: win.processName || t.processName,
                inputPoint: inputPoint,
                focusPoint: focusPoint,
                driver: t.driver || "win32-field",
              }
            : t
        );
        writeSettings({ targets: next });
        settings.targets = next;
      }

      const r = await focusAndPaste(
        win.hwnd,
        card.prompt || "",
        settings.autoEnter === true,
        settings.pauseMs,
        { focusPoint, inputPoint }
      );
      results.push({ target: target.name, ...r });

      await new Promise((r) => setTimeout(r, gapMs));
    }
  } finally {
    if (needsClipboard) {
      const clipToRestore = prevClip;
      setTimeout(() => {
        try {
          clipboard.writeText(clipToRestore);
        } catch {
          /* ignore */
        }
      }, 700);
      if (deckWindow && !deckWindow.isDestroyed()) {
        deckWindow.setAlwaysOnTop(true, "screen-saver");
        if (deckWasVisible) {
          setDeckVisible(true, { force: true, inactive: true });
        }
      }
    }
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("paste-done", { cardId, results });
    }
    edgeHoverPaused = false;
  }

  return { ok: results.some((r) => r.ok), results };
}

/** Ephemeral phone-remote chat id: live|{cdpTargetId}|{chatId}|{chatTitle}|{project?} */
function encodeLiveChatRef({ cdpTargetId, chatId, chatTitle, project }) {
  const parts = [
    "live",
    encodeURIComponent(String(cdpTargetId || "")),
    encodeURIComponent(String(chatId || "")),
    encodeURIComponent(String(chatTitle || "")),
  ];
  if (project) parts.push(encodeURIComponent(String(project)));
  return parts.join("|");
}

/**
 * Resolve phone remote chat id: live CDP ref, SDK synthetic, or legacy saved settings target.
 * @returns {{ kind:'live'|'saved'|'sdk', cdpTargetId:string, chatId:string, chatTitle:string, projectName?:string, name:string, port:number, needsCdpRebind?:boolean } | null}
 */
function resolveRemoteChatRef(id) {
  const raw = String(id || "").trim();
  if (!raw) return null;
  const settings = readSettings();
  const port = Number(settings.cdpPort) || DEFAULT_CDP_PORT;

  if (raw === SDK_LIVE_CHAT_ID || raw.startsWith("sdk|")) {
    const parsed = parseSdkChatRef(raw) || { projectId: "", chatId: "" };
    const project = findSdkProject(settings, parsed.projectId);
    const chat = findSdkChat(project, parsed.chatId);
    const name = project
      ? `${project.name}${chat?.name ? ` · ${chat.name}` : ""}`
      : t("remote.sdkAgent");
    return {
      kind: "sdk",
      projectId: project?.id || "",
      sdkChatId: chat?.id || "",
      cdpTargetId: "",
      chatId: chat?.id || project?.id || "default",
      chatTitle: name,
      name,
      port: 0,
    };
  }

  if (raw.startsWith("live|")) {
    const parts = raw.split("|");
    if (parts.length < 3) return null;
    const cdpTargetId = decodeURIComponent(parts[1] || "");
    const chatId = decodeURIComponent(parts[2] || "");
    const chatTitle = decodeURIComponent(parts[3] || "");
    const projectName = decodeURIComponent(parts[4] || "");
    if (!cdpTargetId || !chatId) return null;
    const name = projectName
      ? `${projectName} · ${chatTitle || chatId}`
      : chatTitle || chatId;
    return {
      kind: "live",
      cdpTargetId,
      chatId,
      chatTitle,
      projectName,
      name,
      port,
    };
  }

  const target = (settings.targets || []).find(
    (x) => x.id === raw && x.driver === "cdp"
  );
  if (!target) return null;
  return {
    kind: "saved",
    cdpTargetId: String(target.cdpTargetId || ""),
    chatId: String(target.chatId || ""),
    chatTitle: String(target.chatTitle || ""),
    projectName: String(target.projectName || ""),
    name: target.name || target.chatTitle || target.id,
    port: Number(target.port) || port,
    needsCdpRebind: !!target.needsCdpRebind,
  };
}

/** Live open Cursor chats from CDP (not limited to saved Keycode targets), or synthetic SDK chat. */
async function listRemoteLiveChats() {
  const settings = readSettings();
  if (cursorBackendOf(settings) === "sdk") {
    const projects = normalizeSdkProjects(settings.sdkProjects);
    if (!projects.length) {
      return {
        ok: false,
        error: "sdk_need_cwd",
        hint: "sdk_need_cwd",
        chats: [],
        port: 0,
        backend: "sdk",
      };
    }
    const chats = [];
    for (const p of projects) {
      const list = Array.isArray(p.chats) && p.chats.length
        ? p.chats
        : [{ id: "main", name: "Chat", agentId: p.agentId || "" }];
      for (const c of list) {
        chats.push({
          id: encodeSdkChatRef(p.id, c.id),
          name: `${p.name || path.basename(p.cwd) || t("remote.sdkAgent")} · ${
            c.name || "Chat"
          }`,
          cdpTargetId: "",
          chatId: c.id,
          chatTitle: c.name || "Chat",
          windowTitle: p.cwd,
          backend: "sdk",
          projectId: p.id,
          sdkChatId: c.id,
        });
      }
    }
    return {
      ok: true,
      chats,
      port: 0,
      backend: "sdk",
    };
  }

  const port = Number(settings.cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  let probe;
  try {
    probe = await cdp.probe();
  } catch (e) {
    return {
      ok: false,
      error: String(e.message || e),
      hint: "cdp_closed",
      chats: [],
      port,
    };
  }
  if (!probe?.open) {
    return { ok: false, error: "cdp_closed", hint: "cdp_closed", chats: [], port };
  }

  const chats = [];
  const seen = new Set();
  for (const win of (probe.targets || []).slice(0, 8)) {
    let list;
    try {
      list = await cdp.listChats(win.id);
    } catch {
      continue;
    }
    if (!list?.ok) continue;
    for (const c of list.chats || []) {
      const chatId = String(c.id || "");
      const chatTitle = String(c.title || "");
      const project = String(c.project || "");
      if (!chatId && !chatTitle) continue;
      const id = encodeLiveChatRef({
        cdpTargetId: win.id,
        chatId: chatId || chatTitle,
        chatTitle,
        project,
      });
      if (seen.has(id)) continue;
      seen.add(id);
      chats.push({
        id,
        name: project ? `${project} · ${chatTitle || chatId}` : chatTitle || chatId,
        cdpTargetId: win.id,
        chatId: chatId || chatTitle,
        chatTitle,
        projectName: project,
        windowTitle: String(win.title || ""),
      });
      if (chats.length >= 200) break;
    }
    if (chats.length >= 200) break;
  }
  return { ok: true, chats, port };
}

/** Phone remote: paste text into a single Cursor chat (live or saved) or SDK agent. Never logs text. */
async function pasteTextToTarget(text, targetId, notify = { kind: "text", cardId: null }) {
  const settings = readSettings();
  const kind = notify.kind || "text";
  // Phone remote (free text + cards) always submits. Desktop strip follows Settings → Enter.
  const submit =
    kind === "text" || kind === "card" || notify.submit === true
      ? true
      : settings.autoEnter === true;

  if (cursorBackendOf(settings) === "sdk") {
    const ref = resolveRemoteChatRef(targetId) || {
      projectId: settings.activeSdkProjectId || "",
      sdkChatId: "",
      name: t("remote.sdkAgent"),
    };
    const r = await pasteViaSdk(
      String(text || ""),
      ref.projectId,
      ref.sdkChatId || ref.chatId
    );
    const results = [{ target: ref.name || t("remote.sdkAgent"), ...r }];
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("paste-done", {
        cardId: notify.cardId ?? null,
        kind,
        results,
      });
    }
    return { ok: !!r.ok, results };
  }

  const ref = resolveRemoteChatRef(targetId);
  if (!ref) {
    return { ok: false, error: t("remote.errUnknownTarget"), hint: "unknown_target" };
  }
  if (ref.kind === "sdk") {
    const r = await pasteViaSdk(
      String(text || ""),
      ref.projectId,
      ref.sdkChatId || ref.chatId
    );
    const results = [{ target: ref.name, ...r }];
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("paste-done", {
        cardId: notify.cardId ?? null,
        kind,
        results,
      });
    }
    return { ok: !!r.ok, results };
  }
  if (ref.needsCdpRebind) {
    return { ok: false, error: t("err.rebindCdp") };
  }

  const r = await pasteViaCdp(
    {
      id: ref.kind === "saved" ? targetId : "",
      cdpTargetId: ref.cdpTargetId,
      chatId: ref.chatId,
      chatTitle: ref.chatTitle,
      projectName: ref.projectName || "",
      port: ref.port,
      name: ref.name,
    },
    String(text || ""),
    submit,
    settings.cdpPort
  );
  const results = [{ target: ref.name, ...r }];
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.webContents.send("paste-done", {
      cardId: notify.cardId ?? null,
      kind,
      results,
    });
  }
  return { ok: !!r.ok, results };
}

/** Phone remote: paste one card into a single Cursor chat (live or saved). */
async function pasteCardToTarget(cardId, targetId) {
  const settings = readSettings();
  const deck = loadDeck(settings.activeDeckId);
  const card = (deck.cards || []).find((c) => c.id === cardId);
  if (!card) return { ok: false, error: t("err.cardMissing") };
  return pasteTextToTarget(card.prompt || "", targetId, {
    kind: "card",
    cardId,
  });
}

function getRemoteStatePayload() {
  const settings = readSettings();
  const deck = loadDeck(settings.activeDeckId);
  const decks = listDecks().map((d) => ({
    id: d.id,
    name: d.name || d.id,
  }));
  const cards = (deck.cards || []).map((c) => ({
    id: c.id,
    title: c.title || "",
    description: c.description || "",
    image: c.image || "",
    hotkey: c.hotkey || "",
    // Full prompt intentionally omitted until paste (server uses local deck).
  }));
  return {
    deck: { id: deck.id, name: deck.name || deck.id },
    decks,
    cards,
    // Chat list comes from GET /api/chats (live CDP or SDK); kept empty for backward compat.
    targets: [],
    autoEnter: settings.autoEnter === true,
    uiLocale: i18n.getActiveUiLocale() || "en",
    cursorBackend: cursorBackendOf(settings),
    /** Future: KEYCODE_ENABLE_SDK=1 re-shows API backend in Settings */
    sdkBackendEnabled: isCursorSdkEnabled(),
    // Rule-based highlights ride on chat payloads; deck state keeps [].
    suggestions: [],
  };
}

/** Activate a deck by id, or cycle with step ±1. Used by IPC + phone remote. */
function activateDeck({ deckId, step } = {}) {
  const decks = listDecks();
  if (!decks.length) return { ok: false, error: "no_decks" };

  let nextId = null;
  if (deckId != null && String(deckId).trim()) {
    const safe = trySafeId(String(deckId).trim());
    if (!safe || !decks.some((d) => d.id === safe)) {
      return { ok: false, error: "unknown_deck" };
    }
    nextId = safe;
  } else if (step === 1 || step === -1) {
    const settings = readSettings();
    let idx = decks.findIndex((d) => d.id === settings.activeDeckId);
    if (idx < 0) idx = 0;
    nextId = decks[(idx + step + decks.length) % decks.length].id;
  } else {
    return { ok: false, error: "deck_id_or_step_required" };
  }

  writeSettings({ activeDeckId: nextId });
  registerShortcuts();
  const deck = loadDeck(nextId);
  broadcastStateChanged();
  return { ok: true, deck: { id: deck.id, name: deck.name || deck.id } };
}

function notifyRemoteDeckChanged() {
  if (!remoteServer || typeof remoteServer.notifyDeck !== "function") return;
  try {
    remoteServer.notifyDeck({ ok: true, ...getRemoteStatePayload() });
  } catch (e) {
    log.warn("remote deck notify failed", { err: String(e.message || e) });
  }
}

async function readRemoteChat(targetId, { select = true } = {}) {
  const settings = readSettings();
  if (cursorBackendOf(settings) === "sdk") {
    const ref = resolveRemoteChatRef(targetId);
    const sdk = getCursorSdkClient();
    const opts = sdkOptsFromSettings(
      settings,
      ref?.projectId,
      ref?.sdkChatId || ref?.chatId
    );
    await sdk.listModels(opts).catch(() => {});
    return sdk.readTranscript(opts);
  }
  const ref = resolveRemoteChatRef(targetId);
  if (!ref) {
    return { ok: false, error: "unknown_target", hint: "unknown_target" };
  }
  if (ref.kind === "sdk") {
    const sdk = getCursorSdkClient();
    const opts = sdkOptsFromSettings(
      settings,
      ref.projectId,
      ref.sdkChatId || ref.chatId
    );
    await sdk.listModels(opts).catch(() => {});
    return sdk.readTranscript(opts);
  }
  if (ref.needsCdpRebind) {
    return { ok: false, error: t("err.rebindCdp"), hint: "rebind" };
  }
  const port = Number(ref.port) || Number(settings.cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  const result = await cdp.readTranscript(
    ref.cdpTargetId,
    {
      id: ref.chatId,
      title: ref.chatTitle,
      project: ref.projectName || "",
    },
    { select: select !== false }
  );
  if (ref.kind === "saved" && result?.cdpTargetId) {
    persistHealedCdpTarget(targetId, { cdpTargetId: result.cdpTargetId });
  }
  return result;
}

/** Attach rule-based next-card suggestions for the active deck. */
function attachChatSuggestions(result) {
  if (!result?.ok) return result;
  try {
    const settings = readSettings();
    const deck = loadDeck(settings.activeDeckId);
    const catalog = {};
    for (const id of i18n.STOCK_DECK_IDS) {
      try {
        const file = deckFilePath(decksDir(), id);
        if (!fs.existsSync(file)) continue;
        const loaded = loadDeck(id);
        if (loaded?.id === id) catalog[id] = loaded;
      } catch {
        /* skip missing stock deck */
      }
    }
    const suggestions = suggestNextCards({
      messages: result.messages || [],
      cards: deck.cards || [],
      deckId: deck.id,
      catalog,
    }).map((s) => {
      const target = s.deckId && catalog[s.deckId] ? catalog[s.deckId] : deck;
      const card = (target.cards || []).find((c) => c.id === s.cardId);
      return {
        ...s,
        deckName: target.name || s.deckId || deck.name,
        cardTitle: (card && card.title) || s.cardId,
      };
    });
    return { ...result, suggestions };
  } catch (e) {
    log.warn("attachChatSuggestions", String(e.message || e));
    return { ...result, suggestions: [] };
  }
}

async function readRemoteChatWithSuggestions(targetId, opts) {
  const result = await readRemoteChat(targetId, opts);
  return attachChatSuggestions(result);
}

async function setRemoteComposerMode(targetId, mode) {
  const settings = readSettings();
  const want = String(mode || "").toLowerCase() === "plan" ? "plan" : "agent";
  if (cursorBackendOf(settings) === "sdk") {
    const sdk = getCursorSdkClient();
    return { ok: true, mode: want, ...sdk.setMode(want) };
  }
  const ref = resolveRemoteChatRef(targetId);
  if (!ref) return { ok: false, error: "unknown_target", hint: "unknown_target" };
  if (ref.kind === "sdk") {
    const sdk = getCursorSdkClient();
    return { ok: true, mode: want, ...sdk.setMode(want) };
  }
  const port = Number(ref.port) || Number(settings.cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  const chat = {
    id: ref.chatId,
    title: ref.chatTitle,
    project: ref.projectName || "",
  };
  const selected = await cdp.selectChat(ref.cdpTargetId, chat);
  const id = selected?.cdpTargetId || ref.cdpTargetId;
  if (ref.kind === "saved" && id) {
    persistHealedCdpTarget(targetId, { cdpTargetId: id });
  }
  return cdp.setComposerMode(id, want);
}

async function setRemoteComposerModel(targetId, model) {
  const settings = readSettings();
  const want = String(model || "").trim();
  if (!want) return { ok: false, error: "model_required", hint: "model_required" };
  if (cursorBackendOf(settings) === "sdk") {
    const sdk = getCursorSdkClient();
    const r = sdk.setModel(want);
    if (r.ok) writeSettings({ cursorSdkModel: want });
    return r;
  }
  const ref = resolveRemoteChatRef(targetId);
  if (!ref) return { ok: false, error: "unknown_target", hint: "unknown_target" };
  if (ref.kind === "sdk") {
    const sdk = getCursorSdkClient();
    const r = sdk.setModel(want);
    if (r.ok) writeSettings({ cursorSdkModel: want });
    return r;
  }
  const port = Number(ref.port) || Number(settings.cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  const chat = {
    id: ref.chatId,
    title: ref.chatTitle,
    project: ref.projectName || "",
  };
  const selected = await cdp.selectChat(ref.cdpTargetId, chat);
  const id = selected?.cdpTargetId || ref.cdpTargetId;
  if (ref.kind === "saved" && id) {
    persistHealedCdpTarget(targetId, { cdpTargetId: id });
  }
  return cdp.setComposerModel(id, want);
}

async function answerRemoteClarification(targetId, payload = {}) {
  const settings = readSettings();
  if (cursorBackendOf(settings) === "sdk") {
    // SDK has no DOM widgets — treat as free-text send.
    const text =
      String(payload.text || "").trim() ||
      String(payload.optionId || "").trim();
    if (!text) {
      return { ok: false, error: "text_required", hint: "sdk_no_clarifications" };
    }
    return pasteTextToTarget(text, targetId, { kind: "text", cardId: null });
  }
  const ref = resolveRemoteChatRef(targetId);
  if (!ref) return { ok: false, error: "unknown_target", hint: "unknown_target" };
  if (ref.kind === "sdk") {
    const text =
      String(payload.text || "").trim() ||
      String(payload.optionId || "").trim();
    if (!text) {
      return { ok: false, error: "text_required", hint: "sdk_no_clarifications" };
    }
    return pasteTextToTarget(text, targetId, { kind: "text", cardId: null });
  }
  const port = Number(ref.port) || Number(settings.cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  const chat = {
    id: ref.chatId,
    title: ref.chatTitle,
    project: ref.projectName || "",
  };
  const selected = await cdp.selectChat(ref.cdpTargetId, chat);
  const id = selected?.cdpTargetId || ref.cdpTargetId;
  if (ref.kind === "saved" && id) {
    persistHealedCdpTarget(targetId, { cdpTargetId: id });
  }
  return cdp.answerClarification(id, payload);
}

function ensureRemoteToken(settings, { persist = true } = {}) {
  if (settings.remoteToken && String(settings.remoteToken).length >= 16) {
    return settings;
  }
  if (!persist) return settings;
  const token = generateRemoteToken();
  return writeSettings({ remoteToken: token });
}

async function probeTailscaleServe(port) {
  const p = Number(port) || DEFAULT_REMOTE_PORT;
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 5000,
      windowsHide: true,
    });
    let status;
    try {
      status = JSON.parse(stdout || "{}");
    } catch {
      status = {};
    }
    const self = status.Self || status.self || {};
    const dns =
      self.DNSName ||
      self.dnsName ||
      (Array.isArray(self.DNSName) ? self.DNSName[0] : "") ||
      "";
    const host = String(dns || "").replace(/\.$/, "");
    let serveUrl = "";
    try {
      const { stdout: serveOut } = await execFileAsync(
        "tailscale",
        ["serve", "status", "--json"],
        { timeout: 4000, windowsHide: true }
      );
      const serve = JSON.parse(serveOut || "{}");
      // Look for proxy to our localhost port
      const web = serve.Web || serve.web || {};
      for (const [key, val] of Object.entries(web)) {
        const handlers = val?.Handlers || val?.handlers || val || {};
        const entries = typeof handlers === "object" ? Object.values(handlers) : [];
        for (const h of entries) {
          const proxy = String(h?.Proxy || h?.proxy || "");
          if (proxy.includes(`:${p}`) || proxy.includes(`127.0.0.1:${p}`)) {
            serveUrl = key.startsWith("https://") ? key : `https://${host}`;
            break;
          }
        }
        if (serveUrl) break;
      }
      if (!serveUrl && host) {
        // No matching handler yet — still show expected URL after serve setup
        serveUrl = "";
      }
    } catch {
      /* serve status optional */
    }
    const command = `tailscale serve --bg ${p}`;
    return {
      ok: true,
      installed: true,
      online: self.Online !== false && self.online !== false,
      dnsName: host,
      serveUrl: serveUrl || (host ? `https://${host}` : ""),
      command,
      port: p,
    };
  } catch (e) {
    const msg = String(e.message || e);
    const missing = /not recognized|ENOENT|cannot find/i.test(msg);
    return {
      ok: false,
      installed: !missing,
      online: false,
      dnsName: "",
      serveUrl: "",
      command: `tailscale serve --bg ${p}`,
      port: p,
      error: missing ? "tailscale_missing" : msg,
    };
  }
}

const REMOTE_UI_ASSET_VERSION = "20260723f";

function buildRemotePublicUrl(serveUrl, token) {
  const base = String(serveUrl || "").replace(/\/$/, "");
  if (!base || !token) return "";
  // Query busts stale phone caches of remote.js/css (fragment token stays after ?v=).
  return `${base}/?v=${REMOTE_UI_ASSET_VERSION}#token=${encodeURIComponent(token)}`;
}

/** Pick a private IPv4 address for same-Wi-Fi QR (skip loopback / link-local). */
function detectLanIPv4() {
  const nets = os.networkInterfaces() || {};
  const scored = [];
  for (const [ifName, list] of Object.entries(nets)) {
    for (const n of list || []) {
      if (!n || n.internal) continue;
      const fam = n.family;
      if (fam !== "IPv4" && fam !== 4) continue;
      const ip = String(n.address || "");
      if (!ip || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
      let score = 0;
      if (ip.startsWith("192.168.")) score = 30;
      else if (ip.startsWith("10.")) score = 20;
      else {
        const m = /^172\.(\d+)\./.exec(ip);
        const oct = m ? Number(m[1]) : 0;
        if (oct >= 16 && oct <= 31) score = 10;
        else continue;
      }
      // Prefer real Wi-Fi over Hyper-V / VPN / hotspot adapters
      if (/wi-?fi|wlan|wireless/i.test(ifName)) score += 50;
      else if (/vethernet|hyper-v|wsl|radmin|vpn|virtual|loopback/i.test(ifName)) {
        score -= 40;
      }
      scored.push({ ip, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.ip || "";
}

function remoteAccessModeOf(settings) {
  return String(settings?.remoteAccessMode || "lan").toLowerCase() === "tailscale"
    ? "tailscale"
    : "lan";
}

async function syncRemoteServer() {
  const settings = readSettings();
  const enabled = settings.remoteEnabled === true;
  const port = Math.min(
    65535,
    Math.max(1024, Number(settings.remotePort) || DEFAULT_REMOTE_PORT)
  );
  const mode = remoteAccessModeOf(settings);

  if (!enabled) {
    if (remoteServer) {
      await remoteServer.stop();
    }
    return { ok: true, running: false, port, accessMode: mode };
  }

  const withToken = ensureRemoteToken(settings);
  if (!remoteServer) {
    remoteServer = createRemoteServer({
      getToken: () => readSettings().remoteToken || "",
      getPort: () => {
        const s = readSettings();
        return Number(s.remotePort) || DEFAULT_REMOTE_PORT;
      },
      getAccessMode: () => remoteAccessModeOf(readSettings()),
      getRemoteState: getRemoteStatePayload,
      setActiveDeck: (opts) => activateDeck(opts || {}),
      listChats: listRemoteLiveChats,
      readChat: readRemoteChatWithSuggestions,
      setComposerMode: (targetId, mode) =>
        pasteQueue.enqueue(() => setRemoteComposerMode(targetId, mode)),
      setComposerModel: (targetId, model) =>
        pasteQueue.enqueue(() => setRemoteComposerModel(targetId, model)),
      answerClarification: (targetId, payload) =>
        pasteQueue.enqueue(() => answerRemoteClarification(targetId, payload)),
      pasteCard: (cardId, targetId) =>
        pasteQueue.enqueue(() => pasteCardToTarget(cardId, targetId)),
      pasteText: (text, targetId) =>
        pasteQueue.enqueue(() => pasteTextToTarget(text, targetId)),
      staticDir: path.join(appRoot(), "src", "remote"),
      tarotDir: path.join(appRoot(), "assets", "tarot"),
      log: (level, msg, meta) => {
        if (level === "WARN") log.warn(msg, meta);
        else log.info(msg, meta);
      },
      allowLoopbackWithoutTailscale: process.env.KEYCODE_REMOTE_DEV === "1",
    });
  }

  const st = remoteServer.status();
  const wantHost = mode === "tailscale" ? "127.0.0.1" : "0.0.0.0";
  if (st.running && (st.port !== port || st.host !== wantHost || st.accessMode !== mode)) {
    await remoteServer.stop();
  }
  if (!remoteServer.status().running) {
    try {
      await remoteServer.start(port);
    } catch (e) {
      log.warn("remote start failed", { err: String(e.message || e) });
      return {
        ok: false,
        running: false,
        port,
        accessMode: mode,
        error: String(e.message || e),
        token: withToken.remoteToken || "",
      };
    }
  }
  const running = remoteServer.status();
  return {
    ok: true,
    running: true,
    host: running.host || wantHost,
    port: running.port || port,
    accessMode: mode,
    token: withToken.remoteToken || "",
  };
}

async function getRemoteStatusPayload() {
  let settings = readSettings();
  // Only mint a token when remote is (or was) enabled — avoid writing on every status poll
  if (settings.remoteEnabled === true) {
    settings = ensureRemoteToken(settings);
  }
  const port = Math.min(
    65535,
    Math.max(1024, Number(settings.remotePort) || DEFAULT_REMOTE_PORT)
  );
  const mode = remoteAccessModeOf(settings);
  const lanIp = detectLanIPv4();
  const server = remoteServer?.status?.() || {
    running: false,
    port,
    host: mode === "tailscale" ? "127.0.0.1" : "0.0.0.0",
  };
  const ts = await probeTailscaleServe(port);
  const lanUrl = lanIp
    ? buildRemotePublicUrl(`http://${lanIp}:${port}`, settings.remoteToken)
    : "";
  const tailscaleUrl = buildRemotePublicUrl(
    ts.serveUrl || (ts.dnsName ? `https://${ts.dnsName}` : ""),
    settings.remoteToken
  );
  // Primary phone URL: LAN for now; Tailscale URL kept for later
  const publicUrl = mode === "tailscale" ? tailscaleUrl : lanUrl;
  const localUrlWithToken = settings.remoteToken
    ? `http://127.0.0.1:${port}/#token=${encodeURIComponent(settings.remoteToken)}`
    : `http://127.0.0.1:${port}/`;
  return {
    ok: true,
    enabled: settings.remoteEnabled === true,
    running: !!server.running,
    accessMode: mode,
    host: server.host || (mode === "tailscale" ? "127.0.0.1" : "0.0.0.0"),
    port,
    lanIp,
    token: settings.remoteToken || "",
    localUrl: `http://127.0.0.1:${port}/`,
    localUrlWithToken,
    lanUrl,
    publicUrl,
    serveCommand: ts.command || `tailscale serve --bg ${port}`,
    tailscale: { ...ts, url: tailscaleUrl, later: true },
    firewallHint: t("settingsMsg.remoteFirewallHint"),
    cursorBackend: cursorBackendOf(settings),
    suggestionsSupported: true,
  };
}

/** Self-check from main (does not go through HTTP auth). */
async function diagnoseRemote() {
  const status = await getRemoteStatusPayload();
  const steps = [];
  const push = (ok, code, detail) => {
    steps.push({ ok, code, detail: detail || "" });
  };

  if (!status.enabled) {
    push(false, "remote_off", t("settingsMsg.remoteDiagOff"));
    return { ok: false, status, steps, next: t("settingsMsg.remoteDiagNextEnable") };
  }
  push(true, "remote_on", t("settingsMsg.remoteRunning", { port: status.port }));

  if (!status.running) {
    push(false, "not_listening", t("settingsMsg.remoteStopped"));
    return { ok: false, status, steps, next: t("settingsMsg.remoteDiagNextPort") };
  }
  push(true, "listening", `${status.host}:${status.port}`);

  if (!status.token || status.token.length < 16) {
    push(false, "no_token", t("settingsMsg.remoteDiagNoToken"));
    return { ok: false, status, steps, next: t("settingsMsg.remoteDiagNextRotate") };
  }
  push(true, "token", t("settingsMsg.remoteDiagTokenOk"));

  if (status.accessMode === "lan") {
    if (!status.lanIp) {
      push(false, "no_lan_ip", t("settingsMsg.remoteDiagNoLanIp"));
      return {
        ok: false,
        status,
        steps,
        next: t("settingsMsg.remoteDiagNextLan"),
      };
    }
    push(true, "lan_ip", status.lanIp);
    if (!status.publicUrl) {
      push(false, "no_url", t("settingsMsg.remoteDiagNoLanUrl"));
      return {
        ok: false,
        status,
        steps,
        next: t("settingsMsg.remoteDiagNextLan"),
      };
    }
    push(true, "url", status.publicUrl.replace(/#token=.*/, "#token=…"));
    push(true, "firewall", t("settingsMsg.remoteFirewallHint"));
  } else {
    // Tailscale mode (later)
    if (!status.tailscale?.installed) {
      push(false, "tailscale", t("settingsMsg.remoteNoTailscale"));
      return {
        ok: false,
        status,
        steps,
        next: t("settingsMsg.remoteDiagNextTailscale"),
      };
    }
    if (!status.tailscale?.online) {
      push(false, "tailscale_offline", t("settingsMsg.remoteTailscaleOffline"));
      return {
        ok: false,
        status,
        steps,
        next: t("settingsMsg.remoteDiagNextTailscaleLogin"),
      };
    }
    push(true, "tailscale", status.tailscale.dnsName || "online");
    if (!status.publicUrl) {
      push(false, "serve", t("settingsMsg.remoteDiagNoServe"));
      return {
        ok: false,
        status,
        steps,
        next: t("settingsMsg.remoteDiagNextServe", { cmd: status.serveCommand }),
      };
    }
    push(true, "url", status.publicUrl.replace(/#token=.*/, "#token=…"));
  }

  let state;
  try {
    state = getRemoteStatePayload();
  } catch (e) {
    push(false, "state", String(e.message || e));
    return { ok: false, status, steps, next: t("settingsMsg.remoteDiagNextRestart") };
  }

  let live;
  try {
    live = await listRemoteLiveChats();
  } catch (e) {
    live = { ok: false, chats: [], error: String(e.message || e), hint: "cdp_closed" };
  }

  push(
    true,
    "state",
    t("settingsMsg.remoteDiagState", {
      cards: (state.cards || []).length,
      targets: (live.chats || []).length,
    })
  );

  if (!live.ok) {
    push(false, "no_targets", t("settingsMsg.remoteDiagNoTargets"));
    return {
      ok: false,
      status,
      steps,
      next: t("settingsMsg.remoteDiagNextCdp"),
    };
  }
  if (!(live.chats || []).length) {
    push(false, "no_targets", t("settingsMsg.remoteDiagNoTargets"));
  } else {
    push(true, "targets", t("settingsMsg.remoteDiagTargets", { n: live.chats.length }));
  }

  // Optional: probe CDP for first live chat
  const first = (live.chats || [])[0];
  if (first?.id) {
    try {
      const chat = await readRemoteChat(first.id, { select: true });
      if (chat?.ok) {
        push(
          true,
          "cdp_chat",
          t("settingsMsg.remoteDiagChatOk", { n: (chat.messages || []).length })
        );
      } else {
        push(false, "cdp_chat", chat?.error || chat?.hint || "cdp");
      }
    } catch (e) {
      push(false, "cdp_chat", String(e.message || e));
    }
  }

  const allOk = steps.every((s) => s.ok);
  return {
    ok: allOk,
    status,
    steps,
    next: allOk
      ? t("settingsMsg.remoteDiagReady")
      : t("settingsMsg.remoteDiagFixSteps"),
  };
}

function closePickWindow() {
  if (pickWindow && !pickWindow.isDestroyed()) {
    pickWindow.close();
  }
  pickWindow = null;
}

function startTargetPick(mode = "field") {
  return new Promise((resolve) => {
    closePickWindow();
    edgeHoverPaused = true;
    if (deckWindow && deckWindow.isVisible()) {
      setDeckVisible(false, { force: true, unpin: false });
    }
    if (targetsWindow && !targetsWindow.isDestroyed()) {
      targetsWindow.hide();
    }

    const display = screen.getPrimaryDisplay();
    const { x, y, width, height } = display.bounds;

    pickWindow = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      hasShadow: false,
      fullscreen: false,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    pickWindow.setAlwaysOnTop(true, "screen-saver");
    pickWindow.setIgnoreMouseEvents(false);
    pickWindow.loadFile(path.join(appRoot(), "src", "pick.html"));

    // field | cursor (UIA). Legacy "agent" maps to cursor.
    const pickMode =
      mode === "cursor" || mode === "agent" || mode === "uia"
        ? "cursor"
        : "field";
    /** @type {'chat' | 'input'} */
    let phase = pickMode === "cursor" ? "chat" : "input";
    /** @type {null | { hwnd: string, windowName: string, processName: string, chatLocator: any, chatName: string }} */
    let draft = null;

    let settled = false;
    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      try {
        ipcMain.removeHandler("pick-click");
        ipcMain.removeHandler("pick-cancel");
      } catch {
        /* ignore */
      }
      closePickWindow();
      if (targetsWindow && !targetsWindow.isDestroyed()) {
        targetsWindow.show();
      }
      edgeHoverPaused = false;
      broadcastTargetsUpdated();
      resolve(payload);
    };

    const showPickOverlay = (hint) => {
      if (!pickWindow || pickWindow.isDestroyed()) return;
      pickWindow.show();
      pickWindow.focus();
      pickWindow.webContents.send("pick-hint", {
        text: hint,
        phase: phase === "chat" ? "focus" : "input",
      });
    };

    try {
      ipcMain.removeHandler("pick-click");
      ipcMain.removeHandler("pick-cancel");
    } catch {
      /* ignore */
    }

    pickWindow.webContents.once("did-finish-load", () => {
      showPickOverlay(
        pickMode === "cursor"
          ? t("pick.hintStep1")
          : t("pick.hintFieldEsc")
      );
    });

    ipcMain.handle("pick-click", async (_e, { screenX, screenY }) => {
      if (pickWindow && !pickWindow.isDestroyed()) {
        pickWindow.hide();
      }
      // Дать оверлею исчезнуть, затем читать реальный курсор (физические px).
      await new Promise((r) => setTimeout(r, 120));
      const nativePos = await getPhysicalCursorPos();
      const electronCursor = screen.getCursorScreenPoint();
      const pickPoints = uniquePoints([
        nativePos,
        toPhysicalScreenPoint(screenX, screenY),
        toPhysicalScreenPoint(electronCursor.x, electronCursor.y),
        { x: screenX, y: screenY },
        electronCursor,
      ]);

      if (pickMode === "field") {
        const preserve = readSettings().preserveFocus !== false;
        if (preserve) {
          const uia = getUiaClient();
          let hit = null;
          for (const pt of pickPoints) {
            hit = await uia.elementFromPoint(pt.x, pt.y, "input");
            if (hit?.ok) break;
          }
          if (!hit?.ok) {
            await finish({
              ok: false,
              error:
                t("err.pickNoBackground"),
            });
            return { ok: false };
          }
          const result = upsertTargetFromQuietUia({
            hwnd: hit.hwnd,
            windowName: hit.windowName || "",
            processName: hit.processName || "",
            inputLocator: hit.locator,
          });
          await finish(result);
          return { ok: result.ok };
        }
        let win = null;
        for (const pt of pickPoints) {
          win = await windowFromPointPhysical(pt.x, pt.y);
          if (win) break;
        }
        if (!win) {
          showPickOverlay(t("pick.hintInputEsc"));
          return { ok: false, continue: true };
        }
        const point = {
          x: Number(win.clientX),
          y: Number(win.clientY),
        };
        const result = upsertTargetFromField({
          win,
          inputPoint: point,
          focusPoint: null,
        });
        await finish(result);
        return { ok: result.ok };
      }

      // Cursor UIA binding
      const uia = getUiaClient();
      try {
        const hitAtPoints = async (role) => {
          let last = null;
          for (const pt of pickPoints) {
            const hit = await uia.elementFromPoint(pt.x, pt.y, role);
            last = hit;
            if (hit?.ok) return hit;
          }
          return last || { ok: false, error: role === "chat" ? "not_chat" : "not_input" };
        };

        if (phase === "chat") {
          const hit = await hitAtPoints("chat");
          if (!hit.ok) {
            showPickOverlay(
              `${uiaErr(hit.error, t("err.clickAgentRow"))}${t("pick.escSuffix")}`
            );
            return { ok: false, continue: true };
          }
          // If we bound a Button row, climb name is fine; prefer ListItem-like name
          const probe = await uia.probe(hit.hwnd);
          if (probe.status === "chrome_only" || probe.accessible === false) {
            await finish({
              ok: false,
              error:
                t("err.cursorA11y"),
              needsAccessibility: true,
            });
            return { ok: false };
          }
          draft = {
            hwnd: String(hit.hwnd),
            windowName: hit.windowName || "Cursor",
            processName: "Cursor",
            chatLocator: hit.locator,
            chatName: hit.name || hit.locator?.name || "",
          };
          phase = "input";
          showPickOverlay(
            t("pick.hintStep2", {
              name: (draft.chatName || t("err.chatDefault")).slice(0, 40),
            })
          );
          return { ok: true, continue: true };
        }

        const hit = await hitAtPoints("input");
        if (!hit.ok) {
          showPickOverlay(
            `${uiaErr(hit.error, t("err.clickInput"))} · Esc — cancel`
          );
          return { ok: false, continue: true };
        }
        if (!draft) {
          await finish({ ok: false, error: t("err.clickChatFirst") });
          return { ok: false };
        }
        if (String(hit.hwnd) !== String(draft.hwnd)) {
          showPickOverlay(t("pick.hintSameWindow"));
          return { ok: false, continue: true };
        }
        const result = upsertTargetFromUia({
          hwnd: draft.hwnd,
          windowName: draft.windowName || hit.windowName,
          processName: draft.processName,
          chatLocator: draft.chatLocator,
          inputLocator: hit.locator,
          chatName: draft.chatName,
        });
        await finish(result);
        return { ok: result.ok };
      } catch (e) {
        await finish({ ok: false, error: String(e.message || e) });
        return { ok: false };
      }
    });

    ipcMain.handle("pick-cancel", async () => {
      await finish({ ok: false, canceled: true });
      return { ok: false };
    });

    pickWindow.on("closed", () => {
      pickWindow = null;
    });
  });
}

function setupIpc() {
  ipcMain.handle("get-state", () => {
    const settings = readSettings();
    refreshLocaleFromSettings(settings);
    const decks = listDecks();
    const deck = loadDeck(settings.activeDeckId);
    const layout = dockLayout(settings.dock || "right", expandedMode);
    return {
      settings,
      decks,
      deck,
      dock: settings.dock || "right",
      horizontal: layout.horizontal,
      expanded: expandedMode,
      fullscreenEdit: fullscreenEditMode,
      pinnedOpen,
      tarotBase: "app://tarot/",
      i18n: i18nPayload(settings),
      sdkBackendEnabled: isCursorSdkEnabled(),
    };
  });

  ipcMain.handle("save-settings", (e, partial) => {
    if (!assertTrustedSender(e)) return readSettings();
    let safe = pickSettingsPartial(partial || {});
    if (safe.panelScale != null) {
      safe = {
        ...safe,
        panelScale: stripMetrics(safe.panelScale).scale,
      };
    }
    const before = readSettings();
    if (safe.cursorBackend != null) {
      const wantSdk =
        isCursorSdkEnabled() && safe.cursorBackend === "sdk";
      safe = {
        ...safe,
        cursorBackend: wantSdk ? "sdk" : "cdp",
      };
    }
    if (safe.cursorApiKey != null) {
      safe = { ...safe, cursorApiKey: String(safe.cursorApiKey) };
    }
    if (safe.cursorSdkCwd != null) {
      safe = { ...safe, cursorSdkCwd: String(safe.cursorSdkCwd) };
    }
    if (safe.cursorSdkAgentId != null) {
      safe = { ...safe, cursorSdkAgentId: String(safe.cursorSdkAgentId) };
    }
    if (safe.cursorSdkModel != null) {
      safe = {
        ...safe,
        cursorSdkModel: String(safe.cursorSdkModel || DEFAULT_MODEL_ID),
      };
    }
    if (safe.sdkProjects != null) {
      safe = {
        ...safe,
        sdkProjects: normalizeSdkProjects(safe.sdkProjects),
      };
    }
    if (safe.activeSdkProjectId != null) {
      safe = {
        ...safe,
        activeSdkProjectId: trySafeId(safe.activeSdkProjectId) || "",
      };
    }
    const s = writeSettings(safe);
    if (safe.dock || safe.panelScale != null || safe.sideCardLayout != null) {
      applyDock(s.dock || "right");
    }
    if (safe.showHotkey != null || safe.activeDeckId != null || safe.targets) {
      registerShortcuts();
    }
    if (safe.targets) broadcastTargetsUpdated();
    if (safe.uiLocale != null || safe.arcanaLocale != null) {
      const ui = refreshLocaleFromSettings(s);
      if (safe.uiLocale != null && safe.uiLocale !== before.uiLocale) {
        syncBundledDecks(ui, { onlyIfMissing: false });
        writeSettings({ stockDeckRev: STOCK_DECK_REV });
      }
      try {
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.setTitle(t("settings.winTitle"));
        }
        if (targetsWindow && !targetsWindow.isDestroyed()) {
          targetsWindow.setTitle(t("targets.winTitle"));
        }
        if (chatPickWindow && !chatPickWindow.isDestroyed()) {
          chatPickWindow.setTitle(t("chatPick.winTitle"));
        }
      } catch {
        /* ignore */
      }
    } else {
      refreshLocaleFromSettings(s);
    }
    if (
      safe.remoteEnabled != null ||
      safe.remotePort != null ||
      safe.remoteToken != null ||
      safe.remoteAccessMode != null
    ) {
      syncRemoteServer().catch((err) =>
        log.warn("remote sync", String(err.message || err))
      );
    }
    if (
      safe.cursorBackend != null &&
      safe.cursorBackend !== before.cursorBackend
    ) {
      notifyRemoteDeckChanged();
    }
    broadcastStateChanged();
    return s;
  });

  ipcMain.handle("remote-status", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    return getRemoteStatusPayload();
  });

  ipcMain.handle("remote-set-enabled", async (e, enabled) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    let s = readSettings();
    if (enabled && !s.remoteToken) {
      s = writeSettings({ remoteToken: generateRemoteToken() });
    }
    s = writeSettings({ remoteEnabled: !!enabled });
    const sync = await syncRemoteServer();
    const status = await getRemoteStatusPayload();
    return { ...status, sync };
  });

  ipcMain.handle("remote-rotate-token", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    writeSettings({ remoteToken: generateRemoteToken() });
    await syncRemoteServer();
    return getRemoteStatusPayload();
  });

  ipcMain.handle("remote-qr-data-url", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const status = await getRemoteStatusPayload();
    const url = status.publicUrl || "";
    if (!url) return { ok: false, error: "no_url", status };
    try {
      const QRCode = require("qrcode");
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 240,
        errorCorrectionLevel: "M",
      });
      return { ok: true, dataUrl, url, status };
    } catch (err) {
      return {
        ok: false,
        error: String(err.message || err),
        url,
        status,
      };
    }
  });

  ipcMain.handle("remote-diagnose", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    return diagnoseRemote();
  });

  ipcMain.handle("preview-settings", (_e, partial) => {
    if (partial && partial.panelScale != null) {
      const scale = stripMetrics(partial.panelScale).scale;
      partial = { ...partial, panelScale: scale };
      applyDock(readSettings().dock || "right", expandedMode, scale);
    }
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("settings-preview", partial);
    }
    return true;
  });

  ipcMain.handle("deck-ui-ready", () => {
    markDeckUiReady();
    return true;
  });

  ipcMain.handle("set-dock", (_e, dock) => {
    const s = writeSettings({ dock });
    applyDock(dock);
    return s;
  });

  ipcMain.handle("set-active-deck", (e, id) => {
    if (!assertTrustedSender(e)) return null;
    const result = activateDeck({ deckId: id });
    if (!result?.ok) return null;
    return loadDeck(result.deck.id);
  });

  ipcMain.handle("save-deck", (e, deck) => {
    if (!assertTrustedSender(e)) return null;
    try {
      const saved = saveDeck(deck);
      writeSettings({ activeDeckId: saved.id });
      registerShortcuts();
      broadcastStateChanged();
      return saved;
    } catch (err) {
      log.warn("save-deck", String(err.message || err));
      return { ok: false, error: String(err.message || err) };
    }
  });

  ipcMain.handle("open-settings", () => {
    openSettingsWindow();
    return true;
  });

  ipcMain.handle("close-settings", () => {
    closeSettingsWindow();
    return true;
  });

  ipcMain.handle("open-targets", () => {
    openTargetsWindow();
    return true;
  });

  ipcMain.handle("close-targets", () => {
    closeTargetsWindow();
    return true;
  });

  ipcMain.handle("list-windows", async () => listWindows());

  ipcMain.handle("add-target-window", async (_e, win) => {
    if (!win?.hwnd) return { ok: false, error: t("err.noWindow") };
    const result = await upsertTargetFromWindow({
      hwnd: String(win.hwnd),
      pid: win.pid,
      processName: win.processName || "",
      title: win.title || "",
    });
    broadcastTargetsUpdated();
    return result;
  });

  ipcMain.handle("paste-card", async (e, cardId) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    return pasteQueue.enqueue(() => pasteCardById(cardId));
  });

  /** Deck strip transcript for solo Cursor chat (same CDP path as phone remote). */
  ipcMain.handle("deck-read-chat", async (e, payload) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const targetId = String(payload?.targetId || settings.activeTargetId || "").trim();
    if (!targetId) {
      return { ok: false, error: "no_target", hint: "pick_chat" };
    }
    const target = (settings.targets || []).find((t) => t.id === targetId);
    if (!target) {
      return { ok: false, error: "unknown_target", hint: "unknown_target" };
    }
    if (target.driver !== "cdp") {
      return { ok: false, error: "not_cdp", hint: "not_cdp" };
    }
    const select = payload?.select !== false;
    try {
      const result = await readRemoteChat(targetId, { select });
      if (!result?.ok) {
        return {
          ok: false,
          error: result?.error || "read_failed",
          hint: result?.hint || "",
          targetId,
        };
      }
      const withSuggest = attachChatSuggestions(result);
      return {
        ok: true,
        targetId,
        hash: withSuggest.hash || "",
        messages: withSuggest.messages || [],
        generating: withSuggest.generating === true,
        suggestions: withSuggest.suggestions || [],
      };
    } catch (err) {
      return {
        ok: false,
        error: String(err.message || err),
        hint: "read_failed",
        targetId,
      };
    }
  });

  ipcMain.handle("set-ignore-mouse", (_e, ignore) => {
    const next = !!ignore;
    setDeckIgnoreMouse(next);
    mouseCaptureOpen = !next;
    if (mouseCaptureOpen && hideDelayTimer) {
      clearTimeout(hideDelayTimer);
      hideDelayTimer = null;
    }
    return true;
  });

  ipcMain.handle("get-cursor-client", () => cursorInDeckClient());

  ipcMain.handle("get-deck-focused", () => {
    if (!deckWindow || deckWindow.isDestroyed()) return false;
    return deckWindow.isFocused();
  });

  ipcMain.handle("set-preview-hold", (_e, on) => {
    // Never keep preview hit-area alive while another app is foreground
    if (on && (!deckWindow || deckWindow.isDestroyed() || !deckWindow.isFocused())) {
      previewHoldOpen = false;
      return false;
    }
    previewHoldOpen = !!on;
    return true;
  });

  ipcMain.handle("set-modal-hold", (_e, on) => {
    modalHoldOpen = !!on;
    if (modalHoldOpen && deckWindow && !deckWindow.isDestroyed()) {
      if (hideDelayTimer) {
        clearTimeout(hideDelayTimer);
        hideDelayTimer = null;
      }
      setDeckVisible(true, { inactive: true });
    }
    return true;
  });

  ipcMain.handle("start-target-pick", async (e, mode) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    if (!pasteQueue.beginPick()) {
      return { ok: false, error: t("err.pickBusy") };
    }
    let result;
    try {
      result = await startTargetPick(mode);
    } finally {
      pasteQueue.endPick();
    }
    edgeHoverPaused = false;
    if (result?.ok) {
      pinnedOpen = true;
      setDeckVisible(true);
      broadcastTargetsUpdated();
      const msg = result.duplicate
        ? t("msg.alreadyHave", { name: result.target.name })
        : t("msg.targetNamed", { name: result.target.name });
      if (deckWindow && !deckWindow.isDestroyed()) {
        deckWindow.webContents.send("toast", { type: "ok", message: msg });
      }
      if (targetsWindow && !targetsWindow.isDestroyed()) {
        targetsWindow.show();
        targetsWindow.focus();
        targetsWindow.webContents.send("toast", { type: "ok", message: msg });
      }
    } else if (!result?.canceled) {
      pinnedOpen = true;
      setDeckVisible(true);
      const errMsg = result?.error || t("err.notSelected");
      if (deckWindow && !deckWindow.isDestroyed()) {
        deckWindow.webContents.send("toast", { type: "error", message: errMsg });
      }
      if (targetsWindow && !targetsWindow.isDestroyed()) {
        targetsWindow.show();
        targetsWindow.focus();
        targetsWindow.webContents.send("toast", { type: "error", message: errMsg });
      }
    } else {
      edgeHoverPaused = false;
      if (pinnedOpen) setDeckVisible(true, { inactive: true });
      if (targetsWindow && !targetsWindow.isDestroyed()) {
        targetsWindow.show();
        targetsWindow.focus();
      }
    }
    return result;
  });

  ipcMain.handle("cursor-probe", async () => {
    try {
      const settings = readSettings();
      const port = settings.cdpPort || DEFAULT_CDP_PORT;
      const cdp = getCdpClient(port);
      const probe = await cdp.probe();
      const running = await isCursorRunning();
      const exe = await resolveCursorExe();
      let chatsTotal = 0;
      if (probe.open && probe.targets?.length) {
        for (const t of probe.targets.slice(0, 3)) {
          const list = await cdp.listChats(t.id);
          if (list.ok) chatsTotal += (list.chats || []).length;
        }
      }
      const hintRu = probe.open
        ? t("msg.cdpOpen", { windows: probe.targetCount, chats: chatsTotal })
        : running
          ? t("settingsMsg.cursorNoDebug")
          : t("msg.cdpClosedLaunchBtn");
      return {
        ok: probe.open,
        ...probe,
        chatsTotal,
        hint: hintRu,
        cursorRunning: running,
        cursorExe: exe,
        flag: `--remote-debugging-port=${port}`,
        accessibilityFlag: ACCESSIBILITY_FLAG,
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle("sdk-probe", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const r = await getCursorSdkClient().probe(sdkOptsFromSettings(settings));
    if (!r.ok) {
      return {
        ...r,
        error: mapSdkError(r.error || r.hint),
      };
    }
    return {
      ok: true,
      hasKey: true,
      apiKeyName: r.apiKeyName || "",
      modelCount: r.modelCount || 0,
      hint: t("settingsMsg.sdkOk", {
        name: r.apiKeyName ? ` (${r.apiKeyName})` : "",
      }),
    };
  });

  ipcMain.handle("sdk-pick-cwd", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const { filePaths, canceled } = await dialog.showOpenDialog(dialogParent(), {
      properties: ["openDirectory"],
    });
    if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
    const cwd = filePaths[0];
    const settings = readSettings();
    const projects = normalizeSdkProjects(settings.sdkProjects);
    const activeId = settings.activeSdkProjectId;
    let next;
    if (activeId && projects.some((p) => p.id === activeId)) {
      next = projects.map((p) =>
        p.id === activeId ? { ...p, cwd, name: p.name || path.basename(cwd) } : p
      );
    } else {
      const added = normalizeSdkProject({
        name: path.basename(cwd),
        cwd,
      });
      next = [...projects, added].slice(0, MAX_SDK_PROJECTS);
      writeSettings({
        sdkProjects: next,
        activeSdkProjectId: added.id,
        cursorSdkCwd: cwd,
      });
      broadcastStateChanged();
      notifyRemoteDeckChanged();
      return {
        ok: true,
        cwd,
        sdkProjects: next,
        activeSdkProjectId: added.id,
      };
    }
    const s = writeSettings({
      sdkProjects: next,
      cursorSdkCwd: cwd,
      activeSdkProjectId: activeId,
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      cwd: s.cursorSdkCwd,
      sdkProjects: s.sdkProjects,
      activeSdkProjectId: s.activeSdkProjectId,
    };
  });

  ipcMain.handle("sdk-add-project", async (e, opts = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    let cwd = String(opts.cwd || "").trim();
    if (!cwd) {
      const { filePaths, canceled } = await dialog.showOpenDialog(dialogParent(), {
        properties: ["openDirectory"],
      });
      if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
      cwd = filePaths[0];
    }
    const settings = readSettings();
    const projects = normalizeSdkProjects(settings.sdkProjects);
    if (projects.length >= MAX_SDK_PROJECTS) {
      return { ok: false, error: t("err.sdkProjectsMax") };
    }
    const name =
      String(opts.name || "").trim() || path.basename(cwd) || "Project";
    const added = normalizeSdkProject({ name, cwd });
    const next = [...projects, added];
    const s = writeSettings({
      sdkProjects: next,
      activeSdkProjectId: added.id,
      cursorSdkCwd: cwd,
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      project: added,
      sdkProjects: s.sdkProjects,
      activeSdkProjectId: s.activeSdkProjectId,
    };
  });

  ipcMain.handle("sdk-remove-project", async (e, projectId) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const id = trySafeId(projectId);
    if (!id) return { ok: false, error: "invalid_id" };
    const settings = readSettings();
    const next = normalizeSdkProjects(settings.sdkProjects).filter(
      (p) => p.id !== id
    );
    let active = settings.activeSdkProjectId;
    if (active === id) active = next[0]?.id || "";
    const s = writeSettings({
      sdkProjects: next,
      activeSdkProjectId: active,
      cursorSdkCwd: next.find((p) => p.id === active)?.cwd || "",
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      sdkProjects: s.sdkProjects,
      activeSdkProjectId: s.activeSdkProjectId,
    };
  });

  ipcMain.handle("sdk-set-active-project", async (e, projectId) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const project = findSdkProject(settings, projectId);
    if (!project) return { ok: false, error: "unknown_project" };
    const chat = findSdkChat(project, project.activeChatId);
    const s = writeSettings({
      activeSdkProjectId: project.id,
      cursorSdkCwd: project.cwd,
      cursorSdkAgentId: chat?.agentId || project.agentId || "",
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      activeSdkProjectId: s.activeSdkProjectId,
      cwd: project.cwd,
      sdkProjects: s.sdkProjects,
    };
  });

  ipcMain.handle("sdk-rename-project", async (e, payload = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const id = trySafeId(payload.projectId || payload.id);
    const name = String(payload.name || "").trim().slice(0, 80);
    if (!id || !name) return { ok: false, error: "invalid" };
    const settings = readSettings();
    const next = normalizeSdkProjects(settings.sdkProjects).map((p) =>
      p.id === id ? { ...p, name } : p
    );
    const s = writeSettings({ sdkProjects: next });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return { ok: true, sdkProjects: s.sdkProjects };
  });

  ipcMain.handle("sdk-add-chat", async (e, payload = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const projectId =
      trySafeId(payload.projectId) ||
      trySafeId(settings.activeSdkProjectId) ||
      "";
    const projects = normalizeSdkProjects(settings.sdkProjects);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: "unknown_project" };
    if ((project.chats || []).length >= MAX_SDK_CHATS_PER_PROJECT) {
      return { ok: false, error: t("err.sdkChatsMax") };
    }
    const n = (project.chats || []).length + 1;
    const added = normalizeSdkChat({
      name: String(payload.name || "").trim() || `Chat ${n}`,
      agentId: "",
    });
    const next = projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            chats: [...(p.chats || []), added],
            activeChatId: added.id,
            agentId: "",
          }
        : p
    );
    const s = writeSettings({
      sdkProjects: next,
      cursorSdkAgentId: "",
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      chat: added,
      sdkProjects: s.sdkProjects,
      activeSdkProjectId: s.activeSdkProjectId,
    };
  });

  ipcMain.handle("sdk-remove-chat", async (e, payload = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const projectId =
      trySafeId(payload.projectId) ||
      trySafeId(settings.activeSdkProjectId) ||
      "";
    const chatId = trySafeId(payload.chatId || payload.id);
    if (!projectId || !chatId) return { ok: false, error: "invalid" };
    const projects = normalizeSdkProjects(settings.sdkProjects);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: "unknown_project" };
    if ((project.chats || []).length <= 1) {
      return { ok: false, error: t("err.sdkChatLast") };
    }
    const chats = (project.chats || []).filter((c) => c.id !== chatId);
    let activeChatId = project.activeChatId;
    if (activeChatId === chatId) activeChatId = chats[0]?.id || "";
    const next = projects.map((p) =>
      p.id === projectId
        ? {
            ...p,
            chats,
            activeChatId,
            agentId: chats.find((c) => c.id === activeChatId)?.agentId || "",
          }
        : p
    );
    const s = writeSettings({
      sdkProjects: next,
      cursorSdkAgentId:
        next.find((p) => p.id === projectId)?.agentId || "",
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return { ok: true, sdkProjects: s.sdkProjects };
  });

  ipcMain.handle("sdk-set-active-chat", async (e, payload = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const projectId =
      trySafeId(payload.projectId) ||
      trySafeId(settings.activeSdkProjectId) ||
      "";
    const chatId = trySafeId(payload.chatId || payload.id);
    if (!projectId || !chatId) return { ok: false, error: "invalid" };
    const projects = normalizeSdkProjects(settings.sdkProjects);
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: "unknown_project" };
    const chat = findSdkChat(project, chatId);
    if (!chat) return { ok: false, error: "unknown_chat" };
    const next = projects.map((p) =>
      p.id === projectId
        ? { ...p, activeChatId: chat.id, agentId: chat.agentId || "" }
        : p
    );
    const s = writeSettings({
      sdkProjects: next,
      activeSdkProjectId: projectId,
      cursorSdkCwd: project.cwd,
      cursorSdkAgentId: chat.agentId || "",
    });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return {
      ok: true,
      sdkProjects: s.sdkProjects,
      activeSdkProjectId: s.activeSdkProjectId,
      activeChatId: chat.id,
    };
  });

  ipcMain.handle("sdk-rename-chat", async (e, payload = {}) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    const projectId =
      trySafeId(payload.projectId) ||
      trySafeId(settings.activeSdkProjectId) ||
      "";
    const chatId = trySafeId(payload.chatId || payload.id);
    const name = String(payload.name || "").trim().slice(0, 80);
    if (!projectId || !chatId || !name) return { ok: false, error: "invalid" };
    const projects = normalizeSdkProjects(settings.sdkProjects);
    const next = projects.map((p) => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        chats: (p.chats || []).map((c) =>
          c.id === chatId ? { ...c, name } : c
        ),
      };
    });
    const s = writeSettings({ sdkProjects: next });
    broadcastStateChanged();
    notifyRemoteDeckChanged();
    return { ok: true, sdkProjects: s.sdkProjects };
  });

  ipcMain.handle("sdk-new-agent", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const settings = readSettings();
    try {
      const project = findSdkProject(settings, settings.activeSdkProjectId);
      const chat = findSdkChat(project, project?.activeChatId);
      const opts = sdkOptsFromSettings(
        settings,
        project?.id,
        chat?.id
      );
      const r = await getCursorSdkClient().resetAgent(opts);
      const s = persistSdkAgentId(opts.projectId, opts.chatId, r.agentId || "");
      broadcastStateChanged();
      notifyRemoteDeckChanged();
      return {
        ok: true,
        agentId: r.agentId,
        sdkProjects: s.sdkProjects,
        hint: t("settingsMsg.sdkAgentReset"),
      };
    } catch (err) {
      const code = err?.code || "";
      return { ok: false, error: mapSdkError(code || err.message || err) };
    }
  });

  ipcMain.handle("cursor-install-cdp-shortcut", async (_e, opts = {}) => {
    const settings = readSettings();
    const port = Number(opts.cdpPort) || settings.cdpPort || DEFAULT_CDP_PORT;
    const mode = opts.mode || "background";
    return installCursorCdpShortcut({ mode, cdpPort: port });
  });

  ipcMain.handle("cursor-launch-integration", async (_e, opts = {}) => {
    const settings = readSettings();
    const port = Number(opts.cdpPort) || settings.cdpPort || DEFAULT_CDP_PORT;
    const mode = opts.mode || "background";
    const allowRestart =
      opts.allowRestart === true || opts.restart === true;
    const result = allowRestart
      ? await launchOrRestartCursorWithCdp({ mode, cdpPort: port, allowRestart: true })
      : await launchCursorForIntegration({ mode, cdpPort: port });
    if (!result.ok) return result;
    await new Promise((r) => setTimeout(r, 2800));
    try {
      const cdp = getCdpClient(port);
      let probe = await cdp.probe();
      for (let i = 0; i < 8 && !probe.open; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        probe = await cdp.probe();
      }
      return {
        ...result,
        probe: {
          ...probe,
          hint: probe.open
            ? result.restarted
              ? t("msg.cursorReadyCdpRestart")
              : t("msg.cursorReadyCdp")
            : t("msg.cursorStarting"),
        },
      };
    } catch (e) {
      return { ...result, probeError: String(e.message || e) };
    }
  });

  ipcMain.handle("cdp-list-windows", async () => {
    const settings = readSettings();
    const cdp = getCdpClient(settings.cdpPort || DEFAULT_CDP_PORT);
    const probe = await cdp.probe();
    if (!probe.open) {
      return { ok: false, error: t("err.cdpClosedLaunch"), windows: [] };
    }
    return { ok: true, windows: probe.targets || [], port: probe.port };
  });

  ipcMain.handle("cdp-list-chats", async (_e, arg, maybeOpts) => {
    const settings = readSettings();
    const cdp = getCdpClient(settings.cdpPort || DEFAULT_CDP_PORT);
    const cdpTargetId =
      typeof arg === "string" ? arg : arg?.cdpTargetId || arg?.id;
    const opts =
      typeof arg === "string" ? maybeOpts || {} : arg && typeof arg === "object" ? arg : {};
    const list = await cdp.listChats(cdpTargetId, {
      revealAll: opts.revealAll === true,
    });
    return list;
  });

  ipcMain.handle("cdp-add-chat", async (_e, payload) => {
    const settings = readSettings();
    const result = upsertTargetFromCdp({
      cdpTargetId: payload?.cdpTargetId,
      windowTitle: payload?.windowTitle,
      chatId: payload?.chatId || payload?.id,
      chatTitle: payload?.chatTitle || payload?.title,
      projectName: payload?.projectName || payload?.project || "",
      port: settings.cdpPort || DEFAULT_CDP_PORT,
    });
    if (result.ok) broadcastTargetsUpdated();
    return result;
  });

  ipcMain.handle("cdp-create-chat", async (e, payload) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const req = normalizeCreateChatRequest(payload);
    if (!req.ok) return req;
    const settings = readSettings();
    const port = settings.cdpPort || DEFAULT_CDP_PORT;
    const cdp = getCdpClient(port);
    const created = await cdp.createChatInProject(req.cdpTargetId, req.projectName);
    if (!created?.ok || !created.chat) {
      return {
        ok: false,
        error: created?.error || "create_chat_failed",
        hint: created?.hint || created?.error || "create_chat_failed",
      };
    }
    const winTitle =
      String(payload?.windowTitle || "").trim() ||
      "Cursor";
    const result = upsertTargetFromCdp({
      cdpTargetId: req.cdpTargetId,
      windowTitle: winTitle,
      chatId: created.chat.id,
      chatTitle: created.chat.title,
      projectName: created.chat.project || req.projectName,
      port,
    });
    if (result.ok) broadcastTargetsUpdated();
    return {
      ...result,
      chat: created.chat,
    };
  });

  ipcMain.handle("paste-text-to-target", async (e, payload) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const targetId = String(payload?.targetId || "").trim();
    const text = String(payload?.text ?? "");
    if (!targetId) {
      return { ok: false, error: "target_required", hint: "target_required" };
    }
    if (!text.trim()) {
      return { ok: false, error: "empty_text", hint: "empty_text" };
    }
    if (text.length > 100_000) {
      return { ok: false, error: "text_too_long", hint: "text_too_long" };
    }
    return pasteQueue.enqueue(() =>
      pasteTextToTarget(text, targetId, { kind: "text", cardId: null })
    );
  });

  ipcMain.handle("open-chat-pick", () => {
    openChatPickWindow();
    return true;
  });

  ipcMain.handle("close-chat-pick", () => {
    closeChatPickWindow();
    return true;
  });

  ipcMain.handle("uia-diagnose", async () => {
    try {
      const settings = readSettings();
      const cdp = getCdpClient(settings.cdpPort || DEFAULT_CDP_PORT);
      const probe = await cdp.probe();
      let chatsTotal = 0;
      if (probe.open) {
        for (const t of (probe.targets || []).slice(0, 4)) {
          const list = await cdp.listChats(t.id);
          if (list.ok) chatsTotal += (list.chats || []).length;
        }
      }
      return {
        ok: probe.open,
        status: probe.open ? "ok" : "cdp_closed",
        accessible: !!probe.open,
        elementCount: 0,
        chatCandidates: chatsTotal,
        inputCandidates: 0,
        buttonCount: 0,
        windowName: probe.targets?.[0]?.title || "",
        targetCount: probe.targetCount || 0,
        hint: probe.open
          ? t("msg.cdpSummary", { windows: probe.targetCount, chats: chatsTotal })
          : t("msg.cdpClosedNeedLaunch"),
      };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  });

  ipcMain.handle("toggle-deck", () => {
    toggleDeck();
    return {
      visible: deckWindow ? deckWindow.isVisible() : false,
      pinned: pinnedOpen,
    };
  });

  ipcMain.handle("set-expanded", (_e, expanded) => {
    expandedMode = !!expanded;
    applyDock(readSettings().dock || "right", expandedMode);
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("panel-expanded", { expanded: expandedMode });
    }
    return { expanded: expandedMode };
  });

  ipcMain.handle("toggle-pin", () => {
    pinnedOpen = !pinnedOpen;
    const s = readSettings();
    if (pinnedOpen) {
      setDeckVisible(true);
    }
    sendPinState();
    return { pinned: pinnedOpen, settings: s };
  });

  ipcMain.handle("unpin-deck", () => {
    pinnedOpen = false;
    sendPinState();
    return true;
  });

  ipcMain.handle("set-fullscreen-edit", (_e, on) => setFullscreenEdit(!!on));

  ipcMain.handle("hide-deck", () => {
    pinnedOpen = false;
    expandedMode = false;
    fullscreenEditMode = false;
    setDeckVisible(false, { force: true });
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("fullscreen-edit", { on: false });
      deckWindow.webContents.send("panel-expanded", { expanded: false });
      sendPinState();
    }
    return false;
  });

  ipcMain.handle("show-deck", () => {
    pinnedOpen = true;
    setDeckVisible(true);
    sendPinState();
    return true;
  });

  ipcMain.handle("export-deck", async (e, deckId) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const safe = trySafeId(deckId);
    if (!safe) return { ok: false, error: t("err.badDeckId") };
    const deck = loadDeck(safe);
    const { filePath, canceled } = await dialog.showSaveDialog(dialogParent(), {
      title: t("msg.exportDeck"),
      defaultPath: `${deck.name || deck.id}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, JSON.stringify(deck, null, 2), "utf8");
    return { ok: true, filePath };
  });

  ipcMain.handle("import-deck", async (e) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const { filePaths, canceled } = await dialog.showOpenDialog(dialogParent(), {
      title: t("msg.importDeck"),
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths?.[0]) return { ok: false };
    try {
      const st = fs.statSync(filePaths[0]);
      if (st.size > MAX_DECK_IMPORT_BYTES) {
        return { ok: false, error: t("err.fileTooLarge") };
      }
      const raw = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
      const existing = listExistingDeckIds(decksDir());
      const deck = normalizeDeck(raw, {
        existingIds: existing,
        sourceBytes: st.size,
      });
      saveDeck(deck);
      writeSettings({ activeDeckId: deck.id });
      registerShortcuts();
      broadcastStateChanged();
      return { ok: true, deck };
    } catch (err) {
      const msg =
        err?.code === "too_large"
          ? t("err.fileTooLarge")
          : err?.code === "empty_cards"
            ? t("err.noCardsInFile")
            : err?.code === "invalid_id" || err?.code === "invalid_deck"
              ? t("err.badDeckFormat")
              : String(err.message || err);
      log.warn("import-deck", msg);
      return { ok: false, error: msg };
    }
  });

  ipcMain.handle("new-deck", (e, name) => {
    if (!assertTrustedSender(e)) return null;
    const id = `deck-${Date.now()}`;
    const deck = {
      id,
      name: String(name || t("msg.newDeckName")).slice(0, 80),
      cards: [
        {
          id: `card-${Date.now()}`,
          title: t("msg.newCardTitle"),
          description: t("msg.newCardDesc"),
          prompt: t("msg.newCardPrompt"),
          image: "magician",
          hotkey: "F1",
        },
      ],
    };
    saveDeck(deck);
    writeSettings({ activeDeckId: id });
    registerShortcuts();
    broadcastStateChanged();
    return deck;
  });

  ipcMain.handle("delete-deck", (e, id) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const safe = trySafeId(id);
    if (!safe) return { ok: false, error: t("err.badId") };
    if (i18n.isStockDeckId(safe)) {
      return { ok: false, error: t("err.cannotDeleteStock") };
    }
    try {
      const file = deckFilePath(decksDir(), safe);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    const settings = readSettings();
    if (settings.activeDeckId === safe) {
      writeSettings({ activeDeckId: "validate-v1" });
    }
    registerShortcuts();
    broadcastStateChanged();
    return { ok: true };
  });

  ipcMain.handle("open-data-folder", () => {
    ensureData();
    shell.openPath(userDataDir());
  });

  ipcMain.handle("open-logs-folder", () => {
    ensureData();
    const dir = log.getLogDir() || path.join(userDataDir(), "logs");
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle("donate-get-config", (e) => {
    if (!assertTrustedSender(e)) return publicConfig({});
    return publicConfig(donateConfig);
  });

  ipcMain.handle("donate-get-stats", (e) => {
    if (!assertTrustedSender(e)) {
      return { total: 0, percents: { unknown: 0, coffee: 0, beer: 0, cats: 0 } };
    }
    ensureData();
    return computeStats(clicksPath(userDataDir()));
  });

  ipcMain.handle("donate-record-click", (e, payload) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    ensureData();
    return recordClick(clicksPath(userDataDir()), payload || {});
  });

  ipcMain.handle("donate-open-pay", async (e, method) => {
    if (!assertTrustedSender(e)) return { ok: false, error: "denied" };
    const m = String(method || "");
    if (m === "crypto") {
      const addr = String(donateConfig.cryptoAddress || "").trim();
      if (!addr) return { ok: false, error: "unavailable" };
      clipboard.writeText(addr);
      return {
        ok: true,
        copied: true,
        network: String(donateConfig.cryptoNetwork || "").trim(),
        address: addr,
      };
    }
    const url = resolveAllowedUrl(donateConfig, m);
    if (!url) return { ok: false, error: "unavailable" };
    await shell.openExternal(url);
    return { ok: true };
  });

  ipcMain.handle("dismiss-first-run", () => {
    writeSettings({ firstRunDone: true });
    broadcastStateChanged();
    return true;
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!info) return { ok: true, available: false };
      const current = app.getVersion();
      const available = info.version && info.version !== current;
      return {
        ok: true,
        available: !!available,
        version: info.version || null,
        current,
      };
    } catch (err) {
      log.warn("check-for-updates", String(err.message || err));
      return {
        ok: false,
        error:
          t("err.updatesUnavailable"),
      };
    }
  });

  ipcMain.handle("quit-app", () => {
    shutdownApp();
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: false,
    },
  },
]);

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  protocol.handle("app", (request) => {
    try {
      const url = new URL(request.url);
      // app://tarot/magician.jpg — only files inside assets/tarot
      if (url.hostname === "tarot") {
        const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
        const tarotRoot = path.join(appRoot(), "assets", "tarot");
        const filePath = safeTarotFilePath(tarotRoot, name);
        if (fs.existsSync(filePath)) {
          return net.fetch(pathToFileURL(filePath).href);
        }
      }
    } catch {
      /* invalid path */
    }
    return new Response("Not found", { status: 404 });
  });

  i18n.setPacksRoot(appRoot());
  ensureData();
  const bootSettings = readSettings();
  refreshLocaleFromSettings(bootSettings);
  setupIpc();
  createDeckWindow();
  registerShortcuts();
  applyDock(bootSettings.dock || "right", false);
  if (bootSettings.remoteEnabled === true) {
    syncRemoteServer().catch((err) =>
      log.warn("remote boot", String(err.message || err))
    );
  }
  // First run: show deck so onboarding is visible; otherwise wait for edge/F9
  if (!bootSettings.firstRunDone) {
    pinnedOpen = true;
    setDeckVisible(true, { inactive: true });
  } else {
    pinnedOpen = false;
  }
  // Edge hover только после deck-ui-ready из рендерера (полная загрузка)

  // Automated smoke: exercise i18n + settings/targets, then quit.
  if (process.env.KEYCODE_SMOKE_I18N === "1") {
    (async () => {
      try {
        const attachConsole = (win, label) => {
          if (!win || win.isDestroyed()) return;
          win.webContents.on("console-message", (_e, level, message) => {
            if (level >= 2) {
              console.error(`[smoke-i18n] renderer-error ${label}:`, message);
            }
          });
          win.webContents.on("did-fail-load", (_e, code, desc) => {
            console.error(`[smoke-i18n] fail-load ${label}:`, code, desc);
          });
        };

        const pack = i18nPayload(bootSettings);
        console.log(
          "[smoke-i18n]",
          pack.uiLocale,
          pack.arcanaLocale,
          pack.messages["settings.title"] || "MISSING"
        );

        // Cycle a few locales through save-settings path
        for (const loc of ["en", "ru", "de", "ja"]) {
          const s = writeSettings({ uiLocale: loc, arcanaLocale: "ui" });
          const ui = refreshLocaleFromSettings(s);
          syncBundledDecks(ui, { onlyIfMissing: false });
          const p = i18nPayload(s);
          if (p.uiLocale !== loc) {
            throw new Error(`locale cycle failed: want ${loc} got ${p.uiLocale}`);
          }
          if (!p.messages["settings.title"] || p.messages["settings.title"] === "settings.title") {
            throw new Error(`messages missing for ${loc}`);
          }
          if (!p.tarot?.cards?.magician) {
            throw new Error(`tarot missing for ${loc}`);
          }
          const deck = loadDeck("validate-v1");
          if (!deck?.cards?.length) throw new Error(`deck empty after ${loc}`);
          console.log("[smoke-i18n] locale", loc, p.messages["settings.title"], deck.name);
        }

        // Restore system locale preference for the user profile
        writeSettings({ uiLocale: "system", arcanaLocale: "en" });
        refreshLocaleFromSettings(readSettings());

        openSettingsWindow();
        attachConsole(settingsWindow, "settings");
        await new Promise((r) => setTimeout(r, 900));
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          const probe = await settingsWindow.webContents.executeJavaScript(`
            (() => {
              if (!window.I18n) return { ok: false, error: "no I18n" };
              const title = window.I18n.t("settings.title");
              const magician = window.I18n.tarotName("magician");
              const hasSelect = !!document.getElementById("set-ui-locale");
              const opts = document.getElementById("set-ui-locale")?.options?.length || 0;
              return { ok: true, title, magician, hasSelect, opts };
            })()
          `);
          console.log("[smoke-i18n] settings-probe", JSON.stringify(probe));
          if (!probe?.ok || !probe.hasSelect || probe.opts < 2) {
            throw new Error("settings locale UI broken: " + JSON.stringify(probe));
          }
        }

        openTargetsWindow();
        attachConsole(targetsWindow, "targets");
        attachConsole(deckWindow, "deck");
        await new Promise((r) => setTimeout(r, 800));
        if (targetsWindow && !targetsWindow.isDestroyed()) {
          const probe = await targetsWindow.webContents.executeJavaScript(`
            (() => {
              if (!window.I18n) return { ok: false, error: "no I18n" };
              return { ok: true, title: window.I18n.t("targets.title") };
            })()
          `);
          console.log("[smoke-i18n] targets-probe", JSON.stringify(probe));
          if (!probe?.ok) throw new Error("targets i18n broken: " + JSON.stringify(probe));
          closeTargetsWindow();
        }

        if (deckWindow && !deckWindow.isDestroyed()) {
          const probe = await deckWindow.webContents.executeJavaScript(`
            (() => {
              if (!window.I18n) return { ok: false, error: "no I18n" };
              const hasCorner = !!document.getElementById("btn-corner-targets");
              const hasRail = !!document.getElementById("target-rail");
              return {
                ok: true,
                hasCorner,
                hasRail,
                magician: window.I18n.tarotName("magician"),
              };
            })()
          `);
          console.log("[smoke-i18n] deck-probe", JSON.stringify(probe));
          if (!probe?.ok || !probe.hasCorner || probe.hasRail) {
            throw new Error("deck i18n broken: " + JSON.stringify(probe));
          }
        }

        // Live switch language from settings UI
        if (settingsWindow && !settingsWindow.isDestroyed()) {
          await settingsWindow.webContents.executeJavaScript(`
            (async () => {
              const sel = document.getElementById("set-ui-locale");
              sel.value = "ru";
              sel.dispatchEvent(new Event("change", { bubbles: true }));
              await new Promise((r) => setTimeout(r, 900));
              return true;
            })()
          `);
          await new Promise((r) => setTimeout(r, 500));
          const after = await settingsWindow.webContents.executeJavaScript(`
            (() => ({
              title: document.querySelector("h1")?.textContent || "",
              t: window.I18n.t("settings.title"),
              lang: window.I18n.getUiLocale(),
            }))()
          `);
          console.log("[smoke-i18n] live-switch", JSON.stringify(after));
          if (after.lang !== "ru" || after.title !== after.t) {
            throw new Error("live language switch failed: " + JSON.stringify(after));
          }
        }

        // Phone remote: enable localhost server + settings UI hooks
        process.env.KEYCODE_REMOTE_DEV = "1";
        writeSettings({ remoteEnabled: true, remotePort: DEFAULT_REMOTE_PORT });
        const sync = await syncRemoteServer();
        if (!sync?.ok || !sync.running) {
          throw new Error("remote sync failed: " + JSON.stringify(sync));
        }
        const status = await getRemoteStatusPayload();
        if (!status.token || status.token.length < 16) {
          throw new Error("remote token missing");
        }
        if (!status.running) throw new Error("remote not running");

        const http = require("http");
        const api = await new Promise((resolve, reject) => {
          http
            .get(
              {
                host: "127.0.0.1",
                port: status.port,
                path: "/api/state",
                headers: { Authorization: `Bearer ${status.token}` },
              },
              (res) => {
                let b = "";
                res.on("data", (c) => (b += c));
                res.on("end", () => {
                  try {
                    resolve({ status: res.statusCode, body: JSON.parse(b) });
                  } catch (e) {
                    reject(e);
                  }
                });
              }
            )
            .on("error", reject);
        });
        if (api.status !== 200 || !api.body?.ok) {
          throw new Error("remote /api/state failed: " + JSON.stringify(api));
        }
        if (api.body.cards?.[0]?.prompt != null) {
          throw new Error("remote leaked card prompt");
        }

        if (settingsWindow && !settingsWindow.isDestroyed()) {
          const remoteUi = await settingsWindow.webContents.executeJavaScript(`
            (() => ({
              enable: !!document.getElementById("set-remote-enabled"),
              port: !!document.getElementById("set-remote-port"),
              qr: !!document.getElementById("remote-qr"),
              label: window.I18n.t("settings.remoteTitle"),
            }))()
          `);
          console.log("[smoke-i18n] remote-ui", JSON.stringify(remoteUi));
          if (!remoteUi.enable || !remoteUi.port || !remoteUi.label) {
            throw new Error("remote settings UI missing: " + JSON.stringify(remoteUi));
          }
        }

        writeSettings({ remoteEnabled: false });
        await syncRemoteServer();
        console.log("[smoke-i18n] remote ok", status.port);
        console.log("[smoke-i18n] ok");
        app.exit(0);
      } catch (e) {
        console.error("[smoke-i18n] fail", e && e.stack ? e.stack : e);
        try {
          writeSettings({ remoteEnabled: false });
          await syncRemoteServer();
        } catch {
          /* ignore */
        }
        app.exit(1);
      }
    })();
  }
});

app.on("will-quit", () => {
  app.isQuitting = true;
  if (edgePollTimer) clearInterval(edgePollTimer);
  if (hideDelayTimer) clearTimeout(hideDelayTimer);
  cancelConcealAnim();
  clearShortcuts();
  try {
    if (remoteServer) {
      remoteServer.stop();
      remoteServer = null;
    }
  } catch {
    /* ignore */
  }
  try {
    getUiaClient().quit();
  } catch {
    /* ignore */
  }
  try {
    getCdpClient().closeAll();
  } catch {
    /* ignore */
  }
  closeChatPickWindow();
  closePickWindow();
  targetsHeldPin = false;
  settingsHeldPin = false;
  if (targetsWindow && !targetsWindow.isDestroyed()) {
    targetsWindow.removeAllListeners("closed");
    targetsWindow.close();
    targetsWindow = null;
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.removeAllListeners("closed");
    settingsWindow.close();
    settingsWindow = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Already running — quit quietly (will-quit must not touch globalShortcut before ready)
  app.quit();
} else {
  app.on("second-instance", () => {
    if (deckWindow && !deckWindow.isDestroyed()) {
      pinnedOpen = true;
      setDeckVisible(true);
    }
  });
}
