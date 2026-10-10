/**
 * 几何层类型：节点/边/泳道/布局
 * 与 schema/design_dsl.schema.json 严格对齐
 */

import type { DesignDSL } from './types.js';
import type { NodeShapes } from './animation.js';

/** 图纸/节点状态 */
export type DiagramStatus = 'draft' | 'in_progress' | 'done';

/**
 * 职责分层：节点/边按职责分三层，渲染时渐进披露（默认只显示 main 层）
 * - main：主干数据流转（默认显示）
 * - error：异常处理（深层，默认折叠，宿主节点 ⚠ 角标展开）
 * - detail：实现细节（深层，默认折叠，宿主节点 ▸ 角标展开）
 */
export type NodeLayer = 'main' | 'error' | 'detail';

/** 节点 CSS 样式（几何层） */
export interface NodeStyle {
  /** 形状：rect=矩形, rounded=圆角矩形, circle=圆形, diamond=菱形, freeform=自由形, parallelogram=平行四边形, hexagon=六边形, triangle=三角形 */
  shape?: 'rect' | 'rounded' | 'circle' | 'diamond' | 'freeform' | 'parallelogram' | 'hexagon' | 'triangle';
  /** 背景色 */
  bg?: string;
  /** 前景色（文字） */
  color?: string;
  /** 语义色调：error/success/warning，渲染器映射到主题变量（显式 bg 优先） */
  tone?: 'error' | 'success' | 'warning';
  /** 边框，如 "1px solid #4f8df7" */
  border?: string;
  /** 圆角半径（px） */
  borderRadius?: number;
  /** 阴影，如 "0 8px 32px rgba(0,0,0,0.3)" */
  shadow?: string;
  /** 透明度 0-1 */
  opacity?: number;
  /** 允许扩展任意 CSS 字段 */
  [key: string]: string | number | undefined;
}

/** 内容块样式 */
export interface BlockStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  [key: string]: string | number | boolean | undefined;
}

/** 富文本内容块 */
export interface ContentBlock {
  /** 块类型：text=文字, image=图片, color_block=色块容器, spacer=间隔, code=代码块, list=列表, divider=分割线, badge=徽章 */
  type: 'text' | 'image' | 'color_block' | 'spacer' | 'code' | 'list' | 'divider' | 'badge';
  /** 文字内容（type=text 时） */
  value?: string;
  /** 图片 URL（type=image 时） */
  src?: string;
  /** 图片宽度（type=image 时） */
  width?: number;
  /** 图片高度（type=image 时） */
  height?: number;
  /** 背景色（type=color_block 时） */
  bg?: string;
  /** 边框（type=color_block 时） */
  border?: string;
  /** 圆角（type=color_block 时） */
  borderRadius?: number;
  /** 内边距（type=color_block 时） */
  padding?: number;
  /** 间隔高度（type=spacer 时） */
  spacerHeight?: number;
  /** 子块（type=color_block 时） */
  children?: ContentBlock[];
  /** 块样式 */
  style?: BlockStyle;
  /** 是否可见（动画控制） */
  visible?: boolean;
  /** 列表项（type=list 时） */
  items?: string[];
  /** 列表类型（type=list 时） */
  listType?: 'ul' | 'ol';
  /** 代码语言（type=code 时） */
  language?: string;
  /** 徽章颜色（type=badge 时） */
  badgeColor?: string;
}

/** 节点内容 */
export interface NodeContent {
  /** 内容类型：text=纯文字, rich=富文本块, layout=布局容器 */
  type: 'text' | 'rich' | 'layout';
  /** 富文本块列表（type=rich 或 layout 时） */
  blocks?: ContentBlock[];
}

/** 几何层节点 */
export interface Node {
  id: string;
  label?: string;
  /** 左上角 x 坐标（px），缺省由 layout 自动排版 */
  x?: number;
  /** 左上角 y 坐标（px） */
  y?: number;
  width?: number;
  height?: number;
  style?: NodeStyle;
  /** 节点内容：纯文字或富文本块（含图片、色块） */
  content?: NodeContent;
  /**
   * 子图 DSL：点击节点在新标签页打开子画布
   * 用于"功能聚合"——主图保持简洁，细节在子图里展开
   */
  sub_dsl?: DesignDSL;
  /** 节点实现状态：draft=待实现, in_progress=实现中, done=已完成 */
  status?: DiagramStatus;
  /** 所属泳道 ID（对应 geometry.swimlanes[].id） */
  swimlane?: string;
  /** 节点类型描述（如 service/module/database/api/queue/ui） */
  type?: string;
  /** 节点描述/备注 */
  description?: string;
  /** 人话主标题：LLM 生成的职责摘要（如"配置加载与校验"），渲染端优先展示，label 兜底 */
  title?: string;
  /** title 英文版（i18n：切换英文时用，缺失回退 title） */
  title_en?: string;
  /** 职责分层：main=主干（默认显示）；error/detail=深层（默认折叠，角标展开）。缺省 main */
  layer?: NodeLayer;
  /** 深层节点的宿主主干节点 ID（角标挂载点）；缺省时仅跟随全局层开关 */
  host?: string;
  /** 架构分层（L2 序号5/7）：启发式推断文件所属架构层（api/service/data/ui/...），供图层着色切换 */
  arch_layer?: string;
  /** 数据形状卡（D1）：进/出该节点的数据形状（人话版 JSON Schema 渲染，纯展示） */
  shapes?: NodeShapes;
  /**
   * 决策卡·参数表（2026-08-18）：类型化 key-value，承载设计参数（如 budget_mb: 64）。
   * 与 description 纯文本的区别：参数是字段，机器可对拍（未来 observe 参数级对拍的地基）。
   */
  attributes?: Record<string, string | number | boolean>;
  /**
   * 决策卡·决策记录（2026-08-18）：结论/理由/替代方案/后果/验收标准。
   * LLM 运化时填写，人抽查；DSL 只运化可机器执行部分，rationale 永留卡上。
   */
  decision?: NodeDecision;
  /**
   * 决策卡·版本栈（2026-08-18 语义化）：每次 update decision 自动把旧版压栈。
   * 栈底最老、栈顶最近被取代的版本；当前生效版永远是 node.decision 本身。
   */
  decision_history?: DecisionHistoryEntry[];
}

/**
 * ★★★ 决策作者的**类别**（可信度轴）—— `NodeDecision.author` / `DecisionHistoryEntry.author` 的唯一取值域。
 *
 * ## 为什么收成一个枚举（不许再是自由文本）
 * 本仓规矩「**语义空 = 谁想装什么都行 = 迟早一名两义**」。收口前 `author` 上写着
 * "human / llm / 账号名"——**三个东西挤在同一个字段**：前两个是**类别**（可信度），
 * 第三个是**身份**（谁）。这正是一名两义。
 * ⇒ 拆成两个正交维度（本仓 2026-10-10 定）：
 *   · **类别**（可信度到哪）= 本类型 `author`，只为 `'human' | 'llm'`；
 *   · **身份**（可追溯·出了事找谁）= `NodeDecision.agent`（`string`）。
 * ★ 两者**可以并存**（例：`author:'llm'` + `agent:'agent-07'`）——
 *   "这条是机器推的" 与 "是哪台机器" 是**两个问题**，不许合并。
 * ★ 立场（本仓既有）：**人写的 > 机器推的** —— 所以类别是**可信度**，不是"礼帽装饰"。
 */
export type DecisionAuthor = 'human' | 'llm';

/** 节点决策记录（决策卡的核心结构） */
export interface NodeDecision {
  /** 结论：这个设计是什么（一句话） */
  summary: string;
  /** 理由：为什么这么定（含定量依据） */
  rationale?: string;
  /** 被否掉的替代方案及否决原因 */
  alternatives?: { option: string; rejected_because: string }[];
  /** 后果/风险：这么定的代价 */
  consequences?: string;
  /** 验收标准：怎么算做好了（可观测） */
  acceptance?: string;
  /**
   * ★★★ **可判定的验收**（2026-10-09，T74）—— `acceptance` 那句话里**能被机器判定的那一部分**。
   *
   * ★ **不是 `acceptance` 的替代**：后者是给人读的一句话（保留、不动）；本字段是它的**可执行子集**。
   *   一句话里判不了的（"代码要更清晰"）**不许硬塞进来** —— 那只会造出"永远绿"的假项。
   * ★ 为什么需要它（实测）：`acceptance` 此前是**自由文本、无任何程序读它**，
   *   而 `consistency_check` / `detect_drift` **退出码恒 0** ⇒ "照设计重写实际"这条链上
   *   **唯一没有执行者的一环就是验收**（别的环错了看得见，它错了看不见）。
   * ★ 形状与判据见 `src/domain/expectation.ts`；判定器在 `application/design/intent/expectations.ts`。
   */
  expectations?: import('./expectation.js').Expectation[];
  /** 生效状态：active=当前生效（默认）；superseded=已被新版取代（历史版不删，进 decision_history）；draft=讨论中未定稿 */
  status?: 'active' | 'superseded' | 'draft';
  /** 功能线：同类决策的聚合标签（如"内存治理"/"链路追踪"），query decisions 按此分组，相似功能线合并视图 */
  thread?: string;
  /** 自由标签：跨功能线检索（如 "blackbox" "performance"） */
  tags?: string[];
  /**
   * ★★★ **作者类别**（可信度轴，2026-10-10 收口）—— `'human' | 'llm'`，回答「**可信度到哪**」。
   *
   * ★ **不再是自由文本**：此前写着"human / llm / 账号名"，把**类别**（可信度）与**身份**（谁）挤在一个字段里
   *   ⇒ 一名两义。现只认两个类别；**身份**（Agent 的编号/名字）住在 {@link NodeDecision.agent}。
   * ★ 两者**并存**：`author:'llm'` + `agent:'agent-07'` ⇒ "机器推的" + "是哪台机器"。
   * ★ **缺省不伪造**（写入口没传就不写）—— 缺省 ≠ 说谎，读端据"有没有值"判断。
   */
  author?: DecisionAuthor;
  /**
   * ★★★ **发起本次决策的身份**（可追溯轴，2026-10-10 新增）—— Agent 的编号/名字，回答「**出了事找谁**」。
   *
   * ## 它**不是** `author`（这是本字段存在的全部理由）
   * `author` = **类别**（`'human' | 'llm'`，说**可信度**）；本字段 = **身份**（`string`，说**是谁**）。
   * 二者是**两个正交维度**，**都要能同时存在**（例：`author:'llm'` + `agent:'agent-07'`）。
   * ★ 从前把"账号名"塞进 `author` ⇒ 谁想装什么都行 ⇒ 迟早一名两义（本仓头号病）。
   *
   * ## 来源是**调用方**，工具**不生成**它
   * 一次工具调用本身没有稳定身份（每次都是新的）—— 所以身份只能由**调用方**（发起 `edit_dsl` 的那个
   * Agent / 人）传进来（`edit_dsl` 顶层入参 `agent`）。工具**绝不自己造**一个 id（那是伪造）。
   * ★ **没传时怎么办**：本仓选「**落库但不伪造 + 读端明标「未署名」**」（不是抛错）——
   *   理由见 `b_terms` 的 `agent` 词条 / 写入口回执。⇒ 读端据"有没有该字段"即可判断**这条有没有署名**。
   */
  agent?: string;
  /** 本次决策最近写入/修订时间（ISO 8601），与 decision_history.at 呼应成时间线 */
  updated_at?: string;
  /**
   * ★★★ **未决分歧**（2026-10-10，T106 决策写入口）—— 多份证据**说法不一致、还没对拍裁定**的差异。
   *
   * ## 为什么**不能**塞进 `alternatives`（本字段存在的全部理由）
   * `alternatives` 的既有语义是「**被否掉的**替代方案 + **否决原因**」（**已经想清楚并排除了**）；
   * 而这里的分歧是「**还没想清楚**」。直接塞进去会把"未决"伪装成"已排除"（同名不同义，本仓头号病）。
   * ⇒ **未决分歧住这里**；等对拍 / 以设计为准裁定之后，**未采纳的说法 + 为什么不采纳**才进
   *   `alternatives[{option, rejected_because}]`。
   *
   * ## 语义（用户 2026-10-10 裁定，逐字）
   * 「并**不要强制它们没有区别**……三个如果有了差别，**要以用户的那个设计为准**，然后去想
   *   **怎样去往设计上靠拢**。」⇒ **分歧不是要消除的噪声，是一处「待对拍的差异」**；
   * "往设计上靠拢"是**修复方向**。⇒ 写入口只**如实记下**分歧，**不去消歧**（处置是对拍与人的事）。
   *
   * ★ 口径见 `domain/b_terms.ts` 的 `dissent` 词条（**唯一住处**）。
   */
  dissent?: DecisionDissent[];
  /**
   * ★ **支持 `summary` 的证据源个数**（多源印证 = 置信；不是"同一提示词抽几次的稳定性"）。
   * 证据源枚举见 `harvest_decisions` 的 `EvidenceSource`（code / history / docs）。
   */
  votes?: number;
  /** ★ 支持 `summary` 的**证据源**（哪几份证据投了它）；长度应 = `votes`。 */
  evidence_source?: string[];
}

/**
 * 一条**未决分歧**：某份证据给出的、与当前 `summary` 不同、且**尚未裁定**的说法。
 * ★ 与 `NodeDecision.alternatives` 的 `{option, rejected_because}` **不是一个东西**：
 *   本结构**没有被否**（只是没被采纳），也**没有否决原因**（还没判）。
 * ★ 将来裁定后：被否的说法 → `alternatives`（补 `rejected_because`）；本项从 `dissent` 移除。
 */
export interface DecisionDissent {
  /** 该分歧说法（与 `summary` 不同的那个结论） */
  option: string;
  /** 支持该说法的证据源个数（可选） */
  votes?: number;
  /** 支持该说法的证据源（可选；code / history / docs） */
  evidence_source?: string[];
}

/** 决策版本栈条目：旧决策 + 压栈时间 + 修订说明 */
export interface DecisionHistoryEntry {
  /** 压栈时间（ISO 8601） */
  at: string;
  /** 被取代的旧决策全文 */
  decision: NodeDecision;
  /** 本次修订说明（翻案理由/变更点，可空） */
  note?: string;
  /**
   * 发起本次修订的**作者类别**（谁用新版取代了旧版；值域 = `'human' | 'llm'`，**同 `NodeDecision.author`**）；
   * 旧版自身的 author 仍留在 `decision.author`。★ 与 `agent` 是两个维度（类别 vs 身份）。
   */
  author?: DecisionAuthor;
  /**
   * 发起本次修订的**身份**（Agent 的编号/名字，同 `NodeDecision.agent`）；旧版自身身份仍在 `decision.agent`。
   * ★ 缺省 = 本次修订**未署名**（读端据此判断）。
   */
  agent?: string;
}

/** 边 SVG 样式 */
export interface EdgeStyle {
  stroke?: string;
  strokeWidth?: number;
  [key: string]: string | number | undefined;
}

/** 几何层边 */
export interface Edge {
  id: string;
  /** 源节点 ID */
  from: string;
  /** 目标节点 ID */
  to: string;
  label?: string;
  style?: EdgeStyle;
  /** 边类型：直线(默认)/贝塞尔曲线/虚线 */
  type?: 'straight' | 'curve' | 'dashed';
  /** 箭头方向：正向(默认)/反向/双向/无 */
  arrow?: 'forward' | 'reverse' | 'both' | 'none';
  /** 职责分层：缺省时自动推导——任一端点为深层节点则跟随较深层（detail > error > main） */
  layer?: NodeLayer;
  /** 设计意图（overlay 落库到 base 的边级意图）：A 为何依赖 B / 边界归属 */
  intent?: { reason?: string; boundary?: string };
}

/** 泳道（横向分组） */
export interface Swimlane {
  id: string;
  /** 显示名称 */
  label?: string;
  /** 背景色（可选） */
  bg?: string;
  /** 文字颜色（可选） */
  color?: string;
  /** 垂直位置（top y），高度根据节点自动计算 */
  y?: number;
  /** 固定高度（可选，不设置则自动计算） */
  height?: number;
}

/** 几何层 */
export interface Geometry {
  /**
   * 自动排版策略：
   * - dag：拓扑排序布局（适合有向无环图）
   * - force：力导向布局（适合复杂网络图）
   * - grid：网格布局（按 columns 排列）
   * - vertical_flow：纵向流
   * - horizontal_flow：横向流
   * - free：完全用 x/y
   */
  layout?: 'dag' | 'force' | 'grid' | 'vertical_flow' | 'horizontal_flow' | 'free';
  /** 画布宽度（px） */
  width?: number;
  /** 画布高度（px） */
  height?: number;
  /** grid 布局列数 */
  columns?: number;
  /** 网格对齐大小（px），默认 20 */
  grid_size?: number;
  /** 力导向布局参数 */
  force_params?: ForceParams;
  nodes: Node[];
  edges?: Edge[];
  /** 泳道分组（可选） */
  swimlanes?: Swimlane[];
}

/** 力导向布局参数 */
export interface ForceParams {
  /** 排斥力系数（默认 1000） */
  repulsion?: number;
  /** 弹簧刚度（默认 0.1） */
  stiffness?: number;
  /** 阻尼系数（默认 0.85） */
  damping?: number;
  /** 迭代次数（默认 500） */
  iterations?: number;
  /** 节点半径（默认 50） */
  node_radius?: number;
}
