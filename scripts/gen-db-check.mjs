#!/usr/bin/env node
/**
 * gen-db-check —— 「设计要求进没进设计 DB」的**门**（第 6 逆门）。
 *
 * ## 为什么它是门，而 `design_line action=gen-db check=true` 不是
 * `check=true` 比的是**整份字节**，其中 `symbols` / `imports` / `calls` 来自 `cache.db` ——
 * 而 `cache.db` **不入库**（实测：`git ls-files .agent-io` 只有 2 份 DSL）。
 * ⇒ 同一次提交，在"索引刚重建"与"索引旧一点"的两台机器上红绿不同 —— 那种门会**静默地不信任**。
 * 本门只比**设计侧可复现**的几样（全依赖入库的 `design/*.dsl.json`）：
 *   ① `//source` 是否列出**全部**持有者；② `requirements` 是否等于设计判据的并集；
 *   ③ `requirements_calls` 的**调用方与条数**；④ 缺副本；⑤ 多余副本；⑥ 真冲突。
 *
 * ## 它挡的是哪一类事故（不是"普查"）
 * 「设计加了 `call-exists` 但没重跑 gen-db」⇒ `design-db` 里的 `requirements_calls` 是**旧的**，
 * 而 `scripts/contract-calls.mjs`（契约门）读的正是它 ⇒ **契约门在拿旧要求判新代码**，静默撒谎。
 * 这就是本门存在的理由：**在生成物与它的消费者之间，不允许有静默漂移**。
 *
 * ## 怎么修
 *   node dist/src/presentation/cli/cli.js design_line project_dir=. action=gen-db      # 重跑生成器
 * 真冲突（两个 feature 对同一文件要求互斥）重跑修不好，只能改设计 —— 回执会点名两侧。
 */
import { checkDesignDbStructure } from '../dist/src/application/design/db/gen_design_db.js';

const r = checkDesignDbStructure('.');
const bad = r.problems.length + r.conflicts.length + r.stale.length + r.missing.length + r.extra.length;

console.log(
  `设计 DB 结构 · ${r.paths} 份投影（${r.files} 个文件节点）· ` +
    `真冲突 ${r.conflicts.length} · 陈旧 ${r.stale.length} · 缺 ${r.missing.length} · 多 ${r.extra.length}`,
);
for (const x of r.conflicts) console.log(`  ★ 真冲突 ${x}`);
for (const x of r.stale) console.log(`  ⚠ 陈旧 ${x}`);
for (const x of r.missing) console.log(`  ⚠ 缺 ${x}`);
for (const x of r.extra) console.log(`  ⚠ 多 ${x}`);
for (const x of r.problems) console.log(`  ⚠ 问题 ${x}`);

if (bad) {
  console.log('\n★ 本门只比**设计侧**（不读 cache.db）：上面每一条都能靠入库文件复现。');
  console.log('★ 修法：node dist/src/presentation/cli/cli.js design_line project_dir=. action=gen-db');
  console.log('★ 真冲突例外：重跑修不好 —— 两个 feature 对同一文件的要求互相矛盾，只能改设计。');
  process.exit(1);
}

// ★★ AGENTS-RULES 0.12（10 处同族里的第 8 处）：**投影为空 ⇒ 没有可比的东西，不是"一致"**。
//   `bad` 是五项之和；五项全 0 有两种读法：① 真的一致；② **压根没有可比的对象**。
//   ②的成因都是真实的：设计册在、但 `semantic.files` 一个文件节点都没有 / 生成器口径变了 /
//   feature 切错（`design_line action=gen-db` 带 feature 只重生成那一片）。
//   ⇒ 只报"一致"就是替"没有"背书。
if (r.paths === 0 || r.files === 0) {
  console.log('\n★ 这不是一致，是**没有可比的东西**：设计册在，但没有任何可对账的文件节点。');
  console.log('  排查三条：');
  console.log('    ① 设计的 `semantic.files` 是不是空的（空 = 这条 feature 还没声明任何文件节点）；');
  console.log('    ② 生成器口径变了？跑 node dist/src/presentation/cli/cli.js design_line project_dir=. action=gen-db，看它报几个 features / files；');
  console.log('    ③ 本门按 cwd 解析 project_dir ⇒ 手工跑 `node scripts/gen-db-check.mjs` 时 cwd 必须就是这个仓。');
  process.exit(1);
}
console.log('★ 设计与投影一致：每条判据都在 design-db 里，且没有两个 feature 提出互斥要求。');
