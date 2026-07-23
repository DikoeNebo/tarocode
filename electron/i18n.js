/**
 * Locale resolve + message packs for main process.
 * UI JSON: src/i18n/ui/{locale}.json
 * Tarot JSON: src/i18n/tarot/{locale}.json
 * Bundled decks: data/locales/{locale}/{lazy-v1|pro-v1}.json
 */
const fs = require("fs");
const path = require("path");

const SUPPORTED = [
  "en",
  "ru",
  "uk",
  "de",
  "es",
  "fr",
  "pt-BR",
  "zh-CN",
  "ja",
  "pl",
];

const SUPPORTED_SET = new Set(SUPPORTED);

/** Native labels for language dropdowns */
const LOCALE_LABELS = {
  en: "English",
  ru: "Русский",
  uk: "Українська",
  de: "Deutsch",
  es: "Español",
  fr: "Français",
  "pt-BR": "Português (Brasil)",
  "zh-CN": "简体中文",
  ja: "日本語",
  pl: "Polski",
};

const cache = {
  ui: new Map(),
  tarot: new Map(),
};

let activeUiLocale = "en";
let packsRoot = null;

function setPacksRoot(root) {
  packsRoot = root;
  cache.ui.clear();
  cache.tarot.clear();
}

function rootDir() {
  return packsRoot || path.join(__dirname, "..");
}

function uiDir() {
  return path.join(rootDir(), "src", "i18n", "ui");
}

function tarotDir() {
  return path.join(rootDir(), "src", "i18n", "tarot");
}

function localesDataDir() {
  return path.join(rootDir(), "data", "locales");
}

function normalizeTag(tag) {
  const s = String(tag || "").trim().replace(/_/g, "-");
  if (!s) return "";
  if (SUPPORTED_SET.has(s)) return s;
  const lower = s.toLowerCase();
  for (const code of SUPPORTED) {
    if (code.toLowerCase() === lower) return code;
  }
  const base = s.split("-")[0].toLowerCase();
  const mapped = { zh: "zh-CN", pt: "pt-BR" }[base];
  if (mapped && SUPPORTED_SET.has(mapped)) return mapped;
  for (const code of SUPPORTED) {
    if (code.toLowerCase() === base || code.toLowerCase().startsWith(`${base}-`)) {
      return code;
    }
  }
  return "";
}

/**
 * @param {string} preference settings.uiLocale ("system" or locale)
 * @param {string} systemLocale app.getLocale()
 */
function resolveUiLocale(preference, systemLocale) {
  if (preference && preference !== "system") {
    const forced = normalizeTag(preference);
    if (forced) return forced;
  }
  const fromOs = normalizeTag(systemLocale);
  return fromOs || "en";
}

/**
 * @param {string} preference settings.arcanaLocale ("en" | "ui" | locale)
 * @param {string} uiLocale resolved UI locale
 */
function resolveArcanaLocale(preference, uiLocale) {
  if (preference === "ui") return uiLocale || "en";
  const forced = normalizeTag(preference);
  if (forced) return forced;
  return "en";
}

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadUiMessages(locale) {
  const code = normalizeTag(locale) || "en";
  if (cache.ui.has(code)) return cache.ui.get(code);
  let data = loadJson(path.join(uiDir(), `${code}.json`));
  if (!data && code !== "en") {
    data = loadJson(path.join(uiDir(), "en.json"));
  }
  const messages = data && typeof data === "object" ? data : {};
  cache.ui.set(code, messages);
  return messages;
}

function loadTarotNames(locale) {
  const code = normalizeTag(locale) || "en";
  if (cache.tarot.has(code)) return cache.tarot.get(code);
  let data = loadJson(path.join(tarotDir(), `${code}.json`));
  if (!data && code !== "en") {
    data = loadJson(path.join(tarotDir(), "en.json"));
  }
  const names = data && typeof data === "object" ? data : {};
  cache.tarot.set(code, names);
  return names;
}

function setActiveUiLocale(locale) {
  activeUiLocale = normalizeTag(locale) || "en";
}

function getActiveUiLocale() {
  return activeUiLocale;
}

function formatMessage(template, vars) {
  let s = String(template ?? "");
  if (!vars || typeof vars !== "object") return s;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v ?? ""));
  }
  return s;
}

function t(key, vars, locale = activeUiLocale) {
  const messages = loadUiMessages(locale);
  const fallback = locale === "en" ? null : loadUiMessages("en");
  const template =
    (messages && messages[key]) || (fallback && fallback[key]) || key;
  return formatMessage(template, vars);
}

function tarotLabel(id, locale) {
  const pack = loadTarotNames(locale);
  const entry = pack.cards && pack.cards[id];
  if (entry) return entry;
  const en = loadTarotNames("en");
  return (en.cards && en.cards[id]) || id;
}

function tarotGroupLabel(groupId, locale) {
  const pack = loadTarotNames(locale);
  if (pack.groups && pack.groups[groupId]) return pack.groups[groupId];
  const en = loadTarotNames("en");
  return (en.groups && en.groups[groupId]) || groupId;
}

function bundledDeckPath(locale, deckId) {
  const code = normalizeTag(locale) || "en";
  const primary = path.join(localesDataDir(), code, `${deckId}.json`);
  if (fs.existsSync(primary)) return primary;
  const en = path.join(localesDataDir(), "en", `${deckId}.json`);
  if (fs.existsSync(en)) return en;
  // legacy fallbacks at data/
  if (deckId === "lazy-v1") {
    const legacy = path.join(rootDir(), "data", "default-deck.json");
    if (fs.existsSync(legacy)) return legacy;
  }
  if (deckId === "pro-v1") {
    const legacy = path.join(rootDir(), "data", "pro-deck.json");
    if (fs.existsSync(legacy)) return legacy;
  }
  return primary;
}

function localeOptions() {
  return SUPPORTED.map((code) => ({
    code,
    label: LOCALE_LABELS[code] || code,
  }));
}

function buildI18nPayload(settings, systemLocale) {
  const uiLocale = resolveUiLocale(settings?.uiLocale ?? "system", systemLocale);
  const arcanaLocale = resolveArcanaLocale(
    settings?.arcanaLocale ?? "en",
    uiLocale
  );
  setActiveUiLocale(uiLocale);
  return {
    uiLocale,
    arcanaLocale,
    uiLocalePref: settings?.uiLocale ?? "system",
    arcanaLocalePref: settings?.arcanaLocale ?? "en",
    messages: loadUiMessages(uiLocale),
    tarot: loadTarotNames(arcanaLocale),
    locales: localeOptions(),
  };
}

module.exports = {
  SUPPORTED,
  LOCALE_LABELS,
  setPacksRoot,
  normalizeTag,
  resolveUiLocale,
  resolveArcanaLocale,
  loadUiMessages,
  loadTarotNames,
  setActiveUiLocale,
  getActiveUiLocale,
  t,
  tarotLabel,
  tarotGroupLabel,
  bundledDeckPath,
  localeOptions,
  buildI18nPayload,
  formatMessage,
};
