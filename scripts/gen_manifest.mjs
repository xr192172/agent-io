/**
 * gen_manifest —— 生成 / 校验 `<project>/.agent-io/MANIFEST.txt`（**卷声明**）。
 *
 * ## 为什么要有它（2026-10-08，对应用户「合并形态 S1」，`docs/todo.md` T67）
 * 实测病：**"这份认知有哪几个卷"这条心智，此前全仓只住在 `src/infrastructure/storage_overlay.ts` 的注释里** ——
 * README / router skill / mind skill **三处都不写**。后果是**用户和我都不会想到它有三个**（他自己都忘了第三个是什么）。
 * ⇒ 解法不是"再写一篇文档"，而是**放一份声明在数据旁边**：环境自己说清"我这里有几卷、谁是真相、谁能改、谁会被重生成"。
 *
 * ## 三条纪律
 * 1. ★ **只声明，不放数据**。数据仍在原处（`features/` / `live/` / …）⇒ **不新增真相源**。
 * 2. ★★ **声明必须与磁盘一致**，而且**这一条由本脚本自己执行**（`--check`）：
 *    声明了不存在的卷 ⇒ **报错退出 1**（**不许静默**）；磁盘上多出未声明的卷 ⇒ 同样报出来。
 *    ★ 这就是"声明文件"最容易变成废纸的那一步（写着写着就漂了）—— **所以它必须能被机器对账**。
 * 3. ★ 卷表**只在本文件写一处**（`VOLUMES`）。别处再抄一份就是第二真相
 *    （本仓教训：同一判据住两处、各持一份）。
 *
 * ## 用法
 *   node scripts/gen_manifest.mjs [--project <dir>] [--stdout] [--check]
 *   · 默认：写出 `<project>/.agent-io/MANIFEST.txt`
 *   · `--stdout`：只打印，不写盘（看将要写什么）
 *   · `--check`：**不写盘**，只对账；不一致 ⇒ 退出 1
 *   · `--project` 缺省 = cwd（★ 本仓禁 `cwd` 兜底，但**这是一个显式 CLI 工具**，
 *     它的"项目"就是操作者站的地方，与在工具内部偷偷 `?? process.cwd()` 不是一回事）
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = '.agent-io';
const FORMAT_VERSION = 'agent-io/volumes-v1';

/**
 * ★ 卷表（**唯一一处**）。`present` 判据 = 该 `probe` 路径在磁盘上存在。
 * `mode` 语义刻意用三个不同的词，别混：
 *   · `readonly`        —— 只读，工具不许写（写了就是 bug）；
 *   · `regenerable`     —— **会被重新生成**，人写在里面的东西**可能被覆盖** ⇒ 决策别写这儿；
 *   · `human-authored`  —— **人写的，永不被重生成覆盖**（决策的家）；
 *   · `append-only`     —— 只增不删；
 *   · `derived`         —— 从别的卷**现算**出来，随时可重生成，**不是真相**。
 */
const VOLUMES = [
  { id: 'live',      mode: 'readonly',       regen: 'scan',          probe: 'live',              path: 'live/<feature>.dsl.json' },
  { id: 'baseline',  mode: 'readonly',       regen: 'snapshot',      probe: 'baseline',          path: 'baseline/<feature>.dsl.json' },
  { id: 'base',      mode: 'regenerable',    regen: 'scan|write',    probe: 'features',          path: 'features/<feature>.json' },
  { id: 'overlay',   mode: 'human-authored', regen: 'never',         probe: 'features',          path: 'features/<feature>.overlay.json' },
  { id: 'archive',   mode: 'append-only',    regen: 'never',         probe: 'archive',           path: 'archive/<feature>/' },
  { id: 'cognition', mode: 'derived',        regen: 'base+overlay',  probe: 'COGNITION.txt',     path: 'COGNITION.txt' },
  { id: 'index',     mode: 'derived',        regen: 'scan',          probe: 'cache.db',          path: 'cache.db' },
  { id: 'drift',     mode: 'derived',        regen: 'check',         probe: 'drift',             path: 'drift/<feature>.drift.json' },
  { id: 'snapshots', mode: 'append-only',    regen: 'never',         probe: 'code-snapshots',    path: 'code-snapshots/' },
];

/** ★ 草案配额（T69 会把它变成单点常量 + L1 双边执行；本轮只**声明**它，不执行）。 */
const QUOTA = 'F<=200 R<=300 A<=300 S<=600';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const projectDir = path.resolve(valOf('--project') ?? process.cwd());
const dataDir = path.join(projectDir, DATA_DIR);

/** 卷在磁盘上存在吗？—— ★ 判据只有这一处（`VOLUMES[].probe` 存在性） */
export function volumeState(v) {
  return fs.existsSync(path.join(dataDir, v.probe)) ? 'present' : 'absent';
}

export function renderManifest() {
  const lines = [
    '#AgentIO-MANIFEST: 1',
    `#Format-Version: ${FORMAT_VERSION}`,
    '#',
    '# 本文件**只声明，不放数据**（数据仍在各自路径）—— 它回答四个问题：',
    '#   哪几卷 · 谁是真相 · 谁能改（mode） · 谁会被重新生成（regen）',
    '# ★ mode 三个词别混：readonly=只读 | regenerable=**会被重新生成**（别把决策写这儿）',
    '#                    | human-authored=人写的**永不被覆盖** | append-only=只增 | derived=现算的，不是真相',
    '#',
  ];
  for (const v of VOLUMES) {
    const st = volumeState(v);
    lines.push(
      `#Volume: id=${v.id.padEnd(9)} mode=${v.mode.padEnd(14)} regen=${v.regen.padEnd(12)} ` +
        `state=${st.padEnd(7)} path=${v.path}`,
    );
  }
  lines.push(
    '#',
    `#Quota: ${QUOTA}`,
    '#Admission: L1-L4（见 src/application/observe/reconcile/reason_validator.ts）—— ★ 我们已有的写入闸，不是新造的',
    '#Derived-From: 本文件由 scripts/gen_manifest.mjs 依磁盘实况生成；--check 可对账',
    '',
  );
  return lines.join('\n');
}

/** --check：拿磁盘上那份去对账（★ 只报差异，不改盘） */
export function checkManifest() {
  const file = path.join(dataDir, 'MANIFEST.txt');
  if (!fs.existsSync(file)) return { ok: false, why: `MANIFEST.txt 不存在（${file}）⇒ 先跑一次生成`, stale: [], missing: [], undeclared: [] };
  const onDisk = fs.readFileSync(file, 'utf8');
  const declared = new Map();
  for (const m of onDisk.matchAll(/^#Volume: id=(\S+)[^\n]*state=(\S+)/gm)) declared.set(m[1], m[2]);
  const missing = [], stale = [];
  for (const v of VOLUMES) {
    const real = volumeState(v);
    if (real === 'present' && !declared.has(v.id)) missing.push(v.id);        // 磁盘有、声明没有
    if (real === 'present' && declared.get(v.id) === 'absent') stale.push(v.id); // 声明说没有、其实有
    if (real === 'absent' && declared.has(v.id) && declared.get(v.id) === 'present') stale.push(v.id); // 反向
  }
  const undeclared = VOLUMES.filter((v) => !declared.has(v.id)).map((v) => v.id);
  const drift = missing.length + stale.length + undeclared.length > 0;
  return { ok: !drift, why: drift ? '声明与磁盘不一致' : '一致', stale, missing, undeclared };
}

const rendered = renderManifest();

if (flag('--stdout')) {
  process.stdout.write(rendered);
  process.exit(0);
}

if (flag('--check')) {
  const r = checkManifest();
  console.log(`对账：${r.why}`);
  if (r.undeclared.length) console.log(`  未声明的卷：${r.undeclared.join(', ')}`);
  if (r.stale.length) console.log(`  ★ 声明与实况不符：${r.stale.join(', ')}（声明说 absent/present，实际相反）`);
  if (r.missing.length) console.log(`  ★ 磁盘有但没声明：${r.missing.join(', ')}`);
  console.log(r.ok ? '✅ MANIFEST 与磁盘一致' : '❌ MANIFEST 与磁盘不一致（不静默）');
  process.exit(r.ok ? 0 : 1);
}

fs.mkdirSync(dataDir, { recursive: true });
const out = path.join(dataDir, 'MANIFEST.txt');
fs.writeFileSync(out, rendered, 'utf8');
console.log(`已写出 ${out}（${rendered.length} 字符 / ${rendered.split('\n').length - 1} 行）`);
const state = VOLUMES.map((v) => `${v.id}=${volumeState(v)}`).join(' ');
console.log(`卷状态：${state}`);
