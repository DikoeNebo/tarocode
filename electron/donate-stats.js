/**
 * Local donate click log + delayed stats (24h). Pure fs helpers for tests.
 */
const fs = require("fs");
const path = require("path");
const { atomicWriteJson } = require("./data-store");

const PURPOSES = new Set(["unknown", "coffee", "beer", "cats"]);
const METHODS = new Set(["tbank", "lava", "crypto"]);
const STATS_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLICKS = 5000;

function clicksPath(userDataDir) {
  return path.join(userDataDir, "donate-clicks.json");
}

function readClicks(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function normalizeClick(partial) {
  const purpose = PURPOSES.has(partial?.purpose) ? partial.purpose : null;
  const method = METHODS.has(partial?.method) ? partial.method : null;
  if (!purpose || !method) return null;
  return {
    purpose,
    method,
    at: new Date().toISOString(),
  };
}

function recordClick(filePath, partial) {
  const entry = normalizeClick(partial);
  if (!entry) return { ok: false, error: "invalid" };
  let list = readClicks(filePath);
  list.push(entry);
  if (list.length > MAX_CLICKS) list = list.slice(-MAX_CLICKS);
  atomicWriteJson(filePath, list);
  return { ok: true };
}

/**
 * Percentages by purpose from clicks at least STATS_DELAY_MS old.
 * @returns {{ total: number, percents: Record<string, number>, counts: Record<string, number> }}
 */
function computeStats(filePath, nowMs = Date.now()) {
  const counts = { unknown: 0, coffee: 0, beer: 0, cats: 0 };
  const list = readClicks(filePath);
  let total = 0;
  for (const c of list) {
    if (!PURPOSES.has(c?.purpose)) continue;
    const t = Date.parse(c.at);
    if (!Number.isFinite(t) || nowMs - t < STATS_DELAY_MS) continue;
    counts[c.purpose] += 1;
    total += 1;
  }
  const percents = { unknown: 0, coffee: 0, beer: 0, cats: 0 };
  if (total > 0) {
    for (const key of Object.keys(percents)) {
      percents[key] = Math.round((counts[key] / total) * 100);
    }
  }
  return { total, percents, counts };
}

function publicConfig(cfg) {
  return {
    tbankUrl: String(cfg.tbankUrl || "").trim(),
    lavaUrl: String(cfg.lavaUrl || "").trim(),
    cryptoNetwork: String(cfg.cryptoNetwork || "").trim(),
    cryptoAddress: String(cfg.cryptoAddress || "").trim(),
    hasTbank: Boolean(String(cfg.tbankUrl || "").trim()),
    hasLava: Boolean(String(cfg.lavaUrl || "").trim()),
    hasCrypto: Boolean(String(cfg.cryptoAddress || "").trim()),
  };
}

/** Allow openExternal only for configured https URLs. */
function resolveAllowedUrl(cfg, method) {
  const url =
    method === "tbank"
      ? String(cfg.tbankUrl || "").trim()
      : method === "lava"
        ? String(cfg.lavaUrl || "").trim()
        : "";
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  return url;
}

module.exports = {
  PURPOSES,
  METHODS,
  STATS_DELAY_MS,
  clicksPath,
  readClicks,
  recordClick,
  computeStats,
  publicConfig,
  resolveAllowedUrl,
};
