/**
 * rejection_kind —— 「拒绝事件」的分类核（**纯函数、零依赖**）
 *
 * ## 它回答的那个问题（本仓此前没有账）
 * 仓里有两个 `ok`，回答两件不同的事：
 *   · `usage.jsonl` 的 `ok` = `!isError` —— **这次调用跑通了吗**（工具层）；
 *   · 回执 payload 里的 `ok:false` —— **世界好不好**（业务层，例如"快照缺失"）。
 * 而「**该做、但被规则挡下**」（任务闸 / 重写计划闸 / 判据不够 / 合理性校验 …）是**第三件事**：
 * 它不是异常，也不是"世界不好"。它此前只能混在同一个布尔里 ⇒ 量不到。
 * ★ 实测（2026-11-07）：`.agentio-data/dogfood/usage.jsonl` 10,633 行里 ok=false 1,765 条，
 *   其中 ≥1,200 条属这一类，却**没有任何字段**说得清哪些是。
 *
 * ## 五类（次序即判据，先命中先定 —— **顺序本身就是内容**）
 * 1. `C 探测`：`via ∈ {sweep, gate}`。它不是"业务被挡"，是健康探测 / 门跑。
 *    ★ 必须**最先**判：实测 `.agent-io/dogfood/usage.jsonl` 26,211 行里 `via:"mcp"` **零条** ——
 *      把那一本当"使用账"，量出来的"业务拒绝 = 0"是**选错文件**，不是事实。
 * 2. `D 调用方用错`：缺必填 / 类型不符 / 不认识的键 ⇒ 是**用错**，不是"该做被挡"。
 *    ★ 实测 344 条（schema 71 + 缺参/类型 273）—— 卡的"三类"装不下它。
 * 3. `A 业务拒绝`：错带了**闸的来源**（`gateCodes` 非空，或 `gateRejection`）。
 * 4. `B 异常`：抛了 `Error` 而闸的来源**一条都没有** ⇒ 代码错。
 * 5. `unknown`：`isError` 为真而既没有 `Error` 对象、也没有任何码 ⇒ **判不了**。
 *    ★ 必须单列且**不许**并进 A 或 B：判不了 ≠ 没发生（2026-11-06 栽过一次：`unsupported` 被混进"红"）。
 *
 * ## 为什么住 `src/domain` 且**一个 import 都没有**
 * `behavior-cases` 判据的执行核只拷**相对 import 闭包**（规则 `E-CRIT-006`）⇒ 有裸 import 的文件
 * load 不了 ⇒ 判据只能退化成 `source-has`（存在类，永远发现不了逻辑错）。
 * ⇒ 本文件**故意**零依赖。别在这里加 import，也别把判据搬到带 import 的文件上。
 */

/** 拒绝事件的五类（A/B/D/unknown 是"拒绝"的分类；C 是**探测**，只用来证明它被排除了） */
export type RejectionKind = 'A' | 'B' | 'C' | 'D' | 'unknown';

/**
 * 判一次拒绝所需的**事实**（★ 全部是事实，没有一项是结论）。
 *
 * ★ 为什么存事实、不存 `kind`：结论会变、事实不会。sidecar 里写死 `kind:"A"` ⇒
 *   **改判据之后读数变了而"复算命令"输出不变** ⇒ 那条判据（"口径可复算"）就退化成
 *   "数一个已冻结的 verdict"，永远发现不了判定错。⇒ 复算 = 拿事实现跑 {@link classifyRejection}。
 */
export interface RejectionFacts {
  /** 调用来源（`mcp` / `cli` / `cert` / `sweep` / `gate` / `http`）—— C 类只靠它判 */
  via: string;
  /** 调用层是否失败（= `invokeTool` 的 `!ok`） */
  isError: boolean;
  /** 是否**抛出了 Error 对象**（`wrap`/`wrapData` 的 catch 里为 true；handler 主动回 `isError:true` 为 false） */
  threw: boolean;
  /** 错误对象的构造名（`Error` / `TypeError` / `GateError` …）；拿不到 Error 对象时为空串 */
  errorName: string;
  /**
   * 闸/规则的码（`gateErrorsOf(e)` 的结果码，兜底 `gateRuleByMessage(msg)`）。
   * ★ 空 = 这个错**没有闸的来源** —— 正是 A 与 B 的分界线。
   */
  gateCodes: readonly string[];
  /** 是否命中闸拒绝（★ 与 `gateCodes` **同源**，不另判一遍；给读端一个直白布尔） */
  gateRejection: boolean;
  /** 错误消息（已截断）—— D 类与 unknown 的判据落在这串前缀上 */
  message: string;
}

/** 探测来源：这两种 via 的行**不回答**"业务有没有被挡" */
export const PROBE_VIA: readonly string[] = ['sweep', 'gate'];

/**
 * D 类（调用方用错）的文案前缀 —— **唯一取值处**。
 *
 * ★ 为什么用前缀而不是每个 handler 各嗅一次：`plumbing.ts#requireStr` / `requireArr` 的两条文案
 *   （`缺参数 "x"` / `缺参数 "x"：hint`）与 `invokeTool` 的 schema 拒绝（`✗ 调用失败：入参未通过 …`）
 *   是**同一个意思**（"你把入参用错了"）⇒ 判定只能有一处。
 * ★ 加一条前缀 = 改判据 ⇒ 同一张表，别在别处再写一份。
 */
export const ARG_SHAPE_PREFIXES: readonly string[] = [
  '缺参数 "',
  '✗ 调用失败：入参未通过',
  '缺**必填**参数',
  '不认识的键',
];

/** 五类的人读标签（渲染用；★ 判据不读它） */
export const REJECTION_KIND_LABEL: Readonly<Record<RejectionKind, string>> = {
  A: 'A 业务拒绝（该做，但被规则挡）',
  B: 'B 异常（代码错）',
  C: 'C 探测（门 / 扫射，不参与业务分母）',
  D: 'D 调用方用错（缺参 / 类型不符）',
  unknown: 'unknown 判不了（不是"没发生"）',
};

/** 这条调用是不是**探测**（门 / 扫射）—— C 的唯一判据 */
export function isProbeVia(via: string): boolean {
  return PROBE_VIA.includes(String(via ?? ''));
}

/** 这个错是不是**调用方用错**（D 的唯一判据：文案前缀命中 {@link ARG_SHAPE_PREFIXES}） */
export function looksLikeArgShapeError(message: string): boolean {
  const m = String(message ?? '');
  return ARG_SHAPE_PREFIXES.some((p) => m.startsWith(p));
}

/**
 * 把**事实**分成五类（纯函数，无 IO、无随机、无时间）。
 *
 * ★ 次序即判据（改次序 = 改判据，别顺手调换）：
 *   C（探测优先）→ D（用错）→ A（带闸来源）→ B（抛了但无闸来源）→ unknown。
 */
export function classifyRejection(f: RejectionFacts): RejectionKind {
  // 0. 没失败就不是拒绝事件（调用方不该拿它来问；保守回 unknown 而不是假装 A）
  if (!f || f.isError === false) return 'unknown';
  // 1. 探测：门/扫射跑出来的失败不回答"业务有没有被挡" ⇒ 必须先从分母里出去
  if (isProbeVia(f.via)) return 'C';
  // 2. 调用方用错（缺参 / schema / 未知键）—— 它也不是"该做被挡"
  if (looksLikeArgShapeError(f.message)) return 'D';
  // 3. 业务拒绝：错带闸的来源（码表是唯一权威，别在这里嗅散文）
  if (Array.isArray(f.gateCodes) && f.gateCodes.length > 0) return 'A';
  if (f.gateRejection === true) return 'A';
  // 4. 抛出了 Error 却一条闸来源都没有 ⇒ 代码错
  if (f.threw === true) return 'B';
  // 5. 既没 Error 对象、也没码、也不像用错 ⇒ **判不了**（不许冒充）
  return 'unknown';
}

/**
 * 一次「没做成」该给哪种信封 —— **唯一判据**。
 *
 * ## 它分开的是两件被混在一起的事
 * · **执行失败**（插桩抛了 / 写没落盘）= 这次调用**没跑通** ⇒ `isError`（脚本里能看见"没做成"）；
 * · **报表说世界不好**（`ok:false` 的 payload，如"快照缺失"）= 调用**跑通了**，只是世界不好 ⇒ 不升 `isError`。
 *   ★ 这条纪律见 `plumbing.ts` 的 `wrapData` 尾注（2026-10-20），本函数**不推翻**它。
 *
 * ## 为什么它必须是一个函数而不是一行三元
 * `observe/handlers.ts` 原先写的是 `...(isGateRejection(e) ? { isError: true } : {})` ——
 * 只有"被闸拒绝"才升 `isError`，其余执行失败（语言包缺工具链 / 目录不存在）落 `isError:false`
 * ⇒ `usage.jsonl` 记成 `ok:true`，而消息写着「Observe 插桩失败」= **失败被记成成功**。
 * 把它抽成零依赖纯函数，判据才有**行为落点**（`behavior-cases` 能 load）。
 */
export function envelopeFor(f: { threw: boolean }): 'isError' | 'report-only' {
  return f && f.threw === true ? 'isError' : 'report-only';
}
