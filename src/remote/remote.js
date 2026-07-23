(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    token: "",
    cards: [],
    decks: [],
    deck: null,
    targets: [],
    suggestions: [],
    targetId: "",
    busy: false,
    deckBusy: false,
    es: null,
    stickBottom: true,
    generating: false,
    completedAt: 0,
    locale: "en",
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
    },
  };
  let audioContext = null;
  let recognition = null;

  function tr(key) {
    const lang = state.locale.toLowerCase().startsWith("ru") ? "ru" : "en";
    return copy[lang][key] || copy.en[key] || key;
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

  function suggestedSet() {
    const ids = new Set();
    for (const s of state.suggestions || []) {
      if (s?.cardId) ids.add(s.cardId);
      if (s?.origin === "deck" && s?.id) ids.add(s.id);
    }
    return ids;
  }

  function renderCards() {
    const root = $("cards");
    root.replaceChildren();
    const highlight = suggestedSet();
    for (const card of state.cards) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card" + (highlight.has(card.id) ? " suggested" : "");
      btn.disabled = state.busy || !currentTargetId();
      btn.dataset.id = card.id;

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

      const title = document.createElement("div");
      title.className = "title";
      title.textContent = card.title || "Card";

      const desc = document.createElement("div");
      desc.className = "desc";
      desc.textContent = card.description || "";

      btn.appendChild(img);
      btn.appendChild(title);
      if (card.description) btn.appendChild(desc);
      btn.addEventListener("click", () => onPaste(card.id));
      root.appendChild(btn);
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
      return;
    }
    for (const t of state.targets) {
      const opt = document.createElement("option");
      opt.value = t.id;
      const title = t.name || t.chatTitle || t.id;
      const win = String(t.windowTitle || "").trim();
      opt.textContent =
        win && win.length > 2 && !win.toLowerCase().includes(String(title).toLowerCase())
          ? `${title} · ${win.slice(0, 28)}`
          : title;
      sel.appendChild(opt);
    }
    if (prev && state.targets.some((t) => t.id === prev)) {
      sel.value = prev;
      state.targetId = prev;
    } else {
      sel.value = state.targets[0].id;
      state.targetId = state.targets[0].id;
    }
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
    // Only lock while a send is in flight. Never gate on targetId / text —
    // mobile IME often skips `input` events, which left Send stuck disabled.
    const lock = !!state.busy;
    input.disabled = lock;
    input.readOnly = lock;
    btn.disabled = lock;
    btn.setAttribute("aria-disabled", lock ? "true" : "false");
    btn.textContent = tr("send");
    if (mic) {
      mic.disabled = lock;
      mic.classList.toggle("listening", !!state.listening);
      mic.setAttribute("aria-pressed", state.listening ? "true" : "false");
      mic.title = state.listening ? tr("micListening") : tr("mic");
      mic.setAttribute("aria-label", mic.title);
    }
  }

  function applyComposerLabels() {
    const label = $("composer-label");
    const input = $("composer-input");
    const btn = $("btn-send");
    const hint = $("composer-hint");
    const mic = $("btn-mic");
    if (label) label.textContent = tr("message");
    if (input) input.placeholder = tr("placeholder");
    if (btn) btn.textContent = tr("send");
    if (hint) hint.textContent = tr("composerHint");
    if (mic) {
      mic.title = tr("mic");
      mic.setAttribute("aria-label", tr("mic"));
    }
    syncComposer();
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
      renderTargets();
      renderCards();
      syncComposer();
      const hint = body?.hint || body?.error || "";
      if (hint === "cdp_closed" || res.status === 502) {
        setStatus(tr("cdpClosed"), "warn");
      } else {
        setStatus(hint || tr("noChats"), "warn");
      }
      return { ok: false, hint };
    }
    state.targets = body.chats || [];
    renderTargets();
    renderCards();
    syncComposer();
    if (!state.targets.length) {
      setStatus(tr("noChats"), "warn");
    }
    return { ok: true };
  }

  function applyDeckState(body) {
    if (!body || typeof body !== "object") return;
    if (Array.isArray(body.cards)) state.cards = body.cards;
    if (Array.isArray(body.decks)) state.decks = body.decks;
    if (body.deck) state.deck = body.deck;
    if (Array.isArray(body.suggestions)) state.suggestions = body.suggestions;
    if (body.uiLocale) state.locale = body.uiLocale;
    renderDeckPager();
    renderCards();
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
      $("cards-label").textContent = tr("cards");
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
    $("cards-label").textContent = tr("cards");
    $("target-label").textContent = tr("chat");
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
      return;
    }
    const { body } = await api(
      `/api/chat?targetId=${encodeURIComponent(state.targetId)}`
    );
    if (!body?.ok) {
      setStatus(body?.hint || body?.error || "Chat error", "warn");
      renderMessages([]);
      return;
    }
    renderMessages(body.messages || []);
    setActivity(body.generating === true);
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
    if (!state.token || !state.targetId) return;

    // EventSource cannot set Authorization headers — use fetch stream polyfill via query is forbidden.
    // We open SSE with fetch + ReadableStream instead.
    const ctrl = new AbortController();
    state.es = { close: () => ctrl.abort(), _ctrl: ctrl };
    (async () => {
      try {
        const res = await fetch(
          `/api/events?targetId=${encodeURIComponent(state.targetId)}`,
          { headers: authHeaders(), signal: ctrl.signal }
        );
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
        setStatus("Live", "ok");
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
      renderMessages(payload.messages || []);
      setActivity(payload.generating === true);
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
      $("cards-label").textContent = tr("cards");
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
      state.targetId = e.target.value || "";
      renderCards();
      syncComposer();
      await loadChat();
      connectSse();
    });

    $("btn-deck-prev")?.addEventListener("click", () => cycleDeck(-1));
    $("btn-deck-next")?.addEventListener("click", () => cycleDeck(1));

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
