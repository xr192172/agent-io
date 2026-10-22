#!/usr/bin/env node
/**
 * verify —— **本仓唯一的总门**（2026-10-05 新增，此前没有）
 *
 * ★ 为什么加它（不是"锦上添花"，是补一个结构性缺口）：
 *   加它之前，本仓 26 条 npm script 里**没有 `test`，也没有任何测试框架**；
 *   实际能挡住回归的只有 `tsc` 与 `mcp_scan` 两道，而**每次都是人手敲**——
 *   于是"跑一遍看看"没有单一入口，漏跑不会有人知道。
 *   这直接解释了本仓多起"声明了但没人接线"的问题：704 行 TS 移植从未接线、
 *   `SilentErrorDiscard` 三份、`observe-lang-go/build/` 死路径、缺二进制时 `loop-skipped` 静默失效
 *   —— **这些全都可能是"没人跑门"的结果，而不是"跑了没发现"。**
 *
 * ★ 三态而不是两态（本仓反复犯的病是"缺工具链就静默跳过 ⇒ 假绿灯"，这里不能重犯）：
 *     PASS  门通过
 *     FAIL  门失败 ⇒ 退出码 1
 *     SKIP  门**跑不了**（缺工具链等）⇒ 退出码 **2**（刻意与 PASS 的 0 区分开）
 *   ⇒ **`npm run verify` 返回 0 的含义被收紧为"每一道门都真的跑过并通过"**，
 *     含 Go 的机器才能拿到 0；没装 Go 的机器拿到 2，而不是"看起来全绿"。
 *
 * ★ 2026-10-10 订正（原文写「刻意不把 `structure_gap` 算进判定：它的结尾是 `process.exit(0)`（无条件）
 *   ⇒ 永远不可能失败」——**该前提已不成立**）：`structure_gap.mjs` 现在**按判据（`clean`）退非 0**。
 *   它仍列在**报告区**（`kind:'report'`）只为两件事：① 通过时打印它的正文；② **门计数仍是 5**
 *   （`total` 只数 `kind:'gate'`）。★ 但它的 FAIL **照常计入** —— 计数循环对 FAIL **一律** `fail++`（与 `kind` 无关）
 *   ⇒ **结构不一致时，verify 会退 1**（这正是不再给"结构已核对"假安全感）。
 *
 * ★★ 2026-10-06（T61）ts 门**不再走 `npx`**：实测 `typescript` 未安装时 `npx tsc` 会取到 npm 上
 *   同名的 **`tsc` 占位包**（只打印「This is not the tsc command you are looking for」）并**退出 0**
 *   ⇒ 这道门会**报 PASS 却什么都没编译**（本仓最反对的假绿灯，而且发生在**总门自己**身上）。
 *   现改为直接调**本地编译器**（路径见 `localTsc`），且拿不到编译器时 **FAIL 而不是 SKIP**：
 *   SKIP（退出 2）是留给**可选的外部工具链**（如 Go）的，而 typescript 是**本仓自己的 devDependency**，
 *   缺它 = 依赖没装 = 环境坏了 ⇒ 总门必须响。
 *   ★★ **不要"顺手加个 npx 兜底"** —— 那等于把假绿灯装回来。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' };

/** @typedef {{name:string, cmd?:string, args?:string[], cwd?:string, kind:'gate'|'report', need?:string, why?:string, fail?:string, shell?:boolean}} Gate */

/** 以**本文件**为基准做模块解析（与 `npm run` 的 cwd 无关）。 */
const requireFromHere = createRequire(import.meta.url);

/**
 * 取本地 `tsc` 的绝对路径；拿不到返回 `null`（= 依赖没装）。
 *
 * ★ 为什么不硬编码 `node_modules/typescript/bin/tsc`：依赖被 hoist 到上层、或用 pnpm 的
 *   符号链接布局时会指错。交给 Node 的模块解析，三种布局都对。
 * ★ 也**不**直取子路径 `typescript/bin/tsc`（虽然当前可用）：那押注"typescript 将来不加 `exports`"，
 *   一旦它加了且未导出 `./bin/tsc` 就会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED`；
 *   而 `resolve('typescript')` 走**主入口**（`main` 或 `exports['.']` 都命中）⇒ 长期可解析。
 *   再按"`bin/` 与 `lib/` 是兄弟目录"这一极稳定的布局取 `../bin/tsc`，并用 `existsSync` 兜底。
 */
function localTsc() {
  try {
    const entry = requireFromHere.resolve('typescript'); // .../typescript/lib/typescript.js
    const bin = path.resolve(path.dirname(entry), '..', 'bin', 'tsc');
    return existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * ts 门（**惰性构造**：命令要按环境解析 —— 找不到编译器时直接给出 `fail`，见 {@link localTsc}）。
 *
 * 命令用 `process.execPath` 跑 tsc 的 JS 入口：**不经 `.bin` shim、不经 shell**
 * （Windows 上少两层可控性；shim 缺失也不会误判成"没装编译器"）。
 */
function tsGate() {
  const tsc = localTsc();
  if (!tsc) {
    return {
      name: 'ts 类型',
      kind: 'gate',
      fail:
        'typescript 未安装（本仓 devDependency，不是可选工具链）⇒ 先跑 `npm install`。' +
        '★ 不要改成 `npx tsc` 兜底：typescript 缺失时 npx 会取到 npm 上的 **tsc 占位包**并以 0 退出 ⇒ 假绿灯（T61）。',
    };
  }
  return {
    name: 'ts 类型',
    kind: 'gate',
    cmd: process.execPath,
    args: [tsc, '--noEmit'],
    // ★★ `shell: false` 是**必须的，不要删**（2026-10-06 实测撞出来）：
    //   本仓其余门在 Windows 上需要 `shell:true`（`go` / `npx` 是 `.cmd`/`.bat`，不带 shell 找不到），
    //   但这一门用的是 `process.execPath` —— 它在本机是 `C:\Program Files\nodejs\node.exe`，
    //   **路径含空格**，经 cmd.exe 会被截成 `C:\Program` ⇒ 报「'C:\Program' is not recognized…」、
    //   门在 13ms 内以"退出码 1"失败（看着像类型错，其实是**没跑起来**）。
    //   直接 spawn（不走 shell、参数逐项传递）⇒ 含空格的路径安全。
    shell: false,
    why: '类型错 ⇒ 运行时必错（本地编译器，非 npx）',
  };
}

/** ★ 元素可以是 `Gate`，也可以是 `() => Gate`（惰性：命令要按环境解析）。 */
/** @type {Array<Gate|(() => Gate)>} */
const GATES = [
  tsGate, // ★ 惰性：tsc 路径按环境解析；拿不到编译器 ⇒ 该门 `fail`（T61）
  { name: 'MCP 工具签名', kind: 'gate', cmd: 'node', args: ['scripts/mcp/mcp_scan.mjs'], why: '全部工具的入参/出参契约（坏签名 ⇒ LLM 一定调错）。★ 真值看 `TOOL_DEFS`。' +
      // ★★★ 2026-10-12（T200）：**删掉了这里的工具计数**（原写 `61 个工具`）。
      //   ★ 为什么**不是**把 61 改成 68：本仓纪律 —— **门/文档里的"计数"会过期，别手改数字**
      //     （★ 这一行自己就记着一次"59 → 61"的更正 ⇒ ★ 改一次过一次）；**要么由 `TOOL_DEFS` 派生、要么删掉** ✓
      //   ★ 实测：今天注册 `observe_proposals` 后是 **68**，而这里还写着 61。
      //   ★ 那两句「为什么需要这道门」的历史理由**保留**（它们不过期）：
      '★ 需先有 dist/：它走 CLI 入口。★ 旧理由「CLI 不做 zod 校验，守卫接没接上只有这里看得见」**已过时** —— ' +
      '现在两道面都先跑 zod ⇒ ★ 本门已改成**直接 import `TOOL_DEFS`、调 `def.handler({})`（绕过 zod）**，' +
      '专测 handler 自己的守卫（见 `scripts/mcp/mcp_scan.mjs` 文件头）。' },
  // ★★★ 2026-10-12（T195）：**原 `b 项契约占位符` 这道门【已撤】** —— ★ 这是**用户既有裁定的执行**，
  //   不是新决定：本仓 2026-10-07 就定过「**不建"免疫系统"（棘轮/体检/巡航门）**；判据靠**逐条查、逐条修**」，
  //   理由（原话）：★「**逐条修不撒谎，普查会** —— 它能**静默死去仍显 ✅**」。
  //   ★ 判据（用户）：*"你这个门能比你多抓出什么东西吗？…你使用 grep 什么的是能够校验出来的吧。
  //     只要你现在开发没有问题，那后续这个门的存在，只是在一遍遍的复核已有的事情，反而还拖累运行速度。"*
  //   ★★ **划在这条线上的理由**：它查的是「**某个字段名在不在 `B_TERMS` 词表里**」= **本仓自己编的命名普查**
  //     ⇒ ★ **一条 grep 就能查**（`node scripts/measure_b_contract.mjs` 随时可跑，只是不再判红）。
  //     ★ 对照留下的门：`ts 类型`/`Go 编译` 是**编译器**（语言的形式规则，不是本仓编的）；
  //     `MCP 工具签名` 抓的是「**zod schema 到底接没接上**」—— ★ **类型系统对 zod 透明，那是我 grep 不出来的接线事实**。
  //   ★ 量具本体保留：`scripts/measure_b_contract.mjs`（改成**只报告、退 0**）。**别再把它加回门里。**
  { name: 'Go 编译', kind: 'gate', cmd: 'go', args: ['build', './...'], cwd: 'observe-lang-go', need: 'go', why: '★ Go 语言包（observe-lang-go）此前**零门**：它一直是 TS 侧之外的盲区（go.mod 无 require ⇒ 标准库项目）' },
  { name: 'Go 静态检查', kind: 'gate', cmd: 'go', args: ['vet', './...'], cwd: 'observe-lang-go', need: 'go', why: '同上；vet 过了才谈得上"改 Go 代码有反馈"' },
  {
    name: '实现夹具',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/impl-fixture.mjs'],
    why:
      '★ cardStanding 的 4 个行为分支（satisfied / work / violated / unknowable）。' +
      '契约门只看结构、design:mutate 只看判据 ⇒ **“实现逻辑被改坏”平时没人抓**，这一门补那一格。' +
      '★ 只覆盖 cardStanding 的一个分支条件（如实声明，不吹）；但它是第一道能抓实现回归的门。',
  },
  // ★★★ 2026-10-21（第七道）：**domain 五值 × 前后态**。
  //   为什么它算门、而「实现夹具」不够：`impl-fixture` 只覆盖 cardStanding 的 **1 个**分支条件，
  //   而五值 × 前后态有 5×2 组合。2026-10-21 拆了 domain → application 倒挂（judge 走端口注入）
  //   ⇒ cardStanding 现在**能喂假 Judge、不碰 fs**，这是它第一次可以毫秒级全分支验证。
  //   它挡的事故：把 `unsupported > 0 ⇒ unknowable` 改成 `⇒ satisfied`（判不了退化成通过）。
  //   ★ 消融实测：改坏 task_machine L300 ⇒ 本门 PASS=36 FAIL=2 EXIT=1；还原 ⇒ 38/38 EXIT=0。
  {
    name: 'domain 五值',
    kind: 'gate',
    cmd: 'node',
    args: ['certs/t358-domain-five-values-cert.mjs'],
    why:
      '★ cardStanding 五值（work / violated / blocked / satisfied / unknowable）× 前后态，38 条断言、2ms。' +
      '喂假 Judge ⇒ 不碰 fs、不建库 ⇒ 这是拆端口换来的唯一收益，不挂进门它就只是摆设。' +
      '★ 「pending」当前行为也在里面钉住（当前 = satisfied，环2 修好后该条必须变红）。',
  },
  // ★★★ 2026-10-20（第六道）：**设计 DB 与设计 DSL 的结构一致性**。
  //   为什么它算门、而 `design_line action=gen-db check=true` 不算：
  //     `check=true` 比的是整份字节，含 `symbols/imports/calls` —— 它们来自 `cache.db`，
  //     而 `cache.db` **不入库**（`git ls-files .agent-io` 只有 2 份 DSL）
  //     ⇒ 把它当门 = 同一次提交在不同机器上红绿不同（另一种假门）。
  //     本门只比**只依赖入库文件**的那几样：`//source` 的持有者、`requirements`、
  //     `requirements_calls` 的调用方与条数、缺/多副本、**真冲突**。
  //   它挡的事故（不是普查）：设计加了 `call-exists` 却没重跑生成器 ⇒ `design-db` 里是旧要求，
  //     而 `scripts/contract-calls.mjs`（契约门）读的正是它 ⇒ **契约门静默拿旧要求判新代码**。
  {
    name: '设计 DB 结构',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/gen-db-check.mjs'],
    why:
      '★ 生成物与它的消费者之间不允许有静默漂移：`design-db/*.calls.json` 是 `contract-calls` 的输入，' +
      '它旧了，契约门就变成假门。★ 只读入库文件（`design/*.dsl.json` + `design-db/`），**不读 cache.db** ⇒ 可复现。' +
      '★ 真冲突（两个 feature 对同一文件要求互斥）也在这里红 —— 那种红重跑修不好，只能改设计。',
  },
  // ★★★ 2026-10-23（第八道）：**两段式领取**（preparing 第 5 态 + prepared_snapshot 事务）。
  //   为什么它算门：`preparing` 的每一条行为都**只在运行时成立**——
  //   ① claim 判据空 ⇒ 进 preparing（不是 claimed）；② start 删快照与改态**同一次落盘**；
  //   ③ release/expire 按快照**逐字还原**；④ 存量卡留痕不拦。
  //   这四条哪一条坏掉，`tsc` 都一声不响（都是"值"不是"形状"）⇒ 只有行为夹具抓得住。
  //   ★ 消融实测（直接改 dist，改一行跑红再从备份还原）：claim 的 preparing→claimed ⇒ 7 条红；
  //     start 不删快照 ⇒ B7 红；release 改成 writeTask（不还原）⇒ C3 红。
  {
    name: '两段式领取',
    kind: 'gate',
    cmd: 'node',
    args: ['certs/t360-two-phase-claim-cert.mjs'],
    why:
      '★ 卡原文 A-D 逐条：A 判据空不许 claim（进 preparing + 点名缺什么）· B start 原子（删快照+改态一次落盘）· ' +
      'C 放弃/超时零残留（判据与 claim 前逐字相同）· D 反馈可读（首行说清"哪个 node / 补几条 / 哪几类"）· ' +
      '⑥ 判据已在的卡一段式 / 存量卡留痕不拦。35 条断言，一次跑 ~1s，只写临时 `AGENT_IO_HOME`。' +
      '★ 它挡的事故：「领了不能干」退化成「领了就能干」（= 判据永远补不上，回到 117 张判据空的老状态），' +
      '以及「事务」退化成「改了不回滚」（设计侧残留半套判据，下一个人拿它当验收）。',
  },
  // ★★★ 2026-10-20：**删掉「结构意图 gap」这道门** —— 它指向 `scripts/structure_gap.mjs`，
  //   而那个脚本 2026-10-19 已随「它只指向已删的 tests/」一起删除 ⇒ 这道门从此 **永远 FAIL**
  //   （实测：Cannot find module `scripts/structure_gap.mjs`）。
  //   ★ 更值得记的是它暴露了什么：昨天我**只跑了自己挑的 4 道门**（tsc/calls/design:check/mutate）
  //     就宣布「全绿」，而**总门 `npm run verify` 一直是红的** —— 「没报错」与「没跑」长得一样。

];

const has = (b) => { try { return spawnSync(b, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0; } catch { return false; } };

function run(g) {
  // ★ 构造期已注定失败的门（如"本地编译器没装"）—— 优先于 need，且**是 FAIL 不是 SKIP**
  if (g.fail) return { state: 'FAIL', why: g.fail, out: '' };
  if (g.need && !has(g.need)) return { state: 'SKIP', why: `缺 ${g.need} 工具链` };
  const cwd = g.cwd ? path.join(ROOT, g.cwd) : ROOT;
  if (g.cwd && !existsSync(cwd)) return { state: 'SKIP', why: `目录不存在：${g.cwd}` };
  // ★ 逐门可覆盖 `shell`：默认在 Windows 上开（`go`/`npx` 是 `.cmd`，不带 shell 找不到），
  //   但含空格的绝对路径（如 `process.execPath`）必须 `shell:false`，否则被 cmd 截断 —— 见 `tsGate`。
  const shell = g.shell ?? process.platform === 'win32';
  // ★ 2026-10-21：告诉子门「你是总门发起的」—— 目前只有 `scripts/mcp/mcp_scan.mjs` 读它
  //   （把那一遍扫射记成 `via:'gate'` 而不是随手扫的 `'sweep'`）。其余门忽略这个变量。
  const r = spawnSync(g.cmd, g.args, {
    cwd,
    encoding: 'utf8',
    shell,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, AGENT_IO_DOGFOOD_VIA: 'gate' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { state: 'FAIL', why: r.error.message, out };
  if (r.status !== 0) return { state: 'FAIL', why: `退出码 ${r.status}`, out };
  return { state: 'PASS', why: '', out };
}

console.log(`${C.b}verify —— 本仓唯一的总门${C.x}  ${C.d}（三态；返回 0 = 每一道门都真跑过并通过）${C.x}\n`);

// 惰性门在此刻定型（元素可能是函数）；此后一律按定型后的数组走。
const gates = GATES.map((g) => (typeof g === 'function' ? g() : g));

let fail = 0;
let skip = 0;
const tail = [];
for (const g of gates) {
  const t0 = Date.now();
  const r = run(g);
  const ms = Date.now() - t0;
  const tag = r.state === 'PASS' ? `${C.g}PASS${C.x}` : r.state === 'FAIL' ? `${C.r}FAIL${C.x}` : `${C.y}SKIP${C.x}`;
  const label = (g.kind === 'report' ? `${C.d}[报告]${C.x} ` : '') + g.name;
  console.log(`  ${tag}  ${label.padEnd(20)} ${C.d}${String(ms).padStart(5)}ms  ${r.why}${C.x}`);
  // ★★ 2026-10-11（T161）：**截断了就必须说** —— 原先 `slice(0, 4000)` / `slice(0, 3000)` 直接切，
  //   读者会以为**这就是全部输出**（"沉默会被读成没问题"的又一形态）。
  //   ★ 与 T160 定下的两条同源：**① 结构化/完整产物要有出路；② 摘要处必须自足**。
  //   这里加的是**第③条**：**截断要标注**（不然"没看到"与"没有"分不清）。
  const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n)}\n…（★ 已截断：原文 ${s.length} 字符，只印前 ${n}；要看全 ⇒ 单独跑该门）`);
  if (r.state === 'FAIL') { fail++; if (r.out) tail.push(`${C.r}── ${g.name} 输出 ──${C.x}\n${clip(r.out, 4000)}`); }
  if (r.state === 'SKIP') skip++;
  if (r.state === 'PASS' && g.kind === 'report' && r.out) tail.push(`${C.d}── ${g.name}（报告区：通过时打印正文；失败照常计入）──${C.x}\n${clip(r.out, 3000)}`);
}

console.log('');
if (tail.length) console.log(tail.join('\n\n') + '\n');

const total = gates.filter((g) => g.kind === 'gate').length;
const line = fail ? `${C.r}${fail} 道门失败${C.x}` : skip ? `${C.y}${skip} 道门没跑成（SKIP）${C.x}` : `${C.g}全部 ${total} 道门通过${C.x}`;
console.log(line);
if (fail) process.exit(1);
if (skip) {
  console.log(`${C.y}⇒ 退出码 2（刻意区别于 0）：有门没跑成，不等于"没问题"。${C.x}`);
  process.exit(2);
}
