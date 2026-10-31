/**
 * P1 · **逐调用保鲜必须真的做走查** —— 由原证 `certs/t238-freshness-cert.mjs` 整张迁入。
 *
 * ## 它测的是哪一格
 * 工具调用前的那次「保鲜」走了统一机制 `ensureStage('symbol_index')`（`src/application/stage_registry.ts`）。
 * ★ 而当时 `symbol_index` **有 `locate` 却没写 `isFresh`** ⇒ 落到兜底的「locate 存在 ⇒ 恒判 fresh」
 *   ⇒ `produce` **一次都没跑** ⇒ ★★ **保鲜静默变成空操作**，而代码注释逐字写着"行为不变 ✓"。
 *
 * ## 判据（二值、可证伪、且**自带对照**）
 * 造一个**已建好索引**的项目 → 之后**新增一个源文件** → 调 `ensureStage('symbol_index')`：
 *   · 保鲜真跑了 ⇒ 新文件被同步进 `cache.db`（files 表 +1）；
 *   · ★ **对照组**：直接调 `ensureProjectIndex(…, {bootstrap:false})`（= T221 前的老行为）
 *     必须给出**同样的**结果 ⇒ 这才证明"接上统一机制后行为不变"，而不是只证明"这次碰巧动了"。
 * ★ 为什么判据必须落在【files 表计数】上：不用返回值 `action` —— 那是**被验证方自己说的话**
 *   （T238 修前它就说 `action:'fresh'`，而实际什么都没做）。用**盘上事实**（sqlite 计数）当判据。
 *
 * ## 原证断言 → 本文件用例（一条不删，7 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ⓪-a 索引已建好：files 表 = 2 | `⓪ 夹具：先建好索引` |
 * | ①-0 调用本身没抛（缺 `isFresh` 时它会响亮抛） | `① 保鲜真的走查了`（第 1 条 assert） |
 * | ①-a ★ files 表 2 → 3（保鲜真的做了走查） | 同上（第 2 条 assert） |
 * | ①-b 返回值如实说 `produced`（不是 `fresh`） | 同上（第 3 条 assert） |
 * | ②-a 老行为读数与统一机制一致 | `② 对照：老行为读数一致`（第 1 条 assert） |
 * | ②-b 且就是"磁盘上有几个源文件就是几个"（3） | 同上（第 2 条 assert） |
 * | ③-a 「有 locate 却没 isFresh」的工序必须响亮抛且点名 isFresh | `③ 缺 isFresh ⇒ 响亮` |
 *
 * ## ★ 消融（本文件必须能红 —— 2026-10-31 迁移时实测）
 *   **改哪一行**：删掉 `src/application/stage_registry.ts` 里 `symbol_index` 的
 *   `isFresh: () => false,`（第 177 行那一行）。
 *   · **红读数**：`用例 2/4 失败` · exit 1 ——
 *     `①` 红（调用直接抛：`工序 "symbol_index" 声明了 locate 却没声明 isFresh ⇒ 「文件存在」**不等于**「新鲜」`；
 *     files 表纹丝不动 —— 正是本证要抓的"保鲜静默变空操作"）；
 *     `②` 红（联动读数：`老=2→3 · 统一机制=-1`，因为 ① 没跑完、读数没落）。
 *   · **还原后**（`git diff` 里该文件消失 = 逐字节相同）⇒ **用例 4/4 · 7 条断言全绿** · exit 0。
 *
 * ## 诚实边界（与原证一致）
 *   · 只用**临时目录**里的夹具项目（`makeTempHome()`）+ 临时 `AGENT_IO_HOME`，不碰真数据仓；
 *   · ③ 这条断言**故意**锁住"缺 `isFresh` ⇒ 响亮"。若哪天给 `dsl_baseline` 写了真的 `isFresh`，
 *     请把本断言改成"它能真的刷新" —— ★ 改它的人是**在把东西修对**，不是绕过判据；
 *   · 不证明"走查花了多久"（性能不是本证的对象）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ensureProjectIndex } from '../src/infrastructure/index/index_freshness.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { ensureStage } from '../src/application/stage_registry.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

const PROJ = path.join(TMP, 'proj');

/**
 * files 表行数 —— ★ **盘上事实**（sqlite 计数），不是被验证方自己的说法。
 * 与 `getProjectCacheDb(PROJ)` 同一个连接池 ⇒ 与 status/ensureStage 的写同源。
 */
function fileCount(): number {
  const db = getProjectCacheDb(PROJ);
  const row = db.prepare('SELECT COUNT(*) AS c FROM files').get() as { c: number };
  return Number(row.c);
}

// ★ 共享读数：①② 必须看同一份夹具（顺序依赖是**故意**的 —— 第②步就是要拿①的结果当对照）
let n0 = -1;
let n1 = -1;

test('⓪ 夹具：一个**已建好索引**的小项目（2 个源文件）', async () => {
  fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
  fs.writeFileSync(path.join(PROJ, 'src', 'a.ts'), 'export function alpha(): number { return 1; }\n');
  fs.writeFileSync(path.join(PROJ, 'src', 'b.ts'), 'export function beta(): number { return 2; }\n');
  await ensureProjectIndex(PROJ, { bootstrap: true });
  n0 = fileCount();
  assert.equal(n0, 2, `索引没建好：files 表实测 = ${n0}（期望 2）— 后面的读数都不可信`);
});

test('① ★★ 磁盘加了一个文件 ⇒ `ensureStage(symbol_index)` 必须真的把它同步进来', async () => {
  fs.writeFileSync(path.join(PROJ, 'src', 'c.ts'), 'export function gamma(): number { return 3; }\n');
  // ★ 包起来：修前它会**抛**（缺 isFresh 现在响亮）⇒ 不包的话本用例是"崩"，读数不可读
  let r: { action?: string } = {};
  let callErr = '';
  try {
    r = (await ensureStage('symbol_index', { projectRoot: PROJ })) as unknown as { action?: string };
  } catch (e) {
    callErr = e instanceof Error ? e.message : String(e);
  }
  assert.equal(callErr, '', `①-0 调用本身不许抛（缺 isFresh 时该抛 —— 但那是另一条判据）：${callErr.split('\n')[0].slice(0, 140)}`);
  n1 = fileCount();
  assert.equal(n1, 3, `①-a ★★ 保鲜必须**真的做走查**：files 表 ${n0} → ${n1}（期望 3）；返回 ${JSON.stringify(r)}`);
  assert.equal(r.action, 'produced', `①-b ★ 返回值必须如实说 produced（**不是** fresh）—— 否则它就是在报告一件没发生的事：实测 action=${String(r.action)}`);
});

test('② ★★ 对照：T221 **之前**的老行为（直调 ensureProjectIndex）读数必须一致', async () => {
  const before = fileCount();
  await ensureProjectIndex(PROJ, { bootstrap: false });
  const afterCount = fileCount();
  assert.equal(afterCount, n1, `②-a 老行为读数必须与统一机制**一致**：老=${before}→${afterCount} · 统一机制=${n1}`);
  assert.equal(afterCount, 3, `②-b ★ 且就是"磁盘上有几个源文件就是几个"（3）—— 两边都不许少：实测 ${afterCount}`);
});

test('③ ★ 「有 locate 却没 isFresh」的工序必须**响亮**，不许静默判新鲜', async () => {
  let threw = '';
  try {
    await ensureStage('dsl_baseline', { projectRoot: PROJ, feature: 'no_such_feature' });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  assert.match(
    threw,
    /isFresh/,
    threw
      ? `③-a 抛了但没点名 isFresh：${threw.split('\n')[0].slice(0, 120)}`
      : '③-a ★★ `dsl_baseline`（有 locate、无 isFresh）必须抛错并点名 isFresh —— 它**没抛** ⇒ 静默兜底又回来了',
  );
});
