/**
 * Local GigaAM Multilingual STT via gigastt sidecar.
 * Variant ml_ctc (~225 MB INT8): ru / en / kk / ky / uz.
 * Keeps a warm `gigastt serve` on loopback so each utterance skips model reload.
 * First use downloads Windows binary + model into userData.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const { createWriteStream } = require("fs");
const { pipeline } = require("stream/promises");

const execFileAsync = promisify(execFile);

const GIGASTT_VERSION = "2.18.0";
const MODEL_VARIANT = "ml_ctc";
/** Fixed Keycode-only port — avoids clashing with a user's default 9876 serve. */
const SERVE_PORT = 18976;
const CLI_TAR = `https://github.com/ekhodzitsky/gigastt/releases/download/v${GIGASTT_VERSION}/gigastt-${GIGASTT_VERSION}-x86_64-pc-windows-msvc.tar.gz`;

/** Files that mean ml_ctc is ready (encoder-only + vocab). */
const MODEL_FILES = [
  "multilingual_ctc.int8.onnx",
  "multilingual_vocab.txt",
];

/** @type {Promise<void> | null} */
let ensurePromise = null;
/** @type {import("child_process").ChildProcess | null} */
let serveProc = null;
/** @type {Promise<void> | null} */
let serveStartPromise = null;

function killServeProc() {
  const proc = serveProc;
  serveProc = null;
  if (!proc || proc.exitCode != null) return;
  try {
    if (process.platform === "win32" && proc.pid) {
      execFile(
        "taskkill",
        ["/pid", String(proc.pid), "/T", "/F"],
        { windowsHide: true },
        () => {}
      );
    } else {
      proc.kill("SIGTERM");
    }
  } catch {
    /* ignore */
  }
}

function stopGigaamServe() {
  serveStartPromise = null;
  killServeProc();
}

/**
 * Start (or reuse) local gigastt HTTP server with model already loaded.
 * @param {string} userDataPath
 */
async function ensureGigaamServe(userDataPath) {
  if (await serveIsReady()) return;
  if (serveStartPromise) {
    await serveStartPromise;
    if (await serveIsReady()) return;
  }
  serveStartPromise = (async () => {
    await ensureGigaamReady(userDataPath);
    if (await serveIsReady()) return;
    killServeProc();
    const child = spawn(
      exePath(userDataPath),
      [
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(SERVE_PORT),
        "--offline",
        "--model-dir",
        modelDir(userDataPath),
        "--model-variant",
        MODEL_VARIANT,
        "--punctuation",
        "off",
        "--itn",
        "off",
        "--profile",
        "edge",
        "--pool-size",
        "1",
      ],
      {
        windowsHide: true,
        stdio: "ignore",
      }
    );
    serveProc = child;
    child.on("exit", () => {
      if (serveProc === child) serveProc = null;
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        throw new Error("gigaam_serve_exited");
      }
      if (await serveIsReady()) return;
      await sleep(250);
    }
    killServeProc();
    throw new Error("gigaam_serve_not_ready");
  })();
  try {
    await serveStartPromise;
  } finally {
    serveStartPromise = null;
  }
}

function binDir(userDataPath) {
  return path.join(String(userDataPath || ""), "gigastt-bin");
}

function modelDir(userDataPath) {
  // Separate folder from older Russian-only rnnt install.
  return path.join(String(userDataPath || ""), "gigastt-models-ml-ctc");
}

function exePath(userDataPath) {
  return path.join(binDir(userDataPath), "gigastt.exe");
}

function modelReady(userDataPath) {
  const dir = modelDir(userDataPath);
  return MODEL_FILES.every((f) => {
    try {
      return fs.statSync(path.join(dir, f)).size > 0;
    } catch {
      return false;
    }
  });
}

function binaryReady(userDataPath) {
  try {
    return fs.statSync(exePath(userDataPath)).size > 1_000_000;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "user-agent": "keycode-gigastt" } },
      (res) => {
        const code = res.statusCode || 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          httpsGet(res.headers.location).then(resolve, reject);
          return;
        }
        if (code !== 200) {
          res.resume();
          reject(new Error(`HTTP ${code} for ${url}`));
          return;
        }
        resolve(res);
      }
    );
    req.on("error", reject);
  });
}

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  try {
    const res = await httpsGet(url);
    await pipeline(res, createWriteStream(tmp));
    fs.renameSync(tmp, dest);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function findFileRecursive(root, name) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.name.toLowerCase() === name.toLowerCase()) return full;
    }
  }
  return null;
}

async function ensureBinary(userDataPath) {
  if (binaryReady(userDataPath)) return;
  const smokeExe = path.join(
    process.env.TEMP || os.tmpdir(),
    "keycode-gigastt-smoke",
    "cli",
    "gigastt.exe"
  );
  if (fs.existsSync(smokeExe) && fs.statSync(smokeExe).size > 1_000_000) {
    fs.mkdirSync(binDir(userDataPath), { recursive: true });
    fs.copyFileSync(smokeExe, exePath(userDataPath));
    if (binaryReady(userDataPath)) return;
  }
  const dir = binDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  const tarPath = path.join(dir, "gigastt.tar.gz");
  await downloadFile(CLI_TAR, tarPath);
  await execFileAsync("tar", ["-xzf", tarPath, "-C", dir], {
    windowsHide: true,
    timeout: 120000,
  });
  try {
    fs.unlinkSync(tarPath);
  } catch {
    /* ignore */
  }
  if (!binaryReady(userDataPath)) {
    const found = findFileRecursive(dir, "gigastt.exe");
    if (found && found !== exePath(userDataPath)) {
      fs.copyFileSync(found, exePath(userDataPath));
    }
  }
  if (!binaryReady(userDataPath)) {
    throw new Error("gigastt_binary_missing");
  }
}

async function ensureModel(userDataPath) {
  if (modelReady(userDataPath)) return;
  await ensureBinary(userDataPath);
  const dir = modelDir(userDataPath);
  fs.mkdirSync(dir, { recursive: true });
  // Official download path (HF INT8 encoder + vocab).
  await execFileAsync(
    exePath(userDataPath),
    [
      "download",
      "--model-dir",
      dir,
      "--model-variant",
      MODEL_VARIANT,
      "--skip-diarization",
    ],
    {
      windowsHide: true,
      timeout: 600000,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    }
  );
  if (!modelReady(userDataPath)) {
    throw new Error("gigastt_model_missing");
  }
}

function ensureGigaamReady(userDataPath) {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await ensureBinary(userDataPath);
      await ensureModel(userDataPath);
    })().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

/**
 * @param {string} method
 * @param {string} urlPath
 * @param {Buffer | null} body
 * @param {Record<string, string>} headers
 * @param {number} timeoutMs
 */
function httpLocal(method, urlPath, body, headers = {}, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: SERVE_PORT,
        path: urlPath,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("gigaam_http_timeout"));
    });
    req.on("error", reject);
    if (body && body.length) req.write(body);
    req.end();
  });
}

async function serveIsReady() {
  try {
    const res = await httpLocal("GET", "/ready", null, {}, 2000);
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Drop leading/trailing quiet frames so inference sees less empty audio.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
function trimSilence(samples, sampleRate = 16000) {
  if (!samples?.length) return samples;
  const frame = Math.max(1, Math.floor(sampleRate * 0.02));
  const thresh = 0.012;
  const pad = Math.floor(sampleRate * 0.05);
  let first = -1;
  let last = -1;
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let energy = 0;
    for (let j = 0; j < frame; j++) {
      const v = samples[i + j];
      energy += v * v;
    }
    if (Math.sqrt(energy / frame) >= thresh) {
      if (first < 0) first = i;
      last = i + frame;
    }
  }
  if (first < 0) return samples;
  const a = Math.max(0, first - pad);
  const b = Math.min(samples.length, last + pad);
  return samples.subarray(a, b);
}

function pcmToWavBuffer(float32Samples, sampleRate = 16000) {
  const samples =
    float32Samples instanceof Float32Array
      ? float32Samples
      : new Float32Array(float32Samples);
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    buffer.writeInt16LE(s, 44 + i * 2);
  }
  return buffer;
}

function writePcm16WavFile(filePath, float32Samples, sampleRate = 16000) {
  fs.writeFileSync(filePath, pcmToWavBuffer(float32Samples, sampleRate));
}

function parseTranscriptBody(body) {
  const raw = String(body || "").trim();
  if (!raw) return "";
  if (raw.startsWith("{")) {
    try {
      const j = JSON.parse(raw);
      const t = j?.text ?? j?.transcript ?? j?.result;
      if (typeof t === "string" && t.trim()) return t.trim();
    } catch {
      /* fall through */
    }
  }
  // CLI -f txt can mix log lines into stdout — keep the last non-log line.
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^\d{4}-\d{2}-\d{2}T/.test(l))
    .filter((l) => !/\b(INFO|WARN|DEBUG|ERROR)\b/i.test(l));
  return lines.pop() || "";
}

/**
 * @param {Float32Array} audio
 * @param {number} sampleRate
 */
async function transcribeViaServe(audio, sampleRate) {
  const wav = pcmToWavBuffer(audio, sampleRate);
  const res = await httpLocal(
    "POST",
    "/v1/transcribe",
    wav,
    {
      "content-type": "application/octet-stream",
      "content-length": String(wav.length),
    },
    90000
  );
  if (res.status === 503) {
    throw new Error("gigaam_serve_busy");
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`gigaam_http_${res.status}`);
  }
  const text = parseTranscriptBody(res.body);
  if (!text) {
    const err = new Error("no_speech");
    err.hint = "no_speech";
    throw err;
  }
  return text;
}

/**
 * @param {Float32Array} audio
 * @param {string} userDataPath
 * @param {number} sampleRate
 */
async function transcribeViaCli(audio, userDataPath, sampleRate) {
  const tmpWav = path.join(
    os.tmpdir(),
    `keycode-gigaam-${process.pid}-${Date.now()}.wav`
  );
  try {
    writePcm16WavFile(tmpWav, audio, sampleRate);
    const { stdout, stderr } = await execFileAsync(
      exePath(userDataPath),
      [
        "transcribe",
        "--offline",
        "--model-dir",
        modelDir(userDataPath),
        "--model-variant",
        MODEL_VARIANT,
        "--punctuation",
        "off",
        "--itn",
        "off",
        "-f",
        "txt",
        tmpWav,
      ],
      {
        windowsHide: true,
        timeout: 120000,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    const text = parseTranscriptBody(stdout);
    if (!text) {
      const err = new Error(String(stderr || "no_speech").slice(0, 200));
      err.hint = "no_speech";
      throw err;
    }
    return text;
  } finally {
    try {
      fs.unlinkSync(tmpWav);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {Float32Array | ArrayBuffer | number[]} samples
 * @param {{ userDataPath?: string, sampleRate?: number }} opts
 */
async function transcribeGigaam(samples, opts = {}) {
  const userDataPath = opts.userDataPath || "";
  const sampleRate = Number(opts.sampleRate) || 16000;
  let audio;
  if (samples instanceof Float32Array) {
    audio = samples;
  } else if (samples instanceof ArrayBuffer) {
    audio = new Float32Array(samples);
  } else if (ArrayBuffer.isView(samples)) {
    audio = new Float32Array(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength / 4
    );
  } else if (Array.isArray(samples)) {
    audio = Float32Array.from(samples);
  } else {
    return { ok: false, error: "bad_audio", hint: "bad_audio" };
  }
  if (!audio.length) {
    return { ok: false, error: "no_speech", hint: "no_speech" };
  }

  audio = trimSilence(audio, sampleRate);
  if (!audio.length) {
    return { ok: false, error: "no_speech", hint: "no_speech" };
  }

  try {
    await ensureGigaamReady(userDataPath);
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e || "gigaam_setup_failed").slice(0, 240),
      hint: "gigaam_setup_failed",
    };
  }

  try {
    await ensureGigaamServe(userDataPath);
    const text = await transcribeViaServe(audio, sampleRate);
    return { ok: true, text, engine: "gigaam", variant: MODEL_VARIANT };
  } catch (serveErr) {
    if (serveErr?.hint === "no_speech" || serveErr?.message === "no_speech") {
      return { ok: false, error: "no_speech", hint: "no_speech" };
    }
    try {
      const text = await transcribeViaCli(audio, userDataPath, sampleRate);
      return { ok: true, text, engine: "gigaam", variant: MODEL_VARIANT };
    } catch (e) {
      return {
        ok: false,
        error: String(
          e?.stderr || e?.message || serveErr?.message || e || "gigaam_failed"
        ).slice(0, 240),
        hint: e?.hint === "no_speech" ? "no_speech" : "gigaam_failed",
      };
    }
  }
}

module.exports = {
  GIGASTT_VERSION,
  MODEL_VARIANT,
  SERVE_PORT,
  ensureGigaamReady,
  ensureGigaamServe,
  stopGigaamServe,
  transcribeGigaam,
  writePcm16WavFile,
  trimSilence,
  modelDir,
  modelReady,
  binaryReady,
};
