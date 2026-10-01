# [B] 字段字典（**机器生成，不手抄**）

> **重生成**：`node scripts/measure_b_contract.mjs --dict > docs/b-field-dictionary.md`
> 人群：[B] = `application/**` 里"**导出函数名 == 文件名 camelCase**"的导出函数（仓内既有约定）。
> 判据：**TS 编译器的 type checker**（类型是结构化数据；正则只能猜）。
> ★ 本文件**只是读数**；语义判断不在这里，见 `docs/tool-chain-contract.md`。
> ⚠️ 类型比较前已**归一化可选性**（`string` 与 `string | undefined` 视为同型）——
>    否则会把"必填 vs 可选"误报成"同名不同型"（本量具第二版栽过，8 个假阳性）。

## 结论（一眼版）

| 侧 | 字段名总数 | 真·共用（同名 + 同型 + ≥2 个 [B]） | ★ **同名不同型** | 只服务 1 个 [B]（领域字段） |
|---|---:|---:|---:|---:|
| 入参 | 134 | **24** | **8** | **102（76%）** |
| 产物 | 189 | **16** | **21** | **152（80%）** |

★ **80% 的产物字段只服务 1 个 [B]** —— 数据完全印证「这些字段当时就是不通用的，只为它这一个功能服务」。
★ 而剩下 20% 里，**21 个是"同一个词指不同东西"** ⇒ **不能靠"名字通用"来造通用层**（见 §同名不同型的证据）。

### 同名不同型的证据（挑最刺眼的）
| 字段 | 有几种类型 | 例 |
|---|---:|---|
| `files`（产物） | **6** | `string[]` ／ `FileContractReport[]` ／ `BrickFileReconcileReport[]` ／ `SlimFileReport[]` ／ `FileReconcileReport[]` ／ `FileRemoval[]` |
| `stats`（产物） | **5** | 5 个**字段完全不同**的对象 |
| `written`（产物） | **2** | `boolean`×4（**是否落盘**） ／ `string[]`×1（**文件表**） |
| `mode` | 3 | `"browse"|"search"|"detail"` ／ `"llm"|"rule"` ／ `"symbol"|"field"|"type"` |
| `scope`（入参） | 3 | `"changed"|"all"` ／ `"all"|"closure"` ／ `"module"|"local"` |
| `action`（入参） | 2 | `manage_feature` 的 5 个动作 ／ `explore_code` 的 15 个动作 |
| `query`（入参） | 2 | `string` ／ 19 个枚举字面量 |

★ 结论（也是纪律）：**同一个字段名在不同 [B] 里可以指完全不同的东西**
⇒ 想统一形态，**只能新增语义唯一的字段，不能复用/合并既有名字**。

---

# [B] 字段字典（**机器生成**；重生成：`node scripts/measure_b_contract.mjs --dict`）

人群：42 个 [B]（= application/** 里"导出函数名==文件名camelCase"的导出函数）

## 入参字段（共 134 个字段名）

- 真·共用（同名 + 类型唯一 + ≥2 个 [B]）：**24**
- ★ 同名**不同型**（必须人核语义）：**8**
- 只出现在 1 个 [B]（= 领域字段）：**102**

| 字段名 | [B] 数 | 类型（出现次数） | 判定 |
|---|---:|---|---|
| `feature` | 18 | `string` | 共用候选 |
| `project_dir` | 17 | `string` | 共用候选 |
| `dry_run` | 6 | `boolean` | 共用候选 |
| `box_dir` | 5 | `string` | 共用候选 |
| `write` | 5 | `boolean` | 共用候选 |
| `file` | 4 | `string` | 共用候选 |
| `node_id` | 4 | `string` | 共用候选 |
| `events_files` | 3 | `string[]` | 共用候选 |
| `opts` | 3 | `?` | 共用候选 |
| `query` | 3 | `string`×2 ／ `"dsl" | "features" | "nodes" | "edges" | "node" | "decisions" | "files" | "file" | "calls" | "functions" | "annotations" | "approvals" | "approval_history" | "snapshots" | "templates" | "simulation_state" | "diff" | "goals" | "edge_intents"`×1 | ★ 同名不同型 |
| `scope` | 3 | `"changed" | "all"`×1 ／ `"all" | "closure"`×1 ／ `"module" | "local"`×1 | ★ 同名不同型 |
| `symbol` | 3 | `string` | 共用候选 |
| `action` | 2 | `"create" | "clone" | "template" | "list" | "delete"`×1 ／ `"search" | "read" | "diff_impact" | "arch_layer" | "guided_tour" | "check_monolith" | "derive_split" | "derive_chain" | "derive_anim_flow" | "derive_algorithm" | "derive_mind_map" | "inject_replay" | "run_simulation" | "reset_simulation" | "watch"`×1 | ★ 同名不同型 |
| `args` | 2 | `Record<string, unknown>` | 共用候选 |
| `brick_name` | 2 | `string` | 共用候选 |
| `bricks` | 2 | `string[]`×1 ／ `BrickSpec[]`×1 | ★ 同名不同型 |
| `detail` | 2 | `boolean`×1 ／ `string`×1 | ★ 同名不同型 |
| `files` | 2 | `string[]` | 共用候选 |
| `limit` | 2 | `number` | 共用候选 |
| `max_depth` | 2 | `number` | 共用候选 |
| `max_steps` | 2 | `number` | 共用候选 |
| `mode` | 2 | `"check" | "status"`×1 ／ `"symbol" | "field" | "type"`×1 | ★ 同名不同型 |
| `name` | 2 | `string` | 共用候选 |
| `project_root` | 2 | `string` | 共用候选 |
| `r` | 2 | `?` | 共用候选 |
| `renames` | 2 | `FileRenameItem[]`×1 ／ `RenameSymbolsItem[]`×1 | ★ 同名不同型 |
| `report_literals` | 2 | `boolean` | 共用候选 |
| `source_path` | 2 | `string` | 共用候选 |
| `to` | 2 | `string` | 共用候选 |
| `tools` | 2 | `?` | 共用候选 |
| `view` | 2 | `"structure" | "teach"`×1 ／ `DSLView`×1 | ★ 同名不同型 |
| `write_dsl` | 2 | `boolean` | 共用候选 |

★ 同名不同型的**全部出处**（逐个看语义）：

- `query`
    - `string` ×2 ⇒ searchBricks, semanticSearch
    - `"dsl" | "features" | "nodes" | "edges" | "node" | "decisions" | "files" | "file" | "calls" | "functions" | "annotations" | "approvals" | "approval_history" | "snapshots" | "templates" | "simulation_state" | "diff" | "goals" | "edge_intents"` ×1 ⇒ queryFeature
- `scope`
    - `"changed" | "all"` ×1 ⇒ detectDrift
    - `"all" | "closure"` ×1 ⇒ findReferences
    - `"module" | "local"` ×1 ⇒ renameSymbols
- `action`
    - `"create" | "clone" | "template" | "list" | "delete"` ×1 ⇒ manageFeature
    - `"search" | "read" | "diff_impact" | "arch_layer" | "guided_tour" | "check_monolith" | "derive_split" | "derive_chain" | "derive_anim_flow" | "derive_algorithm" | "derive_mind_map" | "inject_replay" | "run_simulation" | "reset_simulation" | "watch"` ×1 ⇒ exploreCode
- `bricks`
    - `string[]` ×1 ⇒ assembleBricks
    - `BrickSpec[]` ×1 ⇒ harvestFromUrl
- `detail`
    - `boolean` ×1 ⇒ searchBricks
    - `string` ×1 ⇒ narrateStep
- `mode`
    - `"check" | "status"` ×1 ⇒ detectDrift
    - `"symbol" | "field" | "type"` ×1 ⇒ findReferences
- `renames`
    - `FileRenameItem[]` ×1 ⇒ renameFiles
    - `RenameSymbolsItem[]` ×1 ⇒ renameSymbols
- `view`
    - `"structure" | "teach"` ×1 ⇒ deriveMindMap
    - `DSLView` ×1 ⇒ queryFeature

★ 只服务 1 个 [B] 的字段（领域字段，**不动**）：
  annotation_id, annotation_node_id, apply_literals, assignee, atomic, auto, brick_dir, cfg, changed_files, code, code_dir, commands, comment_files, cwd, dead, decision_status, direction, doc_dir, edge_intents, end, entry, feature_a, feature_b, field, file_id, file_layer, file_path, file_status, filter, force, from, function, gap_notes, gen_descriptions, git_root, go_version, goals, h_gap, has_invariants, include_all, include_callers, incremental, interval, items, known_blind_spots, language, layer, live_dir, max_cfg_branches, max_closure, max_cross, max_files_per_community, merged_into, method, min_hit, min_score, module, narratives, new_file, new_text, old_text, op, operations, output_dir, output_path, overwrite, parent, projectRoot, quiet, re_export_extracted, refresh, rename_file_if_matching, respect_swimlanes, retire_reason, return_contracts, sample, severity, since_ref, source, start, status, sub, subsplit, symbols, target_dir, target_file, targets, thread, timeoutMs, title, type, ui_framework, unresolved_only, v_gap, verified, verify_build, verify_compile, verify_dir, verify_test, view_b, width, zero_third_party

## 产物字段（共 189 个字段名）

- 真·共用（同名 + 类型唯一 + ≥2 个 [B]）：**16**
- ★ 同名**不同型**（必须人核语义）：**21**
- 只出现在 1 个 [B]（= 领域字段）：**152**

| 字段名 | [B] 数 | 类型（出现次数） | 判定 |
|---|---:|---|---|
| `message` | 29 | `string` | 共用候选 |
| `feature` | 12 | `string` | 共用候选 |
| `ok` | 7 | `boolean` | 共用候选 |
| `blocked` | 6 | `string[]` | 共用候选 |
| `data` | 6 | `unknown`×4 ／ `{ feature: string; design_exists: boolean; live_exists: boolean; baseline_exists: boolean; summary: { design_files: number; live_files: number; added_files: number; removed_files: number; modified_files: number; ... 6 more ...; removed_edges: number; }; files: FileDiff[]; edges: EdgeDiff[]; three_way?: { ...; } | un...`×1 ／ `EditReceipt`×1 | ★ 同名不同型 |
| `files` | 6 | `string[]`×1 ／ `FileContractReport[]`×1 ／ `BrickFileReconcileReport[]`×1 ／ `SlimFileReport[]`×1 ／ `FileReconcileReport[]`×1 ／ `FileRemoval[]`×1 | ★ 同名不同型 |
| `stats` | 5 | `{ steps: number; branches: number; loops: number; returns: number; throws: number; handlers: number; }`×1 ／ `{ total: number; business: number; functional: number; hybrid: number; avg_confidence: number; low_confidence: number; shapes_extracted: number; config_keys: number; writes_candidates: number; holds_candidates: number; emits_candidates: number; }`×1 ／ `{ seed_count: number; internal_count: number; value_reachable_count: number; max_depth_reached: number; stdlib_count: number; third_party_count: number; unresolved_count: number; }`×1 ／ `{ files_matched: number; confirmed: number; newly_observed: number; unobserved: number; }`×1 ／ `{ files_matched: number; candidates_confirmed: number; newly_observed: number; unobserved: number; }`×1 | ★ 同名不同型 |
| `written` | 5 | `boolean`×4 ／ `string[]`×1 | ★ 同名不同型 |
| `dryRun` | 4 | `boolean` | 共用候选 |
| `mode` | 4 | `"browse" | "search" | "detail"`×1 ／ `"llm" | "rule"`×2 ／ `"symbol" | "field" | "type"`×1 | ★ 同名不同型 |
| `project_dir` | 4 | `string` | 共用候选 |
| `filesWritten` | 3 | `number` | 共用候选 |
| `meta` | 3 | `{ mode: "llm" | "rule"; llm_ok: number; total: number; }`×2 ／ `{ mcp: number; cli: number; both: number; mcp_only: number; cli_only: number; }`×1 | ★ 同名不同型 |
| `skipped` | 3 | `{ seeds: string[]; reason: string; }[]`×1 ／ `string[]`×1 ／ `{ path: string; why: string; }[]`×1 | ★ 同名不同型 |
| `applied` | 2 | `{ index: number; from: string; to: string; result: RenameFileResult; }[]`×1 ／ `{ index: number; item: RenameSymbolsItem; result: RenameSymbolResult; }[]`×1 | ★ 同名不同型 |
| `box_dir` | 2 | `string` | 共用候选 |
| `brick` | 2 | `string`×1 ／ `{ id: string; name: string; manifest: string; message: string; }`×1 | ★ 同名不同型 |
| `bricks` | 2 | `AssembledBrickReport[]`×1 ／ `HarvestedBrickReport[]`×1 | ★ 同名不同型 |
| `contracts` | 2 | `Record<string, BrickContract>`×1 ／ `unknown`×1 | ★ 同名不同型 |
| `definition` | 2 | `{ file: string; kind: string; refs: ReferenceSite[]; }`×1 ／ `RenameSymbolFileInfo`×1 | ★ 同名不同型 |
| `effect_events` | 2 | `number` | 共用候选 |
| `entries` | 2 | `BrickShelfEntry[]`×1 ／ `FunctionEntry[]`×1 | ★ 同名不同型 |
| `events_files` | 2 | `string[]` | 共用候选 |
| `externalRefs` | 2 | `ExternalRef[]` | 共用候选 |
| `importers` | 2 | `ReferenceFile[]`×1 ／ `RenameSymbolFileInfo[]`×1 | ★ 同名不同型 |
| `incomplete` | 2 | `{ brick_path: string; kind: string; target: string; }[]`×1 ／ `{ dsl_path: string; kind: string; target: string; }[]`×1 | ★ 同名不同型 |
| `indexWriteThrough` | 2 | `WriteThroughOutcome` | 共用候选 |
| `limitations` | 2 | `string[]` | 共用候选 |
| `literals` | 2 | `{ needle: string; matches: RawLiteralMatch[]; }[]`×1 ／ `{ index: number; item: RenameSymbolsItem; needle: string; toSnake: string; matches: LiteralMatch[]; }[]`×1 | ★ 同名不同型 |
| `node_id` | 2 | `string` | 共用候选 |
| `pending` | 2 | `number`×1 ／ `string[]`×1 | ★ 同名不同型 |
| `previews` | 2 | `{ index: number; from: string; to: string; ok: boolean; blocked?: string[]; result?: RenameFileResult; }[]`×1 ／ `{ index: number; item: RenameSymbolsItem; ok: boolean; blocked?: string[]; result?: RenameSymbolResult; }[]`×1 | ★ 同名不同型 |
| `scope` | 2 | `{ mode: "changed" | "all"; since_ref: string | null; changed_files: number; }`×1 ／ `"module" | "local"`×1 | ★ 同名不同型 |
| `summary` | 2 | `{ checked_files: number; matched: number; missing: number; mismatched: number; unexpected: number; invariant_passed: number; invariant_failed: number; }`×1 ／ `string`×1 | ★ 同名不同型 |
| `symbol` | 2 | `string` | 共用候选 |
| `tools` | 2 | `WizardTool[]`×1 ／ `MappedTool[]`×1 | ★ 同名不同型 |
| `written_to_dsl` | 2 | `boolean` | 共用候选 |

★ 同名不同型的**全部出处**（逐个看语义）：

- `data`
    - `unknown` ×4 ⇒ manageFeature, exploreCode, queryFeature, observeTrace
    - `{ feature: string; design_exists: boolean; live_exists: boolean; baseline_exists: boolean; summary: { design_files: number; live_files: number; added_files: number; removed_files: number; modified_files: number; ... 6 more ...; removed_edges: number; }; files: FileDiff[]; edges: EdgeDiff[]; three_way?: { ...; } | un...` ×1 ⇒ diffViews
    - `EditReceipt` ×1 ⇒ editCode
- `files`
    - `string[]` ×1 ⇒ scaffold
    - `FileContractReport[]` ×1 ⇒ extractContracts
    - `BrickFileReconcileReport[]` ×1 ⇒ reconcileBrick
    - `SlimFileReport[]` ×1 ⇒ slimBrick
    - `FileReconcileReport[]` ×1 ⇒ reconcileEffects
    - `FileRemoval[]` ×1 ⇒ removeDeadImports
- `stats`
    - `{ steps: number; branches: number; loops: number; returns: number; throws: number; handlers: number; }` ×1 ⇒ deriveAlgorithm
    - `{ total: number; business: number; functional: number; hybrid: number; avg_confidence: number; low_confidence: number; shapes_extracted: number; config_keys: number; writes_candidates: number; holds_candidates: number; emits_candidates: number; }` ×1 ⇒ extractContracts
    - `{ seed_count: number; internal_count: number; value_reachable_count: number; max_depth_reached: number; stdlib_count: number; third_party_count: number; unresolved_count: number; }` ×1 ⇒ harvestClosure
    - `{ files_matched: number; confirmed: number; newly_observed: number; unobserved: number; }` ×1 ⇒ reconcileBrick
    - `{ files_matched: number; candidates_confirmed: number; newly_observed: number; unobserved: number; }` ×1 ⇒ reconcileEffects
- `written`
    - `boolean` ×4 ⇒ assembleBricks, harvestFromUrl, reconcileBrick, slimBrick
    - `string[]` ×1 ⇒ applyWrites
- `mode`
    - `"browse" | "search" | "detail"` ×1 ⇒ searchBricks
    - `"llm" | "rule"` ×2 ⇒ deriveMindMap, narrateStep
    - `"symbol" | "field" | "type"` ×1 ⇒ findReferences
- `meta`
    - `{ mode: "llm" | "rule"; llm_ok: number; total: number; }` ×2 ⇒ classifyBricks, classifyTools
    - `{ mcp: number; cli: number; both: number; mcp_only: number; cli_only: number; }` ×1 ⇒ collectFunctions
- `skipped`
    - `{ seeds: string[]; reason: string; }[]` ×1 ⇒ harvestFromUrl
    - `string[]` ×1 ⇒ deriveAnimFlow
    - `{ path: string; why: string; }[]` ×1 ⇒ renameSymbol
- `applied`
    - `{ index: number; from: string; to: string; result: RenameFileResult; }[]` ×1 ⇒ renameFiles
    - `{ index: number; item: RenameSymbolsItem; result: RenameSymbolResult; }[]` ×1 ⇒ renameSymbols
- `brick`
    - `string` ×1 ⇒ slimBrick
    - `{ id: string; name: string; manifest: string; message: string; }` ×1 ⇒ narrateStep
- `bricks`
    - `AssembledBrickReport[]` ×1 ⇒ assembleBricks
    - `HarvestedBrickReport[]` ×1 ⇒ harvestFromUrl
- `contracts`
    - `Record<string, BrickContract>` ×1 ⇒ extractContracts
    - `unknown` ×1 ⇒ searchBricks
- `definition`
    - `{ file: string; kind: string; refs: ReferenceSite[]; }` ×1 ⇒ findReferences
    - `RenameSymbolFileInfo` ×1 ⇒ renameSymbol
- `entries`
    - `BrickShelfEntry[]` ×1 ⇒ searchBricks
    - `FunctionEntry[]` ×1 ⇒ collectFunctions
- `importers`
    - `ReferenceFile[]` ×1 ⇒ findReferences
    - `RenameSymbolFileInfo[]` ×1 ⇒ renameSymbol
- `incomplete`
    - `{ brick_path: string; kind: string; target: string; }[]` ×1 ⇒ reconcileBrick
    - `{ dsl_path: string; kind: string; target: string; }[]` ×1 ⇒ reconcileEffects
- `literals`
    - `{ needle: string; matches: RawLiteralMatch[]; }[]` ×1 ⇒ findReferences
    - `{ index: number; item: RenameSymbolsItem; needle: string; toSnake: string; matches: LiteralMatch[]; }[]` ×1 ⇒ renameSymbols
- `pending`
    - `number` ×1 ⇒ runTests
    - `string[]` ×1 ⇒ renameFile
- `previews`
    - `{ index: number; from: string; to: string; ok: boolean; blocked?: string[]; result?: RenameFileResult; }[]` ×1 ⇒ renameFiles
    - `{ index: number; item: RenameSymbolsItem; ok: boolean; blocked?: string[]; result?: RenameSymbolResult; }[]` ×1 ⇒ renameSymbols
- `scope`
    - `{ mode: "changed" | "all"; since_ref: string | null; changed_files: number; }` ×1 ⇒ detectDrift
    - `"module" | "local"` ×1 ⇒ renameSymbols
- `summary`
    - `{ checked_files: number; matched: number; missing: number; mismatched: number; unexpected: number; invariant_passed: number; invariant_failed: number; }` ×1 ⇒ detectDrift
    - `string` ×1 ⇒ indexIntegrity
- `tools`
    - `WizardTool[]` ×1 ⇒ wizardSteps
    - `MappedTool[]` ×1 ⇒ classifyTools

★ 只服务 1 个 [B] 的字段（领域字段，**不动**）：
  added_files, archive_id, archived_decision, assembly_manifest_written, backfill, bounds, brick_dir, build_verification, candidates, chain, chain_match, checked_at, commit, counts, cross_flows, dead_code, dead_require_candidates, degraded, deps_after, deps_before, deps_removed, derive, desc, deviations, dir, domains, doneWhen, drifted, dropped_files, dry_run, edge_crossings, edges_created, edges_written, editCount, effects_detail, error, events, external, extracted, failed, failures, fieldRefs, file, file_path, fileRenameBlocked, fileRenamed, files_after, files_before, files_changed, filter, flows, flows_added, freshness, fromRel, go_mod_written, go_requires, go_slim_errors, goals, hits, host_file, id, importerCount, imports_added_new, imports_added_original, imports_copied, include_callers, index, index_synced, indexed, indexed_files, input, internal_files, issues, jsonFile, kept_imports_stdlib, label, language, languages, literalFilesWritten, merged_into, mind_map, missing_files, module, moved, new_content, new_file, no, nodes_created, not_run, npm_requires, observed, original_content, output, outputFile, overlaps, package_json_written, passed, persisted, pins, project_root, provider, query, rank_count, references, references_to_extracted, refreshed, refs, removed_from_dsl, repair, repo_name, role, rolled_back, scenes, seeds, slim_candidates, slim_dir, slim_name, slots, snapshot_id, source, stale_files, state, statements_removed, status, subsplit, success, suggestions, symbols_after, symbols_before, target_dir, target_file, taxonomy, third_party_pending, title, to, toRel, total, total_bricks, truncated, trustworthy, typeCandidates, typeMembers, unchanged, unclassified, unmatched, unresolved, unresolved_imports, updated_files, value_files, verification, version_conflicts, warnings
