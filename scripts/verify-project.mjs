#!/usr/bin/env node
/**
 * `verify:project` —— **零项目特定配置**的自动接管入口。
 *
 * 用法：
 *   node scripts/verify-project.mjs <projectRoot> [--changed a.ts,b.ts] [--no-run] [--json]
 *
 * ★ 只需要 projectRoot（+ 想要的话给改动集）。不写 touches、不写设计册、不指定测试目录/运行参数。
 * ★ 判定与执行全部复用既有件（`verifyProject` 一个函数，内部用 importProject / impactOfChanged /
 *   planInheritance / VerifiedSnapshot / 项目自己的 runner）。
 */
import { verifyProject } from '../dist/src/application/verify/verify_project.js';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const NO_RUN = args.includes('--no-run');
const root = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--changed'));
const changedArg = (() => {
  const i = args.indexOf('--changed');
  if (i >= 0 && args[i + 1]) return args[i + 1].split(',').map((s) => s.trim()).filter(Boolean);
  const eq = args.find((a) => a.startsWith('--changed='));
  if (eq) return eq.slice('--changed='.length).split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
})();

if (!root) {
  console.error('用法：node scripts/verify-project.mjs <projectRoot> [--changed a.ts,b.ts] [--no-run] [--json]');
  process.exit(2);
}

const r = await verifyProject({ projectRoot: root, change: changedArg, run: !NO_RUN });

if (JSON_OUT) {
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const line = (s) => console.log('  ' + s);
console.log('\n══ verifyProject：自动接管的一次增量验证 ══');
line(`项目 ${r.project.root}`);
line(`运行器 ${r.project.runner} —— ${r.project.runner_why}`);
line(`测试对象：磁盘 ${r.project.test_objects_on_disk} · 索引可见 ${r.project.test_objects_indexed}`);
if (r.project.unsupported) {
  line(`★ 不支持自动验证：${r.project.unsupported}（**不是通过**）`);
}
line(`改动集 ${r.changed.length} 个：${r.changed.slice(0, 6).join(', ')}${r.changed.length > 6 ? ' …' : ''}`);
line(
  r.impacted
    ? `波及：文件 ${r.impacted.files} · 符号 ${r.impacted.symbols} · ${r.impacted.ms}ms`
    : '波及：**不可用**（影响关系不可信）',
);
line(`实跑 ${r.ran.length} · 继承 ${r.inherited.length} · 未判定 ${r.undetermined.length}`);
  // ★ 2026-11-09：change-only 生命周期三行读数（变更事实 / 索引保鲜 / 基线推进）
  line(
    `变更事实：${r.change_fact.source === 'declared' ? '声明' : 'git'} · ${r.change_fact.files} 个文件` +
      `（索引保鲜同步 ${r.index.refreshed_files} 个 · ${r.index.ms}ms）`,
  );
  line(
    r.baseline.written
      ? `基线：${r.baseline.before} ⇒ ${r.baseline.after} 条（本次 pass 已增量合并）`
      : `基线：**不推进**（${r.baseline.before} ⇒ ${r.baseline.before} 条）—— ${r.baseline.why}`,
  );
for (const t of r.ran) line(`   ${t.rc === 0 && t.fail === 0 ? '✓' : '✗'} ${t.file} · pass ${t.pass} / fail ${t.fail} · ${t.ms}ms`);
for (const i of r.inherited) line(`   继承 ${i}`);
for (const u of r.undetermined) line(`   未判定 ${u.id} —— ${u.reason}`);
if (r.limitations.length) {
  line('限制（做不到的事，逐条）：');
  for (const l of r.limitations) line(`   · ${l}`);
}
line(
  `耗时：总 ${r.ms.total}ms（索引 ${r.ms.index} + 波及 ${r.ms.impact} + 决策 ${r.ms.plan} + 测试 ${r.ms.tests}）`,
);
line(r.red ? '★ 结论：**有红**（见上面 ✗）' : r.ok ? '结论：本次增量**可作数**（局部，不是全仓）' : '★ 结论：**不可作数**（未判定/不支持）');
process.exit(r.ok ? 0 : 1);
