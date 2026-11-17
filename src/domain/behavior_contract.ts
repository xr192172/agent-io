/**
 * behavior_contract —— 行为契约编译器（`docs/PROJECT-DESIGN.md` §9.5）的**判定核**：纯函数、**零 import**。
 *
 * ## 它判什么
 * 拿一份 §9.5.2 的 `BehaviorContract` 加上**外部取来的事实**（主体解析结果 / 语言能力 / 依赖面），
 * 逐条走 §9.5.3 的**八步**（★ 逐字是**八段**箭头，不是七 —— 报文要点名「哪一步」，编号错一位就指错步），
 * 每步给 `{ stage, ok, gaps }`；第 6 步顺带产出**现有 `behavior-cases` 输入**。
 *
 * ## 三条设计约束（都有代价，写死别改）
 * ① **零 import**：`behavior-cases` 的 harness 会把本文件单独转译再 import
 *    ⇒ 有任何值 import 就 load 不起来 ⇒ 这份判定只剩 `source-has` 那种"改坏了也绿"的存在类判据。
 * ② **入参收 `unknown`**：它们来自 JSON（判据的 `given` 就是 JSON，`expect` 是返回值的 repr 串）
 *    ⇒ **形状校验本身就是第 1 步的活**，不借类型系统假装"外面已经对了"。
 * ③ **`ok: null` 是一个正经的态**：= 本函数**不判**这一步（第 7/8 步移交下游、或前一步已失败未判到）。
 *    **不许**把"没判"写成 `true` —— 那正是"检查对象退出检查范围 ⇒ 检查自动变绿"。
 *
 * ## 与「自证」的边界（§9.5.7 逐字：自动化消除的是测试的机械写法，不是独立语义预期）
 * `cases` 为空 ⇒ **第 1 步就 unsupported**。为什么必须在这里挡：
 * `judgeExpectations` 的 `behavior-cases` 分支**不校验形状**，`cases: []` 会判 **pass**（detail「0/0 case 一致」）；
 * 形状校验只在 `edit_dsl` 的写路径（`assertValidExpectations`，`minItems: 1`）上，
 * 而**内存编译路径绕开写路径** ⇒ 编译器这一格是**承重**的：漏了就把"一个没写的测试集"判成"全过"。
 *
 * ## 为什么 `expect` 必须在第 4 步被拒（而不是透传）
 * 核的比对尺是 `sameBehaviorRet(ret, expect: string)`：`ret` 是规范化 repr（字符串带引号），
 * 非字符串的 `expect` 走 `String(v) === expect` ⇒ **恒 false** ⇒ 透传一次就造出一条**永远红**的判据。
 * 恒红比假绿更坏：假绿会被忽略，恒红会被当成"这条判据坏了"然后被删掉。
 */

// ── §9.5.2 的逻辑契约 ────────────────────────────────────────
// ★ `subject.file` 可选：§9.5.5 第 1 条逐字是「自动得到 file/symbol」——
//   若 file 必填、编译器只做一致性校验，第 2 步就退化成"确认给定值"，反向三（主体缺失）也验不到"自动定位"。

/** 契约来源（§9.5.1 五档可信程度里的四档；观测那一档必须先被认可才轮得到它） */
export type BehaviorContractSource = 'design' | 'existing-test' | 'approved-baseline' | 'translation';

export interface BehaviorContractCase {
  /** 位置实参（JSON 值；原样传给被考函数，不 parse） */
  given: unknown[];
  /** 期望输出。★ 这里刻意是 `unknown`：第 4 步负责归一成核要的裸串 */
  expect: unknown;
}

export interface BehaviorContract {
  id: string;
  /** ★ 缺 `file` ⇒ 由实际 DB 反查；给了 ⇒ **核对**（不一致就报冲突，不给"以谁为准"的默认） */
  subject: { file?: string; symbol: string };
  /** 这条行为**为什么**应如此（§9.5.2 必填：说不出的不是契约，是"当前实现的副本"） */
  intent: string;
  cases: BehaviorContractCase[];
  source: BehaviorContractSource;
  /** 已有夹具 / 环境要求（不复制实现） */
  setupRefs: string[];
}

// ── 外部取来的事实（本文件不做 IO：谁取事实谁负责在报文里说清"取不到"）──────

/** 主体解析的四态（与 `contractPage` 的 `resolution` 逐字同词：查不到是一个**态**，不是空数组） */
export type SubjectResolution = 'ok' | 'ambiguous' | 'not-found' | 'index-unavailable';

export interface ContractSubjectFacts {
  resolution: SubjectResolution;
  /** 反查到的仓库相对路径 */
  file?: string;
  signature?: string;
  /** `resolution === 'ambiguous'` 时的全部候选（不替调用方挑） */
  candidates?: Array<{ file: string; line?: number }>;
  note?: string;
}

export interface ContractCapabilityFacts {
  /** 目标文件语言（`langOfFile` 的返回值；空串 = 判不出来） */
  lang?: string;
  /** 该语言能否**独立执行**。★ 缺省 ≠ true：缺事实就判不了，判不了就 unsupported */
  toolchain_ok?: boolean;
  toolchain_reason?: string;
  /** 真三方包的值 import 处数（E-CRIT-006）。★ 缺省 ≠ 0：缺事实就是"不知道依赖面" */
  bare_count?: number;
  bare?: string[];
  relative_count?: number;
  builtin_count?: number;
  /** 最小夹具能否建起来。★ 缺省 ≠ true */
  fixture_ok?: boolean;
  fixture_reason?: string;
}

export interface ContractCompileFacts {
  subject: ContractSubjectFacts;
  capability?: ContractCapabilityFacts;
}

// ── §9.5.3 的八步（逐字照抄文档的八段箭头）───────────────────────
// ★ `COMPILE_STAGES.length === 8` 是硬约束：报文用「第 N 步」定位失败，少一步就全程指错步。

export const COMPILE_STAGES = [
  '1 契约提取/模型写语义示例',
  '2 解析主体：file/symbol/export/signature',
  '3 读取能力：能否独立执行 / 是否需要依赖镜像或 IO 替身',
  '4 生成调用计划：模块加载 / 参数适配 / 返回值与异常比较',
  '5 生成最小夹具：只含契约要求的依赖，不复制整个项目',
  '6 编译为现有 behavior-cases 输入',
  '7 真跑并产生 verdict + 执行证据',
  '8 结果交给 ChangeSet / plan / complete',
] as const;

/** 步名（超出八步 ⇒ 明说，不静默回落到第一步） */
export function stageName(no: number): string {
  const s = COMPILE_STAGES[no - 1] as string | undefined;
  return s ?? `第 ${no} 步（**超出八步**：§9.5.3 只有八步）`;
}

/**
 * 第 7/8 步**移交给了谁** —— 短值（`behavior-cases` 判得了；完整指路仍在 `delegated` 里）。
 *
 * ## 为什么单开一个短值接口（与 `compileGate` 同族，`:403-407` 自述的理由逐字相同）
 * `planContractCompile` 的 `delegated` 是**散文**（要同时说清"移交给谁"与"为什么不由本函数判"）；
 * 而 `behavior-cases` 的 `expect` 是**返回值的 repr 裸串** ⇒ 长文推不准、也判不了。
 * ⇒ 把"移交对象"钉成一个短值：它可判，且**反向针**能红
 *（把第 8 步改回"未实现"这类说法 ⇒ 判据当场红；这正是 §9.5.5 第 2 条接线与否的分界）。
 *
 * ## 值域（闭集，别扩成"自由文本"）
 * · `1..6` = **本函数自己判**（不交给任何人）⇒ `'in-process'`；
 * · `7` = 真跑与执行证据 ⇒ `'judgeExpectations'`（`behavior_compile.ts#compileBehaviorContracts` 里那个**现有**执行核）；
 * · `8` = 结果交给 ChangeSet / plan / complete ⇒ `'plan+complete'`
 *   （plan 侧只存 `judgement_ref`、核销侧只读实际执行 verdict；编译面入口 = `design_line action=compile`）；
 * · 超出八步 ⇒ `'out-of-range@<no>'`（**明说**，不静默落回第一步 —— 与 {@link stageName} 同口径）。
 */
export function delegationToken(no: number): string {
  if (no === 7) return 'judgeExpectations';
  if (no === 8) return 'plan+complete';
  if (no >= 1 && no <= 6) return 'in-process';
  return `out-of-range@${no}`;
}

// ── 判定结果 ────────────────────────────────────────────────

/** 某一步的判定：`true` 过 / `false` 不过 / `null` **本函数不判** */
export interface CompileStageResult {
  stage: string;
  ok: boolean | null;
  gaps: string[];
  /** `ok === null` 时**为什么**不由本函数判（值 = 移交给了谁 / 被谁先挡住了） */
  delegated?: string;
}

/** 第 6 步产物 = **现有** `behavior-cases` 输入（与 `edit_dsl` 写进决策卡的那条逐字同形） */
export interface CompiledBehaviorCasesInput {
  kind: 'behavior-cases';
  path: string;
  symbol: string;
  cases: Array<{ given: unknown[]; expect: string }>;
  why: string;
}

export interface CompiledContractPlan {
  contract_id: string;
  verdict: 'ready' | 'unsupported';
  /** 第一个失败的步名（`verdict === 'ready'` 时 null） */
  failed_stage: string | null;
  failed_stage_no: number | null;
  /** 恒 `COMPILE_STAGES.length` 条（第 1..6 步本函数判，第 7/8 步标 delegated） */
  stages: CompileStageResult[];
  file: string | null;
  symbol: string | null;
  /** 第 6 步产物。★ `verdict !== 'ready'` ⇒ **不产出**：不许拿半个产物去凑一个期望 */
  expectation?: CompiledBehaviorCasesInput;
}

// ── 纯工具（零 import 的手写版）────────────────────────────────

/** 仓库相对路径的规范形（`\`→`/`、去前导 `./`、折叠重复 `/`、去尾 `/`）—— 与 `expectation#normPath` 同口径 */
function normPath(p: unknown): string {
  let s = String(p ?? '').trim().replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.replace(/\/+$/, '');
  return s;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
}

/** 给人看的类型名（报文里**不许**出现 `[object Object]`） */
function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t !== 'object') return t === 'undefined' ? 'undefined（缺这个键）' : t;
  const ctor = (v as { constructor?: { name?: string } }).constructor;
  return ctor && ctor.name ? `object(${ctor.name})` : 'object';
}

/** 一个值能不能原样走 `JSON.stringify` 传给 harness 的 CASES（不能 ⇒ 返回原因） */
function jsonProblemOf(v: unknown, where: string, depth: number, seen: unknown[]): string | null {
  if (depth > 20) return `${where} 嵌套超过 20 层（不再深挖）`;
  if (v === null) return null;
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return null;
  if (t === 'number') return Number.isFinite(v as number) ? null : `${where} 不是有限数字（${String(v)}）`;
  if (t === 'undefined') return `${where} 是 undefined`;
  if (t === 'function') return `${where} 是函数`;
  if (t === 'symbol') return `${where} 是 symbol`;
  if (t === 'bigint') return `${where} 是 bigint`;
  if (!isPlainObject(v) && !Array.isArray(v)) {
    return `${where} 是 ${typeOf(v)}（JSON 传参会被**静默降级**，函数收到的不是同一个值）`;
  }
  if (seen.indexOf(v) >= 0) return `${where} 有循环引用`;
  const next = seen.concat([v]);
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = jsonProblemOf(v[i], `${where}[${i}]`, depth + 1, next);
      if (p) return p;
    }
    return null;
  }
  for (const k of Object.keys(v as Record<string, unknown>)) {
    const p = jsonProblemOf((v as Record<string, unknown>)[k], `${where}.${k}`, depth + 1, next);
    if (p) return p;
  }
  return null;
}

// ── 主判定 ──────────────────────────────────────────────────

/**
 * 按 §9.5.3 的八步判一份契约能不能编到**现有** `behavior-cases` 执行核上。
 *
 * ★ 每步都**可判失败**，且失败一律给 `unsupported` + 具体缺口（不是"跳过这条后报全绿"）。
 * ★ 第 7/8 步**不由本函数判**（真跑与核销接入在下游），以 `ok: null` + `delegated` **显式移交**。
 */
export function planContractCompile(contract: unknown, facts: unknown): CompiledContractPlan {
  const stages: CompileStageResult[] = COMPILE_STAGES.map((stage, i) => {
    // ★★★ 2026-11-17（T-#N4）：第 7/8 步的 `delegated` 从"散文"改成**短值开头 + 一句真话指路**。
    //   · 改前第 8 步写的是 `未实现：§9.5.5 第 2 条「接入计划与核销」` —— 而那一半**早就在跑**：
    //     plan 侧只存 `judgement_ref`（`design/index.ts` 的 entries schema）、核销侧现跑判据
    //     （`task_ops#completeTask → runPlanJudgements → complete_canvas_gate`）。
    //     唯一真缺的是**编译面入口**，它现在有了：`design_line action=compile`。
    //   · `ok` 仍是 `null`（★ 不许升 true）：本函数**看不到** complete 会不会真的放行，
    //     写成 true 就是拿没判的东西冒充判过（本文件头注约束③）。
    if (i === 6) {
      return {
        stage,
        ok: null,
        gaps: [],
        delegated:
          `${delegationToken(7)}：真跑与执行证据交给**现有** behavior-cases 执行核` +
          '（`behavior_compile.ts#compileBehaviorContracts → judgeExpectations`；不另造 runner）',
      };
    }
    if (i === 7) {
      return {
        stage,
        ok: null,
        gaps: [],
        delegated:
          delegationToken(8) +
          ' —— §9.5.5 第 2 条（`docs/PROJECT-DESIGN.md:623`）：plan 侧只存稳定引用' +
          '（`judgement_ref`，**不复制判据正文**）、核销侧只读**实际执行** verdict' +
          '（`runPlanJudgements` → `complete_canvas_gate`，入口 `task_ops#completeTask`）；' +
          '编译面入口 = `design_line action=compile`（本函数只判第 1..6 步）',
      };
    }
    return { stage, ok: false, gaps: [] };
  });

  const c = (isPlainObject(contract) ? contract : {}) as Record<string, unknown>;
  const f = (isPlainObject(facts) ? facts : {}) as Record<string, unknown>;
  const subject = (isPlainObject(c.subject) ? c.subject : {}) as Record<string, unknown>;
  const sf = (isPlainObject(f.subject) ? f.subject : {}) as Record<string, unknown>;
  const cap = (isPlainObject(f.capability) ? f.capability : {}) as Record<string, unknown>;
  const symbol = typeof subject.symbol === 'string' ? subject.symbol.trim() : '';

  /** 收口：把第 no 步标红，其后未判到的步标 `ok: null`（**不许**留成"没过"冒充"没判"） */
  const fail = (no: number, gaps: string[]): CompiledContractPlan => {
    stages[no - 1].ok = false;
    stages[no - 1].gaps = gaps.slice();
    for (let i = no; i < 6; i++) {
      stages[i].ok = null;
      stages[i].gaps = [`未判：第 ${no} 步先失败了`];
      stages[i].delegated = `未判（第 ${no} 步先失败）`;
    }
    return {
      contract_id: typeof c.id === 'string' ? c.id : '',
      verdict: 'unsupported',
      failed_stage: stages[no - 1].stage,
      failed_stage_no: no,
      stages,
      file: null,
      symbol: symbol || null,
    };
  };

  // ── 第 1 步：契约本身（★「有没有独立预期」在这里判，不留给下游）──
  const g1: string[] = [];
  if (!isPlainObject(contract)) g1.push(`契约不是对象（实际 ${typeOf(contract)}）⇒ 没有可编译的东西`);
  if (typeof c.id !== 'string' || !c.id.trim()) {
    g1.push('契约缺稳定的 id（§9.5.2：稳定 id 与来源必须能追溯到原始契约）');
  }
  if (typeof c.intent !== 'string' || !c.intent.trim()) {
    g1.push('契约缺 intent（§9.5.2：这条行为**为什么**应如此 —— 说不出的只是"当前实现的副本"）');
  }
  if (!symbol) g1.push('契约缺 subject.symbol（第 2 步要靠它反查 file）');
  const rawCases = Array.isArray(c.cases) ? (c.cases as unknown[]) : null;
  if (rawCases === null) {
    g1.push(`契约的 cases 不是数组（实际 ${typeOf(c.cases)}）`);
  } else if (rawCases.length === 0) {
    g1.push(
      '契约**没有独立预期**（cases 为空）⇒ 只能执行采集、不能判行为正确；' +
        '★ 不许把运行观察值写成期望（§9.5.7：自动化消除的是测试的机械写法，不是独立语义预期）',
    );
  } else {
    rawCases.forEach((x, i) => {
      if (!isPlainObject(x)) {
        g1.push(`第 ${i + 1} 条 case 不是对象（实际 ${typeOf(x)}）`);
        return;
      }
      if (!Array.isArray(x.given)) {
        g1.push(`第 ${i + 1} 条 case 的 given 不是数组（位置实参必须是数组，实际 ${typeOf(x.given)}）`);
      }
    });
  }
  if (g1.length) return fail(1, g1);
  stages[0].ok = true;
  const list = rawCases as unknown[];

  // ── 第 2 步：解析主体（file / symbol / export / signature 由实际 DB 给）──
  const g2: string[] = [];
  const res = String(sf.resolution ?? '');
  if (res === 'ambiguous') {
    const cands = Array.isArray(sf.candidates) ? (sf.candidates as Array<Record<string, unknown>>) : [];
    const shown = cands
      .slice(0, 3)
      .map((x) => `${String(x.file)}:${String(x.line ?? '?')}`)
      .join(' · ');
    g2.push(`主体**多候选**（${cands.length} 处同名定义${shown ? `：${shown}` : ''}）⇒ 不替你挑一个（选择是语义判断）`);
  } else if (res === 'not-found') {
    g2.push(`主体在**实际 DB 里查不到**（symbol=${symbol}）⇒ 没有可执行的对象${sf.note ? `（${String(sf.note)}）` : ''}`);
  } else if (res === 'index-unavailable') {
    g2.push('**索引不可用**（没有可解析的源码 / 建索引失败）⇒ 第 2 步判不了 —— 这不是"符号不存在"');
  } else if (res !== 'ok') {
    g2.push(`主体解析没有给出四态之一（resolution=${res || '(缺)'}）—— 缺事实 ≠ 主体存在`);
  }
  const file = normPath(sf.file);
  if (res === 'ok' && !file) g2.push('resolution=ok 却没给出 file ⇒ 事实自相矛盾');
  const claimedFile = normPath(subject.file);
  if (claimedFile && file && claimedFile !== file) {
    g2.push(
      `契约写的 subject.file=${claimedFile} 与 DB 反查到的 ${file} **不一致** ⇒ 契约与代码已经对不上（不给"以谁为准"的默认）`,
    );
  }
  if (g2.length) return fail(2, g2);
  stages[1].ok = true;

  // ── 第 3 步：读取能力（能不能独立执行 / 依赖要不要镜像或替身）──
  const g3: string[] = [];
  const lang = String(cap.lang ?? '');
  if (!lang) {
    g3.push(
      `语言判不出来（capability.lang 为空）⇒ 不知道能不能独立执行` +
        `${cap.toolchain_reason ? `（${String(cap.toolchain_reason)}）` : ''}`,
    );
  } else if (cap.toolchain_ok === undefined) {
    g3.push(`没有 ${lang} 的**能否独立执行**读数（capability.toolchain_ok 缺失）⇒ 缺事实 ≠ 能跑`);
  } else if (cap.toolchain_ok !== true) {
    g3.push(`${lang} 不能独立执行：${String(cap.toolchain_reason ?? '工具链不可用')}`);
  }
  const bareCount = cap.bare_count;
  if (typeof bareCount !== 'number') {
    g3.push('没有依赖面读数（capability.bare_count 缺失）⇒ 判不了夹具能不能把依赖带过去（缺事实 ≠ 零依赖）');
  } else if (bareCount > 0) {
    const bare = Array.isArray(cap.bare) ? (cap.bare as unknown[]).map(String) : [];
    g3.push(
      `目标文件有 ${bareCount} 处**真三方包的值 import**${bare.length ? `（${bare.slice(0, 3).join(' / ')}）` : ''}` +
        ' ⇒ 单独转译进 tmp 会 load 失败（E-CRIT-006）；出路：把它抽成 src/domain/ 下的零依赖纯函数，或换判据种类',
    );
  }
  if (g3.length) return fail(3, g3);
  stages[2].ok = true;

  // ── 第 4 步：生成调用计划（参数适配 + 返回值/异常比较的口径）──
  const g4: string[] = [];
  list.forEach((x, i) => {
    const one = x as Record<string, unknown>;
    const expect = one.expect;
    if (typeof expect !== 'string') {
      g4.push(
        `第 ${i + 1} 条 expect 不是字符串（实际 ${typeOf(expect)}）⇒ 核的比对尺 sameBehaviorRet 对非字符串**恒 false**，` +
          '透传会造出一条「永远红」的判据（恒红会被当成"判据坏了"删掉）；期望必须写成返回值的 repr 裸串，如 "src/a.ts" / "5" / "true"',
      );
    }
    const given = one.given as unknown[];
    const jp = jsonProblemOf(given, `given[${i + 1}]`, 0, []);
    if (jp) g4.push(`第 ${i + 1} 条 ${jp} ⇒ harness 的 CASES 走 JSON.stringify，函数收到的就不是这个值`);
  });
  if (g4.length) return fail(4, g4);
  stages[3].ok = true;

  // ── 第 5 步：最小夹具（只含契约要求的依赖，不复制整个项目）──
  const g5: string[] = [];
  if (cap.fixture_ok === undefined) {
    g5.push('没有夹具可建性读数（capability.fixture_ok 缺失）⇒ 缺事实 ≠ 夹具建得起来');
  } else if (cap.fixture_ok !== true) {
    g5.push(`最小夹具建不起来：${String(cap.fixture_reason ?? '未知原因')}`);
  }
  if (g5.length) return fail(5, g5);
  stages[4].ok = true;

  // ── 第 6 步：编成**现有** behavior-cases 输入（并自检它过不过现有写路径的形状规则）──
  const why =
    `${String(c.intent).trim()}（契约 ${String(c.id)} / 来源 ${String(c.source ?? '(未标)')}` +
    `${claimedFile ? ` / 指定 ${claimedFile}` : ' / file 由 DB 反查'}）`;
  const expectation: CompiledBehaviorCasesInput = {
    kind: 'behavior-cases',
    path: file,
    symbol,
    cases: list.map((x) => {
      const one = x as Record<string, unknown>;
      return { given: one.given as unknown[], expect: one.expect as string };
    }),
    why,
  };
  const g6: string[] = [];
  if (!expectation.path) g6.push('产物的 path 为空');
  if (!expectation.symbol) g6.push('产物的 symbol 为空');
  if (!expectation.cases.length) g6.push('产物的 cases 为空（现有写路径 assertValidExpectations 要求 minItems=1）');
  if (expectation.cases.some((x) => typeof x.expect !== 'string')) g6.push('产物里有非字符串 expect');
  if (!expectation.why.trim()) g6.push('产物的 why 为空（每个 kind 都要求 why 带实体）');
  if (g6.length) return fail(6, g6);
  stages[5].ok = true;

  return {
    contract_id: String(c.id),
    verdict: 'ready',
    failed_stage: null,
    failed_stage_no: null,
    stages,
    file,
    symbol,
    expectation,
  };
}

/**
 * 判据友好的**窄接口**（短值）：`ready` / `unsupported@N`。
 * ★ 为什么单开一个：`behavior-cases` 的 `expect` 是返回值的 repr 裸串，整份 plan 太长推不准；
 *   而短值 `unsupported@N` 恰好把"哪一步"钉死（N = §9.5.3 的步号）。
 */
export function compileGate(contract: unknown, facts: unknown): string {
  const plan = planContractCompile(contract, facts);
  if (plan.verdict === 'ready') return 'ready';
  return `unsupported@${plan.failed_stage_no ?? 0}`;
}

// ── 真跑失败 → 归因到某一步（纯函数：核的报文是文本，判定只认结构）──

export interface RunFailureAttribution {
  stage_no: number;
  stage: string;
  why: string;
}

/**
 * 把执行核的失败报文归因到 §9.5.3 的某一步。
 *
 * ★ 为什么需要它：`runHarness` 只会说 `top-level function not found: x` / `目标文件加载失败: …`，
 *   **它不知道自己是第几步**。而反向三要求"明示哪个编译阶段失败" ⇒ 归因必须有个唯一住处（本函数），
 *   不许每个调用方各写一套正则。
 * ★ 口径：**只有这四类可归因**，其余一律落第 7 步（真跑）—— 猜成第 2 步会把"实现写错"误报成"主体缺失"。
 */
export function attributeRunFailure(detail: string): RunFailureAttribution {
  const d = String(detail ?? '');
  const at = (no: number, why: string): RunFailureAttribution => ({ stage_no: no, stage: stageName(no), why });
  if (/top-level function not found/i.test(d)) {
    return at(
      2,
      'DB 找到了定义，但 harness 加载后拿不到这个**顶层导出** ⇒ 「export 可达」没过' +
        '（本仓 cache.db 没有 exported 列，这一格只能在加载时确认）',
    );
  }
  if (/工具链|未安装|版本[^。]{0,12}低于|认不出版本/.test(d)) {
    return at(3, '这台机器上的语言工具链不可用 ⇒「能否独立执行」没过');
  }
  if (/目标文件转译失败|目标文件加载失败|Cannot find|闭包|夹具/.test(d)) {
    return at(5, '夹具没能把目标文件与它需要的依赖带进 tmp ⇒「最小夹具」没过（这**不是**行为错）');
  }
  return at(7, '核跑了但结论不是 pass/fail ⇒ 真跑这一格没过');
}
