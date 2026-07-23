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

async function applyLocale() {
  const data = await window.keycode.getState();
  if (data.i18n) window.I18n.setPack(data.i18n);
  window.I18n.applyDom();
}

async function loadWindows() {
  $("status").textContent = window.I18n.t("chatPick.readingWindows");
  const r = await window.keycode.cdpListWindows();
  if (!r?.ok) {
    $("status").textContent = r?.error || window.I18n.t("chatPick.cdpClosed");
    $("win-select").innerHTML = "";
    $("chat-list").innerHTML = "";
    toast(r?.error || window.I18n.t("chatPick.cdpClosed"), "error");
    return;
  }
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
  const r = await window.keycode.cdpListChats(id);
  if (!r?.ok) {
    $("status").textContent = r?.error || window.I18n.t("chatPick.chatsFailed");
    toast(r?.error || window.I18n.t("chatPick.listError"), "error");
    return;
  }
  chats = r.chats || [];
  if (!chats.length) {
    $("status").textContent = window.I18n.t("chatPick.noChats");
    return;
  }
  $("status").textContent = window.I18n.t("chatPick.found", { n: chats.length });
  const winTitle =
    windows.find((w) => w.id === id)?.title || r.windowTitle || "Cursor";
  $("chat-list").innerHTML = chats
    .map(
      (c) => `
    <button type="button" class="chat-item" data-id="${escapeHtml(c.id)}">
      ${escapeHtml(displayChatTitle(c.title))}
    </button>`
    )
    .join("");
  $("chat-list").querySelectorAll(".chat-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const chat = chats.find((c) => c.id === btn.getAttribute("data-id"));
      if (!chat) return;
      const result = await window.keycode.cdpAddChat({
        cdpTargetId: id,
        windowTitle: winTitle,
        chatId: chat.id,
        chatTitle: chat.title,
      });
      if (result?.ok && result.duplicate) toast(window.I18n.t("chatPick.duplicate"), "error");
      else if (result?.ok) {
        toast(window.I18n.t("chatPick.added", { name: result.target.name }), "ok");
        setTimeout(() => window.keycode.closeChatPick(), 400);
      } else toast(result?.error || window.I18n.t("common.error"), "error");
    });
  });
}

$("btn-refresh").addEventListener("click", () => loadWindows());
$("btn-cancel").addEventListener("click", () => window.keycode.closeChatPick());
$("win-select").addEventListener("change", () => loadChats());
window.keycode.onStateChanged?.(async () => {
  await applyLocale();
});

applyLocale()
  .then(() => loadWindows())
  .catch((e) => {
    console.error(e);
    toast(window.I18n?.t?.("chatPick.loading") || "Error", "error");
  });
