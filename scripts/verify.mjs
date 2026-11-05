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
 * ★ 2026-10-31 订正：**`structure_gap` 那道门/报告区已经不存在了** —— `scripts/structure_gap.mjs`
 *   于 2026-10-19 删除（见下方 GATES 里的墓碑注释）。旧的「它按 `clean` 退非 0」说明**已无对象**，
 *   留着只会让人以为"结构已经有人看着"。
 *   ⇒ 那时**结构意图（`structure.domains.json` vs 磁盘）没有任何门在查**，只是 MCP 工具面
 *     （`structure_gap` 工具）里的一次手动读数。
 * ★★ 2026-11-03：**这句话已经过期 —— 结构意图门回来了**（见 GATES 的「结构意图」，实现 =
 *   `scripts/structure-gate.mjs`）。它与被删的那版是**两个东西**：那版指向一个已删的脚本（必然永远红），
 *   这版调的是**两处现存权威**（`design_line.ts#silentGapsOf` 文件级 + `structure_gap.ts#structureGap` 目录级），
 *   并把"已知存量"落成带 reason 的基线 ⇒ 门红得可处置、不会永远红。
 *   ★ 同一批还接了一扇「无卡写账」（`write_log` 第三本账，此前连 npm script 都没登记）。
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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// ★ 重活排他锁（R75）—— 唯一实现在 `scripts/lib/heavy_lock.mjs`（verify / mutate / judge-all 共用一份）
import { acquireHeavyLock } from './lib/heavy_lock.mjs';

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
 *
 * ★ `root` = **要解析依赖的那个项目根**（默认本仓）。不变量：**编译器必须来自被检查的那棵树**
 *   —— `scripts/verify-clean.mjs` 在干净 clone 里跑同一份 GATES，若这里偷偷用回本仓的 tsc，
 *   那一门测的就不是干净环境了（"测的不是我以为的那份" = 0.12 的假绿）。
 */
function localTsc(root = ROOT) {
  try {
    const req = root === ROOT ? requireFromHere : createRequire(path.join(root, 'package.json'));
    const entry = req.resolve('typescript'); // .../typescript/lib/typescript.js
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
function tsGate(root = ROOT) {
  const tsc = localTsc(root);
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

/** ★ 元素可以是 `Gate`，也可以是 `(root) => Gate`（惰性：命令要按**被检查的那棵树**解析）。 */
/** @type {Array<Gate|((root:string)=>Gate)>} */
const GATES = [
  tsGate, // ★ 惰性：tsc 路径按环境解析；拿不到编译器 ⇒ 该门 `fail`（T61）
  // ★★★ R74（2026-11-05）：**工具链完整性**（第二道 —— 紧跟 `ts 类型`） —— 它保护的是**下面这些门自己**。
  //   ### 为什么它不能被现有门吸收（0.25② 要求给出答案，否则就是叠加）
  //   · `ts 类型` 只要求 `typescript`；`测试` 要 `tsx` + `esbuild`，但**它坏起来是"真的像失败"** ——
  //     实测：`@esbuild/win32-x64` 消失 ⇒ 一切 `dynamic import *.ts` 挂 ⇒ 测试门报 **5 个文件红**，
  //     而那 5 个文件**本身没问题**（同一时刻 `npm test` 单跑是绿的）⇒ **与"测试真有失败"同形**。
  //   · 没有第二道门能替它说这件事：编译器看不见"optional 平台二进制在不在"，grep 也看不见。
  //   ⇒ 它是**新的一格**（门自己也需要的工具在不在），入口数 +1 是有理由的，不是叠加。
  //   ### 为什么必须**紧跟 `ts 类型`、排在其余门之前**
  //   它一旦红，后面所有门的读数都**不可归因**（分不清"代码坏了"与"工具没了"）⇒ 先把它判掉，
  //   后面红了才真的是代码问题。★ 它自己 <1 秒，不拖慢总门。
  //   ### 它的边界（0.17①）
  //   只断「5 个关键包能否解析」= **可判红**；`node_modules` 指纹与"谁借了 junction"只**报告不判红**
  //   （正当 `npm install` 也会变指纹；junction 可能是别人正在用的工作区 —— R43）。
  {
    name: '工具链完整',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/check-toolchain-intact.mjs'],
    why:
      '★ 关键依赖 parse 不到 ⇒ 这不是"测试真有失败"，是环境坏了（实测过一次：`@esbuild/win32-x64` 被 npm 当 extraneous 剪掉，' +
      '测试门报 5 个文件红而 `npm test` 单跑是绿的 —— 与真失败同形）。' +
      '★ 另**报告**（不判红）：`node_modules` 指纹与上次的差异、以及有哪些目录借了本仓 `node_modules` 的 junction' +
      '（R74：16 个冷克隆测试目录这样借过，在它们里面跑 `npm install` 会 reconcile 并剪掉本仓的包）。',
  },
  { name: 'MCP 工具签名', kind: 'gate', cmd: 'node', args: ['scripts/mcp/mcp_scan.mjs'], why: '全部工具的入参/出参契约（坏签名 ⇒ LLM 一定调错）。★ 真值看 `TOOL_DEFS`。' +
      // ★★★ 2026-10-12（T200）：**删掉了这里的工具计数**（原写 `61 个工具`）。
      //   ★ 为什么**不是**把 61 改成 68：本仓纪律 —— **门/文档里的"计数"会过期，别手改数字**
      //     （★ 这一行自己就记着一次"59 → 61"的更正 ⇒ ★ 改一次过一次）；**要么由 `TOOL_DEFS` 派生、要么删掉** ✓
      //   ★ 实测：今天注册 `observe_proposals` 后是 **68**，而这里还写着 61。
      //   ★ 那两句「为什么需要这道门」的历史理由**保留**（它们不过期）：
      '★ 需先有 dist/：它走 CLI 入口。★ 旧理由「CLI 不做 zod 校验，守卫接没接上只有这里看得见」**已过时** —— ' +
      '现在两道面都先跑 zod ⇒ ★ 本门已改成**直接 import `TOOL_DEFS`、调 `def.handler({})`（绕过 zod）**，' +
      '专测 handler 自己的守卫（见 `scripts/mcp/mcp_scan.mjs` 文件头）。' +
      // ★★★ 2026-10-31：**工具面固定开销棘轮并入本门**（原 certs/t326，certs/ 退役后无处安放）。
      //   为什么不新建门：本门本来就 import TOOL_DEFS 并打印「工具数 = N」⇒ 同一处权威顺手判它。
      //   阈值不写死：住 `scripts/mcp/tool-surface-baseline.json`（**上一次实测读数**，非人定阈值），
      //   判据方向只有"当前 ≤ 基线"；要变大必须显式 `--update`（本文件的 diff 在评审里现形）。' +
      '★ 另含：**工具面固定开销棘轮**（每请求重付的 tools 块只许不增长；基线 = 上次实测读数）' +
      '与 **dist 不比 src 旧**（否则那一段量的是旧产物）。' },
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
      '★ cardStanding 的**五**个行为分支（satisfied / work / violated / **blocked** / unknowable —— 以 task_machine.ts 的 standing 穷尽为准，别抄这里的数字）。' +
      '契约门只看结构、design:mutate 只看判据 ⇒ **“实现逻辑被改坏”平时没人抓**，这一门补那一格。' +
      '★ 只覆盖 cardStanding 的一个分支条件（如实声明，不吹）；但它是第一道能抓实现回归的门。',
  },
  // ★★★ 2026-10-31：原**第七道门「domain 五值」已撤** —— 内容整张迁进
  //   `tests/p0_domain_five_values.test.ts`，由下面的**「测试」门**统一收走。
  //   理由（0.9 一处权威）：同一件事不许有两个住处，更不许被两道门各跑一遍。
  //   ★ 那道门 `why` 里**有价值的信息**（它挡过什么事故、消融读数、为什么算门）已逐条搬进
  //     新测试文件的**头注**，不随门一起消失。**别再把它加回 GATES。**
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
  // ★★★ 2026-10-31：原**第八道门「两段式领取」已撤** —— 内容整张迁进
  //   `tests/p0_two_phase_claim.test.ts`，由下面的**「测试」门**收走（同上：0.9 一处权威）。
  //   ★ 卡原文 A-D、它挡的两类事故（"领了就能干" / "改了不回滚"）、以及三次消融读数
  //     （preparing→claimed ⇒ 7 红 / start 不删快照 ⇒ B7 红 / release 不还原 ⇒ C3 红）
  //     都搬进新测试文件头注。**别再把它加回 GATES。**
  // ★★★ 2026-10-20：**删掉「结构意图 gap」这道门** —— 它指向 `scripts/structure_gap.mjs`，
  //   而那个脚本 2026-10-19 已随「它只指向已删的 tests/」一起删除 ⇒ 这道门从此 **永远 FAIL**
  //   （实测：Cannot find module `scripts/structure_gap.mjs`）。
  //   ★ 更值得记的是它暴露了什么：昨天我**只跑了自己挑的 4 道门**（tsc/calls/design:check/mutate）
  //     就宣布「全绿」，而**总门 `npm run verify` 一直是红的** —— 「没报错」与「没跑」长得一样。

  // ★★★ 2026-10-31：原**第九道门「证据选量」已撤** —— 内容整张迁进
  //   `tests/p0_evidence_plan.test.ts`，由下面的**「测试」门**收走（同上：0.9 一处权威）。
  //   ★ 那道门 `why` 里**有价值的信息**（`evidenceFreshness` 曾是"建了没接"、0 个外部调用者；
  //     以及两次消融读数）都搬进新测试文件头注。**别再把它加回 GATES。**

  // ★★★ 2026-10-31：**设计册判据** —— 此前全部册的节点判据**没有任何自动门在跑**。
  //   它们只在有人手动 `design_line action=judge` 时存在 ⇒ 红了也**拦不住提交**，等于只在纸面上。
  //   ★ 它比人**多抓**的东西很具体：改了实现使某条断言不再成立 —— `tsc` 一声不响（那是"值"不是"形状"）。
  //   ★ 执行核是 CLI 的 `design_line action=judge`；`scripts/judge-all.mjs` **只遍历册 + 汇总 + 退出码**，
  //     不重实现判定（否则就是第二把尺）。
  //   ★ `unsupported` 也算红（"判不了 ≠ 通过"，0.12 / GUIDE-GATE 四态）；**读不到册同样判红**，不当"全部通过"。
  //   ★ 顺序要求：它读 `dist/`（与「MCP 工具签名」同一前提）⇒ 改了 `src/` 先 `npm run build`；
  //     dist 比 src 旧时 judge 会自己出声（`staleJudgeCaveat`），不会静默给出"判在旧代码上"的绿。
  {
    name: '设计册判据',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/judge-all.mjs'],
    why:
      '★ 全部册的节点判据逐条真跑（条数由 `scripts/judge-all.mjs` 自己打印 —— **别在这里抄数字**，会过期），' +
      '只写 `.agent-io/judge-cache.json`。' +
      '★ 它挡的事故：判据是设计册对代码的断言，而**没有任何门在跑它们** —— 一条断言悄悄失效，' +
      '`tsc` 全绿、测试全绿、没有一处会响。',
  },

  // ★★★ 2026-10-31（第九道）：**判据突变测试** —— 「判据是不是装饰」的唯一度量。
  //   ★ 为什么它必须在这里，而不只是 `design:check` 的 D7/D9：那两条是**一册之内**的设计判据
  //     （`task-system-plan` 册里只有 1 条 `behavior-cases`）⇒ 全仓 23 条语义判据里只量到 1 条。
  //     本门跨全部册取 N=5（`scripts/mutate.mjs` 自己挑、自己打印分母），与 D7/D9 不重复：
  //     那两条判「这份册自洽吗」，本门判「全仓判据对代码变异有没有反应」。
  //   ★ 它挡的事故很具体：判据全是 `source-has` / `symbol-exists` 这类**存在类**时，
  //     `judge-all` 那次跑出**全绿**（名字还在就 pass），而**逻辑被改坏一条都抓不住**。
  //     实测：本门一上线就把「判据突变器变异的是判据自己」这个假读数揭了出来（见 scripts/mutate.mjs 头注）。
  //   ★ 三态在 `scripts/mutate.mjs` 里（本文件不复述）：`killed`=判据 fail · `survived`=判据仍 pass ·
  //     `unsupported`=判不了。**`killed === 0`（没有样本被判定）同样判红** —— 「没验」不许当绿（0.12）。
  //   ★ 它会**临时改 `src/` 一处**再逐字节还原（`sha256` 自检 + 退出钩子兜底 + `.agent-io/mutate.lock` 拒并行）
  //     ⇒ 与其余门一样串行；不要在并行作业里跑本门。
  {
    name: '判据突变',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/mutate.mjs'],
    why:
      '★ 跨册取 N=5 个 `behavior-cases` 样本 + 1 个 `call-exists` 结构对照：在 `src/` 代码上做**一处**语义突变' +
      '（`===`→`!==` / 关系取反 / 字面量改值 / 删一条必须存在的调用），跑该条判据，然后逐字节还原。' +
      '`survived>0`（判据对代码变异无感）或 `unsupported>0`（判不了）或 `killed===0`（没验）都判红。' +
      '★ 它挡的是「判据全绿而逻辑一条都不抓」（判据条数由 `scripts/judge-all.mjs` 自己打印，**别抄数字**）；' +
      '`judge-all` 只证明判据**成立**，本门证明判据**有反应**。',
  },

  // ★★★ 2026-10-31（第十道）：**文档与事实一致** —— 四个断言式检查此前**都不在任何门里**。
  //   第六轮独立复核实测：`verify` 报全绿的同时，`gen-facts:check` / `manifest:check` / `cognition:check`
  //   三个是 EXIT=1（FACTS 说 55 工具而实为 44；MANIFEST 有 27 个未登记条目；COGNITION.txt 根本不存在）
  //   ⇒ **verify 绿 ≠ 仓绿**。本门把四个并进来，让"总门绿"重新等于"这些也都验过"。
  //   ★ 子检查走 `npm run <script>`（package.json 的唯一定义），`scripts/docs-facts-check.mjs` 只做聚合与退出码；
  //     script 缺失 ⇒ 也算红（0.12：读不到 ≠ 通过）。
  {
    name: '文档与事实',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/docs-facts-check.mjs'],
    why:
      '★ 四个断言式检查（lint:prose 写死计数 · gen-facts:check 数字一致 · manifest:check 卷表一致 · cognition:check 最新）' +
      '此前**不在任何门里** ⇒ `npm run verify` 全绿时它们是红的也没人知道。' +
      '★ 它挡的事故：文档/FACTS/MANIFEST 静默撒谎 —— 它们是给人和 agent 读的"事实"，漂了就等于指错路。',
  },
  // ★★★ 2026-10-30（第十道）：**测试门** —— 此前 `tests/` 下 11 个 `*.test.ts` **没有任何 runner 在跑**。
  //   为什么这算"病"而不是"待办"：`docs/GUIDE-GATE.md` 的门表就是"跑过什么"的唯一账本，
  //   不在账上的一律等于**没跑**（本文件开头那句：返回 0 的含义 = 每一道门都真跑过并通过）。
  //   实测代价：`tests/i1_doc_alignment.test.ts` 的正则断言过一句**已被改掉的工具描述**，
  //   靠人工发现才修上 —— 有测试、没裁判，比没测试更糟（它让人以为有）。
  //   ★ 门自己判红的三条**住在** `scripts/run-tests.mjs`（本文件不复述、也不另数一遍）：
  //     退出码/失败数 · **0 个用例被执行** · **任何 skip/todo**。
  //   ★ 默认**全跑**；`--filter` 只给内环定向用，**不许**出现在这条 args 里（那等于给总门开个关掉的门）。
  {
    name: '测试',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/run-tests.mjs'],
    why:
      '★ tests/ 下全部 `*.test.ts` 逐文件真跑（node:test + tsx，读源码不读 dist）⇒ 按 TAP 计数判红：' +
      '失败>0 / **0 个用例被执行** / **任何 skip·todo** 都算红（空跑等于没跑，这条最要紧）。' +
      '★ 它挡的事故：「有测试、没裁判」—— 断言早已可能失效，而没有人会知道。' +
      '★ 2026-10-31 起它还**额外**收走三张原 certs/ 门的内容（domain 五值 / 两段式领取 / 证据选量）' +
      '⇒ 本门是那些保证的**唯一**裁判（文件数、用例数由 `scripts/run-tests.mjs` 自己打印，这里不抄数字）。',
  },

  // ★★★ 2026-11-03（第十一道）：**结构意图门** —— 把「有文件谁都没登记」从 HUMAN 档挪进 GATE 档。
  //   ★ 它挡的事故（实测）：`design_line action=report` ⑥ 的**沉默缺口** 97 条 —— 其中 25 条是**真源码没进册**；
  //     另有一整块目录级读数（`structure_gap` 的 unlisted/misplaced/relocating）**只是工具**、从没被门跑过
  //     （2026-11-03 发现者审计：50 个账目里 HUMAN 24 / NONE 6，本门收的就是其中「结构归属」这一类）。
  //   ★ **不在这里重写判定**（0.9.1）：判据实现只有两处，都是现存权威 ——
  //     ① 文件级 = `design_line.ts#silentGapsOf`（与 `design_line action=report` ⑥ 同一函数）；
  //     ② 目录级 = `structure_gap.ts#structureGap` + `structureGapIsClean`（与 `structure_gap` 工具同一函数）。
  //     本门只做「跑它 + 带分母打印 + 按基线棘轮判红 + 三态退出码」。
  //   ★ 判据（都可判真假）：每个源文件必须满足其一 —— (a) 册上有节点 / (b) 已声明 excluded（带 reason）/
  //     (c) 命中 `NOISE_FILE_RE`；三档都不是 ⇒ 缺口，> 0 即红并**逐个点名**。
  //   ★ 读数带分母（0.12 ③）：`源码 N · 有节点 M · 已声明排除 K · 已登记豁免 X · 新增缺口 G`，且 `N = M + K + 缺口`。
  //   ★ **默认口径 = 基线棘轮**（2026-11-03 第二轮裁定）：本门 args **带 `--allow-structure-gaps`** ——
  //     `scripts/structure-gaps-baseline.json` 里**带 reason** 的存量免红，但**必须逐数打印**
  //     （读数里必须出现「已登记豁免 N」：不出现就无法区分「没有缺口」与「缺口被静默吞掉」）⇒
  //     **新增缺口恒红**（只许不增）。★ 为什么这不是「调宽判据」：那些缺口**仍被计入、仍被打印、仍可追溯**
  //     （每条带 reason），只是"已知"；与 `scripts/test-baseline.json` 的规模棘轮同一形态
  //     （AGENTS-RULES 0.19 明确保留这一类棘轮）。调宽判据 = 让异常**不再被计入**（读数里那个数消失）。
  //   ★ 为什么必须给默认口径：那 25 个真源码缺口不是一天能补完的，若总门**天天亮**、且「亮的原因里有一档
  //     是正常的」，人就会开始忽略 verify ⇒ **真红被一起忽略**（0.16「永远会亮的告警 = 被关掉的告警」）。
  //   ★ 严格模式（M2b 收尾「清零」验收）：`npm run structure:gaps:gate`（= `--strict`）⇒ 存量全部计入红。
  {
    name: '结构意图',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/structure-gate.mjs', '--allow-structure-gaps'],
    why:
      '★ 两档判据、各调一处现存权威（文件级 `design_line.ts#silentGapsOf` · 目录级 `structure_gap.ts#structureGap`）—— ' +
      '本门不重写判定。读数带分母：源码 N · 有节点 M · 已声明排除 K · 已登记豁免 X · 新增缺口 G。' +
      '★ 它挡的事故：「盘上有、册上无、也没声明排除」的文件**没有任何门看得见** —— 写闸把它按 files-not-in-design 放行，' +
      '于是它既改得动又不在册（2026-11-03 实测 25 条真源码 + 2 个未登记目录）。' +
      '★ 默认走基线棘轮：已登记存量免红但**逐数打印**，新增缺口恒红；严格模式用 `npm run structure:gaps:gate --strict`。' +
      '★ `dist/` 不在 ⇒ 本门自报 2（判不了），不折成 0。',
  },

  // ★★★ 2026-11-03（第十二道）：**无卡写账门** —— 把 `write_log` 三本账接进总门。
  //   ★ 它挡的事故（实测）：`write_log` 表 2026-10 就建好了、对账脚本也写得出来，但它**连 npm script
  //     都没登记** ⇒ 「无卡变更」只有人记得跑脚本时才知道 ⇒ 发现者审计里这一条正落在 HUMAN 档。
  //   ★ 判据（都可判）：`card_id IS NULL` 的行数 > 0 == 红，「历史存量」走 `scripts/write-log-baseline.json`
  //     逐条登记（键 = `at|file|kind`）⇒ **只许不增**；新增一条就红并**逐条点名**（file + at + actor + source）。
  //     ★ **不许清零骗绿**：存量逐条列出，登记 ≠ 允许。
  //   ★ 读数带分母（0.12 ③）：`总写入 N · 有卡 M · 无卡 K`（`K + M = N` 且脚本会自检闭合）。
  //   ★ **不在这里重写对账**（0.9.1）：走的是 `scripts/write-log-audit.mjs --gate` —— 同一个脚本、
  //     同一批权威函数（`readWriteLog` / `classifyWriteSubject` / `isUnderSkippedDir` / `shouldSyncRel`）。
  //   ★ 已声明边界（0.17①）：本账只覆盖**过写原语的写**（`source_writer` 五个动词 + 回滚通道）；
  //     `Write` / `Edit` / shell 直写磁盘**不在内** —— 门通过 ≠ 「一切写都有卡」，只等于「过写原语的写都有卡」。
  {
    name: '无卡写账',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/write-log-audit.mjs', '--gate'],
    why:
      '★ `write_log` 的第三本账（谁在什么时候改了哪个文件、挂在哪张卡上）此前**不在任何门里**，' +
      '连 npm script 都没登记 ⇒ 无卡变更靠人跑。本门按「只许不增」的棘轮判：新增无卡写即红并逐条点名。' +
      '★ 分母闭合 `无卡 + 有卡 = 总写入` 由脚本自检；读到 5000 行上限截断也判红（只对了一部分不算通过）。' +
      '★ 边界：只覆盖过写原语的写；直写磁盘不在账上（见文件头 BOUNDARY 与 write_log.ts 头注）。',
  },

  // ★★★ 2026-11-04（第十三道）：**派生条目要求权门** —— 把 `AGENTS.md` 0.29⑥ 从散文变成可跑的门。
  //   ★ 它挡的事故（实测形态）：设计册里 `expected_apis` 的**派生条目**（`notes: from:cache.db@<rev>`）
  //     不承载人类意图，却在 drift 变红时被「把册改回源码当前值」一键摆平 ⇒ 该条目与源码永远同源
  //     ⇒ 再也报不出"这里被改过" ⇒ 设计册静默退化成镜像，**而它的绿是伪造的**。
  //     在这道门之前，这条判据**只存在于文档里**：谁把册改回源码，没有任何机器会发现。
  //   ★ 判定不在这里重写（0.9.1）：判据唯一住 `src/domain/req_baseline.ts#judgeDerivedEntryChange`
  //     （12 条 behavior-cases 挂在设计节点 `file_src_domain_req_baseline_ts` 上，由「设计册判据」门逐条真跑）。
  //     本门只做 I/O：git 窗口 · `cache.db` 此刻签名 · 凭证扫描 · 基线棘轮 · 三态退出码。
  //   ★ 输入是**显式钉死的**（0.12②）：缺省两个窗口（工作区 vs HEAD ∪ 未跟踪、HEAD~1..HEAD），
  //     不是 mtime / cwd / 可被覆盖的缓存；`--range A..B` 可复现任意历史区间。
  //   ★ 基线 `scripts/req-baseline-baseline.json` **故意留空**（本仓 0 存量）：门不需要存量豁免，
  //     一旦这里有登记，"存量违规"就会变成合法噪音（0.16）。
  {
    name: '派生条目要求权',
    kind: 'gate',
    cmd: 'node',
    args: ['scripts/req-baseline-gate.mjs', '--allow-req-baseline'],
    why:
      '★ 判据 = `0.29⑥`：一条**被改动**的派生条目，按序判 —— 单侧（新增/删除）不判 → 两侧都非派生不判 → ' +
      '**情形 C**（该条目对应的源码文件在同窗口内也改了）放行 → **情形 A**（改后签名 == `cache.db` 此刻）红 → ' +
      '**情形 B**（真提升）必须有凭证（指名的 `signature-matches` 或 `behavior-cases`），否则红。' +
      '★ 它挡的事故：「把设计册改回源码当前值」是让 drift 变绿的最省事操作，而它使那条派生条目**永远无法再报"这里被改过"**；' +
      '此前全仓**没有任何门**看得见这件事（判据只在 AGENTS 0.29⑥ 的散文里）。' +
      '★ 三态与其余门一致：0 无未登记违规 / 1 红（逐条点名 窗口·文件·符号·改前→改后·情形·修法）/ 2 判不了（dist·cache.db·git 缺）—— 不折成 0。',
  },

];

const has = (b) => { try { return spawnSync(b, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0; } catch { return false; } };

/**
 * 子门「跑不了 / 判不了」的退出码（= 本文件 `main()` 自己的 SKIP 码）。
 *
 * ★ 不变量：**只有自报 unsupported 的门才配用 2**。用它表达「缺输入」而不折成 1，
 *   是因为「缺输入」与「断言红」的处置完全不同（补输入 vs 改代码），读端必须能分辨。
 */
const UNSUPPORTED_EXIT = 2;

// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-05（R21 · `docs/todo.md`）：**失败门的完整输出必须落盘** —— 摘要一行、明细一个文件
// ════════════════════════════════════════════════════════════════════
// 它治的病（盲复核实测 + 主控两次亲历）：每道门的输出被**硬截断到 4000 字符** ⇒ 只看到
//   「1 道门失败：设计册判据」，**看不到是哪条**；要定位得**另外单独跑那道门**（靠人记得做）。
//   这比「只给指针」更糟：**指针都不给，直接把明细切掉**（AGENTS.md 0.12 第 4 条）。
//   复核原话：「**『门绿』的观感强于它实际能证明的东西**」。
// ★ 判据（可判，双向）：门红 ⇒ 摘要行带**失败 N 条** + 日志路径，从该路径能读到**第一条失败的原文**
//   （一个字节都不截）；门绿 ⇒ 不许出现「失败 N 条」（否则是第二条永远会亮的灯，0.16）。
// ★ 为什么不把 4000 调大：那是**拍出来的窗口**，抬到 40000 只是把下一次的洞挖深（同一个病晚一轮复发）。
// ★ 为什么用正则数失败行：子门输出是**文本流**（tsc / node:test 的 TAP / 各 scripts），没有结构化接口
//   —— 文本形状**本身就是**这里要读的答案（0.18① 允许的场合）。它只用于**计数与定位**，
//   不参与任何门的判定（判定仍住在各子门）；**识别不出 ⇒ 说「没识别出」，绝不许报 0**（0.9.4 第 1 行）。
const FAIL_LINE_RE = /^\s*(?:not ok\b|FAIL\b|[✗✖×])|error TS\d+/;

/** 失败行（原文，未截断）。空数组 = **没识别出**，不是「没有失败」。 */
export function failureLines(out) {
  return String(out ?? '')
    .split(/\r?\n/)
    .filter((l) => FAIL_LINE_RE.test(l));
}

// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-05（R38 · `docs/todo.md`）：**通过腿的读数只许来自该门自己的【汇总行锚点】**
//   与失败腿（R21）同一条纪律：**读不出 ⇒ 说"未识别"，绝不印一个猜出来的数**。
// 病（实测）：通过腿原来对**整份输出**取第一处 `用例 N/M` —— 而测试门的输出是「逐文件一行
//   `用例 6/6`」+「末尾一行汇总」⇒ verify 印 `用例 6/6`，同一时刻真值 422/422。
//   ★ 危害**比不印更坏**：不印 ⇒ 人知道"没读到"；印 6/6 ⇒ 人以为"这门跑了 6 条、全过"。
// 判据（双向；`tests/p0_no_false_green_gates.test.ts` ④⑤⑥ 真跑）：① 测试门 ⇒ 与该门汇总行逐字一致
//   的 N/M（数字从输出现取，不写死）② 有 `6/6` 但无汇总行 ⇒ `用例 未识别` ③ 消融：锚点降回"全文首个
//   N/M" ⇒ ② 立刻变回印 6/6（那两条用例变红）。
// ★ 表里没有条目 ⇒ **未识别**（fail-closed：新增一道门默认拿不到数字，而不是默认拿一个猜的）；
//   锚点命中数 ≠ 1（0 处 / 多处）⇒ 同样未识别。★ 不给每道门各写一段 if：那是 13 个例外（0.25②③）。
// ════════════════════════════════════════════════════════════════════
export const READOUT_ANCHORS = [
  // `total` / `pass` / `fail` = 该锚点里的捕获组号；`fail` ⇒ pass = total − fail。
  {
    gate: 'MCP 工具签名',
    unit: '工具',
    // 实测原文：`总工具   = 44` + `· 坏签名 = 0`
    anchor: /^总工具\s*=\s*(\d+)\n· 坏签名\s*=\s*(\d+)/gm,
    total: 1,
    fail: 2,
  },
  {
    gate: '实现夹具',
    unit: '夹具',
    // 实测原文：`夹具：25/25 通过`
    anchor: /^夹具：(\d+)\/(\d+) 通过$/gm,
    pass: 1,
    total: 2,
  },
  {
    gate: '设计册判据',
    unit: '判据',
    // 实测原文：`—— 3 册 / 判据 630 条判过（630 pass）/ 0 册有红`
    anchor: /^\s*—— \d+ 册 \/ 判据 (\d+) 条判过（(\d+) pass）\/ \d+ 册有红$/gm,
    total: 1,
    pass: 2,
  },
  {
    gate: '文档与事实',
    unit: '检查',
    // 实测原文：`—— 文档与事实：4/4 通过`
    anchor: /^\s*—— 文档与事实：(\d+)\/(\d+) 通过$/gm,
    pass: 1,
    total: 2,
  },
  {
    gate: '测试',
    unit: '用例',
    // 实测原文：`测试门：文件 82 / 用例 422（源码声明 422）/ 通过 422 / 失败 0 / 跳过 0`
    // ★ 分子取门自己打的「通过」，不取「用例 − 失败」：跳过也算没跑，但那一档由该门自己判红。
    anchor: /^测试门：文件 \d+ \/ 用例 (\d+)（源码声明 \d+）\/ 通过 (\d+) \/ 失败 \d+ \/ 跳过 \d+$/gm,
    total: 1,
    pass: 2,
  },
  {
    gate: '结构意图',
    unit: '文件',
    // 实测原文：`   源码 N 个 · 干净入册 M · 已声明排除 K · **冲突 C** · 缺口 G`（★ R32 起为**四桶**；闭合等式在 design_line.ts#assertConflictUniverseClosed 里断言，不是注释）
    // ★ 分子只数**干净入册**：冲突与缺口都不算通过（宁少不多 —— 把冲突算进"通过"就是 R32 要治的那个假绿）
    anchor: /^\s+源码 (\d+) 个 · 干净入册 (\d+) · 已声明排除 \d+ · \*\*冲突 \d+\*\* · 缺口 (\d+)$/gm,
    total: 1,
    pass: 2,
  },
];
// **没有**可锚定 N/M 的门（清单 = 2026-11-05 逐道实测原文；不在上表就是"印 未识别"）：
//   · `ts 类型` / `Go 编译` / `Go 静态检查` —— 通过时**零输出** ⇒ 连分母都没有
//   · `设计 DB 结构` —— 有分母（421 份投影）但**没有"通过数"**：违规是五个独立计数器（归属重复/
//     真冲突/陈旧/缺/多），相加不是"通过了多少份投影" ⇒ 不做减法
//   · `判据突变` —— 分子（killed 5）与分母（本次样本 6）分处两块且语义不同源（6 = 5 语义 + 1 结构）
//     ⇒ 拼成 6/6 就是我编的（R38 的原病）⇒ 不合成
//   · `无卡写账` —— `总写入 229 · 有卡 185 · 无卡 0` 三者不是"通过/总数"关系（有卡 ≠ 通过）⇒ 不印
//   · `派生条目要求权` —— `判了 0 条条目改动，0 条违规`：分母 0 ⇒ `0/0` 是最会骗人的那个数 ⇒ 不印

/** 剃掉 ANSI 颜色与 CRLF（子门的 PASS/FAIL 是彩色的；锚点只认文字、不认颜色） */
const plainText = (s) => String(s ?? '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\r\n/g, '\n');

/**
 * 从**该门自己的汇总行锚点**取 `{unit, pass, total, source}`；取不到 ⇒ `null`（= 不许印数）。
 *
 * 判据（0.14 双向）：① 锚点**恰好命中 1 处**才算命中（0 处 = 输出里没有那行；≥2 处 = 它不再唯一地
 * 指认"汇总行"）② 分子分母必须来自**同一处命中**（不许 A 行的分子配 B 行的分母）。
 * `source` = 命中的那段原文（人拿它核"这个数是从哪句话来的"）；**没有 source 的路径不许走到印数那一步**。
 */
export function casesOf(gateName, out) {
  const entry = READOUT_ANCHORS.find((e) => e.gate === gateName);
  if (!entry) return null;
  const hits = [...plainText(out).matchAll(entry.anchor)];
  if (hits.length !== 1) return null;
  const m = hits[0];
  const num = (i) => {
    const v = i === undefined ? undefined : m[i];
    return typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null;
  };
  const total = num(entry.total);
  const failed = entry.fail === undefined ? 0 : num(entry.fail);
  const pass = entry.pass !== undefined ? num(entry.pass) : failed === null || total === null ? null : total - failed;
  if (total === null || pass === null || pass < 0 || pass > total) return null;
  return { unit: entry.unit ?? '用例', pass, total, source: String(m[0]).trim() };
}

/**
 * 门日志目录（相对被检查的根）。
 *
 * ★★★ 2026-11-05（R39）：**它必须住在一个「已被 MANIFEST 认领」的目录里**。
 *
 * 不变量（破坏它 = 一个缺陷亮两盏灯，第二盏还指着无关的地方）：门红时落下的工作产物**不许**
 * 成为 `.agent-io/` **顶层的新条目**。`manifest:check` 的口径是「`.agent-io/` 顶层每个条目都得是
 * 某卷的 `probe`，或登记在 `NON_VOLUME_ENTRIES`」（`scripts/gen_manifest.mjs#checkManifest` 第 ③ 条）
 * —— 它**不认 gitignore**；而门次序是「… 设计册判据 → 判据突变 → **文档与事实** → 测试 …」⇒
 * 前面任一门红落下的目录，会让**后面那盏灯**也红，且那盏灯指着的地方与元凶无关（查因方向被带偏）。
 * 实测形态：`.agent-io/verify-last/`（上一轮门红落下 ⇒ 这一轮「文档与事实」的 manifest:check 报
 * 「.agent-io/ 下有没人认领的条目：verify-last」）。
 *
 * ⇒ 落点 = `.agent-io/scratch/`：它是卷表里**已声明的卷**（`probe: 'scratch'`），而 manifest 只看**顶层**
 * ⇒ 嵌在它下面的一层目录对本门不可见；且按 `gen_manifest.mjs` 自己的处置口径，一次性产物本就该写进
 * scratch（「② 某个工具的一次性产物 ⇒ 改那个工具让它写进 scratch，**不要**在这里登记它」——
 * 把临时件登记成合法条目会把那道门变成静音按钮）。★ 仍被 `.gitignore` 的 `.agent-io/*` 覆盖 ⇒ 不进 git。
 *
 * 判据（`tests/p0_no_false_green_gates.test.ts` ⑦ 真跑）：造一个失败门 ⇒ 日志落在 scratch 下、且同一次里
 * `gen_manifest --check` **仍绿**；反向：`.agent-io/` 下造一个未声明条目 ⇒ 它**必须**红（不许靠放宽那道门来治）。
 * ★ 这句话对**每一次新机制落地**都成立：先问「**它自己会不会变成别人门里的红**」。
 */
export const GATE_LOG_REL = '.agent-io/scratch/verify-last';

/** 门名 → 文件名词（去掉路径不安全字符；**中文保留** —— 读的人要认得出是哪道门） */
function slugOf(name) {
  return String(name).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').replace(/^_+|_+$/g, '') || 'gate';
}

/** 一道门的日志路径：`<根>/.agent-io/scratch/verify-last/<门序号>-<门名slug>.log`（落点理由见 `GATE_LOG_REL`） */
export function gateLogFile(root, idx, name) {
  return path.join(root, GATE_LOG_REL, `${String(idx).padStart(2, '0')}-${slugOf(name)}.log`);
}

/** 把一道门的**完整输出**落盘（不截断）。`ok:false` 时 `err` 必非空（写不进去也要说出来，0.12）。 */
function writeGateLog(root, idx, name, out) {
  const abs = gateLogFile(root, idx, name);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  try {
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, String(out ?? ''), 'utf-8');
    return { rel, ok: true, err: '' };
  } catch (e) {
    return { rel, ok: false, err: e.message };
  }
}

/** 开跑前清掉上一轮日志（否则「从这条路径读到第一条失败」可能读到**上一次**跑的那一份）。 */
export function clearGateLogs(root) {
  try {
    rmSync(path.join(root, GATE_LOG_REL), { recursive: true, force: true });
  } catch {
    // 清不掉不致命：每份日志都带门序号，本轮会覆盖写同名的那些。
  }
}

/**
 * 一道门的**摘要读数**（R21 的唯一实现处；`main()` 只打印它，不另拼一份文案）。
 *
 * @param {string} root 被检查的项目根（`verify-clean` 也走这里 ⇒ 日志落在那棵树上）
 * @param {number} idx 门序号（1-based，与打印顺序一致）
 * @param {string} name 门名
 * @param {'PASS'|'FAIL'|'SKIP'} state 三态
 * @param {string} out 门的完整输出（stdout+stderr）
 * @returns {{text:string, cases:{unit:string,pass:number,total:number,source:string}|null,
 *   logRel:string|null, failures:string[], lines:number, how:string}}
 *   `text` 接在耗时列之后：通过 ⇒ `<单位> N/M`（**只从该门自己的汇总行锚点取**；取不到 ⇒ `用例 未识别`
 *   且 `cases: null`）；失败 / 没跑成 ⇒ `失败 N 条 · 日志 <相对路径>`
 */
export function gateReading(root, idx, name, state, out) {
  const raw = String(out ?? '');
  const failures = failureLines(raw);
  const lines = raw ? raw.split(/\r?\n/).length : 0;
  if (state === 'PASS') {
    const cases = casesOf(name, raw);
    // ★ R38：取不到锚点 ⇒ 印**显式的"未识别"**（不印 ⇒ 人以为"这门没有读数"；印一个猜的数 ⇒ 人以为它跑过）
    return { text: cases ? `${cases.unit} ${cases.pass}/${cases.total}` : '用例 未识别', cases, logRel: null, failures, lines, how: '' };
  }
  const log = writeGateLog(root, idx, name, raw);
  const how = log.ok ? '' : `★ 完整输出**落盘失败**（${log.err}）—— 这是写不进去，不是「没有明细」`;
  const count = failures.length
    ? `失败 ${failures.length} 条`
    : `未从输出里识别出失败行（原文 ${lines} 行；这**不是**「没有失败」）`;
  return {
    text: `${count} · 日志 ${log.ok ? log.rel : '（落盘失败）'}`,
    cases: null,
    logRel: log.ok ? log.rel : null,
    failures,
    lines,
    how,
  };
}

/** 长输出只印头部并**标注已截断**（只在「已经有完整出路」时用：落盘日志 / 报告区） */
const clip = (s, n) =>
  s.length <= n ? s : `${s.slice(0, n)}\n…（★ 已截断：原文 ${s.length} 字符，只印前 ${n}；完整输出见落盘日志）`;

/**
 * 跑一道门，返回三态结果。
 *
 * ★ `root` = **被检查的项目根**（默认本仓）。`scripts/verify-clean.mjs` 用它在干净 clone 里
 *   复放**同一份** GATES ⇒ 门清单只有一处权威（0.9），且两边跑的是同一个执行函数（不另写一把尺）。
 * ★ `env` = 子进程追加的环境变量（干净环境要隔离 HOME，见 verify-clean 的注释）。
 */
export function run(g, root = ROOT, env = {}) {
  // ★ 构造期已注定失败的门（如"本地编译器没装"）—— 优先于 need，且**是 FAIL 不是 SKIP**
  if (g.fail) return { state: 'FAIL', why: g.fail, out: '' };
  if (g.need && !has(g.need)) return { state: 'SKIP', why: `缺 ${g.need} 工具链` };
  const cwd = g.cwd ? path.join(root, g.cwd) : root;
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
    env: { ...process.env, ...env, AGENT_IO_DOGFOOD_VIA: 'gate' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  if (r.error) return { state: 'FAIL', why: r.error.message, out };
  // ★★ 2026-11-03（批次 0 · 0.5）：**退出码 2 = 子门自报「跑不了 / 判不了」（unsupported）** ⇒ 记成 SKIP。
  //   为什么必须有这一档：子门（如 `实现夹具`）缺输入时**既不是通过，也不是断言红** ——
  //   折成 FAIL 会让「缺输入」与「真回归」长得一样（分不清就查不了因）；折成 PASS 就是假绿（0.12）。
  //   ★ 它不会把红变绿：SKIP 让总门退 **2**（≠ 0），「每一道门都真跑过并通过」仍然不成立。
  if (r.status === UNSUPPORTED_EXIT) return { state: 'SKIP', why: '门自报 unsupported（退出码 2）', out };
  if (r.status !== 0) return { state: 'FAIL', why: `退出码 ${r.status}`, out };
  return { state: 'PASS', why: '', out };
}

// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-02（T-#clean-env）：**被 import 时只导出、不跑门**。
//   理由：`scripts/verify-clean.mjs` 要在**干净 clone** 里复放**同一份** `GATES`（0.9 一处权威：
//   门名单只许有一份）。而 ESM 的 `import` 会执行模块顶层 ⇒ 不设这道闸，一次 import 就把十道门
//   全跑在本仓上（实测代价：多跑 ~7 分钟，且拿到的读数**不是**干净环境的）。
//   判据：只有「本文件就是入口脚本」（`process.argv[1]` 与自身路径同一）才跑门。
// ════════════════════════════════════════════════════════════════════
function main() {
  console.log(`${C.b}verify —— 本仓唯一的总门${C.x}  ${C.d}（三态；返回 0 = 每一道门都真跑过并通过）${C.x}\n`);

  // ★★★ R75（2026-11-05）：**重活排他** —— 本仓的 13 道门与 `mutate` / `judge-all` 共享
  //   `dist/` · `judge-cache.json` · `cache.db` · `design-db/` ⇒ 两个进程同时跑，读数是**不可归因**的
  //   （实测三次拿到假红：同一条命令两次结论不同；「判据突变」门 402ms 崩在 `mutate.lock` 上）。
  //   ★ 为什么锁在**总门**这一层：它已经是"唯一总门"，天然该保证"同一时刻只有一轮重活在跑"；
  //     子门（`mutate` / `judge-all`）看到 `AGENT_IO_HEAVY_HOLDER` 指向锁的持有者 ⇒ **判定自己在锁里**、
  //     不再重复加锁（可重入靠**环境变量按进程树继承**，不靠查 ppid 链）。
  //   ★ 拿不到锁 ⇒ **响亮拒绝并点名"谁在跑"**，不是静默跳过 —— 静默跳过正是"拿到不可归因读数"的来源。
  let releaseLock = null;
  try {
    releaseLock = acquireHeavyLock(ROOT, { name: 'verify' });
  } catch (e) {
    console.error(`${C.r}✗ 没法开始${C.x}：${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  // ★ 用 `exit` 兜住所有返回路径（`main()` 有多处 return）；`unlinkSync` 是同步的，可在 exit 钩子里跑。
  process.on('exit', () => {
    try {
      releaseLock?.();
    } catch {
      /* 释放失败不改结论 */
    }
  });

  // 惰性门在此刻定型（元素可能是函数）；此后一律按定型后的数组走。
  const gates = GATES.map((g) => (typeof g === 'function' ? g(ROOT) : g));

  let fail = 0;
  let skip = 0;
  const tail = [];
  /** @type {Array<{name:string, state:string}>} 逐门结果 —— 汇总行要按它点门名（0.7） */
  const done = [];
  // ★★ R21：开跑前清掉上一轮日志 —— 否则「从这条路径读到第一条失败」可能读到**上一次**跑的那一份
  //   （落盘 ≠ 可定位，前提是它属于这一轮）。
  clearGateLogs(ROOT);
  let gateIdx = 0;
  for (const g of gates) {
    gateIdx += 1;
    const t0 = Date.now();
    const r = run(g);
    const ms = Date.now() - t0;
    const tag = r.state === 'PASS' ? `${C.g}PASS${C.x}` : r.state === 'FAIL' ? `${C.r}FAIL${C.x}` : `${C.y}SKIP${C.x}`;
    const label = (g.kind === 'report' ? `${C.d}[报告]${C.x} ` : '') + g.name;
    const reading = gateReading(ROOT, gateIdx, g.name, r.state, r.out);
    console.log(`  ${tag}  ${label.padEnd(20)} ${C.d}${String(ms).padStart(5)}ms  ${reading.text}${r.why ? ` · ${r.why}` : ''}${C.x}`);
    // ★★ R21（2026-11-05）：**门红时必须能定位到哪条红** —— 原来这里把每道门的输出硬截断到 4000 字符，
    //   于是「N 道门失败：<门名>」这种摘要之后看不到是哪条（「指针都不给，直接把明细切掉」）。
    //   现在的形状：摘要一行一门（`gateReading` 唯一实现）· 失败门的**完整输出**落盘 · 明细区印头几条失败原文。
    //   ★ 不调阈值的取舍：4000 是**拍出来的窗口**，抬到 40000 只是把下一次的洞挖深。
    if (r.state === 'FAIL') {
      fail++;
      const where = reading.logRel ?? '（落盘失败，见下）';
      const head = reading.failures.length
        ? `      ${reading.failures
            .slice(0, 3)
            .map((l) => l.trim().slice(0, 300))
            .join('\n      ')}\n      ★ 共 ${reading.failures.length} 条失败行；完整输出（**不截断**）：${where}`
        : `      ★ **没从输出里识别出失败行**（原文 ${reading.lines} 行）—— 这不是「没有失败」，是「没解析出来」\n` +
          `      ★ 完整输出（**不截断**）：${where}`;
      tail.push(`${C.r}── ${g.name} 失败明细 ──${C.x}\n${head}${reading.how ? `\n      ${reading.how}` : ''}`);
    }
    if (r.state === 'SKIP') {
      skip++;
      // ★ 门的 SKIP 输出也要看得见：子门用退出码 2 报 unsupported 时，**「缺什么」就写在它的输出里**。
      //   只打一句「门自报 unsupported」等于把原因丢掉（0.12：失败必须与「没有」可区分）。
      if (r.out) {
        tail.push(
          `${C.y}── ${g.name} 输出（SKIP：跑不了 / 判不了）──${C.x}\n${clip(r.out, 2000)}\n` +
            `      ★ 完整输出（**不截断**）：${reading.logRel ?? '（落盘失败）'}`,
        );
      }
    }
    done.push({ name: g.name, state: r.state });
    if (r.state === 'PASS' && g.kind === 'report' && r.out) tail.push(`${C.d}── ${g.name}（报告区：通过时打印正文；失败照常计入）──${C.x}\n${clip(r.out, 3000)}`);
  }

  console.log('');
  if (tail.length) console.log(tail.join('\n\n') + '\n');

  const total = gates.filter((g) => g.kind === 'gate').length;
  const namesOf = (state) => done.filter((d) => d.state === state).map((d) => d.name);
  // ★★★ 2026-11-03（批次 0 · 0.7）：**最后一行必须自己就够用** —— 失败（或没跑成）的**门名**写在这一行里。
  //   为什么：输出被截断时（CI 日志尾部 / 终端只留最后几行），`N 道门失败` 这一句**点不出是哪一道**
  //   ⇒ 红过之后无法查因（实测：提交后第一次 verify 报 1 道门失败，明细被截断，门名没留下）。
  //   不变量：**截断只许截门的输出，不许截门名** —— 门名同时出现在 ① 逐门状态行 ② 明细区标题 ③ 这一行。
  //   ★ 为什么不是「把明细留在最后」：明细长度不可控（一道门能吐几十 KB），把名字押在它后面等于押在截断上。
  const line = fail
    ? `${C.r}${fail} 道门失败${C.x}：${namesOf('FAIL').join(' · ')}`
    : skip
      ? `${C.y}${skip} 道门没跑成（SKIP）${C.x}：${namesOf('SKIP').join(' · ')}`
      : `${C.g}全部 ${total} 道门通过${C.x}`;
  // ★ 退出码说明**放在汇总行之前**：汇总行必须是最后一行（否则 SKIP 时门名又被挤掉了）。
  if (skip && !fail) console.log(`${C.y}⇒ 退出码 2（刻意区别于 0）：有门没跑成，不等于"没问题"。${C.x}`);
  // ★★ R21：门名与明细**各给一条出路** —— 门名在汇总行里（不许被截断），完整明细在磁盘上。
  if (fail) console.log(`${C.d}明细：${GATE_LOG_REL}/<门序号>-<门名>.log（每个失败门一份，完整、不截断）${C.x}`);
  console.log(line);
  if (fail) return 1;
  if (skip) return 2;
  return 0;
}

export { GATES, ROOT };

/** 规范化成"同一处"：Windows 下 `d:\x` 与 `D:\X` 是同一路径。 */
const samePath = (a, b) => path.resolve(String(a)).replace(/\\/g, '/').toLowerCase() === path.resolve(String(b)).replace(/\\/g, '/').toLowerCase();
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) process.exit(main());
