const $ = (id) => document.getElementById(id);

function toast(message, type = "") {
  const el = $("toast");
  el.textContent = message;
  el.className = `toast ${type}`.trim();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2800);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayChatTitle(title) {
  if (title === "Текущий агент") return window.I18n.t("msg.currentAgent");
  return title;
}

let windows = [];
let chats = [];
let projects = [];
/** @type {Record<string, boolean>} */
let projectOpen = {};
let cdpBusy = false;
let createBusy = false;
let taskBusy = false;
/** @type {{ targetId: string } | null} */
let pendingTask = null;
/** Local STT (same path as deck strip) — not cloud Web Speech. */
let listening = false;
let dictationBusy = false;
let dictationSession = 0;
let dictationBase = "";
/** @type {"gigaam"|"windows"} */
let dictationEngine = "gigaam";
let dictateAutoSend = false;
/** Silence before auto-end (sec); from settings. */
let dictationSilenceSecValue = 3.5;
/** Max take length (sec); 0 = unlimited. */
let dictationMaxSecValue = 0;
/** @type {MediaStream|null} */
let micStream = null;
/** @type {AudioContext|null} */
let audioCtx = null;
/** @type {ScriptProcessorNode|null} */
let processor = null;
/** @type {number[]} */
let pcmChunks = [];
let speechSeen = false;
let silentFrames = 0;
/** @type {ReturnType<typeof setTimeout>|null} */
let dictationMaxTimer = null;

function speechLangFromTag(tag) {
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

function speechLang() {
  const loc = String(
    window.I18n?.getUiLocale?.() || navigator.language || "en"
  ).toLowerCase();
  if (loc === "system") return speechLangFromTag(navigator.language || "en");
  return speechLangFromTag(loc);
}

function normalizeDictationEngine(raw) {
  return String(raw || "gigaam").toLowerCase() === "windows"
    ? "windows"
    : "gigaam";
}

function setCdpActionsVisible(visible, cursorRunning = false) {
  const wrap = $("cdp-pick-actions");
  const btn = $("btn-cdp-restart");
  if (!wrap || !btn) return;
  wrap.classList.toggle("hidden", !visible);
  if (visible) {
    btn.textContent = cursorRunning
      ? window.I18n.t("cdp.restartBtn")
      : window.I18n.t("cdp.launchBtn");
  }
}

async function launchOrRestartCdp() {
  if (cdpBusy) return;
  cdpBusy = true;
  const btn = $("btn-cdp-restart");
  if (btn) btn.disabled = true;
  try {
    const probe = await window.keycode.cursorProbe();
    if (probe?.ok || probe?.open) {
      toast(probe.hint || window.I18n.t("cdp.alreadyOk"), "ok");
      setCdpActionsVisible(false);
      await loadWindows();
      return;
    }
    const running = !!probe?.cursorRunning;
    toast(
      running ? window.I18n.t("cursor.restartWaitClose") : window.I18n.t("cdp.launching"),
      ""
    );
    const r = await window.keycode.cursorLaunchIntegration({
      mode: "background",
      allowRestart: true,
    });
    if (!r?.ok) {
      toast(r?.error || window.I18n.t("cdp.fail"), "error");
      setCdpActionsVisible(true, running);
      return;
    }
    const open = !!(r.probe?.open);
    toast(
      r.probe?.hint ||
        (open
          ? window.I18n.t("msg.cursorReadyCdp")
          : window.I18n.t("msg.cursorStarting")),
      open ? "ok" : "error"
    );
    if (open) {
      setCdpActionsVisible(false);
      await loadWindows();
    } else {
      setCdpActionsVisible(true, false);
    }
  } catch (e) {
    toast(String(e.message || e), "error");
  } finally {
    cdpBusy = false;
    if (btn) btn.disabled = false;
  }
}

async function applyLocale() {
  const data = await window.keycode.getState();
  if (data.i18n) window.I18n.setPack(data.i18n);
  dictationEngine = normalizeDictationEngine(data.settings?.dictationEngine);
  dictateAutoSend = data.settings?.deckDictateAutoSend === true;
  const silence = Number(data.settings?.dictationSilenceSec);
  dictationSilenceSecValue = Number.isFinite(silence)
    ? Math.min(15, Math.max(1, silence))
    : 3.5;
  const maxSec = Number(data.settings?.dictationMaxSec);
  dictationMaxSecValue =
    Number.isFinite(maxSec) && maxSec > 0
      ? Math.min(1800, Math.max(5, Math.round(maxSec)))
      : 0;
  window.I18n.applyDom();
  syncTaskUi();
}

async function addChat(chat) {
  const id = $("win-select").value;
  const winTitle =
    windows.find((w) => w.id === id)?.title || "Cursor";
  const result = await window.keycode.cdpAddChat({
    cdpTargetId: id,
    windowTitle: winTitle,
    chatId: chat.id,
    chatTitle: chat.title,
    projectName: chat.project || "",
  });
  if (result?.ok && result.duplicate) toast(window.I18n.t("chatPick.duplicate"), "error");
  else if (result?.ok) {
    toast(window.I18n.t("chatPick.added", { name: result.target.name }), "ok");
    setTimeout(() => window.keycode.closeChatPick(), 400);
  } else toast(result?.error || window.I18n.t("common.error"), "error");
}

function syncTaskUi() {
  const mic = $("btn-task-mic");
  const send = $("btn-task-send");
  const input = $("task-input");
  const cancel = $("btn-task-cancel");
  if (mic) {
    mic.disabled = taskBusy || dictationBusy;
    mic.classList.toggle("listening", listening);
    mic.title = listening
      ? window.I18n.t("chatPick.micListening")
      : dictationBusy
        ? window.I18n.t("deck.chatTranscribing")
        : window.I18n.t("chatPick.mic");
    mic.setAttribute("aria-label", mic.title);
    mic.setAttribute("aria-pressed", listening ? "true" : "false");
    mic.textContent = listening ? "■" : dictationBusy ? "…" : "🎤";
  }
  if (send) send.disabled = taskBusy || dictationBusy;
  if (cancel) cancel.disabled = taskBusy;
  const autoSend = $("task-dictate-auto-send");
  if (autoSend) {
    autoSend.checked = dictateAutoSend;
    autoSend.disabled = taskBusy || dictationBusy;
  }
  if (input) input.disabled = taskBusy || dictationBusy;
}

function clearDictationMaxTimer() {
  if (dictationMaxTimer) {
    clearTimeout(dictationMaxTimer);
    dictationMaxTimer = null;
  }
}

function teardownMic() {
  clearDictationMaxTimer();
  try {
    processor?.disconnect();
  } catch {
    /* ignore */
  }
  processor = null;
  try {
    audioCtx?.close();
  } catch {
    /* ignore */
  }
  audioCtx = null;
  if (micStream) {
    for (const track of micStream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  }
  micStream = null;
}

function stopDictation() {
  dictationSession += 1;
  listening = false;
  dictationBusy = false;
  teardownMic();
  syncTaskUi();
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

function dictationSilenceSec() {
  const n = Number(dictationSilenceSecValue);
  if (!Number.isFinite(n)) return 3.5;
  return Math.min(15, Math.max(1, n));
}

function dictationMaxMs() {
  const n = Number(dictationMaxSecValue);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(1800, Math.max(5, Math.round(n))) * 1000;
}

async function finishDictation(session, input, base, lang) {
  if (session !== dictationSession || dictationBusy) return;
  dictationBusy = true;
  dictationSession += 1;
  listening = false;
  const chunks = pcmChunks;
  const inputRate = audioCtx?.sampleRate || 48000;
  teardownMic();
  syncTaskUi();

  try {
    if (!chunks.length) {
      toast(window.I18n.t("chatPick.micError"), "error");
      return;
    }
    const merged = new Float32Array(chunks.length);
    for (let i = 0; i < chunks.length; i++) merged[i] = chunks[i];
    const pcm16k = downsampleTo16k(merged, inputRate);
    const samples = Array.from(pcm16k);
    const result = await window.keycode.dictateTranscribe({
      lang,
      engine: dictationEngine,
      samples,
      sampleRate: 16000,
    });
    if (!result?.ok) {
      const key =
        result?.hint === "no_speech"
          ? "chatPick.micError"
          : result?.hint === "no_lang"
            ? "deck.chatMicNoLang"
            : result?.hint === "gigaam_setup_failed"
              ? "deck.chatMicGigaamSetup"
              : result?.hint === "gigaam_failed"
                ? "deck.chatMicGigaamFail"
                : /denied|access|микрофон|microphone/i.test(
                      String(result?.error || "")
                    )
                  ? "chatPick.micDenied"
                  : "chatPick.micError";
      const detail = String(result?.error || "").trim();
      toast(
        detail && key === "chatPick.micError"
          ? `${window.I18n.t(key)} (${detail.slice(0, 120)})`
          : window.I18n.t(key),
        "error"
      );
      return;
    }
    const spoken = String(result.text || "").trim();
    if (!spoken) {
      toast(window.I18n.t("chatPick.micError"), "error");
      return;
    }
    if (input && !taskBusy && pendingTask) {
      input.value = [base, spoken].filter(Boolean).join(" ").trim();
      syncTaskUi();
      if (dictateAutoSend) {
        await sendTask();
        return;
      }
      const engLabel =
        result.engine === "windows"
          ? window.I18n.t("deck.chatMicEngineWindows")
          : window.I18n.t("deck.chatMicEngineGigaam");
      toast(`${engLabel}: ${window.I18n.t("chatPick.micReady")}`, "ok");
    }
  } catch {
    toast(window.I18n.t("chatPick.micError"), "error");
  } finally {
    dictationBusy = false;
    listening = false;
    syncTaskUi();
  }
}

async function startDictation() {
  const input = $("task-input");
  if (!input || taskBusy || dictationBusy) return;
  if (listening) {
    const session = dictationSession;
    const base = dictationBase;
    const lang = speechLang();
    await finishDictation(session, input, base, lang);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast(window.I18n.t("chatPick.micUnsupported"), "error");
    return;
  }

  const lang = speechLang();
  const base = String(input.value || "").trim();
  dictationBase = base;
  pcmChunks = [];
  speechSeen = false;
  silentFrames = 0;
  const session = ++dictationSession;

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch {
    toast(window.I18n.t("chatPick.micDenied"), "error");
    return;
  }

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    audioCtx = new Ctx();
    const source = audioCtx.createMediaStreamSource(micStream);
    const bufferSize = 4096;
    processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    const mute = audioCtx.createGain();
    mute.gain.value = 0;
    const preRollMax = Math.max(
      bufferSize,
      Math.round(0.2 * (audioCtx.sampleRate || 48000))
    );
    /** @type {number[]} */
    let preRoll = [];
    processor.onaudioprocess = (ev) => {
      if (session !== dictationSession) return;
      const inputData = ev.inputBuffer.getChannelData(0);
      const rms = rmsOf(inputData);
      if (rms >= 0.015) {
        if (!speechSeen && preRoll.length) {
          for (let i = 0; i < preRoll.length; i++) pcmChunks.push(preRoll[i]);
          preRoll = [];
        }
        speechSeen = true;
        silentFrames = 0;
      } else if (speechSeen) {
        silentFrames += 1;
      }
      if (!speechSeen) {
        for (let i = 0; i < inputData.length; i++) preRoll.push(inputData[i]);
        if (preRoll.length > preRollMax) {
          preRoll.splice(0, preRoll.length - preRollMax);
        }
      } else {
        for (let i = 0; i < inputData.length; i++) {
          pcmChunks.push(inputData[i]);
        }
      }
      // Hush length from Settings (dictationSilenceSec).
      const silenceSec = dictationSilenceSec();
      const framesForSilence = Math.max(
        8,
        Math.round((silenceSec * (audioCtx?.sampleRate || 48000)) / bufferSize)
      );
      if (speechSeen && silentFrames >= framesForSilence) {
        finishDictation(session, input, base, lang);
      }
    };
    source.connect(processor);
    processor.connect(mute);
    mute.connect(audioCtx.destination);
  } catch {
    teardownMic();
    toast(window.I18n.t("chatPick.micError"), "error");
    return;
  }

  listening = true;
  syncTaskUi();
  clearDictationMaxTimer();
  const maxMs = dictationMaxMs();
  if (maxMs > 0) {
    dictationMaxTimer = setTimeout(() => {
      if (session !== dictationSession) return;
      finishDictation(session, input, base, lang);
    }, maxMs);
  }
}

function showTaskModal(targetId) {
  pendingTask = { targetId: String(targetId || "") };
  const modal = $("task-modal");
  const input = $("task-input");
  if (input) input.value = "";
  stopDictation();
  taskBusy = false;
  modal?.classList.remove("hidden");
  modal?.setAttribute("aria-hidden", "false");
  syncTaskUi();
  window.I18n.applyDom(modal);
  setTimeout(() => input?.focus(), 30);
}

function hideTaskModal() {
  stopDictation();
  pendingTask = null;
  taskBusy = false;
  const modal = $("task-modal");
  modal?.classList.add("hidden");
  modal?.setAttribute("aria-hidden", "true");
  const input = $("task-input");
  if (input) input.value = "";
  syncTaskUi();
}

async function sendTask() {
  if (taskBusy || !pendingTask?.targetId) return;
  const input = $("task-input");
  const text = String(input?.value || "").trim();
  if (!text) {
    toast(window.I18n.t("chatPick.taskEmpty"), "error");
    return;
  }
  stopDictation();
  taskBusy = true;
  syncTaskUi();
  try {
    const r = await window.keycode.pasteTextToTarget({
      targetId: pendingTask.targetId,
      text,
    });
    if (!r?.ok) {
      toast(
        r?.error || window.I18n.t("chatPick.taskSendFail"),
        "error"
      );
      taskBusy = false;
      syncTaskUi();
      return;
    }
    toast(window.I18n.t("chatPick.taskSent"), "ok");
    hideTaskModal();
    setTimeout(() => window.keycode.closeChatPick(), 350);
  } catch (e) {
    toast(String(e.message || e) || window.I18n.t("chatPick.taskSendFail"), "error");
    taskBusy = false;
    syncTaskUi();
  }
}

async function createChatInProject(projectName) {
  if (createBusy || !projectName) return;
  createBusy = true;
  document.querySelectorAll(".project-new").forEach((b) => {
    b.disabled = true;
  });
  toast(window.I18n.t("chatPick.creating"), "");
  try {
    const id = $("win-select").value;
    const winTitle =
      windows.find((w) => w.id === id)?.title || "Cursor";
    const result = await window.keycode.cdpCreateChat({
      cdpTargetId: id,
      windowTitle: winTitle,
      projectName,
    });
    if (!result?.ok || !result.target?.id) {
      toast(
        result?.error || window.I18n.t("chatPick.createFail"),
        "error"
      );
      return;
    }
    toast(window.I18n.t("chatPick.added", { name: result.target.name }), "ok");
    showTaskModal(result.target.id);
  } catch (e) {
    toast(String(e.message || e) || window.I18n.t("chatPick.createFail"), "error");
  } finally {
    createBusy = false;
    document.querySelectorAll(".project-new").forEach((b) => {
      b.disabled = false;
    });
  }
}

function renderTree() {
  const list = $("chat-list");
  list.innerHTML = "";

  if (projects.length) {
    list.innerHTML = projects
      .map((p) => {
        const open = projectOpen[p.id] !== false;
        const count = (p.chats || []).length;
        const chatsHtml = (p.chats || [])
          .map(
            (c) => `
          <button type="button" class="chat-item" data-id="${escapeHtml(c.id)}">
            ${escapeHtml(displayChatTitle(c.title))}
          </button>`
          )
          .join("");
        return `
        <div class="project-group ${open ? "" : "collapsed"}" data-project="${escapeHtml(p.id)}">
          <div class="project-head">
            <button type="button" class="project-head-toggle" data-toggle-project="${escapeHtml(p.id)}" aria-expanded="${open}">
              <span class="project-chevron" aria-hidden="true">${open ? "▾" : "▸"}</span>
              <span class="project-name">${escapeHtml(p.name)}</span>
              <span class="project-count">${count}</span>
            </button>
            <button
              type="button"
              class="project-new"
              data-new-chat="${escapeHtml(p.name)}"
              title="${escapeHtml(window.I18n.t("chatPick.newChat"))}"
              aria-label="${escapeHtml(window.I18n.t("chatPick.newChat"))}"
            >+</button>
          </div>
          <div class="project-chats">${chatsHtml}</div>
        </div>`;
      })
      .join("");
  } else {
    list.innerHTML = chats
      .map(
        (c) => `
      <button type="button" class="chat-item" data-id="${escapeHtml(c.id)}">
        ${escapeHtml(displayChatTitle(c.title))}
      </button>`
      )
      .join("");
  }

  list.querySelectorAll("[data-toggle-project]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pid = btn.getAttribute("data-toggle-project");
      projectOpen[pid] = !(projectOpen[pid] !== false);
      renderTree();
    });
  });

  list.querySelectorAll("[data-new-chat]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const name = btn.getAttribute("data-new-chat");
      await createChatInProject(name);
    });
  });

  list.querySelectorAll(".chat-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const chatId = btn.getAttribute("data-id");
      const chat =
        chats.find((c) => c.id === chatId) ||
        projects.flatMap((p) => p.chats || []).find((c) => c.id === chatId);
      if (!chat) return;
      await addChat(chat);
    });
  });
}

async function loadWindows() {
  $("status").textContent = window.I18n.t("chatPick.readingWindows");
  const r = await window.keycode.cdpListWindows();
  if (!r?.ok) {
    $("status").textContent = r?.error || window.I18n.t("chatPick.cdpClosed");
    $("win-select").innerHTML = "";
    $("chat-list").innerHTML = "";
    projects = [];
    chats = [];
    let running = false;
    try {
      const probe = await window.keycode.cursorProbe();
      running = !!probe?.cursorRunning;
    } catch {
      /* ignore */
    }
    setCdpActionsVisible(true, running);
    toast(r?.error || window.I18n.t("chatPick.cdpClosed"), "error");
    return;
  }
  setCdpActionsVisible(false);
  windows = r.windows || [];
  const sel = $("win-select");
  sel.innerHTML = windows
    .map(
      (w, i) =>
        `<option value="${escapeHtml(w.id)}" ${i === 0 ? "selected" : ""}>${escapeHtml(
          w.title || w.id
        )}</option>`
    )
    .join("");
  if (!windows.length) {
    $("status").textContent = window.I18n.t("chatPick.noWindows");
    return;
  }
  await loadChats();
}

async function loadChats() {
  const id = $("win-select").value;
  $("status").textContent = window.I18n.t("chatPick.readingChats");
  $("chat-list").innerHTML = "";
  const r = await window.keycode.cdpListChats(id, { revealAll: true });
  if (!r?.ok) {
    $("status").textContent = r?.error || window.I18n.t("chatPick.chatsFailed");
    toast(r?.error || window.I18n.t("chatPick.listError"), "error");
    return;
  }
  projects = Array.isArray(r.projects) ? r.projects : [];
  chats = Array.isArray(r.chats) ? r.chats : [];

  // Default: all projects collapsed — expand one by one (avoids squashed rows)
  for (const p of projects) {
    if (projectOpen[p.id] === undefined) {
      projectOpen[p.id] = false;
    }
  }

  if (!chats.length && !projects.some((p) => (p.chats || []).length)) {
    // Still show project rows (with +) when Cursor lists empty project sections
    if (!projects.length) {
      $("status").textContent = window.I18n.t("chatPick.noChats");
      return;
    }
  }

  const total =
    projects.length > 0
      ? projects.reduce((n, p) => n + (p.chats || []).length, 0)
      : chats.length;
  if (projects.length > 0) {
    $("status").textContent = window.I18n.t("chatPick.foundProjects", {
      projects: projects.length,
      n: total,
    });
  } else {
    $("status").textContent = window.I18n.t("chatPick.found", { n: total });
  }
  renderTree();
}

$("btn-refresh").addEventListener("click", () => loadWindows());
$("btn-cancel").addEventListener("click", () => window.keycode.closeChatPick());
$("btn-cdp-restart")?.addEventListener("click", () => launchOrRestartCdp());
$("win-select").addEventListener("change", () => loadChats());
$("btn-task-send")?.addEventListener("click", (e) => {
  e.preventDefault();
  sendTask();
});
$("btn-task-cancel")?.addEventListener("click", (e) => {
  e.preventDefault();
  hideTaskModal();
});
$("btn-task-mic")?.addEventListener("click", (e) => {
  e.preventDefault();
  void startDictation();
});
$("task-dictate-auto-send")?.addEventListener("change", async (e) => {
  e.preventDefault();
  dictateAutoSend = e.target.checked === true;
  await window.keycode.saveSettings({ deckDictateAutoSend: dictateAutoSend });
  syncTaskUi();
});
$("task-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendTask();
  }
});
$("task-modal")?.addEventListener("click", (e) => {
  if (e.target === $("task-modal") && !taskBusy) hideTaskModal();
});

window.keycode.onStateChanged?.(async () => {
  await applyLocale();
});

applyLocale()
  .then(() => loadWindows())
  .catch((e) => {
    console.error(e);
    toast(window.I18n?.t?.("chatPick.loading") || "Error", "error");
  });
