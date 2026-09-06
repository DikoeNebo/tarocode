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
  chatComposer: null,
  clarifications: [],
  chatBusy: false,
  /** @type {Array<{ cardId: string, rank: 1 | 2 }>} */
  suggestions: [],
  /** @type {Record<string, string>} Cursor-like status per target id */
  chatStatuses: {},
};

/** @type {ReturnType<typeof setInterval> | null} */
let transcriptPollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let statusPollTimer = null;
let statusPollBusy = false;
let transcriptBusy = false;
let deckListening = false;
let deckDictationSession = 0;
let deckDictationBase = "";
/** @type {ReturnType<typeof setTimeout> | null} */
let deckDictationMaxTimer = null;
/** @type {MediaStream | null} */
let deckMicStream = null;
/** @type {AudioContext | null} */
let deckAudioCtx = null;
/** @type {ScriptProcessorNode | null} */
let deckProcessor = null;
/** @type {number[]} */
let deckPcmChunks = [];
let deckSpeechSeen = false;
let deckSilentFrames = 0;
let deckDictationBusy = false;

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
  // Side docks don't need the frozen edge width used by top/bottom chat.
  if (state.dock !== "top" && state.dock !== "bottom") {
    const col = document.querySelector(".deck-col");
    if (col) col.style.minWidth = "";
  }
  applySideLayoutClass();
  syncDeckCards();
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

function applyChatFonts(settings) {
  const clamp = (value) => Math.min(20, Math.max(8, Number(value) || 10));
  document.documentElement.style.setProperty(
    "--chat-message-font-size",
    `${clamp(settings?.chatMessageFontPx)}px`
  );
  document.documentElement.style.setProperty(
    "--chat-composer-font-size",
    `${clamp(settings?.chatComposerFontPx)}px`
  );
}

/**
 * Card scale and chat scale are independent.
 * Control chrome (👁⚙…) never shrinks below 100% so buttons stay usable when cards get smaller.
 * Card pixel size comes only from Settings → panelScale (never from chat height).
 * UI 100% matches the former 75% look (PANEL_SCALE_VISUAL_REF).
 */
function applyPanelScale(settings) {
  const PANEL_SCALE_MIN = 0.3;
  const PANEL_SCALE_MAX = 3;
  const PANEL_SCALE_VISUAL_REF = 0.75;
  const stored = Math.min(
    PANEL_SCALE_MAX,
    Math.max(PANEL_SCALE_MIN, Number(settings?.panelScale) || 1)
  );
  const cardS = stored * PANEL_SCALE_VISUAL_REF;
  const chatS = Math.min(1.5, Math.max(0.75, Number(settings?.chatScale) || 1));
  const btnS = Math.max(1, cardS);
  const btn = Math.round(24 * btnS);
  const gap = Math.max(1, Math.round(2 * btnS));
  const cardGap = Math.max(1, Math.round(2 * cardS));
  const root = document.documentElement;
  root.style.setProperty("--corner-btn-size", `${btn}px`);
  root.style.setProperty("--corner-gap", `${gap}px`);
  root.style.setProperty("--titlebar-h", `${btn}px`);
  root.style.setProperty("--card-gap", `${cardGap}px`);
  root.style.setProperty("--hub-w", `${Math.round(btn + 12)}px`);
  root.style.setProperty("--rail-w", `${Math.round(148 * btnS)}px`);
  root.style.setProperty("--radius", `${Math.round(8 * btnS)}px`);
  root.style.setProperty("--radius-inner", `${Math.round(6 * btnS)}px`);
  root.style.setProperty("--corner-font-size", `${Math.max(11, Math.round(14 * btnS))}px`);
  root.style.setProperty("--table-gap", `${Math.max(2, Math.round(4 * cardS))}px`);
  root.style.setProperty("--card-scale", String(cardS / btnS));
  root.style.setProperty("--chat-scale", String(chatS));
  applyTranscriptHeight(settings?.deckTranscriptHeightPx);
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
  syncTranscriptToggleBtn(state.settings?.deckTranscriptOpen !== false);
  syncCardsToggleBtn(state.settings?.deckCardsOpen !== false);
  syncManualToggleBtn(deckComposerWanted());
  if (isOnboardingVisible()) renderOnboardingStep();
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
  applyChatFonts(data.settings);
  applyPanelScale(data.settings);
  renderAll();
  maybeShowOnboarding();
}

function renderAll() {
  renderDeckSelect();
  syncTargetsBadge();
  renderDestBar();
  renderCards();
  syncDeckTranscript();
  renderPhaseNext();
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

/** Prefer live solo transcript signals over stale sidebar scrape. */
function effectiveChatStatus(targetId) {
  const id = String(targetId || "");
  if (!id) return "";
  const mode = String(state.settings?.pasteMode || "").toLowerCase();
  if (mode === "solo" && id === state.settings?.activeTargetId) {
    if (state.chatComposer?.generating === true) return "running";
    if (Array.isArray(state.clarifications) && state.clarifications.length) {
      return "needs-attention";
    }
  }
  return String(state.chatStatuses?.[id] || "");
}

function stopStatusPoll() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

function startStatusPoll() {
  stopStatusPoll();
  statusPollTimer = setInterval(() => {
    refreshChatStatuses().catch(() => {});
  }, 3000);
}

async function refreshChatStatuses() {
  const targets = (state.settings?.targets || []).filter((t) => t.driver === "cdp");
  if (!targets.length) {
    state.chatStatuses = {};
    stopStatusPoll();
    return;
  }
  if (statusPollBusy) return;
  if (!state.revealed && !state.pinnedOpen && !state.fullscreenEdit) return;
  statusPollBusy = true;
  try {
    const result = await window.keycode.deckChatStatuses();
    if (result?.ok && result.statuses && typeof result.statuses === "object") {
      state.chatStatuses = result.statuses;
    }
    applyDestChipStatuses();
  } catch {
    /* ignore transient CDP blips */
  } finally {
    statusPollBusy = false;
  }
}

function applyDestChipStatuses() {
  const chipsEl = $("dest-chips");
  if (!chipsEl) return;
  for (const btn of chipsEl.querySelectorAll("[data-target]")) {
    const id = btn.getAttribute("data-target") || "";
    const status = effectiveChatStatus(id);
    if (status) btn.setAttribute("data-status", status);
    else btn.removeAttribute("data-status");
  }
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
    state.chatStatuses = {};
    stopStatusPoll();
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
      const status = t.driver === "cdp" ? effectiveChatStatus(t.id) : "";
      const statusAttr = status ? ` data-status="${escapeAttr(status)}"` : "";
      return `<button type="button" class="dest-chip${active ? " active" : ""}" data-target="${escapeAttr(
        t.id
      )}"${statusAttr} title="${escapeAttr(t.name)}" aria-pressed="${active ? "true" : "false"}"><span class="dest-chip-dot" aria-hidden="true"></span><span class="dest-chip-label">${escapeHtml(
        shortDestLabel(t.name, 9)
      )}</span></button>`;
    })
    .join("");

  const pruneBtn = $("btn-dest-prune");
  if (pruneBtn) {
    const showPrune = mode === "solo" && activeTargetId && targets.length > 1;
    pruneBtn.classList.toggle("hidden", !showPrune);
  }

  const hasCdp = targets.some((t) => t.driver === "cdp");
  if (hasCdp) {
    if (!statusPollTimer) startStatusPoll();
    refreshChatStatuses().catch(() => {});
  } else {
    stopStatusPoll();
  }
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

async function removeOtherDestinations() {
  const mode = String(state.settings?.pasteMode || "").toLowerCase();
  const activeId = state.settings?.activeTargetId || "";
  const targets = state.settings?.targets || [];
  if (mode !== "solo" || !activeId || targets.length <= 1) {
    toast(window.I18n.t("dest.removeOthersNone"), "error");
    return;
  }
  const kept = targets.find((t) => t.id === activeId);
  if (!kept) return;
  const removed = targets.length - 1;
  const targetPresets = (state.settings?.targetPresets || [])
    .map((p) => ({
      ...p,
      targetIds: (p.targetIds || []).filter((id) => id === activeId),
    }))
    .filter((p) => (p.targetIds || []).length > 0);
  state.settings = await window.keycode.saveSettings({
    targets: [kept],
    targetPresets,
    pasteMode: "solo",
    activeTargetId: activeId,
    activePresetId: "",
  });
  toast(window.I18n.t("dest.removeOthersDone", { n: removed }), "ok");
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
  if (!Number.isFinite(n)) return 208;
  return Math.min(900, Math.max(80, Math.round(n)));
}

function transcriptComposerVisible() {
  const controls = $("deck-chat-controls");
  return controls && !controls.classList.contains("hidden");
}

function deckComposerWanted() {
  return state.settings?.deckComposerOpen === true;
}

function syncManualToggleBtn(open) {
  const btn = $("btn-deck-manual");
  if (!btn) return;
  const isOpen = open === true;
  btn.setAttribute("aria-pressed", isOpen ? "true" : "false");
  const titleKey = isOpen ? "deck.manualHide" : "deck.manualShow";
  const title = window.I18n.t(titleKey);
  btn.title = title;
  btn.setAttribute("aria-label", title);
  const label = btn.querySelector(".deck-manual-label");
  if (label) label.textContent = title;
  const icon = btn.querySelector(".deck-manual-icon");
  if (icon) icon.textContent = isOpen ? "▴" : "⌨";
}

async function toggleDeckComposer() {
  const open = deckComposerWanted();
  const next = !open;
  const chatS = Math.min(1.5, Math.max(0.75, Number(state.settings?.chatScale) || 1));
  const patch = { deckComposerOpen: next };
  if (next) {
    // Grow chat so composer does not steal message space; cards shift down.
    const cur = clampTranscriptHeight(state.settings?.deckTranscriptHeightPx);
    const want = Math.max(cur, Math.round(220 * chatS));
    if (want > cur) patch.deckTranscriptHeightPx = Math.min(900, want);
  }
  state.settings = await window.keycode.saveSettings(patch);
  const allowed =
    String(state.settings?.pasteMode || "").toLowerCase() === "solo" &&
    !!soloCdpTarget() &&
    state.settings?.deckTranscriptOpen !== false;
  setDeckChatControlsVisible(allowed);
  // Composer appeared/disappeared — refresh click-through hit targets
  lastIgnoreMouse = null;
  syncMousePassthroughFromCursor();
  if (next) {
    requestAnimationFrame(() => $("deck-composer-input")?.focus());
  }
}

function transcriptMinHeight() {
  const chatS = Math.min(1.5, Math.max(0.75, Number(state.settings?.chatScale) || 1));
  if (transcriptComposerVisible()) {
    // Composer + toolbar must stay fully visible (scaled).
    return Math.round(148 * chatS);
  }
  return 80;
}

/** Chat height only — never changes card size (that is Settings → panelScale). */
function applyTranscriptHeight(px) {
  const pane = $("deck-transcript");
  if (!pane) return;

  const minH = transcriptMinHeight();
  let want = clampTranscriptHeight(px ?? state.settings?.deckTranscriptHeightPx);
  want = Math.max(want, minH);

  let applied = want;
  if (document.body.classList.contains("side-layout-table") && isSideDock()) {
    const header = document.querySelector(".deck-hub");
    const headerH = Number(header?.offsetHeight || 0);
    const viewport = window.innerHeight * 0.96;
    // Allow chat almost full height; cards keep settings size and scroll below if needed.
    const maxChat = Math.max(minH, Math.floor(viewport - headerH - 16));
    applied = Math.min(want, maxChat);
  }

  pane.style.height = `${applied}px`;
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

function syncCardsToggleBtn(open) {
  const btn = $("btn-cards-toggle");
  if (!btn) return;
  const isOpen = open !== false;
  btn.setAttribute("aria-pressed", isOpen ? "true" : "false");
  const titleKey = isOpen ? "deck.cardsHide" : "deck.cardsShow";
  const title = window.I18n.t(titleKey);
  btn.title = title;
  btn.setAttribute("aria-label", title);
  const icon = btn.querySelector("span");
  if (icon) icon.textContent = isOpen ? "▦" : "▢";
}

async function toggleDeckTranscript() {
  const open = state.settings?.deckTranscriptOpen !== false;
  state.settings = await window.keycode.saveSettings({
    deckTranscriptOpen: !open,
  });
  syncDeckTranscript();
}

async function toggleDeckCards() {
  const open = state.settings?.deckCardsOpen !== false;
  state.settings = await window.keycode.saveSettings({
    deckCardsOpen: !open,
  });
  syncDeckCards();
}

function syncDeckCards() {
  const wantOpen = state.settings?.deckCardsOpen !== false;
  const col = document.querySelector(".deck-col");
  const topBottom = state.dock === "top" || state.dock === "bottom";
  const wasCollapsed = document.body.classList.contains("cards-collapsed");

  // Freeze column width before hiding cards so chat stays full-width on top/bottom.
  if (topBottom && col && !wantOpen && !wasCollapsed) {
    const w = Math.ceil(col.getBoundingClientRect().width);
    if (w > 80) col.style.minWidth = `${w}px`;
  } else if (wantOpen && col) {
    col.style.minWidth = "";
  } else if (topBottom && col && !wantOpen && wasCollapsed && !col.style.minWidth) {
    const n = Math.max(1, (state.deck?.cards || []).length);
    const cardEl = document.querySelector(".card");
    const cw = cardEl ? cardEl.getBoundingClientRect().width : 0;
    if (cw > 20) {
      col.style.minWidth = `${Math.ceil(n * cw + (n - 1) * 2)}px`;
    }
  }

  document.body.classList.toggle("cards-collapsed", !wantOpen);
  syncCardsToggleBtn(wantOpen);
  const btn = $("btn-cards-toggle");
  const targets = state.settings?.targets || [];
  if (btn) btn.classList.toggle("hidden", !targets.length);
  // Hotkeys still work while cards are hidden — only the strip is folded.
  syncMousePassthroughFromCursor();
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
  syncDeckCards();

  if (!targets.length) {
    pane.classList.add("hidden");
    if (toggle) toggle.classList.add("hidden");
    setDeckChatControlsVisible(false);
    stopTranscriptPoll();
    state.transcriptHash = "";
    state.transcriptTargetId = "";
    clearDeckSuggestions();
    return;
  }
  if (toggle) toggle.classList.remove("hidden");

  if (!wantOpen) {
    pane.classList.add("hidden");
    setDeckChatControlsVisible(false);
    stopTranscriptPoll();
    return;
  }

  // Show pane when open — hint in broadcast, live in solo
  pane.classList.remove("hidden");

  if (mode !== "solo") {
    setDeckChatControlsVisible(false);
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
    setDeckChatControlsVisible(false);
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
    stopDeckDictation();
    state.transcriptTargetId = target.id;
    state.transcriptHash = "";
    state.transcriptStickBottom = true;
    state.chatComposer = null;
    state.clarifications = [];
    clearDeckSuggestions();
    $("deck-transcript-msgs").innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = window.I18n.t("deck.transcriptLoading");
    refreshDeckTranscript({ select: true }).catch(() => {});
  }
  setDeckChatControlsVisible(true);
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
      setDeckChatControlsVisible(false);
      if (!state.transcriptHash) {
        empty.classList.remove("hidden");
        empty.textContent =
          result?.hint === "not_cdp"
            ? window.I18n.t("deck.transcriptNotCdp")
            : result?.hint === "chat_missing" ||
                result?.hint === "window_missing" ||
                result?.hint === "rebind"
              ? window.I18n.t("err.chatMissingReselect")
              : window.I18n.t("deck.transcriptError");
        $("deck-transcript-msgs").innerHTML = "";
      }
      pane.classList.remove("is-generating");
      clearDeckSuggestions();
      return;
    }
    setDeckChatControlsVisible(true);
    const hash = String(result.hash || "");
    state.chatComposer = result.composer
      ? { ...state.chatComposer, ...result.composer }
      : state.chatComposer;
    state.clarifications = Array.isArray(result.clarifications)
      ? result.clarifications
      : [];
    renderDeckChatControls();
    if (hash && hash === state.transcriptHash) {
      pane.classList.toggle("is-generating", result.generating === true);
      applyDestChipStatuses();
      // Still apply suggestions when idle (deck may have changed)
      if (result.generating !== true && Array.isArray(result.suggestions)) {
        applyDeckSuggestions(result.suggestions);
      }
      return;
    }
    state.transcriptHash = hash || state.transcriptHash;
    renderDeckMessages(result.messages || []);
    pane.classList.toggle("is-generating", result.generating === true);
    applyDestChipStatuses();
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

function setDeckChatControlsVisible(allowed) {
  const controls = $("deck-chat-controls");
  const bar = $("deck-manual-bar");
  const open = !!allowed && deckComposerWanted();
  if (controls) controls.classList.toggle("hidden", !open);
  if (bar) bar.classList.toggle("hidden", !allowed);
  syncManualToggleBtn(open);
  if (!open) {
    stopDeckDictation();
  }
  if (!allowed) {
    state.clarifications = [];
    $("deck-clarifications")?.classList.add("hidden");
  } else if (open) {
    renderDeckChatControls();
  }
  applyTranscriptHeight(state.settings?.deckTranscriptHeightPx);
}

function setDeckChatStatus(key, vars) {
  const el = $("deck-composer-status");
  if (el) el.textContent = window.I18n.t(key, vars);
}

function renderDeckClarifications() {
  const root = $("deck-clarifications");
  if (!root) return;
  root.innerHTML = "";
  const list = Array.isArray(state.clarifications) ? state.clarifications : [];
  if (!list.length) {
    root.classList.add("hidden");
    return;
  }
  root.classList.remove("hidden");
  const frag = document.createDocumentFragment();
  for (const question of list) {
    if (!Array.isArray(question?.options) || !question.options.length) continue;
    const card = document.createElement("section");
    card.className = "deck-clarification";
    const prompt = document.createElement("p");
    prompt.className = "deck-clarification-prompt";
    prompt.textContent = String(question.prompt || "");
    card.appendChild(prompt);
    const options = document.createElement("div");
    options.className = "deck-clarification-options";
    for (const option of question.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "deck-clarify-option";
      button.dataset.qid = String(question.id || "");
      button.dataset.oid = String(option.id || "");
      button.dataset.label = String(option.label || "");
      button.dataset.prompt = String(question.prompt || "");
      button.textContent = String(option.label || "");
      button.disabled = state.chatBusy || state.chatComposer?.generating === true;
      options.appendChild(button);
    }
    card.appendChild(options);
    frag.appendChild(card);
  }
  root.appendChild(frag);
  if (!root.childElementCount) root.classList.add("hidden");
}

function renderDeckModelLabel() {
  const modelEl = $("deck-model");
  if (!modelEl) return;
  const composer = state.chatComposer || {};
  const label = String(composer.modelLabel || composer.modelId || "").trim();
  const text = label || "—";
  modelEl.textContent = text;
  modelEl.title = label ? text : window.I18n.t("deck.chatModel");
}

function renderDeckChatControls() {
  const controls = $("deck-chat-controls");
  if (!controls || controls.classList.contains("hidden")) return;
  const composer = state.chatComposer || {};
  const busy = state.chatBusy;
  const generating = composer.generating === true;
  const modeEl = $("deck-mode");
  if (modeEl) {
    const modes = Array.isArray(composer.modes) && composer.modes.length
      ? composer.modes
      : [
          { id: "agent", label: "Agent" },
          { id: "plan", label: "Plan" },
          { id: "ask", label: "Ask" },
          { id: "debug", label: "Debug" },
        ];
    const cur = String(composer.mode || "agent").toLowerCase();
    const prev = modeEl.dataset.modeOpts || "";
    const next = modes.map((m) => m.id).join(",");
    if (prev !== next) {
      modeEl.innerHTML = modes
        .map((m) => {
          const id = String(m.id || "").trim();
          const label =
            window.I18n.t(`deck.mode_${id}`) !== `deck.mode_${id}`
              ? window.I18n.t(`deck.mode_${id}`)
              : String(m.label || id);
          return `<option value="${id}">${label}</option>`;
        })
        .join("");
      modeEl.dataset.modeOpts = next;
    }
    if ([...modeEl.options].some((o) => o.value === cur)) modeEl.value = cur;
    else modeEl.value = "agent";
    modeEl.disabled = busy;
  }
  renderDeckModelLabel();
  const input = $("deck-composer-input");
  const send = $("btn-deck-send");
  const mic = $("btn-deck-mic");
  if (input) input.disabled = busy || generating;
  if (send) {
    send.disabled = busy || generating || !String(input?.value || "").trim();
    send.textContent =
      String(composer.submitLabel || "").trim().slice(0, 24) ||
      window.I18n.t(composer.submitKind === "build" ? "deck.chatBuild" : "deck.chatSend");
  }
  if (mic) {
    mic.disabled = busy || generating || deckDictationBusy;
    mic.classList.toggle("listening", deckListening);
    mic.setAttribute("aria-pressed", deckListening ? "true" : "false");
    mic.title = window.I18n.t("deck.chatMicTitle");
    mic.setAttribute("aria-label", mic.title);
  }
  const autoSend = $("deck-dictate-auto-send");
  if (autoSend) {
    autoSend.checked = state.settings?.deckDictateAutoSend === true;
    autoSend.disabled = busy || generating || deckDictationBusy;
  }
  if (deckListening) {
    setDeckChatStatus("deck.chatListening");
  } else if (deckDictationBusy) {
    setDeckChatStatus("deck.chatTranscribing");
  } else {
    setDeckChatStatus(
      state.chatBusy
        ? "deck.chatSending"
        : generating
          ? "deck.chatWorking"
          : "deck.chatReady"
    );
  }
  renderDeckClarifications();
}

function deckDictationEngine() {
  return String(state.settings?.dictationEngine || "gigaam").toLowerCase() ===
    "windows"
    ? "windows"
    : "gigaam";
}

function deckSpeechLang() {
  const loc = String(
    window.I18n?.getUiLocale?.() ||
      state.settings?.uiLocale ||
      navigator.language ||
      "en"
  ).toLowerCase();
  if (loc === "system") {
    return deckSpeechLangFromTag(navigator.language || "en");
  }
  return deckSpeechLangFromTag(loc);
}

function deckSpeechLangFromTag(tag) {
  const loc = String(tag || "en").toLowerCase();
  if (loc.startsWith("ru")) return "ru-RU";
  if (loc.startsWith("uk")) return "uk-UA";
  if (loc.startsWith("de")) return "de-DE";
  if (loc.startsWith("es")) return "es-ES";
  if (loc.startsWith("fr")) return "fr-FR";
  if (loc.startsWith("pt")) return "pt-BR";
  if (loc.startsWith("zh")) return "zh-CN";
  if (loc.startsWith("ja")) return "ja-JP";
  if (loc.startsWith("pl")) return "pl-PL";
  return "en-US";
}

function clearDeckDictationMaxTimer() {
  if (deckDictationMaxTimer) {
    clearTimeout(deckDictationMaxTimer);
    deckDictationMaxTimer = null;
  }
}

function teardownDeckMic() {
  clearDeckDictationMaxTimer();
  try {
    deckProcessor?.disconnect();
  } catch {
    /* ignore */
  }
  deckProcessor = null;
  try {
    deckAudioCtx?.close();
  } catch {
    /* ignore */
  }
  deckAudioCtx = null;
  if (deckMicStream) {
    for (const track of deckMicStream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  deckMicStream = null;
}

function stopDeckDictation() {
  deckDictationSession += 1;
  deckListening = false;
  teardownDeckMic();
  renderDeckChatControls();
}

function downsampleTo16k(float32, inputRate) {
  const rate = Number(inputRate) || 48000;
  if (rate === 16000) return float32;
  const ratio = rate / 16000;
  const outLen = Math.max(1, Math.floor(float32.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(i * ratio);
    out[i] = float32[idx] || 0;
  }
  return out;
}

function rmsOf(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

/** Seconds of hush before auto-end; Settings → General. */
function deckDictationSilenceSec() {
  const n = Number(state.settings?.dictationSilenceSec);
  if (!Number.isFinite(n)) return 3.5;
  return Math.min(15, Math.max(1, n));
}

/** Max take ms; 0 = unlimited. */
function deckDictationMaxMs() {
  const n = Number(state.settings?.dictationMaxSec);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1800, Math.max(5, Math.round(n))) * 1000;
}

async function finishDeckDictation(session, input, base, lang) {
  if (session !== deckDictationSession || deckDictationBusy) return;
  deckDictationBusy = true;
  // Invalidate duplicate finishers (silence + max timer + click).
  deckDictationSession += 1;
  deckListening = false;
  const chunks = deckPcmChunks;
  const inputRate = deckAudioCtx?.sampleRate || 48000;
  teardownDeckMic();
  renderDeckChatControls();
  setDeckChatStatus("deck.chatTranscribing");

  try {
    if (!chunks.length) {
      toast(window.I18n.t("deck.chatMicError"), "error");
      return;
    }
    const merged = new Float32Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) merged[i] = chunks[i];
    const pcm16k = downsampleTo16k(merged, inputRate);
    // Pass a plain number[] — ArrayBuffer can arrive empty/odd via Electron IPC.
    const samples = Array.from(pcm16k);
    const result = await window.keycode.dictateTranscribe({
      lang,
      engine: deckDictationEngine(),
      samples,
      sampleRate: 16000,
    });
    if (!result?.ok) {
      const key =
        result?.hint === "no_speech"
          ? "deck.chatMicError"
          : result?.hint === "no_lang"
            ? "deck.chatMicNoLang"
            : result?.hint === "gigaam_setup_failed"
              ? "deck.chatMicGigaamSetup"
              : result?.hint === "gigaam_failed"
                ? "deck.chatMicGigaamFail"
                : /denied|access|микрофон|microphone/i.test(
                      String(result?.error || "")
                    )
                  ? "deck.chatMicDenied"
                  : "deck.chatMicError";
      const detail = String(result?.error || "").trim();
      toast(
        detail && key === "deck.chatMicError"
          ? `${window.I18n.t(key)} (${detail.slice(0, 120)})`
          : window.I18n.t(key),
        "error"
      );
      return;
    }
    const spoken = String(result.text || "").trim();
    if (!spoken) {
      toast(window.I18n.t("deck.chatMicError"), "error");
      return;
    }
    if (input) {
      input.value = [base, spoken].filter(Boolean).join(" ").trim();
    }
    renderDeckChatControls();
    if (state.settings?.deckDictateAutoSend === true) {
      await sendDeckChatText();
      return;
    }
    const engLabel =
      result.engine === "windows"
        ? window.I18n.t("deck.chatMicEngineWindows")
        : window.I18n.t("deck.chatMicEngineGigaam");
    toast(`${engLabel}: ${window.I18n.t("chatPick.micReady")}`, "ok");
  } catch {
    toast(window.I18n.t("deck.chatMicError"), "error");
  } finally {
    deckDictationBusy = false;
    deckListening = false;
    renderDeckChatControls();
  }
}

async function startDeckDictation() {
  if (state.chatBusy || deckDictationBusy) return;
  if (deckListening) {
    const input = $("deck-composer-input");
    const session = deckDictationSession;
    const base = deckDictationBase;
    const lang = deckSpeechLang();
    await finishDeckDictation(session, input, base, lang);
    return;
  }
  const input = $("deck-composer-input");
  if (!input) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    toast(window.I18n.t("deck.chatMicUnsupported"), "error");
    return;
  }

  const lang = deckSpeechLang();
  const base = String(input.value || "").trim();
  deckDictationBase = base;
  deckPcmChunks = [];
  deckSpeechSeen = false;
  deckSilentFrames = 0;
  const session = ++deckDictationSession;

  try {
    deckMicStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch {
    toast(window.I18n.t("deck.chatMicDenied"), "error");
    return;
  }

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    deckAudioCtx = new Ctx();
    const source = deckAudioCtx.createMediaStreamSource(deckMicStream);
    const bufferSize = 4096;
    deckProcessor = deckAudioCtx.createScriptProcessor(bufferSize, 1, 1);
    const mute = deckAudioCtx.createGain();
    mute.gain.value = 0;
    // Keep ~0.2s before speech so word onsets are not clipped; drop earlier hush.
    const preRollMax = Math.max(
      bufferSize,
      Math.round(0.2 * (deckAudioCtx.sampleRate || 48000))
    );
    /** @type {number[]} */
    let preRoll = [];
    deckProcessor.onaudioprocess = (ev) => {
      if (session !== deckDictationSession) return;
      const inputData = ev.inputBuffer.getChannelData(0);
      const rms = rmsOf(inputData);
      if (rms >= 0.015) {
        if (!deckSpeechSeen && preRoll.length) {
          for (let i = 0; i < preRoll.length; i++) deckPcmChunks.push(preRoll[i]);
          preRoll = [];
        }
        deckSpeechSeen = true;
        deckSilentFrames = 0;
      } else if (deckSpeechSeen) {
        deckSilentFrames += 1;
      }
      if (!deckSpeechSeen) {
        for (let i = 0; i < inputData.length; i++) preRoll.push(inputData[i]);
        if (preRoll.length > preRollMax) {
          preRoll.splice(0, preRoll.length - preRollMax);
        }
      } else {
        for (let i = 0; i < inputData.length; i++) {
          deckPcmChunks.push(inputData[i]);
        }
      }
      // Hush length from Settings (dictationSilenceSec). Click mic to finish sooner.
      const silenceSec = deckDictationSilenceSec();
      const framesForSilence = Math.max(
        8,
        Math.round((silenceSec * (deckAudioCtx?.sampleRate || 48000)) / bufferSize)
      );
      if (deckSpeechSeen && deckSilentFrames >= framesForSilence) {
        finishDeckDictation(session, input, base, lang);
      }
    };
    source.connect(deckProcessor);
    deckProcessor.connect(mute);
    mute.connect(deckAudioCtx.destination);
  } catch {
    teardownDeckMic();
    toast(window.I18n.t("deck.chatMicError"), "error");
    return;
  }

  deckListening = true;
  renderDeckChatControls();
  setDeckChatStatus("deck.chatListening");
  clearDeckDictationMaxTimer();
  const maxMs = deckDictationMaxMs();
  if (maxMs > 0) {
    deckDictationMaxTimer = setTimeout(() => {
      if (session !== deckDictationSession) return;
      finishDeckDictation(session, input, base, lang);
    }, maxMs);
  }
}

async function sendDeckChatText() {
  const target = soloCdpTarget();
  const input = $("deck-composer-input");
  const text = String(input?.value || "");
  if (!target || state.chatBusy || !text.trim()) return;
  state.chatBusy = true;
  renderDeckChatControls();
  try {
    const result = await window.keycode.pasteTextToTarget({
      targetId: target.id,
      text,
    });
    if (!result?.ok) {
      toast(result?.error || window.I18n.t("deck.chatSendFailed"), "error");
      return;
    }
    input.value = "";
    toast(window.I18n.t("deck.chatSent"), "ok");
    window.setTimeout(() => refreshDeckTranscript({ select: false }).catch(() => {}), 350);
  } catch (error) {
    toast(String(error?.message || error) || window.I18n.t("deck.chatSendFailed"), "error");
  } finally {
    state.chatBusy = false;
    renderDeckChatControls();
  }
}

function deckModeErrorMessage(result) {
  const code = String(result?.hint || result?.error || "").toLowerCase();
  if (code === "mode_not_applied") {
    return window.I18n.t("deck.chatModeNotApplied");
  }
  if (code === "mode_not_found") {
    return window.I18n.t("deck.chatModeNotFound");
  }
  if (code === "mode_ui_missing" || code === "composer_ui_missing") {
    return window.I18n.t("deck.chatModeUiMissing");
  }
  if (
    code === "chat_missing" ||
    code === "chat_not_found" ||
    code === "rebind" ||
    /rebind|chat_not_found/i.test(String(result?.error || ""))
  ) {
    return window.I18n.t("deck.chatModeNeedRebind");
  }
  return result?.error || window.I18n.t("deck.chatModeFailed");
}

async function changeDeckChatMode(mode) {
  const target = soloCdpTarget();
  const want = String(mode || "").trim().toLowerCase();
  if (!target || !want || state.chatBusy) return;
  state.chatBusy = true;
  renderDeckChatControls();
  try {
    const result = await window.keycode.setDeckChatMode({
      targetId: target.id,
      mode: want,
    });
    if (!result?.ok) {
      toast(deckModeErrorMessage(result), "error");
      renderDeckChatControls();
      return;
    }
    if (result.composer) state.chatComposer = result.composer;
    else state.chatComposer = { ...state.chatComposer, mode: want };
    toast(window.I18n.t("deck.chatModeChanged"), "ok");
  } finally {
    state.chatBusy = false;
    renderDeckChatControls();
  }
}

async function answerDeckQuestion(button) {
  const target = soloCdpTarget();
  if (!target || state.chatBusy) return;
  state.chatBusy = true;
  renderDeckChatControls();
  try {
    const result = await window.keycode.answerDeckClarification({
      targetId: target.id,
      clarificationId: button.dataset.qid || "",
      optionId: button.dataset.oid || "",
      text: button.dataset.label || "",
      prompt: button.dataset.prompt || "",
    });
    if (!result?.ok) {
      toast(result?.error || window.I18n.t("deck.chatAnswerFailed"), "error");
      return;
    }
    state.clarifications = [];
    toast(window.I18n.t("deck.chatAnswered"), "ok");
    window.setTimeout(() => refreshDeckTranscript({ select: false }).catch(() => {}), 250);
  } finally {
    state.chatBusy = false;
    renderDeckChatControls();
  }
}

function applyDeckSuggestions(list) {
  const next = Array.isArray(list) ? list : [];
  const prev = state.suggestions || [];
  const same =
    prev.length === next.length &&
    prev.every(
      (s, i) =>
        s.cardId === next[i].cardId &&
        Number(s.rank) === Number(next[i].rank) &&
        String(s.deckId || "") === String(next[i].deckId || "")
    );
  state.suggestions = next;
  if (!same) {
    renderCards();
    renderPhaseNext();
  }
}

function clearDeckSuggestions() {
  if (!(state.suggestions || []).length) {
    const root = $("cards");
    if (root?.classList.contains("has-suggestions")) renderCards();
    renderPhaseNext();
    return;
  }
  state.suggestions = [];
  renderCards();
  renderPhaseNext();
}

function activeDeckId() {
  return state.deck?.id || state.settings?.activeDeckId || "";
}

function renderPhaseNext() {
  const btn = $("btn-phase-next");
  if (!btn) return;
  const active = activeDeckId();
  const cross = (state.suggestions || []).find(
    (s) => s?.deckId && s.deckId !== active && s.cardId
  );
  if (!cross) {
    btn.hidden = true;
    btn.classList.add("hidden");
    btn.textContent = "";
    return;
  }
  const decks = state.decks || [];
  const deckName = cross.deckName || decks.find((d) => d.id === cross.deckId)?.name || cross.deckId;
  const cardTitle = cross.cardTitle || cross.cardId;
  const label = window.I18n.t("hint.nextPhase", { deck: deckName, card: cardTitle });
  btn.hidden = false;
  btn.classList.remove("hidden");
  btn.textContent = label;
  btn.title = label;
  btn.setAttribute(
    "aria-label",
    window.I18n.t("hint.nextPhaseAria", { deck: deckName, card: cardTitle })
  );
  btn.dataset.deckId = cross.deckId;
}

async function switchToSuggestedDeck() {
  const btn = $("btn-phase-next");
  const deckId = btn?.dataset?.deckId;
  if (!deckId) return;
  await window.keycode.setActiveDeck(deckId);
  await refresh();
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

/** OS focus of the deck BrowserWindow (main process). Click-through makes document.hasFocus() lie. */
let deckWindowFocused = false;

function deckIsActiveWindow() {
  return deckWindowFocused;
}

function setDeckWindowFocused(on) {
  const next = !!on;
  if (deckWindowFocused === next) {
    if (!next) hideCardPreview();
    return;
  }
  deckWindowFocused = next;
  if (!deckWindowFocused) hideCardPreview();
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
/** @type {ReturnType<typeof setInterval> | null} */
let passthroughPollTimer = null;
let passthroughPollBusy = false;

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
  const manualBar = document.getElementById("deck-manual-bar");
  if (
    manualBar &&
    !manualBar.classList.contains("hidden") &&
    pointInRect(x, y, manualBar.getBoundingClientRect(), 4)
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

/**
 * Windows often stops forwarding mousemove while another app is focused
 * (setIgnoreMouseEvents + forward). Poll screen cursor so buttons stay clickable.
 */
function startPassthroughPoll() {
  if (passthroughPollTimer) return;
  passthroughPollTimer = setInterval(() => {
    if (!state.revealed || passthroughPollBusy) return;
    passthroughPollBusy = true;
    window.keycode
      .getCursorClient?.()
      .then((p) => {
        if (!p || typeof p.x !== "number" || !state.revealed) return;
        updateMousePassthrough(p.x, p.y);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        passthroughPollBusy = false;
      });
  }, 50);
}

function stopPassthroughPoll() {
  if (!passthroughPollTimer) return;
  clearInterval(passthroughPollTimer);
  passthroughPollTimer = null;
  passthroughPollBusy = false;
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

  const active = state.deck?.id || state.settings?.activeDeckId;
  const hasSuggestions = (state.suggestions || []).some(
    (s) =>
      s?.cardId &&
      (s.rank === 1 || s.rank === 2) &&
      (!s.deckId || s.deckId === active)
  );
  root.classList.toggle("has-suggestions", hasSuggestions);

  root.innerHTML = cards
    .map((card, index) => {
      const preset = window.tarotPreset(card.image);
      const src = window.tarotImageUrl(card.image);
      const action =
        String(card.title || "").trim() || shortAction(card.description, 4);
      const sug = (state.suggestions || []).find(
        (s) => s.cardId === card.id && (!s.deckId || s.deckId === active)
      );
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

const ONBOARDING_STEP_COUNT = 11;
let onboardingStep = 0;
let onboardingLayoutBound = false;

/**
 * Top → bottom on the deck, then Settings phone/decks, with mid + finale celebrations.
 */
const ONBOARDING_STEPS = [
  { target: "#btn-corner-cdp", prepare: "cdp", pad: 6 },
  { target: "#corner-dock", pad: 4 },
  { target: "#deck-pager", pad: 5 },
  { target: "#btn-new-chat", fallback: "#dest-bar", prepare: "dest", pad: 6 },
  { target: "#deck-transcript", prepare: "transcript", pad: 6 },
  {
    target: "#deck-composer-shell",
    fallback: "#btn-deck-manual",
    prepare: "manual",
    pad: 6,
  },
  { center: true, art: "assets/onboarding-mid.png", celebrate: true },
  { target: "#cards", prepare: "cards", pad: 6 },
  {
    host: "settings",
    settings: { page: "phone", highlight: "#settings-phone-spotlight" },
  },
  {
    host: "settings",
    settings: { page: "decks", highlight: "#settings-decks-tour" },
  },
  {
    center: true,
    art: "assets/onboarding-finale.png",
    celebrate: true,
    prepare: "farewell",
    bravo: true,
  },
];

function isOnboardingVisible() {
  const el = $("onboarding");
  return !!(el && !el.classList.contains("hidden"));
}

function resolveOnboardingTarget(sel) {
  if (!sel) return null;
  const el = document.querySelector(sel);
  if (!el) return null;
  if (el.classList.contains("hidden")) return null;
  if (sel === "#cards") {
    const first = el.querySelector(".card, button.card, [data-card-id]");
    return first || el;
  }
  return el;
}

function rectsOverlap(a, b, margin = 0) {
  return !(
    a.right + margin <= b.left ||
    a.left - margin >= b.right ||
    a.bottom + margin <= b.top ||
    a.top - margin >= b.bottom
  );
}

function placeOnboardingCoach(targetEl, opts = {}) {
  const hole = $("onboarding-hole");
  const card = $("onboarding-card");
  const arrow = $("onboarding-arrow");
  if (!hole || !card) return;

  const pad = opts.pad ?? 5;
  const gap = 20;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const celebrate = !!opts.celebrate;
  const cardW = Math.min(celebrate ? 360 : 300, vw - 24);

  card.classList.toggle("celebrate", celebrate);
  card.style.width = `${cardW}px`;

  if (!targetEl) {
    hole.style.display = "none";
    if (arrow) {
      arrow.className = "onboarding-arrow";
      arrow.style.visibility = "hidden";
    }
    const cardH = Math.max(card.offsetHeight || 200, 160);
    card.style.left = `${Math.max(12, (vw - cardW) / 2)}px`;
    card.style.top = `${Math.max(12, (vh - cardH) / 2)}px`;
    return;
  }

  const r = targetEl.getBoundingClientRect();
  const holeLeft = Math.max(4, r.left - pad);
  const holeTop = Math.max(4, r.top - pad);
  const holeW = Math.min(vw - 8, r.width + pad * 2);
  const holeH = Math.min(vh - 8, r.height + pad * 2);
  const holeRight = holeLeft + holeW;
  const holeBottom = holeTop + holeH;
  const holeCx = holeLeft + holeW / 2;
  const holeCy = holeTop + holeH / 2;
  const holeBox = {
    left: holeLeft,
    top: holeTop,
    right: holeRight,
    bottom: holeBottom,
  };

  hole.style.display = "block";
  hole.style.left = `${holeLeft}px`;
  hole.style.top = `${holeTop}px`;
  hole.style.width = `${holeW}px`;
  hole.style.height = `${holeH}px`;

  const cardH = Math.max(card.offsetHeight || 170, 140);

  const candidates = [
    { place: "below", left: holeCx - cardW / 2, top: holeBottom + gap },
    { place: "above", left: holeCx - cardW / 2, top: holeTop - gap - cardH },
    { place: "right", left: holeRight + gap, top: holeCy - cardH / 2 },
    { place: "left", left: holeLeft - gap - cardW, top: holeCy - cardH / 2 },
  ];

  let best = null;
  for (const c of candidates) {
    const left = Math.min(Math.max(10, c.left), vw - cardW - 10);
    const top = Math.min(Math.max(10, c.top), vh - cardH - 10);
    const box = {
      left,
      top,
      right: left + cardW,
      bottom: top + cardH,
    };
    if (rectsOverlap(box, holeBox, 8)) continue;
    const score = Math.abs(left - c.left) + Math.abs(top - c.top);
    if (!best || score < best.score) {
      best = { place: c.place, left, top, score };
    }
  }

  if (!best) {
    best = {
      place: "below",
      left: Math.min(Math.max(10, holeRight - cardW), vw - cardW - 10),
      top: Math.min(holeBottom + gap, vh - cardH - 10),
      score: 9999,
    };
  }

  card.style.left = `${best.left}px`;
  card.style.top = `${best.top}px`;

  if (arrow) {
    arrow.style.visibility = "visible";
    arrow.className = `onboarding-arrow ${best.place}`;
    if (best.place === "below" || best.place === "above") {
      const ax = Math.min(Math.max(16, holeCx - best.left - 6), cardW - 28);
      arrow.style.left = `${ax}px`;
      arrow.style.right = "auto";
      arrow.style.top = best.place === "below" ? "-7px" : "auto";
      arrow.style.bottom = best.place === "above" ? "-7px" : "auto";
    } else {
      const ay = Math.min(Math.max(16, holeCy - best.top - 6), cardH - 28);
      arrow.style.top = `${ay}px`;
      arrow.style.bottom = "auto";
      arrow.style.left = best.place === "right" ? "-7px" : "auto";
      arrow.style.right = best.place === "left" ? "-7px" : "auto";
    }
  }
}

async function prepareOnboardingStep(step) {
  if (!step) return;
  if (step.prepare === "cdp") {
    await refreshCdpCornerState();
  }
  if (step.prepare === "dest") {
    const bar = $("dest-bar");
    if (bar) bar.classList.remove("hidden");
    $("btn-new-chat")?.classList.remove("hidden");
  }
  if (
    step.prepare === "transcript" ||
    step.prepare === "manual" ||
    step.prepare === "cards"
  ) {
    const patch = {};
    if (state.settings?.deckTranscriptOpen === false) {
      patch.deckTranscriptOpen = true;
    }
    if (state.settings?.deckCardsOpen === false) {
      patch.deckCardsOpen = true;
    }
    if (step.prepare === "manual" && state.settings?.deckComposerOpen !== true) {
      patch.deckComposerOpen = true;
      const chatS = Math.min(
        1.5,
        Math.max(0.75, Number(state.settings?.chatScale) || 1)
      );
      const cur = clampTranscriptHeight(state.settings?.deckTranscriptHeightPx);
      const want = Math.max(cur, Math.round(220 * chatS));
      if (want > cur) patch.deckTranscriptHeightPx = Math.min(900, want);
    }
    if (Object.keys(patch).length) {
      state.settings = await window.keycode.saveSettings(patch);
    }
    syncDeckTranscript();
    syncDeckCards();
    $("deck-transcript")?.classList.remove("hidden");
    if (step.prepare === "cards") {
      $("cards-zone")?.classList.remove("hidden");
      document.body.classList.remove("cards-collapsed");
    }
    if (step.prepare === "manual") {
      $("deck-manual-bar")?.classList.remove("hidden");
      setDeckChatControlsVisible(true);
      syncManualToggleBtn(true);
    }
  }
  if (step.prepare === "farewell") {
    window.keycode.settingsFocusClear?.();
    await window.keycode.closeSettings?.();
    await window.keycode.closeTargets?.();
    await window.keycode.focusDeck?.();
    await new Promise((r) => setTimeout(r, 120));
  }
}

function layoutOnboardingStep() {
  if (!isOnboardingVisible()) return;
  const root = $("onboarding");
  const step = ONBOARDING_STEPS[onboardingStep] || {};
  root?.classList.toggle("host-settings", step.host === "settings");
  root?.classList.remove("host-targets");
  if (step.host === "settings") {
    return;
  }
  let target = resolveOnboardingTarget(step.target);
  if (!target && step.fallback) {
    target = resolveOnboardingTarget(step.fallback);
  }
  if (step.center) target = null;
  placeOnboardingCoach(target, {
    pad: step.pad,
    celebrate: step.celebrate,
  });
}

function ensureOnboardingLayoutListeners() {
  if (onboardingLayoutBound) return;
  onboardingLayoutBound = true;
  window.addEventListener("resize", () => {
    if (isOnboardingVisible()) layoutOnboardingStep();
  });
}

function syncOnboardingArt(step) {
  const art = $("onboarding-art");
  if (!art) return;
  if (step?.art) {
    art.src = step.art;
    art.classList.remove("hidden");
  } else {
    art.removeAttribute("src");
    art.classList.add("hidden");
  }
}

function renderOnboardingStep() {
  if (!isOnboardingVisible()) return;
  const idx = Math.max(0, Math.min(onboardingStep, ONBOARDING_STEP_COUNT - 1));
  onboardingStep = idx;
  const n = idx + 1;
  const step = ONBOARDING_STEPS[idx] || {};
  const title = $("onboarding-step-title");
  const body = $("onboarding-body");
  const next = $("onboarding-next");
  const dots = $("onboarding-dots");
  syncOnboardingArt(step);
  if (title) title.textContent = window.I18n.t(`onboarding.s${n}.title`);
  if (body) body.innerHTML = window.I18n.t(`onboarding.s${n}.body`);
  if (next) {
    const last = idx >= ONBOARDING_STEP_COUNT - 1;
    const bravo = !!step.bravo;
    next.textContent = window.I18n.t(
      bravo ? "onboarding.bravo" : last ? "onboarding.done" : "onboarding.next"
    );
  }
  if (dots) {
    dots.innerHTML = "";
    for (let i = 0; i < ONBOARDING_STEP_COUNT; i++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "onboarding-dot" + (i === idx ? " active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", i === idx ? "true" : "false");
      btn.setAttribute("aria-label", String(i + 1));
      btn.addEventListener("click", () => {
        goOnboardingStep(i);
      });
      dots.appendChild(btn);
    }
  }
  prepareOnboardingStep(step)
    .then(() => {
      layoutOnboardingStep();
      requestAnimationFrame(() => {
        layoutOnboardingStep();
        focusOnboardingNext();
      });
      syncOnboardingHostFocus();
    })
    .catch(() => {
      layoutOnboardingStep();
      focusOnboardingNext();
      syncOnboardingHostFocus();
    });
}

function syncOnboardingHostFocus() {
  const step = ONBOARDING_STEPS[onboardingStep] || {};
  const common = {
    tour: true,
    step: onboardingStep + 1,
    stepCount: ONBOARDING_STEP_COUNT,
    hasMore: onboardingStep < ONBOARDING_STEP_COUNT - 1,
  };
  if (step.settings) {
    window.keycode.openSettings?.({
      page: step.settings.page,
      highlight: step.settings.highlight,
      ...common,
    });
    // Re-nudge after open in case the first focus event was missed.
    setTimeout(() => window.keycode.settingsUiReady?.(), 80);
    return;
  }
  window.keycode.settingsFocusClear?.();
  if (state.targetsWindowOpen) {
    window.keycode.closeTargets?.();
  }
}

function focusOnboardingNext() {
  const step = ONBOARDING_STEPS[onboardingStep];
  if (step?.host === "settings") return;
  const btn = $("onboarding-next");
  if (!btn || btn.closest?.(".hidden")) return;
  const aim = () => {
    try {
      btn.focus({ preventScroll: true });
    } catch {
      try {
        btn.focus();
      } catch {
        /* ignore */
      }
    }
    const r = btn.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      window.keycode.pointerMoveInWindow?.({
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      });
    }
  };
  aim();
  setTimeout(aim, 60);
  setTimeout(aim, 180);
}

function goOnboardingStep(i) {
  onboardingStep = Math.max(0, Math.min(i, ONBOARDING_STEP_COUNT - 1));
  renderOnboardingStep();
}

function startOnboarding() {
  const el = $("onboarding");
  if (!el) return;
  onboardingStep = 0;
  el.classList.remove("hidden", "host-settings", "host-targets");
  window.keycode.setModalHold?.(true);
  ensureOnboardingLayoutListeners();
  renderOnboardingStep();
  requestAnimationFrame(() => layoutOnboardingStep());
}

function maybeShowOnboarding() {
  const el = $("onboarding");
  if (!el) return;
  if (state.settings?.firstRunDone) {
    el.classList.add("hidden");
    return;
  }
  startOnboarding();
}

function advanceOnboarding() {
  if (onboardingStep >= ONBOARDING_STEP_COUNT - 1) {
    dismissOnboarding();
    return;
  }
  onboardingStep += 1;
  renderOnboardingStep();
}

async function dismissOnboarding() {
  const el = $("onboarding");
  if (el) {
    el.classList.add("hidden");
    el.classList.remove("host-settings", "host-targets");
  }
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
    action.textContent = window.I18n.t("cdp.launchBtn");
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
    if (running) {
      showCdpNudge({ cursorRunning: true });
      return;
    }
    toast(window.I18n.t("cdp.launching"), "");
    const r = await window.keycode.cursorLaunchIntegration({
      mode: "background",
      allowRestart: false,
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
  requestAnimationFrame(() => {
    const promptEl = $("card-prompt");
    promptEl?.focus({ preventScroll: true });
    promptEl?.scrollIntoView({ block: "nearest" });
  });
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

  $("btn-corner-help")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    startOnboarding();
  });

  $("btn-corner-settings").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.openSettings();
  });

  $("btn-corner-cdp")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    hideCardPreview();
    try {
      const probe = await window.keycode.cursorProbe();
      if (probe?.ok || probe?.open) {
        setCdpCornerState("ok");
        toast(probe.hint || window.I18n.t("cdp.alreadyOk"), "ok");
        return;
      }
      showCdpNudge(probe || {});
    } catch (err) {
      toast(String(err.message || err), "error");
    }
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
    const pruneBtn = e.target.closest?.("#btn-dest-prune");
    if (pruneBtn) {
      e.stopPropagation();
      removeOtherDestinations();
      return;
    }
    const toggleBtn = e.target.closest?.("#btn-transcript-toggle");
    if (toggleBtn) {
      e.stopPropagation();
      toggleDeckTranscript();
      return;
    }
    const cardsBtn = e.target.closest?.("#btn-cards-toggle");
    if (cardsBtn) {
      e.stopPropagation();
      toggleDeckCards();
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

  $("btn-new-chat")?.addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.openChatPick();
  });

  $("btn-deck-manual")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDeckComposer();
  });

  $("deck-composer-input")?.addEventListener("input", () => {
    renderDeckChatControls();
  });
  $("deck-composer-input")?.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendDeckChatText();
    }
  });
  $("btn-deck-send")?.addEventListener("click", (e) => {
    e.stopPropagation();
    sendDeckChatText();
  });
  $("btn-deck-mic")?.addEventListener("click", (e) => {
    e.stopPropagation();
    startDeckDictation();
  });
  $("deck-dictate-auto-send")?.addEventListener("change", async (e) => {
    e.stopPropagation();
    state.settings = await window.keycode.saveSettings({
      deckDictateAutoSend: e.target.checked === true,
    });
    renderDeckChatControls();
  });
  $("deck-mode")?.addEventListener("change", (e) => {
    e.stopPropagation();
    changeDeckChatMode(e.target.value);
  });
  window.addEventListener("resize", () => {
    applyTranscriptHeight(state.settings?.deckTranscriptHeightPx);
  });
  $("deck-clarifications")?.addEventListener("click", (e) => {
    const button = e.target.closest?.(".deck-clarify-option");
    if (!button) return;
    e.stopPropagation();
    answerDeckQuestion(button);
  });

  {
    let resizeStartY = 0;
    let resizeStartH = 0;
    let resizing = false;
    // Top dock: drag bottom edge down to grow (Windows). Bottom dock: drag top edge up to grow.
    // Use screenY so bottom-dock window moves don't invert client coordinates mid-drag.
    const resizeDelta = (screenY) => {
      const dy = screenY - resizeStartY;
      return state.dock === "bottom" ? resizeStartH - dy : resizeStartH + dy;
    };
    const onMove = (e) => {
      if (!resizing) return;
      const next = clampTranscriptHeight(resizeDelta(e.screenY));
      applyTranscriptHeight(next);
      if (state.settings) state.settings.deckTranscriptHeightPx = next;
      // Keep the Electron window edge glued to the cursor on top/bottom docks.
      if (state.dock === "top" || state.dock === "bottom") {
        window.keycode.previewSettings?.({ deckTranscriptHeightPx: next });
      }
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
      resizeStartY = e.screenY;
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

  $("onboarding-skip")?.addEventListener("click", () => dismissOnboarding());
  $("onboarding-next")?.addEventListener("click", () => advanceOnboarding());

  $("btn-deck-prev")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await cycleDeck(-1);
  });
  $("btn-deck-next")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await cycleDeck(1);
  });
  $("btn-phase-next")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await switchToSuggestedDeck();
  });

$("card-cancel").addEventListener("click", closeCardEditor);
  $("card-save").addEventListener("click", saveCardEditor);
  $("card-delete").addEventListener("click", deleteEditingCard);

  document.addEventListener("keydown", (e) => {
    if (
      (e.key === "Enter" || e.key === " ") &&
      isOnboardingVisible() &&
      !ONBOARDING_STEPS[onboardingStep]?.host
    ) {
      const tag = String(e.target?.tagName || "").toLowerCase();
      if (tag !== "textarea" && tag !== "input") {
        e.preventDefault();
        advanceOnboarding();
        return;
      }
    }
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
    startPassthroughPoll();
    // Два кадра — окно успевает показаться скрытым, потом плавный выезд
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRevealed(true);
        const zone = document.querySelector(".cards-zone");
        if (zone) zone.scrollTop = 0;
        syncMousePassthroughFromCursor();
      });
    });
  });
  window.keycode.onDeckConceal(() => {
    setRevealed(false);
    stopCdpStatusWatch();
    stopPassthroughPoll();
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
    if (isOnboardingVisible() && ONBOARDING_STEPS[onboardingStep]?.host === "settings") {
      // Stay on this step; user can reopen via Next / re-sync
      syncOnboardingHostFocus();
    }
  });
  window.keycode.onTargetsClosed(() => {
    state.targetsWindowOpen = false;
    if (isOnboardingVisible() && ONBOARDING_STEPS[onboardingStep]?.host === "targets") {
      syncOnboardingHostFocus();
    }
  });
  window.keycode.onTourHostAdvance?.(() => {
    advanceOnboarding();
  });
  window.keycode.onTourHostSkip?.(() => {
    dismissOnboarding();
  });
  // Back-compat aliases if older preload still fires these names
  window.keycode.onSettingsTourDone?.(() => advanceOnboarding());
  window.keycode.onSettingsTourSkip?.(() => dismissOnboarding());
  window.keycode.onTargetsOpen(() => {
    state.targetsWindowOpen = true;
    hideCardPreview();
  });
  window.keycode.onSettingsPreview((partial) => {
    state.settings = { ...state.settings, ...partial };
    applyOpacity(state.settings);
    applyCardFonts(state.settings);
    applyChatFonts(state.settings);
    if (partial.panelScale != null || partial.chatScale != null) {
      applyPanelScale(state.settings);
    }
    if (partial.deckTranscriptHeightPx != null) {
      applyTranscriptHeight(partial.deckTranscriptHeightPx);
    }
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

  window.keycode.onDeckFocusChanged?.((data) => {
    setDeckWindowFocused(!!data?.focused);
    // Always resync hit-test: blur often breaks mouse-forward until next move
    syncMousePassthroughFromCursor().then(() => {
      if (!deckWindowFocused) return;
      window.keycode.getCursorClient?.().then((p) => {
        if (!p || typeof p.x !== "number" || !deckWindowFocused) return;
        updatePreviewHover(p.x, p.y);
      });
    });
  });
  // Backup if IPC focus events are delayed
  let focusCheckGen = 0;
  window.addEventListener("blur", () => {
    focusCheckGen += 1;
    setDeckWindowFocused(false);
    syncMousePassthroughFromCursor();
  });
  window.addEventListener("focus", async () => {
    const gen = (focusCheckGen += 1);
    try {
      const focused = await window.keycode.getDeckFocused?.();
      if (gen !== focusCheckGen) return;
      setDeckWindowFocused(typeof focused === "boolean" ? focused : true);
      if (!deckWindowFocused) return;
      const p = await window.keycode.getCursorClient?.();
      if (gen !== focusCheckGen) return;
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

  window.keycode.getDeckFocused?.().then((focused) => {
    setDeckWindowFocused(!!focused);
  });
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
