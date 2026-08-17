import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const t = new StdioClientTransport({ command: "node", args: [new URL("./local.js", import.meta.url).pathname] });
const c = new Client({ name: "t", version: "1.0.0" }); await c.connect(t);
console.log("requesting Bionic id 'gemma-4-e4b-it-mlx' (MCP must: free caix RAM, start lms server, load model, answer)...");
const r = await c.callTool({ name: "respond", arguments: { prompt: "Reply with exactly: OK", model: "gemma-4-e4b-it-mlx", max_tokens: 10, timeout_s: 120 } });
console.log(r.content[0].text);
await c.close(); process.exit(0);
