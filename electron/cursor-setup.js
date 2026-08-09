const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { t } = require("./i18n");

const execFileAsync = promisify(execFile);

const ACCESSIBILITY_FLAG = "--force-renderer-accessibility=complete";
const DEFAULT_CDP_PORT = 9222;
const SHORTCUT_FILE_NAME = "Cursor background.lnk";
const SHORTCUT_DESCRIPTION = "Cursor with CDP for Keycode background paste";

function candidateCursorPaths() {
  const local = process.env.LOCALAPPDATA || "";
  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    path.join(local, "Programs", "cursor", "Cursor.exe"),
    path.join(local, "cursor", "Cursor.exe"),
    path.join(pf, "Cursor", "Cursor.exe"),
    path.join(pf86, "Cursor", "Cursor.exe"),
  ];
}

async function findRunningCursorExe() {
  const script = `
$p = Get-Process -Name Cursor -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $p) { '' } else { try { $p.Path } catch { '' } }
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    const p = (stdout || "").trim();
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* ignore */
  }
  return null;
}

async function isCursorRunning() {
  const script = `@((Get-Process -Name Cursor -ErrorAction SilentlyContinue).Count)`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-Command", script],
      { windowsHide: true }
    );
    return Number((stdout || "").trim()) > 0;
  } catch {
    return false;
  }
}

async function resolveCursorExe() {
  const running = await findRunningCursorExe();
  if (running) return running;
  for (const p of candidateCursorPaths()) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function cdpPortFlag(port) {
  const p = Number(port) || DEFAULT_CDP_PORT;
  return `--remote-debugging-port=${p}`;
}

function cdpAddressFlag() {
  return "--remote-debugging-address=127.0.0.1";
}

/**
 * Build Chromium/Cursor args for CDP (+ optional accessibility).
 * Pure — safe for unit tests.
 * @param {{ mode?: 'accessibility'|'background'|'both', cdpPort?: number }} [opts]
 * @returns {string[]}
 */
function buildCdpLaunchArgs(opts = {}) {
  const mode = opts.mode || "both";
  const cdpPort = Number(opts.cdpPort) || DEFAULT_CDP_PORT;
  const args = [];
  if (mode === "accessibility" || mode === "both") {
    args.push(ACCESSIBILITY_FLAG);
  }
  if (mode === "background" || mode === "both") {
    args.push(cdpPortFlag(cdpPort));
    args.push(cdpAddressFlag());
  }
  if (!args.length) {
    args.push(cdpPortFlag(cdpPort));
    args.push(cdpAddressFlag());
  }
  return args;
}

/** Full Target-style string for .lnk / diagnostics (quoted exe + args). */
function buildShortcutTargetString(exe, args) {
  const exeQ = `"${String(exe || "").replace(/"/g, "")}"`;
  const argStr = (Array.isArray(args) ? args : []).join(" ");
  return argStr ? `${exeQ} ${argStr}` : exeQ;
}

function keycodeShortcutPaths() {
  const appData = process.env.APPDATA || "";
  const desktop = process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, "Desktop")
    : "";
  const startMenuDir = appData
    ? path.join(
        appData,
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "Keycode"
      )
    : "";
  return {
    startMenuDir,
    startMenu: startMenuDir
      ? path.join(startMenuDir, SHORTCUT_FILE_NAME)
      : "",
    desktop: desktop ? path.join(desktop, SHORTCUT_FILE_NAME) : "",
  };
}

/**
 * Create/update Start Menu + Desktop .lnk for Cursor with CDP flags.
 * Never modifies the official Cursor shortcut. Never kills Cursor.
 * @param {{ mode?: string, cdpPort?: number }} [opts]
 */
async function installCursorCdpShortcut(opts = {}) {
  const mode = opts.mode || "both";
  const cdpPort = Number(opts.cdpPort) || DEFAULT_CDP_PORT;
  const exe = await resolveCursorExe();
  if (!exe || !fs.existsSync(exe)) {
    return { ok: false, error: t("cursor.exeMissing") };
  }

  const args = buildCdpLaunchArgs({ mode, cdpPort });
  const argString = args.join(" ");
  const paths = keycodeShortcutPaths();
  if (!paths.startMenu && !paths.desktop) {
    return { ok: false, error: t("cursor.shortcutNoPaths") };
  }

  const workDir = path.dirname(exe);
  const created = [];

  async function writeLnk(lnkPath) {
    if (!lnkPath) return;
    const dir = path.dirname(lnkPath);
    fs.mkdirSync(dir, { recursive: true });
    const script = `
$ErrorActionPreference = 'Stop'
$W = New-Object -ComObject WScript.Shell
$S = $W.CreateShortcut(${psQuote(lnkPath)})
$S.TargetPath = ${psQuote(exe)}
$S.Arguments = ${psQuote(argString)}
$S.WorkingDirectory = ${psQuote(workDir)}
$S.IconLocation = ${psQuote(exe + ",0")}
$S.Description = ${psQuote(SHORTCUT_DESCRIPTION)}
$S.Save()
Write-Output 'OK'
`;
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 15000 }
    );
    if (!String(stdout || "").includes("OK")) {
      throw new Error(String(stdout || "CreateShortcut failed"));
    }
    if (!fs.existsSync(lnkPath)) {
      throw new Error("shortcut_missing_after_write");
    }
    created.push(lnkPath);
  }

  try {
    await writeLnk(paths.startMenu);
    await writeLnk(paths.desktop);
  } catch (e) {
    return {
      ok: false,
      error: t("cursor.shortcutFail", { err: String(e.message || e) }),
      exe,
      args,
    };
  }

  return {
    ok: true,
    exe,
    args,
    cdpPort,
    flag: argString,
    target: buildShortcutTargetString(exe, args),
    shortcuts: created,
    startMenu: paths.startMenu,
    desktop: paths.desktop,
    next: t("cursor.shortcutNext"),
  };
}

function psQuote(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

/**
 * Launch via PowerShell Start-Process — avoids Electron spawn EACCES on Cursor.exe.
 */
async function launchViaPowerShell(exe, args) {
  const argList =
    args.length > 0
      ? `@(${args.map((a) => psQuote(a)).join(",")})`
      : "@()";
  const script = `
$ErrorActionPreference = 'Stop'
$p = Start-Process -FilePath ${psQuote(exe)} -ArgumentList ${argList} -PassThru
if ($null -eq $p) { throw 'Start-Process returned null' }
Write-Output ('OK|' + $p.Id)
`;
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 15000 }
  );
  const line = String(stdout || "").trim();
  if (!line.startsWith("OK|")) {
    throw new Error(line || "Start-Process failed");
  }
  return { pid: Number(line.split("|")[1]) || 0 };
}

/**
 * Fallback: cmd start (detached).
 */
function launchViaCmdStart(exe, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cmdArgs = ["/c", "start", "", exe, ...args];
    const child = spawn("cmd.exe", cmdArgs, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      child.removeListener("error", onErr);
      child.removeListener("spawn", onSpawn);
      clearTimeout(timer);
      fn(value);
    };
    const onErr = (err) => finish(reject, err);
    const onSpawn = () => {
      try {
        child.unref();
      } catch {
        /* ignore */
      }
      finish(resolve, { pid: child.pid || 0 });
    };
    child.once("error", onErr);
    child.once("spawn", onSpawn);
    // Some Node versions don't emit 'spawn'; treat no immediate error as ok
    const timer = setTimeout(() => {
      if (!settled) onSpawn();
    }, 200);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Close Cursor processes. Soft CloseMainWindow first; after timeout, Stop-Process -Force.
 * Only call from an explicit user «Restart with CDP» action.
 * @param {{ forceAfterMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, method?: string, error?: string }>}
 */
async function closeCursorProcesses(opts = {}) {
  const forceAfterMs = Math.max(2000, Number(opts.forceAfterMs) || 10000);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$procs = @(Get-Process -Name Cursor -ErrorAction SilentlyContinue)
if ($procs.Count -eq 0) { Write-Output 'NONE'; exit 0 }
foreach ($p in $procs) { try { $null = $p.CloseMainWindow() } catch {} }
$deadline = [DateTime]::UtcNow.AddMilliseconds(${forceAfterMs})
while ([DateTime]::UtcNow -lt $deadline) {
  $left = @(Get-Process -Name Cursor -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) { Write-Output 'SOFT'; exit 0 }
  Start-Sleep -Milliseconds 400
}
Get-Process -Name Cursor -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 600
$left = @(Get-Process -Name Cursor -ErrorAction SilentlyContinue)
if ($left.Count -eq 0) { Write-Output 'FORCE'; exit 0 }
Write-Output 'FAIL'
exit 1
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: forceAfterMs + 8000 }
    );
    const line = String(stdout || "").trim().split(/\r?\n/).pop() || "";
    if (line === "NONE" || line === "SOFT" || line === "FORCE") {
      return { ok: true, method: line.toLowerCase() };
    }
    return { ok: false, error: t("cursor.restartCloseFail") };
  } catch {
    const still = await isCursorRunning();
    if (!still) return { ok: true, method: "force" };
    return { ok: false, error: t("cursor.restartCloseFail") };
  }
}

/**
 * Launch Cursor. Never kills an existing Cursor unless skipRunningCheck (after close).
 * @param {{ mode?: 'accessibility'|'background'|'both', cdpPort?: number, skipRunningCheck?: boolean }} opts
 */
async function launchCursorForIntegration(opts = {}) {
  const mode = opts.mode || "background";
  const cdpPort = Number(opts.cdpPort) || DEFAULT_CDP_PORT;
  if (!opts.skipRunningCheck) {
    const running = await isCursorRunning();
    if (running) {
      return {
        ok: false,
        alreadyRunning: true,
        needsRestart: true,
        error: t("cursor.alreadyOpen"),
      };
    }
  }
  const exe = await resolveCursorExe();
  if (!exe) {
    return {
      ok: false,
      error: t("cursor.exeMissing"),
    };
  }
  if (!fs.existsSync(exe)) {
    return { ok: false, error: t("cursor.fileMissing", { exe }) };
  }

  const args = buildCdpLaunchArgs({ mode, cdpPort });
  const errors = [];

  try {
    const r = await launchViaPowerShell(exe, args);
    return {
      ok: true,
      launched: true,
      exe,
      args,
      cdpPort,
      flag: args.join(" "),
      method: "powershell",
      pid: r.pid,
    };
  } catch (e) {
    errors.push(`powershell: ${e.message || e}`);
  }

  try {
    const r = await launchViaCmdStart(exe, args);
    return {
      ok: true,
      launched: true,
      exe,
      args,
      cdpPort,
      flag: args.join(" "),
      method: "cmd-start",
      pid: r.pid,
    };
  } catch (e) {
    errors.push(`cmd: ${e.message || e}`);
  }

  return {
    ok: false,
    error:
      t("cursor.launchDenied", { flag: args.join(" ") }) +
      "\n\n" +
      errors.join(" · "),
    exe,
    args,
  };
}

/**
 * Launch Cursor with CDP, or close+relaunch when allowRestart and Cursor is already open.
 * @param {{ mode?: string, cdpPort?: number, allowRestart?: boolean, forceAfterMs?: number }} [opts]
 */
async function launchOrRestartCursorWithCdp(opts = {}) {
  const mode = opts.mode || "both";
  const cdpPort = Number(opts.cdpPort) || DEFAULT_CDP_PORT;
  const allowRestart = opts.allowRestart === true;
  const running = await isCursorRunning();
  let restarted = false;
  let closeMethod = "";

  if (running) {
    if (!allowRestart) {
      return {
        ok: false,
        alreadyRunning: true,
        needsRestart: true,
        error: t("cursor.alreadyOpen"),
      };
    }
    const closed = await closeCursorProcesses({
      forceAfterMs: opts.forceAfterMs,
    });
    if (!closed.ok) {
      return {
        ok: false,
        alreadyRunning: true,
        needsRestart: true,
        error: closed.error || t("cursor.restartCloseFail"),
      };
    }
    restarted = true;
    closeMethod = closed.method || "";
    await sleep(700);
  }

  const result = await launchCursorForIntegration({
    mode,
    cdpPort,
    skipRunningCheck: true,
  });
  if (!result.ok) return result;
  return {
    ...result,
    restarted,
    closeMethod,
  };
}

module.exports = {
  ACCESSIBILITY_FLAG,
  DEFAULT_CDP_PORT,
  SHORTCUT_FILE_NAME,
  isCursorRunning,
  resolveCursorExe,
  closeCursorProcesses,
  launchCursorForIntegration,
  launchOrRestartCursorWithCdp,
  installCursorCdpShortcut,
  buildCdpLaunchArgs,
  buildShortcutTargetString,
  keycodeShortcutPaths,
  cdpPortFlag,
  cdpAddressFlag,
};
