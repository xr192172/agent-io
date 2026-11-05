/**
 * ★★★ 2026-10-28（T-#KIND-1 · 用户："你写的这部分有没有补丁式的，要不要结构化重写"）：
 * **判据 kind 的注册表 —— 单一事实源**。
 *
 * ## 它解决什么（实测代价）
 * 加一个 kind 原来要动 **5 个文件**：`expectation.ts` 里 **8 处** + 求值器 + 强度分类 +
 * `schema/design_dsl.schema.json`（**2 处** anyOf）+ `docs/GUIDE-GATE.md` 判据表。
 * 2026-10-28 一天内加了 3 个 kind（`domain-independent` / `cert` / `runtime`）⇒ 同一套手工同步做了**三遍**，
 * 且**漏了一次文档**（判据表写 10 种，实际 12）。这就是本仓头号病"同一件事住多处"在判据体系自身的体现。
 *
 * ## 现在的事实源在这里
 * 每个 kind 一条声明：`phase` · `fields`（名字/类型/必填/约束/说明）· `render` · `subject` · `paths`。
 * 由它**派生**：
 * · `EXPECTATION_KINDS`（名字清单）
 * · `assertValidExpectations`（形状校验 —— 写入路径要响亮拒绝）
 * · `renderExpectation`（人读一行）
 * · `expectationSubjectPath` / `expectationPaths`（对账用）
 * · **JSON Schema 的 anyOf 分支**（`scripts/gen_dsl_schema.mjs` 从这里生成，不再手抄）
 *
 * ## 不从这里派生的两处（**故意的**，都是编译器兜底）
 * · **TS 类型联合**（`Expectation`）—— 留在 `expectation.ts`；
 *   忘了同步 ⇒ 求值器里访问字段会**编译不过**（比运行时才发现强）；
 * · **求值器 `switch`** —— 留在 `intent/expectations.ts`（要 fs/db，属 application 层）。
 *
 * ★ 本文件**不引外部依赖**（domain 层不许引 zod / fs）—— 所以字段表是声明式数据，不是 zod schema。
 * ★ ~~2026-10-30（T-#KIND 后续 · source-has 剥注释）：唯一的 import 是同域的零依赖剥注释器~~
 * ★★ **2026-11-04（subagent:text-has-fix）：剥注释已离开本文件** —— 它上移到
 *   `application/design/intent/expectations.ts#judgeSourceHas`（application 层可以引 infrastructure 的
 *   **AST 注释区间**权威 `infrastructure/parse/comments.ts#stripCommentsSync`；domain 引不到它）。
 *   本文件只留**匹配核**（`matchSourceHas`）。
 *   ★★ 2026-11-05（subagent:match-bounded）：**它不再是零 import** —— 多了同域零依赖的 `./text_strip.js`
 *      （`isIdentifierNeedle` 分档 + `hasIdentifierToken` 边界扫描）。为什么这条 **相对 import 仍然安全**：
 *      `behavior-cases` 的夹具会把**相对 import 闭包整棵拷进 tmp**（`text_strip.ts` 本身零 import）
 *      ⇒ 目标文件仍能被单独转译再 import；被禁的是 fs/zod 这类**不可拷的三方/内置值 import**。
 *      ★ 为什么不把这两个谓词内联回本文件：它们是**判据引擎与 `edit_code` 都要的同一件事**，
 *      内联一份 = 0.9.1 方向 A 的第二处权威（`identifiers` 表那份 AST 偏移版在 infrastructure，domain 引不到）。
 *   为什么必须上移：手写状态机在带引号的正则字面量（`/^import\s+['"]/`）上失步 ⇒
 *   67 个代码目标里 9 个**漏剥**（漏剥 = 注释仍算命中 = 白送绿），而 AST 区间不会失步。
 */

/** 字段类型：够表达现有 11 种判据；不要为了"通用"提前长成 ORM */
import { hasIdentifierToken, isIdentifierNeedle } from './text_strip.js';

export type FieldType = 'string' | 'string[]' | 'json[]' | 'number' | 'boolean' | 'object' | 'object[]';

export interface FieldSpec {
  name: string;
  type: FieldType;
  /** 必填（缺 / 空串 / 空数组 ⇒ 拒） */
  required?: boolean;
  /** 允许值（给了就是闭集） */
  values?: readonly string[];
  /** 数组最小长度（如 `must_not_import` 至少 1 个） */
  minItems?: number;
  /** 给 JSON Schema / 文档用的说明 */
  desc?: string;
  /** 数组元素的子字段（`behavior-cases` 的 cases 用） */
  items?: readonly FieldSpec[];
  /**
   * ★★★ 2026-11-04（subagent:text-has-fix）：这个字段被设成 `true` 时，`why` **必须提到这个词**。
   *
   * 为什么会有这种字段：有些开关的作用是**放宽一条既有判据**（如 `includeComments` 把"剥注释"关掉）。
   * 这种放宽如果是静默的，它就会变成「偷偷关掉判据」的口子 ⇒ 要求写它的人**当场把理由写出来**。
   * ★ 判据是结构性的：`why` 里没有这个词 ⇒ **写不进去**（不是"文档提醒你别滥用"）。
   */
  requiresWhyToMention?: string;
  /**
   * ★★★ 2026-11-05（R9-a / subagent:r9a-env）：这个**字符串**字段里不许出现环境态词
   * （`ENV_STATE_TOKENS`：时钟 / 随机 / 计时 / 目录枚举顺序 / 进程环境 / 运行期取模块）。
   *
   * 为什么声明在字段上、而不是在校验函数里硬编 kind 名：与 `requiresWhyToMention` 同一条纪律 ——
   * 规则跟着**字段**走，加一个 kind 或换一格时不会漏掉（实测病史：12 段 if 沙盒，加 kind 必忘一处）。
   * ★ 今天**只有** `run.expect` 用它：那是唯一被 `new Function` 执行的任意 JS（其余 kind 的文本字段
   * 断的是「目标文件里的字」，含这些词是合法的 —— 见 `tests/p0_run_env_rejected.test.ts` 的反向用例）。
   */
  forbidsEnvState?: boolean;
}

export interface KindSpec {
  kind: string;
  /** `pre` = 未施工时天然成立；`post` = 干完才有 */
  phase: 'pre' | 'post';
  fields: readonly FieldSpec[];
  /** 这些字段**至少给一个**（如 `source-has` 的 must / mustNot） */
  atLeastOneOf?: readonly string[];
  /** 人读一行（判据执行回执里就这样出现） */
  render: (e: Record<string, unknown>) => string;
  /** 主体是不是"某个文件"：不是则返回 `''`（别硬凑） */
  subject?: string;
  /** 判据判的"尺度"（对账/门用；便于人一眼看懂这条在管什么） */
  axis: 'file' | 'symbol' | 'edge' | 'call' | 'text' | 'behavior' | 'domain' | 'runtime';
}

const s = (name: string, o: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'string', ...o });
const sArr = (name: string, o: Partial<FieldSpec> = {}): FieldSpec => ({ name, type: 'string[]', ...o });

/** 一档渲染里最多列几条（再多就截断 —— 但**必须给分母**，别让读者以为全集就这么多） */
const RENDER_SHOW = 5;
/** 单条串超过这么多字符就截断（串是给人**看**的，不是给人 copy 的） */
const RENDER_MAX = 80;

/**
 * ★★★ 2026-11-04（subagent:text-has-fix）：把 `must` / `mustNot` 的**串本身**打印出来。
 *
 * ## 它治的是哪条（用户原话："看不到文本判据全集"）
 * 上一版 `render` 只打印**条数**（`must 2 / mustNot 0`）⇒ 判据回执里**看不到断言的是哪段文本**，
 * 想知道就只能回册里逐条翻。于是"某条判据是不是靠注释里的串白送绿"这件事，**在读端根本无从发现**。
 *
 * ## 两条硬要求
 * · **截断必须带分母**（「已截 N 条，共 M 条」）：只截不说 = 让读者以为全集就这么点（0.12 第 3 条）；
 * · **串要带引号**（`JSON.stringify`）：否则前后空格 / 空串这类"看不见的差异"读不出来
 *   —— 而 `source-has` 恰恰是**纯子串**匹配，前后空格就是不同判据。
 */
function renderStringSet(label: string, xs: unknown): string {
  const arr = ((xs as unknown[]) ?? []).map((x) => String(x));
  if (arr.length === 0) return '';
  const head = arr
    .slice(0, RENDER_SHOW)
    .map((x) => JSON.stringify(x.length > RENDER_MAX ? `${x.slice(0, RENDER_MAX)}…` : x));
  const cut = arr.length > RENDER_SHOW ? `（已截 ${arr.length - RENDER_SHOW} 条，共 ${arr.length} 条）` : '';
  return `${label} ${arr.length} 条${cut}：${head.join(' · ')}`;
}

const norm = (v: unknown): string => String(v ?? '').replace(/\\/g, '/');

/** ★ 11 种判据的唯一声明处 */
export const KIND_SPECS: Record<string, KindSpec> = {
  'file-exists': {
    kind: 'file-exists',
    phase: 'post',
    axis: 'file',
    fields: [s('path', { required: true, desc: '仓库相对路径' })],
    render: (e) => `file-exists  ${norm(e.path)}`,
  },
  'symbol-exists': {
    kind: 'symbol-exists',
    phase: 'post',
    axis: 'symbol',
    fields: [s('path', { required: true }), s('symbol', { required: true, desc: '按 AST 判导出' })],
    render: (e) => `symbol-exists  ${norm(e.path)} :: ${String(e.symbol)}`,
  },
  'signature-matches': {
    kind: 'signature-matches',
    phase: 'post',
    axis: 'symbol',
    fields: [s('path', { required: true }), s('symbol', { required: true }), s('signature', { required: true, desc: '比较前压空白' })],
    render: (e) => `signature-matches  ${norm(e.path)} :: ${String(e.symbol)}(${String(e.signature)})`,
  },
  'edge-exists': {
    kind: 'edge-exists',
    phase: 'post',
    axis: 'edge',
    fields: [s('from', { required: true }), s('to', { required: true })],
    render: (e) => `edge-exists  ${norm(e.from)} → ${norm(e.to)}`,
  },
  'edge-absent': {
    kind: 'edge-absent',
    phase: 'pre',
    axis: 'edge',
    fields: [s('from', { required: true }), s('to', { required: true })],
    render: (e) => `edge-absent  ${norm(e.from)} ⇸ ${norm(e.to)}`,
  },
  'call-exists': {
    kind: 'call-exists',
    phase: 'post',
    axis: 'call',
    fields: [s('path', { required: true }), s('symbol', { required: true }), s('target', { required: true, desc: '被调符号名' })],
    render: (e) => `call-exists  ${norm(e.path)} :: ${String(e.symbol)}() → ${String(e.target)}()`,
  },
  run: {
    kind: 'run',
    phase: 'post',
    axis: 'behavior',
    subject: '', // 跑起来验，不针对某个文件 ⇒ 不硬凑主体
    fields: [
      { name: 'input', type: 'object', desc: '传给 expect 的求值域' },
      s('input_ref'),
      s('expect', {
        required: true,
        desc: '表达式；求值域只有 input / root',
        // ★ 唯一受「环境态词闸」管的字段（见 `FieldSpec.forbidsEnvState` 与 `ENV_STATE_TOKENS`）
        forbidsEnvState: true,
      }),
      s('blocked_by', { desc: '有值 ⇒ 判 pending，不跑 expect' }),
      sArr('mutants_ignore', { desc: '这些 input 字段不参与突变（避免等价突变体误判）' }),
    ],
    render: (e) => `run  ${String(e.expect).slice(0, 70)}`,
  },
  'source-has': {
    kind: 'source-has',
    phase: 'post',
    axis: 'text',
    fields: [
      s('path', { required: true }),
      sArr('must'),
      sArr('mustNot'),
      // ★★★ 2026-11-04（subagent:text-has-fix）：**这一格是本卡的核心开关**。
      //   语义：`false`（缺省）= 剥注释后匹配（注释里出现**不算**命中）；`true` = 匹配原文（注释里算）。
      //   为什么需要它：有一类判据断的**就是注释里的东西** —— `@authority` / `@authority-via` 是
      //   `infrastructure/authority/scan_authorities.ts#parseAuthorityMarks` 逐行扫**注释行**得到的 JSDoc 标记，
      //   它们"住且只住"在注释里 ⇒ 剥注释后它们**永远断言不到**（那不是判据错，是 kind 选错了）。
      //   ⇒ 两种合法处置：换 `run` + `fs` 读原文，或本开关。选后者：不新增 kind（11→12 是最贵的一类变更），
      //     且 `source-has` 的其余闸（path 存在性、索引新鲜度、四态渲染）继续生效，`run` 那条路会绕过它们。
      //   ★★ `requiresWhyToMention` 堵住的滥用：关掉剥注释必须当场写出理由，否则**写不进去**
      //     —— 不让它变成"偷偷放宽 121 条"的口子。
      {
        name: 'includeComments',
        type: 'boolean',
        requiresWhyToMention: '注释',
        desc: '默认 false=剥注释后匹配（注释里出现不算命中）；true=匹配原文（只在断言**注释里的标记**时才用，why 必须说明为什么）',
      },
    ],
    atLeastOneOf: ['must', 'mustNot'],
    // ★★★ 2026-11-04（subagent:text-has-fix）：**打印串本身，不只打条数**（见 `renderStringSet` 的理由）
    render: (e) => {
      const must = renderStringSet('must', e.must);
      const not = renderStringSet('mustNot', e.mustNot);
      const raw = e.includeComments === true ? ' · includeComments=true（读原文，含注释）' : '';
      const both = [must, not].filter(Boolean).join(' / ');
      return `source-has  ${norm(e.path)}${raw} :: ${both || '（未声明 must / mustNot）'}`;
    },
  },
  'behavior-cases': {
    kind: 'behavior-cases',
    phase: 'post',
    axis: 'behavior',
    fields: [
      s('path', { required: true }),
      s('symbol', { required: true }),
      {
        name: 'cases',
        type: 'object[]',
        required: true,
        minItems: 1,
        desc: '说不出验收输入的判据不算判据',
        items: [
          {
            name: 'given',
            type: 'json[]',
            required: true,
            desc: '位置实参（JSON 值：字符串/数字/布尔/null/对象/数组；原样传给函数，不 parse）',
          },
          s('expect', { required: true, desc: '期望输出（规范化后比较）' }),
        ],
      },
    ],
    render: (e) => `behavior-cases  ${norm(e.path)} :: ${String(e.symbol)}() × ${((e.cases as unknown[]) ?? []).length} case`,
  },
  'domain-independent': {
    kind: 'domain-independent',
    phase: 'pre',
    axis: 'domain',
    subject: '', // 主体是**域**（域表里的 id），不是文件
    fields: [
      s('domain', { required: true, desc: '域表 id（不是层级名、不是路径）' }),
      sArr('must_not_import', { required: true, minItems: 1, desc: '不许依赖的域 id；说不出"不许依赖谁"不算判据' }),
    ],
    render: (e) => `domain-independent  ${String(e.domain)} ⇸ ${((e.must_not_import as unknown[]) ?? []).join(' / ')}`,
  },
  runtime: {
    kind: 'runtime',
    phase: 'post',
    axis: 'runtime',
    subject: '', // 主体是事件流（events*.jsonl），不是源文件
    // ★★★ 2026-10-28（用户："这个律我们不是 ast 或者框架自动提供的吗"）——**用户是对的**：
    //   律（silent-error-discard / impact-blast-radius …）本来就由**框架**提供（`OBSERVE_RULE_TABLE`，
    //   稳定 id 在 `OBSERVE_RULE_IDS`）。所以要写的**不是律**，而是"**这条律在本项目生效于哪些代码**"。
    //   而选择依据该用 **rule id（设计侧，稳定）**，不该用 probe 名（实现侧，随插桩器变）——
    //   这正是 T-#OBSERVE-4 ① 的结论。`probe` 保留为**可选**精确/前缀过滤（调试用）。
    fields: [
      s('rule', { desc: '框架规则 id（如 design:silent-error-discard）；★ 律由框架提供，这里只声明适用范围' }),
      s('probe', { desc: '可选：探针名过滤（支持尾部 * 前缀匹配）。★ 易变名，优先用 rule' }),
      s('expect', {
        values: ['ok', 'deviation', 'absent'],
        desc: 'ok=全 ok（默认）| deviation=至少一条偏差（反例用法）| absent=一条都不许出现（按 rule/probe 命中集）',
      }),
      s('events', { desc: '事件文件；缺省自动找 <root>/.agent/observe/events*.jsonl' }),
    ],
    atLeastOneOf: ['rule', 'probe'],
    render: (e) =>
      `runtime  ${String(e.rule ?? '*')}${e.probe ? ` @${String(e.probe)}` : ''}  expect=${String(e.expect ?? 'ok')}`,
  },
};

/** ★ 由注册表派生的名字清单（不再手写数组） */
export const EXPECTATION_KINDS: readonly string[] = Object.keys(KIND_SPECS);

/** 阶段（由注册表派生） */
export function phaseOfKind(kind: string): 'pre' | 'post' | undefined {
  return KIND_SPECS[kind]?.phase;
}

/** 人读一行（由注册表派生） */
export function renderExpectation(e: { kind: string } & Record<string, unknown>): string {
  const spec = KIND_SPECS[e.kind];
  return spec ? spec.render(e as Record<string, unknown>) : String(e.kind);
}

/** 主体路径（不是文件主体的 kind 返回 ''，不硬凑） */
export function subjectPathOf(e: { kind: string } & Record<string, unknown>): string {
  const spec = KIND_SPECS[e.kind];
  if (!spec) return '';
  if (spec.axis === 'edge') return norm(e.from);
  if (spec.subject === '') return '';
  return norm(e.path);
}

/** 判据牵动到的全部路径（对账用） */
export function pathsOf(e: { kind: string } & Record<string, unknown>): string[] {
  const spec = KIND_SPECS[e.kind];
  if (!spec) return [];
  if (spec.axis === 'edge') return [norm(e.from), norm(e.to)];
  if (spec.subject === '') return [];
  return [norm(e.path)];
}

/**
 * ★★★ 2026-10-30（subagent:rule-strip）：**`source-has` 的匹配核**（纯函数；判据执行核 `judgeSourceHas` 只做 fs 读取与四态渲染）。
 *
 * ## 判据
 * `must` / `mustNot` 在**调用方交进来的 `text`** 上做**纯子串**比较。
 * ★★ 2026-11-04（subagent:text-has-fix）：剥注释**不在这里做了** —— 谁来剥、剥成什么样，
 *    由调用方决定（唯一调用方 = `application/design/intent/expectations.ts#judgeSourceHas`）：
 *    `includeComments` ⇒ 原文；代码扩展名 ⇒ AST 注释区间（`stripCommentsSync`，`null` ⇒ unsupported）；
 *    非代码扩展名（`.md` / `.json`）⇒ 原文。本函数的职责只剩「在给定文本里找串」。
 *
 * ## 为什么（实测代价，2026-10-30）
 * 原来是纯子串 ⇒ **注释里出现也算命中**。C1/C3 两张卡为了把
 * `mustNot:["INTRODUCED_BY_MODULE"]` / `["PKG_DIRS"]` 变绿，**只能把注释里的旧名字删掉** ——
 * 判据在**惩罚"记录病史"**，而本仓文化是病史留痕（自相矛盾）。
 *
 * ## 为什么按扩展名限定（不统一剥）
 * **markdown 的 `//source`、JSON 里的 `//` 都不是注释** ⇒ 统一剥会把文档 / 数据判据的字面量
 * 当注释吃掉。只有代码扩展名才剥（判据住在 `text_strip.ts#isCodeText`，这里不重复一套）。
 *
 * ## 为什么住 domain
 * 判据执行核要调它，而 **domain 不许依赖 infrastructure**；剥注释器 `text_strip.ts` 是**零 import**
 * （`behavior-cases` 的 harness 会把目标文件单独转译再 import）。⇒ 判据共三处：
 * `text_strip.ts`（怎么剥）· 本函数（匹配什么）· `judgeSourceHas`（读文件、渲染四态）。
 */
export function matchSourceHas(
  text: string,
  must: readonly string[] = [],
  mustNot: readonly string[] = [],
): { missMust: string[]; hitMustNot: string[] } {
  const hay = String(text ?? '');
  /**
   * ★★★ 2026-11-05（subagent:match-bounded）：**命中判定只此一处**，按针形分档（分档权威 = `isIdentifierNeedle`）：
   * · 裸标识符 ⇒ `hasIdentifierToken`：必须作为**完整 token** 出现（边界两侧都不是 `[\w$]`）；
   * · 其余针（代码片段 / SQL / 中文散文）⇒ `includes`：它们的边界是标点或文字，token 规则不适用。
   * ★ 分档**在入口判一次**（不是每个分支各写一遍）：`must` 与 `mustNot` 共用同一个 `present()`，
   *   方向差异只体现在过滤谓词的取反上 —— 否则两个方向会各长一把尺，早晚分叉。
   */
  const present = (t: string): boolean =>
    isIdentifierNeedle(t) ? hasIdentifierToken(hay, t) : hay.includes(t);
  return {
    missMust: must.filter((t) => !present(t)),
    hitMustNot: mustNot.filter((t) => present(t)),
  };
}

/**
 * ★★★ 2026-11-05（R9-a / subagent:r9a-env）：**`run` 的 `expect` 是任意 JS ⇒ 环境态词不许写进判据**。
 *
 * ## 它防的是这一档假绿（AGENTS 0.12 第 2 条逐字要求「写入时拒」）
 * `run` 的 `expect` 由 `new Function` 求值（执行核：`application/design/intent/expectations.ts`），
 * 求值域里有 `root` 与 `fs` ⇒ `Date.now() > 0` **永远真**、`fs.readdirSync(...)[0] === 'a.ts'`
 * **顺序依赖**。这两条都不会红，读数上却与真判据长得一模一样 ⇒ 只能在**写入那一刻**拒
 * （0.9.4③：让它在结构上写不进来，不靠"记得别这么写"）。
 *
 * ## 为什么是词法、不是 AST（0.18① 允许的正侧）
 * 这里要判的东西**就是这段文本本身**：`expect` 是一段自由 JS，要判"它会不会读时钟"就得做
 * 「能不能被触发」的语义分析 —— 那正是本仓最贵的假精确。词法表的代价**如实写在这里**：
 * 字符串字面量 / 注释里的同一个词也会被拒（例：`expect: "input.s === 'Date'"`）。
 * 这是**故意的**：宁可让它改写，也不要放一条"看着像判据、其实是测量"的东西进册。
 *
 * ## 边界（0.17①：什么我管、什么我不管）
 * · **管**：`decision.expectations[]` 里 **`kind === 'run'` 的 `expect`** —— 唯一被 `new Function` 执行的字段。
 * · **不管** ① `why` 等散文（**必须**能写"这条环境态断言已作废"这类病史 —— 扫整包等于惩罚病史，
 *   与 `source-has` 必须剥注释同族）；② 项目级 `criteria` 的 `expect`（另一套 schema，写端在
 *   `task_ops.ts`，本卡不动）；③ `source-has` 等其它 kind 的文本字段（断的是**目标文件里的字**）。
 */
export const ENV_STATE_TOKENS: readonly { readonly token: string; readonly re: RegExp; readonly why: string }[] = [
  { token: 'Date', re: /\bDate\b/, why: '读时钟（`Date.now()` / `new Date()` 的结论随机器时间变）' },
  { token: 'Math.random', re: /Math\s*\.\s*random/, why: '随机数 ⇒ 同一份代码同一份输入会给出不同结论' },
  { token: 'performance', re: /\bperformance\b/, why: '计时 / 性能计数器 ⇒ 结论取决于机器负载' },
  { token: 'readdir', re: /\breaddir/, why: '目录枚举 ⇒ 返回顺序由文件系统决定（`[0]` 一类写法随平台变）' },
  { token: 'process', re: /\bprocess\b/, why: '进程环境（env / cwd / argv / pid / 平台）' },
  { token: 'require(', re: /\brequire\s*\(/, why: '运行期取模块 ⇒ 结论取决于"本机装没装 / 能不能 load"' },
  { token: 'import(', re: /\bimport\s*\(/, why: '同 `require(`：运行期动态取模块' },
];

/**
 * 命中的环境态词（没有 ⇒ `null`）。★ **判定只此一处**：`validateExpectation` 与用例都走它。
 *
 * 词边界口径（两个方向都由用例钉住，见 `tests/p0_run_env_rejected.test.ts`）：
 * · `Date` / `performance` / `process` 要**整词** —— `updatedAt` 里的 `Date` **不算**（否则误伤普通变量名）；
 * · `readdir` 只要求**前缀** —— `readdirSync` **必须**命中（它就是那个枚举函数）。
 */
export function forbiddenEnvStateToken(expect: string): string | null {
  const text = String(expect ?? '');
  for (const t of ENV_STATE_TOKENS) if (t.re.test(text)) return t.token;
  return null;
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/**
 * ★ 形状校验（由注册表派生）：写入路径用它**响亮拒绝**，而不是让坏数据进 DSL 后静默不判。
 * 报错必须带 `kind` 名 —— 用户才知道自己写坏的是哪一条。
 */
export function validateExpectation(e: unknown, at = 'expectation'): string | null {
  if (!e || typeof e !== 'object') return `${at} 必须是对象`;
  const o = e as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !KIND_SPECS[kind]) {
    return `${at}.kind 非法（"${String(kind)}"）⇒ 只能取 ${EXPECTATION_KINDS.join(' / ')}`;
  }
  const spec = KIND_SPECS[kind];
  if (typeof o.why !== 'string' || o.why.trim() === '') {
    return `${at}.why 必填（一条说不出理由的验收项，将来没人敢删）`;
  }
  for (const f of spec.fields) {
    const v = o[f.name];
    if (f.required && isEmpty(v)) return `${at}.${f.name} 必填且非空（kind=${kind}）`;
    if (v === undefined) continue;
    const isArr = f.type.endsWith('[]');
    if (isArr) {
      if (!Array.isArray(v)) return `${at}.${f.name} 必须是数组（kind=${kind}）`;
      if (f.minItems !== undefined && v.length < f.minItems) {
        return `${at}.${f.name} 至少 ${f.minItems} 项（kind=${kind}）—— 说不出内容的判据不算判据`;
      }
      if (f.type === 'object[]' && f.items) {
        v.forEach((x, i) => {
          if (!x || typeof x !== 'object') return;
          for (const sub of f.items!) {
            if (sub.required && isEmpty((x as Record<string, unknown>)[sub.name])) {
              return `${at}.${f.name}[${i}].${sub.name} 必填且非空（kind=${kind}）`;
            }
          }
        });
      }
    }
    if (f.values && typeof v === 'string' && !f.values.includes(v)) {
      return `${at}.${f.name} 只能是 ${f.values.join(' / ')}（kind=${kind}）`;
    }
  }
  // ★★★ 2026-11-05（R9-a / subagent:r9a-env）：**环境态词闸 —— 声明式**。
  //   「哪个字段受管」由 `FieldSpec.forbidsEnvState` 说，**不在这里硬编 kind 名**（同 `requiresWhyToMention`
  //   的纪律：规则跟着字段走，加 kind / 换格子时不会漏）⇒ 今天只有 `run.expect` 命中这一条。
  //   为什么必须是硬拒绝而**不能**是文档提醒：`run` 的 `expect` 是任意 JS，`Date.now() > 0` 永远为真、
  //   `fs.readdirSync(...)[0]` 顺序依赖 —— 两种都是"绿着撒谎"，而读数上看不出来（0.9.4③）。
  //   报文三件齐（0.12 第 4 条）：哪条判据（`at`）· 命中哪个词 + 它为什么是环境态 · 正确写法往哪走。
  for (const f of spec.fields) {
    if (!f.forbidsEnvState) continue;
    const v = o[f.name];
    if (typeof v !== 'string') continue;
    const hit = forbiddenEnvStateToken(v);
    if (!hit) continue;
    const why = ENV_STATE_TOKENS.find((t) => t.token === hit)?.why ?? '';
    return (
      `${at}.${f.name} 命中环境态词「${hit}」（${why}）⇒ **环境态不是判据**（kind=${kind}）。` +
      `改法：把这个输入钉成常量写进 \`${at}.input\`，求值时用 \`input\` 读；或改成判「目标内容」的写法 —— ` +
      `\`fs.existsSync(目标)\` / \`fs.readFileSync(目标)\` / \`validateDSL(...)\` 是合法输入（不算环境态），` +
      `要列目录就逐个 \`existsSync\` 判，别靠枚举顺序`
    );
  }
  // ★★★ 2026-11-04（subagent:text-has-fix）：**放宽型开关必须在写入那一刻留下理由**。
  //   规则来自字段自己的声明（`FieldSpec.requiresWhyToMention`），不是在这里硬编某个 kind 名。
  //   只对**真值**生效（`false` / 缺省不要求）—— 缺省就是"不放宽"，没有理由可写。
  //   为什么必须是硬拒绝而不是文档提醒：`includeComments` 能把剥注释一条条关掉，
  //   静默地关掉 = 把"注释里出现也算命中"这条漏洞重新打开，而**读数上完全看不出来**。
  for (const f of spec.fields) {
    if (!f.requiresWhyToMention) continue;
    if (o[f.name] !== true) continue;
    if (!String(o.why).includes(f.requiresWhyToMention)) {
      return (
        `${at}.${f.name}=true ⇒ ${at}.why 必须提到「${f.requiresWhyToMention}」二字（kind=${kind}）—— ` +
        `这个字段会**放宽**判据（关掉剥注释），放宽必须当场写出理由，否则它就是"偷偷关掉判据"的口子`
      );
    }
  }
  if (spec.atLeastOneOf) {
    const ok = spec.atLeastOneOf.some((n) => !isEmpty(o[n]));
    if (!ok) return `${at} 必须给 ${spec.atLeastOneOf.join(' 或 ')} 至少一个（kind=${kind}）`;
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-03（M1a）：**判据 kind → 投影去向** 的第二张声明表
//   （与 `KIND_SPECS` **并列**，不是从它派生：一张说「这个 kind 长什么样」，这一张说「它进不进 design-db」）
// ════════════════════════════════════════════════════════════════════

/**
 * 一个 kind 的**投影去向**：投进 design-db 的哪些键，或者为什么不投影（住哪）。
 *
 * ★ 形态照 `design_db_projection.ts#SYMBOL_COLUMN_MAP` 的纪律：**每一条要么投影、要么写明 why —— 不许有第三种（沉默）**。
 *   那张表守的是「`nodes` 的每一列有没有交代」，这张表守的是「注册表里的每一个 kind 有没有交代」。
 */
export interface KindProjection {
  /** 投影进 design-db 的哪些键（与 `why_not_projected` **二选一必填**） */
  keys?: readonly string[];
  /** 不投影的理由（`keys` 缺省时必填） */
  why_not_projected?: string;
  /** 不投影时它住在哪：谁承载 / 谁现算（`why_not_projected` 的配套，缺了这条豁免就不可追溯） */
  carrier?: string;
}

/**
 * ★ 注册表里**每一个** kind 的投影去向（门：`gen-db-check` 的 kind 覆盖子项；用例：`tests/p0_kind_projection.test.ts`）。
 *
 * ## 它治的病（实测，2026-11-03）
 * 册侧判据 **564** 条 → 上了（去重 + 册管辖内）**476** 条 → design-db 只落 **111** 条，且**全部**是 `call-exists`。
 * 而 `gen-db-check` 打印的是「每条判据都在 design-db 里」—— 对 **365** 条是假话。
 * 根因不是「忘了投影」，而是**从来没有人说过哪些 kind 该投影、哪些由别处承载** ⇒ 沉默被读成了「都投了」。
 *
 * ## 判据（可判真假）
 * · 注册表条数 == 本表条数（少一个 ⇒ `projectionDeclarationGaps()` 点名）；
 * · 每条 `keys` / `why_not_projected` **二选一**（两个都给 / 都不给 / 幽灵条目 都算违规）；
 * · 声明了 `keys` 的 kind，其条数必须**真落在** design-db（落地 < 可投影 ⇒ `gen-db-check` 红）。
 *
 * ★ **不许硬编 keys**：无文件主体的 kind（`run` / `domain-independent` / `runtime`）没有可挂的副本，
 *   给它编一个空数组就是「投影了 0 条」冒充「已投影」（0.12：失败必须与「没有」可区分）。
 */
export const EXPECTATION_KIND_PROJECTION: Record<string, KindProjection> = {
  // ★ 唯一「真投影」的 kind：契约门（`scripts/contract-calls.mjs`）读的就是这两个键。
  'call-exists': { keys: ['requirements', 'requirements_calls'] },
  // 以下 10 条都是**已声明不投影**：每条写明为什么，以及它住哪（否则豁免不可追溯）。
  'file-exists': {
    why_not_projected:
      '**副本本体**就是载体：`design-db/<路径>.calls.json` 存在 ⇔ 该路径被设计册断言；再落一个键 = 同一事实两处',
    carrier: '`design-db/` 的副本清单（缺副本 / 多副本由 gen-db-check 现判）；不在册管辖范围（`excluded`）的路径没有副本',
  },
  'symbol-exists': {
    why_not_projected:
      'design-db 的 `symbols[]` 是**现状**（`cache.db` 解析结果）；这条要求的是「该符号必须**被导出**」——把要求写进现状数组，读者就分不清哪是要求、哪是事实',
    carrier: 'judge 现算（AST 导出判定）',
  },
  'signature-matches': {
    why_not_projected:
      '要投影的是**设计要求侧的签名字面**（且比较前压空白）；`symbols[].signature` 是现状签名 ⇒ 落进来会把「事实」读成「要求」',
    carrier: 'judge 现算（压空白后逐字比）',
  },
  'edge-exists': {
    why_not_projected:
      'design-db 的 `calls[]` 是**全量镜像**（必然全绿），不是「设计说必须有」；要求侧需要跨文件的**边**载体，当前 DB 没有这个形状',
    carrier: 'judge 现算（读 `cache.db` 的 call 边）—— 要投影须先立「要求侧边」载体（M1b）',
  },
  'edge-absent': {
    why_not_projected:
      '与 `edge-exists` 同一条理由的另一面（**反向**断言：这两个端点之间不许有边）—— 当前 DB 同样没有「要求侧边」载体',
    carrier: 'judge 现算（读 `cache.db` 的 call 边）—— M1b',
  },
  'source-has': {
    why_not_projected:
      '它是**文本匹配规则**（`must` / `mustNot` 串）；design-db 没有「规则」位 ⇒ 投影进来只会落成一份跑不起来的字面量副本',
    carrier: 'judge 现算（`judgeSourceHas` 读盘 → `infrastructure/parse/comments.ts#stripCommentsSync` 按 **AST 注释区间**剥（`null` ⇒ unsupported），或 `includeComments:true` 时用原文 → `matchSourceHas` 纯子串比较）',
  },
  'behavior-cases': {
    why_not_projected:
      '验收用例要**真跑**（harness 单独转译 + 逐 case 实参对拍）；落进 design-db 只是一份跑不起来的 JSON',
    carrier: 'judge 的行为执行核（`runHarness`）',
  },
  run: {
    why_not_projected:
      '**无文件主体**（`KIND_SPECS.run.subject` 是空串）：表达式针对 `input` / `root` 求值，不针对某个文件 ⇒ 没有可挂的副本',
    carrier: 'judge 的表达式求值核（求值域只有 input / root / validateDSL / fs / path）',
  },
  'domain-independent': {
    why_not_projected:
      '主体是**域**（`structure.domains.json` 的 id），而 design-db 是按**文件**切片的投影 —— 没有域维度；实测 57 条全挂在无 `path` 节点上，投影侧整节点被跳过',
    carrier: '需**域表级**载体（域 × 依赖方向）—— M1b 处理',
  },
  runtime: {
    why_not_projected: '主体是**事件流**（`.agent/observe/events*.jsonl`），不是源文件',
    carrier: 'judge 读事件流现算（`OBSERVE_RULE_IDS` 的 rule → 适用范围的命中集）',
  },
};

/**
 * 声明表的**自洽读数**（纯函数、零依赖）—— 空数组 = 每个 kind 都表了态且二选一成立。
 *
 * 门与用例都读这一处（不各自再数一遍）：
 * · `gen-db-check`：非空 ⇒ 计入 bad（新加 kind 忘了表态 = 当场红）；
 * · `tests/p0_kind_projection.test.ts`：钉「注册表条数 == 声明表条数」+ 二选一 + 无幽灵条目。
 */
export function projectionDeclarationGaps(
  table: Record<string, KindProjection> = EXPECTATION_KIND_PROJECTION,
): string[] {
  const out: string[] = [];
  const registered = EXPECTATION_KINDS.length;
  const declared = Object.keys(table).length;
  for (const k of EXPECTATION_KINDS) {
    const d = table[k];
    if (!d) {
      out.push(`kind ${k} 没在 EXPECTATION_KIND_PROJECTION 里表态（注册表 ${registered} 种 / 声明表 ${declared} 种）`);
      continue;
    }
    const hasKeys = Array.isArray(d.keys) && d.keys.length > 0;
    const hasWhy = typeof d.why_not_projected === 'string' && d.why_not_projected.trim() !== '';
    if (hasKeys && hasWhy) out.push(`kind ${k} 同时给了 keys 与 why_not_projected ⇒ 二选一必填（两条都写 = 没说清去哪）`);
    if (!hasKeys && !hasWhy) out.push(`kind ${k} 既没给 keys 也没给 why_not_projected ⇒ 沉默（0.12：不许有第三种）`);
    if (hasWhy && !(typeof d.carrier === 'string' && d.carrier.trim() !== '')) {
      out.push(`kind ${k} 声明了不投影却没写 carrier ⇒ 豁免不可追溯（读者不知道它住哪）`);
    }
  }
  for (const k of Object.keys(table)) {
    if (!KIND_SPECS[k]) out.push(`声明表里的 ${k} 不在 kind 注册表里 ⇒ 幽灵条目（注册表 ${registered} 种）`);
  }
  return out;
}
