const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeSdkProjects,
  migrateSdkProjects,
  MAX_SDK_PROJECTS,
  MAX_SDK_CHATS_PER_PROJECT,
  SETTINGS_WHITELIST,
  pickSettingsPartial,
} = require("../electron/data-store");

describe("sdk projects", () => {
  it("normalizes and drops empty cwd", () => {
    const list = normalizeSdkProjects([
      { id: "a", name: "One", cwd: "D:\\one" },
      { id: "b", name: "No", cwd: "" },
      { name: "Two", cwd: "D:\\two" },
    ]);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, "a");
    assert.ok(list[1].id);
    assert.equal(list[1].cwd, "D:\\two");
    assert.ok(Array.isArray(list[0].chats));
    assert.equal(list[0].chats.length, 1);
    assert.ok(list[0].activeChatId);
  });

  it("migrates legacy cursorSdkCwd into project + chat", () => {
    const m = migrateSdkProjects({
      cursorSdkCwd: "D:\\keycode",
      cursorSdkAgentId: "agent-1",
      sdkProjects: [],
    });
    assert.equal(m.changed, true);
    assert.equal(m.projects.length, 1);
    assert.equal(m.projects[0].cwd, "D:\\keycode");
    assert.equal(m.projects[0].chats[0].agentId, "agent-1");
    assert.equal(m.projects[0].agentId, "agent-1");
    assert.equal(m.activeSdkProjectId, m.projects[0].id);
  });

  it("migrates project-level agentId into chats[]", () => {
    const list = normalizeSdkProjects([
      { id: "a", name: "One", cwd: "D:\\one", agentId: "old-agent" },
    ]);
    assert.equal(list[0].chats.length, 1);
    assert.equal(list[0].chats[0].agentId, "old-agent");
    assert.equal(list[0].agentId, "old-agent");
  });

  it("keeps multiple chats under one project", () => {
    const list = normalizeSdkProjects([
      {
        id: "a",
        name: "One",
        cwd: "D:\\one",
        activeChatId: "c2",
        chats: [
          { id: "c1", name: "Main", agentId: "a1" },
          { id: "c2", name: "Plan", agentId: "a2" },
        ],
      },
    ]);
    assert.equal(list[0].chats.length, 2);
    assert.equal(list[0].activeChatId, "c2");
    assert.equal(list[0].agentId, "a2");
  });

  it("whitelists sdkProjects keys", () => {
    assert.ok(SETTINGS_WHITELIST.includes("sdkProjects"));
    assert.ok(SETTINGS_WHITELIST.includes("activeSdkProjectId"));
    const p = pickSettingsPartial({
      sdkProjects: [{ id: "x", name: "X", cwd: "C:\\x" }],
      activeSdkProjectId: "x",
    });
    assert.equal(p.activeSdkProjectId, "x");
    assert.equal(p.sdkProjects.length, 1);
  });

  it("caps project and chat counts", () => {
    const many = Array.from({ length: MAX_SDK_PROJECTS + 5 }, (_, i) => ({
      id: `p${i}`,
      name: `P${i}`,
      cwd: `D:\\p${i}`,
    }));
    assert.equal(normalizeSdkProjects(many).length, MAX_SDK_PROJECTS);

    const chats = Array.from(
      { length: MAX_SDK_CHATS_PER_PROJECT + 3 },
      (_, i) => ({ id: `c${i}`, name: `C${i}`, agentId: "" })
    );
    const one = normalizeSdkProjects([
      { id: "a", name: "A", cwd: "D:\\a", chats },
    ]);
    assert.equal(one[0].chats.length, MAX_SDK_CHATS_PER_PROJECT);
  });

  it("SDK UI flag defaults off", () => {
    const { isCursorSdkEnabled } = require("../electron/data-store");
    const prev = process.env.KEYCODE_ENABLE_SDK;
    delete process.env.KEYCODE_ENABLE_SDK;
    assert.equal(isCursorSdkEnabled(), false);
    process.env.KEYCODE_ENABLE_SDK = "1";
    assert.equal(isCursorSdkEnabled(), true);
    if (prev === undefined) delete process.env.KEYCODE_ENABLE_SDK;
    else process.env.KEYCODE_ENABLE_SDK = prev;
  });
});
