/**
 * semantic_model/validate.ts —— **语义校验**（G1–G6，domain 层，**零 import**）。
 *
 * ## 与 `serialize.ts` 的分工（别混）
 * · `serialize.ts` 判**形状**：读不读得进来（键在不在、类型对不对、闭集值合不合法）；
 * · 本文件判**语义**：读得进来之后**自不自洽**（重名 / 悬空引用 / 空判据 / 断版本链 / 没登记的种类）。
 * ⇒ 两件事分开报：`SemanticShapeError` 是"读不进来"，本文件的 `Gap[]` 是"读进来了但不对"。
 *
 * ## 为什么每条 gap 都带 `key`（而不只是人读文本）
 * 本仓 `validator.ts:32-47` 的账：只给文本时，下游对账只能做**字符串差集** ⇒
 * 被引用方的名字一变（重命名），旧文本消失、新文本出现，被当成"本次新增的错"⇒ 误拦合法编辑。
 * ⇒ 键只认**位置/主体**（`entity:<id>` / `op:<name>@<ver>`），**不含被指向方的名字**。
 *
 * ## 六条（G 系列）与它们的出处
 * | # | 判什么 | 出处 |
 * |---|---|---|
 * | G1 | 实体 `id` 全局唯一；`semanticName` 任意但**非空**；同 id 的 `kind` 不许被两处声明 | 归档 `#25`「命名可以是任意的呀…命名成 `block_xyz` 只要声明了融合关系照样执行」+ 唯一性 = 引用可寻址的前提 |
 * | G2 | 引用必须可解析（`attrs` 里指向实体的引用也点名） | 本仓 `validator.ts:107-135` 的 `dangling_edge`/`anchor_broken` 同口径 |
 * | G3 | 算子 `criteria` **为空即拒** | `behavior_contract.ts:18-21`：`cases: []` 会被判 **pass** 的那次坑 |
 * | G4 | 版本链**只增不删**；`supersedes` 指向的旧版必须**真的在**；不许自指、不许超前 | 归档 `#27`「算子带**版本链**（…**旧算子不删，保留回溯**）」 |
 * | G5 | 算子 `inputs[].entityKind` 必须**在注册表里出现过** | `#27`「Agent 写算子（**输入/输出/约束/内部逻辑**）→ 提交 AgentIO 自动生成判据」 |
 * | G6 | 判据 `tier:'geometry'` 一律出口 **`unsupported`**，**不许当 pass** | `behavior_contract.ts:14-15`「**不许把"没判"写成 `true`**」 |
 */

import type { Criterion, EntityDef, OperatorDef, SemanticModel } from './types.js';

/**
 * 判据结论（**三态 + 一个"不知道"**）。
 * ★ `unsupported` 与 `pass` 是**两种东西**：前者是"这一条没判"，后者是"这一条判过了"。
 *   合并它们 = 让"检查对象退出检查范围"变成"检查通过"（AGENTS 收尾三问 ①）。
 */
export type CriterionVerdict = 'pass' | 'fail' | 'unsupported';

/** 一条语义 gap（`key` 稳定、`message` 人读） */
export interface Gap {
  /** 稳定键：只认位置/主体，**不含被指向方的名字** */
  key: string;
  /** 哪条规则（G1…G6）—— 便于反例逐条点名 */
  rule: 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
  message: string;
}

/** `null` / `undefined` / 非字符串 / 空串 ⇒ `null`（★ 不用 `String(x)`：它会把 `undefined` 变成 "undefined"） */
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** 人读标签：永远给得出，哪怕字段缺（报文里不许出现 `undefined`） */
function label(op: OperatorDef): string {
  const n = strOrNull(op?.name) ?? '?';
  const v = typeof op?.version === 'number' ? String(op.version) : '?';
  return `${n}@${v}`;
}

/**
 * **G1**：实体 id 唯一 + `semanticName` 非空 + `kind` 非空。
 * ★ 重复只报**一次**（报第二次出现的那一处）—— 报两次会让"重复了几个"读成"重复了两次"。
 */
export function g1EntityIdentity(entities: readonly EntityDef[]): Gap[] {
  const out: Gap[] = [];
  const seen = new Set<string>();
  entities.forEach((e, i) => {
    const id = strOrNull(e?.id);
    if (!id) {
      out.push({ key: `entity_at:${String(i)}`, rule: 'G1', message: `第 ${i + 1} 个实体没有 id —— 没有身份就无法被引用` });
      return;
    }
    if (seen.has(id)) {
      out.push({ key: `duplicate_entity:${id}`, rule: 'G1', message: `实体 id "${id}" 重复出现（身份必须唯一；第二次出现在第 ${i + 1} 个）` });
      return;
    }
    seen.add(id);
    // ★ semanticName 只要求"非空"，**不校验语义**（`#25`：名字是任意名）
    if (!strOrNull(e.semanticName)) {
      out.push({ key: `nameless_entity:${id}`, rule: 'G1', message: `实体 "${id}" 的 semanticName 是空的 —— 日志/回执里读不出它是谁（名字可任意，但不能没有）` });
    }
    if (!strOrNull(e.kind)) {
      out.push({ key: `kindless_entity:${id}`, rule: 'G1', message: `实体 "${id}" 没有 kind —— 算子按种类要输入，没种类的实体谁都不要` });
    }
  });
  return out;
}

/**
 * **G2**：`attrs` 里指向实体的引用必须可解析。
 *
 * 约定（本核唯一的引用语法，写在字段名之外以免与业务字段冲突）：
 * 形如 `{ ref: '<实体 id>' }` 的对象 = 一条实体引用。查不到 ⇒ 点名**引用方 + 断在哪一格**。
 * ★ 为什么不扫"任意字符串值像 id"：那会把一个恰好像 id 的业务值判成引用（误伤比漏防更坏，
 *   `expectation_kinds.ts:79-82` 同一条取舍）。
 */
export function g2EntityRefs(entities: readonly EntityDef[]): Gap[] {
  const out: Gap[] = [];
  const ids = new Set(entities.map((e) => strOrNull(e?.id)).filter((x): x is string => !!x));
  for (const e of entities) {
    const id = strOrNull(e?.id);
    if (!id) continue;
    const attrs = e.attrs;
    if (!attrs || typeof attrs !== 'object') continue;
    for (const [k, v] of Object.entries(attrs)) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const ref = (v as { ref?: unknown }).ref;
      const target = strOrNull(ref);
      if (!target) continue;
      if (!ids.has(target)) {
        out.push({ key: `dangling_entity_ref:${id}:${k}`, rule: 'G2', message: `实体 "${id}".attrs.${k} 指向 "${target}"，而注册表里没有这个 id` });
      }
    }
  }
  return out;
}

/**
 * **G3**：每个算子至少要有一条判据。
 * ★ 为什么是"写不进去"而不是"警告一下"：一条判据都没有的算子**承诺不了任何东西**，
 *   而它会在目录/能力表里和别的算子长得一模一样（`TOOL_ANNOTATIONS` 缺键即抛的同一条纪律，
 *   `tool_registry.ts:58-64`）。
 */
export function g3CriteriaPresent(operators: readonly OperatorDef[]): Gap[] {
  const out: Gap[] = [];
  for (const op of operators) {
    const cs = Array.isArray(op?.criteria) ? op.criteria : [];
    if (cs.length === 0) {
      out.push({
        key: `no_criteria:${label(op)}`,
        rule: 'G3',
        message: `算子 "${label(op)}" 一条判据都没有 —— 没判据的算子说不出"什么算做对了"，不许注册`,
      });
    }
    // 同一条判据 id 在一个算子内重复 ⇒ 台账里两条判据分不开
    const seen = new Set<string>();
    for (const c of cs) {
      const cid = strOrNull(c?.id);
      if (!cid) {
        out.push({ key: `criteria_no_id:${label(op)}`, rule: 'G3', message: `算子 "${label(op)}" 有一条判据没有 id —— 回执里无法逐条点名` });
        continue;
      }
      if (seen.has(cid)) out.push({ key: `duplicate_criteria:${label(op)}:${cid}`, rule: 'G3', message: `算子 "${label(op)}" 的判据 id "${cid}" 重复` });
      seen.add(cid);
      if (!strOrNull(c?.why)) {
        out.push({ key: `criteria_no_why:${label(op)}:${cid}`, rule: 'G3', message: `算子 "${label(op)}" 的判据 "${cid}" 没有 why —— 说不出"为什么应如此"的不是判据，是"当前实现的副本"（§9.5.2）` });
      }
    }
  }
  return out;
}

/**
 * **G4**：版本链只增不删。
 * 三条：① `supersedes` 指向的 `name@version` 必须存在；② 不许自指（`@自己`）；
 * ③ 被取代的版本必须**更小**（版本链是有向的，指向未来 = 链是断的）。
 */
export function g4VersionChain(operators: readonly OperatorDef[]): Gap[] {
  const out: Gap[] = [];
  const have = new Set(operators.map((o) => label(o)));
  for (const op of operators) {
    const sup = op?.supersedes;
    if (!sup) continue;
    const oldKey = `${strOrNull(sup.name) ?? '?'}@${typeof sup.version === 'number' ? String(sup.version) : '?'}`;
    if (oldKey === label(op)) {
      out.push({ key: `self_supersede:${label(op)}`, rule: 'G4', message: `算子 "${label(op)}" 的 supersedes 指向自己 —— 版本链必须指向旧版` });
      continue;
    }
    if (!have.has(oldKey)) {
      out.push({ key: `broken_chain:${label(op)}`, rule: 'G4', message: `算子 "${label(op)}" 声称取代 "${oldKey}"，而它不在注册表里（旧算子不删 —— 删了就没有回溯）` });
      continue;
    }
    if (typeof sup.version === 'number' && typeof op.version === 'number' && sup.version >= op.version) {
      out.push({ key: `forward_chain:${label(op)}`, rule: 'G4', message: `算子 "${label(op)}" 取代的版本 ${String(sup.version)} 不小于自己 —— 版本链只能指向更旧的那一版` });
    }
  }
  return out;
}

/** **G5**：算子的输入种类必须在本模型里注册过（"没人声明的实体种类"= 算子在对空气提要求） */
export function g5InputKinds(entities: readonly EntityDef[], operators: readonly OperatorDef[]): Gap[] {
  const out: Gap[] = [];
  const kinds = new Set(entities.map((e) => strOrNull(e?.kind)).filter((x): x is string => !!x));
  for (const op of operators) {
    for (const inp of op?.inputs ?? []) {
      const kind = strOrNull(inp?.entityKind);
      if (kind && !kinds.has(kind)) {
        out.push({ key: `unknown_kind:${label(op)}:${strOrNull(inp?.ref) ?? '?'}`, rule: 'G5', message: `算子 "${label(op)}" 的输入位 "${strOrNull(inp?.ref) ?? '?'}" 要实体种类 "${kind}"，而本模型里没有任何实体是那个种类` });
      }
    }
  }
  return out;
}

/**
 * **G6**：把一条判据**判成结论**（本核唯一的口径）。
 *
 * 顺序（每一步都要判，别 early return 成"全绿"）：
 * ① `blocked_by` 有值 ⇒ `unsupported`（卡在哪要说清，`expectation.ts:183-189` 同字段）；
 * ② `tier === 'geometry'` ⇒ `unsupported`（要几何内核，v1 判不了）；
 * ③ `tier === 'declarative'` 且**给了 check** ⇒ `pass`（**声明已登记**，不是"行为已验"）；
 * ④ 其余 ⇒ `unsupported`（比如 declarative 却既没 check 也没 blocked_by：说不清拿什么判）。
 *
 * ★ 为什么 declarative 的也算 `pass` 而不是 `unsupported`：本核能判的**恰好就是**"这条声明在不在、
 *   说不说得清"；真正的行为验证由 `docs/` 下的判据底稿交给 agent-io 的 behavior-cases 去跑。
 *   ⇒ 这里 `pass` 的含义写死为**「声明完整」**，不许被读成「行为已验证」。
 */
export function g6CriterionVerdict(c: Criterion): CriterionVerdict {
  if (strOrNull(c?.blocked_by)) return 'unsupported';
  if (c?.tier === 'geometry') return 'unsupported';
  if (c?.tier === 'declarative' && strOrNull(c.check)) return 'pass';
  return 'unsupported';
}

/** 一个算子的判据总账（**带分母**：`checked` 是判了结论的，`unsupported` 是没判的） */
export interface CriteriaTally {
  total: number;
  pass: number;
  fail: number;
  unsupported: number;
}

/** 逐算子记账（★ 只回读数；"通不通过"由 G3 + 上面的 gap 决定，不用读数替代） */
export function criteriaTally(operators: readonly OperatorDef[]): Record<string, CriteriaTally> {
  const out: Record<string, CriteriaTally> = {};
  for (const op of operators) {
    const t: CriteriaTally = { total: 0, pass: 0, fail: 0, unsupported: 0 };
    for (const c of op?.criteria ?? []) {
      t.total += 1;
      const v = g6CriterionVerdict(c);
      if (v === 'pass') t.pass += 1;
      else if (v === 'fail') t.fail += 1;
      else t.unsupported += 1;
    }
    out[label(op)] = t;
  }
  return out;
}

/**
 * **全模型语义体检**（G1–G5 逐条跑 + 去重）。G6 不是"gap"，它是**结论口径**，故不在这里产出 gap
 * —— 把"没判"当成"错"会让几何判据永远红，然后把整条判据删掉（`behavior_contract.ts:26` 的原话：
 *   恒红比假绿更坏）。
 */
export function validateModel(model: SemanticModel): Gap[] {
  const entities = Array.isArray(model?.entities) ? model.entities : [];
  const operators = Array.isArray(model?.operators) ? model.operators : [];
  const gaps = [...g1EntityIdentity(entities), ...g2EntityRefs(entities), ...g3CriteriaPresent(operators), ...g4VersionChain(operators), ...g5InputKinds(entities, operators)];
  // 同一把尺可能被两条规则各报一次（极少见但可能），按 key 去重保序
  const seen = new Set<string>();
  return gaps.filter((g) => (seen.has(g.key) ? false : (seen.add(g.key), true)));
}

/**
 * 语义是否自洽（**唯一的对外布尔**）。
 * ★ 只回答"有没有 gap"，不回答"算子的行为对不对" —— 后者是判据的事（G6 + 判据底稿）。
 */
export function isModelConsistent(model: SemanticModel): boolean {
  return validateModel(model).length === 0;
}
