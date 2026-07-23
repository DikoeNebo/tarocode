const fs = require("fs");
const path = require("path");
const i18n = require("../electron/i18n");

i18n.setPacksRoot(path.join(__dirname, ".."));

const enUi = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../src/i18n/ui/en.json"), "utf8")
);
const enKeys = Object.keys(enUi);
for (const code of i18n.SUPPORTED) {
  const j = JSON.parse(
    fs.readFileSync(path.join(__dirname, `../src/i18n/ui/${code}.json`), "utf8")
  );
  const missing = enKeys.filter((k) => !(k in j));
  if (missing.length) console.log("UI missing", code, missing.slice(0, 5));
}

const tarotJs = fs.readFileSync(path.join(__dirname, "../src/tarot.js"), "utf8");
const ids = [...tarotJs.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
for (const code of i18n.SUPPORTED) {
  const t = i18n.loadTarotNames(code);
  const missing = ids.filter((id) => !t.cards?.[id]);
  if (missing.length) console.log("tarot missing", code, missing);
  else if (Object.keys(t.cards).length !== 78) {
    console.log("tarot count", code, Object.keys(t.cards).length);
  }
}

for (const code of i18n.SUPPORTED) {
  for (const id of ["lazy-v1", "pro-v1"]) {
    const p = i18n.bundledDeckPath(code, id);
    const d = JSON.parse(fs.readFileSync(p, "utf8"));
    if (d.id !== id || !Array.isArray(d.cards) || d.cards.length < 1) {
      console.log("deck bad", code, id);
    }
  }
}

i18n.setActiveUiLocale("ru");
console.log("sample:", i18n.t("settings.title"), "/", i18n.t("lang.system"));
console.log("resolve it →", i18n.resolveUiLocale("system", "it-IT"));
console.log("check-i18n ok");
