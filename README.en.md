# AgentIO

**Make AI work something you can trust.**

AgentIO is a goal-driven software development engine. The user supplies a goal; models make semantic decisions; the engine locates facts, expands design, constrains writes, performs mechanical changes, verifies results, and maintains evidence. It is not a model, not an agent orchestrator, and it does not claim that structural consistency equals good design.

## Working loop

```text
Understand project facts → state design intent and criteria → expand into owned work items
→ controlled write → rebuild facts → reconcile and close
```

- **Understand**: derive relevant context from source, indexes, tests, and existing design.
- **Design**: allow target structure to differ from current implementation, with reasons and acceptance criteria.
- **Change**: refactor, add, retire, or translate incrementally.
- **Reconcile**: prove what is done, undone, and undecidable.

## Core parts

| Part | Role |
|---|---|
| Criteria | Turn "done" into independently checkable promises; `unsupported`/`pending` never become pass |
| Write gate | Controlled source-write path; rejects no-card, out-of-plan, stale-plan, and read-set conflicts |
| Design sheets | Declarative home for intent, decisions, criteria, cards, and plans; no second editable copy of source facts |
| Ledger | Append-only event stream for hanging, annotating, closing, and ruling; history cannot be silently rewritten |

<!-- FACTS:TOOLS:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 六条能力线（41 个工具，全部证据闸控）

> 工具数与语言矩阵的**唯一事实源**是 [docs/FACTS.json](docs/FACTS.json)（`node scripts/gen-facts.mjs` 生成）；本节数字由它回写，**勿手改**。分线：observe 5 / cross 4 / design 6 / meta 11 / refactor 15。
<!-- FACTS:TOOLS:END -->

<!-- FACTS:LANG:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->
## 语言支持（诚实版）

- **AST 解析**：33 门已装全量（tree-sitter；名册共注册 55 门，装了才能用——`capability_audit` 一键自检）
- **语义操作**（改名/契约闸/影响面等）：9 门全量，其余覆盖度递减（`capability_audit` 一键出缺口清单）

> 数字由 scripts/gen-facts.mjs 回写自 docs/FACTS.json（roster/installed 随机器与版本变），**勿手改**。
<!-- FACTS:LANG:END -->

## Quick start

See [the setup and usage guide](docs/GUIDE-USAGE.md). Shortest path:

```bash
git clone https://github.com/xr192172/agent-io.git
cd agent-io
npm install
npm run build
npm run env:check
```

Then configure the AgentIO MCP server in your MCP host; parameters and first-run mode are documented in `docs/GUIDE-USAGE.md`.

## Honest status

- Exercised in this repository and fixtures: design sheets, criteria, write gate, ledger, incremental verification, multi-seat collaboration.
- Rough: still too many concepts for a first-time user; diff review and error messages are improving.
- Not yet proven: an end-to-end closed loop on an independent project outside this repository.

## Docs

- [Current state and document map](docs/INDEX.md)
- [Goals, non-goals, and stage exits](docs/PROJECT-DESIGN.md)
- [Install, use, and Tailscale security boundary](docs/GUIDE-USAGE.md)
- [Development, verification, seats, and next card](docs/DEVELOPMENT.md)
- [Gates, criteria, and failure semantics](docs/GUIDE-GATE.md)
- [Original user vision quotes](docs/VISION-ORIGINAL.md)
- [Currently effective vetoes and re-entry conditions](docs/RETIRED.md)

MIT License.
