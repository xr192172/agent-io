/**
 * fill —— LLM 单孔填充闭环（三段式落地"③ 填充 → ④ 验证"）
 *
 * 把一个 bodyHole 单元（func）交给可注入的 HoleTranslator（LLM 调用端/桩）翻译函数体，
 * 拼回锁定骨架后立即重跑 verify 闸——错误本地化到单孔、可重试。
 *
 * 关键：HoleTranslator 是可注入的（不硬绑某家 LLM／key），本文件只负责
 *   "给翻译器一份自包含的锁定上下文 → 拿回函数体 → splice 进骨架 → 重验证"。
 * 调用方（CLI / MCP / gateway）负责把 FillContext 交给真实的 LLM，并把输出夹回
 * 本文件约束好的边界内（只给函数体、不改签名）。
 */

import { verifySkeletons, type VerifyIssue } from './verify.js';
import { buildHolePrompt } from './prompts.js';
import type { TransUnit } from './unit.js';

/** 交给翻译器的自包含上下文：签名锁定 + Go 源证据 + 约束 + 给模型的单孔 prompt */
export interface FillContext {
  unit: TransUnit;
  /** 锁定骨架（签名外壳，勿改） */
  skeleton: string;
  /** Go 源原文，翻译依据 */
  srcSnippet: string;
  /** 合并后的约束（typeMap 语义 note + 默认约束） */
  constraints: string[];
  /** 项目级调用约定（receiver→T_f、可引用的跨文件符号名）；项目模式注入 */
  projectNote?: string;
  /** 给模型的单孔指令（可由调用方改用 buildHolePrompt 变体） */
  prompt: string;
}

/** 翻译器契约：输入锁定上下文，只输出目标函数体（不含 export function 外壳） */
export type HoleTranslator = (ctx: FillContext) => string | Promise<string>;

export interface FillResult {
  /** 被填充的单元 */
  unit: TransUnit;
  /** splice 后完整目标源码（骨架 + 函数体） */
  filledSource: string;
  /** 重验证是否通过（语法闸 + 结构闸） */
  ok: boolean;
  issues: VerifyIssue[];
  /** 若翻译器返回空/骨架无法闭合，填 false 并给原因 */
  error?: string;
}

/** 把翻译器产出的函数体拼进骨架：首 `{` 到末 `}` 之间。骨架统一 `export function ...: Ret {\n  <体>\n}`。 */
export function spliceBody(skeleton: string, body: string): string {
  // ★★★ 2026-10-29（**结构 bug**）：原来用 `skeleton.indexOf('{')` 找函数体起点 ——
  //   但**返回类型是对象字面量**时（`): { ID: string }[] {`），第一个 `{` 落在**类型里**，
  //   于是函数体被拼进了返回类型 ⇒ `export function f(): {` 后面直接跟语句（TS1005/TS1108 一片）。
  //   实测 retrieval_pipeline.ts 两处、sortByScore 一处。
  //   ⇒ 从**最后一个** `}` 往前按括号配对，找到与它配对的 `{`，那才是函数体的开括号。
  const close = skeleton.lastIndexOf('}');
  let open = -1;
  if (close >= 0) {
    let depth = 0;
    for (let i = close; i >= 0; i--) {
      const ch = skeleton[i];
      if (ch === '}') depth++;
      else if (ch === '{') {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
  }
  if (open < 0 || close <= open) return skeleton;
  const head = skeleton.slice(0, open + 1);
  const tail = skeleton.slice(close);
  return `${head}\n${indentBody(body)}\n${tail}`;
}

/**
 * Go **数字字面量文本 → TS 合法文本**（**唯此一处**：LLM 填空出口 `fillUnit`、缓存回放出口
 * `project.ts`、机械体渲染出口 `body_pivot` / `body_mech` 全部走它）。
 *
 * 两个处理必须**同时**存在，少一个就漏：
 *   ① 剥 `_` 数字分隔符 —— Go 允许 `1_000`；而 `0_644` 在 TS 是 TS6188、`05` / `00` 是 TS1121；
 *   ② 老式八进制 `0644` → `0o644` —— Go 前导 0 即八进制，TS 里是非法字面量（TS1121）。
 * ★ `1_000` 本身是**合法** TS（ES2021 数字分隔符）—— 它的问题不是编译错，而是**同一段体
 *   经不同出口产出不同字节**（本仓实测三处规则相反）。
 *
 * 入参可以是**整段函数体**，也可以是**单个字面量 token**：边界判据同一套 —— 前一位、后一位
 * 都不许是 `[\w.]`（`10644` / `x0_644` / `a.0644` 里那段数字都不算新字面量）。
 * 字符串 / 符文 / 模板串 / 行注释 / 块注释整段跳过（旧实现会把字符串里的 `"0644"` 改成
 * `"0o644"`，实测）。
 *
 * ★ 双向自查（AGENTS-RULES 0.14）：删掉剥 `_` 那一步 ⇒ `1_000` / `1_0_0` 那几条用例必须红；
 *   删掉 `0…`→`0o` 那一步 ⇒ `0644` / `0_644` / `05` 那几条必须红 —— 用例住 fill.ts 节点上的
 *   2 条 behavior-cases 判据（同义必命中 9 条 + 异义必不命中 12 条）。
 *
 * [已声明边界] `09` 在 Go 侧本身非法（8/9 不是八进制位）⇒ 原样保留，不瞎转成 `0o9`；
 *   TS 正则字面量（形如 `/0644/`）与字符串里空格后的数字在纯文本层与真字面量不可分 ⇒ 仍会被
 *   改写（根治要 AST；本函数按"文本形状本身就是答案"定位）。
 */
export function normalizeGoNumericLiterals(text: string): string {
  // 候选字面量形状：Go 的 0x / 0b / 0o 前缀 + 十进制（含小数与指数），`_` 只许夹在数字里
  const LIT = /0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?/y;
  let out = '';
  let i = 0;
  while (i < text.length) {
    const skip = opaqueEnd(text, i);
    if (skip > i) {
      out += text.slice(i, skip);
      i = skip;
      continue;
    }
    const prev = i > 0 ? text[i - 1] : '';
    if (/\d/.test(text[i]) && !/[\w.]/.test(prev)) {
      LIT.lastIndex = i;
      const hit = LIT.exec(text);
      if (hit && !/[\w.]/.test(text[i + hit[0].length] ?? '')) {
        const raw = hit[0].replace(/_/g, '');
        out += /^0[0-7]+$/.test(raw) ? `0o${raw.slice(1)}` : raw;
        i += hit[0].length;
        continue;
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * 从 `i` 起若落在**不透明区段**（引号字面量 / 原始串 / 模板串 / 行注释 / 块注释）内 ⇒ 返该区段
 * 结束位置；否则原样返 `i`（调用方据此决定要不要做字面量替换）。
 *
 * 不变量：区段内**一个字符都不许改**。少了它，正则会把**字符串内容**（`"0644"` → `"0o644"`）
 * 与**注释里的数字**一起改掉 —— 那是"错而没有声音"的一类（AGENTS-RULES 0.14）。
 */
function opaqueEnd(text: string, i: number): number {
  const c = text[i];
  if (c === '"' || c === "'" || c === '`') {
    let j = i + 1;
    while (j < text.length) {
      const d = text[j];
      if (d === '\\') {
        j += 2;
        continue;
      }
      if (d === c) return j + 1;
      // 未闭合的普通字符串：止于行尾（不猜它跨行）
      if (c !== '`' && d === '\n') return j;
      j += 1;
    }
    return text.length;
  }
  if (c === '/' && text[i + 1] === '/') {
    const nl = text.indexOf('\n', i);
    return nl < 0 ? text.length : nl;
  }
  if (c === '/' && text[i + 1] === '*') {
    const end = text.indexOf('*/', i + 2);
    return end < 0 ? text.length : end + 2;
  }
  return i;
}

/** 函数体整体缩进两级（对齐骨架体内） */
function indentBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '';
  return trimmed
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
}

/** 构造给翻译器的上下文；feedback 非空时追加到 prompt 尾部（纠错重试用），projectNote 附在 prompt 尾部（项目级调用约定） */
export function buildFillContext(u: TransUnit, feedback?: string, projectNote?: string): FillContext {
  let prompt = buildHolePrompt(u);
  if (projectNote) prompt = `${prompt}\n\n${projectNote}`;
  if (feedback) prompt = `${prompt}\n\n--- 上次尝试未通过验证，请据此修正，仍只输出函数体 ---\n${feedback}`;
  return {
    unit: u,
    skeleton: u.skeleton,
    srcSnippet: u.srcSnippet,
    constraints: u.constraints,
    projectNote,
    prompt,
  };
}

/**
 * 填充单个 bodyHole 单元并重验证。type 单元（非孔）返回 null。
 * feedback：把上一次失败产物/诊断作为纠错上下文注入 prompt（见 fillUnitWithRetry）。
 * projectNote：项目级调用约定（receiver→T_f、可引用跨文件符号名），注入 prompt 帮函数体引用对名。
 * 验证不过 → ok:false + 具体 issue，不抛、不丢源（骨架原样保留）。
 */
export async function fillUnit(u: TransUnit, translate: HoleTranslator, feedback?: string, projectNote?: string): Promise<FillResult | null> {
  if (!u.bodyHole) return null;
  const ctx = buildFillContext(u, feedback, projectNote);
  let body: string;
  try {
    body = await translate(ctx);
  } catch (e) {
    return { unit: u, filledSource: u.skeleton, ok: false, issues: [], error: `翻译器异常：${(e as Error).message}` };
  }
  const filledSource = spliceBody(u.skeleton, normalizeGoNumericLiterals(body));
  if (body.trim() === '') {
    return { unit: u, filledSource, ok: false, issues: [], error: '翻译器返回空函数体' };
  }
  // ★★★ 2026-10-29（全仓跑抓到的违规）：LLM 有时把**整个函数外壳**（`export function name(...) {...}`）
  //   一起返回，spliceBody 会把它嵌进外层函数体 ⇒ 生成 `export function` 嵌在函数里（TS1131/TS1128 语法错），
  //   而结构闸没拦住，结果**静默产出坏文件**（实测 retrieval_pipeline.ts 两处）。
  //   ⇒ 契约违反必须**显式失败**（进入纠错重试），不能静默落盘。
  if (/^[ \t]*(export\s+)?(async\s+)?function\b/m.test(body.trim())) {
    return { unit: u, filledSource: u.skeleton, ok: false, issues: [], error: '翻译器返回了函数外壳（只允许返回函数体，不含 export function 行）' };
  }
  const issues = await verifySkeletons([{ ...u, bodyHole: false, skeleton: filledSource }]);
  return { unit: u, filledSource, ok: issues.length === 0, issues };
}

/** 把一次失败结果整理成给 LLM 的纠错反馈（含坏产物 + 具体问题） */
export function buildRetryFeedback(u: TransUnit, r: FillResult): string {
  if (r.error) return `翻译器/填充错误：${r.error}`;
  const detail = r.issues.map((i) => `[${i.gate}] ${i.id}: ${i.detail}`).join('；');
  return ['上次产物（含错误）：', r.filledSource, '', '问题：', detail || '未知'].join('\n');
}

/** 逐次纠错重试：失败则把坏产物+诊断喂回翻译器再试，直到 ok 或重试耗尽。 */
export async function fillUnitWithRetry(u: TransUnit, translate: HoleTranslator, maxRetries = 2, projectNote?: string): Promise<FillResult | null> {
  if (!u.bodyHole) return null;
  let feedback: string | undefined;
  let last: FillResult | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fillUnit(u, translate, feedback, projectNote);
    if (!r || r.ok) return r;
    last = r;
    feedback = buildRetryFeedback(u, r);
  }
  return last;
}

/** 批量填充全部 bodyHole 单元；逐孔独立验证，单孔失败不影响其余。 */
export async function fillUnits(units: TransUnit[], translate: HoleTranslator, projectNote?: string): Promise<FillResult[]> {
  const out: FillResult[] = [];
  for (const u of units) {
    const r = await fillUnit(u, translate, undefined, projectNote);
    if (r) out.push(r);
  }
  return out;
}

/** 批量逐孔纠错重试：每孔 fillUnitWithRetry。 */
export async function fillUnitsWithRetry(
  units: TransUnit[],
  translate: HoleTranslator,
  maxRetries = 2,
  projectNote?: string,
): Promise<FillResult[]> {
  const out: FillResult[] = [];
  for (const u of units) {
    const r = await fillUnitWithRetry(u, translate, maxRetries, projectNote);
    if (r) out.push(r);
  }
  return out;
}

// ─────────────────────────────────────────────
// 批量填充（一次 LLM 调用填多个函数体，省共享 prompt 常量成本）
// ─────────────────────────────────────────────

/** 批量翻译器：输入一批 FillContext，返回 raw 文本（内含 `<unit id>body</unit>` 标记块）。 */
export type BatchHoleTranslator = (ctxs: FillContext[]) => Promise<string>;

/** 确定性切分 `raw` 里的 `<unit id="X">…</unit>` 块 → id → 函数体。未命中 = 缺该单元的块。 */
export function parseUnitBlocks(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<unit\s+id="([^"]+)">([\s\S]*?)<\/unit>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.set(m[1], m[2].trim());
  return out;
}

export interface BatchFillOptions {
  /** 每批最多单元数（仅上限；实际按 maxSrcCharsPerBatch 自适应收紧） */
  batchSize?: number;
  maxRetries?: number;
  projectNote?: string;
  /** 一批内"源证据+骨架"总字符上限，防一次调用输出超出 max_tokens 被截断 → 重试放大成本。默认 4000 */
  maxSrcCharsPerBatch?: number;
}

/** 自适应分批：按"单元数 + 源字符预算"切，函数体越肥批越小，保输出在 token 预算内 */
function sliceBatches<T extends { u: TransUnit }>(items: T[], maxUnits: number, maxChars: number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let chars = 0;
  for (const it of items) {
    const size = it.u.srcSnippet.length + it.u.skeleton.length;
    if (cur.length > 0 && (cur.length >= maxUnits || chars + size > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(it);
    chars += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * 批量填充：把（命中）bodyHole 单元按 batchSize 分批，一次 LLM 调用返回多块（标记切分），
 * 逐单元 splice + 验证；失败子集作为下一批带纠错反馈重试（隔离粒度≈失败子集，不整批重发）。
 * 恢复单孔语义：一孔验证独立、只重试没过的孔。
 */
export async function fillUnitsBatched(
  units: TransUnit[],
  translateRaw: BatchHoleTranslator,
  opts: BatchFillOptions = {},
): Promise<FillResult[]> {
  const holes = units.filter((u) => u.bodyHole);
  const B = opts.batchSize ?? 5;
  const maxChars = opts.maxSrcCharsPerBatch ?? 4000;
  const maxRetries = opts.maxRetries ?? 2;
  const out = new Map<string, FillResult>();
  type QueueItem = { u: TransUnit; feedback?: string };
  let queue: QueueItem[] = holes.map((u) => ({ u }));

  for (let round = 0; round <= maxRetries && queue.length > 0; round++) {
    const next: QueueItem[] = [];
    const batches = sliceBatches(queue, B, maxChars);
    for (const chunk of batches) {
      const ctxs = chunk.map(({ u, feedback }) => buildFillContext(u, feedback, opts.projectNote));
      let raw: string;
      try {
        raw = await translateRaw(ctxs);
      } catch (e) {
        for (const { u } of chunk) {
          const r: FillResult = { unit: u, filledSource: u.skeleton, ok: false, issues: [], error: `批量调用异常：${(e as Error).message}` };
          out.set(u.id, r);
          if (round < maxRetries) next.push({ u, feedback: buildRetryFeedback(u, r) });
        }
        continue;
      }
      const blocks = parseUnitBlocks(raw);
      for (const { u } of chunk) {
        const body = blocks.get(u.id);
        const filledSource = spliceBody(u.skeleton, body ?? '');
        let r: FillResult;
        if (!body?.trim()) {
          r = { unit: u, filledSource, ok: false, issues: [], error: '批中缺失该单元标记块或函数体为空' };
        } else {
          const issues = await verifySkeletons([{ ...u, bodyHole: false, skeleton: filledSource }]);
          r = { unit: u, filledSource, ok: issues.length === 0, issues };
        }
        out.set(u.id, r);
        if (!r.ok && round < maxRetries) next.push({ u, feedback: buildRetryFeedback(u, r) });
      }
    }
    queue = next;
  }
  return holes.map((u) => out.get(u.id)!);
}