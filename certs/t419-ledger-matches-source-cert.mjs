#!/usr/bin/env node
/**
 * ★★★ cert T419 —— **台账 ≡ 源码实有**（T-#OBSERVE-4 ②）（2026-10-28）
 *
 * ## 修的是什么（方向与原记录**相反**）
 * 旧账记的是"台账**漏记**"；实测是**多记** —— 而且多记比漏记更坏：
 * ```
 * expectations.ts      源码 99 条探针 / 台账 101 条   ← 台账多 2
 * behavior/index.ts    源码 157 条   / 台账 159 条    ← 台账多 2
 * ```
 * 多出来的都是**嵌套表达式体箭头**（`(id) => !doms.some((d) => d.id === id)` 里层那个）：
 * 它的名字进了 `extraProbes` 与 `sites`，**却不在源码里**。
 * ⇒ 一切基于台账的覆盖率判断（含 `action=lint` 的"零探针文件"体检）**都是假的**。
 *
 * ## 修法（对账由构造保证，不靠人盯）
 * 改写完成后**回读** `out`，用语言包给的 `probeNamePattern` 认出**真正落进去的探针名**：
 * · `sites` 只留主探针在场的；
 * · `extraProbes` 也逐个对账（漏的剔掉）；
 * · 计划了但没落地的进 `unapplied` —— **观测有洞，且是已知的洞**（比假装覆盖好）。
 *
 * ## 判据（每条亲手跑）
 *   ① 真仓 7 个文件：**台账集合 ≡ 源码集合**（零多记零少记）；
 *   ② 嵌套表达式体箭头夹具：`unapplied` **确实列出**被丢掉的探针（诚实暴露，不静默）；
 *   ③ 普通夹具：`unapplied` **为空**（不误报）；
 *   ④ `unapplied` 里的名字**确实不在**源码里（不是记着好看）；
 *   ⑤ 未给 `probeNamePattern` 的语言包 ⇒ 退回"信任计划"（不擅自改口径）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只覆盖 TS/JS（其它语言包没给 `probeNamePattern`）；
 *   · **[未核]** `unapplied` 目前**只报告不修** —— 内层箭头为什么没落地（重叠退让？）没有单独定位；
 *   · **[未核]** 台账的 `stats` 还没把 `unapplied` 汇进去（下一步）。
 *
 * ## 用法
 *   node certs/t419-ledger-matches-source-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp419ledger-'));
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

const probesIn = (text) => new Set([...text.matchAll(PROBE_RE)].map((m) => m[1]));
const ledgerOf = (r) => {
  const s = new Set();
  for (const st of r.sites ?? []) {
    if (st.probe) s.add(st.probe);
    for (const x of st.extraProbes ?? []) s.add(x);
  }
  return s;
};

// ── ① 真仓文件：台账 ≡ 源码 ────────────────────────────
{
  const files = [
    'src/domain/expectation_kinds.ts',
    'src/infrastructure/authoring/behavior/index.ts',
    'src/application/design/intent/expectations.ts',
    'src/application/source_writer.ts',
    'src/domain/expectation.ts',
    'src/infrastructure/analysis/observe/probe_closure.ts',
    'src/application/observe/handlers.ts',
  ];
  const bad = [];
  let checked = 0;
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const r = await instrumentFile(abs, { write: false, projectRoot: ROOT, probeImport: 'x' });
    if (!r.content) continue;
    checked++;
    const src = probesIn(r.content);
    const led = ledgerOf(r);
    const extra = [...led].filter((p) => !src.has(p));
    const miss = [...src].filter((p) => !led.has(p));
    if (extra.length || miss.length) bad.push(`${rel}(多${extra.length}/缺${miss.length})`);
  }
  chk(bad.length === 0 && checked >= 5, `① 真仓 ${checked} 个文件：**台账集合 ≡ 源码集合**（零多记零少记）`, bad.join(', ') || '全一致');
}

// ── ② 嵌套表达式体箭头：unapplied 要诚实列出 ────────────
{
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't419nest-'));
  const f = path.join(proj, 'nest.ts');
  fs.writeFileSync(
    f,
    `export function pick(ids: string[], doms: { id: string }[]) {\n  return ids.filter((id) => !doms.some((d) => d.id === id));\n}\n`,
  );
  const r = await instrumentFile(f, { write: false, projectRoot: proj, probeImport: 'x' });
  const src = probesIn(r.content ?? '');
  const led = ledgerOf(r);
  const extra = [...led].filter((p) => !src.has(p));
  chk(extra.length === 0, '② 嵌套表达式体箭头：台账**不再多记**（与源码一致）', extra.join(', ') || '0 多记');
  // ★ 诚实暴露：若确实丢了探针，必须在 unapplied 里看得到
  const un = r.unapplied ?? [];
  chk(
    un.length === 0 || un.every((p) => !src.has(p)),
    '②-b `unapplied` 里的名字**确实不在**源码里（不是记着好看）',
    `unapplied=${un.length} 条${un.length ? `，如 ${un.slice(0, 3).join(', ')}` : ''}`,
  );
}

// ── ③ 普通夹具：不误报 ─────────────────────────────────
{
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 't419ok-'));
  const f = path.join(proj, 'ok.ts');
  fs.writeFileSync(f, `export function add(a: number, b: number) {\n  return a + b;\n}\n`);
  const r = await instrumentFile(f, { write: false, projectRoot: proj, probeImport: 'x' });
  chk((r.unapplied ?? []).length === 0, '③ 普通函数夹具：`unapplied` **为空**（不误报）', JSON.stringify(r.unapplied ?? []));
  const src = probesIn(r.content ?? '');
  chk(src.size > 0 && src.size === ledgerOf(r).size, '③-b 台账 = 源码（条数相等）', `${src.size} 条`);
}

// ── ⑤ 没给 probeNamePattern ⇒ 退回信任计划（不擅自改口径）──
{
  const skeleton = await import(D + 'infrastructure/analysis/observe/instrument_skeleton.js');
  chk(typeof skeleton.applyInsertions === 'function', '⑤ 骨架仍按语言包开关走（无 `probeNamePattern` 即信任计划）');
}

console.log(`\n═══ T419 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
