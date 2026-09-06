/**
 * Pure helpers for Cursor composer chrome (mode / Send|Build / clarifications).
 * Keep Electron-free for node:test.
 */

function classifySubmitLabel(label) {
  const s = String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!s) return { kind: "unknown", label: "" };
  if (/\bbuild\b|собрать|сборка/.test(s)) {
    return { kind: "build", label: String(label || "").trim() };
  }
  if (/\bsend\b|отправ|submit|run\b|запуск/.test(s)) {
    return { kind: "send", label: String(label || "").trim() };
  }
  return { kind: "unknown", label: String(label || "").trim() };
}

/** Modes Cursor may expose in the composer mode menu. */
const DEFAULT_COMPOSER_MODES = [
  { id: "agent", label: "Agent" },
  { id: "plan", label: "Plan" },
  { id: "ask", label: "Ask" },
  { id: "debug", label: "Debug" },
];

function normalizeMode(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "agent";
  if (/^plan\b|план/.test(s)) return "plan";
  if (/^ask\b|вопрос/.test(s)) return "ask";
  if (/^edit\b|редакт|^manual\b|ручн/.test(s)) return "edit";
  if (/^debug\b|отлад/.test(s)) return "debug";
  if (/^agent\b|агент/.test(s)) return "agent";
  if (s.includes("plan")) return "plan";
  if (s.includes("ask")) return "ask";
  if (s.includes("edit") || s.includes("manual")) return "edit";
  if (s.includes("debug") || s.includes("отлад")) return "debug";
  return "agent";
}

/**
 * @param {object} raw
 * @returns {{
 *   mode: string,
 *   modeLabel: string,
 *   submitKind: 'send'|'build'|'unknown',
 *   submitLabel: string,
 *   modelLabel: string,
 *   modelId: string,
 *   models: Array<{id:string,label:string}>,
 *   generating: boolean,
 *   modes: Array<{id:string,label:string}>
 * }}
 */
function normalizeComposerChrome(raw = {}) {
  const modeLabel = String(raw.modeLabel || raw.mode || "").trim();
  const mode = normalizeMode(raw.mode || modeLabel);
  const submitRaw = classifySubmitLabel(raw.submitLabel || raw.submitKind);
  let submitKind = raw.submitKind;
  if (submitKind !== "send" && submitKind !== "build" && submitKind !== "unknown") {
    submitKind = submitRaw.kind;
  }
  if (submitKind === "unknown" && mode === "plan") {
    // Phone UX: Plan mode primary CTA reads as Build when DOM label missing.
    submitKind = "build";
  }
  if (submitKind === "unknown") submitKind = "send";

  const submitLabel =
    String(raw.submitLabel || "").trim() ||
    (submitKind === "build" ? "Build" : "Send");

  const models = Array.isArray(raw.models)
    ? raw.models
        .map((m) => {
          const testid = stripInvisible(m?.testid || "");
          let id = stripInvisible(m?.id || "");
          if (!id && testid.indexOf("model-item-") === 0) {
            id = testid.slice("model-item-".length);
          }
          if (!id) id = stripInvisible(m?.label || "");
          const label = stripInvisible(m?.label || m?.id || "") || id;
          const out = { id, label };
          if (testid) out.testid = testid;
          return out;
        })
        .filter((m) => m.id)
    : [];

  const modes = DEFAULT_COMPOSER_MODES.map((m) => ({ ...m }));
  // Overlay discovered labels when Cursor exposes a subset — keep full list.
  if (Array.isArray(raw.modes) && raw.modes.length) {
    for (const m of raw.modes) {
      const id = normalizeMode(m?.id || m?.label);
      const label = String(m?.label || m?.id || "").trim();
      const slot = modes.find((x) => x.id === id);
      if (slot && label) slot.label = label;
    }
  }

  const modelLabel = stripInvisible(raw.modelLabel || "");
  let modelId = stripInvisible(raw.modelId || "");
  // Cursor trigger shows a display label ("Composer 2.5 Fast"); map back to
  // stable menu id ("composer-2.5") when the models list is known.
  if (models.length) {
    const needle = modelId || modelLabel;
    const matched = models.find((m) =>
      modelLabelLooksApplied(needle, m) ||
      (needle &&
        (String(m.id).toLowerCase() === needle.toLowerCase() ||
          String(m.label).toLowerCase() === needle.toLowerCase()))
    );
    if (matched?.id) modelId = matched.id;
  }
  if (!modelId) modelId = modelLabel;

  return {
    mode,
    modeLabel: modeLabel || mode,
    submitKind,
    submitLabel,
    modelLabel,
    modelId,
    models,
    generating: raw.generating === true,
    modes,
  };
}

/**
 * @param {unknown} list
 * @returns {Array<{id:string,prompt:string,options:Array<{id:string,label:string}>}>}
 */
function normalizeClarifications(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const prompt = String(item.prompt || item.question || item.text || "").trim();
    if (!prompt) continue;
    const options = Array.isArray(item.options)
      ? item.options
          .map((o, j) => ({
            id: String(o?.id || `opt-${j}`).trim(),
            label: String(o?.label || o?.text || o || "").trim(),
          }))
          .filter((o) => o.label)
      : [];
    out.push({
      id: String(item.id || `q-${i}`).trim(),
      prompt,
      options,
    });
    if (out.length >= 8) break;
  }
  return out;
}

/** Shared CSS selector string for primary submit in Cursor composer. */
const SUBMIT_BUTTON_SELECTOR =
  'button[aria-label="Send"], button[aria-label*="Send" i], button[aria-label="Build"], button[aria-label*="Build" i], button[data-testid*="send" i], button[data-testid*="build" i], .send-with-mode, [class*="send-with-mode"] button, form button[type="submit"]';

/**
 * Composer shell around the prompt — avoid bare [class*="prompt"] / [class*="prompt-input"]
 * which match the inner editor (Cursor ui-prompt-input-editor) and miss the toolbar.
 */
const COMPOSER_ROOT_SELECTOR =
  '[data-composer-id], .ui-prompt-input, .agent-prompt-input-root, [class*="composer-bar"], [class*="aislash"], [class*="ai-input"], form';

/** Model dropdown trigger in current Cursor prompt toolbar. */
const MODEL_PICKER_SELECTOR = "button.ui-model-picker__trigger";

/**
 * Pick the model trigger for the active (on-screen) composer.
 * Cursor keeps triggers for other chats off-screen; .find(visible) hits those first.
 * Injectable into CDP evaluate (no template literals).
 */
function pickActiveModelTrigger(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const vh = window.innerHeight || 800;
  const scored = [];
  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    if (!el) continue;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue;
    }
    const onScreen = rect.top >= -8 && rect.top < vh && rect.bottom > 0;
    scored.push({ el: el, top: rect.top, onScreen: onScreen });
  }
  if (!scored.length) return null;
  const pool = scored.filter(function (s) {
    return s.onScreen;
  });
  const use = pool.length ? pool : scored;
  // Active composer sits near the bottom of the window.
  use.sort(function (a, b) {
    return b.top - a.top;
  });
  return use[0].el;
}

/** Rows in the model menu — Auto toggle + real models. Skip nested Edit/MAX buttons. */
const MODEL_MENU_ITEM_SELECTOR =
  '[data-testid="auto-mode-toggle"], [data-testid^="model-item-"]';

/**
 * Realistic pointer+mouse click for Cursor menu rows. Plain el.click() does not
 * toggle the Auto switch (pointer-events:none on the knob). Keep free of
 * template literals so it can be injected into CDP evaluate strings.
 * @param {Element|null} el
 * @param {{xRatio?: number}} [opts] — 0..1 across width; Auto toggle sits on the right
 */
function pointerClick(el, opts) {
  if (!el) return false;
  opts = opts || {};
  const ratio = typeof opts.xRatio === "number" ? opts.xRatio : 0.5;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) {
    try {
      el.click();
      return true;
    } catch (e) {
      return false;
    }
  }
  const x = r.left + Math.min(r.width - 2, Math.max(2, r.width * ratio));
  const y = r.top + r.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    button: 0,
  };
  try {
    el.dispatchEvent(
      new PointerEvent("pointerdown", Object.assign({}, base, { pointerId: 1, pointerType: "mouse" }))
    );
    el.dispatchEvent(
      new PointerEvent("pointerup", Object.assign({}, base, { pointerId: 1, pointerType: "mouse" }))
    );
    el.dispatchEvent(new MouseEvent("mousedown", base));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    el.dispatchEvent(new MouseEvent("click", base));
    return true;
  } catch (e) {
    try {
      el.click();
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/**
 * Toggle Cursor's Auto model row. The inner switch has pointer-events:none;
 * synthetic mouse clicks on the row are ignored — Space on the switch works.
 * Injectable into CDP evaluate (no template literals).
 */
function toggleAutoModeRow(autoEl) {
  if (!autoEl) return false;
  const sw = autoEl.querySelector('[role="switch"]') || autoEl;
  const wasOn = function (el) {
    if (!el) return false;
    if (el.getAttribute("aria-checked") === "true") return true;
    const inner = el.querySelector('[role="switch"]');
    return !!(inner && inner.getAttribute("aria-checked") === "true");
  };
  const before = wasOn(autoEl);
  try {
    if (typeof sw.focus === "function") sw.focus();
  } catch (e) {
    /* ignore */
  }
  const fireKey = function (el, key, code, keyCode) {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: key,
        code: code,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
      })
    );
    el.dispatchEvent(
      new KeyboardEvent("keyup", {
        key: key,
        code: code,
        keyCode: keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
      })
    );
  };
  fireKey(sw, " ", "Space", 32);
  if (wasOn(autoEl) === before) {
    const right = autoEl.querySelector(".ui-menu__item-right");
    if (right) pointerClick(right, { xRatio: 0.5 });
  }
  return wasOn(autoEl) !== before;
}

/**
 * Activate a Cursor menu row (model or mode). Synthetic pointer/click is ignored;
 * focus + Enter selects the row. Injectable (no template literals).
 */
function activateMenuItem(el) {
  if (!el) return false;
  try {
    if (typeof el.focus === "function") el.focus();
  } catch (e) {
    /* ignore */
  }
  el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    })
  );
  el.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    })
  );
  return true;
}

/** @deprecated use activateMenuItem */
function activateModelMenuItem(el) {
  return activateMenuItem(el);
}

/** Strip zero-width / BOM chars Cursor puts in model labels. */
function stripInvisible(raw) {
  return String(raw || "")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAutoModelLabel(raw) {
  const s = String(raw || "")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return /^(auto|авто)$/i.test(s);
}

/**
 * Parse one Cursor model-menu row. Keep this free of template literals so it can
 * be injected into CDP evaluate strings.
 * Stable id comes from data-testid (model-item-composer-2.5 → composer-2.5).
 * @param {{testid?: string, name?: string, title?: string, text?: string}} raw
 * @returns {{id:string,label:string,kind:'auto'|'model',testid?:string}|null}
 */
function modelMenuChoice(raw) {
  raw = raw || {};
  const testid = String(raw.testid || "").trim();
  const strip = function (s) {
    return String(s || "")
      .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  };
  const name = strip(raw.name);
  const title = strip(raw.title);
  const text = strip(raw.text);
  if (testid === "max-mode-toggle") return null;
  if (testid === "auto-mode-toggle") {
    return {
      id: "Auto",
      label: title || name || "Auto",
      kind: "auto",
      testid: testid,
    };
  }
  if (testid.indexOf("model-item-") === 0) {
    const slug = testid.slice("model-item-".length);
    const label = name || title || text || slug;
    if (!slug && !label) return null;
    return {
      id: slug || label,
      label: label,
      kind: "model",
      testid: testid,
    };
  }
  const label = name || title;
  if (isAutoModelLabel(label)) {
    return { id: "Auto", label: label, kind: "auto" };
  }
  return null;
}

/**
 * Whether a model pick request matches a menu choice (stable id / testid / label).
 * Injectable into CDP evaluate (no template literals).
 */
function modelChoiceMatches(want, choice) {
  if (!choice) return false;
  const strip = function (s) {
    return String(s || "")
      .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };
  const w = strip(want);
  if (!w) return false;
  const id = strip(choice.id);
  const label = strip(choice.label);
  const testid = strip(choice.testid || "");
  if (w === "auto" || w === "авто") {
    return choice.kind === "auto" || id === "auto" || label === "auto" || label === "авто";
  }
  if (id && (id === w || id === w.replace(/^model-item-/, ""))) return true;
  if (testid && (testid === w || testid === "model-item-" + w || testid.replace(/^model-item-/, "") === w)) {
    return true;
  }
  if (label && (label === w || label.indexOf(w) >= 0 || w.indexOf(label) >= 0)) return true;
  return false;
}

/**
 * Whether the composer model trigger label reflects the chosen model.
 * Injectable into CDP evaluate (no template literals).
 */
function modelLabelLooksApplied(currentLabel, choice) {
  const strip = function (s) {
    return String(s || "")
      .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  };
  const cur = strip(currentLabel);
  if (!choice) return false;
  if (choice.kind === "auto" || strip(choice.id) === "auto") {
    return cur === "auto" || cur === "авто" || cur.indexOf("auto") === 0;
  }
  const label = strip(choice.label);
  const id = strip(choice.id).replace(/-/g, " ");
  if (!cur) return false;
  if (label && (cur === label || cur.indexOf(label) >= 0 || label.indexOf(cur) >= 0)) {
    return true;
  }
  // "composer-2.5" vs "Composer 2.5 Fast"
  if (id && cur.replace(/-/g, " ").indexOf(id) >= 0) return true;
  const tokens = id.split(/\s+/).filter(function (t) {
    return t.length > 1 && !/^\d+$/.test(t);
  });
  if (tokens.length >= 2) {
    return tokens.every(function (t) {
      return cur.indexOf(t) >= 0;
    });
  }
  return false;
}

/**
 * Whether the composer mode chip reflects the requested mode.
 * Agent = no chip. Injectable (no template literals).
 */
function modeLooksApplied(want, chipLabel) {
  const w = String(want || "")
    .trim()
    .toLowerCase();
  const chip = String(chipLabel || "")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (w === "agent") return !chip;
  if (!chip) return false;
  if (w === "plan") return /\bplan\b|план/.test(chip);
  if (w === "ask") return /\bask\b|вопрос/.test(chip) && !/\bagent\b/.test(chip);
  if (w === "edit") return /\bedit\b|\bmanual\b|редакт|ручн/.test(chip);
  if (w === "debug") return /\bdebug\b|отлад/.test(chip);
  return false;
}

/**
 * Whether a menu row label matches the requested mode id.
 * Injectable (no template literals).
 */
function modeMenuLabelMatches(want, label) {
  const w = String(want || "")
    .trim()
    .toLowerCase();
  const t = String(label || "")
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!w || !t) return false;
  // Cursor + menu rows are short ("Plan", "Ask", "Debug"). Reject long chat titles.
  const first = t.split("\n")[0].trim();
  if (!first || first.length > 24) return false;
  if (w === "plan") return /^(plan|план)\b/.test(first);
  if (w === "ask") return /^(ask|вопрос)\b/.test(first);
  if (w === "edit") return /^(edit|manual|редакт|ручн)/.test(first);
  if (w === "debug") return /^(debug|отлад)/.test(first);
  if (w === "agent") return /^(agent|агент)\b/.test(first);
  return false;
}

module.exports = {
  classifySubmitLabel,
  normalizeMode,
  normalizeComposerChrome,
  normalizeClarifications,
  stripInvisible,
  isAutoModelLabel,
  modelMenuChoice,
  modelChoiceMatches,
  modelLabelLooksApplied,
  pointerClick,
  toggleAutoModeRow,
  activateMenuItem,
  activateModelMenuItem,
  pickActiveModelTrigger,
  modeLooksApplied,
  modeMenuLabelMatches,
  DEFAULT_COMPOSER_MODES,
  SUBMIT_BUTTON_SELECTOR,
  COMPOSER_ROOT_SELECTOR,
  MODEL_PICKER_SELECTOR,
  MODEL_MENU_ITEM_SELECTOR,
};
