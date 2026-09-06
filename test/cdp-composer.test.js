const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifySubmitLabel,
  normalizeMode,
  normalizeComposerChrome,
  normalizeClarifications,
} = require("../electron/cdp-composer");

describe("cdp-composer helpers", () => {
  it("classifies Send vs Build labels", () => {
    assert.equal(classifySubmitLabel("Send").kind, "send");
    assert.equal(classifySubmitLabel("Build").kind, "build");
    assert.equal(classifySubmitLabel("Отправить").kind, "send");
  });

  it("normalizes mode strings", () => {
    assert.equal(normalizeMode("Plan"), "plan");
    assert.equal(normalizeMode("agent"), "agent");
    assert.equal(normalizeMode("Ask mode"), "ask");
  });

  it("fills defaults for composer chrome", () => {
    const c = normalizeComposerChrome({
      modeLabel: "Plan",
      submitLabel: "",
      modelLabel: "Auto",
      models: [
        { id: "auto", label: "Auto" },
        { label: "Claude Sonnet 4" },
      ],
      modes: [
        { id: "agent", label: "Agent" },
        { id: "plan", label: "Plan" },
      ],
    });
    assert.equal(c.mode, "plan");
    assert.equal(c.submitKind, "build");
    assert.equal(c.submitLabel, "Build");
    assert.equal(c.modelLabel, "Auto");
    assert.deepEqual(c.models, [
      { id: "auto", label: "Auto" },
      { id: "Claude Sonnet 4", label: "Claude Sonnet 4" },
    ]);
    assert.equal(c.modes.length, 4);
    assert.ok(c.modes.some((m) => m.id === "ask"));
    assert.ok(c.modes.some((m) => m.id === "debug"));
    assert.ok(!c.modes.some((m) => m.id === "edit"));
  });

  it("maps Manual to edit mode", () => {
    assert.equal(normalizeMode("Manual"), "edit");
  });

  it("remaps display model labels to stable ids when models are listed", () => {
    const c = normalizeComposerChrome({
      modelLabel: "Composer 2.5 Fast",
      modelId: "Composer 2.5 Fast",
      models: [
        { id: "Auto", label: "Auto" },
        { id: "composer-2.5", label: "Composer 2.5 Fast" },
        { id: "gpt-5.6-sol", label: "GPT-5.6 Sol Medium" },
      ],
    });
    assert.equal(c.modelId, "composer-2.5");
    assert.equal(c.modelLabel, "Composer 2.5 Fast");
  });

  it("strips invisible chars from model labels", () => {
    const { stripInvisible, normalizeComposerChrome } = require("../electron/cdp-composer");
    assert.equal(stripInvisible("Auto\u200b"), "Auto");
    const c = normalizeComposerChrome({
      modelLabel: "Composer 2.5\u2060 Fast",
      models: [{ id: "x\u200b", label: "X\u200b" }],
    });
    assert.equal(c.modelLabel, "Composer 2.5 Fast");
    assert.equal(c.models[0].id, "x");
  });

  it("parses Cursor model menu rows including Auto and named models", () => {
    const {
      isAutoModelLabel,
      modelMenuChoice,
      modelChoiceMatches,
      modelLabelLooksApplied,
    } = require("../electron/cdp-composer");
    assert.equal(isAutoModelLabel("Auto"), true);
    assert.equal(isAutoModelLabel("Авто"), true);
    assert.equal(isAutoModelLabel("Composer 2.5"), false);
    const auto = modelMenuChoice({ testid: "auto-mode-toggle", title: "Auto" });
    assert.equal(auto.id, "Auto");
    assert.equal(auto.label, "Auto");
    assert.equal(auto.kind, "auto");
    assert.equal(auto.testid, "auto-mode-toggle");
    assert.equal(
      modelMenuChoice({ testid: "max-mode-toggle", text: "MAX Mode" }),
      null
    );
    const grok = modelMenuChoice({
      testid: "model-item-grok-4.6",
      name: "Cursor Grok 4.6 High Fast",
    });
    assert.equal(grok.kind, "model");
    assert.equal(grok.id, "grok-4.6");
    assert.equal(grok.label, "Cursor Grok 4.6 High Fast");
    assert.equal(
      modelMenuChoice({ testid: "", name: "Add Models", text: "Add Models" }),
      null
    );
    assert.equal(modelChoiceMatches("grok-4.6", grok), true);
    assert.equal(modelChoiceMatches("model-item-grok-4.6", grok), true);
    assert.equal(modelChoiceMatches("Cursor Grok 4.6 High Fast", grok), true);
    assert.equal(modelChoiceMatches("composer-2.5", grok), false);
    assert.equal(
      modelLabelLooksApplied("Cursor Grok 4.6 High Fast", grok),
      true
    );
    assert.equal(modelLabelLooksApplied("Auto", grok), false);
    assert.equal(
      modelLabelLooksApplied("Auto", { id: "Auto", label: "Auto", kind: "auto" }),
      true
    );
    assert.equal(
      modelLabelLooksApplied("Composer 2.5 Fast", {
        id: "composer-2.5",
        label: "Composer 2.5",
        kind: "model",
      }),
      true
    );
    const fromTestid = normalizeComposerChrome({
      models: [{ testid: "model-item-composer-2.5", label: "Composer 2.5 Fast" }],
    });
    assert.equal(fromTestid.models[0].id, "composer-2.5");
    assert.equal(fromTestid.models[0].label, "Composer 2.5 Fast");
  });

  it("matches composer mode chips and menu labels", () => {
    const { modeLooksApplied, modeMenuLabelMatches } = require("../electron/cdp-composer");
    assert.equal(modeLooksApplied("agent", ""), true);
    assert.equal(modeLooksApplied("agent", "Plan"), false);
    assert.equal(modeLooksApplied("plan", "Plan"), true);
    assert.equal(modeLooksApplied("ask", "Ask"), true);
    assert.equal(modeLooksApplied("debug", "Debug"), true);
    assert.equal(modeMenuLabelMatches("plan", "Plan"), true);
    assert.equal(modeMenuLabelMatches("ask", "Ask"), true);
    assert.equal(modeMenuLabelMatches("debug", "Debug"), true);
    assert.equal(modeMenuLabelMatches("plan", "Ask"), false);
    assert.equal(modeMenuLabelMatches("plan", "Work plan and checklist"), false);
    assert.equal(modeMenuLabelMatches("ask", "Вопрос о месте"), false);
  });

  it("exports pointerClick helper for Cursor Auto toggle", () => {
    const {
      pointerClick,
      toggleAutoModeRow,
      activateMenuItem,
      activateModelMenuItem,
    } = require("../electron/cdp-composer");
    assert.equal(typeof pointerClick, "function");
    assert.match(pointerClick.toString(), /PointerEvent/);
    assert.match(pointerClick.toString(), /xRatio/);
    assert.equal(typeof toggleAutoModeRow, "function");
    assert.match(toggleAutoModeRow.toString(), /Space/);
    assert.match(toggleAutoModeRow.toString(), /role="switch"/);
    assert.equal(typeof activateMenuItem, "function");
    assert.match(activateMenuItem.toString(), /Enter/);
    assert.match(activateMenuItem.toString(), /focus/);
    assert.equal(typeof activateModelMenuItem, "function");
  });

  it("exports composer root selectors that avoid bare prompt class", () => {
    const {
      COMPOSER_ROOT_SELECTOR,
      MODEL_PICKER_SELECTOR,
    } = require("../electron/cdp-composer");
    assert.match(COMPOSER_ROOT_SELECTOR, /\.ui-prompt-input/);
    assert.match(COMPOSER_ROOT_SELECTOR, /agent-prompt-input-root/);
    assert.doesNotMatch(COMPOSER_ROOT_SELECTOR, /\[class\*="prompt"/);
    assert.doesNotMatch(COMPOSER_ROOT_SELECTOR, /\[class\*="prompt-input"\]/);
    assert.match(MODEL_PICKER_SELECTOR, /ui-model-picker__trigger/);
    assert.match(MODEL_PICKER_SELECTOR, /^button/);
  });

  it("picks the on-screen model trigger over off-screen ones", () => {
    const { pickActiveModelTrigger } = require("../electron/cdp-composer");
    assert.equal(typeof pickActiveModelTrigger, "function");
    assert.match(pickActiveModelTrigger.toString(), /onScreen/);
    assert.match(pickActiveModelTrigger.toString(), /innerHeight/);
  });

  it("normalizes clarifications with options", () => {
    const list = normalizeClarifications([
      {
        id: "q1",
        prompt: "Which approach?",
        options: [{ id: "a", label: "A" }, { label: "B" }],
      },
      { prompt: "" },
    ]);
    assert.equal(list.length, 1);
    assert.equal(list[0].options.length, 2);
    assert.equal(list[0].options[1].label, "B");
  });
});
