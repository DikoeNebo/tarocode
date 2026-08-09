/**
 * Opt-in phone remote: HTTP + SSE.
 * Default access: LAN (bind 0.0.0.0) + Keycode bearer token.
 * Optional later: Tailscale Serve (identity header + token).
 * Never log prompt/chat text.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { DEFAULT_REMOTE_PORT } = require("./data-store");

const BIND_LOOPBACK = "127.0.0.1";
const BIND_LAN = "0.0.0.0";
const MAX_BODY = 48 * 1024;
/** Max characters for phone free-text paste (UTF-16 length). */
const MAX_PASTE_TEXT = 20000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const SSE_POLL_MS = 1500;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function generateRemoteToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function extractBearer(req) {
  const h = String(req.headers["authorization"] || "");
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (m) return m[1].trim();
  const alt = String(req.headers["x-keycode-token"] || "").trim();
  return alt || "";
}

function hasTailscaleIdentity(req) {
  const login = String(req.headers["tailscale-user-login"] || "").trim();
  return login.length > 0;
}

function isLoopbackRemote(req) {
  const ra = String(req.socket?.remoteAddress || "");
  return ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1";
}

function normalizeAccessMode(mode) {
  return String(mode || "lan").toLowerCase() === "tailscale" ? "tailscale" : "lan";
}

function bindHostForMode(mode) {
  return normalizeAccessMode(mode) === "tailscale" ? BIND_LOOPBACK : BIND_LAN;
}

function generationTransition(previous, current) {
  if (typeof current !== "boolean") {
    return { next: previous, changed: false, completed: false };
  }
  if (typeof previous !== "boolean") {
    return { next: current, changed: false, completed: false };
  }
  return {
    next: current,
    changed: previous !== current,
    completed: previous === true && current === false,
  };
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  const rel = decoded.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!rel || rel.includes("\0") || rel.split("/").some((p) => p === "..")) {
    return null;
  }
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, rel);
  const prefix = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  if (full !== rootAbs && !full.startsWith(prefix)) return null;
  return full;
}

/**
 * @param {object} opts
 * @param {() => string} opts.getToken
 * @param {() => number} opts.getPort
 * @param {() => string} [opts.getAccessMode] — "lan" (default) | "tailscale"
 * @param {() => object} opts.getRemoteState — cards without prompts
 * @param {() => Promise<object>} [opts.listChats] — live Cursor chats from CDP
 * @param {(targetId: string, opts?: object) => Promise<object>} opts.readChat
 * @param {(cardId: string, targetId: string) => Promise<object>} opts.pasteCard
 * @param {(text: string, targetId: string) => Promise<object>} [opts.pasteText]
 * @param {(targetId: string, mode: string) => Promise<object>} [opts.setComposerMode]
 * @param {(targetId: string, model: string) => Promise<object>} [opts.setComposerModel]
 * @param {(targetId: string, payload: object) => Promise<object>} [opts.answerClarification]
 * @param {string} opts.staticDir
 * @param {string} opts.tarotDir
 * @param {(level: string, msg: string, meta?: object) => void} [opts.log]
 * @param {boolean} [opts.allowLoopbackWithoutTailscale] — local diagnose / KEYCODE_REMOTE_DEV (tailscale mode)
 * @param {number} [opts.pollMs] — tests only; production uses SSE_POLL_MS
 */
function createRemoteServer(opts) {
  const log = opts.log || (() => {});
  const staticDir = opts.staticDir;
  const tarotDir = opts.tarotDir;
  /** @type {import('http').Server | null} */
  let server = null;
  /** @type {Set<import('http').ServerResponse>} */
  const sseClients = new Set();
  /** @type {Map<string, { count: number, reset: number }>} */
  const rateMap = new Map();
  let pollTimer = null;
  let lastHashByTarget = new Map();
  let listeningPort = 0;
  let boundHost = BIND_LAN;

  function accessMode() {
    return normalizeAccessMode(opts.getAccessMode?.() || "lan");
  }

  function rateOk(key) {
    const now = Date.now();
    let row = rateMap.get(key);
    if (!row || now > row.reset) {
      row = { count: 0, reset: now + RATE_WINDOW_MS };
      rateMap.set(key, row);
    }
    row.count += 1;
    return row.count <= RATE_MAX;
  }

  function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(data),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(data);
  }

  function unauthorized(res, reason) {
    sendJson(res, 401, { ok: false, error: "unauthorized", reason });
  }

  function authorize(req, res) {
    const token = String(opts.getToken() || "");
    if (!token) {
      unauthorized(res, "token_missing");
      return false;
    }
    const presented = extractBearer(req);
    if (!presented || !timingSafeEqualStr(presented, token)) {
      unauthorized(res, "bad_token");
      return false;
    }
    const mode = accessMode();
    // LAN: bearer token is enough (same Wi-Fi). Tailscale mode also needs identity
    // (blocks Funnel); DEV/loopback bypass only in tailscale mode.
    if (mode === "lan") {
      return true;
    }
    if (hasTailscaleIdentity(req)) {
      return true;
    }
    const allowLoop =
      opts.allowLoopbackWithoutTailscale === true ||
      process.env.KEYCODE_REMOTE_DEV === "1";
    if (allowLoop && isLoopbackRemote(req)) {
      return true;
    }
    unauthorized(res, "tailscale_required");
    return false;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let done = false;
      req.on("data", (c) => {
        if (done) return;
        size += c.length;
        if (size > MAX_BODY) {
          done = true;
          reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }));
          try {
            req.resume();
          } catch {
            /* ignore */
          }
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!done) resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", (e) => {
        if (!done) reject(e);
      });
    });
  }

  function serveFile(res, filePath) {
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    const buf = fs.readFileSync(filePath);
    const noStore = ext === ".html" || ext === ".js" || ext === ".css";
    /** @type {Record<string, string|number>} */
    const headers = {
      "Content-Type": type,
      "Content-Length": buf.length,
      "Cache-Control": noStore
        ? "no-store, max-age=0, must-revalidate"
        : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'",
    };
    if (noStore) {
      headers.Pragma = "no-cache";
      headers.Expires = "0";
    }
    res.writeHead(200, headers);
    res.end(buf);
  }

  function broadcastSse(event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(data);
      } catch {
        sseClients.delete(client);
      }
    }
  }

  async function pollTranscripts() {
    if (!sseClients.size) return;
    // Clients send selected target via query on connect;
    // we re-read per-client target stored on res.
    // select:false — do not re-click Cursor sidebar on every poll.
    for (const client of [...sseClients]) {
      const targetId = client._keycodeTargetId;
      if (!targetId) continue;
      try {
        const result = await opts.readChat(targetId, { select: false });
        if (!result?.ok) {
          broadcastToClient(client, "chat-error", {
            targetId,
            error: result?.error || "read_failed",
            hint: result?.hint || "",
          });
          continue;
        }
        const transition = generationTransition(
          client._keycodeGenerating,
          result.generating
        );
        client._keycodeGenerating = transition.next;
        if (transition.changed) {
          broadcastToClient(client, "activity", {
            targetId,
            generating: transition.next,
          });
        }
        if (transition.completed) {
          broadcastToClient(client, "task-done", { targetId });
        }
        const prev = lastHashByTarget.get(targetId);
        const chromeKey = JSON.stringify({
          c: result.composer || null,
          q: (result.clarifications || []).map((x) => x.id),
        });
        const sugKey = (result.suggestions || [])
          .map((s) => `${s.rank}:${s.cardId}`)
          .join(",");
        const nextKey = `${result.hash || ""}|${chromeKey}|${sugKey}`;
        if (prev !== nextKey) {
          lastHashByTarget.set(targetId, nextKey);
          broadcastToClient(client, "chat", {
            targetId,
            hash: result.hash,
            messages: result.messages || [],
            generating: result.generating === true,
            composer: result.composer || null,
            clarifications: result.clarifications || [],
            suggestions: result.suggestions || [],
          });
        }
      } catch (e) {
        broadcastToClient(client, "chat-error", {
          targetId,
          error: String(e.message || e),
        });
      }
    }
  }

  function broadcastToClient(client, event, payload) {
    try {
      client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }

  function startPoll() {
    if (pollTimer) return;
    const pollMs = Math.max(10, Number(opts.pollMs) || SSE_POLL_MS);
    pollTimer = setInterval(() => {
      pollTranscripts().catch(() => {});
    }, pollMs);
    if (typeof pollTimer.unref === "function") pollTimer.unref();
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function handleApi(req, res, url) {
    if (!authorize(req, res)) return;
    const ip = String(req.socket?.remoteAddress || "x");
    if (!rateOk(ip)) {
      sendJson(res, 429, { ok: false, error: "rate_limited" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      try {
        const state = opts.getRemoteState();
        sendJson(res, 200, { ok: true, ...state });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "state_failed" });
        log("WARN", "remote state failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chats") {
      if (typeof opts.listChats !== "function") {
        sendJson(res, 501, { ok: false, error: "list_chats_unavailable" });
        return;
      }
      try {
        const result = await opts.listChats();
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "cdp_closed",
            hint: result?.hint || "cdp_closed",
            chats: [],
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          chats: Array.isArray(result.chats) ? result.chats : [],
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "list_chats_failed", chats: [] });
        log("WARN", "remote list chats failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/chat") {
      const targetId = String(url.searchParams.get("targetId") || "").trim();
      if (!targetId) {
        sendJson(res, 400, { ok: false, error: "target_required" });
        return;
      }
      const result = await opts.readChat(targetId, { select: true });
      if (!result?.ok) {
        sendJson(res, result?.hint === "unknown_target" ? 404 : 502, {
          ok: false,
          error: result?.error || "read_failed",
          hint: result?.hint || "",
        });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        targetId,
        hash: result.hash,
        messages: result.messages || [],
        generating: result.generating === true,
        composer: result.composer || null,
        clarifications: result.clarifications || [],
        suggestions: result.suggestions || [],
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/composer/mode") {
      if (typeof opts.setComposerMode !== "function") {
        sendJson(res, 501, { ok: false, error: "composer_mode_unavailable" });
        return;
      }
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const targetId = String(body.targetId || "").trim();
      const mode = String(body.mode || "").trim();
      if (!targetId || !mode) {
        sendJson(res, 400, { ok: false, error: "target_and_mode_required" });
        return;
      }
      try {
        const result = await opts.setComposerMode(targetId, mode);
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "mode_failed",
            hint: result?.hint || "",
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          composer: result.composer || null,
          mode: result.mode || mode,
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "mode_failed" });
        log("WARN", "remote composer mode failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/composer/model") {
      if (typeof opts.setComposerModel !== "function") {
        sendJson(res, 501, { ok: false, error: "composer_model_unavailable" });
        return;
      }
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const targetId = String(body.targetId || "").trim();
      const model = String(body.model || body.modelId || "").trim();
      if (!targetId || !model) {
        sendJson(res, 400, { ok: false, error: "target_and_model_required" });
        return;
      }
      try {
        const result = await opts.setComposerModel(targetId, model);
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "model_failed",
            hint: result?.hint || "",
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          composer: result.composer || null,
          model: result.model || model,
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "model_failed" });
        log("WARN", "remote composer model failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/composer/answer") {
      if (typeof opts.answerClarification !== "function") {
        sendJson(res, 501, { ok: false, error: "composer_answer_unavailable" });
        return;
      }
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const targetId = String(body.targetId || "").trim();
      if (!targetId) {
        sendJson(res, 400, { ok: false, error: "target_required" });
        return;
      }
      try {
        const result = await opts.answerClarification(targetId, {
          clarificationId: String(body.clarificationId || "").trim(),
          optionId: String(body.optionId || "").trim(),
          text: String(body.text || "").trim(),
        });
        if (result?.busy) {
          sendJson(res, 409, { ok: false, error: "busy", busy: true });
          return;
        }
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "answer_failed",
            hint: result?.hint || "",
          });
          return;
        }
        sendJson(res, 200, { ok: true, clicked: result.clicked || "" });
        broadcastSse("paste-done", { targetId, ok: true, kind: "answer" });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "answer_failed" });
        log("WARN", "remote composer answer failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      const targetId = String(url.searchParams.get("targetId") || "").trim();
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
        "X-Content-Type-Options": "nosniff",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ ok: true, targetId })}\n\n`);
      res._keycodeTargetId = targetId;
      sseClients.add(res);
      startPoll();
      req.on("close", () => {
        sseClients.delete(res);
        if (!sseClients.size) stopPoll();
      });
      if (targetId) {
        try {
          // First snapshot: select the chat once, then polls use select:false
          const result = await opts.readChat(targetId, { select: true });
          if (result?.ok) {
            lastHashByTarget.set(
              targetId,
              `${result.hash || ""}|${JSON.stringify({
                c: result.composer || null,
                q: (result.clarifications || []).map((x) => x.id),
              })}|${(result.suggestions || [])
                .map((s) => `${s.rank}:${s.cardId}`)
                .join(",")}`
            );
            res._keycodeGenerating =
              typeof result.generating === "boolean" ? result.generating : undefined;
            broadcastToClient(res, "chat", {
              targetId,
              hash: result.hash,
              messages: result.messages || [],
              generating: result.generating === true,
              composer: result.composer || null,
              clarifications: result.clarifications || [],
              suggestions: result.suggestions || [],
            });
          } else {
            broadcastToClient(res, "chat-error", {
              targetId,
              error: result?.error || "read_failed",
              hint: result?.hint || "",
            });
          }
        } catch (e) {
          broadcastToClient(res, "chat-error", {
            targetId,
            error: String(e.message || e),
          });
        }
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/deck") {
      if (typeof opts.setActiveDeck !== "function") {
        sendJson(res, 501, { ok: false, error: "set_deck_unavailable" });
        return;
      }
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const deckId =
        body.deckId != null && String(body.deckId).trim()
          ? String(body.deckId).trim()
          : "";
      const stepRaw = body.step;
      const step =
        stepRaw === 1 || stepRaw === -1 || stepRaw === "1" || stepRaw === "-1"
          ? Number(stepRaw)
          : null;
      if (!deckId && step !== 1 && step !== -1) {
        sendJson(res, 400, { ok: false, error: "deck_id_or_step_required" });
        return;
      }
      try {
        const result = await opts.setActiveDeck(
          deckId ? { deckId } : { step }
        );
        if (!result?.ok) {
          const err = result?.error || "deck_failed";
          const code =
            err === "unknown_deck" ? 404 : err === "no_decks" ? 404 : 400;
          sendJson(res, code, { ok: false, error: err });
          return;
        }
        const state = opts.getRemoteState();
        sendJson(res, 200, { ok: true, ...state });
        // setActiveDeck already broadcasts via main; extra SSE is harmless if
        // notifyDeck also fires — clients ignore identical deck id.
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "deck_failed" });
        log("WARN", "remote set deck failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/paste") {
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const cardId = String(body.cardId || "").trim();
      const targetId = String(body.targetId || "").trim();
      if (!cardId || !targetId) {
        sendJson(res, 400, { ok: false, error: "card_and_target_required" });
        return;
      }
      try {
        const result = await opts.pasteCard(cardId, targetId);
        if (result?.busy) {
          sendJson(res, 409, { ok: false, error: "busy", busy: true });
          return;
        }
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "paste_failed",
            results: result?.results || [],
          });
          return;
        }
        sendJson(res, 200, { ok: true, results: result.results || [] });
        broadcastSse("paste-done", {
          cardId,
          targetId,
          ok: true,
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "paste_failed" });
        log("WARN", "remote paste failed", { err: String(e.message || e) });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/paste-text") {
      if (typeof opts.pasteText !== "function") {
        sendJson(res, 501, { ok: false, error: "paste_text_unsupported" });
        return;
      }
      const ct = String(req.headers["content-type"] || "");
      if (!ct.includes("application/json")) {
        sendJson(res, 415, { ok: false, error: "json_required" });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        if (e?.code === "body_too_large") {
          sendJson(res, 413, { ok: false, error: "body_too_large" });
          return;
        }
        sendJson(res, 400, { ok: false, error: "bad_json" });
        return;
      }
      const targetId = String(body.targetId || "").trim();
      const text = typeof body.text === "string" ? body.text : "";
      if (!targetId) {
        sendJson(res, 400, { ok: false, error: "target_required" });
        return;
      }
      if (!text.trim()) {
        sendJson(res, 400, { ok: false, error: "text_required" });
        return;
      }
      if (text.length > MAX_PASTE_TEXT) {
        sendJson(res, 413, { ok: false, error: "text_too_long" });
        return;
      }
      try {
        const result = await opts.pasteText(text, targetId);
        if (result?.busy) {
          sendJson(res, 409, { ok: false, error: "busy", busy: true });
          return;
        }
        if (!result?.ok) {
          sendJson(res, 502, {
            ok: false,
            error: result?.error || "paste_failed",
            results: result?.results || [],
          });
          return;
        }
        sendJson(res, 200, { ok: true, results: result.results || [] });
        broadcastSse("paste-done", {
          targetId,
          ok: true,
          kind: "text",
        });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: "paste_failed" });
        log("WARN", "remote paste-text failed", { err: String(e.message || e) });
      }
      return;
    }

    sendJson(res, 404, { ok: false, error: "not_found" });
  }

  function onRequest(req, res) {
    let url;
    try {
      url = new URL(req.url || "/", `http://127.0.0.1`);
    } catch {
      sendJson(res, 400, { ok: false, error: "bad_url" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "null",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Keycode-Token",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url).catch((e) => {
        log("WARN", "remote api error", { err: String(e.message || e) });
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: "server_error" });
      });
      return;
    }

    // Static UI — token checked by the page JS for API; HTML itself is localhost-only
    // so Tailscale still gates the network path. Extra token gate on HTML would break
    // the fragment-auth flow (browser cannot send Authorization on first navigation).
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      serveFile(res, path.join(staticDir, "index.html"));
      return;
    }

    if (url.pathname.startsWith("/tarot/")) {
      const name = path.basename(url.pathname.slice("/tarot/".length));
      const file = safeJoin(tarotDir, name);
      serveFile(res, file);
      return;
    }

    const file = safeJoin(staticDir, url.pathname);
    serveFile(res, file);
  }

  function start(port) {
    // port 0 = ephemeral; do not use `||` (0 is falsy)
    let p = Number(port);
    if (!Number.isFinite(p) || p < 0) p = DEFAULT_REMOTE_PORT;
    const wantHost = bindHostForMode(accessMode());
    if (server) {
      if (boundHost === wantHost && listeningPort === p) {
        return Promise.resolve({ ok: true, port: listeningPort, host: boundHost });
      }
      // Mode/port change requires restart by caller via stop()+start()
      return Promise.resolve({ ok: true, port: listeningPort, host: boundHost });
    }
    return new Promise((resolve, reject) => {
      server = http.createServer(onRequest);
      const onErr = (err) => {
        log("WARN", "remote server error", { err: String(err.message || err) });
        server = null;
        listeningPort = 0;
        reject(err);
      };
      server.once("error", onErr);
      boundHost = wantHost;
      server.listen(p, boundHost, () => {
        server.removeListener("error", onErr);
        server.on("error", (err) => {
          log("WARN", "remote server error", { err: String(err.message || err) });
        });
        const addr = server.address();
        listeningPort = typeof addr === "object" && addr ? addr.port : p;
        log("INFO", "remote server listening", {
          host: boundHost,
          port: listeningPort,
          mode: accessMode(),
        });
        resolve({ ok: true, port: listeningPort, host: boundHost });
      });
    });
  }

  function stop() {
    stopPoll();
    for (const client of sseClients) {
      try {
        client.end();
      } catch {
        /* ignore */
      }
    }
    sseClients.clear();
    lastHashByTarget.clear();
    rateMap.clear();
    return new Promise((resolve) => {
      if (!server) {
        listeningPort = 0;
        resolve();
        return;
      }
      const s = server;
      server = null;
      s.close(() => {
        listeningPort = 0;
        log("INFO", "remote server stopped");
        resolve();
      });
    });
  }

  function status() {
    return {
      running: !!server && listeningPort > 0,
      host: boundHost,
      bindHost: boundHost,
      accessMode: accessMode(),
      port: listeningPort || Number(opts.getPort?.() || DEFAULT_REMOTE_PORT),
      sseClients: sseClients.size,
    };
  }

  /** Push active deck/cards to open phone remotes (PC switched deck). */
  function notifyDeck(payload) {
    broadcastSse("deck", payload && typeof payload === "object" ? payload : {});
  }

  /** Test helpers */
  function _testAuthorize(req, res) {
    return authorize(req, res);
  }

  return {
    start,
    stop,
    status,
    notifyDeck,
    generateRemoteToken,
    BIND_LAN,
    BIND_LOOPBACK,
    _testAuthorize,
    _extractBearer: extractBearer,
    _hasTailscaleIdentity: hasTailscaleIdentity,
    _timingSafeEqualStr: timingSafeEqualStr,
    _safeJoin: safeJoin,
    _MAX_BODY: MAX_BODY,
  };
}

module.exports = {
  createRemoteServer,
  generateRemoteToken,
  BIND_LAN,
  BIND_LOOPBACK,
  HOST: BIND_LOOPBACK, // backward-compat alias for tests
  normalizeAccessMode,
  bindHostForMode,
  generationTransition,
  timingSafeEqualStr,
  extractBearer,
  hasTailscaleIdentity,
  safeJoin,
  MAX_BODY,
  MAX_PASTE_TEXT,
};
