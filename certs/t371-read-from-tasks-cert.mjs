#!/usr/bin/env node
/**
 * ★★★ cert T371 —— **读走库**：册读出来时 `todos` 以 `tasks.db` 为准（乙方案 slice 2b）
 *
 * ## 本笔的方向
 *   `storage.ts#hydrateTodosFromTasks`：`getDesignSheet` 的唯一读出端里换掉 `todos` 的来源
 *   ⇒ `task_ops` 那 20+ 处读 `dsl.todos` 的点**一处都不用改**，一起变成"读库"。
 *
 * ## ★ 2026-10-27 更新（slice 2c 之后）
 * `saveDesignSheet` **不再把 `todos` 写进册**了 ⇒ 本证要造"老册"（还带 `todos` 的那种）
 * 只能**直接写文件**（`writeRawBook`）。这正是迁移期要覆盖的形态：**存量册里还有卡**。
 *
 * ## 判据（三态，每条亲手跑）
 *   ① **库有卡 / 册上没有** ⇒ 读回来是库里的（以库为准）；
 *   ② **库与册不一致** ⇒ 读回来跟库（并出声 `[tasks-hydrate]`）；
 *   ③ **库不存在** ⇒ 用册上的（迁移前 / 首次，行为逐字不变）；
 *   ④ **库 0 张 / 册上有** ⇒ 用册上的（还没投影过，下一次落盘会投影）；
 *   ⑤ **两边逐张相同** ⇒ 读回内容一致（顺序不同不抖动）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **写**在 slice 2c 之后已改成"只写库、册不写卡"（见 `t373`）；本证只盯**读**的三态；
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
process.env.AGENT_IO_HOME = HOME; // 沙盒 home

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { getDesignSheet, getDesignSheetFile } = await import('../dist/src/infrastructure/storage.js');
const { getTasksDbFile, syncTasksFromDsl } = await import('../dist/src/infrastructure/task_history.js');

const book = (feature, todos, root = PROJ) => ({
  id: `feature_${feature}`,
  type: 'feature_diagram',
  feature,
  version: '1.0.0',
  title: feature,
  source_root: root,
  geometry: { layout: 'free', width: 100, height: 100, nodes: [], edges: [] },
  semantic: { files: [] },
  todos,
});

/** ★ 直接写"老册"（带 `todos` 的那种）：模拟迁移期的存量册 */
const writeRawBook = (feature, todos, root = PROJ) => {
  const b = book(feature, todos, root);
  const file = getDesignSheetFile(feature, root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(b, null, 2), 'utf-8');
  return file;
};
const ids = (todos) => (todos ?? []).map((t) => `${t.id}:${t.state}`).sort().join(' ');

// ── ③ 库不存在 ⇒ 用册上的（先跑：此时还没建库）──────────────
{
  const PROJ2 = path.join(TMP, 'proj2');
  fs.mkdirSync(PROJ2, { recursive: true });
  writeRawBook('t371d', [{ id: 'M', state: 'draft' }], PROJ2);
  chk(!fs.existsSync(getTasksDbFile(PROJ2)), '③ 前置：这个项目还没有库', `file=${getTasksDbFile(PROJ2)}`);
  const read = getDesignSheet('t371d', PROJ2);
  chk(ids(read?.todos) === 'M:draft', '③ 库不存在 ⇒ 用册上的（迁移前行为不变）', `读回=${ids(read?.todos)}`);
}

// ── ① 库有卡 / 册上没有 ⇒ 以库为准 ──────────────────────────
syncTasksFromDsl(PROJ, 't371b', { todos: [{ id: 'X', state: 'claimed' }, { id: 'Y', state: 'candidate' }] });
writeRawBook('t371b', []);
{
  const read = getDesignSheet('t371b', PROJ);
  chk(ids(read?.todos) === 'X:claimed Y:candidate', '① 库里有卡、册上没有 ⇒ 读回来是库里的（**以库为准**）', `读回=${ids(read?.todos)}`);
}

// ── ② 库与册不一致 ⇒ 跟库 ─────────────────────────────────
writeRawBook('t371c', [{ id: 'A', state: 'candidate' }]);
syncTasksFromDsl(PROJ, 't371c', { todos: [{ id: 'A', state: 'done' }] });
{
  const read = getDesignSheet('t371c', PROJ);
  chk(ids(read?.todos) === 'A:done', '② 库与册不一致 ⇒ 读回来跟**库**（并出声 [tasks-hydrate]）', `读回=${ids(read?.todos)}`);
}

// ── ④ 库 0 张 / 册上有 ⇒ 用册上的 ───────────────────────────
{
  const PROJ3 = path.join(TMP, 'proj3');
  fs.mkdirSync(PROJ3, { recursive: true });
  writeRawBook('t371e', [{ id: 'N', state: 'draft' }], PROJ3);
  syncTasksFromDsl(PROJ3, 't371e', { todos: [{ id: 'N', state: 'draft' }] }); // 建库
  syncTasksFromDsl(PROJ3, 't371e', { todos: [] }); // 再把库清空（册上仍有 N）
  const read = getDesignSheet('t371e', PROJ3);
  chk(ids(read?.todos) === 'N:draft', '④ 库里 0 张、册上有 ⇒ 用册上的（还没投影，不算错）', `读回=${ids(read?.todos)}`);
}

// ── ⑤ 内容相同、顺序不同 ⇒ 不抖动 ───────────────────────────
{
  syncTasksFromDsl(PROJ, 't371b', { todos: [{ id: 'Y', state: 'candidate' }, { id: 'X', state: 'claimed' }] });
  const read = getDesignSheet('t371b', PROJ);
  chk(ids(read?.todos) === 'X:claimed Y:candidate', '⑤ 库与册内容相同、顺序不同 ⇒ 读回内容一致（不抖动）', `读回=${ids(read?.todos)}`);
}

console.log(`\n═══ T371 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
