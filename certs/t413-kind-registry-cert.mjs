#!/usr/bin/env node
/**
 * ★★★ cert T413 —— **判据 kind 注册表：单一事实源**（T-#KIND-1）（2026-10-28）
 *
 * ## 这条证钉的是"结构"，不是某个行为
 * 加一个 kind 原来要动 **5 个文件 / `expectation.ts` 里 8 处 / schema 里 2 处**，
 * 一天加 3 个 kind ⇒ 同一套手工同步做三遍，且**漏过一次文档**（判据表写 10 种、实际 12）。
 *
 * 现在的事实源 = `src/domain/expectation_kinds.ts#KIND_SPECS`，由它派生：
 * 名字清单 · 形状校验 · 人读渲染 · 主体路径 · **JSON Schema 的两个 anyOf**。
 *
 * ## 判据（每条亲手跑）
 *   ① `EXPECTATION_KINDS` 与注册表**键集合完全相等**（不是"差不多"）；
 *   ② `schema/design_dsl.schema.json` 的两处判据联合体与注册表**一致**（跑 `--check`）；
 *   ③ `docs/GUIDE-GATE.md` 的判据表**列出每一个 kind**（文档同步从"靠人记"变成"证会红"）；
 *   ④ 形状校验**由注册表派生**：每个 kind 给一条坏样本 ⇒ 全被拒，且报错**带 kind 名**；
 *   ⑤ 每个 kind 的 `render` 都**不抛且非空**；
 *   ⑥ ★ **结构性证据**：`describeExpectation` 源码里**不再有**逐 kind 的 `case '…'` 分支
 *      （原来 12 分支 = 一处必忘的补丁式；现在它只是一行委托）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 不证求值器——它**故意**保留一处 `switch`（要 fs/db，属 application 层），且由**编译器**兜底：
 *     新增 kind 而求值器不处理 ⇒ `tsc` 报 `never` 不收；
 *   · **[未核]** 证据联合体（`expectations`/`reading`/`attestation`）没被误改 —— 本证只在 ② 间接覆盖
 *     （若被覆掉，`--check` 会红，因为内容会与磁盘不同）。
 *
 * ## 用法
 *   node certs/t413-kind-registry-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp413reg-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { EXPECTATION_KINDS } = await import(D + 'domain/expectation.js');
const { KIND_SPECS, validateExpectation, renderExpectation } = await import(D + 'domain/expectation_kinds.js');

const registryKinds = Object.keys(KIND_SPECS).sort();
const kindsFromFile = [...EXPECTATION_KINDS].sort();

// ── ① 名字清单 = 注册表键集合 ───────────────────────────
chk(
  JSON.stringify(registryKinds) === JSON.stringify(kindsFromFile),
  `① \`EXPECTATION_KINDS\` 与注册表**完全相等**（${registryKinds.length} 种）`,
  registryKinds.join(', '),
);

// ── ② schema 与注册表一致 ──────────────────────────────
{
  let ok = false;
  let out = '';
  try {
    out = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/gen-expectation-schema.mjs', '--check'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    ok = true;
  } catch (e) {
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
    ok = false;
  }
  chk(ok, '② schema 的**两处**判据联合体与注册表一致（`gen-expectation-schema --check`）', out.trim().split('\n').pop()?.slice(0, 150) ?? '');
}

// ── ③ 文档列出每个 kind ────────────────────────────────
{
  const doc = fs.readFileSync(path.join(ROOT, 'docs/GUIDE-GATE.md'), 'utf8');
  const missing = registryKinds.filter((k) => !doc.includes(`\`${k}\``));
  chk(missing.length === 0, '③ `GUIDE-GATE.md` 判据表**列出每一个 kind**（文档同步由证兜底）', missing.length ? `缺：${missing.join(', ')}` : `12/${registryKinds.length} 齐`);
}

// ── ④ 坏样本逐 kind 被拒（校验派生）───────────────────
{
  const bads = {
    'file-exists': { kind: 'file-exists', why: 'x' },
    'symbol-exists': { kind: 'symbol-exists', path: 'a.ts', why: 'x' },
    'signature-matches': { kind: 'signature-matches', path: 'a.ts', symbol: 'f', why: 'x' },
    'edge-exists': { kind: 'edge-exists', from: 'a.ts', why: 'x' },
    'edge-absent': { kind: 'edge-absent', from: 'a.ts', why: 'x' },
    'call-exists': { kind: 'call-exists', path: 'a.ts', symbol: 'f', why: 'x' },
    run: { kind: 'run', why: 'x' },
    'source-has': { kind: 'source-has', path: 'a.ts', why: 'x' }, // 缺 must/mustNot
    'behavior-cases': { kind: 'behavior-cases', path: 'a.ts', symbol: 'f', cases: [], why: 'x' }, // 空 cases
    'domain-independent': { kind: 'domain-independent', domain: 'parse', must_not_import: [], why: 'x' },
    cert: { kind: 'cert', why: 'x' },
    runtime: { kind: 'runtime', why: 'x' },
  };
  const notRejected = [];
  const noKindInMsg = [];
  for (const k of registryKinds) {
    const problem = validateExpectation(bads[k]);
    if (!problem) notRejected.push(k);
    else if (!String(problem).includes(k)) noKindInMsg.push(`${k}→"${problem}"`);
  }
  chk(notRejected.length === 0, '④ 每个 kind 的坏样本**都被拒**（形状校验由注册表派生）', notRejected.length ? `漏放：${notRejected.join(', ')}` : `${registryKinds.length}/${registryKinds.length}`);
  chk(noKindInMsg.length === 0, '④-b 报错**带 kind 名**（用户才知道自己写坏的是哪条）', noKindInMsg.join('; ') || '全部带名');
}

// ── ⑤ render 对每个 kind 都能出人读一行 ────────────────
{
  const samples = {
    'file-exists': { kind: 'file-exists', path: 'a.ts' },
    'symbol-exists': { kind: 'symbol-exists', path: 'a.ts', symbol: 'f' },
    'signature-matches': { kind: 'signature-matches', path: 'a.ts', symbol: 'f', signature: '() => void' },
    'edge-exists': { kind: 'edge-exists', from: 'a.ts', to: 'b.ts' },
    'edge-absent': { kind: 'edge-absent', from: 'a.ts', to: 'b.ts' },
    'call-exists': { kind: 'call-exists', path: 'a.ts', symbol: 'f', target: 'g' },
    run: { kind: 'run', expect: 'input.x > 0' },
    'source-has': { kind: 'source-has', path: 'a.ts', must: ['x'] },
    'behavior-cases': { kind: 'behavior-cases', path: 'a.ts', symbol: 'f', cases: [{ given: [1], expect: '2' }] },
    'domain-independent': { kind: 'domain-independent', domain: 'parse', must_not_import: ['edit'] },
    cert: { kind: 'cert', cert: 't405', case: '①' },
    runtime: { kind: 'runtime', probe: 'fn.exit', expect: 'ok' },
  };
  const bad = [];
  for (const k of registryKinds) {
    try {
      const line = renderExpectation(samples[k]);
      if (!line || !line.includes(k)) bad.push(`${k}→"${line}"`);
    } catch (e) {
      bad.push(`${k}→抛错 ${String(e && e.message)}`);
    }
  }
  chk(bad.length === 0, '⑤ 每个 kind 的 `render` **不抛且含 kind 名**', bad.join('; ') || `${registryKinds.length}/${registryKinds.length}`);
}

// ── ⑥ 结构性证据：describeExpectation 里不再有逐 kind 分支 ─
{
  const src = fs.readFileSync(path.join(ROOT, 'src/domain/expectation.ts'), 'utf8');
  const start = src.indexOf('export function describeExpectation(');
  const body = src.slice(start, src.indexOf('\n}', start) + 2);
  const cases = (body.match(/case '/g) ?? []).length;
  chk(cases === 0, '⑥ `describeExpectation` 里**不再有**逐 kind 的 `case` 分支（原来 12 个 = 一处必忘的补丁式）', `实测 case 数：${cases}`);
  chk(/renderBySpec|return renderExpectation\(/.test(body), '⑥-b 它现在只是一行**委托**给注册表');
}

console.log(`\n═══ T413 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
