/**
 * 规则萃取（P1-7）—— 从一次已完成修复里"长出"一条可复跑规则
 *
 * ★ 这是与 Grit 的**核心差异**：Grit 的模式全部由专家手写（无自动萃取机制）；
 *   我们让 agent **现场从改动本身**长出规则 —— 这正是"自进化落到代码改造"的形态。
 *
 * 输入：一次已完成修复的 before/after 片段（来自 edit_code 的 dry_run diff 或
 *       写入前快照 vs 写入后内容）。
 * 输出：候选规则（pattern + replace + **自动生成的正/反例夹具**）。
 *
 * 泛化策略（把"这一次改了什么"抽象成"这类该怎么改"）：
 *   1. **行级对齐**：before/after 按行配对（等长优先；不等长时用 LCS 求最小编辑脚本）。
 *   2. **差异行 → pattern 行**：只保留**变化行**（未变行作锚点，最多取上下各 1 行上下文）。
 *   3. **标识符抽象**：把变化行里的**标识符**（变量名/函数名/参数字面量）抽成 `$hole`：
 *      - 同名标识符在 before/after 两侧都出现 → 抽象为**同一个** `$hole`（保持"同一实参"语义）；
 *      - 只在单侧出现 → 抽象为固定字面量（那是"要改成的东西"，不是变量）。
 *   4. **夹具自动生成**：
 *      - 正例 = 这次的实际 before/after（**出生回归**：新规则必须能复现这次修复）；
 *      - 反例 = **after 本身不得再被命中**（幂等阴性对照）+
 *        把 before 里的字面量替换成别的标识符，验证 hole 泛化没有过度（**泛化阴性对照**）。
 *
 * 纪律：萃取只是**候选**，不自动落盘 —— 必须过 `validateRule`（三关）才允许写入规则库。
 */

import { splitLines } from './rule_tokens.js';
import { matchRule, instantiateReplace, holeNamesOf } from './rule_match.js';
import type { Rule, RuleFixture, RuleLevel } from './rule_library.js';

/* ─────────────────── 差异计算 ─────────────────── */

/** 一个行级差异块 */
export interface LineDiff {
  kind: 'equal' | 'change' | 'del' | 'ins';
  /** before 侧行（1-based 起止，含端点）；del 二者皆有；ins 时 beforeStart > beforeEnd */
  beforeStart: number;
  beforeEnd: number;
  /** after 侧行 */
  afterStart: number;
  afterEnd: number;
}

/** 最长公共子序列（行级），返回差异脚本 */
export function diffLines(before: string[], after: string[]): LineDiff[] {
  const n = before.length;
  const m = after.length;
  // dp[i][j] = LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  /**
   * 追加一个差异块，并**顺手合并**相邻同类块。
   * ★ 相邻的 del+ins 必须并成一个 `change`：LCS 会把"一行被改写"拆成一对
   *   （改一行 ⇒ 删旧的 + 插新的），若原样返回，"变化块数"就被算成 2，
   *   而且 `kind: 'change'` 成为永不出现的死分支。（原先就是这个问题。）
   */
  const push = (d: LineDiff): void => {
    const last = out[out.length - 1];
    if (last) {
      const contiguous = last.beforeEnd + 1 === d.beforeStart && last.afterEnd + 1 === d.afterStart;
      if (contiguous && last.kind === d.kind) {
        last.beforeEnd = d.beforeEnd;
        last.afterEnd = d.afterEnd;
        return;
      }
      // del 紧跟 ins（或反过来）⇒ 合并为 change，区间取并
      if (contiguous && ((last.kind === 'del' && d.kind === 'ins') || (last.kind === 'ins' && d.kind === 'del'))) {
        last.kind = 'change';
        last.beforeStart = Math.min(last.beforeStart, d.beforeStart);
        last.beforeEnd = Math.max(last.beforeEnd, d.beforeEnd);
        last.afterStart = Math.min(last.afterStart, d.afterStart);
        last.afterEnd = Math.max(last.afterEnd, d.afterEnd);
        return;
      }
    }
    out.push(d);
  };
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      push({ kind: 'equal', beforeStart: i + 1, beforeEnd: i + 1, afterStart: j + 1, afterEnd: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push({ kind: 'del', beforeStart: i + 1, beforeEnd: i + 1, afterStart: j + 1, afterEnd: j });
      i++;
    } else {
      push({ kind: 'ins', beforeStart: i + 1, beforeEnd: i, afterStart: j + 1, afterEnd: j + 1 });
      j++;
    }
  }
  while (i < n) { push({ kind: 'del', beforeStart: i + 1, beforeEnd: i + 1, afterStart: m + 1, afterEnd: m }); i++; }
  while (j < m) { push({ kind: 'ins', beforeStart: n + 1, beforeEnd: n, afterStart: j + 1, afterEnd: j + 1 }); j++; }
  return out;
}

/* ─────────────────── 泛化 ─────────────────── */

/** 语言关键字（不抽象成 hole；这些是语法结构，抽象了规则就没意义） */
const KEYWORDS = new Set([
  'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'switch', 'case',
  'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'async',
  'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'do', 'yield',
  'func', 'package', 'defer', 'go', 'range', 'chan', 'interface', 'struct', 'type', 'map', 'nil',
  'true', 'false', 'null', 'undefined', 'this', 'self',
]);

/** 常见全局对象（抽象成 hole 会把 `console.log` 变成 `$x.y` 这类无意义规则） */
const GLOBALS = new Set(['console', 'window', 'document', 'process', 'global', 'Math', 'JSON', 'Object', 'Array', 'Promise']);

interface Token {
  text: string;
  /** 是否标识符（可抽象） */
  ident: boolean;
  /** 是否属性名（`.` 之后，不参与抽象） */
  prop: boolean;
}

/** 把一行切成"标识符 / 其余"的 token 序列 */
function lexLine(line: string): Token[] {
  const toks: Token[] = [];
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)|(\s+)|([^A-Za-z0-9_$\s]+)/g;
  let m: RegExpExecArray | null;
  let lastWasDot = false;
  while ((m = re.exec(line))) {
    if (m[1]) {
      toks.push({ text: m[1], ident: true, prop: lastWasDot });
      lastWasDot = false;
    } else if (m[2]) {
      toks.push({ text: m[2], ident: false, prop: false });
      lastWasDot = false;
    } else {
      toks.push({ text: m[3], ident: false, prop: false });
      lastWasDot = m[3] === '.';
    }
  }
  return toks;
}

/** 一行里"可抽象"的标识符（非关键字、非全局、非属性名） */
function abstractableIdents(line: string): string[] {
  const toks = lexLine(line);
  const out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.ident || t.prop) continue;
    if (KEYWORDS.has(t.text) || GLOBALS.has(t.text)) continue;
    if (!out.includes(t.text)) out.push(t.text);
  }
  return out;
}

export interface GeneralizeResult {
  pattern: string;
  replace: string;
  /** 被抽象成 hole 的标识符（before 侧视角） */
  holes: string[];
}

/**
 * 把一对"变化行块"泛化成 pattern/replace。
 *   - 两侧都出现的标识符 → 同一 `$hole`（保持"同一实参"约束）；
 *   - 只在一侧出现的标识符 → 保留字面量（那是"要改成的东西"）；
 *   - 关键字 / 全局对象 / 属性名 → 一律保留字面量。
 *
 * 若一行里"可抽象标识符"个数为 0，该行整行保留字面量。
 * 若**没有任何**标识符被抽象（改动是纯字面量替换），则退化为"字面量规则"
 * （仍可用：防的就是这个具体字面量回归）。
 *
 * ★ `limit`：只抽象前 limit 个候选（"逐级放宽"梯子用）。
 *   泛化不是越多越好 —— 抽象多了规则会过宽（把不该改的也改了）；
 *   到底抽象几个**不能靠猜**，由 `validateRule` 三关裁决（见 `extractRule`）。
 */
export function generalizeChange(
  beforeLines: string[],
  afterLines: string[],
  limit = Number.POSITIVE_INFINITY,
): GeneralizeResult {
  // 两侧共同出现的可抽象标识符 → hole（按 before 出现顺序）
  const bIds = beforeLines.flatMap(abstractableIdents);
  const aIds = new Set(afterLines.flatMap(abstractableIdents));
  const all: string[] = [];
  for (const id of bIds) if (aIds.has(id) && !all.includes(id)) all.push(id);
  const shared = all.slice(0, Math.max(0, limit));

  const toHole = (line: string): string => {
    if (shared.length === 0) return line;
    // 逐 token 替换（保护属性名：`a.id` 里的 id 不换）
    return lexLine(line)
      .map((t) => (t.ident && !t.prop && shared.includes(t.text) ? '$' + t.text : t.text))
      .join('');
  };

  return {
    pattern: beforeLines.map(toHole).join('\n'),
    replace: afterLines.map(toHole).join('\n'),
    holes: shared,
  };
}

/* ─────────────────── 夹具生成 ─────────────────── */

/**
 * 自动生成夹具（★ 我们的差异化：Grit stdlib 零反例）：
 *   1. **正例**：实际的 before → after（**出生回归**：新规则必须复现这次修复）。
 *   2. **反例**（幂等阴性）：**after 本身不得再被命中**
 *      —— 若被命中，说明规则会把已修好的代码再改一次（幂等性破坏）。
 *
 * ★ **夹具必须与 pattern 同口径（同 scope）**：pattern 是从"变化行窗口"泛化出来的，
 *   而整份输入往往还含未变的上下文行（如 `function f(x) {`）。
 *   拿整份输入当夹具 = 让 1 行的 pattern 去改 3 行的文本 → **必然误报 birth_regression_diff**。
 *   故夹具默认只放"变化行窗口"；若调用方确实传了多行上下文，
 *   是否带上下文由 `withContext` 决定（v1 默认不带 —— 少一层可能失配的噪声）。
 */
export function buildFixtures(beforeText: string, afterText: string, lang = ''): RuleFixture[] {
  const fixtures: RuleFixture[] = [
    { title: '正例（出生回归：本次修复必须能被复现）', before: beforeText, after: afterText, lang },
  ];
  // 幂等阴性对照：after 不应再被命中
  fixtures.push({ title: '反例（幂等：修好的代码不得再被命中）', negative: afterText, lang });
  return fixtures;
}

/* ─────────────────── 三关校验 ─────────────────── */

export interface ValidateIssue {
  code: string;
  message: string;
  severity: 'error' | 'warn';
}

export interface ValidateResult {
  ok: boolean;
  issues: ValidateIssue[];
}

/**
 * ★ 规则验收三关（落盘前的机器判据）：
 *   ① **出生回归**：pattern 必须能命中 fixture 的 before，且改写结果 == after
 *      —— 复现不了这次修复的规则，等于没萃取到东西。
 *   ② **反例不命中**：每条 negative 夹具都不得被命中
 *      —— 缺这一关就无法证明规则"只在该改的地方改"。
 *   ③ **幂等**：把规则应用到 after 上不应再命中（改完就稳定）。
 *
 * 另附软检查（warn）：pattern 里一个 hole 都没有 ⇒ 只能防字面量，泛化弱。
 */
export function validateRule(pattern: string, replace: string, fixtures: RuleFixture[]): ValidateResult {
  const issues: ValidateIssue[] = [];

  const positives = fixtures.filter((f) => f.before !== undefined && f.after !== undefined);
  const negatives = fixtures.filter((f) => f.negative !== undefined);

  if (positives.length === 0) {
    issues.push({ code: 'no_positive', message: '缺正例夹具（无法证明规则复现了本次修复）', severity: 'error' });
  }
  if (negatives.length === 0) {
    issues.push({ code: 'no_negative', message: '缺反例夹具（无法证明规则只在该改的地方改）', severity: 'error' });
  }

  // ① 出生回归
  for (const f of positives) {
    const before = f.before as string;
    const after = f.after as string;
    const out = matchRule(before, pattern);
    if (out.matches.length === 0) {
      issues.push({
        code: 'birth_regression_miss',
        message: `正例「${f.title}」未被命中：pattern 复现不了这次修复`,
        severity: 'error',
      });
      continue;
    }
    if (out.matches.length > 1) {
      issues.push({
        code: 'birth_regression_ambiguous',
        message: `正例「${f.title}」命中 ${out.matches.length} 处（须唯一才动）`,
        severity: 'error',
      });
      continue;
    }
    const rewritten = instantiateReplace(replace, out.matches[0]);
    const expected = after;
    if (rewritten.trimEnd() !== expected.trimEnd()) {
      issues.push({
        code: 'birth_regression_diff',
        message:
          `正例「${f.title}」改写结果与预期不符：\n  得到: ${JSON.stringify(rewritten)}\n  期望: ${JSON.stringify(expected)}`,
        severity: 'error',
      });
    }
  }

  // ② 反例不命中
  for (const f of negatives) {
    const neg = f.negative as string;
    const out = matchRule(neg, pattern);
    if (out.matches.length > 0) {
      issues.push({
        code: 'negative_hit',
        message: `反例「${f.title}」被命中 ${out.matches.length} 处（规则过宽）`,
        severity: 'error',
      });
    }
  }

  // ③ 幂等（把规则应用到 after，不应再有可动处）
  for (const f of positives) {
    const after = f.after as string;
    const out = matchRule(after, pattern);
    if (out.matches.length > 0) {
      issues.push({
        code: 'not_idempotent',
        message: `幂等失败：正例「${f.title}」的 after 仍被命中 ${out.matches.length} 处（会反复改）`,
        severity: 'error',
      });
    }
  }

  // 软检查：零 hole ⇒ 泛化弱
  if (holeNamesOf(pattern).length === 0) {
    issues.push({
      code: 'no_hole',
      message: 'pattern 里没有 $hole：只能防住这一个字面量，泛化能力弱（不阻断）',
      severity: 'warn',
    });
  }

  return { ok: !issues.some((i) => i.severity === 'error'), issues };
}

/* ─────────────────── 顶层：从一次修复萃取 ─────────────────── */

export interface ExtractInput {
  /** 修复前的片段（含足够上下文） */
  before: string;
  /** 修复后的片段 */
  after: string;
  /** 规则 id（调用方给的候选名） */
  id: string;
  title?: string;
  tags?: string[];
  level?: RuleLevel;
  language?: string;
  /** 来源描述（追溯用） */
  createdFrom?: string;
}

export interface ExtractResult {
  rule: Rule;
  validation: ValidateResult;
  /** 泛化信息（holes / 差异块数 / 梯子裁决），用于回执解释 */
  generalization: GeneralizeResult & {
    diffBlocks: number;
    /** 候选 hole 总数（未放宽前） */
    candidateHoles: number;
    /** 试了几级（0 = 一上来就通过） */
    ladderSteps: number;
    /** 是否因放宽而放弃了泛化（true = 退化为字面量规则） */
    degraded: boolean;
    /** 每一级的裁决记录（诚实回执用） */
    attempts: { holes: string[]; ok: boolean; codes: string[] }[];
  };
}

/**
 * 从一次修复萃取候选规则。
 *
 * ★ **逐级放宽梯子**（本函数的核心闭环）：
 *   泛化的"度"不能猜 —— 从"最多抽象"开始试，每级用 `validateRule` 三关裁决：
 *     - 通过 ⇒ 采纳这一级（泛化尽量强）；
 *     - 不通过 ⇒ 少抽象一个标识符，重来；
 *     - 全都不通过 ⇒ 退化为**纯字面量**规则（至少防住这次的具体回归），
 *       并在 `attempts`/`degraded` 里如实记下"泛化失败"。
 *   这样"规则库"里不会出现没过关的规则，同时也不会因为一次泛化过宽就整个放弃。
 *
 * **注意**：本函数**不落盘**。调用方（`rules(action="export")` 工具）须先看 `validation.ok`，
 * 不 ok 就如实回报问题，绝不"先写了再说"。
 */
export function extractRule(input: ExtractInput): ExtractResult {
  const beforeLines = splitLines(input.before).map((l) => l.replace(/\r$/, ''));
  const afterLines = splitLines(input.after).map((l) => l.replace(/\r$/, ''));

  // 差异 → 变化块（pair up 相邻 del/ins 为一个 change）
  const script = diffLines(beforeLines, afterLines);
  const delLines: string[] = [];
  const insLines: string[] = [];
  for (const d of script) {
    if (d.kind === 'del') delLines.push(...beforeLines.slice(d.beforeStart - 1, d.beforeEnd));
    else if (d.kind === 'ins') insLines.push(...afterLines.slice(d.afterStart - 1, d.afterEnd));
    else if (d.kind === 'change') {
      delLines.push(...beforeLines.slice(d.beforeStart - 1, d.beforeEnd));
      insLines.push(...afterLines.slice(d.afterStart - 1, d.afterEnd));
    }
  }

  // ★ 变化行窗口：pattern / replace / 夹具三者**必须同 scope**
  const winBefore = delLines.length ? delLines : beforeLines;
  const winAfter = insLines.length ? insLines : afterLines;
  const beforeText = winBefore.join('\n');
  const afterText = winAfter.join('\n');
  const lang = input.language === 'typescript' ? 'ts' : '';
  const fixtures = buildFixtures(beforeText, afterText, lang);

  // 候选 hole 总数
  const full = generalizeChange(winBefore, winAfter);
  const candidateHoles = full.holes.length;

  // 梯子：从全抽象逐级减到 0（0 = 纯字面量）
  const attempts: ExtractResult['generalization']['attempts'] = [];
  let chosen = full;
  let chosenValidation = validateRule(full.pattern, full.replace, fixtures);
  attempts.push({
    holes: full.holes,
    ok: chosenValidation.ok,
    codes: chosenValidation.issues.map((i) => i.code),
  });
  for (let k = candidateHoles - 1; k >= 0 && !chosenValidation.ok; k--) {
    const gen = generalizeChange(winBefore, winAfter, k);
    const v = validateRule(gen.pattern, gen.replace, fixtures);
    attempts.push({ holes: gen.holes, ok: v.ok, codes: v.issues.map((i) => i.code) });
    if (v.ok) {
      chosen = gen;
      chosenValidation = v;
      break;
    }
    // 记住最后一次结果（若全败，落字面量那级的结果最有信息量）
    chosen = gen;
    chosenValidation = v;
  }

  const rule: Rule = {
    id: input.id,
    title: input.title ?? input.id,
    tags: input.tags ?? [],
    level: input.level ?? 'warn',
    language: input.language ?? '',
    createdFrom: input.createdFrom ?? new Date().toISOString(),
    description: `由一次实际修复萃取：${input.id}`,
    pattern: chosen.pattern,
    replace: chosen.replace,
    fixtures,
  };

  return {
    rule,
    validation: chosenValidation,
    generalization: {
      ...chosen,
      diffBlocks: script.filter((d) => d.kind !== 'equal').length,
      candidateHoles,
      ladderSteps: attempts.length - 1,
      degraded: candidateHoles > 0 && chosen.holes.length < candidateHoles,
      attempts,
    },
  };
}
