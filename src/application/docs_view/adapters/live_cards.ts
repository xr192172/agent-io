/**
 * 适配器：活卡 top-N（源 = `task_history#listLiveCards`，只读）。
 *
 * 纯清单段（M8）：在册 todo 卡 id / feature / 状态 / 更新时刻，取前 N 张；不投影散文叙述。
 *
 * ## 活卡口径（Main 裁决 2，与台账当前性同一把尺）
 * 活卡 = `open`（`!isClosedTaskState(state)`，即 candidate/claimed）∧ 未被取代。
 * done/void/被取代的卡不进当前视图；历史走台账（ledger_rows / task_history）与归档视图，不在此投影。
 *
 * ## 取代 join（批 2 补全）
 * 取代指针读 `ledger_rows.superseded_by IS NOT NULL` 的 ref_id 集合，与活卡按**同一性键**
 * `card.id === ref_id` 匹配；不做路径/子串模糊匹配（防误剔现行卡）。
 *
 * ★ 口径事实（只读探针实测，2026-11-23）：
 * · `ledger_rows.superseded_by` 管的是**台账判据/挂账行**的当前性（active 行被新行取代），
 *   与 `live_cards` todo 卡是两类实体；当前 schema 两表无共享业务键（ref_id 前缀 `T-#`/`R…`，
 *   卡 id 前缀 `todo_`/`file_`，实测 0 交集；当前被取代台账行 0 条）⇒ 身份 join 在现数据上为惰性空集，
 *   前向兼容：日后台账行 ref_id 与卡 id 同号时即生效。
 * · 卡层「带异议接管」关系在 `discussion.supersedes`（against=对端卡 id），不属本适配器；
 *   若后续要按接管关系过滤，另立 discussion 读端，不在此造第二份映射。
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

/** 读台账被取代行 ref_id 集合（只读）；台账读不到 ⇒ 空集 + 原因（join 跳过，不静默） */
function readSupersededRefs(root: string): { refs: Set<string>; unavailable?: string } {
  const opened = openTasksDbForRead(root, 'ledger_rows');
  if ('skip' in opened) {
    return { refs: new Set(), unavailable: `台账读端不可用（${opened.skip}）：${opened.file}` };
  }
  const db = opened.db;
  try {
    const rows = db
      .prepare('SELECT ref_id FROM ledger_rows WHERE superseded_by IS NOT NULL')
      .all() as Array<{ ref_id: string }>;
    return { refs: new Set(rows.map((r) => r.ref_id)) };
  } finally {
    db.close();
  }
}

function isOpenCard(
  c: { id: string; state: string; card: Record<string, unknown> | null },
  supersededRefs: Set<string>,
): boolean {
  if (isClosedTaskState(c.state as TaskState)) return false;
  const supersededBy = c.card?.superseded_by;
  if (supersededBy !== undefined && supersededBy !== null && supersededBy !== '') return false;
  if (supersededRefs.has(c.id)) return false;
  return true;
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
  const { refs: supersededRefs, unavailable: ledgerUnavailable } = readSupersededRefs(root);
  const open = hits.filter((c) => isOpenCard(c, supersededRefs));
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
    availability: { readable: true, reason: ledgerUnavailable },
    snapshot: sha16Hex(JSON.stringify(hits.map((c) => [c.id, c.state, c.updated_at]).sort())),
  };
}

function renderLiveCards(source: AdapterSource): string {
  const rows = source.items.map(
    (it) => `| \`${it.id}\` | ${it.labels.feature} | ${it.labels.state} | ${it.detail ?? ''} |`,
  );
  const body = ['| 卡 | feature | 状态 | 更新时刻 |', '|---|---|---|---|', ...rows].join('\n');
  const note = '活卡 = open（candidate/claimed）∧ 未被取代（台账 superseded_by 身份 join）；done/void/被取代见台账与归档视图。';
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
