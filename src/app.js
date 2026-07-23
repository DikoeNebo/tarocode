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
};

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
  root.style.setProperty("--rail-w", `${Math.round(148 * s)}px`);
  root.style.setProperty("--radius", `${Math.round(8 * s)}px`);
  root.style.setProperty("--radius-inner", `${Math.round(6 * s)}px`);
  root.style.setProperty("--corner-font-size", `${Math.max(11, Math.round(14 * s))}px`);
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
  renderTargetRail();
  renderCards();
  document.body.classList.toggle("edit-mode", state.editMode);
}

function targetPointsOverlap(t) {
  if (!t?.focusPoint || !t?.inputPoint) return false;
  const dx = Number(t.focusPoint.x) - Number(t.inputPoint.x);
  const dy = Number(t.focusPoint.y) - Number(t.inputPoint.y);
  return dx * dx + dy * dy <= 12 * 12;
}

function targetKindLabel(t) {
  if (t.needsCdpRebind) return window.I18n.t("driver.rebindChat");
  if (t.needsUiaRebind && t.driver !== "cdp") return window.I18n.t("driver.rebindChatUia");
  if (t.driver === "cdp") return window.I18n.t("driver.cdp");
  if (t.driver === "uia-quiet") return window.I18n.t("driver.quiet");
  if (t.driver === "uia") return window.I18n.t("driver.uiaLegacy");
  if (targetPointsOverlap(t)) return window.I18n.t("driver.bindError");
  if (t.inputPoint && !t.legacy) return window.I18n.t("driver.windowField");
  if (t.legacy || !t.inputPoint) return window.I18n.t("driver.needField");
  return window.I18n.t("driver.windowField");
}

function renderTargetRail() {
  const list = $("target-rail-list");
  if (!list) return;
  const targets = state.settings?.targets || [];
  if (!targets.length) {
    list.innerHTML =
      '<div class="rail-empty">' + window.I18n.t("rail.empty") + "</div>";
    return;
  }
  list.innerHTML = targets
    .map((t) => {
      const kind = targetKindLabel(t);
      const sub =
        kind +
        (t.fullTitle && t.fullTitle !== t.name ? ` · ${t.fullTitle}` : "");
      const broken =
        t.needsCdpRebind ||
        t.needsUiaRebind ||
        t.legacy ||
        (t.driver !== "cdp" &&
          t.driver !== "uia" &&
          t.driver !== "uia-quiet" &&
          (!t.inputPoint || targetPointsOverlap(t)));
      return `
      <button type="button"
        class="rail-chip ${t.enabled ? "on" : "off"} ${
          broken ? "needs-field" : ""
        }"
        data-rail-toggle="${escapeAttr(t.id)}"
        title="${escapeAttr(t.fullTitle || t.match || t.name || "")}">
        <span class="rail-chip-label">${escapeHtml(t.name || "?")}</span>
        <span class="rail-chip-sub">${escapeHtml(sub)}</span>
      </button>`;
    })
    .join("");
}

async function setTargetsEnabled(updater) {
  const targets = updater(state.settings?.targets || []);
  state.settings = await window.keycode.saveSettings({ targets });
  syncTargetsBadge();
  renderTargetRail();
}

async function pickTargetFromRail(mode = "field") {
  if (mode === "cursor" || mode === "agent") {
    toast(window.I18n.t("rail.openingChats"), "");
    await window.keycode.openChatPick();
    return;
  }
  toast(window.I18n.t("rail.clickField"), "");
  const result = await window.keycode.startTargetPick("field");
  await refresh();
  if (result?.ok && result.duplicate) {
    toast(window.I18n.t("rail.duplicateField"), "error");
  } else if (result?.ok) {
    toast(window.I18n.t("rail.addedField", { name: result.target?.name || window.I18n.t("rail.fieldFallback") }), "ok");
  } else if (result?.canceled) {
    /* silent */
  } else if (result?.error) toast(result.error, "error");
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
  if (!badge || !btn) return;
  const targets = state.settings?.targets || [];
  const enabled = targets.filter((t) => t.enabled).length;
  if (!targets.length) {
    badge.textContent = "!";
    badge.classList.remove("hidden");
    badge.classList.add("warn");
    btn.title = window.I18n.t("rail.targetsManage");
  } else if (!enabled) {
    badge.textContent = "0";
    badge.classList.remove("hidden", "warn");
    btn.title = window.I18n.t("rail.targetsNone");
  } else {
    badge.textContent = String(enabled);
    badge.classList.remove("hidden", "warn");
    btn.title = window.I18n.t("rail.targetsCount", { n: enabled });
  }
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

function updatePreviewHover(clientX, clientY) {
  if (state.settingsWindowOpen || state.targetsWindowOpen) {
    if (!$("card-preview").classList.contains("hidden")) hideCardPreview();
    return;
  }
  if (state.settings?.showCardPreview === false) {
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

  const dock = state.dock || "right";
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
    left = rect.left - tipRect.width - gap;
    top = rect.top;
  } else if (dock === "left") {
    left = rect.right + gap;
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
    left = Math.min(left, rect.left - tipRect.width - gap);
    left = Math.max(8, left);
  } else if (dock === "left") {
    left = Math.max(left, rect.right + gap);
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
  for (const card of document.querySelectorAll(".card")) {
    if (pointInRect(x, y, card.getBoundingClientRect(), 2)) return true;
  }
  const rail = document.getElementById("target-rail");
  if (rail && pointInRect(x, y, rail.getBoundingClientRect(), 4)) return true;
  const stripDeck = document.querySelector(".strip-deck-pager");
  if (stripDeck && pointInRect(x, y, stripDeck.getBoundingClientRect(), 4)) {
    return true;
  }
  const onboarding = document.getElementById("onboarding");
  if (
    onboarding &&
    !onboarding.classList.contains("hidden") &&
    pointInRect(x, y, onboarding.getBoundingClientRect(), 0)
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
  if (countEl) countEl.textContent = `${cards.length}/8`;

  if (!cards.length) {
    root.innerHTML =
      '<div class="empty-targets">' + window.I18n.t("cards.empty") + "</div>";
    return;
  }

  root.innerHTML = cards
    .map((card) => {
      const preset = window.tarotPreset(card.image);
      const src = window.tarotImageUrl(card.image);
      const action = shortAction(card.title || card.description);
      return `
      <article class="card" data-id="${escapeAttr(card.id)}">
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
  const enabled = (state.settings?.targets || []).filter((t) => t.enabled).length;
  if (!enabled) {
    toast(window.I18n.t("cards.pickTarget"), "error");
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
  if (state.deck.cards.length >= 8) {
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

  $("btn-corner-targets").addEventListener("click", (e) => {
    e.stopPropagation();
    hideCardPreview();
    window.keycode.openTargets();
  });

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

  $("btn-rail-all")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await setTargetsEnabled((targets) =>
      targets.map((t) => ({ ...t, enabled: true }))
    );
  });

  $("btn-rail-none")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    await setTargetsEnabled((targets) =>
      targets.map((t) => ({ ...t, enabled: false }))
    );
  });

  $("btn-rail-pick")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    hideCardPreview();
    await pickTargetFromRail("field");
  });

  $("btn-rail-agent")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    hideCardPreview();
    await pickTargetFromRail("cursor");
  });

  $("target-rail-list")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-rail-toggle]");
    if (!btn) return;
    e.stopPropagation();
    const id = btn.getAttribute("data-rail-toggle");
    await setTargetsEnabled((targets) =>
      targets.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t))
    );
  });

  $("card-cancel").addEventListener("click", closeCardEditor);
  $("card-save").addEventListener("click", saveCardEditor);
  $("card-delete").addEventListener("click", deleteEditingCard);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
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
    }
  });

  $("cards").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      e.stopPropagation();
      openCardEditor(edit.getAttribute("data-edit"));
      return;
    }
    const send = e.target.closest("[data-send]");
    if (send) {
      onPasteCard(send.getAttribute("data-send"));
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    onPasteCard(card.getAttribute("data-id"));
  });

  window.keycode.onToast((data) => toast(data.message, data.type || ""));
  window.keycode.onPasteDone((data) => {
    if (!document.hasFocus()) {
      const t = formatPasteToast(data.results);
      toast(t.message, t.type);
    }
  });

  window.keycode.onDeckReveal(() => {
    document.body.classList.remove("concealing", "booting");
    setPreviewAllowed(false);
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
    if (partial.targets) {
      syncTargetsBadge();
      renderTargetRail();
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

  // По умолчанию клики сквозь прозрачную зону
  window.keycode.setIgnoreMouse?.(true);
  lastIgnoreMouse = true;
}

bindEvents();
refresh()
  .then(() => waitForCardImages(1200))
  .then(() => window.keycode.deckUiReady?.())
  .catch((e) => {
    console.error(e);
    toast(window.I18n.t("cards.loadError"), "error");
    window.keycode.deckUiReady?.();
  });
