/**
 * 语义层类型：文件/API/模板/scaffold 配置
 */

import type { DiagramStatus, NodeDecision, DecisionHistoryEntry } from './geometry.js';
import type { BrickContract } from './contract.js';

/** 预期 API */
export interface ExpectedApi {
  /** 函数名（extractApis/opl 写入 actual_apis 时填充） */
  name?: string;
  /** 函数签名，如 "User.Login() (token string, err error)" */
  signature: string;
  /** 函数起始行号（import_project 扫描时填充，LLM 拿到后直接 read 定位） */
  line?: number;
  /** 函数结束行号（含闭合括号，为 LLM 提供完整函数范围） */
  end_line?: number;
  notes?: string;
  /** notes 英文版（i18n：API 说明切换英文时用） */
  notes_en?: string;
}

/** 符号条目：常量/类型/变量/类/接口/结构体声明（非函数方法类，用于行号定位） */
export interface Symbol {
  /** 符号名，如 "MaxRetries"、"UserService" */
  name: string;
  /** 符号类型 */
  kind: 'const' | 'type' | 'var' | 'struct' | 'interface' | 'class' | 'function' | 'method';
  /** 起始行号 */
  line: number;
  /** 结束行号（含闭合括号，为 LLM 提供完整函数/类型范围） */
  end_line?: number;
  /** 签名（声明文本），如 "interface UserService"、"MAX_RETRIES = 3" */
  signature?: string;
  /**
   * 决策卡·符号级（挂载在函数/API 上，而非文件/功能上——diff 的最小单位是符号，
   * 决策卡挂这里才能与三方对比逐符号对齐；没卡时向上继承所在文件的 Node.decision）。
   */
  decision?: NodeDecision;
  /** 决策卡·版本栈（语义同 Node.decision_history） */
  decision_history?: DecisionHistoryEntry[];
  /** 生命周期元数据：下线/合并/拆分时的演进追踪，供 diff 裁决与归档引用 */
  lifecycle?: SymbolLifecycle;
}

/** 符号生命周期（节点下线/合并/拆分的演进状态） */
export interface SymbolLifecycle {
  /** active=存活；deprecated=弃用待删；superseded=已被取代；split=已拆分；merged=已并入他处 */
  status: 'active' | 'deprecated' | 'superseded' | 'split' | 'merged';
  /** 取代者符号（"符号名"或"文件路径#符号名"） */
  superseded_by?: string;
  /** 拆分产物符号列表 */
  split_into?: string[];
  /** 合并来源符号列表 */
  merged_from?: string[];
  /** 下线/变更原因（孤立归档时必填，作为历史研究材料） */
  retire_reason?: string;
  /** 状态变更时间（ISO 8601） */
  changed_at?: string;
}

/** 语义层文件 */
export interface SemanticFile {
  /** 与 geometry.nodes.id 对应 */
  id: string;
  /** 目标文件相对路径 */
  path: string;
  /** 职责描述 */
  responsibility: string;
  /** 职责描述英文版（i18n） */
  responsibility_en?: string;
  expected_apis?: ExpectedApi[];
  /** 预期依赖路径列表（**设计态/意图**） */
  expected_deps?: string[];
  /** 预期行为描述 */
  expected_behavior?: string;
  /** 文件实现状态：draft=待实现, in_progress=实现中, done=已完成 */
  status?: DiagramStatus;
  // ★★ 2026-10-01（T20 第 (2) 步）：`actual_deps` 与 `actual_apis` **已移除**。
  //   它们是**代码的事实**（权威在 tree-sitter 解析数据 `cache.db`），却被镜像进"意图册"——
  //   用户原话：「意图册有三项东西，但是有一项东西其实本身就是代码的权威吧」。
  //   镜像 = 第二份可写副本 = 判据分叉的温床。**要事实请走唯一入口**：
  //     `src/infrastructure/index/file_facts.ts` 的 `fileFacts(root, fileRel, feature?)`
  //   （`root` 取 DSL 自带的 `source_root`；DSL 只保留"事实的出处"，不保留事实本身。）
  /** 符号表：常量/类型/变量/类/接口/结构体声明（非函数方法类），含行号，供 LLM 定位代码 */
  symbols?: Symbol[];
  /** 文件行数（import_project 扫描时填充，供单文件化预警/星图 tooltip 从 DSL 读取） */
  lines?: number;
  /** 架构层 id（序号5：architecture-analyzer 按路径启发式推断，如 api/service/data/ui） */
  layer?: string;
  /** 积木契约（Phase 2 契约提取填充；缺省 = 契约未提取） */
  contract?: BrickContract;
  /** 文件生命周期：合并（两文件合一）/孤立（下线归档）时的演进追踪 */
  lifecycle?: FileLifecycle;
}

/** 文件生命周期（"下线=两个文件合并"或"孤立=真弃用归档"时的演进状态） */
export interface FileLifecycle {
  /** active=存活；deprecated=弃用待删；merged=已并入他处；archived=已归档下线库 */
  status: 'active' | 'deprecated' | 'merged' | 'archived';
  /** 合并目标文件路径（merged 时） */
  merged_into?: string;
  /** 合并来源文件路径列表 */
  merged_from?: string[];
  /** 下线/归档原因（archived 时必填，作为历史研究材料） */
  retire_reason?: string;
  /** 归档条目 id（archived 时指向 archive 库） */
  archive_id?: string;
  /** 状态变更时间（ISO 8601） */
  changed_at?: string;
}

/** 代码模板配置 */
export interface CodeTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 目标语言：go/ts/py/js/vue/react */
  lang: string;
  /** 模板内容（支持占位符：{{package}}, {{imports}}, {{apis}}, {{behavior}}, {{node_id}}, {{node_label}}） */
  template: string;
  /** 文件扩展名 */
  ext: string;
}

/** scaffold 配置 */
export interface ScaffoldConfig {
  /** 自定义模板列表 */
  templates?: CodeTemplate[];
  /** 是否生成注释标记（默认 true） */
  markers?: boolean;
  /** 是否从节点内容生成 UI 骨架（默认 false） */
  generate_ui_skeleton?: boolean;
  /** UI 骨架类型：vue/react/html */
  ui_framework?: 'vue' | 'react' | 'html';
}

/** 语义层 */
export interface Semantic {
  files: SemanticFile[];
  /** 不变式规则（自然语言 + 可选代码引用），design_check 会验证 */
  multi_file_invariants?: string[];
  expected_global_behavior?: string[];
  /** scaffold 代码生成配置 */
  scaffold?: ScaffoldConfig;
}

/**
 * ★ 判据（纯）：本 feature 的语义层里**有没有文件级条目**（`semantic.files` 非空）。
 *
 * ## 为什么单独立一个判据（而不是在调用处各写一次 `files.length === 0`）
 * `semantic.files` **为空**（手工建的 DSL / 旧产物）是**正常状态**，不是坏数据：
 * ★ 2026-10-09 之前 `import_project` 的聚合模式（`functional_mode` 功能聚合 / `design_mode` 设计草图，
 *   0 使用 + 有害 T101，**已移除**）**故意**把"文件身份"折叠进**模块节点** ⇒ 语义层只留模块、不留文件。
 * 而"空 ⇒ 按文件粒度的工具不适用"这条**同一判断**此前散在 **三处**
 * （`dsl_ops/status_tools.ts` / `intent/consistency.ts` / `lifecycle/scaffold.ts`）
 * —— 本仓铁律「**同一判据只写一处**」⇒ 判据住这里。
 * ★ 本判据**只管"有没有"**；"为什么 + 出路"的**用户可见措辞**住
 * `application/design/no_file_entries.ts` 的 `noFileEntriesMessage`（三处共用）。
 *
 * ★ 运行时守卫用 `Array.isArray`：契约上 `files` 恒为数组，但手工/老 DSL 可能缺该字段，
 *   缺字段与空数组**同一语义**（都没有文件级条目）—— 这是**判据**，不是静默降级。
 * ★ 返回类型是**类型谓词**（`semantic is Semantic`）：`if (!hasFileEntries(dsl.semantic)) throw …`
 *   之后 TS 能把 `dsl.semantic` 收敛为**已定义** ⇒ 下游 `dsl.semantic.files` 不必再写 `?.`/`?? []`。
 */
export function hasFileEntries(semantic: Semantic | undefined | null): semantic is Semantic {
  return !!semantic && Array.isArray(semantic.files) && semantic.files.length > 0;
}