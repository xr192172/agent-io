/**
 * store.ts —— ingestion 切片的**唯一写端**（冻结企划 §3.2 单写者纪律 · §2.2 九态闸控）。
 *
 * ## 纪律
 * · **单写者**：store 构造时封一个写者身份；一切迁移 / 裁决落位 / 降级留痕只能经本写端，
 *   写者不符即拒；旁路直写权威被禁止（7.2.1 / 7.4.6）。
 * · **committed 闸**：只有 `adjudicated` 可落权威；`blocked` / `unknown` / 未验证一律拒绝（§2.2 / §9-7）。
 *   落 committed 还必须带完整 adjudication 回执（来源逐条点名）。
 * · **降级非绿**：语义路缺模型 ⇒ 响亮 `blocked/unsupported`，不 Noop 成功；非语义路缺外设 ⇒ 降级可见化留痕，
 *   不做权威判定（§2.3）。聚合门不得把 exit 0 当通过。
 * · **model-in-the-loop**：模型是语义翻译不可或缺环节；本 store 是受控表格 / 状态机，不替模型编候选，
 *   也不把模型产物直接当权威（候选经系统校验 + 裁决后才落位）。
 *
 * ## 边界（M11）
 * 本切片只覆盖本仓权威输入 / 投影文档 + 已合入外部任务卡文档 + 每日简报吸收管线 + provenance schema；
 * 跨项目 `import_project` / 未来 RAG / 外部 URL 批量抓取**不纳入**。
 */
import {
  canTransition,
  assertCommittable,
  type LifecycleState,
} from '../docs_view/lifecycle.js';
import {
  validateProvenance,
  validateAdjudication,
  rowFingerprint,
  type Provenance,
  type Adjudication,
} from './provenance.js';
import type {
  AbsorbedRecord,
  AbsorbedPayload,
  RecordCategory,
  TransitionEvent,
  DegradationNote,
} from './record.js';
import {
  evaluateRoad,
  type PipelineStep,
  type SemanticStep,
  type NonsemanticStep,
} from './roads.js';

/** 语义端口（可替换注入；domain 不绑实现）。`available=false` = 缺模型。 */
export interface SemanticPort {
  readonly available: boolean;
  /** 语义翻译 / 提取；返回候选主张。抛错 / 空候选 = 不产候选。 */
  translate(input: { recordId: string; raw: string }): Promise<{ claim: string }>;
}

export interface RegisterInput {
  id: string;
  category: RecordCategory;
  payload: AbsorbedPayload;
  provenance: Provenance;
}

export interface StoreClock {
  now: () => string;
}

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * ingestion 记录单写者。进程内唯一写路径；多实例不承诺互斥（同 graph_writer 先例：单写者是写端纪律，
 * 不是分布式锁）。
 */
export class IngestionStore {
  private readonly writer: string;
  private readonly clock: () => string;
  private readonly records = new Map<string, AbsorbedRecord>();

  constructor(writer: string, opts?: Partial<StoreClock>) {
    if (!nonEmpty(writer)) throw new Error('IngestionStore：写者身份为空（单写者必须署名）');
    this.writer = writer;
    this.clock = opts?.now ?? (() => new Date().toISOString());
  }

  /** 写者身份（只读披露；不允许换写者）。 */
  getWriter(): string {
    return this.writer;
  }

  private requireWriter(writer: string): void {
    if (writer !== this.writer) {
      throw new Error(
        `单写者闸：写者「${String(writer)}」与本 store 封写者「${this.writer}」不符 —— 旁路直写被禁止`,
      );
    }
  }

  private requireRecord(id: string): AbsorbedRecord {
    const rec = this.records.get(id);
    if (!rec) throw new Error(`ingestion 记录「${id}」不在册（先 register，不许凭空迁移）`);
    return rec;
  }

  private seal(rec: AbsorbedRecord): AbsorbedRecord {
    return {
      ...rec,
      row_fingerprint: rowFingerprint({
        provenance: rec.provenance,
        claim: rec.payload.claim,
        absorbed_as: rec.payload.absorbed_as,
      }),
    };
  }

  /** ① 系统切块与登记：外部原文切块，登记 source/hash/provenance，状态 = ingested；登记不构成理解。 */
  register(input: RegisterInput): AbsorbedRecord {
    this.requireWriter(input.provenance.writer);
    const provenance: Provenance = {
      ...input.provenance,
      captured_at: input.provenance.captured_at || this.clock(),
    };
    const check = validateProvenance(provenance);
    if (!check.ok) {
      throw new Error(`provenance 校验未过：${check.reasons.join('；')}`);
    }
    if (this.records.has(input.id)) {
      throw new Error(`ingestion 记录「${input.id}」已存在（id 不许覆盖；取代走迁移/归档留痕）`);
    }
    const at = this.clock();
    const rec: AbsorbedRecord = {
      id: input.id,
      category: input.category,
      state: 'ingested',
      payload: input.payload,
      provenance,
      trace: [{ at, from: 'ingested', to: 'ingested', reason: '切块登记', writer: provenance.writer }],
      degradations: [],
      row_fingerprint: '',
    };
    const sealed = this.seal(rec);
    this.records.set(rec.id, sealed);
    return sealed;
  }

  /** 系统结构校验：ingested → parsed（锚点 / 类型 / 字段完整性 / 冲突初筛；脏行进 dirty 报告，不进权威）。 */
  parse(id: string, reason: string, writer: string): AbsorbedRecord {
    return this.transition(id, 'parsed', reason, writer);
  }

  /** 裁决：blocked/translated → adjudicated；挂裁决回执（谁裁、按哪份口径、依据哪些一手来源）。 */
  adjudicate(id: string, adjudication: Adjudication, writer: string): AbsorbedRecord {
    this.requireWriter(writer);
    const rec = this.requireRecord(id);
    const check = validateAdjudication(adjudication);
    if (!check.ok) throw new Error(`裁决回执校验未过：${check.reasons.join('；')}`);
    const next = this.transition(id, 'adjudicated', `裁决落位：${adjudication.ruling_ref}`, writer);
    const updated: AbsorbedRecord = {
      ...next,
      provenance: { ...next.provenance, adjudication },
    };
    const sealed = this.seal(updated);
    this.records.set(sealed.id, sealed);
    return sealed;
  }

  /** ⑤ 落权威：adjudicated → committed（单写者唯一入口；不可判不得到此态）。 */
  commit(id: string, writer: string): AbsorbedRecord {
    this.requireWriter(writer);
    const rec = this.requireRecord(id);
    const gate = assertCommittable(rec.state);
    if (!gate.ok) throw new Error(`committed 闸拒绝：${gate.reason}`);
    const adj = validateAdjudication(rec.provenance.adjudication);
    if (!adj.ok) throw new Error(`committed 闸拒绝：${adj.reasons.join('；')}`);
    return this.transition(id, 'committed', '单写者落内部权威；回执写回', writer);
  }

  /** 归档：任意非 archived → archived（可重新导入但不等于重新采纳）。 */
  archive(id: string, reason: string, writer: string): AbsorbedRecord {
    return this.transition(id, 'archived', reason, writer);
  }

  /**
   * 通用迁移闸：边表来自 lifecycle.ts 唯一住处；非法边逐条点名。
   * 落到 committed 的二次闸在 `commit()`；这里只做边合法性。
   */
  transition(id: string, to: LifecycleState, reason: string, writer: string): AbsorbedRecord {
    this.requireWriter(writer);
    const rec = this.requireRecord(id);
    if (!nonEmpty(reason)) throw new Error(`迁移「${id} → ${to}」缺理由（无理由 = 悄悄改状态）`);
    if (!canTransition(rec.state, to)) {
      throw new Error(
        `状态机拒迁：「${id}」 ${rec.state} → ${to} 不在允许边表（九态边表唯一住处 = lifecycle.ts）`,
      );
    }
    const event: TransitionEvent = { at: this.clock(), from: rec.state, to, reason, writer };
    const next: AbsorbedRecord = { ...rec, state: to, trace: [...rec.trace, event] };
    const sealed = this.seal(next);
    this.records.set(sealed.id, sealed);
    return sealed;
  }

  /**
   * 语义路一步（模型不可或缺）。
   * · 端口缺模型 / 调用失败 / 解析失败 / 空候选 ⇒ 落 `blocked`（unsupported 口径），不 Noop 成功、不原文兜底；
   * · 成功 ⇒ `parsed → translated`，候选产物交系统校验 + 裁决，不直接成权威。
   */
  async runSemanticStep(
    id: string,
    step: SemanticStep,
    port: SemanticPort,
    writer: string,
  ): Promise<AbsorbedRecord> {
    this.requireWriter(writer);
    const rec = this.requireRecord(id);
    const ev = evaluateRoad(step, port.available);
    if (ev.outcome === 'blocked') {
      return this.transition(id, 'blocked', `语义路阻断（${step}）：${ev.reason}`, writer);
    }
    let candidate: { claim: string };
    try {
      candidate = await port.translate({ recordId: id, raw: rec.provenance.raw });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return this.transition(id, 'blocked', `语义路调用失败（${step}）：${detail}；不产候选`, writer);
    }
    if (!candidate || !nonEmpty(candidate.claim)) {
      return this.transition(id, 'blocked', `语义路解析失败 / 空候选（${step}）：不原文兜底假装已理解`, writer);
    }
    return this.transition(id, 'translated', `语义候选产出（${step}）；候选非权威，待系统校验 + 裁决`, writer);
  }

  /**
   * 非语义增强路一步（可降级可见化）。缺外设 ⇒ 追加一条降级留痕（显式状态 + reason），不改生命周期态、
   * 不做权威判定；外设可用 ⇒ 不留痕。
   */
  recordNonsemanticStep(
    id: string,
    step: NonsemanticStep,
    available: boolean,
    writer: string,
  ): AbsorbedRecord {
    this.requireWriter(writer);
    const rec = this.requireRecord(id);
    const ev = evaluateRoad(step, available);
    if (ev.outcome !== 'degraded-visible') return rec;
    const note: DegradationNote = {
      at: this.clock(),
      step,
      outcome: 'degraded-visible',
      reason: ev.reason,
      writer,
    };
    const next: AbsorbedRecord = { ...rec, degradations: [...rec.degradations, note] };
    const sealed = this.seal(next);
    this.records.set(sealed.id, sealed);
    return sealed;
  }

  get(id: string): AbsorbedRecord | undefined {
    return this.records.get(id);
  }

  list(): readonly AbsorbedRecord[] {
    return [...this.records.values()];
  }
}

/** 环节类型守卫导出（供调用方归类）。 */
export type { PipelineStep };
