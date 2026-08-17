# bionic-mcp

**Turn the models you run in [LM Studio](https://lmstudio.ai) into tools any MCP client can call.** Prompts go to a model on your own machine. Free, local, private, nothing leaves the box.

## Why you'd want it

- **Free local inference** — offload the cheap, bulky, or repetitive work to a model you already run.
- **Private** — the prompt and the answer stay on your Mac.
- **Typed and safe** — the server refuses unknown model ids instead of letting LM Studio silently swap in whatever happens to be loaded.

## Install

### Claude Code (copy-paste)

Paste this into your terminal. It clones, installs, and registers the MCP in one shot:

```sh
git clone https://github.com/turner-moore/bionic-mcp.git && cd bionic-mcp && npm install && \
claude mcp add -s user bionic -- node "$(pwd)/index.js"
```

You also need [LM Studio](https://lmstudio.ai) running its local server (that's where the models are):

```sh
~/.lmstudio/bin/lms server start
```

### Register with any other MCP client

Add this to your client's config (e.g. `claude_desktop_config.json`), using an absolute path:

```json
{
  "mcpServers": {
    "bionic": {
      "command": "node",
      "args": ["/absolute/path/to/bionic-mcp/index.js"]
    }
  }
}
```

Point it at a different endpoint with the `BIONIC_BASE_URL` env var (default `http://127.0.0.1:1234`).

## Use

`respond` runs a prompt; `models` lists what's installed and loaded. See **Tools** below.

## Tools

- **`respond`** — run a prompt on a local model. Pick a model by id, or let `model:"auto"` use whatever's already loaded (avoids an 8-30s cold reload). Supports a system prompt, temperature, and JSON-schema-forced structured output.
- **`models`** — list the installed models with live load state and a measured capability card (quality, speed, context size), so you can decide what to hand off.

The capability card lives in `models.json`. One prompt is fully self-contained: the local model can't see your session, so inline every input and instruction.

## Two servers in here

- **`index.js`** (`bionic`) — the straight LM Studio server. Start here.
- **`local.js`** (`local`) — an optional tiered version: it tries a faster on-device backend first (caix / Apple Core AI on the Neural Engine) and falls back to LM Studio automatically when that's down. Register it separately if you want the routed surface:
  ```sh
  claude mcp add -s user local -- node /path/to/bionic-mcp/local.js
  ```

## Requirements

Node 18+ (uses built-in `fetch`) and LM Studio with its server running. On a 16GB machine only one chat model stays resident at a time, so switching models costs a cold load; `model:"auto"` is there to avoid paying that when you don't need to.

## License

MIT, see [LICENSE](LICENSE).
