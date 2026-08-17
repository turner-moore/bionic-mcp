// E2E smoke test: connect over stdio like Claude Code would, list tools, run calls.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: [new URL("./index.js", import.meta.url).pathname] });
const client = new Client({ name: "test", version: "0.0.1" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("TOOLS:", tools.map((t) => t.name).join(", "));

const models = await client.callTool({ name: "models", arguments: {} });
console.log("\n=== models ===\n" + models.content[0].text.slice(0, 600));

const r = await client.callTool({
  name: "respond",
  arguments: { prompt: "Reply with exactly: BIONIC-MCP-OK", model: "qwen/qwen3.5-4b", max_tokens: 64, temperature: 0 },
});
console.log("\n=== respond (explicit model) ===\n" + r.content[0].text);

const auto = await client.callTool({
  name: "respond",
  arguments: { prompt: "What is 17*23? Answer with the number only.", max_tokens: 64, temperature: 0 },
});
console.log("\n=== respond (auto; should reuse loaded model, no cold load) ===\n" + auto.content[0].text);

const bad = await client.callTool({ name: "respond", arguments: { prompt: "hi", model: "totally/fake-model" } });
console.log("\n=== unknown id (must refuse, not substitute) ===\n" + (bad.isError ? "REFUSED: " : "PROBLEM, accepted: ") + bad.content[0].text.slice(0, 200));

await client.close();
