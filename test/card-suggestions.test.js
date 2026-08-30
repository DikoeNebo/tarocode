const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  suggestNextCards,
  parseScore,
  parseGate,
  parseNext,
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

const validateCards = [
  { id: "problem", prompt: "State the target audience, the observable problem, and a testable hypothesis." },
  { id: "evidence-plan", prompt: "Pick the cheapest way to test the hypothesis before any experiment." },
  { id: "interview", prompt: "Prepare non-leading interview questions, or analyze answers provided." },
  { id: "market", prompt: "Map competitors, substitutes, licenses, and reusable references carefully." },
  { id: "experiment", prompt: "Design the smallest smoke fake-door waitlist experiment using the threshold." },
  { id: "evidence-review", prompt: "Judge ONLY evidence the user actually provided notes counts links." },
  { id: "pivot", prompt: "Using the failed criterion, shrink audience, problem, or channel now." },
  { id: "validation-cycle", prompt: "Run the validation loop with what is already known from chat." },
  { id: "summary", prompt: "Read this chat. Do not write or change code. Do not invent evidence." },
];

const specCards = [
  { id: "brief", prompt: "Turn the confirmed hypothesis into a product brief with a measurable outcome." },
  { id: "scope", prompt: "Freeze MVP: IN / OUT, one happy path, acceptance criteria, deferred features." },
  { id: "ux", prompt: "Describe screens, controls, empty loading error states, and navigation in text." },
  { id: "data-contracts", prompt: "Define entities, validation, storage, and external contracts only if needed." },
  { id: "architecture", prompt: "Read the repo and existing dependencies first. Propose the simplest structure." },
  { id: "project-rules", prompt: "Inspect existing AGENTS.md and cursor rules. Propose the smallest updates." },
  { id: "risk-review", prompt: "Review the specification for clarity, completeness, YAGNI, safety, testability." },
  { id: "readiness", prompt: "Check that goal, scope, UX, needed contracts, architecture, acceptance exist." },
  { id: "summary", prompt: "Read this chat. Do not write or change code. Four short specification blocks." },
];

const catalog = {
  "validate-v1": { id: "validate-v1", name: "01 Validation", cards: validateCards },
  "spec-v1": { id: "spec-v1", name: "02 Specification", cards: specCards },
  "lazy-v1": { id: "lazy-v1", name: "Hobby", cards: lazyCards },
  "pro-v1": { id: "pro-v1", name: "Pro", cards: proCards },
  "release-v1": {
    id: "release-v1",
    name: "04 Release",
    cards: [
      { id: "release-plan", prompt: "Choose a release profile from the actual project desktop web mobile." },
      { id: "quality-audit", prompt: "Find and run only existing relevant builds tests linters in this repo." },
      { id: "security-audit", prompt: "Read-only security review: secrets, input validation, dependency risk." },
      { id: "package", prompt: "Prepare the package deploy artifact and rollback for the chosen profile." },
      { id: "docs", prompt: "Update only relevant README release notes install upgrade rollback text now." },
      { id: "operations", prompt: "Minimal ops: logs, errors, backups, support, incident response details." },
      { id: "release-gate", prompt: "Check build tests, critical security, docs, rollback, remaining manual steps." },
      { id: "launch", prompt: "First list the launch actions, risks, and rollback. Do not publish yet." },
      { id: "summary", prompt: "Read this chat. Do not publish anything. Do not change production systems." },
    ],
  },
};

describe("parseGate / parseNext", () => {
  it("parses strict GATE and NEXT", () => {
    assert.equal(parseGate("ok\nKEYCODE_GATE: PASS\n"), "PASS");
    assert.equal(parseGate("KEYCODE_GATE: FAIL"), "FAIL");
    assert.equal(parseGate("KEYCODE_GATE: maybe"), null);
    assert.deepEqual(parseNext("KEYCODE_NEXT: spec-v1/brief"), {
      deckId: "spec-v1",
      cardId: "brief",
    });
    assert.equal(parseNext("KEYCODE_NEXT: Idea.1"), null);
    assert.deepEqual(parseNext("KEYCODE_NEXT: spec-v1/brief extra"), {
      deckId: "spec-v1",
      cardId: "brief",
    });
  });
});

describe("phase suggestions", () => {
  it("empty validation deck suggests problem", () => {
    const s = suggestNextCards({
      messages: [],
      cards: validateCards,
      deckId: "validate-v1",
      catalog,
    });
    assert.equal(s[0].cardId, "problem");
    assert.equal(s[0].deckId, "validate-v1");
  });

  it("PASS + NEXT is primary and can point at another deck", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: validateCards.find((c) => c.id === "evidence-review").prompt },
        {
          role: "assistant",
          text: "Enough signups.\nKEYCODE_GATE: PASS\nKEYCODE_NEXT: spec-v1/brief",
        },
      ],
      cards: validateCards,
      deckId: "validate-v1",
      catalog,
    });
    assert.equal(s[0].cardId, "brief");
    assert.equal(s[0].deckId, "spec-v1");
    assert.equal(s[0].rank, 1);
  });

  it("FAIL without NEXT recommends pivot", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: validateCards.find((c) => c.id === "evidence-review").prompt },
        { role: "assistant", text: "No evidence.\nKEYCODE_GATE: FAIL" },
      ],
      cards: validateCards,
      deckId: "validate-v1",
      catalog,
    });
    assert.equal(s[0].cardId, "pivot");
    assert.equal(s[0].deckId, "validate-v1");
  });

  it("ignores unknown NEXT ids", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: validateCards.find((c) => c.id === "evidence-review").prompt },
        {
          role: "assistant",
          text: "KEYCODE_GATE: PASS\nKEYCODE_NEXT: nope-v1/nope",
        },
      ],
      cards: validateCards,
      deckId: "validate-v1",
      catalog,
    });
    assert.ok(!s.some((x) => x.cardId === "nope"));
    assert.equal(s[0].deckId, "spec-v1");
    assert.equal(s[0].cardId, "brief");
  });

  it("stale GATE from earlier card is ignored", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: validateCards.find((c) => c.id === "evidence-review").prompt },
        { role: "assistant", text: "KEYCODE_GATE: FAIL\nKEYCODE_NEXT: validate-v1/pivot" },
        { role: "user", text: validateCards.find((c) => c.id === "problem").prompt },
        { role: "assistant", text: "Hypothesis written." },
      ],
      cards: validateCards,
      deckId: "validate-v1",
      catalog,
    });
    assert.equal(s[0].cardId, "evidence-plan");
  });

  it("readiness PASS suggests both work decks when NEXT is omitted", () => {
    const s = suggestNextCards({
      messages: [
        { role: "user", text: specCards.find((c) => c.id === "readiness").prompt },
        { role: "assistant", text: "Ready.\nKEYCODE_GATE: PASS" },
      ],
      cards: specCards,
      deckId: "spec-v1",
      catalog,
    });
    assert.equal(s[0].deckId, "lazy-v1");
    assert.equal(s[0].cardId, "plan");
    assert.ok(s.some((x) => x.deckId === "pro-v1" && x.cardId === "plan"));
  });

  it("release security FAIL points at pro fix", () => {
    const s = suggestNextCards({
      messages: [
        {
          role: "user",
          text: catalog["release-v1"].cards.find((c) => c.id === "security-audit").prompt,
        },
        { role: "assistant", text: "Secret in repo.\nKEYCODE_GATE: FAIL" },
      ],
      cards: catalog["release-v1"].cards,
      deckId: "release-v1",
      catalog,
    });
    assert.equal(s[0].deckId, "pro-v1");
    assert.equal(s[0].cardId, "fix");
  });

  it("after switching to production, prior security FAIL still suggests fix", () => {
    const s = suggestNextCards({
      messages: [
        {
          role: "user",
          text: catalog["release-v1"].cards.find((c) => c.id === "security-audit").prompt,
        },
        { role: "assistant", text: "Secret in repo.\nKEYCODE_GATE: FAIL" },
      ],
      cards: proCards,
      deckId: "pro-v1",
      catalog,
    });
    assert.equal(s[0].cardId, "fix");
    assert.equal(s[0].deckId, "pro-v1");
  });
});
