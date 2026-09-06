(() => {
  const $ = (id) => document.getElementById(id);

  const DEFAULT_MODES = [
    { id: "agent", label: "Agent" },
    { id: "plan", label: "Plan" },
    { id: "ask", label: "Ask" },
    { id: "debug", label: "Debug" },
  ];
  const MODE_IDS = new Set(DEFAULT_MODES.map((m) => m.id));
  const LS_BOTTOM_DOCK_PCT = "keycode.remote.bottomDockPct";

  const state = {
    token: "",
    cards: [],
    decks: [],
    deck: null,
    targets: [],
    projects: [],
    suggestions: [],
    targetId: "",
    busy: false,
    deckBusy: false,
    sheetOpen: false,
    sheetTab: "chats",
    createBusy: false,
    es: null,
    stickBottom: true,
    generating: false,
    completedAt: 0,
    locale: "en",
    cursorBackend: "cdp",
    composer: null,
    clarifications: [],
    soundEnabled: localStorage.getItem("keycode.remote.sound") !== "off",
    listening: false,
    dictationBase: "",
    dictationSession: 0,
    /** When true, ignore late speech/IME writes into the composer. */
    composerLocked: false,
  };

  const copy = {
    en: {
      connected: "Connected",
      live: "Live",
      working: "Cursor working…",
      completed: "Task completed",
      sending: "Sending…",
      sent: "Sent",
      cards: "Cards",
      chat: "Chat",
      message: "Message",
      placeholder: "Type a message…",
      send: "Send",
      composerHint: "Type here (phone keyboard mic works best), then Send",
      you: "You",
      agent: "Agent",
      noChats: "No open Cursor chats — launch Cursor for background",
      emptyChat: "Pick a Cursor chat to see messages already loaded on the PC.",
      cdpClosed: "Cursor CDP closed — launch Cursor for background",
      refreshed: "Refreshed",
      soundOn: "Completion sound on",
      soundOff: "Completion sound off",
      emptyText: "Type a message first",
      pickChat: "Pick a Cursor chat above",
      busy: "Busy — wait for the previous send",
      sendFailed: "Send failed",
      insertedNotSent:
        "Text was inserted in Cursor but not sent — check Cursor, then try again",
      mic: "Browser dictation (optional)",
      micListening: "Listening… tap to stop",
      micUnsupported: "Voice dictation is not supported in this browser",
      micHttpHint:
        "Prefer the microphone on your phone keyboard. Browser mic is often blocked on http:// Wi‑Fi.",
      micDenied: "Microphone permission denied",
      micError: "Could not start dictation",
      micReady: "Text added — check and tap Send",
      prevDeck: "Previous deck",
      nextDeck: "Next deck",
      deckPager: "Deck switcher",
      nextPhase: "Next: {deck} → {card}",
      backendCdp: "Mode: CDP",
      backendSdk: "Mode: API",
      sdkAgent: "SDK project",
      noSdkChats: "No SDK projects — add a project folder in Settings",
      emptySdkChat: "SDK agent conversation appears here after you send a message.",
      mode: "Mode",
      model: "Model",
      build: "Build",
      answering: "Answering…",
      answered: "Answered",
      modeFailed: "Could not switch mode",
      modeNotApplied: "Cursor did not apply the mode — try again",
      modeNotFound: "That mode is not in Cursor’s menu",
      modeUiMissing: "Cursor mode menu not found — open a chat composer",
      modeNeedRebind: "Chat not found — rebind it in Chats",
      modelFailed: "Could not switch model",
      modelNotApplied: "Cursor did not apply the model — try again",
      modelNotFound: "That model is not in Cursor’s list",
      modelUiMissing: "Cursor model picker not found — open a chat",
      modelNeedRebind: "Chat not found — rebind it in Chats",
      noModel: "Model picker unavailable",
      chats: "Chats",
      openChats: "Open chats",
      newChat: "New chat",
      noProjects: "No projects found — open a folder in Cursor",
      creating: "Creating chat…",
      createFailed: "Could not create chat",
      created: "Chat created",
      resizeSplit: "Drag to resize chat and cards",
      closeSheet: "Close",
      mode_agent: "Agent",
      mode_plan: "Plan",
      mode_ask: "Ask",
      mode_edit: "Edit",
      mode_debug: "Debug",
    },
    ru: {
      connected: "Подключено",
      live: "Онлайн",
      working: "Cursor работает…",
      completed: "Задача завершена",
      sending: "Отправка…",
      sent: "Отправлено",
      cards: "Карты",
      chat: "Чат",
      message: "Сообщение",
      placeholder: "Напишите сообщение…",
      send: "Отправить",
      composerHint: "Пишите здесь (микрофон клавиатуры надёжнее), затем Отправить",
      you: "Вы",
      agent: "Агент",
      noChats: "Нет открытых чатов Cursor — запустите Cursor для фона",
      emptyChat: "Выберите чат Cursor, чтобы увидеть сообщения, загруженные на ПК.",
      cdpClosed: "CDP Cursor закрыт — запустите Cursor для фона",
      refreshed: "Обновлено",
      soundOn: "Звук завершения включён",
      soundOff: "Звук завершения выключен",
      emptyText: "Сначала введите текст",
      pickChat: "Сначала выберите чат Cursor сверху",
      busy: "Занято — дождитесь предыдущей отправки",
      sendFailed: "Не удалось отправить",
      insertedNotSent:
        "Текст вставлен в Cursor, но не отправлен — проверьте Cursor и повторите",
      mic: "Диктовка браузера (опционально)",
      micListening: "Слушаю… нажмите ещё раз, чтобы стоп",
      micUnsupported: "Диктовка в этом браузере не поддерживается",
      micHttpHint:
        "Надёжнее микрофон на клавиатуре телефона. Кнопка браузера на http:// по Wi‑Fi часто блокируется.",
      micDenied: "Нет доступа к микрофону",
      micError: "Не удалось начать диктовку",
      micReady: "Текст добавлен — проверьте и нажмите Отправить",
      prevDeck: "Предыдущая колода",
      nextDeck: "Следующая колода",
      deckPager: "Переключение колоды",
      nextPhase: "Дальше: {deck} → {card}",
      backendCdp: "Режим: CDP",
      backendSdk: "Режим: API",
      sdkAgent: "Проект SDK",
      noSdkChats: "Нет проектов SDK — добавьте папку проекта в Настройках",
      emptySdkChat: "Диалог SDK-агента появится здесь после отправки сообщения.",
      mode: "Режим",
      model: "Модель",
      build: "Build",
      answering: "Ответ…",
      answered: "Ответ отправлен",
      modeFailed: "Не удалось сменить режим",
      modeNotApplied: "Cursor не применил режим — попробуйте ещё раз",
      modeNotFound: "Такого режима нет в меню Cursor",
      modeUiMissing: "Не найдено меню режима — откройте чат с полем ввода",
      modeNeedRebind: "Чат не найден — привяжите его заново в Чатах",
      modelFailed: "Не удалось сменить модель",
      modelNotApplied: "Cursor не применил модель — попробуйте ещё раз",
      modelNotFound: "Такой модели нет в списке Cursor",
      modelUiMissing: "Не найден выбор модели — откройте чат с полем ввода",
      modelNeedRebind: "Чат не найден — привяжите его заново в Чатах",
      noModel: "Выбор модели недоступен",
      chats: "Чаты",
      openChats: "Открытые",
      newChat: "Новый чат",
      noProjects: "Нет проектов — откройте папку в Cursor",
      creating: "Создаём чат…",
      createFailed: "Не удалось создать чат",
      created: "Чат создан",
      resizeSplit: "Тяните, чтобы изменить высоту чата и карт",
      closeSheet: "Закрыть",
      mode_agent: "Agent",
      mode_plan: "Plan",
      mode_ask: "Ask",
      mode_edit: "Edit",
      mode_debug: "Debug",
    },
  };
  let audioContext = null;
  let recognition = null;

  function tr(key, vars) {
    const lang = state.locale.toLowerCase().startsWith("ru") ? "ru" : "en";
    let s = copy[lang][key] || copy.en[key] || key;
    if (vars && typeof vars === "object") {
      for (const [k, v] of Object.entries(vars)) {
        s = s.split(`{${k}}`).join(String(v ?? ""));
      }
    }
    return s;
  }

  function remoteModeErrorMessage(body) {
    const code = String(body?.hint || body?.error || "").toLowerCase();
    if (code === "mode_not_applied") return tr("modeNotApplied");
    if (code === "mode_not_found") return tr("modeNotFound");
    if (code === "mode_ui_missing" || code === "composer_ui_missing") {
      return tr("modeUiMissing");
    }
    if (
      code === "chat_missing" ||
      code === "chat_not_found" ||
      code === "rebind" ||
      /rebind|chat_not_found/i.test(String(body?.error || ""))
    ) {
      return tr("modeNeedRebind");
    }
    if (body?.error && !/^[a-z_]+$/i.test(String(body.error))) {
      return String(body.error);
    }
    return tr("modeFailed");
  }

  function toast(message, type = "") {
    const el = $("toast");
    el.textContent = message;
    el.className = `toast ${type}`.trim();
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
  }

  function setStatus(text, kind = "idle") {
    const el = $("status");
    el.textContent = text;
    el.dataset.state = kind;
  }

  function unlockAudio() {
    if (!state.soundEnabled) return false;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;
    try {
      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  function playCompletionSound() {
    if (!state.soundEnabled || !unlockAudio() || audioContext.state !== "running") {
      return;
    }
    const now = audioContext.currentTime;
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
    gain.connect(audioContext.destination);
    for (const [frequency, offset] of [
      [659.25, 0],
      [880, 0.16],
    ]) {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.28);
    }
  }

  function renderSoundToggle() {
    const button = $("sound-toggle");
    if (!button) return;
    button.textContent = state.soundEnabled ? "🔊" : "🔇";
    button.setAttribute("aria-pressed", String(state.soundEnabled));
    const label = state.soundEnabled ? tr("soundOn") : tr("soundOff");
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function setActivity(generating) {
    state.generating = generating === true;
    if (state.generating) {
      state.completedAt = 0;
      setStatus(tr("working"), "warn");
    } else if (Date.now() - state.completedAt > 10_000) {
      setStatus(tr("live"), "ok");
    }
  }

  function notifyTaskDone() {
    state.generating = false;
    state.completedAt = Date.now();
    setStatus(tr("completed"), "ok");
    toast(tr("completed"), "ok");
    playCompletionSound();
    try {
      navigator.vibrate?.([120, 70, 180]);
    } catch {
      /* vibration is optional */
    }
  }

  function readTokenFromHash() {
    const hash = String(location.hash || "").replace(/^#/, "");
    const params = new URLSearchParams(hash);
    let token = params.get("token") || "";
    if (!token && hash.startsWith("token=")) {
      token = decodeURIComponent(hash.slice("token=".length));
    }
    return token.trim();
  }

  function authHeaders(json = false) {
    const h = { Authorization: `Bearer ${state.token}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { ...authHeaders(!!opts.body), ...(opts.headers || {}) },
    });
    let body = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await res.json();
    } else {
      body = { ok: res.ok, error: await res.text() };
    }
    if (res.status === 401) {
      showAuthGate(true, body?.reason || body?.error || "unauthorized");
      throw new Error(body?.reason || body?.error || "unauthorized");
    }
    return { res, body };
  }

  function showAuthGate(on, reason = "") {
    $("auth-gate").classList.toggle("hidden", !on);
    if (!on) return;
    const title = $("auth-title");
    const text = $("auth-text");
    if (reason === "tailscale_required") {
      if (title) title.textContent = "Tailscale required";
      if (text) {
        text.textContent =
          "Open this page through Tailscale Serve (the HTTPS link / QR from Keycode Settings), not via localhost. Funnel is not supported.";
      }
    } else if (reason === "bad_token" || reason === "token_missing") {
      if (title) title.textContent = "Open from Settings QR";
      if (text) {
        text.textContent =
          "This page needs the secret from Keycode Settings → Phone remote. Scan the QR again, or paste the full link that ends with #token=…";
      }
    }
  }

  function escapeText(s) {
    return String(s ?? "");
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

  /** Extra client-side dedupe + keep paragraph breaks readable. */
  function prepareMessages(messages) {
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
      if (
        out.some(
          (prev) =>
            prev.role === role &&
            prev.flat.includes(flat) &&
            prev.flat.length > flat.length + 24
        )
      ) {
        continue;
      }
      for (let i = out.length - 1; i >= 0; i--) {
        const prev = out[i];
        if (
          prev.role === role &&
          flat.includes(prev.flat) &&
          flat.length > prev.flat.length + 24
        ) {
          seen.delete(prev.role + "|" + prev.flat);
          out.splice(i, 1);
        }
      }
      seen.add(key);
      out.push({ role, text, flat });
    }
    return out.map(({ role, text }) => ({ role, text }));
  }

  function renderMessages(messages) {
    const root = $("transcript");
    const empty = $("transcript-empty");
    const list = prepareMessages(messages);
    root.querySelectorAll(".msg").forEach((n) => n.remove());
    if (!list.length) {
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");
    const frag = document.createDocumentFragment();
    for (const m of list) {
      const wrap = document.createElement("article");
      wrap.className = `msg ${m.role === "user" ? "user" : "assistant"}`;
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = m.role === "user" ? tr("you") : tr("agent");
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.textContent = escapeText(m.text);
      wrap.appendChild(role);
      wrap.appendChild(bubble);
      frag.appendChild(wrap);
    }
    root.appendChild(frag);
    if (state.stickBottom) {
      root.scrollTop = root.scrollHeight;
    }
  }

  function suggestedRankMap() {
    const map = new Map();
    const active = state.deck?.id || "";
    for (const s of state.suggestions || []) {
      const id = s?.cardId || (s?.origin === "deck" ? s.id : "");
      const rank = Number(s?.rank) === 1 ? 1 : 2;
      if (!id) continue;
      if (s.deckId && active && s.deckId !== active) continue;
      if (!map.has(id) || rank < map.get(id)) map.set(id, rank);
    }
    return map;
  }

  function renderPhaseNext() {
    const btn = $("btn-phase-next");
    if (!btn) return;
    const active = state.deck?.id || "";
    const cross = (state.suggestions || []).find(
      (s) => s?.deckId && s.deckId !== active && s.cardId
    );
    if (!cross) {
      btn.hidden = true;
      btn.classList.add("hidden");
      btn.textContent = "";
      return;
    }
    const deckName =
      cross.deckName ||
      (state.decks || []).find((d) => d.id === cross.deckId)?.name ||
      cross.deckId;
    const cardTitle = cross.cardTitle || cross.cardId;
    const label = tr("nextPhase", { deck: deckName, card: cardTitle });
    btn.hidden = false;
    btn.classList.remove("hidden");
    btn.textContent = label;
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.dataset.deckId = cross.deckId;
  }

  async function switchToSuggestedDeck() {
    const btn = $("btn-phase-next");
    const deckId = btn?.dataset?.deckId;
    if (!deckId || state.deckBusy) return;
    state.deckBusy = true;
    renderDeckPager();
    try {
      const { body } = await api("/api/deck", {
        method: "POST",
        body: JSON.stringify({ deckId }),
      });
      if (!body?.ok) {
        toast(body?.error || "Deck switch failed", "error");
        return;
      }
      applyDeckState(body);
      const cardsDock = $("cards-dock");
      if (cardsDock) cardsDock.setAttribute("aria-label", tr("cards"));
      applyComposerLabels();
      renderPhaseNext();
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      state.deckBusy = false;
      renderDeckPager();
    }
  }

  function shortAction(text, maxWords = 2) {
    const words = String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return words.slice(0, maxWords).join(" ");
  }

  function renderCards() {
    const root = $("cards");
    root.replaceChildren();
    const ranks = suggestedRankMap();
    root.classList.toggle("has-suggestions", ranks.size > 0);
    for (const card of state.cards) {
      const btn = document.createElement("button");
      btn.type = "button";
      const rank = ranks.get(card.id);
      btn.className =
        "card" +
        (rank === 1 ? " suggested-primary" : rank === 2 ? " suggested-secondary" : "");
      btn.disabled = state.busy || !currentTargetId();
      btn.dataset.id = card.id;
      const action =
        String(card.title || "").trim() ||
        shortAction(card.description, 4) ||
        "Card";
      const arcana = String(card.arcana || "").trim();
      btn.setAttribute("aria-label", action + (card.hotkey ? `, ${card.hotkey}` : ""));

      const art = document.createElement("div");
      art.className = "card-art";

      const img = document.createElement("img");
      img.alt = "";
      const imageId = String(card.image || "");
      const file = imageId
        ? /\.(jpe?g|png|webp)$/i.test(imageId)
          ? imageId
          : `${imageId}.jpg`
        : "";
      img.src = file ? `/tarot/${encodeURIComponent(file)}` : "";
      img.onerror = () => {
        img.style.display = "none";
      };

      const overlay = document.createElement("div");
      overlay.className = "card-overlay";
      const top = document.createElement("div");
      top.className = "card-overlay-top";
      if (arcana) {
        const tarot = document.createElement("div");
        tarot.className = "card-tarot";
        tarot.textContent = arcana;
        top.appendChild(tarot);
      }
      const bottom = document.createElement("div");
      bottom.className = "card-overlay-bottom";
      const actionEl = document.createElement("div");
      actionEl.className = "card-action";
      actionEl.textContent = action;
      bottom.appendChild(actionEl);
      overlay.appendChild(top);
      overlay.appendChild(bottom);

      art.appendChild(img);
      art.appendChild(overlay);
      if (card.hotkey) {
        const hk = document.createElement("div");
        hk.className = "card-hotkey";
        hk.textContent = card.hotkey;
        art.appendChild(hk);
      }

      btn.appendChild(art);
      btn.addEventListener("click", () => onPaste(card.id));
      root.appendChild(btn);
    }
  }

  function targetDisplayName(t) {
    if (!t) return "—";
    const title = t.name || t.chatTitle || t.id;
    const win = String(t.windowTitle || "").trim();
    if (
      win &&
      win.length > 2 &&
      !win.toLowerCase().includes(String(title).toLowerCase())
    ) {
      return `${title} · ${win.slice(0, 28)}`;
    }
    return title || "—";
  }

  function updateChatPickLabel() {
    const nameEl = $("chat-pick-name");
    const pickBtn = $("btn-chat-pick");
    if (!nameEl) return;
    const current = state.targets.find((t) => t.id === state.targetId);
    const label = current
      ? targetDisplayName(current)
      : state.targets.length
        ? tr("pickChat")
        : tr("noChats");
    nameEl.textContent = label;
    nameEl.title = label;
    if (pickBtn) {
      pickBtn.setAttribute("aria-expanded", state.sheetOpen ? "true" : "false");
    }
  }

  function renderTargets() {
    const sel = $("target-select");
    const prev = state.targetId;
    sel.replaceChildren();
    if (!state.targets.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = tr("noChats");
      sel.appendChild(opt);
      state.targetId = "";
      updateChatPickLabel();
      if (state.sheetOpen) renderSheetBodies();
      return;
    }
    for (const t of state.targets) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = targetDisplayName(t);
      sel.appendChild(opt);
    }
    if (prev && state.targets.some((t) => t.id === prev)) {
      sel.value = prev;
      state.targetId = prev;
    } else {
      sel.value = state.targets[0].id;
      state.targetId = state.targets[0].id;
    }
    updateChatPickLabel();
    if (state.sheetOpen) renderSheetBodies();
  }

  function normalizeModeId(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (MODE_IDS.has(s)) return s;
    if (/^plan\b|план/.test(s) || s.includes("plan")) return "plan";
    if (/^ask\b|вопрос/.test(s) || s.includes("ask")) return "ask";
    if (/^debug\b|отлад/.test(s) || s.includes("debug") || s.includes("отлад"))
      return "debug";
    if (/^agent\b|агент/.test(s) || s.includes("agent")) return "agent";
    // Cursor no longer exposes Edit/Manual in the + menu — treat as Agent.
    return "agent";
  }

  function currentTargetId() {
    const fromState = String(state.targetId || "").trim();
    if (fromState) return fromState;
    const fromSelect = String($("target-select")?.value || "").trim();
    if (fromSelect) {
      state.targetId = fromSelect;
      return fromSelect;
    }
    return "";
  }

  function setBusy(on) {
    state.busy = !!on;
    $("busy-badge").classList.toggle("hidden", !state.busy);
    renderCards();
    syncComposer();
  }

  function syncComposer() {
    const input = $("composer-input");
    const btn = $("btn-send");
    const mic = $("btn-mic");
    if (!input || !btn) return;
    const lock = !!state.busy;
    input.disabled = lock;
    input.readOnly = lock;
    btn.disabled = lock;
    btn.setAttribute("aria-disabled", lock ? "true" : "false");
    applySubmitButtonLabel();
    if (mic) {
      mic.disabled = lock;
      mic.classList.toggle("listening", !!state.listening);
      mic.setAttribute("aria-pressed", state.listening ? "true" : "false");
      mic.title = state.listening ? tr("micListening") : tr("mic");
      mic.setAttribute("aria-label", mic.title);
    }
    const modeEl = $("composer-mode");
    if (modeEl) modeEl.disabled = lock;
  }

  function applySubmitButtonLabel() {
    const btn = $("btn-send");
    if (!btn) return;
    const kind = state.composer?.submitKind === "build" ? "build" : "send";
    const label =
      state.composer?.submitLabel ||
      (kind === "build" ? tr("build") : tr("send"));
    btn.dataset.kind = kind;
    btn.textContent = label;
  }

  function applyComposerLabels() {
    const label = $("composer-label");
    const input = $("composer-input");
    const hint = $("composer-hint");
    const mic = $("btn-mic");
    if (label) label.textContent = tr("message");
    if (input) input.placeholder = tr("placeholder");
    if (hint) hint.textContent = tr("composerHint");
    if (mic) {
      mic.title = tr("mic");
      mic.setAttribute("aria-label", tr("mic"));
    }
    const modeLabel = $("mode-label");
    const modelLabel = $("model-label");
    if (modeLabel) modeLabel.textContent = tr("mode");
    if (modelLabel) modelLabel.textContent = tr("model");
    applySubmitButtonLabel();
    syncComposer();
  }

  function modeOptionLabel(id) {
    const key = `mode_${id}`;
    const translated = tr(key);
    return translated !== key ? translated : id;
  }

  function renderComposerChrome(composer) {
    if (composer && typeof composer === "object") {
      state.composer = composer;
    }
    const c = state.composer || {};
    const modeEl = $("composer-mode");
    const modelEl = $("composer-model");
    if (modeEl) {
      // Modes Cursor exposes in the + menu (AGENTS.md). Server/CDP may report only current.
      const list = DEFAULT_MODES.map((m) => ({
        id: m.id,
        label: modeOptionLabel(m.id),
      }));
      const cur = normalizeModeId(c.mode || c.modeLabel);
      modeEl.innerHTML = list
        .map(
          (m) =>
            `<option value="${escapeAttr(m.id)}"${m.id === cur ? " selected" : ""}>${escapeHtml(
              m.label || m.id
            )}</option>`
        )
        .join("");
      modeEl.value = MODE_IDS.has(cur) ? cur : "agent";
    }
    if (modelEl) {
      const label = String(c.modelLabel || c.modelId || "").trim();
      modelEl.textContent = label || "—";
      modelEl.title = label || tr("model");
    }
    applySubmitButtonLabel();
    syncComposer();
  }

  function renderClarifications(list) {
    state.clarifications = Array.isArray(list) ? list : [];
    const box = $("clarifications");
    if (!box) return;
    if (!state.clarifications.length) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    box.classList.remove("hidden");
    box.innerHTML = state.clarifications
      .map((q) => {
        const opts = (q.options || [])
          .map(
            (o) =>
              `<button type="button" class="clarify-opt" data-qid="${escapeAttr(
                q.id
              )}" data-oid="${escapeAttr(o.id)}" data-label="${escapeAttr(
                o.label
              )}">${escapeHtml(o.label)}</button>`
          )
          .join("");
        return `<div class="clarify-card" data-qid="${escapeAttr(q.id)}">
          <p class="clarify-prompt">${escapeHtml(q.prompt)}</p>
          <div class="clarify-options">${opts || ""}</div>
        </div>`;
      })
      .join("");
  }

  function applyChatPayload(body) {
    if (!body) return;
    renderMessages(body.messages || []);
    setActivity(body.generating === true);
    if (body.composer) renderComposerChrome(body.composer);
    renderClarifications(body.clarifications || []);
    // Freeze highlights while generating; apply when idle
    if (body.generating !== true && Array.isArray(body.suggestions)) {
      const next = body.suggestions;
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
  }

  function speechLang() {
    const loc = String(state.locale || "en").toLowerCase();
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

  function stopDictation() {
    state.listening = false;
    state.dictationBase = "";
    state.dictationSession += 1;
    const rec = recognition;
    recognition = null;
    if (rec) {
      // Detach handlers first — abort/stop often still fires a final onresult.
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onstart = null;
      try {
        rec.abort();
      } catch {
        /* ignore */
      }
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    syncComposer();
  }

  function startDictation() {
    const input = $("composer-input");
    if (!input || state.busy || state.composerLocked) return;
    if (state.listening) {
      stopDictation();
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast(tr("micUnsupported"), "error");
      return;
    }
    if (!window.isSecureContext) {
      toast(tr("micHttpHint"), "error");
      // Still try — some mobile browsers allow it on LAN http.
    }
    let rec;
    try {
      rec = new SR();
    } catch (e) {
      toast(tr("micError"), "error");
      return;
    }
    recognition = rec;
    const session = ++state.dictationSession;
    state.dictationBase = String(input.value || "").trim();
    rec.lang = speechLang();
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (session !== state.dictationSession) return;
      state.listening = true;
      syncComposer();
      setStatus(tr("micListening"), "warn");
    };
    rec.onerror = (ev) => {
      if (session !== state.dictationSession) return;
      const err = String(ev?.error || "");
      stopDictation();
      if (err === "not-allowed" || err === "service-not-allowed") {
        toast(
          window.isSecureContext ? tr("micDenied") : tr("micHttpHint"),
          "error"
        );
      } else if (err !== "aborted" && err !== "no-speech") {
        toast(tr("micError"), "error");
      }
    };
    rec.onend = () => {
      if (session !== state.dictationSession) return;
      state.listening = false;
      if (recognition === rec) recognition = null;
      syncComposer();
      if (state.composerLocked || state.busy) return;
      const text = String(input.value || "").trim();
      if (text) {
        toast(tr("micReady"), "ok");
        setStatus(tr("live"), "ok");
      }
    };
    rec.onresult = (event) => {
      if (session !== state.dictationSession) return;
      if (state.busy || state.composerLocked) return;
      let finalText = "";
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i]?.[0]?.transcript || "";
        if (event.results[i].isFinal) finalText += piece;
        else interim += piece;
      }
      const base = state.dictationBase;
      const spoken = String(finalText || interim || "").trim();
      const next = [base, spoken].filter(Boolean).join(" ").trim();
      input.value = next;
      if (finalText.trim()) {
        state.dictationBase = next;
      }
      autoGrowComposer();
    };

    try {
      rec.start();
    } catch (e) {
      stopDictation();
      toast(
        window.isSecureContext ? tr("micError") : tr("micHttpHint"),
        "error"
      );
    }
  }

  function clearComposerInput(input) {
    if (!input) return;
    state.dictationBase = "";
    try {
      input.blur();
    } catch {
      /* ignore */
    }
    try {
      if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(0, 0);
      }
    } catch {
      /* ignore */
    }
    input.value = "";
    try {
      input.defaultValue = "";
    } catch {
      /* ignore */
    }
    autoGrowComposer();
  }

  /** While locked, any IME/dictation rewrite is wiped immediately. */
  function enforceComposerLock(input) {
    if (!input || !state.composerLocked) return;
    if (input.value) {
      input.value = "";
      autoGrowComposer();
    }
  }

  function lockComposerClear(input, ms = 1800) {
    state.composerLocked = true;
    state.dictationSession += 1;
    clearComposerInput(input);
    const delays = [0, 30, 80, 160, 320, 640, ms];
    for (const delay of delays) {
      setTimeout(() => {
        if (!state.composerLocked && delay > 0) return;
        clearComposerInput(input);
        if (delay === ms) {
          state.composerLocked = false;
          syncComposer();
        }
      }, delay);
    }
  }

  async function loadChats() {
    const { res, body } = await api("/api/chats");
    if (!body?.ok) {
      state.targets = [];
      state.projects = [];
      renderTargets();
      renderCards();
      syncComposer();
      const hint = body?.hint || body?.error || "";
      if (hint === "cdp_closed" || res.status === 502) {
        setStatus(tr("cdpClosed"), "warn");
      } else if (state.cursorBackend === "sdk") {
        setStatus(hint || tr("noSdkChats"), "warn");
      } else {
        setStatus(hint || tr("noChats"), "warn");
      }
      return { ok: false, hint };
    }
    state.targets = body.chats || [];
    state.projects = Array.isArray(body.projects) ? body.projects : [];
    renderTargets();
    renderCards();
    syncComposer();
    if (!state.targets.length) {
      setStatus(
        state.cursorBackend === "sdk" ? tr("noSdkChats") : tr("noChats"),
        "warn"
      );
    }
    return { ok: true };
  }

  function clampBottomPct(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return 42;
    return Math.min(72, Math.max(22, Math.round(v)));
  }

  function applyBottomDockPct(pct) {
    const next = clampBottomPct(pct);
    document.documentElement.style.setProperty("--bottom-dock-pct", `${next}%`);
    const split = $("layout-split");
    if (split) {
      split.setAttribute("aria-valuenow", String(next));
      split.title = tr("resizeSplit");
      split.setAttribute("aria-label", tr("resizeSplit"));
    }
    return next;
  }

  function readBottomDockPct() {
    try {
      const v = localStorage.getItem(LS_BOTTOM_DOCK_PCT);
      if (v != null && v !== "") return clampBottomPct(v);
    } catch {
      /* ignore */
    }
    return 42;
  }

  function initLayoutSplit() {
    applyBottomDockPct(readBottomDockPct());
    const split = $("layout-split");
    if (!split) return;

    let dragging = false;

    const onMove = (clientY) => {
      if (!dragging) return;
      const body = document.body;
      const top = body.getBoundingClientRect().top;
      const h = body.clientHeight || window.innerHeight;
      if (!(h > 0)) return;
      const fromBottom = ((h - (clientY - top)) / h) * 100;
      applyBottomDockPct(fromBottom);
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove("split-dragging");
      try {
        localStorage.setItem(
          LS_BOTTOM_DOCK_PCT,
          String(clampBottomPct(
            parseFloat(
              getComputedStyle(document.documentElement)
                .getPropertyValue("--bottom-dock-pct")
            ) || 42
          ))
        );
      } catch {
        /* ignore */
      }
    };

    split.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      dragging = true;
      document.body.classList.add("split-dragging");
      try {
        split.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onMove(e.clientY);
    });
    split.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      onMove(e.clientY);
    });
    split.addEventListener("pointerup", endDrag);
    split.addEventListener("pointercancel", endDrag);
    split.addEventListener("lostpointercapture", endDrag);

    split.addEventListener("keydown", (e) => {
      const cur = clampBottomPct(
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--bottom-dock-pct"
          )
        ) || 42
      );
      if (e.key === "ArrowUp") {
        e.preventDefault();
        const next = applyBottomDockPct(cur + 3);
        try {
          localStorage.setItem(LS_BOTTOM_DOCK_PCT, String(next));
        } catch {
          /* ignore */
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const next = applyBottomDockPct(cur - 3);
        try {
          localStorage.setItem(LS_BOTTOM_DOCK_PCT, String(next));
        } catch {
          /* ignore */
        }
      }
    });
  }

  function setSheetTab(tab) {
    state.sheetTab = tab === "new" ? "new" : "chats";
    const tabChats = $("tab-chats");
    const tabNew = $("tab-new");
    const sheetChats = $("sheet-chats");
    const sheetProjects = $("sheet-projects");
    const chatsOn = state.sheetTab === "chats";
    if (tabChats) {
      tabChats.classList.toggle("active", chatsOn);
      tabChats.setAttribute("aria-selected", chatsOn ? "true" : "false");
    }
    if (tabNew) {
      tabNew.classList.toggle("active", !chatsOn);
      tabNew.setAttribute("aria-selected", chatsOn ? "false" : "true");
    }
    if (sheetChats) {
      sheetChats.classList.toggle("hidden", !chatsOn);
      sheetChats.hidden = !chatsOn;
    }
    if (sheetProjects) {
      sheetProjects.classList.toggle("hidden", chatsOn);
      sheetProjects.hidden = chatsOn;
    }
    renderSheetBodies();
  }

  function renderSheetBodies() {
    const sheetChats = $("sheet-chats");
    const sheetProjects = $("sheet-projects");
    if (sheetChats) {
      if (!state.targets.length) {
        sheetChats.innerHTML = `<p class="sheet-empty">${escapeHtml(tr("noChats"))}</p>`;
      } else {
        sheetChats.innerHTML = state.targets
          .map((t) => {
            const active = t.id === state.targetId ? " active" : "";
            const sub = t.projectName
              ? `<span class="sheet-item-sub">${escapeHtml(t.projectName)}</span>`
              : "";
            return `<button type="button" class="sheet-item${active}" data-target-id="${escapeAttr(
              t.id
            )}"><span class="sheet-item-title">${escapeHtml(
              t.chatTitle || t.name || t.id
            )}</span>${sub}</button>`;
          })
          .join("");
      }
    }
    if (sheetProjects) {
      if (!state.projects.length) {
        sheetProjects.innerHTML = `<p class="sheet-empty">${escapeHtml(
          tr("noProjects")
        )}</p>`;
      } else {
        sheetProjects.innerHTML = state.projects
          .map((p) => {
            const win = p.windowTitle
              ? `<span class="sheet-item-sub">${escapeHtml(
                  String(p.windowTitle).slice(0, 40)
                )}</span>`
              : "";
            return `<button type="button" class="sheet-item sheet-project" data-project="${escapeAttr(
              p.name
            )}" data-cdp="${escapeAttr(p.cdpTargetId || "")}"${
              state.createBusy ? " disabled" : ""
            }><span class="sheet-item-title">${escapeHtml(
              p.name
            )}</span>${win}<span class="sheet-item-action">+</span></button>`;
          })
          .join("");
      }
    }
  }

  function openChatSheet(tab) {
    const sheet = $("chat-sheet");
    if (!sheet) return;
    state.sheetOpen = true;
    sheet.classList.remove("hidden");
    sheet.hidden = false;
    setSheetTab(tab || state.sheetTab || "chats");
    updateChatPickLabel();
    // Refresh list when opening so phone sees current Cursor chats.
    loadChats().catch(() => {});
  }

  function closeChatSheet() {
    const sheet = $("chat-sheet");
    if (!sheet) return;
    state.sheetOpen = false;
    sheet.classList.add("hidden");
    sheet.hidden = true;
    updateChatPickLabel();
  }

  async function selectTarget(targetId) {
    const id = String(targetId || "").trim();
    if (!id || id === state.targetId) {
      closeChatSheet();
      return;
    }
    state.targetId = id;
    const sel = $("target-select");
    if (sel) sel.value = id;
    state.suggestions = [];
    renderCards();
    renderPhaseNext();
    syncComposer();
    updateChatPickLabel();
    closeChatSheet();
    await loadChat();
    connectSse();
  }

  async function createChatInProject(projectName, cdpTargetId) {
    const name = String(projectName || "").trim();
    if (!name || state.createBusy) return;
    state.createBusy = true;
    renderSheetBodies();
    setStatus(tr("creating"), "warn");
    try {
      const { body } = await api("/api/chats/create", {
        method: "POST",
        body: JSON.stringify({
          projectName: name,
          cdpTargetId: String(cdpTargetId || "").trim(),
        }),
      });
      if (!body?.ok || !body.chat?.id) {
        toast(body?.hint || body?.error || tr("createFailed"), "error");
        setStatus(tr("createFailed"), "err");
        return;
      }
      toast(tr("created"), "ok");
      await loadChats();
      await selectTarget(body.chat.id);
      setStatus(tr("live"), "ok");
    } catch (e) {
      toast(String(e.message || e), "error");
      setStatus(tr("createFailed"), "err");
    } finally {
      state.createBusy = false;
      renderSheetBodies();
    }
  }

  function applyRemoteLabels() {
    $("target-label").textContent = tr("chat");
    const sheetTitle = $("chat-sheet-title");
    if (sheetTitle) sheetTitle.textContent = tr("chats");
    const tabChats = $("tab-chats");
    const tabNew = $("tab-new");
    if (tabChats) tabChats.textContent = tr("openChats");
    if (tabNew) tabNew.textContent = tr("newChat");
    const btnNew = $("btn-chat-new");
    if (btnNew) {
      btnNew.title = tr("newChat");
      btnNew.setAttribute("aria-label", tr("newChat"));
    }
    const closeBtn = $("chat-sheet-close");
    const backdrop = $("chat-sheet-backdrop");
    if (closeBtn) closeBtn.setAttribute("aria-label", tr("closeSheet"));
    if (backdrop) backdrop.setAttribute("aria-label", tr("closeSheet"));
    const cardsDock = $("cards-dock");
    if (cardsDock) cardsDock.setAttribute("aria-label", tr("cards"));
    applyBottomDockPct(readBottomDockPct());
  }

  function renderBackendBadge() {
    const el = $("backend-badge");
    if (!el) return;
    // SDK shelved: hide badge while only CDP is active.
    const sdk = state.cursorBackend === "sdk";
    el.hidden = !sdk;
    if (!sdk) return;
    el.textContent = tr("backendSdk");
    el.dataset.backend = "sdk";
  }

  function applyDeckState(body) {
    if (!body || typeof body !== "object") return;
    if (Array.isArray(body.cards)) state.cards = body.cards;
    if (Array.isArray(body.decks)) state.decks = body.decks;
    if (body.deck) state.deck = body.deck;
    // Suggestions come from chat payloads; ignore empty deck placeholder.
    if (Array.isArray(body.suggestions) && body.suggestions.length) {
      state.suggestions = body.suggestions;
    }
    if (body.uiLocale) state.locale = body.uiLocale;
    if (body.cursorBackend === "sdk" || body.cursorBackend === "cdp") {
      state.cursorBackend = body.cursorBackend;
    }
    renderBackendBadge();
    renderDeckPager();
    renderCards();
    renderPhaseNext();
    const empty = $("transcript-empty");
    if (empty) {
      empty.textContent =
        state.cursorBackend === "sdk" ? tr("emptySdkChat") : tr("emptyChat");
    }
  }

  function renderDeckPager() {
    const nameEl = $("deck-name");
    const prevBtn = $("btn-deck-prev");
    const nextBtn = $("btn-deck-next");
    const pager = $("deck-pager");
    if (!nameEl || !prevBtn || !nextBtn) return;

    const label = state.deck?.name || state.deck?.id || "—";
    const prev = nameEl.textContent;
    if (prev && prev !== "—" && prev !== label) {
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

    const canPage = (state.decks || []).length > 1 && !state.deckBusy;
    prevBtn.disabled = !canPage;
    nextBtn.disabled = !canPage;
    prevBtn.title = tr("prevDeck");
    nextBtn.title = tr("nextDeck");
    prevBtn.setAttribute("aria-label", tr("prevDeck"));
    nextBtn.setAttribute("aria-label", tr("nextDeck"));
    if (pager) pager.setAttribute("aria-label", tr("deckPager"));
  }

  async function cycleDeck(step) {
    if (state.deckBusy || (state.decks || []).length < 2) return;
    state.deckBusy = true;
    renderDeckPager();
    try {
      const { body } = await api("/api/deck", {
        method: "POST",
        body: JSON.stringify({ step }),
      });
      if (!body?.ok) {
        toast(body?.error || "Deck switch failed", "error");
        return;
      }
      applyDeckState(body);
      applyRemoteLabels();
      applyComposerLabels();
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      state.deckBusy = false;
      renderDeckPager();
    }
  }

  async function loadState() {
    const { body } = await api("/api/state");
    if (!body?.ok) throw new Error(body?.error || "state_failed");
    applyDeckState(body);
    applyRemoteLabels();
    $("transcript-empty").textContent = tr("emptyChat");
    applyComposerLabels();
    renderSoundToggle();
    setStatus(tr("connected"), "ok");
    showAuthGate(false);
    await loadChats();
  }

  async function loadChat() {
    if (!state.targetId) {
      renderMessages([]);
      renderClarifications([]);
      return;
    }
    const { body } = await api(
      `/api/chat?targetId=${encodeURIComponent(state.targetId)}`
    );
    if (!body?.ok) {
      setStatus(body?.hint || body?.error || "Chat error", "warn");
      renderMessages([]);
      renderClarifications([]);
      return;
    }
    applyChatPayload(body);
  }

  function connectSse() {
    if (state.es) {
      try {
        state.es.close();
      } catch {
        /* ignore */
      }
      state.es = null;
    }
    if (!state.token) return;

    // EventSource cannot set Authorization headers — use fetch stream.
    // targetId optional: without a chat we still receive deck / paste-done events.
    const ctrl = new AbortController();
    state.es = { close: () => ctrl.abort(), _ctrl: ctrl };
    (async () => {
      try {
        const q = state.targetId
          ? `?targetId=${encodeURIComponent(state.targetId)}`
          : "";
        const res = await fetch(`/api/events${q}`, {
          headers: authHeaders(),
          signal: ctrl.signal,
        });
        if (res.status === 401) {
          let reason = "unauthorized";
          try {
            const j = await res.json();
            reason = j?.reason || j?.error || reason;
          } catch {
            /* ignore */
          }
          showAuthGate(true, reason);
          setStatus("Auth required", "err");
          return;
        }
        if (!res.ok || !res.body) {
          setStatus("Stream offline", "warn");
          return;
        }
        if (state.targetId) setStatus("Live", "ok");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            handleSseChunk(chunk);
          }
        }
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setStatus("Reconnecting…", "warn");
        setTimeout(() => {
          if (!ctrl.signal.aborted) connectSse();
        }, 2000);
      }
    })();
  }

  function handleSseChunk(chunk) {
    let event = "message";
    let data = "";
    for (const line of chunk.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    if (event === "chat" && payload.targetId === state.targetId) {
      applyChatPayload(payload);
    } else if (event === "chat-error" && payload.targetId === state.targetId) {
      setStatus(payload.hint || payload.error || "Chat error", "warn");
    } else if (event === "activity" && payload.targetId === state.targetId) {
      setActivity(payload.generating === true);
    } else if (event === "task-done" && payload.targetId === state.targetId) {
      notifyTaskDone();
    } else if (event === "paste-done") {
      setBusy(false);
    } else if (event === "deck") {
      applyDeckState(payload);
      applyRemoteLabels();
      applyComposerLabels();
    }
  }

  async function onPaste(cardId) {
    const targetId = currentTargetId();
    if (!targetId || state.busy) {
      if (!targetId) toast(tr("pickChat"), "error");
      return;
    }
    unlockAudio();
    setBusy(true);
    setStatus(tr("sending"), "warn");
    try {
      const { res, body } = await api("/api/paste", {
        method: "POST",
        body: JSON.stringify({ cardId, targetId }),
      });
      if (body?.busy || res.status === 409) {
        toast(tr("busy"), "error");
        setStatus("Busy", "warn");
        return;
      }
      if (!body?.ok) {
        const err = String(body?.error || "");
        const msg =
          /inserted|not sent|не отправлен/i.test(err)
            ? tr("insertedNotSent")
            : err || tr("sendFailed");
        toast(msg, "error");
        setStatus(tr("sendFailed"), "err");
        return;
      }
      toast(tr("sent"), "ok");
      setStatus(tr("live"), "ok");
    } catch (e) {
      toast(String(e.message || e), "error");
      setStatus("Error", "err");
    } finally {
      setBusy(false);
    }
  }

  async function onSendText() {
    const input = $("composer-input");
    if (!input || state.busy) return;
    stopDictation();
    const text = String(input.value || "");
    if (!text.trim()) {
      toast(tr("emptyText"), "error");
      syncComposer();
      return;
    }
    let targetId = currentTargetId();
    if (!targetId) {
      try {
        await loadChats();
      } catch {
        /* ignore */
      }
      targetId = currentTargetId();
    }
    if (!targetId) {
      toast(tr("pickChat"), "error");
      setStatus(tr("noChats"), "warn");
      return;
    }
    unlockAudio();
    // Lock + clear immediately so late speech results cannot refill the box.
    state.composerLocked = true;
    clearComposerInput(input);
    setBusy(true);
    setStatus(tr("sending"), "warn");
    let sentOk = false;
    try {
      const { res, body } = await api("/api/paste-text", {
        method: "POST",
        body: JSON.stringify({ text, targetId }),
      });
      if (body?.busy || res.status === 409) {
        toast(tr("busy"), "error");
        setStatus("Busy", "warn");
        return;
      }
      if (!body?.ok) {
        const err = String(body?.error || "");
        const msg =
          /inserted|not sent|не отправлен/i.test(err)
            ? tr("insertedNotSent")
            : err || tr("sendFailed");
        toast(msg, "error");
        setStatus(tr("sendFailed"), "err");
        return;
      }
      sentOk = true;
      toast(tr("sent"), "ok");
      setStatus(tr("live"), "ok");
    } catch (e) {
      toast(String(e.message || e), "error");
      setStatus("Error", "err");
    } finally {
      setBusy(false);
      if (sentOk) {
        // Always clear phone field after successful API send; wipe IME rewrites for ~2s.
        lockComposerClear(input, 1800);
      } else {
        state.composerLocked = false;
        input.value = text;
        autoGrowComposer();
        syncComposer();
      }
    }
  }

  function autoGrowComposer() {
    const input = $("composer-input");
    if (!input) return;
    input.style.height = "auto";
    const next = Math.min(144, Math.max(68, input.scrollHeight));
    input.style.height = `${next}px`;
  }

  async function boot() {
    state.token = readTokenFromHash();
    if (!state.token) {
      showAuthGate(true, "bad_token");
      setStatus("No token", "err");
      return;
    }

    renderSoundToggle();
    document.addEventListener("pointerdown", unlockAudio, {
      once: true,
      capture: true,
    });
    $("sound-toggle")?.addEventListener("click", () => {
      state.soundEnabled = !state.soundEnabled;
      localStorage.setItem(
        "keycode.remote.sound",
        state.soundEnabled ? "on" : "off"
      );
      renderSoundToggle();
      if (state.soundEnabled) {
        unlockAudio();
        playCompletionSound();
      }
      toast(state.soundEnabled ? tr("soundOn") : tr("soundOff"), "ok");
    });
    // Keep token in fragment only (not query); strip if somehow duplicated in history quietly.
    try {
      history.replaceState(null, "", `${location.pathname}${location.search}#token=${encodeURIComponent(state.token)}`);
    } catch {
      /* ignore */
    }

    $("transcript").addEventListener("scroll", () => {
      const el = $("transcript");
      state.stickBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
    });

    $("target-select").addEventListener("change", async (e) => {
      await selectTarget(e.target.value || "");
    });

    $("btn-chat-pick")?.addEventListener("click", () => openChatSheet("chats"));
    $("btn-chat-new")?.addEventListener("click", () => openChatSheet("new"));
    $("chat-sheet-close")?.addEventListener("click", () => closeChatSheet());
    $("chat-sheet-backdrop")?.addEventListener("click", () => closeChatSheet());
    $("tab-chats")?.addEventListener("click", () => setSheetTab("chats"));
    $("tab-new")?.addEventListener("click", () => setSheetTab("new"));
    $("sheet-chats")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-target-id]");
      if (!btn) return;
      selectTarget(btn.getAttribute("data-target-id") || "");
    });
    $("sheet-projects")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".sheet-project");
      if (!btn || state.createBusy) return;
      createChatInProject(
        btn.getAttribute("data-project") || "",
        btn.getAttribute("data-cdp") || ""
      );
    });

    initLayoutSplit();

    $("btn-deck-prev")?.addEventListener("click", () => cycleDeck(-1));
    $("btn-deck-next")?.addEventListener("click", () => cycleDeck(1));
    $("btn-phase-next")?.addEventListener("click", () => switchToSuggestedDeck());

    $("composer-input")?.addEventListener("input", () => {
      const input = $("composer-input");
      enforceComposerLock(input);
      if (state.composerLocked) return;
      autoGrowComposer();
      syncComposer();
    });
    $("composer-input")?.addEventListener("keyup", () => {
      enforceComposerLock($("composer-input"));
      if (!state.composerLocked) syncComposer();
    });
    $("composer-input")?.addEventListener("change", () => {
      enforceComposerLock($("composer-input"));
      if (!state.composerLocked) syncComposer();
    });
    $("composer-input")?.addEventListener("compositionend", () => {
      const input = $("composer-input");
      enforceComposerLock(input);
      if (state.composerLocked) return;
      autoGrowComposer();
      syncComposer();
    });
    // Catch late autofill / dictation writes that skip input events.
    $("composer-input")?.addEventListener("focus", () => {
      enforceComposerLock($("composer-input"));
    });
    setInterval(() => enforceComposerLock($("composer-input")), 200);
    $("composer-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSendText();
      }
    });
    $("btn-send")?.addEventListener("click", (e) => {
      e.preventDefault();
      onSendText();
    });
    $("btn-mic")?.addEventListener("click", (e) => {
      e.preventDefault();
      startDictation();
    });

    $("composer-mode")?.addEventListener("change", async (e) => {
      const targetId = currentTargetId();
      const mode = normalizeModeId(e.target.value);
      if (!targetId || state.busy) return;
      setBusy(true);
      try {
        const { body } = await api("/api/composer/mode", {
          method: "POST",
          body: JSON.stringify({ targetId, mode }),
        });
        if (!body?.ok) {
          toast(remoteModeErrorMessage(body), "error");
          renderComposerChrome(state.composer);
          return;
        }
        if (body.composer) renderComposerChrome(body.composer);
        else renderComposerChrome({ ...(state.composer || {}), mode });
      } catch (err) {
        toast(String(err.message || err), "error");
      } finally {
        setBusy(false);
      }
    });

    $("clarifications")?.addEventListener("click", async (e) => {
      const btn = e.target.closest(".clarify-opt");
      if (!btn || state.busy) return;
      const targetId = currentTargetId();
      if (!targetId) {
        toast(tr("pickChat"), "error");
        return;
      }
      setBusy(true);
      setStatus(tr("answering"), "warn");
      try {
        const { body } = await api("/api/composer/answer", {
          method: "POST",
          body: JSON.stringify({
            targetId,
            clarificationId: btn.getAttribute("data-qid") || "",
            optionId: btn.getAttribute("data-oid") || "",
            text: btn.getAttribute("data-label") || "",
          }),
        });
        if (!body?.ok) {
          toast(body?.error || tr("sendFailed"), "error");
          setStatus(tr("sendFailed"), "err");
          return;
        }
        toast(tr("answered"), "ok");
        await loadChat();
        setStatus(tr("live"), "ok");
      } catch (err) {
        toast(String(err.message || err), "error");
      } finally {
        setBusy(false);
      }
    });

    $("btn-refresh").addEventListener("click", async () => {
      try {
        await loadState();
        await loadChat();
        connectSse();
        toast(tr("refreshed"), "ok");
      } catch (e) {
        toast(String(e.message || e), "error");
      }
    });

    try {
      await loadState();
      await loadChat();
      connectSse();
    } catch (e) {
      setStatus(String(e.message || e), "err");
      toast(String(e.message || e), "error");
    }
  }

  boot();
})();
