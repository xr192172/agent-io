/**
 * P0 保鲜链 · 第 2 环：detect_drift **scope=changed 的存量缺口显式声明**。
 *
 * W0 实测的病：scope=changed 是默认值，但此前回执不说"其余 M 个在册文件没判"，
 * 沉默被读成"查过、没事"。本证锁定：changed 态回执含 N/M 声明行 + 机读字段；
 * scope=all 不出该行（全量没有存量缺口）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectDrift } from '../src/application/design/intent/detect_drift.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

function writeSheet(home: string, feature: string, sourceRoot: string, ledgerPaths: string[]): void {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: { nodes: [{ id: 'svc_1', label: 'svc', type: 'service', x: 0, y: 0 }], edges: [] },
    semantic: { files: ledgerPaths.map((p, i) => ({ id: `f${i}`, path: p })) },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

function makeProject(): string {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p02-proj-'));
  fs.writeFileSync(path.join(project, 'a.ts'), 'export function fa(): number {\n  return 1;\n}\n', 'utf-8');
  fs.writeFileSync(path.join(project, 'b.ts'), 'export function fb(): number {\n  return 2;\n}\n', 'utf-8');
  return project;
}

test('P0-2 · scope=changed ⇒ 回执显式声明「仅判 N 变更文件；其余 M 个在册文件未判存量漂移」', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0drift', project, ['a.ts', 'b.ts']);

    const r = await detectDrift({
      feature: 'p0drift',
      code_dir: project,
      scope: 'changed',
      changed_files: ['a.ts'],
    });
    assert.match(r.message, /作用域声明：本次仅判 git 变更 1 文件；其余 1 个在册文件未判存量漂移——全量请 scope=all/);
    assert.equal(r.scope.unchecked_ledger_files, 1);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-2 · scope=all ⇒ 无存量缺口声明（全量没有"没判的"）', async () => {
  const home = makeTempHome();
  const project = makeProject();
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0drift', project, ['a.ts', 'b.ts']);

    const r = await detectDrift({ feature: 'p0drift', code_dir: project, scope: 'all' });
    assert.doesNotMatch(r.message, /作用域声明/);
    assert.equal(r.scope.unchecked_ledger_files, 0);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
