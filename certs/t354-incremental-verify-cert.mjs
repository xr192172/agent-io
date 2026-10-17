#!/usr/bin/env node
/**
 * ★★★ cert T354 —— **增量验证入口真的"改哪跑哪"**（2026-10-17 · `task_plan.incremental_verify` · B.5）。
 *
 * ## 本笔新增的**方向**（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ★ `scripts/verify-changed.mjs` = **与 `certs/run-all-certs.mjs` 并列的增量入口**：
 *     改一个文件时，它只算并只跑「**契约 `path` 命中**」+「**证 `touches` 命中**」那一小撮。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **空集是真的空**：给一个**什么都没命中**的文件 ⇒ 契约 0 / 证 0，且 `--no-run` 一张都不跑；
 *      ★ 反过来说：若它把"全部 64 张"当成结果，这条**当场红**（这正是要防的退化）；
 *   ② **契约那一路命中**：`src/application/design/dsl_ops/task_ops.ts` ⇒ 列出**带 node_id + 摘要 + path**
 *      的期望（★ 实测 7 条），且**每条 path 里都有这个改动文件**（不是"列了一堆无关的"）；
 *   ③ ★★ **自洽**：拿 `scripts/verify-changed.mjs`（**本笔新增的文件**）当改动 ⇒ 它**自己**算出
 *      「命中 `t354`」（`touches` 那一路）；若算不出 ⇒ 规则有洞，本证红；
 *   ④ **不该跑的没跑**：改 `write_gate.ts` ⇒ 与它无关的 `t136-unused-export-cert.mjs` **不在**命中里；
 *      且命中数 **≤ 5**（设计判据），并**如实打印**它现在算出几张（现状 = 0，见 ⑦）；
 *   ⑤ ★★ **"自己坏"的对照**：`src/domain/task_machine.ts.bak` ⇒ **必须 0 条**。
 *      若有人把匹配写成 `includes()`（子串），这个"备份文件"会命中 `task_machine.ts` 的 7 条 ⇒ ⑤ 红；
 *   ⑥ **路径口径**：传**绝对路径** ⇒ 归一到仓库相对，仍命中同一批（不然 Windows 上必然错）；
 *   ⑦ **git 模式**：不传参数 ⇒ 有数（数组）、`--no-run` 下 `ran.certs` 为空；且**任何**一次的命中里
 *      **都不含 `run-all-certs.mjs`**（★ 本入口不许偷偷跑全量）；
 *   ⑧ **现状如实**：改 `write_gate.ts` 现在算出 **0 张证 / 0 条契约** —— 本证**不假装它命中**，
 *      而是把"这是洞"（`task_plan.touches_gap`）当场打出来。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **退出码 1 的红线未证 [未核]**：要造一张会红的证得往仓里写文件（本证不写盘）；
 *     `red ⇒ exit 1` 这段只有静态读法（`process.exit(red ? 1 : 0)`）；
 *   · **`touches` 覆盖率未证 [未核]**：全仓只有本证声明了 `touches` ⇒ 第③路的"多张"分支测不到；
 *   · **契约判定器要 dist [未核]**：沿用 `npm run build` 的产物，本证不自己造第二把尺；
 *   · **未跑全量**：本证按本笔铁律**不跑** `run-all-certs.mjs`，只验增量入口本身。
 *
 * ## 用法
 *   node certs/t354-incremental-verify-cert.mjs     # 只读仓内 docs/ certs/ git，不写盘
 *
 * touches: scripts/verify-changed.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..').replace(/\\/g, '/');
const TOOL = `${REPO}/scripts/verify-changed.mjs`;
const SELF = path.basename(fileURLToPath(import.meta.url));

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** ★ 一律 `--json --no-run`：① 断言要机器可读；② 免得本证 → 工具 → 本证 自己调自己 */
function runTool(args) {
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [TOOL, '--json', '--no-run', ...args], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    rc = typeof e.status === 'number' ? e.status : -1;
    out = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  let j = null;
  try {
    j = JSON.parse(out.trim().split('\n').filter(Boolean).pop());
  } catch {
    j = null;
  }
  return { rc, j, raw: out };
}

const files = (r) => (r.j?.certs ?? []).map((c) => c.file);

// ── ① 空集 ──
{
  const r = runTool(['src/__t354_nothing_here__.ts']);
  chk(
    !!r.j && r.j.changed.length === 1 && r.j.expectations.length === 0 && r.j.certs.length === 0 && r.j.nothingHit === true && r.j.red === false,
    '① 给一个什么都没命中的文件 ⇒ **契约 0 / 证 0**（不是"把 64 张都算上"）',
    `changed=${JSON.stringify(r.j?.changed)} · 契约=${r.j?.expectations.length} · 证=${r.j?.certs.length} · nothingHit=${r.j?.nothingHit} · exit=${r.rc}`,
  );
  chk(r.j?.ran?.certs?.length === 0, '①\' `--no-run` ⇒ **一张都没跑**（`ran.certs` 为空：算集合 ≠ 跑）', `ran.certs=${JSON.stringify(r.j?.ran?.certs)}`);
}

// ── ② 契约命中（★ 带 node_id + 摘要 + path）──
{
  const CH = 'src/application/design/dsl_ops/task_ops.ts';
  const r = runTool([CH]);
  const exps = r.j?.expectations ?? [];
  chk(
    exps.length === 7 && exps.every((e) => e.node_id && e.text && e.paths.includes(CH)),
    '② 改 `task_ops.ts` ⇒ 契约那一路命中 **7 条**，每条都带 node_id + 摘要 + path（且 path 里就是这个文件）',
    exps.map((e) => `${e.node_id} :: ${e.text}`).join('\n     '),
  );
  chk(
    new Set(exps.map((e) => e.node_id)).size === 1 && exps[0]?.node_id === 'file_src_application_design_dsl_ops_task_ops_ts',
    '②\' 命中的期望**归到同一个节点** `file_src_application_design_dsl_ops_task_ops_ts`（不是撒了一地）',
    `nodes=${JSON.stringify([...new Set(exps.map((e) => e.node_id))])}`,
  );
  chk(
    (r.j?.certs ?? []).length <= 5 && files(r).every((f) => !f.includes('run-all-certs')),
    '④ **命中证 ≤ 5**（设计判据）且**没有 run-all-certs**（增量入口不许偷跑全量）',
    `证=${JSON.stringify(files(r))}`,
  );
  chk(
    !files(r).includes('t136-unused-export-cert.mjs') && !files(r).includes('t352-write-gate-coverage-cert.mjs'),
    '④\' **与改动无关的证没被拉进来**（t136 / t352 都不在命中里）',
    `命中证=${files(r).length} 张：${JSON.stringify(files(r))}`,
  );
}

// ── ③ ★★ 自洽：它给自己算出 t354 ──
{
  const r = runTool(['scripts/verify-changed.mjs']);
  chk(
    files(r).includes(SELF),
    '③ ★★ **自洽**：拿本工具自己当改动 ⇒ 它算出「命中 t354」这张证（`touches` 那一路真的通）',
    `changed=${JSON.stringify(r.j?.changed)} · 命中证=${JSON.stringify(files(r))}`,
  );
  chk(
    (r.j?.expectations ?? []).length === 0,
    '③\' 同时如实报"契约那一路对它 0 命中"（`scripts/` **没有**任何 expectation 的 path ⇒ 另一半是洞）',
    `契约=${r.j?.expectations.length} 条 · nothingHit=${r.j?.nothingHit}`,
  );
}

// ── ④ 现状：write_gate 两条路都 0（★ 如实，不是假装命中）──
{
  const r = runTool(['src/application/write_gate.ts']);
  chk(
    r.j?.changed.length === 1 && (r.j?.certs ?? []).length <= 5,
    '④\'\' 改 `write_gate.ts` ⇒ 改动 1 个 / 命中证 ≤ 5（★ 当前实测 0 张 ⇒ 见下一条的"洞"）',
    `改动=${r.j?.changed.length} · 契约=${r.j?.expectations.length} · 证=${(r.j?.certs ?? []).length} · exit=${r.rc}`,
  );
  chk(
    r.j?.nothingHit === true,
    '⑧ **现状如实**：`write_gate.ts` 现在 **契约 0 / 证 0** ⇒ 工具把它标成"**没验**"而不是"绿"（★ 这是 `touches_gap` 的洞）',
    `结论字段：nothingHit=${r.j?.nothingHit} red=${r.j?.red} exit=${r.rc}`,
  );
}

// ── ⑤ "自己坏"：子串匹配会让备份文件命中 ──
{
  const r = runTool(['src/domain/task_machine.ts.bak']);
  chk(
    (r.j?.expectations ?? []).length === 0 && (r.j?.certs ?? []).length === 0,
    '⑤ **精确匹配**：`task_machine.ts.bak` ⇒ 0 条（若改用 `includes()` 子串，这里会冒出 7 条 ⇒ 本证当场红）',
    `契约=${r.j?.expectations.length} · 证=${(r.j?.certs ?? []).length}`,
  );
  const real = runTool(['src/domain/task_machine.ts']);
  chk(
    (real.j?.expectations ?? []).length > 0,
    '⑤\' 对照组：同目录的**真文件** `task_machine.ts` ⇒ 命中 > 0（说明 ⑤ 不是"永远 0"的假判据）',
    `契约=${real.j?.expectations.length} 条 · 证=${(real.j?.certs ?? []).length} 张`,
  );
}

// ── ⑥ 绝对路径归一 ──
{
  const abs = path.join(REPO, 'src/domain/task_machine.ts').replace(/\\/g, '/');
  const r = runTool([abs]);
  chk(
    r.j?.changed?.[0] === 'src/domain/task_machine.ts' && (r.j?.expectations ?? []).length > 0,
    '⑥ 传**绝对路径** ⇒ 归一到仓库相对（Windows 上不归一必然全 0）',
    `changed=${JSON.stringify(r.j?.changed)} · 契约=${r.j?.expectations.length} 条`,
  );
}

// ── ⑦ git 模式 ──
{
  const r = runTool([]);
  chk(
    !!r.j && Array.isArray(r.j.changed) && Array.isArray(r.j.certs) && r.j.ran?.certs?.length === 0,
    '⑦ 不传参数 ⇒ 走 git（含**未跟踪**文件）；`--no-run` 下 ran.certs 为空',
    `changed=${JSON.stringify(r.j?.changed)} · 证=${(r.j?.certs ?? []).length} · exit=${r.rc}`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
