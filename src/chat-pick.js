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
let recognition = null;
let listening = false;
let dictationSession = 0;
let dictationBase = "";

function speechLang() {
  const loc = String(window.I18n?.getUiLocale?.() || "en").toLowerCase();
  const map = {
    en: "en-US",
    ru: "ru-RU",
    uk: "uk-UA",
    de: "de-DE",
    es: "es-ES",
    fr: "fr-FR",
    "pt-br": "pt-BR",
    "zh-cn": "zh-CN",
    ja: "ja-JP",
    pl: "pl-PL",
  };
  return map[loc] || loc || "en-US";
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
    mic.disabled = taskBusy;
    mic.classList.toggle("listening", listening);
    mic.title = listening
      ? window.I18n.t("chatPick.micListening")
      : window.I18n.t("chatPick.mic");
    mic.setAttribute("aria-label", mic.title);
    mic.textContent = listening ? "■" : "🎤";
  }
  if (send) send.disabled = taskBusy;
  if (cancel) cancel.disabled = taskBusy;
  if (input) input.disabled = taskBusy;
}

function stopDictation() {
  dictationSession += 1;
  listening = false;
  try {
    recognition?.stop?.();
  } catch {
    /* ignore */
  }
  recognition = null;
  syncTaskUi();
}

function startDictation() {
  const input = $("task-input");
  if (!input || taskBusy) return;
  if (listening) {
    stopDictation();
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    toast(window.I18n.t("chatPick.micUnsupported"), "error");
    return;
  }
  let rec;
  try {
    rec = new SR();
  } catch {
    toast(window.I18n.t("chatPick.micError"), "error");
    return;
  }
  recognition = rec;
  const session = ++dictationSession;
  dictationBase = String(input.value || "").trim();
  rec.lang = speechLang();
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  rec.onstart = () => {
    if (session !== dictationSession) return;
    listening = true;
    syncTaskUi();
  };
  rec.onerror = (ev) => {
    if (session !== dictationSession) return;
    const err = String(ev?.error || "");
    stopDictation();
    if (err === "not-allowed" || err === "service-not-allowed") {
      toast(window.I18n.t("chatPick.micDenied"), "error");
    } else if (err !== "aborted" && err !== "no-speech") {
      toast(window.I18n.t("chatPick.micError"), "error");
    }
  };
  rec.onend = () => {
    if (session !== dictationSession) return;
    listening = false;
    if (recognition === rec) recognition = null;
    syncTaskUi();
    if (taskBusy) return;
    if (String(input.value || "").trim()) {
      toast(window.I18n.t("chatPick.micReady"), "ok");
    }
  };
  rec.onresult = (event) => {
    if (session !== dictationSession || taskBusy) return;
    let finalText = "";
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i]?.[0]?.transcript || "";
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    const spoken = String(finalText || interim || "").trim();
    const next = [dictationBase, spoken].filter(Boolean).join(" ").trim();
    input.value = next;
    if (finalText.trim()) dictationBase = next;
  };
  try {
    rec.start();
  } catch {
    stopDictation();
    toast(window.I18n.t("chatPick.micError"), "error");
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
  startDictation();
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
