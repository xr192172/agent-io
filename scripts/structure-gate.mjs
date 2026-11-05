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
 * ## ★★★ 2026-11-05（R32）：文件级读数多了**第 4 桶 `conflict`**
 * 改前 `silentGapOf` 只有三桶（有节点 / 已声明排除 / 缺口），于是"**既被 `excluded` 声明命中、
 * 册里又给它建了节点**"这一类被 `with_node` 吞掉 ⇒ 本门对整场冲突**结构性失明**
 * （那批文件全被读成"已入册"；具体数字现取 `--json` 的 `conflicts` 段，别抄）。
 * ⇒ 现在四桶互斥穷尽 `源码 = 干净入册 + 已声明排除 + 冲突 + 缺口`，且 `conflict` 单独挂棘轮（见下）。
 * ★ 本文件**不自己判定**冲突（0.9.1：同一事实的第二份实现 = 违例）：冲突路径由 `silentGapsOf` 从
 *   `gen_design_db#excludedNodeConflicts` 取来喂进纯核，本文件只**读读数 + 挂账 + 判档**。
 *
 * ## 冲突档的棘轮（★ 与 `files` / `dirs` **分开的键**）
 * · 基线 = **上一次实测读数**（不是人定阈值）——与 `scripts/mcp/tool-surface-baseline.json` 同一形态：
 *   要变大必须显式 `--update-baseline`，那份 diff 在评审里现形；
 * · 三档：`== 基线` ⇒ 绿（**存量逐条列在回执里**，不静默）· `> 基线` ⇒ 红 · `< 基线` ⇒ 红
 *   （「已消散 N 条，请 `--update-baseline` 下调」—— 棘轮只能降，防"修好了但基线还挂着"变永久免罪符）；
 * · 每条必须带 `{path, declared, nodes, expectations, fix_by}`；**缺 `fix_by` 的条目一条都不认**
 *   ⇒ 等同"没登记" ⇒ 红（同 `red-blanket-switch` 的保护：不许用空清单 / 无主清单把这条读数关掉）。
 * · ★ 为什么这份基线**不能**抄 `files` 的"空清单是目标态"：`files` 里那 25 个是真缺口且**已补齐**；
 *   这里 73 条是**待裁决的矛盾**（R12④ 逐文件二选一）⇒ 空清单 = 门一接上就永久红（0.16 永远亮），
 *   而"抄 73 条进 `files` 当豁免" = 把门关掉。⇒ 独立键 + 独立判档 + 每条带 `fix_by`。
 *
 * ## 三态（与总门同口径）
 *   **0** 两档都干净（或缺口**全部**在基线里登记、且显式给了 `--allow-structure-gaps`）
 *   **1** 红：存在**未登记**的缺口（逐个点名）—— 或闸本身说不清（见下）
 *   **2** 判不了：`dist/` 不在 / 册读不到 / 域表坏。★ 不折成 0（假绿）也不折成 1（把"判不了"说成"有缺陷"）
 *
 * ## 棘轮（AGENTS-RULES 0.19）
 * `scripts/structure-gaps-baseline.json` 只记**已登记的存量**，每条必须带 `reason`（缺口）/ `fix_by`（冲突）。
 * `--allow-structure-gaps`（或 `AGENT_IO_ALLOW_STRUCTURE_GAPS=1`）**只对登记过的缺口免红**：
 * **新缺口照样红**。★ 名单缺失或为空时开关**不生效** —— 拒绝"一个全局开关把门关掉"。
 * ★ 冲突档**不吃**这个开关（它有自己的基线三档：`==` 绿 / `>` 红 / `<` 红）。
 *
 * ## 用法
 *   node scripts/structure-gate.mjs [--project <dir>] [--baseline <file>] [--allow-structure-gaps] [--json]
 *   node scripts/structure-gate.mjs --update-baseline      # 把当前**实测**冲突读数写成新基线（显式动作）
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
 * ★ R32：冲突档的 `fix_by` —— **清这批冲突的那张卡**（`docs/todo.md` 的 R12④「逐文件二选一」）。
 * ★ 为什么它是常量而不是逐条手填：73 条的清理动作只有**一个**（同一张卡），逐条填 73 遍等于
 *   给"记得改 73 处"发免死牌；而它**不能为空** —— 空 ⇒ 基线条目一条都不认（见下）⇒ 当场红。
 */
const CONFLICT_FIX_BY = 'todo_r12④-逐文件二选一清-excluded-nodes-冲突-r32-结构门挂账';
/** 显式动作：把当前**实测**冲突读数写成新基线（不许自动、不许静默） */
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
// ★★★ R32：冲突档（第 4 桶）的挂账与三档
// ───────────────────────────────────────────────────────────────────────────
//
// ★ 冲突从哪来：`silentGapsOf` 已经把 `excludedNodeConflicts` 的逐条读数透传在 `files.conflicts` 里
//   ⇒ 本文件**不读册、不重算**"既声明又有节点"（0.9.1），只把逐节点读数按 path 归并成挂账条目。
/** 当前冲突 → 基线条目（同一文件的多个节点归并成一条；排序稳定 ⇒ `--update-baseline` 的 diff 可读） */
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
      fix_by: CONFLICT_FIX_BY,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * ★ 本门（盘上 `walkFiles` 宇宙）的冲突挂账 = **四桶里那一桶**（`files.conflict_list`）。
 * ★ 为什么不是把册上 77 条全抄进来：基线必须与"本门下一次实测"同源，否则那 2 个幽灵 / 2 个 tests
 *   永远对不上（一个永远在、一个永远看不到）⇒ 棘轮失效。两个宇宙的差**逐条点名**（见 `outsideGateConflicts`）。
 */
const conflictAll = conflictEntriesOf(files);
const gateConflictSet = new Set(files.conflict_list);
const conflictsNow = conflictAll.filter((x) => gateConflictSet.has(x.path));
const rawConflicts = rawBaseline && Array.isArray(rawBaseline.conflicts) ? rawBaseline.conflicts : null;
const conflictKeyPresent = !!rawBaseline && Object.prototype.hasOwnProperty.call(rawBaseline, 'conflicts');
/** ★ 只认带 `fix_by` 的条目（缺 = 没登记 = 不算豁免；与 `files` 那条"空 reason 不算"同款） */
const conflictsBase = (rawConflicts ?? [])
  .filter((x) => x && x.path && String(x.fix_by ?? '').trim())
  .map((x) => ({
    path: String(x.path),
    declared: String(x.declared ?? ''),
    nodes: Number(x.nodes ?? 0),
    expectations: Number(x.expectations ?? 0),
    fix_by: String(x.fix_by),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));
const conflictsDropped = (rawConflicts ?? []).filter((x) => !x || !x.path || !String(x.fix_by ?? '').trim());
let conflictsBaseResolved = conflictsBase;

// ───────────────────────────────────────────────────────────────────────────
// ★ 显式动作：把当前**实测**冲突读数写成新基线（与 `scripts/mcp/mcp_scan.mjs --update` 同款）
// ───────────────────────────────────────────────────────────────────────────
// · 只写 `conflicts` 这一个键 —— `files` / `dirs` 原样保留（它们各有自己的口径，混写会污染判档）；
// · **拒写**：任一条缺 `fix_by` / `path` / `nodes` ⇒ 挂账条目说不出"谁来清、裁哪一处" ⇒ 不写并红；
// · 写完**本次就按新基线判**（否则运维刚 `--update` 完还看到 FAIL，会以为没生效）；
// · 提示走 stderr（stdout 要留给 `--json` 的读数，混进去下游就解析不了）。
if (updateBaseline) {
  const bad = conflictsNow.filter((x) => !String(x.fix_by ?? '').trim() || !x.path || !(x.nodes > 0));
  if (bad.length) {
    console.error(`✗ 拒写基线：${bad.length} 条缺 fix_by / path / nodes —— 挂账条目必须能指出「谁来清、裁哪一处」：`);
    for (const b of bad.slice(0, 10)) {
      console.error(`   · ${b.path ?? '(空)'} · fix_by=${JSON.stringify(b.fix_by ?? '')} · nodes=${b.nodes}`);
    }
    process.exit(1);
  }
  const next = {
    ...(rawBaseline ?? {}),
    note: String((rawBaseline && rawBaseline.note) ?? ''),
    files: rawBaseline && Array.isArray(rawBaseline.files) ? rawBaseline.files : [],
    dirs: rawBaseline && Array.isArray(rawBaseline.dirs) ? rawBaseline.dirs : [],
    conflicts: conflictsNow,
  };
  fs.writeFileSync(baselineFile, `${JSON.stringify(next, null, 2)}\n`, 'utf-8');
  console.error(
    `★ 已写基线：${path.relative(REPO_ROOT, baselineFile).split(path.sep).join('/')} —— conflicts ${conflictsNow.length} 条` +
      `（files ${next.files.length} / dirs ${next.dirs.length} 原样保留；本开关**只**写冲突档）`,
  );
  conflictsBaseResolved = conflictsNow;
}

const conflictBaseSet = new Set(conflictsBaseResolved.map((x) => x.path));
const conflictNew = conflictsNow.filter((x) => !conflictBaseSet.has(x.path));
const conflictGone = conflictsBaseResolved.filter((x) => !conflictsNow.some((n) => n.path === x.path));

/**
 * 三档 + 两条"不许把这条读数关掉"的保护：
 * · `red-empty-entries`：`conflicts` 键存在但**一条都不认** ⇒ 红（`red-blanket-switch` 的同构形态）；
 * · `red-strict`：`--strict` 下存量也计入红（与 `files` / `dirs` 的严格口径一致：清零验收）。
 */
let conflictVerdict;
if (!conflictsNow.length && !conflictsBaseResolved.length) conflictVerdict = 'none';
else if (strict && conflictsNow.length) conflictVerdict = 'red-strict';
else if (conflictKeyPresent && !conflictsBaseResolved.length) conflictVerdict = 'red-empty-entries';
else if (conflictNew.length) conflictVerdict = 'red-new';
else if (conflictGone.length) conflictVerdict = 'red-resolved';
else conflictVerdict = 'baseline-ok';
const conflictOk = conflictVerdict === 'none' || conflictVerdict === 'baseline-ok';

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
 * ★★★ R32：**三个口径并排** —— 这是本门最容易被误读成"某个数算错了"的地方。
 *
 * ```
 * 册上（excludedNodeConflicts，节点驱动）= 本门（walkFiles 口径的 conflict）+ 幽灵 + 本门口径外
 * ```
 * · **幽灵** = 册上有节点、盘上**不存在**（节点还在、文件早没了）；
 * · **本门口径外** = 盘上存在，但 `walkFiles(includeTests=false)` 不收（tests/ 被整体跳过）。
 *
 * ★★ **等式落成断言，不落成注释**：`design_line.ts#assertConflictUniverseClosed` 在
 *   `silentGapsOf` 里现算并**抛**（口径一改 —— `includeTests` 翻 true / 幽灵被清掉 —— 它自己红）。
 *   本文件只**取读数**（`files.conflict_outside` 已经是那两类的分区），不再自己算第二遍（0.9.1）。
 * ★ 数字**不写在这里**：现取 `--json` 的 `conflicts.equation`。
 * ★ 反向边界：**不许为了让等式好看去打开 `includeTests`** —— 那会把 tests 卷进这道门的分母，
 *   改变它原来守的东西（那是 0.9.3「它该不该存在」的另一件事，不在 R32 射程内）。
 */
const conflictUniverse = (() => {
  const outside = files.conflict_outside.map((x) => ({
    path: x.path,
    onDisk: x.on_disk,
    why: x.on_disk
      ? '盘上存在，但 walkFiles(includeTests=false) 不收它（测试文件被整体跳过）⇒ 本门看不见（不是幽灵）'
      : '册上有节点，盘上**不存在** ⇒ 幽灵节点（这正是 0.9.4 要区分的"占了位"vs"有"）',
  }));
  const ghosts = outside.filter((x) => !x.onDisk).length;
  const outsideOnDisk = outside.length - ghosts;
  return {
    bookFiles: files.conflicts.conflict_files,
    inGate: files.conflict,
    ghosts,
    outsideOnDisk,
    outside: outside.sort((a, b) => a.path.localeCompare(b.path)),
    /** ★ 分区必须成立（`silentGapsOf` 里已有硬断言；这里是**读端口径自洽**的第二眼） */
    ok: files.conflict + ghosts + outsideOnDisk === files.conflicts.conflict_files,
  };
})();

/** 等式（**自解释**：多个口径并排，每一项都说"是什么"；不写死任何数字） */
const conflictEquation =
  `册上 ${conflictUniverse.bookFiles} = 本门 ${conflictUniverse.inGate} + 幽灵 ${conflictUniverse.ghosts} + ` +
  `本门口径外 ${conflictUniverse.outsideOnDisk}`;

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
          verdict: conflictVerdict,
          ok: conflictOk,
          now: conflictsNow.length,
          baseline: conflictsBaseResolved.length,
          new: conflictNew,
          resolved: conflictGone,
          dropped_entries: conflictsDropped,
          node_driven: {
            files: files.conflicts.conflict_files,
            nodes: files.conflicts.conflict_nodes,
            expectations: files.conflicts.expectations,
          },
          outside_gate: conflictUniverse.outside.map((x) => ({ path: x.path, on_disk: x.onDisk, why: x.why })),
          /** ★ 自解释等式（三个口径并排）与其是否成立 —— 等式本身就是判据 */
          equation: {
            text: conflictEquation,
            ok: conflictUniverse.ok,
            book_files: conflictUniverse.bookFiles,
            in_gate: conflictUniverse.inGate,
            ghosts: conflictUniverse.ghosts,
            outside_on_disk: conflictUniverse.outsideOnDisk,
          },
          fix_by: CONFLICT_FIX_BY,
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
  // ★ R32：四桶 —— `with_node` 一律印成「**干净入册**」（读端不许把旧名读回旧义），冲突单列
  console.log(
    `   源码 ${files.source_files} 个 · 干净入册 ${files.with_node} · 已声明排除 ${files.excluded} · ` +
      `**冲突 ${files.conflict}** · 缺口 ${files.gaps.length}`,
  );
  if (!files.gaps.length) console.log('   （缺口无 —— 每个源文件都在册上、或已声明排除、或落冲突档）');
  else for (const [i, p] of files.gaps.entries()) console.log(`   ${String(i + 1).padStart(3)}. ${rel(p)}`);
  // ★★★ R32：冲突**逐条点名**（存量不许静默）+ 三个口径并排 + 自解释等式
  //   ★ 条件用 `files.conflict || conflictUniverse.bookFiles`：**只有幽灵 / 只有口径外**时
  //     `files.conflict` 会是 0，但等式照样得印（否则"0 冲突"读起来像"一件都没有"）。
  if (files.conflict || conflictUniverse.bookFiles) {
    console.log('');
    if (files.conflict) {
      console.log(
        `   ★ 冲突 ${files.conflict} 个（有节点 ∧ 又被册级 excluded 命中：判据在 judge 里**真的在跑**，而投影跳过它们）：`,
      );
      for (const [i, c] of conflictsNow.entries()) {
        console.log(`   ${String(i + 1).padStart(3)}. ${c.path}  ← 声明 ${c.declared} · 节点 ${c.nodes} 个（判据 ${c.expectations} 条）`);
      }
    }
    console.log(
      `   ★ 三个口径（不是一个数的三种算法）：本门（盘上 walkFiles）= ${files.conflict} 文件 · ` +
        `excludedNodeConflicts（节点驱动）= ${files.conflicts.conflict_files} 文件 / ${files.conflicts.conflict_nodes} 节点 / ` +
        `${files.conflicts.expectations} 判据`,
    );
    // ★★ R32：**自解释等式** —— 等式对不上 = 分区不成立（口径或实现变了），红；不是"数字差一点"
    console.log(
      `   ★ 自解释等式：**${conflictEquation}**` +
        (conflictUniverse.ok ? '（分区成立）' : ' —— ✗ **对不上：分区不成立**（口径或实现变了，不许当成"数字差一点"）'),
    );
    if (conflictUniverse.outside.length) {
      console.log(`   ★ 差的 ${conflictUniverse.outside.length} 个**逐个点名**（不许概括成一句）：`);
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
      `文件 ${baseline.files.length} 条 / 目录 ${baseline.dirs.length} 条 / 冲突 ${conflictsBaseResolved.length} 条` +
      `${baseline.note ? `（${baseline.note}）` : ''}`,
  );
  if (baselineReadError) console.log(`  ★ ${baselineReadError}`);
  if (conflictsDropped.length) {
    console.log(
      `  ★ 冲突基线里 ${conflictsDropped.length} 条**缺 fix_by / path** ⇒ 一条都不认（等同没登记）：` +
        conflictsDropped.map((x) => String((x && x.path) || '(空)')).join(' ; '),
    );
  }
  // ★ R32 冲突档的三档结论（存量时**逐条列在上面**，这里只给档位；`>` / `<` 逐条点名）
  if (conflictVerdict === 'baseline-ok') {
    console.log(
      `  ★ 冲突档：**== 基线**（${conflictsNow.length} 条存量，逐条列在①里；待 R12④ 逐文件二选一）· fix_by = ${CONFLICT_FIX_BY}`,
    );
  } else if (conflictVerdict === 'red-new') {
    console.log(`  ★ 冲突档：**新增 ${conflictNew.length} 条**（基线只许不增）：`);
    for (const c of conflictNew) console.log(`     · ${c.path} ← 声明 ${c.declared} · 判据 ${c.expectations} 条`);
  } else if (conflictVerdict === 'red-resolved') {
    console.log(
      `  ★ 冲突档：**已消散 ${conflictGone.length} 条，请 \`--update-baseline\` 下调**（棘轮只能降；` +
        `挂着不降 = 修好了也仍享免红）：`,
    );
    for (const c of conflictGone) console.log(`     · ${c.path}`);
  } else if (conflictVerdict === 'red-empty-entries') {
    console.log(
      '  ★ 冲突档：基线里 `conflicts` 键存在但**一条都不认**（缺 fix_by 或空清单）⇒ 拒绝把这些冲突当成"没登记"放行',
    );
  } else if (conflictVerdict === 'red-strict') {
    console.log(`  ★ 冲突档：**严格模式** ⇒ 基线不参与，${conflictsNow.length} 条存量也算红（M2b 清零验收口径）`);
  }
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
// ★★ R32：冲突档**独立收口** —— 它与 files/dirs 的四档不是一件事（各有基线、各有方向）
//   ★ 等式不成立（分区打架）也在这里红：那时**任何**冲突数都不可信。
if (!conflictOk || !conflictUniverse.ok) {
  const why = !conflictUniverse.ok
    ? `冲突档：**自解释等式对不上** —— ${conflictEquation}（分区不成立 ⇒ 本门口径 / 册上口径 / includeTests 有一处变了，别当成数字差）`
    : conflictVerdict === 'red-new'
      ? `冲突档（有节点 ∧ 又被 excluded 声明命中）：**新增 ${conflictNew.length} 条**（基线只许不增）· 存量 ${conflictsBaseResolved.length} ⇒ 逐条见①`
      : conflictVerdict === 'red-resolved'
        ? `冲突档：**已消散 ${conflictGone.length} 条** ⇒ 请 \`node scripts/structure-gate.mjs --update-baseline\` 下调（棘轮只能降）`
        : conflictVerdict === 'red-empty-entries'
          ? '冲突档：基线 `conflicts` 键存在但**一条都不认**（缺 fix_by / 空清单）⇒ 拒绝用空清单把这条读数关掉'
          : `冲突档：**严格模式**下 ${conflictsNow.length} 条存量也计入红（M2b 清零验收口径）`;
  line(1, why);
  process.exit(1);
}
if (verdict === 'clean') {
  line(
    0,
    `两档都干净（源码 ${files.source_files} 个全有归属 / 域表与磁盘一致）· 已登记豁免 0` +
      ` · 冲突 ${files.conflict}（== 基线）`,
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
    `冲突 ${files.conflict}（== 基线）· **已登记豁免 ${exemptedFiles}（M2b 待补）** · 新增缺口 0 ⇒ PASS（基线只许不增）`,
);
if (exemptedDirs > 0) console.log(`     ★ 另有已登记豁免目录 ${exemptedDirs} 个（域表待补；同一份基线、同一把棘轮）`);
process.exit(0);
