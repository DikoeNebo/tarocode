const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  safeId,
  trySafeId,
  deckFilePath,
  safeTarotFilePath,
  atomicWriteJson,
  pickSettingsPartial,
  normalizeDeck,
  MAX_DECK_IMPORT_BYTES,
} = require("../electron/data-store");
const { PasteQueue } = require("../electron/paste-queue");

describe("safeId", () => {
  it("accepts normal ids", () => {
    assert.equal(safeId("lazy-v1"), "lazy-v1");
    assert.equal(trySafeId("pro_v1"), "pro_v1");
  });

  it("rejects path traversal", () => {
    assert.equal(trySafeId("../settings"), null);
    assert.equal(trySafeId("..\\settings"), null);
    assert.throws(() => safeId("../settings"), /invalid/);
  });
});

describe("deckFilePath", () => {
  it("stays inside decks dir", () => {
    const dir = path.join(os.tmpdir(), "keycode-decks-test");
    const p = deckFilePath(dir, "lazy-v1");
    assert.ok(p.endsWith(`${path.sep}lazy-v1.json`));
    assert.ok(p.startsWith(path.resolve(dir)));
  });

  it("blocks escape via id", () => {
    const dir = path.join(os.tmpdir(), "keycode-decks-test");
    assert.throws(() => deckFilePath(dir, "../settings"), /invalid/);
  });
});

describe("safeTarotFilePath", () => {
  it("allows basename jpg", () => {
    const root = path.join(os.tmpdir(), "tarot-root");
    fs.mkdirSync(root, { recursive: true });
    const p = safeTarotFilePath(root, "magician.jpg");
    assert.equal(path.basename(p), "magician.jpg");
  });

  it("blocks traversal", () => {
    const root = path.join(os.tmpdir(), "tarot-root");
    assert.throws(() => safeTarotFilePath(root, "../../electron/main.js"), /invalid|path/);
  });
});

describe("normalizeDeck / import", () => {
  it("renames conflicting id", () => {
    const deck = normalizeDeck(
      {
        id: "lazy-v1",
        name: "Hack",
        cards: [{ id: "c1", title: "A", prompt: "x", image: "magician", hotkey: "F1" }],
      },
      { existingIds: new Set(["lazy-v1"]) }
    );
    assert.notEqual(deck.id, "lazy-v1");
    assert.match(deck.id, /^imported-/);
  });

  it("rejects huge files", () => {
    assert.throws(
      () =>
        normalizeDeck(
          { id: "x", cards: [{ title: "a", image: "magician" }] },
          { sourceBytes: MAX_DECK_IMPORT_BYTES + 1 }
        ),
      /too large|too_large/
    );
  });

  it("rejects empty cards on import", () => {
    assert.throws(() => normalizeDeck({ id: "ok-id", cards: [] }), /cards/);
  });
});

describe("pickSettingsPartial", () => {
  it("whitelists keys", () => {
    const p = pickSettingsPartial({
      autoEnter: true,
      evil: "x",
      __proto__: { polluted: true },
    });
    assert.equal(p.autoEnter, true);
    assert.equal(p.evil, undefined);
  });

  it("allows remote settings keys", () => {
    const p = pickSettingsPartial({
      remoteEnabled: true,
      remotePort: 17865,
      remoteToken: "abcdefghijklmnop",
      remoteAccessMode: "lan",
      notRemote: 1,
    });
    assert.equal(p.remoteEnabled, true);
    assert.equal(p.remotePort, 17865);
    assert.equal(p.remoteToken, "abcdefghijklmnop");
    assert.equal(p.remoteAccessMode, "lan");
    assert.equal(p.notRemote, undefined);
  });
});

describe("atomicWriteJson", () => {
  it("writes readable json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "keycode-atomic-"));
    const file = path.join(dir, "settings.json");
    atomicWriteJson(file, { a: 1 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 1 });
    atomicWriteJson(file, { a: 2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 2 });
    assert.ok(fs.existsSync(`${file}.bak`));
  });
});

describe("PasteQueue", () => {
  it("rejects overlapping paste", async () => {
    const q = new PasteQueue();
    let release;
    const blocker = new Promise((r) => {
      release = r;
    });
    const first = q.enqueue(async () => {
      await blocker;
      return { ok: true };
    });
    const second = await q.enqueue(async () => ({ ok: true }));
    assert.equal(second.busy, true);
    assert.equal(second.ok, false);
    release();
    const done = await first;
    assert.equal(done.ok, true);
  });

  it("blocks concurrent pick", () => {
    const q = new PasteQueue();
    assert.equal(q.beginPick(), true);
    assert.equal(q.beginPick(), false);
    q.endPick();
    assert.equal(q.beginPick(), true);
  });
});
