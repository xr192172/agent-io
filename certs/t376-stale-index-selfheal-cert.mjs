#!/usr/bin/env node
/**
 * ★★★ cert T376 —— **索引陈旧造成的"假红"自愈**（2026-10-27 · 用户问「这个坑不能修吗」）
 *
 * ## 坑是什么
 * `call-exists` / `edge-*` **只能读派生索引**（符号能现解析，依赖边不能）。索引一陈旧，
 * `indexStaleFor` 就返回"判不了"⇒ 判据落 `unsupported` ⇒ 而 D6 的判据是 `unsupported === 0`
 * ⇒ 表现成 **"接线断了"**。实测踩过：改完符号没重扫，`gate` 直接红，我差点去改对的代码。
 *
 * ## 修法
 * `judgeExpectations` 在判之前先 `ensureIndexFreshForJudge`：
 *   ① 便宜探测（只算**目标文件**的内容 hash，不扫全仓）—— 不陈旧就一次都不刷；
 *   ② 陈旧 ⇒ `ensureFreshIndex` 增量刷新（mtime/size 先筛 + content_hash 二道闸）；
 *   ③ 刷新失败 / 仍判不了 ⇒ **保持 unsupported 如实报**（仍然红，但红得有理）。
 *
 * ## 判据（每条亲手跑）
 *   ① 索引**新鲜**时：`call-exists` 直接 pass（不该被自愈逻辑干扰）；
 *   ② 把源码改到索引**落后**（新增一次调用）⇒ **不刷新时**判 `unsupported`（复现坑）；
 *   ③ 同一场景走 `judgeExpectations` ⇒ **自动刷新后 pass**（坑被填掉）；
 *   ④ 自愈**不会**把"真的不存在"变成通过：期望一个源码里根本没有的符号 ⇒ 仍 `fail`。
 *
 * ## 用法
 *   node certs/t376-stale-index-selfheal-cert.mjs      # ★ 先 npm run build
 *
 * touches: src/application/design/intent/expectations.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp376stale-'));
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
process.env.AGENT_IO_HOME = HOME;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const w = (rel, text) => {
  const p = path.join(PROJ, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text, 'utf-8');
};

// 夹具：callee 定义 helper，caller 调它
w('src/callee.ts', 'export function helper(): number {\n  return 1;\n}\n');
w('src/caller.ts', "import { helper } from './callee.js';\n\nexport function useIt(): number {\n  return helper();\n}\n");
w('package.json', JSON.stringify({ name: 'fixture', type: 'module' }, null, 2));

const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const { judgeExpectations, indexStaleFor } = await import('../dist/src/application/design/intent/expectations.js');

await importProject({ project_dir: PROJ, feature: 't376stale' });

// ★ `call-exists` 的形状 = { path, symbol(调用方), target(被调), why }
const callExpectation = {
  kind: 'call-exists',
  path: 'src/caller.ts',
  symbol: 'useIt',
  target: 'helper',
  why: 'useIt 必须调用 helper（T376 夹具）',
};
const items = [{ node_id: 'src/caller.ts', node_label: 'caller', expectation: callExpectation }];

// ── ① 索引新鲜 ⇒ 直接 pass ───────────────────────────────
{
  const rep = await judgeExpectations(PROJ, items);
  const v = rep.items[0]?.verdict;
  chk(v === 'pass', '① 索引新鲜 ⇒ `call-exists` 直接 pass', `verdict=${v} · detail=${String(rep.items[0]?.detail ?? '').slice(0, 80)}`);
}

// ── ② 复现坑：改源码让索引落后 ⇒ 不刷新就 "判不了" ─────────
w('src/caller.ts', "import { helper } from './callee.js';\n\nexport function useIt(): number {\n  const a = helper();\n  return a + helper();\n}\n");
{
  const staleMsg = indexStaleFor(PROJ, ['src/caller.ts']);
  chk(!!staleMsg, '②-a 改完源码后 `indexStaleFor` 认得出"索引落后"', String(staleMsg ?? '').slice(0, 90) + '…');
  chk(
    String(staleMsg ?? '').includes('索引与源码不一致'),
    '②-b 提示语点明根因（不是"接线断了"）',
  );
}

// ── ③ 走 judgeExpectations ⇒ 自动刷新后 pass（坑被填）──────
{
  const rep = await judgeExpectations(PROJ, items);
  const v = rep.items[0]?.verdict;
  chk(v === 'pass', '③ 自愈：陈旧索引被**先刷新**，同一判据变 pass', `verdict=${v}`);
  const after = indexStaleFor(PROJ, ['src/caller.ts']);
  chk(after === null, '③-b 判完之后索引已与源码一致', `stale=${after ?? 'null（一致）'}`);
}

// ── ④ 自愈不会把"真不存在"变成通过 ───────────────────────
{
  const bogus = [
    {
      node_id: 'src/caller.ts',
      node_label: 'caller',
      expectation: { kind: 'call-exists', path: 'src/caller.ts', symbol: 'useIt', target: 'noSuchSymbolAnywhere', why: 'T376 反例' },
    },
  ];
  const rep = await judgeExpectations(PROJ, bogus);
  const v = rep.items[0]?.verdict;
  chk(v !== 'pass', '④ 期望一个不存在的符号 ⇒ 仍 **不通过**（自愈只修索引，不修事实）', `verdict=${v}`);
}

console.log(`\n═══ T376 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
