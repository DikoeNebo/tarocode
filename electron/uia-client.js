const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const DEFAULT_TIMEOUT_MS = 8000;
const RESTART_DELAY_MS = 400;

class UiaClient {
  constructor(helperPath) {
    this.helperPath = helperPath;
    this.proc = null;
    this.buf = "";
    this.pending = new Map();
    this.seq = 0;
    this.starting = null;
    this.dead = false;
  }

  ensureHelperPath() {
    if (!this.helperPath || !fs.existsSync(this.helperPath)) {
      throw new Error(`uia-helper.ps1 не найден: ${this.helperPath}`);
    }
  }

  start() {
    if (this.proc && !this.dead) return Promise.resolve();
    if (this.starting) return this.starting;
    this.ensureHelperPath();
    this.starting = new Promise((resolve, reject) => {
      this.dead = false;
      this.buf = "";
      const proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          this.helperPath,
        ],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        }
      );
      this.proc = proc;

      proc.stdout.setEncoding("utf8");
      proc.stderr.setEncoding("utf8");

      proc.stdout.on("data", (chunk) => this._onData(chunk));
      proc.stderr.on("data", () => {
        /* ignore noise; errors come as JSON */
      });
      proc.on("error", (err) => {
        this._failAll(String(err.message || err));
        this.dead = true;
        this.proc = null;
        this.starting = null;
        reject(err);
      });
      proc.on("exit", () => {
        this._failAll("UIA helper завершился");
        this.dead = true;
        this.proc = null;
        this.starting = null;
      });

      // Ready after process starts; ping to verify
      this.request("ping", {}, 4000)
        .then(() => {
          this.starting = null;
          resolve();
        })
        .catch((err) => {
          this.starting = null;
          reject(err);
        });
    });
    return this.starting;
  }

  _onData(chunk) {
    this.buf += chunk;
    let idx;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const id = msg && msg.id != null ? String(msg.id) : null;
      if (!id || !this.pending.has(id)) continue;
      const entry = this.pending.get(id);
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.resolve(msg);
    }
  }

  _failAll(error) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(error));
    }
    this.pending.clear();
  }

  async request(cmd, payload = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.proc || this.dead) {
      try {
        await this.start();
      } catch (e) {
        // one restart attempt after crash
        await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));
        await this.start();
      }
    }
    const id = String(++this.seq);
    const line = JSON.stringify({ id, cmd, ...payload }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`UIA timeout: ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(line, "utf8");
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        this.dead = true;
        reject(err);
      }
    });
  }

  async probe(hwnd) {
    return this.request("probe", { hwnd: hwnd ? String(hwnd) : undefined }, 10000);
  }

  async diagnose(hwnd) {
    return this.request("diagnose", { hwnd: hwnd ? String(hwnd) : undefined }, 10000);
  }

  async elementFromPoint(x, y, role = "any") {
    return this.request(
      "elementFromPoint",
      { x: Math.round(x), y: Math.round(y), role },
      6000
    );
  }

  async listChats(hwnd) {
    return this.request("listChats", { hwnd: String(hwnd) }, 10000);
  }

  async selectChat(hwnd, locator) {
    return this.request(
      "selectChat",
      { hwnd: String(hwnd), locator },
      8000
    );
  }

  async focusInput(hwnd, locator) {
    return this.request(
      "focusInput",
      { hwnd: String(hwnd), locator },
      8000
    );
  }

  async quit() {
    if (!this.proc || this.dead) return;
    try {
      await this.request("quit", {}, 2000);
    } catch {
      /* ignore */
    }
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
    this.proc = null;
    this.dead = true;
  }
}

let singleton = null;

function getUiaClient() {
  if (!singleton) {
    const helperPath = path.join(__dirname, "uia-helper.ps1");
    singleton = new UiaClient(helperPath);
  }
  return singleton;
}

module.exports = { UiaClient, getUiaClient };
