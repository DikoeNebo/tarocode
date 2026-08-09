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
    const c = normalizeComposerChrome({ modeLabel: "Plan", submitLabel: "" });
    assert.equal(c.mode, "plan");
    assert.equal(c.submitKind, "build");
    assert.equal(c.submitLabel, "Build");
    assert.ok(c.modes.some((m) => m.id === "agent"));
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
