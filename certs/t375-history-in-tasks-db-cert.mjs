#!/usr/bin/env node
/**
 * ★★★ cert T375 —— **历史并入任务库**：`task_history` 与活卡同库，`history` 角色退场
 * （2026-10-27 · ROOTS 步 6 / 乙方案 **slice 3**）
 *
 * ## 本笔新增的方向
 *   ① `task_history.ts#openTaskHistoryFor(feature)` —— 历史读写改走 `<proj>/.agent-io/tasks.db`；
 *   ② `getTaskHistoryFile()` 的"一个大库"退场，回执改显示 `taskHistoryDbPath(feature)`；
 *   ③ `roots.ts` 删掉 `history` 角色（数据角色 11 → 10，与 `tasks` 合一）；
 *   ④ 文本载体统一 `tasks.jsonl`：`kind:'live'` + `kind:'history'` 同一条。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① `recordTaskHistory` 落到**项目内** `tasks.db`，且**数据仓里没有** `task-history.db`；
 *   ② `queryTaskHistory` 读得回同样的行；③ `countTaskHistory(feature)` 数字对；
 *   ④ `dropTaskHistoryBatch` 按 `moved_at` 精确撤掉（补偿路径仍成立）；
 *   ⑤ 载体 `tasks.jsonl` 里同时有 live 与 history 两种行；
 *   ⑥ 角色表里**没有** `history` 了（已并入 `tasks`）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **旧库数据**：本机 `<数据仓>/task-history.db` 实测 **0 行**（早就空了）⇒ 没有"迁 181 行"这回事，
 *     所以本证不覆盖"老行搬迁"；真遇到有行的旧库，需要另写一次性迁移；
 *   · **[未核] `countTaskHistory()` 不带 feature** 时按注册表求和（多项目）—— 本证只有 1 个项目。
 *
 * ## 用法
 *   node certs/t375-history-in-tasks-db-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/task_history.ts, src/infrastructure/roots.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp375hist-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.AGENT_IO_HOME = HOME;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { registerFeature } = await import('../dist/src/infrastructure/project_registry.js');
const th = await import('../dist/src/infrastructure/task_history.js');
const { rootsOf } = await import('../dist/src/infrastructure/roots.js');

const FEAT = 't375hist';
registerFeature(FEAT, PROJ, 'cert-t375');
const now = new Date().toISOString();
const rows = [
  { id: 'C1', feature: FEAT, state: 'done', summary: '卡一', card_json: '{"id":"C1"}', moved_at: now, reason: 't375' },
  { id: 'C2', feature: FEAT, state: 'void', summary: '卡二', card_json: '{"id":"C2"}', moved_at: now, reason: 't375' },
];

// ── ① 落到项目内 tasks.db；数据仓没有 task-history.db ────────
const written = th.recordTaskHistory(rows);
const dbFile = th.getTasksDbFile(PROJ);
chk(written === 2 && fs.existsSync(dbFile), '① `recordTaskHistory` 落到**项目内** tasks.db', `written=${written} file=${dbFile}`);
chk(
  !fs.existsSync(path.join(HOME, '.agent-io', 'task-history.db')),
  '①-b 数据仓里**没有** `task-history.db`（"一个大库"已退场）',
  `数据仓=${path.join(HOME, '.agent-io')}`,
);

// ── ②③ 读得回、数得对 ────────────────────────────────────
const q = th.queryTaskHistory({ feature: FEAT });
chk(q.total === 2 && q.rows.length === 2, '② `queryTaskHistory` 读回 2 行', `total=${q.total}`);
chk(th.countTaskHistory(FEAT) === 2, '③ `countTaskHistory(feature)` = 2', `=` + th.countTaskHistory(FEAT));

// ── ⑤ 载体里 live + history 两种行 ────────────────────────
th.syncTasksFromDsl(PROJ, FEAT, { todos: [{ id: 'L1', state: 'candidate' }] });
const jl = fs.readFileSync(th.getTasksJsonlFile(PROJ), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
chk(
  jl.some((r) => r.kind === 'live') && jl.some((r) => r.kind === 'history'),
  '⑤ 载体 `tasks.jsonl` 同时有 live 与 history',
  jl.map((r) => r.kind + ':' + r.id).join(' · '),
);

// ── ④ 补偿删除仍成立 ─────────────────────────────────────
const dropped = th.dropTaskHistoryBatch(FEAT, now);
chk(dropped === 2 && th.countTaskHistory(FEAT) === 0, '④ `dropTaskHistoryBatch` 按 moved_at 精确撤掉', `dropped=${dropped}`);

// ── ⑥ 角色表里没有 history ───────────────────────────────
const roles = Object.keys(rootsOf(PROJ));
chk(!roles.includes('history'), '⑥ 角色表里**已无** `history`（并入 `tasks`）', roles.join(','));

console.log(`\n═══ T375 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
