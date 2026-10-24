/**
 * expectations.ts —— 「**可判定的验收**」的判定器（2026-10-09，`docs/todo.md` T74）。
 * 类型与格式化在 `domain/expectation.ts`（那边不许 import infrastructure，所以判定器住这儿）。
 *
 * ## 四条纪律
 * 1. ★★★ **只看"此刻的代码"，不许拿索引冒充代码**。★ 这条是**出生证当场抓出来的**：
 *    初版用 `fileFacts`（读 `cache.db`）判 `symbol-exists` —— 我把源码里的 `mul` 删掉后，
 *    `consistency_check` 自己（**现解析**）已经报了 `missing: 1`，而我的判定器**仍报"✅ 有 mul"**
 *    ⇒ **拿"索引里的代码"判"此刻的代码" = 假绿**。
 *    ⇒ 修法：`symbol-exists` / `signature-matches` 一律**现读文件 + 现解析**
 *      （`fs.readFileSync` + `parseFileSymbols`；与 `intent/consistency.ts:281-283` 同一套入口）。
 * 2. ★★★ **判不了 ⇒ `unsupported`，既不算过也不算不过**。三类必须显式识别：
 *    · 扩展名不走 TS/JS 解析器 ⇒ 符号事实取不到；
 *    · 依赖边表**按设计只记 `relative` 且非 `type_only`**（`infrastructure/index/symbols.ts:388-390`）
 *      ⇒ 含包导入（Go/Python）的文件，"依赖事实"**不完整**；`import type` 的边**按设计不存在**；
 *    · 依赖边**只能取自索引**（符号能现解析，依赖不能）⇒ 源文件**比索引新**时，事实可能过期。
 *    ★ 三条都是"**没查到 ≠ 不存在**"的形态 —— 判成 fail 是假红，判成 pass 是假绿，所以**单列一类**。
 * 3. ★ **`unsupported` 不许混进"通过"**：那等于用"判不了"冒充"没问题"（本仓最忌的那类绿）。
 * 4. ★ **不新造解析**：符号走 `parseFileSymbols`，依赖走 `fileFacts.deps` + `getRawImportsOfFile`，
 *    全是既有入口；本文件只把它们按"五种检查项"编排一遍。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { getRawImportsOfFile, contentHash } from '../../../infrastructure/index/symbols.js';
import { parseFileSymbols, isSupportedFile } from '../../../infrastructure/parse/ast_parser.js';
// ★ T79：调用边读取**复用现成那一处**（别在这再写一份 SQL）
import { queryFileCalls } from '../../meta/explore/query_feature.js';
import { normPath, normSignature, type Expectation } from '../../../domain/expectation.js';
// ★ 2026-10-24（judge-cache 第一阶）：**一阶文件哈希缓存** —— 「没变的文件不再测」（判据见 judgeExpectations 内注）
import { loadJudgeCache, saveJudgeCache, judgeCacheKey } from './judge_cache.js';
// ★ 工作项 L（2026-10-24）：行为契约的执行核 —— 复用 behavior 基建（与 capture/verify 同一条执行路径）
import { runHarness, type BehaviorSpec } from '../../../infrastructure/authoring/behavior/index.js';
// ★ 2026-10-21（D-judge-port）：判定器的**形状**住 domain（端口 = `domain/judge_port.ts`），本文件只实现
//   「怎么判」。★ 这不是第二把尺 —— 除了本文件，全仓没有第二个 `judgeExpectations`。
import type {
  ExpectationConflict,
  ExpectationItem,
  ExpectationsReport,
  JudgeItem,
  Verdict,
} from '../../../domain/judge_port.js';
// ★ T257：TS/JS 家族扩展名的**唯一判据**（`infrastructure/parse/source_exts.ts`）—— 不另写一把尺
import { TS_JS_EXTS } from '../../../infrastructure/parse/source_exts.js';

// ★★★ 2026-10-21（D-judge-port）：`Verdict` / `ExpectationItem` / `ExpectationsReport` /
//   `ExpectationConflict` / `JudgeItem` 已搬到 `domain/judge_port.ts` —— **它们是 domain 的词汇表**：
//   `cardStanding` 要读 `checked / passed / failed / unsupported` 与 `items[].verdict / items[].expectation`
//   才能派生五值 ⇒ 「谁必须读懂它」的答案是 domain。
//   ★ 本文件只留**实现**（怎么判）；形状由端口那一处声明 —— 同一事实不住两处。
//   ★ 搬过去时逐字保留了原注释里的判据（四值语义 / 冲突只检可判定的互斥 / 为什么单列不进计数）。

/**
 * ★★★ T256 缺口②（2026-10-14）：**决策间冲突**的检测 —— ★ **判据只住这一处**。
 *
 * ## 「冲突」的定义（★ 只检**同一对象上的互斥要求**，不猜语义冲突）
 * · 同一 `from → to`：一条要 `edge-exists`、另一条要 `edge-absent`；
 * · 同一 `path#symbol`：两条 `signature-matches` 要求**不同签名**。
 *
 * ★ **为什么只检这两类**：它们是**可判定的互斥**（同一对象上不可能同时成立）。
 *   "语义冲突"（如 A 说该拆、B 说该合）**机器判不了** ⇒ **不假装能判**（那会变成假信号）。
 * ★ **为什么不并进 `verdict`**：冲突是**要求之间的矛盾**，与"代码满没满足"是**两件事**
 *   —— 两条互斥要求里，代码**只能满足一条**，所以至少一条会 fail；但"谁对"是**人的裁**。
 *   ⇒ 单列一段，不混进 pass/fail 计数。
 */
export function findExpectationConflicts(
  items: readonly JudgeItem[],
): ExpectationConflict[] {
  const out: ExpectationConflict[] = [];
  const add = (
    map: Map<string, Array<{ node_id: string; kind: string; text: string }>>,
    k: string,
    v: { node_id: string; kind: string; text: string },
  ): void => {
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(v);
  };

  // ① edge：同一 from→to 上 exists vs absent
  const byEdge = new Map<string, Array<{ node_id: string; kind: string; text: string }>>();
  for (const it of items) {
    const e = it.expectation;
    if (e.kind !== 'edge-exists' && e.kind !== 'edge-absent') continue;
    add(byEdge, `${normPath(e.from)} → ${normPath(e.to)}`, {
      node_id: it.node_id,
      kind: e.kind,
      text: `${e.kind}：${e.from} → ${e.to}`,
    });
  }
  for (const [subject, sides] of byEdge) {
    if (new Set(sides.map((x) => x.kind)).size > 1) out.push({ subject, sides });
  }

  // ② signature：同一 path#symbol 上两条要求不同签名
  const bySig = new Map<string, Array<{ node_id: string; kind: string; text: string }>>();
  for (const it of items) {
    const e = it.expectation;
    if (e.kind !== 'signature-matches') continue;
    add(bySig, `${normPath(e.path)}#${e.symbol}`, { node_id: it.node_id, kind: e.kind, text: e.signature });
  }
  for (const [subject, sides] of bySig) {
    if (new Set(sides.map((x) => normSignature(x.text))).size > 1) out.push({ subject, sides });
  }

  return out;
}

/**
 * 索引是否**与源码一致**。
 *
 * ★★★ 2026-10-09 **判据换过一次，这次是换掉一个错判据** —— 起因是"真跑一遍试用"：
 *   在真夹具上把 `format.ts` 改对之后，`fileFacts('src/format.ts').deps` **已经是 `['src/math.ts']`**
 *   （索引确实更新了、设计确实满足了），而旧判据仍报「**索引比源码旧 ⇒ 判不了**」⇒ **假红**。
 *   根因两条：① 旧判据比的是 **mtime**，而索引库是 **WAL** 模式 ⇒ **写的是 `cache.db-wal`/`-shm`，
 *   主库 `cache.db` 的 mtime 根本不更新**（实测：主库停在 10-08 21:58，而源文件是 10-09 10:55）；
 *   ② 即使不是 WAL，"谁的 mtime 大"也只是**代理**，而 `files.content_hash` 是**事实**。
 *   ⇒ 换成**按内容比对**：读源文件算 `contentHash`（**复用 `index/symbols.ts` 那一份，不另写 sha1**），
 *     与索引里该文件的 `content_hash` 比。**这才叫"索引是否反映此刻的代码"。**
 * ★ 为什么假红也危险：它会让**干对了的人以为没干对** —— 比假绿更难察（假绿是"不该绿却绿"，
 *   假红是"该绿却红"，而人会先把活儿重做一遍再说）。
 * ★ 附：提示里必须给**可执行的修复动作**（下面那句就是）—— 只说"判不了"等于把问题丢回给用户。
 */
export function indexStaleFor(root: string, rels: readonly string[]): string | null {
  const db = getProjectCacheDb(root);
  for (const relInput of rels) {
    const rel = normPath(relInput);
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue; // 文件不存在 ⇒ 由调用方去判"失败"，不是这里的事
    const facts = fileFacts(root, rel);
    const key = facts.matched_path ?? rel;
    const row = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: key }) as { content_hash?: string } | undefined;
    if (!row?.content_hash) {
      return `索引里查不到该文件（\`${key}\`）⇒ 依赖事实取不到，判不了`;
    }
    const now = contentHash(fs.readFileSync(abs, 'utf-8'));
    if (row.content_hash !== now) {
      return (
        `**索引与源码不一致**：\`${rel}\` 的内容已改过，但索引还是旧的 ⇒ 依赖边可能没反映这次改动。` +
        `★ 依赖边只能取自索引（符号能现解析，依赖不能）⇒ **宁可说"判不了"，不拿旧事实说"通过"**。` +
        `\n     修复动作：跑一次 \`import_project\`（**默认只刷新"实际"、不碰设计**）即可保鲜，然后再对拍。`
      );
    }
  }
  return null;
}

/** 该文件的**依赖事实是否完整**（不完整 ⇒ 与依赖有关的检查一律判不了） */
function depFactsIncomplete(root: string, relPath: string): string | null {
  const facts = fileFacts(root, relPath);
  if (facts.source === null) return `该文件在本项目的符号索引里读不到（无 cache.db 命中）⇒ 事实取不到，判不了`;
  let raw: Array<{ kind: string; type_only: boolean }> = [];
  try {
    raw = getRawImportsOfFile(getProjectCacheDb(root), relPath);
  } catch (e) {
    return `读原始 import 记录失败（${(e as Error).message}）⇒ 判不了`;
  }
  const pkg = raw.filter((r) => r.kind !== 'relative' && !r.type_only);
  if (pkg.length) {
    // ★★★ T257（2026-10-14）：**TS/JS 的裸导入是【外部包】，不构成"仓内边可能漏记"** ——
    //   本仓（以及 TS/JS 生态）的**仓内引用走 relative 说明符**，而依赖边表记的正是它
    //   （`infrastructure/index/symbols.ts:388`）；裸导入（`node:path` / `@scope/pkg`）
    //   **没有仓内目标** ⇒ 它**不会**让"仓内两个文件之间的边"漏记。
    //   ★ 原实现把**任何**非相对 import 都算"事实不完整"（注释只提"Go/Python 的包导入"），
    //     实测后果（T257）：**真实 TS 文件几乎都有包导入** ⇒ `edge-exists` / `edge-absent`
    //     **恒 unsupported** ⇒ 6 种可判形状里有 **2 种对 TS 仓没有可用面**。
    //   ★ 已知限度（如实声明）：若项目配了 `tsconfig.paths` 别名（`@/x` → `src/x`），裸导入
    //     **可能**指向仓内 ⇒ 那时本判据**偏乐观**。当前本仓**未配 paths**，故不触发。
    const isTsJs = (TS_JS_EXTS as readonly string[]).includes(path.extname(relPath).toLowerCase());
    if (!isTsJs) {
      return (
        `该文件含 **${pkg.length} 条非相对导入**（Go/Python 的包导入等），而依赖边表按设计**只记 relative**` +
        `（\`infrastructure/index/symbols.ts:388\`）⇒ **依赖事实不完整，判不了**（不拿"没查到"冒充"不存在"）`
      );
    }
  }
  return null;
}

/**
 * ★ symbol-exists / signature-matches 的**判定核**（2026-10-24 从 judgeExpectations 原样抽出 ——
 *   缓存通道与直算通道共用同一份逻辑，不许判据住两处）。返回而不 push；详细判据注释见函数体内。
 */
async function judgeSymbolOrSignature(
  root: string,
  e: Extract<Expectation, { kind: 'symbol-exists' | 'signature-matches' }>,
): Promise<{ verdict: Verdict; detail: string }> {
  const p = normPath(e.path);
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) {
    return { verdict: 'fail', detail: `${p} **不存在**（查的是 ${abs}）` };
  }
  if (!isSupportedFile(p)) {
    return {
      verdict: 'unsupported',
      detail: `${p} 的扩展名不走 TS/JS 解析器 ⇒ **符号事实取不到，判不了**（不拿“取不到”冒充“没有”）`,
    };
  }
  // ★★★ 现读现解析：**不许**用 `fileFacts`（索引）—— 出生证证明过它会假绿。
  //   证据：把源码里的 mul 删掉后，`consistency_check`（现解析）已报 missing:1，
  //   而用 fileFacts 的初版仍报“✅ 有 mul” ⇒ **拿索引冒充代码**。
  const content = fs.readFileSync(abs, 'utf-8');
  const syms = await parseFileSymbols(p, content);
  // ★★★ T258（2026-10-14）：**这里原先按 kind 过滤，只认 `function | method`** ——
  //   实测后果：`const` / `type` / `interface` / 接口字段类断言**结构上无法表达**
  //   （`parseFileSymbols` 把 `const`/`arrow const` 判成 `const`/`type`，`interface`/`type` 判成
  //   `interface`/`type`）⇒ 取不到 ⇒ 判 **fail**。
  //   ★★ 那是**假红**：把“**我表达不了**”读成“**代码里没有**” —— 比 unsupported 更坏
  //   （unsupported 至少诚实；假红会让人去改没坏的东西）。实测至少 4 张决策卡死于此
  //   （`arc_6` 的 const / `tcc_6` 的接口字段 / `tcc_9` 的 type / `tcc_3` 的类型本体）。
  //   ⇒ 现在**不按 kind 过滤**：问的是“**这个符号在不在**”，就不该替调用方挑 kind。
  const hit = syms.find((s) => s.name === e.symbol || s.qualified_name === e.symbol);
  if (!hit) {
    // ★ 提示也**不再过滤** —— 否则“现取到 N 个”会漏报 const/type，把读者引向错的方向。
    const names = syms.map((s) => s.name);
    return {
      verdict: 'fail',
      detail:
        `${p}（**现解析**）里**没有符号** \`${e.symbol}\`；现取到 ${names.length} 个：` +
        `${names.slice(0, 6).join(', ')}${names.length > 6 ? ' …' : ''}`,
    };
  }
  if (e.kind === 'symbol-exists') {
    return { verdict: 'pass', detail: `${p}（现解析）有 \`${hit.name}\`（L${hit.start_line}-${hit.end_line}）` };
  }
  const got = hit.signature ?? '';
  const ok = normSignature(got) === normSignature(e.signature);
  return {
    verdict: ok ? 'pass' : 'fail',
    detail: ok
      ? `${p} 的 \`${hit.name}\` 签名与期望一致`
      : `${p} 的 \`${hit.name}\` **签名不符**：期望 \`${e.signature}\`，实取 \`${got || '（无签名）'}\``,
  };
}

/** ★ source-has 的**判定核**（同上，从 judgeExpectations 原样抽出 —— 2026-10-19 源码文本判据：不装 input） */
function judgeSourceHas(
  root: string,
  e: Extract<Expectation, { kind: 'source-has' }>,
): { verdict: Verdict; detail: string } {
  const p = normPath(e.path);
  const abs = path.join(root, p);
  if (!fs.existsSync(abs)) {
    return { verdict: 'fail', detail: `${p} **不存在**（查的是 ${abs}）` };
  }
  const src = fs.readFileSync(abs, 'utf-8');
  const missMust = (e.must ?? []).filter((t) => !src.includes(t));
  const hitMustNot = (e.mustNot ?? []).filter((t) => src.includes(t));
  if (missMust.length || hitMustNot.length) {
    const parts = [];
    if (missMust.length) parts.push(`缺 must：${missMust.map((t) => JSON.stringify(t.slice(0, 40))).join(' / ')}`);
    if (hitMustNot.length) parts.push(`命中 mustNot：${hitMustNot.map((t) => JSON.stringify(t.slice(0, 40))).join(' / ')}`);
    return { verdict: 'fail', detail: parts.join('；') };
  }
  return { verdict: 'pass', detail: `${p}：must ${(e.must ?? []).length} 全在 / mustNot ${(e.mustNot ?? []).length} 全无` };
}

/** 逐条判定（★ `async`：符号走**现解析**；不写盘） ★ 见文件头纪律 1 —— 不许用索引冒充代码 */
export async function judgeExpectations(
  root: string,
  items: readonly JudgeItem[],
): Promise<ExpectationsReport> {
  const out: ExpectationItem[] = [];
  const push = (it: JudgeItem, verdict: Verdict, detail: string): void => {
    out.push({ ...it, verdict, detail });
  };

  // ★★ 2026-10-24（judge-cache 第一阶，v3 §4.9）：**一阶文件哈希缓存** —— 「没变的文件不再测」。
  //   · 只缓存 **symbol-exists / signature-matches / source-has** 三类：它们的判定只依赖**目标文件本体**
  //     （key = hash(判据内容 ‖ 目标文件 content_hash)，见 `intent/judge_cache.ts`），一阶即覆盖全部贵判定；
  //   · **不缓存**：file-exists（existsSync 便宜）/ run 与 behavior-cases（必须现跑）/ edge-* 与
  //     call-exists（读边表便宜，且新鲜度由 indexStaleFor 把守）；
  //   · **新鲜度判据 = files.content_hash**（索引那一刻的内容指纹）：文件不在 files 表 ⇒ 拿不到哈希
  //     ⇒ **不缓存，现算**（不许拿"没有哈希"冒充"没变"）；文件变了 ⇒ 哈希变 ⇒ key 变 ⇒ 自然 miss；
  //   · 纪律 1（现读现解析）**不变**：命中的恰是"文件内容哈希没变"的文件 ⇒
  //     缓存里的判定与"此刻现解析"是同一个事实 —— 不是拿索引冒充代码。
  const cache = loadJudgeCache(root);
  let cacheHits = 0;
  let cacheMisses = 0;
  // 一条 prepared statement 复用（逐条现 prepare 才是浪费）；库不可用 ⇒ 全部现算（与"没索引"同语义）
  let fileHashStmt: { get(p: { p: string }): unknown } | null = null;
  try {
    fileHashStmt = getProjectCacheDb(root).prepare('SELECT content_hash FROM files WHERE path = $p');
  } catch {
    fileHashStmt = null;
  }

  for (const it of items) {
    const e = it.expectation;
    // ── 缓存通道（只对三类贵判定；拿不到文件哈希 ⇒ 落到下面 switch 现算）──
    if (e.kind === 'symbol-exists' || e.kind === 'signature-matches' || e.kind === 'source-has') {
      const p = normPath(e.path);
      let fileHash: string | null = null;
      if (fileHashStmt) {
        try {
          const row = fileHashStmt.get({ p }) as { content_hash?: string } | undefined;
          fileHash = row?.content_hash ?? null;
        } catch {
          fileHash = null;
        }
      }
      if (fileHash) {
        const key = judgeCacheKey(e, fileHash);
        const hit = cache.get(key);
        if (hit) {
          cacheHits++;
          push(it, hit.verdict, `${hit.detail}（缓存命中）`);
          continue;
        }
        cacheMisses++;
        const res = e.kind === 'source-has' ? judgeSourceHas(root, e) : await judgeSymbolOrSignature(root, e);
        cache.set(key, { verdict: res.verdict, detail: res.detail });
        push(it, res.verdict, res.detail);
        continue;
      }
    }
    switch (e.kind) {
      case 'file-exists': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        const ok = fs.existsSync(abs);
        push(it, ok ? 'pass' : 'fail', ok ? `${p} 存在` : `${p} **不存在**（查的是 ${abs}）`);
        break;
      }
      case 'symbol-exists':
      case 'signature-matches': {
        // ★ 2026-10-24（judge-cache）：判定核抽到 judgeSymbolOrSignature —— 缓存通道与直算通道共用同一份逻辑
        const r = await judgeSymbolOrSignature(root, e);
        push(it, r.verdict, r.detail);
        break;
      }
      // ★★★ 2026-10-19：**源码文本判据**（grep 型契约的正式名字）—— 不装 input。
      //   ★ 它的边界：只验"文本存在"，不懂语义（注释里出现也算）。
      case 'source-has': {
        // ★ 2026-10-24（judge-cache）：判定核抽到 judgeSourceHas —— 缓存通道与直算通道共用同一份逻辑
        const r = judgeSourceHas(root, e);
        push(it, r.verdict, r.detail);
        break;
      }
      // ★★★ 2026-10-18：**行为契约** —— 一条 run = 一个自包含的测试（input + expect 表达式）。
      //   ★ 求值域只有这三个名字（不是任意代码执行）：input / root / validateDSL。
      //   ★ 不建 fixtures/ 目录：input 就是夹具，内联在契约里。
      case 'run': {
        // ★★★ 2026-10-18：**blocked_by 优先** —— 声明的"卡在哪"比"跑出来 fail"更准。
        //   ★ 跑只会给一个误导的 fail（"断言不成立"），而真实情况是"这活还没干完"。
        if (e.blocked_by) {
          push(it, 'pending', `进行中 · 卡在：${e.blocked_by}`);
          break;
        }
        try {
          const { validateDSL } = await import('../../../domain/validator.js');
          // ★★★ 2026-10-18：求值域扩到 fs / path —— "读文件 / grep" 类债也能配 run。
          //   ★ 仍不是任意代码执行：能用的只有 input / root / validateDSL / fs / path。
          //   ★ 纪律：run 只许【读 + 判】，不许有副作用（写盘 / 调 claimTask 这类会改状态的，别放进来）。
          const { default: fsMod } = await import('node:fs');
          const { default: pathMod } = await import('node:path');
          const fn = new Function('input', 'root', 'validateDSL', 'fs', 'path', `"use strict"; return (${e.expect});`);
          const ok = Boolean(fn((e as { input?: unknown }).input, root, validateDSL, fsMod, pathMod));
          push(it, ok ? 'pass' : 'fail', ok ? `断言成立：${e.expect}` : `断言**不成立**：${e.expect}`);
        } catch (err) {
          push(it, 'fail', `run 判不了：${(err as Error).message}`);
        }
        break;
      }
      case 'call-exists': {
        // ★★ T79：**调用级**判据 —— 边/符号/签名三档表达不了"必须用哪个符号"，
        //   而"用错符号"恰恰是最常见的偏差（实测：设计说必须用 add，实现换成 mul，边判据照样绿）。
        const p = normPath(e.path);
        const bad = indexStaleFor(root, [p]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
                let outgoing: Array<{ caller: string; callee: string; line: number }> = [];
        try {
          outgoing = queryFileCalls(getProjectCacheDb(root), p).outgoing;
        } catch (err) {
          push(it, 'unsupported', `读调用边失败（${(err as Error).message}）⇒ 判不了`);
          break;
        }
        // ★★★ 2026-10-09：id 约定**实测定证**（别按 DSL 的节点 id 猜）——
        //   索引 `nodes` / `edges` 里符号 id 是 **`<仓库相对路径>#<符号名>`**
        //   （实测：`src/format.ts#total → src/math.ts#add`），
        //   **不是** DSL 的 `file_src_format_ts#total`。
        //   ★ 我初版按 DSL 的 file id 拼 ⇒ 查不到 ⇒ 把"已实现"判成 fail（**假红**）。
        //   ★★ 顺带修掉了 `get_dsl query=calls`（同一个拼错 id 的根因，见 T80）。
        const callerId = `${p}#${e.symbol}`;
        const mine = outgoing.filter((x) => x.caller === callerId);
        // ★★ 守卫（防**假绿**，但不能变成假红）：只有当**整个索引里一条调用边都没有**时，
        //   才说"判不了"（那时是"调用抽取没产出"，不是"这个符号没调用"）。
        //   ★ 初版守卫写的是"该文件一条出调用都没有 ⇒ 判不了" —— **太保守**：
        //     文件本来就不做任何项目内调用是完全正常的状态（实测夹具里 `total` 只调用 `Array.reduce`），
        //     那应当判 **fail**，判"判不了"等于给一个"没实现"的设计开脱。
        if (mine.length === 0) {
          let totalCalls = 0;
          try {
            const row = getProjectCacheDb(root).prepare("SELECT COUNT(*) AS c FROM edges WHERE kind = 'call'").get() as { c?: number } | undefined;
            totalCalls = row?.c ?? 0;
          } catch {
            totalCalls = 0;
          }
          if (totalCalls === 0) {
            push(it, 'unsupported', `本项目索引里**一条调用边都没有**（该语言的调用抽取没产出）⇒ 判不了`);
            break;
          }
        }
        const shortName = (id: string): string => id.slice(id.lastIndexOf('#') + 1);
        const callees = mine.map((x) => shortName(x.callee));
        const hit = mine.find((x) => shortName(x.callee) === e.target);
        push(
          it,
          hit ? 'pass' : 'fail',
          hit
            ? `${p} 的 \`${e.symbol}()\` **调用了** \`${e.target}()\`（L${hit.line}）`
            : `${p} 的 \`${e.symbol}()\` **没有**调用 \`${e.target}()\`` +
              (callees.length ? `；它实际调用的是：${[...new Set(callees)].join(', ')}` : '（该符号没有任何出调用）'),
        );
        break;
      }

      // ★★★ 2026-10-24（工作项 L 第一步）：**行为契约** —— 给定输入 → 断言输出（契约三层之三：
      //   ① signature-matches 声明契约 ② call-exists 副作用契约 ③ behavior-cases 行为契约）。
      //   ★ 期望输出写在判据里（cases[].expect），**不依赖基线文件**：基线是 capture 时的"实然"，
      //     expect 是设计声明的"应然" —— 判据必须对着应然判（若对着基线判：capture 自坏代码 ⇒ 恒 fail、
      //     capture 自好代码 ⇒ expect 沦为摆设）。执行核复用 `runHarness`（`verifyBaseline` 同一条执行路径）。
      case 'behavior-cases': {
        const p = normPath(e.path);
        const abs = path.join(root, p);
        if (!fs.existsSync(abs)) {
          push(it, 'fail', `${p} **不存在**（查的是 ${abs}）`);
          break;
        }
        try {
          const spec: BehaviorSpec = {
            project_dir: root,
            file: p,
            function: e.symbol,
            cases: e.cases.map((c, i) => ({ name: `case-${i + 1}`, args: c.given })),
          };
          const run = runHarness(spec);
          if (run.error) {
            // 进程级失败（工具链缺失 / 加载失败 / 顶层函数缺失）⇒ "判不了"不冒充"错"
            push(it, 'unsupported', `行为基线跑不了 ⇒ 判不了：${run.error}`);
            break;
          }
          // expect 是裸串（"f(a,b)"），harness 的 ret 是规范化 repr（字符串带引号）⇒ 对齐后再比
          const shown = (ret: string): string => {
            try {
              const v: unknown = JSON.parse(ret);
              return typeof v === 'string' ? v : JSON.stringify(v);
            } catch { return ret; }
          };
          const same = (ret: string, expect: string): boolean => {
            if (ret === expect) return true; // expect 本就写成 repr 形态（如 "5" / "true" / "{\"a\":1}"）
            try { return String(JSON.parse(ret)) === expect; } catch { return false; } // expect 是裸串
          };
          const bad: string[] = [];
          for (let i = 0; i < e.cases.length; i++) {
            const c = e.cases[i];
            const r = run.results.find((x) => x.case === `case-${i + 1}`);
            if (!r) { bad.push(`case-${i + 1}（输入 ${JSON.stringify(c.given)}）harness 未产出该 case`); continue; }
            if (!r.ok) { bad.push(`case-${i + 1} 输入 ${JSON.stringify(c.given)}：**抛错** ${r.error}`); continue; }
            if (!same(r.ret ?? '', c.expect)) {
              bad.push(`case-${i + 1} 输入 ${JSON.stringify(c.given)}：期望 \`${c.expect}\`，实得 \`${shown(r.ret ?? '')}\``);
            }
          }
          if (bad.length > 0) {
            push(it, 'fail', `行为差异 ${bad.length}/${e.cases.length}：${bad[0]}`);
          } else {
            push(it, 'pass', `${e.cases.length}/${e.cases.length} case 一致（${p} 的 \`${e.symbol}\` 经金丝雀 harness 现跑）`);
          }
        } catch (err) {
          push(it, 'unsupported', `行为基线判不了：${(err as Error).message}`);
        }
        break;
      }
      case 'edge-exists':
      case 'edge-absent': {
        const from = normPath(e.from);
        const to = normPath(e.to);
        const bad = depFactsIncomplete(root, from) ?? indexStaleFor(root, [from]);
        if (bad) {
          push(it, 'unsupported', bad);
          break;
        }
        const deps = fileFacts(root, from).deps.map(normPath);
        const has = deps.includes(to);
        // ★ 若"期望存在但没找到"，再排一次 **type-only 的冤案**：
        //   `import type` 运行时擦除 ⇒ 按设计**不建边**（`symbols.ts:390`）⇒ 这是"判不了"，不是"不存在"
        if (e.kind === 'edge-exists' && !has) {
          const raw = getRawImportsOfFile(getProjectCacheDb(root), from);
          // ★★★ T3（G2 修复，2026-10-16；`docs/board.md` T3 / `docs/replan-log-2026-10-15.md` §83.3）：
          //   **按「basename 去扩展名」比较**，不再拿"带扩展名的串"硬比。
          //   · 原实现：`raw.find((r) => to.startsWith(normPath(r.source).replace(/^\.\//, '')) || r.source.includes(to.split('/').pop() ?? ''))`
          //     —— 两个子句**都是死代码**：`to` 是 `.../task_schema.ts`（带 `.ts`），而 raw import 的
          //     `r.source` 是 `'./task_schema.js'`（带 `.js`；**本仓 ESM/NodeNext 约定：源码写 `.js`、
          //     真实文件是 `.ts`**）⇒ `includes('task_schema.ts')` **永不命中**
          //     ⇒ 整段 type-only 冤案排解对本仓是死的 ⇒ 把合法的 `import type` 读成"不存在" ⇒ **假红**
          //     （实测：`edge-exists discussion_log→task_schema` 判 **fail**，而正确判定是"按设计不建边 ⇒ 判不了"）。
          //   · 修法（§83.3 给的补丁）：两侧都取 **basename 并去掉扩展名** 再比 ⇒ `task_schema.ts` ↔ `task_schema.js` 命中。
          //   ★ 已知限度（如实声明）：只比 basename ⇒ 若 `to` 与某条 **type-only 导入同名不同目录**，
          //     会误判成"判不了"（= 假 unsupported；比假红轻，但仍是错）。本分支**只在 `has===false`
          //     且仅用于区分 fail/unsupported**，不判"存在"⇒ 最坏也只是把一条"该红"读成"判不了"。
          const baseNoExt = (s: string): string => {
            const base = normPath(s).split('/').pop() ?? '';
            return base.replace(/\.[^.]*$/, '');
          };
          const rawHit = raw.find((r) => baseNoExt(r.source) === baseNoExt(to));
          if (rawHit?.type_only) {
            push(it, 'unsupported', `${from} 对 ${to} 的导入是 **type-only**（\`import type\`），按设计**不建依赖边** ⇒ 判不了（不是"不存在"）`);
            break;
          }
        }
        if (e.kind === 'edge-exists') {
          push(
            it,
            has ? 'pass' : 'fail',
            has ? `${from} → ${to} 存在` : `${from} **没有**依赖 ${to}（现取到 ${deps.length} 条依赖：${deps.slice(0, 5).join(', ') || '（无）'}${deps.length > 5 ? ' …' : ''}）`,
          );
        } else {
          push(
            it,
            has ? 'fail' : 'pass',
            has
              ? `${from} **不该**依赖 ${to}，但它确实依赖（边界越权）`
              : `${from} 未依赖 ${to}（符合预期：不许依赖）`,
          );
        }
        break;
      }
    }
  }

  // ★ 函数末尾：本轮有现算并入缓存的新条目 ⇒ 落盘（try/catch：落盘失败警告不致命，**不静默吞**）
  if (cacheMisses > 0) {
    try {
      saveJudgeCache(root, cache);
    } catch (err) {
      process.stderr.write(
        `⚠ judge-cache 落盘失败（${(err as Error).message}）—— 不致命：本轮判定已出，只是下次要重算\n`,
      );
    }
  }

  const notes: string[] = [];
  const unsupported = out.filter((x) => x.verdict === 'unsupported').length;
  if (unsupported > 0) {
    notes.push(
      `★★ 有 **${unsupported} 条判不了（unsupported）** —— ★ **这不是"通过"**：` +
        `把它们并进"通过"就等于用"判不了"冒充"没问题"。请先把判据补全（多半是索引没建，或该语言不走相对导入）。`,
    );
  }
  return {
    checked: out.length,
    passed: out.filter((x) => x.verdict === 'pass').length,
    failed: out.filter((x) => x.verdict === 'fail').length,
    unsupported,
    // ★★★ 2026-10-22：`pending` 单列 —— 此前四值里只有它没人计数 ⇒ 只有 pending 后态判据的卡
    //   会被 `cardStanding` 判 `satisfied`（「还没干完，在等前置」被读成「可收口」）。
    //   计数口径与其他三值一致：**只数 verdict，不重新解释**（怎么处置在 domain 侧）。
    pending: out.filter((x) => x.verdict === 'pending').length,
    // ★ T256 缺口②：决策间冲突（同一对象上的互斥要求）—— 单列，不混进 pass/fail 计数
    conflicts: findExpectationConflicts(items),
    // ★ 2026-10-24（judge-cache）：缓存命中率（读端可看见「没变的文件不再测」兑现了几成）
    cache: { hits: cacheHits, misses: cacheMisses },
    items: out,
    notes,
  };
}
