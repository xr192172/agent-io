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
 *    （分母 = 盘上源文件，来源 = 册上节点 path + 全册 excluded 并集）。
 * ② **目录级**：`structure_gap.ts#structureGap` + `structureGapIsClean` —— 与 `structure_gap` 工具**同一函数**，
 *    clean 的判据也只有那一处（本文件不自己数四个数组）。
 *
 * ## 三态（与总门同口径）
 *   **0** 两档都干净（或缺口**全部**在基线里登记、且显式给了 `--allow-structure-gaps`）
 *   **1** 红：存在**未登记**的缺口（逐个点名）—— 或闸本身说不清（见下）
 *   **2** 判不了：`dist/` 不在 / 册读不到 / 域表坏。★ 不折成 0（假绿）也不折成 1（把"判不了"说成"有缺陷"）
 *
 * ## 棘轮（AGENTS-RULES 0.19）
 * `scripts/structure-gaps-baseline.json` 只记**已登记的存量**，每条必须带 `reason`。
 * `--allow-structure-gaps`（或 `AGENT_IO_ALLOW_STRUCTURE_GAPS=1`）**只对登记过的条目免红**：
 * **新缺口照样红**。★ 名单缺失或为空时开关**不生效** —— 拒绝"一个全局开关把门关掉"。
 *
 * ## 用法
 *   node scripts/structure-gate.mjs [--project <dir>] [--baseline <file>] [--allow-structure-gaps] [--json]
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

/** 基线：只认带 reason 的条目（空 reason = 没登记，不算豁免） */
let baseline = { note: '', files: [], dirs: [] };
let baselineReadError = '';
try {
  if (fs.existsSync(baselineFile)) {
    const raw = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
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
          with_node: files.with_node,
          excluded: files.excluded,
          gaps: files.gaps.length,
          gap_list: files.gaps,
          unbaselined: unbaselinedFiles,
        },
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
  console.log(
    `   源码 ${files.source_files} 个 · 有节点 ${files.with_node} · 已声明排除 ${files.excluded} · 缺口 ${files.gaps.length}`,
  );
  if (!files.gaps.length) console.log('   （无 —— 每个源文件都在册上或已声明排除）');
  else for (const [i, p] of files.gaps.entries()) console.log(`   ${String(i + 1).padStart(3)}. ${rel(p)}`);
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
      `文件 ${baseline.files.length} 条 / 目录 ${baseline.dirs.length} 条${baseline.note ? `（${baseline.note}）` : ''}`,
  );
  if (baselineReadError) console.log(`  ★ ${baselineReadError}`);
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
  const tag = state === 0 ? 'PASS' : state === 1 ? 'FAIL' : 'SKIP';
  console.log(`${tag}  结构意图：${why}`);
};
if (verdict === 'clean') {
  line(0, `两档都干净（源码 ${files.source_files} 个全有归属 / 域表与磁盘一致）· 已登记豁免 0`);
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
  `源码 ${files.source_files} · 有节点 ${files.with_node} · 已声明排除 ${files.excluded} · ` +
    `**已登记豁免 ${exemptedFiles}（M2b 待补）** · 新增缺口 0 ⇒ PASS（基线只许不增）`,
);
if (exemptedDirs > 0) console.log(`     ★ 另有已登记豁免目录 ${exemptedDirs} 个（域表待补；同一份基线、同一把棘轮）`);
process.exit(0);
