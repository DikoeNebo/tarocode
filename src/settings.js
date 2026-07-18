/** @typedef {{ id: string, title: string, description: string, prompt: string, image: string, hotkey?: string }} Card */
/** @typedef {{ id: string, name: string, cards: Card[] }} Deck */

let state = {
  settings: null,
  decks: [],
  deck: /** @type {Deck | null} */ (null),
  editingCardId: null,
};

const $ = (id) => document.getElementById(id);

function toast(message, type = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${type}`.trim();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

async function refresh() {
  const data = await window.keycode.getState();
  state.settings = data.settings;
  state.decks = data.decks;
  state.deck = data.deck;
  fillSettingsForm();
  renderDeckSelect();
  renderCardsList();
  syncCardForm();
}

function fillSettingsForm() {
  $("set-pause").value = String(state.settings?.pauseMs ?? 350);
  $("set-auto-enter").checked = state.settings?.autoEnter !== false;
  $("set-hotkey").value = state.settings?.showHotkey || "F9";
  $("set-edge-hover").checked = state.settings?.edgeHover !== false;
  $("set-edge-threshold").value = String(state.settings?.edgeThreshold ?? 14);
  $("set-card-preview").checked = state.settings?.showCardPreview !== false;
  const scalePct = Math.round((state.settings?.panelScale ?? 1) * 100);
  const uiPct = Math.round((state.settings?.uiOpacity ?? 0.8) * 100);
  const titlePct = Math.round((state.settings?.titleOpacity ?? 1) * 100);
  const tarotPx = Number(state.settings?.cardTarotFontPx) || 16;
  const actionPx = Number(state.settings?.cardActionFontPx) || 13;
  $("set-panel-scale").value = String(scalePct);
  $("set-ui-opacity").value = String(uiPct);
  $("set-title-opacity").value = String(titlePct);
  $("set-tarot-font").value = String(tarotPx);
  $("set-action-font").value = String(actionPx);
  $("set-panel-scale-val").textContent = `${scalePct}%`;
  $("set-ui-opacity-val").textContent = `${uiPct}%`;
  $("set-title-opacity-val").textContent = `${titlePct}%`;
  $("set-tarot-font-val").textContent = `${tarotPx}px`;
  $("set-action-font-val").textContent = `${actionPx}px`;
  syncDockButtons(state.settings?.dock || "right");
}

function syncDockButtons(dock) {
  const active = dock || "right";
  document.querySelectorAll("#dock-pad .dock-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-dock") === active);
  });
}

function renderDeckSelect() {
  const sel = $("deck-select");
  const active = state.settings?.activeDeckId;
  sel.innerHTML = (state.decks || [])
    .map(
      (d) =>
        `<option value="${escapeAttr(d.id)}" ${d.id === active ? "selected" : ""}>${escapeHtml(
          d.name
        )} (${d.cardCount})</option>`
    )
    .join("");
  $("deck-name").value = state.deck?.name || "";
}

function renderCardsList() {
  const list = $("cards-list");
  const cards = state.deck?.cards || [];
  if (!cards.length) {
    list.innerHTML = `<p class="hint">Нет карт</p>`;
    return;
  }
  list.innerHTML = cards
    .map((card) => {
      const img = window.tarotImageUrl(card.image);
      const active = card.id === state.editingCardId ? " active" : "";
      return `<button type="button" class="card-item${active}" data-id="${escapeAttr(card.id)}">
        <img src="${escapeAttr(img)}" alt="" />
        <div class="card-item-meta">
          <div class="card-item-title">${escapeHtml(card.title)}</div>
          <div class="card-item-desc">${escapeHtml(card.description)}</div>
          ${card.hotkey ? `<div class="card-item-hotkey">${escapeHtml(card.hotkey)}</div>` : ""}
        </div>
      </button>`;
    })
    .join("");
}

function fillImageSelect(selectedId) {
  window.fillTarotImagePicker($("card-image"), selectedId);
}

function syncCardForm() {
  const card = state.deck?.cards?.find((c) => c.id === state.editingCardId);
  const hasCard = !!card;
  $("card-save").disabled = !hasCard;
  $("card-delete").disabled = !hasCard || (state.deck?.cards?.length || 0) <= 1;
  $("card-form-hint").classList.toggle("hidden", hasCard);

  if (!hasCard) {
    $("card-title").value = "";
    $("card-desc").value = "";
    $("card-prompt").value = "";
    $("card-hotkey").value = "";
    $("card-image").innerHTML = "";
    delete $("card-image").dataset.value;
    return;
  }

  $("card-title").value = card.title || "";
  $("card-desc").value = card.description || "";
  $("card-prompt").value = card.prompt || "";
  $("card-hotkey").value = card.hotkey || "";
  fillImageSelect(card.image);
}

function selectCard(cardId) {
  state.editingCardId = cardId;
  renderCardsList();
  syncCardForm();
}

async function saveGeneralSettings() {
  const pauseMs = Number($("set-pause").value) || 350;
  const autoEnter = $("set-auto-enter").checked;
  const showHotkey = $("set-hotkey").value || "F9";
  const edgeHover = $("set-edge-hover").checked;
  const edgeThreshold = Number($("set-edge-threshold").value) || 14;
  const showCardPreview = $("set-card-preview").checked;
  const panelScale = (Number($("set-panel-scale").value) || 100) / 100;
  const uiOpacity = (Number($("set-ui-opacity").value) || 80) / 100;
  const titleOpacity = (Number($("set-title-opacity").value) || 100) / 100;
  const cardTarotFontPx = Number($("set-tarot-font").value) || 16;
  const cardActionFontPx = Number($("set-action-font").value) || 13;
  state.settings = await window.keycode.saveSettings({
    pauseMs,
    autoEnter,
    showHotkey,
    edgeHover,
    edgeThreshold,
    showCardPreview,
    panelScale,
    uiOpacity,
    titleOpacity,
    cardTarotFontPx,
    cardActionFontPx,
  });
}

async function saveDeckName() {
  if (!state.deck) return;
  const name = $("deck-name").value.trim();
  if (!name) {
    toast("Введите название", "error");
    return;
  }
  state.deck = await window.keycode.saveDeck({ ...state.deck, name });
  await refresh();
  toast("Название сохранено", "ok");
}

async function saveCard() {
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
  await refresh();
  selectCard(id);
  toast("Карта сохранена", "ok");
}

async function deleteCard() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  if (state.deck.cards.length <= 1) {
    toast("Нужна хотя бы одна карта", "error");
    return;
  }
  const cards = state.deck.cards.filter((c) => c.id !== id);
  state.deck = await window.keycode.saveDeck({ ...state.deck, cards });
  state.editingCardId = cards[0]?.id || null;
  await refresh();
  toast("Карта удалена", "ok");
}

async function addCard() {
  if (!state.deck) return;
  if (state.deck.cards.length >= 8) {
    toast("Максимум 8 карт", "error");
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
  state.editingCardId = card.id;
  await refresh();
  toast("Карта добавлена", "ok");
}

async function closeWindow() {
  await saveGeneralSettings();
  await window.keycode.closeSettings();
}

function bindLiveGeneralSettings() {
  const preview = (partial) => window.keycode.previewSettings(partial);
  const persist = async (partial) => {
    state.settings = await window.keycode.saveSettings(partial);
  };

  $("set-ui-opacity").addEventListener("input", (e) => {
    const pct = Number(e.target.value);
    $("set-ui-opacity-val").textContent = `${pct}%`;
    preview({ uiOpacity: pct / 100 });
  });
  $("set-ui-opacity").addEventListener("change", (e) => {
    persist({ uiOpacity: Number(e.target.value) / 100 });
  });

  $("set-title-opacity").addEventListener("input", (e) => {
    const pct = Number(e.target.value);
    $("set-title-opacity-val").textContent = `${pct}%`;
    preview({ titleOpacity: pct / 100 });
  });
  $("set-title-opacity").addEventListener("change", (e) => {
    persist({ titleOpacity: Number(e.target.value) / 100 });
  });

  $("set-tarot-font").addEventListener("input", (e) => {
    const px = Number(e.target.value);
    $("set-tarot-font-val").textContent = `${px}px`;
    preview({ cardTarotFontPx: px });
  });
  $("set-tarot-font").addEventListener("change", (e) => {
    persist({ cardTarotFontPx: Number(e.target.value) });
  });

  $("set-action-font").addEventListener("input", (e) => {
    const px = Number(e.target.value);
    $("set-action-font-val").textContent = `${px}px`;
    preview({ cardActionFontPx: px });
  });
  $("set-action-font").addEventListener("change", (e) => {
    persist({ cardActionFontPx: Number(e.target.value) });
  });

  $("set-panel-scale").addEventListener("input", (e) => {
    const pct = Number(e.target.value) || 100;
    $("set-panel-scale-val").textContent = `${pct}%`;
    preview({ panelScale: pct / 100 });
  });
  $("set-panel-scale").addEventListener("change", (e) => {
    const pct = Number(e.target.value) || 100;
    persist({ panelScale: pct / 100 });
  });

  $("set-edge-hover").addEventListener("change", (e) => {
    persist({ edgeHover: e.target.checked });
  });
  $("set-edge-threshold").addEventListener("change", (e) => {
    persist({ edgeThreshold: Number(e.target.value) || 14 });
  });
  $("set-card-preview").addEventListener("change", (e) => {
    persist({ showCardPreview: e.target.checked });
  });
  $("set-pause").addEventListener("change", (e) => {
    persist({ pauseMs: Number(e.target.value) || 350 });
  });
  $("set-auto-enter").addEventListener("change", (e) => {
    const autoEnter = e.target.checked;
    preview({ autoEnter });
    persist({ autoEnter });
  });
  $("set-hotkey").addEventListener("change", (e) => {
    persist({ showHotkey: e.target.value || "F9" });
  });

  $("dock-pad").addEventListener("click", async (e) => {
    const btn = e.target.closest(".dock-btn");
    if (!btn) return;
    const dock = btn.getAttribute("data-dock");
    if (!dock) return;
    syncDockButtons(dock);
    state.settings = await window.keycode.setDock(dock);
    toast(
      dock === "top"
        ? "Карты сверху"
        : dock === "bottom"
          ? "Карты снизу"
          : dock === "left"
            ? "Карты слева"
            : "Карты справа",
      "ok"
    );
  });
}

function bindEvents() {
  $("btn-done").addEventListener("click", closeWindow);
  bindLiveGeneralSettings();

  $("deck-select").addEventListener("change", async (e) => {
    await window.keycode.setActiveDeck(e.target.value);
    state.editingCardId = null;
    await refresh();
    const first = state.deck?.cards?.[0];
    if (first) selectCard(first.id);
  });

  $("btn-save-deck-name").addEventListener("click", saveDeckName);
  $("deck-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveDeckName();
  });

  $("cards-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".card-item");
    if (!btn) return;
    selectCard(btn.getAttribute("data-id"));
  });

  $("card-save").addEventListener("click", saveCard);
  $("card-delete").addEventListener("click", deleteCard);
  $("btn-add-card").addEventListener("click", addCard);

  $("btn-new-deck").addEventListener("click", async () => {
    const name = prompt("Название колоды:", "Моя колода");
    if (!name) return;
    const deck = await window.keycode.newDeck(name.trim());
    state.editingCardId = deck.cards?.[0]?.id || null;
    await refresh();
    toast("Колода создана", "ok");
  });

  $("btn-export").addEventListener("click", async () => {
    if (!state.deck) return;
    const r = await window.keycode.exportDeck(state.deck.id);
    if (r?.ok) toast("Экспорт готов", "ok");
  });

  $("btn-import").addEventListener("click", async () => {
    const r = await window.keycode.importDeck();
    if (r?.ok) {
      state.editingCardId = r.deck?.cards?.[0]?.id || null;
      await refresh();
      toast("Импорт готов", "ok");
    }
  });

  $("btn-delete-deck").addEventListener("click", async () => {
    if (!state.deck) return;
    if (!confirm(`Удалить колоду «${state.deck.name}»?`)) return;
    const r = await window.keycode.deleteDeck(state.deck.id);
    if (!r?.ok) toast(r?.error || "Нельзя удалить", "error");
    else {
      state.editingCardId = null;
      await refresh();
      const first = state.deck?.cards?.[0];
      if (first) selectCard(first.id);
      toast("Колода удалена", "ok");
    }
  });

  $("btn-folder").addEventListener("click", () => window.keycode.openDataFolder());

  window.keycode.onStateChanged(() => refresh());
}

async function init() {
  bindEvents();
  await refresh();
  const first = state.deck?.cards?.[0];
  if (first) selectCard(first.id);
}

init();
