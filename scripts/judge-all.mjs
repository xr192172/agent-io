#!/usr/bin/env node
/**
 * 跑**全部册**的节点级判据（`design_line action=judge`），汇总成一道门。
 *
 * ## 为什么需要这个脚本（而不是直接写进 verify.mjs）
 * 判据的**唯一执行核**是 CLI 的 `design_line action=judge`；这里只做「遍历册 + 汇总 + 退出码」，
 * 不重实现判定 —— 否则就是第二把尺。
 *
 * ## 为什么它该是门（判据此前**没有任何自动门在跑**）
 * 判据是设计册对代码的断言（"这个文件必须做到 X"）。在它进 `verify` 之前：
 * 判据红了**也拦不住提交**，等于那些断言只在有人手动跑 `design_line` 时才存在
 * （★ 条数由本脚本自己打印 —— **别在这里抄数字**，抄一次漂一次）。
 * ★ 它比人**多抓**的东西很具体：改了实现使某条断言不再成立 —— `tsc` 一声不响（那是"值"不是"形状"）。
 *
 * ## ★★★ 口径只许一处：**本仓的册 = `<cwd>/.agent-io/design/*.dsl.json`**
 * 不变量：本脚本的册清单**只**来自这一层目录，**不看** `project_registry` / `getDesignSheetFile` 的解析结果。
 * · 为什么必须钉死：CLI 的 feature 枚举走「注册表（`feature → 项目根`）→ 数据家旧目录」两步，是**跨项目**的
 *   （`src/infrastructure/storage.ts#listDesignSheets`）⇒ 同一个问题有两个答案：
 *   本脚本数出的是**本仓 3 册**，而"逐 feature 求和"把**别的项目**（如 `review-hub`）的册一起加了进来
 *   ⇒ 分母混了：那个项目的增长会被算成"我们的增长"，而且两边结论可能相反（这边全绿、那边报红）。
 * · 所以：本仓读数只用上面那一条路径；别项目的册**既不静默计入，也不静默跳过** —— 见下面两条。
 *
 * ## 跨项目必须**显式**（`--include-external <项目根>`，可重复）
 * · 不给参数 ⇒ 一个外部册都不看；
 * · 给了 ⇒ 外部册**单列**（自己的标签、自己的汇总行），并在输出顶部**大字标注**「本数含外部项目：<名字>」；
 * · ★ 对外只报**一个**数：本仓判据数。外部的数永远另起一行、另起标签 —— 否则又是分母混了。
 * · 参数名只此一个；本脚本不接受别的参数（未知参数直接拒，别静默忽略）。
 *
 * ## 退出码
 * 任一册（本仓或显式纳进来的外部册）出现 `fail` 或 `unsupported` ⇒ 1（`unsupported` 也是失败：
 * "判不了 ≠ 通过"，见 AGENTS-RULES 0.12 与 GUIDE-GATE 四态）。
 * ★ 显式要了外部册，就得看见它的红 —— 所以外部红同样置 1；但**汇总行仍只报本仓数**。
 *
 * ## ★ dist 比 src 旧 ⇒ 同样判红（**判据可能判在旧代码上**）
 * 不变量：**跑判据之前先无条件验一次 dist 新鲜度**；不新鲜就红，且一条判据都不跑。
 * · 为什么是"红"而不是"警告一句再照旧 exit 0"：整批跑在旧代码上时，`pass` 是**旧代码的读数** ——
 *   它与"判据真的成立"在输出上长得一模一样（AGENTS-RULES 0.12：失败必须与「没有」可区分）；
 * · 为什么"无条件"：只在 `unsupported > 0` 时才查（`domain/stale_verdict.ts#staleJudgeCaveat` 的不变量）
 *   漏掉最糟的一态 —— **整轮都 pass** 时恰恰不查 ⇒ "判在旧代码上"零提示；
 * · 判据实现**不另造**：委派 `src/application/observe/runtime/stale_check.ts#checkStaleBuild`
 *   （与 MCP 的 `STALE_SOURCE` 告警、`verify` 的 MCP 门同一把尺），扫 `src/` 全树，不限子目录。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ★★★ 2026-11-01（外审：判据闸「判红了」与「压根没判」在退出码上不可分 —— 0.12 同族）：
//   **退出码从此是三态**（下游必须分开处理，别把 2 当成 1）：
//     0 = 全部册都判过，且 0 红
//     1 = **判出了红**（某册有 fail / unsupported / 该册 0 条 / 判的不是这一份册）
//     2 = **压根没判**（找不到 dist · dist 比 src 旧 · 新鲜度没验全 · 找不到册 · 总计 0 条）
//   ⇒ 2 的含义是「这次运行没有产出任何可信读数」，把它当"通过"或当"判红"都是错的。
const ROOT = process.cwd();
/** 本脚本自己所在的仓 —— **尺子的出处**。与 `ROOT` 分开：`ROOT` 是**被检查的**项目 */
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'dist', 'src', 'presentation', 'cli', 'cli.js');
/** ★ 本仓口径的**唯一锚**：只数这一层（见文件头「口径只许一处」） */
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const DATA_MARK = '---DATA---';
const USAGE = 'node scripts/judge-all.mjs [--include-external <项目根>]…';

/** 判据读不全就停：本脚本**不接受**除「显式外部」以外的参数（多一个入口 = 多一处口径） */
function fail(msg) {
  console.error(`✗ ${msg}\n  用法：${USAGE}`);
  process.exit(2);
}

/** 只认 `--include-external <dir>`（可重复）。缺省 = 不纳任何外部册。 */
function parseArgs(argv) {
  const externals = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--include-external') fail(`未知参数 ${argv[i]}（本脚本只接受 --include-external <项目根>）`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) fail('--include-external 后面必须跟**项目根**（如 D:/agentio/dev/review-hub）');
    externals.push(v);
    i++;
  }
  return { externals };
}

/** 某一目录下的册名（唯一枚举实现 —— 本仓与外部共用，不写第二份 readdir 口径） */
function listSheets(designDir) {
  if (!fs.existsSync(designDir)) return [];
  return fs
    .readdirSync(designDir)
    .filter((f) => f.endsWith('.dsl.json'))
    .map((f) => f.slice(0, -'.dsl.json'.length))
    .sort();
}

/**
 * `--include-external` 的入参解析：给项目根 `<p>/.agent-io/design` 里有册就用它；
 * 也可以直接给册目录 `<p>/.agent-io/design`。**给错就停**（读不到 ≠ 没有，0.12）。
 */
function resolveExternal(arg) {
  const abs = path.resolve(ROOT, arg);
  const nested = path.join(abs, '.agent-io', 'design');
  if (listSheets(nested).length) return { label: path.basename(abs) || abs, projectRoot: abs, designDir: nested };
  if (listSheets(abs).length) {
    const projectRoot = path.dirname(path.dirname(abs));
    return { label: path.basename(projectRoot) || abs, projectRoot, designDir: abs };
  }
  return fail(
    `--include-external ${arg}：找不到它的册（既没有 ${path.join(abs, '.agent-io', 'design')}/*.dsl.json，也不是一个册目录）` +
      ' ⇒ 读不到 ≠ 没有（0.12）',
  );
}

/**
 * `---DATA---` 之后的那个顶层 JSON 值（括号配对截取；字符串里的括号要跳过）。
 * ★ 两种顶层形状都要认：`design_line` 回**对象**，`get_dsl query=features` 回**数组** ——
 *   只认 `{` 的那种写法会让后者静默解析失败（实测：诊断走了"查不到 CLI 册库"那一支）。
 */
function parseDataBlock(out) {
  const i = out.indexOf(DATA_MARK);
  if (i < 0) return null;
  const s = out.slice(i + DATA_MARK.length);
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = start; k < s.length; k++) {
    const ch = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, k + 1);
    }
  }
  return null;
}

/** 跑一次 CLI，返回 `---DATA---` 之后的原始 JSON 文本与进程状态 */
function runCli(toolName, payload) {
  // ★ shell:false + process.execPath：路径含空格时经 cmd.exe 会被截断（见 verify.mjs 的 tsGate 注释）
  const r = spawnSync(process.execPath, [CLI, toolName, '--json', JSON.stringify(payload)], {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { out: `${r.stdout ?? ''}${r.stderr ?? ''}`, status: r.status };
}

/**
 * 判**一个目标的一册**。`target` = { label, projectRoot, designDir }：
 * 本仓的 target 由 `DESIGN_DIR` 造，外部的由 `resolveExternal` 造 —— 判定路径完全共用。
 */
function judgeOne(feature, target) {
  // ★ `project_dir` 传**绝对路径**（不传 `'.'`）：门的输入不许是环境态（cwd），见 AGENTS-RULES 0.12 第 2 条。
  const { out, status } = runCli('design_line', { project_dir: target.projectRoot, feature, action: 'judge' });
  // ★★★ 2026-10-31（第四轮独立复核抓到）：原来用 `"verdict":"pass"` 数个数、用 **400 字符窗口正则**抓
  //   `fail|unsupported` 的 node_id。两个毛病：① 计数靠字符串出现次数（detail 里出现一次就多算）；
  //   ② 400 字符窗口跨条目时会**张冠李戴**（归属到隔壁节点的 id）⇒ 报出来的"哪条红了"不可靠。
  //   现在改成**读 CLI 的结构化回执**：`---DATA---` 之后是一段干净 JSON（`tally` + `items[]`）。
  //   取不到可解析的 DATA 块 ⇒ **判这一册红**（0.12：读不到 ≠ 没有），不回落成"数个数"。
  // ★ 取结构化回执：`---DATA---` 之后是**一行 JSON**，再往后可能还有 `⚠️ STALE_INDEX：…` 这类**散文警告**
  //   （实测：JSON 与 `---WARNINGS---` 之间夹着警告正文）⇒ 不能用"到下一个标记为止"的懒惰正则，
  //   必须按**括号配对**把那个顶层对象截出来（`parseDataBlock`）。
  const dataBlock = parseDataBlock(out);
  let rec = null;
  if (dataBlock) {
    try {
      rec = JSON.parse(dataBlock);
    } catch {
      rec = null;
    }
  }
  if (!rec || !rec.tally || !Array.isArray(rec.items)) {
    return { feature, pass: 0, fail: 0, unsupported: 0, bad: [], ok: false, unparsed: true };
  }
  // ★★★ 2026-10-31（第六轮独立复核抓到）：**两根没钉在一起**。
  //   本脚本从 `ROOT/.agent-io/design` 发现册，但**判据是 CLI 从它自己的注册表读的**
  //   （`AGENT_IO_HOME` 或包安装根）。两根不一致时：副本里把某册判据清空，CLI 仍读真仓 ⇒ 门报 `pass=1` **绿**。
  //   ⇒ 必须有一条事实能证明「读的是这一份册」，否则判该册红（0.12：读的不是我以为的那份 ⇒ 不算通过）。
  // ★★★ 2026-11-01（subagent:portable-anchor）：**这条事实是 `sheet`，不是 `root`**。
  //   不变量：`rec.root` 从这天起 = judge 的路径锚 = **调用方给的 `project_dir`**
  //   （`src/application/design/index.ts` 的 action=judge 不再取 `dsl.source_root`：册里存的是写册那台机器的
  //   绝对路径，换机器后判据全部指向不存在的文件）。⇒ `rec.root` 恒等于本脚本传的 `project_dir`，
  //   **拿它当守卫等于恒过**（0.9：两把尺只能删第二把）。唯一能证明「读的是这一份册」的事实 = 回执里的 `sheet`。
  //   老 CLI / 旧 dist 没有这个字段 ⇒ **判红**（读不到 ≠ 通过），不许静默放行。
  // ★ 2026-11-03（T-#JUDGEALL-CROSS-PROJECT）：`wantSheet` 现在跟着 `target.designDir` 走 ——
  //   外部册判的必须是**它自己那份**，理由同一条：读的不是我以为的那份 ⇒ 不算通过。
  const normRoot = (s) => path.resolve(String(s ?? '')).replace(/\\/g, '/').toLowerCase();
  const wantSheet = path.join(target.designDir, `${feature}.dsl.json`);
  if (!rec.sheet || normRoot(rec.sheet) !== normRoot(wantSheet)) {
    return {
      feature,
      pass: 0,
      fail: 0,
      unsupported: 0,
      bad: [],
      ok: false,
      sheetMismatch: `CLI 判的册 = ${rec.sheet ?? '(回执里没有 sheet 字段)'}，与本次检查的 ${wantSheet} 不是同一份`,
    };
  }
  const tally = rec.tally ?? {};
  const bad = rec.items
    .filter((it) => it.verdict === 'fail' || it.verdict === 'unsupported')
    .map((it) => `${it.verdict}:${it.node_id}${it.expectation?.kind ? `(${it.expectation.kind})` : ''}`);
  return {
    feature,
    pass: tally.pass ?? 0,
    fail: tally.fail ?? 0,
    unsupported: tally.unsupported ?? 0,
    bad,
    ok: status === 0,
  };
}

/** 逐册判 + 打印 + 汇总（本仓与外部**同一段代码**，差别只在标签与前缀） */
function judgeBooks(features, target, prefix) {
  let bad = 0;
  let totalPass = 0;
  let totalJudged = 0;
  for (const f of features) {
    const r = judgeOne(f, target);
    totalPass += r.pass;
    const judged = r.pass + r.fail + r.unsupported;
    totalJudged += judged;
    // ★★ 2026-10-31（第四轮独立复核抓到）：原来只有**跨册求和**的「判了 0 条」守卫 ⇒
    //   **单册判据被清空**时，只要别册还有料就照绿。每册必须自己判过东西。
    const emptyBook = judged === 0;
    const isBad = r.fail > 0 || r.unsupported > 0 || !r.ok || emptyBook;
    if (isBad) bad++;
    const mark = isBad ? '✗' : '✓';
    console.log(
      `  ${prefix}${mark} ${f.padEnd(22)} pass=${String(r.pass).padEnd(4)} fail=${String(r.fail).padEnd(2)} unsupported=${r.unsupported}` +
        (r.sheetMismatch
          ? `  ← ★ ${r.sheetMismatch}（册不重合 ⇒ 这册的读数不算数）`
          : r.unparsed
            ? '  ← ★ CLI 回执里没有可解析的 `---DATA---` 块（读不到 ≠ 通过）'
            : emptyBook
              ? '  ← 该册一条判据都没判到（≠ 通过）'
              : ''),
    );
    for (const b of r.bad.slice(0, 5)) console.log(`       ${prefix}· ${b}`);
    if (r.bad.length > 5) console.log(`       ${prefix}· …另有 ${r.bad.length - 5} 条`);
  }
  return { books: features.length, judged: totalJudged, pass: totalPass, bad };
}

const { externals: extArgs } = parseArgs(process.argv.slice(2));

if (!fs.existsSync(CLI)) {
  console.error(`✗ 找不到 ${path.relative(ROOT, CLI)} ⇒ 先 npm run build（本门与「MCP 工具签名」同一前提）`);
  process.exit(2);
}

// ════════════════════════════════════════════════════════════════════
// ★★★ dist 新鲜度：**无条件先判一次**（判据可能判在旧代码上 —— 见文件头那段不变量）
//   委派唯一实现 `stale_check#checkStaleBuild`（不另造一把尺）；扫 `src/` 全树。
//   读不到尺子 / 尺子抛错 ⇒ 红（0.12：读不到 ≠ 新鲜），不许跳过。
// ════════════════════════════════════════════════════════════════════
const STALE_MOD = path.join(TOOL_ROOT, 'dist', 'src', 'application', 'observe', 'runtime', 'stale_check.js');
let fresh = null;
let freshErr = '';
try {
  const mod = await import(pathToFileURL(STALE_MOD).href);
  if (typeof mod.checkStaleBuild !== 'function') freshErr = `${path.relative(TOOL_ROOT, STALE_MOD)} 里没有 checkStaleBuild 导出`;
  else fresh = mod.checkStaleBuild(ROOT);
} catch (e) {
  freshErr = `读不到/跑不了 ${path.relative(TOOL_ROOT, STALE_MOD)}：${e?.message ?? String(e)}`;
}
if (!fresh) {
  console.error(
    `✗ 无法判定 dist 是否比 src 新：${freshErr}\n` +
      '  ⇒ 判据可能判在旧代码上，本门**不敢放行**（读不到 ≠ 新鲜）。先 npm run build 再跑。',
  );
  process.exit(2);
}
/** mtime → `HH:MM:SS`（与 `stale_check#formatStaleText` 同一口径，不另造一套渲染） */
const hhmmss = (ms) => (ms > 0 ? new Date(ms).toISOString().slice(11, 19) : '缺产物');
if (fresh.stale) {
  const first = fresh.entries[0];
  console.error(
    `✗ ★ dist 比 src 旧（src ${hhmmss(first.srcMtime)} vs dist ${hhmmss(first.outMtime)}；` +
      `checkStaleBuild 报 ${fresh.entries.length}/${fresh.scanned} 个源未重建，basis=${fresh.basis}）` +
      '⇒ 判据可能判在旧代码上；先 npm run build，再跑本门。',
  );
  for (const e of fresh.entries.slice(0, 10)) {
    console.error(`     · ${e.src} → ${e.missing ? '缺产物' : `产物旧(源 ${hhmmss(e.srcMtime)} vs 产物 ${hhmmss(e.outMtime)})`}`);
  }
  if (fresh.entries.length > 10) console.error(`     · …另有 ${fresh.entries.length - 10} 个`);
  console.error('  —— 本门**一条判据都没跑**（判在旧代码上的读数没有意义；这不是通过）');
  process.exit(2);
}
if (fresh.skipped.length > 0) {
  // ★ 0.12 ③：分母两半同时给。有源读不到 ⇒ 新鲜度只验了一部分 ⇒ 不许当"dist 最新"放行
  console.error(
    `✗ dist 新鲜度没验全：扫到 ${fresh.scanned} 个手写源，其中 ${fresh.skipped.length} 个读不到` +
      `（验了 ${fresh.scanned - fresh.skipped.length} 个 ⇒ 剩下那些**可能**正比 src 旧）⇒ 这不是「dist 最新」（0.12）。`,
  );
  for (const s of fresh.skipped.slice(0, 5)) console.error(`     · 未验 ${s.src}（${s.reason}）`);
  process.exit(2);
}
console.log(`  ✓ dist 不比 src 旧（checkStaleBuild：${fresh.scanned} 个手写源均已重建，basis=${fresh.basis}）`);

// ════════════════════════════════════════════════════════════════════
// 口径：本仓的册**只**来自 DESIGN_DIR（钉死，见文件头）
// ════════════════════════════════════════════════════════════════════
const list = listSheets(DESIGN_DIR);
if (!list.length) {
  // ★ 0.12：读不到册不许当"全部通过"
  console.error(`✗ ${path.relative(ROOT, DESIGN_DIR)} 下没有任何 *.dsl.json ⇒ 无法判定（这不是通过）`);
  process.exit(2);
}

/**
 * 显式外部册：每个目录各判各的；与仓内同名 ⇒ **停**（同名 = 口径不可区分，不猜）。
 */
const externals = extArgs.map(resolveExternal);
const repoSet = new Set(list);
const seenNames = new Map(list.map((f) => [f, '本仓']));
for (const ext of externals) {
  ext.features = listSheets(ext.designDir);
  if (!ext.features.length) fail(`--include-external ${ext.label}：${ext.designDir} 下没有任何 *.dsl.json（读不到 ≠ 没有）`);
  for (const f of ext.features) {
    if (seenNames.has(f)) {
      fail(
        `--include-external ${ext.label}：册名 "${f}" 与 ${seenNames.get(f)}的同名册**撞了** ⇒ ` +
          '同名两册无法区分口径，拒绝合并统计（请只在**一个**来源里判它）',
      );
    }
    seenNames.set(f, `外部 ${ext.label} `);
  }
}

// ════════════════════════════════════════════════════════════════════
// ★ 0.12：**别处还有册**这件事必须出声（既不静默计入，也不静默跳过）
//   唯一事实源 = CLI 自己的 feature 枚举（`get_dsl query=features`，走注册表 → 跨项目），
//   本脚本**不**另写一份注册表解析（0.9）。
// ════════════════════════════════════════════════════════════════════
const featOut = runCli('get_dsl', { query: 'features', project_dir: ROOT });
let cliFeatures = null;
try {
  const rec = JSON.parse(parseDataBlock(featOut.out) ?? 'null');
  if (Array.isArray(rec)) cliFeatures = rec.map((x) => x?.feature).filter((x) => typeof x === 'string');
} catch {
  cliFeatures = null;
}
if (!cliFeatures) {
  console.log(
    '  ⚠ 诊断：查不到 CLI 的册库（`get_dsl query=features` 没有可解析的 DATA 块）⇒ 无法判定本仓之外' +
      '是否还有别项目的册（读不到 ≠ 没有，0.12）',
  );
} else {
  const outside = cliFeatures.filter((f) => !repoSet.has(f));
  if (outside.length) {
    const shown = outside.slice(0, 12).join(', ') + (outside.length > 12 ? ` …另有 ${outside.length - 12} 册` : '');
    const included = outside.filter((f) => seenNames.has(f));
    console.log(
      `  ⚠ 诊断：CLI 的册库另登记了 ${outside.length} 册**不属于本仓**（其册住在本仓 .agent-io/design 之外）：${shown}`,
    );
    console.log(
      `      ⇒ 本仓读数**只数** ${path.relative(ROOT, DESIGN_DIR).replace(/\\/g, '/')}/*.dsl.json；这些册` +
        (included.length ? `里已被显式纳入的：${included.join(', ')}；` : '') +
        '既未计入本仓数，也未被静默跳过。',
    );
    console.log(
      '      ⇒ 要连它们一起判：显式加 `--include-external <该项目的根>`（外部数会**单列一行**并大字标注含外部）。',
    );
  }
}

if (externals.length) {
  console.log(
    `  ★★★ 本数含外部项目：${externals.map((e) => `${e.label}（${e.designDir.replace(/\\/g, '/')}）`).join('、')} ★★★`,
  );
  for (const ext of externals) {
    console.log(
      `      ⚠ 诊断：外部册 ${ext.designDir.replace(/\\/g, '/')} 在 dataHome（${path.join(ROOT, '.agent-io').replace(/\\/g, '/')}）` +
        ' 之外 ⇒ 只因显式 --include-external 被纳入；**下面本仓那行数不含它**。',
    );
  }
}

console.log(
  `  口径：本仓 = ${path.relative(ROOT, DESIGN_DIR).replace(/\\/g, '/')}/*.dsl.json（钉死；不看注册表 / 别的 data home）`,
);
const repo = judgeBooks(list, { label: '本仓', projectRoot: ROOT, designDir: DESIGN_DIR }, '');

// ★★★ 0.12 第 1 条：「判了 0 条」不许当「全部通过」。
//   实测过的两种死法（独立复核 2026-10-31 用临时副本复现）：
//   ① 册在盘上、但 CLI 的 dataHome 被 `AGENT_IO_HOME` 指到别处 ⇒ 看到 0 个 feature ⇒ 0 条判据 ⇒ 若只看
//      `fail>0` 就会 exit 0（**假绿**）；② 判据被人删空 ⇒ 同样 0 条 ⇒ exit 0。
//   `run-tests` 有这条断言（"0 个用例被执行"算红），本门原来没有 —— 现在补上。
if (repo.judged === 0) {
  console.error(
    `✗ 一条判据都没判到（盘上发现 ${list.length} 册：${list.join(', ')}）⇒ 这不是通过。\n` +
      `  常见原因：① \`AGENT_IO_HOME\` 指到了别的数据根 ⇒ CLI 看不到册；② 该册的判据被删空。\n` +
      `  排查：\`node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"features"}'\` 看 CLI 自己认几册。`,
  );
  process.exit(2);
}

console.log(`  —— ${repo.books} 册 / 判据 ${repo.judged} 条判过（${repo.pass} pass）/ ${repo.bad} 册有红`);

// ★ 外部册**单列**：自己的标签、自己的汇总行（对外只报一个数，第二个数必须另起标签）
let extBad = 0;
for (const ext of externals) {
  const r = judgeBooks(ext.features, ext, `[外部 ${ext.label}] `);
  extBad += r.bad;
  console.log(
    `  ★★ 外部项目 ${ext.label} —— ${r.books} 册 / 判据 ${r.judged} 条判过（${r.pass} pass）/ ${r.bad} 册有红` +
      '　（★ 这一行**不是**本仓的数）',
  );
}

process.exit(repo.bad || extBad ? 1 : 0);
