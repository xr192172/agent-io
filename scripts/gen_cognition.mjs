/**
 * gen_cognition —— 生成 / 校验 `<project>/.agent-io/COGNITION.txt`（**一行式认知索引**）。
 *
 * ## 它是什么（2026-10-09，用户「合并形态 S2」，`docs/todo.md` T68）
 * `get_dsl query=digest` 的**落盘形态** —— 一行一个文件：`路径[层]: F:职责 | R:关系 | A:契约 | S:高熵决策`。
 * 目的：让"这些文件都是干什么的"这件事**躺在仓里**，而不是**只躺在工具里**（要人先想到去问）。
 *
 * ## ★★ 三条纪律
 * 1. ★★ **不进 Git**（判据 = **变更频率**）：它**随每次代码改动而变** ⇒ churn 高。
 *    对照 `MANIFEST.txt`：只在"卷的布局变了"时变 ⇒ churn 低 ⇒ 进 Git。
 *    （`MANIFEST.txt` 是**声明**，`COGNITION.txt` 是**快照** —— 声明稳定，快照易变。）
 * 2. ★★★ **同一渲染器，不许第二份实现**：本脚本**不自己排版**，而是把 `get_dsl query=digest`
 *    的**文本原样取回来**（经 CLI 调的就是那一个实现）⇒ "与 `query=digest` 逐字一致"是**结构保证**，
 *    不是靠我对齐。
 * 3. ★★ **带派生指纹，过期即标**：每段写 `sha256=<body 的哈希>`。
 *    ★ 为什么哈希"渲染出来的 body"而不是"DSL 文件"：**视图才是我要保证没变的东西** ——
 *      DSL 里改个坐标，body 一字不变 ⇒ **这份快照仍然准确**，不该被判过期。
 *    ⇒ 于是判据是**双向都好用**的：body 变 ⇔ 文件过期。
 *    ★ 静态文件**不可能自己知道**自己过期 ⇒ 由**读者**判（`--check`，以及后续 `capability_map` 顶部）。
 *      文件头因此**常驻一句自白**："会过期，跑 `cognition:check` 判"——**不许装作永远新鲜**。
 *
 * ## 用法
 *   node scripts/gen_cognition.mjs [--project <dir>] [--stdout] [--check]
 *   · 默认写出 `<project>/.agent-io/COGNITION.txt`；`--stdout` 只打印；`--check` 只对账（过期 ⇒ 退出 1）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'dist', 'src', 'presentation', 'cli', 'cli.js');
const DATA_DIR = '.agent-io';
const FORMAT = 'agent-io/cognition-fras-v1';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const projectDir = path.resolve(valOf('--project') ?? process.cwd());
const dataDir = path.join(projectDir, DATA_DIR);
const outPath = path.join(dataDir, 'COGNITION.txt');

/**
 * 有哪些 feature —— **目录即清单，不手抄**。
 *
 * ★★★ 2026-10-31 修的一处**假绿**：本函数原来读 `features/*.json`，而那个目录
 *   **2026-10-18 就退场了**（`stage_registry.ts`：设计册唯一位置 = `design/<f>.dsl.json`；
 *   "agent-io.json 与 features/ 已退场"）⇒ 它读到 0 个 feature，写出**空**的 COGNITION.txt，
 *   而 `--check` 因为"它自己那半边也是空"照样报"一致（最新）"。
 *   ⇒ 判据（0.12）：**枚举源失效时必须说出来**，不许回落到空集。
 *   现在读 `design/*.dsl.json`，并且**一个 feature 都没有时抛错**（"没有"与"读失败"必须可分）。
 */
function listFeatures() {
  const dir = path.join(dataDir, 'design');
  if (!fs.existsSync(dir)) {
    throw new Error(`设计册目录不存在：${dir} ⇒ COGNITION 无从枚举（先 import_project 建档）`);
  }
  const list = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .sort();
  if (list.length === 0) {
    throw new Error(`${dir} 下没有任何 <feature>.dsl.json ⇒ COGNITION 会是空文件，那不是"最新"，是"没东西可投影"`);
  }
  return list;
}

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);

/**
 * ★★ 取某一 feature 的 digest **正文行** —— **调的是产品自己的 CLI**，
 * 所以这里拿到的就是 `query=digest` 的输出，**没有第二份排版代码**。
 */
function digestBody(feature) {
  let raw;
  try {
    raw = execFileSync(
      process.execPath,
      ['--no-warnings', CLI, 'get_dsl', '--json', JSON.stringify({ query: 'digest', feature, view: 'design' })],
      { env: { ...process.env, AGENT_IO_HOME: projectDir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    // ★ 不许静默：把失败**写进文件**（带 feature 名与错误首行），而不是当作"这一 feature 没内容"。
    // ★★ 2026-11-11（第⑬项 Java ② 收口诊断）：原来只取 stdout/message 首 120 字 ⇒ **stderr（真正的
    //   SQLite stack）被丢**——"Provided value cannot be bound to SQLite parameter 1" 的查询位置
    //   永远定位不到。现在 stdout + stderr 全带（截断 2000），ERROR 段直接可读。
    const out = String(e?.stdout ?? '').trim();
    const errOut = String(e?.stderr ?? '').trim();
    const msg = [errOut, out, String(e?.message ?? '')]
      .filter(Boolean)
      .join('\n---\n')
      .split('\n')
      .filter((l) => /Error|provided|bound|SQLite|at |parameter/i.test(l) || l === '---')
      .slice(0, 20)
      .join('\n')
      .slice(0, 2000) || String(e?.message ?? '').slice(0, 200);
    return { lines: [], error: msg };
  }
  const text = raw.split('---DATA---')[0];
  const lines = text
    .split('\n')
    .filter((l) => /^\S.*:\s/.test(l) && !l.startsWith('══') && !l.startsWith('('));
  return { lines, error: null };
}

function dslRev(feature) {
  try {
    // ★ 2026-10-31：原来读 `dataDir/features/` —— 那个目录 2026-10-18 已退场 ⇒ rev 恒 0（静默失效）。
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, 'design', `${feature}.dsl.json`), 'utf8'));
    const r = j.rev ?? j._dsl_rev ?? (j.meta && j.meta.rev);
    return typeof r === 'number' ? r : 0;
  } catch { return 0; }
}

/** 现算每一段的 {feature, rev, hash, lines|error} */
export function computeSections() {
  return listFeatures().map((feature) => {
    const { lines, error } = digestBody(feature);
    // ★★ 2026-10-31（第十轮复核）：失败时原来 hash = sha('') ⇒ 与"空快照"相等 ⇒ `--check` 报"一致（最新）"，
    //   门绿而该 feature 一行都没投影（0.12：读失败 ≠ 没有）。现失败段带 ERROR 前缀，永不等于真实 digest。
    return { feature, rev: dslRev(feature), hash: error ? sha('ERROR:' + error) : sha(lines.join('\n')), lines, error };
  });
}

export function renderCognition(sections) {
  const head = [
    '#AgentIO-COGNITION: 1',
    `#Format: ${FORMAT}`,
    '#',
    '# 一行式认知索引：`路径[层]: F:职责 | R:关系 | A:契约 | S:高熵决策`（段缺则省略）。',
    '# ★★ 本文件是**派生快照，不是真相** —— 真相在 .agent-io/design/<feature>.dsl.json（overlay 已于 2026-10-23 并入同一文件）。',
    '# ⚠ **会过期**：改过 DSL 后请重跑 `npm run cognition`；`npm run cognition:check` 判过没过期。',
    '# 生成方式：取 `get_dsl query=digest` 的输出（**同一渲染器**，不另写一份排版）。',
    '# 不进 Git（随代码改动而变 ⇒ churn 高）；进 Git 的是 MANIFEST.txt（那才是稳定的声明）。',
    '#',
  ];
  const body = [];
  for (const s of sections) {
    body.push(`===feature ${s.feature}=== dsl_rev=${s.rev} sha256=${s.hash}`);
    if (s.error) body.push(`  ⚠ 生成失败（不静默）：${s.error}`);
    else if (s.lines.length === 0) body.push('  （语义层没有文件可投影）');
    else body.push(...s.lines);
    body.push('');
  }
  return head.concat(body).join('\n');
}

/** `--check`：重算 + 与文件里声明的 `sha256` 比 ⇒ 过期即报（**静态文件自己不可能知道**） */
export function checkCognition() {
  if (!fs.existsSync(outPath)) return { ok: false, why: `COGNITION.txt 不存在（${outPath}）⇒ 先跑一次生成`, stale: [], missing: [], extra: [] };
  const onDisk = fs.readFileSync(outPath, 'utf8');
  const declared = new Map();
  for (const m of onDisk.matchAll(/^===feature (\S+)=== dsl_rev=(\d+) sha256=(\w+)/gm)) declared.set(m[1], m[3]);
  const sections = computeSections();
  const now = new Map(sections.map((s) => [s.feature, s.hash]));
  const stale = [...now].filter(([f, h]) => declared.has(f) && declared.get(f) !== h).map(([f]) => f);
  const missing = [...now.keys()].filter((f) => !declared.has(f));
  const extra = [...declared.keys()].filter((f) => !now.has(f));
  // ★ 0.12：**取不到 digest 的段落**必须判红 —— 否则"某 feature 一行都没投影"与"它没内容"读起来一样。
  const failed = sections.filter((s) => s.error).map((s) => `${s.feature}（${s.error}）`);
  const ok = stale.length + missing.length + extra.length === 0 && failed.length === 0;
  return {
    ok,
    why: failed.length
      ? `**有 ${failed.length} 个 feature 的 digest 取不到 ⇒ 这不是"一致"，是没验**`
      : ok
        ? '一致（最新）'
        : '**已过期，请重生成**（`npm run cognition`）',
    stale,
    missing,
    extra,
    failed,
  };
}

if (flag('--stdout')) { process.stdout.write(renderCognition(computeSections())); process.exit(0); }

if (flag('--check')) {
  const r = checkCognition();
  console.log(`对账：${r.why}`);
  if (r.stale.length) console.log(`  ★ 已过期（DSL 改过而快照没重生成）：${r.stale.join(', ')}`);
  if (r.missing.length) console.log(`  ★ 新增但没进快照：${r.missing.join(', ')}`);
  if (r.extra.length) console.log(`  ★ 快照里有、现在已不存在：${r.extra.join(', ')}`);
  if (r.failed && r.failed.length) console.log(`  ★ digest 取不到（≠ 没内容）：${r.failed.join(', ')}`);
  console.log(r.ok ? '✅ COGNITION 是最新的' : '❌ COGNITION 已过期（不静默）');
  process.exit(r.ok ? 0 : 1);
}

const sections = computeSections();
fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(outPath, renderCognition(sections), 'utf8');
const nFiles = sections.reduce((a, s) => a + s.lines.length, 0);
console.log(`已写出 ${outPath}（${sections.length} 段 / ${nFiles} 行认知${sections.some((s) => s.error) ? ' · ★ 有段生成失败，见文件内 ⚠' : ''}）`);
