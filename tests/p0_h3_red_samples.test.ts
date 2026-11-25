/**
 * P0 · H3 红样本（2026-11-26，#202 A+①）：**固定坏夹具复验 —— 改尺后必须仍红**。
 *
 * ## 为什么要有这一份
 * 裁判核 / 判据清单 / 册是"什么算过、算红"的尺子。尺子若被放宽成假绿（不存在的文件 / 符号 /
 * 文本也判 pass），假绿读起来与真通过同形，没有第二道闸能发现。本证把一批**固定坏夹具**
 * （`tests/fixtures/red-samples/`，目标在夹具工程里永远不存在）落进临时工程真跑
 * `judgeBookReceipt`，断言：
 * · 三条坏判据全部落在 `fail` / `unsupported`，**一条都不许 `pass`**；
 * · 回执带出 `rules_sha`（裁判版本指纹）与 `protected` 标记；
 * · 反向守卫：夹具册里必须真有判据（items>0），否则"全红"可能是"压根没判"。
 *
 * ★ 本批与消融 `full_red` 哨兵同一口径：固定红样本是标尺，改尺（裁判核/清单/册）后重跑，
 *   它们必须仍红；若变绿 = 裁判被放宽成假绿，当场红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIXTURE_BOOK = path.join(ROOT, 'tests', 'fixtures', 'red-samples', 'red-samples.dsl.json');
const FEATURE = 'red-samples';

test('H3-red · 固定坏夹具三条判据全部 fail/unsupported，不许出现 pass（改尺后必须仍红）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-red-samples-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  try {
    // 落夹具册到工程自己的 design 目录（project_dir 锚点，不依赖本机注册表）。
    const designDir = path.join(project, '.agent-io', 'design');
    fs.mkdirSync(designDir, { recursive: true });
    fs.copyFileSync(FIXTURE_BOOK, path.join(designDir, `${FEATURE}.dsl.json`));
    // 注册兜底（与 p1_judge_parallel ③ 同口径：数据根钉临时 home）。
    fs.writeFileSync(
      path.join(home, 'projects.json'),
      JSON.stringify(
        { version: 1, features: { [FEATURE]: { project_root: project.split(path.sep).join('/'), registered_at: new Date().toISOString(), registered_by: 'tests/p0_h3_red_samples' } } },
        null,
        2,
      ),
      'utf-8',
    );

    process.env.AGENT_IO_DATA_ROOT = home;
    const { judgeBookReceipt } = await import('../src/application/design/index.js');
    const rec = await judgeBookReceipt({ project_dir: project, feature: FEATURE });
    const data = rec.data;

    const items = (data.items ?? []) as Array<{ node_id: string; verdict: string; detail: string }>;
    assert.ok(items.length > 0, '夹具册必须真收集到判据（items>0）；空集等于压根没判');

    const passItems = items.filter((it) => it.verdict === 'pass');
    assert.equal(passItems.length, 0, `坏夹具一条都不许 pass；实得 pass=${JSON.stringify(passItems.map((x) => x.node_id))}`);

    const tally = (data.tally ?? {}) as Record<string, number>;
    const redCount = (tally.fail ?? 0) + (tally.unsupported ?? 0);
    assert.ok(redCount > 0, `fail+unsupported 必须 > 0；实得 tally=${JSON.stringify(tally)}`);

    // 双版本分记：回执必须带裁判版本指纹；临时非 git 工程 ⇒ protected=false（未纳入基线，不强制）。
    assert.ok(typeof data.rules_sha === 'string' && data.rules_sha.length > 0, '回执必须带 rules_sha 裁判版本指纹');
    assert.equal(data.protected, false, '隔离临时工程未受基线管理 ⇒ protected=false');
  } finally {
    delete process.env.AGENT_IO_DATA_ROOT;
    rmRf(home);
    rmRf(project);
  }
});
