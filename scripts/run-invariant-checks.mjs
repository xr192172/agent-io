#!/usr/bin/env node
/**
 * run-invariant-checks —— ★ 给 `task_plan.invariant_checks` 做的 **runner**（榜单 `docs/board.md` T4 · 滞涩 #6 · G5）。
 *
 * ## 为什么要有它（★ 这是本笔存在的唯一理由，别删）
 * `docs/task-system-plan.dsl.json` 的 `task_plan.invariant_checks` 里**早就写了 4 条带 `cmd` 的判据**，
 * 而**全仓没有执行者** ⇒ ★★ **判据没有执行者 = 等于没有**（设计与 `NEGATIVE_KINDS` 那条同形：
 * 一条写着"必须真的含 edge-absent"的检查，若没人跑，它就退化成一串没人读的字符串）。
 * ⇒ 本脚本把"跑一遍"固化：**一条命令把每条 `cmd` 都真跑一遍**，任一 FAIL ⇒ 退出码 1。
 *
 * ## ★★ 它与那 4 条 `cmd` 的关系：**只当执行者，不当改写者**
 * 本 runner **不重写、不翻译、不"等价实现"** 任何一条判据 —— 它只做三件事：
 *   ① 从 DSL 里**读** `cmd` 原文；② 交给 shell **原样执行**；③ 按 **exit code** 判定。
 * ★ 为什么这条是铁的：本仓反对的形状正是"判据住两处"（同一判据写两遍，早晚分叉）。
 *   若这里"再实现一遍等价逻辑"，那 DSL 里的 `cmd` 就成了装饰 ⇒ 又绕回 G5。
 *
 * ## ★ `invariant_checks[i]` 的**真实形状**（以文件为准 · 2026-10-16 实测）
 *   键名 = `{ invariant, check, cmd, red_when }`（**没有** `pass_when`、**也没有** `red`）。
 *   ★ 本 runner 因此把 **PASS 判据钉死为 `exit === 0`** —— 文件里没有"通过条件"字段，
 *     所以不能去猜别的键；`red_when` 只是**人话解释**（红时打出来给读者看），**不参与判定**。
 *   ★★ 与派活描述的出入（如实记）：描述里写的是 `cmd / pass_when / red`，
 *     实测是 `cmd / red_when`（+ `invariant` / `check`）。**以文件为准**。
 *
 * ## ★ 一条自带的守门：**有判据但没 `cmd` ⇒ 也算 FAIL**
 *   `cmd` 缺失 / 空串 / 非字符串 ⇒ 该条判 FAIL（reason = "无 cmd = 没有执行者"）。
 *   ★ 理由：本 runner 是来消"判据没有执行者"的 ⇒ 若它**默默跳过**没 `cmd` 的条目，
 *     就等于把"没执行者"从 DSL 里挪到了 runner 里（换了个地方藏），而**那就是它要治的病**。
 *
 * ## 用法
 * ```
 * node scripts/run-invariant-checks.mjs              # 跑 docs/task-system-plan.dsl.json
 * npm run invariants                                 # 同上（package.json 里的别名）
 * node scripts/run-invariant-checks.mjs <别的.dsl.json>   # 指定 DSL（★ 冒烟 / 故意改坏时用）
 * ```
 * ★ 退出码：**0 = 全部 PASS；1 = 有 FAIL**（与 `certs/*` 同口径）。
 * ★ 找不到 `task_plan.invariant_checks`（形状变了）⇒ **exit 2**（"没跑成" ≠ "跑过且通过"，本仓铁律）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DSL_PATH = process.argv[2] ?? path.join(ROOT, 'docs/task-system-plan.dsl.json');

// ★★ 判据必须能被"读出来"：解析失败也退 2（不许把它当成 0 条 = 全绿）
let doc;
try {
  doc = JSON.parse(fs.readFileSync(DSL_PATH, 'utf8'));
} catch (e) {
  console.error(`★ 读不了 DSL：${DSL_PATH}\n  ${String((e && e.message) || e)}`);
  process.exit(2);
}

const checks = doc?.task_plan?.invariant_checks;
if (!Array.isArray(checks)) {
  console.error(`★ ${DSL_PATH} 里没有 task_plan.invariant_checks（形状变了？）⇒ 没跑成，退出码 2（不是 0）。`);
  process.exit(2);
}

console.log(`invariant_checks runner —— ${path.relative(ROOT, DSL_PATH).replace(/\\/g, '/')}`);
console.log(`  条数 = ${checks.length} · 判定口径 = 该条 cmd 的 exit code（0 ⇒ PASS，非 0 ⇒ FAIL）· cwd = 仓根\n`);

const clip = (s, n = 70) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length <= n ? one : `${one.slice(0, n)}…`;
};

const rows = [];
for (let i = 0; i < checks.length; i++) {
  const c = checks[i] ?? {};
  const label = clip(c.invariant ?? '(无 invariant 文案)', 56);

  // ★ 守门：没有 cmd ⇒ FAIL（"判据没有执行者"，本 runner 存在的理由）
  if (typeof c.cmd !== 'string' || c.cmd.trim() === '') {
    rows.push({ i, label, ok: false, rc: null, why: '★ 该条**没有 cmd** ⇒ 没有执行者（判据等于没有）', out: '' });
    console.log(`  [${i}] ★ FAIL  —— ${label}\n        ↳ 该条没有 cmd 字段／为空 ⇒ 没有执行者`);
    continue;
  }

  const t0 = Date.now();
  const r = spawnSync(c.cmd, { cwd: ROOT, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const rc = typeof r.status === 'number' ? r.status : -1;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const ok = rc === 0;
  rows.push({ i, label, ok, rc, why: ok ? '' : (c.red_when ?? '(无 red_when)'), out });

  console.log(`  [${i}] ${ok ? 'PASS' : '★ FAIL'}  exit=${rc}  ${String(ms).padStart(5)}ms  —— ${label}`);
  // ★ 读数自足：把该 cmd 的**自有输出**打一行（很多 cmd 会 console.log 自己的读数）
  const own = out.trim().split('\n').filter(Boolean)[0];
  if (own) console.log(`        ↳ ${clip(own, 110)}`);
  if (!ok) console.log(`        ↳ red_when: ${clip(c.red_when ?? '(无)', 110)}`);
}

const P = rows.filter((r) => r.ok).length;
const F = rows.length - P;

// ★ FAIL 的：把 cmd 的输出尾部原文打出来（★ 否则读者只能猜"红在哪"）
if (F > 0) {
  console.log('\n════ FAIL 的条目，cmd 输出原文（尾部 20 行）════');
  for (const r of rows.filter((x) => !x.ok)) {
    console.log(`\n──── [${r.i}] exit=${r.rc} —— ${r.label} ────`);
    if (r.rc === null) console.log('（该条没有 cmd，无输出）');
    else console.log((r.out || '(无输出)').trim().split('\n').slice(-20).join('\n'));
  }
}

console.log(`\n汇总：checks=${rows.length}  PASS=${P}  FAIL=${F}`);
console.log(F > 0 ? '★ 有 FAIL ⇒ 退出码 1（判据没全过）' : '✓ 全部 PASS ⇒ 退出码 0');
process.exit(F > 0 ? 1 : 0);
