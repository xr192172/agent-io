/**
 * P1 · 接线账的**消费者事实**三格（2026-11-09）
 *
 * touches: src/infrastructure/analysis/health/wiring_enumerate.ts, src/application/design/db/wiring_triage.ts
 *
 * 为什么要有这支：账上"域有没有消费者"原先数的是**设计册里有没有节点**（"被登记"当成"被消费"），
 * 而且路径串拼自 `declared` 文本、拼不到就是空串 ⇒ 一律计 0，本仓 37 条域声明全被误判
 * 成 `missing-consumer`。修法是**接三个可核查的事实**：
 *   ① `src/|tests/|scripts/` 里**相对 import 解析后**落进该域的**域外**文件数（剥 `dist/` 前缀）；
 *   ② `package.json` 的 `bin` / `scripts` 里指向的构建产物目录；
 *   ③ 同名入口脚本 `scripts/<域id>.mjs` 存在且被 npm scripts 引用（覆盖**动态加载**：静态 import 正则看不见）。
 *
 * ★ 每一格都必须**能红**：把对应事实删掉 ⇒ 该域必须回到 `missing-consumer`（不是"永远绿"的读数）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { collectAllWiringProbes } from '../src/infrastructure/analysis/health/wiring_enumerate.js';
import { buildWiringLedger } from '../src/infrastructure/analysis/health/wiring_ledger.js';

/** 最小仓库：一个 `role=capability` 的域 `src/demo`，外部消费者可选 */
function mkRepo(opts: { importer?: boolean; scripts?: Record<string, string>; bin?: unknown; scriptFile?: boolean }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wir-cells-'));
  fs.mkdirSync(path.join(root, 'src', 'demo'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'structure.domains.json'),
    JSON.stringify({ domains: [{ id: 'demo', layer: 'application', role: 'capability', dir: 'src/demo', note: '夹具' }] }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'wir-cells', version: '1.0.0', ...(opts.bin ? { bin: opts.bin } : {}), scripts: opts.scripts ?? {} }, null, 2),
  );
  fs.writeFileSync(path.join(root, 'src', 'demo', 'index.ts'), 'export function demo(): number {\n  return 1;\n}\n');
  if (opts.importer) {
    // ★ 关键：**相对** specifier（真实写法），不是全仓路径
    fs.writeFileSync(path.join(root, 'src', 'user.ts'), "import { demo } from './demo/index.js';\nconsole.log(demo());\n");
  }
  if (opts.scriptFile) fs.writeFileSync(path.join(root, 'scripts', 'demo.mjs'), 'export {};\n');
  return root;
}

function statusOf(root: string, subject: string): { status: string; consumer: string } {
  const { probes } = collectAllWiringProbes(root);
  const e = buildWiringLedger(probes).find((x) => x.subject === subject);
  assert.ok(e, `台账里必须有 ${subject}（实测：${buildWiringLedger(probes).map((x) => x.subject).join(', ')}）`);
  return { status: e.status, consumer: e.evidence.find((v) => v.includes('consumer')) ?? '' };
}

test('P1-wiring-cells · ① 相对 import 解析（含 dist 前缀）能算进消费者；删掉 import 必须回到 missing-consumer', () => {
  const withImp = mkRepo({ importer: true });
  try {
    const got = statusOf(withImp, 'domain:demo');
    assert.equal(got.status, 'static-only', `有域外 importer ⇒ 不该再是 missing-consumer（实测 ${got.status} / ${got.consumer}）`);
    assert.match(got.consumer, /文件数 = 1/, `必须数到 1 个域外消费者：${got.consumer}`);
  } finally {
    fs.rmSync(withImp, { recursive: true, force: true });
  }
  // ★ 反例：同一个仓库删掉那支 importer ⇒ 必须**变回** missing-consumer
  const without = mkRepo({ importer: false });
  try {
    const got = statusOf(without, 'domain:demo');
    assert.equal(got.status, 'missing-consumer', `删掉 importer 后必须变回 missing-consumer（实测 ${got.status} / ${got.consumer}）`);
    assert.match(got.consumer, /文件数 = 0/, `必须如实报 0：${got.consumer}`);
  } finally {
    fs.rmSync(without, { recursive: true, force: true });
  }
});

test('P1-wiring-cells · ② package.json 的 bin/scripts 指向该域 ⇒ 进程外入口也算消费者', () => {
  const root = mkRepo({ scripts: { demo: 'node dist/src/demo/cli.js' } });
  try {
    const got = statusOf(root, 'domain:demo');
    assert.equal(got.status, 'static-only', `入口脚本指向该域 ⇒ 不算"没人消费"（实测 ${got.status} / ${got.consumer}）`);
    assert.match(got.consumer, /进程外入口/, `证据必须点明是入口：${got.consumer}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('P1-wiring-cells · ③ 同名入口脚本（动态加载，静态 import 看不见）⇒ 也算消费者；脚本不存在则不算', () => {
  const withScript = mkRepo({ scripts: { demo: 'node scripts/demo.mjs' }, scriptFile: true });
  try {
    const got = statusOf(withScript, 'domain:demo');
    assert.equal(got.status, 'static-only', `同名入口脚本存在 ⇒ 必须认（实测 ${got.status} / ${got.consumer}）`);
    assert.match(got.consumer, /同名入口脚本/, `证据必须点明是哪一格：${got.consumer}`);
  } finally {
    fs.rmSync(withScript, { recursive: true, force: true });
  }
  // ★ 反例：npm scripts 写了、但**文件不存在** ⇒ 不许认（否则就是编事实）
  const missingFile = mkRepo({ scripts: { demo: 'node scripts/demo.mjs' }, scriptFile: false });
  try {
    const got = statusOf(missingFile, 'domain:demo');
    assert.equal(got.status, 'missing-consumer', `脚本文件不存在时不许认入口（实测 ${got.status} / ${got.consumer}）`);
  } finally {
    fs.rmSync(missingFile, { recursive: true, force: true });
  }
});
