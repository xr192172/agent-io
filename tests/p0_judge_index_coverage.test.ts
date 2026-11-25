/**
 * P0 · #188 时序根因修（2026-11-26，Main 裁 b）：**判定前索引覆盖校验 + 同步补齐 + fail-closed**。
 *
 * ## 病（CI 偶发，非 #188 回归）
 * runner 上 judge 判定时点，后台收录尚未跑完 ⇒ 判据指向的文件还没进 `files`/边表。
 * 旧实现判定前只做"逐文件 stale 探测"，整库覆盖与否没有权威校验；缺收录的边表类判据
 * 落到 call-exists 分支，`indexStaleFor` 报"索引里查不到该文件" ⇒ 偶发 unsupported。
 * dump 取证：judge 时点缺收录、judge 结束后的保鲜步才补齐 = **判定前时序根因**。
 *
 * ## 本证锁两件事
 * 1. **判定前补齐自愈**：磁盘有、索引缺的文件，判定前由覆盖复核 + 同步 backfill 补齐，
 *    边表类判据据此可正常判定（不再因时序缺行报 unsupported）。
 * 2. **fail-closed 不冒充完整**：补齐后整库仍未覆盖（或覆盖校验读不出）时，边表类判据
 *    单列 unsupported 明示，不拿缺行边表判 pass/fail（比照 V3 untrusted 不得 exit0）。
 *
 * 夹具复刻真实处境：先只把被调方 `a.ts` 落库，调用方 `b.ts` 磁盘已写、索引未收录。
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

const CALLER = 'src/b.ts';
const CALLEE = 'src/a.ts';

async function makeFixture(): Promise<{ home: string; project: string; items: JudgeItem[] }> {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-coverage-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(project, CALLEE),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(project, CALLER),
    "import { add } from './a';\n\nexport function runB(): number {\n  return add(1, 2);\n}\n",
    'utf-8',
  );
  // ★ 只落被调方；调用方 b.ts 磁盘已写、索引未收录（复刻 judge 时点缺收录）。
  await syncFile(getProjectCacheDb(project), project, path.join(project, CALLEE));
  const items: JudgeItem[] = [
    {
      node_id: 'card_cov',
      node_label: '覆盖补齐卡',
      expectation: { kind: 'call-exists', path: CALLER, symbol: 'runB', target: 'add', why: '调用方必须调用 add' },
    },
  ];
  return { home, project, items };
}

function indexedPaths(project: string): Set<string> {
  const rows = getProjectCacheDb(project).prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  return new Set(rows.map((r) => r.path));
}

test('P0-cov ① · 判定前补齐缺收录文件 ⇒ call-exists 可正常判定（不再时序 unsupported）', async () => {
  const { home, project, items } = await makeFixture();
  try {
    process.env.AGENT_IO_HOME = home;
    // 前置：调用方确实还没进索引（本证要演的缺收录土壤）
    assert.ok(!indexedPaths(project).has(CALLER), '前置：b.ts 判定前尚未收录');

    const res = await judgeExpectations(project, items);
    const item = res.items[0];
    // ★ 修前：缺收录 ⇒ unsupported「索引里查不到该文件」；修后：判定前补齐 ⇒ 边可查 ⇒ pass。
    assert.equal(item.verdict, 'pass', `补齐后应命中调用边；实际 ${item.verdict}：${item.detail}`);
    assert.ok(indexedPaths(project).has(CALLER), '判定流程已把缺收录的 b.ts 补齐进索引');
    assert.doesNotMatch(item.detail, /查不到该文件/, '不得再报时序缺收录 unsupported');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-cov ② · 整库未覆盖时边表类 fail-closed ⇒ unsupported 明示，不判 pass/fail', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-cov-fc-'));
  // 空目录：走查范围为空 ⇒ `indexCoversDiskEx` 双出口 ok=false（读不出覆盖），补齐也无源可补。
  const items: JudgeItem[] = [
    {
      node_id: 'card_fc',
      node_label: 'fail-closed 卡',
      expectation: { kind: 'call-exists', path: CALLER, symbol: 'runB', target: 'add', why: '未覆盖时拒绝判定' },
    },
  ];
  try {
    process.env.AGENT_IO_HOME = home;
    const res = await judgeExpectations(project, items);
    const item = res.items[0];
    // ★ fail-closed：覆盖校验读不出 ⇒ 边表类判据只能 unsupported，不得判 pass/fail。
    assert.equal(item.verdict, 'unsupported', '未覆盖/读不出 ⇒ 只能 unsupported，不得 pass/fail');
    assert.match(item.detail, /未覆盖磁盘|边表事实不可信|判不了/, 'fail-closed 须明示原因');
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
