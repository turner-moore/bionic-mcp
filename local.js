#!/usr/bin/env node
// local-mcp: tiered local inference. caix (Apple Core AI, :1237) is the FAST primary;
// Bionic/LM Studio (:1234) is the stable fallback for its full catalog and when caix is
// down (e.g. after a macOS/Xcode beta bump rebreaks the Core AI runtime). Built 2026-08-16.
// Leaves bionic-mcp/index.js untouched; reuses its node_modules + models.json.
// One heavy chat backend holds a model at a time on 16GB, so routing enforces mutual exclusion.
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const CAIX = process.env.CAIX_BASE_URL || "http://127.0.0.1:1237";
const BIONIC = process.env.BIONIC_BASE_URL || "http://127.0.0.1:1234";
const CARD = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8"));
const UID = process.getuid();
const LMS = process.env.LMS_BIN || `${process.env.HOME}/.lmstudio/bin/lms`;
const execFileP = promisify(execFile);

// caix "auto" default: 3B is the speed/quality sweet spot (60 tok/s); 7B (32 tok/s) and
// 1.5B (95 tok/s) available by exact id. Change via CAIX_DEFAULT if the export set changes.
const CAIX_DEFAULT_HINT = process.env.CAIX_DEFAULT || "3b";

// --- lifecycle: servers are started/stopped by the MCP, not by hand. On 16GB only
// one heavy chat backend may hold a model at a time (caix has no idle-unload; Bionic idle-
// unloads at 60min), so routing enforces mutual exclusion. "backend is down" self-heals.
const sh = (file, args, ms = 20000) =>
  execFileP(file, args, { timeout: ms }).then(() => true).catch(() => false);
async function portUp(base, path, ms = 2000) {
  try { return (await fetch(`${base}${path}`, { signal: AbortSignal.timeout(ms) })).ok; }
  catch { return false; }
}
async function waitUp(base, path, tries = 20, gapMs = 750) {
  for (let i = 0; i < tries; i++) { if (await portUp(base, path)) return true; await new Promise((r) => setTimeout(r, gapMs)); }
  return false;
}
// caix is a KeepAlive LaunchAgent, so "down" means crashed/mid-restart: kick it and wait.
async function ensureCaix() {
  if (await portUp(CAIX, "/v1/models")) return true;
  await sh("launchctl", ["kickstart", "-k", `gui/${UID}/local.caix-serve`], 8000);
  return waitUp(CAIX, "/v1/models");
}
// Bionic starts on demand (no always-on RAM). Freeing caix's resident model first keeps 16GB safe.
async function freeCaixModel() { await sh("launchctl", ["kickstart", "-k", `gui/${UID}/local.caix-serve`], 8000); }
async function ensureBionic({ exclusive } = {}) {
  if (exclusive) await freeCaixModel(); // drop caix's ~5GB so Bionic can load without OOM
  if (await portUp(BIONIC, "/api/v0/models")) return true;
  await sh(LMS, ["server", "start"], 25000);
  return waitUp(BIONIC, "/api/v0/models");
}

async function listCaix() {
  try {
    const r = await fetch(`${CAIX}/v1/models`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return [];
    return (await r.json()).data.map((m) => m.id);
  } catch { return []; }
}
async function listBionic() {
  try {
    const r = await fetch(`${BIONIC}/api/v0/models`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    return (await r.json()).data.filter((m) => m.type === "llm" || m.type === "vlm");
  } catch { return []; }
}
const isQwenArch = (m) => (m.arch || "").toLowerCase().startsWith("qwen");

function pickCaix(requested, caixIds) {
  if (requested && !["auto", "fast", "caix", "local"].includes(requested)) {
    return caixIds.includes(requested) ? requested : null; // exact caix id or not-ours
  }
  // auto: prefer the hinted size, else largest available, else first
  return (
    caixIds.find((id) => id.includes(CAIX_DEFAULT_HINT)) ??
    caixIds.slice().sort().reverse()[0] ??
    caixIds[0] ??
    null
  );
}

async function callCaix(model, messages, args) {
  const body = { model, messages, max_tokens: args.max_tokens, stream: false };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (args.json_schema)
    body.response_format = { type: "json_schema", json_schema: { name: "result", strict: true, schema: args.json_schema } };
  const started = Date.now();
  const r = await fetch(`${CAIX}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(args.timeout_s * 1000),
  });
  if (!r.ok) throw new Error(`caix HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const u = d.usage ?? {};
  const text = (d.choices?.[0]?.message?.content ?? "").trim();
  return { text: text || "(no content)", tag: `local→caix: ${d.model ?? model} | ${u.prompt_tokens ?? "?"}>${u.completion_tokens ?? "?"} tok | ${elapsed}s` };
}

// Bionic fallback: minimal port of bionic-mcp's call path (reasoning-off for qwen,
// silent-substitution guard). Full-featured Bionic access still lives in the `bionic` MCP.
async function callBionic(requested, messages, args) {
  const live = await listBionic();
  if (!live.length) throw new Error(`Bionic unreachable at ${BIONIC} (start: ~/.lmstudio/bin/lms server start).`);
  let target;
  if (requested && !["auto", "fast", "caix", "local"].includes(requested)) {
    target = live.find((m) => m.id === requested);
    if (!target) throw new Error(`Model "${requested}" not on caix or Bionic. Bionic has: ${live.map((m) => m.id).join(", ")}`);
  } else {
    target =
      live.find((m) => m.state === "loaded" && CARD.models[m.id]?.auto_route !== false) ??
      live.find((m) => m.id === CARD.default_model) ??
      live.find((m) => CARD.models[m.id]?.auto_route !== false);
    if (!target) throw new Error("No routable chat model on Bionic.");
  }
  const body = { model: target.id, messages, max_tokens: args.max_tokens, stream: false };
  if (args.temperature !== undefined) body.temperature = args.temperature;
  if (isQwenArch(target)) body.reasoning_effort = "none";
  const started = Date.now();
  const call = (p) => fetch(`${BIONIC}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p), signal: AbortSignal.timeout(args.timeout_s * 1000),
  });
  let r = await call(body);
  if (r.status === 400 && body.reasoning_effort) { delete body.reasoning_effort; r = await call(body); }
  if (!r.ok) throw new Error(`Bionic HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const u = d.usage ?? {};
  const served = d.model ?? target.id;
  const warn = served !== target.id ? `WARNING: requested ${target.id}, server ran ${served} (silent substitution).\n\n` : "";
  const text = (d.choices?.[0]?.message?.content ?? "").trim();
  return { text: warn + (text || "(no content)"), tag: `local→bionic: ${served} | ${u.prompt_tokens ?? "?"}>${u.completion_tokens ?? "?"} tok | ${elapsed}s${target.state === "loaded" ? "" : " incl. cold load"}` };
}

const server = new McpServer({ name: "local", version: "1.0.0" });

server.tool(
  "respond",
  "Run a prompt on tiered local inference: caix (Apple Core AI, Neural Engine) is the FAST primary, " +
    "Bionic/LM Studio the stable fallback. Free local inference. " +
    "model:'auto' (default) -> caix (Qwen2.5-3B, ~60 tok/s); 'qwen2_5_7b_instruct_4bit_dynamic' (~32 tok/s, most capable) " +
    "or 'qwen2_5_1_5b_instruct_4bit_dynamic' (~95 tok/s) by exact id; any Bionic id (qwen/qwen3.5-4b, gemma-4-e4b-it-mlx, " +
    "mistralai_ministral-3-14b-instruct-2512-mlx, qwythos-9b-...) routes to Bionic. If caix is down (e.g. after an OS beta bump), " +
    "auto/fast requests fall back to Bionic automatically. Vision/images and the uncensored variant: use the `bionic` MCP directly. " +
    "DELEGATION CONTRACT: the prompt must be fully self-contained; inline every input, constraint, and output-format requirement. " +
    "Keep on the hosted model instead: tasks needing session context, files, or memory.",
  {
    prompt: z.string().describe("Fully self-contained task, all inputs inlined"),
    model: z.string().default("auto").describe("'auto' (caix 3B), an exact caix id, or a Bionic id"),
    system: z.string().optional(),
    max_tokens: z.number().int().positive().default(1024),
    temperature: z.number().min(0).max(2).optional(),
    json_schema: z.record(z.any()).optional().describe("JSON Schema; forces structured JSON output"),
    timeout_s: z.number().int().positive().default(180),
  },
  async (args) => {
    const messages = [];
    if (args.system) messages.push({ role: "system", content: args.system });
    messages.push({ role: "user", content: args.prompt });

    const notes = [];
    // Self-heal caix (KeepAlive agent; kick it if the port is dead) then see what it serves.
    await ensureCaix();
    const caixIds = await listCaix();
    const caixModel = pickCaix(args.model, caixIds);

    // Primary: caix, when it owns the model (or auto/fast and caix is up).
    if (caixModel) {
      // Protect 16GB: if Bionic is holding a model, unload it before caix loads (best-effort,
      // only when Bionic is actually up so we don't spawn lms for nothing).
      if (await portUp(BIONIC, "/api/v0/models", 600)) sh(LMS, ["unload", "--all"], 8000);
      try {
        const { text, tag } = await callCaix(caixModel, messages, args);
        return { content: [{ type: "text", text: `${text}\n\n[${tag}]` }] };
      } catch (e) {
        notes.push(`caix failed (${e.message.slice(0, 120)}) -> Bionic`);
      }
    }
    // Fallback / explicit Bionic id: start Bionic on demand, freeing caix's RAM first (exclusive).
    const up = await ensureBionic({ exclusive: true });
    if (!up) {
      throw new Error(
        `local: could not reach or start Bionic at ${BIONIC} (${LMS} server start failed).` +
          (notes.length ? ` ${notes.join(" | ")}` : "")
      );
    }
    try {
      const { text, tag } = await callBionic(args.model, messages, args);
      const prefix = notes.length ? `[${notes.join(" | ")}]\n\n` : "";
      return { content: [{ type: "text", text: `${prefix}${text}\n\n[${tag}]` }] };
    } catch (e) {
      const chain = notes.concat(`bionic failed (${e.message})`).join(" | ");
      throw new Error(`All local tiers failed. ${chain}`);
    }
  }
);

server.tool(
  "models",
  "List the tiered local models: caix (Apple Core AI, fast primary) and Bionic/LM Studio (fallback catalog), " +
    "with live state. Call before deciding what to delegate locally.",
  {},
  async () => {
    const caixIds = await listCaix();
    const bionic = await listBionic();
    const caixRows = caixIds.length
      ? caixIds.map((id) => `- ${id}  [caix/Core AI, fast]`).join("\n")
      : "- (caix :1237 not reachable)";
    const bRows = bionic.length
      ? bionic.map((m) => {
          const c = CARD.models[m.id] ?? {};
          return `- ${m.id}  [bionic, ${m.state}]${c.quality ? `  ${c.quality}/10 @ ${c.tok_s} tok/s` : ""}${c.role ? `  ${c.role}` : ""}`;
        }).join("\n")
      : "- (Bionic :1234 not reachable — start: ~/.lmstudio/bin/lms server start)";
    return {
      content: [{
        type: "text",
        text: `PRIMARY caix (${CAIX}, Neural Engine):\n${caixRows}\n\nFALLBACK Bionic (${BIONIC}):\n${bRows}\n\n` +
          "Routing: 'auto' -> caix 3B; exact caix id for 1.5B/7B; any Bionic id -> Bionic; caix-down auto-falls-back.",
      }],
    };
  }
);

await server.connect(new StdioServerTransport());
