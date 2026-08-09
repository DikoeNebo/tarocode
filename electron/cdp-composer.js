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

function normalizeMode(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return "agent";
  if (/^plan\b|план/.test(s)) return "plan";
  if (/^ask\b|вопрос/.test(s)) return "ask";
  if (/^edit\b|редакт/.test(s)) return "edit";
  if (/^agent\b|агент/.test(s)) return "agent";
  if (s.includes("plan")) return "plan";
  if (s.includes("ask")) return "ask";
  if (s.includes("edit")) return "edit";
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
        .map((m) => ({
          id: String(m?.id || m?.label || "").trim(),
          label: String(m?.label || m?.id || "").trim(),
        }))
        .filter((m) => m.id)
    : [];

  const modes = Array.isArray(raw.modes) && raw.modes.length
    ? raw.modes.map((m) => ({
        id: normalizeMode(m?.id || m?.label),
        label: String(m?.label || m?.id || "").trim() || normalizeMode(m?.id),
      }))
    : [
        { id: "agent", label: "Agent" },
        { id: "plan", label: "Plan" },
      ];

  return {
    mode,
    modeLabel: modeLabel || mode,
    submitKind,
    submitLabel,
    modelLabel: String(raw.modelLabel || "").trim(),
    modelId: String(raw.modelId || raw.modelLabel || "").trim(),
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

module.exports = {
  classifySubmitLabel,
  normalizeMode,
  normalizeComposerChrome,
  normalizeClarifications,
  SUBMIT_BUTTON_SELECTOR,
};
