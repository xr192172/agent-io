#!/usr/bin/env node
/**
 * verify-clean —— 在**忠实于 CI checkout 的干净环境**里逐道门跑一遍，**只报告、不判死**。
 *
 * ## 它是什么 / 不是什么
 * - **是**一个诊断工具：回答"干净 clone 上到底哪几道门红、缺什么"。
 *   这个问题此前**没有任何本地命令**能回答 —— 只有推上去等 CI 才知道。
 * - **不是**一道门：不进 `scripts/verify.mjs` 的 `GATES`，不阻断任何人，退出码不表达红绿。
 * - **不许**为了让它变绿去改门的判据。它只如实报告干净环境下每道门的状态。
 *
 * ## 干净环境怎么造（为什么它等同于 CI 的 checkout）
 * | 步骤 | 做法 | 为什么等同于 CI |
 * |---|---|---|
 * | 源码 | `git clone --no-hardlinks <本仓> <work>/clean` | `actions/checkout` 拿到的就是"该 commit 的跟踪文件 + 一份 `.git`"，本地 clone 逐字节相同 |
 * | 落点 | 默认 `<本仓的父目录>/.agent-io-verify-clean-<ts>`，**不许在系统临时目录下** | 有门按"是不是系统临时目录"分类（见下方不变量）；CI 的 checkout 也不在 tmp 里 |
 * | 保真断言 | clone 后 `git status --porcelain --ignored` 必须为空、`rev-parse HEAD` 必须与源一致、`ls-files` 计数必须相等 | 断言不过 ⇒ **环境不是干净环境**，读数不可信（退出码 2，不冒充读数） |
 * | 依赖 | `npm ci` | 与 CI 同一条命令（锁文件驱动，不解析 semver） |
 * | 数据根 | **不设** `AGENT_IO_HOME` / `AGENT_IO_DATA_ROOT`；`HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` 隔离到 `<work>/home` | CI runner 上没有 `~/.agent-io`。★ 反过来**不许**在这里钉 `AGENT_IO_HOME` —— 一钉，`设计册判据` 的红就被盖掉了（那正是要测的东西） |
 *
 * ## 门名单的唯一权威
 * **复用** `scripts/verify.mjs` 导出的 `GATES` 与 `run()`（0.9 一处权威：门名单只许有一份）。
 * 本文件不写任何门名、不判任何门的对错，只负责"造环境 + 逐门跑 + 汇总"。
 *
 * ## CI 独有的步骤从哪来
 * `ci.yml` 里 `run:` 的命令**扫出来**（不是另抄一份）：已经被本脚本做过的那三条
 * （`npm ci` / `npm run build` / `npm run verify`）跳过，剩下的原样在干净环境里跑
 * —— verify 之外的 CI 步骤若有输入不入库，干净环境里的红也会从这里进得来。
 *
 * ## 退出码（三态，与 verify 的口径不同 —— 这里的红是**预期的读数**，不是失败）
 *   0 = 跑完了（无论几红）；2 = **环境没造起来**（clone 失败 / 保真断言不过）⇒ 没有可信读数
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATES, ROOT, run } from './verify.mjs';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[1m', d: '\x1b[90m', x: '\x1b[0m' };
const T_START = Date.now();

// ─────────────────────────── 入参 ───────────────────────────
const argv = process.argv.slice(2);
const flag = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf('=');
  return eq < 0 ? true : hit.slice(eq + 1);
};
if (flag('help')) {
  console.log(
    'verify:clean —— 干净 clone 上的门读数（诊断工具，不是门）\n\n' +
      '  npm run verify:clean\n' +
      '  npm run verify:clean -- --only=设计册,文档与事实   只跑名字含这些子串的步骤（子串匹配）\n' +
      '  npm run verify:clean -- --keep                          保留干净 clone（默认跑完删掉）\n' +
      '  npm run verify:clean -- --workdir=D:/work/vc            干净 clone 的落点（★ 不要在系统临时目录下）\n',
  );
  process.exit(0);
}
const ONLY = String(flag('only') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const KEEP = !!flag('keep');
// ★★★ 不变量：干净环境的落点**不许在系统临时目录下**（默认就落在**本仓的兄弟目录**）。
//   实测（2026-11-02）：默认落在 `os.tmpdir()` 时 `p0_registry_read_no_write` ⑥ **必红** ——
//   它断言"本仓根是**真项目根**、`registry_repair` 必须保留它"，而那个脚本的判据是
//   "**在系统临时目录下** ⇒ 候选（可删）"。clone 落在 tmp ⇒ 本仓根被自己判成临时目录 ⇒ **假红**。
//   ⇒ 这不是门的问题，是**造环境的人**把仓放错了地方。所以默认值避开 tmp，并在下面留一条响亮提醒。
const WORK = path.resolve(
  String(flag('workdir') || path.join(path.dirname(ROOT), `.agent-io-verify-clean-${Date.now()}`)),
);
const CLONE = path.join(WORK, 'clean');
const SANDBOX_HOME = path.join(WORK, 'home');

// ★ 落点在系统临时目录下 ⇒ 明确说"有一类门会被这个落点坑成假红"，而不是让它悄悄红。
{
  const rel = path.relative(os.tmpdir(), WORK);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    const msg = [
      `${C.y}⚠ 干净环境落在系统临时目录下（${WORK}）⇒ 有一类门会被**落点**坑成假红：`,
      '   `p0_registry_read_no_write` ⑥ 断言「本仓根是真项目根、必须保留」，而 `scripts/registry_repair.mjs`',
      '   的判据是「**在系统临时目录下** ⇒ 候选（可删）」⇒ clone 在 tmp 里时本仓根被自己判成临时目录。',
      `   这不是门的问题，是落点的问题。用 --workdir=<非 tmp 路径> 重跑。${C.x}`,
    ].join('\n');
    console.log(`${msg}\n`);
  }
}

// ★ 删除前的唯一守卫：绝不删到本仓、也绝不让本仓落在被删目录里（`rm -rf` 打错一次代价太大）。
{
  const norm = (p) => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  if (norm(CLONE) === norm(ROOT) || norm(ROOT).startsWith(norm(CLONE) + '/') || norm(SANDBOX_HOME) === norm(ROOT)) {
    console.error(`✗ 拒绝执行：干净环境的落点 ${CLONE} 与本仓 ${ROOT} 重叠 ⇒ 会把仓库删掉。换 --workdir。`);
    process.exit(2);
  }
}

// ─────────────────────────── 小工具 ───────────────────────────
const secs = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;
const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
/**
 * 显示宽度：CJK / 全角字符占 2 列。
 * ★ 不这么算，中文表格**一定**歪（`padEnd` 数的是 code unit）—— 而歪掉的表比没有表更难看懂。
 */
function dispWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}
const pad = (s, n) => (dispWidth(s) >= n ? String(s) : String(s) + ' '.repeat(n - dispWidth(s)));
const padStartW = (s, n) => (dispWidth(s) >= n ? String(s) : ' '.repeat(n - dispWidth(s)) + String(s));

/** 同步跑一条命令，返回 `{code, out, ms}`。`out` = stdout+stderr（截断到 64MB 上限，够用）。 */
function sh(cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    encoding: 'utf8',
    shell: opts.shell ?? false,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...(opts.env ?? {}) },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { code: r.error ? -1 : (r.status ?? -1), out: r.error ? `${out}\n${r.error.message}`.trim() : out, ms: Date.now() - t0 };
}

const git = (args, cwd = ROOT) => sh('git', args, { cwd });

/**
 * 干净环境里子进程用的环境变量：**隔离 HOME**，且**不钉数据根**。
 *
 * 不变量 ①（不钉数据根）：`AGENT_IO_HOME` 一旦被钉住，`设计册判据` 那道门就会找到册
 *   ⇒ 把"项目注册表不入 git"这个真问题**盖成绿**。干净环境的定义就是"没人为它钉过任何东西"。
 * 不变量 ②（隔离 HOME）：CI runner 上没有 `~/.agent-io`。不隔离 ⇒ 本机的 `~/.agent-io` 会参与
 *   判定（本机实测它存在，会让 `getDataHome()` 走 `os.homedir()` 分支），且门跑起来会往开发者的
 *   `~/.agent-io/dogfood/` 记账（把开发者的用量统计污染成假的 gate 跑）。
 */
function cleanEnv() {
  const env = {
    USERPROFILE: SANDBOX_HOME,
    HOME: SANDBOX_HOME,
    APPDATA: path.join(SANDBOX_HOME, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(SANDBOX_HOME, 'AppData', 'Local'),
  };
  for (const k of ['AGENT_IO_HOME', 'AGENT_IO_DATA_ROOT', 'AGENT_IO_DATA_DIR']) delete process.env[k];
  return env;
}

// ─────────────────────────── 步骤模型 ───────────────────────────
/** @typedef {{group:'env'|'ci'|'gate', name:string, state:'green'|'red'|'unsupported', ms:number, why:string, missing:string[], out:string}} Step */
/** @type {Step[]} */
const STEPS = [];
const push = (s) => {
  STEPS.push(s);
  return s;
};
const mark = (s) => (s.state === 'green' ? `${C.g}绿${C.x}` : s.state === 'red' ? `${C.r}红${C.x}` : `${C.y}unsupported${C.x}`);

/**
 * 「缺什么」——**测出来的**，不是写死的断言。
 *
 * 每一项都是"本地盘上有 / git 不跟踪 / 干净环境里没有"的实测三元组。
 * 这一张表就是"本地绿、CI 红"的**根因类**：门的输入里有不入库的东西。
 */
const IGNORED_INPUTS = [
  { probe: 'design-db', label: '设计 DB 投影（册的纯投影；`gen-db-check` 读它）' },
  { probe: '.agentio-data/projects.json', label: '项目注册表（feature → 项目根；CLI 靠它定位册）' },
  { probe: '.agent-io/cache.db', label: '符号索引（`fileFacts` / 影响面 / 判据的执行输入）' },
  { probe: '.agent-io/tasks.db', label: '任务卡库' },
  { probe: '.agent-io/COGNITION.txt', label: '认知索引（`cognition:check` 的产物）' },
];

/** 目录/文件在干净环境里有没有；本地有几份；git 跟踪几个。 */
function inventory() {
  const countFiles = (p) => {
    try {
      const st = fs.statSync(p);
      if (!st.isDirectory()) return 1;
      let n = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const q = path.join(d, e.name);
          if (e.isDirectory()) walk(q);
          else n++;
        }
      };
      walk(p);
      return n;
    } catch {
      return 0;
    }
  };
  return IGNORED_INPUTS.map((it) => {
    const src = path.join(ROOT, it.probe);
    const dst = path.join(CLONE, it.probe);
    const tracked = git(['ls-files', '--', it.probe]).out.split(/\r?\n/).filter(Boolean).length;
    return {
      probe: it.probe,
      label: it.label,
      tracked,
      localFiles: countFiles(src),
      inClean: fs.existsSync(dst),
    };
  });
}

/**
 * 逐步骤的「缺什么」注记（一句话说清缺哪个文件/哪类数据）。
 *
 * ★ 键是**步骤名**，所以门改名时这里会失配 ⇒ 末尾会打印 `⚠ 诊断注记失配`。
 *   为什么不做成"静默忽略"：一条对不上任何门的注记 = 一条永远不亮的提示（0.16 的同族）。
 * ★ 没有注记的红步骤**照样**给证据原文 ⇒ 缺什么永远不为空，只是不够精炼。
 */
const HINTS = {
  '实现夹具':
    '这道门有**三态**：exit 0 通过 · exit 1 断言红（夹具不符）· exit 2 跑不了/判不了 ⇒ 总门记 SKIP。' +
    '★ **看退出码，别去对报错原文**（原文随实现变，退出码契约不变）；exit 2 时会逐项点名缺什么（如「缺构建产物」⇒ 先 npm run build）',
  '设计 DB 结构':
    '`design-db/` 0 文件被跟踪 ⇒ 384 份投影全缺（`npm run gate` 会先 `design:gen-db`，`npm run verify` 不会）',
  '设计册判据':
    '`.agentio-data/projects.json`（项目注册表）不入 git ⇒ CLI 不知道这 3 册属于本仓 ⇒ 回落到 `<storageRoot>/design/` ⇒ 判据 0 条（exit 2）',
  '文档与事实': '`.agent-io/COGNITION.txt` 不入 git，且本地盘上也没有 ⇒ `cognition:check` 必红',
};

const hintFor = (name) => HINTS[name] ?? '';

/** 所有可能出现的步骤名（**不受 `--only` 过滤影响**）—— 用来核对 HINTS 有没有失配。 */
const ALL_NAMES = new Set();

// ═══════════════════════════ ① 干净环境 ═══════════════════════════
console.log(`${C.b}verify:clean —— 干净 clone 上的门读数${C.x}  ${C.d}（诊断工具，不是门；不进 verify，不阻断任何人）${C.x}\n`);
console.log(`${C.b}① 造干净环境${C.x}  ${C.d}（判据：等同于 CI 的 checkout = 只有 git 跟踪的文件 + 一条 npm ci 能装出来的依赖）${C.x}`);

const head = git(['rev-parse', 'HEAD']).out;
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
const dirty = git(['status', '--porcelain']).out.split(/\r?\n/).filter(Boolean);
const srcTracked = git(['ls-files']).out.split(/\r?\n/).filter(Boolean).length;
console.log(`  源仓        ${ROOT}  ${C.d}@ ${branch} ${head.slice(0, 8)}${C.x}`);
console.log(`  跟踪文件    ${srcTracked} 个（git ls-files）`);
if (dirty.length) {
  // ★ 不静默：干净 clone 只含 HEAD，工作区未提交改动**不在**读数里。
  console.log(`  ${C.y}未提交改动  ${dirty.length} 个文件 ⇒ 本次读数**只反映 HEAD**，不含这些改动${C.x}`);
} else {
  console.log('  未提交改动  0 个文件 ⇒ 干净 clone 与工作区一致');
}

fs.rmSync(CLONE, { recursive: true, force: true });
fs.rmSync(SANDBOX_HOME, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(SANDBOX_HOME, { recursive: true });

const tClone = Date.now();
const cloneR = git(['clone', '--no-hardlinks', '--quiet', ROOT, CLONE]);
const cloneMs = Date.now() - tClone;
if (cloneR.code !== 0) {
  console.error(`${C.r}✗ git clone 失败 ⇒ 干净环境没造起来，没有可信读数${C.x}\n${cloneR.out}`);
  process.exit(2);
}
console.log(`  clone       git clone --no-hardlinks → ${CLONE}  ${C.d}${secs(tClone)}${C.x}`);

// ── 保真断言：不通过就**不是**干净环境（0.12：造不出来 ≠ 没问题）
{
  const cHead = git(['rev-parse', 'HEAD'], CLONE).out;
  const cTracked = git(['ls-files'], CLONE).out.split(/\r?\n/).filter(Boolean).length;
  // ★ `--ignored` 一起列：刚 clone 完应当**一个 ignored 条目都没有** ——
  //   这一条是"干净环境里只有跟踪文件"的直接证据，而不是一句声明。
  const cIgnored = git(['status', '--porcelain', '--ignored'], CLONE).out.split(/\r?\n/).filter(Boolean);
  const bad = [];
  if (cHead !== head) bad.push(`HEAD 不一致：clone=${cHead.slice(0, 8)} 源=${head.slice(0, 8)}`);
  if (cTracked !== srcTracked) bad.push(`跟踪文件数不一致：clone=${cTracked} 源=${srcTracked}`);
  if (cIgnored.length) bad.push(`clone 里出现了 ${cIgnored.length} 个非跟踪条目（应当为 0）`);
  push({
    group: 'env',
    name: '干净 clone 保真',
    state: bad.length ? 'red' : 'green',
    ms: cloneMs,
    why: bad.length ? bad.join('；') : `HEAD 一致 · 跟踪文件 ${cTracked} 个 · 非跟踪条目 0`,
    missing: [],
    out: cIgnored.slice(0, 10).join('\n'),
  });
  if (bad.length) {
    console.error(`  ${C.r}✗ 保真断言不过${C.x}：${bad.join('；')}\n  ⇒ 这不是干净环境，读数不可信。`);
    process.exit(2);
  }
  console.log(`  保真断言    HEAD 一致 · 跟踪文件 ${cTracked} 个 · 非跟踪条目 0 ${C.g}✓${C.x}`);
}

const envClean = cleanEnv();

// ── 依赖：npm ci（与 CI 同一条命令）
{
  const t = Date.now();
  console.log(`  ${C.d}跑 npm ci …${C.x}`);
  const r = sh('npm', ['ci'], { cwd: CLONE, shell: process.platform === 'win32' });
  const pkgs = /added (\d+) packages/.exec(r.out)?.[1] ?? '?';
  push({
    group: 'env',
    name: 'npm ci',
    state: r.code === 0 ? 'green' : 'red',
    ms: r.ms,
    why: r.code === 0 ? `${pkgs} packages` : `退出码 ${r.code}`,
    missing: [],
    out: r.out,
  });
  console.log(`  npm ci      ${pkgs} packages  ${C.d}${secs(t)}${C.x}`);
}

// ── 构建：npm run build（CI 的 node-test 与 verify job 都先跑它；verify 的 mcp_scan 门要 dist/）
{
  const t = Date.now();
  console.log(`  ${C.d}跑 npm run build …${C.x}`);
  const r = sh('npm', ['run', 'build'], { cwd: CLONE, shell: process.platform === 'win32' });
  const orphans = /孤儿[^\n]*?(\d+) 个/.exec(r.out)?.[1];
  push({
    group: 'env',
    name: 'npm run build',
    state: r.code === 0 ? 'green' : 'red',
    ms: r.ms,
    why: r.code === 0 ? `dist 与源码一一对应${orphans != null ? `（孤儿 ${orphans} 个）` : ''}` : `退出码 ${r.code}`,
    missing: [],
    out: r.out,
  });
  console.log(`  build       ${r.code === 0 ? 'ok' : `退出码 ${r.code}`}  ${C.d}${secs(t)}${C.x}`);
}

// ═══════════════════════════ ② CI 独有的步骤（从 ci.yml 派生）═══════════════════════════
console.log(`\n${C.b}② CI 步骤${C.x}  ${C.d}（从 .github/workflows/ci.yml 扫 run: 派生 —— 不另抄一份门名单）${C.x}`);

const CI_FILE = path.join(ROOT, '.github', 'workflows', 'ci.yml');
/** 本脚本已经做过 / 改由 GATES 逐门复放的命令 ⇒ 不再原样重放。 */
const HANDLED = new Map([
  ['npm ci', { short: '①已跑', why: '① 造环境时已用同一条 `npm ci` 装过依赖' }],
  ['npm run build', { short: '①已跑', why: '① 造环境时已用同一条 `npm run build` 构建过' }],
  ['npm run verify', { short: '③复放', why: '③ 由 GATES 逐门复放（同一个 `run()`，只是拆成逐门读数）' }],
]);

/**
 * 扫 ci.yml 的 `run:` 步骤。
 *
 * ★ 只认单行 `run:`；遇到块标量（`run: |`）**不猜**，标 unsupported 并说明 —— 静默跳过等于假装它不存在。
 * ★ `working-directory: ${{ matrix.module }}` 用 `matrix: module: [...]` 解析（本项目里就是 `observe-lang-go`）。
 */
function parseCi() {
  const text = fs.readFileSync(CI_FILE, 'utf8');
  const lines = text.split(/\r?\n/);
  let modules = [];
  for (const l of lines) {
    const m = /^\s*module:\s*\[(.+)\]\s*$/.exec(l);
    if (m) modules = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  const steps = [];
  let cur = null;
  const flush = () => {
    if (cur) steps.push(cur);
    cur = null;
  };
  for (const line of lines) {
    const nameOnly = /^\s*-\s*name:\s*(.+?)\s*$/.exec(line);
    const dash = /^\s*-\s*(?:\S.*)?$/.test(line) && /^\s*-\s/.test(line);
    if (nameOnly) {
      flush();
      cur = { name: nameOnly[1], run: null, cwd: null, if: null, block: false };
      continue;
    }
    if (dash) {
      flush();
      cur = { name: null, run: null, cwd: null, if: null, block: false };
      continue;
    }
    if (!cur) continue;
    const runM = /^\s*run:\s*(.*)$/.exec(line);
    if (runM) {
      const v = runM[1].trim();
      if (!v || /^[|>]/.test(v)) cur.block = true;
      else cur.run = v;
      continue;
    }
    const wd = /^\s*working-directory:\s*(.+?)\s*$/.exec(line);
    if (wd) cur.cwd = wd[1];
    const iff = /^\s*if:\s*(.+?)\s*$/.exec(line);
    if (iff) cur.if = iff[1];
  }
  flush();
  return { modules, steps };
}

const ci = parseCi();
const ciOnly = [];
const seen = new Set();
for (const s of ci.steps) {
  if (s.block) {
    ciOnly.push({ name: s.name ?? '(无名步骤)', block: true, cwd: null });
    continue;
  }
  if (!s.run) continue;
  const key = `${s.run} @ ${s.cwd ?? '.'}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const cwdRel = s.cwd ? s.cwd.replace('${{ matrix.module }}', ci.modules[0] ?? '?') : null;
  const resolvable = !s.cwd || (!s.cwd.includes('matrix.module') || ci.modules.length === 1);
  ciOnly.push({ name: s.name ?? s.run, run: s.run, cwd: cwdRel, resolvable, if: s.if ?? null, handled: HANDLED.get(s.run) });
}
if (!ciOnly.length) {
  // 0.12：读不到 ≠ 没有
  push({
    group: 'ci',
    name: 'ci.yml 解析',
    state: 'unsupported',
    ms: 0,
    why: `从 ${path.relative(ROOT, CI_FILE)} 里一条 run: 都没扫到 ⇒ 这份 CI 定义没被复放（不代表它没事）`,
    missing: [],
    out: '',
  });
}
console.log(`  ${C.d}矩阵：os=[${(/(\bos:\s*\[(.+)\])/.exec(fs.readFileSync(CI_FILE, 'utf8'))?.[2] ?? '?').replace(/\s+/g, '')}] · node=[22] ⇒ 本机按当前平台复放 1 次${C.x}`);

for (const s of ciOnly) {
  ALL_NAMES.add(s.name);
  if (s.block) {
    push({
      group: 'ci',
      name: s.name,
      state: 'unsupported',
      ms: 0,
      why: 'ci.yml 里这一步是多行 run（块标量）⇒ 本工具不猜它的语义，未复放',
      missing: [],
      out: '',
    });
    continue;
  }
  if (s.handled) {
    // ★ 名字里带上"已由谁执行"：绿行不贴输出，光写 `npm ci` 会让人以为它又跑了一遍。
    push({
      group: 'ci',
      name: `${s.name} 〔${s.handled.short}〕`,
      state: 'green',
      ms: 0,
      why: s.handled.why,
      missing: [],
      out: '',
    });
    continue;
  }
  if (!s.resolvable) {
    push({
      group: 'ci',
      name: s.name,
      state: 'unsupported',
      ms: 0,
      why: 'working-directory 用了 `${{ matrix.module }}` 而 matrix.module 不是单值 ⇒ 无法确定 cwd',
      missing: [],
      out: '',
    });
    continue;
  }
  if (ONLY.length && !ONLY.some((k) => s.name.includes(k) || (s.run ?? '').includes(k))) continue;
  const cwd = s.cwd ? path.join(CLONE, s.cwd) : CLONE;
  console.log(`  ${C.d}跑 [CI] ${s.run} …${C.x}`);
  // ★ `shell: true` 恒开：`run:` 的值是**一整行命令行**（`node …` / `go build ./...`），
  //   不是 argv —— 拆成 argv 需要另写一个 shell 词法器，那是第二把尺。
  const r = sh(s.run, [], { cwd, shell: true, env: envClean });
  const exists = fs.existsSync(cwd);
  const guard = s.if ? `；ci.yml 条件 ${s.if}（本环境未设该变量 ⇒ 按"跑"处理）` : '';
  push({
    group: 'ci',
    name: s.name,
    state: !exists ? 'unsupported' : r.code === 0 ? 'green' : 'red',
    ms: r.ms,
    why: (!exists ? `目录不存在：${s.cwd}` : r.code === 0 ? '退出码 0' : `退出码 ${r.code}`) + guard,
    missing: [],
    out: r.out,
  });
}

// ═══════════════════════════ ③ GATES（复用 verify.mjs）═══════════════════════════
console.log(`\n${C.b}③ 总门 GATES${C.x}  ${C.d}（复用 scripts/verify.mjs 的 GATES 清单与 run()，共 ${GATES.length} 项）${C.x}`);

const gates = GATES.map((g) => (typeof g === 'function' ? g(CLONE) : g));
for (const g of gates) {
  ALL_NAMES.add(g.name);
  if (ONLY.length && !ONLY.some((k) => g.name.includes(k))) continue;
  console.log(`  ${C.d}跑 [门] ${g.name} …${C.x}`);
  const t = Date.now();
  const r = run(g, CLONE, envClean);
  push({
    group: 'gate',
    name: g.name,
    // ★ 三态映射与 verify 一致：SKIP（跑不了）在干净环境里就是 unsupported，不是红也不是绿
    state: r.state === 'PASS' ? 'green' : r.state === 'FAIL' ? 'red' : 'unsupported',
    ms: Date.now() - t,
    why: r.state === 'PASS' ? '' : r.why,
    missing: [],
    out: r.out,
  });
}

// ═══════════════════════════ ④ 汇总 ═══════════════════════════
const inv = inventory();
const steps = STEPS;
const green = steps.filter((s) => s.state === 'green').length;
const red = steps.filter((s) => s.state === 'red').length;
const unsup = steps.filter((s) => s.state === 'unsupported').length;

/**
 * 取证据原文：首 N + 末 N + **所有"错在哪"的行**。
 *
 * ★ 为什么不能只印首尾：本工具第一版就是首 15 + 末 15，而 `测试` 门有 68 行输出、
 *   失败的那一行**正好落在省略号里** ⇒ 报出"1 个文件没通过"却点不出是哪个文件。
 *   "没看到"与"没有"长得一样（0.12），所以关键行必须无条件保留。
 */
const clipLines = (s, head = 12, tail = 12) => {
  const ls = String(s).split(/\r?\n/).filter((l) => l.trim());
  if (ls.length <= head + tail + 4) return ls.join('\n');
  const keep = new Set();
  for (let i = 0; i < Math.min(head, ls.length); i++) keep.add(i);
  for (let i = Math.max(0, ls.length - tail); i < ls.length; i++) keep.add(i);
  const KEY = /FAIL|✗|❌|Error|error:|退出码|TypeError|Cannot|没通过|失败|红：/;
  for (let i = 0; i < ls.length; i++) if (KEY.test(ls[i])) keep.add(i);
  const idx = [...keep].sort((a, b) => a - b);
  const out = [];
  let prev = -1;
  for (const i of idx) {
    if (prev >= 0 && i > prev + 1) out.push(`…（★ 省略 ${i - prev - 1} 行）`);
    out.push(ls[i]);
    prev = i;
  }
  return out.join('\n');
};

console.log(`\n${C.b}④ 汇总${C.x}  ${C.d}（红/unsupported 都附"缺什么" + 证据原文；绿的不贴输出）${C.x}\n`);
const wName = Math.max(...steps.map((s) => dispWidth(s.name)), 10) + 2;
console.log(`  ${pad('状态', 14)}${pad('步骤', wName)}${pad('组', 8)}耗时`);
console.log(`  ${'-'.repeat(14 + wName + 8 + 10)}`);
for (const s of steps) {
  const tag =
    s.state === 'green' ? `${C.g}绿${C.x}` : s.state === 'red' ? `${C.r}红${C.x}` : `${C.y}unsupported${C.x}`;
  const grp = s.group === 'gate' ? '门' : s.group === 'ci' ? 'CI' : '环境';
  console.log(`  ${pad(tag, 14)}${pad(s.name, wName)}${pad(grp, 8)}${padStartW((s.ms / 1000).toFixed(1) + 's', 8)}`);
  // ★ 绿行也可能有话说（"已由本工具执行"），所以 `why` 不只给红行 —— 只是绿的用暗色。
  if (s.state === 'green') {
    if (s.why) console.log(`      ${C.d}${s.why}${C.x}`);
    continue;
  }
  const hint = hintFor(s.name);
  if (hint) console.log(`      ${C.y}缺什么${C.x}：${hint}`);
  if (s.why) console.log(`      ${C.d}为什么${C.x}：${s.why}`);
  if (s.out) console.log(`      ${C.d}证据${C.x}：\n${clipLines(s.out).split('\n').map((l) => `        ${l}`).join('\n')}`);
}

// ── 干净环境里缺的、而本地盘上有的（这是"本地绿 / CI 红"的根因类）
console.log(`\n${C.b}⑤ 干净环境里缺的、而本地盘上有的${C.x}  ${C.d}（git 不跟踪 ⇒ 本地绿是"文件在我盘上"，不是"门真的能过"）${C.x}\n`);
console.log(`  ${pad('路径', 34)}${pad('git 跟踪', 14)}${pad('本地盘上', 12)}干净环境`);
console.log(`  ${'-'.repeat(34 + 14 + 12 + 10)}`);
for (const it of inv) {
  const flagTxt = it.tracked === 0 ? `${C.r}0 个${C.x}` : `${it.tracked} 个`;
  const localTxt = it.localFiles === 0 ? '无' : `${it.localFiles} 个`;
  const cleanTxt = it.inClean ? `${C.g}有${C.x}` : `${C.r}无${C.x}`;
  console.log(`  ${pad(it.probe, 34)}${pad(flagTxt, 14)}${pad(localTxt, 12)}${cleanTxt}`);
  console.log(`    ${C.d}${it.label}${C.x}`);
}

// ── 慢在哪
const slow = [...steps].filter((s) => s.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 3);
const totalMs = Date.now() - T_START;
console.log(`\n${C.b}⑥ 总判${C.x}`);
console.log(`  干净环境 ${C.b}${green}/${steps.length}${C.x} 步可绿（红 ${red} · unsupported ${unsup}）`);
if (ONLY.length) console.log(`  ${C.d}（本次只跑了 ${steps.length} 步：--only=${ONLY.join(',')} 过滤；全量读数用不带 --only 的那次）${C.x}`);
console.log(`  总耗时 ${C.b}${(totalMs / 1000 / 60).toFixed(1)} min${C.x}`);
if (slow.length) console.log(`  慢在哪：${slow.map((s) => `${s.name} ${(s.ms / 1000).toFixed(0)}s`).join(' · ')}`);
if (red || unsup) {
  console.log(
    `  ${C.d}★ 红/unsupported 是**本次的读数**，不是本工具的失败：本工具只如实报告，不阻断任何人。` +
      `\n  只想看某几门：npm run verify:clean -- --only=<步骤名的子串>[,<再一个>]${C.x}`,
  );
}
console.log(
  `  ${C.d}★ 本表是**一次采样**（每步跑 1 次）。某步红绿只是"这一次"；要判它是否**稳定**红/绿，` +
    `连跑 3 次看同不同 —— 实测确实有步骤会时红时绿（冷缓存 / 落点 / 时序），那不是本工具的错，` +
    `但**一次绿不能当结论**。${C.x}`,
);

// ── 诊断注记失配（0.16：一条永远对不上的注记 = 一条永远不亮的提示）
const stale = Object.keys(HINTS).filter((k) => !ALL_NAMES.has(k));
if (stale.length) {
  console.log(`\n${C.y}⚠ 诊断注记失配：HINTS 里 ${stale.length} 条对不上任何步骤（门改名了？）⇒ ${stale.join(' / ')}${C.x}`);
}

if (!KEEP) {
  fs.rmSync(WORK, { recursive: true, force: true });
  // ★★ 清理失败必须出声（0.12）：`rmSync({force:true})` 会把"删不掉"咽掉。
  //   实测（2026-11-02）：`测试` 门跑完可能留下**孤儿 node 进程**，它们握着干净环境里的
  //   `node_modules/*.node` 与 `.agent-io/cache.db` ⇒ Windows 上整个目录删不掉（实测残留 ~500MB）。
  //   静默吞掉 ⇒ 下一个跑的人以为没残留，直到磁盘满。
  if (fs.existsSync(WORK)) {
    const mb = (() => {
      let n = 0;
      const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const q = path.join(d, e.name);
          try {
            if (e.isDirectory()) walk(q);
            else n += fs.statSync(q).size;
          } catch {
            /* 单个文件读不到不影响总量下限 */
          }
        }
      };
      try {
        walk(WORK);
      } catch {
        /* 目录都读不全 ⇒ 下面的"至少 N MB"按已知部分算 */
      }
      return Math.round(n / 1024 / 1024);
    })();
    console.log(
      `\n${C.y}⚠ 干净环境没删干净：${WORK}（至少 ${mb} MB）仍被占用。\n` +
        `   常见原因：某个门留下了**孤儿 node 进程**握着它的 node_modules / cache.db。\n` +
        `   处置：\`Get-CimInstance Win32_Process -Filter "Name='node.exe'"\` 找那个进程并结束，再手删这个目录。${C.x}`,
    );
  }
} else {
  console.log(`\n${C.d}干净环境保留在：${WORK}${C.x}`);
}
process.exit(0);
