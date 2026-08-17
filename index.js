#!/usr/bin/env node
// bionic-mcp: exposes local LM Studio (Bionic) models on :1234 as MCP tools.
// Free local inference tier. Companion capability card lives in models.json. Built 2026-07-31.
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.BIONIC_BASE_URL || "http://127.0.0.1:1234";
const CARD = JSON.parse(
  readFileSync(new URL("./models.json", import.meta.url), "utf8")
);

const UNREACHABLE_HELP =
  `LM Studio server not reachable at ${BASE}. Start it with: ~/.lmstudio/bin/lms server start ` +
  `(LaunchAgent ai.elementlabs.bionic.lms-server normally starts it at login).`;

async function apiModels() {
  let res;
  try {
    res = await fetch(`${BASE}/api/v0/models`, { signal: AbortSignal.timeout(5000) });
  } catch {
    throw new Error(UNREACHABLE_HELP);
  }
  if (!res.ok) throw new Error(`LM Studio /api/v0/models returned HTTP ${res.status}`);
  return (await res.json()).data;
}

const isChat = (m) => m.type === "llm" || m.type === "vlm";
const isQwenArch = (m) => (m.arch || "").toLowerCase().startsWith("qwen");

// model:"auto" prefers the already-loaded chat model (one fits at a time on this
// 16GB machine; switching costs an 8-30s cold load), skipping models the card
// marks auto_route:false (the uncensored variant and the embedder).
function resolveModel(requested, live) {
  const chat = live.filter(isChat);
  if (requested !== "auto") {
    const hit = live.find((m) => m.id === requested);
    if (!hit || !isChat(hit)) {
      const ids = chat.map((m) => m.id).join(", ");
      throw new Error(
        `Model "${requested}" is not on the server. Refusing the call because LM Studio silently ` +
        `substitutes unknown ids with whatever is loaded. Chat models available: ${ids}`
      );
    }
    return hit;
  }
  const loaded = chat.find(
    (m) => m.state === "loaded" && CARD.models[m.id]?.auto_route !== false
  );
  if (loaded) return loaded;
  const fallback =
    chat.find((m) => m.id === CARD.default_model) ??
    chat.find((m) => CARD.models[m.id]?.auto_route !== false);
  if (!fallback) throw new Error("No routable chat model on the server.");
  return fallback;
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const server = new McpServer({ name: "bionic", version: "1.0.0" });

server.tool(
  "respond",
  "Run a prompt on the local LM Studio (Bionic) models. Free local inference. " +
    "Model cheat sheet (measured 2026-07-30): " +
    "qwen/qwen3.5-4b = volume/batch work, 8/10 @ 48 tok/s; gemma-4-e4b-it-mlx = general default, 10/10 @ 28.5, vision; " +
    "mistralai_ministral-3-14b-instruct-2512-mlx = hardest problems, 10/10 @ 19.3; " +
    "qwythos-9b-claude-mythos-5-1m = only choice past ~62K tokens of context (~144K); " +
    "supergemma4-e4b-abliterated-mlx = uncensored variant, invoke by exact id (text-only). " +
    "model:'auto' (default) uses the already-loaded model to avoid an 8-30s cold load, else the general default. " +
    "One model resident at a time. DELEGATION CONTRACT: the prompt must be fully self-contained; the local model " +
    "cannot see this session, so inline every input, constraint, and output-format requirement. " +
    "Keep on the hosted model instead: tasks needing session context, files, or memory.",
  {
    prompt: z.string().describe("Fully self-contained task, all inputs inlined"),
    model: z.string().default("auto").describe("Exact model id, or 'auto' (prefer loaded model)"),
    system: z.string().optional().describe("Optional system prompt"),
    max_tokens: z.number().int().positive().default(1024),
    temperature: z.number().min(0).max(2).optional(),
    thinking: z.boolean().default(false).describe("true lets qwen-family models reason (auto-raises max_tokens to 2048+; slower)"),
    json_schema: z.record(z.any()).optional().describe("JSON Schema; forces structured JSON output"),
    image_path: z.string().optional().describe("Absolute path to a png/jpg/webp for vision models"),
    timeout_s: z.number().int().positive().default(180),
  },
  async (args) => {
    const live = await apiModels();
    const target = resolveModel(args.model, live);
    const card = CARD.models[target.id] ?? {};

    let userContent = args.prompt;
    if (args.image_path) {
      if (card.text_only) {
        throw new Error(`${target.id} is text-only (vision tower stripped). Use gemma-4-e4b-it-mlx for images.`);
      }
      if (!existsSync(args.image_path)) throw new Error(`image_path not found: ${args.image_path}`);
      const mime = MIME[extname(args.image_path).toLowerCase()];
      if (!mime) throw new Error(`Unsupported image type: ${args.image_path}`);
      const b64 = readFileSync(args.image_path).toString("base64");
      userContent = [
        { type: "text", text: args.prompt },
        { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
      ];
    }

    const messages = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: userContent });

    // Thinking budget: reasoning tokens come out of max_tokens, so give headroom.
    const maxTokens = args.thinking ? Math.max(args.max_tokens, 2048) : args.max_tokens;
    const body = { model: target.id, messages, max_tokens: maxTokens, stream: false };
    if (args.temperature !== undefined) body.temperature = args.temperature;
    if (args.json_schema) {
      body.response_format = { type: "json_schema", json_schema: { name: "result", strict: true, schema: args.json_schema } };
    }
    // qwen3.5 models think by default and ignore /no_think; reasoning_effort:'none'
    // is the working off-switch. Gemma models 400 on the field, so qwen-arch only.
    if (!args.thinking && isQwenArch(target)) body.reasoning_effort = "none";

    const wasLoaded = target.state === "loaded";
    const started = Date.now();
    const call = (payload) =>
      fetch(`${BASE}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(args.timeout_s * 1000),
      });

    let res;
    try {
      res = await call(body);
      if (res.status === 400 && body.reasoning_effort) {
        // Arch detection was wrong for this model; retry without the field.
        delete body.reasoning_effort;
        res = await call(body);
      }
    } catch (e) {
      if (e.name === "TimeoutError") {
        throw new Error(
          `Timed out after ${args.timeout_s}s on ${target.id}` +
            (wasLoaded ? "." : " (model was not loaded; cold load + generation exceeded the budget — retry or raise timeout_s).")
        );
      }
      throw new Error(UNREACHABLE_HELP);
    }
    if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

    const data = await res.json();
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const msg = data.choices?.[0]?.message ?? {};
    const text = (msg.content ?? "").trim();
    const served = data.model ?? "unknown";
    const usage = data.usage ?? {};

    const lines = [];
    // LM Studio stamps the response with the model that actually ran; trust that,
    // not the id we sent (silent-substitution gotcha, verified 2026-07-30).
    if (served !== target.id) {
      lines.push(`WARNING: requested ${target.id} but the server ran ${served} (silent substitution). Treat the output accordingly.`);
    }
    if (!text && msg.reasoning_content) {
      lines.push(
        `EMPTY ANSWER: the model spent the whole ${maxTokens}-token budget thinking. ` +
          `Retry with thinking:false, or thinking:true with max_tokens 3000+.`
      );
    }
    lines.push(text || "(no content)");
    lines.push(
      `[bionic: ${served} | ${usage.prompt_tokens ?? "?"}>${usage.completion_tokens ?? "?"} tok | ${elapsed}s${wasLoaded ? "" : " incl. cold load"}]`
    );
    return { content: [{ type: "text", text: lines.join("\n\n") }] };
  }
);

server.tool(
  "models",
  "List the local LM Studio (Bionic) models: live load state plus the measured capability card " +
    "(quality /10, tok/s, role, warnings) and the routing rules. Call this when deciding what to delegate locally.",
  {},
  async () => {
    const live = await apiModels();
    const rows = live.map((m) => {
      const card = CARD.models[m.id] ?? {};
      return [
        `- ${m.id}  [${m.state}${m.state === "loaded" ? ", warm" : ""}]`,
        `  ${card.role ?? `${m.type} (${m.arch ?? "?"}); not in the capability card yet — probe before relying on it`}`,
        card.quality ? `  measured: ${card.quality}/10 @ ${card.tok_s} tok/s; ctx ${card.ctx_loaded ?? m.max_context_length}` : null,
        card.notes ? `  notes: ${card.notes}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    });
    const notes = CARD.routing_notes.map((n) => `- ${n}`).join("\n");
    return {
      content: [
        { type: "text", text: `Bionic models on ${BASE} (card measured 2026-07-30):\n\n${rows.join("\n\n")}\n\nRouting rules:\n${notes}` },
      ],
    };
  }
);

await server.connect(new StdioServerTransport());
