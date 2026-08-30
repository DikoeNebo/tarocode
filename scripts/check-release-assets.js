/**
 * Prebuild check: bundled decks + tarot images referenced by decks exist.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const i18n = require("../electron/i18n");
i18n.setPacksRoot(root);

const decks = [];
for (const id of i18n.STOCK_DECK_IDS) {
  decks.push(path.join(root, "data", "locales", "en", `${id}.json`));
}
decks.push(path.join(root, "data", "default-deck.json"));
decks.push(path.join(root, "data", "pro-deck.json"));
const tarotDir = path.join(root, "assets", "tarot");

let failed = false;

function fail(msg) {
  console.error(`[check] ${msg}`);
  failed = true;
}

for (const file of decks) {
  if (!fs.existsSync(file)) {
    fail(`missing deck: ${file}`);
    continue;
  }
  let deck;
  try {
    deck = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`bad json ${file}: ${e.message}`);
    continue;
  }
  if (!deck.id || !Array.isArray(deck.cards) || !deck.cards.length) {
    fail(`invalid deck content: ${file}`);
    continue;
  }
  if (deck.cards.length > 9) fail(`too many cards in ${file}`);
  for (const card of deck.cards) {
    const img = `${card.image || "magician"}.jpg`;
    const p = path.join(tarotDir, img);
    if (!fs.existsSync(p)) fail(`missing tarot image for ${card.id}: ${img}`);
  }
  console.log(`[check] ok ${path.basename(file)} (${deck.cards.length} cards)`);
}

const jpgCount = fs.existsSync(tarotDir)
  ? fs.readdirSync(tarotDir).filter((f) => f.endsWith(".jpg")).length
  : 0;
if (jpgCount < 20) fail(`expected many tarot jpgs, found ${jpgCount}`);
else console.log(`[check] tarot images: ${jpgCount}`);

if (failed) {
  process.exit(1);
}
console.log("[check] release assets ok");
