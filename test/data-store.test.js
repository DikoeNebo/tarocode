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
  MAX_TARGET_PRESETS,
  normalizeTargetPresets,
  resolvePasteTargets,
  migratePasteRouting,
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

  it("keeps up to 9 cards and allows empty hotkey", () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      title: `C${i}`,
      prompt: "x",
      image: "magician",
      hotkey: i < 8 ? `F${i + 1}` : "",
    }));
    const deck = normalizeDeck({ id: "nine-ok", name: "Nine", cards });
    assert.equal(deck.cards.length, 9);
    assert.equal(deck.cards[8].hotkey, "");
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
      cursorBackend: "sdk",
      cursorApiKey: "k",
      notRemote: 1,
    });
    assert.equal(p.remoteEnabled, true);
    assert.equal(p.remotePort, 17865);
    assert.equal(p.remoteToken, "abcdefghijklmnop");
    assert.equal(p.remoteAccessMode, "lan");
    assert.equal(p.cursorBackend, "sdk");
    assert.equal(p.cursorApiKey, "k");
    assert.equal(p.notRemote, undefined);
  });

  it("allows sideCardLayout", () => {
    const p = pickSettingsPartial({ sideCardLayout: "strip", ignored: true });
    assert.equal(p.sideCardLayout, "strip");
    assert.equal(p.ignored, undefined);
  });

  it("allows Chats window placement keys", () => {
    const p = pickSettingsPartial({
      targetsWindowBounds: { x: 10, y: 20, width: 480, height: 560 },
      targetsWindowMaximized: true,
      evilBounds: { x: 0 },
    });
    assert.deepEqual(p.targetsWindowBounds, {
      x: 10,
      y: 20,
      width: 480,
      height: 560,
    });
    assert.equal(p.targetsWindowMaximized, true);
    assert.equal(p.evilBounds, undefined);
  });

  it("allows paste routing keys", () => {
    const p = pickSettingsPartial({
      pasteMode: "solo",
      activeTargetId: "t1",
      activePresetId: "p1",
      targetPresets: [{ id: "p1", name: "Both", targetIds: ["t1"] }],
      evil: true,
    });
    assert.equal(p.pasteMode, "solo");
    assert.equal(p.activeTargetId, "t1");
    assert.equal(p.activePresetId, "p1");
    assert.equal(p.targetPresets.length, 1);
    assert.equal(p.evil, undefined);
  });
});

describe("resolvePasteTargets / presets", () => {
  const targets = [
    { id: "a", name: "A", enabled: true },
    { id: "b", name: "B", enabled: false },
    { id: "c", name: "C", enabled: true },
  ];

  it("broadcast uses enabled when no preset", () => {
    const r = resolvePasteTargets({ pasteMode: "broadcast", targets });
    assert.deepEqual(
      r.targets.map((t) => t.id),
      ["a", "c"]
    );
  });

  it("broadcast uses preset targetIds ignoring enabled", () => {
    const r = resolvePasteTargets({
      pasteMode: "broadcast",
      targets,
      activePresetId: "both",
      targetPresets: [{ id: "both", name: "Both", targetIds: ["a", "b"] }],
    });
    assert.deepEqual(
      r.targets.map((t) => t.id),
      ["a", "b"]
    );
  });

  it("solo uses activeTargetId", () => {
    const r = resolvePasteTargets({
      pasteMode: "solo",
      targets,
      activeTargetId: "b",
    });
    assert.equal(r.targets.length, 1);
    assert.equal(r.targets[0].id, "b");
  });

  it("solo missing target returns reason", () => {
    const r = resolvePasteTargets({
      pasteMode: "solo",
      targets,
      activeTargetId: "missing",
    });
    assert.equal(r.targets.length, 0);
    assert.equal(r.reason, "no_active_target");
  });

  it("empty preset returns reason", () => {
    const r = resolvePasteTargets({
      pasteMode: "broadcast",
      targets,
      activePresetId: "empty",
      targetPresets: [{ id: "empty", name: "Empty", targetIds: ["gone"] }],
    });
    assert.equal(r.targets.length, 0);
    assert.equal(r.reason, "empty_preset");
  });

  it("caps presets at MAX_TARGET_PRESETS", () => {
    const list = [];
    for (let i = 0; i < MAX_TARGET_PRESETS + 3; i++) {
      list.push({ id: `p${i}`, name: `P${i}`, targetIds: ["a"] });
    }
    assert.equal(normalizeTargetPresets(list).length, MAX_TARGET_PRESETS);
  });

  it("migratePasteRouting drops stale ids", () => {
    const m = migratePasteRouting({
      pasteMode: "solo",
      targets: [{ id: "a", enabled: true }],
      activeTargetId: "gone",
      activePresetId: "missing-preset",
      targetPresets: [
        { id: "keep", name: "Keep", targetIds: ["a", "gone"] },
        { id: "old", name: "Old", targetIds: ["gone"] },
      ],
    });
    assert.equal(m.activeTargetId, "");
    assert.equal(m.activePresetId, "");
    assert.equal(m.targetPresets.length, 2);
    assert.deepEqual(m.targetPresets[0].targetIds, ["a"]);
    assert.deepEqual(m.targetPresets[1].targetIds, []);
    assert.equal(m.changed, true);
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
