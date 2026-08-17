# bionic-mcp

**Turn the models you run in [LM Studio](https://lmstudio.ai) into tools any MCP client can call.** Prompts go to a model on your own machine. Free, local, private, nothing leaves the box.

## Why you'd want it

- **Free local inference** — offload the cheap, bulky, or repetitive work to a model you already run.
- **Private** — the prompt and the answer stay on your Mac.
- **Typed and safe** — the server refuses unknown model ids instead of letting LM Studio silently swap in whatever happens to be loaded.

## Quick start

1. Start LM Studio's server (it listens on `:1234`):
   ```sh
   ~/.lmstudio/bin/lms server start
   ```
2. Register the MCP:
   ```sh
   claude mcp add -s user bionic -- node /path/to/bionic-mcp/index.js
   ```
3. Call it. `respond` runs a prompt; `models` shows what's installed and loaded.

Point it somewhere else with `BIONIC_BASE_URL` (default `http://127.0.0.1:1234`).

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
