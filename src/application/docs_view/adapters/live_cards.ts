/**
 * 适配器：活卡 top-N（源 = `task_history#listLiveCards`，只读）。
 *
 * 纯清单段（M8）：在册 todo 卡 id / feature / 状态 / 更新时刻，取前 N 张；不投影散文叙述。
 *
 * ## 活卡口径（Main 裁决 2，与台账当前性同一把尺）
 * 活卡 = `open`（`!isClosedTaskState(state)`，即 candidate/claimed）∧ 未被取代（`card.superseded_by` 为空）。
 * done/void/被取代的卡不进当前视图；历史走台账（ledger_rows / task_history）与归档视图，不在此投影。
 *
 * 读数口径对齐 §5.1：读不到 ≠ 没有 —— `unreachable` 落「判不了」，
 * `no-db` / `no-table` 才是真无行（§0.12 两类分开，不固化空快照冒充可用）。
 */
import { openTasksDbForRead, listLiveCards } from '../../../infrastructure/task_history.js';
import {
  TASK_STATES,
  LEGACY_TASK_STATES,
  isClosedTaskState,
  type TaskState,
} from '../../../domain/task_schema.js';
import { sha16Hex } from '../markers.js';
import type { AdapterSource, DocBlockAdapter, SourceItem } from '../types.js';

const TOP_N = 10;
const STATE_CLOSED = [...TASK_STATES, ...LEGACY_TASK_STATES] as const;

function isOpenCard(c: { state: string; card: Record<string, unknown> | null }): boolean {
  if (isClosedTaskState(c.state as TaskState)) return false;
  const supersededBy = c.card?.superseded_by;
  return supersededBy === undefined || supersededBy === null || supersededBy === '';
}

function readLiveCards(root: string): AdapterSource {
  const opened = openTasksDbForRead(root, 'live_cards');
  if ('skip' in opened) {
    const readUnavailable = opened.skip === 'unreachable';
    return {
      adapterId: 'dev.live-cards',
      rev: '',
      items: [],
      labelSets: { state: [...STATE_CLOSED] },
      availability: {
        readable: !readUnavailable,
        reason: readUnavailable ? `活卡读端不可用（${opened.skip}）：${opened.file}` : undefined,
        engineAbsent: readUnavailable,
      },
    };
  }
  const hits = listLiveCards(root);
  const open = hits.filter(isOpenCard);
  const top = [...open]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : a.id.localeCompare(b.id)))
    .slice(0, TOP_N);
  const items: SourceItem[] = top.map((c) => ({
    id: c.id,
    labels: { feature: c.feature, state: c.state },
    detail: c.updated_at,
  }));
  return {
    adapterId: 'dev.live-cards',
    rev: sha16Hex(JSON.stringify(top.map((c) => [c.id, c.state, c.updated_at]))),
    items,
    labelSets: { state: [...STATE_CLOSED] },
    availability: { readable: true },
    snapshot: sha16Hex(JSON.stringify(hits.map((c) => [c.id, c.state, c.updated_at]).sort())),
  };
}

function renderLiveCards(source: AdapterSource): string {
  const rows = source.items.map(
    (it) => `| \`${it.id}\` | ${it.labels.feature} | ${it.labels.state} | ${it.detail ?? ''} |`,
  );
  const body = ['| 卡 | feature | 状态 | 更新时刻 |', '|---|---|---|---|', ...rows].join('\n');
  const note = '活卡 = open（candidate/claimed）∧ 未被取代；done/void/被取代见台账与归档视图。';
  return source.items.length === 0 ? `${body}\n\n（当前无在册活卡）\n\n${note}` : `${body}\n\n${note}`;
}

export const liveCardsAdapter: DocBlockAdapter = {
  id: 'dev.live-cards',
  docRel: 'docs/DEVELOPMENT.md',
  title: '在册活卡 top-N（投影自 live_cards；open ∧ 未被取代）',
  lifecycleStage: 'committed',
  read: readLiveCards,
  render: renderLiveCards,
};
