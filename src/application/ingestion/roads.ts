/**
 * roads.ts —— 管线两路分层（冻结企划 §2.3 · Main 纠偏口径）。
 *
 * ## 两条路，两种缺外设口径（不许混）
 * · **语义翻译 / 语义提取路（模型不可或缺）**：叙事提取、schema 候选生成、pivot/translate 名词映射、
 *   蒸馏 / 去重 judge、语义复核。缺模型 / 调用失败 / 解析失败 ⇒ **响亮 blocked/unsupported 报错阻断或不产候选**；
 *   **不得 Noop 降级成功、不得原文兜底假装已理解**。
 * · **非语义增强路（纯机械 / 检索增强，可降级）**：向量化、重排、查询重写、REM 联想增强、heat 衰减、算法剪枝。
 *   缺外设 ⇒ Noop / 空结果 / 机械兜底 / 跳过，**降级可见化**（显式状态 + reason）；只影响召回排序与整理效率，
 *   不做权威判定。
 *
 * ## 模型定位（§1.1 / §2.4）
 * 模型负责语义增强；系统负责状态、闸、审计、权威落位。模型产物一律是候选，不直接成为权威；
 * 裁决权在系统 / 主控。本模块只给路别分类与降级口径判定，不绑定具体模型实现。
 */

/** 语义路环节闭集（模型不可或缺）。 */
export const SEMANTIC_STEPS = [
  'narrative-extraction',
  'schema-candidate-gen',
  'pivot-translate',
  'skill-distill-dedupe',
  'semantic-review',
] as const;

/** 非语义增强路环节闭集（可降级可见化）。 */
export const NONSEMANTIC_STEPS = [
  'vectorize',
  'rerank',
  'query-rewrite',
  'rem-association',
  'heat-decay',
  'prune',
] as const;

export type SemanticStep = (typeof SEMANTIC_STEPS)[number];
export type NonsemanticStep = (typeof NONSEMANTIC_STEPS)[number];
export type PipelineStep = SemanticStep | NonsemanticStep;

export type RoadKind = 'semantic' | 'nonsemantic';

/** 闸判定结果：proceed=外设可用；blocked=语义路阻断（非绿）；degraded-visible=非语义路降级可见（非绿读数）。 */
export type RoadOutcome = 'proceed' | 'blocked' | 'degraded-visible';

export interface RoadEvaluation {
  road: RoadKind;
  step: PipelineStep;
  available: boolean;
  /** 是否降级（仅非语义路可为 true；语义路降级 = 阻断，不走降级通道） */
  degraded: boolean;
  outcome: RoadOutcome;
  reason: string;
}

/** 环节 → 路别。未登记环节 = 口径外环节，抛错（不许静默归到可降级那一路）。 */
export function classifyRoad(step: PipelineStep): RoadKind {
  if ((SEMANTIC_STEPS as readonly string[]).includes(step)) return 'semantic';
  if ((NONSEMANTIC_STEPS as readonly string[]).includes(step)) return 'nonsemantic';
  throw new Error(`roads：环节「${String(step)}」不在两路闭集内 —— 口径外环节不许默认按可降级处理`);
}

/**
 * 评估某环节外设可用与否的闸口径。
 * · 语义路缺模型 ⇒ `blocked`（`degraded=false`，响亮阻断；不产候选、不原文兜底）；
 * · 非语义路缺外设 ⇒ `degraded-visible`（`degraded=true`，显式理由可见；不做权威判定）；
 * · 可用 ⇒ `proceed`。
 *
 * ★ 聚合门不得把 `proceed=false` 之外的 exit 0 当通过：`blocked` / `degraded-visible` 都是非绿读数。
 */
export function evaluateRoad(step: PipelineStep, available: boolean): RoadEvaluation {
  const road = classifyRoad(step);
  if (available) {
    return { road, step, available: true, degraded: false, outcome: 'proceed', reason: '外设可用' };
  }
  if (road === 'semantic') {
    return {
      road,
      step,
      available: false,
      degraded: false,
      outcome: 'blocked',
      reason:
        '语义路缺模型 / 调用失败 / 解析失败 ⇒ blocked/unsupported：不 Noop 降级成功、不原文兜底假装已理解、不产伪候选',
    };
  }
  return {
    road,
    step,
    available: false,
    degraded: true,
    outcome: 'degraded-visible',
    reason: '非语义增强路缺外设 ⇒ Noop / 空结果 / 机械兜底 / 跳过；降级可见化（显式状态 + reason），不做权威判定',
  };
}
