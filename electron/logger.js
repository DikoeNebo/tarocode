/**
 * Rotating diagnostic log under userData. Never log prompt/chat text.
 */
const fs = require("fs");
const path = require("path");

const MAX_BYTES = 512 * 1024;
const KEEP_LINES = 2000;

let logDir = null;
let logFile = null;

function initLogger(userDataRoot) {
  logDir = path.join(userDataRoot, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "keycode.log");
  return logDir;
}

function getLogDir() {
  return logDir;
}

function rotateIfNeeded() {
  if (!logFile || !fs.existsSync(logFile)) return;
  try {
    const st = fs.statSync(logFile);
    if (st.size < MAX_BYTES) return;
    const text = fs.readFileSync(logFile, "utf8");
    const lines = text.split(/\r?\n/);
    const kept = lines.slice(-KEEP_LINES).join("\n");
    fs.writeFileSync(logFile, kept + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

function write(level, message, meta) {
  if (!logFile) return;
  try {
    rotateIfNeeded();
    const ts = new Date().toISOString();
    let line = `[${ts}] ${level} ${String(message || "")}`;
    if (meta != null) {
      const safe =
        typeof meta === "string"
          ? meta.slice(0, 500)
          : JSON.stringify(meta).slice(0, 500);
      line += ` ${safe}`;
    }
    fs.appendFileSync(logFile, line + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

function info(msg, meta) {
  write("INFO", msg, meta);
}

function warn(msg, meta) {
  write("WARN", msg, meta);
  console.warn("[keycode]", msg, meta || "");
}

function error(msg, meta) {
  write("ERROR", msg, meta);
  console.error("[keycode]", msg, meta || "");
}

module.exports = {
  initLogger,
  getLogDir,
  info,
  warn,
  error,
};
