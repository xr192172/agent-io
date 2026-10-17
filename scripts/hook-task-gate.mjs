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
 * ★ 为什么第一版**只判"有没有 claimed 卡"**、不判"是不是你的"：
 *   "谁在写"这一维还没实现 —— 那正是挂在 `file_src_application_write_gate_ts` 上的那张卡的活
 *   （`WriteActor` / `assertSourceWriteRegisteredFor`）。★ 卡做完，这里再升级成"owner === 我"。
 *
 * ## 四种判定（都是 exit 0）
 *   ① 有 claimed 卡           ⇒ 静默（正常）
 *   ② 有卡但不是 claimed      ⇒ 提醒"你改的不是你在做的活"
 *   ③ 有节点但没有卡          ⇒ 提醒"这次改动挂在账外"
 *   ④ 不属于任何节点          ⇒ 提醒"没有卡能追（可能该建节点）"
 *
 * ## 用法（dry-run 不挂 hook 也能测）
 *   echo '{"tool_input":{"file_path":"src/domain/task_machine.ts"}}' | node scripts/hook-task-gate.mjs
 *
 * ★★★ **提醒频率：每会话每个文件只提醒一次**（2026-10-17 实测后的决定）
 *   覆盖率只有 1.7%（356 个源文件 / 6 个有节点）⇒ 若每次都提醒，**98.3% 的写操作都在响**
 *   ⇒ 半小时内就会学会忽略它 ⇒ ★ **噪音比没有更坏，因为它看起来在工作**。
 *   ⇒ 所以同一会话内，同一个文件**只提醒一次**（记在 `certs/.work/hook-seen-<session>.json`）；
 *     新会话会重新提醒一次（新人新账，不算重复）。
 *   ★ 这不是"降低监管" —— 而是让"监管"配得上被听见。
 */
import fs from 'node:fs';
import path from 'node:path';

let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* 容错：不是 JSON 就当空 */ }

  const ti = input.tool_input || input.toolInput || {};
  const file = ti.file_path || ti.filePath || ti.path || '';
  if (!file) return done(''); // 拿不到文件路径 ⇒ 静默（不打扰）

  const root = input.cwd && fs.existsSync(path.join(input.cwd, 'docs/task-system-plan.dsl.json'))
    ? input.cwd
    : process.cwd();
  const dslPath = path.join(root, 'docs/task-system-plan.dsl.json');
  if (!fs.existsSync(dslPath)) return done('');

  let d;
  try { d = JSON.parse(fs.readFileSync(dslPath, 'utf8')); } catch { return done(''); }

  const norm = (s) => String(s).replace(/\\/g, '/').replace(/^\.\//, '');
  // 取仓库相对路径（去掉 cwd 前缀 / 盘符前缀）
  const n = norm(file);
  const idx = n.indexOf('src/');
  const target = idx >= 0 ? n.slice(idx) : n;

  const nodes = (d.geometry && d.geometry.nodes) || [];
  /** ★ 提醒 = 每会话每文件一次 */
  const remind = (msg) => {
    if (alreadySeen(root, String(input.session_id || input.sessionId || 'nosession'), target)) return done('');
    return done(msg);
  };

  const hit = nodes.find((x) => x.path && norm(x.path) === target);

  if (!hit) {
    return remind(`★ 账外提醒：${target} 不属于任何设计节点 ⇒ 这次改动没有卡能追（可能该先给它建节点/卡）`);
  }
  const card = hit.task;
  if (!card) {
    return remind(`★ 账外提醒：节点 ${hit.id} 上没有任务卡 ⇒ 这次改动挂在账外（gate-principle：提醒，不阻断）`);
  }
  if (card.state !== 'claimed') {
    return remind(`★ 提醒：节点 ${hit.id} 的卡是「${card.state}」（不是 claimed）⇒ 你改的不是"你在做的活"`);
  }
  // ★ 有 claimed 卡 ⇒ 静默（★ 还差"是不是你领的" —— 见文件头）
  return done('');
});

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
