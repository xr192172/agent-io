/**
 * 既有裸奔对账（批 3 · G3）：`tasks.db` 权威行 ↔ `tasks.jsonl` 镜像只读比较器。
 *
 * ## 治哪个洞
 * `tasks.jsonl` 是 `tasks.db` 的**投影**（不是第二份权威；权威永远是库）。此前镜像由
 * `task_history#exportTasksJsonl` 导出，失败只 `stderr` 告警并 `return null`，不影响主写 ——
 * 镜像静默落后 / 缺行 / 多行 / 字段漂移时，**没有任何机器会发现**。本比较器把这条现状变成一道
 * 可判的对账：库两侧（`live_cards` ∪ `task_history`）逐行对镜像，分叉即点名。
 *
 * ## 口径（终局形状 · fail-closed）
 * · **只读**：不建库 / 不建表 / 不写镜像；读端唯一入口 `openTasksDbForRead`（skip 三态分开）。
 * · 键：活卡 `feature ⟂ id`；历史 `feature ⟂ id ⟂ moved_at`（历史 append-only，同 id 可多行）。
 * · 比较字段：活卡 `feature/id/state/card/updated_at`；历史 `feature/id/node_id/state/summary/moved_at/reason`
 *   （`card_json` 不进镜像，历史行不比对卡体）。
 * · 不可判 ≠ 绿：库读端 `unreachable` ⇒ `unavailable`（退出 2），不折成 0；`no-db` / `no-table`
 *   是真无行（库侧 0 行），镜像侧非空 ⇒ 多行分叉红。
 * · 镜像坏行（JSON 解析失败）/ 未知 `kind` ⇒ 分叉点名，不静默跳过。
 *
 * ## 边界（0.17①）
 * · 本比较器只对账**镜像与库的一致**；不判卡本身该不该在（那是 cardLivesOf / 批 16 收敛的口径）。
 * · 镜像导出失败的根因（写盘失败 / 库读不到）不在此重写；本门只保证「导出结果与库不一致」必被抓住。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  getTasksDbFile,
  getTasksJsonlFile,
  listLiveCards,
  openTasksDbForRead,
} from '../../../infrastructure/task_history.js';

/** 一条分叉点名（缺行 / 多行 / 字段不一致 / 坏行 / 未知 kind） */
export interface MirrorMismatch {
  /** 对账键（活卡 `feature⟂id`；历史 `feature⟂id⟂moved_at`；坏行为行号） */
  key: string;
  kind: 'missing-in-mirror' | 'extra-in-mirror' | 'field-mismatch' | 'bad-line' | 'unknown-kind';
  /** 人读细节：两侧值 / 原因 */
  detail: string;
}

/** 单侧（活卡 / 历史）对账结果 */
export interface MirrorSideReport {
  dbRows: number;
  mirrorRows: number;
  missing: MirrorMismatch[];
  extra: MirrorMismatch[];
  mismatches: MirrorMismatch[];
}

export interface TasksMirrorReport {
  /** `ok` 两侧一致 · `diverged` 有分叉 · `unavailable` 库读端不可判（不折绿） */
  status: 'ok' | 'diverged' | 'unavailable';
  /** unavailable 原因（原样可贴回执）；ok/diverged 为空 */
  reason?: string;
  dbFile: string;
  mirrorFile: string;
  live: MirrorSideReport;
  history: MirrorSideReport;
  badLines: MirrorMismatch[];
}

const SEP = '⟂';

/** 规范化 JSON（键排序）⇒ 深相等只比字符串；`card` 对象键序不影响判定 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const obj = value as Record<string, unknown>;
  return '{' + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

function emptySide(): MirrorSideReport {
  return { dbRows: 0, mirrorRows: 0, missing: [], extra: [], mismatches: [] };
}

interface MirrorRow {
  kind: string;
  feature?: unknown;
  id?: unknown;
  state?: unknown;
  card?: unknown;
  updated_at?: unknown;
  node_id?: unknown;
  summary?: unknown;
  moved_at?: unknown;
  reason?: unknown;
}

/** 读镜像文件：缺文件 ⇒ `{ rows: [], missing: true }`；坏行进 `badLines` 不抛 */
function readMirror(file: string): { rows: MirrorRow[]; badLines: MirrorMismatch[]; missing: boolean } {
  if (!fs.existsSync(file)) return { rows: [], badLines: [], missing: true };
  const text = fs.readFileSync(file, 'utf-8');
  const raw = text.split(/\r?\n/);
  // 导出末尾带一个换行 ⇒ 末段空串是换行符产物，不是空行
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop();
  const rows: MirrorRow[] = [];
  const badLines: MirrorMismatch[] = [];
  raw.forEach((line, i) => {
    if (line.trim() === '') return;
    try {
      rows.push(JSON.parse(line) as MirrorRow);
    } catch (e) {
      badLines.push({
        key: `line:${i + 1}`,
        kind: 'bad-line',
        detail: `镜像第 ${i + 1} 行 JSON 解析失败：${String(e).slice(0, 120)}`,
      });
    }
  });
  return { rows, badLines, missing: false };
}

/** 逐字段比对一行；返回首个不一致字段的点名（全一致 ⇒ null） */
function diffRow(expected: Record<string, unknown>, actual: Record<string, unknown>, fields: string[]): string | null {
  for (const f of fields) {
    const a = expected[f] ?? null;
    const b = actual[f] ?? null;
    if (canonical(a) !== canonical(b)) {
      return `${f}: 库=${canonical(a).slice(0, 120)} 镜像=${canonical(b).slice(0, 120)}`;
    }
  }
  return null;
}

/**
 * 对账 `tasks.db`（权威）vs `tasks.jsonl`（镜像）。纯只读；不触发导出、不写任何文件。
 */
export function reconcileTasksMirror(projectRoot: string): TasksMirrorReport {
  const dbFile = getTasksDbFile(projectRoot);
  const mirrorFile = getTasksJsonlFile(projectRoot);
  const live = emptySide();
  const history = emptySide();
  const badLines: MirrorMismatch[] = [];

  // ── 库侧：活卡（listLiveCards 已解析 card；坏 card_json ⇒ null，与镜像同口径） ──
  const liveOpened = openTasksDbForRead(projectRoot, 'live_cards');
  if ('skip' in liveOpened && liveOpened.skip === 'unreachable') {
    return { status: 'unavailable', reason: `活卡读端不可用（unreachable）：${liveOpened.file}`, dbFile, mirrorFile, live, history, badLines };
  }
  const liveDb = 'skip' in liveOpened ? [] : listLiveCards(projectRoot);
  live.dbRows = liveDb.length;

  // ── 库侧：历史（与导出同一 SELECT 口径；只读） ──
  const histOpened = openTasksDbForRead(projectRoot, 'task_history');
  if ('skip' in histOpened && histOpened.skip === 'unreachable') {
    return { status: 'unavailable', reason: `历史读端不可用（unreachable）：${histOpened.file}`, dbFile, mirrorFile, live, history, badLines };
  }
  interface HistRow {
    feature: string;
    id: string;
    node_id: string | null;
    state: string;
    summary: string;
    moved_at: string;
    reason: string;
  }
  let histDb: HistRow[] = [];
  if ('db' in histOpened) {
    try {
      histDb = histOpened.db
        .prepare('SELECT feature, id, node_id, state, summary, moved_at, reason FROM task_history ORDER BY feature, moved_at, id')
        .all() as unknown as HistRow[];
    } finally {
      histOpened.db.close();
    }
  }
  history.dbRows = histDb.length;

  // ── 镜像侧 ──
  const { rows: mirrorRows, badLines: mirrorBad, missing: mirrorMissing } = readMirror(mirrorFile);
  badLines.push(...mirrorBad);

  const mirrorLive = new Map<string, MirrorRow>();
  const mirrorHist = new Map<string, MirrorRow>();
  for (const row of mirrorRows) {
    if (row.kind === 'live') {
      mirrorLive.set(`${row.feature ?? ''}${SEP}${row.id ?? ''}`, row);
    } else if (row.kind === 'history') {
      mirrorHist.set(`${row.feature ?? ''}${SEP}${row.id ?? ''}${SEP}${row.moved_at ?? ''}`, row);
    } else {
      badLines.push({
        key: `${row.feature ?? ''}${SEP}${row.id ?? ''}`,
        kind: 'unknown-kind',
        detail: `镜像行 kind=${String(row.kind)}（只认 live / history）`,
      });
    }
  }
  live.mirrorRows = mirrorLive.size;
  history.mirrorRows = mirrorHist.size;

  // ── 活卡：库 ⇒ 镜像 ──
  const liveFields = ['feature', 'id', 'state', 'card', 'updated_at'];
  for (const c of liveDb) {
    const key = `${c.feature}${SEP}${c.id}`;
    const expected: Record<string, unknown> = {
      kind: 'live',
      feature: c.feature,
      id: c.id,
      state: c.state,
      card: c.card ?? null,
      updated_at: c.updated_at,
    };
    const m = mirrorLive.get(key);
    if (!m) {
      live.missing.push({ key, kind: 'missing-in-mirror', detail: `库有活卡，镜像缺行：${canonical(expected).slice(0, 160)}` });
      continue;
    }
    mirrorLive.delete(key);
    const diff = diffRow(expected, m as unknown as Record<string, unknown>, liveFields);
    if (diff) live.mismatches.push({ key, kind: 'field-mismatch', detail: diff });
  }
  for (const [key, m] of mirrorLive) {
    live.extra.push({ key, kind: 'extra-in-mirror', detail: `镜像有活卡，库无此行：${canonical(m).slice(0, 160)}` });
  }

  // ── 历史：库 ⇒ 镜像 ──
  const histFields = ['feature', 'id', 'node_id', 'state', 'summary', 'moved_at', 'reason'];
  for (const h of histDb) {
    const key = `${h.feature}${SEP}${h.id}${SEP}${h.moved_at}`;
    const expected: Record<string, unknown> = {
      kind: 'history',
      feature: h.feature,
      id: h.id,
      node_id: h.node_id,
      state: h.state,
      summary: h.summary,
      moved_at: h.moved_at,
      reason: h.reason,
    };
    const m = mirrorHist.get(key);
    if (!m) {
      history.missing.push({ key, kind: 'missing-in-mirror', detail: `库有历史行，镜像缺行：${canonical(expected).slice(0, 160)}` });
      continue;
    }
    mirrorHist.delete(key);
    const diff = diffRow(expected, m as unknown as Record<string, unknown>, histFields);
    if (diff) history.mismatches.push({ key, kind: 'field-mismatch', detail: diff });
  }
  for (const [key, m] of mirrorHist) {
    history.extra.push({ key, kind: 'extra-in-mirror', detail: `镜像有历史行，库无此行：${canonical(m).slice(0, 160)}` });
  }

  // 镜像文件整体缺失：库侧有行 ⇒ 缺镜像（分叉）；两侧皆空 ⇒ 一致
  if (mirrorMissing && live.dbRows === 0 && history.dbRows === 0) {
    return { status: 'ok', dbFile, mirrorFile, live, history, badLines };
  }

  const diverged =
    live.missing.length + live.extra.length + live.mismatches.length +
    history.missing.length + history.extra.length + history.mismatches.length +
    badLines.length > 0;
  return {
    status: diverged ? 'diverged' : 'ok',
    ...(mirrorMissing ? { reason: `镜像文件缺失：${mirrorFile}` } : {}),
    dbFile,
    mirrorFile,
    live,
    history,
    badLines,
  };
}
