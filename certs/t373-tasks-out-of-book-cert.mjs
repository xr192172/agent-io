#!/usr/bin/env node
/**
 * ★★★ cert T373 —— **卡彻底搬出册**：落盘不写 `todos`，库是唯一住处 + `.jsonl` 文本载体
 * （2026-10-27 · ROOTS 步 6 / 乙方案 **slice 2c**）
 *
 * ## 本笔新增的方向
 *   ① `storage.ts#withoutTodos` —— `saveDesignSheet` / `saveDSL` 落盘前摘掉 `todos`；
 *   ② `roots.ts` 的 `tasks` 角色改 **`derivable: false`**（意图数据）+ 声明 **`carrier: 'tasks.jsonl'`**；
 *   ③ `gitignoreRules()` 支持载体：二进制 `.db` 仍忽略、文本载体放行（T-#14 的判据）；
 *   ④ `task_history.ts#exportTasksJsonl` —— 同步后刷文本载体；
 *   ⑤ `design_line` 的"卡数"读数改问库（否则摘掉之后会恒为 0 = 假读数）。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① 落盘后**册文件里没有 `todos`**；② 库里**有**卡；③ 读回（hydrate）**有**卡；
 *   ④ 文本载体 `tasks.jsonl` 落在**项目内**、行数 = 卡数；⑤ 角色表 `derivable=false` + `carrier`；
 *   ⑥ `.gitignore` 规则：`tasks.db` 忽略、`tasks.jsonl` 放行。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **[未核] 旧历史迁入**：`<数据仓>/task-history.db` 里那 181 行还没搬进各项目 `tasks.db`（slice 3）；
 *   · **[未核] 老册残留**：已经带 `todos` 的历史册读起来仍正常（hydrate 以库为准，库空才回落册），
 *     但**没有**做"把老册上的卡一次性搬进库"的迁移证（下一片）；
 *   · **[未核] 并发**：两进程同时落盘同一册。
 *
 * ## 用法
 *   node certs/t373-tasks-out-of-book-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/infrastructure/storage.ts, src/infrastructure/roots.ts, src/infrastructure/task_history.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp373book-'));
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

const { saveDesignSheet, getDesignSheet, getDesignSheetFile } = await import('../dist/src/infrastructure/storage.js');
const { getTasksDbFile, getTasksJsonlFile, listLiveCards } = await import('../dist/src/infrastructure/task_history.js');
const { rootsOf, gitignoreRules } = await import('../dist/src/infrastructure/roots.js');

const FEAT = 't373book';
const book = {
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: 't373',
  source_root: PROJ,
  geometry: { layout: 'free', width: 100, height: 100, nodes: [], edges: [] },
  semantic: { files: [] },
  todos: [
    { id: 'K1', state: 'candidate', title: '甲' },
    { id: 'K2', state: 'claimed', title: '乙' },
  ],
};

// ── ① 落盘：册里没有 todos ───────────────────────────────
saveDesignSheet(book, PROJ);
const onDisk = JSON.parse(fs.readFileSync(getDesignSheetFile(FEAT, PROJ), 'utf-8'));
chk(!('todos' in onDisk), '① 落盘后**册文件里没有 `todos`**（卡的家不在册）', `keys=${Object.keys(onDisk).join(',')}`);

// ── ② 库里有卡 ─────────────────────────────────────────
const cards = listLiveCards(PROJ, FEAT);
chk(cards.length === 2, '② 库里有 2 张卡', `line=${cards.map((c) => `${c.id}:${c.state}`).join(' · ')}`);

// ── ③ 读回（hydrate）有卡 ───────────────────────────────
const read = getDesignSheet(FEAT, PROJ);
chk((read?.todos ?? []).length === 2, '③ 读回有 2 张卡（`getDesignSheet` hydrate）', `todos=${(read?.todos ?? []).map((t) => `${t.id}:${t.state}`).join(' · ')}`);

// ── ④ 文本载体在项目内、行数 = 卡数 ──────────────────────
const jl = getTasksJsonlFile(PROJ);
const jlLines = fs.existsSync(jl) ? fs.readFileSync(jl, 'utf-8').split('\n').filter(Boolean) : [];
chk(
  jl === path.join(PROJ, '.agent-io', 'tasks.jsonl') && jlLines.length === 2,
  '④ 文本载体 `tasks.jsonl` 落在**项目内**、2 行',
  `file=${jl} 行=${jlLines.length}`,
);

// ── ⑤ 角色表：derivable=false + carrier ─────────────────
const spec = rootsOf(PROJ).tasks;
chk(spec.derivable === false && spec.carrier === 'tasks.jsonl', '⑤ 角色 `tasks` 是 `derivable:false` 且声明了 `carrier`', `derivable=${spec.derivable} carrier=${spec.carrier}`);
chk(getTasksDbFile(PROJ) === spec.path, '⑤-b 库路径与 `rootsOf(proj).tasks.path` 逐字一致');

// ── ⑥ .gitignore 规则：库忽略、载体放行 ──────────────────
const gi = gitignoreRules();
chk(gi.ignore.includes('.agent-io/tasks.db'), '⑥-a `.agent-io/tasks.db` 在**忽略**表里（二进制不进 git）', gi.ignore.join(' · '));
chk(gi.keep.includes('.agent-io/tasks.jsonl'), '⑥-b `.agent-io/tasks.jsonl` 在**放行**表里（T-#14：文本载体随仓移交）', gi.keep.join(' · '));

console.log(`\n═══ T373 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
