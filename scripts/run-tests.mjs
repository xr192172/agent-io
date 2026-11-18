#!/usr/bin/env node
/**
 * 测试门 —— 把 `tests/` 下的 `node:test` 用例**真跑一遍**，按 TAP 计数判红。
 *
 * ★ 为什么要有它（本仓的病）：`tests/` 下**全部** `*.test.ts`（文件数由本脚本自己打印 —— 别在注释里抄），
 *   而 `scripts/verify.mjs` 的 `GATES` 里
 *   **没有任何一道跑它们** —— 有测试、没裁判，比没测试更糟（`tests/i1_doc_alignment.test.ts` 的正则
 *   曾断言一句**已被改掉**的工具描述，靠人工发现才修上）。
 *
 * ## 判红的四条（缺一条这道门就是假绿灯）
 * 1. **退出码非 0** 或 **`# fail > 0`** ⇒ 红；
 * 2. **`0 个用例被执行`** ⇒ 红（空跑等于没跑：文件被删空、glob 没匹配上、`--test` 只跑了 0 条，
 *    都会静默退 0）；
 * 3. **`skipped / todo > 0`** ⇒ 红（本仓口径：不许用 skip/todo 把门关掉 —— 那会把"有测试没裁判"
 *    重演一遍，而且是**更隐蔽**的一遍）；
 * 4. **源码里 `test(` / `it(` 一个都没有** ⇒ 红（★ 见下"两条口径"：`tests > 0` 骗得过这一态）。
 *
 * ## 两条口径（分工写清，别混）
 * · **通过/失败**只认 runner 自己的 TAP 汇总行（`# tests` / `# pass` / `# fail` / `# skipped` / `# todo`）
 *   —— 跑起来才有数；
 * · **源码计数**只当**下限守卫**（`countTestCalls`，剥注释与字符串后数 `test(` / `it(`）：
 *   它不参与"过了几条"，只判两件事 —— ① 该文件**声明了 0 条**用例 ⇒ 红；② TAP 报的用例数
 *   **少于**源码声明的条数 ⇒ 红（有声明的用例没跑出来）。
 *   ★ 为什么必须有这一条：`tests > 0` 挡不住"文件在、用例没了" —— 实测把 `*.test.ts` 清空后
 *   runner 仍报「用例 1/1 通过」并退出 0（node:test 会为"这个文件"合成一条），门就绿了。
 *   ⇒ 「跑了几条」与「声明了几条」必须**两个数都看**，否则空文件与真跑过在读数上同形（0.12）。
 *
 * ## 为什么逐文件跑（而不是一次全跑）
 * 一次全跑的 TAP 里**没有文件名**（只有用例名）⇒ 报红时说不出"哪个文件红"，门就退化成"有一坨红"。
 * 逐文件 spawn 一次拿到**文件级**读数，代价是每个文件一次进程启动（本地实测 ~10s，可接受）。
 *
 * ## 跑法
 * ```
 * node scripts/run-tests.mjs                  # 全跑（默认；总门就是这么调的）
 * node scripts/run-tests.mjs --filter i1_     # 定向（内环用；★ 不进总门，**不判规模棘轮**，只打印覆盖缺口）
 * node scripts/run-tests.mjs --update-baseline             # 重建规模基线（只许全量、零失败；**只许升**）
 * node scripts/run-tests.mjs --update-baseline --allow-lower  # 显式放宽基线（降幅会大字打印；要有证据）
 * node scripts/run-tests.mjs --jobs 4            # 并行跑（★ 输出仍按**文件原顺序**；产者护栏降级，见下）
 * ```
 * ★ 规模棘轮的三条口径（定向跑不判 / 只许升 / 落后显形）见文件末尾那一大段注释 —— 全部由实测翻车得来。
 *
 * ## `--jobs N`（增量化第一批 · 项 1；★ 默认 1 = **逐字**保持原串行行为）
 * · 为什么默认 1 而不是"核数"：本门的读数是**逐文件**的（判红点什么文件、产者护栏点名"哪一次测试写的"）
 *   —— 这两件事都以"**确定的执行顺序**"为前提。默认档必须是不改变语义的那一档，快是**可选项**。
 * · 并行时：结果**按 index 缓冲**，跑完再**按文件原顺序**打印（完成序会让逐文件行与 TAP 汇总读起来
 *   对不上号；node:test 自己的 reporter 也是"声明序缓冲、执行序另发"两套事件，见自述里的网检）。
 * · 产者护栏的**诚实降级**（0.12：判不了要说判不了）：`--jobs >1` 时只做「跑前 / 跑后各拍一次真册
 *   sha256」，变了就报红并要求用 `--jobs 1` 复跑点名 —— **不假装**能指出污染者。
 * · 数据隔离口径：`RUN_HOME_ROOT/w<槽位>/<文件>/` —— 槽位由 worker 池**建池时固定**（串行档恒 `w0`），
 *   槽下面**仍每文件一个子目录** ⇒ `--jobs 1` 与 `--jobs N` 的隔离**同口径**（唯一差别是多一层 `wN/`）。
 *   真仓写面测试若自己钉了 `AGENT_IO_HOME`，照旧以它为准（48/135 个文件自钉，见自述；分组改造另卡）。
 * · **`--jobs 1` 仍是实时逐文件打印**（跑一个、判一个、当场一行）：不用"池里放 1 个 worker"来省分支 ——
 *   那样逐文件行会等到全部跑完才出现（对 135 个文件 = 几分钟没有任何输出，红在哪要等最后才知道）。
 * TS 直跑用 `--import tsx`（测试从 `../src/*.ts` 导入，`.js` 后缀指向 TS 源；Node 自带 type
 * stripping 解析不了这种后缀映射）⇒ 不需要 `npm run build`，测试读的是**源码**而不是 dist。
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectTestFiles } from './lib/test_files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

const args = process.argv.slice(2);
const fi = args.indexOf('--filter');
const filter = fi >= 0 ? (args[fi + 1] ?? '') : '';

// ★★★ 2026-11-17（增量化第一批 · 项 1）：`--jobs N` 并发度。**缺省 = 1 = 原串行路径**（零变化）。
//   ★ 非法值**响亮判红**（不是"看不懂就当 1"）：判不了 ≠ 没写 —— 静默回落会让 `--jobs 0` 与没写同形。
const ji = args.indexOf('--jobs');
const jobsArg = ji >= 0 ? args[ji + 1] : undefined;
const jobs = (() => {
  if (ji < 0) return 1;
  const n = Number(jobsArg);
  if (!Number.isInteger(n) || n < 1) {
    console.log(`${C.r}✗ --jobs 后面必须跟 ≥1 的整数（实际收到 ${JSON.stringify(jobsArg ?? null)}）⇒ 拒绝跑（不猜你的意思）${C.x}`);
    process.exit(1);
  }
  return n;
})();
/** ★ 并行档（`--jobs >1`）：唯一的语义差异是"产者护栏判不了是谁"（见文件头与末尾那段） */
const PARALLEL = jobs > 1;

// ★★★ 2026-10-30（T-#REG-POLLUTE）：**测试跑在自己的数据根里** —— 与 `certs/run-all-certs.mjs` 同一笔修法。
// 病：测试若 `importProject` 一个 temp 夹具项目，登记会落进**真数据仓**（`<包根>/.agentio-data/projects.json`），
//     而运行期一过那条登记就永远指向一个不存在的目录 ⇒ 注册表（总任务视图的钥匙）被幽灵条目弄脏。
// 修法：本次 run 建一个 temp 根 ⇒ **每个测试文件一个子目录**当 `AGENT_IO_HOME` ⇒ 跑完整棵删掉。
// ★ 注入 `AGENT_IO_HOME` 而不是 `AGENT_IO_DATA_ROOT`：`getStorageRoot()` 里 ① DATA_ROOT 优先于 ② HOME，
//   钉外层 DATA_ROOT 会把测试自己钉的 `AGENT_IO_HOME`（`i1_*` / `p0_*` 全都自己钉了 mkdtemp）**抢掉**；
//   用 HOME 则"测试自己的声明永远赢"，没钉的那几个才落到这里。
const RUN_HOME_ROOT = mkdtempSync(path.join(os.tmpdir(), 'agent-io-tests-home-'));
const INJECT_VAR = process.env.AGENT_IO_DATA_ROOT?.trim() ? 'AGENT_IO_DATA_ROOT' : 'AGENT_IO_HOME';
/**
 * 一个文件自己的数据根。
 *
 * 第二参 `slot` = **worker 固定槽位**（串行档恒 0）。
 * ★★ 为什么槽位是**入参**、而不是"函数上的计数器 / 闭包里现加一个变量"（增量化第一批 · 项 1 的坑）：
 *   并发下累加器会被几个 worker **交错自增** ⇒ 要么两个 worker 拿到同一个号（互踩同一个数据根），
 *   要么同一个 worker 的两个文件拿到不同号（"槽位"与实际并发度**双计错位**，读数不可归因）。
 *   ⇒ 槽位由 `runPool` **建池那一刻固定**（第 k 个 worker 永远拿 k），文件→槽的映射因此是确定的。
 * ★ 槽**下面**仍然**每文件一个子目录**：这比"每 worker 一个目录"更强（同一 worker 的两个文件也不共享根），
 *   而 `--jobs 1` 与 `--jobs N` 的隔离口径因此**逐字相同**（唯一差别是多了一层 `wN/`）。
 */
function testDataHome(rel, slot = 0) {
  const dir = path.join(RUN_HOME_ROOT, `w${slot}`, rel.replace(/[^\w.-]/g, '_'));
  mkdirSync(dir, { recursive: true });
  return INJECT_VAR === 'AGENT_IO_HOME' ? path.join(dir, 'home') : dir;
}

/**
 * 测试文件清单（`tests/` 下**递归**的 `*.test.ts`；`tests/helpers/` 是夹具、不是用例）。
 *
 * ★★ 2026-11-02（载荷预算卡）：原先是 `readdirSync('tests')` —— **只扫顶层**。于是
 *   `tests/budget/payload_budget.test.ts`（判据要求住这个子目录）**一条都没被跑**，而门照样报绿：
 *   这正是本文件头注批的"有测试、没裁判"。现在递归；返回**相对 `tests/` 的路径**（带目录，
 *   报红时一眼看出是哪个子目录的文件）。
 * ★ 只有 `.test.ts` 才进清单 ⇒ `fixtures/budget-proj/generate.ts`（夹具生成器）不会混进用例。
 */
function testFiles(useFilter = true) {
  // ★★ 唯一实现已抽到 `scripts/lib/test_files.mjs`（0.9.1）：`verify-changed.mjs`
  //   原先自己写了一份「只扫顶层」的收集器（82 vs 85），注释却声称与本文件一致。
  //   ★ 2026-11-02（载荷预算卡）：原先是 `readdirSync('tests')` —— **只扫顶层**。于是
  //   `tests/budget/payload_budget.test.ts`（判据要求住这个子目录）**一条都没被跑**，而门照样报绿：
  //   这正是本文件头注批的"有测试、没裁判"。
  const out = collectTestFiles(path.join(ROOT, 'tests'));
  // ★ 2026-11-03（T-#TEST-BASELINE-LAG）：`useFilter=false` ⇒ 给"全量几个文件"这个分母用
  //   （定向跑必须能说出"未覆盖 M−N 个"，M 不能是它自己那 1 个 —— 0.12 ③）。
  return out.filter((f) => (useFilter && filter ? f.includes(filter) : true));
}

/** 正则字面量可以开始的位置：这些**显著字符**之后的 `/` 是正则开头（不是除号） */
const REGEX_PREV_CH = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>']);
/** 同上，但前一个 token 是**关键字**时（`return /re/` · `typeof /re/` · `case /re/:` …） */
const REGEX_PREV_KW = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void', 'new', 'yield', 'await', 'do', 'else']);

/**
 * 这个 `/` 是不是**正则字面量的开始**（而不是除号）。
 * ★ 为什么非判不可：正则里可以含**引号**与**星号**（例如匹配引号字符类、或匹配注释定界符）——
 *   把它当成字符串/注释的开头就会把后面真正的用例调用整段吞掉（实测：两个测试文件被吞成 1 条）。
 * 判据 = 前一个显著字符落在 `REGEX_PREV_CH`，或前一个 token 是关键字；否则按除号处理。
 */
function isRegexStart(lastCh, word) {
  if (!lastCh) return true; // 文件开头
  if (REGEX_PREV_CH.has(lastCh)) return true;
  return /[\w$]/.test(lastCh) && REGEX_PREV_KW.has(word);
}

/**
 * 把**注释、字符串内容、正则字面量**抹成空格（保留换行，行号不变）—— 给 `countTestCalls` 用。
 *
 * 为什么要抹：源码计数只在"文本形状本身就是答案"的场合可用，而**注释掉的 `test(`** 与
 * **测试名里的 `it(`** 都不是用例 ⇒ 不抹掉就会把 0 用例的文件算成有。
 * ★ 手写状态机而不是正则：模板字符串的 `${…}` 里可以再嵌模板/字符串、正则里可以有引号，
 *   正则（那一种）表达不了这些嵌套；抹错的方向是把真调用吞掉（假红），所以宁可多几行也要做对。
 */
function stripNonCode(src) {
  const out = [];
  const st = ['root']; // root=代码（含模板插值内）· line/block=注释 · sq/dq/tmpl=字符串 · regex=正则 · expr=插值花括号层
  const top = () => st[st.length - 1];
  let lastCh = ''; // 上一个**显著**（非空白）代码字符
  let word = ''; // lastCh 所在的标识符（判关键字用）
  let reClass = false; // 正则的字符类 `[…]` 内：`/` 不是结束符
  for (let i = 0; i < src.length; ) {
    const c = src[i];
    const c2 = src[i + 1];
    const t = top();
    if (t === 'line') {
      if (c === '\n') {
        st.pop();
        out.push('\n');
      } else out.push(' ');
      i++;
      continue;
    }
    if (t === 'block') {
      if (c === '*' && c2 === '/') {
        st.pop();
        out.push('  ');
        i += 2;
      } else {
        out.push(c === '\n' ? '\n' : ' ');
        i++;
      }
      continue;
    }
    if (t === 'regex') {
      if (c === '\\') {
        out.push('  ');
        i += 2;
        continue;
      }
      if (c === '[') reClass = true;
      else if (c === ']') reClass = false;
      else if (c === '/' && !reClass) {
        st.pop();
        out.push(' ');
        i++;
        lastCh = '/'; // 正则字面量是一个**值** ⇒ 后面的 `/` 是除号
        word = '';
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    if (t === 'sq' || t === 'dq' || t === 'tmpl') {
      const q = t === 'sq' ? "'" : t === 'dq' ? '"' : '`';
      if (c === '\\') {
        out.push('  ');
        i += 2;
        continue;
      }
      if (t === 'tmpl' && c === '$' && c2 === '{') {
        st.push('expr');
        out.push('  ');
        i += 2;
        continue;
      }
      if (c === q) {
        st.pop();
        out.push(' ');
        i++;
        // 字符串/模板结束时它是一个**值** ⇒ 记一个"值已结束"标记（`"` 不在 REGEX_PREV_CH 里 ⇒ 后面 `/` 按除号）
        lastCh = '"';
        word = '';
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }
    // 代码态（root / expr）
    if (c === '/' && c2 === '/') {
      st.push('line');
      out.push('  ');
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      st.push('block');
      out.push('  ');
      i += 2;
      continue;
    }
    if (c === '/' && isRegexStart(lastCh, word)) {
      st.push('regex');
      reClass = false;
      out.push(' ');
      i++;
      continue;
    }
    if (c === "'") {
      st.push('sq');
      out.push(' ');
      i++;
      continue;
    }
    if (c === '"') {
      st.push('dq');
      out.push(' ');
      i++;
      continue;
    }
    if (c === '`') {
      st.push('tmpl');
      out.push(' ');
      i++;
      continue;
    }
    if (t === 'expr' && c === '{') {
      st.push('expr');
      out.push('{');
      lastCh = '{';
      word = '';
      i++;
      continue;
    }
    if (t === 'expr' && c === '}') {
      st.pop();
      out.push(' ');
      i++;
      continue;
    }
    out.push(c);
    i++;
    if (!/\s/.test(c)) {
      if (/[\w$]/.test(c)) word = /[\w$]/.test(lastCh) ? word + c : c;
      else word = '';
      lastCh = c;
    }
  }
  return out.join('');
}

/**
 * 源码里**声明了几条**用例（`test(` / `it(` 调用）。
 *
 * 口径：剥掉注释与字符串后数调用点；`describe(` 不算；`obj.test(` / `t.test(` 这类**成员调用**不算
 * （前面是 `.`），`test.only(` 不算（里面不是直接跟 `(`）。
 * ★ 它是**下限守卫**，不是"通过了几条"的计数（后者只认 TAP）。
 */
function countTestCalls(src) {
  const m = stripNonCode(src).match(/(?:^|[^\w$.])(?:test|it)\s*\(/g);
  return m ? m.length : 0;
}

/** 读文件 → 源码声明的用例条数；读不到 ⇒ `{n:null, err}`（判不了 ≠ 0 条） */
function staticCallsOf(rel) {
  try {
    return { n: countTestCalls(readFileSync(path.join(ROOT, rel), 'utf8')), err: '' };
  } catch (e) {
    return { n: null, err: `读不到源码（${e?.message ?? String(e)}）` };
  }
}

/** TAP 汇总行 → 计数（拿不到 = null，**不是 0**：判不了 ≠ 通过） */
function tapCounts(out) {  const n = (re) => {
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

/**
 * 跑**一个**测试文件，返回它的读数（TODO：async ⇒ `spawn` 而非 `spawnSync` —— `--jobs >1` 要能并发）。
 *
 * ★ 读数形状与改前的 `spawnSync` 版**逐字段一致**（`rel/ms/status/out` + TAP 计数 + `failures`）⇒ 下游判定
 *   （`reportRun` / 汇总行 / 产者护栏）一个字都不用改（0.9.1：改的是"怎么等"，不是"读什么"）。
 * ★ `out` 仍按 **stdout 全量后接 stderr 全量** 拼（与 `spawnSync` 的取值顺序相同）：TAP 汇总在 stdout、
 *   警告在 stderr，混序拼接会让 `# tests` 汇总行偶发被 stderr 行切碎（那是会读成"计数缺失"的假红）。
 * ★ `slot` = worker 固定槽位（见 `testDataHome`；串行档恒 0）。
 */
function runOne(rel, slot = 0) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    /** 单流上限 = 改前 `spawnSync` 的 `maxBuffer`（32MB）；超了就**如实说超了**，不静默丢 */
    const CAP = 32 * 1024 * 1024;
    let so = '';
    let se = '';
    let truncated = false;
    // ★★★ 2026-11-17（T-#RUN-TESTS-REPORTER-TAP）：**显式指定 TAP reporter**。
    //   病（实测，存量测试即可复现）：Node 24 把 `node --test` 的**默认** reporter 从 TAP
    //   改成了 spec 风格（输出 `ℹ tests 6` / `ℹ pass 6`），而本文件的计数一直按 TAP 正则
    //   `/^# tests (\d+)$/m` 解析 ⇒ **汇总行永远匹配不上** ⇒ 每个文件都落进「计数缺失 ⇒ FAIL」
    //   ⇒ 本机任何 `npm test` 都恒红，而用例其实全绿（假红：红在口径，不在被测代码）。
    //   ⇒ 修法不是"再写一套 spec 解析"（那会让门的口径跟着 Node 版本漂，且是第二把尺），
    //     而是**要 TAP**：`--test-reporter tap` 在仓基线 Node 22 与本机 Node 24 上都存在。
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-reporter', 'tap', rel], {
      cwd: ROOT,
      // ★ shell:false（`process.execPath` 在 Windows 上含空格，经 cmd 会被截断 —— 见 verify.mjs 的 ts 门）
      shell: false,
      // ★ 2026-10-30：每文件一个自己的数据根（见 RUN_HOME_ROOT 那段论证）
      env: { ...process.env, [INJECT_VAR]: testDataHome(rel, slot) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (s) => {
      if (so.length + s.length <= CAP) so += s;
      else truncated = true;
    });
    child.stderr.on('data', (s) => {
      if (se.length + s.length <= CAP) se += s;
      else truncated = true;
    });
    let settled = false;
    const finish = (status, extra = '') => {
      if (settled) return;
      settled = true;
      const out = `${so}${se}${truncated ? `\n★ 单流输出超过 ${CAP} 字节，已截断（完整输出没保留）` : ''}${extra}`;
      resolve({ rel, ms: Date.now() - t0, status, out, ...tapCounts(out), failures: failuresOf(out) });
    };
    // ★ spawn 自己失败（ENOENT / EACCES）⇒ status=null ⇒ 下游按"没跑起来"判红，不折成 0
    child.on('error', (e) => finish(null, `\n★ 起不来：${e?.message ?? String(e)}`));
    child.on('close', (code) => finish(code));
  });
}

/**
 * **有界并发 worker 池**（`--jobs N` 的实现）。
 *
 * 判据（都可判）：① 每个 index **恰好**被调一次；② 同时在跑的不超过 `jobs` 个；
 *   ③ `await` 之后全部已完成（没有"漏跑的第 k 个"）；④ 第 k 个 worker 拿到的**槽位恒为 k**
 *   （槽位在建池那一刻固定 ⇒ 数据根不会因为"谁先跑完"而漂，见 `testDataHome`）。
 * ★ 不在这里打印任何东西 —— 输出顺序是**调用方**的事（并行档按 index 缓冲后按原顺序打印）。
 * ★ 为什么不用 `Promise.all(todo.map(fn))`：那会把 135 个进程同时拉起来（Windows 上直接打不开文件句柄），
 *   `--jobs` 要的就是"同时最多 N 个"。
 */
async function runPool(indices, concurrency, fn) {
  const n = Math.max(1, Math.min(concurrency, indices.length));
  let next = 0;
  const worker = async (slot) => {
    for (;;) {
      const k = next++;
      if (k >= indices.length) return;
      await fn(indices[k], slot);
    }
  };
  await Promise.all(Array.from({ length: n }, (_, slot) => worker(slot)));
}

// ════════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-01（T-#REG ⑦）：**产者护栏 —— 全量测试跑完，真数据仓的 projects.json 必须一字节未变**
//
// ## 为什么需要它（实测）
// 上面那套「每文件一个 AGENT_IO_HOME」是**只覆盖了一部分路径**：只要某个用例自己漏钉 / 用
// `AGENT_IO_DATA_ROOT` 抢先 / 直接拼真数据仓路径 `import_project` 一个 temp 夹具，
// 那条登记就会落进**真册**，而夹具目录跑完就没了 ⇒ 注册表积累幽灵根。
// 现存实证：真册里有 5 条 `iso / ds / sp / tp / t192flow`（root 全在 `%LOCALAPPDATA%\Temp\` 下）。
// ⇒ 光修一次不够（下次还会长），必须让**门**在它再长的时候立刻红。
//
// ## 判据（三条，缺一条就又是假绿）
// ① 真册路径**现问** `src/infrastructure/project_registry.ts#registryFile()`（不在这里抄一份路径口径 —— 0.9）；
// ② 跑前 / 跑后各算一次 sha256，**并要求逐文件比对**：变了就点名"是哪一次测试写的"（至少给 sha 前后 + mtime）；
// ③ 问不到真册路径 ⇒ **红**（判不了 ≠ 没被污染）。
// ════════════════════════════════════════════════════════════════════════

/** 真实数据仓的注册表文件（★ 现问 src，不在本文件复述路径口径） */
function probeRealRegistryFile() {
  const r = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "const m = await import('./src/infrastructure/project_registry.js'); process.stdout.write(m.registryFile());",
    ],
    { cwd: ROOT, encoding: 'utf8', shell: false, maxBuffer: 4 * 1024 * 1024 },
  );
  const out = String(r.stdout ?? '').trim();
  if (r.status !== 0 || !out) {
    return { ok: false, file: '', why: `探针退出码 ${r.status}：${String(r.stderr ?? '').trim().split('\n').slice(-1)[0] ?? ''}` };
  }
  return { ok: true, file: out, why: '' };
}

/** 一份文件的指纹（不存在 ⇒ sha='<absent>'，mtime=-1 —— 「没有」也是一条可比的读数） */
function fingerprint(file) {
  try {
    const buf = readFileSync(file);
    return { sha: createHash('sha256').update(buf).digest('hex'), mtime: statSync(file).mtimeMs };
  } catch {
    return { sha: '<absent>', mtime: -1 };
  }
}

const files = testFiles();
console.log(`${C.b}测试门 —— tests/*.test.ts 真跑${C.x}  ${C.d}（node:test + tsx；逐文件取 TAP 计数）${C.x}`);
if (filter) console.log(`${C.y}★ --filter ${JSON.stringify(filter)}：这是**定向**跑，不进总门口径${C.x}`);
console.log(`${C.d}★ 数据隔离：每文件注入 ${INJECT_VAR}=${RUN_HOME_ROOT}/<w槽位>/<文件>（跑完整棵删掉 ⇒ 真数据仓不碰）${C.x}`);
if (PARALLEL) {
  // ★ 三条"并行改了什么"的颜色说明放在**开跑前**：不写清，读者会以为并行档与默认档读数是同一件事（0.12）。
  console.log(
    `${C.y}★ 并行 --jobs ${jobs}：结果按 index 缓冲、**按文件原顺序**打印（完成序会让逐文件行与 TAP 汇总对不上号）${C.x}`,
  );
  console.log(
    `${C.d}  隔离不变：数据根 = RUN_HOME_ROOT/w<槽位>/<文件>（槽位由池建池时固定，串行档恒 w0）⇒ 槽下面**仍每文件一个**子目录${C.x}`,
  );
  console.log(
    `${C.y}  ★ 产者护栏降级：并行时**判不了是谁改的** —— 只能"跑前/跑后各拍一次 sha"；变了就用 --jobs 1 复跑点名${C.x}`,
  );
}

// ★ T-#REG ⑦：真册的跑前指纹（跑完必须一字节未变；见上面「产者护栏」那段论证）
const REAL = probeRealRegistryFile();
const realBefore = REAL.ok ? fingerprint(REAL.file) : { sha: '<probe-failed>', mtime: -1 };
/** 哪一次测试把它改了（逐步比对：第一次变的那一刻点名，再以新值为下一段的基线） */
const registryPolluters = [];
let realCursor = realBefore;
console.log(
  REAL.ok
    ? `${C.d}★ 产者护栏：真册 ${REAL.file} sha=${realBefore.sha.slice(0, 12)}（跑完必须不变）${C.x}`
    : `${C.r}★ 产者护栏：**问不到**真册路径（${REAL.why}）⇒ 跑完会判红（判不了 ≠ 没污染）${C.x}`,
);
console.log('');

let bad = 0;
let tot = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0 };
/** ★ 源码声明的用例条数（下限守卫的分子/分母都从这里来；见文件头"两条口径"） */
let totStatic = 0;
/**
 * **静态守卫**的红行（**唯一实现**：串行与并行两条路径都调它 —— 0.9.1）。
 *
 * 判据：源码读不到，或源码里一条 `test(`/`it(` 都没有 ⇒ 文件在、用例没了 ⇒ 红，且**不跑**。
 * （改前跑这种文件会得到「用例 1/1 通过」⇒ 门绿 —— 见文件头"两条口径"。）
 */
function reportStaticFail(f, stat) {
  bad++;
  console.log(`  ${C.r}FAIL${C.x}  ${f.padEnd(34)} ${C.d}      ${stat.err ? '源码读不到' : '源码 0 条用例'}${C.x}`);
  console.log(`        ${C.r}★ 该文件没有任何 test()/it() 调用（文件在、用例没了）⇒ 这不是通过，是没验${C.x}`);
  if (stat.err) console.log(`        ${C.r}读不到源码：${stat.err}（读不到 ≠ 0 条）${C.x}`);
}

/**
 * 一个文件跑完后的**判定 + 打印**（**唯一实现**：串行路径与并行路径共用 —— 0.9.1）。
 *
 * ★ 它只消费 `runOne` 的读数（不读盘、不 spawn）⇒ 两条路径的判定口径**不可能**漂开。
 * ★ 判红四条仍原样：退出码/`# fail`、`0 个用例`、`skip/todo`、TAP 少于源码声明。
 */
function reportRun(f, stat, r) {
  // ★★ 静态守卫之二：TAP 报的用例数**少于**源码声明的条数 ⇒ 有声明的用例没跑出来
  //   （只判这个方向：TAP 更多 = 循环里动态生成用例，合法）
  const underRun = r.tests !== null && r.tests < stat.n;
  const ok = r.status === 0 && r.fail === 0 && (r.tests ?? 0) > 0 && (r.skipped ?? 0) === 0 && (r.todo ?? 0) === 0 && !underRun;
  const tag = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
  const cnt = r.tests === null ? '计数缺失' : `用例 ${r.pass}/${r.tests}${stat.n > 0 ? `（源码 ${stat.n}）` : ''}`;
  const extra = r.skipped || r.todo ? `  ${C.y}skip ${r.skipped} / todo ${r.todo}${C.x}` : '';
  console.log(`  ${tag}  ${f.padEnd(34)} ${C.d}${String(r.ms).padStart(5)}ms  ${cnt}${C.x}${extra}`);
  if (r.tests === null) {
    // ★ 汇总行都没有 = 文件根本没跑起来（导入失败 / 语法错 / 进程崩）⇒ 不许当 0 处理
    console.log(`        ${C.r}没有 TAP 汇总行（文件没跑起来）⇒ 前 3 行：${C.x}`);
    for (const line of r.out.split(/\r?\n/).filter((l) => l.trim()).slice(0, 3)) console.log(`        ${line.slice(0, 200)}`);
    bad++;
    return;
  }
  tot.tests += r.tests;
  tot.pass += r.pass ?? 0;
  tot.fail += r.fail ?? 0;
  tot.skipped += r.skipped ?? 0;
  tot.todo += r.todo ?? 0;
  totStatic += stat.n;
  if (!ok) {
    bad++;
    if (r.tests === 0) console.log(`        ${C.r}0 个用例被执行 ⇒ 红（空跑等于没跑）${C.x}`);
    if (underRun) {
      console.log(
        `        ${C.r}★ TAP 只报了 ${r.tests} 条，而源码里声明了 ${stat.n} 条 ⇒ 有声明的用例没跑出来（这不是通过）${C.x}`,
      );
    }
    for (const x of r.failures) console.log(`        ${C.r}✗ ${x.name}${C.x}\n          ${x.err.slice(0, 300)}`);
    if (!r.failures.length && r.fail) {
      const first = r.out.split(/\r?\n/).filter((l) => /error|Error/.test(l))[0] ?? '';
      console.log(`        ${C.r}${first.trim().slice(0, 300)}${C.x}`);
    }
    if (r.skipped || r.todo) console.log(`        ${C.r}有 skip/todo ⇒ 这些用例没跑；本仓不许用它关掉门（要退役就按 docs/RETIRED.md 删断言）${C.x}`);
  }
}

if (PARALLEL) {
  // ── 并行档（`--jobs >1`）：先**并发**跑完（结果按 index 缓冲），再**按文件原顺序**打印 ──
  //   ★ 按完成序打印会把"逐文件行"与"TAP 汇总/护栏读数"打散 ⇒ 报红时说不清哪一行属于哪一次跑。
  const stats = files.map((f) => staticCallsOf(`tests/${f}`));
  /** @type {Array<Awaited<ReturnType<typeof runOne>> | null>} */
  const results = new Array(files.length).fill(null);
  const todo = [];
  files.forEach((f, i) => {
    // ★ 静态守卫先判（不跑）：它不依赖执行，串并行同口径
    if (!(stats[i].err || stats[i].n === 0)) todo.push(i);
  });
  await runPool(todo, jobs, async (i, slot) => {
    results[i] = await runOne(`tests/${files[i]}`, slot);
  });
  files.forEach((f, i) => {
    if (stats[i].err || stats[i].n === 0) reportStaticFail(f, stats[i]);
    else reportRun(f, stats[i], results[i]);
  });
} else {
  // ── 串行档（默认）：**逐字保持**原行为 —— 跑一个、判一个、当场打印一行 ──
  for (const f of files) {
    const rel = `tests/${f}`;
    const stat = staticCallsOf(rel);
    if (stat.err || stat.n === 0) {
      reportStaticFail(f, stat);
      continue;
    }
    const r = await runOne(rel);
    // ★ T-#REG ⑦：这个文件跑完后，真册变了没有？（变了就点名——"哪一次测试写的"就是这一行）
    if (REAL.ok) {
      const now = fingerprint(REAL.file);
      if (now.sha !== realCursor.sha) {
        registryPolluters.push({ rel, before: realCursor.sha, after: now.sha, mtime: now.mtime });
        realCursor = now;
      }
    }
    reportRun(f, stat, r);
  }
}

// ★ 2026-10-30：整棵 temp 数据根删掉（每个测试文件那棵子目录一起没；删不掉不影响判定）
try {
  rmSync(RUN_HOME_ROOT, { recursive: true, force: true });
} catch {
  /* 删不掉不影响判定 */
}

console.log('');
// ★ 机器读的唯一一行（判据锚它）：文件数 / 用例数 / 通过 / 失败 / 跳过 / **源码声明条数（分母的另一半）**
//   ★ 0.12 ③：TAP 分子与"源码声明了几条"同时给 —— 只给分子时，"空文件"与"真跑过"读起来一样。
console.log(
  `测试门：文件 ${files.length} / 用例 ${tot.tests}（源码声明 ${totStatic}）/ 通过 ${tot.pass} / 失败 ${tot.fail} / 跳过 ${tot.skipped + tot.todo}`,
);
// ════════════════════════════════════════════════════════════════════════
// ★ T-#REG ⑦ 产者护栏的判定（**进红判**，不是提示）：真册被测试写过 ⇒ 门红。
//   判据三条：问得到路径（否则红）· sha256 前后相同 · 逐文件点名（谁写的）。
// ════════════════════════════════════════════════════════════════════════
const realAfter = REAL.ok ? fingerprint(REAL.file) : { sha: '<probe-failed>', mtime: -1 };
const registryClean = REAL.ok && realAfter.sha === realBefore.sha;
if (!REAL.ok) {
  console.log(
    `${C.r}✗ 产者护栏：问不到真册路径（${REAL.why}）⇒ 这轮**判不了**有没有污染真数据仓（判不了 ≠ 没污染）${C.x}`,
  );
} else if (!registryClean) {
  // ★★ 2026-11-17（增量化第一批 · 项 1）：**并行档的诚实降级**（0.12：判不了要说判不了）。
  //   逐文件点名要求"确定的执行顺序"（跑一个、拍一次指纹、与上一次比）—— 并行档没有这个顺序，
  //   硬点名只会指到一个**恰好在那一刻跑完**的文件（比不点名更坏：它看起来像证据）。
  //   ⇒ 并行档只说"变没变"，并**明确要求**用 `--jobs 1` 复跑点名。
  const who = PARALLEL
    ? `    ★ **并行模式（--jobs ${jobs}）无法点名污染者** —— 逐文件切指纹要有确定的执行顺序，并行没有这个顺序。\n` +
      `      这不是"没人写"，是**判不了是谁**（0.12）⇒ 请用 \`node scripts/run-tests.mjs --jobs 1\` 复跑点名（同一条路径，逐文件归因）。`
    : `    ★ 是哪一次测试写的（逐步比对，第一次变的那一刻）：\n` +
      registryPolluters.map((p) => `      · ${p.rel}：${p.before.slice(0, 12)} → ${p.after.slice(0, 12)}`).join('\n');
  console.log(
    `${C.r}✗ 产者护栏红：真数据仓的 projects.json 被测试改过 —— 注册表是总账与设计册位置的钥匙，幽灵条目就是从这来的${C.x}\n` +
      `    ${REAL.file}\n` +
      `    sha 前=${realBefore.sha}\n    sha 后=${realAfter.sha}\n    mtime 后=${new Date(realAfter.mtime).toISOString()}\n` +
      who +
      `\n    ★ 怎么办：让该用例自己钉 \`AGENT_IO_HOME\`（别落真数据仓），再用 node scripts/registry_repair.mjs 清掉多余登记。`,
  );
} else {
  console.log(
    `${C.g}✓ 产者护栏：真册 sha256 前后一致（${realBefore.sha.slice(0, 12)}）⇒ 这轮测试一条登记都没写进真数据仓${C.x}`,
  );
}
if (files.length === 0) {
  console.log(`${C.r}0 个测试文件 ⇒ 红（tests/*.test.ts 一个都没匹配上：要么被删空了，要么目录/命名变了）${C.x}`);
  process.exit(1);
}
if (bad || tot.fail || tot.skipped || tot.todo || tot.tests === 0 || !registryClean) {
  console.log(
    `${C.r}⇒ 测试门红：${bad} 个文件没通过${registryClean ? '' : ' · 真注册表被写（产者护栏）'}（详见上面的 ✗ 行）${C.x}`,
  );
  process.exit(1);
}
// ════════════════════════════════════════════════════════════════════
// ★★★ 测试规模棘轮（E-2 2026-10-31 第八轮复核 / E-3 第九轮复核）
//   E-2：**没有文件数/用例数棘轮** —— 删掉一个守卫测试（如 `tests/p0_gate_table.test.ts`）⇒ 门报「文件 39 / 用例 171 / 失败 0」**绿**，
//        而"少了一个守卫"与"本来就少"读起来一样（0.12）⇒ 显式基线 `scripts/test-baseline.json`，**只许不减少**。
//   E-3：`--update-baseline` 原来在 bad/fail 判定**之前** exit 0 ⇒ 带失败跑、或与 `--filter` 联用（只跑子集）时
//        会把基线**按局部读数重写**并退 0 ⇒ 棘轮被静默放宽。
//        ⇒ 本块**整个放在红判之后**（能走到这里 = 全量、零失败、零跳过），且**拒 `--filter`**。
const BASELINE = new URL('./test-baseline.json', import.meta.url);
const wantUpdate = args.includes('--update-baseline');
const allowLower = args.includes('--allow-lower');

/** 读基线：读不到 / JSON 坏 / 形状不对 ⇒ `{ok:false, why}`（判不了 ≠ 没基线 —— 0.12） */
function readBaseline() {
  let raw;
  try {
    raw = fs.readFileSync(BASELINE, 'utf8');
  } catch (e) {
    return { ok: false, why: `读不到（${e?.message ?? String(e)}）`, data: null };
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { ok: false, why: `JSON 坏了（${e?.message ?? String(e)}）`, data: null };
  }
  if (typeof data?.files !== 'number' || typeof data?.cases !== 'number') {
    return { ok: false, why: 'files / cases 不是数字', data: null };
  }
  return { ok: true, why: '', data };
}
const base = readBaseline();
/** 点名一份名单（上限 20 行；超出给总数 —— 不静默截断） */
function nameDelta(list) {
  const CAP = 20;
  const head = list.slice(0, CAP).map((f) => `      · ${f}`).join('\n');
  return list.length <= CAP ? head : `${head}\n      · …共 ${list.length} 个（只列前 ${CAP}）`;
}

if (wantUpdate) {
  if (filter) {
    console.log(
      `${C.r}✗ --update-baseline 不许与 --filter 联用${C.x}（基线只能来自**全量**跑；否则棘轮会被按局部读数静默放宽）`,
    );
    process.exit(1);
  }
  // ── b) 基线只许升：先算"要不要降"，降就必须显式 --allow-lower ──
  //   判据 = 新值低于旧值 ⇒ 拒绝且**文件一字节不动**（写盘在下面，拒绝分支到不了写盘）。
  const dFiles = base.ok ? files.length - base.data.files : 0;
  const dCases = base.ok ? tot.tests - base.data.cases : 0;
  const lower = base.ok && (dFiles < 0 || dCases < 0);
  if (lower && !allowLower) {
    console.log(
      `${C.r}✗ 拒绝更新基线：本次读数比基线**低** ⇒ 不许用 --update-baseline 把棘轮放松${C.x}\n` +
        `     基线 文件 ${base.data.files} / 用例 ${base.data.cases} → 本次 文件 ${files.length} / 用例 ${tot.tests}` +
        `（差 ${dFiles} 文件 / ${dCases} 用例）\n` +
        `     ★ scripts/test-baseline.json **一字节未改**（sha 不变）。\n` +
        `     ★ 若这次减少确实是有证据的有意动作，显式给 --allow-lower（会大字打印降幅）。`,
    );
    process.exit(1);
  }
  // ── d) 更新必须打印 diff：计数变化 + 新增/消失的文件点名 ──
  const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
  console.log(
    `${C.b}★ 测试基线更新：文件 ${base.ok ? base.data.files : '(无基线)'} → ${files.length}（${fmt(dFiles)}）` +
      ` · 用例 ${base.ok ? base.data.cases : '(无基线)'} → ${tot.tests}（${fmt(dCases)}）${C.x}`,
  );
  if (lower) {
    console.log(
      `${C.r}${C.b}★★★ 放宽基线（显式 --allow-lower）：降 ${-dFiles} 个文件 / ${-dCases} 个用例 ★★★${C.x}\n` +
        `${C.r}     这等于允许"静默删掉 ${-dFiles} 个文件 / ${-dCases} 个用例"而门不响 ⇒ 要有证据（docs/todo.md 挂账 + 评审）${C.x}`,
    );
  }
  const oldList = Array.isArray(base.data?.fileList) ? base.data.fileList : null;
  const newList = files.slice().sort();
  if (oldList) {
    const nowSet = new Set(newList);
    const oldSet = new Set(oldList);
    const added = newList.filter((f) => !oldSet.has(f));
    const gone = oldList.filter((f) => !nowSet.has(f));
    console.log(`  新增文件 ${added.length} 个${added.length ? '：' : '（无）'}`);
    if (added.length) console.log(nameDelta(added));
    if (gone.length) {
      console.log(`${C.y}  消失文件 ${gone.length} 个（★ 里面有守卫测试 ⇒ 这就是"棘轮被放松"的证据）：${C.x}`);
      console.log(nameDelta(gone));
    }
  } else {
    console.log(
      `  ${C.d}旧基线只记了计数（没有 fileList）⇒ 本轮点不出"具体哪几个文件变了"；` +
        `本次写盘会带上 fileList，下一次更新就能点名（不静默：这一行本身就是那条诊断）。${C.x}`,
    );
  }
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        note:
          '测试规模基线 = **上一次实测读数**（`scripts/run-tests.mjs` 每次现算并打印，两者一比就是本门判据）。' +
          '★ 判据只有一条方向：当前 ≥ 基线（全量跑才判；`--filter` 定向跑不判规模，只打印覆盖缺口）。' +
          '要调低必须显式 `--update-baseline --allow-lower`（只许全量、零失败时跑；无 --allow-lower 的降基线会被拒绝；本文件的 diff 会在评审里现形）。' +
          '★ `fileList` = 基线时刻的测试文件清单，用来在下次更新时点名"新增/消失了哪些文件"。',
        files: files.length,
        cases: tot.tests,
        capturedAt: new Date().toISOString().slice(0, 10),
        fileList: newList,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(`${C.g}★ 已更新测试基线 → scripts/test-baseline.json（文件 ${files.length} / 用例 ${tot.tests}）${C.x}`);
  process.exit(0);
}

// ── a) 定向跑（--filter）：**不判规模**，但覆盖缺口必须打印，退出码只看用例通过/失败 ──
//   判据：子集天然小于全量 ⇒ 拿全量基线判规模会**恒红**（实测：被测文件 9/9 全 PASS 仍 exit 1）
//   ⇒ 那不是"发现回归的嘴"，是"永远张着的嘴"（0.16）⇒ 把它缩小到只在全量跑上生效，
//   并把"本轮只验了 N / M"这条分母留下（否则定向跑会静默读成"全绿"）。
if (filter) {
  const all = testFiles(false);
  const uncovered = all.length - files.length;
  console.log(
    `${C.y}★ 定向跑（--filter ${JSON.stringify(filter)}）：本次 ${files.length} 个文件 / 用例 ${tot.tests}；` +
      `全量 ${all.length} 个文件 ⇒ 未覆盖 ${uncovered} 个（全量 ${all.length} − 本次 ${files.length}）${C.x}`,
  );
  console.log(
    `${C.d}  规模棘轮本轮不判（子集天然小于全量，判了就恒红）⇒ 退出码只看用例通过/失败` +
      `；基线（全量口径）${base.ok ? `文件 ${base.data.files} / 用例 ${base.data.cases}` : `**读不到**（${base.why}）`}${C.x}`,
  );
  console.log(
    `${C.g}⇒ 定向跑绿：${files.length} 个文件、${tot.tests} 个用例全部真跑过并通过` +
      `${C.x}${C.y}（★ 只覆盖这 ${files.length} 个，其余 ${uncovered} 个本轮未验）${C.x}`,
  );
  process.exit(0);
}

if (!base.ok) {
  console.log(
    `${C.r}✗ 测试基线缺失/损坏（scripts/test-baseline.json：${base.why}）⇒ 只许显式建立：node scripts/run-tests.mjs --update-baseline${C.x}`,
  );
  process.exit(1);
}
const baseline = base.data;
/** 落后差额（正 = 实测更高） */
const lagFiles = files.length - baseline.files;
const lagCases = tot.tests - baseline.cases;
// ── c) **基线滞后必须显形**：实测 > 基线 ⇒ 打印落后量，**不红**（落后不是失败）──
//   为什么必须打印：滞后 = 棘轮此刻允许"静默删掉 lagFiles 个文件 / lagCases 个用例"。
//   实测（2026-11-03）：滞后 8 文件 / 48 用例时，全量跑完**一个字都没有** ⇒ 棘轮在松，而读数是绿的。
if (lagFiles > 0 || lagCases > 0) {
  console.log(
    `${C.y}★ 基线落后：实测 ${files.length} 文件 / ${tot.tests} 用例 vs 基线 ${baseline.files} 文件 / ${baseline.cases} 用例 ` +
      `⇒ 差 ${lagFiles} 文件 / ${lagCases} 用例 ⇒ 建议 node scripts/run-tests.mjs --update-baseline${C.x}`,
  );
  console.log(
    `${C.d}  （落后不是失败 ⇒ 本轮不红；但棘轮现在允许"静默删掉 ${Math.max(0, lagFiles)} 个文件 / ${Math.max(0, lagCases)} 个用例"，所以要看得见）` +
      `　基线 capturedAt=${baseline.capturedAt ?? '(未记)'}${C.x}`,
  );
}
if (files.length < baseline.files || tot.tests < baseline.cases) {
  console.log(
    `${C.r}✗ 测试规模低于基线：文件 ${files.length}（基线 ${baseline.files}）· 用例 ${tot.tests}（基线 ${baseline.cases}）${C.x}\n` +
      `     ★ 少了什么？删掉守卫测试 = 删掉"能发现回归的那张嘴"。` +
      `若确实要减 ⇒ 先挂账到 docs/todo.md，再 node scripts/run-tests.mjs --update-baseline --allow-lower（有意识动作）。`,
  );
  process.exit(1);
}
console.log(`${C.g}⇒ 测试门绿：${files.length} 个文件、${tot.tests} 个用例全部真跑过并通过${C.x}`);
