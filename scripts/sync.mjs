#!/usr/bin/env node
/**
 * sync.mjs —— ③ 设计侧保鲜【双向】：补 + 清
 *
 * ## 为什么需要它
 * `fork` 只做一次（实际 DSL → 设计 DSL）。之后两条线各自前进：
 *   · Agent 绕过工具改源码 ⇒ `live/` 多出文件 ⇒ **要"补"进 design**
 *   · 人删了源码 / 删了设计 ⇒ 另一边还挂着 ⇒ **要"清"**
 * 没有它，`design/` 会慢慢变成"源码的化石"（今天实测：23 个节点还挂着我删掉的文件）。
 *
 * ## 判据（只用【存在性】—— 唯一可靠的那层）
 * ```
 * live 有 · design 没有  ⇒ 补（待 sync）
 * design 有 · live 没有  ⇒ 清（设计领先/孤儿）
 * 都有 / 都无            ⇒ 无事
 * ```
 * ★ 不比语义：`design/` 的 semantic 是 fork 快照，`cache.db` 的 call 边只同文件
 *   ⇒ 任何"内容比较"都会产假象（见 docs/MERGE.md §6）。
 *
 * ## 用法
 *   node scripts/sync.mjs                 # 只出清单（零写入）
 *   node scripts/sync.mjs --apply         # 真删 design 里的孤儿节点
 *   node scripts/sync.mjs --feature=xxx
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const FEATURE = argOf('feature') ?? 'task-system-plan';
const APPLY = process.argv.includes('--apply');

const BS = String.fromCharCode(92);
const norm = (s) => String(s ?? '').split(BS).join('/');

const readDsl = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const design = readDsl(path.join(ROOT, '.agent-io', 'design', `${FEATURE}.dsl.json`));
const live = readDsl(path.join(ROOT, '.agent-io', 'live', `${FEATURE}.dsl.json`));
if (!design || !live) {
  console.error('★ 缺 design/ 或 live/ 的 DSL');
  process.exit(2);
}

/** 只取"src/ 开头的文件节点" */
const fileNodes = (dsl) =>
  new Map(
    (dsl.geometry?.nodes ?? [])
      .filter((n) => norm(n.description).startsWith('src/'))
      .map((n) => [norm(n.description), n]),
  );

const D = fileNodes(design);
const L = fileNodes(live);

const toAdd = []; // live 有、design 没有
const toRemove = []; // design 有、live 没有

for (const [rel] of L) if (!D.has(rel)) toAdd.push(rel);
for (const [rel, n] of D) if (!L.has(rel)) toRemove.push({ rel, id: n.id });

console.log(`════ SYNC · ${FEATURE} ════`);
console.log(`  design ${D.size} 文件 · live ${L.size} 文件`);
console.log(`  ★ 待补（实际有、设计没有）: ${toAdd.length}`);
console.log(`  ★ 待清（设计有、实际没有）: ${toRemove.length}`);

if (toAdd.length) {
  console.log('\n  ── 待补（前 12，需要 node.add，本脚本不自动做）──');
  for (const r of toAdd.slice(0, 12)) console.log(`     + ${r}`);
}
if (toRemove.length) {
  console.log('\n  ── 待清（前 12，可自动 node.remove）──');
  for (const r of toRemove.slice(0, 12)) console.log(`     - ${r.rel}   (${r.id})`);
}

if (!APPLY) {
  console.log('\n  ★ 零写入。加 --apply 才真删"待清"（"待补"一律不自动做——它要人写 decision）。');
  process.exit(0);
}

if (toRemove.length === 0) {
  console.log('\n  ✓ 没有要清的');
  process.exit(0);
}

// ── 真删：**先删指向它的边，再删节点**（否则 validateDSL 的自洽闸会拒）──
const { updateFeature } = await import(
  pathToFileURL(path.join(ROOT, 'dist/src/application/design/dsl_ops/update_feature.js')).href
);

const edges = design.geometry?.edges ?? [];
const removedIds = new Set(toRemove.map((r) => r.id));

// ★ 自洽闸的规则："不能有悬空边" ⇒ 删节点前必须先删所有 from/to 指向它的边
const orphanEdges = edges.filter((e) => removedIds.has(e.from) || removedIds.has(e.to));

let ok = 0;
const failed = [];

// ① 先删边
if (orphanEdges.length) {
  const ops = orphanEdges.map((e) => ({ type: 'edge', op: 'delete', id: e.id }));
  try {
    // 分批（一次太多可能触顶；20 条一批）
    for (let i = 0; i < ops.length; i += 20) {
      await updateFeature({ feature: FEATURE, agent: 'sync-script', operations: ops.slice(i, i + 20) });
    }
    console.log(`\n  ✓ 已删 ${orphanEdges.length} 条悬空边`);
  } catch (e) {
    console.log(`\n  ✗ 删边失败：${String(e).slice(0, 120)}`);
  }
}

// ② 再删 semantic.files 条目（否则 anchor_broken：semantic.files.id 在 geometry.nodes 找不到）
{
  const semIds = new Set((design.semantic?.files ?? []).map((f) => f.id));
  const toDel = toRemove.filter((r) => semIds.has(r.id));
  if (toDel.length) {
    for (const r of toDel) {
      try {
        await updateFeature({
          feature: FEATURE,
          agent: 'sync-script',
          operations: [{ type: 'file', op: 'delete', id: r.id }],
        });
      } catch (e) {
        console.log(`  ✗ 删 semantic.files 失败 ${r.rel}：${String(e).slice(0, 80)}`);
      }
    }
    console.log(`  ✓ 已删 ${toDel.length} 条 semantic.files`);
  }
}

// ③ 最后删节点
for (const r of toRemove) {
  try {
    await updateFeature({
      feature: FEATURE,
      agent: 'sync-script',
      operations: [{ type: 'node', op: 'delete', id: r.id }],
    });
    ok++;
  } catch (e) {
    failed.push({ rel: r.rel, why: String(e).slice(0, 100) });
  }
}

console.log(`  ✓ 已删 ${ok} 个节点 · ✗ 失败 ${failed.length}`);
for (const f of failed.slice(0, 6)) console.log(`     ${f.rel} ← ${f.why}`);
