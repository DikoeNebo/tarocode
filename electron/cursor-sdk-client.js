/**
 * Cursor SDK backend for A/B vs CDP.
 * Never logs apiKey or prompt/chat text.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeComposerChrome } = require("./cdp-composer");

/** Synthetic remote chat id (same shape family as live|…). */
const SDK_LIVE_CHAT_ID = "sdk|default";

const DEFAULT_MODEL_ID = "composer-2.5";

function hashTranscript(messages) {
  const h = crypto.createHash("sha1");
  for (const m of messages || []) {
    h.update(String(m.role || ""));
    h.update("\0");
    h.update(String(m.text || ""));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 16);
}

function extractMessageText(raw) {
  if (raw == null) return "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw !== "object") return String(raw).trim();
  if (typeof raw.text === "string") return raw.text.trim();
  const content = raw.content ?? raw.message ?? raw.text;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (raw.message != null && raw.message !== raw) {
    return extractMessageText(raw.message);
  }
  return "";
}

function normalizeSdkMessages(items, { maxMessages = 80, maxChars = 12000 } = {}) {
  const out = [];
  let chars = 0;
  const list = Array.isArray(items) ? items : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const roleRaw = String(item?.type || item?.role || "").toLowerCase();
    const role =
      roleRaw === "user" || roleRaw === "human"
        ? "user"
        : roleRaw === "assistant" || roleRaw === "ai"
          ? "assistant"
          : roleRaw || "assistant";
    let text = extractMessageText(item);
    if (!text) continue;
    if (text.length > 4000) text = text.slice(0, 4000) + "…";
    if (chars + text.length > maxChars && out.length) break;
    chars += text.length;
    out.push({
      id: String(item?.uuid || item?.id || `sdk-${i}`),
      role,
      text,
    });
    if (out.length >= maxMessages) break;
  }
  return out;
}

/**
 * @param {object} [deps]
 * @param {typeof import('@cursor/sdk').Agent} [deps.Agent]
 * @param {typeof import('@cursor/sdk').Cursor} [deps.Cursor]
 */
function createCursorSdkClient(deps = {}) {
  let Agent = deps.Agent || null;
  let Cursor = deps.Cursor || null;

  function loadSdk() {
    if (Agent && Cursor) return { Agent, Cursor };
    const sdk = require("@cursor/sdk");
    Agent = sdk.Agent;
    Cursor = sdk.Cursor;
    return { Agent, Cursor };
  }

  /** @type {import('@cursor/sdk').SDKAgent | null} */
  let agent = null;
  let busy = false;
  /** @type {'agent'|'plan'} */
  let mode = "agent";
  let modelId = DEFAULT_MODEL_ID;
  /** @type {Array<{id:string,label:string}>} */
  let cachedModels = [];
  /** @type {Array<{id:string,role:string,text:string}>} */
  let cachedMessages = [];
  let cachedHash = "0";

  function isBusy() {
    return busy;
  }

  function getComposerChrome() {
    const composer = normalizeComposerChrome({
      mode,
      modeLabel: mode === "plan" ? "Plan" : "Agent",
      submitKind: mode === "plan" ? "build" : "send",
      submitLabel: mode === "plan" ? "Build" : "Send",
      modelId,
      modelLabel: modelId,
      models: cachedModels,
      generating: busy,
    });
    return { ok: true, composer, clarifications: [] };
  }

  function getCachedTranscript() {
    const chrome = getComposerChrome();
    return {
      ok: true,
      messages: cachedMessages,
      hash: cachedHash,
      count: cachedMessages.length,
      generating: busy,
      composer: chrome.composer,
      clarifications: [],
    };
  }

  function setMode(next) {
    mode = next === "plan" ? "plan" : "agent";
    return getComposerChrome();
  }

  function setModel(next) {
    const id = String(next || "").trim();
    if (!id) return { ok: false, error: "model_required", hint: "model_required" };
    modelId = id;
    return { ok: true, ...getComposerChrome() };
  }

  function validateOpts(opts = {}) {
    const apiKey = String(opts.apiKey || "").trim();
    const cwd = String(opts.cwd || "").trim();
    if (!apiKey) {
      const err = new Error("sdk_need_key");
      err.code = "sdk_need_key";
      throw err;
    }
    if (!cwd) {
      const err = new Error("sdk_need_cwd");
      err.code = "sdk_need_cwd";
      throw err;
    }
    const resolved = path.resolve(cwd);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      const err = new Error("sdk_bad_cwd");
      err.code = "sdk_bad_cwd";
      throw err;
    }
    return {
      apiKey,
      cwd: resolved,
      agentId: String(opts.agentId || "").trim(),
      modelId:
        String(opts.modelId || modelId || DEFAULT_MODEL_ID).trim() ||
        DEFAULT_MODEL_ID,
      mode: opts.mode === "plan" || mode === "plan" ? "plan" : "agent",
    };
  }

  async function ensureAgent(opts = {}) {
    const { Agent: A } = loadSdk();
    const v = validateOpts(opts);
    mode = v.mode;
    modelId = v.modelId;
    if (agent && agent.agentId && (!v.agentId || agent.agentId === v.agentId)) {
      return { agent, agentId: agent.agentId, created: false };
    }
    if (agent) {
      try {
        agent.close();
      } catch {
        /* ignore */
      }
      agent = null;
    }

    if (v.agentId) {
      try {
        agent = await A.resume(v.agentId, {
          apiKey: v.apiKey,
          model: { id: v.modelId },
          mode: v.mode,
          local: { cwd: v.cwd },
        });
        return { agent, agentId: agent.agentId, created: false };
      } catch {
        // Fall through to create a fresh agent.
      }
    }

    agent = await A.create({
      apiKey: v.apiKey,
      name: "Keycode",
      model: { id: v.modelId },
      mode: v.mode,
      local: { cwd: v.cwd },
    });
    return { agent, agentId: agent.agentId, created: true };
  }

  async function resetAgent(opts = {}) {
    if (agent) {
      try {
        agent.close();
      } catch {
        /* ignore */
      }
      agent = null;
    }
    cachedMessages = [];
    cachedHash = "0";
    const next = await ensureAgent({ ...opts, agentId: "" });
    return { ok: true, agentId: next.agentId, created: true };
  }

  async function refreshTranscript(opts = {}) {
    const { Agent: A } = loadSdk();
    const v = validateOpts(opts);
    const agentId = agent?.agentId || v.agentId;
    if (!agentId) {
      cachedMessages = [];
      cachedHash = "0";
      return getCachedTranscript();
    }
    let items = [];
    try {
      items = await A.messages.list(agentId, {
        apiKey: v.apiKey,
        cwd: v.cwd,
        limit: 80,
      });
    } catch {
      items = [];
    }
    if (!Array.isArray(items)) {
      items = items?.items || items?.messages || [];
    }
    cachedMessages = normalizeSdkMessages(items);
    cachedHash = hashTranscript(cachedMessages);
    return getCachedTranscript();
  }

  async function readTranscript(opts = {}) {
    try {
      await refreshTranscript(opts);
      return getCachedTranscript();
    } catch (e) {
      const code = e?.code || "";
      return {
        ok: false,
        error: code || String(e.message || e),
        hint: code || "sdk_error",
        messages: [],
        hash: "0",
        generating: busy,
      };
    }
  }

  /**
   * @returns {Promise<{ok:boolean, agentId?:string, error?:string, warning?:string}>}
   */
  async function send(text, opts = {}) {
    const body = String(text || "");
    if (!body.trim()) {
      return { ok: false, error: "empty_text" };
    }
    if (busy) {
      return { ok: false, error: "busy", hint: "busy" };
    }
    busy = true;
    try {
      const ensured = await ensureAgent(opts);
      const sendOpts = {
        mode: mode === "plan" ? "plan" : "agent",
        model: { id: modelId },
      };
      const run = await ensured.agent.send(body, sendOpts);
      const result = await run.wait();
      await refreshTranscript({ ...opts, agentId: ensured.agentId });
      if (result.status === "error" || result.status === "cancelled") {
        return {
          ok: false,
          agentId: ensured.agentId,
          error: result.error?.message || result.status || "sdk_send_failed",
        };
      }
      return { ok: true, agentId: ensured.agentId };
    } catch (e) {
      const code = e?.code || "";
      return {
        ok: false,
        error: code || String(e.message || e),
        hint: code || "sdk_error",
      };
    } finally {
      busy = false;
    }
  }

  async function listModels(opts = {}) {
    const { Cursor: C } = loadSdk();
    const apiKey = String(opts.apiKey || "").trim();
    if (!apiKey) {
      return { ok: false, error: "sdk_need_key", hint: "sdk_need_key", models: [] };
    }
    try {
      const listed = await C.models.list({ apiKey });
      const items = Array.isArray(listed) ? listed : listed?.items || [];
      cachedModels = items
        .map((m) => ({
          id: String(m?.id || m?.model?.id || "").trim(),
          label: String(
            m?.displayName || m?.label || m?.id || m?.model?.id || ""
          ).trim(),
        }))
        .filter((m) => m.id);
      return { ok: true, models: cachedModels };
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || e),
        hint: "sdk_models_failed",
        models: cachedModels,
      };
    }
  }

  async function probe(opts = {}) {
    const { Cursor: C } = loadSdk();
    const apiKey = String(opts.apiKey || "").trim();
    if (!apiKey) {
      return { ok: false, error: "sdk_need_key", hint: "sdk_need_key" };
    }
    try {
      const me = await C.me({ apiKey });
      const modelsResult = await listModels({ apiKey });
      return {
        ok: true,
        hasKey: true,
        apiKeyName: me?.apiKeyName || "",
        modelCount: (modelsResult.models || []).length,
      };
    } catch (e) {
      return {
        ok: false,
        hasKey: true,
        error: String(e.message || e),
        hint: "sdk_auth_failed",
      };
    }
  }

  function listSyntheticChats(name = "SDK agent") {
    return {
      ok: true,
      chats: [
        {
          id: SDK_LIVE_CHAT_ID,
          name: String(name || "SDK agent"),
          cdpTargetId: "",
          chatId: "default",
          chatTitle: String(name || "SDK agent"),
          windowTitle: "Cursor SDK",
          backend: "sdk",
        },
      ],
      port: 0,
      backend: "sdk",
    };
  }

  function close() {
    if (agent) {
      try {
        agent.close();
      } catch {
        /* ignore */
      }
      agent = null;
    }
  }

  return {
    SDK_LIVE_CHAT_ID,
    isBusy,
    ensureAgent,
    resetAgent,
    send,
    readTranscript,
    getCachedTranscript,
    getComposerChrome,
    setMode,
    setModel,
    listModels,
    probe,
    listSyntheticChats,
    close,
    normalizeSdkMessages,
    hashTranscript,
  };
}

let singleton = null;

function getCursorSdkClient() {
  if (!singleton) singleton = createCursorSdkClient();
  return singleton;
}

module.exports = {
  SDK_LIVE_CHAT_ID,
  DEFAULT_MODEL_ID,
  createCursorSdkClient,
  getCursorSdkClient,
  normalizeSdkMessages,
  hashTranscript,
  extractMessageText,
};
