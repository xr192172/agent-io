/**
 * registry/tool_warnings.ts —— 跨工具「告警」的结构化通道 + 两级呈现（P-F，规划书 §16.6 / §16.8）
 *
 * ★ 为什么要有它
 *   `⚠️ STALE SOURCE / STALE INDEX` 的**存在**是正确设计 —— 它们让人（和 agent）能判断
 *   "读到的是不是旧图"。但它们原先**每轮附整段长文本**（改 src 未 build 期间每次调用都有），
 *   对 agent 是**重复噪音**；而另一端"报一次就永久静默"又违反 §2d（把"少做了什么"藏起来：
 *   后来加入的读者永远不知道图是旧的）。⇒ 两条要求（§16.6）：
 *     ① **首次出现给全文，之后给一行摘要**；
 *     ② **结构化**成 `warnings: [{code, summary, detail, fix}]` —— 判据是**可被程序判定**。
 *
 * ★ 两级呈现的**判定依据**（"首次/后续"的状态位在哪里）
 *   进程内的 `delivered: Set<键>`，键 = `code@scope`。
 *   - **为什么可靠**：MCP server 是**长驻进程**，模块级状态**跨工具调用保留**
 *     （与 `staleSourceWarning` 早先那个 `_lastStaleState` 标志同一机制、同一生命周期）。
 *   - 第一次投递某键 ⇒ **全文**（`detail` + `fix`）；之后每次投递同一键 ⇒ **只有 `summary`**。
 *     ★ 注意"之后"不是静默：摘要**每次都给**（否则又回到"藏起来"）。
 *   - 进程重启 ⇒ Set 清空 ⇒ 新会话第一次仍得全文 —— 这正是想要的（新读者需要完整说明）。
 *
 * ★ 诚实边界（别把本机制当"保证"）
 *   ① **跨进程不保留**：重启即重置。刻意如此，不是缺陷。
 *   ② 键含 `scope`（由生产方给，如 STALE INDEX 用项目根）⇒ **换项目会各自算"首次"**。
 *   ③ "已投递全文"是**粘性**的：同一进程内某键恢复健康后再变陈旧，**只给摘要**（不重发全文）。
 *   ④ 它只负责**呈现分级**与**结构化**，不负责探测：探测仍在各生产方（`staleSourceWarning` 等），
 *      所以"没探测到"和"探测到了但降级成摘要"是两回事 —— 后者在 `warnings` 数组里**有**该 code。
 *
 * ★ 机器通道（"可被程序判定"落在这）
 *   响应文本**末尾**追加 `---WARNINGS---` + JSON（与 `wrapData` 的 `---DATA---` 同一约定）。
 *   放在**最末**是刻意的：`text.split(WARNINGS_MARKER)[1]` 即可直接 `JSON.parse`
 *   （`---DATA---` 因为后面还会被追加文本，做不到这一点；那是既有约定，不在本笔范围）。
 *   无告警时**不追加**该块（空数组不进门，避免无意义的每轮噪音）。
 */

/** 一条告警 —— 生产方的产物，也是线上形状（`scope` 例外，见下）。 */
export interface ToolWarning {
  /** 稳定机器码（程序据此判定，不靠正则）。已发布的码不要改。 */
  code: string;
  /** 一行摘要：**每次**投递都带 */
  summary: string;
  /** 完整说明：只在**首次**投递带；后续摘要投递为 `null`（避免重复噪音） */
  detail: string | null;
  /** 可执行修复：只在**首次**投递带；后续为 `null` */
  fix: string | null;
  /**
   * 记账作用域（**不上线**：序列化时被剥掉，只用于 `code@scope` 这个"首次/后续"的键）。
   * 缺省 = 全局（整个进程只算一次"首次"）。
   */
  scope?: string;
}

/** 机器通道分隔标记（与 `---DATA---` 同一约定） */
export const WARNINGS_MARKER = '---WARNINGS---';

/** 与本模块自述一致：线上（JSON）形状恰好这四个键。 */
export interface WireWarning {
  code: string;
  summary: string;
  detail: string | null;
  fix: string | null;
}

/** 已「全文投递」过的键（进程内）。判据 = 这里的成员资格，见文件头。 */
const delivered = new Set<string>();

/**
 * 测试隔离 / 显式重置：清掉"已投递全文"的记账 ⇒ **下一次投递重新给全文**。
 * （`staleIndexWarning` 那边的 `resetStaleIndexWarningCache` 会连带调用本函数 —— 见其注释。）
 */
export function resetWarningDelivery(): void {
  delivered.clear();
}

function keyOf(w: ToolWarning): string {
  return w.scope ? `${w.code}@${w.scope}` : w.code;
}

function toWire(w: ToolWarning): WireWarning {
  return { code: w.code, summary: w.summary, detail: w.detail, fix: w.fix };
}

/**
 * 两级呈现的核心判定（纯逻辑 + 一个 `ledger` 副作用）：把生产方的告警转成**本轮要投递的**数组。
 * 第一次见到的键 ⇒ 原文（含 detail/fix）；已投递过 ⇒ 只剩 `code` + `summary`（detail/fix 置 null）。
 *
 * `ledger` 可注入（默认进程级单例）—— 就是为了**能被测试与门看见**，不必依赖跨轮的真实调用。
 */
export function tierWarnings(ws: readonly ToolWarning[], ledger: Set<string> = delivered): WireWarning[] {
  return ws.map((w) => {
    const k = keyOf(w);
    if (ledger.has(k)) return { code: w.code, summary: w.summary, detail: null, fix: null };
    ledger.add(k);
    return toWire(w);
  });
}

/** 人类可读渲染：全文 = 摘要 + 说明 + 修复（三行）；摘要投递 = **一行**。无告警 ⇒ 空串。 */
export function renderWarningText(ws: readonly WireWarning[]): string {
  const lines: string[] = [];
  for (const w of ws) {
    lines.push(`\n⚠️ ${w.code}：${w.summary}`);
    if (w.detail) lines.push(`   ${w.detail}`);
    if (w.fix) lines.push(`   → ${w.fix}`);
  }
  return lines.join('\n');
}

/** 机器通道：前置标记 + JSON 数组；无告警 ⇒ 空串（不追加空块）。 */
export function warningBlock(ws: readonly WireWarning[]): string {
  if (ws.length === 0) return '';
  return `\n${WARNINGS_MARKER}\n${JSON.stringify(ws)}`;
}

/** 一轮投递的产物：结构化数据（`warnings`）+ 由它派生的文本/机器块。 */
export interface WarningEmission {
  /** 本轮**要投递**的告警（已按见/未见分级；形状 = `{code, summary, detail, fix}`） */
  warnings: WireWarning[];
  /** 注入进响应文本的人类可读段（首次全文 / 后续一行摘要；空 = 无告警） */
  text: string;
  /** 注入进响应**最末**的机器块（含 `---WARNINGS---` 标记；空 = 无告警） */
  block: string;
}

/**
 * 唯一入口：生产方的告警（`null` = 本轮无此告警）⇒ 分级后的结构化数组 + 文本 + 机器块。
 * ★ 调用方**只**该用本函数拼响应，不要再手工拼警告字符串（否则结构化通道会被绕过）。
 */
export function emitWarnings(produced: ReadonlyArray<ToolWarning | null | undefined>): WarningEmission {
  const live = produced.filter((w): w is ToolWarning => w !== null && w !== undefined);
  const warnings = tierWarnings(live);
  return { warnings, text: renderWarningText(warnings), block: warningBlock(warnings) };
}
