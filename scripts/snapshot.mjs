/**
 * snapshot —— **代码功能快照**：记一份「当前行为」的指纹 → 重写后重跑 → 逐点比。
 *
 * 由来（用户 2026-10-08 的提议）：
 *   *「有没有办法做一个通用型的、保留代码功能快照，快速布下探针看是否和原来一样？」*
 *   —— 我这几轮的对照脚本每次都是**临时手写**的，而它们本质是同一件事：
 *     **把"当前行为"记成可比数据，改完再比**。本文件把它通用化。
 *
 * 用法：
 *   node scripts/snapshot.mjs list            # 看观测点表
 *   node scripts/snapshot.mjs take            # 跑全部观测点 → `.snapshots/behavior.json`
 *   node scripts/snapshot.mjs diff            # 重跑并与快照逐点比（差异 = 行为变了）
 *
 * ★★ 两条铁律（决定这机制有没有用，不是形式）：
 *   ① **只记「函数的行为」，不记「仓库的当前状态」**。
 *      后者每次提交都变（文件数 / 行数 / 依赖图规模）⇒ diff 噪声会淹没信号。
 *      实测：`probe:edges`（现扫 vs 索引库对照）**随提交变化** ⇒ 它是"体检"、不是"行为指纹"，
 *      **不进快照**（要看它就单独跑）。
 *   ② **观测点必须确定**：输入固定 ⇒ 输出固定；不许有时间戳 / 绝对路径 / 随机序。
 *      ★ 且**与机器环境有关**的部分要显式声明（见 `_meta.env` 与 diff 的环境闸），
 *        否则换台机器 diff 会全红，人就不看了。
 *
 * ★ 观测点的**输入表住在探针里**（单一事实源）——本文件只负责"跑、取、比"，不重复定义。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SNAP = path.join(REPO, '.snapshots', 'behavior.json');

/** 观测点表：每个探针都要有 `--json`（只吐可比数据）。★ 全部是「函数行为」，不含仓库状态 */
const OBS = [
  { name: 'completion-candidates', script: 'scripts/probe_cc_equiv.mjs', note: 'import 候选表生成（纯函数，顺序即行为）' },
  { name: 'binding-generation', script: 'scripts/probe_verdict_grid.mjs', note: '装包代际 → verdict（纯判据，穷举事实）' },
  { name: 'xfile-resolve', script: 'scripts/probe_xfile_resolve.mjs', note: '跨文件 import 解析（依赖语言包 ⇒ 见 env 闸）' },
  { name: 'extract-minimal', script: 'scripts/probe_extract_quality.mjs', note: '逐语言最小样本的 符号/import/调用（依赖语言包 ⇒ 见 env 闸）' },
];

const runObs = (o) => {
  const out = execFileSync(process.execPath, [o.script, '--json'], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26 });
  // ★ 只取**最后一行有效 JSON** —— 实测有探针会在 JSON 之前先打一行人读口径
  //   （`probe_xfile_resolve` 打「候选后缀取生产口径…」）。
  //   ⇒ 观测器**容忍**它，比要求所有探针都纯净更实际（探针照样可以直接被人读）。
  const line = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('[') || l.startsWith('{'))
    .pop();
  if (!line) throw new Error(`${o.name}: 输出里没找到 JSON 行`);
  return JSON.parse(line);
};

/** 当前环境（快照的**有效性边界**：这些一变，快照就不该拿来比） */
const envOf = () => {
  let core = '?';
  try { core = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', 'tree-sitter', 'package.json'), 'utf8')).version; } catch { /* 没装 */ }
  return { core, node: process.version, platform: `${process.platform}-${process.arch}` };
};

function diffDeep(a, b, p = '') {
  const out = [];
  if (a === b) return out;
  const prim = (x) => x === null || typeof x !== 'object';
  if (prim(a) || prim(b) || Array.isArray(a) !== Array.isArray(b)) { out.push({ path: p || '(root)', old: a, now: b }); return out; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p2 = Array.isArray(a) ? `${p}[${k}]` : p ? `${p}.${k}` : k;
    if (!(k in a) || !(k in b)) out.push({ path: p2, old: a[k], now: b[k] });
    else out.push(...diffDeep(a[k], b[k], p2));
  }
  return out;
}

const cmd = process.argv[2] ?? 'list';

if (cmd === 'list') {
  console.log('观测点（每个都是「函数行为」，不含仓库状态）：\n');
  for (const o of OBS) console.log(`  ${o.name.padEnd(24)} ${o.script}\n      ${o.note}`);
  console.log(`\n快照文件：${path.relative(REPO, SNAP)}`);
  console.log(`当前环境：${JSON.stringify(envOf())}`);
} else if (cmd === 'take') {
  const obs = {};
  for (const o of OBS) { obs[o.name] = runObs(o); }
  fs.mkdirSync(path.dirname(SNAP), { recursive: true });
  fs.writeFileSync(SNAP, JSON.stringify({ _meta: { takenAt: new Date().toISOString(), env: envOf(), obsCount: OBS.length }, obs }, null, 1) + '\n');
  console.log(`已记快照 → ${path.relative(REPO, SNAP)}`);
  for (const o of OBS) console.log(`  ${o.name.padEnd(24)} ${JSON.stringify(obs[o.name]).length} 字节`);
} else if (cmd === 'diff') {
  if (!fs.existsSync(SNAP)) { console.error('没有快照；先跑 take'); process.exit(2); }
  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const env = envOf();
  // ★ 环境闸：快照只在**同一环境**下可比（否则"语言包版本变了"会被误读成"行为变了"）
  const envSame = JSON.stringify(snap._meta.env) === JSON.stringify(env);
  console.log(`快照环境: ${JSON.stringify(snap._meta.env)}`);
  console.log(`当前环境: ${JSON.stringify(env)}${envSame ? '  ✓ 一致' : '  ★ 不一致 —— 含语言包的观测点差异**不一定**是行为变化'}`);
  console.log(`快照时间: ${snap._meta.takenAt}\n`);
  let bad = 0;
  for (const o of OBS) {
    const now = runObs(o);
    const d = diffDeep(snap.obs[o.name], now);
    if (!d.length) { console.log(`  ✅ ${o.name.padEnd(24)} 与快照一致`); continue; }
    bad++;
    console.log(`  ❌ ${o.name.padEnd(24)} **${d.length} 处差异**`);
    for (const x of d.slice(0, 4)) {
      console.log(`       ${x.path}`);
      console.log(`         旧: ${JSON.stringify(x.old)?.slice(0, 110)}`);
      console.log(`         新: ${JSON.stringify(x.now)?.slice(0, 110)}`);
    }
    if (d.length > 4) console.log(`       …还有 ${d.length - 4} 处`);
  }
  console.log(bad ? `\n❌ ${bad}/${OBS.length} 个观测点与快照不一致 ⇒ **行为变了**（要么修回，要么 take 更新快照并说明为什么）` : `\n✅ ${OBS.length} 个观测点全部与快照一致 ⇒ 行为未变`);
  process.exitCode = bad ? 1 : 0;
} else {
  console.log('用法: node scripts/snapshot.mjs list|take|diff');
}
