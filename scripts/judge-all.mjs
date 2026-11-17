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
// ★ 路径身份（软链/大小写/斜杠归一）：唯一实现——册身份守卫必须用它（见下方 wantSheet 注释）
import { samePath } from './lib/path_identity.mjs';
import { fileURLToPath, pathToFileURL } from 'node:url';
// ★ 重活排他锁（R75）—— 唯一实现在 `scripts/lib/heavy_lock.mjs`（verify / mutate / judge-all 共用一份）
import { acquireHeavyLock } from './lib/heavy_lock.mjs';

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

// ★★★ R75（2026-11-05）：**重活排他** —— 它与 `verify` / `mutate` 共享 `dist/` · `judge-cache.json` ·
//   `cache.db` · `design-db/`。本脚本是**顶层脚本**（下面有十来处 `process.exit`）⇒ 锁放在模块顶层，
//   释放挂在 `exit` 钩子上（`unlinkSync` 同步 ⇒ 钩子里可以跑）。
//   ★ 拿不到锁 ⇒ **退出码 2**（"本次没有产出可信读数"）—— 这正是本脚本既有的三态语义：
//     它**不是**判出红（1），也**不许**被当通过（0）。静默跳过会让人把"读不到"当"全绿"。
let releaseHeavyLock = null;
try {
  releaseHeavyLock = acquireHeavyLock(ROOT, { name: 'judge-all' });
  process.on('exit', () => {
    try {
      releaseHeavyLock?.();
    } catch {
      /* 释放失败不改结论 */
    }
  });
} catch (e) {
  console.error(`✗ judge-all 没法开始：${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const DATA_MARK = '---DATA---';
const USAGE =
  'node scripts/judge-all.mjs [--include-external <项目根>]… [--changed <路径>|@<清单文件>]…';

/** 判据读不全就停：本脚本**不接受**除「显式外部 / 显式选量」以外的参数（多一个入口 = 多一处口径） */
function fail(msg) {
  console.error(`✗ ${msg}\n  用法：${USAGE}`);
  process.exit(2);
}

/**
 * 只认两族参数：
 * · `--include-external <dir>`（可重复）—— 显式外部册（既有，语义不动）；
 * · `--changed <路径>` 或 `--changed @<清单文件>`（可重复）—— ★★ T-#INC-JUDGE-SEL（2026-11-17）**选量入口**。
 *   给了 ⇒ 只判「这些改动可能影响到的」判据（口径在 `domain/expectation.ts#selectExpectationsForChanged`）；
 *   **不给 ⇒ 全量**（向后兼容：既有调用方 `verify.mjs` / `judge-gate.yml` 一个字都不用改）。
 *
 * ## 为什么选量参数属于「脚本」而不属于「判定」
 * 判定核仍是 CLI 的 `design_line action=judge`（本脚本不重实现判定）；本脚本只负责
 * **把改动集翻译成 CLI 的参数**、**把回执里的分子/分母汇总成人读的一行**、**退出码**。
 * ⇒ 选量规则一处（domain）、入口一处（这里）、判定一处（CLI）。
 */
function readChangedList(spec) {
  // `@<file>`：一行一个路径（`#` 开头是注释、空行忽略）—— 改动集上千条时避开命令行长度上限。
  const file = path.resolve(ROOT, spec.slice(1));
  if (!fs.existsSync(file)) fail(`--changed @${spec.slice(1)}：清单文件不存在（读不到 ≠ 没有改动）`);
  return fs
    .readFileSync(file, 'utf-8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function parseArgs(argv) {
  const externals = [];
  /** `null` = 没要选量（全量）；数组（可能为空）= 要了选量（空 ⇒ 回落全量，见主流程） */
  let changed = null;
  for (let i = 0; i < argv.length; i++) {
    // ★ 基线上调旗标（见下方 :534 一段）—— 无值 flag，由 process.argv.includes('--write-baseline') 消费。
    //   2026-11-17 实测：这里此前把除 --include-external 外的一切都拒 ⇒ 上面的 --write-baseline 分支
    //   **永远不可达**（判据在、入口没接）。放行它，语义不变。
    if (argv[i] === '--write-baseline') continue;
    if (argv[i] === '--changed') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail('--changed 后面必须跟**仓库相对路径**（或 `@<清单文件>`）');
      const paths = v.startsWith('@') ? readChangedList(v) : [v];
      changed = [...(changed ?? []), ...paths];
      i++;
      continue;
    }
    if (argv[i] !== '--include-external') fail(`未知参数 ${argv[i]}（本脚本只接受 --include-external <项目根> / --changed <路径>`);
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) fail('--include-external 后面必须跟**项目根**（如 D:/agentio/dev/review-hub）');
    externals.push(v);
    i++;
  }
  return { externals, changed };
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
function judgeOne(feature, target, changed = null) {
  // ★ `project_dir` 传**绝对路径**（不传 `'.'`）：门的输入不许是环境态（cwd），见 AGENTS-RULES 0.12 第 2 条。
  // ★★ T-#INC-JUDGE-SEL：`changed` 只在**本仓 target** 上出现（外部项目的路径口径不同 ⇒ 那边恒全量，见主流程）。
  const payload = { project_dir: target.projectRoot, feature, action: 'judge', ...(changed ? { changed } : {}) };
  const { out, status } = runCli('design_line', payload);
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
    return { feature, pass: 0, fail: 0, unsupported: 0, bad: [], perKind: {}, ok: false, unparsed: true };
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
  // ★★ 2026-11-16（恢复事故）：册身份比较必须**物理路径归一**（realpath）。
  //   旧实现 `path.resolve` + 小写：仓在软链下工作时，CLI 回执的 `sheet` 是软链形态
  //   （`D:\agentio\...`）而本脚本的 `wantSheet` 由 `import.meta.url` 推出真实形态
  //   （`D:\Projects\ai\agentio\...`）⇒ 判不等 ⇒ 假红「册不重合 ⇒ 这册的读数不算数」，
  //   14 门里的判据门直接判 0 条。软链/大小写/斜杠都交给唯一实现 path_identity。
  const wantSheet = path.join(target.designDir, `${feature}.dsl.json`);
  if (!rec.sheet || !samePath(rec.sheet, wantSheet)) {
    return {
      feature,
      pass: 0,
      fail: 0,
      unsupported: 0,
      bad: [],
      perKind: {},
      ok: false,
      sheetMismatch: `CLI 判的册 = ${rec.sheet ?? '(回执里没有 sheet 字段)'}，与本次检查的 ${wantSheet} 不是同一份`,
    };
  }
  const tally = rec.tally ?? {};
  const bad = rec.items
    .filter((it) => it.verdict === 'fail' || it.verdict === 'unsupported')
    .map((it) => {
      const kind = it.expectation?.kind ? `(${it.expectation.kind})` : '';
      // ★★ T43：**原因必须跟在这一行上**。改前只有 `verdict:node_id(kind)`，读者拿不到
      //   「为什么判不了」；而 `design_line action=judge` 的 message 只打 fail、unsupported 一条不打
      //   ⇒ 两个面都看不到（完整 detail 只住在 `---DATA---.items[].detail`）。
      //   ★ detail 缺 ⇒ **明说**，不留白（0.12：读不到 ≠ 没有）。
      const why = firstSentenceOf(it.detail) || '（回执里没有 detail ⇒ 这条判不了没有原因可读）';
      return `${it.verdict}:${it.node_id}${kind} —— ${why}`;
    });
  // ★★★ 2026-11-03（M1a ③-2）：**per-kind 的「真判过」计数**（pass + fail，不含 pending / unsupported）。
  //   为什么要落这一份：`gen-db-check` 的「载体可达」若用 judge **收集**条数（`collectExpectations`），
  //   它对**每个** kind 都收 ⇒ 那一列永远不为 0 ⇒ 门永远不红（0.16 的镜像：不是永远亮，是**永远不亮**）。
  //   「判过」才是有牙的口径：收进来了却一条都没判出结论（全 pending / unsupported）⇒ 该 kind judged=0 ⇒ 门红。
  const perKind = perKindOf(rec.items);
  return {
    feature,
    pass: tally.pass ?? 0,
    fail: tally.fail ?? 0,
    unsupported: tally.unsupported ?? 0,
    pending: tally.pending ?? 0,
    bad,
    perKind,
    // ★★ 第⑨项（2026-11-10）：**逐条判定结果带出去** —— VerifiedSnapshot 的 contract 条目要从这里拿。
    //    （judgeOne 原来只聚合计数；条目字段 node_id/verdict/expectation 都在 rec.items 上，捎带零成本。）
    items: rec.items,
    // ★ T-#INC-JUDGE-SEL（2026-11-17）：CLI 的**选量读数**（只有选量模式才在回执里）。
    //   缺省 `null` = 本次是全量 —— 全量时**一律** null（不猜"没给就是全量选中"）。
    selection: selectionOf(rec.selection),
    ok: status === 0,
  };
}

/**
 * 校验 CLI 回执里的 `selection` 块（T-#INC-JUDGE-SEL）。
 *
 * 口径：拿不到可用的块 ⇒ `null`（= 本次无法判断是不是全量）。★ **不**拿 `items.length` 冒充 `total`：
 * "分母"必须由产出方给，读端自己算分母 = 第二把尺（而且恰好在"少判"时算出个漂亮的 100%）。
 */
function selectionOf(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const selected = num(raw.selected);
  const total = num(raw.total);
  if (selected === null || total === null) return null;
  return {
    selected,
    total,
    hit: num(raw.hit) ?? 0,
    always: num(raw.always) ?? 0,
    unselected: num(raw.unselected) ?? Math.max(0, total - selected),
    changed: num(raw.changed) ?? 0,
    mode: raw.mode === 'full' ? 'full' : 'changed',
    why_full: typeof raw.why_full === 'string' ? raw.why_full : '',
  };
}

/**
 * `rec.items` → **per-kind 的判定计数**（M1a ③-2）。
 *
 * 口径（写下来，别让读的人猜）：
 * · `judged` = `pass + fail` —— **真判出结论**的条数。`pending`（`blocked_by` 声明卡住）与
 *   `unsupported`（判不了）都**不算**判过：它们是"收进来了但没结论"。
 * · `checked` = 该 kind 被 judge **收到**的条数（= 四种之和）—— 与 `judged` 并列印，两个数一起才看得出
 *   "是没收到"还是"收到了但判不了"（0.12：分母与分子都要给）。
 */
function perKindOf(items) {
  const out = {};
  for (const it of items ?? []) {
    const k = String(it?.expectation?.kind ?? '');
    if (!k) continue;
    const slot = out[k] ?? { pass: 0, fail: 0, unsupported: 0, pending: 0, checked: 0, judged: 0 };
    const v = String(it?.verdict ?? '');
    if (v === 'pass' || v === 'fail' || v === 'unsupported' || v === 'pending') slot[v] += 1;
    slot.checked += 1;
    slot.judged = slot.pass + slot.fail;
    out[k] = slot;
  }
  return out;
}

/**
 * ★★★ P1（2026-11-17）：`rec.items` → 证据分级分布 + assumption 点名（只读报告层）。
 *
 * ## 口径（写死在这里，别让读的人猜）
 * · 分布只数 `items[].evidence.tier`，**不重新解释 verdict**；分母 = items.length。
 * · `evidence` 读不到 / tier 非法 ⇒ 按最弱档 `assumption` 算（0.12：读不到 ≠ 通过）。
 * · `assumption` 级逐条点名（wf §3.3「被裁掉的东西必须点名」）；空清单就打"（无）"，不假装缺（lead D3）。
 * · `documented/community_practice` 缺 cited、`assumption` 缺 next_verify ⇒ 记入 badMarks
 *   ★ **首版只警告、不改退出码**（lead D2/D4：只读裁定；P2 升门时把这里改成 bad++ 即可，检测点入口不增）。
 */
const EVIDENCE_TIERS = ['assumption', 'community_practice', 'documented', 'prior_verified', 'read_directly', 'measured', 'tested'];
function evidenceOfItems(items) {
  const counts = Object.fromEntries(EVIDENCE_TIERS.map((k) => [k, 0]));
  const assumption = [];
  const badMarks = [];
  for (const it of items ?? []) {
    const ev = it?.evidence;
    const raw = ev?.tier ?? 'assumption';
    const tier = EVIDENCE_TIERS.includes(raw) ? raw : 'assumption';
    counts[tier] += 1;
    if (!EVIDENCE_TIERS.includes(raw)) badMarks.push(`${it?.node_id}:tier 非法 ${String(raw)}`);
    if (tier === 'assumption') assumption.push(it?.node_id);
    if ((tier === 'documented' || tier === 'community_practice') && !ev?.cited)
      badMarks.push(`${it?.node_id}:${tier} 缺引源`);
    if (tier === 'assumption' && !ev?.next_verify)
      badMarks.push(`${it?.node_id}:assumption 缺下一步验证`);
  }
  return { counts, assumption, badMarks };
}

/** 把多册的 perKind 相加（同一 kind 跨册合并 —— 本仓口径） */
function mergePerKind(dst, src) {
  for (const [k, v] of Object.entries(src ?? {})) {
    const slot = dst[k] ?? { pass: 0, fail: 0, unsupported: 0, pending: 0, checked: 0, judged: 0 };
    slot.pass += v.pass;
    slot.fail += v.fail;
    slot.unsupported += v.unsupported;
    slot.pending += v.pending;
    slot.checked += v.checked;
    slot.judged = slot.pass + slot.fail;
    dst[k] = slot;
  }
  return dst;
}

/**
 * 判据行里的**一行原因**：`detail` 的**首句**（T43）。
 *
 * ## 为什么必须给
 * 改前 bad 行只有 `verdict:node_id(kind)` ⇒ 读的人**拿不到"为什么判不了"**；
 * 而 `design_line action=judge` 的 message 只打 `fail`（`unsupported` 一条都不打，
 * 它只在四态计数里出现），完整原因只住在 `---DATA---.items[].detail`
 * ⇒ **两个面都看不到**。后果很具体：读端分不清「harness 进程级失败（超时 / 起不来）」
 * 与「表达式抛错」—— 这两类的修法完全不同（前者是环境 / 超时预算，后者是判据本身），
 * 混在一起就只剩一句"判不了"。
 *
 * ## 口径（写成一句话，别让读的人猜）
 * · 截到第一个 `。`（没有句号 ⇒ 整句）—— 多句 detail 里第一句就是"为什么"；
 * · `\s+` 压成单空格 ⇒ **保证一行**（detail 可能带换行 / 栈回溯）；
 * · 硬上限 160 字符 + `…`（这是**行宽**，不是字节预算 —— 不以 P28 的字节口径要求它）；
 * · detail 空 ⇒ 空串：由调用方**显式**说"回执里没有 detail"（0.12：读不到 ≠ 没有）。
 */
function firstSentenceOf(detail) {
  const one = String(detail ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!one) return '';
  const dot = one.indexOf('。');
  const head = dot >= 0 ? one.slice(0, dot + 1) : one;
  return head.length > 160 ? `${head.slice(0, 160)}…` : head;
}

/**
 * 逐册判 + 打印 + 汇总（本仓与外部**同一段代码**，差别只在标签与前缀）.
 *
 * ★★ T-#INC-JUDGE-SEL（2026-11-17）：`opts.changed` 非 null ⇒ **选量模式**。选量模式下：
 * · 每册行尾多一段 `选量 selected/total`（分子 + 分母，0.12 第 3 条）；
 * · 该册 `selected === 0` ⇒ **不算红**，但也不标 ✓ —— 标 `○` 并写明"未判 ≠ 通过"；
 * · 回执里**没有** `selection` 块（旧 dist / 选量没生效）⇒ 记 `noSelection` 册，主流程判红（读不到 ≠ 全量）。
 */
function judgeBooks(features, target, prefix, opts = {}) {
  const changed = opts.changed ?? null;
  let bad = 0;
  let totalPass = 0;
  let totalJudged = 0;
  const byKind = {};
  const allItems = [];
  // 选量汇总（跨册相加）；`sheetsWithoutSelection` 用来抓"要了选量但 CLI 没回读数"
  const sel = { selected: 0, total: 0, hit: 0, always: 0, unselected: 0, changed: 0, sheets: 0, sheetsWithoutSelection: [], whyFull: [] };
  for (const f of features) {
    const r = judgeOne(f, target, changed);
    totalPass += r.pass;
    mergePerKind(byKind, r.perKind);
    // ★ 第⑨项：逐条判定带出（供 VerifiedSnapshot 写入）
    if (Array.isArray(r.items)) for (const it of r.items) allItems.push({ ...it, feature: f });
    const judged = r.pass + r.fail + r.unsupported;
    totalJudged += judged;
    // ★ 选量读数：**选了量就必须有**（没有 ⇒ 主流程判红，见下）
    if (changed) {
      if (r.selection) {
        sel.selected += r.selection.selected;
        sel.total += r.selection.total;
        sel.hit += r.selection.hit;
        sel.always += r.selection.always;
        sel.unselected += r.selection.unselected;
        sel.changed = Math.max(sel.changed, r.selection.changed);
        sel.sheets += 1;
        if (r.selection.mode === 'full') sel.whyFull.push(`${f}:${r.selection.why_full}`);
      } else {
        sel.sheetsWithoutSelection.push(f);
      }
    }
    // ★★ 2026-10-31（第四轮独立复核抓到）：原来只有**跨册求和**的「判了 0 条」守卫 ⇒
    //   **单册判据被清空**时，只要别册还有料就照绿。每册必须自己判过东西。
    // ★★ T-#INC-JUDGE-SEL 补一个例外（**只在选量模式**）：该册本次**一条都没命中**是合法结果，
    //   此时"判了 0 条"不是红，而是"这册本次不需要判" —— 但**绝不是通过**（标 ○ + 文字说清）。
    const selectedZero = Boolean(changed && r.selection && r.selection.selected === 0);
    const emptyBook = judged === 0 && !selectedZero;
    const isBad = r.fail > 0 || r.unsupported > 0 || !r.ok || emptyBook;
    if (isBad) bad++;
    const mark = isBad ? '✗' : selectedZero ? '○' : '✓';
    console.log(
      `  ${prefix}${mark} ${f.padEnd(22)} pass=${String(r.pass).padEnd(4)} fail=${String(r.fail).padEnd(2)} unsupported=${r.unsupported}` +
        (changed && r.selection ? `   选量 ${r.selection.selected}/${r.selection.total}` : '') +
        (r.sheetMismatch
          ? `  ← ★ ${r.sheetMismatch}（册不重合 ⇒ 这册的读数不算数）`
          : r.unparsed
            ? '  ← ★ CLI 回执里没有可解析的 `---DATA---` 块（读不到 ≠ 通过）'
            : selectedZero
              ? '  ← ★ 选量 0 条命中：本册本次**没判**（≠ 通过；改到相关文件才会被选上）'
              : emptyBook
                ? '  ← 该册一条判据都没判到（≠ 通过）'
                : ''),
    );
    for (const b of r.bad.slice(0, 5)) console.log(`       ${prefix}· ${b}`);
    if (r.bad.length > 5) console.log(`       ${prefix}· …另有 ${r.bad.length - 5} 条`);
  }
  return { books: features.length, judged: totalJudged, pass: totalPass, bad, byKind, items: allItems, selection: changed ? sel : null };
}

const { externals: extArgs, changed: changedRaw } = parseArgs(process.argv.slice(2));
/**
 * ★★ T-#INC-JUDGE-SEL 的三态入口（写在这里而不是散在下面）：
 * · `changedRequested=false` ⇒ **全量**（行为与今天逐字相同，不打印任何选量行）；
 * · `changedRequested=true && changed.length===0` ⇒ **回落全量**并**响亮说明**（空 = 保守方向）；
 * · 否则 ⇒ 选量。
 * ★ 为什么"空 changed 也要出声"：调用方给了 `--changed @清单` 而清单是空的，
 *   与"没人要选量"在读数上必须可区分 —— 否则"选量静默退化成全量"这件事没人看得见。
 */
const changedRequested = changedRaw !== null;
const changedPaths = (changedRaw ?? []).map((x) => String(x).trim()).filter(Boolean);
// ★★ 定义在**使用点之前**（下面 get_dsl query=features 的诊断块要按它决定跳不跳 —— TDZ 不是抽象概念，--changed 一开就炸）。
const changedForRepo = changedRequested && changedPaths.length > 0 ? changedPaths : null;

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
//
// ★★ T-#INC-JUDGE-SEL（2026-11-17）：**增量模式跳过这次枚举**，并**明说跳过了**。
//   理由（实测）：它是一次独立 CLI spawn ≈ **1.2s**，而增量跑整轮的目标是 <10s；
//   而它回答的问题（"CLI 册库里还有没有别项目的册"）**与本次"判多少条"无关**。
//   ★ 为什么"跳过"允许：本脚本**没有**因此少判任何判据 —— 少的是**诊断**，而诊断缺席必须自报
//     （0.12：读不到 ≠ 没有）。⇒ 这行字就是"本次没查"，不是"本次没有别处的册"。
// ════════════════════════════════════════════════════════════════════
const featOut = changedForRepo ? null : runCli('get_dsl', { query: 'features', project_dir: ROOT });
if (!featOut) {
  console.log(
    '  ⚠ 增量模式：**跳过**「CLI 册库里是否还登记着别项目的册」那次枚举（省一个 CLI 进程 ~1.2s）' +
      ' ⇒ 本轮**没查**这件事（不是"没有别处的册"）；要看它就跑全量。',
  );
}
let cliFeatures = null;
if (featOut) {
  try {
    const rec = JSON.parse(parseDataBlock(featOut.out) ?? 'null');
    if (Array.isArray(rec)) cliFeatures = rec.map((x) => x?.feature).filter((x) => typeof x === 'string');
  } catch {
    cliFeatures = null;
  }
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

// ════════════════════════════════════════════════════════════════════
// ★★ T-#INC-JUDGE-SEL（2026-11-17）：**选量模式**的入口声明（只在显式 `--changed` 时出现）
// ════════════════════════════════════════════════════════════════════
// 口径（写死在这里，别让读的人猜）：
// · 三件一起给：**改了多少路径**（输入）· **判了多少 / 共多少**（分子分母）· **没判多少**（未判 ≠ 通过）；
// · `--changed` 给了但为空 ⇒ **回落全量**（保守方向）并**明说**；
// · 外部册（`--include-external`）**恒全量**：`--changed` 的路径是**相对本仓**的，拿它去比别项目的册
//   会把路径比空（静默少判）⇒ 宁可不省。
if (changedRequested) {
  console.log(
    `  ★ 增量选量（T-#INC-JUDGE-SEL）：--changed 给了 ${changedPaths.length} 条路径` +
      (changedForRepo
        ? ' ⇒ 只判「这些路径可能影响到的」判据（口径 = domain/expectation.ts#selectExpectationsForChanged）'
        : ' ⇒ **空清单 = 回落全量**（保守方向：没有改动 ≠ 没有判据要判）'),
  );
  if (externals.length) {
    console.log('      ⚠ 外部册**不参与选量**（`--changed` 的路径相对本仓，比外部册会静默比空）⇒ 外部册照旧全量。');
  }
}
const repo = judgeBooks(list, { label: '本仓', projectRoot: ROOT, designDir: DESIGN_DIR }, '', {
  changed: changedForRepo,
});
// ★ 要了选量但 CLI 一条 `selection` 都没回（旧 dist / 参数没接上）⇒ **红**：
//   那意味着"本次到底是全量还是选量"读端无从判断，而"无从判断"不许长得像"全量跑过"（0.12）。
if (changedForRepo && repo.selection && repo.selection.sheetsWithoutSelection.length) {
  console.error(
    `✗ 选举量了但 CLI 回执里没有 selection 块：${repo.selection.sheetsWithoutSelection.join(', ')}\n` +
      '  ⇒ 判不出"这次判了几条 / 共几条" ⇒ 读数不可比（读不到 ≠ 全量跑过）。\n' +
      '  ⇒ 常见原因：dist 是旧的（先 npm run build）；或这个 CLI 的 design_line action=judge 还没接 --changed。',
  );
  process.exit(2);
}

// ★★★ 0.12 第 1 条：「判了 0 条」不许当「全部通过」。
//   实测过的两种死法（独立复核 2026-10-31 用临时副本复现）：
//   ① 册在盘上、但 CLI 的 dataHome 被 `AGENT_IO_HOME` 指到别处 ⇒ 看到 0 个 feature ⇒ 0 条判据 ⇒ 若只看
//      `fail>0` 就会 exit 0（**假绿**）；② 判据被人删空 ⇒ 同样 0 条 ⇒ exit 0。
//   `run-tests` 有这条断言（"0 个用例被执行"算红），本门原来没有 —— 现在补上。
if (repo.judged === 0) {
  // ★★ T-#INC-JUDGE-SEL：选量模式下的"0 条"是**另一种原因**，必须分开说 ——
  //   否则读的人会照着全量那份排查建议去查 `AGENT_IO_HOME`（南辕北辙）。
  if (changedForRepo) {
    console.error(
      `✗ 选量结果：本次 selected 0 / total ${repo.selection?.total ?? '?'} —— changed ${changedPaths.length} 条路径` +
        `**一条判据都没命中** ⇒ 本次什么都没判（未判 ≠ 通过）。\n` +
        `  若这不是意料之外：① 路径必须是**仓库相对 + 正斜杠**（绝对路径/反斜杠比不中）；\n` +
        `  ② 该册的判据可能都挂在**别的文件**上（想知道全量有几条：不传 --changed 再跑一次，看 "判据 N 条判过" 那行）；\n` +
        `  ③ 想要无条件全量读数 ⇒ **别传** --changed。`,
    );
    process.exit(2);
  }
  console.error(
    `✗ 一条判据都没判到（盘上发现 ${list.length} 册：${list.join(', ')}）⇒ 这不是通过。\n` +
      `  常见原因：① \`AGENT_IO_HOME\` 指到了别的数据根 ⇒ CLI 看不到册；② 该册的判据被删空。\n` +
      `  排查：\`node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"features"}'\` 看 CLI 自己认几册。`,
  );
  process.exit(2);
}

console.log(`  —— ${repo.books} 册 / 判据 ${repo.judged} 条判过（${repo.pass} pass）/ ${repo.bad} 册有红`);
// ★★★ P1（只读报告层）：分级分布 + assumption 点名 —— 紧跟汇总行，不改退出码
{
  const ev = evidenceOfItems(repo.items);
  console.log(
    `  ★ 证据分级分布（${EVIDENCE_TIERS.join(' / ')}）：` +
      EVIDENCE_TIERS.map((k) => `${k}=${ev.counts[k]}`).join(' · ') + `；分母 ${repo.items?.length ?? 0}`,
  );
  console.log(
    `  ★ assumption 级判据（下一步验证清单，${ev.assumption.length} 条）：` +
      (ev.assumption.length
        ? ev.assumption.slice(0, 20).join(', ') + (ev.assumption.length > 20 ? ` …另有 ${ev.assumption.length - 20} 条` : '')
        : '（无）'),
  );
  if (ev.badMarks.length) {
    console.log(
      `  ⚠ 证据标注五道自检未过 ${ev.badMarks.length} 条（首版只警告、不改退出码；供写册人修）：` +
        ev.badMarks.slice(0, 10).join(' · ') + (ev.badMarks.length > 10 ? ` …另有 ${ev.badMarks.length - 10} 条` : ''),
    );
  }
}
// ★★ 选量模式的**分母行**：独立一行紧跟汇总行（不塞进上面那行 —— 那行的 `repo.judged` 是"判过"),
//   口径必须保持"一行一个事实"：判过多少 / 共多少 / 未判多少。
if (repo.selection) {
  const s = repo.selection;
  console.log(
    `  ★ 增量选量读数：selected ${s.selected} / total ${s.total}` +
      `（路径命中 ${s.hit} · 恒选 ${s.always} · **未判 ${s.unselected}**）· changed ${s.changed} 条路径 · ${s.sheets} 册带 selection 块`,
  );
  console.log(
    '      ★ 未判的那些**本次没有断言**（既不是通过、也不是红）—— 要"全量读数"就别传 --changed。',
  );
  if (s.whyFull.length) console.log(`      ⚠ 有册回落全量：${s.whyFull.join(' · ')}`);
}

// ════════════════════════════════════════════════════════════════════
// 判据总数棘轮（R62 · 盲复核实测出来的缺口）
// ════════════════════════════════════════════════════════════════════
// ★ 为什么需要：`decision.update` 的 `expectations` 是**全量替换**（AGENTS 0.7，已撞三次），
//   冲掉 1 条又新增 2 条 ⇒ **净增掩盖丢失**；而"0 册有红"只证明**剩下的都对**，
//   **不证明没少** —— 唯一能看出来的仪表盘就是判据总数，而它此前没有任何断言。
// ★★ 只拦「掉」，不拦「涨」：加判据是好事（0.16 反向边界：不许变成永远亮的灯）。
// ★ 基线**只许显式上调**（`--write-baseline`），不许静默漂；掉下来时**点名差了多少**。
const JUDGE_BASELINE_REL = 'scripts/judge-baseline.json';
{
  const abs = path.join(ROOT, JUDGE_BASELINE_REL);
  const write = process.argv.includes('--write-baseline');
  // ★★ T-#INC-JUDGE-SEL：**棘轮的分母必须是"全册判据总数"**，不能是"本次判过条数"。
  //   选了量 ⇒ 判过条数天然变小（那是设计，不是丢失）⇒ 拿它比基线会把**每一次增量**都报成
  //   "判据掉了 N 条"（0.16 的反面：一盏被自己的正常行为点亮的红灯）。
  //   ⇒ 选量模式用回执里的 `selection.total`（= 该册全部判据条数，与全量口径同义）。
  const totalForRatchet = repo.selection ? repo.selection.total : repo.judged;
  if (write && repo.selection) {
    // ★ 选量模式下**不许**写基线：它会按"选中条数"记账（若 total 缺失）或把 by_kind 写成部分集
    //   ⇒ 下一轮全量比基线会误报。写基线只属于全量跑（那是"建账"）。
    console.error('✗ 不能与 --changed 同时用 --write-baseline（基线只许在全量读数上建账）⇒ 本次没写基线。');
    process.exit(2);
  }
  const cur = { total: totalForRatchet, by_kind: repo.byKind, capturedAt: new Date().toISOString().slice(0, 10) };
  if (repo.selection) {
    console.log(`  ★ 增量模式：棘轮按 **total ${totalForRatchet}** 比（不按"本次判过 ${repo.judged} 条" —— 那会每次增量都像掉条）`);
  }
  if (write) {
    fs.writeFileSync(
      abs,
      JSON.stringify(
        {
          '//': '判据总数棘轮（judge-all.mjs --write-baseline 写；判据总数低于此值 ⇒ 红）。只拦「掉」不拦「涨」。',
          ...cur,
        },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    console.log(`  ★ 判据总数基线已写入 ${JUDGE_BASELINE_REL}：${totalForRatchet} 条（只许显式上调）`);
  } else if (!fs.existsSync(abs)) {
    // ★★★ 首次运行：**建账而不是判红** —— 理由：本脚本被 `verify.mjs:204` 当门调用，
    //   若"缺基线 ⇒ exit 2"，那装上这条棘轮的那一刻**整个 verify 就红了**，
    //   而红的原因跟"判据有没有被删"毫无关系（0.16：不许造一盏永远亮的灯）。
    //   ⇒ 折中：**第一次**按当前值建账并**响亮声明**（下一个读到它的人知道这是 bootstrap、不是历史基线）；
    //     此后任何一次"掉"都会红。★ 代价如实说：`删判据 + 恰好赶上首次建账` 这一种序列会漏 —— 但它要求基线文件先被删，
    //     而基线文件入 git ⇒ 删它会出现在 diff 里。
    fs.writeFileSync(abs, JSON.stringify({ '//': '判据总数棘轮（首次运行自动建账；判据总数低于此值 ⇒ 红）。只拦「掉」不拦「涨」。', bootstrap: true, ...cur }, null, 2) + '\n', 'utf-8');
    console.log(
      `  ★★ 判据总数基线**不存在 ⇒ 本次已按当前值建账**：${totalForRatchet} 条 → ${JUDGE_BASELINE_REL}（bootstrap:true）。\n` +
        `     这不是历史基线，是"从这次开始记"。⇒ 请把它连同 commit 一起提交，之后任何"掉"都会红。`,
    );
  } else {
    let base = null;
    try {
      base = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    } catch (e) {
      console.error(`✗ 判据总数基线读不动（${JUDGE_BASELINE_REL}）：${e?.message ?? String(e)} ⇒ 这不是"没掉"。`);
      process.exit(2);
    }
    const b = Number(base?.total ?? NaN);
    if (!Number.isFinite(b)) {
      console.error(`✗ 判据总数基线里没有可用的 total（读到 ${JSON.stringify(base?.total)}）⇒ 这不是"没掉"。`);
      process.exit(2);
    }
    const delta = totalForRatchet - b;
    if (delta < 0) {
      console.error(
        `✗ 判据总数**掉了 ${-delta} 条**：本次 ${totalForRatchet} / 基线 ${b}（${JUDGE_BASELINE_REL}）。\n` +
          `  ⇒ 这不是"判据更精简"，是**有人删了判据、或一次 decision.update 的全量替换覆盖了它**（AGENTS 0.7）。\n` +
          `  ⇒ 逐册核：\`node dist/src/presentation/cli/cli.js get_dsl --json '{"query":"nodes","feature":"<册>"}'\`；\n` +
          `  ⇒ 若确实是"被更强的判据取代"，把它写进 commit message 后跑 \`node scripts/judge-all.mjs --write-baseline\` 显式下调。`,
      );
      process.exit(1);
    }
    console.log(`  ✓ 判据总数棘轮：本次 ${totalForRatchet} / 基线 ${b}${delta > 0 ? `（涨 ${delta}，是好事）` : '（未降）'}`);
  }
}

// ★★★ 2026-11-03（M1a ③-2）：把 **per-kind 的「真判过」条数**落成读数，供 `scripts/gen-db-check.mjs` 印
//   「judge 判过」列。为什么必须落盘而不是让投影门自己算：投影门只读入库文件**不跑 judge**（跑一次要几十秒、
//   且要 cache.db）；而"judge 到底判出结论没有"只有**跑过 judge 的人**知道。
//   ⇒ 判据：该 kind 的 `judged`（= pass + fail）= 0 而册侧 > 0 ⇒ 投影门红（"收进来了却一条都没结论"）。
//   ★ 写盘失败**不许静默**（0.12）：那不是"没有读数"，是"这次没记下来"。
// ★★ T-#INC-JUDGE-SEL：**选量模式不写这份读数** —— 它的 `by_kind.judged` 会变成"部分集"，
//   而 `gen-db-check` 的判据是"该 kind judged=0 而册侧 > 0 ⇒ 红"：写进去等于用一次增量去
//   冒充"全量的 per-kind 读数"（下次读它的人分不出）。⇒ 保留上一次**全量**跑的读数，并**明说**。
if (repo.selection) {
  console.log(
    '  ○ 增量模式：**不覆盖** .agent-io/judge-readings.json（它是"全量 per-kind 读数"，增量写进去会把部分集冒充成全量）',
  );
} else try {
  const readingsPath = path.join(ROOT, '.agent-io', 'judge-readings.json');
  fs.mkdirSync(path.dirname(readingsPath), { recursive: true });
  fs.writeFileSync(
    readingsPath,
    JSON.stringify(
      {
        '//': '判定闸的 per-kind 读数（judge-all.mjs 每次跑完覆盖写）—— gen-db-check 的「judge 判过」列读它',
        at: new Date().toISOString(),
        books: repo.books,
        judged: repo.judged,
        pass: repo.pass,
        by_kind: repo.byKind,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
  console.log(
    `  ✓ 已写 per-kind 判定读数：${path.relative(ROOT, readingsPath).replace(/\\/g, '/')}` +
      `（${Object.keys(repo.byKind).length} 种 kind · judged 合计 ${Object.values(repo.byKind).reduce((n, v) => n + v.judged, 0)} 条）`,
  );
} catch (e) {
  console.error(`✗ 写不出 per-kind 判定读数（${e?.message ?? String(e)}）⇒ 投影门的「judge 判过」列将不可算（这不是"没有"）。`);
  process.exit(2); // 2 = 本次没有产出可信读数（不许当成 1「判出红」）
}

// ════════════════════════════════════════════════════════════════════
// ★★ 第⑨项（2026-11-10）：**判定结果写回 VerifiedSnapshot**（作为契约证据，供增量验证继承）。
//
// ## 为什么写在 judge-all（而不是让 verify-changed 自己跑 judge）
// judge-all 是**判据面的全量执行点**（每次全跑三册，量级 ~90s 还不痛）⇒ 它手里天然有
// 每条判据的**新鲜 verdict**；不落盘的话，verify-changed 只好自己再跑一遍 judge（两倍时间）。
// 本段**只写证据**，**不改变本门的判定行为**（退出码语义逐字不变）。
//
// ## 合并纪律（三条，与 verify_project.ts / verify-changed.mjs 同源，不许各写一套）
// ① **保留未判过条目**（它们没被推翻——上次跑过就仍然有效）；
// ② 本次条目 dropThenPush（同 id 以最新为准）；
// ③ **撤销旧 pass**：本次 fail / unsupported / pending 的 id，不许留上次的绿（旧绿当豁免 = 假绿）。
//
// ## scope 口径
// `partial:false` = **判据面全量**；`evidence_kinds:['contract']` = 证据**只有契约**——
// 两个分开标，读端不会把"契约全过"误读成"测试也全过"。
//
// ## 失败语义
// 写失败**降级为响亮警告**（不改退出码）：主结果（判据绿/红）不被基础设施问题掩盖；
// 但**不许静默** —— 写不出就要喊，下一轮增量验证因此会重跑全部判据（保守方向，安全）。
// ════════════════════════════════════════════════════════════════════
// ★★ T-#INC-JUDGE-SEL：**选量模式不写 VerifiedSnapshot**。
//   理由（比"少一个写点"重要）：这份快照的 `scope.partial=false` 语义是「判据面**全量**跑过」，
//   而增量只跑了一部分 ⇒ 写进去要么撒谎（partial:false），要么改语义（partial:true 的下游没人核过）。
//   ⇒ 保留上一次全量跑的契约证据；增量跑的读数**只出现在 stdout**（那是它该待的地方）。
if (repo.selection) {
  console.log(
    '  ○ 增量模式：**不覆盖** .agent-io/verified-snapshot.json（它的 partial:false = 判据面全量跑过；增量不满足这个前提）',
  );
} else try {
  const vsPath = path.join(TOOL_ROOT, 'dist', 'src', 'application', 'design', 'verified_snapshot.js');
  const VS = await import(pathToFileURL(vsPath).href);

  const snapRel = VS.SNAPSHOT_REL;
  const snapAbs = path.join(ROOT, snapRel);
  let prev = null;
  if (fs.existsSync(snapAbs)) {
    try {
      const loaded = VS.loadVerifiedSnapshot(ROOT);
      if (loaded.status === 'ok') prev = loaded.snapshot;
    } catch {
      prev = null; // 旧基线读不了 ⇒ 当没有（下面会全量写入本次条目，方向保守）
    }
  }

  const nowIso = new Date().toISOString();
  const norm = (p) => String(p ?? '').replace(/\\/g, '/');
  // 判据观察面：expectation 的 path/from/to（与 verify-changed.mjs:1088 同口径，不另造第二套）
  const observesOf = (exp) =>
    [...new Set([exp?.path, exp?.from, exp?.to].filter((x) => typeof x === 'string').map(norm))];
  const symbolsOf = (exp) =>
    [exp?.symbol, exp?.from, exp?.to, exp?.target].filter((x) => typeof x === 'string');
  const verdictOf = (v) =>
    v === 'pass' ? 'pass' : v === 'fail' ? 'fail' : v === 'unsupported' ? 'unsupported' : 'pending';

  const thisRun = repo.items ?? [];
  const ranIds = new Set(thisRun.map((it) => `contract:${it.node_id}`));
  // ① 保留未判过的旧 contract 条目（test 条目原样保留 —— 它们不归本门管，也不许被冲掉）
  const kept = (prev?.entries ?? []).filter((e) => !(e.kind === 'contract' && ranIds.has(e.id)));
  // ③ 撤旧绿：本次非 pass 的 id，把它**上次的 pass 条目**扔掉（上面 kept 已按 id 排除了本次判过的 ⇒
  //    这里只需保证本次条目按实际 verdict 写，不 pass 的自然不产生绿）
  const entries = [...kept];
  const dropThenPush = (e) => {
    const i = entries.findIndex((x) => x.id === e.id);
    if (i >= 0) entries.splice(i, 1);
    entries.push(e);
  };
  for (const it of thisRun) {
    dropThenPush({
      id: `contract:${it.node_id}`,
      kind: 'contract',
      verdict: verdictOf(it.verdict),
      command: `node scripts/judge-all.mjs（契约 ${it.node_id}）`,
      at: nowIso,
      observes: observesOf(it.expectation),
      symbols: symbolsOf(it.expectation),
    });
  }

  // 语义摘要：契约条目的摘要由 verify 侧的 semanticDigest 统一算（这里不引入第二套）⇒ 不填 digest
  //（缺省 digest = 继承时判 undetermined，保守方向——增量侧若要精确继承需先跑一次 digest 采集）。
  const contentFiles = prev?.content?.files ?? {};
  const snap = {
    schema: VS.SNAPSHOT_SCHEMA,
    at: nowIso,
    content: { version: prev?.content?.version ?? '', files: contentFiles },
    graph: prev?.graph ?? { version: '', bytes: 0, available: false },
    entries,
    scope: {
      ran: [...ranIds],
      inherited: (prev?.scope?.inherited ?? []).filter((id) => !ranIds.has(id)),
      undetermined: prev?.scope?.undetermined ?? [],
      partial: false, // 判据面全量
      evidence_kinds: ['contract'], // 证据种类单列：这里只有契约证据（没有测试证据）
      covered_files: [...new Set(entries.flatMap((e) => e.observes ?? []))].sort(),
    },
  };
  // ★ rel 必须是**仓库相对路径**（writeVerifiedSnapshot 内部 `path.join(root, rel)`——
  //   传绝对路径会被拼成 `<root>D:\...` 的坏路径，实测 ENOENT）。缺省值就是 SNAPSHOT_REL。
  VS.writeVerifiedSnapshot(ROOT, snap);
  const cnt = entries.filter((e) => e.kind === 'contract').length;
  console.log(
    `  ✓ 契约证据已写回 ${snapRel}（contract 条目 ${cnt} 条 / 本次判 ${thisRun.length} 条；` +
      `test 条目原样保留 ${(prev?.entries ?? []).filter((e) => e.kind === 'test').length} 条）`,
  );
} catch (e) {
  console.error(
    `⚠ 契约证据写回失败（${e?.message ?? String(e)}）⇒ 下次增量验证会重跑全部判据（保守方向，安全；` +
      `本门判定结果不受影响）`,
  );
}

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
