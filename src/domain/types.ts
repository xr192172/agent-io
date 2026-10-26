/**
 * agent-io DSL 类型定义（根模块）
 * 与 schema/design_dsl.schema.json 严格对齐
 *
 * 领域拆分：几何层 ./geometry / 语义层 ./semantic / 标注 ./annotation
 *          动画 ./animation / 仿真 ./simulation
 * 本文件保留根类型（DesignDSL/ThemeConfig/ThemeId）并统一再导出全部领域类型，
 * 外部消费者继续从 domain/types.js 单一入口获取类型。
 */

import type { DiagramStatus, Geometry } from './geometry.js';
import type { Semantic } from './semantic.js';
import type { Animation, AnimationSystem } from './animation.js';
import type { Simulation } from './simulation.js';
import type { ReasoningSystem } from './reasoning.js';

export type {
  DiagramStatus,
  NodeLayer,
  NodeStyle,
  BlockStyle,
  ContentBlock,
  NodeContent,
  Node,
  NodeDecision,
  DecisionDissent,
  DecisionAuthor,
  DecisionHistoryEntry,
  EdgeStyle,
  Edge,
  Swimlane,
  Geometry,
  ForceParams,
} from './geometry.js';

export type {
  ExpectedApi,
  SemanticFile,
  CodeTemplate,
  ScaffoldConfig,
  Semantic,
  Symbol,
  SymbolLifecycle,
  FileLifecycle,
} from './semantic.js';

export type {
  BrickContract,
  BrickRole,
  ShapeSchema,
  ShapeField,
  EffectTarget,
} from './contract.js';


export type {
  ElementState,
  AnimationStage,
  Animation,
  AnimationTrigger,
  AnimationValueSchema,
  NodeShapes,
  AnimationValue,
  AnimationHandlerMapping,
  AnimationError,
  AnimationHandler,
  AnimationBranch,
  AnimationFlow,
  AnimationRuntime,
  AnimationSystem,
} from './animation.js';

export type {
  SimulationRule,
  SimulationDepEdge,
  SimulationAction,
  SimulationStateDef,
  SimulationNodeMapping,
  Simulation,
  SimulationTrace,
} from './simulation.js';

export type {
  ReasoningStepKind,
  ReasoningFoldKind,
  ReasoningStep,
  ReasoningFold,
  ReasoningBudget,
  ReasoningEntry,
  ReasoningSystem,
} from './reasoning.js';

/** 主题配置 */
export interface ThemeConfig {
  /** 主题 ID */
  id: string;
  /** 主题名称 */
  name: string;
  /** 主色调 */
  primary?: string;
  /** 辅助色 */
  secondary?: string;
  /** 背景色 */
  background?: string;
  /** 卡片背景 */
  cardBg?: string;
  /** 边框色 */
  border?: string;
  /** 文字颜色 */
  text?: string;
  /** 副标题颜色 */
  textSub?: string;
  /** 强调色 */
  accent?: string;
}

/** 主题 ID */
export type ThemeId = 'dynamic' | 'blue' | 'sakura' | 'forest' | 'ocean' | 'star';

/** 架构分层定义（序号5/7：architecture-analyzer + Layer Visualization） */
export interface ArchLayer {
  /** 层标识（kebab-case，如 api/service/data/ui） */
  id: string;
  /** 层名（中文，如 "API 层"） */
  name: string;
  /** 层名英文版（i18n：切换英文时取值，缺失回退 name） */
  name_en?: string;
  /** 层职责一句话描述 */
  description: string;
  /** 层职责一句话描述英文版（i18n） */
  description_en?: string;
  /** 该层统一着色（深色主题协调的填充色） */
  color: string;
  /** 该层包含的文件节点数 */
  count: number;
}

/** 功能树下钻：一个社区（analyze_monolith 的结构簇） */
export interface FeatureCommunity {
  /** analyze_monolith 社区 id */
  id: number;
  /** 社区名（功能锚点名/高频词） */
  name: string;
  /** 社区名英文版（i18n） */
  name_en?: string;
  /** 社区横跨的文件（相对路径） */
  files: string[];
  /** 估算行数 */
  est_lines: number;
  /** 社区内符号数 */
  symbol_count: number;
}

/** 功能树下钻：一个功能（几大功能之一，社区二次归并） */
export interface FeatureNode {
  /** 功能 id（kebab-case，如 renderer） */
  id: string;
  /** 功能名（LLM 生成中文名，未配置时用目录/锚点兜底） */
  name: string;
  /** 功能名英文版（i18n） */
  name_en?: string;
  /** 该功能下的社区 */
  communities: FeatureCommunity[];
}

/**
 * ★ 社区 ≠ 目录 的文件（T230）：该文件的主导社区之"家目录" ≠ 该文件自己的目录。
 *
 * 这是**聚类唯一的增量价值**：一个功能横跨多个目录时，目录会把它**切碎**，
 * 而聚类能看见"这些点在外还聚在一起"（跨目录的调用关系）。
 * ★ 判据：两者**一致的文件不出现**——只有不一致的才进这份清单（否则就是装饰）。
 */
export interface CommunityDirDiffEntry {
  /** SemanticFile.id（= geometry.node.id） */
  file_id: string;
  /** 语义文件相对路径（相对 source_root） */
  file: string;
  /** 文件自己的目录键（首段目录；根级文件 'root-svc'） */
  dir: string;
  /** 该文件主导社区 id */
  community_id: number;
  /** 该文件主导社区名 */
  community_name: string;
  /** 主导社区的家目录键（该社区多数成员文件所在目录） */
  community_dir: string;
}

/** 功能树：项目 → 功能 → 社区 → 文件 的逐级下钻数据 */
export interface FeatureTree {
  /** 功能层 */
  features: FeatureNode[];
  /** 文件 → 主导归属映射（key 为 SemanticFile.id，即 geometry.node.id） */
  file_map: Record<string, { feature_id: string; community_id: number }>;
  /** 功能名生成方式：llm=LLM 人话命名；rule=目录归并兜底（可被 refresh_llm 升级） */
  source?: 'llm' | 'rule';
  /** ★ 社区 ≠ 目录 的文件清单（仅在不一致时出现；一致时不写这个键 —— 空清单占位=装饰）。 */
  community_dir_diff?: CommunityDirDiffEntry[];
}

/** 顶层 DSL 文档 */
export interface DesignDSL {
  /** DSL ID（可选，用于全局唯一标识） */
  id?: string;
  /** DSL 类型（如 feature_diagram） */
  type?: string;
  /** feature 名，用于 get_dsl / list_features */
  feature: string;
  /** DSL 版本（语义化版本号） */
  version?: string;
  /** 人类可读标题 */
  title?: string;
  /** 导入源码的持久根目录（绝对路径）。semantic.files 的相对路径以此为基；
   * 巨石体检/影响面/一致性等需读源文件的功能据此定位源码。 */
  source_root?: string;
  /** 乐观锁修订号（daemon 写权威用：写前携带 base _dsl_rev，冲突则拒绝，防多会话丢改动） */
  _dsl_rev?: number;
  status?: DiagramStatus;
  /** 主题 ID（默认 blue） */
  theme?: ThemeId;
  /**
   * ★★★ 2026-10-18（Q5）：**无节点任务**（To Do）—— 和 `geometry.nodes[].task` **同一套状态机/同一套 op 语义**，
   * 区别只在"挂在哪"：节点任务挂代码节点，todo 挂这个顶层数组。
   * ★ 它**没有 `expectations`**（不是代码，判不了）⇒ 完成只收 `attestation` 证据。
   */
  todos?: import('./task_schema.js').TaskSpec[];
  /** 几何层（必填） */
  geometry: Geometry;
  /** 语义层（无则纯示意图） */
  semantic?: Semantic;
  /**
   * ★★★ 2026-10-23：`annotations` / `canvas_notes` / `user_nodes` 三格**已整体退场**
   * （用户裁定：「前端几乎没有什么可操作页面，它只是一个显示屏」「给前端用的这些都不需要，只需要供给 Agent 用」）。
   * DSL 字段已删、HTTP 端点已删、**没有替代住家**（曾计划 `canvas_store.ts`，**从未存在**）。
   * ★ 别把它们加回来：它们是**批注层**，不是设计内容；加回来就得再给写闸开一个洞。
   * 详见 `docs/ROOTS.md` §8（退场登记）。
   */
  /** 动画序列（旧版阶段快照式，保留向后兼容） */
  animations?: Animation[];
  /** 动画系统 V2（分层精度 L0-L5，声明式数据流可视化，详见 docs/animation-design.md） */
  animations_v2?: AnimationSystem;
  /** 仿真器定义（事件驱动状态机，替代动画时间轴） */
  simulation?: Simulation;
  /** Agent 推理演示（脚本式回放：输入 → 逐层推理 → token 超量折叠上下文） */
  reasoning?: ReasoningSystem;
  /** 架构分层结果（序号5/7）：每层定义 + 文件归属，供图层着色与图例 */
  layers?: ArchLayer[];
  /** 功能树（项目 → 功能 → 社区 → 文件）：逐级下钻导航数据 */
  feature_tree?: FeatureTree;
}

/** 用户在思维导图上新增的节点（挂在 AI 生成树的任意节点下，可嵌套） */
export interface UserNode {
  id: string;
  /** 挂载目标：'root' | 'f{i}' | 'f{i}:{j}' | 其他 user node id */
  parent_id: string;
  /** 挂载时的目标文字（分镜再生成后 f 索引漂移时按文字兜底匹配） */
  parent_label?: string;
  /** 节点文字 */
  text: string;
  created?: string;
}