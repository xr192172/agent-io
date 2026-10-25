/**
 * P0 保鲜链 · 第 1 环：**新建文件自动提议入册**（只警告、不自动入册）。
 *
 * W0 实测的病：edit_code op=insert 在盘上新建的文件不在设计册 `semantic.files`
 * ⇒ 判据/对账覆盖不到它，而这件事没有任何机制报出。
 * 本证锁定：① 新建 + 有册指向 + 不在册 ⇒ 回执含「新文件未入册」+ 一键入参示例；
 *          ② 在册 ⇒ 不加噪声；③ 项目根上没有设计册 ⇒ 不加噪声（无册谈不上册外）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { editCode } from '../src/application/refactor/edit/edit_code.js';
import { newFileLedgerWarning } from '../src/application/design/ledger_membership.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

/** 落一份带 semantic.files 的设计册（source_root 指向给定项目根） */
function writeSheet(home: string, feature: string, sourceRoot: string, ledgerPaths: string[]): void {
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: {
      nodes: [
        { id: 'svc_1', label: 'svc', type: 'service', x: 0, y: 0 },
        // 文件节点声明豁免：本证只验"入册警告"，不验任务闸（否则在册路径会被任务闸拦下）
        ...ledgerPaths.map((p, i) => ({ id: `f${i}`, label: p, type: 'file', path: p, x: 0, y: 0, gate: 'exempt' as const })),
      ],
      edges: [],
    },
    semantic: { files: ledgerPaths.map((p, i) => ({ id: `f${i}`, path: p })) },
    todos: [],
  } as unknown as DesignDSL;
  const dir = path.join(home, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${feature}.dsl.json`), JSON.stringify(dsl, null, 2), 'utf-8');
}

const HELLO_TS = 'export function hello(): number {\n  return 1;\n}\n';

test('P0-1 · 新建文件不在册 ⇒ 回执含「新文件未入册」警告段 + 一键入参示例', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p01-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    writeSheet(home, 'p0ledger', project, ['src/known.ts']);

    const r = await editCode({
      project_dir: project,
      file: 'src/brand_new.ts',
      op: 'insert',
      code: HELLO_TS,
    });
    assert.match(r.message, /新文件未入册：`src\/brand_new\.ts`/);
    assert.match(r.message, /edit_dsl .*type:'file', op:'add'/);
    assert.match(r.message, /responsibility/);
    // 一键示例里的 path 是本文件的仓库相对口径
    assert.match(r.message, /path:'src\/brand_new\.ts'/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-1 · 路径已在册 ⇒ 不加噪声（回执无警告段）', async () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p01-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    // 册里先列好这个路径（人已入册，文件此刻才落盘是合法顺序）
    writeSheet(home, 'p0ledger', project, ['src/known.ts']);

    const r = await editCode({
      project_dir: project,
      file: 'src/known.ts',
      op: 'insert',
      code: HELLO_TS,
    });
    assert.match(r.message, /已创建 src\/known\.ts/);
    assert.doesNotMatch(r.message, /新文件未入册/);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});

test('P0-1 · 项目根上没有设计册指向 ⇒ helper 返回 null（无册谈不上册外）', () => {
  const home = makeTempHome();
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-p01-proj-'));
  try {
    process.env.AGENT_IO_HOME = home;
    // 另一个项目根的册不覆盖本项目
    writeSheet(home, 'elsewhere', path.join(os.tmpdir(), 'agentio-p01-other'), ['x.ts']);
    assert.equal(newFileLedgerWarning(project, 'src/new.ts'), null);
  } finally {
    rmRf(home);
    rmRf(project);
  }
});
