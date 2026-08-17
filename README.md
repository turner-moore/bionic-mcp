# bionic-mcp

A small stdio MCP server that exposes your local [LM Studio](https://lmstudio.ai) models
(the "Bionic" tier, served on `http://127.0.0.1:1234`) to any MCP client as typed tools.
It is a free local-inference surface: prompts go to the model running on your own machine,
nothing leaves the box.

Built for a hybrid setup where cheap or bulky work is routed to a local model first and only
escalated to a hosted model when needed.

## Requirements

- Node.js 18+ (uses the built-in `fetch`)
- LM Studio with its local server running on `:1234`
  (`~/.lmstudio/bin/lms server start`)

## Install

```bash
npm install
```

## Register with an MCP client

```bash
claude mcp add -s user bionic -- node /path/to/bionic-mcp/index.js
```

Override the endpoint with `BIONIC_BASE_URL` (defaults to `http://127.0.0.1:1234`).

## Tools

- **`bionic`** — send a prompt to a local LM Studio model and get the completion back.
- The server reads a capability card from `models.json` describing which local models are
  available and what each is good for.

## `local.js` (bonus router)

`local.js` is a second, optional MCP server in this repo. It fronts a tiered local stack,
trying a faster on-device backend first and falling back to LM Studio if that backend is not
reachable. Register it separately if you want the routed surface:

```bash
claude mcp add -s user local -- node /path/to/bionic-mcp/local.js
```

## License

MIT, see [LICENSE](LICENSE).
