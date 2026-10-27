/**
 * rewrite_plan.ts —— **重写计划（画布）** 的读写口：`<proj>/.agent-io/plan/<rel>.plan.json`。
 *
 * ## 它是什么（一段话）
 * 写源码前必须"通读设计指向的区域 → 选定范围 → 写完细节"。那些**选择与细节**就落在这里，
 * 一条 entry = 一处改动。**它替代的是"agent 脑子里的计划"** —— 上下文一压缩就没了的东西。
 *
 * ## 为什么它必须入库、且与底片分家
 * · `design-db/<rel>.calls.json`（**底片**）= 从 `cache.db` 派生的**事实**，整目录被 gitignore；
 * · 本文件的计划是**意图**（人/模型写、算不出来）⇒ 必须进 git，否则换机/clean 就丢。
 *   ⇒ 两个文件、两个家，各自一条判据（`t378` 管同构、`t379` 管这份计划不被生成器吃掉）。
 *
 * ## 纪律
 * · **生成器永不写它**（`gen_design_db` 只读不写）；
 * · 写盘用 `temp + rename`（半份计划比没有计划更坏）；
 * · `status:'stale'` = 锚点在当前代码里对不上（**只标不删**，等人看）；
 * · 空计划 = 没有计划（不是"计划为空"）：闸按"必须有 entries"判。
 */
import fs from 'node:fs';
import path from 'node:path';
import { rootPath } from '../../../infrastructure/roots.js';

/** 一处改动的意图 */
export interface RewritePlanEntry {
  /**
   * 锚点：**只用符号名**（`cache.db` 的 `nodes.name`）。
   * ★ 不用行号：任何一次插入都会让它整体漂移（`sym_hash` 才是"这段变没变"的判据）。
   */
  anchor: { symbol: string };
  /** rewrite = 改现有符号；create = 新建（骨架还没生成）；delete = 删除 */
  kind: 'rewrite' | 'create' | 'delete';
  /** 要改成什么样（一句话，够下一个 agent 接着写） */
  detail: string;
  /** ★ 必填：拿什么验（证/判据引用）。说不出怎么验的细节 = 没写完 */
  judgement_ref: string;
  /** open = 待做；stale = 锚点对不上（只标不删）；done = 源码已到位且判据转绿 */
  status: 'open' | 'stale' | 'done';
  /** 行号只作注记，**不参与判定** */
  note?: string;
}

/** 一个路径的整份画布 */
export interface RewritePlan {
  /** 源码仓库相对路径（posix），与底片的 `path` 一一对应 */
  path: string;
  /** 冻结时刻（这一刻起本块权威 = 本文件；`gen-db` 只报 drift 不覆盖） */
  frozen_at?: string;
  /** 冻结那一刻的底片指纹（用文件内容哈希，便于判"底片换没换"） */
  base?: { content_hash?: string };
  entries: RewritePlanEntry[];
  /**
   * ★★★ 2026-10-28（用户："模型喜欢补丁式修改，这套流程应该强迫全貌浏览"）：
   * **该文件里"我看过、但不动"的符号** —— 每个符号要么在 `entries`（要改），要么在这里（不动 + 为什么）。
   *
   * ## 为什么要它
   * 只有 `entries` 的话，"计划里只列 1 个符号、也只改这 1 个符号"是**完全合规的补丁式修改** ——
   * 全貌浏览仍然靠自觉。加了这一格，"通读"才有了**可判形态**：漏掉的符号会以"**未表态**"被抓出来。
   * ★ 判据不住这里（这里是形状）：判定在 `planCoverageGaps`。
   */
  untouched?: Array<{ symbol: string; why: string }>;
}

/** 计划目录：`<proj>/.agent-io/plan`（`rootsOf().plan` 的唯一解析器，别在别处再拼） */
export function planDir(projectRoot: string): string {
  return rootPath('plan', path.resolve(projectRoot));
}

/** 某个源码路径的计划文件：`<planDir>/<rel>.plan.json` */
export function planFileFor(projectRoot: string, relPath: string): string {
  const rel = relPath.split(path.sep).join('/').replace(/^\/+/, '');
  return path.join(planDir(projectRoot), `${rel}.plan.json`);
}

/** 读计划（没有就 null —— **不造假计划**） */
export function readRewritePlan(projectRoot: string, relPath: string): RewritePlan | null {
  const file = planFileFor(projectRoot, relPath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as RewritePlan;
  } catch {
    return null; // 坏文件当"没有"（闸会拒写 ⇒ 响亮），不在读侧抛
  }
}

/** 写计划（temp + rename：不留半份） */
export function writeRewritePlan(projectRoot: string, plan: RewritePlan): string {
  const file = planFileFor(projectRoot, plan.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
  return file;
}

/**
 * 计划**是否够格放行写源码**（准入闸的唯一判据；`t379` 就是打它的证）。
 * @returns 不合格的原因（空数组 = 合格）
 */
export function planGaps(plan: RewritePlan | null): string[] {
  if (!plan) return ['没有重写计划（`plan/<rel>.plan.json` 不存在）⇒ 先通读 + 选范围 + 写细节'];
  const gaps: string[] = [];
  if (!plan.entries.length) gaps.push('计划里 0 条改动 ⇒ 先说明要改哪个符号、改成什么');
  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    if (!e.anchor?.symbol) gaps.push(`${who} —— 缺锚点（只用符号名，别用行号）`);
    if (!e.detail?.trim()) gaps.push(`${who} —— 缺 detail（要改成什么样）`);
    if (!e.judgement_ref?.trim()) gaps.push(`${who} —— 缺 judgement_ref（拿什么验）`);
    if (e.status === 'stale') gaps.push(`${who} —— 锚点已过期（stale）⇒ 先核对再改`);
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（迭代 ③）：**"通读"的可判形态** —— 该文件的符号是否**逐个表过态**。
 *
 * 判据：文件名里的符号（实际 DB 的 `nodes`，排除 `kind='file'`）**每一个**必须满足其一：
 *   ① 在 `entries[].anchor.symbol` 里（要改）；② 在 `untouched[].symbol` 里（不动 + 有理由）。
 * 两者都没有 ⇒ **未表态** ⇒ 报出来（默认档点名，严格档拦）。
 *
 * ★ 为什么这是"强迫全貌"的那一格：没有它，模型可以只列 1 个符号改 1 个符号，
 *   全程合规，而**文件里其他 20 个符号它根本没看**。有了它，"没看"会变成一条可见的缺口。
 * ★ 纯函数（符号清单由调用方从实际 DB 取）：这样判据可单测，且不把 `cache.db` 依赖塞进本模块。
 */
export function planCoverageGaps(plan: RewritePlan | null, symbolsInFile: readonly string[]): string[] {
  if (!plan) return [];
  const planned = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const declared = new Set((plan.untouched ?? []).map((u) => u.symbol).filter(Boolean));
  const silent = [...new Set(symbolsInFile)].filter((s) => !planned.has(s) && !declared.has(s));
  if (!silent.length) return [];
  return [
    `该文件有 ${silent.length} 个符号**没表态**（既不在 \`entries\`、也不在 \`untouched\`）：${silent.slice(0, 6).join(', ')}` +
      (silent.length > 6 ? ` 等 ${silent.length} 个` : '') +
      `\n      ⇒ 要么把它写进 entries（要改），要么写进 untouched（看过、不动，附一句 why）`,
  ];
}

/** `untouched` 的每条都要有理由（空理由 = 等于没表态） */
export function planUntouchedGaps(plan: RewritePlan | null): string[] {
  if (!plan?.untouched?.length) return [];
  const bad = plan.untouched.filter((u) => !u.symbol?.trim() || !u.why?.trim());
  if (!bad.length) return [];
  return [`untouched 里有 ${bad.length} 条缺 symbol 或 why（空理由 = 没表态）`];
}