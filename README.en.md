# agent-io

![CI](https://github.com/xr192172/agent-io/actions/workflows/ci.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D22.5-339933.svg)
![MCP](https://img.shields.io/badge/MCP-server-7c3aed.svg)

> Give your codebase a **living document** and a **quality gate**. As a standard MCP server, agent-io encodes **design intent** and contracts into structured DSL JSON (facts are read live, never backfilled into a second writable copy) — and turns LLM code changes into a controlled pipeline of **precise editing, runtime verification, and rollback on failure**.

[中文](README.md) · [English](README.en.md)

![agent-io companion frontend dsl-workbench sandbox view (real-time DSL rendering)](assets/demo-workbench.png)

## Current contract (quick reference)

★ This section is the **spec as it stands today**, not a changelog. To trace *why* something became this way, read the inline `★ <date>: corrected…` notes and `docs/`.

| Contract | What it is now | What NOT to repeat |
|---|---|---|
| **Entry points** | MCP / bin entry = `dist/src/presentation/mcp/server.js`; HTTP engine = `dist/src/presentation/http/serve.js` | `dist/src/server.js`, `dist/src/tools/*` (the old `src/tools/` was reorganized into application / domain / infrastructure / presentation) |
| **Frontend** | A **separate repo**, [dsl-workbench](https://github.com/xr192172/dsl-workbench). This repo's `serve` has **no pages at all** | `/workbench`, `/mindmap/<feature>` — **measured 404** (removed 2026-09-30) |
| **DSL semantic layer** | Records **intent only** (responsibility / decisions / goals). Code **facts** are computed live by `explore_code` / `consistency_check`, which *report* mismatches | "`scaffold action=backfill` auto-backfills" — deleted outright on 2026-10-01; `scaffold` no longer even has an `action` parameter |
| **Verification** | `npm run verify` is the **single total gate** (4 gates + a 3-state exit code — see "Verification") | `tests/` (**does not exist**), vitest, `npm test` |
| **Tool surface** | Default `AGENT_IO_MCP_FACE=all` ⇒ every tool exposed; `=composed` ⇒ orchestration face + one atomic entry | "the default is composed"; **any hardcoded tool total** (call `capability_map` — it is derived from the registry) |
| **Writing to disk** | Throw on failure, structured products, pre-write snapshot for rollback; **a half-applied change is worse than none** | silent fallbacks / `catch { return [] }` / "partially applied, then aborted" without rollback |

## Background & Positioning

Two chronic problems in engineering collaboration, both addressed by agent-io:

**Problem 1: Documentation drift.** Every design doc and architecture diagram goes stale as code evolves, until nobody trusts it. agent-io encodes the "design truth" as **structured DSL JSON** — and records **intent only**: the semantic layer holds file responsibilities and decisions (files / decisions / goals), while **code facts are computed live** (`explore_code` / `consistency_check` read the parsed results directly) and mismatches are **reported** rather than copied into the doc. ★ There is deliberately **no "backfill from implementation" path** (deleted outright on 2026-10-01): that would be a *second writable copy*, which inevitably diverges from the truth.

**Problem 2: Uncontrolled changes.** LLMs often edit the wrong location, break files, and produce changes that can't be verified — forcing rework. agent-io provides a controlled change pipeline: symbol-level precise editing (`edit_code`) → real diff review before applying → runtime probe reconciliation → commit only on pass, auto-rollback on failure — **changes no longer rely on luck**.

The two-layer DSL is the common foundation:

* **`geometry`**: node positions and edges — what it looks like;
* **`semantic`**: node meaning, contracts, and decisions — why it was done this way.

Human–LLM collaboration is the carrier of this mechanism, not the whole story: both share the same DSL JSON, and a frontend renders it into interactive diagrams for review, annotation, and modification.

The project follows a **frontend/backend separation** architecture:

| Layer | Responsibility | Carrier |
|---|---|---|
| **Data / protocol layer** | DSL storage, code understanding, generation/consistency, brick system, runtime verification, diagnosis loop; exposes MCP tools and an HTTP API | This repository (MCP server) |
| **Visual collaboration frontend** | Renders live DSL into an interactive workbench (sandbox, version diff, issue list, probes, contracts, code approval) | [dsl-workbench](https://github.com/xr192172/dsl-workbench) (separate repo) |

## Core Capabilities

One thread runs through everything: **any code → contract-bearing bricks → verified contracts**. The **contract** is the single shared interface between the two ends — the brick line produces contracts, the verification line validates them.

| Capability | Description | Representative tools |
|---|---|---|
| **Visual protocol layer** | DSL read/write/edit, design view vs. actual code snapshot diff, diagram/vector/document export (from storage) | `get_dsl` / `edit_dsl` / `manage_feature` / `render_design` / `diff_views` |
| **Code understanding** | Project import, semantic search, impact analysis, architecture layering, monolith splitting, algorithm/dataflow derivation | `import_project` / `explore_code` |
| **Brick system** | Harvest code from any source into contract-bearing bricks: closure extraction, contract extraction, decision-card recovery (the brick-box / assembly family was removed on 2026-10-05; design docs kept in `docs/`) | `harvest_closure` / `extract_contracts` / `harvest_decisions` |
| **Runtime verification** | Reconcile contracts and behavior baselines against actual runtime observations, forming a "commit only if verified, roll back on failure" gate | `observe_instrument` / `observe_judge` / `reconcile_chain` / `reconcile_effects` |
| **Generation / consistency** | Generate a code skeleton from the DSL semantic layer; compare expected contracts against actual code and report (read-only — mismatches are *reported*, never backfilled) | `scaffold` / `consistency_check` |
| **Deterministic refactoring (no rework)** | Symbol-level editing (never matches wrong), bulk/cross-file renaming, dead code removal, diff review before applying, rollback on failure | `edit_code` / `rename_*` / `refactor_pipeline` |
| **Diagnosis loop** | Full chain from symptom → root cause → fix → verify (or roll back) ⇒ ★ now on the tool face: `diagnose_loop` (★ **commit stays with you**; the tool stops at "verified") | `diagnose` / `refactor_judge` / `diagnose-loop` (CLI) |
| **Multi-language AST foundation** | Unified extraction of symbols / imports / call edges / type references on top of tree-sitter | `ts_kernel` / `package_migration` |

## Quick Start

```bash
# 1. Clone the repository to your machine (first time)
git clone https://github.com/xr192172/agent-io.git
cd agent-io

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Start the MCP server (stdio mode)
npm start
```

Register in your MCP client configuration:

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

You can also install into all major MCP clients (Claude / Cursor / VS Code / Codex / Copilot / Gemini / Windsurf / Cline) with one command:

```bash
node scripts/install_mcp.mjs            # Write config into all installed clients (auto-merge + backup)
node scripts/install_mcp.mjs --list     # Show config paths and write status per platform
node scripts/install_mcp.mjs --dry-run  # Preview what will be written (no disk writes)
node scripts/install_mcp.mjs --target claude  # Write a single platform only
```

### One-command demo

```bash
npm run demo                # seed the built-in example + start the data/API engine (prints how to reach the frontend)
npm run demo -- 8081        # Custom port
npm run demo -- --prepare   # Seed only (build + persist feature), no server — good for CI / acceptance
npm run hub                 # Start the engine only, no example seeding (daily use, for the frontend to connect to)
```

Examples are persisted from `examples/*.json` through the **same storage entry the toolchain uses** (`saveDSL`); an existing feature with the same name is skipped, so your data is never overwritten.

> ★ **This repo has no pages** — `npm run demo` does **not** open a browser workbench. `serve` has shed all
> self-contained pages: `GET /` returns a small JSON note, and `/workbench` plus `/mindmap/<feature>`
> are **measured 404**. The visual frontend is a **separate repo**,
> [dsl-workbench](https://github.com/xr192172/dsl-workbench): run `npm install && npm run dev` there and
> point it at this `serve` address.
> If you already know the frontend URL:
> `AGENT_IO_FRONTEND_URL=http://localhost:5173 npm run demo -- --open`.

## MCP Tool Reference

Tools are organized into "capability navigation + primary tools + specialized tools": `capability_map` provides layered capability-lane navigation, primary tools provide unified entry points, specialized tools each do one job. The tables below are a curated subset, not the full list.

> ★ **This README deliberately does not state a tool total.** 2026-10-13: this line used to say "68 MCP tools", and a same-day measurement (`node scripts/mcp/mcp_scan.mjs`) returned **69** ⇒ a hand-maintained number *always* drifts, so deleting it beats bumping it once.
> The authoritative count is `TOOL_DEFS` (`src/application/tool_registry.ts`); for a human-readable snapshot of the current state, call **`capability_map`** (derived from the registry, so it cannot drift).

### Capability navigation (1)

| Tool | Purpose |
|------|------|
| `capability_map` | Capability-lane navigation: 6 lanes (design / refactor / observe / harvest / cross / meta) × in-lane tools with when-to-use; the agent layers then enters a concrete tool. High-frequency tools can bypass this navigation |

**Usage examples**

```json
// 1. No args: return the map of all 6 capability lanes (recommended: locate first)
{}

// 2. View a single lane (e.g. the refactor/rename lane)
{ "lane": "refactor" }

// 3. Valid lane values
{ "lane": "design" }    // design / living docs
{ "lane": "refactor" }  // refactor / rename
{ "lane": "observe" }   // observe / verify
{ "lane": "harvest" }   // contract / closure harvesting
{ "lane": "cross" }     // cross-repo / health
{ "lane": "meta" }      // meta-info / exploration
```

> Note: `capability_map` is a read-only navigation with no side effects. The return is a three-level map "lane → in-lane tools → when to use each"; the agent picks a tool from it, then enters the concrete tool. High-frequency tools (`get_dsl` / `edit_dsl` / `explore_code` / `rename_symbols` / `rename_files` / `find_references`) work directly without going through it first.
>
> The catalogue is **derived automatically from the tool registry**: `LANE_OF` in `src/application/meta/registry/capability_map.ts` only declares the tool → lane membership, and `when` defaults to the first sentence of the registered description. A newly registered tool needs just one membership line, and unmapped tools are listed explicitly under "unmapped" rather than silently vanishing.
>
> ★ Corrected 2026-10-13: this line used to say "Consistency is enforced by `tests/tools/capability_map.test.ts` against the real `TOOL_DEFS`" — **that file no longer exists** and following the reference gives a 404. The test framework was removed wholesale on 2026-10-04 (see "Verification"). **Nothing guards this for you now**: an unmapped tool only shows up if a human actually reads the output.

### Primary tools (7)

| Tool | Purpose |
|------|------|
| `get_dsl` | Unified read-only entry: query DSL / nodes / edges / files / decisions / annotations / snapshots / simulation state / diffs, with `view` (design/live) and filter parameters |
| `edit_dsl` | Unified write entry: batch `operations[]` for add/update/delete, semantic binding, status updates, annotations, approvals, auto-layout; executed in order, full rollback on any failure (atomic) |
| `manage_feature` | Feature lifecycle management: create / clone / template / list / delete |
| `render_design` | Render entry: mindmap (default) / svg / markdown, all read from storage by `feature`; `output_path` sets the destination |
| `scaffold` | Scaffold entry: generate a code skeleton from the DSL semantic layer (go / ts / js / py / vue / tsx + state inference), plus INVARIANTS.md recording cross-file invariants; existing files are not overwritten by default. ★ **There is no `action` parameter** (generation is the only thing it does); ★ the former `action=backfill` (parsing implementation API signatures back into the DSL) was **deleted outright on 2026-10-01** — to read code facts, use `explore_code` / `get_dsl`, which compute them live |
| `consistency_check` | Compare expected contracts against actual code; output a consistency report and cross-file invariants (read-only) |
| `explore_code` | Code understanding entry: semantic search, impact analysis, architecture layering, monolith detection, split suggestions, algorithm/dataflow derivation, simulation replay, etc. |

### Specialized tools

> ★ Curated subset by topic (for findability — **not** the full list); the authoritative count is `TOOL_DEFS`.
> The count that used to sit in this heading has been removed: as a "curated subset" number it could never equal the row count, and hand-maintained numbers only drift. Call `capability_map` for a real total.

**Code understanding**

| Tool | Purpose |
|------|------|
| `import_project` | Import a code project into DSL (local absolute path or browser upload; honors `.gitignore`) |
| `diff_views` | Diff the design view against the live code snapshot |
| `render_brickwork` | Render a dependency-driven feature-community workbench (brickified preview) |
| `find_references` | Query symbol / field references (reference view: see blast radius before changing); read-only |
| `detect_drift` | Check whether the design is stale / under-implemented against the code change |

**Brick system**

| Tool | Purpose |
|------|------|
| `harvest_closure` | Harvest bricks together with their transitive import closure |
| `harvest_decisions` | Reverse-extract design decisions from project records |
| `extract_contracts` | Extract brick contracts (role / shapes / effects) |
| `reconcile_effects` | Reconcile effect candidates against runtime observations |
| `narrate_step` | Narrate a pipeline step as a governed narration brick |

**Runtime verification (Observe)**

| Tool | Purpose |
|------|------|
| `observe_instrument` | Auto-instrument / restore TS projects; writes a probe ledger and stats after the run |
| `observe_log` | Query runtime logs per file |
| `observe_judge` | Batch-judge runtime events |
| `feature_line` | Feature line: wire each feature into one main chain (feature → entry → call nodes), for step-through run / big-screen projection |
| `reconcile_chain` | Reconcile a host chain against its real runtime events |
| `run_tests` | Run tests and return structured failure localization (filter-targeted / full) |

**Deterministic refactoring**

| Tool | Purpose |
|------|------|
| `edit_code` | Symbol-level code editing (replace / insert / delete / range) |
| `rename_symbols` | Unified identifier renaming: `scope=module` (default) renames cross-file module-level symbols (whole-batch atomic); `scope=local` renames file-local bindings (scope-isolated, per-item independent). Items `renames=[{file,symbol,to,decl_line?}]`, whole-run dry-run first |
| `rename_files` | Batch file renaming (single or batch unified entry; whole-run dry-run first) |
| `remove_dead_imports` | Remove stale imports |
| `refactor_pipeline` | Deterministic refactoring pipeline (dead code cleanup + package
migration; auto-detects the project language and runs language-specific stages — auto-triggers Spring MVC layering on
Java projects, Python dead-code cleanup on Python projects; apply / verify / rollback all in one loop) |
| `annotate_functions` | Function semantic comments (TS/JS + Go): scan coverage → LLM fills missing → re-sync via `@fnhash` body fingerprint when stale; mode=scan/dry_run/apply |
| `suggest_renames` | Suggest semantic names for short / meaningless variables (incl. restoring readable names in obfuscated / minified code) |
| `find_similar_names` | Detect and disambiguate easily-confused similar names |

> **Deobfuscation boundary**: full deobfuscation is a heuristic / LLM-level non-deterministic
> restoration, unfit as a base tool of the deterministic refactor pipeline. The reversible half
> (structure-preserving renaming) goes through `suggest_renames` + `rename_symbols` (rollback-safe);
> string-encryption / flattening etc. that are irreversible or undecidable stay with humans / LLM —
> don't expect "compile → disassemble" to restore readability (the readable info is lost at compile time).

**Diagnosis & review**

| Tool | Purpose |
|------|------|
| `refactor_judge` | LLM review gate: accept / reject / escalate uncertain items |
| `diagnose` | Symptom → root cause analysis: locate candidates → trace call chain → assess impact → aggregate root cause → suggest verification |
| `diagnose_loop` | ★ **Diagnosis loop** (T202, moved from CLI to the tool face): diagnose → generate patch → apply → verify, **auto-rollback on failure**. ★ `apply` defaults to `false` (compute-only) · ★ **does NOT commit** git (that is yours) |

| `upgrade` | **Version-upgrade contract diff** (single entry, two actions): `scan` (read-only) reports "declared toolchain versions vs local runtimes / language features beyond the declared boundary / removed-deprecated APIs / uncovered extensions (unchecked files are stated, not hidden)", with optional `gate` (compile-level) and `dynamic` (runtime-level, ★ really runs the source) gates; `apply` runs the closed loop: exact string replacement → pre-edit baseline commit → verification → **commit on pass, git rollback on fail** (★ requires `project_dir` to be a git repo; the baseline commit **also sweeps in pre-existing working-tree changes**) |

**Design intent (overlay)**

| Tool | Purpose |
|------|------|
| `design_intent` | Design-intent (why) unified entry (`action=set` / `propose`). `set`: write `goals` (structured objectives/direction) + `edge_intents` (why A depends on B / boundary attribution) into the design-intent overlay, which then lands into base `meta.goals` / `edge.intent` for the LLM and read side to consume; `propose`: LLM drafts a "design-intent rewrite" approval card, only computing a before/after intent diff **without writing** — the human approves in the workbench "Code approval" tab before it truly lands in the DSL; reject discards (human is the decision approver, LLM the proposer) |

**Canvas annotations**

| Tool | Purpose |
|------|------|
| `canvas_notes` | Unified canvas-notes entry (read=work orders / mark=status / decide=LLM) |
| `archive` | Unified retired-node library entry (node=archive a file·write & irreversible / list=list archived entries·read-only) |
| `review_changes` | Pending-PR entry (list/show/comment/approve/reject) — ★ the confirmer is the **next agent taking over**, not a human; comments are how a "meeting" is held, and **self-approval is refused** |
| `observe_proposals` | Observe-proposal entry (list/show/approve/reject) — ★ also a **handover** entry; approve runs a **4-layer gate**, and any failure ⇒ **frozen** (proposal rejected, authoritative DSL untouched) |
| `sync_contracts` | Backfill DSL contracts using the server_registry schema as source |

**LLM gateway**

| Tool | Purpose |
|------|------|
| `gateway_provider` | Unified LLM gateway entry (list / upsert / delete / stats) |

**Project docs**

| Tool | Purpose |
|------|------|
| `read_project_docs` | Read the doc list and content under a project's `docs/` directory |

**Migration & assessment**

| Tool | Purpose |
|------|------|
| `impact_analysis` | Pre-change risk-closure report: change points → reverse reachable closure, output affected files and risk ranking (`hubs=true` for hot-spot survey) |
| `cross_repo_symbol_index` | Cross-project symbol index: intersection of top-level symbols = conflicts / twins, difference = migration scope |
| `behavior_baseline` | Behavior baseline: canary harness runs sample cases and records a snapshot, verify after changes to confirm "does it work" |
| `code_health` | Code health score: dead code / cyclomatic complexity / layering violations → health score + issue list |

### The `view` parameter

- `design` (default): the design view — live DSL + feature archive, the object the LLM actively designs and iterates on; corresponds to the "Design" view in the browser;
- `live`: the actual view — a read-only code snapshot rebuilt by `import_project` / `explore_code`; corresponds to the "Actual" view in the browser.

The design view is what gets iterated; the actual view is what the code currently looks like. `diff_views` compares the two.

## Capability Matrix & Multi-language Support

Tools are built on tree-sitter parsers, loaded on demand.

> NOTE (corrected 2026-10-08): this section used to say "**168+ language AST parser**" — **that number had no
> source**. Measured from the list the official docs point to (`tree-sitter.wiki.git` → `List-of-parsers.md`):
> **509 table rows / 440 distinct parser names / 482 repos**, of which **227 have an npm package** and **213 are
> GitHub-only**. **This repo registers only 55**, and **11 of those had package names that do not match npm
> reality** (now declared explicitly via `pkgSpec`; re-runnable check: `npm run lang:check`).
> **Do not describe this repo's capability with upstream's magnitude.**

The core foundation `ts_kernel` supports symbols / imports / call edges / type references for every **installed
and usable** language; some refactoring features are rolled out per language tier:

- **full_ast**: Go / TypeScript / JS family in full; Python depending on the feature
- **regex_fallback**: a few features fall back to regex for some languages
- **unimplemented**: unimplemented "feature × language" pairs — explicitly registered, visible, and schedulable

Scan gaps automatically during a health check:

```bash
npm run doctor        # Environment readiness check + capability matrix gap self-check
npm run capability    # Output capability gaps (JSON / human-readable)
```

## Diagnosis Loop (CLI)

`diagnose-loop` upgrades diagnosis from "just suggestions" to "closed-loop execution": diagnose → fix → verify → commit (or roll back).

```bash
npm run diagnose-loop -- --project <project-dir> --symptom "<symptom>"
```

| Flag | Description |
|---|---|
| `--project <dir>` | Target project (must be a git repository; rollback relies on git) |
| `--symptom "<symptom>"` | Symptom description (error message / observed behavior) |
| `--auto` | Fully automatic: baseline commit + skip patch approval + auto-commit on pass |
| `--apply` | Apply the patch directly, skipping approval (the real diff is still printed for review) |
| `--skip-verify` | Skip the verification phase |
| `--verify-timeout <sec>` | Verification command timeout (default 300s) |

Flow: baseline snapshot (auto-commit before changes) → build symbol cache → diagnose (rule + LLM dual engine) → LLM line-level patch (modification whitelist + line-range validation + approval showing the real diff) → run the project's tests: on pass, commit exactly the patched files; on failure, roll back automatically.

## Verification

This project **ships no unit-test suite** (decided 2026-10-04; the test framework was removed wholesale and the `tests/` directory **does not exist**). Verification is **one total gate + real invocation**:

```bash
npm run verify                            # ★ the single total gate: 4 gates, 3-state exit code (see below)
npm run build                             # type check + build (tsc; the same thing as verify's ts gate)
npm run doctor                            # environment health check + capability-matrix gaps
npm run tool -- <tool> --schema           # see what args a tool actually needs (★ don't guess, don't read source)
npm run tool -- <tool> --json '{...}'     # actually invoke a tool — the only meaningful acceptance
npm run structure:gap                     # structural intent vs. reality (runs as a "report" inside verify)
```

> `npm run doctor` is a **health report, not a gate**: it lists "not ready" items and **exits 1**, and those are
> usually **environmental** (no instrumentation ⇒ no events source, no LLM env, skills not installed into the
> target agent, language-pack gaps…). ★ It now **names which one is missing** (e.g. `缺：design-canvas-router`)
> — act on that line rather than reading exit code 1 as "the repo is broken". ★ The only real gate is below.

`npm run verify`'s four gates (plus one report) — **only these two kinds qualify as a gate**: a compiler / official linter, or something that catches a *wiring* fact:

| Gate | What it checks | Why it qualifies |
|---|---|---|
| **ts types** | `tsc` | A compiler, not something this repo invented |
| **MCP tool signatures** | `scripts/mcp/mcp_scan.mjs`, invoking every tool **through the CLI entry** | Catches whether the zod schema is actually **wired up** — the type system is blind to zod, so **grep cannot find this** |
| **Go compile** | `go build ./...` (observe-lang-go) | Official toolchain |
| **Go static check** | `go vet ./...` | Same |
| *[report] structural intent gap* | `scripts/structure_gap.mjs` | Prints its body on pass and is excluded from the gate count; but a **FAIL still counts** (exits 1) |

★ **Three-state exit code**: `0` = every gate really ran and passed · `1` = some gate FAILed · `2` = **some gate could not run (SKIP)**.
"Could not run" deliberately does **not** count as passing — otherwise an environment missing a toolchain would read "never ran" as "green".

> ★ This repo **no longer maintains gates of its own making** (decided 2026-10-05). The criterion: **anything one `grep` can answer does not deserve a gate**, and a self-invented **sweep gate can silently die while still showing ✅** (looks like a gate, is actually a tautology) ⇒ changes go through **case-by-case checking and fixing**, not sweeping.

CI additionally runs three things: `npm run verify` (its own job, with the Go toolchain),
`node third_party/archify/bin/archify.mjs doctor` (keeps the vendored renderer + schema + example triple intact),
and the Go language pack's `go build ./... && go test ./...`.

## Tech Stack

- **MCP server**: TypeScript + [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- **AST parsing**: tree-sitter (Go / TypeScript / Python / JavaScript), language packs detected at runtime
- **Export**: `render_design` does **mindmap / svg / markdown** only, all **read from storage** (export is a data-layer concern);
  ★ the former "HTML string-assembly renderer (self-contained single-file output)" was **removed on 2026-09-30** — the UI belongs to the separate dsl-workbench frontend.
- **Schema validation**: ajv + ajv-formats

## Agent Guidance

The repository ships agent-facing skills (`.trae/skills/`):

- **design-canvas-router**: progressive-disclosure routing — "what problem → which tool", layer by layer; check existing capabilities first before deciding to build a new tool;
- **design-canvas-mind**: a mental wrapper providing a capability map, needs-to-toolchain orchestration, tool-call caching, and honest-delivery discipline.

Loading these two skills before using the toolchain is recommended, to avoid reinventing the wheel. ★ The tool face also has **`capability_map`** (read-only navigation: 6 lanes × in-lane tools × when to use each) — **call it first whenever you are unsure which lane to take**.

> ★ Corrected 2026-10-08: these two skills were written here as `agent-io-router` / `agent-io-mind`, while the
> directories on disk have always been `design-canvas-router` / `design-canvas-mind` (the rename missed this
> README) ⇒ following the README gets you a 404. **Trust the directory names under `.trae/skills/`.**

## License

MIT
