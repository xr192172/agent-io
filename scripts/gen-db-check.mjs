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
 *   ③ `requirements_calls` 的**调用方与条数**；④ 缺副本；⑤ 多余副本；⑥ 真冲突；
 *   ⑦ **归属重复**（同一个受断言的文件被 >1 册断言 —— 见下）。
 *
 * ## ⑦ 与 ⑥ 的区别（两条都要留，别合成一个计数）
 * - ⑥ 真冲突 = 两册对同一文件的要求**互斥**（不可能同时成立）⇒ 只能改要求；
 * - ⑦ 归属重复 = 两册**都断言**同一文件（要求并不互斥）⇒ 只能一册持有 ⇒ **把断言搬到持有册**：
 *   多者持有；平手归 `agent-io`。
 * 为什么它必须在门里而不是靠纪律：2026-10-31 收口那次读数是 0，随后的两条新判据分别写进
 * `agent-io` 与 `task-system-plan` 的同一批文件 ⇒ 立刻变 3 个双册 path，而**没有任何读数因此变红**。
 * 「一处权威」若判不了真假，下一个人照样会写第二处。
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
const bad =
  r.problems.length +
  r.conflicts.length +
  r.ownership.length +
  r.stale.length +
  r.missing.length +
  r.extra.length +
  // ★★★ 2026-11-03（M1a ⑧）：判据 kind → 投影去向 —— **声明了投影键却落地不满**、声明表漏了 kind、
  //   `SYMBOL_COLUMN_MAP` 有沉默列，三样都算红。声明 `why_not_projected` 的 kind 按载体豁免（条数另行印出），
  //   所以这一项在正常状态下**可以**是绿的（0.16：一条永远会亮的告警 = 一条被关掉的告警）。
  r.kindProjectionGaps.length;

// ★ 0.12「统计必须带分母」：受断言路径数是分子（归属重复）的分母 —— 只报 0 违例而不知道查了几个 path，等于没验。
console.log(
  `设计 DB 结构 · ${r.paths} 份投影（${r.files} 个文件节点）· 受断言路径 ${r.assertedPaths} · ` +
    `归属重复 ${r.ownership.length} · 真冲突 ${r.conflicts.length} · 陈旧 ${r.stale.length} · 缺 ${r.missing.length} · 多 ${r.extra.length}`,
);
for (const x of r.ownership) console.log(`  ✗ 归属重复 ${x}`);
for (const x of r.conflicts) console.log(`  ★ 真冲突 ${x}`);
for (const x of r.stale) console.log(`  ⚠ 陈旧 ${x}`);
for (const x of r.missing) console.log(`  ⚠ 缺 ${x}`);
for (const x of r.extra) console.log(`  ⚠ 多 ${x}`);
for (const x of r.problems) console.log(`  ⚠ 问题 ${x}`);
for (const x of r.kindProjectionGaps) console.log(`  ✗ 判据 kind 投影 ${x}`);

// ★★ AGENTS-RULES 0.12（10 处同族里的第 8 处）：**投影为空 ⇒ 没有可比的东西，不是"一致"**。
//   ★ 2026-11-03（M1a）：这一档必须**排在 `bad` 之前** —— 空投影时 `kindProjectionGaps` 会附一条
//     「design-db/ 目录不存在 ⇒ 落地数不可算」，若先走 bad 分支，人只会看到「本门只比设计侧」，
//     而真相是「压根没有可比的对象」（两种病同一个报文 ⇒ 查不了因）。
//   `bad` 是七项之和；全 0 有两种读法：① 真的一致；② **压根没有可比的对象**。
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

if (bad) {
  console.log('\n★ 本门只比**设计侧**（不读 cache.db）：上面每一条都能靠入库文件复现。');
  console.log('★ 修法：node dist/src/presentation/cli/cli.js design_line project_dir=. action=gen-db');
  console.log('★ 真冲突例外：重跑修不好 —— 两个 feature 对同一文件的要求互相矛盾，只能改设计。');
  console.log('★ 归属重复例外：重跑也修不好 —— 把那条断言**原样搬**到持有册（多者持有；平手归 agent-io），再从另一册删；断言一条都不许丢。');
  console.log('★ 判据 kind 投影例外：声明了投影键却没落地 ⇒ 改投影（M1b）；声明不投影的按载体豁免，别把豁免当红。');
  process.exit(1);
}
// ════════════════════════════════════════════════════════════════════
// ★★★ 2026-11-03（M1a ②）：**判据 kind → 投影去向的诚实读数**
//   此前这里印的是「每条判据都在 design-db 里」—— 实测册侧 564 条里只有 111 条（全是 call-exists）落地
//   ⇒ 那句话对 365 条是假话。现在**现算两列**：册侧读 `design/*.dsl.json`，投影侧读 `design-db/`（与门同一批入库文件，
//   仍不读 cache.db）；分母（册侧/可投影）与分子（落地/可达）**每次都印**（AGENTS-RULES 0.12 第 3 条）。
// ════════════════════════════════════════════════════════════════════
const cov = r.kindCoverage;
if (cov.length) {
  const pad = (s, n) => String(s).padEnd(n);
  const num = (n, w) => String(n).padStart(w);
  console.log('\n【判据 kind → 投影去向】（★ 现算：册侧 = design/*.dsl.json，投影侧 = design-db/）');
  console.log(
    '  ' + pad('kind', 20) + num('册条', 6) + num('可投影', 7) + num('DB落地', 7) + num('judge判过', 9) + '  去向 / 落地率',
  );
  for (const x of cov) {
    const where =
      x.declared === 'keys'
        ? `→ ${(x.keys ?? []).join(' + ')}`
        : x.declared === 'exempt'
          ? '不投影（已声明载体）'
          : '★ 没表态（沉默）';
    // ★ 2026-11-03（M1a ③-2）：「judge判过」= 该 kind 真判出结论的条数（pass+fail，来自 judge-readings.json）；
    //   读数为 —— 时印「—」，**不印 0**（0 的含义是"收进来了却一条都没结论"，那才是真故障）。
    const judgedCell = x.judged === null ? '    —' : num(x.judged, 9);
    console.log(
      '  ' + pad(x.kind, 20) + num(x.sheet, 6) + num(x.projectable, 7) + num(x.landed, 7) + judgedCell + '  ' + where,
    );
    console.log('  ' + pad('', 20) + '  ' + x.rate);
  }
  const keyed = cov.filter((x) => x.declared === 'keys').length;
  const silent = cov.filter((x) => x.declared === 'undeclared').length;
  console.log(
    `  合计：册侧 ${r.kindCoverage.reduce((n, x) => n + x.sheet, 0)} 条 · 可投影 ${r.kindCoverage.reduce(
      (n, x) => n + x.projectable,
      0,
    )} 条 · DB 落地 ${r.kindCoverage.reduce((n, x) => n + x.landed, 0)} 条`,
  );
  console.log(
    `  ★ 只有 ${keyed} 种 kind 有投影键（进 design-db）；${r.kindExemptedCount} 条判据**已声明不投影**` +
      `（按 EXPECTATION_KIND_PROJECTION 的载体豁免 —— 载体 = judge 现算 / 副本本体 / 事件流，逐条可查）；` +
      `${r.kindNoPathCount} 条挂在无 path 节点上（投影口径外：planDesignDb 对这类节点整节点跳过）`,
  );
  if (silent) console.log(`  ✗ ${silent} 种 kind 没在声明表里表态 ⇒ 沉默不许当"已投影"`);
  console.log(
    '  ★ judge判过 = 该 kind **真判出结论**的条数（pass+fail，读 .agent-io/judge-readings.json）；' +
      'pending 与 unsupported 都不算判过。judged==0 而册侧>0 ⇒ 本门红（"收进来了却没结论"）。',
  );
  if (r.kindJudgedNote) console.log(`  ⚠ judge判过 不可算：${r.kindJudgedNote}`);
}
console.log(
  '\n★ 结构一致：`//source` 的持有者 / `requirements` / `requirements_calls` 的调用方 / 归属 / 副本数 全部对上；\n' +
    '  没有两个 feature 提出互斥要求；也没有同一个受断言的文件被两个 feature 同时断言（归属重复 0）。\n' +
    '★ ★ 注意：**「每条判据都在 design-db 里」这句话不成立**（上面那张表就是分母）—— design-db 只承载**声明了投影键**的 kind；\n' +
    '  其余 kind 的验收在 judge 侧（`design_line action=judge` 会真跑它们），本门通过 `judge判过` 那一列确认它们真的判出了结论。',
);
