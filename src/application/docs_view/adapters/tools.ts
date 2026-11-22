/**
 * 适配器：工具注册表指针表（源 = `TOOL_DEFS` + `laneOfFromSources`，只读读端）。
 *
 * 纯清单/指针段（M8）：工具名 / 归属线 / 说明指针；不投影散文主张。
 * 归属由 LANE_SOURCES 派生（`laneOfFromSources`），不在本适配器存第二份线清单。
 */
import { TOOL_DEFS, laneOfFromSources } from '../../tool_registry.js';
import { LANE_IDS } from '../../meta/registry/lane_ids.js';
import { sha16Hex } from '../markers.js';
import type { AdapterSource, DocBlockAdapter, SourceItem } from '../types.js';

function sanitize(text: string): string {
  const flat = text.replace(/\r?\n/g, ' ').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
  // 指针段：只留首句前 96 字符，完整说明以 ToolDef.description 为权威（不整篇抄成第二真相）
  const firstSentence = flat.split(/(?<=。|；)/)[0] ?? flat;
  let out = firstSentence.length > 96 ? firstSentence.slice(0, 96) : firstSentence;
  // 剥掉截断残留的尾部孤括号与悬停标点（O2：trivial 清理，不留未闭合括号）
  out = out.trimEnd();
  while (/[（(]$/.test(out)) out = out.slice(0, -1).trimEnd();
  out = out.replace(/[：:、，,；;]\s*$/, '');
  return firstSentence.length > 96 ? `${out}…` : out;
}

function readTools(): AdapterSource {
  const laneOf = laneOfFromSources();
  const rows = TOOL_DEFS.map((d) => ({
    name: d.name,
    lane: laneOf[d.name]?.lane ?? '',
    description: sanitize(d.description),
  })).sort((a, b) => a.name.localeCompare(b.name));
  const items: SourceItem[] = rows.map((r) => ({
    id: r.name,
    labels: { lane: r.lane },
    detail: r.description,
  }));
  return {
    adapterId: 'index.tools',
    rev: sha16Hex(JSON.stringify(rows.map((r) => [r.name, r.lane]))),
    items,
    labelSets: { lane: [...LANE_IDS] },
    availability: { readable: true },
  };
}

function renderTools(source: AdapterSource): string {
  const rows = source.items.map((it) => `| \`${it.id}\` | ${it.labels.lane} | ${it.detail ?? ''} |`);
  return ['| 工具 | 线 | 说明 |', '|---|---|---|', ...rows].join('\n');
}

export const toolsAdapter: DocBlockAdapter = {
  id: 'index.tools',
  docRel: 'docs/INDEX.md',
  title: '工具注册表指针（投影自 TOOL_DEFS）',
  lifecycleStage: 'committed',
  read: readTools,
  render: renderTools,
};
