/** @typedef {{ id: string, title: string, description: string, prompt: string, image: string, hotkey?: string }} Card */
/** @typedef {{ id: string, name: string, cards: Card[] }} Deck */

let state = {
  settings: null,
  decks: [],
  deck: /** @type {Deck | null} */ (null),
  editingCardId: null,
  /** Future: KEYCODE_ENABLE_SDK=1 */
  sdkBackendEnabled: false,
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

function applyI18nPack(pack) {
  if (pack) window.I18n.setPack(pack);
  window.I18n.applyDom();
  fillLocaleSelects(pack);
  const cursorStatus = $("cursor-status");
  // Don't wipe live probe/diag text (ok/warn classes mark a live status).
  if (
    cursorStatus &&
    !cursorStatus.classList.contains("ok") &&
    !cursorStatus.classList.contains("warn")
  ) {
    cursorStatus.textContent = window.I18n.t("settings.cursorHint");
  }
}

function fillLocaleSelects(pack) {
  const uiSel = $("set-ui-locale");
  const arcSel = $("set-arcana-locale");
  if (!uiSel || !arcSel || !pack) return;
  const locales = pack.locales || [];
  const uiOpts =
    `<option value="system">${window.I18n.t("lang.system")}</option>` +
    locales
      .map(
        (l) =>
          `<option value="${l.code}">${l.label}</option>`
      )
      .join("");
  const arcOpts =
    `<option value="en">${window.I18n.t("lang.arcanaEn")}</option>` +
    `<option value="ui">${window.I18n.t("lang.arcanaUi")}</option>` +
    locales
      .filter((l) => l.code !== "en")
      .map((l) => `<option value="${l.code}">${l.label}</option>`)
      .join("");
  const uiVal = pack.uiLocalePref || "system";
  const arcVal = pack.arcanaLocalePref || "en";
  uiSel.innerHTML = uiOpts;
  arcSel.innerHTML = arcOpts;
  uiSel.value = uiVal;
  arcSel.value = arcVal;
}

async function refresh() {
  const data = await window.keycode.getState();
  state.settings = data.settings;
  state.decks = data.decks;
  state.deck = data.deck;
  state._i18n = data.i18n;
  state.sdkBackendEnabled = data.sdkBackendEnabled === true;
  applyI18nPack(data.i18n);
  fillSettingsForm();
  renderDeckSelect();
  renderCardsList();
  syncCardForm();
  refreshRemotePanel().catch(() => {});
}

function fillSettingsForm() {
  $("set-pause").value = String(state.settings?.pauseMs ?? 350);
  $("set-preserve-focus").checked = state.settings?.preserveFocus !== false;
  $("set-auto-enter").checked = state.settings?.autoEnter === true;
  $("set-hotkey").value = state.settings?.showHotkey || "F9";
  if ($("set-show-deck-on-startup")) {
    $("set-show-deck-on-startup").checked =
      state.settings?.showDeckOnStartup === true;
  }
  if ($("set-auto-check-updates")) {
    $("set-auto-check-updates").checked =
      state.settings?.autoCheckUpdates !== false;
  }
  if ($("set-dictation-engine")) {
    const eng = String(state.settings?.dictationEngine || "gigaam").toLowerCase();
    $("set-dictation-engine").value = eng === "windows" ? "windows" : "gigaam";
  }
  if ($("set-dictation-silence")) {
    const silence = Number(state.settings?.dictationSilenceSec);
    $("set-dictation-silence").value = String(
      Number.isFinite(silence) ? silence : 3.5
    );
  }
  if ($("set-dictation-max")) {
    const maxSec = Number(state.settings?.dictationMaxSec);
    $("set-dictation-max").value = String(
      Number.isFinite(maxSec) && maxSec > 0 ? Math.round(maxSec) : 0
    );
  }
  if ($("set-cdp-port")) {
    $("set-cdp-port").value = String(state.settings?.cdpPort ?? 9222);
  }
  if ($("set-cursor-backend")) {
    $("set-cursor-backend").value =
      state.settings?.cursorBackend === "sdk" ? "sdk" : "cdp";
  }
  if ($("set-cursor-api-key")) {
    $("set-cursor-api-key").value = String(state.settings?.cursorApiKey || "");
  }
  renderSdkProjectsForm();
  syncSdkSettingsVisibility();
  if ($("set-remote-enabled")) {
    $("set-remote-enabled").checked = state.settings?.remoteEnabled === true;
  }
  if ($("set-remote-port")) {
    $("set-remote-port").value = String(state.settings?.remotePort ?? 17865);
  }
  $("set-edge-hover").checked = state.settings?.edgeHover !== false;
  $("set-edge-threshold").value = String(state.settings?.edgeThreshold ?? 14);
  const hideDelayMs = Number(state.settings?.hideDelayMs) || 450;
  if ($("set-hide-delay")) $("set-hide-delay").value = String(hideDelayMs);
  if ($("set-hide-delay-val")) {
    $("set-hide-delay-val").textContent = `${hideDelayMs}ms`;
  }
  $("set-card-preview").checked = state.settings?.showCardPreview !== false;
  if ($("set-side-card-layout")) {
    $("set-side-card-layout").value =
      state.settings?.sideCardLayout === "strip" ? "strip" : "table";
  }
  const scalePct = Math.round((state.settings?.panelScale ?? 1) * 100);
  const chatPct = Math.round((state.settings?.chatScale ?? 1) * 100);
  const uiPct = Math.round((state.settings?.uiOpacity ?? 0.8) * 100);
  const titlePct = Math.round((state.settings?.titleOpacity ?? 1) * 100);
  const tarotPx = Number(state.settings?.cardTarotFontPx) || 16;
  const actionPx = Number(state.settings?.cardActionFontPx) || 13;
  const chatMessagePx = Number(state.settings?.chatMessageFontPx) || 10;
  const chatComposerPx = Number(state.settings?.chatComposerFontPx) || 10;
  $("set-panel-scale").value = String(scalePct);
  if ($("set-chat-scale")) $("set-chat-scale").value = String(chatPct);
  if ($("set-chat-message-font")) {
    $("set-chat-message-font").value = String(chatMessagePx);
  }
  if ($("set-chat-composer-font")) {
    $("set-chat-composer-font").value = String(chatComposerPx);
  }
  $("set-ui-opacity").value = String(uiPct);
  $("set-title-opacity").value = String(titlePct);
  $("set-tarot-font").value = String(tarotPx);
  $("set-action-font").value = String(actionPx);
  $("set-panel-scale-val").textContent = `${scalePct}%`;
  if ($("set-chat-scale-val")) $("set-chat-scale-val").textContent = `${chatPct}%`;
  $("set-ui-opacity-val").textContent = `${uiPct}%`;
  $("set-title-opacity-val").textContent = `${titlePct}%`;
  $("set-tarot-font-val").textContent = `${tarotPx}px`;
  $("set-action-font-val").textContent = `${actionPx}px`;
  if ($("set-chat-message-font-val")) {
    $("set-chat-message-font-val").textContent = `${chatMessagePx}px`;
  }
  if ($("set-chat-composer-font-val")) {
    $("set-chat-composer-font-val").textContent = `${chatComposerPx}px`;
  }
  syncDockButtons(state.settings?.dock || "right");
}

function syncDockButtons(dock) {
  const active = dock || "right";
  document.querySelectorAll("#dock-pad .dock-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-dock") === active);
  });
}

function showSettingsPage(page) {
  const selected = page || "general";
  document.querySelectorAll("[data-settings-nav]").forEach((btn) => {
    const active = btn.getAttribute("data-settings-nav") === selected;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll("[data-settings-page]").forEach((section) => {
    section.classList.toggle(
      "active",
      section.getAttribute("data-settings-page") === selected
    );
  });
  document.querySelector(".settings-pages")?.scrollTo({ top: 0 });
  if (selected === "decks" && !state.editingCardId) {
    const first = state.deck?.cards?.[0];
    if (first) selectCard(first.id);
  }
}

function bindSettingsNavigation() {
  const buttons = [...document.querySelectorAll("[data-settings-nav]")];
  buttons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      showSettingsPage(btn.getAttribute("data-settings-nav"));
    });
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowRight" &&
          e.key !== "ArrowUp" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next?.focus();
      next?.click();
    });
  });
  showSettingsPage("general");
}

function syncSdkSettingsVisibility() {
  const enabled = state.sdkBackendEnabled === true;
  const block = $("cursor-backend-block");
  if (block) {
    block.classList.toggle("hidden", !enabled);
    block.hidden = !enabled;
  }
  if (!enabled) {
    if ($("set-cursor-backend")) $("set-cursor-backend").value = "cdp";
    const box = $("sdk-settings");
    if (box) box.classList.add("hidden");
    const line = $("backend-mode-line");
    if (line) line.textContent = "";
    return;
  }
  const backend = $("set-cursor-backend")?.value === "sdk" ? "sdk" : "cdp";
  const box = $("sdk-settings");
  if (box) box.classList.toggle("hidden", backend !== "sdk");
  const line = $("backend-mode-line");
  if (line) {
    line.textContent =
      backend === "sdk"
        ? window.I18n.t("settingsMsg.backendSdk")
        : window.I18n.t("settingsMsg.backendCdp");
  }
}

function sdkProjectsList() {
  return Array.isArray(state.settings?.sdkProjects)
    ? state.settings.sdkProjects
    : [];
}

function activeSdkProject() {
  const list = sdkProjectsList();
  const id = state.settings?.activeSdkProjectId;
  return list.find((p) => p.id === id) || list[0] || null;
}

function activeSdkChat() {
  const project = activeSdkProject();
  const chats = Array.isArray(project?.chats) ? project.chats : [];
  if (!chats.length) return null;
  const id = project?.activeChatId;
  return chats.find((c) => c.id === id) || chats[0] || null;
}

function renderSdkProjectsForm() {
  const sel = $("set-sdk-active-project");
  const nameEl = $("set-sdk-project-name");
  const cwdEl = $("set-cursor-sdk-cwd");
  const chatSel = $("set-sdk-active-chat");
  const chatNameEl = $("set-sdk-chat-name");
  const list = sdkProjectsList();
  const active = activeSdkProject();
  const activeChat = activeSdkChat();
  if (sel) {
    if (!list.length) {
      sel.innerHTML = `<option value="">${window.I18n.t("settings.sdkNoProjects")}</option>`;
    } else {
      sel.innerHTML = list
        .map(
          (p) =>
            `<option value="${escapeAttr(p.id)}"${
              active && p.id === active.id ? " selected" : ""
            }>${escapeHtml(p.name || p.cwd || p.id)}</option>`
        )
        .join("");
    }
  }
  if (nameEl) nameEl.value = active?.name || "";
  if (cwdEl) cwdEl.value = active?.cwd || state.settings?.cursorSdkCwd || "";
  const chats = Array.isArray(active?.chats) ? active.chats : [];
  if (chatSel) {
    if (!chats.length) {
      chatSel.innerHTML = `<option value="">${window.I18n.t("settings.sdkNoChats")}</option>`;
    } else {
      chatSel.innerHTML = chats
        .map(
          (c) =>
            `<option value="${escapeAttr(c.id)}"${
              activeChat && c.id === activeChat.id ? " selected" : ""
            }>${escapeHtml(c.name || c.id)}</option>`
        )
        .join("");
    }
  }
  if (chatNameEl) chatNameEl.value = activeChat?.name || "";
  const removeBtn = $("btn-sdk-remove-project");
  if (removeBtn) removeBtn.disabled = !active;
  const removeChatBtn = $("btn-sdk-remove-chat");
  if (removeChatBtn) removeChatBtn.disabled = !activeChat || chats.length <= 1;
  const addChatBtn = $("btn-sdk-add-chat");
  if (addChatBtn) addChatBtn.disabled = !active;
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
    list.innerHTML = `<p class="hint">${window.I18n.t("cards.empty")}</p>`;
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
  const promptEl = $("card-prompt");
  if (promptEl && state.editingCardId) {
    requestAnimationFrame(() => {
      promptEl.focus({ preventScroll: true });
      promptEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
}

async function saveGeneralSettings() {
  const pauseMs = Number($("set-pause").value) || 350;
  const preserveFocus = $("set-preserve-focus").checked;
  const autoEnter = $("set-auto-enter").checked;
  const showHotkey = $("set-hotkey").value || "F9";
  const showDeckOnStartup = $("set-show-deck-on-startup")?.checked === true;
  const autoCheckUpdates = $("set-auto-check-updates")?.checked !== false;
  const dictationRaw = String($("set-dictation-engine")?.value || "").toLowerCase();
  const dictationEngine =
    dictationRaw === "windows" || dictationRaw === "gigaam" ? dictationRaw : null;
  const silenceRaw = Number($("set-dictation-silence")?.value);
  const dictationSilenceSec = Number.isFinite(silenceRaw) ? silenceRaw : 3.5;
  const maxRaw = Number($("set-dictation-max")?.value);
  const dictationMaxSec =
    Number.isFinite(maxRaw) && maxRaw > 0 ? Math.round(maxRaw) : 0;
  const edgeHover = $("set-edge-hover").checked;
  const edgeThreshold = Number($("set-edge-threshold").value) || 14;
  const hideDelayMs = Number($("set-hide-delay")?.value) || 450;
  const showCardPreview = $("set-card-preview").checked;
  const sideCardLayout =
    $("set-side-card-layout")?.value === "strip" ? "strip" : "table";
  const panelScale = (Number($("set-panel-scale").value) || 100) / 100;
  const chatScale = (Number($("set-chat-scale")?.value) || 100) / 100;
  const uiOpacity = (Number($("set-ui-opacity").value) || 80) / 100;
  const titleOpacity = (Number($("set-title-opacity").value) || 100) / 100;
  const cardTarotFontPx = Number($("set-tarot-font").value) || 16;
  const cardActionFontPx = Number($("set-action-font").value) || 13;
  const chatMessageFontPx = Number($("set-chat-message-font")?.value) || 10;
  const chatComposerFontPx = Number($("set-chat-composer-font")?.value) || 10;
  const cdpPort = Number($("set-cdp-port")?.value) || 9222;
  const cursorBackend =
    state.sdkBackendEnabled === true &&
    $("set-cursor-backend")?.value === "sdk"
      ? "sdk"
      : "cdp";
  const cursorApiKey =
    state.sdkBackendEnabled === true
      ? $("set-cursor-api-key")?.value ?? ""
      : state.settings?.cursorApiKey ?? "";
  state.settings = await window.keycode.saveSettings({
    pauseMs,
    preserveFocus,
    autoEnter,
    showHotkey,
    showDeckOnStartup,
    autoCheckUpdates,
    ...(dictationEngine ? { dictationEngine } : {}),
    dictationSilenceSec,
    dictationMaxSec,
    edgeHover,
    edgeThreshold,
    hideDelayMs,
    showCardPreview,
    sideCardLayout,
    panelScale,
    chatScale,
    uiOpacity,
    titleOpacity,
    cardTarotFontPx,
    cardActionFontPx,
    chatMessageFontPx,
    chatComposerFontPx,
    cdpPort,
    cursorBackend,
    ...(state.sdkBackendEnabled === true ? { cursorApiKey } : {}),
  });
}

async function saveDeckName() {
  if (!state.deck) return;
  const name = $("deck-name").value.trim();
  if (!name) {
    toast(window.I18n.t("settingsMsg.enterName"), "error");
    return;
  }
  state.deck = await window.keycode.saveDeck({ ...state.deck, name });
  await refresh();
  toast(window.I18n.t("settingsMsg.nameSaved"), "ok");
}

async function saveCard() {
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
  await refresh();
  selectCard(id);
  toast(window.I18n.t("settingsMsg.cardSaved"), "ok");
}

async function deleteCard() {
  const id = state.editingCardId;
  if (!id || !state.deck) return;
  if (state.deck.cards.length <= 1) {
    toast(window.I18n.t("cards.needOne"), "error");
    return;
  }
  const cards = state.deck.cards.filter((c) => c.id !== id);
  state.deck = await window.keycode.saveDeck({ ...state.deck, cards });
  state.editingCardId = cards[0]?.id || null;
  await refresh();
  toast(window.I18n.t("settingsMsg.cardDeleted"), "ok");
}

async function addCard() {
  if (!state.deck) return;
  if (state.deck.cards.length >= 9) {
    toast(window.I18n.t("cards.max8Long"), "error");
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
  state.editingCardId = card.id;
  await refresh();
  toast(window.I18n.t("settingsMsg.cardAdded"), "ok");
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

  $("set-chat-scale")?.addEventListener("input", (e) => {
    const pct = Number(e.target.value) || 100;
    if ($("set-chat-scale-val")) $("set-chat-scale-val").textContent = `${pct}%`;
    preview({ chatScale: pct / 100 });
  });
  $("set-chat-scale")?.addEventListener("change", (e) => {
    const pct = Number(e.target.value) || 100;
    persist({ chatScale: pct / 100 });
  });

  $("set-chat-message-font")?.addEventListener("input", (e) => {
    const px = Number(e.target.value) || 10;
    if ($("set-chat-message-font-val")) {
      $("set-chat-message-font-val").textContent = `${px}px`;
    }
    preview({ chatMessageFontPx: px });
  });
  $("set-chat-message-font")?.addEventListener("change", (e) => {
    persist({ chatMessageFontPx: Number(e.target.value) || 10 });
  });

  $("set-chat-composer-font")?.addEventListener("input", (e) => {
    const px = Number(e.target.value) || 10;
    if ($("set-chat-composer-font-val")) {
      $("set-chat-composer-font-val").textContent = `${px}px`;
    }
    preview({ chatComposerFontPx: px });
  });
  $("set-chat-composer-font")?.addEventListener("change", (e) => {
    persist({ chatComposerFontPx: Number(e.target.value) || 10 });
  });

  $("set-edge-hover").addEventListener("change", (e) => {
    persist({ edgeHover: e.target.checked });
  });
  $("set-edge-threshold").addEventListener("change", (e) => {
    persist({ edgeThreshold: Number(e.target.value) || 14 });
  });
  $("set-hide-delay")?.addEventListener("input", (e) => {
    const ms = Number(e.target.value) || 450;
    if ($("set-hide-delay-val")) {
      $("set-hide-delay-val").textContent = `${ms}ms`;
    }
  });
  $("set-hide-delay")?.addEventListener("change", (e) => {
    persist({ hideDelayMs: Number(e.target.value) || 450 });
  });
  $("set-card-preview").addEventListener("change", (e) => {
    persist({ showCardPreview: e.target.checked });
  });
  $("set-side-card-layout")?.addEventListener("change", (e) => {
    const sideCardLayout = e.target.value === "strip" ? "strip" : "table";
    preview({ sideCardLayout });
    persist({ sideCardLayout });
  });
  $("set-pause").addEventListener("change", (e) => {
    persist({ pauseMs: Number(e.target.value) || 350 });
  });
  $("set-preserve-focus")?.addEventListener("change", (e) => {
    const preserveFocus = e.target.checked;
    preview({ preserveFocus });
    persist({ preserveFocus });
  });
  $("set-auto-enter").addEventListener("change", (e) => {
    const autoEnter = e.target.checked;
    preview({ autoEnter });
    persist({ autoEnter });
  });
  $("set-hotkey").addEventListener("change", (e) => {
    persist({ showHotkey: e.target.value || "F9" });
  });
  $("set-show-deck-on-startup")?.addEventListener("change", (e) => {
    persist({ showDeckOnStartup: e.target.checked });
  });
  $("set-auto-check-updates")?.addEventListener("change", (e) => {
    persist({ autoCheckUpdates: e.target.checked });
  });
  $("set-dictation-engine")?.addEventListener("change", (e) => {
    const raw = String(e.target.value || "gigaam").toLowerCase();
    const dictationEngine = raw === "windows" ? "windows" : "gigaam";
    persist({ dictationEngine });
  });
  $("set-dictation-silence")?.addEventListener("change", (e) => {
    const n = Number(e.target.value);
    persist({ dictationSilenceSec: Number.isFinite(n) ? n : 3.5 });
  });
  $("set-dictation-max")?.addEventListener("change", (e) => {
    const n = Number(e.target.value);
    persist({
      dictationMaxSec: Number.isFinite(n) && n > 0 ? Math.round(n) : 0,
    });
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
        ? window.I18n.t("settings.cardsTop")
        : dock === "bottom"
          ? window.I18n.t("settings.cardsBottom")
          : dock === "left"
            ? window.I18n.t("settings.cardsLeft")
            : window.I18n.t("settings.cardsRight"),
      "ok"
    );
  });
}

/** @type {"unknown"|"coffee"|"beer"|"cats"} */
let donatePurpose = "unknown";
/** @type {Awaited<ReturnType<typeof window.keycode.donateGetConfig>> | null} */
let donateCfg = null;

function setDonatePurpose(purpose) {
  donatePurpose = purpose;
  document.querySelectorAll(".donate-purpose-btn").forEach((btn) => {
    const on = btn.getAttribute("data-purpose") === purpose;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
}

function renderDonateStats(stats) {
  const empty = $("donate-stats-empty");
  const bars = $("donate-stats-bars");
  if (!empty || !bars) return;
  const total = stats?.total || 0;
  if (total <= 0) {
    empty.classList.remove("hidden");
    bars.classList.add("hidden");
    return;
  }
  empty.classList.add("hidden");
  bars.classList.remove("hidden");
  const percents = stats.percents || {};
  bars.querySelectorAll(".donate-stat-row").forEach((row) => {
    const key = row.getAttribute("data-stat");
    const pct = Number(percents[key] || 0);
    const bar = row.querySelector(".donate-stat-bar > i");
    const label = row.querySelector(".donate-stat-pct");
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = `${pct}%`;
  });
}

function applyDonateConfig(cfg) {
  donateCfg = cfg;
  const tbank = $("donate-pay-tbank");
  const lava = $("donate-pay-lava");
  const crypto = $("donate-pay-crypto");
  if (tbank) tbank.disabled = !cfg?.hasTbank;
  if (lava) lava.disabled = !cfg?.hasLava;
  if (crypto) crypto.disabled = !cfg?.hasCrypto;
  const meta = $("donate-crypto-meta");
  if (meta) {
    if (cfg?.hasCrypto) {
      const net = cfg.cryptoNetwork || "";
      meta.textContent = net
        ? `${net}: ${cfg.cryptoAddress}`
        : cfg.cryptoAddress;
      meta.classList.remove("hidden");
    } else {
      meta.classList.add("hidden");
    }
  }
  const soon = $("donate-soon");
  if (soon) {
    const any = cfg?.hasTbank || cfg?.hasLava || cfg?.hasCrypto;
    soon.classList.toggle("hidden", !!any);
  }
}

async function openDonateModal() {
  setDonatePurpose("unknown");
  const [cfg, stats] = await Promise.all([
    window.keycode.donateGetConfig(),
    window.keycode.donateGetStats(),
  ]);
  applyDonateConfig(cfg);
  renderDonateStats(stats);
  $("modal-donate")?.classList.remove("hidden");
}

function closeDonateModal() {
  $("modal-donate")?.classList.add("hidden");
}

async function onDonatePay(method) {
  const r = await window.keycode.donateRecordClick({
    purpose: donatePurpose,
    method,
  });
  if (!r?.ok) {
    toast(window.I18n.t("donate.recordFail"), "error");
    return;
  }
  const pay = await window.keycode.donateOpenPay(method);
  if (!pay?.ok) {
    toast(window.I18n.t("donate.unavailable"), "error");
    return;
  }
  if (pay.copied) {
    toast(window.I18n.t("donate.cryptoCopied"), "ok");
  } else {
    toast(window.I18n.t("donate.opened"), "ok");
  }
}

function bindDonateUi() {
  $("btn-donate")?.addEventListener("click", () => {
    openDonateModal().catch(() => toast(window.I18n.t("common.error"), "error"));
  });
  $("donate-modal-close")?.addEventListener("click", closeDonateModal);
  $("donate-modal-backdrop")?.addEventListener("click", closeDonateModal);
  document.querySelectorAll(".donate-purpose-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.getAttribute("data-purpose");
      if (p) setDonatePurpose(/** @type {any} */ (p));
    });
  });
  document.querySelectorAll(".donate-pay-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      const method = btn.getAttribute("data-method");
      if (!method) return;
      onDonatePay(method).catch(() =>
        toast(window.I18n.t("common.error"), "error")
      );
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("modal-donate")?.classList.contains("hidden")) closeDonateModal();
  });
}

function bindEvents() {
  $("btn-done").addEventListener("click", closeWindow);
  bindSettingsNavigation();
  bindLiveGeneralSettings();
  bindDonateUi();

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
    const name = prompt(window.I18n.t("settingsMsg.newDeckPrompt"), window.I18n.t("settingsMsg.newDeckDefault"));
    if (!name) return;
    const deck = await window.keycode.newDeck(name.trim());
    state.editingCardId = deck.cards?.[0]?.id || null;
    await refresh();
    toast(window.I18n.t("settingsMsg.deckCreated"), "ok");
  });

  $("btn-export").addEventListener("click", async () => {
    if (!state.deck) return;
    const r = await window.keycode.exportDeck(state.deck.id);
    if (r?.ok) toast(window.I18n.t("settingsMsg.exportOk"), "ok");
  });

  $("btn-import").addEventListener("click", async () => {
    const r = await window.keycode.importDeck();
    if (r?.ok) {
      state.editingCardId = r.deck?.cards?.[0]?.id || null;
      await refresh();
      toast(window.I18n.t("settingsMsg.importOk"), "ok");
    } else if (r && !r.ok) {
      toast(r.error || window.I18n.t("settingsMsg.importFail"), "error");
    }
  });

  $("btn-delete-deck").addEventListener("click", async () => {
    if (!state.deck) return;
    if (!confirm(window.I18n.t("settingsMsg.deleteConfirm", { name: state.deck.name }))) return;
    const r = await window.keycode.deleteDeck(state.deck.id);
    if (!r?.ok) toast(r?.error || window.I18n.t("settingsMsg.cannotDelete"), "error");
    else {
      state.editingCardId = null;
      await refresh();
      const first = state.deck?.cards?.[0];
      if (first) selectCard(first.id);
      toast(window.I18n.t("settingsMsg.deckDeleted"), "ok");
    }
  });

  $("btn-folder").addEventListener("click", () => window.keycode.openDataFolder());
  $("btn-logs")?.addEventListener("click", () => window.keycode.openLogsFolder?.());
  $("btn-check-updates")?.addEventListener("click", async () => {
    const el = $("update-status");
    if (el) el.textContent = window.I18n.t("settingsMsg.checking");
    const r = await window.keycode.checkForUpdates?.();
    if (!r?.ok) {
      if (el) el.textContent = r?.error || window.I18n.t("settingsMsg.checkUnavailable");
      return;
    }
    if (r.available) {
      if (el) {
        el.textContent = window.I18n.t("settingsMsg.updateAvailable", { version: r.version, current: r.current });
      }
      toast(window.I18n.t("settingsMsg.newVersion", { version: r.version }), "ok");
    } else {
      if (el) el.textContent = window.I18n.t("settingsMsg.upToDate", { current: r.current || "?" });
      toast(window.I18n.t("settingsMsg.noUpdates"), "ok");
    }
  });

  $("set-cdp-port")?.addEventListener("change", async (e) => {
    const cdpPort = Math.min(65535, Math.max(1024, Number(e.target.value) || 9222));
    e.target.value = String(cdpPort);
    state.settings = await window.keycode.saveSettings({ cdpPort });
  });

  $("set-cursor-backend")?.addEventListener("change", async (e) => {
    const cursorBackend = e.target.value === "sdk" ? "sdk" : "cdp";
    state.settings = await window.keycode.saveSettings({ cursorBackend });
    syncSdkSettingsVisibility();
    toast(
      cursorBackend === "sdk"
        ? window.I18n.t("settingsMsg.backendSdk")
        : window.I18n.t("settingsMsg.backendCdp"),
      "ok"
    );
  });

  $("set-cursor-api-key")?.addEventListener("change", async (e) => {
    state.settings = await window.keycode.saveSettings({
      cursorApiKey: String(e.target.value || ""),
    });
  });

  $("btn-sdk-pick-cwd")?.addEventListener("click", async () => {
    if (!window.keycode.sdkPickCwd) return;
    const r = await window.keycode.sdkPickCwd();
    if (!r?.ok) return;
    state.settings = {
      ...state.settings,
      cursorSdkCwd: r.cwd || "",
      sdkProjects: r.sdkProjects || state.settings.sdkProjects,
      activeSdkProjectId:
        r.activeSdkProjectId || state.settings.activeSdkProjectId,
    };
    renderSdkProjectsForm();
    toast(window.I18n.t("settingsMsg.sdkCwdSet"), "ok");
  });

  $("btn-sdk-add-project")?.addEventListener("click", async () => {
    if (!window.keycode.sdkAddProject) return;
    const r = await window.keycode.sdkAddProject({});
    if (!r?.ok) {
      if (!r?.canceled) toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = {
      ...state.settings,
      sdkProjects: r.sdkProjects,
      activeSdkProjectId: r.activeSdkProjectId,
      cursorSdkCwd: r.project?.cwd || "",
    };
    renderSdkProjectsForm();
    toast(window.I18n.t("settingsMsg.sdkProjectAdded"), "ok");
  });

  $("btn-sdk-remove-project")?.addEventListener("click", async () => {
    const active = activeSdkProject();
    if (!active || !window.keycode.sdkRemoveProject) return;
    const r = await window.keycode.sdkRemoveProject(active.id);
    if (!r?.ok) {
      toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = {
      ...state.settings,
      sdkProjects: r.sdkProjects,
      activeSdkProjectId: r.activeSdkProjectId,
    };
    renderSdkProjectsForm();
    toast(window.I18n.t("settingsMsg.sdkProjectRemoved"), "ok");
  });

  $("set-sdk-active-project")?.addEventListener("change", async (e) => {
    const id = e.target.value;
    if (!id || !window.keycode.sdkSetActiveProject) return;
    const r = await window.keycode.sdkSetActiveProject(id);
    if (!r?.ok) {
      toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = {
      ...state.settings,
      activeSdkProjectId: r.activeSdkProjectId,
      cursorSdkCwd: r.cwd || "",
      sdkProjects: r.sdkProjects || state.settings.sdkProjects,
    };
    renderSdkProjectsForm();
  });

  let renameTimer = null;
  $("set-sdk-project-name")?.addEventListener("change", async (e) => {
    const active = activeSdkProject();
    const name = String(e.target.value || "").trim();
    if (!active || !name || !window.keycode.sdkRenameProject) return;
    const r = await window.keycode.sdkRenameProject({
      projectId: active.id,
      name,
    });
    if (!r?.ok) return;
    state.settings = { ...state.settings, sdkProjects: r.sdkProjects };
    renderSdkProjectsForm();
  });
  $("set-sdk-project-name")?.addEventListener("input", () => {
    clearTimeout(renameTimer);
    renameTimer = setTimeout(() => {
      $("set-sdk-project-name")?.dispatchEvent(new Event("change"));
    }, 600);
  });

  $("set-sdk-active-chat")?.addEventListener("change", async (e) => {
    const active = activeSdkProject();
    const chatId = e.target.value;
    if (!active || !chatId || !window.keycode.sdkSetActiveChat) return;
    const r = await window.keycode.sdkSetActiveChat({
      projectId: active.id,
      chatId,
    });
    if (!r?.ok) {
      toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = {
      ...state.settings,
      sdkProjects: r.sdkProjects,
      activeSdkProjectId: r.activeSdkProjectId,
    };
    renderSdkProjectsForm();
  });

  let chatRenameTimer = null;
  $("set-sdk-chat-name")?.addEventListener("change", async (e) => {
    const active = activeSdkProject();
    const chat = activeSdkChat();
    const name = String(e.target.value || "").trim();
    if (!active || !chat || !name || !window.keycode.sdkRenameChat) return;
    const r = await window.keycode.sdkRenameChat({
      projectId: active.id,
      chatId: chat.id,
      name,
    });
    if (!r?.ok) return;
    state.settings = { ...state.settings, sdkProjects: r.sdkProjects };
    renderSdkProjectsForm();
  });
  $("set-sdk-chat-name")?.addEventListener("input", () => {
    clearTimeout(chatRenameTimer);
    chatRenameTimer = setTimeout(() => {
      $("set-sdk-chat-name")?.dispatchEvent(new Event("change"));
    }, 600);
  });

  $("btn-sdk-add-chat")?.addEventListener("click", async () => {
    const active = activeSdkProject();
    if (!active || !window.keycode.sdkAddChat) return;
    const r = await window.keycode.sdkAddChat({ projectId: active.id });
    if (!r?.ok) {
      toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = {
      ...state.settings,
      sdkProjects: r.sdkProjects,
      activeSdkProjectId: r.activeSdkProjectId,
    };
    renderSdkProjectsForm();
    toast(window.I18n.t("settingsMsg.sdkChatAdded"), "ok");
  });

  $("btn-sdk-remove-chat")?.addEventListener("click", async () => {
    const active = activeSdkProject();
    const chat = activeSdkChat();
    if (!active || !chat || !window.keycode.sdkRemoveChat) return;
    const r = await window.keycode.sdkRemoveChat({
      projectId: active.id,
      chatId: chat.id,
    });
    if (!r?.ok) {
      toast(r?.error || "SDK", "error");
      return;
    }
    state.settings = { ...state.settings, sdkProjects: r.sdkProjects };
    renderSdkProjectsForm();
    toast(window.I18n.t("settingsMsg.sdkChatRemoved"), "ok");
  });

  $("btn-sdk-probe")?.addEventListener("click", async () => {
    const line = $("sdk-status-line");
    if (line) line.textContent = window.I18n.t("settingsMsg.sdkProbing");
    // Persist key from the field before probe
    const cursorApiKey = String($("set-cursor-api-key")?.value || "");
    state.settings = await window.keycode.saveSettings({ cursorApiKey });
    const r = await window.keycode.sdkProbe();
    if (line) {
      line.textContent = r?.ok
        ? r.hint || window.I18n.t("settingsMsg.sdkOk", {
            name: r.apiKeyName ? ` (${r.apiKeyName})` : "",
          })
        : r?.error || window.I18n.t("settingsMsg.sdkProbeFail", { err: "?" });
    }
    toast(
      r?.ok
        ? window.I18n.t("settingsMsg.sdkOk", {
            name: r.apiKeyName ? ` (${r.apiKeyName})` : "",
          })
        : r?.error || "SDK",
      r?.ok ? "ok" : "error"
    );
  });

  $("btn-sdk-new-agent")?.addEventListener("click", async () => {
    const cursorApiKey = String($("set-cursor-api-key")?.value || "");
    state.settings = await window.keycode.saveSettings({ cursorApiKey });
    const r = await window.keycode.sdkNewAgent();
    const line = $("sdk-status-line");
    if (line) line.textContent = r?.hint || r?.error || "";
    if (r?.ok) {
      state.settings = {
        ...state.settings,
        cursorSdkAgentId: r.agentId || "",
        sdkProjects: r.sdkProjects || state.settings.sdkProjects,
      };
      renderSdkProjectsForm();
    }
    toast(r?.hint || r?.error || "", r?.ok ? "ok" : "error");
  });

  const setCursorStatus = (text, type = "") => {
    const el = $("cursor-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("ok", type === "ok");
    el.classList.toggle("warn", type === "warn");
  };

  $("btn-cursor-probe")?.addEventListener("click", async () => {
    setCursorStatus(window.I18n.t("settingsMsg.probingCdp"));
    const r = await window.keycode.cursorProbe();
    if (!r?.ok && !r?.open) {
      setCursorStatus(r?.hint || r?.error || window.I18n.t("settingsMsg.cdpClosed"), "warn");
      const diag = $("cursor-diag");
      if (diag) {
        diag.textContent = r?.cursorRunning
          ? window.I18n.t("settingsMsg.cursorNoDebug")
          : window.I18n.t("settingsMsg.cursorNotRunning");
      }
      return;
    }
    setCursorStatus(r.hint || window.I18n.t("settingsMsg.cdpOk"), "ok");
    const diag = $("cursor-diag");
    if (diag) {
      diag.textContent = [
        window.I18n.t("settingsMsg.cdpReadyNoRestart"),
        r.flag,
        r.cursorExe && `exe: ${r.cursorExe}`,
        window.I18n.t("settingsMsg.chatsApprox", { n: r.chatsTotal ?? "?" }),
      ]
        .filter(Boolean)
        .join(" · ");
    }
  });

  $("btn-cursor-shortcut")?.addEventListener("click", async () => {
    setCursorStatus(window.I18n.t("settingsMsg.shortcutInstalling"));
    const r = await window.keycode.cursorInstallCdpShortcut?.({ mode: "background" });
    if (!r?.ok) {
      setCursorStatus(r?.error || window.I18n.t("settingsMsg.shortcutFail"), "warn");
      return;
    }
    setCursorStatus(window.I18n.t("settingsMsg.shortcutInstalled"), "ok");
    const diag = $("cursor-diag");
    if (diag) {
      diag.textContent = [
        r.next || window.I18n.t("cursor.shortcutNext"),
        r.desktop,
        r.startMenu,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    toast(window.I18n.t("settingsMsg.shortcutInstalled"), "ok");
  });

  $("btn-cursor-launch")?.addEventListener("click", async () => {
    setCursorStatus(window.I18n.t("cursor.restartWaitClose"));
    const r = await window.keycode.cursorLaunchIntegration({
      mode: "background",
      allowRestart: true,
    });
    if (!r?.ok) {
      setCursorStatus(r?.error || window.I18n.t("settingsMsg.launchFail"), "warn");
      return;
    }
    const hint = r.probe?.hint || window.I18n.t("settingsMsg.cursorLaunched");
    setCursorStatus(hint, r.probe?.open ? "ok" : "warn");
    const diag = $("cursor-diag");
    if (diag) {
      diag.textContent = r.exe ? window.I18n.t("settingsMsg.launchedExe", { exe: r.exe, flag: r.flag || "" }) : "";
    }
  });

  $("btn-uia-diagnose")?.addEventListener("click", async () => {
    const diag = $("cursor-diag");
    if (diag) diag.textContent = window.I18n.t("settingsMsg.diagCdp");
    const r = await window.keycode.uiaDiagnose();
    if (!r?.ok) {
      if (diag) diag.textContent = r?.error || window.I18n.t("settingsMsg.diagError");
      setCursorStatus(window.I18n.t("settingsMsg.diagFail"), "warn");
      return;
    }
    setCursorStatus(r.hint || "", r.status === "ok" ? "ok" : "warn");
    if (diag) {
      diag.textContent = [
        r.windowName && window.I18n.t("settingsMsg.window", { name: r.windowName }),
        window.I18n.t("settingsMsg.cdpWindows", { n: r.targetCount ?? "?" }),
        window.I18n.t("settingsMsg.chatsApprox", { n: r.chatCandidates }),
      ]
        .filter(Boolean)
        .join(" · ");
    }
  });

  $("set-ui-locale")?.addEventListener("change", async (e) => {
    state.settings = await window.keycode.saveSettings({
      uiLocale: e.target.value || "system",
    });
    await refresh();
  });
  $("set-arcana-locale")?.addEventListener("change", async (e) => {
    state.settings = await window.keycode.saveSettings({
      arcanaLocale: e.target.value || "en",
    });
    await refresh();
  });

  bindRemoteControls();

  window.keycode.onStateChanged(() => refresh());
}

async function refreshRemotePanel() {
  if (!window.keycode.remoteStatus) return;
  const st = await window.keycode.remoteStatus();
  const line = $("remote-status-line");
  const cmd = $("remote-serve-cmd");
  const url = $("remote-public-url");
  const qr = $("remote-qr");
  if (cmd) cmd.value = st.serveCommand || "";
  if (url) url.value = st.publicUrl || "";
  if (line) {
    const parts = [];
    if (st.enabled) {
      parts.push(
        st.running
          ? window.I18n.t("settingsMsg.remoteRunning", { port: st.port })
          : window.I18n.t("settingsMsg.remoteStopped")
      );
    } else {
      parts.push(window.I18n.t("settingsMsg.remoteOff"));
    }
    if (st.lanIp) {
      parts.push(st.lanIp);
    } else if (st.enabled) {
      parts.push(window.I18n.t("settingsMsg.remoteDiagNoLanIp"));
    }
    line.textContent = parts.filter(Boolean).join(" · ");
    line.classList.toggle("ok", !!st.running && !!st.lanIp);
    line.classList.toggle("warn", st.enabled && (!st.running || !st.lanIp));
  }
  if (qr) {
    if (st.enabled && st.publicUrl && window.keycode.remoteQrDataUrl) {
      const r = await window.keycode.remoteQrDataUrl();
      if (r?.ok && r.dataUrl) {
        qr.src = r.dataUrl;
        qr.classList.remove("hidden");
      } else {
        qr.removeAttribute("src");
        qr.classList.add("hidden");
      }
    } else {
      qr.removeAttribute("src");
      qr.classList.add("hidden");
    }
  }
  // Do not clear diagnose results here — state-changed would wipe them immediately.
}

function bindRemoteControls() {
  $("set-remote-enabled")?.addEventListener("change", async (e) => {
    const enabled = e.target.checked;
    if (window.keycode.remoteSetEnabled) {
      const st = await window.keycode.remoteSetEnabled(enabled);
      state.settings = { ...state.settings, remoteEnabled: !!st.enabled, remotePort: st.port, remoteToken: st.token };
    } else {
      state.settings = await window.keycode.saveSettings({ remoteEnabled: enabled });
    }
    await refreshRemotePanel();
    toast(
      enabled ? window.I18n.t("settingsMsg.remoteEnabled") : window.I18n.t("settingsMsg.remoteDisabled"),
      "ok"
    );
  });

  $("set-remote-port")?.addEventListener("change", async (e) => {
    const remotePort = Math.min(65535, Math.max(1024, Number(e.target.value) || 17865));
    e.target.value = String(remotePort);
    state.settings = await window.keycode.saveSettings({ remotePort });
    await refreshRemotePanel();
  });

  $("btn-remote-refresh")?.addEventListener("click", async () => {
    await refreshRemotePanel();
    toast(window.I18n.t("settingsMsg.remoteRefreshed"), "ok");
  });

  $("btn-remote-diagnose")?.addEventListener("click", async () => {
    const diag = $("remote-diag-line");
    if (diag) {
      diag.dataset.live = "1";
      diag.textContent = window.I18n.t("settingsMsg.remoteDiagRunning");
      diag.classList.remove("ok", "warn");
    }
    const r = await window.keycode.remoteDiagnose?.();
    await refreshRemotePanel();
    if (diag) {
      const failed = (r?.steps || []).filter((s) => !s.ok).map((s) => s.detail || s.code);
      const summary = r?.next || r?.error || "";
      diag.textContent = [summary, failed.length ? failed.join(" · ") : ""]
        .filter(Boolean)
        .join(" — ");
      diag.classList.toggle("ok", !!r?.ok);
      diag.classList.toggle("warn", !r?.ok);
      delete diag.dataset.live;
    }
    toast(
      r?.ok
        ? window.I18n.t("settingsMsg.remoteDiagReady")
        : window.I18n.t("settingsMsg.remoteDiagFail"),
      r?.ok ? "ok" : "error"
    );
  });

  $("btn-remote-rotate")?.addEventListener("click", async () => {
    if (!confirm(window.I18n.t("settingsMsg.remoteRotateConfirm"))) return;
    if (window.keycode.remoteRotateToken) {
      await window.keycode.remoteRotateToken();
    }
    await refreshRemotePanel();
    toast(window.I18n.t("settingsMsg.remoteRotated"), "ok");
  });

  $("btn-remote-copy-url")?.addEventListener("click", async () => {
    const v = $("remote-public-url")?.value || "";
    if (!v) {
      toast(window.I18n.t("settingsMsg.remoteNoUrl"), "error");
      return;
    }
    try {
      await navigator.clipboard.writeText(v);
      toast(window.I18n.t("settingsMsg.remoteCopied"), "ok");
    } catch {
      toast(window.I18n.t("settingsMsg.remoteCopyFail"), "error");
    }
  });

  $("btn-remote-copy-cmd")?.addEventListener("click", async () => {
    const v = $("remote-serve-cmd")?.value || "";
    if (!v) return;
    try {
      await navigator.clipboard.writeText(v);
      toast(window.I18n.t("settingsMsg.remoteCopied"), "ok");
    } catch {
      toast(window.I18n.t("settingsMsg.remoteCopyFail"), "error");
    }
  });
}

async function init() {
  // Tour listener must be ready before main's settings-focus (load race).
  bindSettingsTour();
  bindEvents();
  await refresh();
  await refreshRemotePanel();
  const first = state.deck?.cards?.[0];
  if (first) selectCard(first.id);
  window.keycode.settingsUiReady?.();
}

function placeSettingsTourCoach(targetEl) {
  const hole = $("settings-onboarding-hole");
  const card = $("settings-onboarding-card");
  const arrow = $("settings-onboarding-arrow");
  if (!hole || !card) return;
  const pad = 6;
  const gap = 20;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(320, vw - 24);
  card.style.width = `${cardW}px`;
  if (!targetEl) {
    hole.style.display = "none";
    if (arrow) arrow.style.visibility = "hidden";
    const cardH = Math.max(card.offsetHeight || 160, 140);
    card.style.left = `${Math.max(12, (vw - cardW) / 2)}px`;
    card.style.top = `${Math.max(12, (vh - cardH) / 2)}px`;
    return;
  }
  const r = targetEl.getBoundingClientRect();
  const holeLeft = Math.max(4, r.left - pad);
  const holeTop = Math.max(4, r.top - pad);
  const holeW = Math.min(vw - 8, r.width + pad * 2);
  const holeH = Math.min(vh - 16, r.height + pad * 2);
  const holeRight = holeLeft + holeW;
  const holeBottom = holeTop + holeH;
  const holeCx = holeLeft + holeW / 2;
  const holeCy = holeTop + holeH / 2;
  hole.style.display = "block";
  hole.style.left = `${holeLeft}px`;
  hole.style.top = `${holeTop}px`;
  hole.style.width = `${holeW}px`;
  hole.style.height = `${holeH}px`;
  const cardH = Math.max(card.offsetHeight || 160, 140);
  const holeBox = {
    left: holeLeft,
    top: holeTop,
    right: holeRight,
    bottom: holeBottom,
  };
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
    const box = { left, top, right: left + cardW, bottom: top + cardH };
    const overlap = !(
      box.right + 8 <= holeBox.left ||
      box.left - 8 >= holeBox.right ||
      box.bottom + 8 <= holeBox.top ||
      box.top - 8 >= holeBox.bottom
    );
    if (overlap) continue;
    const score = Math.abs(left - c.left) + Math.abs(top - c.top);
    if (!best || score < best.score) best = { place: c.place, left, top, score };
  }
  if (!best) {
    best = {
      place: "below",
      left: Math.min(Math.max(10, holeRight - cardW), vw - cardW - 10),
      top: Math.min(holeBottom + gap, vh - cardH - 10),
    };
  }
  card.style.left = `${best.left}px`;
  card.style.top = `${best.top}px`;
  if (arrow) {
    arrow.style.visibility = "visible";
    arrow.className = `onboarding-arrow ${best.place}`;
    if (best.place === "below" || best.place === "above") {
      arrow.style.left = `${Math.min(Math.max(16, holeCx - best.left - 6), cardW - 28)}px`;
      arrow.style.right = "auto";
      arrow.style.top = best.place === "below" ? "-7px" : "auto";
      arrow.style.bottom = best.place === "above" ? "-7px" : "auto";
    } else {
      arrow.style.top = `${Math.min(Math.max(16, holeCy - best.top - 6), cardH - 28)}px`;
      arrow.style.bottom = "auto";
      arrow.style.left = best.place === "right" ? "-7px" : "auto";
      arrow.style.right = best.place === "left" ? "-7px" : "auto";
    }
  }
}

function hideSettingsTour() {
  $("settings-onboarding")?.classList.add("hidden");
}

function showSettingsTour(data = {}) {
  const root = $("settings-onboarding");
  if (!root) return;
  const step = Number(data.step) || 6;
  const stepCount = Number(data.stepCount) || 8;
  const page = data.page || "phone";
  const hasMore = data.hasMore !== false;
  showSettingsPage(page);
  const title = $("settings-onboarding-title");
  const body = $("settings-onboarding-body");
  const next = $("settings-onboarding-next");
  const dots = $("settings-onboarding-dots");
  if (title) title.textContent = window.I18n.t(`onboarding.s${step}.title`);
  if (body) body.innerHTML = window.I18n.t(`onboarding.s${step}.body`);
  if (next) {
    next.textContent = window.I18n.t(hasMore ? "onboarding.next" : "onboarding.bravo");
  }
  if (dots) {
    dots.innerHTML = "";
    for (let i = 0; i < stepCount; i++) {
      const d = document.createElement("span");
      d.className = "onboarding-dot" + (i === step - 1 ? " active" : "");
      dots.appendChild(d);
    }
  }
  root.classList.remove("hidden");
  const highlightSel = data.highlight || "#settings-phone-spotlight";
  const target =
    document.querySelector(highlightSel) ||
    document.querySelector(`[data-settings-nav="${page}"]`);
  if (page === "phone") {
    refreshRemotePanel().catch(() => {});
  }
  requestAnimationFrame(() => {
    target?.scrollIntoView?.({ block: "center", inline: "nearest" });
    placeSettingsTourCoach(target);
    requestAnimationFrame(() => {
      placeSettingsTourCoach(target);
      aimSettingsOnboardingNext();
    });
  });
}

function aimSettingsOnboardingNext() {
  const btn = $("settings-onboarding-next");
  if (!btn) return;
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

function bindSettingsTour() {
  window.keycode.onSettingsFocus?.((data) => {
    if (!data) return;
    if (data.page) showSettingsPage(data.page);
    if (data.tour) {
      showSettingsTour(data);
    } else if (data.highlight) {
      hideSettingsTour();
      const el = document.querySelector(data.highlight);
      el?.scrollIntoView?.({ block: "nearest" });
      el?.classList?.add("tour-pulse");
      setTimeout(() => el?.classList?.remove("tour-pulse"), 1600);
    }
  });
  window.keycode.onSettingsTourClear?.(() => hideSettingsTour());
  $("settings-onboarding-next")?.addEventListener("click", async () => {
    await window.keycode.tourHostAdvance?.();
  });
  $("settings-onboarding-skip")?.addEventListener("click", async () => {
    hideSettingsTour();
    await window.keycode.settingsFocusClear?.();
    await window.keycode.tourHostSkip?.();
  });
  window.addEventListener("resize", () => {
    if ($("settings-onboarding")?.classList.contains("hidden")) return;
    const page =
      document.querySelector(".settings-page.active")?.getAttribute("data-settings-page") ||
      "phone";
    const target =
      document.querySelector("#settings-phone-tour") ||
      document.querySelector("#settings-nav") ||
      document.querySelector(`[data-settings-nav="${page}"]`);
    placeSettingsTourCoach(target);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if ($("settings-onboarding")?.classList.contains("hidden")) return;
    hideSettingsTour();
    window.keycode.tourHostSkip?.();
  });
}

init();
