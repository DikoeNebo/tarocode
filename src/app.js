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

function setRevealed(on) {
  state.revealed = !!on;
  document.body.classList.toggle("revealed", state.revealed);
  document.body.classList.toggle("concealing", !state.revealed);
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
  root.style.setProperty("--radius", `${Math.round(8 * s)}px`);
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

async function refresh() {
  const data = await window.keycode.getState();
  state.settings = data.settings;
  state.decks = data.decks;
  state.deck = data.deck;
  state.pinnedOpen = !!data.pinnedOpen;
  applyDockClass(data.dock || data.settings?.dock, data.horizontal, data.expanded);
  applyFullscreenEdit(!!data.fullscreenEdit);
  applyOpacity(data.settings);
  applyCardFonts(data.settings);
  applyPanelScale(data.settings);
  renderAll();
}

function renderAll() {
  renderDeckSelect();
  syncTargetsBadge();
  renderCards();
  document.body.classList.toggle("edit-mode", state.editMode);
  $("btn-edit-mode")?.classList.toggle("active", state.editMode);
  const addBtn = $("btn-add-card");
  if (addBtn) addBtn.disabled = (state.deck?.cards?.length || 0) >= 8;
}

function renderDeckSelect() {
  const sel = $("deck-select");
  const active = state.settings?.activeDeckId;
  sel.innerHTML = (state.decks || [])
    .map(
      (d) =>
        `<option value="${escapeAttr(d.id)}" ${
          d.id === active ? "selected" : ""
        }>${escapeHtml(d.name)}</option>`
    )
    .join("");
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
    btn.title = "Куда отправлять — нет целей";
  } else if (!enabled) {
    badge.textContent = "0";
    badge.classList.remove("hidden", "warn");
    btn.title = "Куда отправлять — никто не выбран";
  } else {
    badge.textContent = String(enabled);
    badge.classList.remove("hidden", "warn");
    btn.title = `Куда отправлять — ${enabled} чат(ов)`;
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
  cancelPreviewHide();
  const preset = window.tarotPreset(card.image);
  const el = $("card-preview");
  if (!el || !anchorEl) return;

  state.previewCardId = card.id;

  el.innerHTML = `
    <div class="preview-tarot">${escapeHtml(preset.name)}</div>
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
  const tipRect = el.getBoundingClientRect();
  el.style.visibility = "";

  const dock = state.dock || "right";
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
    const belowBar = barRect ? barRect.bottom + gap : zoneRect.bottom + gap;
    top = belowBar;
  } else {
    // Снизу: кнопки над картами — превью выше кнопок
    left = Math.max(
      8,
      Math.min(
        rect.left + rect.width / 2 - tipRect.width / 2,
        window.innerWidth - tipRect.width - 8
      )
    );
    const aboveBar = barRect
      ? barRect.top - tipRect.height - gap
      : zoneRect.top - tipRect.height - gap;
    top = aboveBar;
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

function hitCapturesMouse(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  if (
    el.closest(
      ".card, .corner-btn, .corner-dock, .titlebar, .chrome, .modal:not(.hidden), .toast:not(.hidden), .card-preview:not(.hidden)"
    )
  ) {
    return true;
  }
  // Мост к превью: зона между картой и описанием тоже кликабельна, пока превью открыто
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

function renderCards() {
  const root = $("cards");
  const cards = state.deck?.cards || [];
  const countEl = $("card-count");
  if (countEl) countEl.textContent = `${cards.length}/8`;

  if (!cards.length) {
    root.innerHTML =
      '<div class="empty-targets">Нет карт. Добавьте карточку.</div>';
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
        )}" title="Редактировать">✎</button>
        <div class="card-art">
          <img src="${escapeAttr(src)}" alt="${escapeAttr(preset.name)}"
            onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" />
          <div class="fallback" style="display:none" title="${escapeAttr(
            preset.name
          )}">✦</div>
          <div class="card-overlay">
            <div class="card-overlay-top">
              <div class="card-tarot">${escapeHtml(preset.name)}</div>
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
      </article>`;
    })
    .join("");
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


async function onPasteCard(cardId) {
  hideCardPreview();
  const enabled = (state.settings?.targets || []).filter((t) => t.enabled).length;
  if (!enabled) {
    toast("Выберите цели — 🎯", "error");
    window.keycode.openTargets();
    return;
  }
  const el = document.querySelector(`.card[data-id="${CSS.escape(cardId)}"]`);
  if (el) el.classList.add("sending");
  const result = await window.keycode.pasteCard(cardId);
  if (el) setTimeout(() => el.classList.remove("sending"), 500);
  if (!result?.ok && result?.error === "no targets") return;
  if (result?.results) {
    const ok = result.results.filter((r) => r.ok).length;
    const fail = result.results.length - ok;
    if (fail && !ok) toast("Окно не найдено?", "error");
    else if (fail) toast(`Ок: ${ok}, нет: ${fail}`, "error");
    else toast(`→ ${ok} чат(а)`, "ok");
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
}

function closeCardEditor() {
  $("modal-card").classList.add("hidden");
  state.editingCardId = null;
}

async function saveCardEditor() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  const cards = state.deck.cards.map((c) =>
    c.id === id
      ? {
          ...c,
          title: $("card-title").value.trim() || "Без названия",
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
  toast("Сохранено", "ok");
}

async function deleteEditingCard() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  if (state.deck.cards.length <= 1) {
    toast("Нужна хотя бы одна карта", "error");
    return;
  }
  const cards = state.deck.cards.filter((c) => c.id !== id);
  state.deck = await window.keycode.saveDeck({ ...state.deck, cards });
  closeCardEditor();
  await refresh();
  toast("Удалено", "ok");
}

async function addCard() {
  if (!state.deck) return;
  if (state.deck.cards.length >= 8) {
    toast("Максимум 8", "error");
    return;
  }
  const n = state.deck.cards.length + 1;
  const freeHotkey = ["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"].find(
    (h) => !state.deck.cards.some((c) => c.hotkey === h)
  );
  const presets = window.TAROT_PRESETS;
  const card = {
    id: uid("card"),
    title: `Карта ${n}`,
    description: "Описание",
    prompt: "Ваш текст…",
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
  $("modal-quit").classList.remove("hidden");
}

function closeQuitDialog() {
  $("modal-quit").classList.add("hidden");
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
    toast("Скрыто — в фоне. Полный выход: ✕ → «Да, выйти»", "");
  });

  $("btn-hide").addEventListener("click", () => window.keycode.hideDeck());

  $("deck-select").addEventListener("change", async (e) => {
    await window.keycode.setActiveDeck(e.target.value);
    await refresh();
  });

  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const dock = btn.getAttribute("data-dock");
      await window.keycode.setDock(dock);
      await refresh();
    });
  });

  $("btn-edit-mode").addEventListener("click", () => {
    state.editMode = !state.editMode;
    document.body.classList.toggle("edit-mode", state.editMode);
    $("btn-edit-mode").classList.toggle("active", state.editMode);
  });

  $("btn-open-targets")?.addEventListener("click", () => window.keycode.openTargets());

  $("btn-add-card").addEventListener("click", addCard);

  $("card-cancel").addEventListener("click", closeCardEditor);
  $("card-save").addEventListener("click", saveCardEditor);
  $("card-delete").addEventListener("click", deleteEditingCard);

  $("cards").addEventListener("click", (e) => {
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      e.stopPropagation();
      openCardEditor(edit.getAttribute("data-edit"));
      return;
    }
    const card = e.target.closest(".card");
    if (!card) return;
    if (state.editMode) {
      openCardEditor(card.getAttribute("data-id"));
      return;
    }
    onPasteCard(card.getAttribute("data-id"));
  });

  window.keycode.onToast((data) => toast(data.message, data.type || ""));
  window.keycode.onPasteDone((data) => {
    if (!document.hasFocus()) {
      const ok = (data.results || []).filter((r) => r.ok).length;
      if (ok) toast(`→ ${ok}`, "ok");
    }
  });
  window.keycode.onDeckReveal(() => {
    document.body.classList.remove("concealing", "booting");
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
    hideCardPreview();
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
    if (partial.targets) syncTargetsBadge();
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
    toast("Ошибка загрузки", "error");
    window.keycode.deckUiReady?.();
  });
