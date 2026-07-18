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

const execFileAsync = promisify(execFile);

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

const userDataDir = () => path.join(app.getPath("userData"), "keycode-data");
const decksDir = () => path.join(userDataDir(), "decks");
const settingsPath = () => path.join(userDataDir(), "settings.json");

const defaultSettings = {
  autoEnter: true,
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
  const defaultDeckSrc = path.join(appRoot(), "data", "default-deck.json");
  const defaultDeckDest = path.join(decksDir(), "lazy-v1.json");
  if (!fs.existsSync(defaultDeckDest) && fs.existsSync(defaultDeckSrc)) {
    fs.copyFileSync(defaultDeckSrc, defaultDeckDest);
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
    return { ...defaultSettings, ...raw };
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

function dockLayout(dock, expanded = expandedMode, scaleOverride = null) {
  const wa = workArea();
  const { strip: cardStrip, cardH, titlebarH } =
    scaleOverride != null ? stripMetrics(scaleOverride) : currentStrip();
  const previewLane = expanded ? 0 : 300;
  const chrome = expanded ? 240 : 0;
  const pad = 6;

  switch (dock) {
    case "top": {
      // Карты + кнопки у верха; ниже — полоса под описание (клики сквозь неё)
      const tipLane = expanded ? 0 : 260;
      const height = titlebarH + cardH + 4 + tipLane + chrome + pad * 2;
      return {
        x: wa.x,
        y: wa.y,
        width: wa.width,
        height: Math.min(height + (expanded ? 40 : 0), Math.floor(wa.height * 0.5)),
        horizontal: true,
        expanded,
      };
    }
    case "bottom": {
      // Карты + кнопки у низа; выше — полоса под описание
      const tipLane = expanded ? 0 : 260;
      const height = titlebarH + cardH + 4 + tipLane + chrome + pad * 2;
      const h = Math.min(height + (expanded ? 40 : 0), Math.floor(wa.height * 0.5));
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
      const w = cardStrip + previewLane + pad + chrome;
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
      const w = cardStrip + previewLane + pad + chrome;
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
  // Только полоса карт/кнопок — не вся прозрачная зона превью (иначе блокирует клики «рядом»)
  const dock = readSettings().dock || "right";
  const m = currentStrip();
  const strip = m.strip + 8;
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

  if (near || overPanel || previewHoldOpen) {
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
      if (pinnedOpen || edgeHoverPaused || previewHoldOpen) return;
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
  globalShortcut.unregisterAll();
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

function registerShortcuts() {
  globalShortcut.unregisterAll();
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

async function listWindows() {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static List<string> List() {
    var list = new List<string>();
    EnumWindows((hWnd, l) => {
      if (!IsWindowVisible(hWnd)) return true;
      int len = GetWindowTextLength(hWnd);
      if (len == 0) return true;
      var sb = new StringBuilder(len + 1);
      GetWindowText(hWnd, sb, sb.Capacity);
      uint pid; GetWindowThreadProcessId(hWnd, out pid);
      list.Add(hWnd.ToInt64() + "\\t" + pid + "\\t" + sb.ToString());
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
      .map((line) => {
        const [hwnd, pid, ...rest] = line.split("\t");
        const title = rest.join("\t");
        return { hwnd, pid, title };
      })
      .filter((w) => w.title && !/keycode|lazy coder/i.test(w.title));
  } catch (e) {
    console.error(e);
    return [];
  }
}

async function windowFromPoint(screenX, screenY) {
  const script = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinPoint {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  public static string At(int x, int y) {
    POINT pt; pt.X = x; pt.Y = y;
    IntPtr h = WindowFromPoint(pt);
    if (h == IntPtr.Zero) return "";
    IntPtr root = GetAncestor(h, 2); // GA_ROOT
    if (root != IntPtr.Zero) h = root;
    int len = GetWindowTextLength(h);
    var sb = new StringBuilder(Math.Max(len, 1) + 1);
    GetWindowText(h, sb, sb.Capacity);
    uint pid; GetWindowThreadProcessId(h, out pid);
    return h.ToInt64() + "\\t" + pid + "\\t" + sb.ToString();
  }
}
"@
[WinPoint]::At(${Math.round(screenX)}, ${Math.round(screenY)})
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const line = (stdout || "").trim();
    if (!line) return null;
    const [hwnd, pid, ...rest] = line.split("\t");
    const title = rest.join("\t");
    if (!title || /keycode|lazy coder/i.test(title)) return null;
    return { hwnd, pid, title };
  } catch (e) {
    console.error(e);
    return null;
  }
}

async function focusAndPaste(hwnd, text, autoEnter, pauseMs) {
  clipboard.writeText(text);

  const enterBlock = autoEnter
    ? `
Start-Sleep -Milliseconds 80
[WinPaste]::KeyDown(0x0D)
Start-Sleep -Milliseconds 30
[WinPaste]::KeyUp(0x0D)
`
    : "";

  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinPaste {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public static void KeyDown(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); }
  public static void KeyUp(byte vk) { keybd_event(vk, 0, 2, UIntPtr.Zero); }
}
"@
$h = [IntPtr]${Number(hwnd)}
[WinPaste]::ShowWindow($h, 9) | Out-Null
[WinPaste]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds ${Math.max(100, pauseMs || 350)}
[WinPaste]::KeyDown(0x11)
[WinPaste]::KeyDown(0x56)
Start-Sleep -Milliseconds 40
[WinPaste]::KeyUp(0x56)
[WinPaste]::KeyUp(0x11)
${enterBlock}
`;

  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
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
      setDeckVisible(true);
    }
    return { ok: false, error: "no targets" };
  }

  const windows = await listWindows();
  const results = [];
  const prevClip = clipboard.readText();

  edgeHoverPaused = true;
  // Колоду не скрываем — только отпускаем always-on-top, чтобы чат получил фокус
  if (deckWindow && !deckWindow.isDestroyed()) {
    deckWindow.setAlwaysOnTop(false);
  }

  try {
    for (const target of enabled) {
      const match = (target.match || target.name || "").toLowerCase();
      const win =
        windows.find((w) => w.title.toLowerCase().includes(match)) ||
        (target.hwnd &&
          windows.find((w) => String(w.hwnd) === String(target.hwnd)));

      if (!win) {
        results.push({
          target: target.name,
          ok: false,
          error: "окно не найдено",
        });
        continue;
      }

      const r = await focusAndPaste(
        win.hwnd,
        card.prompt || "",
        settings.autoEnter !== false,
        settings.pauseMs
      );
      results.push({ target: target.name, ...r });

      await new Promise((r) => setTimeout(r, settings.pauseMs || 350));
    }
  } finally {
    try {
      clipboard.writeText(prevClip);
    } catch {
      /* ignore */
    }
    if (deckWindow && !deckWindow.isDestroyed()) {
      deckWindow.setAlwaysOnTop(true, "screen-saver");
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

function startTargetPick() {
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
      resolve(payload);
    };

    try {
      ipcMain.removeHandler("pick-click");
      ipcMain.removeHandler("pick-cancel");
    } catch {
      /* ignore */
    }

    ipcMain.handle("pick-click", async (_e, { screenX, screenY }) => {
      // Hide overlay so WindowFromPoint sees real window under cursor
      if (pickWindow && !pickWindow.isDestroyed()) {
        pickWindow.hide();
      }
      await new Promise((r) => setTimeout(r, 50));
      const win = await windowFromPoint(screenX, screenY);
      if (!win) {
        await finish({ ok: false, error: "Окно не найдено — кликните по заголовку чата" });
        return { ok: false };
      }
      const short =
        win.title.match(
          /Cursor|ChatGPT|Claude|Grok|VS Code|Code|Windsurf|Chrome|Edge|Firefox|Copilot/i
        )?.[0] || win.title.slice(0, 32);
      const settings = readSettings();
      const existing = (settings.targets || []).find(
        (t) => String(t.hwnd) === String(win.hwnd)
      );
      if (existing) {
        const targets = (settings.targets || []).map((t) =>
          t.id === existing.id ? { ...t, enabled: true, fullTitle: win.title } : t
        );
        writeSettings({ targets });
        await finish({ ok: true, target: existing, duplicate: true });
        return { ok: true };
      }
      const target = {
        id: `tgt-${Date.now()}`,
        name: short,
        match: short,
        hwnd: win.hwnd,
        enabled: true,
        fullTitle: win.title,
      };
      const targets = [...(settings.targets || []), target];
      writeSettings({ targets });
      await finish({ ok: true, target });
      return { ok: true };
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

  ipcMain.handle("paste-card", async (_e, cardId) => pasteCardById(cardId));

  ipcMain.handle("set-ignore-mouse", (_e, ignore) => {
    setDeckIgnoreMouse(!!ignore);
    return true;
  });

  ipcMain.handle("set-preview-hold", (_e, on) => {
    previewHoldOpen = !!on;
    return true;
  });

  ipcMain.handle("start-target-pick", async () => {
    const result = await startTargetPick();
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
    if (id === "lazy-v1") {
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
  globalShortcut.unregisterAll();
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
  app.quit();
} else {
  app.on("second-instance", () => {
    if (deckWindow && !deckWindow.isDestroyed()) {
      pinnedOpen = true;
      setDeckVisible(true);
    }
  });
}
