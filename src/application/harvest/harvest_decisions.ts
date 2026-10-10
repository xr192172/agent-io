/**
 * harvest_decisions：从文档 / git 日志 / 注释提取设计意图**决策线索（candidate leads）**。
 *
 * 背景（决策卡补录）：现有项目（尤其外来/历史代码）没有决策卡历史，直接扫描必然失真。
 * 本工具不直接写 DSL——只做**机器能判的那一刀**（形状过滤，见 impossibleShapeOf），
 * 先取证（出处 ref + 原文 evidence + 一句话 draft_summary），产出可复核的**线索**。
 * ★ 它产出的是「线索」而非「决策卡」：定稿成卡（status: active）是**下一步**，当前**不存在**该步。
 *   本工具**不**判"结论 / 理由 / 作用对象"三要素——那是**判断**（属"提案 → 定稿"），不是机器判据。
 *
 * 与契约（harvest-decisions DSL expected_apis）对齐：
 *   harvestDecisions(input: { feature; doc_dir?; git_root?; limit?; comment_files? }) → HarvestResult
 *
 * 策略（启发式，不假装精确）：
 *   - gitlog：最近提交 subject 里含设计意图关键词 → feature 级候选
 *   - doc：扫描 *.md 的标题/列表/段落，含设计意图关键词 → feature 级候选（ref=文件:行）
 *   - comment：显式指定源码文件，抓 JSDoc 注释块 → 文件级候选（ref=文件:行）
 *   - lifecycle_hint：evidence 含 下线/弃用/合并/取代/拆分 → 提示 lifecycle 演进，供 diff/归档参考
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gitAvailable } from '../../infrastructure/exec_guard.js';
import { withTouched, type Touched, type TouchedProduct } from '../../domain/b_terms.js';

export type HarvestSource = 'doc' | 'gitlog' | 'comment';

export interface LifecycleHint {
  type: 'retired' | 'merged' | 'superseded' | 'split';
  detail: string;
}

/** 一条可复核的**决策线索**（candidate lead；draft，未写入 DSL。定稿成决策卡是下一步） */
export interface HarvestCandidate {
  /** 挂载目标：feature 级用 feature 名；注释提取用文件相对路径 */
  file_path: string;
  source: HarvestSource;
  /** 出处（doc: 路径:行 / gitlog: hash / comment: 文件:行），复核依据 */
  ref: string;
  /** 提炼的一句话结论（draft，LLM review 后定稿） */
  draft_summary: string;
  /** 原始证据片段（可复核原文） */
  evidence: string;
  /** 推断的功能线 */
  thread?: string;
  /** 自由标签 */
  tags?: string[];
  /** 生命周期提示（下线/合并/取代/拆分），供 diff 与归档参考 */
  lifecycle_hint?: LifecycleHint;
}

export interface HarvestResult {
  message: string;
  feature: string;
  candidates: HarvestCandidate[];
}

export interface HarvestInput {
  /** feature 名（候选挂载目标） */
  feature: string;
  /** 文档目录（扫描 *.md），默认 <cwd>/docs */
  doc_dir?: string;
  /** git 仓库根（读 git log），默认 <cwd> */
  git_root?: string;
  /** git 日志条数上限，默认 30 */
  limit?: number;
  /** 显式指定要提取注释的源码文件（绝对路径） */
  comment_files?: string[];
}

// 设计意图关键词（启发式，宁多勿漏；draft 态保证后续复核）
const INTENT_KW = [
  '因为', '由于', '为了避免', '为避免', '为防止', '选择', '采用', '不用', '放弃', '不采用',
  '权衡', '约束', '设计方案', '方案', '设计', '弃用', '取代', '合并', '拆分', '下线',
  '为保证', '为支持', '以解决', '解决', '防止', '需要', '必须', '替代',
];

const LIFECYCLE_RULES: Array<{ kw: string[]; type: LifecycleHint['type'] }> = [
  { kw: ['弃用', '下线', '废弃', '删除'], type: 'retired' },
  { kw: ['合并', '并入'], type: 'merged' },
  { kw: ['取代', '替代', '替换'], type: 'superseded' },
  { kw: ['拆分', '拆开'], type: 'split' },
];

function lifecycleHint(text: string): LifecycleHint | undefined {
  for (const rule of LIFECYCLE_RULES) {
    for (const kw of rule.kw) {
      if (text.includes(kw)) {
        const idx = text.indexOf(kw);
        return { type: rule.type, detail: text.slice(Math.max(0, idx - 20), idx + 30).replace(/\s+/g, ' ').trim() };
      }
    }
  }
  return undefined;
}

function hasIntent(text: string): boolean {
  return INTENT_KW.some((k) => text.includes(k));
}

// ──────── git 日志提取 ────────

function gitLogEntries(gitRoot: string, limit: number): Array<{ hash: string; subject: string }> {
  // ★ 先过 exec_guard：环境里没有 git 时 spawn 会白等约 5.1 秒（实测本工具 5169ms → ~0ms）
  if (!gitAvailable()) return [];
  try {
    const out = execSync(`git log -n ${limit} --pretty=format:%H%x09%s`, {
      cwd: gitRoot,
      encoding: 'utf-8',
      maxBuffer: 4 * 1024 * 1024,
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf('\t');
        return tab > 0 ? { hash: line.slice(0, tab).slice(0, 8), subject: line.slice(tab + 1) } : null;
      })
      .filter((x): x is { hash: string; subject: string } => x !== null);
  } catch {
    return []; // 非 git 仓库或无 git：静默跳过
  }
}

// ──────── 文档提取 ────────

function collectMdFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.md')) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// ──────── 形状判据（唯一住处） ────────

/**
 * 一行"**形状上就不可能是决策**"的类别。判据逐条给出**为什么**这条形状不可能承载决策。
 */
type ImpossibleShape =
  /** 落在 markdown 代码围栏（``` / ~~~）内的行 —— 那是示例代码/命令，不是本仓的决定。
   *  ★ 实测教训：`// 要 import 边才填（…否则测试红…）` 这类**代码注释**行含"必须/否则"，
   *    会**混过**只看行首的意图关键词检查；它藏在这里面 ⇒ 围栏内的行必须一律排除。 */
  | 'code_fence'
  /** 以 `|` 开头 —— markdown **表格行**：一个单元格是列/行数据，不是一句结论。 */
  | 'table_row'
  /** 以 `>` 开头 —— **引用块**：引用/转述别人的话，不是本仓自己做的决定。 */
  | 'blockquote'
  /** 以 `#` 开头 —— **章节标题**：是结构标签（章节名），决定在它下面的正文里。 */
  | 'heading'
  /** 以 `//` / `/*` 开头 —— **源码注释**：注释不是文档里的决策陈述。 */
  | 'code_comment'
  /** `·`/`-`/`*`/`+`/`1.` 开头且标记后**只剩很短的标签**（< {@link MIN_CLAUSE_LEN}）——
   *  **纯列表项**：不成句、无谓词，承载不了"结论 + 理由"。
   *  ★ 长列表项（含谓词/理由的整句）**不在此列** —— 它可以是决策线索，不许一刀切。 */
  | 'list_fragment'
  /** 以 `：` `,` `，` `（` `(` 结尾 —— **半句话**：后面还有下文，结论不成句。 */
  | 'half_sentence';

/** 与既有 `clean.length < 12` 对齐：短于此长度不成句 ⇒ 视为纯标签。 */
const MIN_CLAUSE_LEN = 12;

interface ShapeVerdict {
  /** 命中 ⇒ 形状上不可能是决策；null ⇒ 未被形状否决（仍可能是决策线索） */
  shape: ImpossibleShape | null;
  /** 该行是标题时给出标题文本（供后续段落作 `thread` 上下文）；否则 undefined */
  headingText?: string;
}

/**
 * ★ **形状判据 —— 唯一住处**：判断一行是否"在形状上就不可能是决策"。
 *
 * 所有形状规则只在这里判一次；调用方（{@link scanDocs}）**不得**再散落行首 if（那正是本仓
 * 撞过的病灶：零判别 ⇒ 表格行/引用块/代码围栏混进"决策线索"，好的被淹掉）。
 *
 * 返回 null 只表示"形状上不作否决"，**不等于**这行就是决策——那需要 LLM/人进一步判断。
 */
function impossibleShapeOf(rawLine: string, opts: { inFence: boolean }): ShapeVerdict {
  const t = rawLine.trim();
  // ① 代码围栏内一律不是决策（先于一切行首规则；注释行能混过行首检查，靠这条挡住）
  if (opts.inFence) return { shape: 'code_fence' };
  // ② 表格行
  if (t.startsWith('|')) return { shape: 'table_row' };
  // ③ 引用块
  if (t.startsWith('>')) return { shape: 'blockquote' };
  // ④ 标题（顺带取出标题文本，供章节上下文）
  const h = t.match(/^#{1,6}\s*(.*)$/);
  if (h) return { shape: 'heading', headingText: h[1].trim() };
  // ⑤ 源码注释
  if (/^\/[/*]/.test(t)) return { shape: 'code_comment' };
  // ⑥ 纯列表项：标记后仅剩很短的标签
  const bullet = t.match(/^([·•\-*+]|\d+[.、)])\s+(.*)$/);
  if (bullet && bullet[2].trim().length < MIN_CLAUSE_LEN) return { shape: 'list_fragment' };
  // ⑦ 半句话：以"话没说完"的标点收尾
  if (/[：,，（(]\s*$/.test(t)) return { shape: 'half_sentence' };
  return { shape: null };
}

/**
 * 每行"是否落在代码围栏内"（含围栏标记行本身）——返回 **0 基行号**集合。
 *
 * ★ 围栏必须**成对**才算数（这里是"实测边界"，不是防御性补丁）：
 *   本仓实测 `docs/observe-unification.md:76` 只有**一个开栅 ``` 、无闭栅**。
 *   若按"见标记就切换开关"的老写法，会把该文件**第 76 行到末尾整段**误判成围栏
 *   ⇒ 真线索被整片吞掉（实测：该文件 12 条候选 → 0 条）。
 *   故先按行号两两配对（1-2、3-4 …）；**落单的尾部标记视作非围栏**（当普通行走后续长度/意图判断）。
 */
function fencedLines(lines: string[]): Set<number> {
  const markers: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(```|~~~)/.test(lines[i].trim())) markers.push(i);
  }
  const fenced = new Set<number>();
  for (let k = 0; k + 1 < markers.length; k += 2) {
    for (let i = markers[k]; i <= markers[k + 1]; i++) fenced.add(i);
  }
  return fenced;
}

function scanDocs(docDir: string): HarvestCandidate[] {
  const candidates: HarvestCandidate[] = [];
  for (const md of collectMdFiles(docDir)) {
    if (!fs.existsSync(md)) continue;
    const lines = fs.readFileSync(md, 'utf-8').split('\n');
    const fenced = fencedLines(lines);
    let heading = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const shape = impossibleShapeOf(line, { inFence: fenced.has(i) });
      if (shape.headingText !== undefined) heading = shape.headingText;
      if (shape.shape) continue; // 形状上就不可能是决策 ⇒ 交出它=噪声
      // 列表项/段落：去掉 markdown 装饰后判断是否有设计意图
      const clean = line.replace(/^[-*•+]\s+/, '').replace(/^\d+[.、)]\s+/, '').trim();
      if (clean.length < MIN_CLAUSE_LEN || !hasIntent(clean)) continue;
      const ref = `${path.relative(process.cwd(), md) || md}:${i + 1}`;
      candidates.push({
        file_path: '',
        source: 'doc',
        ref,
        draft_summary: `[${heading || path.basename(md)}] ${clean.slice(0, 80)}${clean.length > 80 ? '…' : ''}`,
        evidence: clean.slice(0, 200),
        thread: heading || undefined,
        lifecycle_hint: lifecycleHint(clean),
      });
    }
  }
  return candidates;
}

// ──────── 注释提取 ────────

function scanComments(files: string[]): HarvestCandidate[] {
  const candidates: HarvestCandidate[] = [];
  for (const f of files) {
    if (!fs.existsSync(f) || !/\.(ts|tsx|js|jsx|go|py)$/.test(f)) continue;
    const content = fs.readFileSync(f, 'utf-8');
    const blockRe = /\/\*\*([\s\S]*?)\*\//g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(content)) !== null) {
      const block = m[1];
      const lines = block.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean);
      if (lines.length === 0) continue;
      const first = lines[0];
      // 意图判断放宽到整块（首行常是描述性文字，rationale 在后续行才出现"因为/避免"）
      if (!hasIntent(lines.join(' '))) continue;
      const lineNo = content.slice(0, m.index).split('\n').length;
      const rel = path.relative(process.cwd(), f) || f;
      candidates.push({
        file_path: rel,
        source: 'comment',
        ref: `${rel}:${lineNo}`,
        draft_summary: first.slice(0, 100),
        evidence: lines.slice(0, 6).join(' ').slice(0, 240),
        lifecycle_hint: lifecycleHint(lines.join(' ')),
      });
    }
  }
  return candidates;
}

// ──────── 主入口 ────────

function harvestDecisionsCore(input: HarvestInput): HarvestResult {
  const { feature } = input;
  const limit = input.limit ?? 30;
  const gitRoot = input.git_root ?? process.cwd();
  const docDir = input.doc_dir ?? path.join(process.cwd(), 'docs');

  const candidates: HarvestCandidate[] = [];

  // git 日志：提交 subject 即"为什么改"的一手线索
  for (const { hash, subject } of gitLogEntries(gitRoot, limit)) {
    if (!hasIntent(subject)) continue;
    candidates.push({
      file_path: feature,
      source: 'gitlog',
      ref: `git:${hash}`,
      draft_summary: subject,
      evidence: subject,
      tags: ['gitlog'],
      lifecycle_hint: lifecycleHint(subject),
    });
  }

  // 文档：设计意图段落
  candidates.push(...scanDocs(docDir));

  // 注释：显式指定的源码文件
  if (input.comment_files?.length) candidates.push(...scanComments(input.comment_files));

  const lines = [
    `harvest_decisions [${feature}] 提取到 ${candidates.length} 条决策线索（candidate leads，draft，未写入 DSL）`,
    `  来源分布: gitlog ${candidates.filter((c) => c.source === 'gitlog').length} · doc ${candidates.filter((c) => c.source === 'doc').length} · comment ${candidates.filter((c) => c.source === 'comment').length}`,
    '',
    ...candidates.map((c, i) => {
      const lh = c.lifecycle_hint ? `  ⚠ lifecycle:${c.lifecycle_hint.type}` : '';
      const th = c.thread ? `  [${c.thread}]` : '';
      return `  ${i + 1}. [${c.source}] ${c.draft_summary}${th}${lh}\n      ↳ 出处: ${c.ref}\n      ↳ 证据: ${c.evidence}`;
    }),
    '',
    '用法: 逐条 review 上述**线索**（核对出处/原文）自行判断是否成决策；定稿成决策卡是**下一步**（当前无此步），本工具不写 DSL。',
  ];
  return { message: lines.join('\n'), feature, candidates };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 口径（`Touched` 两类字段，见 domain/b_terms.ts:42-89）：
 *   - 作用域类（`project_dir` / `feature`）：随时可给，不依赖成败；
 *   - 对象类（`written_files` / `symbols` / `nodes`）：只有**真发生**才给，否则整项省略。
 */
function touchedOf(input: HarvestInput): Touched {
  const touched: Touched = {};

  // feature：作用域类，随时可给（入参必填）。★ 产物顶层**也有** `feature`，属"同一事实两个名字"
  //   （见报告单列项）。
  touched.feature = input.feature;

  // ★ 不给 project_dir：入参里**没有** project_dir —— 只有 `doc_dir`（默认 <cwd>/docs）与
  //   `git_root`（默认 <cwd>）。二者都不是"被分析项目的根"，且缺省会回落 `process.cwd()`
  //   （那是"进程当前目录"，不是本次调用**确立的对象**）。按"不猜"口径 ⇒ **整项省略**。

  // ★ 不给 read_files（2026-10-05，T56 ④-1）：它是"剪贴板"不是链的接口 ⇒ 已从 `Touched` 撤出。
  //   ★ 原先那段（从 `r.candidates` 的 doc/comment 出处字段反推文件）**随契约撤出一起删除**。
  //     ★ 顺带消掉一个既有隐患：那条路径**基准是 `process.cwd()`**（`scanDocs` 154 行 /
  //       `scanComments` 186 行），**不保证等于仓库相对路径**（本 [B] 本就没有 project_dir 锚点）
  //       —— 撤出后这个"口径违反词表定义"的出口不再存在。

  // ★ 不给 written_files：本 [B] 只产出 draft 候选，**不写任何文件/DSL**（LLM review 定稿后再另行写入）。
  // ★ 不给 symbols / nodes：候选里没有符号 / DSL 节点标识可取。

  return touched;
}

export function harvestDecisions(input: HarvestInput): TouchedProduct<HarvestResult> {
  const r = harvestDecisionsCore(input);
  return withTouched(r, touchedOf(input));
}
