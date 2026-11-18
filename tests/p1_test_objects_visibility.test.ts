/**
 * touches: src/application/meta/integrity/index_integrity.ts
 *
 * P1 · **"测试对象扫到但没进索引"必须自己喊出来**（可证伪读数）。
 *
 * 反例（真实事故，2026-11-08）：本仓 113 个测试文件里 18 个**从未被扫过**，
 * 而旧读数把它们归进"`include_tests=false` 的有意结果" ⇒ 没人会去看。
 * 判据的鉴别力就在这里：**造一个"有测试文件但索引里没有"的工程，读数必须 > 0 并点名**；
 * 把文件补进索引后必须归 0。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { indexIntegrity } from '../src/application/meta/integrity/index_integrity.ts';
import { getProjectCacheDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db.ts';

function makeProj(): { dir: string; dispose: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idxvis-'));
  const w = (rel: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text, 'utf-8');
  };
  w('src/a.ts', 'export function a(): number { return 1; }\n');
  w('tests/a.test.ts', "// touches: src/a.ts\nimport { test } from 'node:test';\ntest('x', () => {});\n");
  w('tests/b.test.ts', "// touches: src/a.ts\nimport { test } from 'node:test';\ntest('y', () => {});\n");

  const db = getProjectCacheDb(dir);
  db.prepare(
    'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('nA', 'function', 'a', 'a', 'src/a.ts', 'ts', 1, 1, 'a(): number', '[]', 'number', 'BH_A', 'T0');
  // ★ files 表要有行：`indexed_files` 读它；否则整份报告走"空索引"分支（那里是另一条路）
  db.prepare(
    'INSERT INTO files (path,content_hash,language,size,modified_at,indexed_at,node_count) VALUES (?,?,?,?,?,?,?)',
  ).run('src/a.ts', 'h1', 'ts', 10, Date.now(), Date.now(), 1);

  return {
    dir,
    dispose: () => {
      closeAllProjectCacheDbs();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* 临时目录 */
      }
    },
  };
}

test('① 有测试文件但索引里没有 ⇒ counts.test_objects 点名 + info 告警（不是"有意排除"）', async () => {
  const p = makeProj();
  try {
    const r = await indexIntegrity({ project_dir: p.dir });
    const t = r.counts.test_objects;
    assert.equal(t.on_disk, 2, `扫描应看到 2 个测试对象，实得 ${t.on_disk}`);
    assert.equal(t.indexed, 0, '索引里一个都没有');
    assert.deepEqual(t.missing, ['tests/a.test.ts', 'tests/b.test.ts'], '必须逐个点名');

    const issue = r.issues.find((i) => i.code === 'test_objects_not_indexed');
    assert.ok(issue, `必须报 test_objects_not_indexed，实得 ${r.issues.map((i) => i.code).join(',')}`);
    assert.equal(issue!.severity, 'info', '这是提示不是硬闸（但它不许沉默）');
    assert.match(issue!.message, /漏扫/, '文案必须把"有意排除"与"漏扫"分开');
    assert.match(issue!.message, /tests\/a\.test\.ts/);
  } finally {
    p.dispose();
  }
});

test('② 把测试文件补进索引 ⇒ 读数归 0、告警消失（鉴别力）', async () => {
  const p = makeProj();
  try {
    const db = getProjectCacheDb(p.dir);
    const ins = db.prepare(
      'INSERT OR REPLACE INTO nodes (id,kind,name,qualified_name,file_path,language,start_line,end_line,signature,params,return_type,body_hash,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    ins.run('nTa', 'const', 'x', 'x', 'tests/a.test.ts', 'ts', 3, 3, 'x', '[]', 'void', 'BH_TA', 'T0');
    ins.run('nTb', 'const', 'y', 'y', 'tests/b.test.ts', 'ts', 3, 3, 'y', '[]', 'void', 'BH_TB', 'T0');
    const insF = db.prepare('INSERT INTO files (path,content_hash,language,size,modified_at,indexed_at,node_count) VALUES (?,?,?,?,?,?,?)');
    insF.run('tests/a.test.ts', 'h2', 'ts', 10, Date.now(), Date.now(), 1);
    insF.run('tests/b.test.ts', 'h3', 'ts', 10, Date.now(), Date.now(), 1);

    const r = await indexIntegrity({ project_dir: p.dir });
    const t = r.counts.test_objects;
    assert.equal(t.on_disk, 2);
    assert.equal(t.indexed, 2, `两个都该可见，实得 ${t.indexed}`);
    assert.deepEqual(t.missing, []);
    assert.ok(!r.issues.some((i) => i.code === 'test_objects_not_indexed'), '归 0 后不许再亮');
  } finally {
    p.dispose();
  }
});

test('③ 真仓：读数与"文件名形态"口径一致（跑不出来的话必须是 0 而不是 undefined）', async () => {
  const r = await indexIntegrity({ project_dir: process.cwd() });
  const t = r.counts.test_objects;
  assert.equal(typeof t.on_disk, 'number', 'on_disk 必须在场（不是 undefined）');
  assert.equal(typeof t.indexed, 'number');
  assert.ok(Array.isArray(t.missing));
  // ★ 2026-11-18（批 10 修口径）：`missing` 的**声明口径**是"差集（仓库相对路径，**最多列 20 条**）"
  //   （`index_integrity.ts` 的 `test_objects.missing` 类型注释 + 实现 `v.missing.slice(0, 20)`），
  //   而旧断言写的是"长度 == 无上限差值" —— 两者在**缺口 ≤ 20** 时巧合相等，缺口一过 20 就红。
  //   批 10 新增 1 个测试文件把缺口从 20 推到 21 ⇒ 旧断言当场红（本批唯一一个"新增红"，见交付书 §2.5）。
  //   修法是**按实现口径断言**，不是把上界放宽：`missing.length === min(20, 缺口)`，且缺口 > 0 时 missing 不许空。
  const gap = t.on_disk - t.indexed;
  assert.ok(gap >= 0, `on_disk (${t.on_disk}) 不该小于 indexed (${t.indexed})`);
  assert.equal(t.missing.length, Math.min(20, gap), '差集必须按**实现口径**自洽（missing 最多列 20 条）');
  if (gap > 0) assert.ok(t.missing.length > 0, '有缺口就必须点名（不许"有漏扫但列表是空的"）');
});
