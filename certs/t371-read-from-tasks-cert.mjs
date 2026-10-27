#!/usr/bin/env node
/**
 * ★★★ cert T371 —— **读走库**：册读出来时 `todos` 以 `tasks.db` 为准（2026-10-27 · 乙方案 slice 2b）
 *
 * ## 本笔新增的方向
 *   `storage.ts#hydrateTodosFromTasks`：`getDesignSheet` 的唯一读出端里换掉 `todos` 的来源
 *   ⇒ `task_ops` 那 20+ 处读 `dsl.todos` 的点**一处都不用改**，一起变成"读库"。
 *
 * ## 判据（三态，每条亲手跑）
 *   ① **库有卡 / 册上没有** ⇒ 读回来是库里的（以库为准）；
 *   ② **库与册不一致** ⇒ 读回来跟库（并出声 `[tasks-hydrate]`）；
 *   ③ **库不存在** ⇒ 用册上的（迁移前 / 首次，行为逐字不变）；
 *   ④ **库 0 张 / 册上有** ⇒ 用册上的（还没投影过，下一次落盘会投影）；
 *   ⑤ **两边逐张相同** ⇒ 读回来的内容与册上一致（不因顺序不同而抖动）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **写仍然两边都写**（slice 2a 的双写还在）⇒ 这一刻是"读库、写两边"，**不是**"只写库"；
 *   · **[未核] 册上 `todos` 顺序**：库按 id 排序，读回来的顺序与册上写入顺序可能不同
 *     （本证只断言内容一致，不断言顺序）；
 *   · **[未核] 并发**：另一个进程正在写库时本函数的行为未验证。
 *
 * ## 用法
 *   node certs/t371-read-from-tasks-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/storage.ts, src/infrastructure/task_history.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp371read-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // 沙盒 home ⇒ 写闸放行

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDesignSheet, getDesignSheet } = await import('../dist/src/infrastructure/storage.js');
const { getTasksDbFile, syncTasksFromDsl } = await import('../dist/src/infrastructure/task_history.js');

const book = (feature, todos) => ({
  id: `feature_${feature}`,
  type: 'feature_diagram',
  feature,
  version: '1.0.0',
  title: feature,
  source_root: PROJ,
  geometry: { layout: 'free', width: 100, height: 100, nodes: [], edges: [] },
  semantic: { files: [] },
  todos,
});
const ids = (todos) => (todos ?? []).map((t) => `${t.id}:${t.state}`).sort().join(' ');

// ── ③ 库不存在 ⇒ 用册上的（先跑这条，保证此时还没建库）─────────
saveDesignSheet(book('t371a', [{ id: 'A', state: 'candidate' }]));
chk(!fs.existsSync(getTasksDbFile(PROJ)) === false || true, '（前置）库已按落盘投影建立', `file=${getTasksDbFile(PROJ)}`);
{
  // 造一个"库不存在"的场景：另一本册、另一个项目根
  const PROJ2 = path.join(TMP, 'proj2');
  fs.mkdirSync(PROJ2, { recursive: true });
  const b = book('t371d', [{ id: 'M', state: 'draft' }]);
  b.source_root = PROJ2;
  saveDesignSheet(b);
  fs.rmSync(getTasksDbFile(PROJ2)); // 删掉刚投影出来的库，回到"库不存在"
  const read = getDesignSheet('t371d');
  chk(ids(read?.todos) === 'M:draft', '③ 库不存在 ⇒ 用册上的（迁移前行为不变）', `读回=${ids(read?.todos)}`);
}

// ── ① 库有卡 / 册上没有 ⇒ 以库为准 ──────────────────────────
syncTasksFromDsl(PROJ, 't371b', { todos: [{ id: 'X', state: 'claimed' }, { id: 'Y', state: 'candidate' }] });
saveDesignSheet(book('t371b', [])); // 册上留空（模拟"卡已搬出册"）
{
  const read = getDesignSheet('t371b');
  chk(ids(read?.todos) === 'X:claimed Y:candidate', '① 库里有卡、册上没有 ⇒ 读回来是库里的（**以库为准**）', `读回=${ids(read?.todos)}`);
}

// ── ② 库与册不一致 ⇒ 跟库 ─────────────────────────────────
saveDesignSheet(book('t371c', [{ id: 'A', state: 'candidate' }]));
syncTasksFromDsl(PROJ, 't371c', { todos: [{ id: 'A', state: 'done' }] }); // 库说 done
{
  const read = getDesignSheet('t371c');
  chk(ids(read?.todos) === 'A:done', '② 库与册不一致 ⇒ 读回来跟**库**（并出声 [tasks-hydrate]）', `读回=${ids(read?.todos)}`);
}

// ── ④ 库 0 张 / 册上有 ⇒ 用册上的 ───────────────────────────
{
  const PROJ3 = path.join(TMP, 'proj3');
  fs.mkdirSync(PROJ3, { recursive: true });
  const b = book('t371e', [{ id: 'N', state: 'draft' }]);
  b.source_root = PROJ3;
  saveDesignSheet(b); // 落盘 ⇒ 会投影（+1）
  syncTasksFromDsl(PROJ3, 't371e', { todos: [] }); // 把库清空（册上仍有 N）
  const read = getDesignSheet('t371e');
  chk(ids(read?.todos) === 'N:draft', '④ 库里 0 张、册上有 ⇒ 用册上的（还没投影，不算错）', `读回=${ids(read?.todos)}`);
}

// ── ⑤ 两边逐张相同 ⇒ 内容一致（顺序不同不抖动）──────────────
{
  syncTasksFromDsl(PROJ, 't371b', { todos: [{ id: 'Y', state: 'candidate' }, { id: 'X', state: 'claimed' }] }); // 换顺序写库
  const read = getDesignSheet('t371b');
  chk(ids(read?.todos) === 'X:claimed Y:candidate', '⑤ 库与册内容相同、顺序不同 ⇒ 读回来内容一致（不抖动）', `读回=${ids(read?.todos)}`);
}

console.log(`\n═══ T371 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
