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
import os from 'node:os';
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
// ★★★ 2026-10-26（T-#20）：kind 的**唯一权威**（`domain/expectation.ts#EXPECTATION_KINDS`）
//   作为 `KINDS` 注入 expect 的求值域 —— 让判据**引用权威**而不是各抄一份。
let EXPECTATION_KINDS;
try {
  const m = await import(pathToFileURL(path.join(ROOT, 'dist', 'src', 'domain', 'expectation.js')).href);
  EXPECTATION_KINDS = m.EXPECTATION_KINDS;
  if (!Array.isArray(EXPECTATION_KINDS) || EXPECTATION_KINDS.length === 0) throw new Error('EXPECTATION_KINDS 为空');
} catch (e) {
  console.error(
    `[design:check] ✗ 拿不到 kind 权威（dist/src/domain/expectation.js）—— 先 \`npm run build\`。\n  ${String(e.message)}`,
  );
  process.exit(2);
}
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
    // ★★★ 2026-10-26（T-#20）：**kind 权威注入求值域** —— 不再让每条 expect 自己抄一份白名单。
    //   实测病史：D3 体内抄了 8 种（漏 source-has 时红过一次；漏 behavior-cases 时又红）。
    //   ⇒ 现在把 `domain/expectation.ts#EXPECTATION_KINDS`（唯一权威）作为 `KINDS` 注入。
    //   ★ 依赖 dist（需先 build）—— 拿不到就**响亮报**，不静默降级。
    const fn = new Function('dsl', 'nodes', 'paths', 'fs', 'path', 'root', 'mutateReport', 'callReport', 'results', 'KINDS', `"use strict"; return (${c.expect});`);
    const ok = Boolean(fn(dsl, nodes, paths, fs, path, ROOT, mutateReport, callReport, results, EXPECTATION_KINDS));
    results.push({ id, name, verdict: ok ? 'pass' : 'fail', detail: ok ? '断言成立' : `断言**不成立**：${c.expect.slice(0, 90)}…`, __fullExpect: ok ? undefined : c.expect });
  } catch (e) {
    results.push({ id, name, verdict: 'fail', detail: `判不了：${e.message}` });
  }
}

const count = (v) => results.filter((r) => r.verdict === v).length;

// ★★★ 2026-10-26（T-#19 / 寄风）：**截断不是丢信息，是换句柄**。
//   原来失败项写的是 `c.expect.slice(0, 90)` —— **硬切 90 字**，要看全只能**重跑本脚本**。
//   ⇒ 超长时把**完整 expect** 落到 spill 文件，detail 里给句柄：用 `read offset/limit` 翻页，**不必重跑**。
//
// ★★★ 位置：**os.tmpdir()**，不是项目内（寄风：为什么不能做成 DSH 一样）——
//   DSH 的 grep 落 `%TEMP%\dsh-spill-<随机>\`；而本仓 `storage.ts#isSandboxDataHome()`
//   早已把 `os.tmpdir()` 定义为"**一次性、可丢**" ⇒ spill 住临时区就是**复用同一条判据**。
//   ★ 住项目内的后果（第一版就是这样，已改）：污染 .gitignore + 无限增长 + 删项目即失。
//
// ★★ 回收（寄风：回收机制怎么做）—— git 的 `gc --prune` 形状，不需要守护进程：
//   · **TTL 管跨会话**：每次 spill 顺手扫兄弟目录，`mtime > 24h` ⇒ rm -rf（清上个进程的残留）
//   · **LRU 管会话内**：自己目录超过 200 份 ⇒ 删最旧的
//   · **不在进程退出时删**：MCP 常驻，退出时删会让 agent 还没读就没了
const SPILL_ROOT = path.join(os.tmpdir(), 'agentio-spill');
const SPILL_DIR = path.join(SPILL_ROOT, `${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
const SPILL_TTL_MS = 24 * 60 * 60 * 1000;
const SPILL_MAX_FILES = 200;
function sweepSpillRoot() {
  try {
    for (const d of fs.readdirSync(SPILL_ROOT, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const p = path.join(SPILL_ROOT, d.name);
      if (p === SPILL_DIR) continue; // 不动自己
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > SPILL_TTL_MS) fs.rmSync(p, { recursive: true, force: true });
      } catch {
        /* 单目录失败不影响别人 */
      }
    }
  } catch {
    /* 根目录不存在 ⇒ 无残留可清 */
  }
}
function pruneSpillDir() {
  try {
    const files = fs.readdirSync(SPILL_DIR).map((n) => path.join(SPILL_DIR, n));
    if (files.length <= SPILL_MAX_FILES) return;
    const withM = files.map((f) => ({ f, m: fs.statSync(f).mtimeMs })).sort((a, b) => a.m - b.m);
    for (const x of withM.slice(0, files.length - SPILL_MAX_FILES)) fs.rmSync(x.f, { force: true });
  } catch {
    /* 删不动就算了：它是临时产物 */
  }
}
function spillText(text, kind) {
  try {
    fs.mkdirSync(SPILL_DIR, { recursive: true });
    sweepSpillRoot();
    const file = path.join(SPILL_DIR, `${kind}-${SPILL_STAMP}.txt`);
    fs.writeFileSync(file, text);
    pruneSpillDir();
    return { file, bytes: Buffer.byteLength(text) };
  } catch {
    return null;
  }
}
const SPILL_STAMP = new Date().toISOString().replace(/[:.]/g, '-');
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
