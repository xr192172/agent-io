/**
 * 适配器契约与块核类型（终局形状；后续规范源吸收适配器只加条目，不改本契约）。
 *
 * ## 契约边界
 * · `read(root)` 对接既有只读读端，不新写 SQL、不重解析 DSL；读不到 ⇒ `availability.readable=false`，
 *   由块核落 `unjudgeable` / `render-failed`，不固化空快照 / 一致文本（§4.2）。
 * · `render(source)` 纯函数，确定性（不渗本机态/时区；日期 UTC；同输入两次逐字节相同，§4.1）。
 * · `selfCheck(source, body)` 走**独立注册表实体**现算（M12），禁止与生成函数同体重算。
 * · 适配器 `lifecycleStage` 标注源所处生命周期态：本批投影源均为 `committed` 内部权威；
 *   后续规范源吸收适配器可携带 ingested/parsed/… 轨迹，契约位已预留（§2.2）。
 */
import type { LifecycleState } from './lifecycle.js';

/** 渲染条目：稳定 id + 标签 + 可选细节（M7：锚点用稳定 id / 路径，禁节号行号） */
export interface SourceItem {
  id: string;
  labels: Record<string, string | string[]>;
  detail?: string;
}

/** 适配器读端产出的权威快照（rev/items/闭集/可用读数） */
export interface AdapterSource {
  adapterId: string;
  /** 权威内容派生 rev（hash 或 HEAD rev）；新鲜度比对键 */
  rev: string;
  items: SourceItem[];
  /** 标签闭集：key=标签名，value=允许取值；渲染标签必须 ∈ 闭集（M12） */
  labelSets: Record<string, readonly string[]>;
  availability: {
    readable: boolean;
    reason?: string;
    /** 引擎/读端缺席（非语义路可降级场景）；降级态必须非绿可见化 */
    engineAbsent?: boolean;
  };
  /** 权威快照指纹（用于 stale 比对；可空 = 读端不提供） */
  snapshot?: string;
}

/** 自洽断言结果（M12：计数==源集合长度；标签∈闭集；失败同列非绿） */
export interface SelfCheckResult {
  ok: boolean;
  violations: string[];
  renderedCount: number;
  sourceCount: number;
}

export interface RenderedBlock {
  blockId: string;
  docRel: string;
  header: string;
  body: string;
  footer: string;
  /** 完整块文本（header + body + footer） */
  blockText: string;
  source: AdapterSource;
  selfCheck: SelfCheckResult;
}

/** 适配器注册表条目契约（可容纳后续规范源吸收适配器） */
export interface DocBlockAdapter {
  id: string;
  /** 目标文档仓库相对路径 */
  docRel: string;
  title: string;
  /** 源生命周期态；本批 = committed；A 段预留位见 lifecycle.ts */
  lifecycleStage: LifecycleState;
  read(root: string): AdapterSource;
  render(source: AdapterSource): string;
  /** 独立实体现算的自洽断言（M12）；缺省 = 计数 + 标签闭集通用校验 */
  selfCheck?(source: AdapterSource, body: string): SelfCheckResult;
}

/** 投影对账七态（§4.4，复用台账形状） */
export const RECON_STATES = [
  'current',
  'stale',
  'hand-edited',
  'missing',
  'unjudgeable',
  'render-failed',
  'degraded-current',
] as const;

export type ReconState = (typeof RECON_STATES)[number];

export interface BlockCheck {
  blockId: string;
  docRel: string;
  state: ReconState;
  rev: string;
  reasons: string[];
  /** 0=current；3=stale/missing；1=判定/生成/自洽/降级未验坏了（非绿） */
  exitCode: 0 | 1 | 3;
}

/** 块核聚合结果 */
export interface DocsCheckResult {
  blocks: BlockCheck[];
  exitCode: 0 | 1 | 3;
  green: boolean;
  degraded: BlockCheck[];
}
