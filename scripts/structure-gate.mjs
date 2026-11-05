#!/usr/bin/env node
/**
 * structure-gate —— `npm run verify` 的「结构意图」门（2026-11-03 接线）。
 *
 * ## 它治哪个洞
 * 仓里有**两套**「结构 / 归属」读数，此前**都只是工具、都不在任何门里**：
 * · `structure_gap`（`structure.domains.json` vs 磁盘）：`scripts/verify.mjs` 的头注自己写着
 *   「结构意图目前**没有任何门在查**」—— 2026-10-19 那版脚本被删后，这扇窗就再没人看；
 * · `design_line action=report` ⑥ 的**沉默缺口**（盘上有 ∧ 册上无节点 ∧ 未声明排除）：
 *   实测 97 条，其中 25 条是**真源码该进册**（其余是测试 / 非代码，已逐条声明 excluded）。
 * ⇒ 「有个文件谁都没登记」这件事**只有人撞上才发现**（2026-11-03 发现者审计：50 个账目里 HUMAN 24 · NONE 6）。
 *
 * ## 两档判据（★ 都不在本文件里重写 —— 各调**一处权威**）
 * ① **文件级**：`design_line.ts#silentGapsOf` —— 与 `design_line action=report` ⑥ **同一函数**
 *    （分母 = 盘上源文件，来源 = 册上节点 path + 全册 excluded 并集 + 冲突路径）。
 * ② **目录级**：`structure_gap.ts#structureGap` + `structureGapIsClean` —— 与 `structure_gap` 工具**同一函数**，
 *    clean 的判据也只有那一处（本文件不自己数四个数组）。
 *
 * ## ★★★ 2026-11-05（R32）：文件级读数有 4 个桶（干净入册 / 已声明排除 / 冲突 / 缺口）
 * 改前 `silentGapOf` 只有三桶，"**既被 `excluded` 声明命中、册里又给它建了节点**"这一类被吞掉
 * （读数读起来像"已入册"）。四桶互斥穷尽：`源码 = 干净入册 + 已声明排除 + 冲突 + 缺口`。
 * ★ 本文件**不自己判定**冲突（0.9.1：同一事实的第二份实现 = 违例）：冲突路径由 `silentGapsOf` 从
 *   `gen_design_db#excludedNodeConflicts` 取来喂进纯核，本文件只**读读数 + 判档**。
 *
 * ## ★★★ 2026-11-05（R49）：冲突档从「待清债务 + 棘轮基线」改成「**信息档 + 两条断言**」—— 只报不红
 * `excluded` 声明只豁免**没有任何册给它建节点**的路径（规则唯一语句 = `gen_design_db#excludedAppliesTo`）
 * ⇒ 「声明 ∧ 节点」那批文件**照样入册**（走 `with_node`），它不再是债 ⇒ 棘轮基线没有意义了。
 * 本门对冲突档**保留两件有牙的事**（都不靠基线）：
 *   · **债务为 0**：四桶里的 `conflict` 非零 = 判序被绕开（有节点却没排在 `excluded` 之前）⇒ 红；
 *   · **四个口径闭合**：册上 = 本门冲突 + 幽灵 + 本门口径外 + 因 node-wins 入册（不成立 ⇒ 红）。
 * 以及一件**不许删**的事：「N 处声明被节点覆盖」每次打印 + **逐条点名** —— 删了就没人知道发生过什么
 * （0.16 的反向要求：这条读数现在按构造不进红，所以更要每次露脸）。
 * ★ 冲突档的棘轮基线**已退役**（`structure-gaps-baseline.json` 的 `conflicts` 键已删）：棘轮是"债务账"，
 *   而这里的债务按构造恒为 0；留着它会让"又有一个文件获得了节点"这种**好事**去撞"只许不增"。
 *
 * ## 三态（与总门同口径）
 *   **0** 两档都干净（或缺口**全部**在基线里登记、且显式给了 `--allow-structure-gaps`）
 *   **1** 红：存在**未登记**的缺口（逐个点名）—— 或闸本身说不清（见下）
 *   **2** 判不了：`dist/` 不在 / 册读不到 / 域表坏。★ 不折成 0（假绿）也不折成 1（把"判不了"说成"有缺陷"）
 *
 * ## 棘轮（AGENTS-RULES 0.19）
 * `scripts/structure-gaps-baseline.json` 只记**已登记的存量**，每条必须带 `reason`（缺口）。
 * `--allow-structure-gaps`（或 `AGENT_IO_ALLOW_STRUCTURE_GAPS=1`）**只对登记过的缺口免红**：
 * **新缺口照样红**。★ 名单缺失或为空时开关**不生效** —— 拒绝"一个全局开关把门关掉"。
 * ★ 冲突档**不吃**这个开关，也不再有基线（R49：它只报不红，两条红条件见文件头）。
 *
 * ## 用法
 *   node scripts/structure-gate.mjs [--project <dir>] [--baseline <file>] [--allow-structure-gaps] [--json]
 *   ★ `--update-baseline` **已退役**（R49：冲突档不再是棘轮 ⇒ 没有需要下调的基线）：
 *     传了也只会得到一句"已退役"的说明 + 退出码 2，不会静默当成"成功"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const asJson = argv.includes('--json');
/**
 * ★★★ **基线模式是 verify 的默认口径**（2026-11-03 第二轮，用户裁定：不许让总门永久红）。
 *
 * ## 为什么必须这样（否则就是 0.16 的教科书形态）
 * 缺口有 27 条（25 文件 + 2 目录），**每一条都真实存在且已登记**，而清它们要逐个裁「纳入 / 显式排除」
 * —— 不是一天能做完的。若 verify 默认把已登记的存量也算红 ⇒ `npm run verify` **每天都亮**，且
 * 「亮的那个原因里有一档是正常的（已登记）」⇒ 人会开始忽略 verify ⇒ **真红被一起忽略**
 * ⇒ 这条告警等于被关掉。
 *
 * ## 这不是「调宽判据变绿」——区别可判
 * · **调宽判据** = 让异常**不再被计入**（判据范围变小，读数里那个数消失）；
 * · **基线棘轮**   = 异常**仍被计入、仍被打印、仍可追溯**（`structure-gaps-baseline.json` 里逐条带 reason），
 *   只是"已知"⇒ 只对**登记过的**免红，**新增一条就红**（与 `scripts/test-baseline.json` 的规模棘轮同形态，
 *   AGENTS-RULES 0.19 明确保留这一类棘轮）。
 * ⇒ 判据（可判真假）：默认模式读数里**必须出现**「已登记豁免 N」这个数；不出现 ⇒ 不算通过
 *   （无法区分"没有缺口"与"缺口被静默吞掉"）。
 *
 * ## 两种口径
 * · 缺省（verify 用，显式传 `--allow-structure-gaps`）：基线棘轮 —— 已登记免红 + **打印豁免数** + 新增恒红；
 * · `--strict` / `--no-baseline`：全部计入红（M2b 收尾「清零」验收用；也压过 `AGENT_IO_ALLOW_STRUCTURE_GAPS`）。
 */
const strict = argv.includes('--strict') || argv.includes('--no-baseline');
const allow = !strict && (argv.includes('--allow-structure-gaps') || process.env.AGENT_IO_ALLOW_STRUCTURE_GAPS === '1');
const project = path.resolve(arg('project', process.cwd()));
const baselineFile = path.resolve(arg('baseline', path.join(SCRIPT_DIR, 'structure-gaps-baseline.json')));

const UNSUPPORTED = 2;
/**
 * ★★★ 2026-11-05（R49）：冲突档不再是债务账 ⇒「清冲突的那张卡」与 `--update-baseline` **一起退役**。
 * ★ 为什么不再需要 `fix_by`：它回答"这批债由谁来清"；node wins 之后这批**不是债**
 *   （那些节点照样入册），要清的东西不存在了 ⇒ 常数留着只会让下一个人以为还有个待办卡。
 */
/** 显式动作：**已退役**（保留入参只为能给出"已退役"的说明，不静默当成成功） */
const updateBaseline = argv.includes('--update-baseline');

const die = (msg) => {
  if (asJson) console.log(JSON.stringify({ ok: false, unsupported: true, project, why: msg }, null, 2));
  else {
    console.error('════ 结构意图（verify 门 · 两档判据）════');
    console.error(`项目：${project}`);
    console.error(`✗ 判不了（退出码 ${UNSUPPORTED}）：${msg}`);
  }
  process.exit(UNSUPPORTED);
};

/** 判据实现只在 `dist/`（与其余门同一前提）—— 拿不到就是"判不了"，不许猜。 */
const distUrl = (...p) => pathToFileURL(path.join(REPO_ROOT, 'dist', 'src', ...p)).href;
let silentGapsOf;
let structureGap;
let structureGapIsClean;
try {
  ({ silentGapsOf } = await import(distUrl('application', 'design', 'line', 'design_line.js')));
  ({ structureGap, structureGapIsClean } = await import(
    distUrl('infrastructure', 'analysis', 'structure', 'structure_gap.js')
  ));
} catch (e) {
  die(
    `读不到判据实现（${(e && e.message) || e}）\n` +
      '  ★ 本脚本**不自己算**这两档缺口（0.9.1：同一判据只许一处实现）—— 它调的是\n' +
      '    design_line.ts#silentGapsOf 与 structure_gap.ts#structureGap。\n' +
      '  ⇒ 先 `npm run build`（dist 必须比 src 新）。',
  );
}

/** 一档读数的收集（任一档抛 ⇒ 整门"判不了"，不许半绿） */
let files;
let dirs;
try {
  files = silentGapsOf(project);
} catch (e) {
  die(`文件级判据抛错（${(e && e.message) || e}）：design_line.ts#silentGapsOf`);
}
try {
  dirs = structureGap(project);
} catch (e) {
  die(`目录级判据抛错（${(e && e.message) || e}）：structure_gap.ts#structureGap`);
}

/** 目录级缺口摊平成「kind + path」（kind 是 structure_gap 的四/六态名，不另起词） */
const DIR_KINDS = ['misplaced', 'unlisted', 'missing', 'misnested', 'unclassified', 'relocating'];
const dirGaps = [];
for (const kind of DIR_KINDS) {
  for (const item of dirs[kind] ?? []) dirGaps.push({ kind, path: String(item.path) });
}

/** 基线：只认带 reason 的条目（空 reason = 没登记，不算豁免）；冲突条目只认带 `fix_by` 的 */
let baseline = { note: '', files: [], dirs: [] };
/** 基线文件的**原样**（`--update-baseline` 要保留别的键，不许整份重写丢掉 `files`/`dirs`） */
let rawBaseline = null;
let baselineReadError = '';
try {
  if (fs.existsSync(baselineFile)) {
    const raw = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
    rawBaseline = raw;
    baseline = {
      note: String(raw.note ?? ''),
      files: (raw.files ?? []).filter((x) => x && x.path && String(x.reason ?? '').trim()),
      dirs: (raw.dirs ?? []).filter((x) => x && x.path && String(x.reason ?? '').trim()),
    };
  } else {
    baselineReadError = `基线文件不存在：${baselineFile}`;
  }
} catch (e) {
  // ★ 读不了 ≠ 没有（0.12）：坏基线不许静默当成空名单 —— 它会让"登记过的存量"变成"未登记"而报假红，
  //   也可能反过来让人以为"没有存量"。这里如实带着它走，并在结论里点名。
  baselineReadError = `基线读不了（${(e && e.message) || e}）：${baselineFile}`;
}

// ───────────────────────────────────────────────────────────────────────────
// ★★★ R49：冲突档 = **信息档**（只报不红）+ 两条与基线无关的红条件
// ───────────────────────────────────────────────────────────────────────────
//
// ★ 事实从哪来：`silentGapsOf` 已经把 `excludedNodeConflicts` 的逐条读数透传在 `files.conflicts` 里
//   ⇒ 本文件**不读册、不重算**"既声明又有节点"（0.9.1），只把逐节点读数按 path 归并成"逐条点名"的清单。
/** 册上冲突 → 逐条信息条目（同一文件的多个节点归并成一行；稳定排序 ⇒ 两次跑的 diff 可读） */
function conflictEntriesOf(reading) {
  const byPath = new Map();
  for (const c of reading.conflicts.conflicts) {
    const cur = byPath.get(c.path) ?? { path: c.path, declared: new Set(), nodes: 0, expectations: 0 };
    cur.declared.add(c.declared);
    cur.nodes += 1;
    cur.expectations += c.expectations;
    byPath.set(c.path, cur);
  }
  return [...byPath.values()]
    .map((x) => ({
      path: x.path,
      declared: [...x.declared].sort().join(' | '),
      nodes: x.nodes,
      expectations: x.expectations,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * ★ 信息档：**N 处声明被节点覆盖** —— 逐条点名（`declared` = 哪册哪个前缀 · `nodes` = 被几个节点覆盖 ·
 *   `expectations` = 那几个节点上挂着几条判据，它们现在**都进 design-db**）。
 * ★ 为什么不红：这不是债。node wins 之下那批节点照样入册，四桶里的 `conflict` 按构造为 0。
 */
const conflictInfo = conflictEntriesOf(files);

/**
 * ★★ 红条件一：**四桶里的 `conflict` 必须是 0**。
 *   非零 = 判序被绕开（有节点却没排在 `excluded` 之前）⇒ 这不是"多了一条债"，是实现 bug。
 *   ★ 鉴别力（可判）：把 `design_line#silentGapOf` 里「有节点优先」那一段摘掉 ⇒ 这里立刻红。
 */
const conflictDebt = files.conflict;
const conflictOk = conflictDebt === 0;
/** 基线里若还留着**已退役**的 `conflicts` 键 ⇒ 如实说出来（不当它不存在，也不当成异常） */
const retiredConflictKeyInBaseline = !!rawBaseline && Object.prototype.hasOwnProperty.call(rawBaseline, 'conflicts');

/**
 * ★ 显式动作 `--update-baseline` 已退役（R49）：冲突档不再是棘轮 ⇒ 没有"债务基线"可写。
 *   ★ 退出码 2（"判不了"）而不是 0：这个开关现在什么都不会做，静默成功会训练人以为它写了。
 */
if (updateBaseline) {
  console.error(
    '✗ `--update-baseline` 已退役（R49）：冲突档不再是棘轮 —— `excluded` 声明只豁免**没有任何册给它建节点**\n' +
      '  的路径，那批节点照样入册 ⇒ 没有"债务基线"需要下调。\n' +
      '  · 要看这批覆盖关系：跑不带该开关的本命令（信息档逐条点名），或读 `--json` 的 `conflicts.node_driven`。',
  );
  process.exit(UNSUPPORTED);
}

const baselineSet = (list) => new Set(list.map((x) => x.path));
const baseFiles = baselineSet(baseline.files);
const baseDirs = baselineSet(baseline.dirs);
const unbaselinedFiles = files.gaps.filter((p) => !baseFiles.has(p));
const unbaselinedDirs = dirGaps.filter((g) => !baseDirs.has(g.path));
const baselineTotal = baseline.files.length + baseline.dirs.length;
const staleBaseline = [
  ...baseline.files.filter((x) => !files.gaps.includes(x.path)).map((x) => ({ kind: 'files', path: x.path })),
  ...baseline.dirs.filter((x) => !dirGaps.some((g) => g.path === x.path)).map((x) => ({ kind: 'dirs', path: x.path })),
];

const totalGaps = files.gaps.length + dirGaps.length;
const totalUnbaselined = unbaselinedFiles.length + unbaselinedDirs.length;
/**
 * ★ 「已登记豁免」的两个数（打印用，也是 ⑤ 的判据载体）：
 *   走棘轮口径（`allow`）时 = 缺口里**在基线登记过**的那些；严格模式 = 0（基线不参与，存量也算红）。
 *   ★ 它们必须**进读数**（不是只进 JSON）：读端靠这个数区分「没有缺口」与「缺口被静默吞掉」。
 */
const exemptedFiles = allow ? files.gaps.length - unbaselinedFiles.length : 0;
const exemptedDirs = allow ? dirGaps.length - unbaselinedDirs.length : 0;

/** 结论：四档，别混（干净 / 只差"给开关" / 有新缺口 / 开关空转） */
let verdict;
if (totalGaps === 0) verdict = 'clean';
else if (!allow) verdict = 'red-not-allowlisted';
else if (baselineTotal === 0) verdict = 'red-blanket-switch';
else if (totalUnbaselined > 0) verdict = 'red-new-gaps';
else verdict = 'clean-allowlisted';

/**
 * ★★★ R32/R49：**四个口径并排** —— 这是本门最容易被误读成"某个数算错了"的地方。
 *
 * ```
 * 册上（excludedNodeConflicts，节点驱动）= 本门冲突 + 幽灵 + 本门口径外 + 因 node-wins 入册
 * ```
 * · **幽灵** = 册上有节点、盘上**不存在**（节点还在、文件早没了）；
 * · **本门口径外** = 盘上存在，但 `walkFiles(includeTests=false)` 不收（tests/ 被整体跳过）；
 * · **因 node-wins 入册** = 盘上有、`walkFiles` 也收，但不在冲突桶里（R49：它进了 `with_node`）。
 *
 * ★★ **等式落成断言，不落成注释**：`design_line.ts#assertConflictUniverseClosed` 在
 *   `silentGapsOf` 里现算并**抛**（口径一改 —— `includeTests` 翻 true / 幽灵被清掉 / 判序被绕开 —— 它自己红）。
 *   本文件只**取读数**（`files.conflict_outside` 已经是那三类的分区），不再自己算第二遍（0.9.1）。
 * ★ 数字**不写在这里**：现取 `--json` 的 `conflicts.equation`。
 * ★ 反向边界：**不许为了让等式好看去打开 `includeTests`** —— 那会把 tests 卷进这道门的分母，
 *   改变它原来守的东西（那是 0.9.3「它该不该存在」的另一件事，不在 R32 射程内）。
 */
const conflictUniverse = (() => {
  const outside = files.conflict_outside
    .map((x) => ({
      path: x.path,
      onDisk: x.on_disk,
      inWalk: x.in_walk,
      why: !x.on_disk
        ? '册上有节点，盘上**不存在** ⇒ 幽灵节点（这正是 0.9.4 要区分的"占了位"vs"有"）'
        : x.in_walk
          ? '★ R49：盘上有、walkFiles 也收 ⇒ **因 node wins 进了 with_node**（声明对它不适用，不是债务）'
          : '盘上存在，但 walkFiles(includeTests=false) 不收它（测试文件被整体跳过）⇒ 本门看不见（不是幽灵）',
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const ghosts = outside.filter((x) => !x.onDisk).length;
  const nodeWon = outside.filter((x) => x.onDisk && x.inWalk).length;
  const outOfScope = outside.length - ghosts - nodeWon;
  return {
    bookFiles: files.conflicts.conflict_files,
    inGate: files.conflict,
    ghosts,
    outOfScope,
    nodeWon,
    outside,
    /** ★ 分区必须成立（`silentGapsOf` 里已有硬断言；这里是**读端口径自洽**的第二眼） */
    ok: files.conflict + ghosts + outOfScope + nodeWon === files.conflicts.conflict_files,
  };
})();

/** 等式（**自解释**：多个口径并排，每一项都说"是什么"；不写死任何数字） */
const conflictEquation =
  `册上 ${conflictUniverse.bookFiles} = 本门冲突 ${conflictUniverse.inGate} + 幽灵 ${conflictUniverse.ghosts} + ` +
  `本门口径外 ${conflictUniverse.outOfScope} + 因 node-wins 入册 ${conflictUniverse.nodeWon}`;

const rel = (p) => p;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        ok: verdict === 'clean' || verdict === 'clean-allowlisted',
        project,
        verdict,
        allow,
        strict,
        /** ★ 「已登记豁免」的两个数（读端据此区分「没有缺口」与「缺口被吞」） */
        exempted: { files: exemptedFiles, dirs: exemptedDirs },
        new_gaps: totalUnbaselined,
        baseline_file: baselineFile,
        baseline_read_error: baselineReadError || undefined,
        files: {
          source_files: files.source_files,
          /** ★ R32：`with_node` 已收窄为「**干净入册**」（有节点 ∧ 不在冲突里）—— 读端别把旧名读回旧义 */
          with_node: files.with_node,
          excluded: files.excluded,
          /** ★ R32 第 4 桶：有节点 ∧ 又被 excluded 声明命中（本门口径 = 盘上 walkFiles 宇宙） */
          conflict: files.conflict,
          conflict_list: files.conflict_list,
          gaps: files.gaps.length,
          gap_list: files.gaps,
          unbaselined: unbaselinedFiles,
        },
        /**
         * ★ R32：冲突档的**两个宇宙并排** + 三档结论。
         * · `now` / `baseline` / `new` / `resolved` 是本门口径（盘上 walkFiles）；
         * · `node_driven` 是 `excludedNodeConflicts` 的原始读数（册上口径）—— 两者差的那几个
         *   必须**逐个点名**（`outside_gate`），不许概括成一句（0.12③ / 0.9.4）。
         */
        conflicts: {
          verdict: conflictOk ? 'info' : 'red-debt',
          ok: conflictOk,
          /** ★ R49 信息档：**N 处声明被节点覆盖**（逐条点名；那批节点现在都入册 —— 不是债） */
          info: { count: conflictInfo.length, entries: conflictInfo },
          /** ★ R49 红条件一：四桶里的 `conflict`（node wins 之下必须为 0；非零 = 判序被绕开） */
          debt: conflictDebt,
          node_driven: {
            files: files.conflicts.conflict_files,
            nodes: files.conflicts.conflict_nodes,
            expectations: files.conflicts.expectations,
          },
          outside_gate: conflictUniverse.outside.map((x) => ({
            path: x.path,
            on_disk: x.onDisk,
            in_walk: x.inWalk,
            why: x.why,
          })),
          /** ★ 自解释等式（四个口径并排）与其是否成立 —— 等式本身就是判据 */
          equation: {
            text: conflictEquation,
            ok: conflictUniverse.ok,
            book_files: conflictUniverse.bookFiles,
            in_gate: conflictUniverse.inGate,
            ghosts: conflictUniverse.ghosts,
            out_of_scope: conflictUniverse.outOfScope,
            node_won: conflictUniverse.nodeWon,
          },
          /** ★ R49：基线里若还留着**已退役**的 `conflicts` 键 ⇒ 如实说（不当它不存在，也不当成异常） */
          retired_baseline_key: retiredConflictKeyInBaseline,
        },
        baseline: { entries: baselineTotal, stale: staleBaseline },
        dirs: {
          configured: dirs.configured,
          domain_count: dirs.domain_count,
          flat_count: dirs.flat_count,
          clean: structureGapIsClean(dirs),
          relocate_note: dirs.relocate_note,
          gaps: dirGaps.length,
          gap_list: dirGaps,
          unbaselined: unbaselinedDirs,
        },
        baseline: { entries: baselineTotal, stale: staleBaseline },
      },
      null,
      2,
    ),
  );
} else {
  console.log('════ 结构意图（verify 门 · 两档判据）════');
  console.log(`项目：${project}`);
  console.log('');
  console.log('① 文件级（盘上有 ∧ 册上无节点 ∧ 未声明排除）—— 判据 = design_line.ts#silentGapsOf');
  // ★ R32 四桶 / ★ R49：`with_node` 印成「**干净入册**」；`conflict` 现在是**债务槽位（node wins 之下必须为 0）**
  console.log(
    `   源码 ${files.source_files} 个 · 干净入册 ${files.with_node} · 已声明排除 ${files.excluded} · ` +
      `冲突债务 ${files.conflict}（必须为 0）· 缺口 ${files.gaps.length}`,
  );
  if (!files.gaps.length)
    console.log('   （缺口无 —— 每个源文件都在册上、或已声明排除；「声明 ∧ 节点」那批已因 node wins 入册）');
  else for (const [i, p] of files.gaps.entries()) console.log(`   ${String(i + 1).padStart(3)}. ${rel(p)}`);
  // ★★★ R32/R49：冲突档 = **信息档** —— 报数 + **逐条点名**（不许只给数字），再并排四个口径 + 自解释等式。
  //   ★ 条件带上 `conflictUniverse.bookFiles`：**只有幽灵 / 只有口径外**时也要印等式
  //     （否则"0 冲突"读起来像"一件都没有"）。
  if (conflictInfo.length || conflictUniverse.bookFiles) {
    console.log('');
    if (conflictInfo.length) {
      console.log(
        `   ★ 信息档：**${conflictInfo.length} 处声明被节点覆盖**（有节点 ∧ 又被册级 excluded 命中 —— ` +
          `node wins ⇒ 这些节点**照样入册**，所以它是信息不是债务；逐条点名如下）：`,
      );
      for (const [i, c] of conflictInfo.entries()) {
        console.log(
          `   ${String(i + 1).padStart(3)}. ${c.path}  ← 声明 ${c.declared} · 节点 ${c.nodes} 个（判据 ${c.expectations} 条）`,
        );
      }
    }
    console.log(
      `   ★ 四个口径（不是一个数的四种算法）：本门冲突（盘上 walkFiles）= ${files.conflict} 文件 · ` +
        `excludedNodeConflicts（节点驱动）= ${files.conflicts.conflict_files} 文件 / ${files.conflicts.conflict_nodes} 节点 / ` +
        `${files.conflicts.expectations} 判据`,
    );
    // ★★ 自解释等式 —— 对不上 = 分区不成立（口径或实现变了），红；不是"数字差一点"
    console.log(
      `   ★ 自解释等式：**${conflictEquation}**` +
        (conflictUniverse.ok ? '（分区成立）' : ' —— ✗ **对不上：分区不成立**（口径或实现变了，不许当成"数字差一点"）'),
    );
    if (conflictUniverse.outside.length) {
      console.log(`   ★ 没进冲突桶的 ${conflictUniverse.outside.length} 个**逐个点名**（不许概括成一句）：`);
      for (const x of conflictUniverse.outside) console.log(`      · ${x.path} —— ${x.why}`);
    }
  }
  console.log('');
  console.log('② 目录级（structure.domains.json vs 磁盘）—— 判据 = structure_gap.ts#structureGap');
  if (!dirs.configured) {
    console.log('   该项目根下没有 structure.domains.json ⇒ **没声明结构意图**（合法状态，不是失败）');
  } else {
    console.log(
      `   域 ${dirs.domain_count} + 平铺 ${dirs.flat_count} · 待搬 ${dirs.misplaced.length} · ` +
        `待定归属 ${dirs.unlisted.length} · 待建域 ${dirs.missing.length} · 声明与位置打架 ${dirs.misnested.length} · ` +
        `未标 role ${dirs.unclassified.length} · 待迁移 ${dirs.relocating.length}`,
    );
    if (!dirGaps.length) console.log('   （无 —— 域表与磁盘一致）');
    else for (const [i, g] of dirGaps.entries()) console.log(`   ${String(i + 1).padStart(3)}. ${g.kind} · ${g.path}`);
    // ★ "没查" 不许读成 "没问题"（0.12）：relocating 比的是 HEAD → 工作区，取不到 HEAD 时它**没查**。
    if (dirs.relocate_note) console.log(`   ★ 待迁移（relocating）**本轮没查**：${dirs.relocate_note}`);
  }
  console.log('');
  console.log(
    `基线：${path.relative(REPO_ROOT, baselineFile).split(path.sep).join('/')} —— ` +
      `文件 ${baseline.files.length} 条 / 目录 ${baseline.dirs.length} 条（冲突档从 R49 起**不再有基线**）` +
      `${baseline.note ? `（${baseline.note}）` : ''}`,
  );
  if (baselineReadError) console.log(`  ★ ${baselineReadError}`);
  if (retiredConflictKeyInBaseline) {
    console.log(
      '  ★ 基线里还留着**已退役**的 `conflicts` 键（R49：冲突档不再是棘轮）⇒ 本门**不读它**；' +
        '删掉那个键即可（留着不会改变任何判定，但会让下一个人以为还有一份债务账）',
    );
  }
  // ★ R49 冲突档的结论：只报不红（两条红条件在收口那一段单独判）
  console.log(
    conflictOk
      ? `  ★ 冲突档（**信息档**，只报不红）：${conflictInfo.length} 处声明被节点覆盖（逐条列在①里）· ` +
          `冲突债务 ${conflictDebt} 必须为 0 ⇒ 当前 0`
      : `  ★ 冲突档：**冲突债务 ${conflictDebt} ≠ 0** —— node wins 之下「声明 ∧ 节点」不该落进任何桶` +
          '（非零 = 判序被绕开：有节点却没排在 `excluded` 之前）',
  );
  if (staleBaseline.length) {
    console.log(`  ★ 已补齐/已消失的基线条目 ${staleBaseline.length} 条（可以删掉，删条目不影响判定）：`);
    for (const s of staleBaseline.slice(0, 10)) console.log(`     · ${s.kind} · ${s.path}`);
    if (staleBaseline.length > 10) console.log(`     …… 另有 ${staleBaseline.length - 10} 条`);
  }
  console.log('');
  // ★★ ⑤ 的判据：「**已登记豁免 N**」必须出现在读数里 —— 不出现就无法区分「没有缺口」与
  //   「缺口被静默吞掉」（0.12：只给分子等于没验；这里给的是"分母里有几个是已知的"）。
  //   ★ 严格模式（--strict）下豁免恒为 0（基线不参与），这个数也照打 —— 让人看得见"没走棘轮"。
  console.log(
    allow
      ? `★ 已登记豁免 ${exemptedFiles} 个文件 + ${exemptedDirs} 个目录（M2b 待补）· 新增缺口 ${totalUnbaselined}（基线只许不增）`
      : `★ 已登记豁免 0 · 未豁免缺口 ${totalGaps}（★ 严格模式：基线不参与，已登记存量也计入红 —— M2b 收尾清零验收用）`,
  );
  console.log('');
}

const line = (state, why) => {
  // ★ `--json` 模式**只输出一份可解析的 JSON**：这句结论行会污染 stdout（下游 JSON.parse 直接抛）。
  //   结论本身由**退出码**承载（0/1/2），不靠这行人读。
  if (asJson) return;
  const tag = state === 0 ? 'PASS' : state === 1 ? 'FAIL' : 'SKIP';
  console.log(`${tag}  结构意图：${why}`);
};
// ★★ R49：冲突档**独立收口** —— 它与 files/dirs 的四档不是一件事（各有方向）。
//   ★ 两条红条件都不依赖基线：**债务必须为 0** / **四个口径的等式必须成立**（分区打架时任何冲突数都不可信）。
if (!conflictOk || !conflictUniverse.ok) {
  const why = !conflictUniverse.ok
    ? `冲突档：**自解释等式对不上** —— ${conflictEquation}（分区不成立 ⇒ 本门口径 / 册上口径 / includeTests 有一处变了，别当成数字差）`
    : `冲突档：**冲突债务 ${conflictDebt} ≠ 0** —— node wins 之下「声明 ∧ 节点」不进任何桶（那批走 with_node）` +
      '；非零 = 判序被绕开（`design_line#silentGapOf` 的「有节点优先」被挪到 `excluded` 之后了）';
  line(1, why);
  process.exit(1);
}
if (verdict === 'clean') {
  line(
    0,
    `两档都干净（源码 ${files.source_files} 个全有归属 / 域表与磁盘一致）· 已登记豁免 0` +
      ` · 冲突债务 ${files.conflict}（必须为 0）· 信息档 ${conflictInfo.length} 处（只报不红）`,
  );
  process.exit(0);
}
if (verdict === 'red-not-allowlisted') {
  line(
    1,
    allow
      ? `缺口 ${totalGaps} 个（文件 ${files.gaps.length} + 目录 ${dirGaps.length}）`
      : `缺口 ${totalGaps} 个（文件 ${files.gaps.length} + 目录 ${dirGaps.length}）—— 严格模式：未启用基线棘轮 ⇒ 全部计入红`,
  );
  if (!allow && totalGaps - totalUnbaselined > 0) {
    console.log(
      `     ★ 其中 ${totalGaps - totalUnbaselined} 个已在基线登记（要跑棘轮口径 ⇒ 加 --allow-structure-gaps；` +
        `M2b 收尾清零 ⇒ 用 --strict）`,
    );
  }
  process.exit(1);
}
if (verdict === 'red-blanket-switch') {
  line(1, `给了 --allow-structure-gaps 但基线里**没有一条**带 reason 的登记 ⇒ 开关不生效（拒绝用一个全局开关把门关掉）`);
  process.exit(1);
}
if (verdict === 'red-new-gaps') {
  line(1, `**新增**缺口 ${totalUnbaselined} 个（基线只许不增）· 已登记豁免 ${exemptedFiles} 文件 + ${exemptedDirs} 目录`);
  for (const p of unbaselinedFiles) console.log(`     · files · ${p}`);
  for (const g of unbaselinedDirs) console.log(`     · ${g.kind} · ${g.path}`);
  process.exit(1);
}
// ★ 默认口径（verify 用）：已登记存量免红，但**逐数打印**，且新增恒红（跑到这里 = 新增 0）。
line(
  0,
  `源码 ${files.source_files} · 干净入册 ${files.with_node} · 已声明排除 ${files.excluded} · ` +
    `冲突债务 ${files.conflict}（必须为 0）· 信息档 ${conflictInfo.length} 处（只报不红）· ` +
    `**已登记豁免 ${exemptedFiles}（M2b 待补）** · 新增缺口 0 ⇒ PASS（基线只许不增）`,
);
if (exemptedDirs > 0) console.log(`     ★ 另有已登记豁免目录 ${exemptedDirs} 个（域表待补；同一份基线、同一把棘轮）`);
process.exit(0);
