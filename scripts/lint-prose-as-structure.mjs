#!/usr/bin/env node
/**
 * lint:prose-as-structure —— **散文不许当结构用**（一条 lint 治一个反复出现的根因）
 *
 * ## 为什么要它（2026-10-26，一天内抓到 5 处同源）
 * 同一个根因犯了五次：`description` / `summary` 是**散文**，却被当成**结构**读：
 *   ① `design-check` 拿 `node.description` 当 path（D1 误判手写节点）
 *   ② `write_gate#nodeFilePath` 回落 `description`（"path 优先"但一半节点没 path）
 *   ③ `node.update` 的 `responsibility` 优先级（旧值永远赢，更新分支失效）
 *   ④ `gen_design_db` 拿 `description` 当 design-db 的**文件名**（整句中文当文件名）
 *   ⑤ `project_task-system-plan` 的 `decision.summary` 里写死过期根路径（权威是 `source_root`）
 * ⇒ 逐个抓不是治法（第五处说明根还在）。**治法是让它一出现就红。**
 *
 * ## 三条可机器判的判据（只判能判的，判不了的不假装判）
 * A. `type:'file'` 的节点：`description` 像仓库相对路径，但 **`path` 缺失**
 *    ⇒ 错。消费者只能回落散文（②③④ 的温床）。
 * B. `type:'file'` 的节点：`path` **不像**仓库相对路径（含中文 / 盘符 / 反斜杠开头）
 *    ⇒ 错。它会变成 design-db 的**文件名**（④ 的实证）。
 * C. 任一节点的 `decision.summary` 里出现**绝对路径**（`D:/…` 或 `D:\…`）
 *    ⇒ 错。根路径的权威是册顶层 `source_root`；散文里再写一遍必分叉（⑤ 的实证）。
 *
 * ★ 判不了的一律**不判**（不假装）：比如"summary 里提到的相对路径是否过期"——那要人看。
 *
 * 用法：node scripts/lint-prose-as-structure.mjs [--json]
 * 退出码：0 = 无问题；1 = 有问题（可当门）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const JSON_OUT = process.argv.includes('--json');

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
/** 像仓库相对路径：至少一段目录 + 一个扩展名 */
const looksLikeRepoPath = (s) => /^[\w.\-]+\/[\w./\-]*\.(ts|tsx|mjs|cjs|js|jsx|go|py|java|cs|c|cc|cpp|json|md|sh)$/.test(norm(s));
/** 含中文（文件名不该有） */
const hasCjk = (s) => /[\u4e00-\u9fff]/.test(String(s ?? ''));
/** 含绝对路径（盘符） */
const hasAbsPath = (s) => /[A-Za-z]:[\\/]/.test(String(s ?? ''));

const problems = [];
if (!fs.existsSync(DESIGN_DIR)) {
  console.log('[lint:prose-as-structure] 没有 design 目录 ⇒ 无事可判');
  process.exit(0);
}

for (const f of fs.readdirSync(DESIGN_DIR).filter((x) => x.endsWith('.dsl.json')).sort()) {
  const feature = f.replace(/\.dsl\.json$/, '');
  const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
  for (const n of dsl.geometry?.nodes ?? []) {
    const desc = norm(n.description);
    const p = norm(n.path);
    const isFile = n.type === 'file';

    // A：description 像路径、但 path 缺失
    if (isFile && !p && looksLikeRepoPath(desc)) {
      problems.push({ feature, id: n.id, rule: 'A', msg: `description 像路径（${desc}）但 path 缺失 ⇒ 消费者只能回落散文` });
    }
    // B：path 不像仓库相对路径
    if (isFile && p && (!looksLikeRepoPath(p) || hasCjk(p) || hasAbsPath(p))) {
      problems.push({ feature, id: n.id, rule: 'B', msg: `path 不像仓库相对路径（${p}）⇒ 会变成 design-db 文件名` });
    }
    // C：summary 里出现绝对路径
    const sum = String(n.decision?.summary ?? '');
    if (hasAbsPath(sum)) {
      const hit = (sum.match(/[A-Za-z]:[\\/][^\s，。）)]*/g) ?? []).slice(0, 2).join(' ');
      problems.push({ feature, id: n.id, rule: 'C', msg: `decision.summary 里写死绝对路径（${hit}）⇒ 权威是 source_root` });
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ checked_features: fs.readdirSync(DESIGN_DIR).filter((x) => x.endsWith('.dsl.json')).length, problems }, null, 2));
} else {
  if (problems.length === 0) {
    console.log('[lint:prose-as-structure] ✓ 无问题（散文没有在当结构用）');
  } else {
    console.log(`[lint:prose-as-structure] ✗ ${problems.length} 处散文当结构：`);
    for (const p of problems.slice(0, 40)) console.log(`  · [${p.rule}] ${p.feature}/${p.id}\n      ${p.msg}`);
    if (problems.length > 40) console.log(`  …另有 ${problems.length - 40} 处`);
  }
}
process.exit(problems.length ? 1 : 0);
