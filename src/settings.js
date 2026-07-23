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
  if ($("set-cdp-port")) {
    $("set-cdp-port").value = String(state.settings?.cdpPort ?? 9222);
  }
  if ($("set-remote-enabled")) {
    $("set-remote-enabled").checked = state.settings?.remoteEnabled === true;
  }
  if ($("set-remote-port")) {
    $("set-remote-port").value = String(state.settings?.remotePort ?? 17865);
  }
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
}

async function saveGeneralSettings() {
  const pauseMs = Number($("set-pause").value) || 350;
  const preserveFocus = $("set-preserve-focus").checked;
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
  const cdpPort = Number($("set-cdp-port")?.value) || 9222;
  state.settings = await window.keycode.saveSettings({
    pauseMs,
    preserveFocus,
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
    cdpPort,
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
  if (state.deck.cards.length >= 8) {
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
    const r = await window.keycode.cursorInstallCdpShortcut?.({ mode: "both" });
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
    setCursorStatus(window.I18n.t("settingsMsg.launching"));
    const r = await window.keycode.cursorLaunchIntegration({ mode: "both" });
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
  bindEvents();
  await refresh();
  await refreshRemotePanel();
  const first = state.deck?.cards?.[0];
  if (first) selectCard(first.id);
}

init();
