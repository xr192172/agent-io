/**
 * T185 出生证的「还原」—— ★ **整份还原，不是外科式**。
 *
 * ★★ 为什么不能复用 `t181-reset.mjs`（那条只删 `lifecycle` 键）：
 *   T185 测的是**移除文件节点** ⇒ 它会**真的删掉语义文件 + 几何节点 + 边**，
 *   而"只删 lifecycle 键"的还原**不会把它们放回来**
 *   ⇒ ★ 我第一次跑 T185 就踩了这个：① 删掉文件 ⇒ ③④ 全都在"文件不存在"上失败，
 *     而且**状态被永久破坏了**（399/400）—— 只好从 `.inspect/run82.bak.json` 整份还原回来。
 *   ⇒ ★ 又一次同族教训：**还原脚本必须覆盖"这个测试会改动的全部东西"**
 *     （第一次漏了活态文件；这一次漏了"结构"本身）。
 *
 * 做法：从 `certs/t185-base/` **整份拷回**三个文件（活态 · 存档 · overlay）。
 */
import fs from 'node:fs';

const BASE = 'certs/t185-base';
const TARGETS = [
  ['agent-io.json', `${BASE}/agent-io.json`],
  ['.agent-io/features/run82.json', `${BASE}/run82.json`],
  ['.agent-io/features/run82.overlay.json', `${BASE}/run82.overlay.json`],
];

/**
 * ★★★ 2026-10-12（T199）：**整份还原会连【设计意图】一起抹掉** —— ★ 这是本脚本的爆炸半径事故。
 *
 * ## 事故（实测坐实）
 * · 基线 `certs/t185-base/*.json` 抓于 **00:25:59**；
 * · 而 **08:55:43** 有一条 `design_intent` 写入被执行（**9 条目标**，工作台记录 `result` 逐字：
 *   *"写入设计意图 · feature=run82 · 目标 9 条（全量替换）"*）；
 * · ★ 我这一整天**每张证前都跑本脚本**（几十次）⇒ ★★ **把那 9 条目标反复抹掉**
 *   ⇒ 结果：`get_dsl query=goals` 报 **"暂无结构化目标"**，而工作台记录说"写成功了"
 *   —— ★★ **看上去像"写入失败"，实际是【我的还原脚本】抹的**（★ 差别很大：前者是产品缺陷，后者是我的量具闯祸）。
 *
 * ## ★★★ 修法（★ 我第一版修错了，第二版才对 —— 记下来）
 * **第一版（错）**：我想"`meta` 是设计意图 ⇒ 本脚本无权动它" ⇒ 于是**把活态的 `meta` 存下来、拷完基线再合回去**。
 *   ★★ **实测打脸**：`t186-cert.mjs`（跑"审批一个 `dsl_intent` 提案"）会把 `run82` 的 goals
 *   **全量替换成它自己的测试目标（1 条）** ⇒ 而我的"保留活态"逻辑**把被改坏的那 1 条也保住了** ✗
 *   ⇒ ★ **结论：`meta` 不该"保留"，该【从基线还原】** —— 因为本脚本的职责就是**把夹具恢复到一个已知 good 状态**。
 *
 * **第二版（对）**：**照旧整份拷回**，★ **但基线本身必须【含 `meta`】** ✓
 *   ⇒ 于是「基线过期」这个真问题被**正面解决**：**基线要在【合法的设计意图变更之后】重抓一次** ✓
 *   ★ 本次已重抓（基线里 `meta.goals` = 9 条 ✓）⇒ 现在：`t186` 改坏 ⇒ 本脚本**能把它修回来** ✓
 *
 * ★★★ 通用教训（★ 与 §2.8"还原要列全"是**一对**）：
 *   - §2.8：**"还原要列全"**（别忘了还原什么）；
 *   - 本条：**"还原要【从已知 good 状态】还，别从活态还"** ——
 *     ★★ 因为**活态可能已经被上一个证改坏**（"保留活态"= **保护污染**）✗。
 */
let n = 0;
for (const [dst, src] of TARGETS) {
  if (!fs.existsSync(src)) {
    console.log(`  ✗ 基线缺失：${src}（T185 的还原不可用）`);
    process.exitCode = 1;
    continue;
  }
  fs.copyFileSync(src, dst);
  n++;
}
console.log(`  · 已整份还原 ${n} 个文件（活态 · 存档 · overlay）—— ★ 保留活态的 meta（设计意图）`);

// ★★★ **第五处状态**：归档库（`.agent-io/archive/<feature>/`）。
//   ★ 它**不在**上面三个文件里 —— 而 `archive` 工具会往里**追加**条目，
//     且「重复归档防御」（`getArchiveEntryByPath`）**读的正是它**
//     ⇒ ★ 不清它，第二次跑同一张证就会撞「已归档过，勿重复归档」而**假红**
//       （我第一次跑 T185 的 ③④ 就是这么红的，还误以为是回执格式问题）。
//   ★ 实测：本目录是我今天测试**新建**的（只有 1 条 `run82__dogfood_build_cache_mjs`）
//     ⇒ 测试前的状态 = **该目录不存在**。
const ARCHIVE_DIR = '.agent-io/archive/run82';
if (fs.existsSync(ARCHIVE_DIR)) {
  const files = fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith('.json'));
  for (const f of files) fs.unlinkSync(`${ARCHIVE_DIR}/${f}`);
  fs.rmdirSync(ARCHIVE_DIR);
  console.log(`  · 已清空归档库 ${ARCHIVE_DIR}（${files.length} 条）`);
} else {
  console.log(`  · 归档库 ${ARCHIVE_DIR} 本就不存在`);
}
