#!/usr/bin/env node
/**
 * ★★★ cert T420 —— **嵌套表达式体箭头也被插桩**（T-#OBSERVE-4 ② 的根因修复）（2026-10-28）
 *
 * ## 根因（比"台账多记"更深一层）
 * `ids.filter((id) => !doms.some((d) => d.id === id))` 里**内层箭头**永远拿不到探针。
 * 追下去发现：表达式体箭头的替换**只给了 `injected`（重贴原文表达式）而没给 `template`** ⇒
 * `applyInsertions` 递归算好的**内层编辑被直接丢弃**（实测 `hasTemplate=false innerCount=1`）。
 * ⇒ 修法：给该 site 一个 `template`，用 `inner`（已含内层改造的表达式）重建整个 body。
 *
 * ★ 修的时候自己踩了一个坑，也值一条判据：模板**不能复用 `stmts` 下标** ——
 *   里面既有探针行也有 `const tv = (原式)` 行，错位会生成**重复声明**
 *   （`const __cam_arrow2C40 = …` 两次 ⇒ `SyntaxError: Identifier has already been declared`）。
 *   ⇒ 现在只用**探针行**与 `inner` 重建。
 *
 * ## 判据（每条亲手跑）
 *   ① 嵌套箭头：**内外两层都插上了**（4 条探针齐），`unapplied` 为空；
 *   ② 生成的代码**可执行**（真跑 node），且**行为不变**（输出与源码一致）；
 *   ③ **无重复声明**（同一个临时变量名只出现一次）—— 我上一版就栽在这；
 *   ④ 块体箭头 / 普通函数**不受影响**（回归：探针数一致、`unapplied` 空）；
 *   ⑤ 真仓 7 文件：台账≡源码 **且 `unapplied` 为空**（说明"已知的洞"已经补上）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 TS/JS 的表达式体箭头；其它语言包没有 `probeNamePattern` 也没有这条 `template`；
 *   · **[未核]** "三层以上嵌套箭头"只做了推理（递归天然支持），没有专证；
 *   · **[未核]** `AGENT_IO_INSTRUMENT_DEBUG=1` 的两处调试打印是长期保留还是移除，未定。
 *
 * ## 用法
 *   node certs/t420-nested-arrow-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp420arrow-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { instrumentFile } = await import(D + 'infrastructure/analysis/observe/instrument.js');
const PROBE_RE = /captureProbe\(\s*["'`]([^"'`]+)["'`]/g;
const probesIn = (t) => [...new Set([...t.matchAll(PROBE_RE)].map((m) => m[1]))];

// ── ① 嵌套箭头：内外都插 ────────────────────────────────
const proj = fs.mkdtempSync(path.join(TMP, 'nest-'));
fs.writeFileSync(path.join(proj, 'probe.mjs'), 'export function captureProbe() {}\nexport function enterScope() {}\nexport function exitScope() {}\n');
const f = path.join(proj, 'demo.mjs');
const src = `export function pick(ids, doms) {
  return ids.filter((id) => !doms.some((d) => d.id === id));
}
console.log('OUT', JSON.stringify(pick(['a','b','c'], [{ id: 'b' }])));
`;
fs.writeFileSync(f, src);
const r = await instrumentFile(f, { write: false, projectRoot: proj, probeImport: './probe.mjs' });
const out = r.content ?? '';
const probes = probesIn(out);
{
  const inner = probes.filter((p) => p.includes('C40'));
  const outer = probes.filter((p) => p.includes('C21'));
  chk(inner.length === 2 && outer.length === 2, '① 嵌套箭头**内外两层都插上了**（各 enter + exit）', probes.join(', '));
  chk((r.unapplied ?? []).length === 0, '①-b `unapplied` 为空（没有"计划了却没落地"的探针）', JSON.stringify(r.unapplied ?? []));
}

// ── ② 可执行 + 行为不变 ─────────────────────────────────
{
  fs.writeFileSync(f, out);
  let ok = false;
  let stdout = '';
  try {
    stdout = execFileSync(process.execPath, [f], { encoding: 'utf8', timeout: 60_000 }).trim();
    ok = true;
  } catch (e) {
    stdout = String(e.stderr ?? '') + String(e.message ?? '');
  }
  chk(ok, '② 生成的代码**可执行**（真跑 node）', ok ? '' : stdout.slice(0, 200));
  chk(stdout === 'OUT ["a","c"]', '②-b **行为不变**（嵌套箭头改写后结果正确）', stdout.slice(0, 120));
}

// ── ③ 无重复声明（我上一版栽的地方）─────────────────────
{
  const names = [...out.matchAll(/const (__cam_arrow[\w]+) =/g)].map((m) => m[1]);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  chk(dup.length === 0, '③ **无重复声明**（同一临时变量名只出现一次 —— 上一版模板错位就栽在这）', dup.length ? `重复：${[...new Set(dup)].join(', ')}` : `临时变量 ${names.length} 个，无重复`);
}

// ── ④ 块体箭头 / 普通函数不受影响 ───────────────────────
{
  const p2 = fs.mkdtempSync(path.join(TMP, 'block-'));
  const f2 = path.join(p2, 'b.ts');
  fs.writeFileSync(f2, `export const m = (x: number) => { return x + 1; };\nexport function plain(a: number) { return a; }\n`);
  const r2 = await instrumentFile(f2, { write: false, projectRoot: p2, probeImport: 'x' });
  const pr2 = probesIn(r2.content ?? '');
  chk(pr2.length >= 4 && (r2.unapplied ?? []).length === 0, '④ 块体箭头 / 普通函数**不受影响**（探针齐、无 unapplied）', pr2.join(', '));
}

// ── ⑤ 真仓：台账≡源码 且无已知的洞 ──────────────────────
{
  const files = [
    'src/application/design/intent/expectations.ts',
    'src/infrastructure/authoring/behavior/index.ts',
    'src/application/observe/handlers.ts',
    'src/domain/expectation.ts',
  ];
  const holes = [];
  let checked = 0;
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const rr = await instrumentFile(abs, { write: false, projectRoot: ROOT, probeImport: 'x' });
    if (!rr.content) continue;
    checked++;
    if ((rr.unapplied ?? []).length) holes.push(rel + ' : ' + rr.unapplied.length);
  }
  chk(checked >= 3 && holes.length === 0, `⑤ 真仓 ${checked} 文件：` + '`unapplied` **为空**（已知的洞补上了）', holes.join(', ') || '无洞');
}

console.log(`\n═══ T420 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
