/** @typedef {{ id: string, title: string, description: string, prompt: string, image: string, hotkey?: string }} Card */
/** @typedef {{ id: string, name: string, cards: Card[] }} Deck */
/** @typedef {{ id: string, name: string, match: string, hwnd?: string, enabled: boolean }} Target */

let state = {
  settings: null,
  decks: [],
  deck: /** @type {Deck | null} */ (null),
  editMode: false,
  editingCardId: null,
  dock: "right",
  horizontal: false,
  expanded: false,
  revealed: false,
  fullscreenEdit: false,
  pinnedOpen: false,
  previewCardId: null,
  settingsWindowOpen: false,
  targetsWindowOpen: false,
  transcriptHash: "",
  transcriptStickBottom: true,
  transcriptTargetId: "",
  /** @type {Array<{ cardId: string, rank: 1 | 2 }>} */
  suggestions: [],
};

/** @type {ReturnType<typeof setInterval> | null} */
let transcriptPollTimer = null;
let transcriptBusy = false;

const $ = (id) => document.getElementById(id);

function toast(message, type = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${type}`.trim();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.add("hidden");
  }, 2800);
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function applyDockClass(dock, horizontal, expanded) {
  state.dock = dock || "right";
  state.horizontal = !!horizontal;
  state.expanded = !!expanded;
  document.body.classList.remove(
    "dock-top",
    "dock-bottom",
    "dock-left",
    "dock-right",
    "horizontal",
    "expanded"
  );
  document.body.classList.add(`dock-${state.dock}`);
  if (state.horizontal) document.body.classList.add("horizontal");
  if (state.expanded) {
    document.body.classList.add("expanded");
    document.body.classList.remove("cards-only");
  } else {
    document.body.classList.add("cards-only");
  }

  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-dock") === state.dock);
  });
  applySideLayoutClass();
}

function isSideDock() {
  return state.dock === "right" || state.dock === "left";
}

/** Side tarot table (default). Classic strip when settings.sideCardLayout === "strip". */
function isSideTable() {
  return (
    isSideDock() &&
    !state.fullscreenEdit &&
    state.settings?.sideCardLayout !== "strip"
  );
}

function applySideLayoutClass() {
  const table =
    isSideDock() &&
    !state.fullscreenEdit &&
    state.settings?.sideCardLayout !== "strip";
  document.body.classList.toggle("side-layout-table", table);
  document.body.classList.toggle(
    "side-layout-strip",
    isSideDock() && !state.fullscreenEdit && !table
  );
}

/** Подсказка только после окончания выезда карт — иначе налезает на полосу */
let previewAllowed = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let previewAllowTimer = null;
const REVEAL_MS = 400;

function setPreviewAllowed(on) {
  if (previewAllowTimer) {
    clearTimeout(previewAllowTimer);
    previewAllowTimer = null;
  }
  previewAllowed = !!on;
  if (!previewAllowed) hideCardPreview();
}

function setRevealed(on) {
  state.revealed = !!on;
  document.body.classList.toggle("revealed", state.revealed);
  document.body.classList.toggle("concealing", !state.revealed);
  if (!state.revealed) {
    setPreviewAllowed(false);
    return;
  }
  // Ждём конец slide-in, потом можно показывать расшифровку
  setPreviewAllowed(false);
  previewAllowTimer = setTimeout(() => {
    previewAllowTimer = null;
    previewAllowed = true;
    // Курсор мог уже стоять над кнопкой без mousemove — обновить клики
    syncMousePassthroughFromCursor();
  }, REVEAL_MS);
}

function applyFullscreenEdit(on) {
  state.fullscreenEdit = !!on;
  document.body.classList.toggle("fullscreen-edit", state.fullscreenEdit);
  if (state.fullscreenEdit) {
    state.editMode = true;
    document.body.classList.add("edit-mode", "expanded");
    document.body.classList.remove("cards-only");
    $("btn-edit-mode")?.classList.add("active");
    applySideLayoutClass();
  } else {
    state.editMode = false;
    document.body.classList.remove("edit-mode");
    applyDockClass(state.dock, state.horizontal, state.expanded);
    $("btn-edit-mode")?.classList.remove("active");
  }
}

function applyOpacity(settings) {
  const ui =
    typeof settings?.uiOpacity === "number" ? settings.uiOpacity : 0.8;
  const title =
    typeof settings?.titleOpacity === "number" ? settings.titleOpacity : 1;
  document.documentElement.style.setProperty("--ui-opacity", String(ui));
  document.documentElement.style.setProperty("--title-opacity", String(title));
}

function applyCardFonts(settings) {
  const tarot = Number(settings?.cardTarotFontPx) || 16;
  const action = Number(settings?.cardActionFontPx) || 13;
  document.documentElement.style.setProperty("--card-tarot-size", `${tarot}px`);
  document.documentElement.style.setProperty("--card-action-size", `${action}px`);
}

/** Карты и кнопки одной ширины: масштаб задаёт размер кнопки → ширина полосы = ширина карты */
function applyPanelScale(settings) {
  const s = Math.min(1.5, Math.max(0.75, Number(settings?.panelScale) || 1));
  const btn = Math.round(24 * s);
  const gap = Math.max(1, Math.round(2 * s));
  const cardGap = Math.max(1, Math.round(2 * s));
  const root = document.documentElement;
  root.style.setProperty("--corner-btn-size", `${btn}px`);
  root.style.setProperty("--corner-gap", `${gap}px`);
  root.style.setProperty("--titlebar-h", `${btn}px`);
  root.style.setProperty("--card-gap", `${cardGap}px`);
  root.style.setProperty("--hub-w", `${Math.round(btn + 12)}px`);
  root.style.setProperty("--rail-w", `${Math.round(148 * s)}px`);
  root.style.setProperty("--radius", `${Math.round(8 * s)}px`);
  root.style.setProperty("--radius-inner", `${Math.round(6 * s)}px`);
  root.style.setProperty("--corner-font-size", `${Math.max(11, Math.round(14 * s))}px`);
  root.style.setProperty("--table-gap", `${Math.max(2, Math.round(4 * s))}px`);
}

function waitForCardImages(timeoutMs = 1200) {
  const imgs = [...document.querySelectorAll("#cards img")];
  if (!imgs.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = imgs.length;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    const one = () => {
      left -= 1;
      if (left <= 0) {
        clearTimeout(timer);
        finish();
      }
    };
    for (const img of imgs) {
      if (img.complete) one();
      else {
        img.addEventListener("load", one, { once: true });
        img.addEventListener("error", one, { once: true });
      }
    }
  });
}

function applyI18nPack(pack) {
  if (pack) window.I18n.setPack(pack);
  window.I18n.applyDom();
  const hide = document.getElementById("btn-corner-hide");
  if (hide) {
    const hotkey = state.settings?.showHotkey || "F9";
    hide.title = window.I18n.t("deck.hideTitle", { hotkey });
  }
}

async function refresh() {
  const data = await window.keycode.getState();
  state.settings = data.settings;
  state.decks = data.decks;
  state.deck = data.deck;
  state.pinnedOpen = !!data.pinnedOpen;
  applyI18nPack(data.i18n);
  applyDockClass(data.dock || data.settings?.dock, data.horizontal, data.expanded);
  applyFullscreenEdit(!!data.fullscreenEdit);
  applyOpacity(data.settings);
  applyCardFonts(data.settings);
  applyPanelScale(data.settings);
  renderAll();
  maybeShowOnboarding();
}

function renderAll() {
  renderDeckSelect();
  syncTargetsBadge();
  renderDestBar();
  syncDeckTranscript();
  renderCards();
  document.body.classList.toggle("edit-mode", state.editMode);
}

/** Count of destinations the next card paste will hit (mirrors main resolvePasteTargets). */
function resolveDestCount(settings) {
  const targets = settings?.targets || [];
  if (!targets.length) return 0;
  if (String(settings?.pasteMode || "").toLowerCase() === "solo") {
    const id = settings?.activeTargetId;
    return id && targets.some((t) => t.id === id) ? 1 : 0;
  }
  const presetId = settings?.activePresetId;
  const presets = settings?.targetPresets || [];
  const preset = presetId ? presets.find((p) => p.id === presetId) : null;
  if (preset) {
    const ids = new Set(preset.targetIds || []);
    return targets.filter((t) => ids.has(t.id)).length;
  }
  return targets.filter((t) => t.enabled).length;
}

function renderDeckSelect() {
  const nameEl = $("deck-page-name");
  const prevBtn = $("btn-deck-prev");
  const nextBtn = $("btn-deck-next");
  if (!nameEl || !prevBtn || !nextBtn) return;

  const decks = state.decks || [];
  const activeId = state.settings?.activeDeckId;
  const active =
    decks.find((d) => d.id === activeId) ||
    decks[0] ||
    state.deck ||
    null;
  const label = active?.name || active?.id || "—";
  const prevLabel = nameEl.textContent;
  if (prevLabel && prevLabel !== "—" && prevLabel !== label) {
    nameEl.classList.add("is-swap");
    window.setTimeout(() => {
      nameEl.textContent = label;
      nameEl.title = label;
      nameEl.classList.remove("is-swap");
    }, 90);
  } else {
    nameEl.textContent = label;
    nameEl.title = label;
    nameEl.classList.remove("is-swap");
  }

  const canPage = decks.length > 1;
  prevBtn.disabled = !canPage;
  nextBtn.disabled = !canPage;
}

async function cycleDeck(step) {
  const decks = state.decks || [];
  if (decks.length < 2) return;
  const activeId = state.settings?.activeDeckId || state.deck?.id;
  let idx = decks.findIndex((d) => d.id === activeId);
  if (idx < 0) idx = 0;
  const next = decks[(idx + step + decks.length) % decks.length];
  if (!next?.id) return;
  await window.keycode.setActiveDeck(next.id);
  await refresh();
}

function syncTargetsBadge() {
  const badge = $("target-badge");
  const btn = $("btn-corner-targets");
  const targets = state.settings?.targets || [];
  const destCount = resolveDestCount(state.settings);
  const solo = String(state.settings?.pasteMode || "").toLowerCase() === "solo";
  if (badge && btn) {
    if (!targets.length) {
      badge.textContent = "!";
      badge.classList.remove("hidden");
      badge.classList.add("warn");
      btn.title = window.I18n.t("rail.targetsManage");
    } else if (!destCount) {
      badge.textContent = "0";
      badge.classList.remove("hidden", "warn");
      btn.title = solo
        ? window.I18n.t("rail.targetsPickSolo")
        : window.I18n.t("rail.targetsNone");
    } else {
      badge.textContent = String(destCount);
      badge.classList.remove("hidden", "warn");
      btn.title = solo
        ? window.I18n.t("rail.targetsSolo", { n: destCount })
        : window.I18n.t("rail.targetsCount", { n: destCount });
    }
  }
}

function shortDestLabel(name, max = 10) {
  const s = String(name || "").trim() || "…";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function renderDestBar() {
  const bar = $("dest-bar");
  const presetsEl = $("dest-presets");
  const chipsEl = $("dest-chips");
  if (!bar || !presetsEl || !chipsEl) return;

  const targets = state.settings?.targets || [];
  if (!targets.length) {
    bar.classList.add("hidden");
    presetsEl.innerHTML = "";
    chipsEl.innerHTML = "";
    return;
  }

  bar.classList.remove("hidden");
  const mode = String(state.settings?.pasteMode || "broadcast").toLowerCase();
  const activePresetId = state.settings?.activePresetId || "";
  const activeTargetId = state.settings?.activeTargetId || "";
  const presets = state.settings?.targetPresets || [];

  presetsEl.innerHTML = presets
    .map((p) => {
      const active = mode === "broadcast" && p.id === activePresetId;
      return `<button type="button" class="dest-pill${active ? " active" : ""}" data-preset="${escapeAttr(
        p.id
      )}" title="${escapeAttr(p.name)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(
        shortDestLabel(p.name, 8)
      )}</button>`;
    })
    .join("");

  chipsEl.innerHTML = targets
    .map((t) => {
      const active = mode === "solo" && t.id === activeTargetId;
      return `<button type="button" class="dest-chip${active ? " active" : ""}" data-target="${escapeAttr(
        t.id
      )}" title="${escapeAttr(t.name)}" aria-pressed="${active ? "true" : "false"}">${escapeHtml(
        shortDestLabel(t.name, 9)
      )}</button>`;
    })
    .join("");
}

async function selectDestSolo(targetId) {
  if (!targetId) return;
  // Drop old chat highlights immediately (before async transcript load)
  if (state.settings?.activeTargetId !== targetId) {
    clearDeckSuggestions();
    state.transcriptTargetId = "";
    state.transcriptHash = "";
  }
  state.settings = await window.keycode.saveSettings({
    pasteMode: "solo",
    activeTargetId: targetId,
  });
  renderAll();
}

async function selectDestPreset(presetId) {
  const presets = state.settings?.targetPresets || [];
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return;

  // Toggle off → fall back to enabled checkboxes
  if (
    String(state.settings?.pasteMode) === "broadcast" &&
    state.settings?.activePresetId === presetId
  ) {
    clearDeckSuggestions();
    state.settings = await window.keycode.saveSettings({
      pasteMode: "broadcast",
      activePresetId: "",
    });
    renderAll();
    return;
  }

  clearDeckSuggestions();
  const ids = new Set(preset.targetIds || []);
  const targets = (state.settings?.targets || []).map((t) => ({
    ...t,
    enabled: ids.has(t.id),
  }));
  state.settings = await window.keycode.saveSettings({
    pasteMode: "broadcast",
    activePresetId: presetId,
    targets,
  });
  renderAll();
}

function soloCdpTarget() {
  const settings = state.settings;
  if (String(settings?.pasteMode || "").toLowerCase() !== "solo") return null;
  const id = settings?.activeTargetId;
  if (!id) return null;
  const t = (settings?.targets || []).find((x) => x.id === id);
  if (!t || t.driver !== "cdp") return null;
  return t;
}

function prepareDeckMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  const seen = new Set();
  for (const m of list) {
    const role = m?.role === "user" ? "user" : "assistant";
    const text = String(m?.text || "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) continue;
    const flat = text.replace(/\s+/g, " ").toLowerCase();
    const key = role + "|" + flat;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, text });
  }
  // Keep last ~24 bubbles so the pane stays light
  return out.slice(-24);
}

function renderDeckMessages(messages) {
  const root = $("deck-transcript-msgs");
  const empty = $("deck-transcript-empty");
  if (!root || !empty) return;
  const list = prepareDeckMessages(messages);
  root.innerHTML = "";
  if (!list.length) {
    empty.classList.remove("hidden");
    empty.textContent = window.I18n.t("deck.transcriptEmpty");
    return;
  }
  empty.classList.add("hidden");
  const frag = document.createDocumentFragment();
  for (const m of list) {
    const wrap = document.createElement("article");
    wrap.className = `deck-msg ${m.role === "user" ? "user" : "assistant"}`;
    const role = document.createElement("div");
    role.className = "deck-msg-role";
    role.textContent =
      m.role === "user"
        ? window.I18n.t("deck.transcriptYou")
        : window.I18n.t("deck.transcriptAgent");
    const bubble = document.createElement("div");
    bubble.className = "deck-msg-bubble";
    bubble.textContent = m.text;
    wrap.appendChild(role);
    wrap.appendChild(bubble);
    frag.appendChild(wrap);
  }
  root.appendChild(frag);
  if (state.transcriptStickBottom) {
    root.scrollTop = root.scrollHeight;
  }
}

function stopTranscriptPoll() {
  if (transcriptPollTimer) {
    clearInterval(transcriptPollTimer);
    transcriptPollTimer = null;
  }
}

function startTranscriptPoll() {
  stopTranscriptPoll();
  transcriptPollTimer = setInterval(() => {
    refreshDeckTranscript({ select: false }).catch(() => {});
  }, 2500);
}

function clampTranscriptHeight(px) {
  const n = Number(px);
  if (!Number.isFinite(n)) return 168;
  return Math.min(420, Math.max(80, Math.round(n)));
}

function applyTranscriptHeight(px) {
  const pane = $("deck-transcript");
  if (!pane) return;
  const h = clampTranscriptHeight(px ?? state.settings?.deckTranscriptHeightPx);
  pane.style.height = `${h}px`;
}

function syncTranscriptToggleBtn(open) {
  const btn = $("btn-transcript-toggle");
  if (!btn) return;
  const isOpen = open !== false;
  btn.setAttribute("aria-pressed", isOpen ? "true" : "false");
  const titleKey = isOpen ? "deck.transcriptHide" : "deck.transcriptShow";
  const title = window.I18n.t(titleKey);
  btn.title = title;
  btn.setAttribute("aria-label", title);
  const icon = btn.querySelector("span");
  if (icon) icon.textContent = isOpen ? "▴" : "▾";
}

async function toggleDeckTranscript() {
  const open = state.settings?.deckTranscriptOpen !== false;
  state.settings = await window.keycode.saveSettings({
    deckTranscriptOpen: !open,
  });
  syncDeckTranscript();
}

function syncDeckTranscript() {
  const pane = $("deck-transcript");
  const empty = $("deck-transcript-empty");
  const toggle = $("btn-transcript-toggle");
  if (!pane || !empty) return;

  const mode = String(state.settings?.pasteMode || "broadcast").toLowerCase();
  const targets = state.settings?.targets || [];
  const wantOpen = state.settings?.deckTranscriptOpen !== false;
  applyTranscriptHeight(state.settings?.deckTranscriptHeightPx);
  syncTranscriptToggleBtn(wantOpen);

  if (!targets.length) {
    pane.classList.add("hidden");
    if (toggle) toggle.classList.add("hidden");
    stopTranscriptPoll();
    state.transcriptHash = "";
    state.transcriptTargetId = "";
    clearDeckSuggestions();
    return;
  }
  if (toggle) toggle.classList.remove("hidden");

  if (!wantOpen) {
    pane.classList.add("hidden");
    stopTranscriptPoll();
    return;
  }

  // Show pane when open — hint in broadcast, live in solo
  pane.classList.remove("hidden");

  if (mode !== "solo") {
    stopTranscriptPoll();
    state.transcriptHash = "";
    state.transcriptTargetId = "";
    clearDeckSuggestions();
    $("deck-transcript-msgs").innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = window.I18n.t("deck.transcriptPick");
    pane.classList.remove("is-generating");
    return;
  }

  const target = soloCdpTarget();
  if (!target) {
    stopTranscriptPoll();
    state.transcriptHash = "";
    state.transcriptTargetId = "";
    clearDeckSuggestions();
    $("deck-transcript-msgs").innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = window.I18n.t("deck.transcriptNotCdp");
    pane.classList.remove("is-generating");
    return;
  }

  const switched = state.transcriptTargetId !== target.id;
  if (switched) {
    state.transcriptTargetId = target.id;
    state.transcriptHash = "";
    state.transcriptStickBottom = true;
    clearDeckSuggestions();
    $("deck-transcript-msgs").innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = window.I18n.t("deck.transcriptLoading");
    refreshDeckTranscript({ select: true }).catch(() => {});
  }
  if (!transcriptPollTimer) startTranscriptPoll();
}

async function refreshDeckTranscript({ select = false } = {}) {
  if (state.settings?.deckTranscriptOpen === false) return;
  const target = soloCdpTarget();
  const pane = $("deck-transcript");
  const empty = $("deck-transcript-empty");
  if (!target || !pane || transcriptBusy) return;
  if (!state.revealed && !state.pinnedOpen && !state.fullscreenEdit) {
    // Still allow first fetch after chip click while revealed briefly
  }
  transcriptBusy = true;
  try {
    const result = await window.keycode.readDeckChat({
      targetId: target.id,
      select: !!select,
    });
    if (!soloCdpTarget() || soloCdpTarget()?.id !== target.id) return;
    if (!result?.ok) {
      if (!state.transcriptHash) {
        empty.classList.remove("hidden");
        empty.textContent =
          result?.hint === "not_cdp"
            ? window.I18n.t("deck.transcriptNotCdp")
            : window.I18n.t("deck.transcriptError");
        $("deck-transcript-msgs").innerHTML = "";
      }
      pane.classList.remove("is-generating");
      clearDeckSuggestions();
      return;
    }
    const hash = String(result.hash || "");
    if (hash && hash === state.transcriptHash) {
      pane.classList.toggle("is-generating", result.generating === true);
      // Still apply suggestions when idle (deck may have changed)
      if (result.generating !== true && Array.isArray(result.suggestions)) {
        applyDeckSuggestions(result.suggestions);
      }
      return;
    }
    state.transcriptHash = hash || state.transcriptHash;
    renderDeckMessages(result.messages || []);
    pane.classList.toggle("is-generating", result.generating === true);
    if (result.generating === true) {
      // Keep cleared/frozen highlights while Cursor is generating
    } else if (Array.isArray(result.suggestions)) {
      applyDeckSuggestions(result.suggestions);
    } else {
      clearDeckSuggestions();
    }
  } finally {
    transcriptBusy = false;
  }
}

function applyDeckSuggestions(list) {
  const next = Array.isArray(list) ? list : [];
  const prev = state.suggestions || [];
  const same =
    prev.length === next.length &&
    prev.every(
      (s, i) => s.cardId === next[i].cardId && Number(s.rank) === Number(next[i].rank)
    );
  state.suggestions = next;
  if (!same) renderCards();
}

function clearDeckSuggestions() {
  if (!(state.suggestions || []).length) {
    // DOM may still show stale classes if a prior clear skipped render
    const root = $("cards");
    if (root?.classList.contains("has-suggestions")) renderCards();
    return;
  }
  state.suggestions = [];
  renderCards();
}

function shortAction(text, maxWords = 2) {
  const words = String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.slice(0, maxWords).join(" ");
}

function hideCardPreview() {
  cancelPreviewHide();
  const el = $("card-preview");
  if (!el) return;
  el.classList.remove("visible");
  el.classList.add("hidden");
  el.setAttribute("aria-hidden", "true");
  el.style.maxHeight = "";
  el.style.width = "";
  el.style.left = "";
  el.style.top = "";
  state.previewCardId = null;
  window.keycode.setPreviewHold?.(false);
}

let previewHideTimer = null;

function cancelPreviewHide() {
  if (previewHideTimer) {
    clearTimeout(previewHideTimer);
    previewHideTimer = null;
  }
}

function schedulePreviewHide() {
  cancelPreviewHide();
  previewHideTimer = setTimeout(() => {
    previewHideTimer = null;
    hideCardPreview();
  }, 400);
}

const PREVIEW_BRIDGE_PX = 14;

function cardAtPoint(x, y) {
  for (const card of document.querySelectorAll(".card")) {
    const r = card.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return card;
    }
  }
  const el = document.elementFromPoint(x, y);
  return el?.closest?.(".card") || null;
}

function pointInPreview(x, y) {
  const preview = $("card-preview");
  if (!preview || preview.classList.contains("hidden")) return false;

  const r = preview.getBoundingClientRect();
  let left = r.left;
  let right = r.right;
  let top = r.top;
  let bottom = r.bottom;
  const dock = state.dock || "right";

  if (dock === "right") right += PREVIEW_BRIDGE_PX;
  else if (dock === "left") left -= PREVIEW_BRIDGE_PX;
  else if (dock === "top") top -= PREVIEW_BRIDGE_PX;
  else bottom += PREVIEW_BRIDGE_PX;

  return x >= left && x <= right && y >= top && y <= bottom;
}

function deckIsActiveWindow() {
  return document.hasFocus();
}

function updatePreviewHover(clientX, clientY) {
  if (state.settingsWindowOpen || state.targetsWindowOpen) {
    if (!$("card-preview").classList.contains("hidden")) hideCardPreview();
    return;
  }
  if (state.settings?.showCardPreview === false) {
    if (!$("card-preview").classList.contains("hidden")) hideCardPreview();
    return;
  }
  // Always-on-top: не перекрывать чужие окна, пока колода не в фокусе
  if (!deckIsActiveWindow()) {
    if (!$("card-preview").classList.contains("hidden")) hideCardPreview();
    return;
  }
  if (!state.revealed || !previewAllowed) {
    if (!$("card-preview").classList.contains("hidden")) hideCardPreview();
    return;
  }

  const preview = $("card-preview");
  const inPreview = pointInPreview(clientX, clientY);

  if (inPreview) {
    cancelPreviewHide();
    return;
  }

  const cardEl = cardAtPoint(clientX, clientY);
  if (cardEl) {
    cancelPreviewHide();
    const cardId = cardEl.getAttribute("data-id");
    if (state.previewCardId !== cardId) {
      const card = state.deck?.cards?.find((c) => c.id === cardId);
      if (card) showCardPreview(card, cardEl);
    }
    return;
  }

  if (!preview.classList.contains("hidden")) {
    schedulePreviewHide();
  }
}

function showCardPreview(card, anchorEl) {
  if (state.settingsWindowOpen || state.targetsWindowOpen) return;
  if (state.settings?.showCardPreview === false) return;
  if (!deckIsActiveWindow()) return;
  if (!state.revealed || !previewAllowed) return;
  cancelPreviewHide();
  const preset = window.tarotPreset(card.image);
  const el = $("card-preview");
  if (!el || !anchorEl) return;

  state.previewCardId = card.id;

  el.innerHTML = `
    <div class="preview-tarot">${escapeHtml(window.I18n.tarotName(preset.id) || preset.name)}</div>
    <div class="preview-title">${escapeHtml(card.title || "")}</div>
    ${
      card.description
        ? `<div class="preview-desc">${escapeHtml(card.description)}</div>`
        : ""
    }
    ${
      card.prompt
        ? `<div class="preview-prompt">${escapeHtml(card.prompt)}</div>`
        : ""
    }`;

  el.classList.remove("hidden");
  el.setAttribute("aria-hidden", "false");

  const rect = anchorEl.getBoundingClientRect();
  const zone = document.querySelector(".cards-zone");
  const zoneRect = zone?.getBoundingClientRect() || rect;
  const bar = document.querySelector(".titlebar");
  const barRect = bar?.getBoundingClientRect();
  const gap = 8;
  let left = 12;
  let top = rect.top;

  el.style.visibility = "hidden";
  el.classList.add("visible");
  el.style.maxHeight = "";
  el.style.width = "";

  const dock = state.dock || "right";
  // Side table: preview beside the whole grid, not beside one cell (avoids overlap).
  if (dock === "right") {
    const lane = Math.max(120, zoneRect.left - gap - 8);
    el.style.width = `${Math.min(280, lane)}px`;
  } else if (dock === "left") {
    const lane = Math.max(120, window.innerWidth - zoneRect.right - gap - 8);
    el.style.width = `${Math.min(280, lane)}px`;
  }

  // Сверху/снизу: вписать превью в полосу tipLane, иначе текст обрезается окном
  if (dock === "top") {
    const belowBar = barRect ? barRect.bottom + gap : zoneRect.bottom + gap;
    const maxH = Math.max(120, window.innerHeight - belowBar - 8);
    el.style.maxHeight = `${Math.min(400, maxH)}px`;
  } else if (dock === "bottom") {
    const barTop = barRect ? barRect.top : zoneRect.top;
    const maxH = Math.max(120, barTop - gap - 8);
    el.style.maxHeight = `${Math.min(400, maxH)}px`;
  }

  const tipRect = el.getBoundingClientRect();
  el.style.visibility = "";

  if (dock === "right") {
    left = zoneRect.left - tipRect.width - gap;
    top = rect.top;
  } else if (dock === "left") {
    left = zoneRect.right + gap;
    top = rect.top;
  } else if (dock === "top") {
    // Подсказки ниже кнопок (кнопки под картами), без наложения
    left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - tipRect.width / 2,
        window.innerWidth - tipRect.width - 8
      )
    );
    top = barRect ? barRect.bottom + gap : zoneRect.bottom + gap;
  } else {
    // Снизу: кнопки над картами — превью выше кнопок
    left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - tipRect.width / 2,
        window.innerWidth - tipRect.width - 8
      )
    );
    top = (barRect ? barRect.top : zoneRect.top) - tipRect.height - gap;
  }

  top = Math.max(8, Math.min(top, window.innerHeight - tipRect.height - 8));
  if (dock === "right") {
    // Never overlap the card table
    left = Math.min(left, zoneRect.left - tipRect.width - gap);
    left = Math.max(8, left);
  } else if (dock === "left") {
    left = Math.max(left, zoneRect.right + gap);
    left = Math.min(left, window.innerWidth - tipRect.width - 8);
  } else {
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    // Не наезжать на полосу кнопок
    if (dock === "top" && barRect) {
      top = Math.max(top, barRect.bottom + gap);
    }
    if (dock === "bottom" && barRect) {
      top = Math.min(top, barRect.top - tipRect.height - gap);
    }
  }

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  window.keycode.setPreviewHold?.(true);
}

let lastIgnoreMouse = null;

function pointInRect(x, y, r, pad = 0) {
  return (
    x >= r.left - pad &&
    x <= r.right + pad &&
    y >= r.top - pad &&
    y <= r.bottom + pad
  );
}

function hitCapturesMouse(x, y) {
  // Геометрия надёжнее elementFromPoint при click-through (ignore + forward)
  // Table: only the centered cluster (cards + hub + rail), not empty top/bottom.
  const cluster = document.getElementById("deck-cluster");
  if (isSideTable() && cluster) {
    if (!pointInRect(x, y, cluster.getBoundingClientRect(), 6)) {
      const onboarding = document.getElementById("onboarding");
      if (
        onboarding &&
        !onboarding.classList.contains("hidden") &&
        pointInRect(x, y, onboarding.getBoundingClientRect(), 0)
      ) {
        return true;
      }
      const nudge = document.getElementById("cdp-nudge");
      if (
        nudge &&
        !nudge.classList.contains("hidden") &&
        pointInRect(x, y, nudge.getBoundingClientRect(), 0)
      ) {
        return true;
      }
      const modal = document.querySelector(".modal:not(.hidden)");
      if (modal && pointInRect(x, y, modal.getBoundingClientRect(), 0)) return true;
      const toast = document.querySelector(".toast:not(.hidden)");
      if (toast && pointInRect(x, y, toast.getBoundingClientRect(), 0)) return true;
      if (pointInPreview(x, y)) return true;
      return false;
    }
  }

  for (const card of document.querySelectorAll(".card")) {
    if (pointInRect(x, y, card.getBoundingClientRect(), 2)) return true;
  }
  const stripDeck = document.querySelector(".strip-deck-pager");
  if (stripDeck && pointInRect(x, y, stripDeck.getBoundingClientRect(), 4)) {
    return true;
  }
  const destBar = document.getElementById("dest-bar");
  if (
    destBar &&
    !destBar.classList.contains("hidden") &&
    pointInRect(x, y, destBar.getBoundingClientRect(), 4)
  ) {
    return true;
  }
  const transcript = document.getElementById("deck-transcript");
  if (
    transcript &&
    !transcript.classList.contains("hidden") &&
    pointInRect(x, y, transcript.getBoundingClientRect(), 4)
  ) {
    return true;
  }
  const hub = document.querySelector(".deck-hub, .titlebar");
  if (hub && pointInRect(x, y, hub.getBoundingClientRect(), 4)) return true;
  const onboarding = document.getElementById("onboarding");
  if (
    onboarding &&
    !onboarding.classList.contains("hidden") &&
    pointInRect(x, y, onboarding.getBoundingClientRect(), 0)
  ) {
    return true;
  }
  const nudge = document.getElementById("cdp-nudge");
  if (
    nudge &&
    !nudge.classList.contains("hidden") &&
    pointInRect(x, y, nudge.getBoundingClientRect(), 0)
  ) {
    return true;
  }
  const dock = document.querySelector(".corner-dock");
  if (dock && pointInRect(x, y, dock.getBoundingClientRect(), 12)) return true;
  for (const btn of document.querySelectorAll(".corner-btn")) {
    if (pointInRect(x, y, btn.getBoundingClientRect(), 10)) return true;
  }
  if (
    document.querySelector(".chrome") &&
    !document.body.classList.contains("cards-only")
  ) {
    const chrome = document.querySelector(".chrome");
    if (chrome && pointInRect(x, y, chrome.getBoundingClientRect(), 0)) {
      return true;
    }
  }
  const modal = document.querySelector(".modal:not(.hidden)");
  if (modal && pointInRect(x, y, modal.getBoundingClientRect(), 0)) return true;
  const toast = document.querySelector(".toast:not(.hidden)");
  if (toast && pointInRect(x, y, toast.getBoundingClientRect(), 0)) return true;
  if (pointInPreview(x, y)) return true;
  return false;
}

function updateMousePassthrough(clientX, clientY) {
  if (state.fullscreenEdit || state.expanded) {
    if (lastIgnoreMouse !== false) {
      lastIgnoreMouse = false;
      window.keycode.setIgnoreMouse?.(false);
    }
    return;
  }
  const capture = hitCapturesMouse(clientX, clientY);
  const ignore = !capture;
  if (ignore === lastIgnoreMouse) return;
  lastIgnoreMouse = ignore;
  window.keycode.setIgnoreMouse?.(ignore);
}

async function syncMousePassthroughFromCursor() {
  try {
    const p = await window.keycode.getCursorClient?.();
    if (!p || typeof p.x !== "number") return;
    // Сбросить кэш — принудительно пересчитать ignore
    lastIgnoreMouse = null;
    updateMousePassthrough(p.x, p.y);
  } catch {
    /* ignore */
  }
}

function renderCards() {
  const root = $("cards");
  const cards = state.deck?.cards || [];
  const countEl = $("card-count");
  if (countEl) countEl.textContent = `${cards.length}/9`;

  if (!cards.length) {
    root.classList.remove("has-suggestions");
    root.innerHTML =
      '<div class="empty-targets">' + window.I18n.t("cards.empty") + "</div>";
    return;
  }

  const hasSuggestions = (state.suggestions || []).some(
    (s) => s?.cardId && (s.rank === 1 || s.rank === 2)
  );
  root.classList.toggle("has-suggestions", hasSuggestions);

  root.innerHTML = cards
    .map((card, index) => {
      const preset = window.tarotPreset(card.image);
      const src = window.tarotImageUrl(card.image);
      const action = shortAction(card.title || card.description);
      const sug = (state.suggestions || []).find((s) => s.cardId === card.id);
      const sugClass =
        sug?.rank === 1
          ? " suggested-primary"
          : sug?.rank === 2
            ? " suggested-secondary"
            : "";
      return `
      <article class="card${sugClass}" data-id="${escapeAttr(card.id)}" data-index="${index}">
        <button type="button" class="card-edit-btn" data-edit="${escapeAttr(
          card.id
        )}" title="${escapeAttr(window.I18n.t("cards.edit"))}" aria-label="${escapeAttr(
          window.I18n.t("cards.editAria", {
            title: card.title || window.I18n.t("cards.cardFallback"),
          })
        )}">✎</button>
        <button type="button" class="card-send" data-send="${escapeAttr(
          card.id
        )}" aria-label="${escapeAttr(card.title || window.I18n.t("cards.sendAria"))}${
          card.hotkey ? `, ${escapeAttr(card.hotkey)}` : ""
        }">
          <div class="card-art">
            <img src="${escapeAttr(src)}" alt=""
              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
            <div class="fallback" style="display:none" title="${escapeAttr(
              window.I18n.tarotName(preset.id) || preset.name
            )}">✦</div>
            <div class="card-overlay">
              <div class="card-overlay-top">
                <div class="card-tarot">${escapeHtml(window.I18n.tarotName(preset.id) || preset.name)}</div>
              </div>
              <div class="card-overlay-bottom">
                <div class="card-action">${escapeHtml(action)}</div>
              </div>
            </div>
            ${
              card.hotkey
                ? `<div class="card-hotkey">${escapeHtml(card.hotkey)}</div>`
                : ""
            }
          </div>
        </button>
      </article>`;
    })
    .join("");
}

function maybeShowOnboarding() {
  const el = $("onboarding");
  if (!el) return;
  if (state.settings?.firstRunDone) {
    el.classList.add("hidden");
    return;
  }
  el.classList.remove("hidden");
  window.keycode.setModalHold?.(true);
}

async function dismissOnboarding() {
  const el = $("onboarding");
  if (el) el.classList.add("hidden");
  window.keycode.setModalHold?.(false);
  await window.keycode.dismissFirstRun?.();
  state.settings = { ...state.settings, firstRunDone: true };
  if (pendingCdpNudge) {
    const data = pendingCdpNudge;
    pendingCdpNudge = null;
    showCdpNudge(data);
  }
}

let cdpBusy = false;
let cdpNudgeCursorRunning = false;
let pendingCdpNudge = null;

function hideCdpNudge() {
  const el = $("cdp-nudge");
  if (el) el.classList.add("hidden");
  window.keycode.setModalHold?.(false);
}

function showCdpNudge(data = {}) {
  const el = $("cdp-nudge");
  if (!el) return;
  const onboarding = $("onboarding");
  if (onboarding && !onboarding.classList.contains("hidden")) {
    pendingCdpNudge = data;
    return;
  }
  cdpNudgeCursorRunning = !!data.cursorRunning;
  const text = $("cdp-nudge-text");
  const action = $("cdp-nudge-action");
  if (text) {
    text.textContent = cdpNudgeCursorRunning
      ? window.I18n.t("cdp.nudgeRestart")
      : window.I18n.t("cdp.nudgeLaunch");
  }
  if (action) {
    action.textContent = cdpNudgeCursorRunning
      ? window.I18n.t("cdp.restartBtn")
      : window.I18n.t("cdp.launchBtn");
  }
  el.classList.remove("hidden");
  window.keycode.setModalHold?.(true);
  window.keycode.showDeck?.();
}

function setCdpCornerState(kind) {
  const btn = $("btn-corner-cdp");
  if (!btn) return;
  const ok = kind === "ok";
  const warn = kind === "warn" || kind === "" || kind == null;
  btn.classList.toggle("ok", ok);
  btn.classList.toggle("warn", warn && !ok);
  if (window.I18n?.t) {
    btn.title = ok
      ? window.I18n.t("cdp.alreadyOk")
      : window.I18n.t("deck.cdpTitle");
  }
}

let cdpStatusTimer = null;
let cdpStatusBusy = false;

async function refreshCdpCornerState() {
  if (cdpStatusBusy || cdpBusy) return;
  const btn = $("btn-corner-cdp");
  if (!btn) return;
  cdpStatusBusy = true;
  try {
    const probe = await window.keycode.cursorProbe();
    if (probe?.ok || probe?.open) {
      setCdpCornerState("ok");
    } else {
      // CDP closed — dark red whether Cursor is running or not
      setCdpCornerState("warn");
    }
  } catch {
    setCdpCornerState("warn");
  } finally {
    cdpStatusBusy = false;
  }
}

function startCdpStatusWatch() {
  if (cdpStatusTimer) return;
  refreshCdpCornerState();
  cdpStatusTimer = setInterval(() => {
    if (document.body.classList.contains("revealed") || state.pinnedOpen) {
      refreshCdpCornerState();
    }
  }, 8000);
}

function stopCdpStatusWatch() {
  if (!cdpStatusTimer) return;
  clearInterval(cdpStatusTimer);
  cdpStatusTimer = null;
}

async function launchOrRestartCdp({ fromNudge = false } = {}) {
  if (cdpBusy) return;
  cdpBusy = true;
  const btn = $("btn-corner-cdp");
  const nudgeAction = $("cdp-nudge-action");
  if (btn) btn.disabled = true;
  if (nudgeAction) nudgeAction.disabled = true;
  try {
    const probe = await window.keycode.cursorProbe();
    if (probe?.ok || probe?.open) {
      setCdpCornerState("ok");
      toast(probe.hint || window.I18n.t("cdp.alreadyOk"), "ok");
      hideCdpNudge();
      return;
    }
    const running = !!probe?.cursorRunning;
    toast(
      running ? window.I18n.t("cdp.restarting") : window.I18n.t("cdp.launching"),
      ""
    );
    const r = await window.keycode.cursorLaunchIntegration({
      mode: "both",
      allowRestart: true,
    });
    if (!r?.ok) {
      setCdpCornerState("warn");
      toast(r?.error || window.I18n.t("cdp.fail"), "error");
      return;
    }
    const open = !!(r.probe?.open);
    setCdpCornerState(open ? "ok" : "warn");
    toast(
      r.probe?.hint ||
        (open
          ? window.I18n.t("msg.cursorReadyCdp")
          : window.I18n.t("msg.cursorStarting")),
      open ? "ok" : "error"
    );
    if (open || fromNudge) hideCdpNudge();
  } catch (e) {
    setCdpCornerState("warn");
    toast(String(e.message || e), "error");
  } finally {
    cdpBusy = false;
    if (btn) btn.disabled = false;
    if (nudgeAction) nudgeAction.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}


function formatPasteToast(results) {
  const list = results || [];
  const ok = list.filter((r) => r.ok).length;
  const fail = list.length - ok;
  const total = list.length;
  const warn = list.find((r) => r.ok && r.warning);
  if (!total) return { message: window.I18n.t("cards.noTargets"), type: "error" };
  if (fail && !ok) {
    const first = list.find((r) => !r.ok);
    return {
      message: window.I18n.t("cards.pasteFail", { target: first?.target || window.I18n.t("cards.windowFallback"), error: first?.error || window.I18n.t("cards.errorFallback") }),
      type: "error",
    };
  }
  if (fail) {
    const first = list.find((r) => !r.ok);
    return {
      message: window.I18n.t("cards.pastePartial", { ok, total, target: first?.target, error: first?.error || window.I18n.t("cards.noneFallback") }),
      type: "error",
    };
  }
  if (warn) {
    return { message: warn.warning, type: "error" };
  }
  return { message: window.I18n.t("cards.pasteOk", { ok, total }), type: "ok" };
}

async function onPasteCard(cardId) {
  hideCardPreview();
  const destCount = resolveDestCount(state.settings);
  if (!destCount) {
    const solo = String(state.settings?.pasteMode || "").toLowerCase() === "solo";
    toast(
      solo ? window.I18n.t("cards.pickSoloChat") : window.I18n.t("cards.pickTarget"),
      "error"
    );
    return;
  }
  const el = document.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
  if (el) el.classList.add("sending");
  const result = await window.keycode.pasteCard(cardId);
  if (el) setTimeout(() => el.classList.remove("sending"), 500);
  if (!result?.ok && result?.error === "no targets") return;
  if (result?.results) {
    const t = formatPasteToast(result.results);
    toast(t.message, t.type);
  }
  if (soloCdpTarget()) {
    state.transcriptHash = "";
    refreshDeckTranscript({ select: false }).catch(() => {});
  }
}

function openCardEditor(cardId) {
  const card = state.deck.cards.find((c) => c.id === cardId);
  if (!card) return;
  state.editingCardId = cardId;
  $("card-title").value = card.title || "";
  $("card-desc").value = card.description || "";
  $("card-prompt").value = card.prompt || "";
  $("card-hotkey").value = card.hotkey || "";

  window.fillTarotImagePicker($("card-image"), card.image);

  $("modal-card").classList.remove("hidden");
  window.keycode.setModalHold?.(true);
}

function closeCardEditor() {
  $("modal-card").classList.add("hidden");
  state.editingCardId = null;
  if ($("modal-quit")?.classList.contains("hidden")) {
    window.keycode.setModalHold?.(false);
  }
}

async function saveCardEditor() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  const cards = state.deck.cards.map((c) =>
    c.id === id
      ? {
          ...c,
          title: $("card-title").value.trim() || window.I18n.t("cards.untitled"),
          description: $("card-desc").value.trim(),
          prompt: $("card-prompt").value,
          image: window.getTarotPickerValue($("card-image")),
          hotkey: $("card-hotkey").value || "",
        }
      : c
  );
  state.deck = await window.keycode.saveDeck({ ...state.deck, cards });
  closeCardEditor();
  await refresh();
  toast(window.I18n.t("cards.saved"), "ok");
}

async function deleteEditingCard() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  if (state.deck.cards.length <= 1) {
    toast(window.I18n.t("cards.needOne"), "error");
    return;
  }
  const cards = state.deck.cards.filter((c) => c.id !== id);
  state.deck = await window.keycode.saveDeck({ ...state.deck, cards });
  closeCardEditor();
  await refresh();
  toast(window.I18n.t("cards.deleted"), "ok");
}

async function addCard() {
  if (!state.deck) return;
  if (state.deck.cards.length >= 9) {
    toast(window.I18n.t("cards.max8"), "error");
    return;
  }
  const n = state.deck.cards.length + 1;
  const freeHotkey = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"].find(
    (h) => !state.deck.cards.some((c) => c.hotkey === h)
  );
  const presets = window.TAROT_PRESETS;
  const card = {
    id: uid("card"),
    title: window.I18n.t("cards.newTitle", { n }),
    description: window.I18n.t("cards.newDesc"),
    prompt: window.I18n.t("cards.newPrompt"),
    image: presets[(n - 1) % presets.length].id,
    hotkey: freeHotkey || "",
  };
  state.deck = await window.keycode.saveDeck({
    ...state.deck,
    cards: [...state.deck.cards, card],
  });
  await refresh();
  openCardEditor(card.id);
}

function openQuitDialog() {
  hideCardPreview();
  $("modal-quit").classList.remove("hidden");
  window.keycode.setModalHold?.(true);
  lastIgnoreMouse = null;
  syncMousePassthroughFromCursor();
}

function closeQuitDialog() {
  $("modal-quit").classList.add("hidden");
  window.keycode.setModalHold?.(false);
}

async function toggleFullscreenEdit() {
  const next = !state.fullscreenEdit;
  await window.keycode.setFullscreenEdit(next);
  applyFullscreenEdit(next);
  if (next) {
    state.expanded = true;
    applyDockClass(state.dock, state.horizontal, true);
    await refresh();
  } else {
    await refresh();
  }
}

function bindEvents() {
  $("btn-corner-hide")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.hideDeck();
  });

  $("btn-corner-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.openSettings();
  });

  $("btn-corner-cdp")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    launchOrRestartCdp();
  });

  $("cdp-nudge-action")?.addEventListener("click", (e) => {
    e.stopPropagation();
    launchOrRestartCdp({ fromNudge: true });
  });

  $("cdp-nudge-dismiss")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCdpNudge();
  });

  $("btn-corner-targets").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.openTargets();
  });

  $("dest-bar")?.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest?.("#btn-transcript-toggle");
    if (toggleBtn) {
      e.stopPropagation();
      toggleDeckTranscript();
      return;
    }
    const presetBtn = e.target.closest?.("[data-preset]");
    if (presetBtn) {
      e.stopPropagation();
      selectDestPreset(presetBtn.getAttribute("data-preset"));
      return;
    }
    const chipBtn = e.target.closest?.("[data-target]");
    if (chipBtn) {
      e.stopPropagation();
      selectDestSolo(chipBtn.getAttribute("data-target"));
    }
  });

  {
    let resizeStartY = 0;
    let resizeStartH = 0;
    let resizing = false;
    const onMove = (e) => {
      if (!resizing) return;
      const dy = e.clientY - resizeStartY;
      const next = clampTranscriptHeight(resizeStartH + dy);
      applyTranscriptHeight(next);
      if (state.settings) state.settings.deckTranscriptHeightPx = next;
    };
    const onUp = async () => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove("transcript-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const h = clampTranscriptHeight(
        state.settings?.deckTranscriptHeightPx ?? $("deck-transcript")?.offsetHeight
      );
      state.settings = await window.keycode.saveSettings({
        deckTranscriptHeightPx: h,
      });
      applyTranscriptHeight(h);
    };
    $("deck-transcript-resize")?.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pane = $("deck-transcript");
      if (!pane || pane.classList.contains("hidden")) return;
      resizing = true;
      resizeStartY = e.clientY;
      resizeStartH = pane.getBoundingClientRect().height;
      document.body.classList.add("transcript-resizing");
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  $("deck-transcript-msgs")?.addEventListener(
    "scroll",
    () => {
      const el = $("deck-transcript-msgs");
      if (!el) return;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      state.transcriptStickBottom = gap < 28;
    },
    { passive: true }
  );

  $("btn-corner-quit").addEventListener("click", (e) => {
    e.stopPropagation();
    openQuitDialog();
  });

  $("quit-return").addEventListener("click", () => {
    closeQuitDialog();
    window.keycode.quitApp();
  });

  $("quit-stay").addEventListener("click", () => {
    closeQuitDialog();
    window.keycode.hideDeck();
    toast(window.I18n.t("cards.hiddenBg"), "");
  });

  $("onboarding-ok")?.addEventListener("click", () => dismissOnboarding());

  $("btn-deck-prev")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await cycleDeck(-1);
  });
  $("btn-deck-next")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await cycleDeck(1);
  });

$("card-cancel").addEventListener("click", closeCardEditor);
  $("card-save").addEventListener("click", saveCardEditor);
  $("card-delete").addEventListener("click", deleteEditingCard);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("modal-card")?.classList.contains("hidden")) {
        closeCardEditor();
        return;
      }
      if (!$("modal-quit")?.classList.contains("hidden")) {
        closeQuitDialog();
        return;
      }
      if (!$("onboarding")?.classList.contains("hidden")) {
        dismissOnboarding();
        return;
      }
      if (!$("cdp-nudge")?.classList.contains("hidden")) {
        hideCdpNudge();
      }
    }
  });

  $("cards").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      e.stopPropagation();
      openCardEditor(edit.getAttribute("data-edit"));
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    const cardId = card.getAttribute("data-id");
    if (!cardId) return;
    onPasteCard(cardId);
  });

  window.keycode.onToast((data) => toast(data.message, data.type || ""));
  window.keycode.onCdpNudge?.((data) => {
    showCdpNudge(data || {});
  });
  window.keycode.onPasteDone((data) => {
    if (!document.hasFocus()) {
      const t = formatPasteToast(data.results);
      toast(t.message, t.type);
    }
  });

  window.keycode.onDeckReveal(() => {
    document.body.classList.remove("concealing", "booting");
    setPreviewAllowed(false);
    startCdpStatusWatch();
    // Два кадра — окно успевает показаться скрытым, потом плавный выезд
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRevealed(true);
        const zone = document.querySelector(".cards-zone");
        if (zone) zone.scrollTop = 0;
      });
    });
  });
  window.keycode.onDeckConceal(() => {
    setRevealed(false);
    stopCdpStatusWatch();
  });
  window.keycode.onPanelExpanded((data) => {
    applyDockClass(state.dock, state.horizontal, !!data?.expanded);
  });
  window.keycode.onPinChanged((data) => {
    state.pinnedOpen = !!data?.pinned;
  });
  window.keycode.onFullscreenEdit((data) => {
    applyFullscreenEdit(!!data?.on);
    if (data?.on) refresh();
  });
  window.keycode.onDockChanged((data) => {
    applyDockClass(data.dock, data.horizontal, data.expanded ?? state.expanded);
  });
  window.keycode.onTargetsUpdated(async () => {
    await refresh();
  });
  window.keycode.onStateChanged(async () => {
    await refresh();
  });
  window.keycode.onSettingsOpen(() => {
    state.settingsWindowOpen = true;
    hideCardPreview();
  });
  window.keycode.onSettingsClosed(() => {
    state.settingsWindowOpen = false;
  });
  window.keycode.onTargetsOpen(() => {
    state.targetsWindowOpen = true;
    hideCardPreview();
  });
  window.keycode.onTargetsClosed(() => {
    state.targetsWindowOpen = false;
  });
  window.keycode.onSettingsPreview((partial) => {
    state.settings = { ...state.settings, ...partial };
    applyOpacity(state.settings);
    applyCardFonts(state.settings);
    if (partial.panelScale != null) applyPanelScale(state.settings);
    if (partial.sideCardLayout != null) {
      applySideLayoutClass();
    }
    if (partial.targets) {
      syncTargetsBadge();
      renderDestBar();
    }
    if (
      partial.pasteMode != null ||
      partial.activeTargetId != null ||
      partial.activePresetId != null ||
      partial.targetPresets != null
    ) {
      syncTargetsBadge();
      renderDestBar();
    }
  });

  document.addEventListener(
    "mousemove",
    (e) => {
      updateMousePassthrough(e.clientX, e.clientY);
      updatePreviewHover(e.clientX, e.clientY);
    },
    { passive: true }
  );

  window.addEventListener("blur", () => {
    hideCardPreview();
  });
  window.addEventListener("focus", async () => {
    try {
      const p = await window.keycode.getCursorClient?.();
      if (!p || typeof p.x !== "number") return;
      lastIgnoreMouse = null;
      updateMousePassthrough(p.x, p.y);
      updatePreviewHover(p.x, p.y);
    } catch {
      /* ignore */
    }
  });

  // Колесико над картой крутит расшифровку (не только над самой панелью)
  document.addEventListener(
    "wheel",
    (e) => {
      const preview = $("card-preview");
      if (!preview || preview.classList.contains("hidden")) return;
      if (preview.contains(e.target)) return;
      if (preview.scrollHeight <= preview.clientHeight + 1) return;

      const cardEl = cardAtPoint(e.clientX, e.clientY);
      if (!cardEl) return;
      if (state.previewCardId !== cardEl.getAttribute("data-id")) return;

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= preview.clientHeight;

      const atTop = preview.scrollTop <= 0;
      const atBottom =
        preview.scrollTop + preview.clientHeight >= preview.scrollHeight - 1;
      if ((dy < 0 && atTop) || (dy > 0 && atBottom)) return;

      e.preventDefault();
      preview.scrollTop += dy;
    },
    { passive: false, capture: true }
  );

  // По умолчанию клики сквозь прозрачную зону
  window.keycode.setIgnoreMouse?.(true);
  lastIgnoreMouse = true;
}

bindEvents();
refresh()
  .then(() => waitForCardImages(1200))
  .then(() => {
    window.keycode.deckUiReady?.();
    startCdpStatusWatch();
    // Default until first probe finishes: assume CDP down → dark red
    setCdpCornerState("warn");
    refreshCdpCornerState();
  })
  .catch((e) => {
    console.error(e);
    toast(window.I18n.t("cards.loadError"), "error");
    window.keycode.deckUiReady?.();
    setCdpCornerState("warn");
    startCdpStatusWatch();
  });
