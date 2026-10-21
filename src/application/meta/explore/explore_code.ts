/**
 * explore_code: 代码理解统一入口
 *
 * 将 search / read / facts / arch_layer / guided_tour / check_monolith / derive_mind_map /
 * run_simulation / reset_simulation / watch 工具聚合为单工具，通过 action 分发。
 * ★ 2026-10-21 加 `facts`：**选择性读 DB**（`nodes` 上的索引事实）—— 与 `read`（读源码）是
 *   两条互不替代的读法。分层：**DB 全量存、读时按需取列**；DSL 才是"面向 LLM 直接读"的产物。
 *   ★ 它带**同源校验**（`contentHash(当前源码) === files.content_hash`）：库与源码不同源就**拒绝**，
 *   绝不把旧快照当事实返回（照旧副本重写 = 把旧代码写回去）。
 * ★ 2026-10-21：删掉 6 个「别处已能回答、实测成功率 0-3%」的 action（diff_impact /
 *   inject_replay / derive_split / derive_chain / derive_anim_flow / derive_algorithm）：
 *   影响面 → `impact_analysis`；注入回放/回放观测 → `observe_instrument` + `observe_trace`；
 *   拆分/调用链 → `feature_line` + `structure_gap`。实现文件**保留**（derive_chain / derive_algorithm
 *   仍被 reconcile_chain / serve 调用），只是不再从这里分发。
 * （import_project 已拆分为独立工具，不再经此分发。）
 *
 * 设计动机：
 * - 代码理解互斥（LLM 一次只能做一件事），避免列表过长
 * - 异步 action（import/derive_* / watch）统一 await，错误分级可恢复
 * - 新增 action 只加 switch case，不改注册表
 *
 * 注意：render_design / get_dsl / diff_views 等"读"工具不在此聚合中，
 * 它们在注册表独立存在，因为 LLM 需要在 import 后立刻渲染/查询，动作链较短。
 */

// ★★★ T191：**判据一处** —— `requireStr` / 严格可选取值 全部从 `plumbing` import。
//   ★ 此前本文件**自带一套**（`requireStr`/`str`/`num`/`bool`）：前者的行为与 `plumbing.requireStr`
//     **逐字相同**（纯重复），后三个是**宽松版**（形状错 ⇒ 静默当没给）。
//   ⇒ 现在：**删掉那四个局部助手**，统一用 `plumbing` 的（严格：**形状错就抛**）。
import { requireStr, optionalStr, optionalNum, optionalBool, optionalArr } from '../../plumbing.js';
// ★★★ T197：**args 的【键名】判据**（★ 与 plumbing 的【值形状】判据是两把尺）。
import { assertExploreArgKeys, assertExploreRequired } from './explore_arg_spec.js';
import { semanticSearch } from '../llm/semantic_search.js';
import { ensureProjectIndex, ensureIndexAroundSeed } from '../../../infrastructure/index/index_freshness.js';
// ★ action=facts（选择性读 DB）的判据全在下层，本文件只解参与渲染，不重推一遍：
//   · `contentHash` = 「库与源码同源」的唯一哈希（= files.content_hash 存的同一个函数）；
//   · `readSymbolBody` = body 的五道准入（含同源校验）—— 别在这里再写一套；
//   · `toIndexKey` = 「路径 → 索引键」的唯一住处（根外 ⇒ null）。
import { contentHash, readSymbolBody, toIndexKey } from '../../../infrastructure/index/symbols.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
// ★ 字段名的"是不是想写 X"与 explore_arg_spec 同一把尺（同一个函数），不另写一份编辑距离。
import { suggestNames } from '../../../infrastructure/text/arg_suggest.js';
import { scheduleBackfill, backfillState, backfillSummary } from '../../../infrastructure/index/index_backfill.js';
import { archLayer } from '../../../infrastructure/analysis/structure/arch_layer.js';
import type { LayerDef } from '../../../infrastructure/analysis/structure/layer_detect.js';
import { guidedTour } from '../../../infrastructure/index/guided_tour.js';
import { checkMonolith } from '../../../infrastructure/analysis/structure/monolith.js';
import { runSimulation, resetSimulation } from '../../design/lifecycle/simulation.js';
import { dispatchWatch } from '../../dispatch.js';
import { deriveMindMap } from '../view/derive_mind_map.js';
import fs from 'node:fs';
import path from 'node:path';
import { parseFileFull, type ParsedSymbol } from '../../../infrastructure/parse/index.js';
import { splitKeepEnds } from '../../../infrastructure/text/line_utils.js';
import { matchSymbols, describeSymbol } from '../../refactor/edit/edit_code.js';

export const EXPLORE_ACTIONS = [
  'search',
  'read',
  // ★ facts：**选择性读 DB**（索引事实），与 read（读源码）是两条互不替代的读法。
  'facts',
  'arch_layer',
  'guided_tour',
  'check_monolith',
  'derive_mind_map',
  'run_simulation',
  'reset_simulation',
  'watch',
] as const;

export type ExploreAction = (typeof EXPLORE_ACTIONS)[number];


/** catch 里如实记下「跳过了什么/为什么」时用的错误文本（§2d：少做的事不许不说） */
function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 统一回执包装。
 *
 * ★★ 2026-10-06（**T34 结案**）：`isAsync=true` 时外层 `message` **恒为**「异步 action 已完成」——
 *   这是**有意**的（外层只是**摘要位**），**不是 bug**，且**别只改一半**：
 *   · **不算"说谎"**：真实文本经 `---DATA---` 通道**确实到达模型**（在 `data` 里）。
 *     它属"宣告了却没实现"那一族（G7）吗？**不属** —— 那些 action 是真实现了的。
 *   · 唯一代价是**可读性**：模型若不读 `data`，就只看到「已完成」三个字。
 *   · ★ **改法只有"全改"**：本文件 `toResult(r, true)` 共 **4 处**调用点（2026-10-21 删 6 个
 *     action 后：`arch_layer` / `check_monolith` / `derive_mind_map` / `watch`），
 *     而每处的 `r` 结构**各不相同**（**没有共同摘要字段**）⇒ 只能逐处挑一句话提上来。
 *     **改一半 = 同一件事两套口径**（本仓头号病根）。
 *   · 更通用的落点在 `invokeTool`（唯一入口，把 data 的摘要提到外层）—— 但那会动**全部 59 个工具**
 *     的对外回执口径 ⇒ 面更大，须按**行为变更**单独验收。
 *   ⇒ **当前判断：不改**（可读性问题，不是一致性问题；`---DATA---` 已保证真文本可达）。
 *     触发条件（满足其一再改）：出现「模型不读 `data` 因而漏看结论」的**实测**案例；
 *     或新前端需要一个可读的单行摘要。
 */
function toResult(r: unknown, isAsync = false): { message: string; data: unknown } {
  return {
    message: isAsync ? '异步 action 已完成' : '',
    data: r,
  };
}

export async function exploreCode(params: { action: ExploreAction; args: Record<string, unknown> }): Promise<{ message: string; data: unknown }> {
  const { action, args } = params;

  // ★★★ T197：**先校验键名** —— `args` 在 schema 里是自由袋子（zod 不校验），
  //   ⇒ 过去一个拼错的键会被**静默丢掉**，调用方以为生效了、工具按默认值跑完还回"正常"结果。
  //   ⇒ 现在：不认识的键 **当场抛**，并给"是不是想写 X"（★ 实测过这个病，见本文件测试与
  //     `explore_arg_spec.ts` 的文件头）。★ 放在 switch **之前** ⇒ 任何 action 都拦得住。
  assertExploreArgKeys(action, args);
  // ★★★ T215（2026-10-13）：**"漏参数"也在入口拦** —— ★ 与上面那道"键名"校验**对称** ✓
  //   ★ 外部评测的 ③：*"入口合并了…增加**选错动作、漏参数、漏读限制**的机会"* ✓
  //   ★★ 实测：★ **必填要求只写在长描述里** ✗（★ 如 *"`run_simulation`（**硬必填** feature）"* ✓）
  //     ⇒ ★ 本行把那些"硬必填"**从说明搬回参数** ✓ —— ★ 缺就在这儿被拒、并说清缺什么 ✓
  //   ★ 同样放在 switch **之前** ⇒ ★ 任何 action 都拦得住 ✓
  //   ★★ 边界：★ 只覆盖 `EXPLORE_REQUIRED` 里【描述点名过】的那些 ✓ —— ★ 其余 action **不越权** ✓
  assertExploreRequired(action, args);

  switch (action) {
    case 'search': {
      // 空 query 温和返回"查询为空"（在 project_dir 校验之前——query 都空了无需纠结库）；
      // project_dir 必填——缺失/索引为空时 semanticSearch 抛可行动错误（杜绝静默空结果）
      const q = typeof args['query'] === 'string' ? (args['query'] as string) : '';
      if (!q.trim()) {
        return { message: '查询为空', data: { query: q, provider: 'fts', indexed: 0, hits: [], message: '查询为空' } };
      }
      // top_k → limit：用户传 top_k=5 就只返 5 条，不再默认返 20 条
      const topK = typeof args['top_k'] === 'number' ? args['top_k'] : undefined;
      // min_score 阈值：语义搜索默认 0.3 滤低分噪音（0.50 的无关符号不再混入）；
      // 用户可显式传 min_score=0 覆盖（exact/fts 路径不受影响——只在 semantic 路径过滤）
      const minScore = typeof args['min_score'] === 'number' ? args['min_score'] : undefined;
      const r = await semanticSearch({
        query: q,
        project_dir: requireStr(args, 'project_dir'),
        limit: topK,
        min_score: minScore,
      });
      // message 内联可读命中列表：外层 wrap 只回显 message，纯 data 易被丢弃导致静默空结果
      const lines = [r.message];
      for (const h of r.hits) {
        lines.push(`  [${h.score.toFixed(3)}] ${h.qualified_name} (${h.file_path}:${h.start_line})`);
      }
      return { message: lines.filter(Boolean).join('\n'), data: r };
    }
    case 'read': {
      // ★ 拼图式局部索引（S1）：以"正在读的这个文件"为种子，按需建它周围的索引块 ——
      //   不触发全量冷启（大仓首调会 12s+），也不假装完整：**覆盖度写进结果**。
      //   只读路径可以用局部索引；编辑类工具仍必须先扩到闭合（见 docs/index-locality-design.md §4）。
      let tileNote = '';
      // 索引增强是「可选加分项」：失败不阻断读取，但**必须如实记下跳过了什么、为什么**（§2d）
      const indexSkipped: Array<{ what: string; why: string }> = [];
      const readRootRaw = args['project_dir'];
      const readFileRaw = args['file'];
      if (typeof readRootRaw === 'string' && readRootRaw.trim() && typeof readFileRaw === 'string' && readFileRaw.trim()) {
        try {
          const readRoot = path.resolve(readRootRaw);
          // 读一个文件只需要"它 + 直接协作者"：depth=1（出边一跳）+ 最多 6 个文本引用方 + 4s 时长上限。
          // ★ 硬纪律：**首次读绝不允许长时间空转**（读不到最打击使用感受）——
          //   超时即停、如实标 partial(time)；剩下的交给下面的后台续建慢慢补。
          const tile = await ensureIndexAroundSeed(readRoot, [readFileRaw], {
            depth: 1,
            maxFiles: 80,
            maxTextImporters: 6,
            maxMs: 4000,
          });
          // ★ 后台续建：没有其他任务时持续把剩下的拼图补全（幂等单飞；每批让出事件循环）
          let bf = backfillState(readRoot);
          if (tile.partial || !bf || !bf.running) {
            try {
              bf = scheduleBackfill(readRoot, { batch: 20, intervalMs: 200 });
            } catch (err) {
              // 后台起不来不影响本次读 —— 但「跳过了后台续建」要说话
              indexSkipped.push({ what: '后台续建', why: errMessage(err) });
            }
          }
          const parts: string[] = [];
          if (tile.newFiles > 0 || tile.stitched > 0) {
            parts.push(
              `按需建索引：围绕该文件扩展 ${tile.visited} 个文件，新建 ${tile.newFiles}，缝合 ${tile.stitched}`,
            );
          }
          if (tile.partial) {
            parts.push(`**本轮覆盖不完整**（${tile.stopReason}），未覆盖区域的引用可能看不到`);
          }
          if (bf) parts.push(backfillSummary(bf));
          if (parts.length) tileNote = `\n（${parts.join('；')}）`;
        } catch (err) {
          // 拼图失败不阻断读取（索引是增强、不是前提）—— 但「跳过了按需建索引」要说话（§2d）
          indexSkipped.push({ what: '按需建索引', why: errMessage(err) });
        }
      }
      // ★ 解参只在这一层（[C] 工具边界，§21.2）；readCode 是显式参数的 [B] 执行体
      const r = await readCode(optionalStr(args, 'project_dir'), requireStr(args, 'file'), {
        symbol: optionalStr(args, 'symbol'),
        parent: optionalStr(args, 'parent'),
        start: optionalNum(args, 'start'),
        end: optionalNum(args, 'end'),
        context: optionalNum(args, 'context'),
        symbols: optionalBool(args, 'symbols'),
        symbolsLimit: optionalNum(args, 'symbols_limit'),
      });
      const data = indexSkipped.length ? { ...r.data, index_skipped: indexSkipped } : r.data;
      const skipNote = indexSkipped.length
        ? `\n（索引增强跳过：${indexSkipped.map((s) => `${s.what}（${s.why}）`).join('；')}）`
        : '';
      return { message: r.message + tileNote + skipNote, data };
    }
    case 'facts': {
      // ★ 读的是 cache.db 的 `nodes`（索引那一刻的事实），**不是源码** —— 读源码用 case 'read'。
      //   同源校验、字段白名单、body 五道准入全在 readFacts 里（唯一住处），这里只解参。
      const r = readFacts({
        project_dir: optionalStr(args, 'project_dir'),
        file: requireStr(args, 'file'),
        name: optionalStr(args, 'name'),
        fields: optionalArr(args, 'fields', 'string[]') as string[] | undefined,
        limit: optionalNum(args, 'limit'),
      });
      return { message: r.message, data: r.data };
    }
    case 'arch_layer': {
      const r = await archLayer({
        feature: requireStr(args, 'feature'),
        persist: optionalBool(args, 'persist'),
        layers: args['layers'] as LayerDef[] | undefined,
        check_violations: optionalBool(args, 'check_violations'),
        no_cache: optionalBool(args, 'no_cache'),
      });
      return toResult(r, true);
    }
    case 'guided_tour': {
      const r = guidedTour({ feature: requireStr(args, 'feature') });
      return toResult(r);
    }
    case 'check_monolith': {
      // ★ 2026-10-04（T17）：此前是纯空壳 —— `assessLines(0,300,600)` 恒返回 'ok'，
      //   从不调用 checkMonolith，**对 agent 说谎**（宣告"巨石分析"却永远给 'ok'）。
      //   现在真的调它：扫描 project_dir / feature / files 之一，出报告 + 拆分建议（只读）。
      const r = await checkMonolith({
        project_dir: optionalStr(args, 'project_dir'),
        feature: optionalStr(args, 'feature'),
        base_dir: optionalStr(args, 'base_dir'),
        files: optionalArr(args, 'files', 'string[]') as string[] | undefined,
        warn_lines: optionalNum(args, 'warn_lines'),
        crit_lines: optionalNum(args, 'crit_lines'),
        flag_cohesive: optionalBool(args, 'flag_cohesive'),
        max_files: optionalNum(args, 'max_files'),
        no_cache: optionalBool(args, 'no_cache'),
        save_preview: optionalBool(args, 'save_preview'),
        preview_feature: optionalStr(args, 'preview_feature'),
      });
      return toResult(r, true);
    }
    case 'derive_mind_map': {
      const r = await deriveMindMap({
        feature: requireStr(args, 'feature'),
        gen_descriptions: optionalBool(args, 'gen_descriptions'),
        max_files_per_community: optionalNum(args, 'max_files_per_community'),
        output_path: optionalStr(args, 'output_path'),
      });
      return toResult(r, true);
    }
    case 'run_simulation': {
      const r = runSimulation({ feature: requireStr(args, 'feature'), events: (optionalArr(args, 'events', '[{event, payload?}]') as Array<{ event: string; payload?: Record<string, unknown> }>) ?? [] });
      return toResult(r);
    }
    case 'reset_simulation': {
      const r = resetSimulation({ feature: requireStr(args, 'feature') });
      return toResult(r);
    }
    case 'watch': {
      // daemon 感知分流：daemon 在则转发（注册表权威在 daemon 进程），不在降级本地（方向 E）
      const r = await dispatchWatch({
        project_dir: requireStr(args, 'project_dir'),
        action: optionalStr(args, 'action') as 'start' | 'status' | 'stop' | 'impact' | 'declare' | 'ledger' | undefined,
        feature: optionalStr(args, 'feature'),
        debounce_ms: optionalNum(args, 'debounce_ms'),
        rebuild_on_change: optionalBool(args, 'rebuild_on_change'),
        rebuild_window_ms: optionalNum(args, 'rebuild_window_ms'),
        reconcile_interval_ms: optionalNum(args, 'reconcile_interval_ms'),
        diff_on_change: optionalBool(args, 'diff_on_change'),
        drift_on_change: optionalBool(args, 'drift_on_change'),
        impact_on_change: optionalBool(args, 'impact_on_change'),
        seq: optionalNum(args, 'seq'),
        files: (args['files'] as string[] | undefined)?.map(String),
        ledger_status: optionalStr(args, 'ledger_status') as 'pending' | 'ok' | 'violated' | 'resolved' | 'expired' | 'all' | undefined,
        resolve_id: optionalStr(args, 'resolve_id'),
        reason: optionalStr(args, 'reason'),
        reviewer: optionalStr(args, 'reviewer'),
      });
      return toResult(r, true);
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知 explore_code action: ${exhaustive as string}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// action=read：按符号定位或行区间读文件（行号契约见 line_utils）
// ─────────────────────────────────────────────────────────────
//
// ★★ 读源码用 **read**，读索引事实用 **facts**（两个 action，别混）：
//   · read  = 磁盘上**现在**的源码（行号与 edit_code 同基准 ⇒ "先读后改"用它）；
//   · facts = cache.db 里**索引那一刻**的解析事实（列可选、带同源校验；要查签名/形参/函数体原文用它）。
//   ★ facts 过期会**报错**而不是回旧数据 ⇒ 想"读旧版本"是不可能的（也不该可能）。
//
// 心智流：explore(search/read) → 确认行号 → edit_code。read 是 edit 的
// "先读后改"前置：返回的 start/end/每行行号与 edit_code(op=range) 同基准
// （splitKeepEnds 数组下标 +1 = 真实行号），LLM 可直接把 read 的行号喂给
// edit_code 而不踩行号漂移。
//
// 两种模式（二选一）：
// - 符号模式：symbol（+parent 消歧 / context 附带上下文行）→ AST 定位符号边界读取
// - 行区间模式：start/end（1-based 含端点）→ 原样读取该区间
// 都不给 → 读整个文件。
//
// 符号索引（默认开启，symbols:false 关闭）：返回时在 data.symbols 附整文件符号索引
// （name/qualified_name/kind/signature/parent/行号），message 末尾附可读符号表
// （上限缺省 30，symbols_limit 可调，超出截断）。用途：一次 read 同时拿到正文 + 文件地图，
// LLM 无需再搜一次即可了解文件结构、按行号直达符号。解析失败仅降级跳过，不阻塞读取。

const READ_PREVIEW_CAP = 500;
const SYMBOL_TABLE_CAP = 30;

/** read 附带的文件符号索引条目（轻量快照，不引 AST 内部结构） */
type SymbolIndexItem = {
  name: string;
  qualified_name: string;
  kind: string;
  signature?: string;
  parent?: string;
  start_line: number;
  end_line: number;
};

/** read 的可选参数（显式收口；不再从 args 袋子里解参） */
interface ReadCodeOptions {
  symbol?: string;
  parent?: string;
  start?: number;
  end?: number;
  context?: number;
  /** 是否附整文件符号索引（缺省 true；false 关闭，省一次 AST） */
  symbols?: boolean;
  /** 符号表上限（缺省 30，钳制 1-500） */
  symbolsLimit?: number;
}

interface ReadCodeData {
  file: string;
  rel_path: string;
  total_lines: number;
  start: number;
  end: number;
  truncated: boolean;
  symbol?: SymbolIndexItem;
  symbols: SymbolIndexItem[];
  lines: string[];
  /** 索引增强被跳过的项（§2d：少做的事必须可读，不许静默） */
  index_skipped?: Array<{ what: string; why: string }>;
}

// [B] 纯函数形状：显式参数 + 结构化产物（§21.2）。拿不到/出错就 throw，不返回"看起来正常"的兜底值。
async function readCode(
  root: string | undefined,
  file: string,
  opts: ReadCodeOptions = {},
): Promise<{ message: string; data: ReadCodeData }> {
  const symbol = opts.symbol;
  const parent = opts.parent;
  const start = opts.start;
  const end = opts.end;
  const context = opts.context;
  // 符号索引默认开启；symbols:false 可关（读超大文件/纯看正文时可省一次 AST）
  const wantSymbols = opts.symbols !== false;

  // 符号表上限：缺省 30，传参可调（钳制 1-500）
  const symbolsLimit = Math.min(Math.max(opts.symbolsLimit || SYMBOL_TABLE_CAP, 1), 500);
  const projectRoot = root ? path.resolve(root) : undefined;
  const absPath = path.isAbsolute(file) ? file : projectRoot ? path.resolve(projectRoot, file) : path.resolve(file);

  if (!fs.existsSync(absPath)) throw new Error(`文件不存在: ${absPath}`);
  if (fs.statSync(absPath).isDirectory()) throw new Error(`是目录，不是文件: ${absPath}`);
  if (fs.statSync(absPath).size > 5 * 1024 * 1024) {
    throw new Error(`文件过大（${(fs.statSync(absPath).size / 1024 / 1024).toFixed(1)}MB），read 只读文本源码，请改用项目搜索定位`);
  }

  const original = fs.readFileSync(absPath, 'utf8');
  const lines = splitKeepEnds(original);
  const total = lines.length;
  const relPath = projectRoot ? path.relative(projectRoot, absPath).split(path.sep).join('/') : absPath;

  // ── 解析一次：符号定位 + 符号索引共用（避免重复 AST）──
  const needParse = Boolean(symbol) || wantSymbols;
  let parsed: Awaited<ReturnType<typeof parseFileFull>> | undefined;
  if (needParse) {
    parsed = await parseFileFull(absPath, original);
    if (parsed.error && symbol) throw new Error(`文件解析失败: ${parsed.error}`);
  }

  // ── 确定读取区间 ──
  let rangeStart: number;
  let rangeEnd: number;
  let symbolInfo: ParsedSymbol | undefined;

  if (symbol) {
    // 符号模式：AST 定位（与 edit_code replace/delete 同一 matchSymbols 口径）
    const syms = parsed?.error ? [] : parsed!.symbols;
    const { qnHits, nameHits } = matchSymbols(syms, symbol, parent);
    const hits = qnHits.length > 0 ? qnHits : nameHits;
    if (hits.length === 0) {
      throw new Error(
        `符号未找到: ${symbol}${parent ? `（parent=${parent}）` : ''}。文件符号:\n` +
          syms.map((s) => `  ${describeSymbol(s)}`).join('\n'),
      );
    }
    if (hits.length > 1) {
      throw new Error(
        `符号不唯一（${hits.length} 候选），传 parent 消歧:\n` +
          hits.map((s) => `  ${describeSymbol(s)}`).join('\n'),
      );
    }
    symbolInfo = hits[0];
    rangeStart = symbolInfo.start_line;
    rangeEnd = symbolInfo.end_line;
    if (context && context > 0) {
      rangeStart = Math.max(1, rangeStart - context);
      rangeEnd = Math.min(total, rangeEnd + context);
    }
  } else if (start != null || end != null) {
    // 行区间模式
    if (start == null || end == null) throw new Error('行区间模式需要同时提供 start/end（1-based 含端点）');
    if (start < 1) throw new Error(`start 必须 ≥1，收到 ${start}`);
    if (end < start) throw new Error(`end(${end}) < start(${start})`);
    if (end > total) throw new Error(`end(${end}) 超出文件总行数(${total})`);
    rangeStart = start;
    rangeEnd = end;
  } else {
    rangeStart = 1;
    rangeEnd = total;
  }

  // ── 生成带真实行号的预览（上限截断防爆）──
  const span = rangeEnd - rangeStart + 1;
  const shown = Math.min(span, READ_PREVIEW_CAP);
  const truncated = span > READ_PREVIEW_CAP;
  const width = String(rangeEnd).length;
  const linesOut: string[] = [];
  for (let i = 0; i < shown; i++) {
    const ln = rangeStart + i;
    linesOut.push(String(ln).padStart(width) + '| ' + lines[ln - 1].replace(/\r?\n$/, ''));
  }

  const symbolNote = symbolInfo
    ? `符号 ${symbolInfo.qualified_name}（${symbolInfo.kind}${symbolInfo.signature ? `, ${symbolInfo.signature}` : ''}` +
      `${symbolInfo.parent ? `, parent=${symbolInfo.parent}` : ''}，本体 L${symbolInfo.start_line}-${symbolInfo.end_line}）`
    : '';

  // ── 符号索引：默认附整文件符号表（上限截断），symbols:false 关闭 ──
  let symbolIndex: SymbolIndexItem[] = [];
  let symbolTableNote = '';
  if (wantSymbols) {
    if (!parsed || parsed.error) {
      symbolTableNote = '\n符号索引：文件解析失败，已跳过';
    } else {
      const syms = parsed.symbols;
      const symShown = Math.min(syms.length, symbolsLimit);
      const symTruncated = syms.length > symbolsLimit;
      symbolIndex = syms.slice(0, symShown).map((s) => ({
        name: s.name,
        qualified_name: s.qualified_name,
        kind: s.kind,
        signature: s.signature,
        parent: s.parent,
        start_line: s.start_line,
        end_line: s.end_line,
      }));
      symbolTableNote =
        '\n文件符号索引（' +
        (symTruncated ? `前 ${symbolsLimit}/${syms.length}，超出截断` : `共 ${syms.length}`) +
        '）:\n' +
        syms
          .slice(0, symShown)
          .map((s) => `  ${describeSymbol(s)}`)
          .join('\n');
    }
  }

  const message = [
    `${relPath} 共 ${total} 行，显示 L${rangeStart}-L${rangeEnd}` +
      (truncated ? `（预览截断，前 ${READ_PREVIEW_CAP} 行）` : '') +
      (symbolNote ? `\n${symbolNote}` : '') +
      symbolTableNote,
    '```',
    ...linesOut,
    '```',
  ].join('\n');

  return {
    message,
    data: {
      file: absPath,
      rel_path: relPath,
      total_lines: total,
      start: rangeStart,
      end: rangeEnd,
      truncated,
      symbol: symbolInfo
        ? {
            name: symbolInfo.name,
            qualified_name: symbolInfo.qualified_name,
            kind: symbolInfo.kind,
            signature: symbolInfo.signature,
            parent: symbolInfo.parent,
            start_line: symbolInfo.start_line,
            end_line: symbolInfo.end_line,
          }
        : undefined,
      symbols: symbolIndex,
      lines: linesOut,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// action=facts：**选择性读 DB**（`nodes` 表）—— ★ 读的是**索引事实**，不是源码（那是 action=read）
// ─────────────────────────────────────────────────────────────
//
// ## 分层（2026-10-21 用户定的判据，别再改）
// · **DB 全量存**：解析器能给的都落库（`nodes` 21 列，含 `body_text`）；
// · **读的时候按需取列**：LLM 直接读 DB 层也应当**选择性读**，不必把整行端上来；
//   「面向 LLM 直接读」的是 DSL 层 ⇒ 本 action **不生成 / 不改 DSL**，只把索引里的事实端出来。
//
// ## ★★ 与 `read` 的分界（两条互不替代的读法）
// · `read`  = 读**源码**（磁盘现在的内容；行号与 `edit_code` 同基准，用于"先读后改"）；
// · `facts` = 读**索引快照**（索引那一刻的解析事实；**带同源校验，过期就拒绝**）。
//   ★ 为什么过期必须拒：`signature` / `body_text` 都是索引时的副本；拿着旧副本重写 = 把旧代码写回去。
//     **给旧数据比报错坏得多** ⇒ 本 action 只有"库与源码同源"这一条路能返回数据。
//
// ## ★ 为什么字段必须是白名单（不是"顺手校验一下"）
// 列名要拼进 SQL。把用户传的 `fields` 直接拼上去 = 在只读工具上开一个注入口。
// ⇒ `FACTS_COLUMNS` 是「字段名 → 列名」的**唯一住处**；不认识的字段**当场拒**（并给"是不是想写 X"）。
//
// ## ★ 边界（如实写在这里）
// · **只读库：不建索引、不做保鲜** —— 库里没这个文件就报错并告诉你先 `read` 一次（它会就地补索引）；
// · `body_text` 是**重字段**（本仓最长的一个函数 3565 行）：默认集**不含**它，只能显式要；
// · 行数上限 = `limit`（缺省 50）；截断时回执**明写「共 N 个，返回 M 个」**，不静默少给。

/** 可读字段白名单（★ 同时是「字段名 → SQL 列」的唯一映射；**别拿入参直接拼 SQL**） */
const FACTS_COLUMNS = {
  kind: 'kind',
  signature: 'signature',
  params: 'params',
  return_type: 'return_type',
  type_params: 'type_params',
  modifiers: 'modifiers',
  members: 'members',
  docstring: 'docstring',
  start_line: 'start_line',
  end_line: 'end_line',
  body_text: 'body_text',
  body_hash: 'body_hash',
  parent: 'parent',
  qualified_name: 'qualified_name',
} as const;

type FactsField = keyof typeof FACTS_COLUMNS;

const FACTS_FIELDS = Object.keys(FACTS_COLUMNS) as FactsField[];

/** 默认集 ★ **不含 `body_text`**（重字段：只在 `fields` 里显式要了才读） */
const FACTS_DEFAULT_FIELDS: readonly FactsField[] = [
  'kind', 'signature', 'params', 'return_type', 'start_line', 'end_line',
];

/** 列全部符号时的缺省上限（截断**必须**在回执里写明"共 N 个，返回 M 个"） */
const FACTS_DEFAULT_LIMIT = 50;

/** DB 里存成 JSON 文本的列 ⇒ 出参**解成结构化值**（解不开就原样回文本，不假装是数组） */
const FACTS_JSON_FIELDS = new Set<FactsField>(['params', 'type_params', 'modifiers', 'members']);

/** 索引时间 → 人读年龄（过期报错里要说清"多旧"，只说"过期"等于没说） */
function factsAge(ms: number): string {
  const d = Math.max(0, Date.now() - ms);
  if (d < 60_000) return `${Math.round(d / 1000)} 秒`;
  if (d < 3_600_000) return `${Math.round(d / 60_000)} 分钟`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} 小时`;
  return `${Math.round(d / 86_400_000)} 天`;
}

function factsJsonOrRaw(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v; // 坏 JSON 原样回（★ 不吞：调用方看到的就是库里的那段文本）
  }
}

/** `fields` 白名单校验（★ 唯一入口：先校验、后拼 SQL） */
function factsFieldsOf(raw: string[] | undefined): FactsField[] {
  if (raw === undefined) return [...FACTS_DEFAULT_FIELDS];
  if (raw.length === 0) {
    throw new Error(
      'facts 的 fields 是空数组 —— ★ 要么**别给**（用默认集），要么明确列出要哪几列。\n' +
        `  ★ 默认集：${FACTS_DEFAULT_FIELDS.join(' · ')}\n` +
        `  ★ 可读字段：${FACTS_FIELDS.join(' · ')}`,
    );
  }
  const out: FactsField[] = [];
  const bad: string[] = [];
  for (const f of raw) {
    if (typeof f !== 'string' || !FACTS_FIELDS.includes(f as FactsField)) {
      bad.push(String(f));
      continue;
    }
    if (!out.includes(f as FactsField)) out.push(f as FactsField);
  }
  if (bad.length) {
    const hints = bad.map((b) => {
      const near = suggestNames(b, FACTS_FIELDS);
      return near.length ? `\`${b}\`（★ 是不是想写 \`${near[0]}\`？）` : `\`${b}\``;
    });
    throw new Error(
      `facts 的 fields 里有**不认识的字段**：${hints.join('、')}\n` +
        `  ★ 可读字段（白名单，★ 只认这些）：${FACTS_FIELDS.join(' · ')}\n` +
        '  ★ 为什么必须拒（而不是忽略）：列名会拼进 SQL ⇒ 只认白名单；忽略掉等于"你要的那列没给、' +
        '却回一份看起来正常的结果"。',
    );
  }
  return out;
}

/** `limit` 校验：不给 = 缺省；给了就必须是 ≥1 的整数（形状错不静默当没给） */
function factsLimitOf(raw: number | undefined): number {
  if (raw === undefined) return FACTS_DEFAULT_LIMIT;
  if (!Number.isInteger(raw) || raw < 1) {
    throw new Error(`facts 的 limit 必须是 ≥1 的整数（收到 ${raw}）`);
  }
  return raw;
}

export interface FactsInput {
  /** 目标项目根（缺省 = cwd；与 `read` 同口径） */
  project_dir?: string;
  /** 相对项目根的路径（也接受绝对路径；落在根外 ⇒ 拒） */
  file: string;
  /** 符号名（短名或 qualified_name，**精确匹配**）；不给 ⇒ 列该文件全部符号 */
  name?: string;
  /** 要哪几列（白名单）；缺省 = 默认集（不含 body_text） */
  fields?: string[];
  /** 列全部符号时的上限（缺省 50） */
  limit?: number;
}

export interface FactsData {
  action: 'facts';
  /** 出处：`db` = `nodes` 表（**不是**从源码现切，也不是 DSL） */
  source: 'db';
  /** ★ 只有"库与源码同源"才可能走到这里 ⇒ 恒为 false（不一致时整个调用报错，不返回数据） */
  stale: false;
  project_dir: string;
  /** 索引键：相对项目根的 posix 路径 */
  file: string;
  name?: string;
  fields: FactsField[];
  limit: number;
  /** 该文件（或该名字）在库里的符号总数 */
  total: number;
  /** 本次实际返回的符号数 */
  returned: number;
  truncated: boolean;
  index: { content_hash: string; indexed_at: string; indexed_age: string };
  /** 每个符号一行；键 = 请求的字段（+ 恒返回的身份列 `name`） */
  symbols: Array<Record<string, unknown>>;
  /** 显式要了 `body_text`、但该行过不了 `readSymbolBody` 五道准入的符号（原因逐条列出，不静默给 null） */
  body_rejected?: Array<{ qualified_name: string; reason: string; detail: string }>;
}

/**
 * 从 `nodes` 表**选择性**读一个文件（或其中一个符号）的事实。
 *
 * ★ 判据全部复用下层，本函数**不重写**：
 * · 「路径 → 索引键」= `toIndexKey`（唯一住处）；
 * · 「库与源码同源」= `contentHash(当前源码) === files.content_hash`（唯一哈希）；
 * · 「body 能不能信」= `readSymbolBody`（五道准入：有行 / 有体 / 库内自洽 / 同源 / 文本对得上）。
 */
export function readFacts(input: FactsInput): { message: string; data: FactsData } {
  const root = path.resolve(input.project_dir ?? process.cwd());
  const rel = toIndexKey(root, input.file);
  if (!rel) {
    throw new Error(
      `facts 的 file 必须在项目根内：${input.file}（根 = ${root}）。\n` +
        '  ★ 索引键是"相对项目根的 posix 路径"；根外路径造不出合法键 ⇒ 拒绝（不猜你要读哪个库）。',
    );
  }

  // ── ① 字段白名单 + limit（★ 先校验，再拼 SQL）──
  const fields = factsFieldsOf(input.fields);
  const limit = factsLimitOf(input.limit);

  // ── ② 同源校验：★ 这道闸就是「事实库」与「缓存」的分界 ──
  const db = getProjectCacheDb(root);
  const fileRow = db
    .prepare('SELECT content_hash, indexed_at, size, modified_at FROM files WHERE path = $p')
    .get({ p: rel }) as
    | { content_hash: string; indexed_at: number; size: number; modified_at: number }
    | undefined;
  if (!fileRow) {
    throw new Error(
      `facts 读不到：${rel} **没有索引记录**（facts 只读索引，不建索引）。\n` +
        `  ★ 库在：${path.join(root, '.agent-io', 'cache.db')}\n` +
        `  ★ 先建索引再来：explore_code action=read file="${rel}"（它会就地补这个文件周围的索引），` +
        `或 import_project project_dir="${root}"`,
    );
  }
  const abs = path.join(root, ...rel.split('/'));
  if (!fs.existsSync(abs)) {
    throw new Error(
      `facts 拒绝返回：**文件已不存在**（${rel}）—— 索引是陈旧的。\n` +
        `  ★ files 里还留着它：content_hash=${fileRow.content_hash.slice(0, 12)}…，索引于 ` +
        `${new Date(fileRow.indexed_at).toISOString()}（${factsAge(fileRow.indexed_at)}前）\n` +
        '  ★ 为什么不给旧快照：那是"已经不存在的文件"的最后一版，照着它写 = 把死代码写回来。\n' +
        '  ★ 处理：重新索引（import_project / index_integrity refresh=true）把这条陈旧行清掉。',
    );
  }
  const src = fs.readFileSync(abs, 'utf8');
  const nowHash = contentHash(src);
  if (nowHash !== fileRow.content_hash) {
    throw new Error(
      `facts 拒绝返回：**索引过期**（文件 ${rel} 已改，索引是 ${factsAge(fileRow.indexed_at)}前的）。\n` +
        `  files.content_hash（索引时）= ${fileRow.content_hash.slice(0, 12)}…\n` +
        `  contentHash(当前源码)      = ${nowHash.slice(0, 12)}…\n` +
        `  索引时间 = ${new Date(fileRow.indexed_at).toISOString()}\n` +
        '  ★ 不返回旧快照（signature / params / body_text 都是索引那一刻的副本，可能就是旧代码）：\n' +
        '    拿着旧副本重写 = 把旧代码写回去 —— **给旧数据比报错坏得多**，所以这里只报错。\n' +
        // ★ 别在这里写"用 read 补索引"：read 走 `ensureIndexAroundSeed`，**已索引**的文件只会被
        //   "缝合"进去、**不会**重同步（实测：改完再 read 两次，files.content_hash 仍是旧值）⇒
        //   真能修的是"会做 stat 比对后重同步"的那两条。
        `  ★ 处理：① 重新索引后重试（import_project project_dir="${root}"，` +
        `或 index_integrity refresh=true —— 两者都会按 stat/hash 重同步变更文件）；` +
        `② 直接读源码：explore_code action=read file="${rel}"（read 读的是磁盘，不受这份旧索引影响）`,
    );
  }

  // ── ③ 查（★ 身份列恒取：渲染与 body 准入都要用；出参时按 `fields` 剔掉没要的）──
  const identity: FactsField[] = ['qualified_name', 'kind', 'start_line', 'end_line'];
  const selected: FactsField[] = [...fields];
  for (const f of identity) if (!selected.includes(f)) selected.push(f);
  const wantBody = fields.includes('body_text');
  if (wantBody && !selected.includes('body_hash')) selected.push('body_hash');

  let where = "file_path = $f AND kind != 'file'";
  const nameParams: Record<string, string> = { f: rel };
  if (input.name) {
    where += ' AND (name = $n OR qualified_name = $n)';
    nameParams['n'] = input.name;
  }
  const total = (db.prepare(`SELECT COUNT(*) c FROM nodes WHERE ${where}`).get(nameParams) as { c: number }).c;
  if (total === 0) {
    if (!input.name) {
      throw new Error(
        `facts 读不到：${rel} 在索引里**没有任何符号行**（文件节点在，但没解析出符号）。\n` +
          `  ★ 索引时间 ${new Date(fileRow.indexed_at).toISOString()}（${factsAge(fileRow.indexed_at)}前）—— ` +
          '这多半是解析失败留下的空壳，重新索引（read / import_project）后再看。',
      );
    }
    const names = (
      db
        .prepare("SELECT name FROM nodes WHERE file_path = $f AND kind != 'file' ORDER BY start_line LIMIT 200")
        .all({ f: rel }) as Array<{ name: string }>
    ).map((r) => r.name);
    throw new Error(
      `facts 查不到符号：${rel}#${input.name}\n` +
        `  ★ 该文件索引里有 ${names.length} 个符号：${names.slice(0, 20).join(' / ')}${names.length > 20 ? ' …' : ''}\n` +
        '  ★ 只按 `name` / `qualified_name` **精确匹配**（不做模糊）—— 名字写错就是查不到，不猜。',
    );
  }

  const cols = selected.map((f) => FACTS_COLUMNS[f]).join(', ');
  const rows = db
    .prepare(`SELECT name, ${cols} FROM nodes WHERE ${where} ORDER BY start_line, id LIMIT $lim`)
    .all({ ...nameParams, lim: limit }) as Array<Record<string, string | number | null>>;

  // ── ④ 出参：JSON 列解码 + `body_text` 过准入 + 剔掉没要的列 ──
  const symbols: Array<Record<string, unknown>> = [];
  const bodyRejected: Array<{ qualified_name: string; reason: string; detail: string }> = [];
  for (const raw of rows) {
    const row: Record<string, unknown> = { name: String(raw['name']) };
    for (const f of selected) {
      const v = raw[f];
      row[f] = FACTS_JSON_FIELDS.has(f) && typeof v === 'string' ? factsJsonOrRaw(v) : v === undefined ? null : v;
    }
    if (wantBody) {
      const qn = String(raw['qualified_name']);
      const b = readSymbolBody(db, {
        file: rel,
        qualifiedName: qn,
        startLine: Number(raw['start_line']),
        src,
      });
      if (b.ok) {
        row['body_text'] = b.body;
      } else if (b.reason === 'no_body') {
        // ★ NULL 的语义见 schema.ts：该节点没有体（type/interface/class / 该语言的体不是单一 AST 节点）——
        //   这不是"空体"，所以给 null 就是**库里的原话**，不需要额外的 reason 键。
        row['body_text'] = null;
      } else {
        row['body_text'] = null;
        bodyRejected.push({ qualified_name: qn, reason: b.reason, detail: b.detail });
      }
    }
    for (const f of selected) if (!fields.includes(f)) delete row[f];
    symbols.push(row);
  }

  // ── ⑤ 回执（★ 共 N / 返回 M 必须显式）──
  const returned = symbols.length;
  const truncated = total > returned;
  const lines: string[] = [
    `facts ${rel}${input.name ? `#${input.name}` : ''} · source=db · stale=false · ` +
      `索引于 ${new Date(fileRow.indexed_at).toISOString()}（${factsAge(fileRow.indexed_at)}前）`,
    `共 ${total} 个符号，返回 ${returned} 个${truncated ? `（limit=${limit}，★ 截断）` : ''}`,
  ];
  rows.forEach((raw, i) => {
    // ★ 签名里带换行（多行形参）会把回执列表打散 ⇒ 展示时压成一行（`data.symbols` 里仍是原文）
    const sigRaw = fields.includes('signature') && typeof raw['signature'] === 'string' ? raw['signature'] : '';
    const sig = sigRaw ? ` — ${sigRaw.replace(/\s+/g, ' ').trim()}` : '';
    lines.push(`  ${i + 1}. L${raw['start_line']}-${raw['end_line']} ${raw['kind']} ${raw['qualified_name']}${sig}`);
  });
  lines.push(
    `字段：${fields.join(' / ')}` +
      (fields.includes('body_text')
        ? ''
        : '（★ 未读 body_text：默认集不含这个重字段，要原文请 fields:["body_text"]）'),
  );
  if (bodyRejected.length) {
    lines.push(
      `★ ${bodyRejected.length} 个符号的 body_text **未返回**（准入不过，不是"没有体"）：` +
        bodyRejected.map((b) => `${b.qualified_name}（${b.reason}: ${b.detail}）`).join('；'),
    );
  }

  const data: FactsData = {
    action: 'facts',
    source: 'db',
    stale: false,
    project_dir: root,
    file: rel,
    ...(input.name ? { name: input.name } : {}),
    fields,
    limit,
    total,
    returned,
    truncated,
    index: {
      content_hash: fileRow.content_hash,
      indexed_at: new Date(fileRow.indexed_at).toISOString(),
      indexed_age: factsAge(fileRow.indexed_at),
    },
    symbols,
    ...(bodyRejected.length ? { body_rejected: bodyRejected } : {}),
  };
  return { message: lines.join('\n'), data };
}
