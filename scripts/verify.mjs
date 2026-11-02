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
 *   ⇒ **现状如实说：结构意图（`structure.domains.json` vs 磁盘）目前没有任何门在查** ——
 *     它只是 MCP 工具面（`structure_gap` 工具）里的一次手动读数。
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

];

const has = (b) => { try { return spawnSync(b, ['version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0; } catch { return false; } };

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

  // 惰性门在此刻定型（元素可能是函数）；此后一律按定型后的数组走。
  const gates = GATES.map((g) => (typeof g === 'function' ? g(ROOT) : g));

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
  if (fail) return 1;
  if (skip) {
    console.log(`${C.y}⇒ 退出码 2（刻意区别于 0）：有门没跑成，不等于"没问题"。${C.x}`);
    return 2;
  }
  return 0;
}

export { GATES, ROOT };

/** 规范化成"同一处"：Windows 下 `d:\x` 与 `D:\X` 是同一路径。 */
const samePath = (a, b) => path.resolve(String(a)).replace(/\\/g, '/').toLowerCase() === path.resolve(String(b)).replace(/\\/g, '/').toLowerCase();
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) process.exit(main());
