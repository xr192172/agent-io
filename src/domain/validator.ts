/**
 * DSL 校验器
 *
 * 用 ajv 跑 JSON Schema 校验，再补两项 schema 无法表达的语义校验：
 * 1. geometry.nodes.id 唯一
 * 2. semantic.files.id 必须能在 geometry.nodes 中找到对应 id（锚定完整性）
 */

import { Ajv, type ErrorObject } from 'ajv';
import * as addFormatsNS from 'ajv-formats';
import schema from '../../schema/design_dsl.schema.json' with { type: 'json' };
import type { DesignDSL } from './types.js';

// ajv-formats 在 NodeNext 严格模式下 default import 不可直接调用，
// 这里通过 namespace import 取 default（运行时是 CommonJS module.exports.default）
type AddFormatsFn = (ajv: Ajv, options?: unknown) => unknown;
const addFormats = (
  (addFormatsNS as unknown as { default?: AddFormatsFn }).default ??
  (addFormatsNS as unknown as AddFormatsFn)
) as AddFormatsFn;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile<DesignDSL>(schema);

/**
 * ★★★ T341（2026-10-16）：一条校验错误 = **稳定的"键"** + **人类可读文本**。
 *   ★ **为什么要键**：下游（`update_feature.ts` 的自洽性闸）要判"**这是不是同一条错**"。
 *     原先它拿 `errors` 做**字符串差集** ⇒ ★ **只要某次编辑让"既有错的文本"变了**
 *     （典型：**重命名**"被指向的名字" ⇒ `[dangling_edge] edge "e" .to "旧名"` 变成 `"新名"`）
 *     ⇒ 旧文本消失/新文本出现 ⇒ **被当成"本次新增"** ⇒ **误拦合法编辑**。
 *   ★ **键的口径**：指向**出错的位置/主体**（引用方：edge.id / file.id / step.id / at_step …），
 *     ★ **不含**"被指向的对方名字"这类**易变文本** ⇒ 重命名被指向的名字**不改键**。
 *   ★ **一处产出**：键与文本在**同一个 push 点**一起产出（不是另写一把"从字符串反解键"的尺）。
 */
interface ValidationErrorItem {
  /** 稳定错误键（见上：位置/主体，不含易变文本） */
  key: string;
  /** 人类可读文本 —— ★ 与 T340 之前**逐字相同** */
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  /** 人类可读错误信息列表（valid=true 时为空） */
  errors: string[];
  /**
   * ★★★ T341：与 `errors` **同长同序**的稳定错误键（`errors[i] ↔ keys[i]`）。
   *   ★ 对账"这是不是同一条错"**用 keys**；展示/既有断言仍用 `errors`（文本未动）。
   */
  keys: string[];
}

/** 把"键 + 文本"对打包成 `ValidationResult`（`errors` 与 `keys` 严格同长同序） */
function toResult(items: ValidationErrorItem[]): ValidationResult {
  return { valid: false, errors: items.map((i) => i.message), keys: items.map((i) => i.key) };
}

/** 把 ajv ErrorObject[] 转成"键 + 可读文本"（★ 文本与原先逐字相同） */
function formatAjvErrors(errors: ErrorObject[] | null | undefined): ValidationErrorItem[] {
  if (!errors || errors.length === 0) return [];
  return errors.map((e) => {
    const path = e.instancePath || '(root)';
    // ★ 键 = 关键字 + 实例路径 + ajv 模板消息（后两者都是 schema 派生的，不含实例取值 ⇒ 稳定）
    return { key: `schema:${e.keyword}:${path}:${e.message ?? ''}`, message: `[${e.keyword}] ${path}: ${e.message ?? ''}` };
  });
}

/** 校验 geometry.nodes.id 唯一性 + semantic.files.id 锚定完整性 */
function validateSemanticAnchoring(dsl: DesignDSL): ValidationErrorItem[] {
  const errors: ValidationErrorItem[] = [];

  // 1. nodes.id 唯一
  const seen = new Map<string, number>();
  for (const node of dsl.geometry.nodes) {
    const count = (seen.get(node.id) ?? 0) + 1;
    seen.set(node.id, count);
    if (count === 2) {
      errors.push({
        key: `duplicate_id:node:${node.id}`,
        message: `[duplicate_id] geometry.nodes.id "${node.id}" 重复出现`,
      });
    }
  }

  // 1b. ★★★ 2026-10-18（D-edge-id-unique）：**edges.id 唯一** —— 此前只查 nodes.id，重复的边 id 能过校验。
  //   ★ 为什么它要紧：`overlay.edges` 按 id 索引 ⇒ 重复 id 会让"改哪条边"变成掷骰子。
  //   ★ 键的形态与 nodes 那条同款（`duplicate_id:edge:<id>`）—— 不含"谁指向谁"，重命名不改键。
  const seenEdges = new Map<string, number>();
  for (const edge of dsl.geometry.edges ?? []) {
    const count = (seenEdges.get(edge.id) ?? 0) + 1;
    seenEdges.set(edge.id, count);
    if (count === 2) {
      errors.push({
        key: `duplicate_id:edge:${edge.id}`,
        message: `[duplicate_id] geometry.edges.id "${edge.id}" 重复出现`,
      });
    }
  }

  // 2. edges.from / edges.to 必须在 nodes 中存在
  const nodeIds = new Set(dsl.geometry.nodes.map((n) => n.id));
  for (const edge of dsl.geometry.edges ?? []) {
    if (!nodeIds.has(edge.from)) {
      errors.push({
        // ★ 键认"**哪个边的哪一端**断了"—— ★ 不含 `edge.from`（被指向的名字，重命名会变）
        key: `dangling_edge:edge:${edge.id}:from`,
        message: `[dangling_edge] edge "${edge.id}".from "${edge.from}" 在 geometry.nodes 中找不到`,
      });
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({
        key: `dangling_edge:edge:${edge.id}:to`,
        message: `[dangling_edge] edge "${edge.id}".to "${edge.to}" 在 geometry.nodes 中找不到`,
      });
    }
  }

  // 3. semantic.files.id 必须在 nodes 中存在（锚定完整性）
  if (dsl.semantic?.files) {
    for (const file of dsl.semantic.files) {
      if (!nodeIds.has(file.id)) {
        errors.push({
          key: `anchor_broken:file:${file.id}`,
          message: `[anchor_broken] semantic.files.id "${file.id}" 在 geometry.nodes 中找不到对应节点`,
        });
      }
    }
  }

  // 4. annotations.target_id 应指向 node.id 或 edge.id（警告级别，不阻断）
  //    这里以 error 形式报，方便发现拼写错误
  const edgeIds = new Set((dsl.geometry.edges ?? []).map((e) => e.id));
  for (const anno of dsl.annotations ?? []) {
    const target = anno.target_id || anno.node_id;
    if (target && !nodeIds.has(target) && !edgeIds.has(target)) {
      errors.push({
        key: `dangling_annotation:annotation:${anno.id}`,
        message: `[dangling_annotation] annotation "${anno.id}".target_id "${target}" 既不在 nodes 也不在 edges 中`,
      });
    }
  }

  return errors;
}

/** 校验 reasoning（Agent 推理演示）的引用完整性 */
function validateReasoningIntegrity(dsl: DesignDSL): ValidationErrorItem[] {
  const errors: ValidationErrorItem[] = [];
  const reasoning = dsl.reasoning;
  if (!reasoning) return errors;

  const nodeIds = new Set(dsl.geometry.nodes.map((n) => n.id));

  // entry.node 必须在 nodes 中存在
  if (reasoning.entry && !nodeIds.has(reasoning.entry.node)) {
    errors.push({
      key: `reasoning_entry_broken:entry`,
      message: `[reasoning_entry_broken] reasoning.entry.node "${reasoning.entry.node}" 在 geometry.nodes 中找不到`,
    });
  }

  // steps.id 唯一 + step.node 必须在 nodes 中存在
  const stepIds = new Set<string>();
  for (const step of reasoning.steps ?? []) {
    if (stepIds.has(step.id)) {
      errors.push({
        key: `reasoning_dup_step:step:${step.id}`,
        message: `[reasoning_dup_step] reasoning.steps.id "${step.id}" 重复出现`,
      });
    }
    stepIds.add(step.id);
    if (!nodeIds.has(step.node)) {
      errors.push({
        // ★ 键认"哪个 step 断了"（step.id）—— 不含 `step.node`（被指向的名字）
        key: `reasoning_step_node_broken:step:${step.id}`,
        message: `[reasoning_step_node_broken] reasoning.steps "${step.id}".node "${step.node}" 在 geometry.nodes 中找不到`,
      });
    }
  }

  // folds.at_step 在合法范围 + folds.node 存在 + folds.folded 引用存在的 step
  const stepCount = reasoning.steps?.length ?? 0;
  for (const fold of reasoning.folds ?? []) {
    if (fold.at_step < 1 || fold.at_step > stepCount) {
      errors.push({
        key: `reasoning_fold_range:fold:${fold.at_step}`,
        message: `[reasoning_fold_range] reasoning.folds.at_step "${fold.at_step}" 超出步骤范围 1..${stepCount}`,
      });
    }
    if (!nodeIds.has(fold.node)) {
      errors.push({
        key: `reasoning_fold_node_broken:fold:${fold.at_step}`,
        message: `[reasoning_fold_node_broken] reasoning.folds.at_step "${fold.at_step}".node "${fold.node}" 在 geometry.nodes 中找不到`,
      });
    }
    for (const sid of fold.folded) {
      if (!stepIds.has(sid)) {
        errors.push({
          key: `reasoning_fold_step_broken:fold:${fold.at_step}:step:${sid}`,
          message: `[reasoning_fold_step_broken] reasoning.folds.at_step "${fold.at_step}".folded "${sid}" 在 steps 中找不到`,
        });
      }
    }
  }

  return errors;
}

/**
 * ★★★ 2026-10-19：**读数快照不许落盘**（`task_plan` 不变量 #2 的第一个可判形态）
 *
 * ## 为什么这条闸必须有（今天的实证，不是假想）
 * `task_plan.plan_to_work.reading_now` 停在 **2026-10-16**：`checked 25 / passed 12 / failed 12`。
 * 而 **2026-10-19 实跑 `judgeExpectations`**：`checked 517 / passed 515 / failed 0`。
 * ⇒ **快照说"还有 12 条红"，实际 0 条。** 它躺在"唯一手写源"里，读它的人（含下一个窗口的 LLM）
 *   会以为还有 12 件活；而且它引用的复跑入口 `certs/.work/probe-plan-detail.mjs` 至今仍按**老路径**
 *   （`docs/` 下那份）去读设计 DSL —— 那份早已迁到 `.agent-io/design/task-system-plan.dsl.json`
 *   ⇒ 连"怎么复跑"都是断的。
 *
 * ## 判据
 * 读数是**派生量**（跑一次就有），只能【读时现算】。落盘 = 第二份真相 = 会过期 = 会骗人。
 * ★ 这条同时补上了 `task_plan.invariants[1]` 的 `covered_by`（那条不变量此前写着 `covered_by: null`
 *   —— "只落意图与事件，不落读数快照"**无法判**，于是 DSL 自己违反了也无人知）。
 *
 * ## 为什么是独立函数，不塞进 anchoring / reasoning
 * ★ 踩过：第一次把它写在 `validateReasoningIntegrity` 末尾，而那个函数第三行是
 *   `if (!reasoning) return errors;` —— 本 DSL 没有 `reasoning` ⇒ **闸一次都没跑过，而三态全绿**
 *   （"没跑"与"没报错"长得一模一样）。独立函数 ⇒ 不继承任何人的 early return。
 *
 * ## 边界（不在这条闸里管的）
 * `layers[].count` 也是读数，但它是 `ArchLayer` 的**必填类型字段**（`types.ts:149`）⇒
 * 删它要连类型与构造处一起改，属于单独一笔（已记进 todos）。
 */
function validateNoReadingSnapshots(dsl: DesignDSL): ValidationErrorItem[] {
  const errors: ValidationErrorItem[] = [];
  const tp = (dsl as DesignDSL & { task_plan?: { plan_to_work?: Record<string, unknown> } }).task_plan;
  const ptw = tp?.plan_to_work;
  for (const k of ['reading_now', 'block_readings'] as const) {
    if (ptw?.[k] !== undefined) {
      errors.push({
        key: `reading_snapshot:task_plan.plan_to_work.${k}`,
        message:
          `[reading_snapshot] "task_plan.plan_to_work.${k}" 是**读数快照**，不许落盘 ` +
          `（不变量 #2：只落意图与事件）—— 读数会过期，过期就会骗人。` +
          `改成**读时现算**：跑 judgeExpectations / 对应 probe；要留痕就写进 decision（带 at + 命令 + 读数），` +
          `不要写成 DSL 字段。`,
      });
    }
  }
  return errors;
}

/**
 * 校验 DSL 对象
 *
 * 用法：
 * ```ts
 * const { valid, errors } = validateDSL(dslObj);
 * if (!valid) throw new Error(errors.join('\n'));
 * ```
 */
export function validateDSL(dsl: unknown): ValidationResult {
  // 先跑 schema 校验
  if (!validateSchema(dsl)) {
    return toResult(formatAjvErrors(validateSchema.errors));
  }
  // schema 通过后跑语义校验
  const semanticErrors = validateSemanticAnchoring(dsl as DesignDSL);
  if (semanticErrors.length > 0) {
    return toResult(semanticErrors);
  }
  // 再跑 reasoning 引用完整性校验
  const reasoningErrors = validateReasoningIntegrity(dsl as DesignDSL);
  if (reasoningErrors.length > 0) {
    return toResult(reasoningErrors);
  }
  // ★★★ 2026-10-19：读数快照（读时现算，不许落盘）—— 独立一段，不继承上面任何人的 early return
  const snapshotErrors = validateNoReadingSnapshots(dsl as DesignDSL);
  if (snapshotErrors.length > 0) {
    return toResult(snapshotErrors);
  }
  return { valid: true, errors: [], keys: [] };
}

/**
 * 校验 DSL JSON 字符串
 *
 * @returns valid=true 时返回解析后的 DSL 对象；valid=false 时 errors 有内容
 */
export function validateDSLJson(json: string): ValidationResult & { dsl?: DesignDSL } {
  let parsed: unknown;
  try {
    // strip UTF-8 BOM（Windows 编辑器常带 BOM，JSON.parse 不接受）
    const clean = json.charCodeAt(0) === 0xfeff ? json.slice(1) : json;
    parsed = JSON.parse(clean);
  } catch (e) {
    return {
      valid: false,
      errors: [`[json_parse] JSON 解析失败: ${(e as Error).message}`],
      // ★ T341：json 解析失败只有一个原因（解析不了）⇒ 键为常量即可（同长同序）
      keys: ['json_parse'],
    };
  }
  const result = validateDSL(parsed);
  return result.valid ? { ...result, dsl: parsed as DesignDSL } : result;
}
