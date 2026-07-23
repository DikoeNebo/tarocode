const { describe, it } = require("node:test");
const assert = require("assert/strict");
const {
  buildCdpLaunchArgs,
  buildShortcutTargetString,
  cdpPortFlag,
  cdpAddressFlag,
  ACCESSIBILITY_FLAG,
  DEFAULT_CDP_PORT,
  SHORTCUT_FILE_NAME,
} = require("../electron/cursor-setup");

describe("cursor CDP shortcut args", () => {
  it("includes port, bind address, and accessibility for mode both", () => {
    const args = buildCdpLaunchArgs({ mode: "both", cdpPort: 9222 });
    assert.ok(args.includes(ACCESSIBILITY_FLAG));
    assert.ok(args.includes(cdpPortFlag(9222)));
    assert.ok(args.includes(cdpAddressFlag()));
    assert.equal(cdpAddressFlag(), "--remote-debugging-address=127.0.0.1");
    assert.equal(DEFAULT_CDP_PORT, 9222);
  });

  it("uses custom cdpPort in flags", () => {
    const args = buildCdpLaunchArgs({ mode: "background", cdpPort: 9333 });
    assert.ok(args.includes("--remote-debugging-port=9333"));
    assert.ok(!args.includes(ACCESSIBILITY_FLAG));
  });

  it("builds Target-style shortcut string with quoted exe", () => {
    const args = buildCdpLaunchArgs({ mode: "both", cdpPort: 9222 });
    const target = buildShortcutTargetString(
      "C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe",
      args
    );
    assert.match(target, /^"C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe"/);
    assert.match(target, /--remote-debugging-port=9222/);
    assert.match(target, /--remote-debugging-address=127\.0\.0\.1/);
    assert.equal(SHORTCUT_FILE_NAME, "Cursor background.lnk");
  });
});
