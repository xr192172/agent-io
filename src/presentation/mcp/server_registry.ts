/**
 * server_registry：MCP 工具注册表（路线图序号 2 收敛）
 *
 * 只注册主工具（2026-08-17 起旧工具名别名已全部移除，无兼容层）。
 *
 * 设计：
 * - 每个工具定义 = { name, title, description, inputSchema, handler }
 * - handler(args) 返回 MCP content 数组（text + isError）
 * - 主工具走强 schema；explore_code/manage_feature 用宽松 record，内部强校验
 *
 * 主工具 handler 复用现有纯函数（src/tools/*.ts），不重写业务逻辑，因此
 * 500+ 单测（针对纯函数）不受影响。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureProjectIndex, detectStaleIndex } from '../../infrastructure/index/index_freshness.js';
import { hasLiveIndex } from '../../application/write_gate.js';
import { scheduleBackfill, backfillState, isIndexIncomplete } from '../../infrastructure/index/index_backfill.js';
import { unknownArgHints, renderArgHints } from '../../infrastructure/text/arg_suggest.js';
import { collectPendingAlertText, dispatchDslEdit } from '../../application/dispatch.js';
// ★★ 2026-10-06：「下一棒」提示 —— 链的接法（`CHAIN_EDGES`）+ 机器段标记（**单点**，别硬编码）
import { renderNextHops, nextHopsOf } from '../../domain/chain_wiring.js';
import { DATA_MARKER } from '../../application/plumbing.js';
// ★★ 2026-10-06：「面」—— 目录口径（`catalogOf`，单点）+ 面的机算（`facesOf`）+ 各线 direct 白名单
import { catalogOf, LANE_META } from '../../application/meta/registry/capability_map.js';
import { facesOf } from '../../application/meta/registry/tool_faces.js';

// （`tools/stale_check` 的导入已随 P-F 删除：本文件不再直接消费它 —— 三个 stale 告警各自
//   探测，`stale_check.formatStaleText` 仍由 lanes/observe.ts 的 `run_tests` 前置提示使用。）
import { getProjectCacheDb } from '../../infrastructure/index/db.js';
import { recordDogfoodUsage } from '../../infrastructure/dogfood_stats.js';
import { prewarmKernel } from '../../infrastructure/parse/index.js';

/**
 * ★★ 2026-10-08 补：**把注释承诺的「进程启动预热」真的接上**。
 *
 * 实测：`prewarmKernel(` 在 `src/` 下**一个调用点都没有**（只在 `kernel.ts` 被定义），
 * 而 `write_gate` / `symbols` / `scaffold` / `remove_dead_imports` 的注释**都**在说
 * 「进程启动 `prewarmKernel()` 预热后，同步工具可走同步路径」——**那句承诺是空的**
 * （与 G4 同形：文档说做了，实际没做）。
 *
 * 后果：`parseFileFullSync` 恒返回 `解析器未预热`、`canParseFileSync` 恒 false ⇒
 * **同步解析路径从来没通过** ⇒ 同步工具只能退化（这也是仓里到处是文本回退的根因之一）。
 *
 * 放在**唯一调用入口**（MCP 与 CLI 逐字同路径）⇒ 一处覆盖两面；
 * `prewarmStarted` 保证只起一次；`void` ⇒ **不阻塞本次调用**。
 */
let prewarmPromise: Promise<void> | null = null;

/**
 * ★★ 2026-10-08 **修正**：预热必须**可等待**，不能 fire-and-forget。
 *
 * 为什么（实测回归）：原版是 `void prewarmKernel()...`（不阻塞本次调用）——
 * 但 **CLI 每次调用都是「第一次调用」**（一次进程一个工具调用）⇒ 处理器执行时预 warm
 * 还没完成 ⇒ `getParserSync` 仍为 null ⇒ **依赖同步 AST 的路径全部拿不到事实**。
 * 后果实测：`dead_imports` 的删除侧（②-c 刚换成共享绑定事实）**一个 import 都不删了，且不报错**
 * —— 又一个「不报错的错」（静默少删）。
 *
 * 所以：**首次调用等它一次**（此后所有调用都命中缓存的 Promise）。
 * 代价：本进程第一次工具调用慢一点（一次性）；收益：同步 AST 路径**真的**可用。
 * ★ 失败也**不吞**（落 stderr）—— 但那会让依赖它的路径退回保守（少删），方向是安全的。
 */
function ensureKernelPrewarmed(): Promise<void> {
  if (!prewarmPromise) {
    prewarmPromise = prewarmKernel()
      .then((r) =>
        console.error(
          `[ts_kernel] prewarm: ${r.warmed} 个解析器就绪${r.missing.length ? `（缺 ${r.missing.length} 个语言包）` : ''}`,
        ),
      )
      .catch((e) => console.error(`[ts_kernel] prewarm 失败：${e instanceof Error ? e.message : String(e)}`));
  }
  return prewarmPromise;
}
import path from 'node:path';
import { statSync, readFileSync, writeFileSync, readdirSync, existsSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ─────────────────────────────────────────────────────────────
// 陈旧进程检测（版本握手）
// ─────────────────────────────────────────────────────────────

/**
 * 狗食缺陷修复：MCP 进程长驻，dist 重建后进程仍运行旧代码，AI 侧表现为
 * "工具缺失/参数报错却不知原因"（2026-08-18 decisions 查询缺失事件）。
 *
 * 机制：进程加载时记录本文件（dist/server_registry.js）的 mtime；
 * 每次工具调用轻量 stat 比对，dist 更新后在所有返回（含错误）尾部追加
 * 重启警告。警告由 registerAllTools 统一注入（唯一出口，覆盖全部工具；
 * wrap/wrapData 不再各自追加）。开销 = 每调用一次 stat，可忽略。
 *
 * ★ P-F（§16.6）：注入出去的**不是字符串**而是结构化告警（`ToolWarning`），
 *   由 `emitWarnings`（registry/tool_warnings.ts）负责①首次全文/后续一行摘要 ②追加
 *   `---WARNINGS---` 机器块。本文件的三个生产方只负责"判出来"。
 */
const SELF_PATH = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null; // 异常环境（理论不可达）——禁用检测
  }
})();
const SELF_MTIME_MS: number | null = SELF_PATH ? safeMtimeMs(SELF_PATH) : null;

function safeMtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 陈旧构建判定（纯函数，可单测）：加载时的 mtime 早于当前 mtime → 进程仍跑旧代码。
 * 任何一侧未知（非编译产物环境）→ `null`，静默禁用。
 *
 * ★ P-F（§16.6）：产物是**结构化告警**（不是 message）—— 分级呈现（首次全文/后续摘要）与
 *   机器通道由 `emitWarnings` 统一负责，本函数只管"判出来"。
 */
export function staleBuildWarningFor(loadedMtimeMs: number | null, curMtimeMs: number | null): ToolWarning | null {
  if (loadedMtimeMs === null || curMtimeMs === null) return null;
  if (curMtimeMs <= loadedMtimeMs) return null;
  return {
    code: 'STALE_BUILD',
    summary: 'dist 已在本进程启动后重建 ⇒ 当前响应来自旧代码（新增工具/字段/参数可能缺失或报"未知"错误）',
    detail: '本进程加载的是重建**之前**的编译产物：进程启动时记录 dist/server_registry.js 的 mtime，之后每次调用比对发现它已被更新。',
    fix: '重启 agent-io MCP server 后再执行写操作',
  };
}

/** dist 已更新（进程仍在跑旧代码）⇒ 告警；否则 null。 */
function staleBuildWarning(): ToolWarning | null {
  return staleBuildWarningFor(SELF_MTIME_MS, SELF_PATH ? safeMtimeMs(SELF_PATH) : null);
}

// ───── STALE SOURCE：改了 src 却忘了 build 的检测 ─────
// 补齐 staleBuildWarning 覆盖不到的缺口——它只在 dist 被重建后(un进程仍旧)提示，
// 若用户改了 src 但没 build，dist mtime 不变则完全无感。此处检测「src 比 dist 新」。
const PACKAGE_ROOT = SELF_PATH ? path.resolve(path.dirname(SELF_PATH), '..', '..') : null;
const SRC_DIR = PACKAGE_ROOT ? path.join(PACKAGE_ROOT, 'src') : null;
const DIST_DIR = PACKAGE_ROOT ? path.join(PACKAGE_ROOT, 'dist') : null;

/** 递归取目录内最新文件 mtime（跳过 node_modules；skipGen 时忽略 *.gen.ts 生成物，避免 build 自己造成误判） */
export function newestMtime(dir: string | null, skipGen: boolean): number | null {
  if (!dir) return null;
  let max: number | null = null;
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const d = stack.pop()!;
    let ents: Dirent[];
    try {
      ents = readdirSync(d, { withFileTypes: true });
    } catch {
      continue; // 目录不存在/无权限 → 视为可跳过
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules') stack.push(p);
      } else if (e.isFile()) {
        if (skipGen && e.name.endsWith('.gen.ts')) continue;
        const m = safeMtimeMs(p);
        if (m !== null && (max === null || m > max)) max = m;
      }
    }
  }
  return max;
}

let _srcMaxCache: { at: number; v: number | null } | null = null;
/** src 树最新 mtime，5s 缓存避免每次工具调用递归扫全树。 */
function cachedSrcMtime(): number | null {
  const now = Date.now();
  if (_srcMaxCache && now - _srcMaxCache.at < 5000) return _srcMaxCache.v;
  const v = newestMtime(SRC_DIR, true);
  _srcMaxCache = { at: now, v };
  return v;
}

/**
 * src 树最新 mtime 晚于 dist 树最新 mtime ⇒ 结构化告警；任一未知 / 不新 ⇒ `null`。
 * 纯函数（两个 mtime 进来），与 `staleBuildWarningFor` 对称 —— 导出**为了能被测试看见**。
 */
export function staleSourceWarningFor(srcMax: number | null, distMax: number | null): ToolWarning | null {
  if (srcMax === null || distMax === null) return null;
  if (srcMax <= distMax) return null;
  return {
    code: 'STALE_SOURCE',
    summary: '`src/` 比 `dist/` 新（疑似改了源码但未 `npm run build`）—— 当前工具跑的是旧编译产物',
    detail: 'dist 产物比源旧：工具的行为（新增字段/修好的 bug）不会体现在本进程里，直到重建。',
    fix: '`npm run build` 后重启 agent-io MCP server 生效',
  };
}

/**
 * src 比 dist 新（改了源码未 build）⇒ 结构化告警；否则 `null`。
 *
 * ★ P-F（§16.6）：原先的状态位 `_lastStaleState`（"转变时报一次、持续期静默"）**已删除** ——
 *   分级呈现（首次全文 / 后续一行摘要，且后续**不静默**）统一交给 `emitWarnings` 的进程内记账。
 *   删除的原因：那个状态位把"持续陈旧"变成**永久静默**（§2d：把"少做了什么"藏起来 ——
 *   后来加入的读者永远不知道图是旧的）。
 */
function staleSourceWarning(): ToolWarning | null {
  return staleSourceWarningFor(cachedSrcMtime(), newestMtime(DIST_DIR, false));
}

// ─────────────────────────────────────────────────────────────
// 通用索引陈旧告警（"不撒谎"不变量的**结构性兜底**）
//
// 为什么要有它：索引层的唯一不变量是「LLM 读到的内容要么与磁盘一致，要么**明确标注**可能旧」。
// 但"保鲜"此前靠**每个工具自己记得调** `ensureProjectIndex` —— 实测 60 个工具里有 **17 个**
// 直接开 cache.db 却没任何保鲜入口（`diff_impact`、`function_outline`、`overview`…），
// 其中 `diff_impact` 给的是**行动建议**，读旧图会直接导致改错。
//
// 与其逐个补（下次加工具还会漏），不如在**响应注入层**兜一次：跟 `staleSourceWarning` 同一套
// 做法（5s 探测缓存），一次覆盖全部工具。
// 它只 stat、不解析、不写库 —— 负责"标注"，不负责"修复"（修复让 LLM 去调 refresh:true）。
//
// ★ 诚实标注它的**边界**（别把它当成保证）：
//   ① 有 **5s 探测缓存**（与 `staleSourceWarning` 同一约定）⇒ 刚刚发生的改动最多 5s 内
//      可能还没被标注到；这是"标注"而非"闸门"，真正的保证在 L1a（写穿）与 L3（读前自证）。
//   ② 只比 `size` + `mtime`（毫秒取整）⇒ **等长改写落在同一毫秒**会漏判（见 detectStaleIndex 注释）。
//   ③ ★ P-F（§16.6）：不再"只在状态转变时报一次、持续期静默"（那会把"少做了什么"藏起来，§2d）
//      —— 改为**每轮都给**，但分级：首次全文 / 之后一行摘要。分级的状态位在
//      `registry/tool_warnings.ts` 的进程内记账里（键含本函数的 `scope` = 项目根）。
// ─────────────────────────────────────────────────────────────

const STALE_INDEX_TTL_MS = 5000;

let _staleIndexCache: { root: string; at: number; stale: number; total: number; sampled: boolean; selfWrites: number } | null = null;

/** 从工具入参里取项目根（各工具参数名不统一，两个都认） */
function projectRootArg(args: Record<string, unknown>): string | null {
  for (const k of ['project_dir', 'project_root', 'root', 'dir']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * 测试隔离用：清掉陈旧告警的**探测缓存**（5s TTL），让下一次调用重新 stat。
 * ★ 与 `resetWarningDelivery()`（清"已投递全文"的记账）**分开**：前者=模拟"过了 5s"，
 *   后者=模拟"新进程"。搅在一起就会让"首次全文/后续摘要"这条性质无法被观测。
 */
export function resetStaleIndexWarningCache(): void {
  _staleIndexCache = null;
}

/**
 * 索引是否落后于磁盘 → 结构化告警；无索引 / 无根 / 出错 → `null`（静默，不干扰主流程）。
 *
 * `scope` = 项目根：换项目各自算"首次全文"（分级键 `STALE_INDEX@<root>`）。
 * 导出是为了**能被测试看见** —— 这类"注入型"逻辑最容易静默失效（永远返回 null 也没人发现）。
 */
export function staleIndexWarning(rawRoot: string | null): ToolWarning | null {
  if (!rawRoot) return null;
  let root: string;
  try {
    root = path.resolve(rawRoot);
  } catch {
    return null;
  }
  try {
    if (!hasLiveIndex(root)) return null;
    const now = Date.now();
    if (!_staleIndexCache || _staleIndexCache.root !== root || now - _staleIndexCache.at >= STALE_INDEX_TTL_MS) {
      const db = getProjectCacheDb(root);
      const p = detectStaleIndex(db, root);
      _staleIndexCache = { root, at: now, stale: p.stale, total: p.total, sampled: p.sampled, selfWrites: p.selfWritesPending };
    }
    const c = _staleIndexCache;
    if (c.stale <= 0 && c.selfWrites <= 0) return null;
    const scope = c.sampled ? `抽样 ${c.total} 个已索引文件中的一段` : `全部 ${c.total} 个已索引文件`;
    return {
      code: 'STALE_INDEX',
      scope: root,
      summary: `符号索引落后于磁盘（${scope}里有 ${c.stale} 个已被改动${c.selfWrites ? `，另有 ${c.selfWrites} 个自写登记待同步` : ''}）—— 本次结果可能基于旧图`,
      detail:
        '`find_references` / `impact_analysis` 之类可能少报、或指向已改名的符号。' +
        '（探测口径：只比 size + mtime，5s 缓存；这是"标注"而非"闸门"。）',
      fix: '先调 `index_integrity({project_dir, refresh:true})` 保鲜（或直接用任一读工具触发保鲜）',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 首次接触 ⇒ 后台建索引（2026-09-15，用户拍板："白跑一轮索引对 LLM 是免费的"）
//
// 此前索引只能从"第一次读"开始建（explore_code 拼图 + 后台续建）——"工作区创建"
// 没有钩子，没接线。任何带 project_root 的工具调用都是对项目的**首次接触**：
// 在唯一入口顺手起后台续建（分小批、可中断、unref 定时器，**不阻塞本次调用**），
// 把建索引的起点从"第一次读"提前到"第一次任何调用"。对 LLM 免费：后台跑，
// 本次调用的耗时不受影响；需要索引的工具自身的冷启/拼图照旧优先。
//
// 纪律：
//   - `noAutoFresh` 的工具不触发（`index_integrity` refresh:false 必须纯只读，连库都不该建；
//     `import_project` 自己做全量导入）。
//   - 根必须是真实存在的目录（不给幻觉路径凭空造 `.agent-io`）。
//   - `AGENT_IO_AUTO_BACKFILL=0` 一键关（对齐 `AGENT_IO_AUTO_WATCH` 的 env 约定）。
//   - 起了之后**诚实标注**：索引在建 ⇒ 本轮结果可能不全 —— 这是"不撒谎"不变量的
//     "明确标注"那半边。`staleIndexWarning` 只覆盖"有索引但落后于磁盘"，
//     覆盖不了"索引还没建完"这种**空缺型不全**（查不到 ≠ 不存在），由本标注兜。
// ─────────────────────────────────────────────────────────────

/** 后台续建进行中 → 诚实标注"结果可能不全"（没在跑 → 空串） */
function backfillProgressNote(absRoot: string): string {
  const s = backfillState(absRoot);
  if (!s?.running) return '';
  const prog = s.total > 0 ? `${s.done}/${s.total}` : '刚启动';
  return (
    `\n[索引] 该项目还没有完整索引 —— 后台建索引进行中（${prog}）。` +
    '**本轮结果可能不全**（还没索引到的文件查不到 ≠ 不存在）；建完后自动精确，`index_integrity({project_dir})` 可查进度。'
  );
}

/**
 * 首次接触 ⇒ 起后台建索引；返回要注入响应的诚实标注（已有索引且没在建 → 空串）。
 * 导出是为了**能被测试看见** —— "顺手起后台"这类逻辑最容易静默失效（永远不起也没人发现）。
 */
export function firstContactBackfill(rawRoot: string | null): string {
  if (!rawRoot || process.env.AGENT_IO_AUTO_BACKFILL === '0') return '';
  try {
    const abs = path.resolve(rawRoot);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return ''; // 幻觉路径不建库
    if (hasLiveIndex(abs)) return backfillProgressNote(abs); // 已有索引：只承担"在建中标注"
    scheduleBackfill(abs, { batch: 20, intervalMs: 200 }); // 幂等单飞；首个批次在 +200ms 后台起
    return backfillProgressNote(abs);
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// 行动工具的可信度自动附注（§5-②，2026-09-15）
//
// 分工（别跟 staleIndexWarning 重复）：
//   - `staleIndexWarning`（全部工具）：索引**落后于磁盘**（not_fresh / 待消费自写登记）
//     —— 靠 stat 就能发现的那类旧。
//   - 本附注（只给"准备基于索引做改动/下结论"的工具）：**陈旧断言**（resolved 但目标符号
//     已不在索引）—— 索引**自己内部**不一致，文件内容没变 ⇒ 保鲜路径（L3①）看不见它，
//     唯一线索是这批行本身。它造成的是**静默漏报**：find_references / impact_analysis
//     "查到了但少了"，LLM 无从察觉 —— 对行动建议类工具是最危险的一种错。
//
// 为什么**不设缓存**：一次纯 SQL 计数（resolved 行 × nodes.name 反查），毫秒级；
// 且 rename_symbols 这类工具**自己会修**陈旧引用（写穿重开）—— 带缓存的附注会在
// 修完之后还报旧的数，那是附注自己在撒谎。宁可每次都查，也不要"过期的诚实"。
// ─────────────────────────────────────────────────────────────

/**
 * 行动工具的可信度附注：陈旧断言 > 0 ⇒ 提示"本结论可能静默漏报"并给可执行修复。
 * 健康时返回空串（不刷屏）。无索引也返回空串（那种"不全"由 firstContactBackfill 标注）。
 * 导出是为了**能被测试看见** —— 注入型逻辑最容易静默失效。
 */
export function trustNoteFor(rawRoot: string | null): string {
  if (!rawRoot) return '';
  try {
    const root = path.resolve(rawRoot);
    if (!hasLiveIndex(root)) return '';
    const db = getProjectCacheDb(root);
    const stale =
      (db
        .prepare(
          `SELECT COUNT(*) c FROM unresolved_refs u
           WHERE u.status = 'resolved'
             AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
        )
        .get() as { c: number } | undefined)?.c ?? 0;
    if (stale <= 0) return '';
    return (
      `\n⚠️ TRUST：符号索引内有 ${stale} 条**陈旧断言**（声称"已解析"、但目标符号已不在索引）——` +
      '本工具的结论可能**静默漏报**（查到了但少了，且无从察觉）。' +
      '先 `index_integrity({project_dir, refresh:true})` 修复（重开重解析：连得上重连、连不上明确标 failed）再采信本结果。'
    );
  } catch {
    return '';
  }
}


// ─────────────────────────────────────────────────────────────
// 基础设施：已抽到 src/registry/（P1a，2026-09-28）
//   抽出的原因：TOOL_DEFS 要按 lane 切文件，而 lane 文件必须用到 ToolDef / 三个包装器 /
//   20 个共享 handler —— 它们原先都定义在本文件内部 ⇒ lane 一 import 就成环
//   （server_registry → lanes → server_registry）。先抽成独立模块，依赖就变成单向。
// ─────────────────────────────────────────────────────────────

import type { ToolDef } from '../../application/types.js';
import { looseInputSchema, textOut, wrap, wrapData } from '../../application/plumbing.js';
import { emitWarnings, type ToolWarning } from './tool_warnings.js';

// 对外仍从本模块导出（原 `export interface ToolDef` 的公开 API 位置不变）
export type { ToolDef };

// ─────────────────────────────────────────────────────────────
// ToolDef 定义：9 主工具 + 别名
// ─────────────────────────────────────────────────────────────


// ★ 2026-10-01（④-2）：工具表的**汇总**已下沉 `application/tool_registry.ts` ——
//   它本是 application 层的事实（6 个 `*_TOOLS` 数组都在那儿）；本文件只负责**注册到 MCP server**。
import { TOOL_DEFS } from '../../application/tool_registry.js';

// ─────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────

/** 注册全部主工具到 McpServer（旧工具名别名已于 2026-08-17 全部移除） */

/**
 * ★★★ 工具的**唯一调用入口**（2026-09-30 抽出）—— MCP 面与 CLI 面调**同一个函数**。
 *
 * 它把「每次调用前保鲜 / 首次接触建索引 / 参数纠错 / 狗食统计 / 响应注入」这五件**外围事**
 * 从注册闭包里搬出来，于是**任何**入口都自动获得它们。
 *
 * ★ 为什么必须抽（**实测的真缺陷**，不是风格问题）：那些**手写的** CLI
 *   （`health_cli` / `impact_cli` / `behavior_cli` / `cross_repo_cli` / `hybrid_cli` …）
 *   **全都没有**保鲜、陈旧告警、狗食统计（实测各 0 命中）⇒ 它们跑的是**旧索引 + 无任何标注**，
 *   给出不可信的结果**还不说**。
 *   ⇒ 「CLI 从唯一真相源投影」的价值不只是消重，是**让 CLI 自动获得这些能力**（结构保证，不是自觉）。
 *
 * ★ 为什么放本文件而不是新开 `registry/invoke.ts`：它需要的 7 个外围函数
 *   （`projectRootArg` / `firstContactBackfill` / `staleIndexWarning` / `trustNoteFor` …）**都定义在本文件里**
 *   ⇒ 另开模块会成环（本仓 §P1a 已为同样的理由抽过一层基础设施）。
 *   等 `server_registry.ts` 按 §44 搬进 `presentation/mcp/` 时，本函数一并搬去 `registry/invoke.ts`。
 */
export async function invokeTool(
  def: ToolDef,
  args: Record<string, unknown> | undefined,
): Promise<{ text: string; isError?: boolean }> {
  const a = (args ?? {}) as Record<string, unknown>;
  // ★ 首次接触 ⇒ 后台建索引（2026-09-15）：带 project_root 的调用若该项目还没有索引，
  //   顺手起后台续建（不阻塞本次调用）——把建索引的起点从"第一次读"提前到"第一次任何调用"。
  //   起了就诚实标注"本轮结果可能不全"（空缺型不全，staleIndexWarning 覆盖不了）。
  const rootArg = projectRootArg(a);
  const firstContactNote = def.noAutoFresh ? '' : firstContactBackfill(rootArg);
  // ★ L3① 结构性精确化（2026-09-15）：有索引的项目，**每次调用前先保鲜**。
  //   为什么放这里：保鲜此前靠"每个工具自己记得调 ensureProjectIndex"，实测 60 个工具里有
  //   17 个直接开 cache.db 却没接 ⇒ 只能靠 staleIndexWarning 做**标注**。标注满足了不变量的
  //   "要么标注"那半边，但结果本身仍是旧的。这里在**唯一入口**做一次，全部工具的结果自动精确，
  //   以后新增工具也不用记得（结构保证，不是自觉）。
  //   成本：ready 态实测 ~35ms/次（390 文件）；有变更时付的是本来也要付的重同步钱。
  //   纪律：bootstrap:false —— 绝不因为一次调用就冷启建索引；失败静默（结果里仍有陈旧告警兜底）。
  //   ★ 后台续建在建时跳过（isIndexIncomplete）：后台循环本来就在持续同步，逐调用保鲜
  //     只会重复全盘走查 + 触发 MAX_ADDS_PER_REFRESH 噪音；"在建 ⇒ 可能不全"由 firstContactNote 标注。
  // ★ 2026-10-08：预热在**每次调用**都检查（只真起一次）—— 放这儿是为了与「逐调用保鲜」同一处，
  //   不另开生命周期钩子（本仓没有启动钩子，见上一段的注释教训）。
  // ★ 2026-10-08：**等它一次**（不是 fire-and-forget）—— 否则同步 AST 路径在本轮不可用（见函数注释）。
  await ensureKernelPrewarmed();
  if (rootArg && !def.noAutoFresh) {
    try {
      if (hasLiveIndex(rootArg) && !isIndexIncomplete(rootArg)) await ensureProjectIndex(rootArg, { bootstrap: false });
    } catch {
      /* 保鲜失败不阻断主流程（staleIndexWarning 仍会兜底标注） */
    }
  }
  // ★ 参数纠错（Did you mean）：zod object 会**静默丢弃**未知键（错参数 = 结果莫名其妙），
  // 这里对"够像"的未知键给一条建议；只提示不阻断，不够像则静默（避免噪音）。
  const knownArgs = Object.keys(def.inputSchema ?? {});
  const argHints = renderArgHints(unknownArgHints(a, knownArgs), knownArgs);
  // 狗食正式统计：记录每次工具调用的成败与子动作（失败静默，不阻断主流程）
  const t0 = Date.now();
  const r = await def.handler(a);
  recordDogfoodUsage({
    ts: new Date().toISOString(),
    tool: def.name,
    action: def.name === 'explore_code'
      ? (typeof a.action === 'string' ? a.action : undefined)
      : def.name === 'edit_code'
        ? (typeof a.op === 'string' ? a.op : undefined)
        : undefined,
    ok: !r.isError,
    ms: Date.now() - t0,
    // ★★ 2026-10-06：把「本次给了几条下一棒」也记下来 —— 用户裁定"收敛靠狗食"，这就是那份原料
    //   （能答"什么时候使用频率高"）。★ 0 时记 undefined（= 没给），免得日志里全是 0 的噪音。
    nextHops: nextHopsOf(def.name).length || undefined,
    err: r.isError ? (r.text ?? '').slice(0, 200) : undefined,
  });
  // 响应注入（顺序即拼接顺序）：① 参数纠错（Did you mean）② 陈旧告警家族（BUILD/SOURCE/INDEX，
  //          **结构化** + 首次全文/后续一行摘要，见 registry/tool_warnings.ts）③ 索引在建标注（首触）
  //          ④ 行动工具的可信度附注（陈旧断言 → 静默漏报预警）：在 handler **之后**算 ——
  //          rename_symbols 等工具自己会修陈旧引用，附注必须反映"修完之后"的现状。
  //          ⑤ watch 产出的未读影响提醒借力本次响应自动送达；⑥ `---WARNINGS---` 机器块（最末）。
  //    ★ P-F（§16.6）：三个 stale 告警不再各自拼字符串，而是产出 `ToolWarning`，由 `emitWarnings`
  //      统一分级 + 生成机器块（**追加在文本最末**，好让 `split(marker)[1]` 直接 `JSON.parse`）。
  //      注入点在 handler 之后、`wrap`/`wrapData` **之外** ⇒ 不经过那两个包装器，
  //      所以本笔无需改动 plumbing.ts（`wrap` 丢 `data` 与这里的告警通道无关）。
  const trustNote = def.trustAnnotated ? trustNoteFor(rootArg) : '';
  const alertNote = await collectPendingAlertText(def.name);
  const emission = emitWarnings([staleBuildWarning(), staleSourceWarning(), staleIndexWarning(rootArg)]);
  // ★ 只回**合成好的文本**（含注入的告警块），**不在这里包 MCP 形状** ——
  //   「怎么呈现」是各面自己的事：MCP 面用 `textOut(...)` 包成 `{content:[...]}`，
  //   CLI 面直接打到 stdout。★ 这样两个面共用的就是**同一份合成逻辑**（唯一真相源）。
  // ⑦ ★★ 2026-10-06：「下一棒」提示（用户裁定：**先不收敛，所有有可能的下一棒都给它**）。
  //    ★ 插在 `---DATA---` **之前**：既有解析 `text.split('---DATA---')[1]` **不受影响**，
  //      且机器块（`---WARNINGS---`）仍是最末 —— **别追加到末尾**，那会污染 `JSON.parse`。
  //    ★ 只在**有已验证出边**的工具上注入（今天 61 个里只有 3 个：find_references /
  //      rename_symbols / edit_code），其余工具文本**一个字符都不变**。
  //    ★★ 它**不进产物**：既不是契约（下游不会用它重算）、也不是剪贴板 —— 是**提示**。
  const nextNote = renderNextHops(def.name);
  const withNext =
    nextNote && r.text.includes(DATA_MARKER)
      ? r.text.replace(DATA_MARKER, () => nextNote + '\n' + DATA_MARKER)
      : r.text + nextNote;
  return { text: withNext + argHints + emission.text + firstContactNote + trustNote + alertNote + emission.block, isError: r.isError };
}

/**
 * ★★★ MCP 的「面」（2026-10-06，用户裁定）
 *
 * 用户原话（意思）：「**原工具面其实不用暴露在 MCP 里面，只需要留一个单独的入口、集中在一起就够了**」。
 *
 * ★ 为什么这条比"裁 `listTools`"对：实测本仓用的 SDK（`server/mcp.js`）——
 *   `ListTools` handler（`:67-68`）与 `CallTool` handler（`:100-102`）读**同一张** `_registeredTools`
 *   ⇒ **"只不列、仍可调"做不到**；而"**不注册**"恰好是 SDK 支持的形态（`:626` 还有 `delete`）。
 *
 * ★★ 默认 `all` = **与改造前逐字等价**（61 个全注册、**不注册**入口）⇒ 不打断现有下游
 *   （`dsh-brain` / `dsl-workbench` / `elv` / `ai-config/skills/design-canvas-mind`）。
 *   要收敛就设 `AGENT_IO_MCP_FACE=composed`：只注册**编排面** + **一个原子入口**。
 */
export const ATOMIC_ENTRY_NAME = 'atomic_call';

/** 当前 MCP 面。★ 用 env 而非常量 —— "把这一部分做成可配置的"是需求本人。 */
export function mcpFace(): 'all' | 'composed' {
  return process.env.AGENT_IO_MCP_FACE === 'composed' ? 'composed' : 'all';
}

/** 编排面 = `facesOf` 算出的 `composed`（`direct` ∪ 派生链）—— ★ 零手写。 */
function composedDefs(): ToolDef[] {
  const faces = facesOf(catalogOf(TOOL_DEFS), LANE_META.flatMap((m) => m.direct));
  const names = new Set(faces.find((f) => f.id === 'composed')?.names ?? []);
  return TOOL_DEFS.filter((d) => names.has(d.name));
}

/**
 * 原子面入口：**一个**工具，能 `list` / `describe` / `call` 全部原子工具。
 *
 * ★★★ 它**不是 `[B]`**，**故意不走那 7 处登记面**（见技能 `dc-add-tool` §一）——
 *   因为它**必须**调 `invokeTool`（唯一咽喉点：保鲜 / 告警 / 狗食统计都挂在那儿），
 *   而 `invokeTool` 住 `presentation/`；若把它做成 `application` 层的 `[B]`，
 *   `application` 就得 import `presentation` ⇒ **分层违规**。
 *   ⇒ ★ **它是传输层的收敛口，不是领域能力。**
 * ★ 因此它**不在 `TOOL_DEFS` 里** ⇒ `mcp_scan` 那道门量不到它（那道门的对象是 `[B]` 的契约）；
 *   也**不能**经 CLI 投影调用（CLI 从 `TOOL_DEFS` 找 def）—— ★ 这是**有意**的：
 *   CLI 本来就是"全量可脚本化"的那个面，不需要入口。
 */
function registerAtomicEntry(server: McpServer, exposedNames: ReadonlySet<string>): void {
  server.registerTool(
    ATOMIC_ENTRY_NAME,
    {
      title: 'Atomic face entry (list / describe / call)',
      description:
        '原子面入口 —— 本会话的 MCP 面是「编排面」，**其余原子工具只能经这里走**。' +
        'action=list 列全部原子工具名（带 * 的是已直接暴露的）；describe 取某个的入参名清单；' +
        'call 调它（args 原样透传，入参校验由被调工具自己做）。拿不准就先 list、再 describe、最后 call。',
      inputSchema: {
        action: z.enum(['list', 'describe', 'call']).optional(),
        tool: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (raw) => {
      const a = (raw ?? {}) as { action?: 'list' | 'describe' | 'call'; tool?: string; args?: Record<string, unknown> };
      const action = a.action ?? 'list';
      if (action === 'list') {
        const lines = TOOL_DEFS.map((d) => `${exposedNames.has(d.name) ? '*' : ' '} ${d.name}`);
        return textOut(
          `原子工具共 ${TOOL_DEFS.length} 个（带 * 的**也**已在 MCP 面直接可用；其余经 ` +
            `${ATOMIC_ENTRY_NAME} action=call 调）：\n${lines.join('\n')}`,
        );
      }
      const name = a.tool;
      if (!name) return textOut(`action=${action} 需要 tool（先用 action=list）`, true);
      if (name === ATOMIC_ENTRY_NAME) return textOut('拒绝：不能经入口调入口自己（防自递归）', true);
      const def = TOOL_DEFS.find((d) => d.name === name);
      if (!def) return textOut(`没有这个工具："${name}"。先 action=list 看名字。`, true);
      if (action === 'describe') {
        const keys = catalogOf([def])[0]?.inputKeys ?? [];
        return textOut(
          `${def.name} — ${def.title}\n${def.description}\n` +
            `入参名（**深层**收集，含数组元素里的键）：${keys.join(', ') || '（无）'}\n` +
            `★ 类型 / 必填以描述为准；缺参会被人话错误挡回（不会静默）。`,
        );
      }
      const r = await invokeTool(def, a.args ?? {});
      return textOut(`[${def.name}] ${r.text}`, r.isError);
    },
  );
}

export function registerAllTools(server: McpServer): void {
  const face = mcpFace();
  const exposed = face === 'composed' ? composedDefs() : TOOL_DEFS;
  for (const def of exposed) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: looseInputSchema(def.inputSchema) as unknown as z.ZodRawShape },
      async (args) => {
        const r = await invokeTool(def, args as Record<string, unknown>);
        return textOut(r.text, r.isError);
      },
    );
  }
  // ★ 收敛面：额外注册**一个**原子入口（= 原工具面的唯一通道）。
  if (face === 'composed') registerAtomicEntry(server, new Set(exposed.map((d) => d.name)));
}


