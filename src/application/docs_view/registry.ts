/**
 * 适配器注册表（§4.2 · Main 约束 2/3）。
 *
 * · 表驱动：block-id → { 源读端, rev 取法, 渲染函数 }；后续批只加适配器条目，不改内核。
 * · 投影条目同源落账到权威输入源登记（`authority_sources.ts`），与「人写权威输入 / 归档」区分。
 * · 适配器契约已预留后续规范源吸收适配器位（lifecycleStage / availability / selfCheck）；
 *   A 段 model-in-the-loop 管线本批不施工。
 */
import { gatesAdapter } from './adapters/gates.js';
import { toolsAdapter } from './adapters/tools.js';
import { liveCardsAdapter } from './adapters/live_cards.js';
import { registerProjectionSource, type AuthoritySourceEntry } from './authority_sources.js';
import type { DocBlockAdapter } from './types.js';

export const ADAPTERS: readonly DocBlockAdapter[] = [gatesAdapter, toolsAdapter, liveCardsAdapter];

const byId = new Map<string, DocBlockAdapter>(ADAPTERS.map((a) => [a.id, a]));

export function listAdapters(): DocBlockAdapter[] {
  return [...ADAPTERS];
}

export function getAdapter(id: string): DocBlockAdapter | undefined {
  return byId.get(id);
}

/** 投影条目落账（权威地图区分：projection 可再生；authority-input 不可再生） */
function registerProjectionEntries(): void {
  for (const a of ADAPTERS) {
    const entry: AuthoritySourceEntry = {
      id: `projection:${a.id}`,
      kind: 'projection',
      path: a.docRel,
      owner: 'docs-view-kernel',
      state: 'projected',
      regenerable: true,
      provenance: { source_kind: '内部权威机械投影', source_ref: a.id },
      note: `块 ${a.id}：从内部权威只读端确定性再生；手改生成区由 check 判 hand-edited。`,
    };
    registerProjectionSource(entry);
  }
}

registerProjectionEntries();
