/**
 * receipt —— translate_go_ts 的回执：**已知 / 未知 / 验证** 三分，互不混淆
 *
 * 判据：翻译是否成功看**功能是否达成** —— 同一批输入，Go 原函数与
 * TS 翻译函数输出逐条一致。函数体里写 void 还是返回 null、结构像不像，都不构成证据。
 *
 * 两条硬规矩（本文件负责把它们变成代码）：
 *   ① `known` 只收**读得出来的事实**：AST 的签名/字段、常量求值、跨文件 import/调用边、
 *      仓库测试里抽到的用例。推断（惯用法怎么映）、缺库、行为假设 **一律进 `unknowns`**。
 *   ② `verification` 只认**对照测试**。只编译过 / 只跑自动生成的冒烟样例 / 根本没跑
 *      ⇒ `unverified`。★ **不许把"能编译"写成"完成"**。
 */

import { mapGoType } from './ts_codegen.js';
import { DEFAULT_CONSTRAINTS, type TransUnit } from './unit.js';
import type { SkippedDecl } from './go_extractor.js';
import type { BehaviorCase } from '../behavior/index.js';
import { checkTranslationParity, generateCasesFor, typeSamples, type ParityOptions } from './verify_behavior.js';
import type { GoTestRef } from './go_tests.js';

// ─────────────────────────────────────────────
// 已知：从 AST / 常量求值 / import / 调用边 读出来的事实
// ─────────────────────────────────────────────

export type KnownKind = 'signature' | 'type_shape' | 'const_value' | 'import' | 'call_edge' | 'body_filled';

export interface KnownFact {
  /** 单元 id（或项目模式的模块相对路径） */
  id: string;
  kind: KnownKind;
  /** 事实原文（签名/字段表/import 语句…） */
  detail: string;
  /** 源 Go 行（单文件模式） */
  line?: number;
}

// ─────────────────────────────────────────────
// 未知：推测 / 缺失 / 假设 —— 一等公民，绝不混进 known
// ─────────────────────────────────────────────

export type UnknownKind = 'type_map' | 'idiom' | 'behavior' | 'missing_lib' | 'structure' | 'body';

/** 这条"不知道"的性质：推断（有依据但没证明）/ 缺失（东西根本不在）/ 假设（选了近似写法） */
export type UnknownBasis = 'inference' | 'missing' | 'assumption';

export interface UnknownItem {
  id: string;
  kind: UnknownKind;
  /** 不知道的具体内容 */
  detail: string;
  /** 为什么不知道（推断依据 / 缺什么 / 假设了什么） */
  why: string;
  basis: UnknownBasis;
  /** 建议怎么解决（手动翻译 / 补库 / 补测试） */
  suggested?: string;
  line?: number;
}

// ─────────────────────────────────────────────
// 验证：只认"同一批输入，新旧逐条比"
// ─────────────────────────────────────────────

export type VerifyStatus = 'verified' | 'partial' | 'diff' | 'unverified';

/** 用例来源：仓库测试 > 调用方给的 > 自动冒烟（冒烟**不算验证**） */
export type CaseSource = 'repo_test' | 'supplied' | 'smoke' | 'none';

export interface CaseResult {
  name: string;
  status: 'same' | 'changed';
  go?: string;
  ts?: string;
  go_error?: string;
  ts_error?: string;
}

export interface UnitVerification {
  unit: string;
  status: 'verified' | 'diff' | 'unverified';
  source: CaseSource;
  cases_total: number;
  cases_matched: number;
  /** 该单元**可用**样例数（> cases_total ⇒ 被 maxCases 截断，差额没跑） */
  cases_available?: number;
  /** 未验证/有差异的具体原因（人话） */
  reason?: string;
  cases?: CaseResult[];
}

export interface VerificationReceipt {
  status: VerifyStatus;
  summary: string;
  units: UnitVerification[];
  /** 仓库里被看到的 Go 测试（file:line func），便于人去看"到底有没有测试" */
  repo_tests: GoTestRef[];
  /** 取用例过程的说明（为什么没取到） */
  notes: string[];
}

export interface Receipt {
  known: KnownFact[];
  unknowns: UnknownItem[];
  verification: VerificationReceipt;
  /**
   * ★ I3（2026-10-25）：**硬依赖清单** —— externalImports 从 unknowns 的 missing_lib 诊断
   *   升格为独立区块（回执 + 册子 `external_deps` 同型）：每条带 strategy 字段，
   *   初始空由模型/人填（npm_equiv=找等价 npm 库 / same_slot=同槽位替身 / http_bridge=HTTP 桥接）。
   *   为什么升格：外部依赖是「必须先定策略才能翻」的**一等欠账**，混在 unknowns 里会被当成普通推测刷过去。
   */
  external_deps: ExternalDep[];
}

/** 硬依赖清单条目（与册子 `book.ts#BookExternalDep` 同型：回执 + 册子两处同一种东西） */
export type ExternalDepStrategy = '' | 'npm_equiv' | 'same_slot' | 'http_bridge';

export interface ExternalDep {
  /** 非 stdlib 的 Go import 路径（首段含 '.'） */
  import: string;
  strategy: ExternalDepStrategy;
  note?: string;
}

// ─────────────────────────────────────────────
// known
// ─────────────────────────────────────────────

function signatureOf(u: TransUnit): string {
  const ps = (u.params ?? []).map((p) => `${p.name} ${p.type}`).join(', ');
  const tps = u.typeParams?.length ? `<${u.typeParams.join(', ')}>` : '';
  return `func ${u.name}${tps}(${ps})${u.result ? ` ${u.result}` : ''}`;
}

/** 从单元读出的事实（不掺任何推断） */
export function buildKnown(units: TransUnit[], filled?: Map<string, string>): KnownFact[] {
  const out: KnownFact[] = [];
  for (const u of units) {
    if (u.kind === 'func') {
      out.push({ id: u.id, kind: 'signature', detail: signatureOf(u), line: u.srcLine });
    } else if (u.kind === 'const') {
      out.push({ id: u.id, kind: 'const_value', detail: `const ${u.name} = ${u.value ?? '?'}`, line: u.srcLine });
    } else if (u.typeKind === 'struct') {
      out.push({ id: u.id, kind: 'type_shape', detail: `struct ${u.name} { ${(u.fields ?? []).map((f) => `${f.name} ${f.type}`).join('; ')} }`, line: u.srcLine });
    } else if (u.typeKind === 'interface') {
      out.push({ id: u.id, kind: 'type_shape', detail: `interface ${u.name} { ${(u.methods ?? []).map((m) => `${m.name}(${m.params.map((p) => p.type).join(', ')})`).join('; ')} }`, line: u.srcLine });
    } else {
      out.push({ id: u.id, kind: 'type_shape', detail: `type ${u.name} = ${u.aliasType ?? '?'}`, line: u.srcLine });
    }
    if (filled?.has(u.id)) {
      out.push({ id: u.id, kind: 'body_filled', detail: `函数体已生成（${filled.get(u.id)!.length} 字符）并通过骨架静态闸；语义是否一致 ⇒ 看 verification`, line: u.srcLine });
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// unknowns
// ─────────────────────────────────────────────

/** 默认约束是"纪律"不是"未知"——别把它们当成推测噪声刷屏 */
const DISCIPLINE = new Set(DEFAULT_CONSTRAINTS);

interface Hint {
  kind: UnknownKind;
  why: string;
  basis: UnknownBasis;
  suggested?: string;
}

/** 约束文本 → 它到底在提示哪种"不知道"（认不出就返回 null，不硬塞） */
function hintFor(text: string): Hint | null {
  if (/defer/.test(text)) return { kind: 'idiom', basis: 'inference', why: 'AST 只看得到 defer 出现，看不到清理时机在 TS 里是否等价', suggested: '手写 try/finally 后人工核清理顺序' };
  if (/go 语句/.test(text)) return { kind: 'idiom', basis: 'inference', why: 'goroutine 的调度/取消/顺序在 JS 里没有等价保证', suggested: 'Promise 化 + 显式 await 顺序，人工核竞态' };
  if (/select/.test(text)) return { kind: 'behavior', basis: 'assumption', why: 'Go select 的 first-ready 是运行时仲裁；Promise.race 只是近似', suggested: '人工确认分支优先级与取消语义' };
  if (/通道|<-/.test(text)) return { kind: 'behavior', basis: 'assumption', why: 'Channel<T> 垫片是队列模拟，阻塞/缓冲/关闭语义不同', suggested: '人工核阻塞与背压；必要时换真并发原语' };
  if (/嵌入字段/.test(text)) return { kind: 'structure', basis: 'inference', why: '字段提升是 Go 编译期语义，TS interface 没有提升', suggested: '展开字段，或改组合后显式解引用' };
  if (/TS 无等价约束/.test(text)) return { kind: 'type_map', basis: 'inference', why: 'Go 约束（comparable/集合）在 TS 类型系统里表达不出来', suggested: '运行时校验或文档化约束' };
  if (/近似/.test(text)) return { kind: 'behavior', basis: 'assumption', why: '骨架生成时已标注为近似，等价性没有被证明', suggested: '补一条对照测试再宣称等价' };
  return null;
}

/** 类型映射层面的未知：骨架里已经写成近似/占位的那些 */
function typeUnknowns(u: TransUnit, noteTexts: Set<string>): UnknownItem[] {
  const out: UnknownItem[] = [];
  const add = (prefix: string, goType: string): void => {
    const m = mapGoType(goType);
    if (m.degree !== 'unsupported') return;
    if (m.note) noteTexts.add(m.note);
    out.push({
      id: u.id,
      kind: 'type_map',
      detail: `${prefix}: ${goType} → ${m.ts}`,
      why: m.note ?? '该 Go 类型无法机械映射到 TS',
      basis: 'assumption',
      suggested: '人工决定目标表示（错误传播方式 / 结果形态 / 并发原语）',
      line: u.srcLine,
    });
  };
  for (const p of u.params ?? []) add(p.name, p.type);
  if (u.result) add('return', u.result);
  for (const f of u.fields ?? []) add(f.name, f.type);
  for (const m of u.methods ?? []) {
    for (const p of m.params) add(`${m.name}.${p.name}`, p.type);
    if (m.result) add(`${m.name}.return`, m.result);
  }
  if (u.typeKind === 'alias' && u.aliasType) add(`type ${u.name}`, u.aliasType);
  return out;
}

export interface UnknownsInput {
  units: TransUnit[];
  /** 已填（且过静态闸）的单元 → 填后源码；不在表里 = 还是孔 */
  filled?: Map<string, string>;
  /** 填孔失败原因（unit id → 原因） */
  fillFailures?: Map<string, string>;
  /** 萃取期跳过项（空结构体/空接口/不可求值 const…） */
  skipped?: SkippedDecl[];
  /** ★ I3：外部 import 不再进 unknowns（升格为独立硬依赖清单区块 `Receipt.external_deps`） */
  diagnostics?: string[];
}

/** 收集所有"不知道"：类型映射 / 惯用法 / 行为假设 / 缺库 / 结构丢失 / 未翻的孔 */
export function buildUnknowns(input: UnknownsInput): UnknownItem[] {
  const out: UnknownItem[] = [];
  const noteTexts = new Set<string>();
  const seen = new Set<string>();
  const push = (it: UnknownItem): void => {
    const key = `${it.id}|${it.kind}|${it.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(it);
  };

  for (const u of input.units) {
    for (const it of typeUnknowns(u, noteTexts)) push(it);
    for (const c of u.constraints ?? []) {
      if (DISCIPLINE.has(c)) continue;
      if ([...noteTexts].some((n) => c.endsWith(n))) continue; // 已被 type_map 更精确地表达
      const h = hintFor(c);
      if (!h) continue;
      push({ id: u.id, kind: h.kind, detail: c, why: h.why, basis: h.basis, suggested: h.suggested, line: u.srcLine });
    }
    if (u.kind === 'func' && u.bodyHole && !input.filled?.has(u.id)) {
      const fail = input.fillFailures?.get(u.id);
      push({
        id: u.id,
        kind: 'body',
        detail: fail ? `函数体未翻译（LLM 填充失败：${fail}）` : '函数体未翻译（仍是 TODO 孔）',
        why: fail ? '多次纠错重试仍没过静态闸' : '没有请求 LLM 填充，也没有人工填入',
        basis: 'missing',
        suggested: fail ? '人工翻译该函数体，或拆小后重试' : 'fill=true，或手动翻译该函数体',
        line: u.srcLine,
      });
    }
  }

  for (const s of input.skipped ?? []) {
    push({ id: s.name, kind: 'structure', detail: `${s.kind} ${s.name} 未进翻译（${s.reason}）`, why: '萃取阶段就判定为不可机械翻译', basis: 'missing', suggested: '手动翻译该声明', line: s.line });
  }
  for (const d of input.diagnostics ?? []) {
    const kind: UnknownKind = /冲突|同名|未定义/.test(d) ? 'missing_lib' : 'structure';
    push({ id: '*', kind, detail: d, why: '项目级诊断（不阻断）', basis: 'missing', suggested: '人工消歧/补实现' });
  }

  return out;
}

// ─────────────────────────────────────────────
// 硬依赖清单（I3 升格）：外部 import 一等区块，strategy 待填
// ─────────────────────────────────────────────

/**
 * 外部 import 路径 → 硬依赖清单条目（strategy 初始空，由模型/人填）。
 * ★ 纯函数：去重保序，不猜策略。
 */
export function buildExternalDeps(imports: readonly string[]): ExternalDep[] {
  const seen = new Set<string>();
  const out: ExternalDep[] = [];
  for (const p of imports) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push({ import: p, strategy: '' });
  }
  return out;
}

// ─────────────────────────────────────────────
// verification：同一批输入，Go 与 TS 逐条比
// ─────────────────────────────────────────────

export interface VerifyUnitInput {
  unit: TransUnit;
  /** 已填的完整 TS 源码（export function …）；未填 = undefined */
  tsCode?: string;
}

export interface VerifyOptions {
  /** Go 源文件全文（Go 侧对拍要能编译） */
  goSource: string;
  /** 每函数从仓库测试抽到的用例（go_tests.harvestForUnits 的产物） */
  harvested?: Map<string, { cases: BehaviorCase[]; tests: GoTestRef[]; notes: string[] }>;
  /** 调用方显式给的用例（优先于仓库测试） */
  supplied?: BehaviorCase[];
  /** 样例最多跑多少条（防大表把回执拖成分钟级） */
  maxCases?: number;
  /** 测试注入口（labs 里可换桩） */
  runHarnessImpl?: ParityOptions['runHarnessImpl'];
}

function caseResultsOf(diff: { details: { case: string; status: 'same' | 'changed'; before?: string; after?: string; before_error?: string; after_error?: string }[] }): CaseResult[] {
  return diff.details.map((d) => ({
    name: d.case,
    status: d.status === 'same' ? 'same' : 'changed',
    go: d.before,
    ts: d.after,
    ...(d.before_error ? { go_error: d.before_error } : {}),
    ...(d.after_error ? { ts_error: d.after_error } : {}),
  }));
}

/** 汇总一句话结论（★ 没验证就明说"未验证"，不许写成完成） */
function summarize(units: UnitVerification[], funcCount: number, nonFunc: number): string {
  const verified = units.filter((u) => u.status === 'verified').length;
  const diff = units.filter((u) => u.status === 'diff');
  const unverified = units.filter((u) => u.status === 'unverified');
  // ★ 只跑了部分样例就不能说「全部一致」：把「已测/共」直接写进结论。
  const truncated = units.filter((u) => (u.cases_available ?? 0) > u.cases_total);
  const unrun = truncated.reduce((s, u) => s + ((u.cases_available ?? 0) - u.cases_total), 0);
  const truncNote = truncated.length
    ? `；★ 样例未跑全：${truncated.length} 个单元共 ${unrun} 条未测（${truncated.map((u) => `${u.unit} ${u.cases_total}/${u.cases_available}`).join('、')}）`
    : '';
  if (diff.length) {
    const changed = diff.reduce((s, u) => s + (u.cases_total - u.cases_matched), 0);
    return `对照测试有差异：${diff.length} 个函数 / ${changed} 条输入输出不一致（${diff.map((d) => d.unit).join(', ')}）`;
  }
  if (verified && !unverified.length) {
    const cases = units.reduce((s, u) => s + u.cases_total, 0);
    return `对照测试通过：${verified} 个函数 / ${cases} 条输入全部一致${truncNote}${nonFunc ? `（另有 ${nonFunc} 个 type/const 单元无运行时可对拍）` : ''}`;
  }
  if (verified) {
    return `部分验证：${verified}/${funcCount} 个函数有对照测试且全部一致${truncNote}；其余 ${unverified.length} 个未验证（${unverified.map((u) => u.unit).join(', ')}）`;
  }
  if (funcCount === 0 && nonFunc > 0) {
    return `未验证：${nonFunc} 个 type/const 单元只做了机械映射，没有任何行为对拍（这类单元没有可执行语义）`;
  }
  const why = unverified[0]?.reason ?? '没有可对拍的函数';
  return `未验证：${why}`;
}

/** 从方法单元原文里读出的三件事（receiver 名 / receiver 类型原文 / 方法名） */
export interface MethodInfo {
  recvName: string;
  /** 带 * 的原样类型（wrapper 要保真：值接收者/指针接收者语义不同） */
  recvType: string;
  method: string;
}

/** `func (u *User) Greet(n string) string` → {u, *User, Greet}；读不出返回 null（不猜） */
export function methodInfo(u: TransUnit): MethodInfo | null {
  const m = /^\s*func\s*\(\s*([A-Za-z_]\w*)\s+(\*?[\w.\[\]]+)\s*\)\s*([A-Za-z_]\w*)/.exec(u.srcSnippet);
  if (!m) return null;
  return { recvName: m[1], recvType: m[2], method: m[3] };
}

/**
 * ★ ① 方法对拍的入口问题：Go 里没有 `User_Greet` 这个包级函数（方法不在包命名空间）
 * ⇒ 合成一个**只转发**的 wrapper 追加进临时 Go 源，让 harness 的反射找得到。
 *
 * ★★ 窄就写窄（别把这条读成"方法已可验证"）：
 *   · 只解决"没有同名包级入口"；
 *   · receiver 是**结构体/指针**时 harness 的 coerce 仍只认标量 ⇒ 会以
 *     `unsupported param type …` 如实报 unverified（根因在 behavior 的 coerce，另案）；
 *   · 泛型 receiver 走不到这里（前面按 typeParams 已跳过，wrapper 表达不出类型参数）。
 */
export function methodWrapper(u: TransUnit): { name: string; code: string } | null {
  const info = methodInfo(u);
  if (!info || !u.params?.length) return null;
  if (u.params[0].name !== info.recvName) return null; // 萃取契约变了 ⇒ 不硬拼
  const ps = u.params.map((p, i) => p.name + ' ' + (i === 0 ? info.recvType : p.type)).join(', ');
  const args = u.params.slice(1).map((p) => p.name).join(', ');
  const call = info.recvName + '.' + info.method + '(' + args + ')';
  const ret = u.result ? ' ' + u.result : '';
  const body = u.result ? '\treturn ' + call : '\t' + call;
  return {
    name: u.id,
    code: '\n// parity wrapper（translate_go_ts 自动合成，仅用于对拍，不落盘）\nfunc ' + u.id + '(' + ps + ')' + ret + ' {\n' + body + '\n}\n',
  };
}

/**
 * ★ ① 的边界（写死在这里，别靠调用方自觉）：receiver 能不能被 harness 造出来。
 *   harness 的 coerce 只认标量 ⇒ `Counter`（底层 int）可以，`User`/`*User`（struct）不行。
 *   底层类型从 Go 源里读：`type X struct` ⇒ struct；`type X int|string|bool|...` ⇒ scalar；
 *   读不到 ⇒ unknown（**保守当作不可造**：宁可报未验证，也不拿 nil receiver 换一个假的 same）。
 */
export function receiverKind(goSource: string, recvType: string): 'scalar' | 'struct' | 'unknown' {
  const base = recvType.replace(/^\*/, '').replace(/\[.*\]$/, '');
  if (/^(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|byte|rune|string|bool)$/.test(base)) return 'scalar';
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp('type\\s+' + esc + '\\s+struct\\b').test(goSource)) return 'struct';
  if (new RegExp('type\\s+' + esc + '\\s+(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|uintptr|float32|float64|byte|rune|string|bool)\\b').test(goSource)) return 'scalar';
  return 'unknown';
}

/** 对已填函数逐个跑"同一批输入"对照；只有仓库测试/调用方用例全一致才算 verified */
export function verifyTranslation(inputs: VerifyUnitInput[], opts: VerifyOptions): VerificationReceipt {
  const units: UnitVerification[] = [];
  const repoTests: GoTestRef[] = [];
  const notes = new Set<string>();
  for (const h of opts.harvested?.values() ?? []) {
    for (const t of h.tests) repoTests.push(t);
    for (const n of h.notes) notes.add(n);
  }

  const funcs = inputs.filter((i) => i.unit.kind === 'func');
  const nonFunc = inputs.length - funcs.length;

  for (const it of funcs) {
    const u = it.unit;
    const base = { unit: u.id, source: 'none' as CaseSource, cases_total: 0, cases_matched: 0 };
    if (!it.tsCode) {
      units.push({ ...base, status: 'unverified', reason: `${u.id}：函数体未翻译（无 TS 可执行体）` });
      continue;
    }
    if ((u.typeParams ?? []).length) {
      units.push({ ...base, status: 'unverified', reason: `${u.id}：泛型函数，类型实参未定，自动对拍不可判` });
      continue;
    }

    // ★ ① 方法：Go 侧没有 `Type_Method` 这个包级入口 ⇒ 先合成一个只转发的 wrapper 再对拍。
    //   ★ 这只修"入口"，不修"样例"：receiver 是结构体/指针时 harness 造不出来，
    //     会以 unsupported param type 如实报 unverified（根因在 behavior 的 coerce，别在这里糊）。
    let goSource = opts.goSource;
    let funcName = u.name;
    if (/^\s*func\s*\(/.test(u.srcSnippet)) {
      const w = methodWrapper(u);
      if (!w) {
        units.push({ ...base, status: 'unverified', reason: `${u.id}：方法单元，receiver 形状无法解析 ⇒ 未能合成 Go wrapper，未对拍` });
        continue;
      }
      if (opts.goSource.includes('func ' + w.name + '(')) {
        units.push({ ...base, status: 'unverified', reason: `${u.id}：Go 源已存在同名函数 ${w.name}（不覆盖）⇒ 未对拍` });
        continue;
      }
      goSource = opts.goSource + w.code;
      funcName = w.name;
      // ★ 入口有了 ≠ 样例有了：receiver 是结构体/指针时 coerce 造不出来。
      //   这里**必须挡在跑之前** —— 否则调用方给一条 args:[null,…] 就能让 Go 侧
      //   在 nil receiver 上跑通、TS 侧恰好也没用到 receiver ⇒ 换回一个假的 verified。
      const info = methodInfo(u);
      const kind = info ? receiverKind(opts.goSource, info.recvType) : 'unknown';
      if (kind !== 'scalar') {
        units.push({
          ...base,
          status: 'unverified',
          source: 'none',
          reason: `${u.id}：方法单元，receiver 是 ${info?.recvType ?? '?'}（${kind === 'struct' ? '结构体' : '底层类型未知'}），harness 的 coerce 只认标量 ⇒ 造不出 receiver，未对拍`,
        });
        continue;
      }
    }

    const h = opts.harvested?.get(u.id);
    let cases: BehaviorCase[];
    let source: CaseSource;
    if (opts.supplied?.length) {
      cases = opts.supplied;
      source = 'supplied';
    } else if (h && h.cases.length) {
      cases = h.cases;
      source = 'repo_test';
    } else {
      // ★ 冒烟样例只对能造样例的类型有意义：map/struct/chan 这类会退化成 0，
      //   两侧都会抛错/输出无意义 ⇒ 强行对比只会造出假 diff。此时如实报"没输入"。
      const canSmoke = (u.params ?? []).every((p) => typeSamples(p.type).length > 0);
      if (!canSmoke) {
        units.push({
          ...base,
          status: 'unverified',
          source: 'none',
          reason: `${u.id}：仓库无测试用例，且参数类型（${(u.params ?? []).map((p) => p.type).join(', ')}）生成不出自动样例`,
        });
        continue;
      }
      cases = generateCasesFor(u.params ?? []);
      source = 'smoke';
    }
    const cap = opts.maxCases ?? 200;
    // ★ 截断必须进回执：否则「跑了 200/250」会被读成「250 条全一致」（假绿）。
    const casesAvailable = cases.length;
    if (casesAvailable > cap) {
      cases = cases.slice(0, cap);
      notes.add(`${u.id}：样例 ${casesAvailable} 条，只跑了 ${cases.length} 条（maxCases=${cap}），其余 ${casesAvailable - cases.length} 条未测`);
    }
    const truncated = casesAvailable > cases.length ? { cases_available: casesAvailable } : {};
    // 后面每条 push 都展开 ...base ⇒ 截断读数对 verified/diff/unverified 一视同仁
    Object.assign(base, truncated);

    if (!cases.length) {
      units.push({ ...base, status: 'unverified', source: 'none', reason: `${u.id}：没有可用输入（仓库无测试，参数类型也生成不出样例）` });
      continue;
    }

    try {
      const res = checkTranslationParity({
        goSource,
        funcName,
        tsOutput: it.tsCode,
        cases,
        ...(opts.runHarnessImpl ? { runHarnessImpl: opts.runHarnessImpl } : {}),
      });
      const casesArr = caseResultsOf(res.verdict);
      const matched = casesArr.filter((c) => c.status === 'same').length;
      if (res.verdict.verdict === 'error') {
        const why = res.goRun.error ?? res.tsRun.error ?? res.verdict.message;
        units.push({ ...base, status: 'unverified', source, cases_total: cases.length, cases_matched: matched, reason: `${u.id}：对拍跑不起来（${why}）`, cases: casesArr });
      } else if (res.verdict.verdict === 'diff') {
        units.push({ ...base, status: 'diff', source, cases_total: cases.length, cases_matched: matched, reason: res.verdict.message, cases: casesArr });
      } else if (source === 'smoke') {
        // ★ 冒烟样例是"自动生成的"，不是仓库测试 ⇒ 即使全过也**不许**记 verified
        units.push({
          ...base,
          status: 'unverified',
          source,
          cases_total: cases.length,
          cases_matched: matched,
          reason: `${u.id}：仓库无测试用例，只跑了 ${cases.length} 条自动生成的冒烟样例（${matched}/${cases.length} 一致），不构成等价证明`,
          cases: casesArr,
        });
      } else {
        units.push({ ...base, status: 'verified', source, cases_total: cases.length, cases_matched: matched, cases: casesArr });
      }
    } catch (e) {
      units.push({ ...base, status: 'unverified', source, cases_total: cases.length, reason: `${u.id}：对拍异常（${(e as Error).message}）` });
    }
  }

  const verifiedAll = units.length > 0 && units.every((u) => u.status === 'verified');
  const anyDiff = units.some((u) => u.status === 'diff');
  const anyVerified = units.some((u) => u.status === 'verified');
  const status: VerifyStatus = anyDiff ? 'diff' : verifiedAll ? 'verified' : anyVerified ? 'partial' : 'unverified';
  return { status, summary: summarize(units, funcs.length, nonFunc), units, repo_tests: repoTests, notes: [...notes] };
}

/** 没有可执行函数 / 未请求对拍时的回执（★ 明确写"未验证"，不留空白让人误读成完成） */
export function unverifiedReceipt(reason: string, funcCount = 0, nonFunc = 0): VerificationReceipt {
  return { status: 'unverified', summary: `未验证：${reason}`, units: [], repo_tests: [], notes: funcCount || nonFunc ? [`可对拍函数 ${funcCount} 个、type/const ${nonFunc} 个`] : [] };
}
