# bionic-mcp

You run models in [LM Studio](https://lmstudio.ai). `bionic-mcp` turns them into tools Claude Code (or any MCP client) can call, so you can hand the cheap and bulky work to your own machine instead of a paid model. It's free, local, and private: the prompt and the answer never leave your Mac.

## Why not just point the client at LM Studio's API

You can, and two things will eventually bite you. This server fixes both:

- **LM Studio silently swaps models.** Ask for a model that isn't loaded and its API quietly answers with whatever *is* loaded, so you think you're talking to a 14B and you're actually talking to a 3B. This server refuses an unknown model id up front and checks `response.model` on every reply, so you always know what answered.
- **Cold loads are slow.** On 16GB only one model stays resident, and switching costs 8-30 seconds. `model:"auto"` uses whatever's already loaded instead of forcing a reload, so a quick call stays quick.

That's the whole pitch: safe access to the models you already run, without the two foot-guns.

## Where it fits your flow

You're in Claude Code and hit a subtask that doesn't need the expensive model: classify these, summarize that, second-opinion this, extract fields from a batch. Hand it to `respond` and it runs on your hardware for free. `models` shows you what's installed and loaded so you can pick, or let `auto` decide.

## Install

### Claude Code (copy-paste)

Paste this into your terminal. It clones, installs, and registers the MCP in one shot:

```sh
git clone https://github.com/turner-moore/bionic-mcp.git && cd bionic-mcp && npm install && \
claude mcp add -s user bionic -- node "$(pwd)/index.js"
```

You also need LM Studio running its local server (that's where the models are):

```sh
~/.lmstudio/bin/lms server start
```

### Any other MCP client

Add this to your client's config (e.g. `claude_desktop_config.json`) with an absolute path:

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

Point it at a different endpoint with `BIONIC_BASE_URL` (default `http://127.0.0.1:1234`).

## Tools

- **`respond`**: run a prompt. Pick a model by id, or let `model:"auto"` use the loaded one. Takes a system prompt, temperature, and a JSON schema to force structured output.
- **`models`**: list installed models with live load state and a capability card (quality, speed, context size), so you can decide what to hand off.

One rule that matters: each prompt has to stand on its own. The local model can't see your Claude session, files, or memory, so inline every input and instruction it needs.

## Two servers in here

- **`index.js`** (`bionic`): the straight LM Studio bridge. Start here.
- **`local.js`** (`local`): an optional tiered version. It tries a faster on-device backend first (caix, Apple Core AI on the Neural Engine) and falls back to LM Studio when that's down. Register it separately if you want it:
  ```sh
  claude mcp add -s user local -- node "$(pwd)/local.js"
  ```

## Requirements

Node 18+ (for built-in `fetch`) and LM Studio with its server running. The capability card lives in `models.json`, edit it to match your own installed models.
