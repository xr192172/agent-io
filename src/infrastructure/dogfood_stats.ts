/**
 * dogfood_stats —— 工具使用"正式统计"（狗食量化）
 *
 * agent-io 作为 AI 第一性工具的采纳度怎么量？—— 在统一调度咽喉
 * (server_registry registerAllTools) 记录每次工具调用结果，落盘 JSONL：
 *   <dataHome>/.agent-io/dogfood/usage.jsonl
 *
 * 每条记录 = { ts, tool, action?, ok, ms, err? }
 *   - tool    : 工具名（explore_code / edit_code / get_dsl / ...）
 *   - action  : 参数化工具的子动作（explore_code.search / edit_code.replace ...）
 *   - ok      : handler 是否返回成功（!isError）
 *   - err     : 失败时的错误消息（截断，防撑爆单行）
 *
 * 设计取向：
 *   - 零侵入：记录失败（无目录/无权限）静默吞掉，绝不阻断工具主流程
 *   - 成本：每次调用一次 io append，可忽略
 *   - 只加不减：不提供删除/清空入口（原始日志两层分离：raw 全量 + LLM 聚合）
 */
import { DATA_DIR_NAME } from './data_dir.js';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDataHome } from './storage.js';

export interface DogfoodUsage {
  ts: string;
  tool: string;
  /** 参数化工具的子动作：explore_code=action，edit_code=op */
  action?: string;
  ok: boolean;
  ms: number;
  /** 失败时的错误消息（截断） */
  err?: string;
  /**
   * ★★ **本次回执里给了几条「下一棒」**（缺省 / 0 = 没给）—— 2026-10-06 加。
   *
   * ★ 为什么记它（用户裁定：「**先不做收敛**，靠**最后的狗食**去收敛」）：
   *   做减法不能靠"看列表里有什么"，得靠**频率**这个读数 —— 正是用户问的
   *   「**什么时候使用频率高**」。
   * ★ 口径 = `nextHopsOf(tool).length`（**具体对象边**的条数）；
   *   **不含**"全称规则"那 2 行（那是背景规则，不随工具变 ⇒ 记了也不区分工具）。
   */
  nextHops?: number;
}

const MAX_ERR_LEN = 200;

/** dogfood 日志目录（`<dataHome>/.agent-io/dogfood`）。★ T19：导出它 ⇒ 「归哪个根」可见（owner: dataHome）。 */
export function dogfoodLogDir(): string {
  return path.join(getDataHome(), DATA_DIR_NAME, 'dogfood');
}
function logFile(): string {
  return path.join(dogfoodLogDir(), 'usage.jsonl');
}

/** 记录一次工具调用（失败静默，不阻断主流程）。 */
export function recordDogfoodUsage(u: DogfoodUsage): void {
  try {
    fs.mkdirSync(dogfoodLogDir(), { recursive: true });
    fs.appendFileSync(logFile(), JSON.stringify(u) + '\n', 'utf-8');
  } catch {
    /* 记录失败不影响工具主流程 */
  }
}

/** 子动作明细统计。 */
export interface DogfoodActionStat {
  calls: number;
  ok: number;
  failed: number;
}

export interface DogfoodToolStat {
  tool: string;
  calls: number;
  ok: number;
  failed: number;
  /** 按子动作聚合（explore_code.action / edit_code.op）；无子动作的记在 key='—' */
  by_action: Record<string, DogfoodActionStat>;
  /** ★ 带「下一棒」提示的调用数（**频率的分子**）—— 收敛的原料，见 `DogfoodUsage.nextHops` */
  hinted: number;
}

export interface DogfoodSnapshot {
  file: string;
  total: number;
  /** 聚合口径至少覆盖这些"第一性"工具才叫正式统计 */
  tools: DogfoodToolStat[];
}

function emptyAction(): DogfoodActionStat {
  return { calls: 0, ok: 0, failed: 0 };
}

/** 读取日志聚合出统计快照。 */
export function snapshotDogfoodStats(): DogfoodSnapshot {
  const file = logFile();
  const tools = new Map<string, DogfoodToolStat>();

  const ensureTool = (tool: string): DogfoodToolStat => {
    let t = tools.get(tool);
    if (!t) {
      t = { tool, calls: 0, ok: 0, failed: 0, by_action: {}, hinted: 0 };
      tools.set(tool, t);
    }
    return t;
  };
  const statFor = (t: DogfoodToolStat, action: string): DogfoodActionStat => {
    let a = t.by_action[action];
    if (!a) {
      a = emptyAction();
      t.by_action[action] = a;
    }
    return a;
  };

  try {
    const text = fs.readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as DogfoodUsage;
        const t = ensureTool(r.tool);
        t.calls++;
        if (r.ok) t.ok++;
        else t.failed++;
        // ★ 频率的分子：本次回执里**真给了**"下一棒"的次数（0/缺省 = 没给）
        if (typeof r.nextHops === 'number' && r.nextHops > 0) t.hinted++;
        const a = statFor(t, r.action ?? '—');
        a.calls++;
        if (r.ok) a.ok++;
        else a.failed++;
      } catch {
        /* 单行损坏跳过，不阻断聚合 */
      }
    }
  } catch {
    /* 无日志文件 → 空快照 */
  }

  // 稳定排序：工具名 alphabetically；动作名按出现序（保留 object 插入序即可）
  const list = [...tools.values()].sort((x, y) => x.tool.localeCompare(y.tool));
  const total = list.reduce((n, t) => n + t.calls, 0);
  return { file, total, tools: list };
}

/** 人类可读报告（正式统计的默认出口）。 */
export function renderDogfoodSnapshot(s: DogfoodSnapshot): string {
  const lines = [
    `狗食使用统计 · 共 ${s.total} 次工具调用`,
    `  日志: ${s.file}`,
    '',
    '| 工具 | 调用 | 成功 | 失败 | 成功率 |',
    '|---|---|---|---|---|',
  ];
  for (const t of s.tools) {
    const rate = t.calls > 0 ? `${Math.round((t.ok / t.calls) * 100)}%` : '—';
    lines.push(`| ${t.tool} | ${t.calls} | ${t.ok} | ${t.failed} | ${rate} |`);
    // 参数化工具展开子动作明细
    const actions = Object.entries(t.by_action);
    if (actions.length > 1 || (actions.length === 1 && actions[0][0] !== '—')) {
      for (const [act, a] of actions) {
        const ar = a.calls > 0 ? `${Math.round((a.ok / a.calls) * 100)}%` : '—';
        lines.push(`| &nbsp;&nbsp;↳ ${act} | ${a.calls} | ${a.ok} | ${a.failed} | ${ar} |`);
      }
    }
  }
  // ★★ 2026-10-06：「下一棒」提示的**频率** —— 用户裁定"收敛靠狗食"，这就是那份原料。
  const hinted = s.tools.reduce((n, t) => n + t.hinted, 0);
  if (hinted > 0) {
    const pct = s.total > 0 ? Math.round((hinted / s.total) * 100) : 0;
    lines.push('');
    lines.push(`★ 「下一棒」提示：**${hinted} / ${s.total}** 次调用带提示（${pct}%）—— 按工具看"频率"就是收敛的原料。`);
  }
  return lines.join('\n');
}

/** 仅打印聚合口径内工具（explore_code/edit_code/diff_views/get_dsl/render_design/import_project）的简洁口径。 */
export function renderDogfoodSummary(s: DogfoodSnapshot): string {
  const keys = ['explore_code', 'edit_code', 'get_dsl', 'render_design', 'import_project', 'diff_views', 'scaffold', 'consistency_check'];
  const lines: string[] = [];
  for (const k of keys) {
    const t = s.tools.find((x) => x.tool === k);
    if (!t) continue;
    const rate = t.calls > 0 ? `${Math.round((t.ok / t.calls) * 100)}%` : '—';
    lines.push(`${k}: ${t.calls} 次 (成功 ${t.ok} / 失败 ${t.failed} / 成功率 ${rate})`);
  }
  // ★ 简洁口径也带上频率（只在真给过提示时才出现，免得给没接链的人加噪音）
  const hinted = s.tools.filter((t) => t.hinted > 0).map((t) => `${t.tool}: ${t.hinted}/${t.calls}`);
  if (hinted.length) lines.push(`★ 带「下一棒」提示：${hinted.join(' · ')}`);
  return lines.join('\n');
}

/** CLI 入口：node dist/src/tools/dogfood_stats.js [--by-action|--summary] */
export function runDogfoodCLI(argv: string[]): void {
  const summaryOnly = argv.includes('--summary') || argv.includes('-s');
  const s = snapshotDogfoodStats();
  const text = summaryOnly ? renderDogfoodSummary(s) : renderDogfoodSnapshot(s);
  console.log(text);
}

const isMain = import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? '')).href;
if (isMain) {
  try {
    runDogfoodCLI(process.argv.slice(2));
  } catch (e) {
    console.error('dogfood-stats:', (e as Error).message);
    process.exitCode = 1;
  }
}