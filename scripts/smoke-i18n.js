/**
 * Smoke: locale resolve, packs, decks, t() for all locales, renderer files parse.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { spawn } = require("child_process");
const i18n = require("../electron/i18n");

const root = path.join(__dirname, "..");
i18n.setPacksRoot(root);

const errors = [];

function fail(msg) {
  errors.push(msg);
  console.error("FAIL:", msg);
}

// 1) UI key parity
const enUi = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/ui/en.json"), "utf8"));
const enKeys = Object.keys(enUi);
for (const code of i18n.SUPPORTED) {
  const j = JSON.parse(
    fs.readFileSync(path.join(root, `src/i18n/ui/${code}.json`), "utf8")
  );
  for (const k of enKeys) {
    if (!(k in j)) fail(`${code} missing UI key ${k}`);
    else if (typeof j[k] !== "string" || !j[k].trim()) fail(`${code} empty ${k}`);
  }
}

// 2) Tarot 78
const tarotJs = fs.readFileSync(path.join(root, "src/tarot.js"), "utf8");
const tarotIds = [...tarotJs.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
assert.equal(tarotIds.length, 78);
for (const code of i18n.SUPPORTED) {
  const t = i18n.loadTarotNames(code);
  for (const id of tarotIds) {
    if (!t.cards?.[id]) fail(`${code} missing tarot ${id}`);
  }
}

// 3) Decks
for (const code of i18n.SUPPORTED) {
  for (const id of i18n.STOCK_DECK_IDS) {
    const p = i18n.bundledDeckPath(code, id);
    if (!fs.existsSync(p)) {
      fail(`missing deck ${code}/${id}`);
      continue;
    }
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    if (d.id !== id) fail(`deck id ${code}/${id} got ${d.id}`);
    if (!Array.isArray(d.cards) || d.cards.length < 1 || d.cards.length > 9) {
      fail(`deck cards ${code}/${id} len=${d.cards?.length}`);
    }
    const ids = (d.cards || []).map((c) => c.id);
    const hotkeys = (d.cards || []).map((c) => c.hotkey || "");
    if (code === "en") {
      // baseline for cross-locale parity
      globalThis.__KEYCODE_DECK_BASE__ = globalThis.__KEYCODE_DECK_BASE__ || {};
      globalThis.__KEYCODE_DECK_BASE__[id] = { ids, hotkeys };
    } else {
      const base = globalThis.__KEYCODE_DECK_BASE__?.[id];
      if (base) {
        if (JSON.stringify(ids) !== JSON.stringify(base.ids)) {
          fail(`deck card ids diverge ${code}/${id}`);
        }
        if (JSON.stringify(hotkeys) !== JSON.stringify(base.hotkeys)) {
          fail(`deck hotkeys diverge ${code}/${id}`);
        }
      }
    }
    for (const c of d.cards || []) {
      if (!c.id || !c.title || !c.prompt || !c.image) {
        fail(`card incomplete ${code}/${id}/${c?.id}`);
      }
    }
    if (!ids.includes("summary")) fail(`deck missing summary ${code}/${id}`);
    const summary = (d.cards || []).find((c) => c.id === "summary");
    if (summary && summary.hotkey) {
      fail(`summary must be click-only ${code}/${id}`);
    }
  }
}

// 4) resolve + t
assert.equal(i18n.resolveUiLocale("system", "it-IT"), "en");
assert.equal(i18n.resolveUiLocale("system", "ru-RU"), "ru");
assert.equal(i18n.resolveUiLocale("system", "pt-BR"), "pt-BR");
assert.equal(i18n.resolveUiLocale("de", "en-US"), "de");
assert.equal(i18n.resolveArcanaLocale("ui", "ja"), "ja");
assert.equal(i18n.resolveArcanaLocale("en", "ja"), "en");

for (const code of i18n.SUPPORTED) {
  i18n.setActiveUiLocale(code);
  const title = i18n.t("settings.title");
  if (!title || title === "settings.title") fail(`t(settings.title) broken for ${code}`);
  const toast = i18n.t("toast.hotkeyBusy", { keys: "F9" });
  if (!toast.includes("F9")) fail(`interpolation broken for ${code}: ${toast}`);
}

// 5) payload shape
const payload = i18n.buildI18nPayload(
  { uiLocale: "system", arcanaLocale: "en" },
  "ru-RU"
);
assert.equal(payload.uiLocale, "ru");
assert.equal(payload.arcanaLocale, "en");
assert.ok(payload.messages["settings.title"]);
assert.ok(payload.tarot.cards.magician);
assert.equal(payload.locales.length, 10);

// 6) renderer sources syntax
for (const rel of [
  "src/i18n.js",
  "src/app.js",
  "src/settings.js",
  "src/targets.js",
  "src/chat-pick.js",
  "src/pick.js",
  "src/tarot.js",
]) {
  const { status, stderr } = require("child_process").spawnSync(
    process.execPath,
    ["--check", path.join(root, rel)],
    { encoding: "utf8" }
  );
  if (status !== 0) fail(`syntax ${rel}: ${stderr}`);
}

// 7) HTML has i18n.js
for (const rel of [
  "src/index.html",
  "src/settings.html",
  "src/targets.html",
  "src/chat-pick.html",
  "src/pick.html",
]) {
  const html = fs.readFileSync(path.join(root, rel), "utf8");
  if (!html.includes('src="i18n.js"')) fail(`${rel} missing i18n.js`);
}

console.log("smoke-i18n static checks:", errors.length ? "FAILED" : "OK");

// 8) Launch Electron briefly, capture console
async function launchElectronSmoke() {
  const electronBin = require("electron");
  const logPath = path.join(root, "scripts", ".smoke-electron.log");
  try {
    fs.unlinkSync(logPath);
  } catch {
    /* ignore */
  }

  return new Promise((resolve) => {
    const child = spawn(electronBin, [root, "--smoke-i18n"], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: "1",
        KEYCODE_SMOKE_I18N: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const finish = (why) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (!child.killed) child.kill();
      } catch {
        /* ignore */
      }
      fs.writeFileSync(logPath, out, "utf8");
      const fatal = [
        /Cannot find module/i,
        /ReferenceError/i,
        /SyntaxError/i,
        /TypeError:.*undefined/i,
        /Uncaught Exception/i,
        /is not a function/i,
        /\[smoke-i18n\] fail/i,
        /\[smoke-i18n\] renderer-error/i,
      ];
      const hits = fatal.filter((re) => re.test(out));
      if (hits.length) {
        for (const re of hits) fail(`electron log matched ${re}`);
        console.log("--- electron log (tail) ---");
        console.log(out.slice(-3000));
      } else if (!/\[smoke-i18n\] ok/.test(out)) {
        fail(`electron smoke incomplete (${why}); log tail:\n${out.slice(-2000)}`);
      } else {
        console.log("electron smoke: ok");
      }
      resolve();
    };

    const timer = setTimeout(() => finish("timeout"), 25000);

    const onData = (buf) => {
      out += buf.toString();
      if (/\[smoke-i18n\] ok/.test(out) || /\[smoke-i18n\] fail/.test(out)) {
        setTimeout(() => finish("done"), 300);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("exit", (code, signal) => {
      if (/\[smoke-i18n\] ok/.test(out)) finish("exit");
      else finish(`exit ${code} ${signal}`);
    });
  });
}

(async () => {
  try {
    await launchElectronSmoke();
  } catch (e) {
    fail(`electron launch: ${e.message || e}`);
  }
  if (errors.length) {
    console.error(`\n${errors.length} error(s)`);
    process.exit(1);
  }
  console.log("\nAll smoke checks passed");
})();
