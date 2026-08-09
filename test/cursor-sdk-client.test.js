const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const {
  createCursorSdkClient,
  SDK_LIVE_CHAT_ID,
  normalizeSdkMessages,
  extractMessageText,
} = require("../electron/cursor-sdk-client");
const { SETTINGS_WHITELIST, pickSettingsPartial } = require("../electron/data-store");

describe("cursor sdk client helpers", () => {
  it("extracts nested text blocks", () => {
    assert.equal(extractMessageText("hi"), "hi");
    assert.equal(
      extractMessageText({ content: [{ type: "text", text: "a" }, { text: "b" }] }),
      "a\nb"
    );
  });

  it("normalizes message roles", () => {
    const msgs = normalizeSdkMessages([
      { type: "user", uuid: "1", message: { text: "Q" } },
      { type: "assistant", uuid: "2", content: "A" },
    ]);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, "user");
    assert.equal(msgs[1].role, "assistant");
    assert.equal(msgs[0].text, "Q");
  });

  it("lists synthetic SDK chat", () => {
    const client = createCursorSdkClient({
      Agent: {},
      Cursor: {},
    });
    const list = client.listSyntheticChats("SDK agent");
    assert.equal(list.ok, true);
    assert.equal(list.chats.length, 1);
    assert.equal(list.chats[0].id, SDK_LIVE_CHAT_ID);
    assert.equal(list.backend, "sdk");
  });

  it("send uses mock Agent create/send/wait", async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-sdk-"));
    const calls = [];
    const fakeAgent = {
      agentId: "agent-test-1",
      send: async (text) => {
        calls.push(["send", text]);
        return {
          wait: async () => ({ status: "finished", id: "run-1" }),
        };
      },
      close() {},
    };
    const Agent = {
      create: async (opts) => {
        calls.push(["create", opts.local?.cwd, !!opts.apiKey]);
        return fakeAgent;
      },
      resume: async () => fakeAgent,
      messages: {
        list: async () => [
          { type: "user", uuid: "u1", message: { text: "hello" } },
          { type: "assistant", uuid: "a1", message: { text: "world" } },
        ],
      },
    };
    const client = createCursorSdkClient({ Agent, Cursor: { me: async () => ({}) } });
    const r = await client.send("hello", {
      apiKey: "test-key-not-real",
      cwd,
      agentId: "",
      modelId: "composer-2.5",
    });
    assert.equal(r.ok, true);
    assert.equal(r.agentId, "agent-test-1");
    assert.equal(calls[0][0], "create");
    assert.equal(calls[1][0], "send");
    const tr = await client.readTranscript({
      apiKey: "test-key-not-real",
      cwd,
      agentId: "agent-test-1",
    });
    assert.equal(tr.ok, true);
    assert.equal(tr.messages.length, 2);
    assert.match(tr.hash, /^[a-f0-9]+$/);
  });

  it("rejects missing key/cwd without calling SDK", async () => {
    const client = createCursorSdkClient({
      Agent: {
        create: async () => {
          throw new Error("should not create");
        },
      },
      Cursor: {},
    });
    const r = await client.send("x", { apiKey: "", cwd: "" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "sdk_need_key");
  });
});

describe("cursor backend settings whitelist", () => {
  it("includes SDK A/B keys", () => {
    assert.ok(SETTINGS_WHITELIST.includes("cursorBackend"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorApiKey"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorSdkCwd"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorSdkAgentId"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorSdkModel"));
    const p = pickSettingsPartial({
      cursorBackend: "sdk",
      cursorApiKey: "secret",
      cursorSdkCwd: "D:\\proj",
      hacker: 1,
    });
    assert.equal(p.cursorBackend, "sdk");
    assert.equal(p.cursorApiKey, "secret");
    assert.equal(p.hacker, undefined);
  });
});
