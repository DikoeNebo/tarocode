const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  findBestChat,
  pickCdpWindow,
  scoreChatMatch,
  transcriptFailHint,
  normalizeAgentStatus,
} = require("../electron/cdp-resolve");

describe("pickCdpWindow", () => {
  const a = { id: "aaa", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/aaa" };
  const b = { id: "bbb", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/bbb" };

  it("returns the stored window when still listed", () => {
    const r = pickCdpWindow([a, b], "bbb");
    assert.equal(r.reason, "exact");
    assert.equal(r.target.id, "bbb");
  });

  it("matches stored id inside the websocket url", () => {
    const r = pickCdpWindow(
      [{ id: "other", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/old-id" }],
      "old-id"
    );
    assert.equal(r.reason, "exact");
    assert.equal(r.target.id, "other");
  });

  it("heals to the only remaining window after Cursor restart", () => {
    const r = pickCdpWindow([b], "aaa");
    assert.equal(r.reason, "healed-single");
    assert.equal(r.target.id, "bbb");
  });

  it("does not guess when several windows remain", () => {
    const r = pickCdpWindow([a, b], "gone");
    assert.equal(r.reason, "stale");
    assert.equal(r.target, null);
  });
});

describe("findBestChat", () => {
  const chats = [
    { id: "p:keycode|a#0:Plan the fix", title: "Plan the fix", project: "keycode" },
    { id: "p:other|a#0:Plan the fix", title: "Plan the fix", project: "other" },
    { id: "p:keycode|a#1:Review", title: "Review", project: "keycode" },
  ];

  it("prefers same project + title when the sidebar index changed", () => {
    const m = findBestChat(chats, {
      chatId: "p:keycode|a#9:Plan the fix",
      chatTitle: "Plan the fix",
      projectName: "keycode",
    });
    assert.equal(m.project, "keycode");
    assert.equal(m.title, "Plan the fix");
  });

  it("does not pick a same-title chat from another project", () => {
    const n = scoreChatMatch(chats[1], {
      chatTitle: "Plan the fix",
      projectName: "keycode",
    });
    assert.equal(n, 0);
  });

  it("returns null when nothing is close", () => {
    assert.equal(findBestChat(chats, { chatTitle: "Unrelated", projectName: "keycode" }), null);
  });

  it("matches the same a#N slot after Cursor renames the chat", () => {
    const m = findBestChat(chats, {
      chatId: "p:keycode|a#1:старое длинное название чата",
      chatTitle: "старое длинное название чата",
      projectName: "keycode",
    });
    assert.equal(m.title, "Review");
    assert.equal(m.id, "p:keycode|a#1:Review");
  });

  it("does not use a#N from another project", () => {
    const m = findBestChat(
      [
        { id: "p:keycode|a#1:Review", title: "Review", project: "keycode" },
        { id: "p:other|a#0:Other zero", title: "Other zero", project: "other" },
      ],
      {
        chatId: "p:other|a#1:старое",
        chatTitle: "старое",
        projectName: "other",
      }
    );
    assert.equal(m, null);
  });
});

describe("transcriptFailHint", () => {
  it("does not call a missing window a closed CDP port", () => {
    assert.equal(
      transcriptFailHint("CDP: Cursor window not found"),
      "window_missing"
    );
    assert.equal(transcriptFailHint("chat_not_found"), "chat_missing");
    assert.equal(transcriptFailHint("ECONNREFUSED"), "cdp_closed");
    assert.equal(transcriptFailHint("CDP connect timeout"), "cdp_closed");
  });
});

describe("normalizeAgentStatus", () => {
  it("maps Cursor sidebar labels to stable ids", () => {
    assert.equal(normalizeAgentStatus("running"), "running");
    assert.equal(normalizeAgentStatus("needs-attention"), "needs-attention");
    assert.equal(normalizeAgentStatus("done_unseen"), "done-unseen");
    assert.equal(normalizeAgentStatus("done-seen"), "done-seen");
    assert.equal(normalizeAgentStatus("draft"), "draft");
    assert.equal(normalizeAgentStatus("generating"), "running");
    assert.equal(normalizeAgentStatus(""), "");
    assert.equal(normalizeAgentStatus("mystery"), "");
  });
});
