#!/usr/bin/env node
/**
 * design:check —— 【项目级】契约的执行器（★ `judgeExpectations` 的项目级版）
 *
 * ## 为什么需要它
 * 节点级判据住在 `decision.expectations`（`judgeExpectations` 跑）；
 * 而**项目级判据**（"设计全不全"）住在 `task_plan.design_completeness.criteria[].rule` ——
 * ★ 而 `rule` 是【纯文本】⇒ **没有执行器** ⇒ `criteria[].unjudged` 一直写着"没有检查器"。
 * ⇒ 本脚本就是那个执行器：**读 `criteria[].expect`（可执行断言）⇒ 跑 ⇒ 报 pass/fail/pending**。
 *
 * ## 判据从哪来（★ 别在这里写死业务规则）
 * - **有 `expect`** ⇒ 跑它（求值域：`dsl` / `nodes` / `paths` / `fs` / `path`）
 * - **没有 `expect`** ⇒ ★ **判 `pending`**（不假绿：没写断言 = 还没到能判的程度）
 * - **有 `blocked_by`** ⇒ 也判 `pending`（写明卡在哪）
 *
 * ## 加语言 / 加目录要不要改它
 * ★ **不用**。它只读 `criteria`，不认语言、不认目录 —— 那是扫描器（`import_project`）的事。
 *
 * ## 用法
 *   node scripts/design-check.mjs                 # 默认 feature: task-system-plan
 *   node scripts/design-check.mjs --feature x      # 指定 feature
 *   node scripts/design-check.mjs --json           # 机器可读
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const argOf = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};
const FEATURE = argOf('--feature') ?? 'task-system-plan';
const JSON_OUT = args.includes('--json');
const ROOT = process.cwd();
const FILE = path.join(ROOT, '.agent-io', 'design', `${FEATURE}.dsl.json`);

if (!fs.existsSync(FILE)) {
  console.error(`★ 找不到 ${FILE}`);
  process.exit(2);
}
const dsl = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const criteria = dsl?.task_plan?.design_completeness?.criteria ?? [];
const nodes = dsl?.geometry?.nodes ?? [];
const paths = nodes.map((n) => String(n.description ?? '').replace(/\\/g, '/'));

if (!criteria.length) {
  console.error('★ 这份 DSL 没有 task_plan.design_completeness.criteria');
  process.exit(2);
}

const results = [];

// ★★★ 2026-10-19（D6 的正解）：预跑"全部 call-exists 期望"，结果交给 expect 用。
//   ★ 为什么是它：D6 说"每个 export 至少 1 个消费者" —— 而"消费者"的判据就是 `call-exists`（它内部读 cache.db 的 call 边）。
//   ★ 关键：`checked` 必须 ≥1 —— **没有判据不算通过**（D6 若 0 条 call-exists ⇒ 该红，不是真空过）。
let callReport = null;
{
  const callItems = [];
  for (const n of dsl.geometry?.nodes ?? []) {
    for (const e of n.decision?.expectations ?? []) {
      if (e.kind === 'call-exists') callItems.push({ node_id: n.id, node_label: String(n.description ?? n.id), expectation: e });
    }
  }
  if (callItems.length) {
    try {
      const je = await import(pathToFileURL(path.join(ROOT, 'dist/src/application/design/intent/expectations.js')).href);
      const rep = await je.judgeExpectations(ROOT, callItems);
      callReport = {
        checked: rep.checked,
        passed: rep.passed,
        failed: rep.failed,
        unsupported: rep.unsupported,  // ★ 判不了的也要带上（否则 D6 把 9 条 unsupported 当通过）
        detail: rep.items.filter((x) => x.verdict !== 'pass').slice(0, 5).map((x) => `${x.node_id.replace('file_src_', '')}: ${x.detail}`),
      };
    } catch (e) {
      callReport = { error: String(e.message) };
    }
  }
}

// ★★★ 2026-10-19（用户："能不能自动做突变测试"）：先跑一遍突变，结果交给 expect 用。
//   ★ 为什么要预跑：D7 的判据就是"有没有存活的装饰判据" —— 而它要靠 mutate 才知道。
//   ★ 只在 D7 需要时才跑（省时间）；没有 D7 就跳过。
const needsMutate = criteria.some((c) => typeof c.expect === 'string' && c.expect.includes('mutateReport'));
let mutateReport = null;
if (needsMutate) {
  try {
    const { runMutate } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mutate.mjs')).href);
    mutateReport = await runMutate(FEATURE, ROOT);
  } catch (e) {
    mutateReport = { error: String(e.message) };
  }
}

for (const c of criteria) {
  const id = c.id ?? '?';
  const name = c.name ?? '';
  if (c.blocked_by) {
    results.push({ id, name, verdict: 'pending', detail: `进行中 · 卡在：${c.blocked_by}` });
    continue;
  }
  if (typeof c.expect !== 'string' || !c.expect.trim()) {
    results.push({ id, name, verdict: 'pending', detail: '★ 没有可执行断言（`expect`）—— 还没到能判的程度' });
    continue;
  }
  try {
    // ★ 求值域：dsl / nodes / paths / fs / path / root（root = 被分析项目根，D4 要读源码查"迁移有没有执行者"）
    const fn = new Function('dsl', 'nodes', 'paths', 'fs', 'path', 'root', 'mutateReport', 'callReport', 'results', `"use strict"; return (${c.expect});`);
    const ok = Boolean(fn(dsl, nodes, paths, fs, path, ROOT, mutateReport, callReport, results));
    results.push({ id, name, verdict: ok ? 'pass' : 'fail', detail: ok ? '断言成立' : `断言**不成立**：${c.expect.slice(0, 90)}…`, __fullExpect: ok ? undefined : c.expect });
  } catch (e) {
    results.push({ id, name, verdict: 'fail', detail: `判不了：${e.message}` });
  }
}

const count = (v) => results.filter((r) => r.verdict === v).length;

// ★★★ 2026-10-26（T-#19 / 寄风）：**截断不是丢信息，是换句柄**。
//   原来失败项写的是 `c.expect.slice(0, 90)` —— **硬切 90 字**，要看全只能**重跑本脚本**
//   （实测：为了看 D1/D4/D9 的完整 expect，我今天重跑了一次 `design-check --json`）。
//   ⇒ 现在超长时把**完整 expect** 落到 `.agent-io/.spill/`，detail 里给句柄：
//     用 `read offset/limit` 翻页，**不必重跑**。
//   ★ DSH 的 `grep` / `pwsh` 早就是这个范式（"Full output stored at <path>"）。
//   ★ 为什么先写在这里而不是抽公共：**唯一消费者只有一个**，现在就抽 = 凭想象定接口。
//     第二个消费者出现时再提到 `application/plumbing.ts`（唯一住处）。
const SPILL_DIR = path.join(ROOT, '.agent-io', '.spill');
const SPILL_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
function spillText(text, kind) {
  try {
    fs.mkdirSync(SPILL_DIR, { recursive: true });
    const file = path.join(SPILL_DIR, `${kind}-${SPILL_STAMP}.txt`);
    fs.writeFileSync(file, text);
    return { file, bytes: Buffer.byteLength(text) };
  } catch {
    return null;
  }
}
// 回填：失败项把完整 expect 换成一个**句柄**（JSON 与文本两条路径共用）
for (const r of results) {
  if (r.verdict !== 'fail' || !r.__fullExpect) continue;
  const s = spillText(r.__fullExpect, `design-check-${r.id}`);
  if (s) {
    r.expect_file = s.file;
    r.detail =
      r.detail.replace(/…$/, '') +
      `\n     ★ 完整 expect（${s.bytes} 字节）见 ${s.file} —— 用 read offset/limit 翻页，**不必重跑本工具**`;
  }
  delete r.__fullExpect;
}

if (JSON_OUT) {
  console.log(JSON.stringify({ feature: FEATURE, checked: results.length, passed: count('pass'), failed: count('fail'), pending: count('pending'), items: results }, null, 2));
} else {
  console.log(`══ design:check · ${FEATURE} ══`);
  for (const r of results) {
    const mark = r.verdict === 'pass' ? '✓' : r.verdict === 'fail' ? '✗' : '…';
    console.log(`  ${mark} ${r.id}${r.name ? ' [' + r.name + ']' : ''} — ${r.detail}`);
  }
  console.log(`\n  通过 ${count('pass')} · ★ 不通过 ${count('fail')} · 进行中 ${count('pending')}（共 ${results.length} 条）`);
  if (count('pending')) {
    console.log('  ★ pending 不是"通过" —— 是"还没写断言 / 卡在某处"。要它变绿，先写 expect 或解掉 blocked_by。');
  }
}
process.exit(count('fail') ? 1 : 0);
