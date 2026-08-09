const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  suggestNextCards,
  parseScore,
  detectLastCardId,
} = require("../electron/card-suggestions");

const lazyCards = [
  { id: "plan", prompt: "Create a step-by-step plan for the current task. Do not write code." },
  { id: "evaluate", prompt: "Evaluate the current plan or latest result honestly — no filler, no flattery." },
  { id: "work", prompt: "Do the next open step of the approved plan — only that step, not everything at once." },
  { id: "test", prompt: "Test what was just done (the last step or a clearly named part)." },
  { id: "fix", prompt: "Fix issues from the last test, error, or project quality score below 7/10." },
  { id: "polish", prompt: "\"Polish\" mode. Do not stop until the project quality score is 9 or 10 out of 10." },
  { id: "backup", prompt: "Create a safe rollback point for the current project state." },
  { id: "fullcycle", prompt: "Full cycle through the plan from start to finish — no skipping." },
  {
    id: "summary",
    prompt:
      "Read this chat and the repo context. Do not write or change code.\n\nReply in exactly four short sections.",
  },
];

const proCards = [
  ...lazyCards.filter((c) => c.id !== "backup"),
  {
    id: "improve",
    prompt: "Improve the current plan or design until it is ready to implement.",
  },
];

function ranks(suggestions) {
  return suggestions.map((s) => `${s.rank}:${s.cardId}`);
}

describe("parseScore", () => {
  it("prefers KEYCODE_SCORE over prose", () => {
    assert.equal(
      parseScore("Project quality score: 9/10\nKEYCODE_SCORE: 4"),
      4
    );
  });

  it("falls back to project quality score line", () => {
    assert.equal(parseScore("Балл оценки проекта: 7/10"), 7);
    assert.equal(parseScore("Project quality score: 8/10"), 8);
  });
});

describe("detectLastCardId", () => {
  it("matches user paste to card prompt prefix", () => {
    const id = detectLastCardId(
      [
        {
          role: "user",
          text: lazyCards.find((c) => c.id === "evaluate").prompt + "\n\nextra",
        },
      ],
      lazyCards
    );
    assert.equal(id, "evaluate");
  });
});

describe("suggestNextCards", () => {
  it("empty chat suggests plan primary and fullcycle secondary", () => {
    const s = suggestNextCards({ messages: [], cards: lazyCards });
    assert.deepEqual(ranks(s), ["1:plan", "2:fullcycle"]);
  });

  it("after plan suggests evaluate", () => {
    const s = suggestNextCards({
      messages: [{ role: "user", text: lazyCards[0].prompt }],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "evaluate");
    assert.equal(s[0].rank, 1);
  });

  it("after evaluate score <7 suggests fix", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        { role: "assistant", text: "Review done.\nKEYCODE_SCORE: 5" },
      ],
      cards: lazyCards,
    });
    assert.deepEqual(ranks(s).slice(0, 1), ["1:fix"]);
    assert.ok(s.every((x) => x.rank === 1 || x.rank === 2));
    assert.ok(s.length <= 3);
    assert.equal(s.filter((x) => x.rank === 1).length, 1);
  });

  it("after evaluate score 7–8 suggests work", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        { role: "assistant", text: "KEYCODE_SCORE: 8" },
      ],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "work");
    assert.ok(s.some((x) => x.cardId === "polish"));
  });

  it("after evaluate score 9–10 suggests work + backup", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        { role: "assistant", text: "KEYCODE_SCORE: 9" },
      ],
      cards: lazyCards,
    });
    assert.deepEqual(ranks(s), ["1:work", "2:backup"]);
  });

  it("after work suggests test", () => {
    const s = suggestNextCards({
      messages: [{ role: "user", text: lazyCards.find((c) => c.id === "work").prompt }],
      cards: lazyCards,
    });
    assert.deepEqual(ranks(s), ["1:test"]);
  });

  it("after test fail suggests fix", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "test").prompt },
        { role: "assistant", text: "Result: red — assertion failed.\nKEYCODE_SCORE: 4" },
      ],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "fix");
  });

  it("after test pass with mid score suggests work", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "test").prompt },
        { role: "assistant", text: "TEST PASSED\nKEYCODE_SCORE: 7" },
      ],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "work");
  });

  it("only returns ids present in the deck", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        { role: "assistant", text: "KEYCODE_SCORE: 9" },
      ],
      cards: proCards,
    });
    assert.ok(!s.some((x) => x.cardId === "backup"));
    assert.equal(s[0].cardId, "work");
  });

  it("after plan on pro deck can secondary-suggest improve", () => {
    const s = suggestNextCards({
      messages: [{ role: "user", text: lazyCards[0].prompt }],
      cards: proCards,
    });
    assert.equal(s[0].cardId, "evaluate");
    assert.ok(s.some((x) => x.cardId === "improve" && x.rank === 2));
  });

  it("KEYCODE_SCORE wins over conflicting prose score", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        {
          role: "assistant",
          text: "Project quality score: 9/10\nKEYCODE_SCORE: 3",
        },
      ],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "fix");
  });

  it("after summary continues from prior work card + score", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "evaluate").prompt },
        { role: "assistant", text: "KEYCODE_SCORE: 8" },
        { role: "user", text: lazyCards.find((c) => c.id === "summary").prompt },
        {
          role: "assistant",
          text: "Task: x\nDone: y\nNot done: z\nNext: Work",
        },
      ],
      cards: lazyCards,
    });
    assert.equal(s[0].cardId, "work");
    assert.ok(!s.some((x) => x.cardId === "summary"));
  });

  it("summary alone falls back to plan", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: lazyCards.find((c) => c.id === "summary").prompt },
      ],
      cards: lazyCards,
    });
    assert.deepEqual(ranks(s), ["1:plan", "2:fullcycle"]);
  });
});
