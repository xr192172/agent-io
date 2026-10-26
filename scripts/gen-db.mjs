#!/usr/bin/env node
/**
 * design:gen-db —— **生成** design-db（不是门；门是 `gen-db:check`）
 *
 * ## 为什么需要它（2026-10-26）
 * `design-db/` 是**册的纯投影**：任何 commit 上 checkout 册 + 跑一次本脚本就能重建
 * ⇒ 它是**构建产物**，**不进 git**（寄风裁定：「本地已有类 git 的 before/after」——
 * 册的 `_dsl_rev` / `decision_history` / snapshot 就是 before/after，派生品不必再存一份）。
 *
 * ★ 但 `gen-db:check` 是门：design-db 不在盘上时它会全报"缺" ⇒ 门会假红。
 *   ⇒ 所以门必须先**生成**再**校验**（标准 build-then-check），本脚本就是那一步。
 *
 * ★ 生成是**确定性**的（同一份册 ⇒ 逐字节同一份 design-db）⇒ 先跑本脚本再校验，
 *   校验通过就证明"册与投影一致"，与"投影有没有进 git"无关。
 *
 * 用法：node scripts/gen-db.mjs [--feature <name>]
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const argOf = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const feature = argOf('--feature');

const mod = await import(pathToFileURL(path.join(ROOT, 'dist', 'src', 'application', 'design', 'db', 'gen_design_db.js')).href);
const res = mod.genDesignDb(ROOT, feature ? { feature } : {});

console.log(
  `[design:gen-db] features=${res.features ?? '-'} files=${res.files} written=${res.written} ` +
    `pruned=${res.pruned} problems=${res.problems?.length ?? 0}`,
);
if (res.problems?.length) {
  for (const p of res.problems.slice(0, 10)) console.log('  ✗', typeof p === 'string' ? p : JSON.stringify(p).slice(0, 160));
  process.exit(1);
}
