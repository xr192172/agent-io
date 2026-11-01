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
import { writeRewritePlan, type RewritePlan } from '../src/application/design/db/rewrite_plan.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import type { DesignDSL } from '../src/domain/types.js';

/**
 * ★ 2026-10-30（补前置，不动断言）：2026-10-28 起「重写计划闸」**默认严格档** ⇒ 没有
 * `plan/<rel>.plan.json` 的写源码请求会**在落盘前被拒**（`write_gate.ts#assertSourceWriteRegistered`）。
 * 本证要验的是"新建文件未入册"的**警告**，所以必须先把**每一道写门前置**补齐 —— 4 条断言原文一字不改。
 */
function writePlan(project: string, rel: string, symbol: string): void {
  // ★ 2026-11-02（subagent:canvas-db）：画布已入库（`tasks.db#plans`）—— 不再有盘上的 `.plan.json`
  writeRewritePlan(project, {
    path: rel,
    entries: [
      { anchor: { symbol }, kind: 'create', detail: `新建 ${symbol}（本证只验入册警告）`, judgement_ref: 'decision:probe_node#0', status: 'open' },
    ],
  } as RewritePlan);
}

/** 落一份带 semantic.files 的设计册（source_root 指向给定项目根） */
function writeSheet(home: string, feature: string, sourceRoot: string, ledgerPaths: string[]): void {
  // ★ 画布的 judgement_ref 必须能解到一条**语义类**判据（存在类会被计划闸点名为"永远发现不了逻辑错"）：
  //   这里放一条 call-exists（probe 调 helper），它只用来解开画布，**不参与本证的任何断言**。
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, 'src', 'probe.ts'),
    'export function helper() { return 1; }\nexport function probe() {\n  return helper();\n}\n',
    'utf-8',
  );
  const dsl: DesignDSL = {
    feature,
    title: feature,
    source_root: sourceRoot,
    geometry: {
      nodes: [
        { id: 'svc_1', label: 'svc', type: 'service', x: 0, y: 0 },
        // 文件节点声明豁免：本证只验"入册警告"，不验任务闸（否则在册路径会被任务闸拦下）
        ...ledgerPaths.map((p, i) => ({ id: `f${i}`, label: p, type: 'file', path: p, x: 0, y: 0, gate: 'exempt' as const })),
        {
          id: 'probe_node',
          label: 'probe',
          type: 'service',
          x: 0,
          y: 0,
          decision: {
            expectations: [
              { kind: 'call-exists', path: 'src/probe.ts', symbol: 'probe', target: 'helper', why: '画布锚点：probe 调 helper（存在类判据解不开画布）' },
            ],
          },
        },
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
    writePlan(project, 'src/brand_new.ts', 'hello');

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
    writePlan(project, 'src/known.ts', 'hello');

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
