/**
 * P0 保鲜链 · 第 3 环（本任务核心）：**判据覆盖对账**。
 *
 * W0 实证：council-hub 的 5 条判据指向 7 个测试文件，全不在 `semantic.files` ——
 * 这个缺口此前没有任何检查会报。本证锁定：
 * ① 判据路径不在册 ⇒ consistency_check 报「判据指册外」缺口清单（含盘上存在性 + 来源决策卡）；
 * ② 判据路径在册 ⇒ 不报；
 * ③ edge 类判据两端都提取（to 在册外也要报）；
 * ④ 盘上存在 / 不存在两种事实都如实区分。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkConsistencyReport } from '../src/application/design/intent/consistency.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

interface SheetOpts {
  expectations: unknown[];
  ledgerPaths: string[];
}

function writeSheet(home: string, feature: string, sourceRoot: string, opts: SheetOpts): void {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: {
      nodes: [
        {
          id: 'card_a',
          label: '判据卡A',
          type: 'service',
          x: 0,
          y: 0,
          decision: { summary: '对账验证卡', expectations: opts.expectations },
        },
      ],
      edges: [],
    },
    semantic: { files: opts.ledgerPaths.map((p, i) => ({ id: `f${i}`, path: p })) },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

function makeProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p03-proj-'));
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  // in.ts：在册；out.ts：**盘上有、册上无**（W0 的形状）；ghost.ts：册上无、盘上也没有
  fs.writeFileSync(path.join(project, 'src', 'in.ts'), 'export function fin(): number {\n  return 1;\n}\n', 'utf-8');
  fs.writeFileSync(path.join(project, 'src', 'out.ts'), 'export function fout(): number {\n  return 2;\n}\n', 'utf-8');
  return project;
}

test('P0-3 · 判据指向册外路径 ⇒ 缺口清单点名路径 / 来源卡 / 盘上存在性（正例）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0cover', project, {
      ledgerPaths: ['src/in.ts'],
      expectations: [
        { kind: 'file-exists', path: 'src/in.ts', why: '在册，不报' },
        { kind: 'symbol-exists', path: 'src/out.ts', symbol: 'fout', why: '盘上有、册上无 ⇒ 报存在' },
        { kind: 'file-exists', path: 'src/ghost.ts', why: '册上无、盘上也没有 ⇒ 报不存在' },
        { kind: 'edge-absent', from: 'src/in.ts', to: 'src/edge.ts', why: 'to 端册外也要报' },
      ],
    });

    const r = await checkConsistencyReport({ feature: 'p0cover', code_dir: project });
    assert.equal(r.expectation_coverage.total_expectations, 4);
    assert.equal(r.expectation_coverage.gap_count, 3);
    const paths = r.expectation_coverage.gaps.map((g) => g.path).sort();
    assert.deepEqual(paths, ['src/edge.ts', 'src/ghost.ts', 'src/out.ts']);
    const out = r.expectation_coverage.gaps.find((g) => g.path === 'src/out.ts')!;
    assert.equal(out.on_disk, true);
    assert.equal(out.sources[0].node_id, 'card_a');
    const ghost = r.expectation_coverage.gaps.find((g) => g.path === 'src/ghost.ts')!;
    assert.equal(ghost.on_disk, false);

    // 人读消息：缺口段逐条点名（W0 本该当场看到的那句话）
    assert.match(r.message, /【判据覆盖对账（决策卡判据 vs 在册文件）】/);
    assert.match(r.message, /判据指册外：`src\/out\.ts`（来自决策卡 判据卡A\(card_a\)）——该文件在盘上\*\*存在\*\*/);
    assert.match(r.message, /判据指册外：`src\/ghost\.ts`.*该文件在盘上\*\*不存在\*\*/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-3 · 判据路径全部在册 ⇒ 缺口 0、消息无缺口段（反例）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0cover', project, {
      ledgerPaths: ['src/in.ts'],
      expectations: [
        { kind: 'file-exists', path: 'src/in.ts', why: '在册' },
        { kind: 'symbol-exists', path: 'src/in.ts', symbol: 'fin', why: '同文件在册' },
      ],
    });

    const r = await checkConsistencyReport({ feature: 'p0cover', code_dir: project });
    assert.equal(r.expectation_coverage.gap_count, 0);
    assert.doesNotMatch(r.message, /判据指册外/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
