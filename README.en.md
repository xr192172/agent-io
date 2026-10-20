# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

[中文](README.md) · [English](README.en.md)

![dsl-workbench sandbox view (live DSL rendering)](assets/demo-workbench.png)

## What this is

- A standard MCP server: design intent / decisions / contracts encoded as structured DSL JSON (`.agent-io/design/*.dsl.json`).
- The semantic layer records **intent only** (responsibility / decisions / goals). Code **facts** are computed live by `explore_code` / `consistency_check`; mismatches are reported, never backfilled.
- Code changes go through a controlled pipeline: symbol-level editing `edit_code` → diff approval → runtime reconciliation → rollback on failure.
- Entry points: MCP / bin = `dist/src/presentation/mcp/server.js`; HTTP engine = `dist/src/presentation/http/serve.js`.
- This repo ships **no pages**; the visual frontend is a separate repo, [dsl-workbench](https://github.com/xr192172/dsl-workbench).
- Tool surface defaults to `AGENT_IO_MCP_FACE=all`; `=composed` registers the orchestration face plus one atomic entry `atomic_call`.

## How to run

```bash
npm install
npm run build                      # gen_agents + tsc + clean_dist
npm start                          # MCP server (stdio)
npm run serve                      # HTTP engine
npm run verify                     # the single gate; 3-state exit code, see docs/GUIDE-GATE.md
npm run demo                       # seed example + start engine (--prepare = seed only, -- 8081 = port)
npm run hub                        # start engine only, no seeding
npm run doctor                     # environment check + capability matrix gaps
npm run tool -- <tool> --schema     # show a tool's input schema
npm run tool -- <tool> --json '{}'  # actually call a tool
node scripts/install_mcp.mjs       # write config into MCP clients (--list / --dry-run / --target <client>)
```

MCP client configuration:

```json
{
  "mcpServers": {
    "agent-io": {
      "command": "node",
      "args": ["/path/to/agent-io/dist/src/presentation/mcp/server.js"]
    }
  }
}
```

## Tools

No hardcoded total. Authoritative list = `TOOL_DEFS` in `src/application/tool_registry.ts`; human-readable snapshot = `capability_map` (derived from the registry).

## Docs

| File | What it is |
|---|---|
| `docs/INDEX.md` | Single entry: layout / tools / status / open items |
| `docs/GUIDE-GATE.md` | Gates, certificates, expectations, write-gate rules |
| `AGENTS.md` | Dev action → required tool |
| `CONTRIBUTING.md` | What to touch when adding / removing a tool |

MIT
