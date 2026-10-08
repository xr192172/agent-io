/**
 * gen_manifest —— 生成 / 校验 `<project>/MANIFEST.txt`（**卷声明**）。
 *
 * ## 为什么要有它（2026-10-08，用户「合并形态 S1」，`docs/todo.md` T67）
 * 实测病：**"这份认知有哪几个卷"这条心智，此前全仓只住在 `src/infrastructure/storage_overlay.ts` 的注释里** ——
 * README / router skill / mind skill **三处都不写**。后果是**用户和我都不会想到它有三个**（他自己都忘了第三个是什么）。
 * ⇒ 解法不是"再写一篇文档"，而是**放一份声明在数据旁边**：环境自己说清"我这里有几卷、谁是真相、谁能改、谁会被重生成"。
 *
 * ## 四条纪律
 * 1. ★ **只声明，不放数据**。数据仍在原处 ⇒ **不新增真相源**。
 * 2. ★★ **不写运行态**（`state=present/absent`）。★ 这条是**2026-10-09 自查改掉的**：
 *    初版把每卷的存在与否写进文件，而**这份文件要进 Git** ⇒ ① **新克隆**跑 `--check` 会全线报"不一致"；
 *    ② 同一份文件在不同机器上合法地不同 ⇒ **不可复现**。
 *    ⇒ 判据同 `COGNITION.txt`：**进 Git 的东西不许带"此刻/此机"的状态**（运行态由 `--check` 现算）。
 * 3. ★★ **声明必须与磁盘一致，且这一条由本脚本自己执行**（`--check`）：两**方向**都报 ——
 *    ① 声明了但卷表里没有（**文件被手改过**）；② `.agent-io/` 下出现了**没声明的条目**（**新增了卷却忘了登记**）。
 *    ★ 这是"声明文件最容易变废纸"的那一步（写着写着就漂了）⇒ **所以它必须能被机器对账**。
 * 4. ★ 卷表**只在本文件写一处**（`VOLUMES`）。别处再抄一份就是第二真相。
 *
 * ## 用法
 *   node scripts/gen_manifest.mjs [--project <dir>] [--in-data-dir] [--stdout] [--check]
 *   · 默认：写出 **`<project>/MANIFEST.txt`（仓根）** —— ★ 见下面"**为什么默认放仓根**"
 *   · `--in-data-dir`：写进 `<project>/.agent-io/MANIFEST.txt`
 *   · `--stdout`：只打印，不写盘；`--check`：**不写盘**，只对账（不一致 ⇒ 退出 1）
 *
 * ## ★★ 为什么默认写**仓根**
 * 因为**这份声明存在的唯一理由就是"被看见"**：
 *   · 放 `.agent-io/` ⇒ 那目录在目标仓里是 **gitignore 的** ⇒ **文件在，但等于不在**；
 *   · 放**仓根** ⇒ LLM 读仓时**走它本来就在走的通道**（读文件），**不必先知道"有个工具、该调哪个 query"**。
 * ★ 这就是「**file 通道** vs **tool 通道**」之别：tool 通道要求 **服务在跑 + 知道工具存在 + 20 个 query 里挑对**。
 *   实测代价：`query=digest` **早就实现且能用**，却在 `capability_map` / README / router **三处都不点名**
 *   ⇒ **我自己连着四轮都没看见它**，还提议再造一个同功能的 `query=outline`。**这就是 tool 通道的失败模式。**
 * ★ 它**只有 ~1.7KB / 30 行，且只在"卷的布局变了"时才变**（罕见）⇒ **churn 低 ⇒ 适合进 Git**。
 *   ★ 对照 `COGNITION.txt`：**随每次代码改动而变 ⇒ churn 高 ⇒ 不进 Git**，靠工具现渲染。
 *   ⇒ ★★ **判据 = 变更频率**（不是"重要不重要"）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = '.agent-io';
const FORMAT_VERSION = 'agent-io/volumes-v1';
const MANIFEST_NAME = 'MANIFEST.txt';

/**
 * ★ 卷表（**唯一一处**）。`probe` = 该项目根下 `.agent-io/` 里能代表这一卷的条目名。
 * `mode` 语义刻意用不同的词，别混：
 *   · `readonly`        —— 只读，工具不许写；
 *   · `regenerable`     —— **会被重新生成**，人写在里面的东西**可能被覆盖** ⇒ 决策别写这儿；
 *   · `human-authored`  —— **人写的，永不被重生成覆盖**（决策的家）；
 *   · `append-only`     —— 只增不删；
 *   · `derived`         —— 从别的卷**现算**出来，**不是真相**。
 * `secret` ⇒ 该卷**可能含凭据**，声明出来让人知道"这目录里有密钥"。
 */
const VOLUMES = [
  // ── 认知卷（DSL 家族）──
  { id: 'live',      mode: 'readonly',       regen: 'scan',         probe: 'live',           path: `${DATA_DIR}/live/<feature>.dsl.json` },
  { id: 'baseline',  mode: 'readonly',       regen: 'snapshot',     probe: 'baseline',       path: `${DATA_DIR}/baseline/<feature>.dsl.json` },
  { id: 'base',      mode: 'regenerable',    regen: 'scan|write',   probe: 'features',       path: `${DATA_DIR}/features/<feature>.json` },
  { id: 'overlay',   mode: 'human-authored', regen: 'never',        probe: 'features',       path: `${DATA_DIR}/features/<feature>.overlay.json` },
  { id: 'archive',   mode: 'append-only',    regen: 'never',        probe: 'archive',        path: `${DATA_DIR}/archive/<feature>/` },
  { id: 'cognition', mode: 'derived',        regen: 'base+overlay', probe: 'COGNITION.txt',  path: `${DATA_DIR}/COGNITION.txt` },
  // ── 派生卷 ──
  { id: 'index',     mode: 'derived',        regen: 'scan',         probe: 'cache.db',       path: `${DATA_DIR}/cache.db` },
  { id: 'drcache',   mode: 'derived',        regen: 'on-demand',    probe: 'cache',          path: `${DATA_DIR}/cache/` },
  { id: 'drift',     mode: 'derived',        regen: 'check',        probe: 'drift',          path: `${DATA_DIR}/drift/<feature>.drift.json` },
  { id: 'mindmap',   mode: 'derived',        regen: 'render',       probe: 'mindmap',        path: `${DATA_DIR}/mindmap/` },
  { id: 'snapshots', mode: 'append-only',    regen: 'never',        probe: 'code-snapshots', path: `${DATA_DIR}/code-snapshots/` },
  { id: 'dogfood',   mode: 'append-only',    regen: 'never',        probe: 'dogfood',        path: `${DATA_DIR}/dogfood/usage.jsonl` },
  // ── 配置卷（★ 人也写，且可能含凭据）──
  { id: 'gateway',   mode: 'human-authored', regen: 'never',        probe: 'gateway.json',   path: `${DATA_DIR}/gateway.json`, secret: true },
];

/**
 * ★ `.agent-io/` 下**已知但不是卷**的条目（SQLite 边车等）。
 * 判据：它随某个卷一起生灭、没有独立语义 ⇒ 声明它只在制造噪音。
 * ★ 新条目要么进 `VOLUMES`、要么进这里加一行理由 —— **不许默默多出来**。
 */
const NON_VOLUME_ENTRIES = [
  { name: 'cache.db-shm', why: 'SQLite WAL 边车，随 cache.db 生灭' },
  { name: 'cache.db-wal', why: 'SQLite WAL 边车，随 cache.db 生灭' },
  { name: 'MANIFEST.txt', why: '本声明自己（`--in-data-dir` 时才落这里）' },
];

/** ★ 草案配额（T69 会把它变成单点常量 + L1 双边执行；本轮只**声明**它，不执行）。 */
const QUOTA = 'F<=200 R<=300 A<=300 S<=600';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

const projectDir = path.resolve(valOf('--project') ?? process.cwd());
const dataDir = path.join(projectDir, DATA_DIR);
/** ★ 声明文件落点：**默认仓根**（`--in-data-dir` 改回数据目录）。只在这里算一次。 */
const manifestPath = path.join(flag('--in-data-dir') ? dataDir : projectDir, MANIFEST_NAME);

export function renderManifest() {
  const lines = [
    '#AgentIO-MANIFEST: 1',
    `#Format-Version: ${FORMAT_VERSION}`,
    '#',
    '# 本文件**只声明，不放数据**（数据仍在各自路径），也**不记运行态**（哪一卷现在有没有，由 --check 现算）。',
    '# 它回答四个问题：哪几卷 · 谁是真相 · 谁能改（mode） · 谁会被重新生成（regen）',
    '# ★ mode：readonly=只读 | regenerable=**会被重新生成**（别把决策写这儿）',
    '#         human-authored=人写的**永不被覆盖** | append-only=只增 | derived=现算的，不是真相',
    '# ★ secret=该卷可能含凭据（别提交、别外传）',
    '#',
  ];
  for (const v of VOLUMES) {
    lines.push(
      `#Volume: id=${v.id.padEnd(9)} mode=${v.mode.padEnd(14)} regen=${v.regen.padEnd(12)} ` +
        `path=${v.path}${v.secret ? ' secret=true' : ''}`,
    );
  }
  lines.push(
    '#',
    `#Quota: ${QUOTA}`,
    '#Admission: L1-L4（见 src/application/observe/reconcile/reason_validator.ts）—— ★ 我们已有的写入闸，不是新造的',
    '#Derived-From: 本文件由 scripts/gen_manifest.mjs 依卷表生成；`npm run manifest:check` 可对账',
    '',
  );
  return lines.join('\n');
}

/**
 * `--check`：**两方向**对账（只报差异，不改盘）。
 *   ① 文件里声明的 id ⊆ 卷表（多出来的 id ⇒ 文件被手改过）；
 *   ② 卷表里的 id ⊆ 文件（漏 ⇒ 加了卷没重新生成）；
 *   ③ `.agent-io/` 下出现的条目，**每条都得有人认领**（是某卷的 probe，或在 `NON_VOLUME_ENTRIES` 里）。
 *      ★ 第 ③ 条是**这条纪律真正的工作面** —— 本轮它当场抓出 4 个未声明条目（含含密钥的 `gateway.json`）。
 */
export function checkManifest() {
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, why: `MANIFEST.txt 不存在（${manifestPath}）⇒ 先跑一次生成`, extra: [], missing: [], unclaimed: [] };
  }
  const onDisk = fs.readFileSync(manifestPath, 'utf8');
  const declared = new Set([...onDisk.matchAll(/^#Volume: id=(\S+)/gm)].map((m) => m[1]));
  const expected = new Set(VOLUMES.map((v) => v.id));
  const extra = [...declared].filter((id) => !expected.has(id));   // ①
  const missing = [...expected].filter((id) => !declared.has(id)); // ②

  const probes = new Set(VOLUMES.map((v) => v.probe));
  const known = new Set(NON_VOLUME_ENTRIES.map((e) => e.name));
  const unclaimed = []; // ③
  if (fs.existsSync(dataDir)) {
    for (const name of fs.readdirSync(dataDir)) {
      if (probes.has(name) || known.has(name)) continue;
      unclaimed.push(name);
    }
  }
  const ok = extra.length + missing.length + unclaimed.length === 0;
  return { ok, why: ok ? '一致' : '声明与磁盘不一致', extra, missing, unclaimed };
}

const rendered = renderManifest();

if (flag('--stdout')) {
  process.stdout.write(rendered);
  process.exit(0);
}

if (flag('--check')) {
  const r = checkManifest();
  console.log(`对账：${r.why}`);
  if (r.extra.length) console.log(`  ★ 文件里声明了、卷表里没有：${r.extra.join(', ')}（文件被手改过？）`);
  if (r.missing.length) console.log(`  ★ 卷表里有、文件里没写：${r.missing.join(', ')}（加了卷没重新生成？）`);
  if (r.unclaimed.length) console.log(`  ★ .agent-io/ 下有没人认领的条目：${r.unclaimed.join(', ')}` +
    `\n      ⇒ 要么进卷表、要么进 NON_VOLUME_ENTRIES 加一行理由 —— **不许默默多出来**`);
  console.log(r.ok ? '✅ MANIFEST 与卷表一致' : '❌ MANIFEST 与卷表不一致（不静默）');
  process.exit(r.ok ? 0 : 1);
}

fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, rendered, 'utf8');
console.log(`已写出 ${manifestPath}（${rendered.length} 字符 / ${rendered.split('\n').length - 1} 行 / ${VOLUMES.length} 卷）`);
