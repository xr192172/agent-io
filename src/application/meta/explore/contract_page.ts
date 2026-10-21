/**
 * contract_page —— **契约页 / 类型页**：给定一个**符号名**，**一次给全**它的契约面。
 *
 * ## 它答什么问题（本工具存在的全部理由）
 * 「**`Touched` 是什么、谁产生、谁消费、改它会砸谁**」—— 一个真实使用者问这句话时，
 * 原先要**四步**才拼得出答案：`explore_code search` → `find_references(symbol)` →
 * `find_references(field)` → 再手工 `Read` 源码。而自称"**新用户第一站**"的 `capability_map`
 * **完全不导"定义在哪"**。
 *
 * 一条比喻（本工具的灵魂）：
 * > *"不是全自动，而是能直接把**备好**……就像厨师把**备好的菜**直接递给厨师，
 * >  而不是让厨师自己去菜篮子里到处翻。"*
 * ⇒ 本工具的职责是「**把散在四处的信息处理好、一次端上来**」—— **不是新算**。
 *
 * ## ★★★ 每一块都【从已有的权威取】（判据复用 —— 只端，不新做）
 * | 块 | 权威（数据源） | 怎么取 |
 * |---|---|---|
 * | 定义在哪（文件:行 + 签名） | **内核 AST**（`src/infrastructure/parse/`） | `locateCandidates`（cache.db 的符号索引）定文件 → `parseFileFull` 取签名 |
 * | 字段/成员清单 | **内核 AST** | `parseAstRoot` 走 `interface_body`/`object_type`/`class_body`（**不是正则**） |
 * | 产者 / 消费者 | **`find_references` 已有的能力** | 调 `findReferences`（**不自己写一套匹配**）：mode=field 的「构」=产者、「读/解」=消费者；mode=symbol 的 importers 并入消费者 |
 * | 接法边 | **`CHAIN_EDGES`**（`src/domain/chain_wiring.ts`） | 唯一权威，连 `[ran]` 标签也用它的 `evidenceLabel` |
 * | **实现（函数体）** | **`nodes.body_text`（schema v15）** | `readSymbolBody`（**五道准入**：有行 / 有体 / 库内自洽 / 与源码同源 / 文本对得上） |
 *
 * ## ★ 为什么现在才给"实现"（v15）
 * 用户判据：**重写一个函数时，只要还得打开源文件，就说明 DB 不全**。v14 之前 `nodes` 只有
 * 签名 / 形参 / 返回类型 / 修饰符 / 成员 —— DB 知道"它长什么样"，**不知道它做了什么**。
 * v15 把函数体原文（`body_text`）与它的 `sha1`（`body_hash`）落库 ⇒ 本工具**一次把实现也端上来**。
 * ★ 仍然**不盲信 DB**：读 body 走 `readSymbolBody` 的五道准入（含 `files.content_hash` 同源校验）；
 *   索引过期 ⇒ **不给 body、报出原因**（`implementation_absent`），绝不返回一个"看起来能用"的旧实现。
 * | 词表口径 | **`b_terms`**（`src/domain/b_terms.ts`） | `B_TERMS` 原样带出（不改写、不摘要） |
 *
 * ## ★★ 三条纪律（照本仓已立的先例抄口径）
 * 1. **别自己拼路径 / 别自己按名匹配** —— 复用例：`findDecisionTargetNode`（T117）·
 *    `codeSourceExtSet`（T116）· `normRel`（T119）· 符号名→文件复用 `candidate_locator.locateCandidates`（诊断流水线那一步）。
 * 2. **查不到就说查不到**（**不许静默返回空**）—— 照 `consistency_check` 三态 / `index_integrity` 的 `verdict`：
 *    `resolution` 是一个**明确的态**（`ok` / `ambiguous` / `not-found` / `index-unavailable`），**不是空数组**。
 * 3. **★ 只端、不新算，也不替调用方选**：多个同名定义 ⇒ `ambiguous` 并把候选**全列出来**（不给一个默认值）。
 *
 * ## 只读
 * 本工具**只读**（不改任何文件）；唯一的写是 `find_references` 自身的"就地冷启建索引"（既有行为）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseAstRoot, parseFileFull, memberNamesOf, findTypeDeclByName } from '../../../infrastructure/parse/index.js';
import { ensureProjectIndex } from '../../../infrastructure/index/index_freshness.js';
import { hasAnyIndexedFiles, readSymbolBody } from '../../../infrastructure/index/symbols.js';
import { locateCandidates } from '../../../infrastructure/analysis/diagnosis/candidate_locator.js';
import type { Candidate, SymptomParsed } from '../../../infrastructure/analysis/diagnosis/contract.js';
import { findReferences } from '../../refactor/find/find_references.js';
import { camelToSnake } from '../../refactor/rename/rename_symbols.js';
import { CHAIN_EDGES, chainExprOf, evidenceLabel } from '../../../domain/chain_wiring.js';
import { B_TERMS, withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

/** 每个面**最多回多少条**（避免刷屏）；真实总数另给 `count`，截断在 `limitations` 里如实标注。 */
const MAX_SITES = 40;

/**
 * 实现原文最多回多少**字符**（`nodes.body_text` 截断点）。
 * ★ 为什么必须截：本仓最长的一个函数 3565 行 —— 原样打出来会撑爆回执/上下文；
 *   截断是**显式**的（`truncated` + `chars`/`lines` 给全文体量），不是静默少给。
 */
const BODY_CAP = 6000;

/** 花括号口径（与 `schema.ts` 的 `body_text` 列注释同一句话）—— 决定消费方怎么拼回去。 */
const BODY_BRACE_NOTE =
  '外层花括号**随语法树原样**：ts/js · go · java · kotlin · php · c# · rust 的体**含** { }；' +
  'python 的 block 是缩进语句块（**不含** def 行、没有花括号）；箭头简写（x => expr）的体是一段表达式。';

export interface ContractPageInput {
  /** 要查的**符号名**或**类型名**（模块级声明名，如 `Touched` / `withTouched` / `written_files`）。 */
  symbol: string;
  /** 目标项目根（缺省 = cwd）。 */
  project_dir?: string;
  /** 可选：定义文件（**多候选消歧**用；给了就直接以它为定义锚点）。 */
  file?: string;
  /** 可选：feature（本工具暂只作上下文回显，不参与查询）。 */
  feature?: string;
}

export type ContractPageResolution = 'ok' | 'ambiguous' | 'not-found' | 'index-unavailable';

export interface ContractDefinition {
  /** 仓库相对路径（POSIX） */
  file: string;
  /** 1-based 行 */
  line: number;
  end_line: number;
  /** 内核 AST 给的 kind（function / interface / type / class / const …） */
  kind: string;
  /** 内核 AST 给的签名（取不到时为空串，另在 limitations 里说） */
  signature: string;
  qualified_name: string;
}

/**
 * ★ v15：函数/方法的**实现原文**（`nodes.body_text`）—— 重写它之前**不必再打开源文件**。
 *
 * ★ 出来的每一份都**过了五道准入**（见 `index/symbols.ts#readSymbolBody`）：库里有行 / 有体 /
 *   `sha1(body_text) === body_hash` / `contentHash(当前源码) === files.content_hash` / 文本在该符号 span 里。
 *   任一道不过 ⇒ **本对象根本不出现**，改用 `implementation_absent` 报原因（不许"看起来能用"）。
 */
export interface ContractImplementation {
  /** 函数体原文（**原文照录**；超长时按 `BODY_CAP` 截断，见 `truncated`） */
  body: string;
  /** 全文的 sha1（★ 是**未截断**原文的 hash：截断只影响 `body`，不影响这个指纹） */
  body_hash: string;
  /** 全文**字符数**（截断前；> `body.length` 即被截断） */
  chars: number;
  /** 全文**行数** */
  lines: number;
  /** `body` 是否被截断（`chars > BODY_CAP`） */
  truncated: boolean;
  /** 出处：`db` = `nodes.body_text`（**不是**从源码现切） */
  source: 'db';
  /** 人读说明：同源判据的读数 + **是否含外层花括号**（决定怎么拼回去） */
  note: string;
}

/** 一个引用点（消费者/产者的逐条位置）。 */
export interface ContractSite {
  file: string;
  line: number;
  /** 与 find_references 的 kind 对齐：field-key / field-read / field-destructure / field-decl / import / usage … */
  kind: string;
  snippet?: string;
}

export interface ContractEdge {
  from: string;
  from_key: string;
  /** 表达式（由 `chainExprOf` 单点生成：`touched.<键>` / `touched.<键>[i]`） */
  expr: string;
  to: string;
  to_path: string;
  cardinality: 'single' | 'pick';
  /** ★ 呈现词 = `evidenceLabel(evidence)`：`ran`（当年真跑过）/ `pending` */
  tag: string;
  evidence: string;
}

export interface ContractTerm {
  /** 词表里的键（可能是 `symbol` 本身，也可能是 snake/lower 归一后的名）。 */
  name: string;
  kind: string;
  type: string;
  /** ★ 口径**原样**带出（不摘要、不改写） */
  meaning: string;
  debt: boolean;
  retired?: string;
  fix?: string;
}

export interface ContractPageResult {
  symbol: string;
  /** ★ 明确的**态**（查不到 = 一个态，不是空数组） */
  resolution: ContractPageResolution;
  resolution_note: string;
  project_dir: string;
  definition?: ContractDefinition;
  /** `resolution=ambiguous` 时列出**全部**同名定义候选（不替调用方选） */
  candidates?: Array<{ file: string; line: number; kind: string; qualified_name: string; source: string }>;
  /** 字段 / 成员清单（interface / type / class）—— 内核 AST 走出来的，**不是正则**。 */
  members?: string[];
  members_note?: string;
  /**
   * ★ v15：函数/方法的**实现原文**（`nodes.body_text`，五道准入全过才给）。
   * ★ 超长截断到 `BODY_CAP` 字符（`truncated` 标记 + `chars`/`lines` 给全文体量），
   *   因为本仓有个 3565 行的函数 —— 回执里不许把它原样打出来。
   */
  implementation?: ContractImplementation;
  /** ★ 没给 `implementation` 时**为什么**（`no_row` / `no_body` / `hash_mismatch` / `index_stale` / `text_mismatch` / `no_source`）—— 不是"没有这段"。 */
  implementation_absent?: { reason: string; detail: string };
  /** ★ 产者：谁**构造**它（`find_references` mode=field 的「构」点 = 对象字面量键）。 */
  producers?: { source: string; count: number; sites: ContractSite[]; note: string };
  /** ★ 消费者：谁**读/解构**它（mode=field「读/解」点）+ 谁 **import/使用**它（mode=symbol）。 */
  consumers?: { source: string; count: number; sites: ContractSite[]; note: string };
  /** ★ 相关接法边（`CHAIN_EDGES` 唯一权威，含 `[ran]` 标签） */
  chain_edges?: ContractEdge[];
  /** ★ 词表口径（`b_terms` 唯一权威，原样） */
  term?: ContractTerm;
  /** ★ 诚实边界：哪些取不到、哪些是启发式、哪些没做 —— 不许留白。 */
  limitations: string[];
}

// ★ T157（2026-10-11）：类型声明的节点集与成员提取**已提级到内核**
//   （`infrastructure/parse/type_members.ts`）—— 因为 `consistency_check` 也要用同一份。
//   ★ 原先这一整块（`TYPE_DECL_NODES`/`BODY_NODES`/`MEMBER_NODES`/`findDeclByName`/`memberNamesOf`）
//     住在本文件里 ⇒ **两处调用各持一份**就是本仓头号病 ⇒ 已改为 `import`（见文件头 import 行）。

/** 词表命中：原名 → snake 归一 → 小写（b_terms 的键就是字段名，不许自己再造变体）。 */
function lookupTerm(symbol: string): { key: string; term: ContractTerm } | null {
  for (const k of [symbol, camelToSnake(symbol), symbol.toLowerCase()]) {
    const t = B_TERMS[k];
    if (t) {
      return {
        key: k,
        term: {
          name: k,
          kind: t.kind,
          type: t.type,
          meaning: t.meaning,
          debt: t.debt === true,
          ...(t.retired ? { retired: t.retired } : {}),
          ...(t.fix ? { fix: t.fix } : {}),
        },
      };
    }
  }
  return null;
}

/**
 * 相关接法边：三方命中任一即算相关 ——
 * ① 边的一端就是这个工具名（`symbol` 是工具名时）；
 * ② 边的 `fromKey` 属于该类型的成员集（`symbol` 是 `Touched` 这类"接力键集合"时）。
 * ★ 只读 `CHAIN_EDGES`（唯一权威），**不推新规则**。
 */
function relatedEdges(symbol: string, members: readonly string[]): ContractEdge[] {
  const memberSet = new Set(members);
  return CHAIN_EDGES.filter((e) => e.from === symbol || e.to === symbol || memberSet.has(e.fromKey)).map((e) => ({
    from: e.from,
    from_key: e.fromKey,
    expr: chainExprOf(e),
    to: e.to,
    to_path: e.toPath,
    cardinality: e.cardinality,
    tag: evidenceLabel(e.evidence),
    evidence: e.evidence,
  }));
}

/** 从 find_references mode=field 的结果里抽出某种 kind 的站点。 */
function sitesOfKind(
  fieldRefFiles: ReadonlyArray<{ file: string; refs: ReadonlyArray<{ line: number; kind: string; snippet?: string }> }>,
  kinds: ReadonlySet<string>,
): ContractSite[] {
  const out: ContractSite[] = [];
  for (const f of fieldRefFiles) {
    for (const r of f.refs) {
      if (!kinds.has(r.kind)) continue;
      out.push({ file: f.file, line: r.line, kind: r.kind, ...(r.snippet ? { snippet: r.snippet } : {}) });
    }
  }
  return out;
}

/**
 * 主实现：给定符号名，一次把六块端出来。
 * ★ 内部只**调**既有能力（`locateCandidates` / `findReferences` / `CHAIN_EDGES` / `B_TERMS`），
 *   **不自己写匹配**，也**不新增规则**。
 */
async function contractPageCore(input: ContractPageInput): Promise<ContractPageResult> {
  const symbol = input.symbol;
  const root = path.resolve(input.project_dir ?? process.cwd());
  const limitations: string[] = [];
  /** 词表命中（唯一住处 = `B_TERMS`；本工具只取、不改）。 */
  const termHit = lookupTerm(symbol);

  // ── ① 定位符号定义（复用诊断流水线的 `locateCandidates`：cache.db 的符号索引）──
  const { db } = await ensureProjectIndex(root);
  if (!hasAnyIndexedFiles(db)) {
    return {
      symbol,
      resolution: 'index-unavailable',
      resolution_note:
        `符号索引不可用：${root} 下没有可解析的源码（或建索引失败）⇒ 拿不到定义。` +
        '请确认 project_dir 指向代码根目录（本工具只读，不会替你改任何代码）。',
      project_dir: root,
      limitations,
    };
  }

  const parsed: SymptomParsed = { symbols: [symbol], locations: [], keywords: [] };
  const located = locateCandidates(db, { project_dir: root, parsed });
  const exact = located.candidates.filter((c) => c.source === 'exact');
  // 给了 file ⇒ 以它为锚点（消歧），只保留匹配那个文件的精确候选
  const fileArg = input.file;
  const fileRelNorm = fileArg ? (path.isAbsolute(fileArg) ? path.relative(root, fileArg) : path.resolve(root, fileArg)).split(path.sep).join('/') : '';
  const exactFiltered = fileRelNorm
    ? exact.filter((c) => c.file_path === fileRelNorm || c.file_path.endsWith('/' + fileRelNorm))
    : exact;
  const primaryPool = fileRelNorm && exactFiltered.length ? exactFiltered : exact;

  const asCandidate = (c: Candidate) => ({ file: c.file_path, line: c.start_line, kind: c.kind, qualified_name: c.qualified_name, source: c.source });

  if (primaryPool.length === 0) {
    const near = located.candidates.slice(0, 8).map(asCandidate);
    return {
      symbol,
      resolution: 'not-found',
      resolution_note:
        `**查不到**：索引里没有名为 \`${symbol}\` 的模块级定义（既非精确名、也不是已登记的类型/函数）。` +
        (input.file ? `（已用 file=${input.file} 消歧）` : '') +
        (near.length ? `\n  ★ 相近名（FTS 检索命中，**不是定义**）：${near.map((n) => `${n.qualified_name}@${n.file}:${n.line}`).join(' · ')}` : ''),
      project_dir: root,
      ...(near.length ? { candidates: near } : {}),
      ...(termHit ? { term: termHit.term } : {}),
      limitations: ['定义/成员/产者/消费者未做（没有锚点）。'],
    };
  }

  if (primaryPool.length > 1) {
    return {
      symbol,
      resolution: 'ambiguous',
      resolution_note:
        `**有 ${primaryPool.length} 处同名定义** ⇒ 本工具**不替你选**（选择是语义判断）。` +
        '请用 `file=` 指定其中一个重查。候选：' +
        primaryPool.map((c) => `${c.file_path}:${c.start_line}（${c.kind}）`).join(' · '),
      project_dir: root,
      candidates: primaryPool.map(asCandidate),
      chain_edges: relatedEdges(symbol, []),
      ...(termHit ? { term: termHit.term } : {}),
      limitations: ['多候选 ⇒ 未产出定义/成员/产者/消费者。'],
    };
  }

  const pick = primaryPool[0];
  const relFile = pick.file_path;
  const absFile = path.resolve(root, relFile);
  let src = '';
  try {
    src = fs.readFileSync(absFile, 'utf-8');
  } catch {
    limitations.push(`定义文件读不到（${relFile}），定义/成员降级为索引里的行号（无签名）。`);
  }

  // ── ② 定义 + 成员：**内核 AST**（parseFileFull 取签名；parseAstRoot 走成员）──
  let definition: ContractDefinition | undefined;
  let members: string[] | undefined;
  let membersNote: string | undefined;
  if (src) {
    const pf = await parseFileFull(absFile, src);
    const ps = pf.symbols.find((s) => s.name === symbol || s.qualified_name === symbol);
    definition = ps
      ? { file: relFile, line: ps.start_line, end_line: ps.end_line, kind: ps.kind, signature: ps.signature ?? '', qualified_name: ps.qualified_name }
      : { file: relFile, line: pick.start_line, end_line: pick.start_line, kind: pick.kind, signature: '', qualified_name: pick.qualified_name };
    if (!ps) limitations.push('内核 AST 未在定义文件里解出该符号（可能是该方法不支持的声明形态）⇒ 签名取不到、行号退回索引值。');
    else if (ps.kind !== 'function' && ps.kind !== 'method') {
      // ★ 内核 AST 的 `signature` 是**函数形态**的（`Name(params): ret`）—— 对 interface/type/class
      //   会退化成 `Name()`，那不是真实签名 ⇒ 如实标注（不许把内核的归一化当成"这个类型的签名"）。
      limitations.push(`内核 AST 对 \`${ps.kind}\` 的 signature 形如 \`Name()\`（**非真实签名**，只是内核的归一化）⇒ 类型/接口的"签名"请直接看定义行 ${relFile}:${ps.start_line}。`);
    }

    const ast = await parseAstRoot(absFile, src);
    const decl = ast ? findTypeDeclByName(ast.root, symbol) : null;
    if (decl) {
      members = memberNamesOf(decl);
      membersNote = `内核 AST 从 \`${decl.type}\` 的直接成员解出（interface/type/class）。`;
      if (members.length === 0) membersNote += ' ★ 声明体里没有属性/方法签名（可能是联合类型/别名无体）。';
    } else if (ast) {
      membersNote = '该声明不是带成员体的类型（interface/type/class）⇒ 无成员清单。';
    } else {
      limitations.push('AST 解析失败（语言不支持 / 解析器缺失）⇒ 无成员清单。');
    }
  }

  // ── ①b 实现（v15）：函数体原文 **从库读**（`nodes.body_text`），五道准入唯一住处 = `readSymbolBody` ──
  //   ★ 为什么不"从源码现切"：那等于这两列白建 —— 工具还是得靠源文件（用户判据：不用打开源文件才算 DB 全）。
  //   ★ 为什么仍要 `src`：同源判据 `contentHash(src) === files.content_hash` 必须拿**当前源码**才算得出来；
  //     算不出来 ⇒ 不给 body 并报原因 —— 宁可"没给"，也不给一个"看起来能用"的旧实现。
  let implementation: ContractImplementation | undefined;
  let implementationAbsent: { reason: string; detail: string } | undefined;
  const bodyKind = definition?.kind ?? pick.kind;
  if (bodyKind === 'function' || bodyKind === 'method' || bodyKind === 'const') {
    if (!src) {
      implementationAbsent = {
        reason: 'no_source',
        detail: `定义文件读不到（${relFile}）⇒ 无法做 content_hash 同源校验，拒绝返回可能过期的 body`,
      };
    } else {
      const read = readSymbolBody(db, {
        file: relFile,
        qualifiedName: pick.qualified_name,
        startLine: pick.start_line,
        src,
      });
      if (read.ok) {
        const chars = read.body.length;
        const lines = read.body.split('\n').length;
        const truncated = chars > BODY_CAP;
        implementation = {
          body: truncated ? read.body.slice(0, BODY_CAP) : read.body,
          body_hash: read.body_hash,
          chars,
          lines,
          truncated,
          source: 'db',
          note:
            '★ 与源码**同源**（contentHash(当前源码) === files.content_hash）且库内自洽（sha1(body_text) === body_hash）；' +
            '原文照录、不重排缩进。' +
            BODY_BRACE_NOTE +
            (truncated ? ` ★ 已截断：正文只给了前 ${BODY_CAP} 字符（全文 ${chars} 字符 / ${lines} 行）。` : ''),
        };
      } else if (read.reason !== 'no_body' || bodyKind !== 'const') {
        // `const` 绑纯值（`const X = 1`）⇒ 本来就没有体，不算"少做"；其余一律如实报。
        implementationAbsent = { reason: read.reason, detail: read.detail };
        if (read.reason === 'index_stale') {
          limitations.push(
            `实现（函数体）**未给出**：索引过期（${read.detail}）⇒ 先重建索引（import_project / index_integrity refresh:true）再重查；` +
              '本工具**不会**拿旧 body 冒充当前实现。',
          );
        }
      }
    }
  }

  // ── ③ 产者 / 消费者：**find_references 已有的能力**（不自己写匹配）──
  //   消费者 = mode=field 的「读/解构/声明」点 + mode=symbol 的 importers（谁 import/用它）。
  //   产者   = mode=field 的「构造」点（对象字面量键 = 谁在构造形如它的对象）。
  const fieldName = termHit?.key ?? camelToSnake(symbol);
  let producers: ContractPageResult['producers'];
  let consumers: ContractPageResult['consumers'];

  // 3a) 引用面（mode=symbol）：谁 import / 使用它
  let importerCount = 0;
  const consumerSites: ContractSite[] = [];
  try {
    const refs = await findReferences({ project_dir: root, file: relFile, symbol });
    if (refs.ok && refs.importers) {
      importerCount = refs.importers.length;
      for (const imp of refs.importers) {
        const line = imp.refs[0]?.line ?? 0;
        consumerSites.push({ file: imp.file, line, kind: 'import', ...(imp.importSources.length ? { snippet: `import ${imp.importSources.join(', ')}` } : {}) });
      }
    } else {
      limitations.push(`引用面（mode=symbol）未产出：${(refs.blocked ?? ['未给出原因']).join('；')}`);
    }
  } catch (e) {
    limitations.push(`引用面（mode=symbol）调用失败：${(e as Error).message.slice(0, 160)}`);
  }

  // 3b) 字段面（mode=field）：谁「构」（产者）/ 谁「读、解构」（消费者）
  //   ★ 只在"名字在词表里"或"它是带成员的类型"时才跑（避免对每个函数名做一次无意义全项目扫）。
  const shouldProbeField = !!termHit || (members !== undefined && members.length > 0);
  if (shouldProbeField && fieldName.length >= 3) {
    try {
      const fr = await findReferences({ project_dir: root, mode: 'field', field: fieldName, file: relFile });
      const files = fr.fieldRefs ?? [];
      const buildSites = sitesOfKind(files, new Set(['field-key']));
      const consumerFieldSites = sitesOfKind(files, new Set(['field-read', 'field-destructure']));
      producers = {
        source: `find_references mode=field（field=\`${fieldName}\`）的「构造点」(field-key)`,
        count: buildSites.length,
        sites: buildSites.slice(0, MAX_SITES),
        note:
          `★ 「构造点」= 对象字面量里写着 \`${fieldName}:\` 的位置 —— 即**谁在构造**形如它的对象。` +
          `（原样取自 find_references，本工具不重算。）`,
      };
      consumerSites.push(...consumerFieldSites);
      if (buildSites.length > MAX_SITES) limitations.push(`产者站点已截断：共 ${buildSites.length}，只列前 ${MAX_SITES}。`);
    } catch (e) {
      limitations.push(`字段面（mode=field）调用失败：${(e as Error).message.slice(0, 160)}`);
    }
  } else {
    limitations.push(
      `字段面（mode=field）**未做**：\`${symbol}\` 既不在词表里、也不是带成员的类型 ` +
        `⇒ 没有可查的字段名（归一后为 \`${fieldName}\`）。`,
    );
  }

  consumers = {
    source: 'find_references mode=symbol 的 importers + mode=field 的「读/解构」点',
    count: consumerSites.length,
    sites: consumerSites.slice(0, MAX_SITES),
    note:
      `★ 两个来源都取自 find_references：**谁 import 它**（mode=symbol，${importerCount} 个 import 方）` +
      `＋ **谁读/解构它**（mode=field 的 field-read / field-destructure）。`,
  };
  if (consumerSites.length > MAX_SITES) limitations.push(`消费者站点已截断：共 ${consumerSites.length}，只列前 ${MAX_SITES}。`);

  // ── ④ 接法边（CHAIN_EDGES 唯一权威）──
  const edges = relatedEdges(symbol, members ?? []);

  // ── ⑤ 词表口径（b_terms 唯一权威，原样）──
  const term = termHit?.term;
  if (!term) limitations.push(`\`${symbol}\` 不在 \`b_terms\` 词表里（键试过：原名 / snake / 小写）⇒ 无口径。`);

  return {
    symbol,
    resolution: 'ok',
    resolution_note: `定义定位到 \`${relFile}:${definition?.line ?? pick.start_line}\`（${definition?.kind ?? pick.kind}）。`,
    project_dir: root,
    ...(definition ? { definition } : {}),
    ...(members !== undefined ? { members } : {}),
    ...(membersNote ? { members_note: membersNote } : {}),
    // ★ v15：实现原文（五道准入全过才给）/ 没给时的具名原因
    ...(implementation ? { implementation } : {}),
    ...(implementationAbsent ? { implementation_absent: implementationAbsent } : {}),
    producers,
    consumers,
    chain_edges: edges,
    ...(term ? { term } : {}),
    limitations,
  };
}

/**
 * 唯一构造点：把"我动了什么"集中算一次（T18 的单构造点纪律）。
 * 只读工具 ⇒ **绝不填 `written_files`**；填作用域根 + 这次**确立下来的**对象（符号 / 定义文件）。
 */
function touchedOf(input: ContractPageInput, r: ContractPageResult): Touched {
  const touched: Touched = {};
  if (input.project_dir) touched.project_dir = path.resolve(input.project_dir);
  else touched.project_dir = r.project_dir;
  if (input.feature) touched.feature = input.feature;
  // ★ 只在**真有定义**（resolution=ok）时才宣称符号/文件 —— 与 find_references 的 `file` 同款判据。
  if (r.resolution === 'ok' && r.definition) {
    touched.file = r.definition.file;
    touched.symbols = [r.symbol];
  }
  return touched;
}

export async function contractPage(input: ContractPageInput): Promise<TouchedProduct<ContractPageResult>> {
  const r = await contractPageCore(input);
  return withTouched(r, touchedOf(input, r));
}

/** 渲染人读回执（六块逐段；★ 查不到是**一个态**，不是空）。 */
export function renderContractPage(r: ContractPageResult): string {
  const L: string[] = [];
  L.push(`契约页：\`${r.symbol}\`　[${r.resolution}]`);
  L.push(`  ${r.resolution_note}`);

  if (r.resolution !== 'ok') {
    if (r.candidates?.length) {
      L.push('  ★ 候选（本工具不替你选）：');
      for (const c of r.candidates) L.push(`      - ${c.qualified_name} @ ${c.file}:${c.line}（${c.kind}，来源 ${c.source}）`);
    }
    if (r.term) L.push(`  ▢ 词表口径（\`${r.term.name}\` · ${r.term.kind}）：${r.term.meaning}`);
    if (r.limitations.length) L.push('  ★ 未做/取不到：\n      - ' + r.limitations.join('\n      - '));
    return L.join('\n');
  }

  // ① 定义
  if (r.definition) {
    const d = r.definition;
    L.push(`\n① 定义在哪：\`${d.file}:${d.line}\`（${d.kind}${d.end_line !== d.line ? `，到 L${d.end_line}` : ''}）`);
    L.push(`   签名：${d.signature || '（内核 AST 未取到签名）'}`);
    L.push(`   qualified_name：${d.qualified_name}`);
  }

  // ①b 实现（v15）
  if (r.implementation) {
    const im = r.implementation;
    L.push(
      `\n▣ 实现（函数体原文 · nodes.body_text · ${im.lines} 行 / ${im.chars} 字符${im.truncated ? ' · **已截断**' : ''} · sha1 ${im.body_hash.slice(0, 12)}…）`,
    );
    L.push(`   ${im.note}`);
    L.push('   ```');
    for (const ln of im.body.split('\n')) L.push(`   ${ln}`);
    L.push('   ```');
  } else if (r.implementation_absent) {
    L.push(`\n▣ 实现（函数体）：**没给**　[${r.implementation_absent.reason}] ${r.implementation_absent.detail}`);
  }

  // ② 成员
  if (r.members) {
    L.push(`\n② 字段/成员（${r.members.length}）：${r.members.join(', ') || '（无）'}`);
    if (r.members_note) L.push(`   ${r.members_note}`);
  }

  // ③ 产者
  if (r.producers) {
    L.push(`\n③ 谁产生它（产者）：**${r.producers.count}** 处　来源：${r.producers.source}`);
    for (const s of r.producers.sites.slice(0, 12)) L.push(`     - ${s.file}:L${s.line} ${s.snippet ?? ''}`.trimEnd());
    if (r.producers.sites.length > 12) L.push(`     …（共列 ${r.producers.sites.length}）`);
  }

  // ④ 消费者
  if (r.consumers) {
    L.push(`\n④ 谁消费它（消费者）：**${r.consumers.count}** 处　来源：${r.consumers.source}`);
    for (const s of r.consumers.sites.slice(0, 12)) L.push(`     - ${s.file}:L${s.line} [${s.kind}] ${s.snippet ?? ''}`.trimEnd());
    if (r.consumers.sites.length > 12) L.push(`     …（共列 ${r.consumers.sites.length}）`);
  }

  // ⑤ 接法边
  if (r.chain_edges) {
    L.push(`\n⑤ 相关接法边（CHAIN_EDGES，${r.chain_edges.length}）：`);
    for (const e of r.chain_edges) {
      L.push(`     [${e.tag}] ${e.from.padEnd(17)} ──${e.expr.padEnd(26)}──▶ ${e.to} · ${e.to_path}　（${e.cardinality === 'single' ? '单元素·直接取' : '多元素·下标由你给'}）`);
    }
    if (r.chain_edges.length === 0) L.push('     （无：这个符号既不是接法表里的工具名，其成员也不构成任何边的 fromKey）');
  }

  // ⑥ 词表口径
  if (r.term) {
    L.push(`\n⑥ 词表口径（b_terms 原样）：\`${r.term.name}\` · ${r.term.kind} · \`${r.term.type}\`` + (r.term.debt ? '　★ 有债' : ''));
    L.push(`   ${r.term.meaning}`);
    if (r.term.retired) L.push(`   ★ 已退役：${r.term.retired}`);
    if (r.term.fix) L.push(`   处置：${r.term.fix}`);
  }

  if (r.limitations.length) L.push('\n★ 诚实边界（取不到 / 未做）：\n   - ' + r.limitations.join('\n   - '));
  return L.join('\n');
}
