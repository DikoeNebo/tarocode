const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  recordClick,
  computeStats,
  resolveAllowedUrl,
  publicConfig,
  STATS_DELAY_MS,
} = require("../electron/donate-stats");

describe("donate-stats", () => {
  it("records clicks and ignores fresh ones in stats", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "donate-"));
    const file = path.join(dir, "donate-clicks.json");
    assert.equal(recordClick(file, { purpose: "coffee", method: "lava" }).ok, true);
    const fresh = computeStats(file);
    assert.equal(fresh.total, 0);
    const old = [
      {
        purpose: "coffee",
        method: "lava",
        at: new Date(Date.now() - STATS_DELAY_MS - 1000).toISOString(),
      },
      {
        purpose: "beer",
        method: "tbank",
        at: new Date(Date.now() - STATS_DELAY_MS - 2000).toISOString(),
      },
      {
        purpose: "coffee",
        method: "crypto",
        at: new Date(Date.now() - STATS_DELAY_MS - 3000).toISOString(),
      },
    ];
    fs.writeFileSync(file, JSON.stringify(old), "utf8");
    const stats = computeStats(file);
    assert.equal(stats.total, 3);
    assert.equal(stats.percents.coffee, 67);
    assert.equal(stats.percents.beer, 33);
    assert.equal(stats.percents.cats, 0);
  });

  it("only allows https configured pay urls", () => {
    const cfg = {
      tbankUrl: "https://www.tbank.ru/cf/x",
      lavaUrl: "http://insecure.example/",
    };
    assert.equal(resolveAllowedUrl(cfg, "tbank"), cfg.tbankUrl);
    assert.equal(resolveAllowedUrl(cfg, "lava"), null);
    assert.equal(resolveAllowedUrl(cfg, "crypto"), null);
  });

  it("publicConfig flags empty links", () => {
    const p = publicConfig({ tbankUrl: "  ", lavaUrl: "https://lava.top/x", cryptoAddress: "Txx" });
    assert.equal(p.hasTbank, false);
    assert.equal(p.hasLava, true);
    assert.equal(p.hasCrypto, true);
  });
});
