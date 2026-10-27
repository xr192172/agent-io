#!/usr/bin/env node
/**
 * ★★★ cert T368 —— **任务卡搬出 DSL 的第一步：每项目一库 `tasks.db`（影子同步）**
 * （2026-10-27 · ROOTS 步 6 / 乙方案 slice 1）
 *
 * ## 本笔新增的方向（新方向 ⇒ 必须新增一条打它的证）
 *   ① `roots.ts` 多一个角色 `tasks`（project · `derivable:false` · `<proj>/.agent-io/tasks.db`）；
 *   ② `task_history.ts#syncTasksFromDsl` —— 把 `dsl.todos[]` **投影**进 `live_cards`（**只写不读**）；
 *   ③ `parityTasks` —— 册 vs 库的对拍尺（影子期的验收依据）；
 *   ④ **单向门**：已经在 `task_history` 里的卡**不许被册复活**。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① 库落在**项目内** `<proj>/.agent-io/tasks.db`（不是数据家）；
 *   ② 首次同步 `added=3`（= 册上 3 张），第二次**逐字幂等**（`added=updated=removed=0`）；
 *   ③ 册上改一张卡的 state ⇒ `updated=1`，库里的 state 跟着变；
 *   ④ 册上删一张卡 ⇒ `removed=1`（活卡表**只反射册的现状**）；
 *   ⑤ **单向门**：某 id 已在 `task_history` ⇒ 册上还有它也只计 `skipped_archived`，**不写回活卡表**；
 *   ⑥ `parityTasks`：一致时 `diff=[]`，故意不一致时**点名**差在哪。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不改读写路径**：`task_ops` 一个字节没动（本期是影子），所以"册与库不一致时谁说了算"还没答案；
 *   · **[未核] 真仓历史迁移**：旧 `history` 角色（`<dataHome>/.agent-io/task-history.db`，181 行）
 *     还没搬进 `tasks.db` —— 那是 slice 3 的事；
 *   · **[未核] 并发写**：本证单进程；两进程同时 sync 的串行化未验证（SQLite `BEGIN IMMEDIATE` 只保证单次事务原子）。
 *
 * ## 用法
 *   node certs/t368-tasks-db-shadow-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 *
 * touches: src/infrastructure/task_history.ts, src/infrastructure/roots.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp368tasks-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(ROOT, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { getTasksDbFile, openTasksDb, syncTasksFromDsl, listLiveCards, parityTasks } = await import(
  '../dist/src/infrastructure/task_history.js'
);

const FEAT = 't368tasks';
const card = (id, state) => ({ id, state, type: 'todo', title: `卡 ${id}`, note: `note-${id}` });

/** 每次用**新数组**：判据是"内容"，不是对象身份 */
const dslOf = (...cards) => ({ feature: FEAT, todos: cards.map((c) => ({ ...c })) });

// ── ① 库落在项目内 ─────────────────────────────────────
const dbFile = getTasksDbFile(ROOT);
chk(
  dbFile === path.join(ROOT, '.agent-io', 'tasks.db'),
  '① 库落在**项目内** `<proj>/.agent-io/tasks.db`（不是数据家）',
  `实际=${dbFile}`,
);
openTasksDb(ROOT).close();
chk(fs.existsSync(dbFile), '①-b 打开即建库（表结构由 TASKS_SCHEMA_SQL 一处定义）', `file=${dbFile}`);

// ── ② 首次同步 + 幂等 ──────────────────────────────────
const dsl1 = dslOf(card('A', 'candidate'), card('B', 'claimed'), card('C', 'candidate'));
const r1 = syncTasksFromDsl(ROOT, FEAT, dsl1);
chk(r1.dsl_cards === 3 && r1.added === 3, '②-a 首次同步：册上 3 张 ⇒ `added=3`', JSON.stringify(r1));
const r2 = syncTasksFromDsl(ROOT, FEAT, dsl1);
chk(
  r2.added === 0 && r2.updated === 0 && r2.removed === 0,
  '②-b 同一份册再跑一次 ⇒ **逐字幂等**（added=updated=removed=0）',
  JSON.stringify(r2),
);

// ── ③ 改 state ⇒ updated=1，库里跟着变 ─────────────────
const dsl2 = dslOf(card('A', 'candidate'), card('B', 'done'), card('C', 'candidate'));
const r3 = syncTasksFromDsl(ROOT, FEAT, dsl2);
const bAfter = listLiveCards(ROOT, FEAT).find((c) => c.id === 'B');
chk(r3.updated === 1 && bAfter?.state === 'done', '③ 册上改一张卡的 state ⇒ `updated=1` 且库里 state 跟着变', `updated=${r3.updated} · 库里 B.state=${bAfter?.state}`);

// ── ④ 册上删一张 ⇒ removed=1 ───────────────────────────
const dsl3 = dslOf(card('A', 'candidate'), card('B', 'done'));
const r4 = syncTasksFromDsl(ROOT, FEAT, dsl3);
chk(r4.removed === 1 && listLiveCards(ROOT, FEAT).length === 2, '④ 册上删掉一张（C）⇒ `removed=1`，活卡表只剩 2', JSON.stringify(r4));

// ── ⑤ 单向门：已在 history 的卡不许被册复活 ──────────────
{
  const db = openTasksDb(ROOT);
  db.prepare(
    'INSERT INTO task_history (id, feature, node_id, state, summary, card_json, moved_at, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('D', FEAT, null, 'done', '卡 D', JSON.stringify(card('D', 'done')), new Date().toISOString(), 't368-证明单向门');
  db.close();
}
const dsl4 = dslOf(card('A', 'candidate'), card('B', 'done'), card('D', 'candidate'));
const r5 = syncTasksFromDsl(ROOT, FEAT, dsl4);
const hasD = listLiveCards(ROOT, FEAT).some((c) => c.id === 'D');
chk(
  r5.skipped_archived === 1 && !hasD,
  '⑤ **单向门**：册上还有 D，但 D 已在 history ⇒ 只计 `skipped_archived`，**不写回活卡表**',
  `skipped=${r5.skipped_archived} · 活卡表里有 D=${hasD}`,
);

// ── ⑥ 对拍尺 ──────────────────────────────────────────
const p1 = parityTasks(ROOT, FEAT, { todos: listLiveCards(ROOT, FEAT).map((c) => c.card ?? {}) });
chk(p1.diff.length === 0, '⑥-a 库自己跟自己对拍 ⇒ `diff=[]`', JSON.stringify(p1));
const p2 = parityTasks(ROOT, FEAT, dslOf(card('A', 'claimed'), card('Z', 'candidate')));
chk(
  p2.diff.length === 3,
  '⑥-b 故意不一致 ⇒ 对拍**点名**差在哪（state 不一致 1 + 册有库无 1 + 库有册无 1）',
  JSON.stringify(p2.diff),
);

console.log(`\n═══ T368 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
