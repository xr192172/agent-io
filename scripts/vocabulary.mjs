#!/usr/bin/env node
/**
 * vocabulary.mjs —— 填卡时的「可选值清单」（词汇表）
 *
 * 为什么要它（2026-10-17 用户问）：
 *   「这图上的这些选项需不需要注册进去，就是这些契约需不需要注册进去，
 *     以便下个人填写的时候简便填写，不用自己去拟造。」
 *
 * 数出来的事实：
 *   · expectation.kind  → ✓ EXPECTATION_KINDS（编译期穷尽 + 运行时抛错并列出合法值）
 *   · provenance 五类    → ✗ 只活在 DSL 散文里（没有单一枚举出处）
 *   · assertion 三态     → ✗ 只活在 DSL 文档段
 *   · schema enum 23 处  → ✓ 在 schema
 *   · ★ 但没有任何读取端能拿到这些清单 ⇒ 校验端知道合法值，填充端不知道 ⇒ 只能拟造
 *
 * 本脚本把「合法取值」汇成一份机读清单，并标注每条的【强度】：
 *   strong —— 编译期穷尽（Record<K, V>）+ 运行时抛错 ⇒ 拟造不出来
 *   weak   —— 有单一名单，但没有编译期保证（填错可能静默通过）
 *   none   —— 只有散文 ⇒ 必须人工对
 *
 * 用法：
 *   node scripts/vocabulary.mjs            # 人读
 *   node scripts/vocabulary.mjs --json     # 机读（给 agent 填卡前查）
 */
import fs from 'node:fs';

const EXPECTATION_TS = 'src/domain/expectation.ts';
const PLAN = 'docs/task-system-plan.dsl.json';
const SCHEMA = 'schema/design_dsl.schema.json';

const out = [];

// ── 1) expectation.kind —— 从代码抽，不复制 ──
{
  const src = fs.readFileSync(EXPECTATION_TS, 'utf8');
  const m = src.match(/EXPECTATION_KINDS\s*=\s*\[([^\]]+)\]/);
  const values = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  const exhaustive = /Record<Expectation\['kind'\],\s*\w+>/.test(src);
  const throws = /kind 非法/.test(src);
  out.push({
    namespace: 'expectation.kind',
    authority: `${EXPECTATION_TS} 的 EXPECTATION_KINDS`,
    strength: values.length && exhaustive && throws ? 'strong' : 'weak',
    why: '编译期穷尽（Record<kind, Phase>）+ 运行时抛错并列出合法值 ⇒ 拟造不出来',
    values,
    how_to_read: 'expectationPhase(kind) / 直接 import EXPECTATION_KINDS',
  });
}

// ── 2) provenance.source 五类 —— 从 DSL 抽（weak：散文里的一张表）──
{
  const d = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const kinds = (((d.task_plan || {}).provenance || {}).decision_card || {}).source_kinds || [];
  out.push({
    namespace: 'provenance.source',
    authority: 'docs/task-system-plan.dsl.json → task_plan.provenance.decision_card.source_kinds',
    strength: kinds.length ? 'weak' : 'none',
    why: '★ 有单一名单，但代码里没有 PROVENANCE_KINDS、没有编译期穷尽 ⇒ 填错可能静默通过',
    values: kinds.map((k) => ({ kind: k.kind, what: k.what })),
    how_to_read: '本脚本 / 直接读 DSL 那一段',
    debt: '★ 要变 strong：把 source_kinds 提成 src/domain 的常量 + Record 穷尽，像 EXPECTATION_KINDS 那样',
  });
}

// ── 3) assertion.kind 三态 —— 从 DSL 抽（weak）──
{
  const d = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  const kinds = (((d.task_plan || {}).assertion_kinds || {}).kinds) || {};
  out.push({
    namespace: 'assertion.kind',
    authority: 'docs/task-system-plan.dsl.json → task_plan.assertion_kinds.kinds',
    strength: Object.keys(kinds).length ? 'weak' : 'none',
    why: '★ 同上：名单在，但没有编译期约束',
    values: Object.keys(kinds),
    how_to_read: 'scripts/plan-assertions.mjs（它会判每条判据落在哪一态）',
    consumer: 'scripts/plan-assertions.mjs',
  });
}

// ── 4) schema 里的 enum —— 从 schema 抽 ──
{
  const s = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  const enums = [];
  (function walk(n, path) {
    if (n && typeof n === 'object') {
      if (Array.isArray(n.enum)) enums.push({ at: path || '(root)', values: n.enum });
      for (const [k, v] of Object.entries(n)) walk(v, path ? `${path}.${k}` : k);
    }
  })(s, '');
  out.push({
    namespace: 'schema.enum',
    authority: SCHEMA,
    strength: 'weak',
    why: '★ 在 schema 里 ⇒ validateDSL 会校验；但没有编译期穷尽',
    values: enums,
    how_to_read: 'validateDSL 的报错 / 本脚本',
  });
}

const asJson = process.argv.includes('--json');
if (asJson) {
  console.log(JSON.stringify({ generated_by: 'scripts/vocabulary.mjs', vocabularies: out }, null, 2));
} else {
  console.log('════ 填卡词汇表（合法取值 + 强度）════');
  for (const v of out) {
    const badge = v.strength === 'strong' ? '★★ strong' : v.strength === 'weak' ? '★  weak' : '   none';
    const n = Array.isArray(v.values) ? v.values.length : 0;
    console.log(`\n[${badge}] ${v.namespace}   (${n} 项)`);
    console.log(`  权威: ${v.authority}`);
    console.log(`  读法: ${v.how_to_read}`);
    if (v.strength !== 'strong' && v.why) console.log(`  为何不是 strong: ${v.why}`);
    if (v.debt) console.log(`  ${v.debt}`);
  }
  const strong = out.filter((v) => v.strength === 'strong').length;
  console.log(`\n★ 共 ${out.length} 个命名空间，其中 strong ${strong} 个`);
  console.log('★ 填卡时：先查本表；查不到的合法值 ⇒ 说明该枚举不全 ⇒ 那是 L1 建构任务（补全枚举），不是自己拟造。');
}
