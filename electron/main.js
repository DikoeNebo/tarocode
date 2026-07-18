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
const { execFile } = require("child_process");
const { promisify } = require("util");
const { pathToFileURL } = require("url");
const { getUiaClient } = require("./uia-client");
const { getCdpClient, DEFAULT_PORT: DEFAULT_CDP_PORT } = require("./cdp-client");
const {
  launchCursorForIntegration,
  isCursorRunning,
  resolveCursorExe,
  ACCESSIBILITY_FLAG,
  DEFAULT_CDP_PORT: SETUP_CDP_PORT,
} = require("./cursor-setup");

const execFileAsync = promisify(execFile);

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

const UIA_ERROR_RU = {
  element_not_found: "элемент не найден",
  not_chat: "это не вкладка/чат агента — кликните по строке агента",
  not_input: "это не поле ввода — кликните по текстовому полю чата",
  window_not_found: "окно не найдено",
  chat_not_found: "чат не найден — перепривяжите через «+ чат Cursor»",
  chat_ambiguous: "найдено несколько чатов — перепривяжите",
  chat_select_failed: "не удалось выбрать чат",
  input_not_found: "поле ввода не найдено — перепривяжите",
  input_ambiguous: "найдено несколько полей — перепривяжите",
  input_focus_failed: "не удалось сфокусировать поле",
  focus_mismatch: "фокус не на текстовом поле",
  chrome_only: "нужен режим доступности Cursor",
  no_cursor: "окно Cursor не найдено",
};

function uiaErr(code, fallback) {
  if (!code) return fallback || "ошибка UIA";
  return UIA_ERROR_RU[code] || String(code);
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
  activeDeckId: "lazy-v1",
  /** @type {'top'|'bottom'|'left'|'right'} */
  dock: "right",
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
/** Keep deck visible while settings window is open */
let settingsHeldPin = false;
let settingsRestorePinned = false;
/** Keep deck visible while targets window is open */
let targetsHeldPin = false;
let targetsRestorePinned = false;

const CONCEAL_ANIM_MS = 300;

function ensureData() {
  fs.mkdirSync(decksDir(), { recursive: true });
  if (!fs.existsSync(settingsPath())) {
    fs.writeFileSync(
      settingsPath(),
      JSON.stringify(defaultSettings, null, 2),
      "utf8"
    );
  }
  // Seed bundled decks if missing (hobby + pro)
  const bundledDecks = [
    ["default-deck.json", "lazy-v1.json"],
    ["pro-deck.json", "pro-v1.json"],
  ];
  for (const [srcName, destName] of bundledDecks) {
    const src = path.join(appRoot(), "data", srcName);
    const dest = path.join(decksDir(), destName);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
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
    if (changed) {
      fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), "utf8");
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
      try {
        fs.writeFileSync(settingsPath(), JSON.stringify(merged, null, 2), "utf8");
      } catch {
        /* ignore */
      }
    } else {
      merged.targets = mig.targets;
    }
    return merged;
  } catch {
    return { ...defaultSettings };
  }
}

function writeSettings(partial) {
  const next = { ...readSettings(), ...partial };
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function listDecks() {
  ensureData();
  const files = fs.readdirSync(decksDir()).filter((f) => f.endsWith(".json"));
  return files
    .map((f) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(decksDir(), f), "utf8"));
        return {
          id: d.id || path.basename(f, ".json"),
          name: d.name || path.basename(f, ".json"),
          file: f,
          cardCount: Array.isArray(d.cards) ? d.cards.length : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function loadDeck(id) {
  ensureData();
  const file = path.join(decksDir(), `${id}.json`);
  if (!fs.existsSync(file)) {
    const first = listDecks()[0];
    if (!first) return { id: "empty", name: "Пусто", cards: [] };
    return loadDeck(first.id);
  }
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(d.cards)) d.cards = [];
  d.cards = d.cards.slice(0, 8);
  return d;
}

function saveDeck(deck) {
  ensureData();
  if (!deck.id) deck.id = `deck-${Date.now()}`;
  deck.cards = (deck.cards || []).slice(0, 8);
  const file = path.join(decksDir(), `${deck.id}.json`);
  fs.writeFileSync(file, JSON.stringify(deck, null, 2), "utf8");
  return deck;
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
    title: "Lazy Coder — Настройки",
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    // Без parent к колоде: иначе always-on-top колоды держит настройки поверх всех окон
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
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

function openChatPickWindow() {
  if (chatPickWindow && !chatPickWindow.isDestroyed()) {
    chatPickWindow.focus();
    return;
  }
  const width = 440;
  const height = 520;
  const wa = workArea();
  const x = Math.round(wa.x + (wa.width - width) / 2);
  const y = Math.round(wa.y + (wa.height - height) / 2);
  chatPickWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 360,
    minHeight: 400,
    title: "Выбор чата Cursor",
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  chatPickWindow.setAlwaysOnTop(true, "floating");
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

  const width = 480;
  const height = 560;
  const wa = workArea();
  const x = Math.round(wa.x + (wa.width - width) / 2);
  const y = Math.round(wa.y + (wa.height - height) / 2);

  targetsWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 400,
    minHeight: 420,
    title: "Lazy Coder — Куда отправлять",
    backgroundColor: "#120a1c",
    autoHideMenuBar: true,
    show: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  targetsWindow.once("ready-to-show", () => {
    if (targetsWindow && !targetsWindow.isDestroyed()) {
      targetsWindow.show();
      targetsWindow.focus();
    }
  });

  targetsWindow.loadFile(path.join(appRoot(), "src", "targets.html"));

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

/** Base: 3×24px buttons + 2×2px gap = 76; card height 2:3 */
function stripMetrics(scale) {
  const s = Math.min(1.5, Math.max(0.75, Number(scale) || 1));
  const btn = Math.round(24 * s);
  const gap = Math.max(1, Math.round(2 * s));
  const strip = 3 * btn + 2 * gap;
  const cardH = Math.round((strip * 3) / 2);
  const titlebarH = btn;
  const cardGap = Math.max(1, Math.round(2 * s));
  return { scale: s, btn, gap, strip, cardH, titlebarH, cardGap };
}

function currentStrip() {
  return stripMetrics(readSettings().panelScale);
}

function railWidth(scale) {
  const s = Math.min(1.5, Math.max(0.75, Number(scale) || 1));
  return Math.round(148 * s);
}

function dockLayout(dock, expanded = expandedMode, scaleOverride = null) {
  const wa = workArea();
  const metrics =
    scaleOverride != null ? stripMetrics(scaleOverride) : currentStrip();
  const { strip: cardStrip, cardH, titlebarH, scale } = metrics;
  const rail = expanded ? 0 : railWidth(scale);
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
      const w = cardStrip + rail + 6 + previewLane + pad + chrome;
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
      const w = cardStrip + rail + 6 + previewLane + pad + chrome;
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
  // Полоса карт + боковой список чатов (не вся зона превью)
  const dock = readSettings().dock || "right";
  const m = currentStrip();
  const rail = railWidth(m.scale);
  const strip = m.strip + rail + 14;
  const barH = m.titlebarH + m.cardH + 10;
  switch (dock) {
    case "left":
      return { x: b.x, y: b.y, width: strip, height: b.height };
    case "right":
      return { x: b.x + b.width - strip, y: b.y, width: strip, height: b.height };
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

  if (near || overPanel || previewHoldOpen || modalHoldOpen) {
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
      if (pinnedOpen || edgeHoverPaused || previewHoldOpen || modalHoldOpen)
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
    },
  });

  deckWindow.setAlwaysOnTop(true, "screen-saver");
  deckWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  deckWindow.loadFile(path.join(appRoot(), "src", "index.html"));

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
  try {
    globalShortcut.register(hotkey, () => {
      toggleDeck();
    });
  } catch (e) {
    console.warn("show hotkey failed", hotkey, e);
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
      globalShortcut.register(card.hotkey, () => {
        pasteCardById(card.id);
      });
    } catch (e) {
      console.warn("card hotkey failed", card.hotkey, e);
    }
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
  return `Окно ${String(win.hwnd).slice(-4)}`;
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
    return { ok: false, error: "не указано поле ввода" };
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
    return { ok: false, error: "не удалось сохранить локаторы чата/поля" };
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
    (chatName || chatLocator.name || "").trim().slice(0, 40) || "Cursor чат";
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
  const root = String(base || "Чат").trim() || "Чат";
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
    return { ok: false, error: status || "ошибка вставки" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function focusAndPasteUia(target, text, autoEnter, pauseMs) {
  const uia = getUiaClient();
  const hwnd = target.hwnd;
  if (!hwnd) return { ok: false, error: "нет hwnd цели" };
  if (!target.chatLocator || !target.inputLocator) {
    return { ok: false, error: "нет UIA-локаторов — перепривяжите чат" };
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
      return { ok: false, error: uiaErr(sel.error, "чат не выбран") };
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
      return { ok: false, error: "не удалось активировать окно" };
    }
    return { ok: false, error: status || "ошибка вставки" };
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
  const base =
    (chatTitle || "").trim().slice(0, 40) ||
    "Cursor чат";
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
    fullTitle: windowTitle || "Cursor",
    match: windowTitle || "Cursor",
    processName: "Cursor",
  };
  writeSettings({ targets: [...(settings.targets || []), target] });
  return { ok: true, duplicate: false, target };
}

async function pasteViaCdp(target, text, autoEnter, cdpPort) {
  const port = Number(target.port) || Number(cdpPort) || DEFAULT_CDP_PORT;
  const cdp = getCdpClient(port);
  try {
    await cdp.sendToChat(
      target.cdpTargetId,
      { id: target.chatId, title: target.chatTitle },
      text,
      { submit: autoEnter === true }
    );
    return { ok: true };
  } catch (e) {
    const msg = String(e.message || e);
    if (/CDP порт|cdp_closed|fetch|ECONNREFUSED/i.test(msg)) {
      return {
        ok: false,
        error: "CDP закрыт — Настройки → Запустить Cursor для фона",
        needsCdp: true,
      };
    }
    if (/chat_not_found/i.test(msg)) {
      return { ok: false, error: "чат не найден — выберите чат снова из списка" };
    }
    if (/input_not_found/i.test(msg)) {
      return { ok: false, error: "поле ввода Cursor не найдено" };
    }
    return { ok: false, error: msg };
  }
}

/** Quiet ValuePattern write — no SetForegroundWindow. */
async function pasteQuietUia(target, text) {
  const uia = getUiaClient();
  try {
    const hwnd = target.hwnd;
    if (!hwnd || !target.inputLocator) {
      return { ok: false, error: "нет локатора поля для тихой записи" };
    }
    // Reuse focusInput path then Value via evaluate in helper — if SetFocus would steal,
    // we only call a dedicated setValue command if available; else skip.
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
        error: uiaErr(res?.error, "программа не принимает текст в фоне"),
      };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: "эта программа не принимает текст в фоне",
    };
  }
}

async function pasteCardById(cardId) {
  const settings = readSettings();
  const deck = loadDeck(settings.activeDeckId);
  const card = (deck.cards || []).find((c) => c.id === cardId);
  if (!card) return { ok: false, error: "Карточка не найдена" };

  const enabled = (settings.targets || []).filter((t) => t.enabled);
  if (!enabled.length) {
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.webContents.send("toast", {
        type: "error",
        message: "Выберите хотя бы одну цель",
      });
    }
    return { ok: false, error: "no targets" };
  }

  const preserveFocus = settings.preserveFocus !== false;
  const windows = preserveFocus ? [] : await listWindows();
  const results = [];
  const prevClip = clipboard.readText();

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
    for (const target of enabled) {
      if (target.needsCdpRebind || (preserveFocus && target.driver !== "cdp" && target.driver !== "uia-quiet")) {
        if (target.needsCdpRebind || (isCursorLikeTarget(target) && target.driver !== "cdp")) {
          results.push({
            target: target.name,
            ok: false,
            error: "перепривяжите через «+ чат Cursor» (фон / CDP)",
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
          const r = await pasteQuietUia(target, card.prompt || "");
          results.push({ target: target.name, ...r });
        } else {
          results.push({
            target: target.name,
            ok: false,
            error: "эта программа не принимает текст в фоне",
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
          error: "перепривяжите через «+ чат Cursor»",
        });
        continue;
      }

      const win = resolveTargetWindow(target, windows);
      if (!win) {
        results.push({
          target: target.name,
          ok: false,
          error: "окно не найдено",
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
          error: "ошибка привязки — добавьте поле заново",
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
            message: "Перепривяжите поле прицелом ⊕ (старая цель без поля)",
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
    if (!preserveFocus) {
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
          ? "Шаг 1/2: кликните по чату/агенту Cursor · Esc — отмена"
          : "Кликните по полю ввода чата · Esc — отмена"
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
        let win = null;
        for (const pt of pickPoints) {
          win = await windowFromPointPhysical(pt.x, pt.y);
          if (win) break;
        }
        if (!win) {
          showPickOverlay("Кликните по полю ввода чата · Esc — отмена");
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
              `${uiaErr(hit.error, "кликните по строке агента в списке слева")} · Esc — отмена`
            );
            return { ok: false, continue: true };
          }
          // If we bound a Button row, climb name is fine; prefer ListItem-like name
          const probe = await uia.probe(hit.hwnd);
          if (probe.status === "chrome_only" || probe.accessible === false) {
            await finish({
              ok: false,
              error:
                "Внутренности Cursor недоступны. Настройки → Интеграция Cursor → запустите с флагом доступности.",
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
            `Шаг 2/2: кликните по полю ввода «${(
              draft.chatName || "чат"
            ).slice(0, 40)}» · Esc — отмена`
          );
          return { ok: true, continue: true };
        }

        const hit = await hitAtPoints("input");
        if (!hit.ok) {
          showPickOverlay(
            `${uiaErr(hit.error, "кликните по полю ввода")} · Esc — отмена`
          );
          return { ok: false, continue: true };
        }
        if (!draft) {
          await finish({ ok: false, error: "сначала кликните по чату" });
          return { ok: false };
        }
        if (String(hit.hwnd) !== String(draft.hwnd)) {
          showPickOverlay("Поле должно быть в том же окне Cursor · Esc — отмена");
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
    };
  });

  ipcMain.handle("save-settings", (_e, partial) => {
    if (partial && partial.panelScale != null) {
      partial = {
        ...partial,
        panelScale: stripMetrics(partial.panelScale).scale,
      };
    }
    const s = writeSettings(partial);
    if (partial.dock || partial.panelScale != null) {
      applyDock(s.dock || "right");
    }
    if (partial.showHotkey) registerShortcuts();
    else if (partial.activeDeckId === undefined) registerShortcuts();
    if (partial.targets) broadcastTargetsUpdated();
    broadcastStateChanged();
    return s;
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

  ipcMain.handle("set-active-deck", (_e, id) => {
    writeSettings({ activeDeckId: id });
    registerShortcuts();
    const deck = loadDeck(id);
    broadcastStateChanged();
    return deck;
  });

  ipcMain.handle("save-deck", (_e, deck) => {
    const saved = saveDeck(deck);
    writeSettings({ activeDeckId: saved.id });
    registerShortcuts();
    broadcastStateChanged();
    return saved;
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
    if (!win?.hwnd) return { ok: false, error: "нет окна" };
    const result = await upsertTargetFromWindow({
      hwnd: String(win.hwnd),
      pid: win.pid,
      processName: win.processName || "",
      title: win.title || "",
    });
    broadcastTargetsUpdated();
    return result;
  });

  ipcMain.handle("paste-card", async (_e, cardId) => pasteCardById(cardId));

  ipcMain.handle("set-ignore-mouse", (_e, ignore) => {
    setDeckIgnoreMouse(!!ignore);
    return true;
  });

  ipcMain.handle("get-cursor-client", () => cursorInDeckClient());

  ipcMain.handle("set-preview-hold", (_e, on) => {
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

  ipcMain.handle("start-target-pick", async (_e, mode) => {
    const result = await startTargetPick(mode);
    edgeHoverPaused = false;
    if (result?.ok) {
      pinnedOpen = true;
      setDeckVisible(true);
      broadcastTargetsUpdated();
      const msg = result.duplicate
        ? `Уже есть: ${result.target.name} (включено)`
        : `Цель: ${result.target.name}`;
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
      const errMsg = result?.error || "Не выбрано";
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
        ? `CDP открыт · окон ${probe.targetCount} · чатов≈${chatsTotal}`
        : "CDP закрыт. Закройте Cursor и нажмите «Запустить Cursor для фона».";
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

  ipcMain.handle("cursor-launch-integration", async (_e, opts = {}) => {
    const settings = readSettings();
    const port = Number(opts.cdpPort) || settings.cdpPort || DEFAULT_CDP_PORT;
    const mode = opts.mode || "both";
    const result = await launchCursorForIntegration({ mode, cdpPort: port });
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
            ? "Готово: Cursor запущен для фона (CDP)"
            : "Cursor запускается — повторите «Проверить» через пару секунд",
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
      return { ok: false, error: "CDP закрыт — запустите Cursor для фона", windows: [] };
    }
    return { ok: true, windows: probe.targets || [], port: probe.port };
  });

  ipcMain.handle("cdp-list-chats", async (_e, cdpTargetId) => {
    const settings = readSettings();
    const cdp = getCdpClient(settings.cdpPort || DEFAULT_CDP_PORT);
    const list = await cdp.listChats(cdpTargetId);
    return list;
  });

  ipcMain.handle("cdp-add-chat", async (_e, payload) => {
    const settings = readSettings();
    const result = upsertTargetFromCdp({
      cdpTargetId: payload?.cdpTargetId,
      windowTitle: payload?.windowTitle,
      chatId: payload?.chatId || payload?.id,
      chatTitle: payload?.chatTitle || payload?.title,
      port: settings.cdpPort || DEFAULT_CDP_PORT,
    });
    if (result.ok) broadcastTargetsUpdated();
    return result;
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
          ? `CDP: окон ${probe.targetCount}, чатов≈${chatsTotal}`
          : "CDP закрыт — нужен запуск Cursor для фона",
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

  ipcMain.handle("export-deck", async (_e, deckId) => {
    const deck = loadDeck(deckId);
    const { filePath, canceled } = await dialog.showSaveDialog(dialogParent(), {
      title: "Экспорт колоды",
      defaultPath: `${deck.name || deck.id}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false };
    fs.writeFileSync(filePath, JSON.stringify(deck, null, 2), "utf8");
    return { ok: true, filePath };
  });

  ipcMain.handle("import-deck", async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog(dialogParent(), {
      title: "Импорт колоды",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || !filePaths?.[0]) return { ok: false };
    try {
      const deck = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
      if (!deck.id) deck.id = `imported-${Date.now()}`;
      if (!deck.name) deck.name = "Импорт";
      deck.cards = (deck.cards || []).slice(0, 8);
      saveDeck(deck);
      writeSettings({ activeDeckId: deck.id });
      registerShortcuts();
      broadcastStateChanged();
      return { ok: true, deck };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });

  ipcMain.handle("new-deck", (_e, name) => {
    const id = `deck-${Date.now()}`;
    const deck = {
      id,
      name: name || "Новая колода",
      cards: [
        {
          id: `card-${Date.now()}`,
          title: "Новая",
          description: "Описание",
          prompt: "Текст промпта…",
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

  ipcMain.handle("delete-deck", (_e, id) => {
    if (id === "lazy-v1" || id === "pro-v1") {
      return { ok: false, error: "Стандартную колоду нельзя удалить" };
    }
    const file = path.join(decksDir(), `${id}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const settings = readSettings();
    if (settings.activeDeckId === id) {
      writeSettings({ activeDeckId: "lazy-v1" });
    }
    registerShortcuts();
    broadcastStateChanged();
    return { ok: true };
  });

  ipcMain.handle("open-data-folder", () => {
    ensureData();
    shell.openPath(userDataDir());
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
      bypassCSP: true,
    },
  },
]);

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    // app://tarot/magician.jpg
    if (url.hostname === "tarot") {
      const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
      const filePath = path.join(appRoot(), "assets", "tarot", name);
      if (fs.existsSync(filePath)) {
        return net.fetch(pathToFileURL(filePath).href);
      }
    }
    return new Response("Not found", { status: 404 });
  });

  ensureData();
  setupIpc();
  createDeckWindow();
  registerShortcuts();
  pinnedOpen = false;
  applyDock(readSettings().dock || "right", false);
  // Edge hover только после deck-ui-ready из рендерера (полная загрузка)
});

app.on("will-quit", () => {
  app.isQuitting = true;
  if (edgePollTimer) clearInterval(edgePollTimer);
  if (hideDelayTimer) clearTimeout(hideDelayTimer);
  cancelConcealAnim();
  clearShortcuts();
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
