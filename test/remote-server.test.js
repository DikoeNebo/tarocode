const { describe, it, before, after } = require("node:test");
const assert = require("assert/strict");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  createRemoteServer,
  generateRemoteToken,
  timingSafeEqualStr,
  extractBearer,
  hasTailscaleIdentity,
  safeJoin,
  MAX_BODY,
  HOST,
  BIND_LAN,
  BIND_LOOPBACK,
  normalizeAccessMode,
  bindHostForMode,
  generationTransition,
} = require("../electron/remote-server");
const {
  normalizeTranscriptMessages,
  hashTranscript,
  dedupeTranscriptMessages,
  stripAgentUiChrome,
  isUiChromeMessage,
} = require("../electron/cdp-transcript");
const { SETTINGS_WHITELIST, DEFAULT_REMOTE_PORT } = require("../electron/data-store");

/** Node http.request helper — connect via loopback even when server binds 0.0.0.0 */
function req(port, method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: HOST,
        port,
        path: urlPath,
        method,
        headers: {
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

describe("remote settings whitelist", () => {
  it("includes remote keys and default port", () => {
    assert.ok(SETTINGS_WHITELIST.includes("remoteEnabled"));
    assert.ok(SETTINGS_WHITELIST.includes("remotePort"));
    assert.ok(SETTINGS_WHITELIST.includes("remoteToken"));
    assert.ok(SETTINGS_WHITELIST.includes("remoteAccessMode"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorBackend"));
    assert.ok(SETTINGS_WHITELIST.includes("cursorApiKey"));
    assert.equal(DEFAULT_REMOTE_PORT, 17865);
  });
});

describe("remote access mode helpers", () => {
  it("defaults to lan and binds 0.0.0.0", () => {
    assert.equal(normalizeAccessMode(undefined), "lan");
    assert.equal(normalizeAccessMode("LAN"), "lan");
    assert.equal(normalizeAccessMode("tailscale"), "tailscale");
    assert.equal(bindHostForMode("lan"), BIND_LAN);
    assert.equal(bindHostForMode("tailscale"), BIND_LOOPBACK);
    assert.equal(BIND_LAN, "0.0.0.0");
  });
});

describe("remote task completion transition", () => {
  it("does not complete on the first snapshot", () => {
    assert.deepEqual(generationTransition(undefined, false), {
      next: false,
      changed: false,
      completed: false,
    });
    assert.deepEqual(generationTransition(undefined, true), {
      next: true,
      changed: false,
      completed: false,
    });
  });

  it("completes exactly on generating true to false", () => {
    assert.deepEqual(generationTransition(false, true), {
      next: true,
      changed: true,
      completed: false,
    });
    assert.deepEqual(generationTransition(true, false), {
      next: false,
      changed: true,
      completed: true,
    });
    assert.deepEqual(generationTransition(false, false), {
      next: false,
      changed: false,
      completed: false,
    });
  });

  it("ignores unknown activity instead of reporting completion", () => {
    assert.deepEqual(generationTransition(true, undefined), {
      next: true,
      changed: false,
      completed: false,
    });
  });
});

describe("remote listen port", () => {
  it("treats port 0 as ephemeral (not default 17865)", async () => {
    const token = generateRemoteToken();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-ephem-"));
    const srv = createRemoteServer({
      getToken: () => token,
      getPort: () => 0,
      getAccessMode: () => "lan",
      getRemoteState: () => ({ cards: [], targets: [], deck: { id: "x", name: "x" } }),
      readChat: async () => ({ ok: true, messages: [], hash: "" }),
      pasteCard: async () => ({ ok: true }),
      staticDir: tmp,
      tarotDir: tmp,
    });
    try {
      const started = await srv.start(0);
      assert.notEqual(started.port, 0);
      assert.notEqual(started.port, DEFAULT_REMOTE_PORT);
      assert.ok(started.port > 0);
      assert.equal(started.host, BIND_LAN);
    } finally {
      await srv.stop();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe("cdp transcript helpers", () => {
  it("normalizes roles, truncates, and hashes", () => {
    const msgs = normalizeTranscriptMessages([
      { role: "user", text: "  hello   world  " },
      { role: "bot", text: "answer" },
      { role: "user", text: "" },
    ]);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].text, "hello world");
    assert.equal(msgs[1].role, "assistant");
    const h1 = hashTranscript(msgs);
    const h2 = hashTranscript(msgs);
    assert.equal(h1, h2);
    assert.notEqual(h1, hashTranscript([{ role: "user", text: "other" }]));
  });

  it("keeps paragraph breaks readable", () => {
    const msgs = normalizeTranscriptMessages([
      { role: "assistant", text: "line one\n\nline two\nline three" },
    ]);
    assert.equal(msgs[0].text, "line one\n\nline two\nline three");
  });

  it("dedupes identical consecutive messages", () => {
    const d = dedupeTranscriptMessages([
      { role: "assistant", text: "long answer here" },
      { role: "assistant", text: "long answer here" },
      { role: "user", text: "ok" },
    ]);
    assert.equal(d.length, 2);
  });

  it("strips Thought / tool chrome from assistant text", () => {
    const raw = [
      "Агент",
      "Thought",
      "for 12s",
      "Агент",
      "Сделаю очистку поля после отправки.",
      "Агент",
      "Read",
      "remote.js L380-479",
      "Edited",
      "AGENTS.md",
      "+4",
      "-3",
    ].join("\n");
    const cleaned = stripAgentUiChrome(raw);
    assert.match(cleaned, /Сделаю очистку/);
    assert.doesNotMatch(cleaned, /Thought/);
    assert.doesNotMatch(cleaned, /\bRead\b/);
    assert.doesNotMatch(cleaned, /remote\.js/);
    assert.equal(isUiChromeMessage("Read\nremote.js L1-2"), true);
    const msgs = normalizeTranscriptMessages([{ role: "assistant", text: raw }]);
    assert.equal(msgs.length, 1);
    assert.match(msgs[0].text, /Сделаю очистку/);
  });

  it("dedupes nested partial copies of the same reply", () => {
    const d = dedupeTranscriptMessages([
      { role: "assistant", text: "Hello world this is a long reply about cats" },
      { role: "assistant", text: "Hello world this is a long reply about cats" },
      { role: "assistant", text: "Hello world" },
      { role: "user", text: "thanks" },
    ]);
    assert.equal(d.length, 2);
    assert.match(d[0].text, /cats/);
    assert.equal(d[1].text, "thanks");
  });

  it("respects maxChars", () => {
    const big = "x".repeat(800);
    const msgs = normalizeTranscriptMessages(
      [
        { role: "user", text: big },
        { role: "assistant", text: big },
        { role: "user", text: big },
      ],
      { maxChars: 600 }
    );
    assert.ok(msgs.length >= 1);
    const total = msgs.reduce((n, m) => n + m.text.length, 0);
    assert.ok(total <= 620);
    assert.ok(msgs.length < 3);
  });
});

describe("remote auth helpers", () => {
  it("timing-safe compare", () => {
    const t = generateRemoteToken();
    assert.equal(timingSafeEqualStr(t, t), true);
    assert.equal(timingSafeEqualStr(t, t + "x"), false);
  });

  it("extracts bearer / header", () => {
    assert.equal(
      extractBearer({ headers: { authorization: "Bearer abc" } }),
      "abc"
    );
    assert.equal(
      extractBearer({ headers: { "x-keycode-token": "xyz" } }),
      "xyz"
    );
  });

  it("detects Tailscale identity", () => {
    assert.equal(
      hasTailscaleIdentity({
        headers: { "tailscale-user-login": "alice@example.com" },
      }),
      true
    );
    assert.equal(hasTailscaleIdentity({ headers: {} }), false);
  });

  it("safeJoin blocks traversal", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-static-"));
    fs.writeFileSync(path.join(root, "ok.js"), "1");
    assert.ok(safeJoin(root, "ok.js"));
    assert.equal(safeJoin(root, "../secret"), null);
    assert.equal(safeJoin(root, "a/../../secret"), null);
  });
});

describe("remote server HTTP (LAN)", () => {
  const token = generateRemoteToken();
  let pasted = null;
  let pastedText = null;
  let srv;
  let port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-remote-"));
  const staticDir = path.join(tmp, "static");
  const tarotDir = path.join(tmp, "tarot");

  before(async () => {
    fs.mkdirSync(staticDir, { recursive: true });
    fs.mkdirSync(tarotDir, { recursive: true });
    fs.writeFileSync(path.join(staticDir, "index.html"), "<html>ok</html>");
    fs.writeFileSync(path.join(tarotDir, "magician.jpg"), Buffer.from([0xff, 0xd8]));

    port = 18000 + Math.floor(Math.random() * 1000);
    srv = createRemoteServer({
      getToken: () => token,
      getPort: () => port,
      getAccessMode: () => "lan",
      getRemoteState: () => ({
        deck: { id: "lazy-v1", name: "Hobby" },
        cards: [{ id: "c1", title: "Eval", description: "d", image: "magician" }],
        targets: [],
        suggestions: [],
      }),
      listChats: async () => ({
        ok: true,
        chats: [
          {
            id: "live|win1|chatA|Chat%20A",
            name: "Chat A",
            cdpTargetId: "win1",
            chatId: "chatA",
            chatTitle: "Chat A",
          },
          {
            id: "live|win1|chatB|Chat%20B",
            name: "Chat B",
            cdpTargetId: "win1",
            chatId: "chatB",
            chatTitle: "Chat B",
          },
        ],
      }),
      readChat: async (targetId, _opts) => {
        if (!String(targetId).startsWith("live|") && targetId !== "t1") {
          return { ok: false, error: "unknown_target", hint: "unknown_target" };
        }
        return {
          ok: true,
          hash: "1",
          messages: [{ id: "m0", role: "user", text: "hi" }],
        };
      },
      pasteCard: async (cardId, targetId) => {
        pasted = { cardId, targetId };
        if (!String(targetId).startsWith("live|") && targetId !== "t1") {
          return { ok: false, error: "bad_target" };
        }
        return { ok: true, results: [{ target: "Chat A", ok: true }] };
      },
      pasteText: async (text, targetId) => {
        pastedText = { text, targetId };
        if (!String(targetId).startsWith("live|") && targetId !== "t1") {
          return { ok: false, error: "bad_target" };
        }
        return { ok: true, results: [{ target: "Chat A", ok: true }] };
      },
      staticDir,
      tarotDir,
    });
    const started = await srv.start(port);
    port = started.port;
  });

  after(async () => {
    await srv.stop();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("binds 0.0.0.0 and serves index", async () => {
    assert.equal(srv.status().host, BIND_LAN);
    assert.equal(srv.status().accessMode, "lan");
    const r = await req(port, "GET", "/");
    assert.equal(r.status, 200);
    assert.match(r.raw, /ok/);
  });

  it("rejects API without token", async () => {
    const r = await req(port, "GET", "/api/state");
    assert.equal(r.status, 401);
    assert.equal(r.json?.reason, "bad_token");
  });

  it("accepts token without Tailscale header in LAN mode", async () => {
    const r = await req(port, "GET", "/api/state", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.cards[0].id, "c1");
    assert.equal(r.json.cards[0].prompt, undefined);
  });

  it("rejects API chats without token", async () => {
    const r = await req(port, "GET", "/api/chats");
    assert.equal(r.status, 401);
  });

  it("lists live chats with token", async () => {
    const r = await req(port, "GET", "/api/chats", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.chats.length, 2);
    assert.equal(r.json.chats[0].name, "Chat A");
    assert.match(r.json.chats[0].id, /^live\|/);
  });

  it("rejects unknown target chat", async () => {
    const r = await req(port, "GET", "/api/chat?targetId=nope", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 404);
  });

  it("reads chat by live id", async () => {
    const r = await req(port, "GET", "/api/chat?targetId=live%7Cwin1%7CchatA%7CChat%20A", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.messages[0].text, "hi");
  });

  it("pastes only to selected live chat", async () => {
    pasted = null;
    const liveId = "live|win1|chatB|Chat%20B";
    const r = await req(port, "POST", "/api/paste", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ cardId: "c1", targetId: liveId }),
    });
    assert.equal(r.status, 200);
    assert.deepEqual(pasted, { cardId: "c1", targetId: liveId });
  });

  it("rejects paste-text without token", async () => {
    const r = await req(port, "POST", "/api/paste-text", {
      body: JSON.stringify({ text: "hi", targetId: "live|win1|chatA|Chat%20A" }),
    });
    assert.equal(r.status, 401);
  });

  it("pastes free text to selected live chat", async () => {
    pastedText = null;
    const liveId = "live|win1|chatA|Chat%20A";
    const r = await req(port, "POST", "/api/paste-text", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "hello from phone", targetId: liveId }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.deepEqual(pastedText, { text: "hello from phone", targetId: liveId });
  });

  it("rejects empty paste-text", async () => {
    const r = await req(port, "POST", "/api/paste-text", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "   ", targetId: "live|win1|chatA|Chat%20A" }),
    });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, "text_required");
  });

  it("rejects oversized paste-text", async () => {
    const { MAX_PASTE_TEXT } = require("../electron/remote-server");
    const r = await req(port, "POST", "/api/paste-text", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        text: "x".repeat(MAX_PASTE_TEXT + 1),
        targetId: "live|win1|chatA|Chat%20A",
      }),
    });
    assert.equal(r.status, 413);
    assert.equal(r.json.error, "text_too_long");
  });

  it("rejects oversized body", async () => {
    const big = JSON.stringify({ cardId: "c1", targetId: "t1", pad: "x".repeat(MAX_BODY) });
    const result = await req(port, "POST", "/api/paste", {
      headers: { Authorization: `Bearer ${token}` },
      body: big,
    }).then(
      (r) => ({ kind: "res", r }),
      (e) => ({ kind: "err", e })
    );
    if (result.kind === "err") {
      assert.ok(result.e);
      return;
    }
    assert.ok(
      result.r.status === 413 ||
        result.r.status === 400 ||
        result.r.status === 500
    );
  });

  it("SSE cleanup on stop", async () => {
    const st = srv.status();
    assert.equal(st.running, true);
    await new Promise((resolve, reject) => {
      const r = http.get(
        {
          host: HOST,
          port,
          path: "/api/events?targetId=live%7Cwin1%7CchatA%7CChat%20A",
          headers: { Authorization: `Bearer ${token}` },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          res.destroy();
          resolve();
        }
      );
      r.on("error", reject);
    });
  });
});

describe("remote live chats CDP closed", () => {
  it("returns 502 when listChats reports cdp_closed", async () => {
    const token = generateRemoteToken();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-chats-"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<html>ok</html>");
    const port = 19100 + Math.floor(Math.random() * 500);
    const srv = createRemoteServer({
      getToken: () => token,
      getPort: () => port,
      getAccessMode: () => "lan",
      getRemoteState: () => ({ cards: [], targets: [], deck: { id: "x", name: "x" } }),
      listChats: async () => ({
        ok: false,
        error: "cdp_closed",
        hint: "cdp_closed",
        chats: [],
      }),
      readChat: async () => ({ ok: true, messages: [], hash: "" }),
      pasteCard: async () => ({ ok: true }),
      staticDir: tmp,
      tarotDir: tmp,
    });
    await srv.start(port);
    try {
      const r = await req(port, "GET", "/api/chats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(r.status, 502);
      assert.equal(r.json?.hint, "cdp_closed");
    } finally {
      await srv.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("remote completion SSE", () => {
  it("emits task-done once for false, true, false, false", async () => {
    const token = generateRemoteToken();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-complete-"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<html>ok</html>");
    const states = [false, true, false, false];
    let reads = 0;
    const srv = createRemoteServer({
      getToken: () => token,
      getPort: () => 0,
      getAccessMode: () => "lan",
      getRemoteState: () => ({}),
      readChat: async () => {
        const generating = states[Math.min(reads, states.length - 1)];
        reads += 1;
        return {
          ok: true,
          generating,
          hash: String(reads),
          messages: [],
        };
      },
      pasteCard: async () => ({ ok: true }),
      staticDir: tmp,
      tarotDir: tmp,
      pollMs: 10,
    });
    const started = await srv.start(0);
    try {
      const stream = await new Promise((resolve, reject) => {
        const request = http.get(
          {
            host: HOST,
            port: started.port,
            path: "/api/events?targetId=t1",
            headers: { Authorization: `Bearer ${token}` },
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => {
              raw += chunk.toString("utf8");
            });
            setTimeout(() => {
              res.destroy();
              resolve(raw);
            }, 100);
          }
        );
        request.on("error", reject);
      });
      assert.equal((stream.match(/event: task-done/g) || []).length, 1);
      assert.equal((stream.match(/event: activity/g) || []).length, 2);
    } finally {
      await srv.stop();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("remote server HTTP (tailscale mode later)", () => {
  it("requires Tailscale identity when bypass off", async () => {
    const token = generateRemoteToken();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-ts-"));
    fs.writeFileSync(path.join(tmp, "index.html"), "<html>ok</html>");
    const port = 19000 + Math.floor(Math.random() * 1000);
    const strict = createRemoteServer({
      getToken: () => token,
      getPort: () => port,
      getAccessMode: () => "tailscale",
      getRemoteState: () => ({}),
      readChat: async () => ({ ok: true, messages: [], hash: "" }),
      pasteCard: async () => ({ ok: true }),
      staticDir: tmp,
      tarotDir: tmp,
      allowLoopbackWithoutTailscale: false,
    });
    await strict.start(port);
    try {
      assert.equal(strict.status().host, BIND_LOOPBACK);
      const r = await req(port, "GET", "/api/state", {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(r.status, 401);
      assert.equal(r.json?.reason, "tailscale_required");

      const ok = await req(port, "GET", "/api/state", {
        headers: {
          Authorization: `Bearer ${token}`,
          "tailscale-user-login": "alice@example.com",
        },
      });
      assert.equal(ok.status, 200);
    } finally {
      await strict.stop();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });
});

describe("remote /api/deck", () => {
  let srv;
  let port;
  let token;
  let active = "lazy-v1";
  const decks = [
    { id: "lazy-v1", name: "Hobby" },
    { id: "pro-v1", name: "Pro" },
  ];

  function statePayload() {
    const deck = decks.find((d) => d.id === active) || decks[0];
    return {
      deck: { id: deck.id, name: deck.name },
      decks: decks.map((d) => ({ id: d.id, name: d.name })),
      cards: [{ id: `card-${deck.id}`, title: deck.name }],
      targets: [],
      suggestions: [],
    };
  }

  before(async () => {
    token = generateRemoteToken();
    port = 19000 + Math.floor(Math.random() * 1000);
    srv = createRemoteServer({
      getToken: () => token,
      getPort: () => port,
      getAccessMode: () => "lan",
      getRemoteState: () => statePayload(),
      setActiveDeck: ({ deckId, step } = {}) => {
        if (deckId) {
          if (!decks.some((d) => d.id === deckId)) {
            return { ok: false, error: "unknown_deck" };
          }
          active = deckId;
          return { ok: true, deck: { id: active, name: active } };
        }
        if (step === 1 || step === -1) {
          const idx = decks.findIndex((d) => d.id === active);
          active = decks[(idx + step + decks.length) % decks.length].id;
          return { ok: true, deck: { id: active, name: active } };
        }
        return { ok: false, error: "deck_id_or_step_required" };
      },
      listChats: async () => ({ ok: true, chats: [] }),
      readChat: async () => ({ ok: true, hash: "0", messages: [] }),
      pasteCard: async () => ({ ok: true, results: [] }),
      staticDir: os.tmpdir(),
      tarotDir: os.tmpdir(),
    });
    const started = await srv.start(port);
    port = started.port;
  });

  after(async () => {
    await srv.stop();
  });

  it("cycles active deck with step", async () => {
    active = "lazy-v1";
    const r = await req(port, "POST", "/api/deck", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ step: 1 }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.ok, true);
    assert.equal(r.json?.deck?.id, "pro-v1");
    assert.equal(r.json?.cards?.[0]?.id, "card-pro-v1");
    assert.equal(r.json?.decks?.length, 2);
  });

  it("sets deck by id", async () => {
    const r = await req(port, "POST", "/api/deck", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deckId: "lazy-v1" }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.deck?.id, "lazy-v1");
  });

  it("rejects unknown deck id", async () => {
    const r = await req(port, "POST", "/api/deck", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ deckId: "nope" }),
    });
    assert.equal(r.status, 404);
    assert.equal(r.json?.error, "unknown_deck");
  });

  it("rejects empty body", async () => {
    const r = await req(port, "POST", "/api/deck", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
    assert.equal(r.json?.error, "deck_id_or_step_required");
  });
});

describe("remote composer endpoints", () => {
  let srv;
  let port;
  let token;
  let lastMode = null;
  let lastModel = null;
  let lastAnswer = null;

  before(async () => {
    token = generateRemoteToken();
    port = 19100 + Math.floor(Math.random() * 800);
    srv = createRemoteServer({
      getToken: () => token,
      getPort: () => port,
      getAccessMode: () => "lan",
      getRemoteState: () => ({
        deck: { id: "lazy-v1", name: "Hobby" },
        cards: [],
        targets: [],
        suggestions: [],
      }),
      listChats: async () => ({ ok: true, chats: [] }),
      readChat: async () => ({
        ok: true,
        hash: "c1",
        messages: [],
        generating: false,
        composer: {
          mode: "agent",
          submitKind: "send",
          submitLabel: "Send",
          modelLabel: "composer-2.5",
          models: [{ id: "composer-2.5", label: "composer-2.5" }],
        },
        clarifications: [
          {
            id: "q-0",
            prompt: "Pick one",
            options: [{ id: "opt-0", label: "Yes" }],
          },
        ],
      }),
      setComposerMode: async (targetId, mode) => {
        lastMode = { targetId, mode };
        return {
          ok: true,
          mode,
          composer: {
            mode,
            submitKind: mode === "plan" ? "build" : "send",
            submitLabel: mode === "plan" ? "Build" : "Send",
          },
        };
      },
      setComposerModel: async (targetId, model) => {
        lastModel = { targetId, model };
        return { ok: true, model, composer: { modelId: model, modelLabel: model } };
      },
      answerClarification: async (targetId, payload) => {
        lastAnswer = { targetId, ...payload };
        return { ok: true, clicked: payload.text || payload.optionId };
      },
      pasteCard: async () => ({ ok: true, results: [] }),
      staticDir: os.tmpdir(),
      tarotDir: os.tmpdir(),
    });
    const started = await srv.start(port);
    port = started.port;
  });

  after(async () => {
    await srv.stop();
  });

  it("returns composer chrome on chat read", async () => {
    const r = await req(port, "GET", "/api/chat?targetId=t1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json?.composer?.submitLabel, "Send");
    assert.equal(r.json?.clarifications?.length, 1);
  });

  it("sets composer mode", async () => {
    const r = await req(port, "POST", "/api/composer/mode", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetId: "t1", mode: "plan" }),
    });
    assert.equal(r.status, 200);
    assert.equal(lastMode?.mode, "plan");
    assert.equal(r.json?.composer?.submitKind, "build");
  });

  it("sets composer model", async () => {
    const r = await req(port, "POST", "/api/composer/model", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ targetId: "t1", model: "composer-2.5" }),
    });
    assert.equal(r.status, 200);
    assert.equal(lastModel?.model, "composer-2.5");
  });

  it("answers clarification", async () => {
    const r = await req(port, "POST", "/api/composer/answer", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetId: "t1",
        clarificationId: "q-0",
        optionId: "opt-0",
        text: "Yes",
      }),
    });
    assert.equal(r.status, 200);
    assert.equal(lastAnswer?.text, "Yes");
  });
});
