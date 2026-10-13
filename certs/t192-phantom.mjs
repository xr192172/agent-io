/**
 * T192 量具（终版）：**全仓有几处在"叫你去调一个不存在的工具"？**
 *
 * ## 三层收窄（★ 每一层都是被上一层的噪音逼出来的）
 * v1 "任何 snake_case" ⇒ 196 处**不可判别**（字段名/历史叙述全进来了）
 * v2 加"祈使词紧跟名字" ⇒ 92 处，但仍混着**模块名**（`layer_detect`="复用它的判定"）与**字段名**
 * v3 **再排两类**：① 仓里有**同名 `.ts` 文件**的（那是模块，不是工具）② 已知**字段/参数名**
 * ⇒ 剩下的才是 ★ **"看起来是个工具名、但其实不在册"** —— 读者会去调它、然后撞墙。
 *
 * ★ 只报告，不判红（**它不是门**）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';

const known = new Set(TOOL_DEFS.map((d) => d.name));

// 仓内的模块名（有同名 .ts 文件 ⇒ 那是"复用 X 的实现"，不是"去调 X 工具"）
const mods = new Set();
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) {
      mods.add(path.basename(e.name, '.ts'));
      files.push(p.replace(/\\/g, '/'));
    }
  }
};
walk('src');

// 已知字段/参数名（不是工具）
const FIELDS = new Set([
  'feature', 'project_dir', 'file_id', 'node_id', 'edge_id', 'file', 'symbols', 'nodes', 'scope_files',
  'written_files', 'timeout_ms', 'max_depth', 'max_steps', 'max_branches', 'new_file', 'target_file',
  'source_root', 'base_dir', 'warn_lines', 'crit_lines', 'max_files', 'seq', 'weight', 'reason', 'agent',
  'evidence', 'operations', 'action', 'view', 'note', 'layout', 'kind', 'status', 'tags', 'text',
]);

const RE =
  /(?:请先使用|请使用|可以先使用|建议使用|使用|改用|调用|换成|用)\s*[:：]?\s*`?([a-z][a-z0-9]*(?:_[a-z0-9]+){1,3})`?/g;

/** 这些名字是"动作/查询类型"，不是工具 —— 也排除（它们在别的枚举里） */
const ACTION_ISH = new Set([
  'derive_mind_map', 'derive_anim_flow', 'derive_chain', 'derive_algorithm', 'derive_split',
  'guided_tour', 'check_monolith', 'arch_layer', 'inject_replay', 'run_simulation', 'reset_simulation',
]);

const hits = new Map();
for (const f of files) {
  fs.readFileSync(f, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const m of line.matchAll(RE)) {
        const tok = m[1];
        // ★ 误报类：**否定式提及**（"没有 X" / "不是 X"）是在【否认】它，不是指路 ⇒ 跳过
        // ★ 误报类：**否定式提及**（"没有 X 这个工具" / "X 不是工具"）是在【否认】它，不是指路 ⇒ 跳过
        if (/没有\s*[*`]*\s*[a-z_]*\s*[*`]*\s*(这个)?工具|不是\s*`?[a-z_]+`?/.test(line)) continue;
        if (known.has(tok) || mods.has(tok) || FIELDS.has(tok)) continue;
        const kind = ACTION_ISH.has(tok) ? 'action' : 'phantom';
        const key = `${kind}|${tok}`;
        (hits.get(key) ?? hits.set(key, []).get(key)).push(`${f}:${i + 1}  ${line.trim().slice(0, 120)}`);
      }
    });
}

const phantom = [...hits.entries()].filter(([k]) => k.startsWith('phantom|'));
const action = [...hits.entries()].filter(([k]) => k.startsWith('action|'));
const show = (title, arr, note) => {
  console.log(`\n════ ${title}: ${arr.length} 个名字`);
  console.log(note);
  for (const [k, rs] of arr.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ★ ${k.split('|')[1]}  （${rs.length} 处）`);
    for (const r of rs.slice(0, 4)) console.log(`      ${r}`);
  }
};
console.log(`工具总数 ${known.size} · 扫了 ${files.length} 个源文件 · 仓内模块名 ${mods.size} 个`);
show('★★★ 幻影工具（不像模块、不像字段，却像工具名）', phantom, '  ⇒ 读者会去调它 ⇒ 撞墙（★ 这就是用户第 1 步撞的那面墙）');
show('⚠ 指向"某个 action"（那些其实是 `explore_code` 的 action，不是独立工具）', action, '  ⇒ 读者会当工具调 ⇒ 也撞墙（★ 与上者同族，只是名字"确实存在过"）');
