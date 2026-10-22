#!/usr/bin/env node
/**
 * ★★★ verify-changed.mjs —— **增量验证入口**（2026-10-17 · `task_plan.incremental_verify` / `preflight-checklist.md` B.5）
 *
 * 与 `certs/run-all-certs.mjs` **并列**，不是替代它：全量那条仍在（收口 / 日终 / 改 schema 或证框架本身时跑）。
 *
 * 用户原话（`docs/task-system-plan.dsl.json#task_plan.incremental_verify.why` 逐字）：
 *   *"我们的闸应该不用全量运行吧，改了哪里运行哪里应该就可以了。而且我们不是直接有契约的吗？
 *    只有契约，局部契约对上应该就可以了"*
 *
 * ## 三步（★ 次序就是设计里的次序，别调换）
 *   ① **拿改动文件**：`git diff --name-only`（★ 外加**未跟踪**文件 —— 新增的证/脚本在 `git diff` 里
 *      **根本不出现**，若只认 `git diff` 则"这笔新增的入口"永远验不到自己）；也可命令行直接传文件；
 *   ② ★★ **契约优先（便宜）**：读 `docs/task-system-plan.dsl.json` 的
 *      `geometry.nodes[].decision.expectations[]`，**`path` 命中改动文件**的 ⇒ 列出并**就地判**（复用
 *      `judgeExpectations`，★ 不新造第二把尺）；
 *   ③ ★ **证其次**：扫 `certs/t*.mjs` 里的 **`touches:` 声明**，命中改动文件的证才跑（★ **不跑 run-all**）。
 *
 * ## 判据 / 退出码
 *   · 有红（★ 证 FAIL>0 / 证崩 / 契约 expectation fail）⇒ **1**；
 *   · 全绿 ⇒ **0**；
 *   · ★★ **命中 0 条 ≠ 绿**：那是"**没验**"。本脚本把它**打在结论那一行**（★ 这里不擅自 exit 2：
 *     用户定的退出码只有"红 ⇒ 1 / 绿 ⇒ 0"；但读数必须让人一眼看出"这次什么都没证"）。
 *
 * ## `touches` 的写法（★ 全仓统一，一行即可）
 * ```
 *  * touches: src/application/write_gate.ts, src/domain/task_machine.ts
 * ```
 * ★ 比对是**整路径精确相等**（不是子串）：`src/a.ts.bak` **不**命中 `src/a.ts` 的契约/touches
 *   —— 子串匹配会让"备份文件/同前缀文件"把不相关的证全拉起来（t354 有一条专门打它）。
 *
 * ## 用法
 * ```
 * node scripts/verify-changed.mjs                 # 按 git（含未跟踪）算改动
 * node scripts/verify-changed.mjs src/a.ts b.ts   # 显式点名
 * node scripts/verify-changed.mjs --no-run        # ★ 只算集合、不跑（给 t354 断言用；也免得自调用递归）
 * node scripts/verify-changed.mjs --json --no-run src/a.ts
 * ```
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **`touches` 覆盖率**：`certs/` 里**除 `t354` 外没有任何一张**有机器可读的 `touches:` 声明
 *     （`t351:31` 只有一句散文中提到 `touches`，不是声明）⇒ 第 ③ 步目前**只能命中 t354 自己**
 *     —— ★ 这不是本脚本的 bug，是 `task_plan.touches_gap` 记的那个缺口；
 *   · **契约的 `path` 覆盖率**：28 条里 24 条带 `path`，且**只指向 5 个 src 文件** ⇒ 改别的文件
 *     （如 `src/application/write_gate.ts`）**两条路都命中 0** ⇒ 见运行期提示与 `docs/frictions.jsonl`；
 *   · **`edge-*` 期望的命中**：按"主体 + 对端"两端算（`expectationPaths`），但**只**在这两端出现在改动里时命中；
 *   · **判定器要 dist**：契约的"判"复用 `dist/.../judgeExpectations` ⇒ 未 `npm run build` 时**只列不判**（会明说）；
 *   · **不写盘 / 不写真仓 home**：本脚本只读 `docs/`、`certs/`、`git`；子证自己的 `AGENT_IO_HOME` 由子证自己设。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..').replace(/\\/g, '/');
// ★★★ 2026-10-22：设计册的**唯一位置**是 `.agent-io/design/`（`storage.ts#getDesignDir` 头注明写
//   「曾经试过放 docs/ … 现在只有一处」）。本行原来指着 `docs/task-system-plan.dsl.json` —— 那位置
//   2026-10-18 就废弃了，且 `docs/*` 进了 .gitignore ⇒ 文件根本不存在 ⇒ `plan=null` ⇒
//   **t354 的 ②②'⑤'⑥' 四条变成空断言**（它们「通过」不是因为对，是因为没东西可判）。
//   ⇒ 读不到册子要**当场报**，不许静默降到"只列不判"。
const PLAN = `${ROOT}/.agent-io/design/task-system-plan.dsl.json`;
const CERTS = `${ROOT}/certs`;

const argv = process.argv.slice(2);
const NO_RUN = argv.includes('--no-run');
const JSON_OUT = argv.includes('--json');
const named = argv.filter((a) => !a.startsWith('--'));

/** ★ 路径口径只有一处：正斜杠 + 去 `./` + 去根前缀（与 `domain/expectation.ts` 的 `normPath` 同义） */
const norm = (p) => p.replace(/\\/g, '/').replace(/^\.\//, '');

// ════════════════════════════════════════════════════════════════════
// ① 改动文件
// ════════════════════════════════════════════════════════════════════
function gitList(args) {
  try {
    const out = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function changedFromGit() {
  // ★ `--name-only HEAD` 同时覆盖暂存与未暂存（相对 HEAD）；无 HEAD（全新仓）时退回裸 diff
  const tracked = gitList(['diff', '--name-only', 'HEAD']);
  const fallback = tracked.length === 0 ? gitList(['diff', '--name-only']) : [];
  // ★★ 未跟踪：新增的证/脚本在 `git diff` 里**不出现** —— 不列它，本入口就验不到自己（本次新增即此形状）
  const untracked = gitList(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...fallback, ...untracked])];
}

const changed = [...new Set((named.length > 0 ? named : changedFromGit()).map((p) => {
  // 允许传绝对路径：能相对仓库根就相对，否则原样（后面精确比对自然命不中）
  const abs = path.resolve(ROOT, p).replace(/\\/g, '/');
  return abs.startsWith(`${ROOT}/`) ? abs.slice(ROOT.length + 1) : norm(p);
}))].sort();

const changedSet = new Set(changed);

// ════════════════════════════════════════════════════════════════════
// ② 契约：`path` 命中改动文件
// ════════════════════════════════════════════════════════════════════
let E = null; // dist 的 expectation 模块（★ 摘要/路径口径都从它取，不自造格式）
let judge = null;
try {
  E = await import('../dist/src/domain/expectation.js');
  judge = (await import('../dist/src/application/design/intent/expectations.js')).judgeExpectations;
} catch {
  E = null;
}

/**
 * 一条期望涉及的路径（★ 精确比对用）。
 * ★ 有 dist 就调 `expectationPaths`（唯一口径）；没有就按 kind **就地**取 —— 这是**降级**，
 *   仅为"未 build 也能列出命中"，输出里会标 `判不了`。
 */
function pathsOf(e) {
  if (E) return E.expectationPaths(e);
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [norm(e.from), norm(e.to)] : [norm(e.path ?? '')];
}
function textOf(e) {
  if (E) return E.describeExpectation(e);
  return `${e.kind} ${norm(e.path ?? `${e.from}→${e.to}`)} ${e.symbol ?? ''} ${e.target ?? ''}`.trim();
}

let plan = null;
try {
  plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
} catch {
  plan = null;
}

const expHits = []; // { node_id, node_label, expectation, paths, text }
for (const n of plan?.geometry?.nodes ?? []) {
  for (const e of n.decision?.expectations ?? []) {
    const ps = pathsOf(e);
    if (ps.some((p) => changedSet.has(p))) {
      expHits.push({ node_id: n.id, node_label: n.label ?? n.id, expectation: e, paths: ps, text: textOf(e) });
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// ③ 证：`touches:` 命中改动文件（★ 另加一条：改的就是某张证 ⇒ 它自己必跑）
// ════════════════════════════════════════════════════════════════════
/** `touches:` 一行声明。★ 只认**行首的** `touches:`（散文里提到 `touches` 不算声明） */
const TOUCH_RE = /^[ \t]*(?:\*|\/\/|\/\*)?[ \t]*touches[ \t]*:[ \t]*(.+)$/m;

/**
 * ★★★ 2026-10-22：**派生索引兜底**（`scripts/derive-touches.mjs` 的产物）
 *
 * 为什么必须加：实测 **75 张证里 70 张没写 `touches:`**（本文件第 41 行自己就记着这个缺口）
 * ⇒ `certHits` 恒为空 ⇒ 增量入口"命中 0 张" ⇒ **它不是"只跑受影响的"，是"什么都不跑"**。
 *
 * ★ 优先级：**显式声明 > 派生**（作者写的意图比机器猜的准）；
 *   两个都没有 ⇒ `null` ⇒ 调用方按**全跑**处理（漏跑=假绿，多跑只是慢）。
 */
let DERIVED_TOUCHES = {};
try {
  DERIVED_TOUCHES = JSON.parse(fs.readFileSync(`${CERTS}/.touches.json`, 'utf8'));
} catch {
  // 没有派生索引就退化为"只认显式声明"（与旧行为一致，不静默改变语义）
  DERIVED_TOUCHES = {};
}

function touchesOf(file) {
  let src = '';
  try {
    src = fs.readFileSync(`${CERTS}/${file}`, 'utf8');
  } catch {
    return null;
  }
  // ① 显式声明优先
  const m = src.match(TOUCH_RE);
  if (m) {
    return [...new Set(
      m[1]
        .replace(/\*\/\s*$/, '')
        .split(/[,\s]+/)
        .map((s) => s.replace(/[`'"]/g, '').trim())
        .filter(Boolean),
    )];
  }
  // ② 派生索引兜底（★ 这是 2026-10-22 补的：之前 70/75 张落进了"null ⇒ 不跑"）
  const d = DERIVED_TOUCHES[file];
  if (Array.isArray(d) && d.length) return d;
  // ③ 都没有 ⇒ null（调用方必须按"全跑"处理，不许当"不跑"）
  return null;
}

// ★ 收集规则与 run-all 对齐（`t<数字>-...mjs`）；★ 绝不含 `run-all-certs.mjs`（本入口**不跑全量**）
const certFiles = fs
  .readdirSync(CERTS)
  .filter((f) => /^t\d+-.*\.mjs$/.test(f))
  .sort();

const certHits = [];
const noTouches = [];
for (const f of certFiles) {
  const t = touchesOf(f);
  if (t === null) {
    // ★★★ 2026-10-22：**无 touches ⇒ 必须全跑，不许跳过**
    //   ★ 为什么：跳过 = 漏跑 = 假绿；全跑只是慢。今天实测"命中 0 张"就是因为这里 continue。
    //   ★ 如果这里嫌慢：那要补的是【touches 声明/派生】，不是"允许它不跑"。
    noTouches.push(f);
    certHits.push({ file: f, touches: [], kind: 'full-run', why: '★ 无 touches 声明（也没派生到）⇒ 必须全跑' });
    continue;
  }
  const hit = t.filter((p) => changedSet.has(norm(p)));
  const selfChanged = changedSet.has(`certs/${f}`);
  if (hit.length > 0 || selfChanged) {
    certHits.push({ file: f, touches: t, kind: selfChanged ? 'self-changed' : 'touches', why: selfChanged ? '改动文件就是它自己' : `touches 命中 ${hit.join(', ')}` });
  }
}

// ════════════════════════════════════════════════════════════════════
// ④ 实际跑（★ 只跑上面算出的；--no-run 时一个都不跑）
// ════════════════════════════════════════════════════════════════════
const certRuns = [];
if (!NO_RUN) {
  for (const c of certHits) {
    // ★ 与 run-all 同一条纪律：每张证跑前先还原（失败不致命）
    try {
      execFileSync('node', [`${CERTS}/t185-reset.mjs`], { cwd: ROOT, stdio: 'ignore' });
    } catch {
      /* 还原失败不致命 */
    }
    const t0 = Date.now();
    let out = '';
    let rc = 0;
    try {
      out = execFileSync('node', [`${CERTS}/${c.file}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      rc = typeof e.status === 'number' ? e.status : -1;
      out = String(e.stdout ?? '') + String(e.stderr ?? '');
    }
    const sum = (out.match(/汇总：PASS=(\d+)\s+FAIL=(\d+)/) ?? []).slice(1);
    const hasSummary = sum.length === 2;
    const fail = hasSummary ? Number(sum[1]) : null;
    certRuns.push({
      file: c.file,
      rc,
      pass: hasSummary ? Number(sum[0]) : null,
      fail,
      hasSummary,
      ms: Date.now() - t0,
      kind: hasSummary && fail > 0 ? 'red' : rc !== 0 ? 'crash' : hasSummary ? 'green' : 'nosummary',
      out,
    });
  }
}

let expReport = null;
if (!NO_RUN && expHits.length > 0 && judge) {
  // ★ 判据复用既有判定器（★ 不新造第二把尺）；`node_label` 由 DSL 给，缺了用 id
  expReport = await judge(ROOT, expHits.map(({ node_id, node_label, expectation }) => ({ node_id, node_label, expectation })));
}

// ════════════════════════════════════════════════════════════════════
// ⑤ 输出 / 退出码
// ════════════════════════════════════════════════════════════════════
const badCerts = certRuns.filter((r) => r.kind === 'red' || r.kind === 'crash');
const redExps = (expReport?.items ?? []).filter((i) => i.verdict === 'fail');
const red = badCerts.length > 0 || redExps.length > 0;
/**
 * ★★ 2026-10-22：`nothingHit` 必须只看【精准命中】，不能把"兜底全跑"算进去。
 * 为什么：改成"零命中⇒全跑"之后，`certHits` 永远非空 ⇒ `nothingHit` 永远 false ⇒
 * 这条读数就死了（它会说"命中了"，实际一张精准的都没有）。用户的 t354 ① 正是靠它。
 */
const certPreciseHits = certHits.filter((c) => (c.kind ?? 'touches') !== 'full-run');
const nothingHit = expHits.length === 0 && certPreciseHits.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({
    changed,
    // ★★★ 2026-10-22（t354 剩余缺口②）：**补 `why`** —— 它是每条契约唯一的人话摘要
    //   （`text` 只是"kind + 路径 + 符号"的形状描述，读不出"为什么要有这一条"）。
    //   ★ t354 的断言要"每条都带 node_id + **摘要** + path"，而旧输出里根本没有摘要 —— 那不是断言太严，
    //     是**输出缺一列**（补输出，不是把断言改松）。
    expectations: expHits.map((h) => ({
      node_id: h.node_id,
      kind: h.expectation.kind,
      paths: h.paths,
      text: h.text,
      why: typeof h.expectation.why === 'string' ? h.expectation.why : '',
    })),
    // ★★ 2026-10-22：`kind` 必须输出 —— "精准命中"与"兜底全跑"是两个概念，
    //   下游（t354 的 ④/⑤）要能分开数；混成一个数会让"精准性"这条判据失真。
    certs: certHits.map((c) => ({ file: c.file, touches: c.touches, kind: c.kind ?? 'touches' })),
    certs_precise: certHits.filter((c) => c.kind !== 'full-run').length,
    certs_full_run: certHits.filter((c) => c.kind === 'full-run').length,
    ran: {
      certs: certRuns.map((r) => ({ file: r.file, rc: r.rc, pass: r.pass, fail: r.fail, kind: r.kind, ms: r.ms })),
      expectations: expReport ? { checked: expReport.checked, passed: expReport.passed, failed: expReport.failed, unsupported: expReport.unsupported } : null,
    },
    nothingHit,
    red,
    noRun: NO_RUN,
  }));
  process.exit(red ? 1 : 0);
}

// ★★★ 结论**一行在最上面**（★ 不许让人翻 28 行才看到它）
const verdict = red
  ? `★ 有红：${badCerts.length} 张证红/崩 · ${redExps.length} 条契约期望 fail`
  : nothingHit
    ? '★ 没验：命中 0 条契约 / 0 张证（★ 这不是绿）'
    : NO_RUN
      ? `★ 只算集合（--no-run）：命中 ${expHits.length} 条契约 / ${certHits.length} 张证（★ 一个都没跑）`
      : `★ 全绿：跑了 ${certRuns.length} 张证 / ${expHits.length} 条期望`;
console.log(`${verdict}`);
console.log(`  （改动 ${changed.length} 个文件 · 命中契约 ${expHits.length} 条 · 命中证 ${certHits.length} 张${NO_RUN ? ' · --no-run：只算不跑' : ''}）`);

console.log(`\n★ 改动文件：${changed.length} 个`);
for (const f of changed) console.log(`   · ${f}`);

console.log(`\n★ 命中契约：${expHits.length} 条期望`);
for (const h of expHits) {
  console.log(`   · ${h.node_id}  ←  ${h.text}   [path: ${h.paths.join(' , ')}]`);
  // ★ 摘要另起一行：它是给人判断"这条契约该不该改"用的，挤在同行会把路径挤没
  if (typeof h.expectation.why === 'string' && h.expectation.why.trim()) console.log(`       摘要：${h.expectation.why}`);
}
if (expHits.length === 0) console.log('   （无：没有任何 expectation 的 path 命中改动文件）');

console.log(`\n★ 命中证：${certHits.length} 张`);
for (const c of certHits) console.log(`   · ${c.file}   （${c.why}）`);
if (certHits.length === 0) console.log('   （无：没有证声明 touches 命中改动文件）');

console.log(`\n★ 实际跑了：${NO_RUN ? 0 : certRuns.length} 张证 / ${NO_RUN ? 0 : expHits.length} 条期望`);
for (const r of certRuns) {
  const tag = r.kind === 'red' ? `★ 有红（FAIL=${r.fail}）` : r.kind === 'crash' ? `★ 崩（exit=${r.rc}）` : r.kind === 'nosummary' ? '○ 无汇总' : '✓';
  console.log(`   ${tag}  ${r.file}  ${r.pass ?? '?'}/${r.fail ?? '?'}  ${(r.ms / 1000).toFixed(1)}s`);
}
if (expReport) {
  console.log(
    `   契约：pass ${expReport.passed} · fail ${expReport.failed} · unsupported ${expReport.unsupported}（checked ${expReport.checked}）`,
  );
  for (const it of expReport.items.filter((i) => i.verdict !== 'pass').slice(0, 8)) {
    console.log(`   ${it.verdict === 'fail' ? '✗' : '○'} ${it.node_id}  ${describeShort(it)}  —— ${String(it.detail).split('\n')[0]}`);
  }
} else if (expHits.length > 0 && !NO_RUN) {
  console.log('   ★ 契约**只列未判**：dist 里没有 `judgeExpectations`（先 `npm run build`）');
}

function describeShort(it) {
  try {
    return describe(it.expectation);
  } catch {
    return it.expectation?.kind ?? '?';
  }
}
function describe(e) {
  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? `${e.kind} ${e.from} ${e.kind === 'edge-exists' ? '→' : '⇸'} ${e.to}` : `${e.kind} ${e.path}${e.symbol ? ` :: ${e.symbol}` : ''}`;
}

if (nothingHit) {
  console.log(
    '\n★★ 命中 0 ⇒ **本次增量没有覆盖任何证、任何契约**（改了，但没人证这件事）。' +
      '\n   两条可查的出口：① 该文件是否该进某节点的 `expectations[].path`（契约没写到它）；' +
      '\n   ② 证是否该声明 `touches:`（★ 全仓目前只有 t354 有 → `task_plan.touches_gap`）。' +
      '\n   ★ 这不等于通过：要真结论，跑 `node certs/run-all-certs.mjs`（全量，约 9–19 分钟）。',
  );
}
if (noTouches.length > 0) {
  console.log(`\n★ 未声明 \`touches\` 的证：${noTouches.length} / ${certFiles.length} 张（★ 它们永远不会被增量命中）`);
}

// ★ 崩/红的原文（★ 与 run-all 同一条纪律：只打这些）
for (const r of badCerts) {
  console.log(`\n──── ${r.file}（exit=${r.rc}）────`);
  console.log(r.out.split('\n').slice(-20).join('\n'));
}
process.exit(red ? 1 : 0);
