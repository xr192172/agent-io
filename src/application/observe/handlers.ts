/**
 * observe 线的工具入参适配层（handler）—— ★ 2026-10-05 从 `application/handlers.ts` 按线拆出。
 *
 * 为什么要拆：原来 15 个 handler 挤在一个跨 5 条线的文件里，而 5 个 lane 的 `index.ts` 都 import 它
 * ⇒ `application/` 与每个 lane **互为消费方**（目录级环：文件级无环，所以 code_health 报 0 是对的，
 *   但**目录**才是人导航的单位）。拆开后每条线自足：给这条线加工具只动这条线内的文件。
 *
 * 本文件由 `edit_code`（AST 取边界）从原文件逐符号搬入，**不是手抄**；tsc 是闸门。
 */

import fs from 'node:fs';
import path from 'node:path';
import { wrap, wrapData } from '.././plumbing.js';
import { rebuildChains } from '../../infrastructure/analysis/observe/chain.js';
import { TSComparator, renderTSDiffReport } from '../../infrastructure/analysis/observe/contract.js';
import type { TSDLDecl, TSDiffReport } from '../../infrastructure/analysis/observe/contract.js';
import { judgeEvents, judgeEventsWithLLM, normalizeEvents, renderJudgeReport } from '../../infrastructure/analysis/observe/judge_service.js';
import type { ObserveRuleCtx } from '../../infrastructure/analysis/observe/judge.js';
import { knownSpreadIndex } from '../../infrastructure/analysis/observe/ledger_fold.js';
import {
  observeLangs,
  renderInstrumentReport,
  renderUninstrumentReport,
} from '../../infrastructure/analysis/observe/observe_langs.js';
// ★ 2026-10-06（T15）：探针台账的读取与摘要 —— 原先是 CLI-only 的 `instrument_cli --ledger`。
import { loadProbeLedger, ledgerSummary } from '../../infrastructure/analysis/observe/instrument.js';
import { DesignDSLStore, defaultDSLDir } from '../../infrastructure/analysis/observe/dsl_store.js';
import { queryObserveLog } from '../../infrastructure/analysis/observe/log_query.js';
import { getDSLByView, getLiveDir, requireProjectRoot } from '../../infrastructure/storage.js';
import { observeTrace } from '.././observe/capture/observe_trace.js';
import { reconcileChain } from '.././observe/reconcile/reconcile_chain.js';
import type { ReconcileChainInput } from '.././observe/reconcile/reconcile_chain.js';

/** 探针名后缀 → 基名（`X.enter` 的基名是 `X`）。★ 必须含 Go 侧特有后缀：Go 的 defer 探针名形如
 *  `main.closure@L123C9.defer`（T294 假阳性的成因 —— 后缀表缺 `defer` 会把它当成独立函数）。 */
const PROBE_SUFFIX_RE = /\.(enter|exit|catch|defer|recover|writefile|mkdir|rename|remove|append|readfile)$/i;

/** Go 隐式构建约束的文件名后缀（GOOS / GOARCH）：`foo_linux.go` / `bar_amd64.go` 只在对应平台编译。 */
const GO_PLATFORM_SUFFIXES = new Set([
  // GOOS
  'aix', 'android', 'darwin', 'dragonfly', 'freebsd', 'hurd', 'illumos', 'ios', 'js', 'linux',
  'nacl', 'netbsd', 'openbsd', 'plan9', 'solaris', 'wasip1', 'windows', 'zos',
  // GOARCH
  '386', 'amd64', 'arm', 'arm64', 'loong64', 'mips', 'mips64', 'mips64le', 'mipsle',
  'ppc64', 'ppc64le', 'riscv64', 's390x', 'wasm',
]);

/**
 * 该 Go 文件是否带**构建约束**（⇒ 与同目录别的文件可能互斥、不会同时编译）？
 * 覆盖两形态：① 文件头的 `//go:build` / `// +build` 注释；② 隐式文件名后缀（`foo_linux.go`）。
 *
 * ★★★ 为什么必须有它：`action=lint` 新增的「跨文件撞名」判据在**同一目录**下报警，而
 *   「同目录两个文件声明同名顶层函数」**唯一合法**的成因就是**构建约束**（平台替代实现，
 *   如 `open_linux.go` 与 `open_windows.go` 各有 `func open`）。
 *   不排除它 ⇒ **必然误报**（而本仓反复强调"假阳性会让体检失去信任"）⇒ 查出来就跳过（宁可少报）。
 * ★ 读不到文件 ⇒ 保守当作"可能有约束"⇒ 跳过（同样宁可少报）。
 */
function hasGoBuildConstraint(file: string): boolean {
  const base = path.basename(file);
  if (!base.endsWith('.go')) return false;
  // ② 隐式文件名后缀：<name>_<GOOS|GOARCH>.go
  const stem = base.slice(0, -3); // 去掉 ".go"
  const us = stem.lastIndexOf('_');
  if (us > 0 && GO_PLATFORM_SUFFIXES.has(stem.slice(us + 1))) return true;
  // ① 文件头注释里的 build 指令（只扫开头 2KB —— 约束必须在 package 子句之前）
  try {
    const head = fs.readFileSync(file, 'utf-8').slice(0, 2048);
    if (/^\/\/go:build\s/m.test(head) || /^\/\/\s*\+build\s/m.test(head)) return true;
  } catch {
    return true; // 读不到 ⇒ 保守跳过
  }
  return false;
}

/** observe_instrument：对目标项目全自动插桩 / 还原（复用 instrumentProject/restoreInstrumented）。
 * ★ wrapData：handler 回 `data`（results / ledger / 还原清单），wrap 会静默丢弃。 */
export const observeInstrumentHandler = wrapData(async (a) => {
  const targetArg = a.target as string | undefined;
  if (!targetArg) {
    throw new Error('observe_instrument 需要 target 参数：传要插桩的项目目录。');
  }

  // ★★ 2026-10-06（T15 尾账）：`target` 在**入口归一成绝对路径**再往下传 —— 本 handler 唯一的取根处。
  //   为什么必须在**入口**（而不是各语言包自己修一遍）：Go 包的插桩是
  //   `spawn('go', ['run', './cmd/instrument', root, …], { cwd: goObserveDir() })`
  //   —— ★ **子进程的 cwd 是语言包目录**，而 `root` 是**位置参数**
  //   ⇒ 相对 target 会被按**那个**目录解析。
  //   **实测**（改前）：`target=observe-lang-go`（相对）⇒
  //     `Observe 插桩失败（语言包 go）：instrument: open <repo>\observe-lang-go\observe-lang-go`
  //     （★ **多拼一层** —— 正是"相对路径原样下传"），而**绝对的同一目标完全正常**
  //     （扫描 12 源文件 / 将注入 9+34 探针点）⇒ 这类错只在相对路径下出现，属"静默错位"。
  //   ★ 基准 = **调用方 cwd**（本仓 `project_dir` / `file` 等入参的既有口径），
  //     既不是语言包目录、也不是 `project_root`。
  const target = path.resolve(targetArg);

  // ★★ 2026-10-06（T15）：`action=ledger` —— 查看探针台账（一次插桩的全部探针点 + 统计）。
  //   为什么补它：本仓盘点「真 CLI 共 11 个」时，`instrument_cli --ledger` 是那个 CLI **唯一**
  //   没有 MCP 对应的一项（action 枚举原先只有 `instrument|uninstrument|restore`）
  //   ⇒ 直接删那个 CLI 会**丢掉一个能力**（它不是"多余的投影"）。
  //   本处接的是**只读**分支，复用 CLI 的同一实现（`loadProbeLedger` / `ledgerSummary`），
  //   不碰任何写盘/备份路径。
  //   ★ 输出形状：`message` = 人读台账（与 CLI 逐行一致）；`data` = `{ root, ledger, summary }`。
  //     `ledger: null` = 未找到台账 ⇒ **不抛错**（"没插过桩 / 已全拔"是正常状态，不是失败）。
  // ★★★ 2026-10-14：**插桩体检（`action=lint`）** —— 「清单对比」的第一道筛。
  //
  // ## 为什么要有它（来自今天 35 条账的复盘）
  // 今天挖出的账里，约**三分之一是【结构类】**（探针名撞了 / 该有的没有），而它们
  // **全都体现在探针台账里** —— 台账本来就有（`action=ledger`），只是**没人去比**。
  // ⇒ 这一支就是"**去比**"：纯台账内检查，**不需要跑、不需要接 sink、秒级**，
  //   把结构类问题挡在端到端之前（端到端贵，且贵在"要跑起来"）。
  //
  // ## 判据（★ 只三条，且**不需要人写期望清单** —— 不变量而非期望值）
  // 按"函数"聚合（把 `X.enter` / `X.exit` / `X.catch` 归到 `X`）：
  //   ① **每个函数恰有一条 enter、一条 exit** —— 缺 ⇒ 漏插；多 ⇒ **撞名**（两个东西共用一个名字）。
  //      ★ 实测这类账：T280（Go 闭包全叫 `main.closure`）· T282（get/set 都叫 `value`）
  //        · T263（箭头函数漏插 ⇒ 少一对）。
  //   ② **同一 `probe` 名在同一文件出现多次** —— 直接点出撞名的具体名字。
  //   ③ **完全没有探针的文件** —— 扫描到却一个点都没插（可能是整文件漏插）。
  //
  // ★ 覆盖不到什么（如实）：**运行时语义**（取值时机、序列化失败、事件顺序）——
  //   台账只记"注入了什么"，不记"跑起来发生了什么"。那类必须靠端到端。
  if (a.action === 'lint') {
    const lintRoot = target;
    const ledger = loadProbeLedger(lintRoot);
    if (!ledger) {
      return {
        message: `=== Observe 插桩体检 [${lintRoot}] ===\n未找到台账（可能从未插桩，或已一键全拔清理）。\n  ⇒ 先跑一次插桩（不带 action），再体检。`,
        data: { root: lintRoot, ledger: null, issues: [] },
      };
    }
    const sites = (ledger as { sites?: Array<{ probe?: string; file?: string; kind?: string; line?: number }> }).sites ?? [];
    // 按"文件 + 函数基名"聚合（基名 = 去掉 .enter/.exit/.catch/.writefile 等后缀）
    const byFn = new Map<string, { enter: number; exit: number; probes: string[] }>();
    const byFile = new Map<string, number>();
    for (const s of sites) {
      const probe = String(s.probe ?? '');
      if (!probe) continue;
      const file = String(s.file ?? '');
      byFile.set(file, (byFile.get(file) ?? 0) + 1);
      // ★★★ T294（2026-10-14）：后缀表要含 Go 侧特有的 —— 实测 Go 的 defer 探针名是
      //   `main.closure@L123C9.defer`，而原表没有 `defer` ⇒ 它被当成一个独立函数（enter=0/exit=0）
      //   ⇒ 假阳性。（假阳性会让体检失去信任 ⇒ 宁可判据少而准。）
      const base = probe.replace(PROBE_SUFFIX_RE, '');
      const key = `${file}::${base}`;
      const rec = byFn.get(key) ?? { enter: 0, exit: 0, probes: [] };
      if (probe.endsWith('.enter')) rec.enter++;
      else if (probe.endsWith('.exit')) rec.exit++;
      rec.probes.push(probe);
      byFn.set(key, rec);
    }
    const issues: Array<{ kind: string; where: string; detail: string }> = [];
    // ① 每个函数恰一条 enter / 至少一条 exit
    //   ★★★ 2026-10-14 修（我自己的假阳性）：**`exit > 1` 不是撞名** ——
    //     一个函数有多个 `return` 就天然有多条 exit（实测 `loopRet` 里两个 return ⇒ exit=2）。
    //     ⇒ **撞名的判据只能是 `enter > 1`**（一个函数只能有一个入口）。
    //     ★ 这条假阳性是"跑一次真夹具"抓出来的 —— 光看代码不会发现。
    for (const [key, rec] of byFn) {
      const [file, base] = key.split('::');
      // ★ 先判**撞名**（`enter > 1`）—— 它比"缺失"更具体：`enter=2 exit=0` 既撞名又缺 exit，
      //   两条都报（★ 实测构造过这一格：先判缺失会把撞名掩盖成"漏插"）。
      if (rec.enter > 1) {
        issues.push({
          kind: 'duplicate-name',
          where: `${file} :: ${base}`,
          detail: `enter=${rec.enter} ⇒ **撞名**：两个不同的东西共用了这个名字（契约匹配会命中错的对象）`,
        });
      }
      if (rec.enter === 0 || rec.exit === 0) {
        issues.push({
          kind: 'missing-pair',
          where: `${file} :: ${base}`,
          // ★★★ T294（2026-10-14）：**如实标注「可能正确」** —— 实测 Go 的 `main.boom`（末语句 `panic(…)`）
          //   就是 enter=1 / exit=0，而那是**正确**行为（panic 之后没有出口）。同类还有 `os.Exit`、死循环。
          //   ⇒ 体检只读台账、**看不出**这些语义 ⇒ 与其报成「漏插」，不如说清「也可能是正确的」。
          //     ★ 假阳性会让体检失去信任（本仓反复强调）⇒ 宁可说得准。
          detail: `enter=${rec.enter} exit=${rec.exit} ⇒ 缺${rec.enter === 0 ? ' enter' : ''}${rec.exit === 0 ? ' exit' : ''}（漏插或名字算错；★ 但「有 enter 无 exit」**也可能是正确的** —— panic / os.Exit / 死循环结尾的函数本就没有出口）`,
        });
      }
    }
    // ② ★★★ T295（2026-10-14）：**跨文件撞名** —— 同一「探针基名」出现在【同一目录】的 ≥2 个不同文件。
    //
    // ## 为什么原来的判据删了、这条要新加
    // 原来（更早）这里查的是"同名 probe 出现 >1 次"，被删掉是因为它**过粗**：
    //   · **多 return 的函数天然有多条同名 exit**（`loopRet.exit` 出现 2 次是正常的）—— 已由 ① 覆盖；
    //   · **跨文件同名也可能正常**（不同文件的 `main.enter` 互不相干）。
    // 但删掉之后**留了一个洞**：① 的 `enter > 1` 按 `文件::基名` 聚合 ⇒ **跨文件**撞名各成一条
    //   （enter=1/exit=1）⇒ **抓不到**。而 T295（同包两个文件各一个 `init()`，Go 侧原先都叫
    //   `pkg.init`）正是这种跨文件撞名 ⇒ ① 漏报。这条补的就是那个洞。
    //
    // ## 判据：同目录 + 同基名 + ≥2 文件
    //   · **必须同目录**：同目录 = 同包；**跨目录**同名是**正常**的（如两个 `package main` 命令
    //     各有一个 `func Run`，探针名都叫 `main.Run`）⇒ 不限制目录就会误报（这条限制就是"防误报"的关键）。
    //   · **同目录同基名基本=撞名**：Go **不允许**同一包两个文件声明**同名顶层函数**（唯一例外是
    //     `init` —— 而 Go 侧已把 init 的名字带上文件名区分，见 instrument.go 的 funcDeclName）
    //     ⇒ 同目录里出现同基名，只可能来自**插桩命名缺陷**（T295 那类）或**合成名撞车**
    //     （如两个文件里行列位置相同的 `closure@L..C..` ⇒ 确实是两个不同的闭包共用一个名字）。
    //
    // ## ★ 为什么**不会误报**（这是加它的前提）
    // "同目录两个文件声明同名函数"在 Go 里**唯一合法**的成因是**构建约束**（平台替代实现：
    // `open_linux.go` 与 `open_windows.go` 各有 `func open` —— 二者互斥、永不同时编译）。
    // ⇒ 凡带构建约束的文件一律**跳过**（`hasGoBuildConstraint` 覆盖 `//go:build`/`// +build`
    //   注释与隐式文件名后缀两种形态）。排掉它之后，同目录同基名就**不存在**合法解释 ⇒ 必为撞名。
    //   ★ 仍有残余：读不到文件时保守跳过（宁可少报）；构建约束若只以**其它**非常规形式表达
    //     （本函数未识别），仍可能漏过 —— 但那属于极罕见，且**方向是少报而非误报**。
    const filesOfBase = new Map<string, Set<string>>();
    for (const s of sites) {
      const probe = String(s.probe ?? '');
      const file = String(s.file ?? '');
      if (!probe || !file) continue;
      const base = probe.replace(PROBE_SUFFIX_RE, '');
      const set = filesOfBase.get(base) ?? new Set<string>();
      set.add(file);
      filesOfBase.set(base, set);
    }
    for (const [base, fileSet] of filesOfBase) {
      if (fileSet.size < 2) continue;
      const files = [...fileSet];
      // 只在【同一目录】报（跨目录同名正常 —— 见上"必须同目录"）
      if (new Set(files.map((f) => path.dirname(f))).size !== 1) continue;
      // 构建约束（平台替代实现）⇒ 合法，跳过（见上"不会误报"）
      if (files.some((f) => hasGoBuildConstraint(f))) continue;
      issues.push({
        kind: 'duplicate-name',
        where: `${path.dirname(files[0])} :: ${base}`,
        detail:
          `跨文件撞名：同一目录下 ${files.length} 个文件都产出探针名「${base}」` +
          `（${files.map((f) => path.basename(f)).join(' / ')}）` +
          `⇒ 两个不同的东西共用一个名字（契约匹配会命中错的对象）`,
      });
    }
    // ③ 有文件却一个点都没有
    const fileSet = new Set<string>((ledger as { files?: string[] }).files ?? []);
    for (const f of fileSet) {
      if (!byFile.has(f)) issues.push({ kind: 'empty-file', where: f, detail: '该文件在台账里没有任何探针点（整文件漏插？）' });
    }
    const head =
      `=== Observe 插桩体检 [${lintRoot}] ===\n` +
      `台账：${sites.length} 探针点 · ${byFn.size} 个函数 · ${byFile.size} 个文件\n` +
      `检查：① 每函数恰一条 enter、至少一条 exit（缺=漏插；enter>1=撞名） ② 同一目录跨文件撞名 ③ 不得有"零探针文件"\n` +
      // ★★★ T299（2026-10-14，第 3 轮实测的量具边界）：**必须说清它看不见什么** ——
      //   实测 `gp1-r3v-mini`（`go build` **退 1**、编译不过）跑 lint 却报「✓ 不变量全过」。
      //   ⇒ 因为 lint 只读**探针台账**（"注入了什么"），而"注入后还能不能编译/跑"它**结构上看不见**。
      //   ★ 不说清就会被误当成"全绿" ⇒ 本仓最反对的"沉默的缺失"。
      `★ 边界：本体检只覆盖**结构类**（名字/配对/覆盖）；**编译 / 运行 / 取值时机 / 序列化 / 事件顺序**它看不见 ⇒ 那几类要靠 go build / tsc / 端到端。\n`;
    if (issues.length === 0) {
      return { message: `${head}✓ 不变量全过。\n  ★ **但"全过"只说明【结构类】没问题** —— 编译不过 / 跑不起来 / 取值时机错 / 序列化丢事件 等**都看不见**（实测：一个 go build 退 1 的夹具，本体检照样报"全过"）⇒ 那几类必须靠 go build / tsc / 端到端。`, data: { root: lintRoot, issues: [], checked: { fns: byFn.size, files: byFile.size } } };
    }
    const body = issues
      .map((it, i) => `  ${i + 1}. [${it.kind}] ${it.where}\n     ${it.detail}`)
      .join('\n');
    return {
      message: `${head}✗ 发现 ${issues.length} 个结构问题：\n${body}\n  ★ 这些是**结构类**（名字/配对/覆盖）；运行时问题（取值时机/序列化/顺序）不在此列。`,
      data: { root: lintRoot, issues, checked: { fns: byFn.size, files: byFile.size } },
    };
  }

  if (a.action === 'ledger') {
    const ledgerRoot = target; // 已在入口归一为绝对路径（原先这里再 resolve 一次 —— 同一件事写两处）
    const ledger = loadProbeLedger(ledgerRoot);
    if (!ledger) {
      return {
        message: `=== Observe 探针台账 [${ledgerRoot}] ===\n未找到台账（可能从未插桩，或已一键全拔清理）。`,
        data: { root: ledgerRoot, ledger: null, summary: null },
      };
    }
    const summary = ledgerSummary(ledger);
    const lines = [
      `=== Observe 探针台账 [${ledgerRoot}] ===`,
      `插桩时间：${ledger.instrumentedAt}`,
      `统计：${summary}`,
      '── 明细（探针点）──',
      ...ledger.sites.map(
        (s) => `  ${path.relative(ledgerRoot, s.file) || s.file} L${s.line} [${s.kind}/${s.level}] ${s.injected.trim().split('\n')[0]}`,
      ),
    ];
    return { message: lines.join('\n'), data: { root: ledgerRoot, ledger, summary } };
  }

  const unintrument = a.action === 'uninstrument' || a.action === 'restore';
  const dryRun = a.dry_run === true || a.dry_run === 'true' || a.dry_run === '1';
  const projectRoot = a.project_root as string | undefined;
  // 契约模式：contract_probes 非空数组时只注入声明的探针点；缺省/空数组 → 探索模式全量插桩
  const contractProbes = Array.isArray(a.contract_probes) && a.contract_probes.length > 0
    ? (a.contract_probes as string[])
    : undefined;

  // ★ 2026-10-05：语言分派从**硬编码的 `if (isGoProject(target))`** 改成**语言包注册表**
  //   （`infrastructure/analysis/observe/observe_langs.ts`），本 handler 退化成**薄壳**：挑包 → 调包 → 一份渲染。
  //   原先这里是两段 ~35 行、**结构逐字相同**的报告渲染（Go 分支 / TS 分支），加第三门语言就得再抄一遍。
  //   挑包判据照 `refactor_langs`：`manifest` 优先（`package.json` vs `go.mod`），判不出再退到「有该语言源文件」。
  // ★★★ T278（2026-10-14）：**`target` 传【文件】时必须响亮且准确** ——
  //   实测：传 `…/async_arrow.ts` ⇒ `pick()` 判不出语言包 ⇒ 落到下面那句
  //   「未找到匹配 …的观察语言包」⇒ ★★ **误导**（用户会以为"这门语言不支持"，
  //   其实是"target 该传目录"）；而且返回 `[]`、**退出码 0**、**不报错** = 静默空结果。
  try {
    if (fs.existsSync(target) && fs.statSync(target).isFile()) {
      return {
        message:
          `\`target\` 必须是【目录】，你传的是【文件】：${target}\n` +
          `  ⇒ 插桩按语言包**扫描整个项目**；要只处理这一个文件，请传它所在的项目目录。`,
        data: [],
      };
    }
  } catch {
    /* stat 失败 ⇒ 交给下面原来的判据（不吞成"没问题"） */
  }

  const pack = observeLangs.pick(target);
  if (!pack) {
    const known = observeLangs.list().map((p) => `${p.lang}(${p.label})`).join('、');
    return {
      message:
        `未找到匹配 \`${target}\` 的观察语言包 —— 目标项目里既没有已登记的 manifest，也没有已知语言的源文件。\n` +
        `  已注册：${known}\n` +
        `  ⇒ 要支持新语言：在 \`infrastructure/analysis/observe/observe_langs.ts\` 注册一个 \`ObserveLangPack\`。`,
      data: [],
    };
  }

  try {
    if (unintrument) {
      const rep = await pack.uninstrument(target);
      return { message: renderUninstrumentReport(rep), data: rep };
    }
    const rep = await pack.instrument(target, {
      dryRun,
      projectRoot,
      contractProbes,
      scope: a.scope === true,
      deep: a.deep === true,
      effects: a.effects === true,
    });
    return {
      message: renderInstrumentReport(rep, { target, contractProbes }).join('\n'),
      data: { report: rep, ledger: rep.ledger?.raw },
    };
  } catch (e) {
    // ★ 包自己已经**响亮失败**过了（Go 缺工具链 / 目录不存在）⇒ 这里只补一句是哪个语言包，不吞、不改写。
    return { message: `Observe 插桩失败（语言包 ${pack.lang}）：${(e as Error).message}`, data: {} };
  }
});

/** observe_judge：对一批事件执行偏差判定。decls（可选）提供时额外执行 P2 链路契约判定——
 * 重建实测调用链（trace 三元组）+ Comparator 全量对比（探针级 + 链路级），
 * 链路断裂（chain-broken）带 trace_id 与实测窗口。不传 decls 保持逐事件判定。
 * ★ 刻意保留 `wrap`（2026-09-29 逐处复核，**这条最容易被误迁**）：
 *   本 handler 的 message 在**缺省模式下就是判定结果的 JSON 全文**（`JSON.stringify(merged)`，
 *   见下方 `text` 的三元式）⇒ `data: merged` 与 message **逐字重复**，
 *   迁 `wrapData` 只会把同一份 JSON 打两遍（回执体积翻倍、零信息增量）——
 *   正是「data 会重复 message」应当保留 `wrap` 的那一类。
 *   ★ 如实记下残余缺口：`text=true` 时 message 是**人读散文**（renderJudgeReport / renderTSDiffReport），
 *     此时结构化的 `merged` 只有散文可达。要补它需要一个"**按参数条件输出 data**"的通道
 *     （缺省模式不输出 data）——那会让静态门（G11）记一笔"已迁 wrapData"而缺省模式实际仍无 `---DATA---`，
 *     属**刷假账**，故不做；此缺口在此登记，留给"回执通道按需选档"那一笔统一处理。 */
export const observeJudgeHandler = wrap(async (a) => {
  const events = a.events;
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('observe_judge 需要 events 参数：传要判定的事件数组（符合 TSEvent 形状）。');
  }
  const { events: norm, error } = normalizeEvents(events);
  if (error) throw new Error(error);
  const useLlm = a.use_llm === true || a.use_llm === 'true' || a.use_llm === '1';

  // ★ 2026-10-06（P5）：**decls 的计算从"判定之后"上移到"判定之前"**。
  //   原因：逐事件判定现在要扣掉"已被设计承认的耦合"（known-spread 声明，见 `judge.ObserveRuleCtx`），
  //   而那份"已承认耦合"表只能从 decls 折叠出来。原先顺序是"先判定、后算 decls"
  //   ⇒ 扣减**永远拿不到输入**（功能形同不存在）。顺序换过后，下面 `report` 一并带上 `judgeCtx`。

  // ★ 2026-10-05：设计对比的 decls **默认从项目自己的 dsl.json 读**，不必由调用方自带。
  //
  //   为什么加这个（这是"LLM 想知道哪里没纳入设计"这条路能通的前提）：
  //     此前只有 Go 的 `observe-dsl show` 能读 `dsl.json`，**TS 侧没有任何工具读它**
  //     （`DesignDSLStore` 只被 `run_loop` / `approve_gated` 用，没暴露给任何 handler）
  //     ⇒ 而 `decls` 是**入参** ⇒ LLM 要问"哪些探针还没被设计覆盖"必须**先知道 DSL 里有什么**，
  //       那时它无从得知 ⇒ 这条路是**断的**（P4 收尾时发现，此前误判为"搬过来就等价"）。
  //
  //   判据（照 `requireProjectRoot` 的既定纪律 `storage.ts:92-100`）：
  //     · **显式 `project_root`**，**故意不兜底到 cwd** —— cwd 是"另一个项目"，不是"更弱的答案"（原文）
  //     · 显式传 `decls` ⇒ 用它（要对着假设的声明集判，就显式传）
  //     · 两者都没给 ⇒ **保持逐事件判定**，但**如实说明**为什么没做设计对比 + 怎么开启
  const explicitDecls = Array.isArray(a.decls) && a.decls.length > 0 ? (a.decls as TSDLDecl[]) : undefined;
  let decls = explicitDecls;
  let declsNote = '';
  if (!decls) {
    const root = typeof a.project_root === 'string' && a.project_root.trim() ? a.project_root.trim() : '';
    if (!root) {
      declsNote =
        '\n⚠ 未做设计对比：没传 decls 也没有 project_root。要对比"哪些探针还没纳入设计"，' +
        '传 project_root（会自动读 <root>/.agent/observe/dsl.json）或直接传 decls。' +
        '（本轮只做了逐事件规则判定。）';
    } else {
      const loaded = new DesignDSLStore(defaultDSLDir(root)).load();
      if (loaded && loaded.decls.length > 0) {
        decls = loaded.decls;
        declsNote = `\ndecls 来源：<${root}>/.agent/observe/dsl.json（v${loaded.version}，${loaded.decls.length} 条声明）`;
      } else {
        declsNote =
          `\n⚠ 未做设计对比：<${root}>/.agent/observe/dsl.json ${loaded ? '是空的' : '不存在'}。` +
          '（本轮只做了逐事件规则判定。要建声明先跑一次 loop，它会播种 v1 种子。）';
      }
    }
  } else {
    declsNote = '\ndecls 来源：调用方显式传入';
  }

  // 声明侧上下文：`decls` 为 undefined（既没传 decls、也没给 project_root）⇒ **不给 ctx**
  // ⇒ 规则按原样判、并在文案里**明说"未扣已承认耦合"**（不静默当作"无已承认耦合"处理）。
  const judgeCtx: ObserveRuleCtx | undefined = decls
    ? { acknowledgedSpreads: knownSpreadIndex(decls) }
    : undefined;

  const report = useLlm ? await judgeEventsWithLLM(norm, true, judgeCtx) : judgeEvents(norm, judgeCtx);

  // P2 链路契约：decls 可得时重建实测链 + Comparator 全量对比（探针级 + 链路级）
  let diff: TSDiffReport | undefined;
  let chainsNote = '';
  if (decls && decls.length > 0) {
    const { chains, dropped } = rebuildChains(norm);
    const comp = new TSComparator();
    diff = comp.compare(
      { version: 1, updated_at: new Date().toISOString(), decls },
      TSComparator.aggregate(norm),
      chains,
    );
    chainsNote = `\n链路重建: ${chains.length} 条链${dropped > 0 ? `（超预算丢弃 ${dropped} 条）` : ''}`;
  }

  const merged = diff ? { ...report, diff, decls_source: declsNote.trim() } : { ...report, decls_source: declsNote.trim() };
  const text = a.text === true || a.text === '1'
    ? renderJudgeReport(report) + (diff ? `\n\n${renderTSDiffReport(diff)}${chainsNote}` : '') + declsNote
    : JSON.stringify(merged);
  return { message: text, data: merged };
});

// ─────────────────────────────────────────────────────────────
// Observe 观测工具 handler（设计→开发→测试闭环的「测试」端）
// 与 design 主工具并列同一套 MCP。底层复用 observe/* 纯函数，不重写逻辑。
// ─────────────────────────────────────────────────────────────

/** observe_log：按文件/全量查询 Observe 运行日志（复用 queryObserveLog）。
 * ★ wrapData：结构化 entries 由**通道**附带 `---DATA---`（原先手写在 message 里，现交给包装器，输出字节等价）。 */
export const observeLogHandler = wrapData(async (a) => {
  const eventsFile = a.events_file as string | undefined;
  if (!eventsFile) {
    throw new Error('observe_log 需要 events_file 参数：传 Observe 事件文件路径（events.jsonl）。');
  }
  const files = Array.isArray(a.files) ? (a.files as string[]).filter(Boolean) : [];
  const all = a.all === true || a.all === 'true' || a.all === '1';
  const r = queryObserveLog(eventsFile, { files, all });
  const lines = [
    `Observe 日志 [${r.eventsPath}]`,
    `  事件 ${r.total} · 偏差 ${r.anomalyCount} · 跳过 ${r.skipped} · 返回 ${r.entries.length} 条`,
    // ★ 2026-10-06（T41 ②）：**"文件不存在"与"存在但无匹配"必须分开说** ——
    //   原先两者都打「（无匹配事件）」⇒ 会把"传错路径"伪装成"跑过了、没内容"。
    ...(r.missing
      ? [`  ⚠ 事件文件不存在：${r.eventsPath}（★ 这不是"无匹配事件"—— 这个文件压根不在；请检查 events_file）`]
      : r.entries.length === 0
        ? ['  （无匹配事件）']
        : []),
  ];
  for (const e of r.entries) {
    const mark = e.result === 'deviation' ? '✗' : '✓';
    lines.push(`  ${mark} [${e.result}] ${e.probe}${e.file ? ` (${e.file})` : ''} rule=${e.rule}`);
    lines.push(`      ${e.reason}`);
  }
  // 附完整结构化数据供 LLM 继续分析（由 wrapData 通道追加，不再手写；见上注释）
  return { message: lines.join('\n'), data: r.entries };
});

/** observe_trace：读录制调用链 → 采样 → 返回结构化调用树（面向 LLM 的纯后端回放）。
 * 不给 trace_id 时返回链路清单（供 LLM 挑）；给 trace_id 展开该针完整调用树文本+数据。 */
export const observeTraceHandler = wrapData(async (a) => {
  const cfg = {
    events_path: typeof a.events_path === 'string' && a.events_path ? a.events_path : undefined,
    events_text: typeof a.events_text === 'string' && a.events_text ? a.events_text : undefined,
    keep: (a.keep === 'all' ? 'all' : 'default') as 'all' | 'default',
    trace_id: typeof a.trace_id === 'string' && a.trace_id ? a.trace_id : undefined,
    limit: typeof a.limit === 'number' ? a.limit : undefined,
  };
  const r = observeTrace(cfg);
  return { message: r.message, data: r.data };
});

/**
 * reconcile_chain：中观档——按「文件/宿主节点」一条命令的真跑 + 查数据 + 对账。
 * 后工具自动前置：宿主下无 detail 链时自动调用 deriveDetailChain（缓存判断——已有链即跳过），
 * 再自动发现事件文件、按链文件过滤真跑事件、逐事件判定、重建实测链、链路契约匹配。
 */
export const reconcileChainHandler = wrapData(async (a) => {
  const input = a as unknown as ReconcileChainInput;
  if (!input.feature || !input.node_id) {
    throw new Error('reconcile_chain 需要 feature + node_id：指定宿主文件节点（detail 链挂在它下面）做中观档对账。');
  }
  const r = await reconcileChain({
    feature: String(input.feature),
    node_id: String(input.node_id),
    project_dir: requireProjectRoot({ project_dir: input.project_dir }),
    events_files: Array.isArray(input.events_files) ? (input.events_files as string[]) : undefined,
    force: input.force === true,
    max_steps: typeof input.max_steps === 'number' ? input.max_steps : undefined,
  });
  return { message: r.message, data: r };
});
