/**
 * project_actual_fields —— 把**实际侧已有的字段**投影到设计侧（A 类缺口：结构/清单层，机械可补）
 *
 * ## 它补的是哪一类缺口（`docs/FIELD-ALIGNMENT.md` §四「A 投影」）
 * | 设计侧字段 | 实际侧来源 | 本模块的动作 |
 * |---|---|---|
 * | `semantic.files[].expected_apis[].signature` | `nodes.signature` | **空 ⇒ 填**（逐字取自 cache.db） |
 * | `semantic.files[].expected_deps[]` | `edges(kind='import')` | **空 ⇒ 填**（仓库相对路径） |
 *
 * 派生之前这两项是 0% / 0.4% ⇒ `drift` 的左侧为空 ⇒ **永远 `no_comparison`**
 * （AGENTS 0.31 点名的反面实证：「不是工具写错了，是地基字段是空的」）。
 *
 * ## ★★★ 与 T85/D1 · T343 的关系：**精确化，不是推翻**（下一个人必须先读这段）
 *
 * 旧裁定 A（`import_project.ts:1734`，T85/D1，2026-10-09）：「已摘掉 `expected_apis: apis`」——
 *   理由写在 `domain/expectation.ts:356`：「`expected_apis` 对账是**扫描来的**契约 ——
 *   而设计就是从扫描 fork 的 ⇒ 它对出来**永远干净**」。
 * 旧裁定 B（`derive/opl.ts:170 assertContractNotFromCode`，T343）：
 *   「喂了现状签名 ⇒ 期望侧 = 实现侧 = 自己测自己（**恒真、永远绿**）—— 正是本仓最忌的装饰闸」。
 *
 * ★ 它们反对的是「**每次扫描都覆盖**」：人的编辑被冲掉 ⇒ 期望侧恒等于实现侧 ⇒ 对拍恒真。
 * ★ 它们**没有**反对「**一次性派生一个基线**」—— AGENTS 0.29 的第①步「派生（实际册 → 设计册）」
 *   就是这个动作，而「留空 ⇒ 对拍没有依据」也正是 0.29② 明令的结构层缺陷。
 *
 * ⇒ 本模块用**两条判据**把「派生一次」与「每次覆盖」分开（这是它能存在的前提，删任一条即违例）：
 *   1. **只填空值，绝不覆盖非空值** —— `existing.length > 0` ⇒ 整字段跳过（计入 `skipped_nonempty`），
 *      **一个字都不动**。⇒ 派生过一次、或人改过一次之后，本模块对该字段**永久只读**
 *      ⇒ 结构上不可能退化成"每次覆盖"。
 *   2. **每条派生条目带 provenance**：`notes: from:cache.db@<scanRev>`
 *      （scanRev 取 `scan_rev.ts#scanRevOf` 的权威值）⇒ 派生基线与**人写的契约**可 grep 区分。
 *
 * ## ★★★ 它的 `clean` 是 **baseline freeze 语义**，不是正确性证明
 * 派生完成的**那一刻**，设计侧与代码侧必然相等（同源）⇒ `design_line action=drift` 会报 `clean`。
 * **那不是**「我们验证了设计对不对」，而是「**从这一刻起**，代码再动就会被看见」。
 * 谁把这里的 `clean` 当正确性证明，谁就在复现 T343 要防的那种装饰闸。
 * 真正的验收读数是 `compared > 0`（有东西可比）与 `mismatched === 0`（投影没歪）。
 *
 * ## 口径边界（如实写，别当成"全都有"）
 * · **只收 `function` / `method`**（非局部闭包、`signature` 非空、且**导出**）。
 *   `type` / `interface` / `class` / `const` **不收**：`design/intent/consistency.ts` 的 `actualApis`
 *   只取 function/method；而 cache.db 里 type/interface 的签名是**退化**的 `Name()`
 *   （实测 `typeDeclFromSignature('DslWriteVia()') = not-type-decl`）⇒ 收进来会全部判成
 *   「缺实现」= **假红**。⇒ 这批被排除的符号是 `expected_apis` 的**已知盲区**，
 *   读数里给分母（`blind_spot.excluded_symbol_kinds`），按 AGENTS 0.17③ 挂账。
 * · **导出判定**：`nodes.modifiers` 含 `export` / `public`，或 Go 的**首字母大写**。
 *   `nodes.modifiers` 是 `docs/FIELD-ALIGNMENT.md` 已登记的字段 ⇒ 这是「读字段」，
 *   **不是**「重新扫描源码」⇒ 0.31② 不违例。
 * · **`title` 不填**：实际侧**没有文件级 docstring**（`nodes` 里 `kind='file'` 674 个、
 *   `docstring` **0** 个；4297 条 docstring 全在**符号**上）。拿符号的 docstring 当文件 `title`
 *   是**误归属**（实测反例：`build_cache.mjs` → "收集 dir 下所有受支持文件" 是 `collect` 的注释；
 *   `run_recorder.go` → "Close flush 并关闭文件" 是方法 `Close` 的）。
 *   ⇒ 按 AGENTS 0.29② 把 `title` **声明为槽位**（实况里没有、也无从派生）：本模块**只报读数、不写**。
 *   要真填 title 属 **C 类（AST 提取补全：把文件首块注释挂到 `kind='file'` 的 docstring）**，另立卡。
 *
 * ## 与 `sync_contracts` 的关系（0.9.1 一处权威）
 * 两者都是「派生 → 写 `expected_apis`」的写端，但**事实源不同、语义不同**：
 *   · `sync_contracts`：源 = 注册表 zod schema（**工具契约 = 人定的意图**）；
 *   · 本模块：源 = cache.db（**代码事实 = 冻结的基线**）。
 * 两个源各自都是唯一权威，且靠 `notes` 前缀可区分 ⇒ 不是"同一件事两处住处"。
 *
 * ## 写闸
 * 本模块是**派生写端**，落盘自己声明自己：
 *   `runDslWriteScope({ via: 'derived', who: 'project_actual_fields' }, () => saveDSL(next))`
 * ★ 为什么不是 `via:'tool'`：那条分支要求 `who` 在 `ToolDef.writes` 注册表里
 *   （`storage.ts#assertDslWriteAllowed` 的 `via === 'tool'` 分支，名字不在表里直接抛）。
 *   本模块**不是 MCP 工具**（工具面固定开销棘轮「只许不增长」，加工具会红），
 *   入口是 `scripts/project-actual-fields.mjs` ⇒ 走 `derived`（「派生写端自己声明自己」，
 *   与 `dag_layout` / `opl` / `snapshot` / `arch_layer` 同一档；`_sync.via` 落
 *   `derived:project_actual_fields`，可 grep 可审阅）。
 */
import { getDSL, saveDSL } from '../../../infrastructure/storage.js';
import { runDslWriteScope } from '../../../infrastructure/dsl_write_scope.js';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { findCacheDb, openDb, type Database } from '../../../infrastructure/index/db.js';
import { scanRevOf } from '../../../infrastructure/index/scan_rev.js';
import type { DesignDSL, ExpectedApi, SemanticFile } from '../../../domain/types.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** provenance 前缀（**唯一住处**）：派生条目的 `notes` 一律以它开头 ⇒ 可与人写契约 grep 区分。 */
export const DERIVED_NOTES_PREFIX = 'from:cache.db@';

/** 逐字段计数（★ 三个数是本模块的核心读数：`filled` 写了几次 / `skipped_nonempty` 因非空而没写 / `unchanged` 与派生结果同值） */
export interface FieldCounts {
  /** 原值为空 ⇒ 本次写入派生值 */
  filled: number;
  /** 原值非空且**与派生结果不同** ⇒ 跳过（人写/旧派生值，一个字都不动） */
  skipped_nonempty: number;
  /** 原值非空且**与派生结果相同** ⇒ 无需写（幂等复跑落在这里） */
  unchanged: number;
  /** 原值为空、派生也为空 ⇒ 无内容可填（不是失败） */
  empty_no_derivation: number;
}

export interface ProjectActualFieldsInput {
  /** feature 名（已存在的 DSL feature） */
  feature: string;
  /** 只处理这些文件（仓库相对路径）；省略 = 该 feature 全部 `semantic.files` */
  files?: string[];
  /** true = 只算不写盘（默认 false） */
  dry_run?: boolean;
}

export interface ProjectActualFieldsResult {
  message: string;
  feature: string;
  /** `cache.db` 的扫描代（`max(files.indexed_at)`）；`null` = 读不到（**不是** 0） */
  scan_rev: number | null;
  /** 写进每条派生条目 `notes` 的 provenance 串 */
  provenance: string;
  files_seen: number;
  apis: FieldCounts & { entries_written: number; files_nonempty_after: number };
  deps: FieldCounts & { entries_written: number; files_nonempty_after: number };
  /** ★ 槽位（实况里没有、也无从派生）—— 只报读数，不写 */
  slots: {
    title: {
      files: number;
      blank: number;
      file_level_docstrings: number;
      reason: string;
    };
  };
  /** ★ 已知盲区（0.17③ 挂账）：被排除在 `expected_apis` 之外的符号种类与条数 */
  blind_spot: {
    excluded_symbol_kinds: Record<string, number>;
    note: string;
  };
  written: boolean;
  dry_run: boolean;
}

/** 导出判定要吃的那几列（`nodes` 的**字段**，不是源码文本） */
export interface ExportProbe {
  name?: string | null;
  modifiers?: string | null;
  language?: string | null;
}

/**
 * 这个符号算不算**导出**（契约面）。
 *
 * 判据（三档，按序）：
 *   ① `modifiers` 含 `export` 或 `public` ⇒ 是（TS/JS/Java）；
 *   ② 语言是 Go ⇒ **首字母大写**才是导出（Go 没有 modifiers，导出性由标识符决定）；
 *   ③ 其余 ⇒ 否（Python 的下划线约定没有可靠的"模块级"信息 ⇒ 保守判否，**不猜**）。
 *
 * ★ 坏 JSON 的 `modifiers` 当"没有 modifiers"（不猜、不抛）—— 它只由本仓 kernel
 *   `JSON.stringify` 写入，坏值 = 库被外部改过；这一档的后果只是"少判一条导出"，
 *   而抛错会让整个投影停摆（更糟）。★ 该取舍**只影响导出过滤**，不影响签名逐字性。
 */
export function isExportedSymbol(row: ExportProbe | null | undefined): boolean {
  const raw = row?.modifiers;
  let mods: string[] = [];
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const v: unknown = JSON.parse(raw);
      if (Array.isArray(v)) mods = v.map((x) => String(x));
    } catch {
      mods = [];
    }
  }
  if (mods.includes('export') || mods.includes('public')) return true;
  if (String(row?.language ?? '').toLowerCase() === 'go') return /^[A-Z]/.test(String(row?.name ?? ''));
  return false;
}

/** 路径归一（cache.db 与 DSL 两侧可能一边是 `\` 一边是 `/`） */
function posix(p: string | null | undefined): string {
  return String(p ?? '').replace(/\\/g, '/');
}

/** 空计数 */
function emptyCounts(): FieldCounts {
  return { filled: 0, skipped_nonempty: 0, unchanged: 0, empty_no_derivation: 0 };
}

/** `expected_apis` 逐条相等（signature + notes，顺序敏感 —— 顺序也是投影的一部分） */
function sameApis(a: readonly ExpectedApi[], b: readonly ExpectedApi[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if ((a[i]?.signature ?? '') !== (b[i]?.signature ?? '')) return false;
    if ((a[i]?.notes ?? '') !== (b[i]?.notes ?? '')) return false;
  }
  return true;
}

/** `expected_deps` 逐条相等（顺序敏感） */
function sameDeps(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 派生结果的分类（**唯一判据**：要不要写、算哪个桶） */
function classifyField(
  existingLen: number,
  derivedLen: number,
  same: boolean,
): keyof FieldCounts {
  if (existingLen === 0) return derivedLen === 0 ? 'empty_no_derivation' : 'filled';
  return same ? 'unchanged' : 'skipped_nonempty';
}

interface NodeApiRow {
  kind: string;
  name: string;
  signature: string | null;
  modifiers: string | null;
  language: string | null;
  is_closure: number | null;
}

/**
 * 核心实现（**不做** `withTouched` 包装；入口 `projectActualFields` 负责那一层）。
 *
 * 流程：`getDSL` → 逐 `semantic.files` 算派生 → **只填空值** → 有改动才一次 `saveDSL`。
 * 一次 `saveDSL` = 一个事务 ⇒ 中途算错不会写出半份册。
 */
export function projectActualFieldsCore(input: ProjectActualFieldsInput): ProjectActualFieldsResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature ${input.feature} 不存在，请先写 DSL 或 import_project`);

  const root = dsl.source_root;
  if (!root || !String(root).trim()) {
    // ★ 0.12：读不到 ≠ 没有。没有 source_root 就不知道去哪找实际册 ⇒ 必须说清楚，不许回落到 cwd。
    throw new Error(
      `feature ${input.feature} 的 DSL 没有 source_root ⇒ 不知道该读哪个 cache.db（不回落 cwd：那是环境态）。` +
        `\n  ⇒ 先给它一个出处（import_project 会写），再跑本模块。`,
    );
  }

  const rev = scanRevOf({ feature: input.feature, sourceRoot: root });
  const dbFile = rev.db ?? findCacheDb({ sourceRoot: root });
  if (!dbFile) {
    throw new Error(
      `找不到 ${root} 下的 cache.db（候选只有 <source_root>/.agent-io/cache.db 一级）⇒ **实际侧读不到**。` +
        `\n  ★ 这不是"没有字段可投影"，是"没有索引"——请先 import_project / 任一读工具触发建索引。`,
    );
  }
  const provenance = rev.rev === null ? 'from:cache.db' : `${DERIVED_NOTES_PREFIX}${rev.rev}`;

  const files = (dsl.semantic?.files ?? []) as SemanticFile[];
  const wanted = input.files?.length ? new Set(input.files.map(posix)) : null;
  const dryRun = input.dry_run === true;

  const apisCounts = emptyCounts();
  const depsCounts = emptyCounts();
  let apisEntries = 0;
  let depsEntries = 0;
  let apisFilesNonempty = 0;
  let depsFilesNonempty = 0;
  let filesSeen = 0;
  let missingIndex = 0;
  let touched = false;

  const db: Database = openDb(dbFile);
  try {
    const qNodes = db.prepare(
      `SELECT kind, name, signature, modifiers, language, COALESCE(is_closure, 0) AS is_closure
       FROM nodes
       WHERE file_path = ? AND kind IN ('function', 'method') AND signature IS NOT NULL
       ORDER BY start_line, id`,
    );
    const qFileDoc = db.prepare(
      `SELECT COUNT(*) AS c FROM nodes WHERE kind = 'file' AND docstring IS NOT NULL AND trim(docstring) <> ''`,
    );

    for (const f of files) {
      const rel = posix(f.path);
      if (!rel) continue;
      if (wanted && !wanted.has(rel)) continue;
      filesSeen++;

      // ★ 事实走**权威函数** `fileFacts`（`infrastructure/index/file_facts`）：它负责
      //   "DSL path 与 cache.db file_path 可能前缀不同"的解析（精确→唯一后缀）与连接复用。
      //   本模块**不另写一套查找顺序**（0.20 / 0.9.1）。
      const facts = fileFacts(root, rel, input.feature);
      if (!facts.source) {
        missingIndex++;
        continue;
      }
      // ★ `matched_path === null` = 这个文件**不在索引里**（查不到 / 后缀命中多条歧义）——
      //   与"它没有导出符号"是两件事（0.12）：必须计入 missingIndex 而不是当成空结果。
      if (facts.matched_path === null) {
        missingIndex++;
        continue;
      }
      const matched = posix(facts.matched_path);

      // ── ① expected_deps ← edges(kind='import')（只收**跨文件**依赖）──
      const derivedDeps = [...new Set(facts.deps.map(posix).filter((t) => t.length > 0 && t !== matched))].sort();
      const existingDeps = (f.expected_deps ?? []).map(posix);
      const depsBucket = classifyField(existingDeps.length, derivedDeps.length, sameDeps(existingDeps, derivedDeps));
      depsCounts[depsBucket]++;
      if (depsBucket === 'filled') {
        depsEntries += derivedDeps.length;
        if (!dryRun) {
          f.expected_deps = derivedDeps;
          touched = true;
        }
        depsFilesNonempty++;
      } else if (existingDeps.length > 0) {
        depsFilesNonempty++;
      }

      // ── ② expected_apis ← nodes.signature（只收**导出**的 function/method）──
      const rows = qNodes.all(matched) as unknown as NodeApiRow[];
      const derivedApis: ExpectedApi[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (Number(r.is_closure ?? 0) !== 0) continue;
        const sig = r.signature;
        // ★ 签名**逐字取自 cache.db**：不重排参数、不补类型、不格式化。
        if (typeof sig !== 'string' || !sig.trim()) continue;
        if (!isExportedSymbol(r)) continue;
        if (seen.has(sig)) continue;
        seen.add(sig);
        derivedApis.push({ signature: sig, notes: provenance });
      }
      const existingApis = f.expected_apis ?? [];
      const apisBucket = classifyField(existingApis.length, derivedApis.length, sameApis(existingApis, derivedApis));
      apisCounts[apisBucket]++;
      if (apisBucket === 'filled') {
        apisEntries += derivedApis.length;
        if (!dryRun) {
          f.expected_apis = derivedApis;
          touched = true;
        }
        apisFilesNonempty++;
      } else if (existingApis.length > 0) {
        apisFilesNonempty++;
      }
    }

    // ── ③ 槽位读数：title（**不写**）──
    const fileDocRow = qFileDoc.get() as unknown as { c: number } | undefined;
    const fileLevelDocstrings = Number(fileDocRow?.c ?? 0);
    const nodes = dsl.geometry?.nodes ?? [];
    const byPath = new Map<string, { title?: string }>();
    for (const n of nodes) {
      const p = posix((n as { path?: string }).path);
      if (p) byPath.set(p, n as { title?: string });
    }
    let titleBlank = 0;
    for (const f of files) {
      const n = byPath.get(posix(f.path));
      if (n && !n.title) titleBlank++;
    }

    // ── ④ 盲区分母（0.17③ 挂账）──
    const excluded: Record<string, number> = {};
    const qKinds = db.prepare(
      `SELECT kind, COUNT(*) AS c FROM nodes WHERE kind IN ('type', 'interface', 'class', 'const') GROUP BY kind`,
    );
    for (const r of qKinds.all() as unknown as Array<{ kind: string; c: number }>) excluded[r.kind] = Number(r.c);

    const result: ProjectActualFieldsResult = {
      message: '',
      feature: input.feature,
      scan_rev: rev.rev,
      provenance,
      files_seen: filesSeen,
      apis: { ...apisCounts, entries_written: apisEntries, files_nonempty_after: apisFilesNonempty },
      deps: { ...depsCounts, entries_written: depsEntries, files_nonempty_after: depsFilesNonempty },
      slots: {
        title: {
          files: files.length,
          blank: titleBlank,
          file_level_docstrings: fileLevelDocstrings,
          reason:
            `实际侧**没有文件级 docstring**（nodes.kind='file' 的 docstring 填充 ${fileLevelDocstrings} 条）⇒ ` +
            `拿符号的 docstring 当文件 title 是误归属 ⇒ 按 AGENTS 0.29② **声明为槽位**（留空），不写。` +
            `要真填属 C 类（AST 提取补全），另立卡。`,
        },
      },
      blind_spot: {
        excluded_symbol_kinds: excluded,
        note:
          'expected_apis **只收 function/method**。type/interface/class/const 不收：consistency 的 actualApis 只取 ' +
          'function/method，而 cache.db 里 type/interface 的签名是退化的 `Name()` ⇒ 收进来会全部判成「缺实现」= 假红。' +
          '这批条数是 expected_apis 的**已知盲区**（AGENTS 0.17③ 挂账）。',
      },
      written: false,
      dry_run: dryRun,
    };

    if (touched && !dryRun) {
      const next: DesignDSL = { ...dsl, semantic: { ...(dsl.semantic ?? {}), files } };
      // ★ 谁写谁声明（`docs/…` 与 `dsl_write_scope.ts` 的口径）：授权发在写点自己身上，
      //   不靠"假设外层包了我"（本模块的入口是 scripts 脚本，没有 invokeTool 作用域）。
      runDslWriteScope({ via: 'derived', who: 'project_actual_fields', feature: input.feature }, () =>
        saveDSL(next),
      );
      result.written = true;
    }

    const pct = (n: number): string => (filesSeen === 0 ? '0' : String(n));
    result.message =
      `project_actual_fields [${input.feature}]：实际侧 → 设计侧投影完成（provenance=${provenance}）\n` +
      `  expected_apis：fill ${result.apis.filled} 文件 / ${result.apis.entries_written} 条 · ` +
      `skip(非空不同) ${result.apis.skipped_nonempty} · unchanged ${result.apis.unchanged} · ` +
      `无导出符号 ${result.apis.empty_no_derivation} ⇒ 非空文件 ${pct(result.apis.files_nonempty_after)}/${filesSeen}\n` +
      `  expected_deps：fill ${result.deps.filled} 文件 / ${result.deps.entries_written} 条 · ` +
      `skip(非空不同) ${result.deps.skipped_nonempty} · unchanged ${result.deps.unchanged} · ` +
      `无跨文件依赖 ${result.deps.empty_no_derivation} ⇒ 非空文件 ${pct(result.deps.files_nonempty_after)}/${filesSeen}\n` +
      `  ★ 槽位（声明，不写）：title 留空 ${result.slots.title.blank}/${result.slots.title.files}` +
      `（文件级 docstring ${result.slots.title.file_level_docstrings} 条）\n` +
      `  ★ 盲区（挂账）：${Object.entries(result.blind_spot.excluded_symbol_kinds)
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ')}\n` +
      (missingIndex > 0 ? `  ⚠ ${missingIndex} 个文件在 cache.db 里查不到（不在索引里，**不是**"没有符号"）\n` : '') +
      (dryRun
        ? '  ★ dry_run：**未写盘**'
        : result.written
          ? `  ★ 已落盘：_sync.via = derived:project_actual_fields`
          : '  ★ 无改动 ⇒ 未写盘（幂等）');

    return result;
  } finally {
    db.close();
  }
}

/**
 * 唯一入口（`withTouched` 那一层在这里，核心在 `projectActualFieldsCore`）。
 *
 * `touched` 口径：**只给作用域类 `feature`**，**绝不给 `written_files`** ——
 * 本模块的落盘是 `saveDSL`（写的是**设计册**，不在仓库里），磁盘上**没有**写任何仓库文件。
 */
export function projectActualFields(input: ProjectActualFieldsInput): TouchedProduct<ProjectActualFieldsResult> {
  const r = projectActualFieldsCore(input);
  const t: Touched = { feature: input.feature };
  return withTouched(r, t);
}
