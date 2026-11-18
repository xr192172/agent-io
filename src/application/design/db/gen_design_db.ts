/**
 * gen_design_db —— 设计 DSL → 设计 DB（工具 `design_line` 的 `action=gen-db`）
 *
 * ## 它生成什么（用户的关键定义，逐字留在注释里）
 * ```
 * design-db/<file>.calls.json   ← 每个文件一份（全量）
 * ```
 * ★ 2026-10-20 订正：原文写的是"每个**文件节点**一份" —— 那是假门的源头。
 *   一个路径可以被**多个 feature 各持一个节点**（实测今天 344 个路径 / 367 个节点 / 23 个多持有者），
 *   而 `design-db` 只有**一份**投影 ⇒ 第二个节点永远对不上。
 *   ⇒ 现在按**路径**归并：判据取并集、表头列出全部持有者、矛盾单独判真冲突
 *     （`planDesignDb` 是唯一那一处；`DesignDbConflict` 写着什么是"真"什么不是）。
 *
 * ## 为什么必须【全量、和实际 DB 同构】
 * 规则：解析与重写都是**渐进**的两条路 —— 既要重写设计 DSL，
 * 还要重写设计 DB，最后才重写源码。
 * ```
 * 解析（源码 → 设计）：源码 → 实际 DB → 实际 DSL → 设计 DSL（fork）
 * 重写（设计 → 源码）：设计 DSL → ★ 设计 DB → 源码
 * ⇒ 两条路的三层一一对应：实际 DB ↔ 设计 DB（同构）、实际 DSL ↔ 设计 DSL（同构）
 * ⇒ "重写源码"需要一份【完整的设计 DB】，不是"设计关心的那几条"
 *   —— 那几条只是设计 DB 里的 `requirements[]` 标注。
 * ```
 *
 * ## 每份的形状（与实际 DB 同构）
 * ```
 * { "//"…, "path": <仓库相对路径>, "symbols": […], "imports": […], "calls": […],
 *   ★ 2026-10-28：`reverse_calls` **已删除** —— 它是 `calls` 的一跳反向（算得出来）⇒ 落盘即第二份事实；
 *     要"谁调我"请从 `calls` 现算。
 *   "requirements"?: […], "requirements_calls"?: […] }
 * ```
 * ★ `calls` 是**全量镜像**（必然全绿）；`requirements_calls` 才是"设计说必须有"的
 *   —— `contract:calls` 必须读后者，否则契约门在全量之后会失效（用户 2026-10-19 指出过）。
 *
 * ## 搬家纪律（从 scripts/gen-design-db.mjs）
 * **输出必须逐字相同**。所以下面这些格式细节一律不得擅自调整：
 * `JSON.stringify(payload, null, 2) + '\n'`、键的插入顺序、`outNameOf` 的替换规则、
 * 可选字段的"空就不写"。
 *
 * ## ★★★ 输入签名（T-#INC-GENDB，2026-11-17）：**命中 ⇒ 跳过查询与序列化，不跳过判断力**
 * 实测（本文件 550+ 路径的真实规模，见卡上读数）：一次全量 gen-db 里 `qSymbols` / `qImports` /
 * `qCallsOut` 三条查询 + `requirements_calls` 的 `qHome` 占**大头**，而 `JSON.stringify` + 逐字节比只占零头。
 * 输出侧本来就有增量（`old === text ⇒ skip`），但**读取侧是全量**：每次都把 4 条 SQL 重跑一遍。
 * ⇒ 每份副本算一个**输入签名**，命中就跳过查询与序列化。
 *
 * ### 签名 = 五元组（缺一项就是一个假绿入口）
 * ```
 * ① sha(册侧该 path 的输入)        —— 持有者/来源/判据并集/`semantic.files` 的期望符号切片
 * ② sha(cache.db 该 path 的行级事实) —— `files.content_hash` + `norm_hash` + `node_count`（行级 key，已有列）
 * ③ ⚠ sha(cache.db **全库**事实快照)  —— 见下「为什么 ② 不够」；任一文件内容/索引格式变了就换 epoch
 * ④ sha(design_db_projection.ts)   —— 映射表变了 ⇒ 输出变（Turborepo #14820：映射表也是输入）
 * ⑤ FORMAT_VERSION                 —— payload 形状/键序/空值省略规则一变就必须 +1 ⇒ 全量重算
 * ```
 * ★ **为什么四元组不够（② 的补丁）**：`requirements_calls[].to` 的"符号的家"来自 `qHome`
 *   （`nodes WHERE name = ?`，**跨文件**查），`calls[].to` 也是索引期跨文件解析的结果。
 *   ⇒ 只把"本 path 的 `content_hash`"放进签名会在**别的文件新增同名符号**时假绿。
 *   事实侧因此再加一个**全库快照**（所有 path 的 `content_hash` + `schema_versions`）：任何文件的内容
 *   或索引格式变了 ⇒ epoch 变 ⇒ 本次全量重算（**诚实降级**：慢，但不会拿旧字节冒充新投影）。
 *
 * ### ★★ 第 6 项：**产物自己也是输入**（这一条是"逐字节比不许拆"的机械保证）
 * 现有写侧判断是 `old === text ? skip` ⇒ **盘上那份副本就是输入之一**。签名不把它算进去，
 * "某人手改了 design-db/*.calls.json" 这类改动就会因为"输入没变"而被判为命中 ⇒ 假绿。
 * ⇒ 签名在副本里**自述**（`//inputs` 键，与 `//` / `//generated_by` / `//source` 同族），其中：
 * · `sig` = 上面五元组的合成 sha；`body` = **去掉 `//inputs` 那一行之后的正文 sha**。
 * 命中 = `sig` 与现算相同 **且** `body` 与盘上正文相同 ⇒ 外部改过正文 ⇒ `body` 不匹配 ⇒ 走全量重算
 * ⇒ **写前那一次真逐字节比照旧跑**（它没被拆，只是命中时不需要它也能判等价）。
 *
 * ### 存哪里（★ 不新建基线文件）
 * **不落盘任何独立签名/基线**（不产 `stale-*.json`：那会变成第二个可陈旧的东西，正是"不建免疫系统门"要挡的）。
 * 副本自述在**生成物本体**里（生成物自带出处，与 `//generated_by` 同一类信息）；每次运行**现算**一遍。
 * 事实侧的行级 key 沿用 `cache.db#files` 已有的 `content_hash`（不新增表、不新增列）。
 *
 * ### fail-closed（算不出来 = 不命中，不是"算不出来 = 一致"）
 * `cache.db` 没有 `files` 表 / 映射表模块读不到 / 副本没有 `//inputs`（旧格式）⇒ **一律不命中**，
 * 走原来的全量路径，并在 `fingerprintNote` 里说出原因（0.12：读不到 ≠ 0）。
 *
 * ## 边界（写在代码里，别让调用方以为它全管）
 * - 只处理 `description` 以 `src/` 开头的节点（其他目录不进设计 DB）
 * - `symbols` / `imports` / `calls` 的**事实**取自 `cache.db`（设计 DSL 不存符号级事实）
 * - `check=true` **不写盘**（只报不一致），也不清理陈旧副本
 * - ★ `check=true` 的红分两类，**不许合成一个计数**：
 *   `drift`（重跑生成器就绿）vs `conflicts`（重跑一百遍也绿不了 ⇒ 该改设计）
 * - ★ **门只由 `checkDesignDbStructure` 提供**（`scripts/gen-db-check.mjs`）：它只比设计侧
 *   可复现的三样（`//source` / `requirements` / `requirements_calls` 的调用方），
 *   因为 `cache.db` **不入库** —— 拿它当门 = 同一次提交在不同机器上红绿不同（另一种假门）。
 * - ★ 本工具是**诊断**，不是门：要判"设计进没进投影"请跑 `node scripts/gen-db-check.mjs`。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { SYMBOL_COLUMN_MAP, symbolSelectSql, projectSymbolRow } from './design_db_projection.js';
// ★ M1a：kind 的投影去向是**声明**（不是沉默）—— 声明表住在 kind 的权威住处（domain），
//   本文件只按声明去**现算**分母与分子，不在这里再写一份"哪些 kind 该投影"。
import {
  EXPECTATION_KIND_PROJECTION,
  EXPECTATION_KINDS,
  projectionDeclarationGaps,
  type KindProjection,
} from '../../../domain/expectation_kinds.js';
// ★ M1a：落地率只许由 `rateOf` 印（问题 / 分子 / 分母 / 百分比四件同场，0.12 第 3 条）。
import { rateOf } from '../../../domain/rate.js';
// ★ M1a：载体**可达条数**的口径不在这里定义 —— 直接复用 judge 的收集器
//   （`collectExpectations`：跳过 `intent='retired'` 的节点），不另写一份"哪些判据会被跑"。
import { collectExpectations } from '../../../domain/expectation.js';
// ★★★ 2026-11-04（A4 · Placeholder as Data）：职责占位的**唯一判定** —— 结构门与写端
//   （`domain/validator.ts#validateResponsibilityIntent`）共用同一把尺（0.9.1）。
import { responsibilityVerdict } from '../../../domain/semantic.js';
import type { DesignDSL } from '../../../domain/types.js';
// ★ 2026-11-05（R12④）：`ExcludedNodeConflict.gate` 只**引用**闸的值域，不在这里再写一份 `'gated' | 'exempt'`
//   —— 值域的唯一住处是 `domain/geometry.ts#NODE_GATES` / `NodeGate`（0.9.1）。
import type { NodeGate } from '../../../domain/geometry.js';
// ★ 册可能住在数据家（AGENT_IO_HOME 沙箱 / 旧位置）⇒ 只有注册表能看见；"这册属于谁"复用 isSameProject
// ★★★ 2026-11-17（批 0.4）：「哪几册属于本项目」的**实现体**已下移到 `storage#readDesignSheetsForGate`
//   —— 写端判据（`saveDSL`）也要读它，而 `storage → application` 会成环。本文件只取用（口径不分叉）。
import { readDesignSheetsForGate } from '../../../infrastructure/storage.js';
// ★ 批 0.6：跨册归属读数（② 档）的判定核住基础设施层，门与写端共用同一份（不各写一份判据）
import {
  crossBookOwnership,
  readDesignBooks,
  type CrossBookReading,
  type DesignBooksRead,
} from '../../../infrastructure/design_books.js';

// ★ 2026-10-20：`GenDesignDbOptions` / `GenDesignDbResult` 已下移到归并逻辑旁边
//   （与 `DesignDbPlanItem` / `DesignDbConflict` 同住）—— 此前它们在这里，改归并时又在下面
//   重写了一份，两份同名 interface 会**静默合并**（tsc 不报）⇒ 改字段时只改一份也编得过。
//   ★ 这就是本仓头号病（同一判据住两处）的又一次现形：**编译通过 ≠ 只有一份**。

export type RawExpectation = {
  kind?: string;
  path?: string;
  symbol?: string;
  target?: string;
  from?: string;
  to?: string;
  signature?: string;
  must?: string[];
  mustNot?: string[];
  expect?: string;
  input?: unknown;
  why?: string;
};

export type AnyNode = {
  id?: string;
  path?: string;
  decision?: { expectations?: RawExpectation[] };
};

const norm = (s: unknown): string => String(s ?? '').replace(/\\/g, '/');

/** 副本文件名：`src/a/b.ts` → `a-b.calls.json`（★ 与旧脚本逐字一致，别改） */
export const outNameOf = (rel: string): string =>
  rel.replace(/^src\//, '').replace(/[/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';

/**
 * 设计 DB 的输出目录 —— ★ **唯一住所**（2026-10-20 从 `certs/` 下搬到**仓根** `design-db/`）。
 *
 * 消费者全部认这一处，不许各写一遍字面量：
 * - `gen_design_db.ts` 自己
 * - `design_line.ts` / `symbol_diff.ts`（TS 侧直接 import 本函数）
 * - `scripts/gen-contracts.mjs` / `contract-calls.mjs`（.mjs 侧 import dist 里的编译产物；`dep.mjs` 已于 2026-10-24 按裁 A 退役——calls 只读，意图走 call-exists 判据）
 */
export const designDbDir = (root: string): string => path.join(root, 'design-db');

// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-19（T-#PERF-MEMO · 病灶 #2）：**`design-db/_index.json`（副本汇总）**
//   病：`design_line` 的 ⑤ 为了拿「几份 / 几符号 / 几调用 / 几要求 + 一份 path 列表」，
//   把 **583 份** `.calls.json`（9.91 MB）**逐份 `JSON.parse`**（实测 279.63 ms/次）。
//   治法：汇总由**生成它的同一趟**（`genDesignDb`）写出 —— 天然同源，不需要第二个生成器；
//   读端只读这 1 份。★ 缺失 / 坏 ⇒ 读端**响亮回落全扫**（见 `design_line` 的 `design_db_index`），
//   **不许**把"读不到"折成"0 份"（AGENTS-RULES 0.12）。
// ════════════════════════════════════════════════════════════════════

/** 汇总文件名（★ 不是副本：`<x>.calls.json` 才是副本；这个名字不许被当成"陈旧副本"删掉） */
export const DESIGN_DB_INDEX_NAME = '_index.json';

/** 汇总里的一行 = 一份副本的三个计数 + 它自报的 path */
export interface DesignDbIndexRow {
  path: string;
  symbols: number;
  calls: number;
  requirements_calls: number;
}

/** 汇总的**读结果**（三态：读到 / 读不到带原因 —— 不折成"空"） */
export interface DesignDbIndexRead {
  ok: boolean;
  /** `ok:false` 时的原因（缺失 / JSON 坏 / 形状不对），**必须**能原样进报文 */
  why?: string;
  totals: { count: number; symbols: number; calls: number; requirements_calls: number };
  files: DesignDbIndexRow[];
}

const EMPTY_INDEX_TOTALS = { count: 0, symbols: 0, calls: 0, requirements_calls: 0 };

/**
 * 读 `design-db/_index.json`（**唯一读口**；`design_line` ⑤ 的取数处）。
 * ★ 形状校验是**判据的一部分**：三个计数只要有一个不是有限数、`files[]` 不是数组 ⇒ `ok:false`
 *   （半个汇总比没有更坏：它会让 ⑤ 报一个看起来正确的小数字）。
 */
export function readDesignDbIndex(dir: string): DesignDbIndexRead {
  const file = path.join(dir, DESIGN_DB_INDEX_NAME);
  if (!fs.existsSync(file)) {
    return { ok: false, why: `汇总不存在（${DESIGN_DB_INDEX_NAME}）`, totals: { ...EMPTY_INDEX_TOTALS }, files: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      why: `汇总读不出来（${String((e as Error)?.message ?? e).replace(/\s+/g, ' ').slice(0, 160)}）`,
      totals: { ...EMPTY_INDEX_TOTALS },
      files: [],
    };
  }
  const j = parsed as {
    totals?: Record<string, unknown>;
    files?: unknown;
  };
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const t = j?.totals;
  const shapeOk =
    !!j &&
    typeof j === 'object' &&
    !!t &&
    num(t.count) &&
    num(t.symbols) &&
    num(t.calls) &&
    num(t.requirements_calls) &&
    Array.isArray(j.files);
  if (!shapeOk) {
    return { ok: false, why: '汇总形状不对（totals 四个计数或 files[] 缺失/非数）', totals: { ...EMPTY_INDEX_TOTALS }, files: [] };
  }
  const files: DesignDbIndexRow[] = [];
  for (const raw of j.files as unknown[]) {
    const r = raw as Partial<DesignDbIndexRow>;
    if (!r || typeof r.path !== 'string') {
      return { ok: false, why: '汇总 files[] 里有条目缺 path', totals: { ...EMPTY_INDEX_TOTALS }, files: [] };
    }
    files.push({
      path: r.path,
      symbols: num(r.symbols) ? r.symbols : 0,
      calls: num(r.calls) ? r.calls : 0,
      requirements_calls: num(r.requirements_calls) ? r.requirements_calls : 0,
    });
  }
  return {
    ok: true,
    totals: {
      count: t!.count as number,
      symbols: t!.symbols as number,
      calls: t!.calls as number,
      requirements_calls: t!.requirements_calls as number,
    },
    files,
  };
}

/** 汇总正文（**纯函数**：同一批行 ⇒ 同一份字节；`generated_at` 由调用方给，便于"没变就不写"） */
export function renderDesignDbIndex(rows: readonly DesignDbIndexRow[], generatedAt: string): string {
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totals = {
    count: sorted.length,
    symbols: sorted.reduce((s, r) => s + r.symbols, 0),
    calls: sorted.reduce((s, r) => s + r.calls, 0),
    requirements_calls: sorted.reduce((s, r) => s + r.requirements_calls, 0),
  };
  return (
    JSON.stringify(
      {
        '//': 'Design DB 副本汇总（★ 与 <x>.calls.json 同一趟生成；读端 = design_line ⑤）—— 不许手改',
        '//generated_by': 'scripts/gen-design-db.mjs → genDesignDb（★ 改了下次生成就冲掉）',
        generated_at: generatedAt,
        totals,
        files: sorted,
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * 落汇总（**只在真生成时调用**；`check` 档不写盘）。
 * ★ 幂等：`files` / `totals` 没变 ⇒ **不重写**（只更新 `generated_at` 也算"变了"，但那种 churn 没意义
 *   —— 时间戳只记"这份汇总最后一次覆盖到真变化"）。
 */
export function writeDesignDbIndex(dir: string, rows: readonly DesignDbIndexRow[]): { written: boolean; totals: DesignDbIndexRead['totals'] } {
  const prev = readDesignDbIndex(dir);
  const sorted = [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totals = {
    count: sorted.length,
    symbols: sorted.reduce((s, r) => s + r.symbols, 0),
    calls: sorted.reduce((s, r) => s + r.calls, 0),
    requirements_calls: sorted.reduce((s, r) => s + r.requirements_calls, 0),
  };
  const same =
    prev.ok &&
    prev.totals.count === totals.count &&
    prev.totals.symbols === totals.symbols &&
    prev.totals.calls === totals.calls &&
    prev.totals.requirements_calls === totals.requirements_calls &&
    prev.files.length === sorted.length &&
    prev.files.every((r, i) => {
      const n = sorted[i]!;
      return r.path === n.path && r.symbols === n.symbols && r.calls === n.calls && r.requirements_calls === n.requirements_calls;
    });
  if (same) return { written: false, totals };
  const file = path.join(dir, DESIGN_DB_INDEX_NAME);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, renderDesignDbIndex(sorted, new Date().toISOString()), 'utf8');
  fs.renameSync(tmp, file);
  return { written: true, totals };
}

// ════════════════════════════════════════════════════════════════════
// ★★★ T-#INC-GENDB：**per-path 输入签名**（四元组 + 产物自身 + 格式版本）
//   见文件头「输入签名」一节。这里只放**纯函数与快照**，判断点在 `genDesignDb` 的循环里（只有一处）。
// ════════════════════════════════════════════════════════════════════

/**
 * 设计 DB 投影的**格式版本**：payload 的形状 / 键序 / "空就不写" 规则一变就必须 **+1**。
 * ★ 它进签名 ⇒ 版本一变 = 所有旧副本一次全量重算（不做"猜哪些副本还兼容"）。
 * ★ 加字段（如本版的 `//inputs`）也必须 +1 —— 否则签名命中的旧副本会带着旧形状活下去。
 */
export const DESIGN_DB_FORMAT_VERSION = 2;

/** 副本自述输入的键名（与 `//` / `//generated_by` / `//source` 同族：注释键不进任何消费者的语义） */
const INPUTS_KEY = '//inputs';

/** 唯一的摘要原语（签名**只吃字符串/字节**，不吃对象序列化的偶然形态） */
const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** 副本里 `//inputs` 的解析结果 */
export interface DesignDbInputHeader {
  /** 生成它的格式版本（与 {@link DESIGN_DB_FORMAT_VERSION} 不等 ⇒ 不命中） */
  format: number;
  /** 五元组合成签名（册侧 / 事实 / 全库 epoch / 映射表 / 格式版本） */
  sig: string;
  /** **正文**摘要（去掉 `//inputs` 那一行之后的字节）—— 它替"逐字节比"在命中路径上兜底 */
  body: string;
}

/** `//inputs` 的**唯一**序列化形态：单行、可 grep、可手读（改这里 = 改格式 ⇒ 版本 +1） */
export const formatInputHeader = (h: DesignDbInputHeader): string => `v${h.format} sig=${h.sig} body=${h.body}`;

/** 解析 `//inputs` 的值；任何不合形态的输入 ⇒ `null`（**不猜**，不命中的判定在调用点） */
export function parseInputHeader(v: unknown): DesignDbInputHeader | null {
  if (typeof v !== 'string') return null;
  const m = /^v(\d+) sig=([0-9a-f]{64}) body=([0-9a-f]{64})$/.exec(v);
  return m ? { format: Number(m[1]), sig: m[2], body: m[3] } : null;
}

/**
 * 从**盘上那份副本的原文**里取 `//inputs`（★ 不 `JSON.parse` 整份 —— 命中路径要便宜到值得）。
 * 认的形态只有一种：2 空格缩进 + 尾逗号 + 换行（= `JSON.stringify(payload, null, 2)` 的产物）。
 */
export function readInputHeaderFromText(text: string): DesignDbInputHeader | null {
  const m = /^ {2}"\/\/inputs": "([^"\n]*)",$/m.exec(text);
  return m ? parseInputHeader(m[1]) : null;
}

/**
 * 去掉 `//inputs` 那一行 ⇒ 回到"没有签名的 payload"的**逐字节形态**。
 * ★ 这一步是签名能替代逐字节比的**根据**：`payload` 里 `//inputs` 后面永远还有 `path` 等键
 *   ⇒ 摘掉"该行 + 它的尾逗号"之后，剩下的字节正好等于 `JSON.stringify(payloadWithoutInputs, null, 2) + '\n'`。
 *   （`tests/p1_gendb_fingerprint.test.ts` 把这个恒等式钉成用例，别让"便宜"悄悄变成"不等价"。）
 */
export function stripInputHeaderLine(text: string): string {
  return text.replace(/^ {2}"\/\/inputs": "[^"\n]*",\n/m, '');
}

/** 正文摘要（= 逐字节比在命中路径上的**廉价替身**：外部改过正文 ⇒ body 变 ⇒ 不命中） */
export const bodyDigestOf = (text: string): string => sha256Hex(stripInputHeaderLine(text));

/** `cache.db` 的一次**事实快照**（★ 全库一次，不是每 path 一次） */
export interface CacheFactsSnapshot {
  /** path → 该 path 的行级事实键（`content_hash` + `norm_hash` + `node_count`；改一个字节就变） */
  byPath: Map<string, string>;
  /** 全库事实 epoch（所有 path 的行级键 + 索引格式版本；跨文件解析的兜底，见函数注释） */
  epoch: string;
}

/**
 * 采一次 `cache.db` 的事实快照 —— 判"这份投影的事实输入有没有变"的**唯一口径**。
 *
 * ## 为什么是 `files` 表而不是"把 nodes/imports/edges 行哈希一遍"
 * 那等于**先把 4 条查询跑完再判要不要跑**（签名成本 ≥ 它省下的成本 ⇒ 没有意义）。
 * `files` 是索引器写下的**行级事实 key**：一个 path 的 `content_hash` 变了 ⇒ 它的 `nodes` / `imports` /
 * `edges` 行必然重写过。读整张 `files`（实测 ~700 行）**一次**即可覆盖全部路径，成本与路径数无关。
 *
 * ## 为什么还要 epoch（② 不够的原因）
 * `requirements_calls[].to` 的符号"家"由 `qHome` 跨文件决定，`calls[].to` 也是索引期跨文件解析的结果
 * ⇒ 别的文件新增/改名会让本 path 的输出变，而本 path 的 `content_hash` 一个字节都没变。
 * 把**全库** `files`（+ `schema_versions`：索引格式版本）合成一个 epoch 进签名 ⇒ 那种情况**不会假绿**，
 * 只会**诚实降级**成全量重算。
 *
 * ## 读不到就是读不到
 * 没有 `files` 表（旧库 / 夹具没建索引）⇒ `null`（调用点据此**全量重算**并说出原因）。
 */
export function snapshotCacheFacts(db: DatabaseSync): CacheFactsSnapshot | null {
  try {
    const rows = db
      .prepare('SELECT path, content_hash, norm_hash, node_count FROM files ORDER BY path')
      .all() as Array<{ path?: string; content_hash?: string; norm_hash?: string; node_count?: number }>;
    const byPath = new Map<string, string>();
    for (const r of rows) {
      byPath.set(norm(r.path), `${r.content_hash ?? ''}:${r.norm_hash ?? ''}:${r.node_count ?? ''}`);
    }
    // ★ 索引格式版本也是输入：索引器升级后同一份源码可能派生出不同的行（此处只取可读的那一份）
    let schema = '';
    try {
      const has = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_versions'")
        .all() as Array<{ name?: string }>;
      if (has.length) schema = JSON.stringify(db.prepare('SELECT * FROM schema_versions ORDER BY 1').all());
    } catch {
      schema = ''; // 读不到就不进 epoch：宁可少一层（更保守地不命中）也不猜
    }
    const epoch = sha256Hex(JSON.stringify([...byPath.entries()]) + '\u0000' + schema);
    return { byPath, epoch };
  } catch {
    return null;
  }
}

/**
 * 映射表**本体**的 sha（Turborepo #14820 的教训：映射表变了，输出就变了，即使输入一个字都没改）。
 *
 * ★ 读的是**正在执行的这份模块**（`import.meta.url` 的兄弟文件）：`tsx` 直跑 = `.ts`，`dist` 跑 = `.js`。
 *   ⇒ 改了 `.ts` 而没重新 build，执行的仍是旧 `.js`，哈希不变 —— **这正确**（产物确实不会变）；
 *     重新 build 之后哈希才变（那时产物确实可能变）。
 * ★ 兄弟文件读不到 ⇒ 退回"映射表的语义内容"（列交代 + 派生 SQL）；再算不出来 ⇒ `null`（调用点 fail-closed）。
 */
export function projectionDigest(selfUrl: string): string | null {
  try {
    const base = path.join(path.dirname(fileURLToPath(selfUrl)), 'design_db_projection');
    for (const ext of ['.js', '.ts']) {
      const p = base + ext;
      if (fs.existsSync(p)) return sha256Hex(fs.readFileSync(p));
    }
  } catch {
    /* 落到下面的语义回落 */
  }
  try {
    return sha256Hex(JSON.stringify(SYMBOL_COLUMN_MAP) + '\u0000' + symbolSelectSql());
  } catch {
    return null;
  }
}

/**
 * 一个 path 的**输入签名**（五元组合成）。
 * ★ 只喂字符串 ⇒ 同一状态永远同一签名（0.16：连跑两次必须同结论）。
 * ★ 形状是**加法**：以后再加一项输入，就加到 `parts` 里、把 `DESIGN_DB_FORMAT_VERSION` +1。
 */
export function designDbInputSignature(parts: {
  format: number;
  designDigest: string;
  factDigest: string;
  factsEpoch: string;
  projectionDigest: string;
}): string {
  return sha256Hex(
    [`v${parts.format}`, parts.designDigest, parts.factDigest, parts.factsEpoch, parts.projectionDigest].join('|'),
  );
}

/** 一个路径的一个**持有者**（= 某个 feature 里的那个节点） */
export interface DesignDbHolder {
  /** feature 名（= 设计文件名去后缀） */
  feature: string;
  /** 表头里的来源串：`design/<feature>.dsl.json` */
  source: string;
  node: AnyNode;
}

/** 归并后的一份投影的**设计侧输入**（★ 不含事实：symbols / imports / calls 全在 cache.db） */
export interface DesignDbPlanItem {
  /** 仓库相对路径 */
  path: string;
  /** 所有持有者的 feature（★ 稳定序 = 设计文件名排序） */
  holders: string[];
  /** 所有持有者的来源串（顺序与 holders 一致） */
  sources: string[];
  /** 所有持有者的判据**并集**（去重、稳定序） */
  expectations: RawExpectation[];
}

/**
 * ★★★ **真冲突**（2026-10-20）：两个 feature 对同一文件的要求**不可能同时满足**。
 *
 * 为什么必须与「投影陈旧」分开：
 * - 投影陈旧 ⇒ **重跑生成器**就绿（`GenDesignDbResult.drift`）；
 * - 真冲突 ⇒ 重跑一百遍也绿不了（`GenDesignDbResult.conflicts`）—— 只有**改设计**能修。
 * 把两者混成一个计数，就是本仓最反对的那种读数：「红着，但没人知道该动哪儿」。
 *
 * 判据只有两条（★ 都是**可机器判定**的，不靠"两个 decision 逐字不同"）：
 * ① 同一符号的两条 `signature-matches` 给出**不同签名** ⇒ 不可能同时成立；
 * ② 一个 feature 的 `source-has.must` 与另一个的 `source-has.mustNot` 撞同一串 ⇒ 互斥。
 * ★ 其余主张（file-exists / symbol-exists / call-exists / edge-* / run）都是**正向断言**，
 *   两个 feature 各说一条只能**并集**，构不成矛盾 —— 所以今天 23 个多持有者路径里
 *   真冲突是 **0 条**（实测，2026-10-20）。
 */
export interface DesignDbConflict {
  path: string;
  kind: 'signature-matches' | 'source-has';
  /** 人话，点名两边的 feature 与各自的要求 */
  detail: string;
}

/** 判据的去重键：**只含判据本体**（`why` 是理由，不进键 —— 同一判据两说理由不算两条） */
const expectationKey = (e: RawExpectation): string =>
  JSON.stringify([
    e.kind ?? '',
    norm(e.path ?? ''),
    e.symbol ?? '',
    norm(e.target ?? ''),
    norm(e.from ?? ''),
    norm(e.to ?? ''),
    e.signature ?? '',
    (e.must ?? []).join('\n'),
    (e.mustNot ?? []).join('\n'),
    e.expect ?? '',
    JSON.stringify(e.input ?? null),
  ]);

/** 同一路径上两个持有者之间的**真冲突**（判据见 {@link DesignDbConflict}） */
function conflictsOf(rel: string, holders: DesignDbHolder[]): DesignDbConflict[] {
  const out: DesignDbConflict[] = [];

  // ① signature-matches：同一符号被要求不同签名
  const sigs = new Map<string, Map<string, string[]>>();
  for (const h of holders) {
    for (const e of h.node.decision?.expectations ?? []) {
      if (e.kind !== 'signature-matches' || !e.symbol) continue;
      const key = `${norm(e.path ?? rel)}#${e.symbol}`;
      const bySig = sigs.get(key) ?? new Map<string, string[]>();
      const sig = String(e.signature ?? '');
      bySig.set(sig, [...(bySig.get(sig) ?? []), h.feature]);
      sigs.set(key, bySig);
    }
  }
  for (const [key, bySig] of sigs) {
    if (bySig.size < 2) continue;
    const said = [...bySig.entries()].map(([sig, who]) => `${who.join('+')} 要求 \`${sig}\``).join('；');
    out.push({ path: rel, kind: 'signature-matches', detail: `${key} —— ${said}` });
  }

  // ② source-has：一边说"必须有"、另一边说"必须没有"同一串
  const byFile = new Map<string, Array<{ feature: string; must: Set<string>; mustNot: Set<string> }>>();
  for (const h of holders) {
    for (const e of h.node.decision?.expectations ?? []) {
      if (e.kind !== 'source-has') continue;
      const file = norm(e.path ?? rel);
      const list = byFile.get(file) ?? [];
      let slot = list.find((x) => x.feature === h.feature);
      if (!slot) {
        slot = { feature: h.feature, must: new Set<string>(), mustNot: new Set<string>() };
        list.push(slot);
      }
      for (const m of e.must ?? []) slot.must.add(String(m));
      for (const m of e.mustNot ?? []) slot.mustNot.add(String(m));
      byFile.set(file, list);
    }
  }
  for (const [file, list] of byFile) {
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        for (const m of a.must) {
          if (!b.mustNot.has(m)) continue;
          out.push({
            path: rel,
            kind: 'source-has',
            detail: `${file} —— ${a.feature} 要求源码里**必须有** \`${m}\`，而 ${b.feature} 要求**必须没有**它`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * ★★★ 2026-11-01（一处权威 · 归属）：**一册设计册在"归属"这条链上被读到的全部内容** —— 只有三段。
 *
 * 为什么不直接吃 `DesignDSL`：判定引用解析（{@link resolveDecisionExpectation}）要能在**纯夹具**
 * （只有 `geometry.nodes` + `excluded` 的对象）上判，不许为此去碰 storage 的读端；
 * 而设计与解析**必须读同一本账**（0.9「一处权威」）⇒ 形状收窄，两处传进来的必须是同一份册。
 */
export interface DesignSheetLike {
  /** 册名（★ **以文件名为准**，见 {@link loadDesignSheetsForGate}） */
  feature?: string;
  geometry?: { nodes?: AnyNode[] };
  /** 管辖范围声明（`path` 作**前缀**匹配 —— 与 `planDesignDb` 的 byPath 同一口径） */
  excluded?: Array<{ path?: string; reason?: string }>;
  /**
   * 语义层文件条目（★ 2026-11-04 · A4）：**只为本门读职责占位**而开的一个切面。
   * ★ 为什么不另开一个读端：册的唯一读端是 {@link loadDesignSheetsForGate}（0.9.1）⇒
   *   加需要的那一列，而不是让门自己去 `readFileSync` 第二遍。
   */
  semantic?: { files?: Array<{ id?: string; path?: string; responsibility?: string }> };
}

/** {@link loadDesignSheetsForGate} 的读结果 */
export interface DesignSheetsForGate {
  features: string[];
  sheets: Array<DesignSheetLike & { feature: string }>;
  /** 设计目录不存在（**合法状态**：还没开垦，不是失败） */
  missingDir: boolean;
}

/**
 * 读设计册 —— **只读 `<root>/.agent-io/design/*.dsl.json`**，不碰 `cache.db`、不碰注册表。
 *
 * ★ 这是"归属"这条链上的**唯一读端**：`planDesignDb`（投影 / 归属门）与
 *   `resolveDecisionExpectation`（判定引用解析）都从这里拿册 —— 拿两次就算两份事实。
 *
 * ★★★ 2026-11-17（T-#A8A9-CROSS-BOOK 批 0.4）：**实现体搬到 `infrastructure/storage.ts#readDesignSheetsForGate`**，
 *   本函数只是它的**别名**。为什么必须搬：写端判据（`storage#assertBookOwnership`）也要读"哪几册属于本项目"，
 *   而 `storage → application` 会成环 ⇒ 读数下移到 storage，**口径一个字没变**（这里仍是它的公开名）。
 *   ★ 这条纪律别破：**读端只有一份实现**，别名不是第二份。
 */
export function loadDesignSheetsForGate(root: string, opts: { feature?: string } = {}): DesignSheetsForGate {
  return readDesignSheetsForGate(root, opts) as unknown as DesignSheetsForGate;
}

/**
 * ★★★ 2026-11-17（T-#A8A9-CROSS-BOOK 批 0.6）：**跨册归属读数**（`structure-gate` ② 档的唯一判定入口）。
 *
 * ## 它问的问题（与 ① 档互补，不重叠）
 * · ① 文件级（`silentGapsOf`）：**盘上有 ∧ 册上无节点 ∧ 未声明排除** —— "有没有人在管"；
 * · ② 跨册归属（本函数）：**册上有 ∧ 归属是否恰一个人** —— "是不是恰一个人在管"。
 *   ⇒ `h == 0` 是 ① 的领域，本函数**不重算**（同一事实两处实现 = 0.9.1 违例）。
 *
 * ## 五档（互斥；读数必须带分母）
 * `owned`（绿）· `multi_owned`（h≥2）· `owner_mismatch`（h==1 但属主是别册）·
 * `unowned_but_held`（落在 `unowned` 条目里却有节点）· `undeclared`（域表没有一条覆盖它 = **判不了**）。
 * ★ 外加 `id_drift`：`id ≠ nodeIdOf(path)` 的**存量**节点（本卡只报不改 —— 改名会断
 *   `judgement_ref` / `plans` / `write_log` 的既有引用）。
 *
 * ## 三态
 * 域表不在 / 坏 ⇒ `applied:false` + `table_error`（门据此**退出码 2**，不折成 0 也不折成 1）。
 */
export function crossBookReadingOf(root: string): CrossBookReading & { table: DesignBooksRead } {
  const read = readDesignBooks(root);
  const loaded = loadDesignSheetsForGate(root);
  const reading = crossBookOwnership(loaded.sheets as unknown as Parameters<typeof crossBookOwnership>[0], read);
  return { ...reading, table: read };
}

/**
 * ★★★ 2026-11-18（T-#EXCLUDED-EMPTY-PATH）：**`excluded` 的形状断言**（唯一守卫；纯函数，可单独消融）。
 *
 * ## 它治哪个洞（实测过两次的假绿，不是设想）
 * `agent-io.dsl.json` 的 `excluded` 曾被手写成**字符串数组** `["tests/fixtures/java-proj/**"]`。
 * 而唯一读端 {@link excludedPathsOf} 按 `{path, reason}` 取值 ⇒ `x.path` 是 `undefined` ⇒
 * {@link norm} 得 `''` ⇒ {@link isExcludedPath} 的 `p.startsWith('')` **恒真** ⇒
 * 结构门把盘上**所有**没有节点的源文件都算进 `excluded`、`gaps` 恒 0。
 * 实测读数（形状修好前后同一条命令）：
 * `source 585 / with_node 525 / excluded 60 / gaps 0`（假绿，吞掉 19 个真无节点源文件）
 * → `excluded 41 / gaps 19`（真红，逐个点名）。
 * 同族病征（0.12「读不到 ≠ 没有」）：**输入形状没被判就进匹配器**，而 `startsWith('')` 恒真是
 * TS/Rust 都常见的兜底陷阱 ⇒ 这里在并集**入口**响亮拒，报文点名 `册名 + 第几条 + 实际值`。
 *
 * ## 为什么在这里判（不是 `isExcludedPath`、也不是各调用方）
 * · `isExcludedPath` 拿到的是**已归一**过的 `{path: string}` —— 形状信息到那里已经丢了，再判晚一步；
 * · `excludedPathsOf` 正是「形状 → path」的那一步，判在它前面最贴身；
 * · 五个生产调用方（`write_gate#collectGateCoverage` / `excludedNodeConflicts` /
 *   `assertedPathsBySheet` / `design_line#silentGapsOf` / `diff_views`）都经它 ⇒ 一处判据全覆盖（0.9.1）。
 *
 * ## 判据（与写端 `task_ops#applyExcludedOp` 同口径）
 * 合法形状只有 `[{path: 非空, reason: 非空}]`；`excluded` **缺省 / null** 是合法的（= 没声明管辖边界）。
 * ★ **不做静默归一**（`string → {path}`）：兼容会把「册写错」这件事藏进实现，下一次再写错就没人知道
 *   —— 而这条 bug 的全部代价就是「没人知道」。
 */
export function assertionExcludedShape(sheets: readonly DesignSheetLike[]): void {
  const bad: string[] = [];
  sheets.forEach((s, si) => {
    const raw = (s as unknown as { excluded?: unknown }).excluded;
    if (raw === undefined || raw === null) return;
    const who = norm((s as { feature?: string }).feature) || `sheet#${si + 1}`;
    if (!Array.isArray(raw)) {
      bad.push(`${who} 册 excluded 不是数组（收到 ${JSON.stringify(raw)}）`);
      return;
    }
    raw.forEach((x, i) => {
      const at = `${who} 册第 ${i + 1} 条`;
      if (!x || typeof x !== 'object' || Array.isArray(x)) {
        bad.push(`${at} 不是 {path, reason} 对象（收到 ${JSON.stringify(x)}）`);
        return;
      }
      if (!norm((x as { path?: unknown }).path)) bad.push(`${at} 的 path 为空（收到 ${JSON.stringify(x)}）`);
      else if (!norm((x as { reason?: unknown }).reason)) bad.push(`${at} 的 reason 为空（收到 ${JSON.stringify(x)}）`);
    });
  });
  if (bad.length) {
    throw new Error(
      'excluded 形状非法（T-#EXCLUDED-EMPTY-PATH；空 path 会让全仓文件被排除、结构门 gaps 恒 0）：' + bad.join('；'),
    );
  }
}

/**
 * 全部册的 `excluded` 并集（管辖范围声明的唯一切面）。
 * ★ 2026-11-05（R12①）：**带上 `feature`** —— "这条声明是哪册写的"是复算冲突时必须说得出的那一半
 *   （{@link excludedNodeConflicts} 要报「哪册哪个前缀」）；只加字段、不改口径，读端按需取。
 */
export function excludedPathsOf(
  sheets: readonly DesignSheetLike[],
): Array<{ path: string; reason: string; feature: string }> {
  // ★★★ T-#EXCLUDED-EMPTY-PATH：**形状先判再并** —— 空 path 会让下面整段前缀匹配恒真（结构门假绿）。
  assertionExcludedShape(sheets);
  const out: Array<{ path: string; reason: string; feature: string }> = [];
  for (const s of sheets) {
    for (const x of s.excluded ?? []) {
      out.push({ path: norm(x.path), reason: String(x.reason ?? ''), feature: norm(s.feature) });
    }
  }
  return out;
}

/** `p` 是否落在某个 `excluded` 声明里（前缀匹配；与 `planDesignDb` 同一口径） */
export function isExcludedPath(excluded: ReadonlyArray<{ path: string }>, p: string): boolean {
  return excluded.some((x) => p === x.path || p.startsWith(x.path));
}

/**
 * ★★★ 2026-11-05（R49）：「**有节点 ⇒ 声明不适用**」（node wins）—— **这条规则的唯一语句**。
 *
 * 语义：`excluded` 声明只豁免**没有任何册给它建节点**的路径。
 *
 * 为什么判据落在「**节点存在性**」上，而不是「归属」或「按册作用域」：
 *   · `excluded` 的本意是"这个目录不进册"—— 而只要有一册说它是设计对象，这句话就不成立；
 *   · 磁盘上的一个文件**不属于任何册**（归属只在册里），而结构门是**磁盘驱动**的 ⇒
 *     "A 册的声明只豁免 A 册的节点"在投影/结构门这一侧没有一个干净的归属概念可落。
 *   · 「节点存在性」是可判的：`nodePaths` 就是册里所有节点的 `path`，不需要新概念。
 *
 * ★ 历史（为什么必须有这一格）：某册的一句 `scripts/` 曾把**另一册** 69 个脚本节点（含 24 条判据）
 *   全挡在 design-db 之外 —— 立卡写判据的是 A 册，一句话把它们静音的是 B 册，而 B 册对它们没有发言权。
 * ★ 消费者的形态：`assertedPathsBySheet` 直接调它；`planDesignDb` 与 `design_line#silentGapOf`
 *   **只遍历节点**（所以本判据在那里恒为"不适用"，表现为"不看 excluded"，而不是再写一份判断）。
 * ★ 被覆盖的那批（声明 ∧ 节点）不是债务了，是**信息档**：见 {@link excludedNodeConflicts}。
 */
export function excludedAppliesTo(
  decls: ReadonlyArray<{ path: string }>,
  nodePaths: ReadonlySet<string>,
  p: string,
): boolean {
  if (!isExcludedPath(decls, p)) return false;
  return !nodePaths.has(p);
}

/**
 * 一条「声明与节点共存」（R12①）：**某文件既被册级 `excluded` 声明命中，册里又给它建了节点**。
 *
 * ★★★ 2026-11-05（R49）：它现在是**信息档**，不是矛盾 —— node wins 之后两个读者**不再取相反结论**：
 *   · **写闸**（`write_gate#evaluateTaskGate`）：`cands.length !== 0` ⇒ 短路走节点判 ⇒ 受任务闸；
 *   · **投影**（本文件 `planDesignDb`）：**不再看 `excluded`** ⇒ 同一个节点**照样进 design-db**。
 * ⇒ 本读数回答的是「**这条声明覆盖掉了哪些节点**」（谁声明、覆着几个节点、那些节点上几条判据），
 *   而不是"待清债务"：那批节点照样入册、判据照样跑（R49 之前它确实是债：投影跳过、判据不进库）。
 * ★ 旧不变量 `excluded ∩ nodes = ∅` **已退位**：它把"两种写法"当成了"矛盾"。
 */
export interface ExcludedNodeConflict {
  /** 文件路径（仓库相对、正斜杠） */
  path: string;
  /** 踩了这条冲突的节点 id */
  node: string;
  /** 节点在哪一册 */
  feature: string;
  /** 命中哪条声明 —— `<册>:<前缀>`（一个字段同时点名"哪册"与"哪个前缀"；不写"某处有声明"） */
  declared: string;
  /** 该节点挂着几条判据（★ R49 之后它们**照样进 design-db**；这个字段用来量"这条声明覆掉了多少判据"） */
  expectations: number;
  /**
   * 该节点**自己的**写闸口径（`'gated'` = 缺省 / `'exempt'` = 显式免检），与写闸**同一把尺**。
   *
   * ★★★ 2026-11-05（R12④）：R33 的 5 形态表按「这个节点有没有 gate」分组 ——
   *   **① 真矛盾** = 节点无 gate（= gated）却被册级声明命中；**② 两声明同向** = 节点全 `exempt`。
   *   而在此之前本读数**只有 `expectations` 计数、没有 `gate`** ⇒ 「按形态分组」这件事**没有权威**，
   *   每个读端只能自己再读一遍册（0.31③：工具依赖的字段来源不成立 ⇒ 结论不可信）。
   *
   * ★ **盘上存在性不在这里**：「幽灵 / 本门口径外」要读盘，而本函数是纯函数（无 IO）。
   *   那个事实的唯一住处是 `design_line.ts#silentGapsOf` 的 `conflict_outside[].on_disk`
   *   （它同时是 `assertConflictUniverseClosed` 的输入）—— 再算一份就是同一事实两处（0.9.1），故不复制。
   */
  gate: NodeGate;
}

/** {@link excludedNodeConflicts} 的读数（★ 必须带分母：0.12③ / 0.19③） */
export interface ExcludedNodeConflicts {
  /** 逐条冲突（按 path → 册 → 节点 稳定排序） */
  conflicts: ExcludedNodeConflict[];
  /** 冲突涉及的**文件**数（去重；同一文件被两册各建一个节点 ⇒ 1 文件 / 2 节点） */
  conflict_files: number;
  /** 冲突**节点**数（= `conflicts.length`；判"建一个节点 ⇒ +1"看这个最直接） */
  conflict_nodes: number;
  /** 分母：全册 `excluded` 声明条数 */
  excluded_decls: number;
  /** 分母：全册节点数 */
  total_nodes: number;
  /** 冲突节点上挂着的判据总数（★ R49：它们**照样入册**；这里是"覆盖面"的分母，不是代价读数） */
  expectations: number;
}

/**
 * ★★★ 2026-11-05（R12①）：**「声明覆盖了哪些节点」的唯一判定核**（R49 起为信息档，不是矛盾核）。
 *
 * 纯函数（不读盘、不落盘）：输入是 {@link loadDesignSheetsForGate} 读来的册，输出是读数。
 * 前缀匹配走 {@link isExcludedPath}，不在这里再写第二份。
 *
 * ★ 它回答三件事（都是信息，不是待办）：
 *   ① **覆盖面可见**：几十处"声明了不管、又建了节点"不再靠人记；
 *   ② **量级可见**：读数给到"节点 + 它挂的判据"（`expectations` 一栏），不是"一个文件"；
 *   ③ **来源可追**：每条点名「文件 · 哪册哪个前缀 · 几个节点 · 几条判据」。
 * ★ **它不再支撑任何"删节点/删声明"的裁决**：R49 之后这两批读者已经不取相反结论了
 *   （见 {@link ExcludedNodeConflict} 的文档）—— 删不删是范围意图问题，不是这道读数能判的。
 *
 * ★ 口径：只认节点的 `path`（`description` 已删，见 T-#37），且 `path` 为空的手写节点不算
 *   （它没有被投影跳过这件事可判）。
 */
export function excludedNodeConflicts(sheets: readonly DesignSheetLike[]): ExcludedNodeConflicts {
  const decls = excludedPathsOf(sheets);
  const conflicts: ExcludedNodeConflict[] = [];
  let totalNodes = 0;
  for (const s of sheets) {
    const feature = norm(s.feature);
    for (const n of (s.geometry?.nodes ?? []) as AnyNode[]) {
      totalNodes += 1;
      const rel = norm((n as { path?: string }).path);
      if (!rel) continue;
      const hit = decls.find((d) => isExcludedPath([d], rel));
      if (!hit) continue;
      conflicts.push({
        path: rel,
        node: String((n as { id?: string }).id ?? ''),
        feature,
        declared: `${hit.feature}:${hit.path}`,
        expectations: (n.decision?.expectations ?? []).length,
        // ★ R12④：缺省一律按 'gated' 走 —— 与写闸 `write_gate#evaluateTaskGate` 同一口径
        //   （漏标 = 受闸 = 安全方向）；只有显式 'exempt' 才算免检。
        gate: (n as { gate?: NodeGate }).gate === 'exempt' ? 'exempt' : 'gated',
      });
    }
  }
  conflicts.sort((a, b) => a.path.localeCompare(b.path) || a.feature.localeCompare(b.feature) || a.node.localeCompare(b.node));
  return {
    conflicts,
    conflict_files: new Set(conflicts.map((c) => c.path)).size,
    conflict_nodes: conflicts.length,
    excluded_decls: decls.length,
    total_nodes: totalNodes,
    expectations: conflicts.reduce((sum, c) => sum + c.expectations, 0),
  };
}

/**
 * ★★★ **归属账的唯一实现**：`受断言的文件 → 册 → 条数`。
 *
 * `gen-db-check` 的 ⑦（归属重复）与判定引用解析（{@link resolveDecisionExpectation}）**读同一本账**
 * —— 分开写就是「同一事实两把尺」，而这两把尺恰恰会在"该归谁"上给出两种答案。
 *
 * ★ 断言的文件是判据**自己的** `e.path`（缺省回落节点 path）：节点 `file_src_x_ts` 上完全可以有
 *   断言 `src/y.ts` 的判据（`source-has` 常这么写）⇒ 只看节点 path 会**漏数**。
 */
export function assertedPathsBySheet(sheets: readonly DesignSheetLike[]): Map<string, Map<string, number>> {
  const excluded = excludedPathsOf(sheets);
  // ★★★ 2026-11-05（R49 · node wins）：判据**落在这条路径上有没有节点**，不落在"哪一册声明了它"。
  //   `excluded` 本意是"这个目录不进册"；只要有一册给它建了节点，这句话就不成立 ⇒ 那条断言照样进归属账。
  //   ★ 唯一语句住 {@link excludedAppliesTo}（本文件）—— 这里只把两个输入取来，不再写第二份判据。
  const nodePaths = new Set<string>();
  for (const s of sheets) {
    for (const n of s.geometry?.nodes ?? []) {
      const p = norm((n as { path?: string }).path);
      if (p) nodePaths.add(p);
    }
  }
  const byPath = new Map<string, Map<string, number>>();
  for (const s of sheets) {
    const feature = norm(s.feature);
    for (const n of s.geometry?.nodes ?? []) {
      const rel = norm((n as { path?: string }).path);
      for (const e of n.decision?.expectations ?? []) {
        const asserted = norm(e.path) || rel;
        if (!asserted) continue;
        if (excludedAppliesTo(excluded, nodePaths, asserted)) continue;
        const byFeature = byPath.get(asserted) ?? new Map<string, number>();
        byFeature.set(feature, (byFeature.get(feature) ?? 0) + 1);
        byPath.set(asserted, byFeature);
      }
    }
  }
  return byPath;
}

/** 归属账 → 归属重复清单（同一 path 被 >1 册断言）。展示顺序不在本函数定（见 {@link renderOwnership}） */
export function ownershipConflictsOf(
  assertedBy: ReadonlyMap<string, Map<string, number>>,
): DesignDbOwnershipConflict[] {
  const out: DesignDbOwnershipConflict[] = [];
  for (const [p, byFeature] of assertedBy) {
    if (byFeature.size < 2) continue;
    out.push({ path: p, claims: [...byFeature.entries()].map(([feature, count]) => ({ feature, count })) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** 一条 `decision:<node_id>#<index>` 的解析结果（★ `ok:false` 必带人话原因 —— 不许静默回落成 null） */
export type DecisionResolution =
  | { ok: true; feature: string; node: AnyNode; exp: RawExpectation; assertedPath: string }
  | { ok: false; why_not: string };

/**
 * ★★★ 2026-11-01（**一处权威 · 归属**）：把 `decision:<node_id>#<index>` 解到**持有该 path 的那本册**。
 *
 * ## 它修的是什么（改前按册序挑，实测 42 个同名节点解不出来）
 * 改前 `write_gate#resolveJudgementKind` 与 `judgement_run#expectationOf` 都是「**按册序取第一个
 * 同名节点**」⇒ 一个 path 的断言搬到持有册后，另一册里的同名节点仍在（0 条断言）⇒ 册序在前的那一份
 * 先命中 ⇒ 报文是 `expectations[1] 不存在（该节点有 0 条）`，而它读起来和"设计里没这条判据"一模一样。
 *
 * ## 判据（与 `gen-db-check` 的 ⑦ **同一把尺**：读同一本 {@link assertedPathsBySheet}）
 * ① 先按 `node_id` 找**所有**同名节点；
 * ② **候选** = 真有第 `index` 条判据（`expectations` 非空）的那些册；
 * ③ 候选唯一 ⇒ 再核归属：它断言的 path 必须由它**独占**（归属账里只有它一个断言者），
 *    否则报「归属重复」（与门同一条判据）；
 * ④ 候选多处 ⇒ 先用「节点自己那个 path 的持有册」收窄；收窄后仍不唯一 ⇒ **报歧义并全列候选**
 *    （★ 不许挑第一个 —— 那正是改前的病）；
 * ⑤ 一册都取不到 ⇒ 报"没有任何断言"，并**列出它在哪几册出现过、各几条**（0.12 第 3 条：分母要露出来）；
 * ⑥ ★ **显式册名**（3 段写法）⇒ ①②③④ 全不走：只在该册里找，找不到就**点名它指的那一册**
 *    （{@link resolveDecisionInNamedSheet}）—— 它是"归属不唯一"的**出路**，不是对它的豁免。
 */
export function resolveDecisionExpectation(
  nodeId: string,
  index: number,
  sheets: readonly DesignSheetLike[],
  /**
   * ★ **显式册名**（`decision:<feature>:<node>#<i>` 的 **3 段**写法，2026-11-05 · R72）：给了 ⇒ **只在这一册里找**。
   * ① 不走下面的"归属账收窄"—— 那套逻辑存在的理由正是"你**没**说自己指哪册"；
   * ② **绝不回落别的册**（回落正是"不替你挑册序第一份"的反面）。
   * ★ 它**不是**把「一个 path 两个断言者」合法化：那件事由 `gen-db-check` 的 ⑦ 独立报红（与 ref 怎么写无关）。
   */
  sheetName?: string,
): DecisionResolution {
  if (sheetName !== undefined && sheetName !== '') {
    return resolveDecisionInNamedSheet(nodeId, index, sheets, sheetName);
  }
  type Holder = { feature: string; node: AnyNode; exps: RawExpectation[] };
  const pathOf = (n: AnyNode): string => norm((n as { path?: string }).path);
  const present: Holder[] = [];
  for (const s of sheets) {
    const node = (s.geometry?.nodes ?? []).find((n) => n.id === nodeId);
    if (!node) continue;
    present.push({ feature: norm(s.feature), node, exps: node.decision?.expectations ?? [] });
  }
  if (!present.length) {
    return { ok: false, why_not: `设计册里找不到节点 ${nodeId}（查了 ${sheets.length} 册，没有同名节点）` };
  }
  const inventory = present.map((p) => `${p.feature}(${p.exps.length} 条)`).join(' 与 ');
  const holders = present.filter((p) => p.exps[index] !== undefined);
  if (!holders.length) {
    const total = present.reduce((n, p) => n + p.exps.length, 0);
    return {
      ok: false,
      why_not:
        `节点 ${nodeId} 的第 ${index} 条判据**哪一册都取不到** —— 它在 ${present.length} 册里出现过、` +
        `共 ${total} 条断言：${inventory}（该节点没有任何断言 ⇒ 判据无依，**不是"通过"**）`,
    };
  }

  const assertedBy = assertedPathsBySheet(sheets);
  const claimsOf = (p: string): Array<{ feature: string; count: number }> =>
    [...(assertedBy.get(p) ?? new Map<string, number>())].map(([feature, count]) => ({ feature, count }));
  /** 归属账里 `p` 是否**只有这一个**断言者（`p` 不在账上 ⇒ 被 excluded 挡住，门不判它 ⇒ 无竞争） */
  const ownsPath = (feature: string, p: string): boolean => {
    if (!p) return true;
    const c = claimsOf(p);
    if (!c.length) return true;
    return c.length === 1 && c[0].feature === feature;
  };
  const describe = (h: Holder): string => {
    const asserted = norm(h.exps[index]?.path) || pathOf(h.node);
    const c = asserted ? claimsOf(asserted) : [];
    return (
      `${h.feature}（节点 path=${pathOf(h.node) || '—'}，第 ${index} 条 path=${asserted || '—'}，` +
      `${asserted ? `归属账：${c.map((x) => `${x.feature}(${x.count} 条)`).join(' / ')}` : '无 path'}）`
    );
  };

  let picked = holders[0];
  if (holders.length > 1) {
    // ① 用"节点自己那个 path 的持有册"收窄（同一本归属账；同 id 节点的 path 不同则无从收窄）
    const nodePath = pathOf(holders[0].node);
    const samePath = holders.every((h) => pathOf(h.node) === nodePath);
    const keep = samePath && nodePath ? holders.filter((h) => ownsPath(h.feature, nodePath)) : [];
    if (keep.length !== 1) {
      // ★ 2026-11-05（R72）：拒绝必须**可执行** —— 除"谁持有"（describe）外还要给出**往哪写**：
      //   出路里的册名取自 `holders` 的**真名**（不留 `<feature>` 占位符 —— 占位符等于把活推回给人）。
      const escape = holders.map((h) => `\`decision:${h.feature}:${nodeId}#${index}\``).join(' / ');
      return {
        ok: false,
        why_not:
          `节点 ${nodeId} 的第 ${index} 条判据**归属不唯一**（${holders.length} 册都有断言）⇒ 不替你挑册序第一份。` +
          `候选：${holders.map(describe).join(' · ')}` +
          `\n      ⇒ 用**显式册名**重写这条引用（上面哪一册是你要的，就把它的名字写进去）：${escape}`,
      };
    }
    picked = keep[0];
  }

  const exp = picked.exps[index];
  const assertedPath = norm(exp.path) || pathOf(picked.node);
  if (!ownsPath(picked.feature, assertedPath)) {
    const c = claimsOf(assertedPath);
    return {
      ok: false,
      why_not:
        `节点 ${nodeId} 的第 ${index} 条判据住在 ${picked.feature}，但它断言的 ${assertedPath} 的归属账是 ` +
        `${c.map((x) => `${x.feature}(${x.count} 条)`).join(' 与 ') || '（无）'} ⇒ **归属重复**` +
        `（与 gen-db-check 的 ⑦ 同一把尺：一个受断言的文件只许一册持有）⇒ 把这条判据搬到持有册，别在住处就地解析`,
    };
  }
  return { ok: true, feature: picked.feature, node: picked.node, exp, assertedPath };
}

/**
 * ★★★ 2026-11-05（R72）：`decision:<feature>:<node>#<i>` —— **显式册名**的解析（只在这一册里找）。
 *
 * ## 它治的是哪条病
 * 同一个 id 在两册都有、且两册都断言同一个 path ⇒ 归属账里谁都不"独占" ⇒
 * {@link resolveDecisionExpectation} 的收窄腿取不到唯一册（它当时只能报"归属不唯一"）。
 * **拒绝是对的**（不替你挑），错的是它当时**没有出路**：写引用的人明说"我要哪一册"时，
 * 闸不该还拿归属账去猜。
 *
 * ## 判据（三条，都可判）
 * ① 只在该册里找，找不到 ⇒ **点名它指的那一册**并给出该册的分母（几个节点 / 该节点几条判据）；
 * ② **不回落**：另一册里有一模一样的 id + index 也不是它（否则"显式"就是一句空话）；
 * ③ **册名不存在** ⇒ 点名它指的那册 + 列出本项目**有哪几册**（0.12：读数要能定位失败）。
 *
 * ★ 它**不**放宽数据层的归属判据：`assertedPathsBySheet` 那份账与 ref 怎么写无关，
 *   "一个 path 两个断言者"仍由 `gen-db-check` 的 ⑦ 独立报红。
 */
function resolveDecisionInNamedSheet(
  nodeId: string,
  index: number,
  sheets: readonly DesignSheetLike[],
  sheetName: string,
): DecisionResolution {
  const want = norm(sheetName);
  const inventory = sheets.map((s) => norm(s.feature)).join(' 与 ') || '（一册都没有）';
  const sheet = sheets.find((s) => norm(s.feature) === want);
  if (!sheet) {
    return {
      ok: false,
      why_not: `你指的是 \`${want}\` 册的 ${nodeId}#${index}，但**没有这本册**（本项目 ${sheets.length} 册：${inventory}）`,
    };
  }
  const nodes = sheet.geometry?.nodes ?? [];
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) {
    return {
      ok: false,
      why_not:
        `你指的是 \`${want}\` 册的 ${nodeId}#${index}，但该册里**没有这个节点**` +
        `（该册有 ${nodes.length} 个节点）⇒ **不会去别的册找**（显式册名 = 只认这一册）`,
    };
  }
  const exps = node.decision?.expectations ?? [];
  const exp = exps[index];
  if (exp === undefined) {
    return {
      ok: false,
      why_not:
        `你指的是 \`${want}\` 册的 ${nodeId}#${index}，但该册里**没有这条判据**` +
        `（该册有 ${nodes.length} 个节点，该节点有 ${exps.length} 条判据，第 ${index} 条不存在）`,
    };
  }
  return { ok: true, feature: want, node, exp, assertedPath: norm(exp.path) || norm((node as { path?: string }).path) };
}
/**
 * **归并计划**：读 `design/*.dsl.json`，把「一个路径」归成「一份投影」。
 *
 * ★ 这是本生成器的**唯一一处**决定"同一路径多个节点怎么办"的地方：
 *   - **不是**各写一份（否则同一文件的 symbols/calls 会被复制 N 份，消费者还得再挑一次）；
 *   - **不是**第一个/最后一个 feature 赢（那会让另一个节点**永远**对不上 —— 假门就是这么来的）；
 *   - **而是**判据取并集 + 表头列出**全部**持有者 + 矛盾单独判（{@link DesignDbConflict}）。
 *
 * ★ 纯 DSL 读取（**不碰 cache.db**）⇒ 结构可复现（`checkDesignDbStructure` 靠它当门）。
 */
export function planDesignDb(
  root: string,
  opts: { feature?: string } = {},
): {
  features: string[];
  nodes: number;
  items: Map<string, DesignDbPlanItem>;
  conflicts: DesignDbConflict[];
  /** ★ 目标③：**归属重复**（同一个受断言的文件被 >1 册断言）—— 重跑生成器修不好，只能搬家 */
  ownership: DesignDbOwnershipConflict[];
  /** 分母：被判据断言过的路径**总数**（0.12：只给分子等于没验） */
  assertedPaths: number;
  missingDir: boolean;
} {
  const loaded = loadDesignSheetsForGate(root, opts);
  const plan = {
    features: loaded.features,
    nodes: 0,
    items: new Map<string, DesignDbPlanItem>(),
    conflicts: [] as DesignDbConflict[],
    ownership: [] as DesignDbOwnershipConflict[],
    assertedPaths: 0,
    missingDir: loaded.missingDir,
  };
  if (plan.missingDir) return plan;

  // ① 按路径收集**所有**持有者 —— ★★★ 2026-11-17（批 0）：**"允许"改成"不许"**。
  //   旧注释原话：「同一路径允许被多个 feature 各持一个节点」—— 那句话**就是** 414 个跨册重复的许可
  //   （注释是本仓的权威载体，留着它就是下一次重复的许可证）。现在唯一语句是：
  //   `{册 | 该册有该 path 的文件节点}` **≤ 1**（仓根 `design-books.json` + `infrastructure/design_books.ts`）。
  //   ★ 本循环**仍然**收集全部持有者：存量 414 还没迁完（批 1–13），投影必须照旧并集（并集对单册恒等）。
  //     迁移收口后 `holders.length` 恒 1 ⇒ 这段代码自然退化成"取那一个"，不需要再改一次。
  // ★ 2026-10-24（管辖范围收口，裁 A）：范围权威从硬编码 `startsWith('src/')` 迁到**每册的 excluded 清单**——
  //   observe-lang 等非 src 产品文件由此入投影；certs/scripts 等量具由 excluded 挡住。
  // ★ 2026-10-26（T-#28）：路径取法已改为 **`path` 优先、回落 `description`**（见下面 `rel` 处）；
  //     原先只认 `description` ⇒ 手写节点的散文会变成文件名。
  // ★★★ 2026-11-05（R49 · node wins）：这里**故意不看 `excluded`** —— 声明只豁免**没有任何册给它建节点**的
  //   路径（别册的一句 `scripts/` 曾把本册 69 个脚本节点挡在 design-db 之外，而它对那些节点没有发言权）。
  //   本循环只遍历节点 ⇒ 每个 `rel` 都是某册的节点路径 ⇒ 声明在这一处**恒不适用** ⇒ 旧的那行跳过被删掉。
  //   ★ 这条规则的权威语句住 {@link excludedAppliesTo}；磁盘文件的四桶判序住 `design_line#silentGapOf`；
  //     「声明被节点覆盖 N 处」的**信息档**住 {@link excludedNodeConflicts}（仍按原样报，不因本改动消失）。
  const byPath = new Map<string, DesignDbHolder[]>();
  for (const dsl of loaded.sheets) {
    const feature = dsl.feature;
    for (const raw of (dsl.geometry?.nodes ?? []) as AnyNode[]) {
      // ★★★ 2026-10-26（T-#28）：**`path` 优先、回落 `description`** —— 与 `write_gate#nodeFilePath` 同口径。
      //   病史：这里原先**只**取 `description` ⇒ 手写节点（`description` 是职责散文）的整句中文
      //   会变成 design-db 的**文件名**。实测产出过：
      //     design-db/本仓的愿景-理想文档：回答「这个工具到底为什么存在」，是判据与取舍的最终依据。.calls.json
      //   旧 dump 里更夸张：“考古冻结声明（不挂判据、不阻断任何工具）.calls.json”。
      //   ★ 这是第 4 处“散文当结构”（前 3 处：`design-check` 拿 description 当 path ·
      //     `write_gate` 回落 description · `node.update` 的 responsibility 优先级）。
      //   ★ T-#23 已让 `import_project` 给 file 节点写 `path` ⇒ 扫描节点走 path 分支，产出不变。
      const rel = norm((raw as { path?: string }).path); // ★ T-#37：AnyNode.description 已删 ⇒ 只认 path
      // ★ 目标③ 的那本账（**谁断言了哪个文件**）不在这里算：唯一实现是 `assertedPathsBySheet`
      //   —— 判定引用解析（{@link resolveDecisionExpectation}）读的是同一本账，
      //     分头写就是同一事实两把尺（`docs/ONE-AUTHORITY.md`）。
      if (!rel) continue;
      plan.nodes += 1;
      const list = byPath.get(rel) ?? [];
      list.push({ feature, source: `design/${feature}.dsl.json`, node: raw });
      byPath.set(rel, list);
    }
  }

  // ② 一个路径 ⇒ 一份投影：判据并集（去重、稳定序）+ 真冲突单独收集
  for (const [rel, holders] of byPath) {
    const seen = new Set<string>();
    const expectations: RawExpectation[] = [];
    for (const h of holders) {
      for (const e of h.node.decision?.expectations ?? []) {
        const k = expectationKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        expectations.push(e);
      }
    }
    plan.items.set(rel, {
      path: rel,
      holders: holders.map((h) => h.feature),
      sources: holders.map((h) => h.source),
      expectations,
    });
    plan.conflicts.push(...conflictsOf(rel, holders));
  }

  // ③ ★ 目标③：一个受断言的文件 ⇒ **只能一册持有**（多者持有；平手归 agent-io）。
  //   ★ 子集读数的边界（0.12 的「分母」）：只给了 `opts.feature` 时这里只看得见那一册 ⇒
  //     `ownership` 恒空**不代表全仓没有重复** ⇒ 门的调用点必须**不传 feature**。
  const assertedBy = assertedPathsBySheet(loaded.sheets);
  plan.assertedPaths = assertedBy.size;
  // ★ 顺序不在这里定：`claims` 按册序原样带上 —— 展示顺序的唯一住处是 `renderOwnership`（它才知道要「多者在前」）
  plan.ownership = ownershipConflictsOf(assertedBy);
  return plan;
}

/** 投影里的 `requirements`（★ 只收 `call-exists` —— 契约门读的是这个） */
export function requirementsOf(item: DesignDbPlanItem): Array<Record<string, unknown>> {
  return item.expectations
    .filter((e) => e.kind === 'call-exists')
    .map((e) => ({ kind: 'call-exists', symbol: e.symbol, target: e.target, ...(e.why ? { why: e.why } : {}) }));
}

/**
 * 投影里的 `requirements_calls` 的**未解析形状**（`to` 要 cache.db 才能定住符号的家）。
 * ★ 结构检查（无 cache.db）只比 `from` 与条数 —— 这就是"设计要求进没进投影"的可复现判据。
 */
export function requirementCallsOf(item: DesignDbPlanItem): Array<{ from: string; target: string; why?: string }> {
  const out: Array<{ from: string; target: string; why?: string }> = [];
  for (const e of item.expectations) {
    if (e.kind !== 'call-exists') continue;
    const fromFile = norm(e.path ?? item.path);
    out.push({ from: `${fromFile}#${e.symbol}`, target: String(e.target ?? ''), ...(e.why ? { why: e.why } : {}) });
  }
  return out;
}

export interface GenDesignDbOptions {
  /** 只处理这个 feature（不传 = design/ 下全部） */
  feature?: string;
  /** 只比对不写盘（真写会改 design-db/） */
  check?: boolean;
}

export interface GenDesignDbResult {
  /** 参与生成的 feature 数 */
  features: number;
  /** 参与生成的**文件节点**数（同一路径被两个 feature 持有 ⇒ 计 2） */
  files: number;
  /** 归并后的**投影份数**（一个路径一份） */
  paths: number;
  /** 本次写入的副本数 */
  written: number;
  /** 内容未变、跳过的副本数 */
  unchanged: number;
  /**
   * ★ T-#INC-GENDB：**输入签名命中**的副本数（跳过 4 条查询 + 跳过 `JSON.stringify`）。
   * ★ 分母是 `paths`：`reused + recomputed === paths`（写盘/检查两条路都一样）——只报分子等于没验。
   */
  reused: number;
  /** ★ 签名**没**命中、本次真跑查询并序列化的副本数（含"旧格式副本"与"签名不可用"两种情况） */
  recomputed: number;
  /**
   * ★ 本次真发到 `cache.db` 的查询次数（3 条固定查询 + 每条 `call-exists` 一次 `qHome`）。
   * ★ 它是"命中真的跳了查询"的**机器可验**读数（用例断言它，而不是断言"大概变快了"）。
   */
  dbQueries: number;
  /** ★ 签名**不可用**时的原因（空串 = 可用）；读不到 ≠ 一致（0.12） */
  fingerprintNote: string;
  /** 清理掉的陈旧副本数（check 模式恒 0） */
  pruned: number;
  /** 问题清单（读库失败 / 找不到设计目录） */
  problems: string[];
  /** ★ 投影与设计/事实不一致（**重跑生成器**能修） */
  drift: string[];
  /** ★ 真冲突（**重跑修不好**，只能改设计） */
  conflicts: string[];
  /** ★ 归属重复（同一受断言文件被 >1 册断言；重跑修不好 —— 搬断言，见 {@link renderOwnership}） */
  ownership: string[];
  /** 本次是否 check 模式 */
  check: boolean;
}

/** 真冲突的人话（生成器与结构检查共用同一句，别各写一份） */
export const renderConflict = (c: DesignDbConflict): string =>
  `${c.path}: ${c.detail} —— 两个 feature 对同一文件的要求不可能同时满足（该改设计；重跑生成器修不好）`;

/**
 * ★★★ **归属重复**（目标③ 的机器判据）：同一个**受断言的文件**被多于一个册断言。
 *
 * ## 与 {@link DesignDbConflict}（真冲突）不是一回事 —— 两条都要留
 * - 真冲突：两册对同一文件的要求**互斥**（不可能同时成立）⇒ 必须改要求；
 * - 归属重复：两册**都断言**同一文件（要求并不互斥）⇒ **只能一册持有** ⇒ 把断言搬到持有册。
 *   归属规则：**多者持有；平手归 `agent-io`**（主册）。
 *
 * ## 为什么必须是机器判据（而不是"记得别两边写"）
 * 「一处权威」在册里是**可判真假**的：同一事实住两处，改一处不改另一处仍看起来正常。
 * 实测：2026-10-31 收口时该读数为 0，此后两条新判据分别写进 `agent-io` 与 `task-system-plan` 的
 * **同一批文件** ⇒ 变成 3 个双册 path，而**没有任何读数因此变红**（判据越多越容易原地复发）。
 * ⇒ 在归并计划里留一份「谁在断言哪个文件」的账，让它在 `gen-db-check` 这道**已有的门**里红。
 *
 * ## 归属按什么算（`e.path` 优先，缺省回落节点 `path`）
 * 一条判据断言的文件是它**自己**的 `e.path`，不是它挂在哪个节点上：
 * `file_src_x_ts` 节点上完全可以有断言 `src/y.ts` 的判据（`source-has` 常这么写）。
 * ⇒ 这本账（谁断言谁）与 `plan.items`（谁给谁写投影）**是两本**，别合并。
 */
export interface DesignDbOwnershipConflict {
  /** 受断言的文件（仓库相对路径） */
  path: string;
  /** 断言了它的册与各自条数（★ 顺序不在此约定：展示顺序由 {@link renderOwnership} 归一 —— 排序只许住一处） */
  claims: Array<{ feature: string; count: number }>;
}

/**
 * 归属重复的人话（★ 报文要能直接告诉人怎么修：搬到判据多的那一册）。
 * ★ 展示顺序的**唯一住处**就在这里：条数多者在前、平手按册名 —— 第一句就是「该归谁」，
 *   免得读的人自己数；顺序若由调用方给，同一份数据能渲染成两种说法。
 */
export const renderOwnership = (o: DesignDbOwnershipConflict): string => {
  const claims = [...o.claims].sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature));
  const who = claims.map((c) => `${c.feature}(${c.count} 条)`).join(' 与 ');
  return `${o.path} 被 ${who} 共同断言 ⇒ 只能一册持有（多者持有；平手归 agent-io）`;
};

/**
 * 生成（或检查）设计 DB。
 * ★ 纯 I/O：读 `design/*.dsl.json` + `cache.db`，写 `designDbDir(root)`（= `<root>/design-db/`）。
 *
 * ★ 2026-10-20：**一个路径只写一份**（此前是"逐节点各写一遍同一个文件名" ⇒ 后写的覆盖前面的，
 *   于是另一个 feature 的节点**永远**对不上 ⇒ `check=true` 结构上不可能绿）。
 *   现在按 `planDesignDb` 归并后写，表头列出**全部**持有者。
 */
export function genDesignDb(root: string, opts: GenDesignDbOptions = {}): GenDesignDbResult {
  const OUT_DIR = designDbDir(root);
  const CHECK = opts.check === true;

  const result: GenDesignDbResult = {
    features: 0,
    files: 0,
    paths: 0,
    written: 0,
    unchanged: 0,
    reused: 0,
    recomputed: 0,
    dbQueries: 0,
    fingerprintNote: '',
    pruned: 0,
    problems: [],
    drift: [],
    conflicts: [],
    ownership: [],
    check: CHECK,
  };

  const plan = planDesignDb(root, { feature: opts.feature });
  result.features = plan.features.length;
  result.files = plan.nodes;
  result.paths = plan.items.size;
  result.conflicts = plan.conflicts.map(renderConflict);
  result.ownership = plan.ownership.map(renderOwnership);
  if (plan.missingDir) {
    result.problems.push(`找不到 ${path.join(root, '.agent-io', 'design')}`);
    return result;
  }
  if (!CHECK) fs.mkdirSync(OUT_DIR, { recursive: true });

  const dbPath = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  // ★★★ 2026-10-28（同构漂移修复）：**SQL 由映射表派生**，不再手写列名 ——
  //   手写是漂移入口（实测：实际侧 21 列、设计侧只投影 5 键，`sym_hash` 这种重写锚点整整缺了一个月）。
  const qSymbols = db.prepare(symbolSelectSql());
  const qImports = db.prepare('SELECT source, kind, type_only FROM v_imports WHERE file_path = ? ORDER BY line');
  const qCallsOut = db.prepare("SELECT source, target FROM edges WHERE kind = 'call' AND source LIKE ? ORDER BY target");
  const qHome = db.prepare(
    'SELECT file_path FROM nodes WHERE name = ? AND parent IS NULL ORDER BY (file_path = ?) DESC LIMIT 1',
  );

  // ★★★ 2026-10-28（同构纪律的第二步）：**`reverse_calls` 删掉** —— 它是 `calls` 的一跳反向，
  //   **算得出来**（`calls[].to` 按文件归并即可）⇒ 落盘就是第二份事实，必然烂；
  //   而且实测**零消费者**（全仓只有本文件在写它）。要"谁调我"就用 `calls` 现算。

  // ★ 2026-10-24（裁 A 落地）：**期望段上投影** —— 设计册的符号期望（无行号）与现状并列，
  //   gap 一眼可见。意图的源在设计册，gen-db 幂等重生成 ⇒ 不需要锁（VISION §冲突已裁：calls 只读、dep 已退役）。
  const expectedByPath = new Map<string, Array<{ name: string; kind: string; signature?: string }>>();
  for (const f of fs.readdirSync(path.join(root, '.agent-io', 'design'))) {
    if (!f.endsWith('.dsl.json')) continue;
    const book = JSON.parse(fs.readFileSync(path.join(root, '.agent-io', 'design', f), 'utf8')) as {
      semantic?: { files?: Array<{ path?: string; symbols?: Array<{ name: string; kind: string; signature?: string }> }> };
    };
    for (const sf of book.semantic?.files ?? []) {
      if (!sf.path) continue;
      const key = norm(sf.path);
      if (!expectedByPath.has(key)) expectedByPath.set(key, []);
      const arr = expectedByPath.get(key)!;
      const seen = new Set(arr.map((s) => s.name));
      for (const s of sf.symbols ?? []) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        arr.push({ name: s.name, kind: s.kind, ...(s.signature ? { signature: s.signature } : {}) });
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ★★★ T-#INC-GENDB：**每次运行一次的**两样输入（与路径数无关 ⇒ 成本不随 550 增长）
  //   `facts` = cache.db 的全库事实快照（行级 key 沿用已有的 `files.content_hash`）
  //   `projDigest` = 映射表本体的 sha（映射表也是输入 —— Turborepo #14820）
  //   ★ 任一算不出来 ⇒ `fingerprintUsable=false` ⇒ **一个都不命中**（fail-closed），并说出原因。
  // ════════════════════════════════════════════════════════════════════
  const facts = snapshotCacheFacts(db);
  const projDigest = projectionDigest(import.meta.url);
  const fingerprintUsable = facts !== null && projDigest !== null;
  if (!fingerprintUsable) {
    result.fingerprintNote =
      '输入签名**不可用** ⇒ 本次全量现算（' +
      (facts === null ? 'cache.db 没有 files 表 / 快照读不到' : '投影映射表的 sha 算不出来') +
      '）—— 读不到 ≠ 一致';
  }

  // ★★★ 2026-11-19（T-#PERF-MEMO）：**汇总与副本同一趟生成** —— 行在下面的循环里顺手攒，末尾一次落盘。
  //   命中（`reused`）的副本不重算 ⇒ 它的三个计数从**上一份汇总**里取（body 摘要已证明"字节没变" ⇒
  //   计数必然没变）；上一份汇总没有它（首轮 / 刚升级）才退回解析那一份旧副本（**一次**，之后就命中）。
  const indexRows: DesignDbIndexRow[] = [];
  const prevIndex = readDesignDbIndex(OUT_DIR);
  const prevRows = new Map<string, DesignDbIndexRow>();
  if (prevIndex.ok) for (const r of prevIndex.files) prevRows.set(norm(r.path), r);
  const rowOfReusedCopy = (rel: string, copyText: string): DesignDbIndexRow => {
    const prevRow = prevRows.get(norm(rel));
    if (prevRow) return prevRow;
    try {
      const j = JSON.parse(copyText) as {
        symbols?: unknown[];
        calls?: unknown[];
        requirements_calls?: unknown[];
      };
      return {
        path: rel,
        symbols: j.symbols?.length ?? 0,
        calls: j.calls?.length ?? 0,
        requirements_calls: j.requirements_calls?.length ?? 0,
      };
    } catch {
      result.problems.push(`${rel}: 汇总缺这一行、旧副本又解析不出来 ⇒ 汇总里按 0 记（跑一次不带 check 的生成可重建）`);
      return { path: rel, symbols: 0, calls: 0, requirements_calls: 0 };
    }
  };

  try {
    for (const item of plan.items.values()) {
      const rel = item.path;
      const outPath = path.join(OUT_DIR, outNameOf(rel));
      // ★ 副本先读：命中要用它的 `//inputs`；不命中时它本来就是"写前逐字节比"的左边（顺序变了，次数没变）
      const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;

      // ── ① 册侧输入（该 path 的持有者/来源/判据并集/期望符号切片）⇒ 一个 sha ──
      const expectedSlice = expectedByPath.get(norm(rel)) ?? null;
      const designDigest = sha256Hex(
        JSON.stringify({
          path: rel,
          holders: item.holders,
          sources: item.sources,
          expectations: item.expectations,
          expected_symbols: expectedSlice,
        }),
      );
      // ── ②③ 事实侧：该 path 的行级 key + 全库 epoch（跨文件解析的兜底）──
      const factDigest = facts?.byPath.get(norm(rel)) ?? '';
      const sig = designDbInputSignature({
        format: DESIGN_DB_FORMAT_VERSION,
        designDigest,
        factDigest,
        factsEpoch: facts?.epoch ?? '',
        projectionDigest: projDigest ?? '',
      });

      // ── 命中判定（三条同时成立才算命中；任一不成立 ⇒ 走原来的全量路径）──
      //   ① 副本带 `//inputs` 且格式版本一致；② `sig` 与现算相同（输入没变）；
      //   ③ `body` 与盘上正文相同（**产物没被外部改过** —— 这一条就是"不拆逐字节比"的机械保证）
      if (fingerprintUsable && old !== null) {
        const head = readInputHeaderFromText(old);
        if (
          head &&
          head.format === DESIGN_DB_FORMAT_VERSION &&
          head.sig === sig &&
          head.body === bodyDigestOf(old)
        ) {
          result.unchanged += 1;
          result.reused += 1;
          indexRows.push(rowOfReusedCopy(rel, old));
          continue; // ★ 跳 4 条查询、跳 stringify、跳逐字节比 —— 三样都由上面三条判据替掉了
        }
      }
      result.recomputed += 1;

      let symbols: Array<Record<string, unknown>> = [];
      let imports: Array<Record<string, unknown>> = [];
      let calls: Array<Record<string, unknown>> = [];
      try {
        // ★ 2026-10-28：投影走**唯一映射表**（`design_db_projection.ts`）——每列要么投影、要么写明为什么不投影
        symbols = (qSymbols.all(rel) as Array<Record<string, unknown>>).map(projectSymbolRow);
        imports = (qImports.all(rel) as Array<{ source: string; kind: string; type_only: number | null }>).map((r) => ({
          source: r.source,
          kind: r.kind,
          ...(r.type_only ? { type_only: true } : {}),
        }));
        calls = (qCallsOut.all(rel + '#%') as Array<{ source: string; target: string }>).map((r) => ({
          from: norm(r.source),
          to: norm(r.target),
        }));
        result.dbQueries += 3;
      } catch (e) {
        result.problems.push(`${rel}: 读 cache.db 失败（${(e as Error)?.message ?? String(e)}）`);
        continue;
      }

      // ★ 设计要求单独一个字段：`calls` 是全量镜像（必然全绿），
      //   `requirements_calls` 才是"设计说必须有"的 —— 契约门必须读它。
      const requirementsCalls: Array<Record<string, unknown>> = [];
      for (const spec of requirementCallsOf(item)) {
        result.dbQueries += 1;
        const home = qHome.get(spec.target, spec.from.split('#')[0]) as { file_path?: string } | undefined;
        if (!home) continue;
        requirementsCalls.push({
          from: spec.from,
          to: `${norm(home.file_path)}#${spec.target}`,
          ...(spec.why ? { why: spec.why } : {}),
        });
      }

      const sources = item.sources.join(', ');

      // ★★★ T-#INC-GENDB：payload 分两段拼，只为让"签名的 body"与"盘上的正文"是**同一份字节**。
      //   `payloadHead` = 注释键（`//` / `//generated_by` / `//source` ⇒ 静态）；
      //   `payloadBody` = 其余键（顺序与改前**逐字一致**，别动）；
      //   `//inputs` 插在 head 与 body 之间（★ 后面永远还有键 ⇒ 摘行规则 `stripInputHeaderLine` 成立）。
      const payloadHead = {
        '//': `Design DB —— ${rel}（★ 全量、与实际 DB 同构；从 ${sources} 的节点生成）`,
        '//generated_by': 'scripts/gen-design-db.mjs（★ 不许手改：改了下次生成就冲掉）',
        '//source': sources,
      };
      const payloadBody: Record<string, unknown> = {
        /** 副本自报路径（机器可读；此前只在首行注释里，消费者只能解析注释） */
        path: rel,
        symbols,
        imports,
        calls,
        ...(expectedSlice?.length ? { expected_symbols: expectedSlice } : {}),

        ...(requirementsOf(item).length ? { requirements: requirementsOf(item) } : {}),
        ...(requirementsCalls.length ? { requirements_calls: requirementsCalls } : {}),
      };
      // ★ body = **不含 `//inputs`** 的那份正文的 sha ⇒ 外部改了正文，body 就对不上（签名不命中）
      const body = sha256Hex(JSON.stringify({ ...payloadHead, ...payloadBody }, null, 2) + '\n');
      // ★ T-#PERF-MEMO：这一份的三计数进汇总（三个数组就在手上 ⇒ 零额外解析）
      indexRows.push({ path: rel, symbols: symbols.length, calls: calls.length, requirements_calls: requirementsCalls.length });
      const payload = {
        ...payloadHead,
        [INPUTS_KEY]: formatInputHeader({ format: DESIGN_DB_FORMAT_VERSION, sig, body }),
        ...payloadBody,
      };
      const text = JSON.stringify(payload, null, 2) + '\n';
      // ★ 写前逐字节比：**原样保留**（签名命中的那条路已被上面三条判据替掉，走到这里就必须真比）
      if (old === text) {
        result.unchanged += 1;
        indexRows.push({ path: rel, symbols: symbols.length, calls: calls.length, requirements_calls: requirementsCalls.length });
        continue;
      }
      if (CHECK) {
        result.drift.push(`${outNameOf(rel)}: 与当前设计不一致（该重跑生成器）`);
        continue;
      }
      fs.writeFileSync(outPath, text);
      result.written += 1;
    }
  } finally {
    db.close();
  }

  const expected = new Set([...plan.items.keys()].map(outNameOf));
  if (CHECK) {
    // ★ check 也要看"多出来的"：否则删了一个节点、副本留在盘上，这道读数永远是绿的
    for (const name of fs.readdirSync(OUT_DIR)) {
      // ★ T-#PERF-MEMO：`_index.json` **不是副本**（是汇总，只有本函数写它）⇒ 不在"陈旧副本"的口径里
      if (name === DESIGN_DB_INDEX_NAME) continue;
      if (!expected.has(name)) result.drift.push(`${name}: 设计里没有这个路径的节点（陈旧副本，该重跑生成器以清理）`);
    }
  } else {
    for (const name of fs.readdirSync(OUT_DIR)) {
      // ★ 同上：汇总的生死由下面 `writeDesignDbIndex` 管，**不许**被当陈旧副本删掉
      //   （删了 = 每次生成都把 ⑤ 打回全扫，而读数上完全看不出来）
      if (name === DESIGN_DB_INDEX_NAME) continue;
      if (!expected.has(name)) {
        fs.unlinkSync(path.join(OUT_DIR, name));
        result.pruned += 1;
      }
    }
    // ★★★ T-#PERF-MEMO：**同一趟落汇总**（check 档不写盘 —— 它是只读档）
    writeDesignDbIndex(OUT_DIR, indexRows);
  }
  return result;
}

/** 结构检查的读数（★ 只覆盖**设计侧可复现**的那一半） */
export interface DesignDbStructureResult {
  paths: number;
  files: number;
  /** 设计里有、盘上没有 */
  missing: string[];
  /** 盘上有、但与设计的**设计要求/表头**对不上 */
  stale: string[];
  /** 盘上有、设计里没有 */
  extra: string[];
  conflicts: string[];
  /** ★ 目标③：归属重复（同一 path 被 >1 册断言 —— 与真冲突不同：那个改要求，这个搬家） */
  ownership: string[];
  /** 分母：被判据断言过的路径总数（0.12：只给分子等于没验） */
  assertedPaths: number;
  problems: string[];
  /** ★ M1a：判据 kind → 投影去向的**诚实读数**（每 kind 一行：册侧 / 可投影 / 落地 / 落地率） */
  kindCoverage: KindCoverageRow[];
  /** ★ M1a 新门：会红的那一档（声明了投影键却没落地 / 声明表漏了 kind / SYMBOL_COLUMN_MAP 有沉默列） */
  kindProjectionGaps: string[];
  /** 已声明不投影的**判据条数**（豁免必须可追溯：读的人要知道"少看了多少条"） */
  kindExemptedCount: number;
  /** 挂在无 `path` 节点上的判据条数（投影口径外，但必须可见） */
  kindNoPathCount: number;
  /** 「judge 判过」列不可算时的原因（空串 = 读数可用）—— 读不到 ≠ 0 条判过 */
  kindJudgedNote: string;
}

/**
 * ★★★ **结构检查 = 可以当门的那一半**（门：`scripts/gen-db-check.mjs`）。
 *
 * ## 为什么它与 `check=true` 不是同一件事（★ 别合并）
 * `genDesignDb({check:true})` 比的是**整份字节**，其中 `symbols` / `imports` / `calls` 来自
 * `cache.db` —— 而 `cache.db` **不入库**（实测：`git ls-files .agent-io` 只有 2 份 DSL）。
 * ⇒ 把它当门 = 换一种假门：**同一次提交，在不同机器/不同索引版本上红绿不同**。
 *
 * 本函数只比**设计侧可复现**的三样（全部只依赖入库的 `design/*.dsl.json`）：
 * ① `//source` 是否列出**全部**持有者；② `requirements` 是否等于设计判据的并集；
 * ③ `requirements_calls` 的**调用方与条数**是否与设计一致（`to` 要 cache.db，不比）。
 * 外加 ④ 缺副本 / ⑤ 多余副本 / ⑥ 真冲突 / ⑦ **归属重复**（{@link DesignDbOwnershipConflict}）。
 *
 * ★★ 真冲突与归属重复是**两件事**，两条都要留：前者是两册对同一文件的要求**互斥**（只能改要求），
 *   后者是两册**都断言**同一文件（只能把断言搬到一个册）。合成一个计数就是「红着，但没人知道该动哪儿」。
 *
 * ## 它挡的是哪一类事故（这不是"普查"）
 * 「设计加了 `call-exists` 但没重跑 gen-db」⇒ design-db 里的 `requirements_calls` 是**旧的**，
 * 而 `scripts/contract-calls.mjs`（契约门）读的正是它 ⇒ **契约门在拿旧要求判新的代码**，静默撒谎。
 */
/**
 * ★★★ 2026-11-04（A4 · Placeholder as Data）：**职责占位**是结构问题，所以归结构门管。
 *
 * ## 它挡的事故（实测，不是假想）
 * 928 条非空 responsibility 里 **29 条等于自己的 basename/path**、**802 条是扫描器统计文案**
 * ⇒ 全被算进"responsibility 100% 已填"。这两个数都**不是职责**：一个是文件名回显，一个是
 * 可从 `cache.db` 用同一公式重算的派生串。读端把它当"已填" ⇒ 假绿（AGENTS 0.12）。
 *
 * ## 为什么这条必须由**门**判，而不只是写端校验
 * `validateDSL` 只在 `edit_dsl` 写那一刻跑；而册是可以被**任何**改盘工具改到的（实测有人手工改册）
 * ⇒ 写端校验挡不住手改。这里有牙的形态 = 手工把一条 responsibility 改成文件名 ⇒ `npm run verify`
 * 的「设计 DB 结构」门**当场红**（判据只在 `responsibilityVerdict` 一处）。
 *
 * ## 读数带分母（0.12 第 3 条）
 * 每册印「职责占位 N / 受检 T」——只印 N 读不出"是不是全扫了"。
 */
function responsibilityPlaceholderProblems(
  sheets: readonly (DesignSheetLike & { feature: string })[],
): string[] {
  const out: string[] = [];
  for (const s of sheets) {
    const files = s.semantic?.files ?? [];
    const bad: string[] = [];
    for (const f of files) {
      const p = norm(f.path);
      const verdict = responsibilityVerdict(p, f.responsibility);
      if (verdict === 'filename' || verdict === 'statistical') bad.push(`${p}（${verdict}）`);
    }
    if (!bad.length) continue;
    const shown = bad.slice(0, 8).join('；');
    out.push(
      `职责占位 ${bad.length} / 受检 ${files.length}（${s.feature}）：${shown}` +
        `${bad.length > 8 ? ` …另 ${bad.length - 8} 条` : ''}` +
        ` —— responsibility 是**意图层**：文件名回显与扫描统计文案都不算"已填"；` +
        `写 \`''\` = 诚实的"没有"（判据 = \`domain/semantic.ts#responsibilityVerdict\`）`,
    );
  }
  return out;
}

export function checkDesignDbStructure(
  root: string,
  opts: { kindProjections?: Record<string, KindProjection> } = {},
): DesignDbStructureResult {
  const OUT_DIR = designDbDir(root);
  const r: DesignDbStructureResult = {
    paths: 0,
    files: 0,
    missing: [],
    stale: [],
    extra: [],
    conflicts: [],
    ownership: [],
    assertedPaths: 0,
    problems: [],
    kindCoverage: [],
    kindProjectionGaps: [],
    kindExemptedCount: 0,
    kindNoPathCount: 0,
    kindJudgedNote: '',
  };
  const plan = planDesignDb(root);
  r.paths = plan.items.size;
  r.files = plan.nodes;
  if (plan.missingDir) {
    r.problems.push(`找不到 ${path.join(root, '.agent-io', 'design')}`);
    return r;
  }
  r.conflicts = plan.conflicts.map(renderConflict);
  r.ownership = plan.ownership.map(renderOwnership);
  r.assertedPaths = plan.assertedPaths;
  // ★★★ 2026-11-04（A4）：**职责占位**（文件名回显 / 扫描统计文案）—— 计入 problems ⇒ 本门红
  r.problems.push(...responsibilityPlaceholderProblems(loadDesignSheetsForGate(root).sheets));
  // ★★ M1a ⑧：**判据 kind → 投影去向**的诚实读数 + 会红的那一档。
  //   与 ①~⑦ 同一道门（不新开一道门）：声明表 ① + 载体可达 ② 一起判，声明不投影的按载体豁免且条数可见。
  const cov = expectationKindCoverage(root, { projections: opts.kindProjections });
  r.kindCoverage = cov.rows;
  r.kindProjectionGaps = [...cov.gaps, ...symbolColumnMapGaps()];
  r.kindExemptedCount = cov.exemptedExpectations;
  r.kindNoPathCount = cov.noPathExpectations;
  r.kindJudgedNote = cov.judgedNote;

  for (const item of plan.items.values()) {
    const name = outNameOf(item.path);
    const outPath = path.join(OUT_DIR, name);
    if (!fs.existsSync(outPath)) {
      r.missing.push(`${name}: 没有这份投影（设计里有 ${item.path}）`);
      continue;
    }
    let disk: Record<string, unknown>;
    try {
      disk = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      r.problems.push(`${name}: 读不出 JSON（${(e as Error)?.message ?? String(e)}）`);
      continue;
    }
    const why: string[] = [];
    if (norm(disk['//source']) !== item.sources.join(', ')) {
      why.push(`//source 写的是 ${JSON.stringify(disk['//source'])}，设计里的持有者是 ${JSON.stringify(item.sources.join(', '))}`);
    }
    if (JSON.stringify(disk.requirements ?? []) !== JSON.stringify(requirementsOf(item))) {
      why.push('requirements 与设计的判据不一致');
    }
    const wantFrom = requirementCallsOf(item).map((x) => x.from);
    const gotFrom = ((disk.requirements_calls ?? []) as Array<{ from?: string }>).map((x) => norm(x.from));
    if (JSON.stringify(gotFrom) !== JSON.stringify(wantFrom)) {
      why.push(`requirements_calls 的调用方 ${JSON.stringify(gotFrom)} 与设计的 ${JSON.stringify(wantFrom)} 不一致`);
    }
    if (why.length) r.stale.push(`${name}: ${why.join('；')}（该重跑生成器）`);
  }

  const expected = new Set([...plan.items.keys()].map(outNameOf));
  if (fs.existsSync(OUT_DIR)) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      // ★ T-#PERF-MEMO：汇总不是副本（`<x>.calls.json` 才是）⇒ 不进 `extra`
      if (name === DESIGN_DB_INDEX_NAME) continue;
      if (!expected.has(name)) r.extra.push(`${name}: 设计里没有对应的节点（陈旧副本，该重跑生成器清理）`);
    }
  }
  return r;
}


// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-03（M1a）：判据 kind → 投影去向的**诚实读数**，与那一道**会红的门**
// ════════════════════════════════════════════════════════════════════

/** 一个 kind 的投影账：**册侧 / 可投影 / 落地** 三个数必须同时在场（0.12 第 3 条：只给分子等于没验） */
export interface KindCoverageRow {
  kind: string;
  /** 册侧条数：全部册、全部判据（含被 `excluded` 挡住的、含挂在无 `path` 节点上的）—— **最大分母** */
  sheet: number;
  /** 可投影条数：按路径归并去重 + 在册管辖范围内（= `planDesignDb` 的判据并集条数，与生成器同一份口径） */
  projectable: number;
  /** 落地条数：design-db 里该 kind **声明键**上的条目数（各键取最大值，口径见 {@link landedByKind}） */
  landed: number;
  /**
   * ★ 载体可达条数：这个 kind 的**载体真能拿到**多少条 —— 口径 = `collectExpectations`（judge 的收集器，
   * 唯一实现住 `domain/expectation.ts`），与 DB 落地取**最大值**（两条载体任一能拿到即算通）。
   * ⇒ 「声明 → 可达」两个数字并列，豁免才可追溯（否则又是一条写在纸上没人执行的纪律）。
   */
  reach: number;
  /**
   * ★ 2026-11-03（M1a ③-2）：**judge 真判过的条数**（该 kind 的 `pass + fail`，来自判定闸落的
   * `judge-readings.json`）。`null` = 读数缺失 / 陈旧 ⇒ **不可算**（不是 0 —— 0 的含义是
   * "收进来了却一条都没判出结论"，那才是真故障）。
   */
  judged: number | null;
  /** 落地率的文本（唯一产出点 = `rateOf`，问题 = `expectation-kind-landed`） */
  rate: string;
  /** 声明去向：`keys`=承诺投影 / `exempt`=已声明不投影（带 carrier）/ `undeclared`=没表态（沉默） */
  declared: 'keys' | 'exempt' | 'undeclared';
  /** 声明了 `keys` 时是哪几个键 */
  keys?: readonly string[];
  /** 声明不投影时它住在哪（原样带出，供人核豁免） */
  carrier?: string;
}

/** `expectationKindCoverage` 的读数（表 + 三个分母 + 会红的那一档） */
export interface KindProjectionCoverage {
  rows: KindCoverageRow[];
  sheetTotal: number;
  projectableTotal: number;
  landedTotal: number;
  /** 已声明不投影的**判据条数**（按册侧计 —— 不是 kind 数：读的人要知道"少看了多少条"） */
  exemptedExpectations: number;
  /** 挂在无 `path` 节点上的判据条数（投影口径外，但必须可见：实测 57 条全是 `domain-independent`） */
  noPathExpectations: number;
  /** 「judge 判过」列不可算时的原因（空串 = 读数可用）；缺失 / 陈旧都必须说出来（0.12） */
  judgedNote: string;
  /** ★ 会红的那一档（判据见 {@link expectationKindCoverage}） */
  gaps: string[];
}

/**
 * design-db 里每个 kind 的**落地条数**（读盘，**不读 `cache.db`** ⇒ 这道门仍可复现）。
 *
 * ## 计数口径（唯一的、写下来的 —— 不写就成了"看数猜口径"）
 * 对该 kind 声明的**每个键**：取该键上的数组，条目带 `kind` 字段就按它筛（`requirements` 就是），
 * 不带 `kind` 字段则整套算该 kind（`requirements_calls` 就是）；各键之间取**最大值** —— 同一份判据常有两条键
 * （给机器读的 + 给人读的），相加会把一份判据数成两份。
 *
 * ★ 这个口径是**读数**，不是校验：M1b 给新 kind 定键时，若某个键里混装多个 kind 又都不带 `kind` 字段，
 *   本读数会偏高 ⇒ 那时必须在该键的条目里带 `kind`，**别让口径去猜**。
 */
function landedByKind(root: string, decl: Record<string, KindProjection>): Map<string, number> {
  const out = new Map<string, number>();
  const dir = designDbDir(root);
  if (!fs.existsSync(dir)) return out;
  const perKey = new Map<string, number>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.calls.json')) continue;
    let disk: Record<string, unknown>;
    try {
      disk = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Record<string, unknown>;
    } catch {
      continue; // 读不出 JSON 的副本由 checkDesignDbStructure 报 problems（这里既不数它、也不静默当成落地 0）
    }
    for (const [kind, d] of Object.entries(decl)) {
      for (const key of d.keys ?? []) {
        const arr = disk[key];
        if (!Array.isArray(arr)) continue;
        const n = arr.filter((x) => {
          const k = x && typeof x === 'object' ? (x as { kind?: unknown }).kind : undefined;
          return k === undefined ? true : k === kind;
        }).length;
        const id = `${kind}\u0000${key}`;
        perKey.set(id, (perKey.get(id) ?? 0) + n);
      }
    }
  }
  for (const [id, n] of perKey) {
    const kind = id.split('\u0000')[0];
    out.set(kind, Math.max(out.get(kind) ?? 0, n));
  }
  return out;
}

/**
 * 每个 kind 的**载体可达条数**：judge 真会收到多少条。
 *
 * ★ 口径**不在这里定义**：直接调 `domain/expectation.ts#collectExpectations`（`design_line action=judge`
 *   与它同一个收集器 —— 跳过 `intent='retired'` 的节点）。本函数只按 kind 计数，不另写"哪些判据会被跑"。
 */
function reachableByKind(sheets: readonly DesignSheetLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sheets) {
    for (const it of collectExpectations(s as unknown as DesignDSL)) {
      const k = String(it.expectation?.kind ?? '');
      if (!k) continue;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * 判定闸落的 **per-kind 读数**（`scripts/judge-all.mjs` 每次跑完覆盖写 `<root>/.agent-io/judge-readings.json`）。
 *
 * ★ 为什么不在这里跑 judge：判定要几十秒且要 `cache.db`，而本门只读入库文件（`design/*.dsl.json` + `design-db/`）
 *   —— 让它跑 judge 就破坏「同一份提交在哪台机器上都一样」这条可复现性。谁跑过 judge，谁负责留读数。
 */
export interface JudgeReadings {
  /** 读数时间戳（ISO）；与册的最近改动时间比，旧了就是陈旧 */
  at?: string;
  /** 读数是否比册旧（由 {@link readJudgeReadings} 现算，不是文件里的字段） */
  stale?: boolean;
  by_kind?: Record<string, { pass?: number; fail?: number; unsupported?: number; pending?: number; checked?: number; judged?: number }>;
}

/**
 * 读 `<root>/.agent-io/judge-readings.json`；**读不到 / 读不出 ⇒ `null`**（调用方据此说"不可算"，不回落成 0）。
 * ★ 陈旧判定放在这里（与读同一处，避免第二条 "什么时候算旧" 的口径）：读数 `at` 早于册的最新 mtime ⇒ `stale=true`。
 */
export function readJudgeReadings(root: string): JudgeReadings | null {
  const p = path.join(root, '.agent-io', 'judge-readings.json');
  let raw: JudgeReadings;
  try {
    if (!fs.existsSync(p)) return null;
    raw = JSON.parse(fs.readFileSync(p, 'utf8')) as JudgeReadings;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || !raw.by_kind) return null;
  // 册的最新改动时间（只比本仓 design 目录下的 *.dsl.json —— 与门同一批文件）
  const designDir = path.join(root, '.agent-io', 'design');
  let newest = 0;
  try {
    for (const f of fs.readdirSync(designDir)) {
      if (!f.endsWith('.dsl.json')) continue;
      const m = fs.statSync(path.join(designDir, f)).mtimeMs;
      if (m > newest) newest = m;
    }
  } catch {
    newest = 0; // 册目录都读不到 ⇒ 不做陈旧判定（上层另有 missingDir 的读数）
  }
  const at = Date.parse(String(raw.at ?? ''));
  const stale = Number.isFinite(at) && newest > 0 ? at + 1000 < newest : false;
  return { ...raw, stale };
}

/**
 * ★★★ **判据 kind → 投影去向的诚实读数**（门：`scripts/gen-db-check.mjs` 的子项 ⑧）。
 *
 * ## 它替掉的那句假话（2026-11-03 实测）
 * `gen-db-check` 原来在末尾打印「设计与投影一致：每条判据都在 design-db 里」。实测：
 * 册侧 **564** 条 → 可投影 **476** 条 → design-db 只落 **111** 条（全是 `call-exists`）⇒ 那句话对 **365** 条是假话。
 * 它恒绿的原因是**两边调同一个函数**：`checkDesignDbStructure` 拿 `requirementsOf(item)` 比盘上的 `requirements`，
 * 而盘上那份正是 `requirementsOf` 写的 ⇒ 恒等（旧判据）。
 *
 * ## 判据三条（哪一条会红，写清）
 * ① **声明完整性**：注册表里每个 kind 都要在 `EXPECTATION_KIND_PROJECTION` 里表态，`keys` / `why_not_projected`
 *    二选一，不投影必须带 `carrier`（`projectionDeclarationGaps()` 现算；加 kind 忘表态 ⇒ 当场红）；
 * ② **载体可达性**（核心）：`reach = max(DB 落地, judge 收集)` —— **`reach === 0` 就是"声明了载体却到不了"** ⇒ 红。
 *    · `keys` 类：DB 落地 < 可投影（含 0）也红（声明与投影脱节 / 部分丢失）；
 *    · `why` 类：载体是 judge 现算，所以 `reach` 为 0 只可能是**收集器整批跳过了它**
 *      （如节点 `intent='retired'`），报文会点到具体原因；
 * ③ **声明 `why_not_projected` 的按载体豁免**：不进 `gaps`，但其**判据条数**记进 `exemptedExpectations` 并印出来
 *    ⇒ 「已声明不投影」是**可追溯的等价豁免**，不是删掉不管（M1b 把声明改成 `keys` 后自动开始计入）。
 *
 * ★ 分母三列都印（册侧 / 可投影 / 落地）+ 可达一列：只给"落地 111"看不出少了 365，只给率看不出分母。
 * ★ `opts.projections` 是**消融入口**（传 `{}` ⇒ 现状必须红）：用例 `tests/p0_kind_projection.test.ts` 靠它证明这道门有牙。
 */
export function expectationKindCoverage(
  root: string,
  opts: { projections?: Record<string, KindProjection>; judgeReadings?: JudgeReadings | null } = {},
): KindProjectionCoverage {
  const decl = opts.projections ?? EXPECTATION_KIND_PROJECTION;

  // ① 册侧（最大分母）：全部册、全部判据 —— 不经 `excluded` 过滤，也不要求节点有 path
  const sheets = loadDesignSheetsForGate(root).sheets;
  const sheet = new Map<string, number>();
  let noPath = 0;
  for (const s of sheets) {
    for (const n of s.geometry?.nodes ?? []) {
      const hasPath = !!norm((n as { path?: string }).path);
      for (const e of n.decision?.expectations ?? []) {
        const k = String(e.kind ?? '');
        if (!k) continue; // 没有 kind 的判据 validateDSL 会拒；这里不替它挑一个 kind
        sheet.set(k, (sheet.get(k) ?? 0) + 1);
        if (!hasPath) noPath += 1;
      }
    }
  }

  // ② 可投影：吃**生成器那一份**归并计划（不另写一套过滤 —— 否则读数与产物各数一遍）
  const projectable = new Map<string, number>();
  for (const item of planDesignDb(root).items.values()) {
    for (const e of item.expectations) {
      const k = String(e.kind ?? '');
      if (!k) continue;
      projectable.set(k, (projectable.get(k) ?? 0) + 1);
    }
  }

  // ③ 落地（读 design-db 盘上产物）+ 可达（读 judge 的收集器）
  const dbReadable = fs.existsSync(designDbDir(root));
  const landed = landedByKind(root, decl);
  const reachable = reachableByKind(sheets);

  // ④ judge **真判过**多少条：读判定闸落的 per-kind 读数（**不跑 judge** —— 那是 `judge-all` 的事）。
  //   缺失 / 陈旧 ⇒ 明确「不可算」（0.12：读不到 ≠ 0 条判过），且这一列不参与判红（避免假红）。
  const readings = opts.judgeReadings !== undefined ? opts.judgeReadings : readJudgeReadings(root);
  const judgedByKind = new Map<string, number>();
  let judgedNote = '';
  if (!readings) {
    judgedNote =
      '判定闸没有留下可用的 per-kind 读数（.agent-io/judge-readings.json 缺失 / 读不出）⇒「judge 判过」不可算 —— 先跑 node scripts/judge-all.mjs';
  } else if (readings.stale) {
    judgedNote =
      `判定闸的读数比册旧（读数 at=${String(readings.at ?? '无时间戳')}，册更晚有改动）⇒「judge 判过」不可算 —— 先重跑 node scripts/judge-all.mjs`;
  } else {
    for (const [k, v] of Object.entries(readings.by_kind ?? {})) judgedByKind.set(k, Number((v as { judged?: number }).judged ?? 0));
  }
  const judgedKnown = judgedNote === '';

  // ★ 声明表完整性**按注入的那张表**判（`opts.projections` 是消融入口：传 `{}` ⇒ 每个 kind 都必须点名）
  const gaps: string[] = [...projectionDeclarationGaps(decl)];
  if (!dbReadable) {
    gaps.push('design-db/ 目录不存在 ⇒ 判据落地数**不可算**（0.12：读不到 ≠ 落地 0）—— 先跑 design_line action=gen-db');
  }

  const rows: KindCoverageRow[] = [];
  // 注册表 ∪ 声明表 ∪ 册里真出现的 kind（三者的差集本身就是读数：多出来的会以 undeclared 现形）
  const kinds = [...new Set([...EXPECTATION_KINDS, ...Object.keys(decl), ...sheet.keys()])].sort();
  let sheetTotal = 0;
  let projectableTotal = 0;
  let landedTotal = 0;
  let exempted = 0;
  for (const kind of kinds) {
    const d = decl[kind];
    const sN = sheet.get(kind) ?? 0;
    const pN = projectable.get(kind) ?? 0;
    const lN = landed.get(kind) ?? 0;
    const rN = Math.max(lN, reachable.get(kind) ?? 0);
    sheetTotal += sN;
    projectableTotal += pN;
    landedTotal += lN;
    const declared: KindCoverageRow['declared'] = !d ? 'undeclared' : (d.keys ?? []).length ? 'keys' : 'exempt';
    if (declared === 'exempt') exempted += sN;

    // 落地率只有一个产出点（`rateOf`）。分子 > 分母时它自己会抛 ⇒ 这里给**可见诊断**，不静默回 0
    let rate: string;
    if (lN > pN) {
      rate = `落地 ${lN} > 可投影 ${pN} ⇒ 计数口径错（该键是否混装了别的 kind？见 landedByKind 的口径）`;
      gaps.push(`kind ${kind} 的落地数 ${lN} 超过可投影数 ${pN} ⇒ 要么计数口径错、要么生成器把一条判据算成了两条`);
    } else {
      rate = rateOf({ n: lN, d: pN, question: 'expectation-kind-landed' }).text;
    }

    rows.push({
      kind,
      sheet: sN,
      projectable: pN,
      landed: lN,
      reach: rN,
      // ★ 判过 = 真出结论（pass+fail）；读数不可算时是 null（不是 0）
      judged: judgedKnown ? (judgedByKind.get(kind) ?? 0) : null,
      rate,
      declared,
      ...(d?.keys ? { keys: d.keys } : {}),
      ...(d?.carrier ? { carrier: d.carrier } : {}),
    });

    if (declared === 'undeclared') continue; // 由 projectionDeclarationGaps() 统一点名（别两处各报一次）

    // ★ 会红的第一档：声明了 keys ⇒ 必须真落地（0 落地 / 落地不满都红）
    if (declared === 'keys' && dbReadable) {
      const keys = JSON.stringify(d!.keys);
      if (lN === 0 && pN > 0) {
        gaps.push(`kind ${kind} 声明了投影键 ${keys} 却 **0 条落地**（可投影 ${pN} 条）⇒ 声明与投影脱节`);
      } else if (lN < pN) {
        gaps.push(`kind ${kind} 声明了投影键 ${keys} 但只落地 ${lN}/${pN} 条（少 ${pN - lN} 条）`);
      }
    }

    // ★ 会红的第二档（核心，M1a ③-2）：该 kind 被 judge **收进来**了，却**一条都没判出结论**
    //   （`judged` = pass + fail = 0；`pending` / `unsupported` 都不算结论）⇒ 载体跑不动，这才是真故障。
    //   ★ 为什么不用「收集条数」（reach）：`collectExpectations` 对**每个** kind 都收 ⇒ 那一列永不为 0
    //     ⇒ 门永远不红（0.16 的镜像：不是永远亮，是**永远不亮**）。判「判过」才有牙。
    //   ★ 读数缺失 / 陈旧时**不判红**（那是"不可算"，`judgedNote` 会说出来）—— 不许拿假红冒充有牙。
    if (judgedKnown && sN > 0 && (judgedByKind.get(kind) ?? 0) === 0) {
      const carrier = d?.carrier ? '（声明的载体：' + d.carrier + '）' : '';
      gaps.push(
        'kind ' + kind + ' 声明了载体' + carrier + '，但 judge **一条都没判出结论**（judged = pass+fail = 0，册侧 ' +
          sN +
          ' 条）⇒ 载体跑不动：要么这些判据全 pending（blocked_by 声明卡住）、要么全 unsupported（判不了 ≠ 通过）' +
          (d?.keys ? '；DB 落地 ' + lN + ' 条' : '') +
          '。★ 定位：node scripts/judge-all.mjs 的 by_kind.' + kind + ' 看 unsupported / pending 各几条',
      );
    }
  }

  return {
    rows,
    sheetTotal,
    projectableTotal,
    landedTotal,
    exemptedExpectations: exempted,
    noPathExpectations: noPath,
    judgedNote,
    gaps,
  };
}

/**
 * ★ 2026-11-03（M1a ④）：`SYMBOL_COLUMN_MAP` 的纪律「**每一列要么被投影、要么显式声明不投影（why）**」
 * 以前**没有执行者**（`design_db_projection.ts` 的头注释写着"新证 `t378` 拿这张表当判据"，而 `certs/`
 * 与 `t378` **都不存在**）⇒ 表格自己怎么写都行。这里补上能补的那一半。
 *
 * ## 边界（如实说，别当成全了）
 * 本函数只判**表自身**：每列 `key` / `why` 二选一、`why` 不许空串、投影键不许重复、不许空表。
 * **列注册表 ↔ `nodes` 实际列（`PRAGMA table_info`）那一条没有在这里判** —— 本门只读入库文件
 * （`design/*.dsl.json` + `design-db/`），`cache.db`/`design-db` 都不入库 ⇒ 在这里读 `cache.db` 会让同一份提交
 * 在不同机器上红绿不同（另一种假门）。那半条挂 **M2**（`docs/todo.md` §A M2「册仓同构」）。
 */
export function symbolColumnMapGaps(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const d of SYMBOL_COLUMN_MAP) {
    const hasKey = typeof d.key === 'string' && d.key !== '';
    const hasWhy = typeof d.why === 'string' && d.why.trim() !== '';
    if (hasKey && hasWhy) out.push(`列 ${d.column} 同时给了 key 与 why ⇒ 二选一（两条都写 = 没说清投不投）`);
    if (!hasKey && !hasWhy) out.push(`列 ${d.column} 既没投影也没写 why ⇒ 沉默（SYMBOL_COLUMN_MAP 的判据：不许有第三种）`);
    if (d.key) {
      if (seen.has(d.key)) out.push(`投影键 ${d.key} 重复（第二处出现在列 ${d.column}）⇒ 两个列争一个键`);
      seen.add(d.key);
    }
  }
  if (SYMBOL_COLUMN_MAP.length === 0) {
    out.push('SYMBOL_COLUMN_MAP 是空表 ⇒ 设计侧 symbols[] 没有任何一列有交代（空表不许当"全合规"）');
  }
  return out;
}
