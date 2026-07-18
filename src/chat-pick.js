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

let windows = [];
let chats = [];

async function loadWindows() {
  $("status").textContent = "Читаю окна Cursor (CDP)…";
  const r = await window.keycode.cdpListWindows();
  if (!r?.ok) {
    $("status").textContent = r?.error || "CDP закрыт";
    $("win-select").innerHTML = "";
    $("chat-list").innerHTML = "";
    toast(r?.error || "CDP закрыт", "error");
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
    $("status").textContent = "Окон Cursor не найдено";
    return;
  }
  await loadChats();
}

async function loadChats() {
  const id = $("win-select").value;
  $("status").textContent = "Читаю список чатов…";
  $("chat-list").innerHTML = "";
  const r = await window.keycode.cdpListChats(id);
  if (!r?.ok) {
    $("status").textContent = r?.error || "Не удалось получить чаты";
    toast(r?.error || "Ошибка списка", "error");
    return;
  }
  chats = r.chats || [];
  if (!chats.length) {
    $("status").textContent =
      "Чаты не найдены. Откройте Agents в Cursor или используйте отдельное окно на агента.";
    return;
  }
  $("status").textContent = `Найдено: ${chats.length}. Кликните чат, чтобы добавить.`;
  const winTitle =
    windows.find((w) => w.id === id)?.title || r.windowTitle || "Cursor";
  $("chat-list").innerHTML = chats
    .map(
      (c) => `
    <button type="button" class="chat-item" data-id="${escapeHtml(c.id)}">
      ${escapeHtml(c.title)}
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
      if (result?.ok && result.duplicate) toast("Этот чат уже в списке", "error");
      else if (result?.ok) {
        toast(`Добавлено: ${result.target.name}`, "ok");
        setTimeout(() => window.keycode.closeChatPick(), 400);
      } else toast(result?.error || "Ошибка", "error");
    });
  });
}

$("btn-refresh").addEventListener("click", () => loadWindows());
$("btn-cancel").addEventListener("click", () => window.keycode.closeChatPick());
$("win-select").addEventListener("change", () => loadChats());

loadWindows().catch((e) => {
  console.error(e);
  toast("Ошибка загрузки", "error");
});
