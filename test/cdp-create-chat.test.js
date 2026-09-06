const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCreateChatRequest,
  createdChatSelectionPatch,
} = require("../electron/cdp-client");

describe("normalizeCreateChatRequest", () => {
  it("rejects empty project name", () => {
    const r = normalizeCreateChatRequest({
      cdpTargetId: "tgt-1",
      projectName: "  ",
    });
    assert.equal(r.ok, false);
    assert.equal(r.hint, "project_required");
  });

  it("rejects missing cdp target", () => {
    const r = normalizeCreateChatRequest({ projectName: "keycode" });
    assert.equal(r.ok, false);
    assert.equal(r.hint, "cdp_target_required");
  });

  it("accepts project alias and trims", () => {
    const r = normalizeCreateChatRequest({
      id: " win-a ",
      project: " keycode ",
    });
    assert.equal(r.ok, true);
    assert.equal(r.cdpTargetId, "win-a");
    assert.equal(r.projectName, "keycode");
  });

  it("selects a newly created target in solo mode", () => {
    assert.deepEqual(
      createdChatSelectionPatch({ target: { id: " tgt-new " } }),
      {
        pasteMode: "solo",
        activePresetId: "",
        activeTargetId: "tgt-new",
      }
    );
    assert.equal(createdChatSelectionPatch({}), null);
  });
});
