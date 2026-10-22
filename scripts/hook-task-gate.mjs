#!/usr/bin/env node
/**
 * hook-task-gate.mjs —— PreToolUse hook：写文件前**提醒**「这一步有没有你的卡」
 *
 * ★★★ 设计依据（`docs/gate-principle.md`）：
 *   **闸默认是校验器，不是关卡。** 遇到"不通过"先问：**它会损坏数据吗？**
 *   · 无卡改源码 ⇒ **不损坏数据**，只是"没在账上"（记录问题）⇒ ★ **提醒 + 放行 + 留痕**
 *   · 所以本 hook **永远 exit 0**（不阻断）—— 它只负责让"没在账上"这件事**每次都出现在你眼前**。
 *   ★ 阻断留给真正会损坏数据的场景（本 hook 不负责）。
 *
 * ★★★ 2026-10-22（第二版）：**判据不再自己写，一律调 `collectGateCoverage`**
 *   ## 第一版是怎么死的（实测读数，不是推测）
 *   ① 它读 `docs/task-system-plan.dsl.json` —— 那个位置 **2026-10-18 就废弃了**
 *      （`infrastructure/storage.ts#getDesignDir` 头注明写"现在只有一处"：`.agent-io/design/`），
 *      且 `docs/*` 进了 .gitignore ⇒ **文件不存在** ⇒ `if (!existsSync(dslPath)) return done('')`
 *      ⇒ **静默 return** —— 这个自称"每会话提醒"的闸**一次都没提醒过**；
 *   ② 就算把路径改对，它取路径的写法是 `x.path` —— 而册上 650 个节点里**只有 8 个**有 `path`，
 *      543 个 file/doc 节点把路径写在 `description` 里（口径的唯一住处 = `write_gate#nodeFilePath`：
 *      `path` 优先、回落 `description`）⇒ **恒 0 命中** ⇒ 每次写都掉进"不属于任何设计节点"那一支。
 *   ⇒ 两个 bug 叠起来 = 一个"看起来在工作、其实恒不放声"的闸（假绿灯的家族）。
 *   ★ 所以修法**不是**"把那个路径改对"，而是**把判据搬走**：路径口径、节点表、豁免声明这三样
 *     全在 `application/write_gate.ts#collectGateCoverage` 里（写闸自己也读它）
 *     ⇒ 这里**只读它**，不再自建第二张 `path → 节点` 表（本仓头号病就是同一件事两处判，第二处必漂移）。
 *   ★ 代价如实说：本 hook 现在依赖 `dist/`（与写闸同一份编译产物）⇒ **没 build 就提醒不了**。
 *     那不是静默降级：**跑不了会明说**（每会话一次），不会假装"查过了没问题"。
 *
 * ★ 为什么第二版仍**只判"有没有 claimed 卡"**、不判"是不是你的"：
 *   "谁在写"这一维在 `write_gate#assertSourceWriteRegisteredFor`（A7）里，那是**阻断**；
 *   本 hook 是**提醒**，只回答"这一步在不在账上"。
 *
 * ## 四种判定（都是 exit 0）
 *   ① 有 claimed 卡           ⇒ 静默（正常）
 *   ② 有卡但不是 claimed      ⇒ 提醒"你改的不是你在做的活"
 *   ③ 有节点但没有卡          ⇒ 提醒"这次改动挂在账外"
 *   ④ 不属于任何节点          ⇒ 提醒"没有卡能追（可能该建节点）"
 *   ⑤ 节点声明 `gate:'exempt'` ⇒ 静默（写闸按设计侧声明豁免，本 hook 不该唱反调）
 *
 * ## 用法（dry-run 不挂 hook 也能测）
 *   echo '{"tool_input":{"file_path":"src/domain/task_machine.ts"},"cwd":"<仓库根>"}' | node scripts/hook-task-gate.mjs
 *
 * ★★★ **提醒频率：每会话每个文件只提醒一次**（2026-10-17 实测后的决定）
 *   ⇒ 同一会话内，同一个文件**只提醒一次**（记在 `certs/.work/hook-seen-<session>.json`）；
 *     新会话会重新提醒一次（新人新账，不算重复）。
 *   ★ 这不是"降低监管" —— 而是让"监管"配得上被听见。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** 本仓根（hook 住在 `<根>/scripts/` 下）—— 用来定位**与写闸同一份**的 dist 产物 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  // ★ 不用 top-level await：stdin 的 handler 要先挂上，判据（要 import dist）在拿到入参之后再加载
  main(raw).catch((e) => done(`★ 闸自己跑不了（未捕获）：${(e && e.message) || e}`));
});

async function main(raw) {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* 容错：不是 JSON 就当空 */ }

  const ti = input.tool_input || input.toolInput || {};
  const file = ti.file_path || ti.filePath || ti.path || '';
  if (!file) return done(''); // 拿不到文件路径 ⇒ 静默（不打扰）

  const root = path.resolve(input.cwd || process.cwd());
  if (!fs.existsSync(root)) return done('');
  const session = String(input.session_id || input.sessionId || 'nosession');
  const remind = (key, msg) => done(alreadySeen(root, session, key) ? '' : msg);

  // 仓库相对路径（★ 唯一口径：相对**项目根**，不是"从 src/ 开始切"——
  //   scripts/ 与 docs/ 下的节点也是节点，旧写法对它们恒不命中）
  const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
  if (!rel || rel.startsWith('..')) return done(''); // 根外文件不归本册管

  // ★ 册子本体（`.agent-io/`）不是源码：写闸从不为它要卡 ⇒ 这里也不该响（否则又是一条噪音）
  if (rel.startsWith('.agent-io/')) return done('');

  let cov;
  try {
    cov = await coverage(root);
  } catch (e) {
    return remind('!self', `★ 闸自己跑不了：${(e && e.message) || e}\n★ 这一条是**读数**，不是"查过了没问题"——修好它之前本 hook 不提供任何判定。`);
  }
  // 这个项目根不归任何设计册管（`source_root` 指过来的 feature 为 0）⇒ 本闸无事可做
  if (cov.rootFeatureCount === 0) return done('');

  /**
   * ★★ 一个路径可能被**两条 feature** 同时指着（本仓实测：`design-canvas` 175 条 + `task-system-plan` 543 条，
   * 同名节点 id 各有一份 task 格）⇒ 必须**逐条都看**，不能撞见第一条就下结论
   * （第一版修的时候就这样：先撞上 `design-canvas` 的 candidate，把 `task-system-plan` 的 claimed 盖掉了）。
   * ★ 判据与写闸**逐字对齐**（`write_gate.ts` 的 A7 循环）：**任一** feature 上有 claimed 卡就算登记过；
   * 豁免是 AND（指向它的节点**全部** `gate='exempt'` 才免）。
   */
  const hits = [];
  for (const f of cov.features) {
    const nodeId = f.byPath.get(rel);
    if (nodeId) hits.push({ feature: f.feature, nodeId, gate: f.gateByPath.get(rel), task: f.taskById.get(nodeId) });
  }

  if (!hits.length) {
    return remind(rel, `★ 账外提醒：${rel} 不属于任何设计节点 ⇒ 这次改动没有卡能追（可能该先给它建节点/卡）`);
  }
  // ① 设计侧声明了豁免（**全部**指着它的节点都标了）⇒ 写闸按"量具"放行 ⇒ 本 hook 不唱反调
  if (hits.every((h) => h.gate === 'exempt')) return done('');
  // ② 任一 feature 上有 claimed 卡 ⇒ 静默（★ 还差"是不是你领的" —— 那一维在写闸 A7，见文件头）
  const claimed = hits.find((h) => h.task && h.task.state === 'claimed');
  if (claimed) return done('');

  // ③ 有卡但不是 claimed ⇒ 报**离"能做"最近**的那张（先 claimed 之外的任意一张；顺序按 feature 名，稳定）
  const withCard = hits.find((h) => h.task);
  if (withCard) {
    return remind(
      rel,
      `★ 提醒：${rel} 的卡是「${withCard.task.state}」（不是 claimed；节点 ${withCard.nodeId}，feature=${withCard.feature}）` +
        `⇒ 你改的不是"你在做的活"`,
    );
  }
  // ④ 有节点但没有卡 ⇒ 账外
  return remind(
    rel,
    `★ 账外提醒：${rel} 落在节点 ${hits[0].nodeId} 上，但**没有任务卡** ⇒ 这次改动挂在账外（gate-principle：提醒，不阻断）`,
  );
}

/**
 * 判据唯一出处：`write_gate#collectGateCoverage`（写闸自己也读它）。
 * ★ 拿不到就**抛**（由调用方**明说**"闸自己跑不了"），不返回空表 —— 空表会被读成"什么都没命中"。
 */
async function coverage(root) {
  const entry = path.join(REPO, 'dist', 'src', 'application', 'write_gate.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`找不到 ${path.relative(REPO, entry).split(path.sep).join('/')} ⇒ 先 \`npm run build\``);
  }
  const mod = await import(pathToFileURL(entry).href);
  if (typeof mod.collectGateCoverage !== 'function') {
    throw new Error('dist 里的 write_gate 没有导出 collectGateCoverage（版本不对？）');
  }
  return mod.collectGateCoverage(root);
}

function done(msg) {
  if (msg) process.stdout.write(msg + '\n');
  process.exit(0); // ★ 永远放行
}

/**
 * ★ 同一个文件在本会话内只提醒一次。
 * 返回 true ⇒ 已经提醒过（调用方应静默）。
 */
function alreadySeen(root, sessionId, target) {
  const dir = path.join(root, 'certs/.work');
  const f = path.join(dir, `hook-seen-${String(sessionId || 'nosession').slice(0, 12)}.json`);
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* 首次 */ }
  if (seen[target]) return true;
  seen[target] = new Date().toISOString();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(seen, null, 1));
  } catch { /* 记不住就不记，宁可多提醒一次 */ }
  return false;
}
