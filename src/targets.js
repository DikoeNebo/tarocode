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
  if (data.i18n) window.I18n.setPack(data.i18n);
  window.I18n.applyDom();
  render();
}

function render() {
  const list = $("targets-list");
  const targets = settings?.targets || [];
  $("auto-enter").checked = settings?.autoEnter === true;

  const enabled = targets.filter((t) => t.enabled).length;
  const countEl = $("target-count");
  if (!targets.length) {
    countEl.textContent = window.I18n.t("targets.countNone");
    countEl.classList.add("warn");
  } else if (!enabled) {
    countEl.textContent = window.I18n.t("targets.countZero");
    countEl.classList.add("warn");
  } else {
    countEl.textContent = window.I18n.t("targets.countSelected", { enabled, total: targets.length });
    countEl.classList.remove("warn");
  }

  if (!targets.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">◌</span>
        <div>${window.I18n.t("targets.emptyHintChat")}</div>
        <div class="empty-state-detail">${window.I18n.t("targets.emptyHintField")}</div>
      </div>`;
  } else {
    list.innerHTML = targets
      .map((t) => {
        const kind = t.needsCdpRebind
          ? window.I18n.t("driver.rebindChatTargets")
          : t.driver === "cdp"
            ? window.I18n.t("driver.cdp")
            : t.driver === "uia-quiet"
              ? window.I18n.t("driver.quiet")
              : t.driver === "uia"
                ? window.I18n.t("driver.uiaLegacy")
                : pointsOverlap(t)
                  ? window.I18n.t("driver.bindError")
                  : t.inputPoint && !t.legacy
                    ? window.I18n.t("driver.windowField")
                    : window.I18n.t("driver.needRebindField");
        const match = [
          kind,
          window.I18n.t(t.enabled ? "targets.enabled" : "targets.disabled"),
          t.fullTitle || t.match || "",
        ]
          .filter(Boolean)
          .join(" · ");
        return `
      <label class="target-row ${t.needsUiaRebind || t.needsCdpRebind ? "needs-rebind" : ""}" data-id="${escapeAttr(t.id)}">
        <input type="checkbox" ${t.enabled ? "checked" : ""} data-toggle="${escapeAttr(t.id)}" />
        <div class="target-info">
          <div class="target-name">${escapeHtml(t.name)}</div>
          <div class="target-match" title="${escapeAttr(match)}">${escapeHtml(match)}</div>
        </div>
        <button type="button" class="target-remove" data-remove="${escapeAttr(
          t.id
        )}" title="${escapeAttr(window.I18n.t("targets.remove"))}">×</button>
      </label>`;
      })
      .join("");
  }

  renderPresets();
}

const MAX_PRESETS = 4;

function renderPresets() {
  const list = $("presets-list");
  if (!list) return;
  const presets = settings?.targetPresets || [];
  const mode = String(settings?.pasteMode || "broadcast").toLowerCase();
  const activeId = settings?.activePresetId || "";

  if (!presets.length) {
    list.innerHTML = `<div class="presets-empty">${escapeHtml(
      window.I18n.t("targets.presetsEmpty")
    )}</div>`;
    return;
  }

  list.innerHTML = presets
    .map((p) => {
      const active = mode === "broadcast" && p.id === activeId;
      const n = (p.targetIds || []).length;
      return `
      <div class="preset-row${active ? " active" : ""}" data-preset-id="${escapeAttr(p.id)}">
        <div class="preset-info">
          <div class="preset-name">${escapeHtml(p.name)}</div>
          <div class="preset-meta">${escapeHtml(
            window.I18n.t("targets.presetsCount", { n })
          )}</div>
        </div>
        <button type="button" class="link-btn" data-preset-apply="${escapeAttr(
          p.id
        )}">${escapeHtml(window.I18n.t("targets.presetsApply"))}</button>
        <button type="button" class="link-btn" data-preset-rename="${escapeAttr(
          p.id
        )}">${escapeHtml(window.I18n.t("targets.presetsRename"))}</button>
        <button type="button" class="target-remove" data-preset-delete="${escapeAttr(
          p.id
        )}" title="${escapeAttr(window.I18n.t("common.delete"))}">×</button>
      </div>`;
    })
    .join("");
}

async function savePresetFromSelection() {
  const targets = settings?.targets || [];
  const selected = targets.filter((t) => t.enabled).map((t) => t.id);
  if (!selected.length) {
    toast(window.I18n.t("targets.presetsNeedSelection"), "error");
    return;
  }
  const presets = [...(settings?.targetPresets || [])];
  if (presets.length >= MAX_PRESETS) {
    toast(window.I18n.t("targets.presetsMax"), "error");
    return;
  }
  const name = window.prompt(
    window.I18n.t("targets.presetsNamePrompt"),
    window.I18n.t("targets.presetsDefaultName", { n: presets.length + 1 })
  );
  if (name == null) return;
  const trimmed = String(name).trim().slice(0, 80);
  if (!trimmed) {
    toast(window.I18n.t("targets.presetsNeedName"), "error");
    return;
  }
  presets.push({
    id: `preset-${Date.now().toString(36)}`,
    name: trimmed,
    targetIds: selected,
  });
  settings = await window.keycode.saveSettings({
    targetPresets: presets,
    pasteMode: "broadcast",
    activePresetId: presets[presets.length - 1].id,
    targets: targets.map((t) => ({ ...t, enabled: selected.includes(t.id) })),
  });
  render();
  toast(window.I18n.t("targets.presetsSaved"), "ok");
}

async function applyPreset(presetId) {
  const presets = settings?.targetPresets || [];
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return;
  const ids = new Set(preset.targetIds || []);
  const targets = (settings?.targets || []).map((t) => ({
    ...t,
    enabled: ids.has(t.id),
  }));
  settings = await window.keycode.saveSettings({
    pasteMode: "broadcast",
    activePresetId: presetId,
    targets,
  });
  render();
}

async function renamePreset(presetId) {
  const presets = [...(settings?.targetPresets || [])];
  const idx = presets.findIndex((p) => p.id === presetId);
  if (idx < 0) return;
  const name = window.prompt(window.I18n.t("targets.presetsNamePrompt"), presets[idx].name);
  if (name == null) return;
  const trimmed = String(name).trim().slice(0, 80);
  if (!trimmed) {
    toast(window.I18n.t("targets.presetsNeedName"), "error");
    return;
  }
  presets[idx] = { ...presets[idx], name: trimmed };
  settings = await window.keycode.saveSettings({ targetPresets: presets });
  render();
}

async function deletePreset(presetId) {
  const presets = (settings?.targetPresets || []).filter((p) => p.id !== presetId);
  const patch = { targetPresets: presets };
  if (settings?.activePresetId === presetId) {
    patch.activePresetId = "";
  }
  settings = await window.keycode.saveSettings(patch);
  render();
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
    toast(window.I18n.t("targetsMsg.listingChats"), "");
    await window.keycode.openChatPick();
    return;
  }
  toast(window.I18n.t("targetsMsg.clickField"), "");
  const result = await window.keycode.startTargetPick("field");
  await refresh();
  if (result?.ok && result.duplicate) toast(window.I18n.t("targetsMsg.duplicateField"), "error");
  else if (result?.ok) toast(window.I18n.t("targetsMsg.added", { name: result.target.name }), "ok");
  else if (result?.error) toast(result.error, "error");
}

async function launchOrRestartCdp() {
  const btn = $("btn-cdp-launch");
  const label = btn?.querySelector(".pick-label");
  if (btn) btn.disabled = true;
  try {
    const probe = await window.keycode.cursorProbe();
    if (probe?.ok || probe?.open) {
      toast(probe.hint || window.I18n.t("cdp.alreadyOk"), "ok");
      if (label) label.textContent = window.I18n.t("targets.cdpOk");
      if (btn) {
        btn.classList.add("ok");
        btn.classList.remove("warn");
      }
      return;
    }
    const running = !!probe?.cursorRunning;
    if (label) {
      label.textContent = running
        ? window.I18n.t("cdp.restartBtn")
        : window.I18n.t("cdp.launchBtn");
    }
    if (btn) {
      btn.classList.remove("ok");
      btn.classList.add("warn");
    }
    toast(
      running ? window.I18n.t("cdp.restarting") : window.I18n.t("cdp.launching"),
      ""
    );
    const r = await window.keycode.cursorLaunchIntegration({
      mode: "both",
      allowRestart: true,
    });
    if (!r?.ok) {
      toast(r?.error || window.I18n.t("cdp.fail"), "error");
      if (btn) {
        btn.classList.remove("ok");
        btn.classList.add("warn");
      }
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
    if (label) {
      label.textContent = open
        ? window.I18n.t("targets.cdpOk")
        : window.I18n.t("targets.cdpLaunch");
    }
    if (btn) {
      btn.classList.toggle("ok", open);
      btn.classList.toggle("warn", !open);
    }
  } catch (e) {
    toast(String(e.message || e), "error");
    if (btn) {
      btn.classList.remove("ok");
      btn.classList.add("warn");
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function refreshCdpButtonLabel() {
  const btn = $("btn-cdp-launch");
  const label = btn?.querySelector(".pick-label");
  if (!label) return;
  try {
    const probe = await window.keycode.cursorProbe();
    if (probe?.ok || probe?.open) {
      label.textContent = window.I18n.t("targets.cdpOk");
      if (btn) {
        btn.classList.add("ok");
        btn.classList.remove("warn");
      }
      return;
    }
    label.textContent = probe?.cursorRunning
      ? window.I18n.t("cdp.restartBtn")
      : window.I18n.t("targets.cdpLaunch");
    if (btn) {
      btn.classList.remove("ok");
      btn.classList.add("warn");
    }
  } catch {
    label.textContent = window.I18n.t("targets.cdpLaunch");
    if (btn) {
      btn.classList.remove("ok");
      btn.classList.add("warn");
    }
  }
}

function bindEvents() {
  $("btn-pick").addEventListener("click", () => pickTarget("field"));
  $("btn-pick-agent").addEventListener("click", () => pickTarget("cursor"));
  $("btn-cdp-launch")?.addEventListener("click", () => launchOrRestartCdp());
  $("btn-uia-diag")?.addEventListener("click", async () => {
    toast(window.I18n.t("targetsMsg.diag"), "");
    const r = await window.keycode.uiaDiagnose();
    if (!r?.ok) toast(r?.error || window.I18n.t("common.error"), "error");
    else toast(r.hint || window.I18n.t("targetsMsg.ready"), r.status === "ok" ? "ok" : "error");
  });

  $("btn-all").addEventListener("click", async () => {
    const targets = (settings?.targets || []).map((t) => ({ ...t, enabled: true }));
    await saveTargets(targets);
  });

  $("btn-none").addEventListener("click", async () => {
    const targets = (settings?.targets || []).map((t) => ({ ...t, enabled: false }));
    await saveTargets(targets);
  });

  $("btn-save-preset")?.addEventListener("click", () => savePresetFromSelection());

  $("presets-list")?.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.matches("[data-preset-apply]")) {
      await applyPreset(t.getAttribute("data-preset-apply"));
      return;
    }
    if (t.matches("[data-preset-rename]")) {
      await renamePreset(t.getAttribute("data-preset-rename"));
      return;
    }
    if (t.matches("[data-preset-delete]")) {
      await deletePreset(t.getAttribute("data-preset-delete"));
    }
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
refresh()
  .then(() => refreshCdpButtonLabel())
  .catch((e) => {
    console.error(e);
    toast(window.I18n.t("targetsMsg.loadError"), "error");
  });
