/**
 * expectation.ts —— 「**可判定的验收**」的类型与纯格式化（2026-10-09，`docs/todo.md` T74）。
 *
 * ## 为什么需要它（这是整条工作流的**命门**）
 * 目标工作流：对比项目现状与设计，得到区别的地方，然后**分区域重写**。
 * 实测（2026-10-09）：这条链上 **别的环错了都看得见** ——
 * 读取看不清 ⇒ 读到奇怪输出；区域框错 ⇒ 改动落到意外文件；
 * **只有"重写完了对不对"这一环，错了看不见** —— `NodeDecision.acceptance`（`geometry.ts:164`）
 * 当时是**自由文本、无任何程序读它**，而 `consistency_check` / `detect_drift` **退出码恒 0**。
 * ⇒ 没有验收，"分区域重写"就变成**自信地改坏**。本模块只做一件事：把"验收"从**一句话**变成**能判的项**。
 *
 * ## 三条纪律
 * 1. ★★★ **判据必须已经在手边，不许新造解析**：五种 kind 全部落在**既有**入口上
 *    （`fileFacts` 给符号/签名/文件级依赖、`fs` 给存在性）。
 *    ⇒ 新造解析 = 新造一套"事实"，也就是本仓头号病（同一判据住两处）。
 * 2. ★★ **判不了要单独成一类（`unsupported`），既不算过、也不算不过**。
 *    ★ 依据：依赖事实 `fileFacts().deps` **只为 TS/JS 相对导入写**
 *      （`infrastructure/index/symbols.ts:388` `if (imp.kind !== 'relative') continue`）
 *      ⇒ 在 Go/Python 上判 `edge-*` 会**静默判错**（把"没查到"读成"不存在"）。
 *      所以本模块**只描述判据，不判**；判定器（在 `application/`）负责识别"语言不支持 ⇒ unsupported"。
 * 3. ★ **`acceptance` 与 `expectations` 不是替代关系**：前者是人读的一句话（保留，不动），
 *    后者是**其中可机器判定的那一部分**。一句话里判不了的（"代码要更清晰"）**不该进 expectations** ——
 *    硬塞进去只会造出"永远绿"的假项。
 *
 * ## 五种检查项（`from`/`to` 一律是**仓库相对路径**）
 *   · `file-exists`        文件在不在
 *   · `symbol-exists`      某文件里有没有这个符号
 *   · `signature-matches`  某符号的签名是否等于给定签名（比较前**规范化空白**）
 *   · `edge-exists`        A **依赖** B（★ **文件级**，不是符号级）
 *   · `edge-absent`        A **不许**依赖 B（"边界归属"最需要这条）
 */
import type { DesignDSL } from './types.js';
// ★ 2026-10-28（T-#KIND-1）：**判据 kind 的单一事实源**在 `expectation_kinds.ts` ——
//   名字清单 / 形状校验 / 人读渲染 / 主体路径 全从它派生；本文件只留 **TS 类型联合**（编译器兜底）。
import { KIND_SPECS, EXPECTATION_KINDS as KIND_NAMES, validateExpectation, renderExpectation as renderBySpec, subjectPathOf, pathsOf } from './expectation_kinds.js';
// ★★ 2026-10-31（subagent:b1a-landing · `E-CRIT-006`）：值 import 扫描（`text_strip.ts` 是零依赖纯函数）——
//   "behavior-cases 的目标文件能不能被单独转译再 import"就靠它判；本文件**自己不碰 fs**。
import { isCodeText, scanValueImports } from './text_strip.js';

/** ★ 五种可判定的检查项。`why` 是**必填**：一条说不出理由的验收项，将来没人敢删。 */
export type Expectation =
  | { kind: 'file-exists'; path: string; why: string }
  | { kind: 'symbol-exists'; path: string; symbol: string; why: string }
  | { kind: 'signature-matches'; path: string; symbol: string; signature: string; why: string }
  | { kind: 'edge-exists'; from: string; to: string; why: string }
  | { kind: 'edge-absent'; from: string; to: string; why: string }
  /**
   * ★★★ 2026-10-28（T-#DOMAIN-2）：**域级边界判据** —— 「域 `domain` 不许 import 域 `must_not_import` 里的任何文件」。
   *
   * ## 为什么现有 `edge-absent` 不够（实测）
   * `edge-absent` 是**文件对级**：给目录前缀（如 `src/infrastructure/parse`）会判 `unsupported`
   * （索引里没有"目录"这个文件）。而本仓有 **167 个域对 / 1507 条跨域 import 边** ⇒ 逐文件枚举不现实。
   *
   * ## 判据（域对聚合，一次算清）
   * 从域表（`structure.domains.json` 的 `dir`）+ 索引的 import 边聚合：
   * **域 A 的任一文件 → 域 B 的任一文件**存在 import 边 ⇒ `fail`（并给出条数与样例）；
   * 域对之间零边 ⇒ `pass`。★ 域表取不到 / 索引不全 ⇒ `unsupported`（**判不了 ≠ 合格**）。
   *
   * 用途：分割 / 合并 / 废弃 / 删除的**必要条件**可算形态（入度=0 ⇒ 删除候选；双向高密度 ⇒ 合并候选）。
   */
  | { kind: 'domain-independent'; domain: string; must_not_import: string[]; why: string }
  /**
   * ★★★ 2026-10-28（T-#OBSERVE-1）：**运行时判据** —— 自动化测试框架的 **L3 层**。
   *
   * ## 为什么非有它不可
   * 现有 11 种判据只覆盖两层：
   * · **L1 静态**（存在 / 签名 / 依赖边 / 调用 / 文本）—— 看的是"写成了什么"；
   * · **L2 行为**（`behavior-cases`，同进程跑函数比输出）—— 看的是"函数返回什么"。
   * 而 **L3 运行时**没人在看：**真进程 / 真链路 / 静默吞错 / 重试** ——
   * `behavior-cases` 看不到"一次请求实际走了哪条链"，也看不到"错误被 catch 后没抛没记"。
   * 那些事实只存在于**探针事件**（`events*.jsonl`）里，也就是观察线采到的东西。
   *
   * ## 判据（零配置）
   * `probe` 必填（探针名，如 `fn.exit` / `io.call`）；`events` 可选（缺省**自动找**
   * `<root>/.agent/observe/events*.jsonl`，取最新一份）；`expect` 三态：
   * · `'ok'`（默认）= 该 probe 的每条事件判定都必须是 ok；
   * · `'deviation'` = 至少一条必须是偏差（**反例用法**：证明这条规则真的能抓到东西）；
   * · `'absent'` = 该 probe **一条都不许出现**。
   * 找不到事件文件 / 文件里一条事件都没有 ⇒ `unsupported`（**判不了 ≠ 通过**）。
   */
  | { kind: 'runtime'; rule?: string; probe?: string; expect?: 'ok' | 'deviation' | 'absent'; events?: string; why: string }
  /**
   * ★★ 2026-10-09（T79）：**调用级**判据 —— 「`path` 里的 `symbol` 必须调用 `target`」。
   *
   * ## 为什么非有它不可（实测）
   * 设计写的是"累加必须复用 **`math.add`**"，而我把实现换成了 `mul` ——
   * **`edge-exists format→math` 照样通过**（边还在嘛）⇒ **验收 3/3 全绿，但设计根本没实现**。
   * ⇒ 边/符号/签名三档**表达不了"必须用哪个符号"**，而"用错符号"恰恰是最常见的偏差。
   *
   * ★ 判据**已在手边**：调用边住在 `cache.db` 的 `edges(kind='call')`，
   *   节点 id 约定 `"<fileNodeId>#<SymbolName>"`；现成读取入口 = `queryFileCalls`（**复用它，不新写**）。
   */
  | { kind: 'call-exists'; path: string; symbol: string; target: string; why: string }
  /**
   * ★★★ 2026-10-19（突变抓到的"等价突变体"）：**源码文本判据** —— 它是"grep 型"契约的正式名字。
   *
   * ## 为什么需要它
   * 之前有 5 条 `run` 的 `expect` 是 `fs.readFileSync(...).indexOf('…')` —— 即"查源码里有没有某段"。
   * 它们的 `input` 是**摆设** ⇒ 突变"改 input"必然无感 ⇒ 被误判成"判据装饰"。
   * ⇒ 给它们一个**不装 input 的 kind**，名字诚实；而突变对它有效（改 `must` 成不存在的串 ⇒ 该 fail）。
   *
   * ## 边界
   * ★ 它**只验文本存在**，不懂语义（注释里出现也算）—— 写 `must` 时要避开这种坑。
   * ★ 它**不替代** `symbol-exists`（后者按 AST 判"符号导出"）；这里只用于"必须有一段特定写法"。
   */
  | { kind: 'source-has'; path: string; must?: string[]; mustNot?: string[]; includeComments?: boolean; why: string }
  /**
   * ★★★ 2026-10-24（工作项 L 第一步）：**行为契约** —— 给定输入 → 断言输出（契约三层之三）。
   *
   * ## 为什么是它
   * ① `signature-matches`（声明契约）② `call-exists`（副作用契约）已落地，
   * ③「给定输入 ⇒ 断言输出」空缺 —— 而这正是行为基线
   *   （`infrastructure/authoring/behavior`）现成的能力，接到判据上（**复用，不重写**）。
   *
   * ## 形状
   * `cases[].given` = 位置实参数组（对齐 `BehaviorCase.args`；case 名由判定器自动编号）；
   * `cases[].expect` = 期望输出的**裸串**（"f(a,b)" 就写 "f(a,b)"，判定器负责与规范化 repr 对齐）。
   * ★ 空 cases = 校验失败（`assertValidExpectations`）：说不出验收输入的判据不许进册。
   */
  | { kind: 'behavior-cases'; path: string; symbol: string; cases: Array<{ given: unknown[]; expect: string }>; why: string }
  /**
   * ★★★ 2026-10-18（用户："校验的过程就是夹具"）：**行为契约** —— 一条 `run` = 一个自包含的测试。
   * ★★ I1（2026-10-25）首行口径：**不执行命令，只求值表达式** —— `expect` 是一个**表达式**，
   *   在 `judgeExpectations` 显式传入的小求值域（input / root / validateDSL / fs / path）里求值；
   *   它**不是** shell / 子进程，**没有任何命令被执行**（判据见 `intent/expectations.ts` 的 run 分支）。
   *
   * ## 为什么只有【一个】kind（而不是"返回值/退出码/输出/状态"各一种）
   * 所有行为契约的本质 = **给输入 ⇒ 断言输出**；而"输出"可以是返回值、退出码、stdout、**跑完之后的状态**。
   * ⇒ 用一个 `expect` **表达式**覆盖全部，**而不是为每种输出加一个 kind**（那会长成 20 个检查器）。
   *
   * ## 为什么不建 `fixtures/` 目录（用户："还得手动维护"）
   * `input` **就是夹具**，内联写在契约里 ⇒ **没有第二份要同步的东西**。
   * ★ 同一个"够坏"的输入被多条契约用（>3 次）时，才用 `input_ref` 引用 —— **不是靠目录**。
   *
   * ## `expect` 的可用名字
   * `input`（就是上面那个）· `root`（被分析项目根）· ★ `validateDSL`（示范注入：DSL ⇒ 错误清单）。
   * ★ 它**不是任意代码执行**：求值域只在这个小池子里（池子由 `judgeExpectations` 显式传入）。
   *
   * ## 例
   * ```ts
   * { kind:'run',
   *   input:{ geometry:{ nodes:[{id:'a'},{id:'b'}], edges:[{from:'a',to:'zzz'}] } },
   *   expect:'validateDSL(input).errors.some(e => e.code === "dangling_edge")',
   *   why:'坏边必须被点名' }
   * ```
   */
  | {
      kind: 'run';
      input?: unknown;
      input_ref?: string;
      expect: string;
      why: string;
      /**
       * ★★★ 2026-10-18（用户："让它报进行中"）：**卡在哪**。
       * ★ 有值 ⇒ **判 `pending`，不跑 `expect`**（"等某件事"的时候，跑断言只会给出误导的 fail）。
       * ★ 值要具体：`'等宿主传 agent'` / `'等 install_mcp 支持 env'` / `'等外部 API'`。
       * ★ 没有它 ⇒ 正常跑 `expect`（pass/fail）。
       */
      blocked_by?: string;
      /**
       * ★★★ 2026-10-19（突变测试抓到的"等价突变体"）：**这些 input 字段不参与突变**。
       * ★ 为什么需要：若 `expect` 只读 `input.status`，那改 `input.feature` 必然无感 ——
       *   那是"改了不改行为"的**等价突变体**，不该算"判据装饰"。
       * ★ 写清你**不**读哪些字段（例：`['feature']`），而不是让突变去猜。
       */
      mutants_ignore?: string[];
    };

export const EXPECTATION_KINDS: readonly string[] = KIND_NAMES; // ★ 由注册表派生（不手写）

/**
 * ★★★ 判据的**阶段**维度（2026-10-16 · T10）。下面 ①②③ 就是判它是不是补丁的那三条特征
 * —— 出自用户 2026-10-16「有补丁说明你原来的设计有问题」那句，原文已随老文档清理删除。
 *
 * ## 要收归的那个补丁是什么
 * 原先判定"是否已满足"的调用方（`src/domain/task_machine.ts` 的 `canClaim`）**自带一份清单**
 * `NEGATIVE_KINDS = ['edge-absent']` + `positiveExpectations()` —— ★ **判定前必须"记得剔除"**。
 * 那是补丁，不是结构（三个特征都占）：
 *   ① **别处要"记得"配合**（`canClaim` 忘了调 ⇒ "任务没领就被误收口"）；
 *   ② **同类问题再来一次时要"再加一条"**（将来再来一种前态判据 ⇒ 回头改那份清单）；
 *   ③ **它需要注释解释"为什么要这样"**。
 * ⇒ 缺的那一维是：**「期望」这个概念本身，不知道自己属于哪个阶段。**
 *
 * ## 收归成的结构
 * 每种 `kind` **自带**自己的 `phase` —— ★ **分类由 phase 决定，不再由任何外部清单决定**。
 *   · `pre`（前态判据）= 在**未施工**时**天然成立**的判据（`edge-absent`："不许依赖 X" —— 还没写当然不依赖）。
 *     ⇒ 拿它判"是否已满足"会**恒真** ⇒ **没领的卡会被误收口**（所以它不参与"已满足"判定）。
 *   · `post`（后态判据）= 施工**之后**才可能成立的判据（"必须有 X" / "必须调用 Y"）。
 *
 * ## ★ 为什么是"由 kind 派生 phase"，而不是"每个期望存一个 phase 字段"
 * `Expectation` 是**扁平的判别联合**，且被**当作纯数据**嵌进设计 DSL
 * （`geometry.nodes[].decision.expectations`）与真仓 `.agent-io/features/*.json`
 * （实测：`self-2026-10-15.json` 有 583 节点、其 `edge-absent` 已存在）。
 * ⇒ 若把 `phase` 做成**必须落盘**的字段，就等于：
 *   ① 把"kind ⇒ phase"这条事实**存两处**（★ 本仓头号病：同一判据住两处）；
 *   ② 要回改**大量既有 / 受保护的设计 JSON**（`Expectation` 被当纯数据用 ⇒ **切不动**）。
 * ⇒ 故把这一维做成 **`kind` 的原生派生属性**：**唯一权威处**就是下面这张
 *   `Record<Expectation['kind'], ExpectationPhase>` —— ★ 与联合类型**同住本文件**，
 *   且由**编译器**保证"新加一种 kind 漏标 phase 就编不过"。
 *
 * ★★ **新加一种前态判据时：只需在 `PHASE_BY_KIND` 里标它自己那一行 `'pre'`** ——
 *    不回头改任何清单（这是"结构"的判据：加的是**一维**，不是**一条**）。
 */
export type ExpectationPhase = 'pre' | 'post';

/**
 * ★★ **kind ⇒ phase**（唯一权威处）。
 * `Record<Expectation['kind'], ExpectationPhase>` ⇒ ★ **穷尽性由编译器钉死**：
 *   往 `Expectation` 联合里加一个 `kind` 而忘了在这里标注 phase ⇒ **`tsc` 直接报错**（漏标不可能）。
 */
const PHASE_BY_KIND: Record<Expectation['kind'], ExpectationPhase> = {
  // ★ run 是「跑起来看结果」⇒ 必然属【后态】（跑之前谈不上结果）
  run: 'post',
  'source-has': 'post',
  'file-exists': 'post',
  'symbol-exists': 'post',
  'signature-matches': 'post',
  'edge-exists': 'post',
  'edge-absent': 'pre', // ★ 前态判据：A 不许依赖 B —— 未施工时天然成立
  'domain-independent': 'pre', // ★ 同上，只是粒度从文件对升到**域对**（T-#DOMAIN-2）
  runtime: 'post', // ★ 运行时判据：跑起来才有事件 ⇒ 后态（T-#OBSERVE-1）
  'behavior-cases': 'post', // ★ 行为契约：跑起来才有输出可比 ⇒ 后态（与 run 同理）
  'call-exists': 'post',
};

/**
 * 这条期望属于哪个阶段（★ 「前态判据」的**唯一判据** —— 分类由期望**自带**，不查任何外部清单）。
 * ★ 它就是原先 `task_machine.ts` 里 `NEGATIVE_KINDS` + `isNegativeExpectation` 的**收归去处**：
 *   那些符号已从状态机删除，这一维搬到了**期望自己的模块**里。
 */
export function expectationPhase(e: Expectation): ExpectationPhase {
  return PHASE_BY_KIND[e.kind];
}

/**
 * **参与「是否已满足」判定的那批**（= 后态判据，`phase === 'post'`）。
 * ★ 用法只有两处，都在 `task_machine.cardStanding` 里：**满足度**那一轴选它（前态同时选出，供违约轴）。
 *   收归后它**不再**"剔前态判据（清单）"，而是**按期望自带的 phase 选取**。
 * ★ 这一步**删不掉**（如实声明）：前态判据本身也可能判成 `unsupported`（依赖事实取不到），
 *   若把它们并进后态报告会**改变 `satisfied` 的结论** ⇒ 收归改变的是"它怎么被认出来"（由 phase），而非"要不要选"。
 */
export function postExpectations(expectations: readonly Expectation[]): Expectation[] {
  return expectations.filter((e) => expectationPhase(e) === 'post');
}

/** 规范化路径（`\`→`/`、去前导 `./`）—— ★ 与 `scope.ts` 同一个口径，别再造第三种写法 */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 规范化签名（去掉空白）—— 比较用；**不改写**存储里的原文 */
export function normSignature(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 一行描述（用于报告；★ 展示层不许自己拼字符串 —— 那是第二份格式） */
export function describeExpectation(e: Expectation): string {
  // ★ 渲染由注册表派生（原来是一个 12 分支 switch）
  return renderBySpec(e as unknown as { kind: string } & Record<string, unknown>);
}


/** 校验一条检查项的形状（★ 写入路径要用它**响亮拒绝**，而不是让坏数据进 DSL 后静默不判） */
export function assertValidExpectations(
  v: unknown,
  /** ★ E-CRIT-006：读目标文件源码的回调（读不到 ⇒ null）。缺省 ⇒ 这条校验不生效。 */
  ctx?: { readSource?: (path: string) => string | null },
): asserts v is Expectation[] {
  // ★ 2026-10-28（T-#KIND-1）：**形状校验由注册表派生**。
  //   原来这里每种 kind 一段 if 沙盒（12 段，加 kind 必忘一处）；现在规则只有一份 `KIND_SPECS`。
  if (!Array.isArray(v)) throw new Error(`expectations 必须是数组，收到 ${typeof v}`);
  v.forEach((x, i) => {
    const problem = validateExpectation(x, `expectations[${i}]`);
    if (problem) throw new Error(problem);
  });
  // ★★★ 2026-10-31（subagent:b1a-landing · `E-CRIT-006`）：**形状对了还不够 —— 目标文件得有行为落点**。
  //   为什么接在这里而不在 `validateExpectation` 里：形状校验是纯形状、domain 不许碰 fs；
  //   而"目标文件能不能被 harness load"必须读文件 ⇒ 由调用方把读源码的能力传进来（`ctx.readSource`）。
  //   ★ 不传 ctx ⇒ 这条校验不生效（纯设计 / 无根场景），与既有的"不给根就不判"同一口径。
  //   ★ 2026-10-31（subagent:fix-gate-scope）：判据已从「有值 import 就拒」收窄为「只拒**裸**说明符」——
  //     相对 import 由夹具拷闭包，能 load（见 `behaviorTargetValueImportProblem` 的口径 ④）。
  const read = ctx?.readSource;
  if (read) {
    v.forEach((x, i) => {
      const problem = behaviorTargetValueImportProblem(x, read, `expectations[${i}]`);
      if (problem) throw new Error(problem);
    });
  }
}

/**
 * ★★★ 2026-10-31（subagent:b1a-landing）：**`E-CRIT-006` 的唯一判据 + 唯一报文**。
 *
 * ## 它拦的是什么（用户点名的根因）
 * 「框架自动判它对不对」的前提是**有行为落点**：`behavior-cases` 会把目标文件**转译进 tmp 再 import**
 * ⇒ 文件里有**裸说明符**的值 import（`import ts from 'typescript'` / `require('fs')` 这类）就 load 失败
 * ⇒ 那条行为判据写不出来 ⇒ 人只能退成 `source-has`（存在类，永远发现不了逻辑错）⇒ 必漂 ⇒ 被删
 * ⇒ 落点还是没有 ⇒ 再发明一个量具。⇒ 在**写判据那一刻**就拒，并给出两条出路（抽零依赖纯函数 / 换判据种类）。
 *
 * ## 口径（四条，别的都不猜；★ 2026-10-31 由「有值 import 就拒」收窄为「只拒裸说明符」）
 * ① `bareCount === 0` ⇒ **通过**（★ **含**只有相对 import 的文件 —— 夹具 `copyRelativeImportClosure()`
 *    会递归转译相对闭包进 tmp，这些**能 load**；实测 `src/domain/expectation.ts#normSignature` 由 unsupported → pass）；
 * ② `bareCount > 0` ⇒ 拒（报文带路径 + 裸处数 + 前 3 个包名 + 相对那一档的计数 + 两条出路）；
 * ③ **文件不存在 / 读不到 / 不是代码扩展名** ⇒ **不在这里拒** —— 那是判据四态（`fail` / `unsupported`）的活，
 *    在这里抢就会把"还没写"当成"写错了"；
 * ④ **相对说明符**（`./x.js` / `../y.js`）**一律放行** —— 判据只有一处：`text_strip.ts#isRelativeSpecifier`，别处不许多判一套。
 */
function behaviorTargetValueImportProblem(
  e: unknown,
  readSource: (path: string) => string | null,
  at: string,
): string | null {
  const o = (e ?? {}) as Record<string, unknown>;
  if (o.kind !== 'behavior-cases' || typeof o.path !== 'string') return null;
  const rel = normPath(o.path);
  if (!isCodeText(rel)) return null; // 非代码文本没有"load"这回事
  let src: string | null = null;
  try {
    src = readSource(rel);
  } catch {
    src = null; // 读不到 ⇒ 交给四态，不在这里拒
  }
  if (src === null) return null;
  const scan = scanValueImports(src);
  // ★★ 2026-10-31（subagent:fix-gate-scope）：**只有裸说明符会 load 失败**。
  //   事实变了：夹具新增 `copyRelativeImportClosure()`（按 TS AST 取相对说明符、递归转译进 tmp）
  //   ⇒ 目标文件里的 `import './x.js'` 现在**能 load**（实测 src/domain/expectation.ts#normSignature 由 unsupported → pass）。
  //   ★★ 2026-11-02：**`node:` 内置也不再算裸** —— tmp 里内置模块由 node 自己解析（实测绿），
  //     把它当「拷不过去」会拒掉 185/377 个文件；分档口径只有 `text_strip.ts#scanValueImports` 一处。
  //   ⇒ 这条闸只拦**真三方包那一档**（`typescript` / `zod` / `ignore`）；相对 import 与 `node:` 内置一律放行。
  if (scan.bareCount === 0) return null;
  const sample = scan.bare.length ? `例：${scan.bare.join(' / ')}` : '';
  const relNote =
    scan.relativeCount > 0
      ? `；另有 ${scan.relativeCount} 处**相对** import（${scan.relative.slice(0, 3).join(' / ')}）由夹具拷闭包，**不拦**`
      : '';
  // ★ 2026-11-02：**内置已放行**要明说 —— 否则用户看到「有裸 import 被拒」会把 `node:fs` 当成必须抽走的依赖。
  const builtinNote =
    scan.builtinCount > 0
      ? `；另有 ${scan.builtinCount} 处 **node: 内置**（${scan.builtin.slice(0, 3).join(' / ')}）由 node 自己解析，**放行**`
      : '';
  return (
    `E-CRIT-006 · ${at} · behavior-cases 的目标文件 ${rel} 有 **${scan.bareCount} 处真三方包的值 import**（${sample}）` +
    `⇒ 项目自己没装这个包时，夹具（相对 import 闭包 + 仓库 node_modules junction）都带不过去` +
    `⇒ 单独转译该文件会 load 失败（判据根本没有行为落点）${relNote}${builtinNote}。\n` +
    ` 要么把被考的决策抽成 src/domain/ 下的零依赖纯函数（范例：src/domain/import_names.ts），要么改用它种判据。`
  );
}


/**
 * ★★ 一条检查项的**「主体路径」**—— 失败时**该改哪个文件**（2026-10-09，T78）。
 *
 * ## 为什么需要它
 * `consistency_check` 的对账结果里有**两个来源**的差异：
 *   ① `expected_apis` 对账（**扫描来的**契约 —— 而设计就是从扫描 fork 的 ⇒ 它对出来**永远干净**）；
 *   ② **人写的验收**（`expectations`）—— **只有它才会真的不一样**。
 * 而"差异块"当初只吃 ① ⇒ **块永远是空的**，"圈范围"那一步等于没做。
 * ⇒ 要让两者汇成同一份块，就得先回答：**这条失败的验收，该算到哪个文件头上？**
 *
 * ## 规则（一句话：**算在"欠了这件事"的那一端**）
 *   · `file-exists` / `symbol-exists` / `signature-matches` / **`call-exists`** ⇒ **`path`** 本身（就是它欠着）；
 *   · `edge-exists`（该有的依赖没有）⇒ **`from`**（是它没去依赖 `to`）；
 *   · `edge-absent`（不该有的依赖有了）⇒ **`from`**（是它越权去依赖了 `to`）。
 * ⇒ 后两者**都算 `from`**，不是"两边都算" —— 两边都标会把"改哪端"这个判断推给读者，
 *   而这里能给的是**默认主体**：*依赖关系由"source 端"负责*。
 * ★ 只此一处算主体路径；别在展示层再推一遍（那是判据分叉）。
 */
export function expectationSubjectPath(e: Expectation): string {
  // ★ 由注册表派生：不是"文件主体"的 kind（run / domain-independent / runtime）返回 ''，不硬凑
  return subjectPathOf(e as unknown as { kind: string } & Record<string, unknown>);
}


/** 一条检查项**涉及的全部路径**（主体 + 对端）—— 报告里说清"牵动了谁"，但**不计入块的归属** */
export function expectationPaths(e: Expectation): string[] {
  return pathsOf(e as unknown as { kind: string } & Record<string, unknown>);
}

// ─────────────────────────────────────────────────────────────
// 「判据丢了没有」的读数（2026-11-06 · T-26 · E-CRIT-007）
//
// ## 为什么这一段必须存在（实测事故，不是假设）
// 一个子代理去修一处乱码，用 `decision.update` 改 `expectations`（**整块替换**）
// ⇒ 静默把原有行为判据压掉 ⇒ **没有任何东西说话**，它自己发现后从 `git show HEAD` 逐字还原。
// 而「重写计划闸」那套规则（P7/P16）挡的是**别的事**（拿弱判据当画布 ref）——
// 「判据被覆盖」这件事此前**一道闸都没有**。
//
// ## 三条口径（每一条都是实测打出来的，别改回"直觉版"）
// 1. ★ **不按内容全等认「同一条」**：那样"把 expect 改严"= 丢旧的+加新的 ⇒ 每条正常改写都算丢弃（误伤比漏防更坏）。
//    ⇒ 认 `kind` + **主体键**（`expectationSubjectKey`，**剔除内容字段**）。
// 2. ★★ **只有主体键不够**：事故形态（同一个 behavior-cases 的 3 个用例被压成 1 个）**主体键根本没变**
//    ⇒ 条目级规则对它**完全瞎**。所以必须**两面都查**：面A 条目消失 / 面B 存活条目净缩。
// 3. ★ **`run` 没有主体**（`KIND_SPECS.run.subject === ''`，现存占三成）⇒ 它的消失**只数得出条数**，
//    **认不出是哪一条** —— 本模块如实返回 `keyless_lost`，不许拿"expect 文本变了"冒充"这一条丢了"
//    （那样改一个 `expect` 就会被读成"丢了一条又加了一条"，6.8% 的正常改写会变成噪音）。
// ─────────────────────────────────────────────────────────────

/**
 * 一条判据的**主体键** —— 认同一条判据的唯一口径（`kind` + 主体，**不含内容字段**）。
 *
 * · `signature-matches` **不含 `signature`**、`source-has` **不含 `must/mustNot`**、
 *   `domain-independent` **不含 `must_not_import`**、`behavior-cases` **不含 `cases`** ——
 *   那些是**内容**，改内容属于"改"，不属于"丢"。
 * · 返回 `null` = **无主体**（`run`，以及将来任何未登记的 kind）⇒ 调用方只能按**条数**数它。
 */
export function expectationSubjectKey(e: { kind: string } & Record<string, unknown>): string | null {
  const n = (v: unknown): string => String(v ?? '').replace(/\\/g, '/');
  switch (e.kind) {
    case 'file-exists':
      return `file-exists:${n(e.path)}`;
    case 'symbol-exists':
      return `symbol-exists:${n(e.path)}#${String(e.symbol ?? '')}`;
    case 'signature-matches':
      return `signature-matches:${n(e.path)}#${String(e.symbol ?? '')}`;
    case 'call-exists':
      return `call-exists:${n(e.path)}#${String(e.symbol ?? '')}->${String(e.target ?? '')}`;
    case 'behavior-cases':
      return `behavior-cases:${n(e.path)}#${String(e.symbol ?? '')}`;
    case 'source-has':
      return `source-has:${n(e.path)}${e.includeComments === true ? '?includeComments' : ''}`;
    case 'edge-exists':
      return `edge-exists:${n(e.from)}->${n(e.to)}`;
    case 'edge-absent':
      return `edge-absent:${n(e.from)}->${n(e.to)}`;
    case 'domain-independent':
      return `domain-independent:${String(e.domain ?? '')}`;
    case 'runtime':
      return `runtime:${String(e.rule ?? '')}@${String(e.probe ?? '')}`;
    // ★ `run`：主体是"那个表达式"，不是某份文件/符号 ⇒ 没有稳定主体键（见头注 3）。
    default:
      return null;
  }
}

/** 一条判据里**可以变短**的集合（面B 的判定面）—— 只有它们才谈得上"净缩" */
function shrinkableCollections(e: { kind: string } & Record<string, unknown>): Array<{ what: string; items: string[] }> {
  switch (e.kind) {
    case 'behavior-cases': {
      const cases = Array.isArray(e.cases) ? (e.cases as unknown[]) : [];
      return [{ what: '用例', items: cases.map((c) => JSON.stringify(c)) }];
    }
    case 'source-has':
      return [
        { what: 'must 针', items: Array.isArray(e.must) ? (e.must as string[]) : [] },
        { what: 'mustNot 针', items: Array.isArray(e.mustNot) ? (e.mustNot as string[]) : [] },
      ];
    case 'domain-independent':
      return [
        {
          what: 'must_not_import',
          items: Array.isArray(e.must_not_import) ? (e.must_not_import as string[]) : [],
        },
      ];
    // ★ `signature-matches` 的 `signature` 是**必填非空**（`KIND_SPECS`）⇒ 结构上"变空"写不进去，
    //   改它就是"改"，不是"丢" ⇒ 不列入面B（列进来只会把每次改签名都算成丢弃）。
    default:
      return [];
  }
}

/** 面A：整条消失 */
export interface ExpectationLost {
  /** 主体键（无主体的 `run` 用 `run#<旧数组下标>` —— 只在本次报文里有意义） */
  key: string;
  /** 人读一行（`renderExpectation`，供回执与拒绝文案） */
  desc: string;
}

/** 面B：存活条目**净缩**（同一主体、集合变短、且没有新增） */
export interface ExpectationEroded {
  key: string;
  desc: string;
  /** 缩的是哪个集合（`用例` / `must 针` / `must_not_import`） */
  what: string;
  was: number;
  now: number;
}

/** 一次写入相对上一版的「丢东西」读数（★ 纯函数：不读盘、不判强度、不判绿红） */
export interface ExpectationLoss {
  /** 面A：整条消失（有序） */
  lost: ExpectationLost[];
  /** 面B：存活条目净缩 */
  eroded: ExpectationEroded[];
  /** 新增的主体（回执念"补了什么"，**不参与判定**） */
  added: ExpectationLost[];
  /** 无主体的判据（`run`）里**只数得出条数**的那部分 —— 认不出是哪一条，不许假装认得出 */
  keyless_lost: number;
  /** 上一版条数 / 本次条数（报文要带分母） */
  was: number;
  now: number;
}

/**
 * 算出 `prev` → `next` 这次改动**丢了什么**。
 *
 * @param prev 上一版判据数组（节点此前没有 decision ⇒ 传 `undefined` / 空数组 ⇒ 一律不算丢）
 * @param next 本次落定的判据数组
 */
export function expectationLossOf(
  prev: readonly Expectation[] | undefined,
  next: readonly Expectation[] | undefined,
): ExpectationLoss {
  const oldList = (prev ?? []) as ReadonlyArray<{ kind: string } & Record<string, unknown>>;
  const newList = (next ?? []) as ReadonlyArray<{ kind: string } & Record<string, unknown>>;
  const desc = (e: { kind: string } & Record<string, unknown>): string => renderBySpec(e);

  // ① 有主体的：按主体键配对
  const newByKey = new Map<string, { kind: string } & Record<string, unknown>>();
  for (const e of newList) {
    const k = expectationSubjectKey(e);
    if (k && !newByKey.has(k)) newByKey.set(k, e);
  }
  const oldKeys = new Set<string>();
  for (const e of oldList) {
    const k = expectationSubjectKey(e);
    if (k) oldKeys.add(k);
  }

  const lost: ExpectationLost[] = [];
  for (const e of oldList) {
    const k = expectationSubjectKey(e);
    if (k && !newByKey.has(k)) lost.push({ key: k, desc: desc(e) });
  }
  const added: ExpectationLost[] = [];
  for (const e of newList) {
    const k = expectationSubjectKey(e);
    if (k && !oldKeys.has(k)) added.push({ key: k, desc: desc(e) });
  }

  // ② 无主体的（`run`）：**只按条数差**数，配不上的那几条报成 `run#<旧下标>`
  const oldKeyless = oldList.map((e, i) => ({ e, i })).filter((x) => expectationSubjectKey(x.e) === null);
  const newKeyless = newList.filter((e) => expectationSubjectKey(e) === null);
  let keylessLost = 0;
  for (let i = newKeyless.length; i < oldKeyless.length; i++) {
    keylessLost++;
    lost.push({ key: `run#${oldKeyless[i].i}`, desc: `${desc(oldKeyless[i].e)}（★ run 无主体：只知少了这一条，认不出是哪条）` });
  }
  for (let i = oldKeyless.length; i < newKeyless.length; i++) {
    added.push({ key: `run#new${i}`, desc: desc(newKeyless[i]) });
  }

  // ③ 面B：存活条目里**约束集合净缩**（变短 **且** 没新增任何一项 —— "换针"不算丢）
  //   ★★ 口径按**条目合计**判，不按单个集合判（2026-11-06 实测打回的第一次实现）：
  //     `source-has` 有两个集合（`must` 正针 / `mustNot` 反针）。若删一条 `must` 同时加一条 `mustNot`，
  //     那是**收紧**（合法的"换更强"），但按单集合判会读成"must 净缩 ⇒ 丢东西"。
  //     实测代价：按单集合判在 1849 次历史写里命中 87 次 source-has 净缩；按条目合计判只剩 2 次
  //     （那 2 次才是真的"只有减、没有任何补偿"）。
  //   ⇒ 判据：**整条的约束总量变短 ∧ 该条目内没有任何新增项** ⇒ 才算净缩，且**一条条目只产出 1 项**
  //     （`key` 是主体键 ⇒ 一条目一项，`drop_ok` 的集合才不会被重复键搅乱）。
  const eroded: ExpectationEroded[] = [];
  for (const e of oldList) {
    const k = expectationSubjectKey(e);
    if (!k) continue;
    const nextE = newByKey.get(k);
    if (!nextE) continue; // 整条没了 ⇒ 已在面A
    const oldCols = shrinkableCollections(e);
    if (!oldCols.length) continue;
    const newCols = shrinkableCollections(nextE);
    // 任何一个集合里出现了旧集合没有的项 ⇒ 这是"换"不是"缩"（整条豁免）
    let compensated = false;
    const shrinking: Array<{ what: string; was: number; now: number }> = [];
    for (let ci = 0; ci < oldCols.length; ci++) {
      const a = oldCols[ci];
      const b = newCols[ci] ?? { what: a.what, items: [] };
      const oldSet = new Set(a.items);
      if (b.items.some((x) => !oldSet.has(x))) {
        compensated = true;
        break;
      }
      if (b.items.length < a.items.length) shrinking.push({ what: a.what, was: a.items.length, now: b.items.length });
    }
    if (compensated || !shrinking.length) continue;
    const was = shrinking.reduce((s, x) => s + x.was, 0);
    const now = shrinking.reduce((s, x) => s + x.now, 0);
    if (now >= was) continue;
    eroded.push({ key: k, desc: desc(e), what: shrinking.map((x) => x.what).join('+'), was, now });
  }

  return { lost, eroded, added, keyless_lost: keylessLost, was: oldList.length, now: newList.length };
}

/** 汇总某个 DSL 里所有决策卡上的 expectations（★ 只读、不改；供对账用） */
export function collectExpectations(dsl: DesignDSL): Array<{ node_id: string; node_label: string; expectation: Expectation }> {
  const out: Array<{ node_id: string; node_label: string; expectation: Expectation }> = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    // ★★ 2026-10-23：`intent='retired'` 的节点**不再收集判据**。
    //   它描述的东西已确认不存在（对账写入 retired）⇒ 继续求值只会制造永久红。
    //   判据本身留在册子里当历史，不删。★ 缺省（无 intent）= `live`，照常收集。
    if (n.intent === 'retired') continue;
    for (const e of n.decision?.expectations ?? []) {
      out.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e });
    }
  }
  return out;
}
