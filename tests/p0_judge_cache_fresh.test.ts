/**
 * P0 · **判定缓存的新鲜度不许依赖索引**（2026-10-31，假绿事故）。
 *
 * ## 病（当天当场撞到，判定体系的地基漏洞）
 * `judgeCacheKey = sha256(判据内容 ‖ fileHash)`，而 `fileHash` 取自 **`cache.db` 的 `files.content_hash`**
 * ⇒ 索引可以落后于磁盘 ⇒ **文件内容变了、key 没变 ⇒ 复用旧结论**。
 * 实测原话：`docs/GUIDE-GATE.md` 的 `**码数合计 70**` 已改成 71，节点上
 * `source-has must:["**码数合计 70**"]` **本该红**，而 `design_line action=judge` 报
 * **pass（缓存命中）** —— 失效的判据被缓存洗成了绿的。
 * ★ 为什么索引没被"先修索引"救回来：`ensureFreshIndex` 走 `walkFiles`，`.md` 属 doc 类
 * （不在 `source_exts.ts` 的 code 集合里）⇒ **docs/ 下的文件永远不在走查集合里**，
 * 它们的 `content_hash` 永久停在 import 那一刻（实测 3 个 md 的 idx_h 全部 ≠ disk_h）。
 *
 * ## 本证锁三件事（每条都能证红，见各 case 的「改前」注释）
 * 1. **内容变了就要重判**：新旧内容都判过、中间**只改磁盘、不碰 `cache.db`** ⇒ 必须 fail。
 * 2. **内容没变仍命中**：连判两次，第二次必须命中缓存（计数可观测）；连 mtime 都不是判据。
 * 3. **文件删除**：判据指向的文件被删 ⇒ **不得返回旧的 pass**。
 *
 * ## 夹具为什么住 `.idxbehind/`（**这不是逃逸，是复刻真实处境**）
 * 本证要造的是「索引里有这一行、但**索引不可能跟上磁盘**」的文件 —— 那正是 `docs/*.md` 的处境。
 * `walkFiles` 跳过所有点目录（与跳过 doc 类文件同一种"走查宇宙之外"），而 `syncFile` 单文件照建行
 * ⇒ 得到与 docs/*.md **同一个形状**：`files.content_hash` 有值、但永不刷新。
 * ★ 若换成一个普通 `src/*.ts`，`ensureFreshIndex` 会按 mtime/size 顺手把它同步掉 ⇒ 索引被自愈 ⇒
 *   这个 bug 在测试里就**演不出来**了（假绿在这里恰好被"修索引"这条无关路径盖住）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { getProjectCacheDb } from '../src/infrastructure/index/db.js';
import { syncFile } from '../src/infrastructure/index/symbols.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { JudgeItem } from '../src/domain/judge_port.js';

/** 索引跟不上的那个文件（点目录 ⇒ 走查宇宙之外，见文件头） */
const REL = '.idxbehind/fresh.ts';

/**
 * 造夹具：临时项目 + 一个**已进索引**（`files` 行有 content_hash）的 `REL` 文件 + 一条 `source-has` 判据。
 * ★ 返回的 `home` 是 `AGENT_IO_HOME`（存储侧隔离；本证只调判定器，但按本仓惯例钉住）。
 */
async function makeFixture(content: string): Promise<{
  home: string;
  project: string;
  abs: string;
  items: JudgeItem[];
}> {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-judgecache-'));
  const abs = path.join(project, REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  // 索引里落一行（**这一步的哈希就是本证要"过期"的那个哈希**）
  await syncFile(getProjectCacheDb(project), project, abs);
  const items: JudgeItem[] = [
    {
      node_id: 'card_fresh',
      node_label: '缓存新鲜度卡',
      expectation: { kind: 'source-has', path: REL, must: ['TOKEN_A'], why: '文本判据：只依赖目标文件本体' },
    },
  ];
  return { home, project, abs, items };
}

/** 索引里记的内容哈希（断言"索引确实还停在旧内容上"用） */
function indexedHash(project: string): string | undefined {
  const db = getProjectCacheDb(project);
  const row = db.prepare('SELECT content_hash FROM files WHERE path = $p').get({ p: REL }) as
    | { content_hash?: string }
    | undefined;
  return row?.content_hash;
}

test('P0-fresh ① · 内容变了 ⇒ 必须重判（改前：索引没变 ⇒ key 没变 ⇒ 复用旧 pass = 假绿）', async () => {
  const { home, project, abs, items } = await makeFixture("export const MARK = 'TOKEN_A';\n");
  try {
    process.env.AGENT_IO_HOME = home;
    const before = await judgeExpectations(project, items);
    assert.equal(before.items[0].verdict, 'pass', '第一次：文件里确实有 TOKEN_A');
    assert.deepEqual(before.cache, { hits: 0, misses: 1 }, '第一次必然是重算');
    const hashAtPass = indexedHash(project);
    assert.ok(hashAtPass, '索引里必须有这一行（否则旧实现压根不进缓存，本证就演不出假绿）');

    // ★ 只改磁盘，**不碰 cache.db**（模拟"索引落后于磁盘"）
    fs.writeFileSync(abs, "export const MARK = 'TOKEN_B';\n", 'utf-8');
    assert.equal(indexedHash(project), hashAtPass, '前置：索引确实还停在旧内容上（这就是假绿的土壤）');

    const after = await judgeExpectations(project, items);
    // ★ 改前这里拿到的是 `pass（缓存命中）` —— 本条断言就是"先红后绿"的那条红线
    assert.equal(after.items[0].verdict, 'fail', '内容改了就必须重判：must TOKEN_A 已经不在了');
    assert.doesNotMatch(after.items[0].detail, /缓存命中/, '不许命中旧结论');
    assert.deepEqual(after.cache, { hits: 0, misses: 1 }, '第二次必须是重算（miss），不是复用');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-fresh ② · 内容没变 ⇒ 仍然命中缓存（缓存没被废掉；连 mtime 都不是判据）', async () => {
  const { home, project, abs, items } = await makeFixture("export const MARK = 'TOKEN_A';\n");
  try {
    process.env.AGENT_IO_HOME = home;
    const first = await judgeExpectations(project, items);
    assert.equal(first.items[0].verdict, 'pass');
    assert.deepEqual(first.cache, { hits: 0, misses: 1 }, '第一次：重算');

    const second = await judgeExpectations(project, items);
    assert.equal(second.items[0].verdict, 'pass');
    assert.deepEqual(second.cache, { hits: 1, misses: 0 }, '第二次必须命中（否则等于把缓存废掉）');
    assert.match(second.items[0].detail, /缓存命中/);

    // ★ 只动 mtime（内容逐字不变）⇒ 仍须命中：新鲜度是**内容哈希**，不是 stat
    const later = new Date(Date.now() + 5 * 60_000);
    fs.utimesSync(abs, later, later);
    const third = await judgeExpectations(project, items);
    assert.deepEqual(third.cache, { hits: 1, misses: 0 }, '改 mtime 不许把缓存打翻（判据是内容哈希）');

    // 缓存条目真的落盘了（不然"命中"只是进程内假象）
    const cacheFile = path.join(project, '.agent-io', 'judge-cache.json');
    assert.ok(fs.existsSync(cacheFile), 'judge-cache.json 应已落盘');
    const entries = JSON.parse(fs.readFileSync(cacheFile, 'utf-8')) as { entries: Record<string, unknown> };
    assert.equal(Object.keys(entries.entries).length, 1, '只该有一条（同判据 + 同内容 = 同一个 key）');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-fresh ③ · 判据指向的文件被删 ⇒ 不得返回旧的 pass（改前：索引行还在 ⇒ 命中旧 pass）', async () => {
  const { home, project, abs, items } = await makeFixture("export const MARK = 'TOKEN_A';\n");
  try {
    process.env.AGENT_IO_HOME = home;
    const before = await judgeExpectations(project, items);
    assert.equal(before.items[0].verdict, 'pass', '第一次：文件在、TOKEN_A 在');

    fs.unlinkSync(abs);
    const after = await judgeExpectations(project, items);
    // ★ 改前这里拿到的是 `pass（缓存命中）`——文件都没了还报绿
    assert.equal(after.items[0].verdict, 'fail', '文件不存在 ⇒ fail（四态里的"活"那一侧，绝不复用旧 pass）');
    assert.match(after.items[0].detail, /不存在/);
    assert.doesNotMatch(after.items[0].detail, /缓存命中/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
