/**
 * reason_validator：变更原因的「四层抗偷懒校验链」
 *
 * 目标：让 Agent 在 edit_dsl 写设计时源头留下「为什么改」，且不靠道德、靠校验兜底。
 * 设计原则（见 docs/plans/2026-08-11-live-doc-change-reason.md）：
 *   - 不依赖某个 LLM 的自律，而是让「编理由」比「说实话」更费劲。
 *   - 校验失败时返回具体命中的层与原因，方便 Agent 修正后重试。
 *
 * 四层：
 *   L1 非空      —— trim 后低于阈值字数 → 拒绝（空原因 / 纯空白）
 *   L2 信息量    —— 命中套话黑名单（"更新代码""修复bug""优化"等）→ 拒绝（占位符）
 *   L3 实体绑定  —— 必须包含 ≥1 个具体实体（trace 引用 / diff 文件名 / 数字指标 / 节点或文件 id）
 *   L4 证据回溯  —— 声称的 evidence 必须能查到；对不上 → 打回（编造的理由）
 *
 * 纯函数、无副作用，便于单测。L4 的"能否查到"通过可注入的 resolver 判定，
 * 由调用方（edit_dsl）决定如何解析（查 DSL 节点/文件、查 trace 文件等）。
 */
// ★ 路径归一的**唯一落点**（`\`→`/`、去前导 `./`）—— 本模块不另写第三份（0.9 一处权威）。
import { normPath } from '../../../domain/expectation.js';

// ─────────────────────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────────────────────

/** 校验命中的层标识 */
export type ReasonFailLayer = 1 | 2 | 3 | 4;

/** 校验结果 */
export interface ReasonValidationResult {
  ok: boolean;
  /** 命中的层（ok=false 时有效） */
  layer?: ReasonFailLayer;
  /** 该层失败的具体原因 */
  error?: string;
}

/** 证据引用（与方案 Annotation.evidence 对齐） */
export interface ReasonEvidenceRef {
  type: 'trace' | 'diff' | 'node' | 'edge' | 'metric';
  ref: string;
}

/** L4 证据回溯的解析上下文：由调用方注入如何判定一个证据是否"存在" */
export interface ReasonEvidenceResolver {
  /** 判定单个证据引用是否真实存在 */
  exists?: (ev: ReasonEvidenceRef) => boolean;
  /** 可选的实体集合（L3 用）：节点 id / 文件 id / 文件路径 */
  entityIds?: string[];
  /** 可选的 trace 引用集合（L3 用）：**真实执行过的探针全名**（如 "order.Place"） */
  traceRefs?: string[];
}

/**
 * ★★★ 2026-11-02：**L4「可追溯」的判定范围** —— `resolver.exists` 该把什么算作"能查到"。
 *
 * ## 病（实测，改前）
 * `edit_dsl {type:'node', op:'add'}` 建**新节点**时：`data.decision.expectations` 已写 `file-exists`、
 * 顶层 `evidence` 也指向同一条路径 ⇒ **L4 仍打回**「evidence 无法回溯：node "<path>" 不存在或对不上」
 * ⇒ 那张卡只能把 `weight` 降到 `routine` **绕过 L4** 才落盘 ⇒ 一条永远过不去的闸 = 被关掉的闸（0.16）。
 *
 * ## 根因（是**判定范围**取错，不是"证据编造"）
 * 旧 `exists` 只认「**已经存在**」：册里已有的 node id / `cache.db` 里查得到的文件 —— 而**本批正在新建的
 * 节点**在册里必然还没有、新建的文件在索引里必然还没有 ⇒ 结构性永远过不去。第二处同族：
 * `fileFacts().matched_path === null` 的意思是「**索引里没有**」，不是「**不存在**」⇒ 把前者当后者
 * 就是"读不到就回落成没有"（0.12），`.md` / 未入库的新文件因此永远过不去。
 *
 * ## 判据（四档，任一命中即可追溯；都不命中 ⇒ 打回）
 * · `known`    —— 册里已有的实体（几何节点 id / 语义文件 id）
 * · `declared` —— **本批 ops 声明的实体**（本批新建的节点 id、`node.add` 声明过 `file-exists` 的路径）
 * · `factNow`  —— **现取事实**命中（`cache.db` 里有它 **或** 它在 `source_root` 下真实存在）
 * · `trace`    —— observe 线的真实录制事件命中
 * ★ 不变式：`ref` 谁也没声明、索引里没有、磁盘上也没有 ⇒ 照旧 false（引用本批之外的 node id 同理）。
 *
 * ## 归一只有这一处
 * 本函数把 `ref` 与两份清单**一起**归一 ⇒ 调用方**不许**再预归一（两级各归一一次 = 0.14 说的
 * "同一把键住在两处"，只改一级等于没改）。
 */
export function isTraceableRef(
  ref: string,
  facts: {
    known?: readonly string[];
    declared?: readonly string[];
    factNow?: boolean;
    trace?: boolean;
  },
): boolean {
  if (facts.trace === true || facts.factNow === true) return true;
  const key = normPath(String(ref ?? '').trim());
  if (!key) return false;
  const hit = (list?: readonly string[]): boolean =>
    (list ?? []).some((x) => {
      const k = normPath(String(x ?? '').trim());
      return k !== '' && k === key;
    });
  return hit(facts.known) || hit(facts.declared);
}

/** 校验入参 */
export interface ValidateReasonInput {
  /** 变更原因（自然语言，必填且需通过校验） */
  reason: string;
  /** 可选：显式证据链（L4 校验其可回溯） */
  evidence?: ReasonEvidenceRef[];
  /**
   * 校验级数（1-4）。默认 4=全链。
   * 活文档「轻量写路径」：routine=3（仍强制 L1 非空 / L2 套话 / L3 实体绑定，
   * 但**跳过 L4 证据回溯**）——给日常维护（补节点/改描述/加标注）放行，
   * 不再要求先跑代码留 trace 证据；重改仍走 level=4 强闸。
   */
  level?: 1 | 2 | 3 | 4;
  /** 可选：L3/L4 的实体与证据解析上下文 */
  resolver?: ReasonEvidenceResolver;
}

// ─────────────────────────────────────────────────────────────
// 阈值与黑名单
// ─────────────────────────────────────────────────────────────

/** L1：有效内容最小字数（不含空白） */
export const MIN_REASON_CHARS = 6;

/**
 * L2：套话黑名单。命中说明这句原因是"空话"，没有信息量。
 * 注意：只在整个 reason 剥掉这些词后仍无实质内容时才判为套话，
 * 避免误杀"因为支付超时，把超时时间从 3s 改为 10s"这类包含具体信息的原因。
 */
const FILLER_WORDS = [
  '更新代码',
  '修复bug',
  '修复 bug',
  '优化代码',
  '优化',
  '改进',
  '调整',
  '修改代码',
  '修复问题',
  '修复',
  '更新',
  '修改',
  '改动',
  '变更',
  '重建',
  '重构',
  '删除',
  '添加',
  '增加',
  '补充',
  '完善',
  '完善一下',
  '调整一下',
  '改一下',
  '修一下',
  '整理',
  '微调',
  '细调',
];

/** 数字指标发电机：匹配形如 3s / 10ms / token=1200 / 超限 1200 等 */
const METRIC_RE = /\d+(\.\d+)?\s*(?:s|ms|token|tokens|tok|%|k|KB|MB|GB)?\b/i;

/**
 * 无实义的语法词/连词/语气词。它们不传达实质信息，剥掉后若什么都不剩，
 * 说明这句原因只是"套话 + 虚词"（如"只是更新代码而已""优化改进调整一下"）。
 */
const FUNCTION_WORDS = [
  '只是', '而已', '一下', '简单地', '稍微', '仅', '只要', '就是', '仅仅',
  '因为', '由于', '为了', '把', '从', '到', '改为', '变成', '变得', '更',
  '比较', '较多', '多', '了', '的', '地', '得', '一个', '一种', '这个',
  '那个', '这些', '那些', '被', '让', '使', '在', '于', '之', '与', '和',
  '及', '并', '而', '或', '且', '但', '是', '为', '对', '向', '往', '以',
  '用', '通过', '基于', '根据', '针对', '相对', '较', '其', '这', '那',
  '我们', '需要', '要', '去', '来', '进行', '做了', '进行一下',
];

// ─────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────

/**
 * 四层校验链。逐层执行，任一失败立即返回该层失败原因。
 */
export function validateReason(input: ValidateReasonInput): ReasonValidationResult {
  const { reason, evidence = [], resolver = {} } = input;
  const level = input.level ?? 4;

  // ── L1 非空 ──
  const trimmed = (reason ?? '').trim();
  // 去掉空白后统计可见字符数
  const visibleChars = trimmed.replace(/\s+/g, '');
  if (visibleChars.length < MIN_REASON_CHARS) {
    return {
      ok: false,
      layer: 1,
      error: `原因过短或无实质内容（有效字符 ${visibleChars.length} < ${MIN_REASON_CHARS}）。请用一句话说明这次变更为什么发生。`,
    };
  }

  // ── L2 信息量（套话检测）──
  if (isFillerOnly(trimmed)) {
    return {
      ok: false,
      layer: 2,
      error: `原因 ${trimmed ? `"${trimmed}"` : '为空'} 命中套话黑名单，无信息量。请补充具体实体与变更动机（例如：支付超时从 3s 改为 10s，因为上游网关峰值延迟）。`,
    };
  }

  // ── L4 前置：提供了 evidence 但根本没有解析器 → 优先打回（无法回溯，必属编造/空挂）──
  if (level >= 4 && evidence.length > 0 && !resolver.exists) {
    return {
      ok: false,
      layer: 4,
      error: '提供了 evidence 但未配置证据解析器，无法回溯。请去掉无法回溯的 evidence 或补充 resolver。',
    };
  }

  // ── L3 实体绑定 ──
  const hasEntity = matchesConcreteEntity(trimmed, resolver);
  if (!hasEntity) {
    return {
      ok: false,
      layer: 3,
      // ★★★ 2026-10-11（T171）：**这句文案原先是误导源** —— 它写
      //   「原因需绑定至少一个具体实体（trace 引用 / diff 文件名 / 数字指标 / 节点或文件 id）」，
      //   ★ 把五种"能算实体的东西"列在一起 ⇒ 读的人**自然去调 `evidence`**。
      //   ★★ 而本层查的是 `matchesConcreteEntity(trimmed, …)` —— **`trimmed` 是 `reason` 文本本身**，
      //      **与 `evidence` 一点关系都没有**。
      //   ⇒ 实测（黑盒实验，一个不许读源码的 agent）：它因此**误判成"evidence 的 ref 要换成节点 id"**，
      //     连试三次，最后"成功"其实是它**顺手把 reason 写具体了**（那条 id 是多余的）。
      //   ⇒ 所以文案改成**先点明"看的是 reason 文本"**，并明确**排除 evidence**。
      error:
        '原因未绑定具体实体，太泛了。★ **注意：这一层看的是【reason 那句话本身】** —— 请把实体名**写进 reason 里**' +
        '（例："为 `src/mathutil.ts` 补 `multiply` 契约，因为调用方已经用它了"），' +
        '★ **不要**指望放进 `evidence` 就能过（`evidence` 是给后面的 facts / L4 两层用的，**与本层无关**）。' +
        '能被认出的实体：节点 id / 文件路径 / 文件名 / 数字指标。',
    };
  }

  // ── L4 证据回溯（只在 level=4 强闸时执行）──
  if (level >= 4 && evidence.length > 0) {
    const exists = resolver.exists as (ev: ReasonEvidenceRef) => boolean;
    for (const ev of evidence) {
      if (!exists(ev)) {
        return {
          ok: false,
          layer: 4,
          error: `evidence 无法回溯：${ev.type} "${ev.ref}" 不存在或对不上。请核对证据或移除编造项。`,
        };
      }
    }
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// 内部工具
// ─────────────────────────────────────────────────────────────

/** 判断一个 reason 是否"全程都是套话"（剥掉黑名单词与虚词后无实质内容） */
function isFillerOnly(text: string): boolean {
  // 先剥掉可能的数字指标（它们是有信息量的），避免把"改到 10s"误判为套话
  let remaining = text.replace(METRIC_RE, '');
  // 逐个剥掉黑名单动作词
  for (const w of FILLER_WORDS) {
    remaining = remaining.split(w).join('');
  }
  // 逐个剥掉无实义虚词
  for (const w of FUNCTION_WORDS) {
    remaining = remaining.split(w).join('');
  }
  // 去掉标点与空白后，若几乎没剩字，说明是纯套话
  const meaningful = remaining.replace(/[\s，。、；：！？,.!?;:（）()【】\[\]"'"“”‘’\-—]/g, '');
  return meaningful.length === 0;
}

/** 判断 reason 是否绑定了至少一个具体实体 */
function matchesConcreteEntity(text: string, resolver: ReasonEvidenceResolver): boolean {
  // 1) 数字指标（如 3s / token=1200 / 1200）
  if (METRIC_RE.test(text)) return true;
  // 2) 文件路径 / diff 文件名（含 . 扩展名或 / 分隔）
  if (/[A-Za-z0-9_\-/.]+\.(?:go|ts|js|py|java|json|vue|md|txt|sql|html|css|mjs|tsx|jsx)\b/i.test(text)) return true;
  // 3) 显式绑定集合中的实体（节点/文件 id、trace 引用）
  const ids = (resolver.entityIds ?? []).filter(Boolean);
  for (const id of ids) {
    if (text.includes(id)) return true;
  }
  const refs = (resolver.traceRefs ?? []).filter(Boolean);
  for (const r of refs) {
    if (text.includes(r)) return true;
  }
  return false;
}