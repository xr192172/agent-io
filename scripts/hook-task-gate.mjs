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
  const hit = nodes.find((x) => x.path && norm(x.path) === target);

  if (!hit) {
    return done(`★ 账外提醒：${target} 不属于任何设计节点 ⇒ 这次改动没有卡能追（可能该先给它建节点/卡）`);
  }
  const card = hit.task;
  if (!card) {
    return done(`★ 账外提醒：节点 ${hit.id} 上没有任务卡 ⇒ 这次改动挂在账外（gate-principle：提醒，不阻断）`);
  }
  if (card.state !== 'claimed') {
    return done(`★ 提醒：节点 ${hit.id} 的卡是「${card.state}」（不是 claimed）⇒ 你改的不是"你在做的活"`);
  }
  // ★ 有 claimed 卡 ⇒ 静默（★ 还差"是不是你领的" —— 见文件头）
  return done('');
});

function done(msg) {
  if (msg) process.stdout.write(msg + '\n');
  process.exit(0); // ★ 永远放行
}
