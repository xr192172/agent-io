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
  //   ★ 规则：**事实只有一个家**（代码 / `cache.db` 是权威），意图册不复刻事实。
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

/**
 * 文件生命周期（"下线=两个文件合并"或"孤立=真弃用归档"时的演进状态）。
 *
 * ★★★ **T183（2026-10-12）：这里原先还有一个 `'archived'` 值 —— 已删掉，因为它是【不可达的】。**
 *   · **取证**：`grep -rn "status: 'archived'" src/` ⇒ **零个写端**；
 *     `grep -rn "lifecycle.archive_id" src/` ⇒ **零个读端**（`archive_id` 一起删了）。
 *   · **为什么本该不可达（设计如此，不是漏做）**：**归档 = 把文件【移出 DSL】+ 写【归档库】**
 *     （`archive` 工具的三清）⇒ ★ 一个"已归档"的文件**根本不在设计 DSL 里**
 *     ⇒ 于是"活文档里的某文件 status=archived"这个状态**结构上不可能存在**。
 *     归档这件事的真身在**归档条目**里（`retire_reason` / `merged_into` / `archived_at` / 完整快照），
 *     **不是**某个枚举值 ⇒ ★ 在 DSL 里再写一个 `archived` 反而是**同一件事住两处**。
 *   · ★★ **为什么必须删而不是留着当"保留值"**：一个**类型声明了、而系统产不出**的状态，
 *     就是一条**会被读成事实的谎** —— 它会把读端引向错误推理。
 *     ★ 本仓有现成先例：我自己和三位评审都曾被 `DiagramStatus` 的**错误值域**带偏过
 *     （我把 `SymbolLifecycle` 的 5 个值当成了 `DiagramStatus` 的值）。**别再造这种类型。**
 *   · ★ 保留的一条**指路**：真有人往 `lifecycle.status` 里写 `'archived'` ⇒
 *     `assertLifecycle` 会用一段**专门文案**告诉他"归档走 `archive` 工具"（见下），
 *     ★ 而不是笼统的"非法值" —— **能力没了，但路还指着**。
 */
export interface FileLifecycle {
  /** active=存活；deprecated=弃用待删；merged=已并入他处（★ **没有** `archived`，见上） */
  status: 'active' | 'deprecated' | 'merged';
  /**
   * ★ **合并目标文件路径** —— `merged` 且本文件是**源**（被并走的那头）时给。
   * ★★ 注意：归档路径上源文件**随即被移出 DSL** ⇒ 它通常只活在**归档快照**里。
   */
  merged_into?: string;
  /**
   * ★ **合并来源文件路径列表** —— `merged` 且本文件是**目标**（吸收别人的那头）时给。
   * ★★ 此时 `merged_into` **显式为 `undefined`**（那是"清掉可能继承来的值"，不是漏填）
   *   ⇒ 判据是"**两者至少有一个**"，不是"必须有 `merged_into`"（T185 修正）。
   */
  merged_from?: string[];
  /** 下线原因（`deprecated` 时必填 —— 一句话说清"为什么该删"，那是历史堆要留的东西） */
  retire_reason?: string;
  /** 状态变更时间（ISO 8601） */
  changed_at?: string;
}

/**
 * ★ `FileLifecycle` 的**已知键全集**（唯一清单）。
 *
 * ★★ 为什么必须有它（T181 出生证**当场抓到的真缺陷**，不是推演）：
 *   只校验 `status` **挡不住"形状错"**。实测：把 `lifecycle` 写成**裸字符串** `"deprecated"`
 *   ⇒ `updateFile` 的合并写 `{ ...file.lifecycle, ...lifecycle }` 会把字符串**按索引展开**成
 *   `{0:'d',1:'e',2:'p',…}` ⇒ ★ 而 `status` 从旧值**继承**过来**仍然是合法的**
 *   ⇒ **校验通过** ⇒ **`{0:'d',…}` 这堆垃圾被静默写进了 DSL**（磁盘实读为证），**一声不响**。
 *   ⇒ 判据：★ 光校验"**值**"不够，还要校验"**键集合**"（同 `op_data_spec.ts` 的 T170c）。
 *   ★ 这也是本仓"**该报错却默认**"那一类：`data` 是自由袋子，不校验形状 ⇒ 喂什么存什么。
 */
export const LIFECYCLE_KEYS = [
  'status',
  'merged_into',
  'merged_from',
  'retire_reason',
  'changed_at',
] as const;

/** ★ 类型级断言：`FileLifecycle` 加了字段而清单没跟（**漏**）⇒ `tsc` 直接红。 */
type LifecycleKeysMissing = Exclude<keyof FileLifecycle, (typeof LIFECYCLE_KEYS)[number]>;
export const _assertLifecycleKeysNoMissing: LifecycleKeysMissing extends never
  ? true
  : ['★ `LIFECYCLE_KEYS` 漏了这些键（interface 有、清单没有）⇒ 补进 `semantic.ts`：', LifecycleKeysMissing] = true;
/** ★ 类型级断言：清单有、interface 没有（**多**）⇒ 也红。 */
type LifecycleKeysExtra = Exclude<(typeof LIFECYCLE_KEYS)[number], keyof FileLifecycle>;
export const _assertLifecycleKeysNoExtra: LifecycleKeysExtra extends never
  ? true
  : ['★ `LIFECYCLE_KEYS` 多写了这些键 ⇒ 从 `semantic.ts` 里删掉：', LifecycleKeysExtra] = true;

/**
 * ★★★ **`FileLifecycle` 的**唯一**校验器**（T181，2026-10-11 三方独立评审后落）。
 *
 * ## 为什么它必须只有一处
 * `lifecycle` 有**两个写端**：① `updateFile`（人/LLM 走 `edit_dsl`）② `archive_node`（归档工具）。
 * ★ 若两处**各自内联校验** ⇒ "什么状态合法、哪些字段必填"就**落两处** ⇒ 本仓头号病「同一判据住两处」。
 *
 * ## 纪律（三方评审一致 + 本仓纪律）
 * · ★ **形状（键集合）先于值** —— 只校验枚举值会被"继承来的合法 status"骗过去（见 `LIFECYCLE_KEYS` 注释）。
 * · ★★ **`archived` 不是合法值**（T183 已从类型里删掉，见 `FileLifecycle` 的注释）：
 *   归档 = 把文件**移出 DSL** + 写**归档库** ⇒ ★ 活文档里**结构上不可能**有这个状态。
 *   ★ 这里**保留一段专门文案**：真有人写 `'archived'` 时**指路 `archive` 工具**，
 *     而不是笼统的"非法值"（**能力没了，但路还指着**）。
 * · ★ **`deprecated` 要有 `retire_reason`**（★ 否则"为什么该删"无从考古 —— 那正是历史堆的用途）。
 * · ★ **`merged` 要有"对手"**：`merged_into`（并到哪去了）**或** `merged_from`（并进来哪些）
 *   —— ★ 至少一个，因为**这个文件可能是合并关系的任一头**（T185 修正，见下方正文）。
 * · ★ **非法一律抛**（不静默回落 —— `data` 是自由袋子，**不校验枚举**，所以这里必须挡）。
 *
 * ★ 载荷是**校验后**的完整 `FileLifecycle`（调用方在合并写之后传进来，见 `file_ops.ts`）：
 *   这样"旧值里的垃圾"也会被挡住（**失败就失败，不降级**），代价是**垃圾一旦落盘会卡住后续写**——
 *   那是**故意**的：它是个必须显式修掉的坏状态，不是可忽略的噪声。
 */
export function assertLifecycle(lc: FileLifecycle): void {
  // ★ 纪律：形状先于值 —— TS 类型在运行期是**擦除**的，`data` 又是自由袋子 ⇒ 这里必须自己判形状。
  if (lc === null || typeof lc !== 'object' || Array.isArray(lc)) {
    throw new Error(
      `lifecycle 必须是**对象**（形如 {status:'deprecated', retire_reason:'…'}）—— ` +
        `收到的是 ${Array.isArray(lc) ? '数组' : typeof lc}。`,
    );
  }
  const unknown = Object.keys(lc).filter((k) => !(LIFECYCLE_KEYS as readonly string[]).includes(k));
  if (unknown.length > 0) {
    // ★ 数字键 = 一个**可识别的误用指纹**：`{...'abc'}` → `{0:'a',…}`、`{...['x']}` → `{0:'x'}`。
    //   ⇒ 分别给一句指路（★ 本仓纪律：错误信息就是最好的文档；别让人自己猜形状）。
    const numericKeys = unknown.every((k) => /^\d+$/.test(k));
    const firstVal = numericKeys ? (lc as unknown as Record<string, unknown>)[unknown[0]] : undefined;
    const hint = !numericKeys
      ? ''
      : typeof firstVal === 'object' && firstVal !== null
        ? `★ 看着像**把 lifecycle 传成了数组**：数组被按索引展开了（{0:{…}}）。` +
          `请传**对象**：{status:'deprecated', retire_reason:'为什么该删'}。\n`
        : `★ 看着像**把 lifecycle 传成了字符串**：字符串被按索引展开了（{0:'d',1:'e',…}）。` +
          `请传**对象**：{status:'deprecated', retire_reason:'为什么该删'}。\n`;
    throw new Error(
      `lifecycle 里有**不被认的键**：${unknown.slice(0, 8).join(' / ')}${unknown.length > 8 ? ` …（共 ${unknown.length} 个）` : ''}` +
        `（★ 此前它们会被**静默写进 DSL** —— 你以为没事、其实落了垃圾）。\n` +
        hint +
        `★ 已知键（${LIFECYCLE_KEYS.length} 个）：${LIFECYCLE_KEYS.join(' / ')}`,
    );
  }
  const ok = ['active', 'deprecated', 'merged'];
  if (!ok.includes(lc.status)) {
    // ★★★ T183：`'archived'` **专门指路**（不是笼统的"非法值"）——
    //   因为它是**最容易被误用**的那一个（"我要归档，就把状态写成 archived"是最自然的直觉），
    //   而正确答案是"**这件事不由这个字段表达**"。★ 别让错误信息只说"错"，要说"该走哪"。
    //   ★★ 为什么要 `as string`：★ **TS 已经证明这个分支在【类型层】不可能**
    //     （删掉 `'archived'` 后，`if (lc.status === 'archived')` 会直接报 TS2367 无重叠）
    //     ⇒ ★ 那条编译错误**本身就是"值不可达"的机器证明**，是好事。
    //     但**运行期**不同：`data` 是**自由袋子**、类型在运行期**被擦除**
    //     ⇒ 真有人发 `{"status":"archived"}`，这里**收得到** ⇒ ★ 守卫必须留着（只是要绕开类型层）。
    if ((lc.status as string) === 'archived') {
      throw new Error(
        'lifecycle.status **没有** `"archived"` 这个值 —— ★ 因为"归档"**不是设计 DSL 里的一种状态**：' +
          '归档 = 把该文件**移出 DSL**（三清）+ 写**归档库**（条目 + 完整快照）' +
          '⇒ 一个"已归档"的文件**根本不在设计 DSL 里**，所以它没有 status 可写。\n' +
          '★ 要归档请调 `archive(action=node, file_path, retire_reason)`；' +
          '只想先标一笔"该删"⇒ 用 `{"status":"deprecated","retire_reason":"…"}`。',
      );
    }
    throw new Error(`lifecycle.status 非法：「${String(lc.status)}」—— 合法值只有 ${ok.join(' / ')}`);
  }
  if (lc.status === 'deprecated' && !lc.retire_reason?.trim()) {
    throw new Error(
      'lifecycle.status="deprecated" 必须带 retire_reason（一句话说清"为什么该删"）—— ' +
        '★ 那正是历史堆要留的东西；没有理由的"待删"标记，将来没人能考古。',
    );
  }
  // ★★★ T185（2026-10-12）：**这条判据我原先写错了，而且它真的弄坏了一条通路** ——
  //   `archive(action=node, merged_into=…)` 的"合并"分支会被它**直接打回**
  //   （实测报错 `lifecycle.status="merged" 必须带 merged_into`）⇒ ★ 一次**回归**，
  //   而 T181 的出生证**没覆盖到那条分支**（它只测了 `edit_dsl` 那一侧）⇒ 没红。
  //   ★ 病根：`merged` 描述的是**一条合并关系**，而这个文件**可能是关系的【任一头】**：
  //     · 被并走的那个（源）：`merged_into` = 去了哪（★ 但源文件**随即被移出 DSL**
  //        ⇒ 这个字段在归档路径上其实**不会**留在 DSL 里，它只是归档快照的一部分）；
  //     · 吸收别人的那个（目标）：`merged_from` = 并进来哪些，**`merged_into` 显式为 undefined**
  //       （`archive_node.ts` 逐字这么写的 —— 那是**清掉可能继承来的值**，不是漏填）。
  //   ⇒ 判据修正：**两者至少有一个**（"这头"必须存在），而不是"必须有 merged_into"。
  if (lc.status === 'merged' && !lc.merged_into && !(lc.merged_from?.length)) {
    throw new Error(
      'lifecycle.status="merged" 必须带 merged_into（并到哪去了）**或** merged_from（并进来哪些）—— ' +
        '★ 至少给出这头，否则"合并"这件事**没有对手**（考古时不知道它和谁合的）。',
    );
  }
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