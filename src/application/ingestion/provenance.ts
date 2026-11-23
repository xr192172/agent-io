/**
 * provenance.ts —— ingestion 切片的 **provenance schema 契约**（冻结企划 §2.5 · M3 一期立边界）。
 *
 * ## 它是什么
 * 每条被吸收的事实 / 意图 / 判据 / 任务卡候选，随行带来源 / 裁决 / 时间 / 写者与原始逐字片段；
 * 模型席位 / 版本 / 输入指纹同样落 provenance（§2.4 多模型席位）。系统动作（切块登记 / 校验 / 落权威）
 * 不调模型 ⇒ `model` 可为空。
 *
 * ## M3 分期口径（不提前承诺未做的装置）
 * · 一期立字段边界：`source_kind / source_ref / captured_at / source_fingerprint / 模型席位·版本·输入指纹 /
 *   adjudication / writer / raw`；
 * · **行级完整哈希与交叉核对列独立后续批次**（避开整份 doc_sha「改一字全行漂移」旧教训：全集不冒充个体）；
 *   本切片只给 `rawSha256`（逐字原文完整哈希）与 `rowFingerprint`（稳定字段规范化指纹，sha16 防意外漂移，
 *   不防恶意碰撞，同 `markers.ts` 先例），不自称已完成 M3 全量行级对账。
 *
 * ## 边界
 * · 本模块只管形状与校验，不含落盘写端；写端唯一住处 = `store.ts`（单写者）。
 * · 外部文本非权威：provenance 完整（来源 + 裁决回执）之前不得进 `committed`（见 store 闸）。
 */
import { createHash } from 'node:crypto';

/** 来源类别闭集（§2.5：外部散文 / 源码注释 / 引擎挂账；一期另收简报转述与内部裁决回执）。 */
export const SOURCE_KINDS = [
  '外部散文',
  '源码注释',
  '引擎挂账',
  '简报转述',
  '内部裁决',
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/** 模型席位记录（§2.4：翻译 / 整理 / 复核可异构；席位身份与版本进 provenance）。 */
export interface ModelSeat {
  /** 席位：translate / review / distill / …（可替换注入，不绑定具体模型） */
  seat: string;
  /** 模型版本标识 */
  version: string;
  /** 本次语义产物的输入指纹（输入片段 sha16） */
  input_fingerprint: string;
}

/** 裁决回执：谁、何时、按哪份口径、依据哪些一手来源。候选过门落权威前必须可读（§2.2 adjudicated 闸）。 */
export interface Adjudication {
  /** 裁决时刻（UTC ISO） */
  ruling_at: string;
  /** 裁决者：Main / 人 / 主控 */
  ruling_by: string;
  /** 裁决口径引用（如「Main 2026-11-23 裁决口径」） */
  ruling_ref: string;
  /** 一手来源 URL / 文档路径（逐条；简报转述不算一手依据） */
  basis: readonly string[];
  /** 裁决理由与边界说明 */
  note: string;
}

/** 一条吸收记录的 provenance 字段契约。 */
export interface Provenance {
  source_kind: SourceKind;
  /** 仓库相对路径或一手 URL */
  source_ref: string;
  /** 登记时刻（UTC ISO；系统切块登记时刻） */
  captured_at: string;
  /** 内容指纹（raw 的 sha16；可空 = 未采集） */
  source_fingerprint?: string;
  /** 模型席位；系统动作 / 无模型参与 ⇒ null */
  model?: ModelSeat | null;
  /** 裁决回执；未裁决候选留空，committed 闸强制补齐 */
  adjudication?: Adjudication;
  /** 写者身份（单写者署名） */
  writer: string;
  /** 原文逐字片段（raw 逐字保留；不去格式、不 unescape） */
  raw: string;
}

/** 校验结果：`ok=false` 时 `reasons` 逐条点名缺哪件，不许只抛「不合法」。 */
export interface ProvenanceCheck {
  ok: boolean;
  reasons: string[];
}

/** sha256 完整哈希（逐字原文用；M3 行级完整哈希分期位）。 */
export function rawSha256(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** sha16 指纹（防意外漂移 / 手改，不防恶意碰撞；同 markers.ts#sha16Hex 先例）。 */
export function sha16Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 校验 provenance 字段完整性。
 * · 必填：source_kind / source_ref / captured_at / writer / raw；
 * · `model` 若给对象，三键都必须非空；
 * · `adjudication` 不在此强制（未裁决候选允许停留 blocked/adjudicated 之前）；committed 闸另行校验。
 */
export function validateProvenance(p: Provenance): ProvenanceCheck {
  const reasons: string[] = [];
  if (!SOURCE_KINDS.includes(p.source_kind)) {
    reasons.push(`source_kind「${String(p.source_kind)}」不在闭集（${SOURCE_KINDS.join(' / ')}）`);
  }
  if (!nonEmptyString(p.source_ref)) reasons.push('source_ref 为空（URL 或仓库相对路径必填）');
  if (!nonEmptyString(p.captured_at)) reasons.push('captured_at 为空（UTC ISO 必填）');
  if (!nonEmptyString(p.writer)) reasons.push('writer 为空（写者身份必填）');
  if (!nonEmptyString(p.raw)) reasons.push('raw 为空（原文逐字片段必填，不得用占位文本顶替）');
  if (p.model) {
    const m = p.model;
    if (!nonEmptyString(m.seat)) reasons.push('model.seat 为空');
    if (!nonEmptyString(m.version)) reasons.push('model.version 为空');
    if (!nonEmptyString(m.input_fingerprint)) reasons.push('model.input_fingerprint 为空');
  }
  return { ok: reasons.length === 0, reasons };
}

/** 校验裁决回执完整性（committed 闸用）。 */
export function validateAdjudication(a: Adjudication | undefined): ProvenanceCheck {
  const reasons: string[] = [];
  if (!a) {
    reasons.push('缺 adjudication 回执：未裁决候选不得落 committed');
    return { ok: false, reasons };
  }
  if (!nonEmptyString(a.ruling_at)) reasons.push('adjudication.ruling_at 为空');
  if (!nonEmptyString(a.ruling_by)) reasons.push('adjudication.ruling_by 为空');
  if (!nonEmptyString(a.ruling_ref)) reasons.push('adjudication.ruling_ref 为空');
  if (!Array.isArray(a.basis) || a.basis.length === 0) {
    reasons.push('adjudication.basis 为空：committed 必须带一手来源逐条点名');
  } else if (a.basis.some((b) => !nonEmptyString(b))) {
    reasons.push('adjudication.basis 含空条目');
  }
  if (!nonEmptyString(a.note)) reasons.push('adjudication.note 为空');
  return { ok: reasons.length === 0, reasons };
}

/** 规范化 JSON（键递归排序）——指纹输入确定性，不渗本机态。 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * 行级稳定字段指纹（M3 分期：行级完整哈希与交叉核对列后续批次）。
 * 只盖 provenance + 主张稳定字段；raw 逐字片段另由 `rawSha256` 单列，不混在一个哈希里。
 */
export function rowFingerprint(input: {
  provenance: Provenance;
  claim: string;
  absorbed_as: string;
}): string {
  return sha16Hex(canonicalJson(input));
}
