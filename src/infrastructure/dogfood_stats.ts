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

/**
 * ★★ 2026-10-21：**这条调用是从哪儿来的** —— 缺了它，账本分不清「agent 真在用」
 *   和「证 / 扫射 / 门在跑」。
 * ★ 实测（改前 `usage.jsonl` 16510 行、字段只有 `ts/tool/action/ok/ms/nextHops/err`）：
 *   `canvas_notes` 的 7 次成功**全挤在 4 个扫射日**（09-14 / 09-27 / 09-28 / 10-04 ——
 *   每天 49~66 个不同工具、相邻两条只隔 10ms~1.2s）⇒ 它到底被真人用过没有，**读不出来**。
 * ⇒ 只补这一个字段。★ **不回填历史行**（append-only；老行没有 `via` 就是「不知道」，不许猜）。
 */
export type DogfoodVia = 'mcp' | 'cli' | 'cert' | 'sweep' | 'gate';

export interface DogfoodUsage {
  ts: string;
  tool: string;
  /**
   * ★ 来源（由**调用方自己声明**，不在这儿猜）：
   *   · `mcp`   = 从 MCP server 进来的调用（`invokeTool` 的缺省值）
   *   · `cli`   = `presentation/cli/cli.ts`
   *   · `cert`  = `certs/*.mjs`
   *   · `sweep` = `scripts/mcp/mcp_scan.mjs` 的扫射
   *   · `gate`  = `npm run verify` 的门（同一份扫射，但由总门发起 ⇒ 与随手扫射分开记）
   * ★ 缺省（历史行）= 不知道；**不要**拿 `mcp` 去填老行。
   */
  via?: DogfoodVia;
  /** 参数化工具的子动作：explore_code=action，edit_code=op */
  action?: string;
  ok: boolean;
  ms: number;
  /** 失败时的错误消息（截断） */
  err?: string;
  /**
   * ★★ **本次回执里给了几条「下一棒」**（缺省 / 0 = 没给）—— 2026-10-06 加。
   *
   * ★ 为什么记它（**先不做收敛，靠最后的狗食去收敛**）：
   *   做减法不能靠"看列表里有什么"，得靠**频率**这个读数 ——
   *   即「**什么时候使用频率高**」。
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
  // ★ 2026-10-21：账本落点的**显式覆写**。存在的唯一理由：有些调用方为了不污染真实数据目录，
  //   主动把 `AGENT_IO_HOME` 指去沙箱（实证：`scripts/mcp/mcp_scan.mjs:64` 指向 `.inspect/_scan_home`）
  //   ⇒ ★ 那它**就算记了**也只会落在沙箱里，真实账本上仍然看不见（扫射依旧不可见）。
  //   有了这个口子，「扫射/门要不要进真实账本」变成**调用方显式声明**，而不是被 HOME 静默决定。
  // ★ 不设 ⇒ 行为与以前**逐字一致**（跟着 `getDataHome()` 走）。
  const override = process.env.AGENT_IO_DOGFOOD_FILE;
  if (override) return path.resolve(override);
  return path.join(dogfoodLogDir(), 'usage.jsonl');
}

/** 记录一次工具调用（失败静默，不阻断主流程）。 */
export function recordDogfoodUsage(u: DogfoodUsage): void {
  try {
    // ★ 2026-10-21：建的是 `logFile()` 的**父目录**（原为 `dogfoodLogDir()`）——
    //   账本可被 `AGENT_IO_DOGFOOD_FILE` 覆写到别处，建错了目录那一笔就会 ENOENT 被静默吞掉。
    fs.mkdirSync(path.dirname(logFile()), { recursive: true });
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

/** ★ 2026-10-21：按来源分组的读数（历史行没有 `via` ⇒ 记在 `'unknown'`）。 */
export interface DogfoodViaStat {
  via: DogfoodVia | 'unknown';
  calls: number;
  ok: number;
  failed: number;
}

export interface DogfoodSnapshot {
  file: string;
  /** 本次**视图**口径下的调用数（`includeSweeps=false` 时不含 sweep/gate） */
  total: number;
  /** ★ 被本次视图口径排除的行数（只有 `via=sweep|gate` 会被排除）；`--all` 时为 0 */
  excluded: number;
  /** ★ 本次视图口径**是否**含 sweep/gate */
  includeSweeps: boolean;
  /**
   * ★ `via` 分组 —— **永远统计全量**，不受 `includeSweeps` 影响。
   *   为什么：这一栏答的是「**账本里到底有什么**」，切了就不是账本读数了。
   */
  by_via: DogfoodViaStat[];
  /** 聚合口径至少覆盖这些"第一性"工具才叫正式统计 */
  tools: DogfoodToolStat[];
}

function emptyAction(): DogfoodActionStat {
  return { calls: 0, ok: 0, failed: 0 };
}

/**
 * 读取日志聚合出统计快照。
 *
 * ★★★ 2026-10-21：**两条口径，别混着看** —— 加 `via` 时顺手写清；没有这一段，`via` 加了也会被误读：
 *   ① `via='sweep'|'gate'` 的 `ok` = **零坏签名**（`scripts/mcp/mcp_scan.mjs` 的判据 ——
 *      它拿 `{}` 去撞每个工具的缺参守卫，工具回「缺参数」是**正常**，不是失败）；
 *   ② `via='mcp'|'cli'|'cert'` 的 `ok` = **handler 真返回成功**。
 *   ⇒ **不是同一把尺** ⇒ 成功率必须**按 `via` 分组**看（见 `by_via`），别加总成一个百分比。
 *
 * ★ 默认视图口径 = 「**工具被用过吗**」⇒ `via ∈ {sweep, gate}` **排除**
 *   （`includeSweeps:true` / CLI `--all` 才进来）。
 *   为什么：那两类**不是"用过"**——扫射/门每天把每个工具都碰一遍，算进来会让采纳度变成
 *   100% 的假读数（实测：`canvas_notes` 7 次成功全落在 4 个扫射日）。
 *   ★ 原始行一条不丢（账本要全：扫射/门跑了几次本身也是事实），只是**视图**默认不算。
 *
 * ★ 2026-10-21 之前的历史行没有 `via` ⇒ 归 `'unknown'`（**不回填、不猜**）。
 */
export function snapshotDogfoodStats(opts: { includeSweeps?: boolean } = {}): DogfoodSnapshot {
  const includeSweeps = opts.includeSweeps === true;
  const file = logFile();
  const tools = new Map<string, DogfoodToolStat>();
  const vias = new Map<string, DogfoodViaStat>();
  let excluded = 0;

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
  const statForVia = (via: DogfoodVia | 'unknown'): DogfoodViaStat => {
    let v = vias.get(via);
    if (!v) {
      v = { via, calls: 0, ok: 0, failed: 0 };
      vias.set(via, v);
    }
    return v;
  };

  try {
    const text = fs.readFileSync(file, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as DogfoodUsage;
        // ★ `by_via` **先记全量**（它答的是「账本里到底有什么」），再判视图口径要不要排除
        const v = statForVia(r.via ?? 'unknown');
        v.calls++;
        if (r.ok) v.ok++;
        else v.failed++;
        // ★ 视图口径：扫射 / 门跑 **不算「用过」**（原始行仍在账本里，只是不进下面的工具表）
        if (!includeSweeps && (r.via === 'sweep' || r.via === 'gate')) {
          excluded++;
          continue;
        }
        const t = ensureTool(r.tool);
        t.calls++;
        if (r.ok) t.ok++;
        else t.failed++;
        // ★ 频率的分子：本次回执里**真给了**「下一棒」的次数（0/缺省 = 没给）
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

  // ★ 固定顺序（mcp/cli/cert/sweep/gate/unknown）—— 别让输出顺序随「账本里谁先出现」而变
  // ★ `unknown` **必须排最后**：它占 99%+，排第一会把 cli/cert/sweep/gate 这四行挤到看不见的地方（team-lead 2026-10-21 指出）
  const VIA_ORDER: Array<DogfoodVia | 'unknown'> = ['mcp', 'cli', 'cert', 'sweep', 'gate', 'unknown'];
  const by_via = [...vias.values()].sort((x, y) => VIA_ORDER.indexOf(x.via) - VIA_ORDER.indexOf(y.via));
  // 稳定排序：工具名 alphabetically；动作名按出现序（保留 object 插入序即可）
  const list = [...tools.values()].sort((x, y) => x.tool.localeCompare(y.tool));
  const total = list.reduce((n, t) => n + t.calls, 0);
  return { file, total, excluded, includeSweeps, by_via, tools: list };
}

/** 人类可读报告（正式统计的默认出口）。 */
export function renderDogfoodSnapshot(s: DogfoodSnapshot): string {
  const lines = [
    `狗食使用统计 · 共 ${s.total} 次工具调用${s.includeSweeps ? '（含 sweep/gate）' : ''}`,
    `  日志: ${s.file}`,
  ];
  // ★★ 2026-10-21：**先把 unknown 的来头说清**（放在表前面，别等读者自己猜）。
  //   不说 ⇒ 读的人会以为「via 分类做完了，99.8% 都判不出来」；
  //   说了 ⇒ 他知道「这是**历史行的边界**，不是分类器的缺陷」。
  //   ★ 数字**由数据算**（不写死 16574 —— 写死的计数一定会过期，本仓纪律）。
  const unknownVia = s.by_via.find((v) => v.via === 'unknown');
  if (unknownVia && unknownVia.calls > 0) {
    lines.push(
      '',
      `★ via 自 2026-10-21 起记录；此前的 **${unknownVia.calls}** 行**无法判定归属**（不回填），显示为 unknown —— 这是历史行的边界，不是分类器的缺陷。`,
    );
  }
  // ★★ 2026-10-21：**按 via 分组**（最小做法：一张小表放在工具表前面，工具表的形状一个字没动）。
  //   为什么必须有：`via` 不显示出来 = 加了没人看见 = 等于没加。
  lines.push('', '按 via 分组（★ 口径不同，成功率**别混着算**）：', '| via | 调用 | 成功 | 失败 | 成功率 |', '|---|---|---|---|---|');
  for (const v of s.by_via) {
    const rate = v.calls > 0 ? `${Math.round((v.ok / v.calls) * 100)}%` : '—';
    const name = v.via === 'unknown' ? 'unknown（历史行）' : v.via;
    lines.push(`| ${name} | ${v.calls} | ${v.ok} | ${v.failed} | ${rate} |`);
  }
  lines.push(
    '  · via=sweep|gate 的「成功」= **零坏签名**（门的判据）；via=mcp|cli|cert 的 = handler 真返回成功',
    // ★ 排在最后、并**明说为什么**：它占 99%+，排第一会把有信息的那四行挤到看不见的地方
    '  · unknown **排在最后**：它占绝大多数，排第一会把 cli/cert/sweep/gate 四行淹没',
  );
  if (!s.includeSweeps && s.excluded > 0) {
    lines.push(`  · ★ 下表已**排除** via=sweep|gate 的 ${s.excluded} 次（扫射 / 门跑**不算「用过」**）；看全量加 --all`);
  }
  lines.push('', '| 工具 | 调用 | 成功 | 失败 | 成功率 |', '|---|---|---|---|---|');
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
  // ★★ 2026-10-06：「下一棒」提示的**频率** —— 收敛靠狗食，这就是那份原料。
  const hinted = s.tools.reduce((n, t) => n + t.hinted, 0);
  if (hinted > 0) {
    const pct = s.total > 0 ? Math.round((hinted / s.total) * 100) : 0;
    lines.push('');
    lines.push(`★ 「下一棒」提示：**${hinted} / ${s.total}** 次调用带提示（${pct}%）—— 按工具看「频率」就是收敛的原料。`);
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
  // ★ 2026-10-21：简洁口径也要说清「排掉了多少」—— 不然读者会以为这就是全量
  if (!s.includeSweeps && s.excluded > 0) {
    lines.push(`★ 已排除 via=sweep|gate 的 ${s.excluded} 次（扫射 / 门跑**不算「用过」**）；加 --all 看全量`);
  }
  return lines.join('\n');
}

/** CLI 入口：node dist/src/tools/dogfood_stats.js [--by-action|--summary] */
export function runDogfoodCLI(argv: string[]): void {
  const summaryOnly = argv.includes('--summary') || argv.includes('-s');
  // ★★ 2026-10-21：`--all` = 把 via=sweep|gate 的行也算进工具表。
  //   默认**排除**（扫射 / 门跑不算「用过」），理由见 snapshotDogfoodStats 的注释。
  const includeSweeps = argv.includes('--all') || argv.includes('-a');
  const s = snapshotDogfoodStats({ includeSweeps });
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