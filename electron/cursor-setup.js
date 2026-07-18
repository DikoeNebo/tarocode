const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const ACCESSIBILITY_FLAG = "--force-renderer-accessibility=complete";
const DEFAULT_CDP_PORT = 9222;

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

/**
 * Launch Cursor. Never kills an existing Cursor.
 * @param {{ mode?: 'accessibility'|'background'|'both', cdpPort?: number }} opts
 */
async function launchCursorForIntegration(opts = {}) {
  const mode = opts.mode || "background";
  const cdpPort = Number(opts.cdpPort) || DEFAULT_CDP_PORT;
  const running = await isCursorRunning();
  if (running) {
    return {
      ok: false,
      alreadyRunning: true,
      error:
        "Cursor уже открыт. Закройте его сами (сохраните работу), затем нажмите «Запустить» снова.",
    };
  }
  const exe = await resolveCursorExe();
  if (!exe) {
    return {
      ok: false,
      error:
        "Cursor.exe не найден. Установите Cursor или откройте его один раз вручную.",
    };
  }
  if (!fs.existsSync(exe)) {
    return { ok: false, error: `Файл не найден: ${exe}` };
  }

  const args = [];
  if (mode === "accessibility" || mode === "both") {
    args.push(ACCESSIBILITY_FLAG);
  }
  if (mode === "background" || mode === "both") {
    args.push(cdpPortFlag(cdpPort));
  }
  if (!args.length) args.push(cdpPortFlag(cdpPort));

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
      "Не удалось запустить Cursor (доступ запрещён или блокировка). " +
      "Закройте Cursor вручную и откройте его из ярлыка с параметром:\n" +
      `${args.join(" ")}\n\n` +
      errors.join(" · "),
    exe,
    args,
  };
}

module.exports = {
  ACCESSIBILITY_FLAG,
  DEFAULT_CDP_PORT,
  isCursorRunning,
  resolveCursorExe,
  launchCursorForIntegration,
  cdpPortFlag,
};
