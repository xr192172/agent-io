# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

[中文](README.md) · [English](README.en.md)

![dsl-workbench sandbox view (live DSL rendering)](assets/demo-workbench.png)

**agent-io is a "design-first" development base**: a standard MCP server + CLI for AI agents (Claude Code, DeepSeek Harness, Pi, or any MCP-capable host). It keeps "**what the design says**" and "**what the code actually does**" as separate ledgers, connected by **machine-checkable acceptance criteria** — when the design says something and the code doesn't do it, **it turns red immediately; red becomes a task; an actor claims it; completion is verified**.

## Core mechanisms

### 1. Design ledger & design database — intent and facts, recorded separately
- The **design ledger** (`.agent-io/design/*.dsl.json`) records **intent only**: responsibilities, decisions, acceptance criteria. It never mirrors code content — code **facts** are always computed live.
- The **design database** (`design-db/`): per-file projections generated from the ledger (400+), containing current symbols, expected symbols, and reverse call edges — one-hop "what breaks if I change this" queries.
- **Coverage reconciliation**: files on disk, ledger nodes, and the exclusion list are three-way aligned. Every file is either designed, explicitly excluded, or listed in the gap report — **no silent blind spots**.

### 2. Acceptance criteria — three layers of contract
| Layer | Criterion | Question answered |
|---|---|---|
| Declarative | `signature-matches` / `symbol-exists` | What does the function **look like** |
| Side-effect | `call-exists` / `edge-absent` | What does it **quietly do** |
| Behavioral | `behavior-cases` (given input → assert output, differential replay) | Does it **compute correctly** |

Criteria live on decision cards in the ledger; the evaluator judges **current code** live — with four-valued semantics (pass / fail / unsupported / pending): "cannot judge" never masquerades as "pass".

### 3. Criteria evaluation — always-on full runs + three-tier caching
- Every overview read performs a **full evaluation** (hundreds of criteria): stale acceptance standards surface the same day, not after a month of silent red.
- **First-order content-hash cache**: unchanged target file → reuse the previous verdict; changed → re-evaluate only affected criteria. Measured: 677 criteria, two consecutive runs, **577 cache hits / 0 inconsistencies**.

### 4. Task system — multi-actor by design
- Five task states (candidate → preparing → claimed → done/void), **two-phase claiming** (claim first; start only once preconditions are in place).
- **Read-set conflict detection**: claiming declares which symbols/files you will read; overlap with an active task's read set is rejected — concurrent collaboration without collisions.
- **Close-out gate**: completion requires all post-state criteria green + reproducible evidence.
- **Done means archived**: closed tasks are archived whole (separate audit store); a successor chain (`follows`) records how work hands over.
- **Sub-agents are just another actor**: the base ships no orchestration — any agent claims work under its own identity; delegation, isolation, and accounting are all carried by the task system.

### 5. One write primitive — every change goes through a gate
Source edits have exactly one entry point, `edit_code`: the **write gate** verifies "is this change attached to a task you claimed", writes outside the declared **read set** are rejected, and after writing the index syncs and affected criteria re-evaluate. On failure everything rolls back to the pre-call bytes — no half-success states.

### 6. Tool-face projection — one registry, multiple views
A registry of 61 atomic tools with face-based exposure: default `AGENT_IO_MCP_FACE=all`; `=composed` exposes only the orchestration face (15 composite tools) + one atomic entry `atomic_call` (everything else remains reachable) — **payload −77.5%**. The orchestration face is data-derived (gate lists ∪ derived chains) and never drifts from the atomic face.

### 7. Three read layers — from overview to detail
`overview` (cross-store ledger, KB-scale) → `digest` (per-file responsibilities & states) → on-demand drill-down (per file / symbol / task). Every layer is a projection of the same ledger.

## Quick start

```bash
npm install
npm run build                      # agent dir generation + tsc + dist cleanup
npm run verify                     # the single gate (9 checks: types/signatures/Go/fixtures/semantics/structure/claiming/evidence)
npm start                          # MCP server (stdio)
npm run serve                      # HTTP engine
```

Wire it into any MCP host:

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

**Sandboxing tip**: on the host side, disable native file and shell tools and keep only the agent-io tool face — every file change then automatically goes through the criteria and gates ("discipline, physicalized").

## Architecture

```
presentation/   MCP server · HTTP engine · CLI (three projections of one registry)
application/    Use cases: criteria evaluation · task system · ledger I/O · replay
domain/         Vocabulary: criteria · actors · state machines (single authority, no IO)
infrastructure/ Storage · index · parsers (TS/Go/Java/Python) · archive store
```

Dependencies point one way, downward; domain types and semantics are referenced by both upper layers.

## Tools

No hard-coded counts. The authoritative list = `TOOL_DEFS` in `src/application/tool_registry.ts`; the human-readable snapshot = `capability_map` (derived from the registry).

## Docs

| File | Contents |
|---|---|
| `docs/INDEX.md` | Single entry: directory / tools / status / open work |
| `docs/GUIDE-GATE.md` | Gates, evidence, criteria, write-path rules |
| `AGENTS.md` | Development action → required tool |
| `CONTRIBUTING.md` | What to touch when adding / removing tools |

## Related repositories

- [dsl-workbench](https://github.com/xr192172/dsl-workbench) — visual front end (sandbox view)

MIT License
