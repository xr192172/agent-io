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

/** ★ 五种可判定的检查项。`why` 是**必填**：一条说不出理由的验收项，将来没人敢删。 */
export type Expectation =
  | { kind: 'file-exists'; path: string; why: string }
  | { kind: 'symbol-exists'; path: string; symbol: string; why: string }
  | { kind: 'signature-matches'; path: string; symbol: string; signature: string; why: string }
  | { kind: 'edge-exists'; from: string; to: string; why: string }
  | { kind: 'edge-absent'; from: string; to: string; why: string }
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
  | { kind: 'source-has'; path: string; must?: string[]; mustNot?: string[]; why: string }
  /**
   * ★★★ 2026-10-18（用户："校验的过程就是夹具"）：**行为契约** —— 一条 `run` = 一个自包含的测试。
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

export const EXPECTATION_KINDS = ['file-exists', 'symbol-exists', 'signature-matches', 'edge-exists', 'edge-absent', 'call-exists', 'run', 'source-has'] as const;

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
  switch (e.kind) {
    case 'file-exists': return `file-exists  ${normPath(e.path)}`;
    case 'symbol-exists': return `symbol-exists  ${normPath(e.path)} :: ${e.symbol}`;
    case 'signature-matches': return `signature-matches  ${normPath(e.path)} :: ${e.symbol}  =  ${e.signature}`;
    case 'edge-exists': return `edge-exists  ${normPath(e.from)} → ${normPath(e.to)}`;
    case 'edge-absent': return `edge-absent  ${normPath(e.from)} ⇸ ${normPath(e.to)}`;
    case 'call-exists': return `call-exists  ${normPath(e.path)} :: ${e.symbol}() → ${e.target}()`;
    case 'run': return `run  ${String(e.expect).slice(0, 70)}`;
    case 'source-has': return `source-has  ${normPath(e.path)} :: must ${(e.must ?? []).length} / mustNot ${(e.mustNot ?? []).length}`;
  }
}

/** 校验一条检查项的形状（★ 写入路径要用它**响亮拒绝**，而不是让坏数据进 DSL 后静默不判） */
export function assertValidExpectations(v: unknown): asserts v is Expectation[] {
  if (!Array.isArray(v)) throw new Error(`expectations 必须是数组，收到 ${typeof v}`);
  v.forEach((x, i) => {
    const at = `expectations[${i}]`;
    if (!x || typeof x !== 'object') throw new Error(`${at} 必须是对象`);
    const o = x as Record<string, unknown>;
    const kind = o.kind;
    if (typeof kind !== 'string' || !(EXPECTATION_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${at}.kind 非法（"${String(kind)}"）⇒ 只能取 ${EXPECTATION_KINDS.join(' / ')}`);
    }
    const need = (k: string): void => {
      if (typeof o[k] !== 'string' || (o[k] as string).trim() === '') throw new Error(`${at}.${k} 必填且非空（kind=${kind}）`);
    };
    if (typeof o.why !== 'string' || (o.why as string).trim() === '') {
      throw new Error(`${at}.why 必填（一条说不出理由的验收项，将来没人敢删）`);
    }
    if (kind === 'file-exists') need('path');
    else if (kind === 'symbol-exists') { need('path'); need('symbol'); }
    else if (kind === 'signature-matches') { need('path'); need('symbol'); need('signature'); }
    else if (kind === 'call-exists') { need('path'); need('symbol'); need('target'); }
    else if (kind === 'run') { need('expect'); }
    else if (kind === 'source-has') {
      need('path');
      const hasMust = Array.isArray(o.must) && o.must.length > 0;
      const hasMustNot = Array.isArray(o.mustNot) && o.mustNot.length > 0;
      if (!hasMust && !hasMustNot) throw new Error(`${at} 必须给 must[] 或 mustNot[] 至少一个（kind=source-has）`);
    }
    else { need('from'); need('to'); }
  });
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
  // ★ run 没有主体文件 —— 它验的是「跑起来」，不是「某个文件」⇒ 返回空串（不硬凑一个文件）
  if (e.kind === 'run') return '';
  if (e.kind === 'source-has') return normPath(e.path);
  return normPath(e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path);
}

/** 一条检查项**涉及的全部路径**（主体 + 对端）—— 报告里说清"牵动了谁"，但**不计入块的归属** */
export function expectationPaths(e: Expectation): string[] {
  // ★ run 无路径（同 subjectPath 的理由）
  if (e.kind === 'run') return [];
  if (e.kind === 'source-has') return [normPath(e.path)];
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [normPath(e.from), normPath(e.to)] : [normPath(e.path)];
}
/** 汇总某个 DSL 里所有决策卡上的 expectations（★ 只读、不改；供对账用） */
export function collectExpectations(dsl: DesignDSL): Array<{ node_id: string; node_label: string; expectation: Expectation }> {
  const out: Array<{ node_id: string; node_label: string; expectation: Expectation }> = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    for (const e of n.decision?.expectations ?? []) {
      out.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e });
    }
  }
  return out;
}
