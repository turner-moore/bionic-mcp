# bionic-mcp

[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2?style=flat-square)](https://modelcontextprotocol.io)
![Node](https://img.shields.io/badge/node-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)

You run models in [LM Studio](https://lmstudio.ai). `bionic-mcp` turns them into tools Claude Code (or any MCP client) can call, so you can hand the cheap and bulky work to your own machine. Free, local, private, nothing leaves your Mac.

```
You, in Claude Code:  "classify these 50 log lines by severity"
                       ↓
             runs on your hardware, 0 API tokens
```

## Install

```sh
git clone https://github.com/turner-moore/bionic-mcp.git && cd bionic-mcp && npm install && \
claude mcp add -s user bionic -- node "$(pwd)/index.js"
```

Then start LM Studio's local server (that's where the models are):

```sh
~/.lmstudio/bin/lms server start
```

<details>
<summary>Registering with a different MCP client</summary>

```json
{
  "mcpServers": {
    "bionic": {
      "command": "node",
      "args": ["/absolute/path/to/bionic-mcp/index.js"],
      "env": { "BIONIC_BASE_URL": "http://127.0.0.1:1234" }
    }
  }
}
```
</details>

## Why not just point your client at the LM Studio API

Two things would eventually bite you. This server fixes both:

> [!IMPORTANT]
> **No silent model swaps.** Ask LM Studio for a model that isn't loaded and its API quietly answers with whatever *is* loaded, so you think you're on a 14B and you're on a 3B. `bionic-mcp` refuses an unknown model id up front and checks `response.model` on every reply.
>
> **No surprise cold loads.** On 16GB only one model stays resident, and switching costs 8-30s. `model:"auto"` uses whatever's already loaded, so a quick call stays quick.

## Tools

| Tool | Parameters | Does |
|---|---|---|
| `respond` | `prompt`, `model` (default `"auto"`), `system`, `temperature`, `json_schema` | Run a prompt on a local model. `json_schema` forces structured JSON out. |
| `models` | none | List installed models with live load state and a capability card (quality, speed, context). |

> [!NOTE]
> Each prompt stands on its own. The local model can't see your Claude session, files, or memory, so inline every input and instruction it needs.

<details>
<summary>Bonus: a tiered on-device + LM Studio router (local.js)</summary>

`local.js` is a second, optional server. It tries a faster on-device backend first (caix, Apple Core AI on the Neural Engine) and falls back to LM Studio when that's down.

```sh
claude mcp add -s user local -- node "$(pwd)/local.js"
```
</details>

## Requirements

- Node 18+ (for built-in `fetch`)
- LM Studio with its local server running
- The capability card lives in `models.json`, edit it to match your own installed models.
