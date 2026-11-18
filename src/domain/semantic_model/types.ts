/**
 * semantic_model/types.ts —— **通用语义建模核**的形状权威（domain 层，**零 import**）。
 *
 * ## 它是什么（一句话）
 * 「语义实体 + 算子」这一对概念的形状：**实体**（有名、可序列化、带字段域）+ **算子**（有语义名、
 * 有输入实体契约、有输出变更、**有判据**）。本文件只有**形状与值域**，不含任何判定逻辑
 * ——判定住 `validate.ts`，注册与查找住 `registry.ts`，往返住 `serialize.ts`。
 *
 * ## ★ 为什么零 import（不是风格，是机械约束）
 * ① 本仓 `tests/p0_domain_purity.test.ts:96-127` 钉死：`src/domain` 对
 *    `application / infrastructure / presentation` 的 import **恒为 0**（连 `import type` 也算）；
 * ② 更要紧：`behavior-cases` 判据的 harness 把目标文件**单独转译再 import**
 *    （见 `domain/behavior_contract.ts:10-13`）—— 有任何值 import 就 load 不起来，
 *    那份判定就只能退化成 `source-has` 那种「改坏了也绿」的存在类判据。
 * ⇒ 形状语言**借** `domain/expectation_kinds.ts` 的 `FieldSpec` 语义（`type/required/values/minItems/items`），
 *   **不借** `application/types.ts` 的 zod（那一层住 application，引用它 = 破 ①）。
 *
 * ## ★ 领域无关：本文件与同目录其余四文件**不许出现任何领域词**
 * （具体是哪些词、往哪扫，见 `tests/p0_semantic_model.test.ts` 的「主控词表扫描」那条）
 * —— 第一个领域包住 `src/domain/` 下的**另一个目录**，它单向引用本目录；本目录**不**引用它。
 */

/**
 * 字段类型 —— **借** `expectation_kinds.ts#FieldType` 的口径（够表达实体字段；不为"通用"提前长成 ORM）。
 * 刻意比那边少 `'json[]'`：本核今天没有消费者要它，多一个值就是多一条没人走的路。
 */
export type FieldType = 'string' | 'string[]' | 'number' | 'boolean' | 'object' | 'object[]';

/** 一个字段的声明（形状 = `expectation_kinds.ts#FieldSpec` 的同构子集） */
export interface FieldSpec {
  name: string;
  type: FieldType;
  /**
   * 必填：缺 / `undefined` / `''` / 空数组 / `null` ⇒ 拒（见 `validate.ts#missingFieldOf`）。
   * ★ `null` 也算缺 —— 本核只有一种"没有"的写法（`change_set.ts:314-316` 的 `strOrNull` 同口径：
   *   **不用 `String(x)`**，它会把 `undefined` 变成 `"undefined"`）。
   */
  required?: boolean;
  /** 允许值（给了就是**闭集**，值不在里面 ⇒ 拒） */
  values?: readonly string[];
  /** 数组最小长度（`type` 是数组时有效） */
  minItems?: number;
  /** 人读说明（渲染用，**不参与判定**） */
  desc?: string;
}

/**
 * **语义实体**的注册形状。
 *
 * ★ `semanticName` 是**任意名**：本核**不校验它的语义**（`#25` 原话「命名可以是任意的呀…
 *   命名成 `block_xyz` 只要声明了融合关系照样执行」）。名字是给 Agent / 人 / 日志用的，
 *   **身份由 `id` 承担**（名字改了，引用不断）。
 */
export interface EntityDef {
  /** 全局唯一（`validate.ts` G1）。引用一律按它，不按名字 */
  id: string;
  /** 语义名（任意，不校验语义；空串非法 —— 空名的实体在日志里读不出来） */
  semanticName: string;
  /** 实体种类（算子的 `inputs[].entityKind` 引它；包内自定值域，本核不收窄） */
  kind: string;
  /** 字段声明（形状校验的唯一依据） */
  fields?: readonly FieldSpec[];
  /** 自由元数据（v1 不校验内容，只要求可 JSON 序列化 —— `serialize.ts` 判） */
  attrs?: Record<string, unknown>;
}

/**
 * 判据的**执行档位**（★ 本核最有牙的一格）。
 *
 * · `declarative`：纯声明即可判（唯一性 / 引用 / 值域 / 环）——**核自己能判**；
 * · `geometry`：要几何内核才判得了（接缝不自交、版型可缝合…）⇒ 本核一律判 **`unsupported`**。
 *
 * ★ 为什么必须有这一格：`behavior_contract.ts:14-15` 写死过一条纪律 ——
 *   「**不许把"没判"写成 `true`**」。把几何判据写成 `declarative` 再放行 = 假绿；
 *   把它挡在门外（不注册）= 需求消失。⇒ 唯一诚实的做法是**登记它、并让它出口为 `unsupported`**。
 */
export type CriterionTier = 'declarative' | 'geometry';

/** 一条判据（形状 = `expectation.ts:177-197` 的 `run` 判据同构子集） */
export interface Criterion {
  id: string;
  tier: CriterionTier;
  /** 这条判据**为什么**应如此（说不出的不是判据，是"当前实现的副本" —— §9.5.2 原话） */
  why: string;
  /**
   * 卡在哪（`expectation.ts:183-189` 同一个字段）：有值 ⇒ 判 `unsupported`，**不去跑**。
   * ★ 值要具体（`'等 v2 几何内核'`），不许写 `'待定'` —— 那等于没写。
   */
  blocked_by?: string;
  /**
   * 纯声明判据的断言式（**不执行**，v1 只登记与展示；执行归 `validate.ts` 的 G 系列）。
   * ★ 刻意不在这里放 `expect` 求值：一旦求值就成了「跑任意代码」，那是另一张卡的事。
   */
  check?: string;
}

/**
 * **算子**的注册形状 —— 本核的一等公民。
 *
 * ★ 与 agent-io `ToolDef`（`application/types.ts:18-68`）**同范式、不同层**：
 *   `name` ↔ `name`、`why` ↔ `description`、`inputs` ↔ `inputSchema`、`outputs[].mutates` ↔ `writes`。
 *   ⇒ 这是**同一个范式在业务域的一条投影**，不是新造一套机制（也不 import 它：见文件头 ①）。
 */
export interface OperatorDef {
  /** 语义名（包内唯一；`name@version` 全局唯一 —— 版本链只增不删，见 G4） */
  name: string;
  /** 语义版本（正整数；`supersedes` 指向的旧版必须存在） */
  version: number;
  /** 一句话：这个算子做什么（人读；也是 `capability_map` 那类目录的来源） */
  intent: string;
  /** 输入实体契约（`entityKind` 必须在本注册表登记过 —— G5） */
  inputs: readonly OperatorInput[];
  /** 输出变更（**不存烘焙结果，只存声明**） */
  outputs: readonly OperatorOutput[];
  /** 判据 —— **空数组即拒**（G3） */
  criteria: readonly Criterion[];
  /** 被本版取代的旧版（版本链；旧版**不删**，保留回溯） */
  supersedes?: { name: string; version: number };
  /** 几何实现的引用位（v1 恒无；有值也不在本核里执行 —— 那是 v2 适配器） */
  geometryImplRef?: string;
  /** 可逆 / 幂等（↔ `ToolDef.annotations` 的 `destructiveHint` / `idempotentHint`） */
  annotations?: { reversible?: boolean; idempotent?: boolean };
}

/** 一个输入位：**按实体种类要一个实体 id**（不是按名字，也不内联实体本体） */
export interface OperatorInput {
  /** 这个输入在算子内部的名字（如 `a` / `b` / `piece`） */
  ref: string;
  /** 要哪种实体（必须在注册表登记过） */
  entityKind: string;
  required?: boolean;
}

/**
 * 一个输出变更。
 *
 * ★ `mutates` 两值是**语义分叉**，不是措辞（对应归档 `A3.4`「**算子存参数，不存烘焙网格；
 *   网格是即时求值产物，不做累积烘焙**」）：
 * · `declare` = 改**已有**实体上的声明（如对接口的 `matedPort` 互指）⇒ 可逆、可重算；
 * · `derive`  = 产出**新**引用（旧实体一个字不改）⇒ 不可回滚原件，因为原件没被动过。
 */
export interface OperatorOutput {
  /** 产出什么（人读的名字，如 `Seam` / `GradedPieceSet`） */
  produces: string;
  mutates: 'declare' | 'derive';
}

/** 一次算子调用的**记录**（这一条才是"可序列化"的对象；算子定义是注册数据，不是记录） */
export interface OperatorCall {
  /** 调的哪个算子（`name` + `version` 两格都写：版本链存在 ⇒ 只写名字读不出是哪一版） */
  op: string;
  version: number;
  /** 位置实参：每个输入位一个实体 id（顺序 = `OperatorDef.inputs` 的顺序） */
  args: readonly string[];
  /** 什么时候（ISO 串；空串非法 —— 没有时刻的记录无法审计） */
  at: string;
  /** 结果（人读/机读都可以；`null` = 还没跑） */
  result?: unknown;
}

/**
 * 一份**可序列化**的语义模型（往返无损的对象 —— 见 `serialize.ts`）。
 * 它就是"一个领域的全部实体 + 全部算子 + 调用流水"。
 */
export interface SemanticModel {
  /** 哪个领域包（`'toy'` / 某个业务域的名字…；空串非法） */
  profile: string;
  entities: readonly EntityDef[];
  operators: readonly OperatorDef[];
  calls?: readonly OperatorCall[];
}
