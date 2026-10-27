#!/usr/bin/env node
/**
 * ★★★ cert T369 —— **卡片投影接在「册落盘」这唯一出口上**（2026-10-27 · ROOTS 步 6 / 乙方案 slice 2a）
 *
 * ## 本笔新增的方向（新方向 ⇒ 必须新增一条打它的证）
 *   `storage.ts#saveDesignSheet` / `saveDSL` 落盘之后立刻 `shadowSyncTasks`：
 *   **谁改的册，库都跟着动**（`task_ops` 那 10 处落盘点一行没改）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① 走**真写入口** `saveDSL` 落一次册 ⇒ **项目根**下出现 `tasks.db`，卡在库里；
 *   ② 数据家**没有** `tasks.db`（不落数据仓 / 不落 C 盘）；
 *   ③ 改一张卡的 state 再落一次 ⇒ 库里跟手（`updated=1` 那条路），且对拍 `diff=[]`；
 *   ④ 册上删一张再落 ⇒ 库里也删（活卡表只反射册的现状）；
 *   ⑤ 根的解析：册没登记注册表但写了 `source_root` ⇒ 用 `source_root` 那个项目（不是数据家）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **读仍然走册**：本片是影子，`task_ops` 读的还是 `dsl.todos` ⇒ "库说了算"要等 slice 2b；
 *   · **[未核] 节点卡**（`geometry.nodes[].task`）**不在本库**：ROOTS 步 6 只搬 `todos[]`，
 *     节点卡是"这个节点要做什么"的设计意图，天然属于册；
 *   · **[未核] 并发**：两个进程同时落册的库竞争未验证（单次事务原子，但没有跨进程锁）。
 *
 * ## 用法
 *   node certs/t369-save-projects-tasks-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 *
 * touches: src/infrastructure/storage.ts, src/infrastructure/task_history.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 夹具落在 `certs/.work`（临时区）⇒ 写闸认这是沙盒，不需要额外授权
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp369prj-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL } = await import('../dist/src/infrastructure/storage.js');
const { getTasksDbFile, listLiveCards, parityTasks } = await import('../dist/src/infrastructure/task_history.js');
const { rootsOf } = await import('../dist/src/infrastructure/roots.js');

const FEAT = 't369tasks';
const book = (todos) => ({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: 't369',
  source_root: PROJ,
  geometry: { layout: 'free', width: 400, height: 300, nodes: [], edges: [] },
  semantic: { files: [] },
  todos,
});

// ── ① 真写入口落册 ⇒ 项目根下出现 tasks.db ─────────────
saveDSL(book([{ id: 'A', state: 'candidate', title: '甲' }, { id: 'B', state: 'claimed', title: '乙' }]));
const dbFile = getTasksDbFile(PROJ);
chk(fs.existsSync(dbFile), '① 走 `saveDSL` 落一次册 ⇒ **项目根**下出现 tasks.db', `file=${dbFile}`);
const cards1 = listLiveCards(PROJ, FEAT);
chk(cards1.length === 2, '①-b 两张卡都进库了', `库里=${cards1.map((c) => `${c.id}:${c.state}`).join(' · ')}`);
chk(
  dbFile === rootsOf(PROJ).tasks.path,
  '①-c 路径与 `rootsOf(proj).tasks.path` 逐字一致（唯一解析器）',
);

// ── ② 数据家没有 tasks.db ──────────────────────────────
chk(!fs.existsSync(path.join(HOME, '.agent-io', 'tasks.db')), '② 数据家**没有** tasks.db（不落数据仓）', `home=${HOME}`);

// ── ③ 改 state 再落 ⇒ 库跟手 + 对拍一致 ─────────────────
saveDSL(book([{ id: 'A', state: 'candidate', title: '甲' }, { id: 'B', state: 'done', title: '乙' }]));
const b = listLiveCards(PROJ, FEAT).find((c) => c.id === 'B');
chk(b?.state === 'done', '③ 册上改 state 再落一次 ⇒ 库里跟着变', `库里 B.state=${b?.state}`);
const parity = parityTasks(PROJ, FEAT, { todos: [{ id: 'A', state: 'candidate' }, { id: 'B', state: 'done' }] });
chk(parity.diff.length === 0, '③-b 册 vs 库对拍 `diff=[]`', JSON.stringify(parity));

// ── ④ 册上删一张再落 ⇒ 库里也删 ────────────────────────
saveDSL(book([{ id: 'A', state: 'candidate', title: '甲' }]));
const cards2 = listLiveCards(PROJ, FEAT);
chk(cards2.length === 1 && cards2[0].id === 'A', '④ 册上删掉 B 再落 ⇒ 库里只剩 A（活卡表只反射册的现状）', `库里=${cards2.map((c) => c.id).join(' · ')}`);

// ── ⑤ 根解析：注册表没登记时用册自己的 source_root ────────
const PROJ2 = path.join(TMP, 'proj2');
fs.mkdirSync(PROJ2, { recursive: true });
saveDSL({ ...book([{ id: 'C', state: 'candidate', title: '丙' }]), feature: `${FEAT}b`, source_root: PROJ2 });
chk(
  fs.existsSync(getTasksDbFile(PROJ2)) && !fs.existsSync(path.join(HOME, '.agent-io', 'tasks.db')),
  '⑤ 注册表没登记 ⇒ 用册的 `source_root` 定项目（不是数据家）',
  `proj2 有库=${fs.existsSync(getTasksDbFile(PROJ2))}`,
);

console.log(`\n═══ T369 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
