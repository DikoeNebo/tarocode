/** @typedef {{ id: string, name: string, match: string, hwnd?: string, enabled: boolean, fullTitle?: string }} Target */

let settings = /** @type {{ targets?: Target[], autoEnter?: boolean } | null} */ (null);

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

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

async function refresh() {
  const data = await window.keycode.getState();
  settings = data.settings;
  render();
}

function render() {
  const list = $("targets-list");
  const targets = settings?.targets || [];
  $("auto-enter").checked = settings?.autoEnter === true;

  const enabled = targets.filter((t) => t.enabled).length;
  const countEl = $("target-count");
  if (!targets.length) {
    countEl.textContent = "Нет целей";
    countEl.classList.add("warn");
  } else if (!enabled) {
    countEl.textContent = "Никто не выбран";
    countEl.classList.add("warn");
  } else {
    countEl.textContent = `${enabled} из ${targets.length} выбрано`;
    countEl.classList.remove("warn");
  }

  if (!targets.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">🎯</span>
        <div><strong>Чат Cursor</strong> — два клика (агент → поле)</div>
        <div style="font-size:12px"><strong>Поле</strong> — Notepad и другие окна · вкл/выкл на полосе</div>
      </div>`;
    return;
  }

  list.innerHTML = targets
    .map((t) => {
      const kind = t.needsCdpRebind
        ? "перепривязать через CDP"
        : t.driver === "cdp"
          ? "Cursor фон"
          : t.driver === "uia-quiet"
            ? "поле (тихо)"
            : t.driver === "uia"
              ? "Cursor UIA"
              : pointsOverlap(t)
                ? "ошибка привязки — добавьте заново"
                : t.inputPoint && !t.legacy
                  ? "поле окна"
                  : "нужно перепривязать поле ⊕";
      const match = [kind, t.fullTitle || t.match || ""]
        .filter(Boolean)
        .join(" · ");
      return `
      <label class="target-row ${t.needsUiaRebind ? "needs-rebind" : ""}" data-id="${escapeAttr(t.id)}">
        <input type="checkbox" ${t.enabled ? "checked" : ""} data-toggle="${escapeAttr(t.id)}" />
        <div class="target-info">
          <div class="target-name">${escapeHtml(t.name)}</div>
          <div class="target-match" title="${escapeAttr(match)}">${escapeHtml(match)}</div>
        </div>
        <button type="button" class="target-remove" data-remove="${escapeAttr(
          t.id
        )}" title="Убрать">×</button>
      </label>`;
    })
    .join("");
}

async function saveTargets(targets) {
  settings = await window.keycode.saveSettings({ targets });
  render();
}

function pointsOverlap(t) {
  if (!t?.focusPoint || !t?.inputPoint) return false;
  const dx = Number(t.focusPoint.x) - Number(t.inputPoint.x);
  const dy = Number(t.focusPoint.y) - Number(t.inputPoint.y);
  return dx * dx + dy * dy <= 12 * 12;
}

async function pickTarget(mode = "field") {
  if (mode === "cursor" || mode === "agent") {
    toast("Список чатов Cursor…", "");
    await window.keycode.openChatPick();
    return;
  }
  toast("Кликните по полю ввода…", "");
  const result = await window.keycode.startTargetPick("field");
  await refresh();
  if (result?.ok && result.duplicate) toast("Это же поле уже в списке", "error");
  else if (result?.ok) toast(`Добавлено: ${result.target.name}`, "ok");
  else if (result?.error) toast(result.error, "error");
}

function bindEvents() {
  $("btn-done").addEventListener("click", () => window.keycode.closeTargets());

  $("btn-pick").addEventListener("click", () => pickTarget("field"));
  $("btn-pick-agent").addEventListener("click", () => pickTarget("cursor"));
  $("btn-uia-diag")?.addEventListener("click", async () => {
    toast("Диагностика…", "");
    const r = await window.keycode.uiaDiagnose();
    if (!r?.ok) toast(r?.error || "Ошибка", "error");
    else toast(r.hint || "Готово", r.status === "ok" ? "ok" : "error");
  });

  $("btn-all").addEventListener("click", async () => {
    const targets = (settings?.targets || []).map((t) => ({ ...t, enabled: true }));
    await saveTargets(targets);
  });

  $("btn-none").addEventListener("click", async () => {
    const targets = (settings?.targets || []).map((t) => ({ ...t, enabled: false }));
    await saveTargets(targets);
  });

  $("auto-enter").addEventListener("change", async (e) => {
    settings = await window.keycode.saveSettings({ autoEnter: e.target.checked });
  });

  $("targets-list").addEventListener("click", async (e) => {
    const t = e.target;
    if (t.matches("[data-remove]")) {
      e.preventDefault();
      e.stopPropagation();
      const id = t.getAttribute("data-remove");
      const targets = (settings?.targets || []).filter((x) => x.id !== id);
      await saveTargets(targets);
    }
  });

  $("targets-list").addEventListener("change", async (e) => {
    const t = e.target;
    if (t.matches("[data-toggle]")) {
      const id = t.getAttribute("data-toggle");
      const targets = (settings?.targets || []).map((x) =>
        x.id === id ? { ...x, enabled: t.checked } : x
      );
      await saveTargets(targets);
    }
  });

  window.keycode.onToast((data) => toast(data.message, data.type || ""));
  window.keycode.onTargetsUpdated(async () => refresh());
  window.keycode.onStateChanged(async () => refresh());
}

bindEvents();
refresh().catch((e) => {
  console.error(e);
  toast("Ошибка загрузки", "error");
});
