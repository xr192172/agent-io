#!/usr/bin/env node
/**
 * 测试门 —— 把 `tests/` 下的 `node:test` 用例**真跑一遍**，按 TAP 计数判红。
 *
 * ★ 为什么要有它（本仓的病）：`tests/` 下有 11 个 `*.test.ts`，而 `scripts/verify.mjs` 的 9 道门里
 *   **没有任何一道跑它们** —— 有测试、没裁判，比没测试更糟（`tests/i1_doc_alignment.test.ts` 的正则
 *   曾断言一句**已被改掉**的工具描述，靠人工发现才修上）。
 *
 * ## 判红的三条（缺一条这道门就是假绿灯）
 * 1. **退出码非 0** 或 **`# fail > 0`** ⇒ 红；
 * 2. **`0 个用例被执行`** ⇒ 红（空跑等于没跑：文件被删空、glob 没匹配上、`--test` 只跑了 0 条，
 *    都会静默退 0）；
 * 3. **`skipped / todo > 0`** ⇒ 红（本仓口径：不许用 skip/todo 把门关掉 —— 那会把"有测试没裁判"
 *    重演一遍，而且是**更隐蔽**的一遍）。
 *
 * ## 只许有一种计数口径
 * 计数**不自己数**（不解析源码里 `test(` 的个数）：那是第二份事实。唯一口径是 runner 自己的
 * TAP 汇总行（`# tests` / `# pass` / `# fail` / `# skipped` / `# todo`）—— 跑起来才有数。
 *
 * ## 为什么逐文件跑（而不是一次全跑）
 * 一次全跑的 TAP 里**没有文件名**（只有用例名）⇒ 报红时说不出"哪个文件红"，门就退化成"有一坨红"。
 * 逐文件 spawn 一次拿到**文件级**读数，代价是 11 次进程启动（本地实测 ~10s，可接受）。
 *
 * ## 跑法
 * ```
 * node scripts/run-tests.mjs                  # 全跑（默认；总门就是这么调的）
 * node scripts/run-tests.mjs --filter i1_     # 定向（内环用；★ 不进总门）
 * ```
 * TS 直跑用 `--import tsx`（测试从 `../src/*.ts` 导入，`.js` 后缀指向 TS 源；Node 自带 type
 * stripping 解析不了这种后缀映射）⇒ 不需要 `npm run build`，测试读的是**源码**而不是 dist。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

const args = process.argv.slice(2);
const fi = args.indexOf('--filter');
const filter = fi >= 0 ? (args[fi + 1] ?? '') : '';

// ★★★ 2026-10-30（T-#REG-POLLUTE）：**测试跑在自己的数据根里** —— 与 `certs/run-all-certs.mjs` 同一笔修法。
// 病：测试若 `importProject` 一个 temp 夹具项目，登记会落进**真数据仓**（`<包根>/.agentio-data/projects.json`），
//     而运行期一过那条登记就永远指向一个不存在的目录 ⇒ 注册表（总任务视图的钥匙）被幽灵条目弄脏。
// 修法：本次 run 建一个 temp 根 ⇒ **每个测试文件一个子目录**当 `AGENT_IO_HOME` ⇒ 跑完整棵删掉。
// ★ 注入 `AGENT_IO_HOME` 而不是 `AGENT_IO_DATA_ROOT`：`getStorageRoot()` 里 ① DATA_ROOT 优先于 ② HOME，
//   钉外层 DATA_ROOT 会把测试自己钉的 `AGENT_IO_HOME`（`i1_*` / `p0_*` 全都自己钉了 mkdtemp）**抢掉**；
//   用 HOME 则"测试自己的声明永远赢"，没钉的那几个才落到这里。
const RUN_HOME_ROOT = mkdtempSync(path.join(os.tmpdir(), 'agent-io-tests-home-'));
const INJECT_VAR = process.env.AGENT_IO_DATA_ROOT?.trim() ? 'AGENT_IO_DATA_ROOT' : 'AGENT_IO_HOME';
function testDataHome(rel) {
  const dir = path.join(RUN_HOME_ROOT, rel.replace(/[^\w.-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  return INJECT_VAR === 'AGENT_IO_HOME' ? path.join(dir, 'home') : dir;
}

/** 测试文件清单（`tests/*.test.ts`；`tests/helpers/` 是夹具，不是用例） */
function testFiles() {
  const dir = path.join(ROOT, 'tests');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .sort()
    .filter((f) => (filter ? f.includes(filter) : true));
}

/** TAP 汇总行 → 计数（拿不到 = null，**不是 0**：判不了 ≠ 通过） */
function tapCounts(out) {
  const n = (re) => {
    const m = out.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    tests: n(/^# tests (\d+)$/m),
    pass: n(/^# pass (\d+)$/m),
    fail: n(/^# fail (\d+)$/m),
    skipped: n(/^# skipped (\d+)$/m),
    todo: n(/^# todo (\d+)$/m),
  };
}

/** 失败用例的第一行真实错误（`not ok` 后面的 `error:` 段首行） */
function failuresOf(out) {
  const lines = out.split(/\r?\n/);
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^not ok \d+ - (.*)$/);
    if (!m) continue;
    const name = m[1];
    let err = '';
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const e = lines[j].match(/^\s+error:\s*(.*)$/);
      if (e && e[1].trim()) {
        err = e[1].trim();
        // TAP 的 `error: |-` 形态：正文在下一行
        if (!err || err === '|-') err = (lines[j + 1] ?? '').trim();
        break;
      }
    }
    bad.push({ name, err });
  }
  return bad;
}

function runOne(rel) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', rel], {
    cwd: ROOT,
    encoding: 'utf8',
    // ★ shell:false（`process.execPath` 在 Windows 上含空格，经 cmd 会被截断 —— 见 verify.mjs 的 ts 门）
    shell: false,
    maxBuffer: 32 * 1024 * 1024,
    // ★ 2026-10-30：每文件一个自己的数据根（见 RUN_HOME_ROOT 那段论证）
    env: { ...process.env, [INJECT_VAR]: testDataHome(rel) },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { rel, ms: Date.now() - t0, status: r.status, out, ...tapCounts(out), failures: failuresOf(out) };
}

const files = testFiles();
console.log(`${C.b}测试门 —— tests/*.test.ts 真跑${C.x}  ${C.d}（node:test + tsx；逐文件取 TAP 计数）${C.x}`);
if (filter) console.log(`${C.y}★ --filter ${JSON.stringify(filter)}：这是**定向**跑，不进总门口径${C.x}`);
console.log(`${C.d}★ 数据隔离：每文件注入 ${INJECT_VAR}=${RUN_HOME_ROOT}/<文件>（跑完整棵删掉 ⇒ 真数据仓不碰）${C.x}`);
console.log('');

let bad = 0;
let tot = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
for (const f of files) {
  const r = runOne(`tests/${f}`);
  const ok = r.status === 0 && r.fail === 0 && (r.tests ?? 0) > 0 && (r.skipped ?? 0) === 0 && (r.todo ?? 0) === 0;
  const tag = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
  const cnt = r.tests === null ? '计数缺失' : `用例 ${r.pass}/${r.tests}`;
  const extra = r.skipped || r.todo ? `  ${C.y}skip ${r.skipped} / todo ${r.todo}${C.x}` : '';
  console.log(`  ${tag}  ${f.padEnd(34)} ${C.d}${String(r.ms).padStart(5)}ms  ${cnt}${C.x}${extra}`);
  if (r.tests === null) {
    // ★ 汇总行都没有 = 文件根本没跑起来（导入失败 / 语法错 / 进程崩）⇒ 不许当 0 处理
    console.log(`        ${C.r}没有 TAP 汇总行（文件没跑起来）⇒ 前 3 行：${C.x}`);
    for (const line of r.out.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3)) console.log(`        ${line.slice(0, 200)}`);
    bad++;
    continue;
  }
  tot.tests += r.tests;
  tot.pass += r.pass ?? 0;
  tot.fail += r.fail ?? 0;
  tot.skipped += r.skipped ?? 0;
  tot.todo += r.todo ?? 0;
  if (!ok) {
    bad++;
    if (r.tests === 0) console.log(`        ${C.r}0 个用例被执行 ⇒ 红（空跑等于没跑）${C.x}`);
    for (const x of r.failures) console.log(`        ${C.r}✗ ${x.name}${C.x}\n          ${x.err.slice(0, 300)}`);
    if (!r.failures.length && r.fail) {
      const first = r.out.split(/\r?\n/).filter((l) => /error|Error/.test(l))[0] ?? '';
      console.log(`        ${C.r}${first.trim().slice(0, 300)}${C.x}`);
    }
    if (r.skipped || r.todo) console.log(`        ${C.r}有 skip/todo ⇒ 这些用例没跑；本仓不许用它关掉门（要退役就按 docs/RETIRED.md 删断言）${C.x}`);
  }
}

// ★ 2026-10-30：整棵 temp 数据根删掉（每个测试文件那棵子目录一起没；删不掉不影响判定）
try {
  rmSync(RUN_HOME_ROOT, { recursive: true, force: true });
} catch {
  /* 删不掉不影响判定 */
}

console.log('');
// ★ 机器读的唯一一行（判据锚它）：文件数 / 用例数 / 通过 / 失败 / 跳过
console.log(`测试门：文件 ${files.length} / 用例 ${tot.tests} / 通过 ${tot.pass} / 失败 ${tot.fail} / 跳过 ${tot.skipped + tot.todo}`);
if (files.length === 0) {
  console.log(`${C.r}0 个测试文件 ⇒ 红（tests/*.test.ts 一个都没匹配上：要么被删空了，要么目录/命名变了）${C.x}`);
  process.exit(1);
}
if (bad || tot.fail || tot.skipped || tot.todo || tot.tests === 0) {
  console.log(`${C.r}⇒ 测试门红：${bad} 个文件没通过${bad ? '' : ''}（详见上面的 ✗ 行）${C.x}`);
  process.exit(1);
}
console.log(`${C.g}⇒ 测试门绿：${files.length} 个文件、${tot.tests} 个用例全部真跑过并通过${C.x}`);
