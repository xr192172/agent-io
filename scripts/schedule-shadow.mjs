#!/usr/bin/env node
/**
 * schedule-shadow.mjs —— **只读**影子调度诊断入口（DS-1）。
 *
 * ## 它回答什么
 * "同一个目标下，各份证据的版本对得上吗？当前缺口是什么？下一条最值得做的是什么（**建议**）。"
 * 它输出结构化 Shadow Plan + 人读理由，**不执行任何一条建议**。
 *
 * ## 它不是判据
 * 本脚本不改任何 state、不写任何产物、不跑测试、不建索引。它给的是**读数**，
 * 退出码只表达"这次读到没读到"，不表达"项目对不对"。
 *
 * ## 零写入（DS-1 死线）
 * · 不经 `invokeTool`（那会触发自动保鲜与首触建索引）；
 * · 索引不存在 ⇒ 报缺口，**不** `import_project`；
 * · 快照不存在 ⇒ 报缺口，**不**创建；
 * · `cache.db` 只以 `readOnly: true` 打开（schema 落后时连开都不开）；
 * · 不启动 daemon / HTTP / 定时任务；无缓存、无 scratch 写入。
 *
 * ## 用法
 *   node scripts/schedule-shadow.mjs                       # 当前目录，自动取改动集
 *   node scripts/schedule-shadow.mjs --project-dir <dir> --goal "把 X 改对"
 *   node scripts/schedule-shadow.mjs --scope src/application --judgement-ref decision:node#0 --budget 2
 *   node scripts/schedule-shadow.mjs --changed src/a.ts --changed tests/a.test.ts   # 覆盖改动集
 *   node scripts/schedule-shadow.mjs --json                # 机器读（一行 JSON）
 *
 * ## 退出码（三态，判不了 ≠ 通过）
 *   0 = 产出了计划（计划可以是 no_op / ask_human）
 *   1 = 用法错误或目标不可读（参数非法 / 目录不存在 / dist 未构建）
 *   2 = 读不到：关键端口全不可用（内容版本 + 索引 + 快照 + 设计册都读不到）⇒ 给不出结论
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { changedPathsOf } from './lib/changed_set.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** 工具根（dist 在这里）：从自身目录上溯找 package.json#name=agent-io。 */
function packageRootFrom(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i += 1) {
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      try {
        if (JSON.parse(fs.readFileSync(pj, 'utf-8')).name === 'agent-io') return dir;
      } catch {
        /* 坏 package.json 不算这个根 */
      }
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return path.resolve(start);
}

const TOOL_ROOT = packageRootFrom(HERE);
const SCHED_MODULE = path.join(TOOL_ROOT, 'dist/src/application/scheduling/shadow_scheduler.js');
const DOMAIN_POLICY = path.join(TOOL_ROOT, 'dist/src/domain/scheduling_policy.js');

const USAGE = `用法：node scripts/schedule-shadow.mjs [--project-dir <dir>] [--goal <文本>]
       [--scope <仓库相对路径>]… [--judgement-ref <ref>]… [--changed <路径>]…
       [--budget <n>] [--json]
★ 只读诊断：不执行建议、不建索引、不写盘。`;

function fail(msg, code = 1) {
  process.stderr.write(`✗ ${msg}\n`);
  return code;
}

function parseArgs(argv) {
  const out = { projectDir: process.cwd(), goal: '', scope: [], refs: [], changed: null, budget: 1, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const need = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} 后面必须跟一个值`);
      i += 1;
      return v;
    };
    if (a === '--project-dir') out.projectDir = need();
    else if (a === '--goal') out.goal = need();
    else if (a === '--scope') out.scope.push(need());
    else if (a === '--judgement-ref') out.refs.push(need());
    else if (a === '--changed') out.changed = [...(out.changed ?? []), need()];
    else if (a === '--budget') {
      const n = Number(need());
      if (!Number.isFinite(n) || n < 1) throw new Error(`--budget 必须是 ≥1 的整数，实得 ${String(n)}`);
      out.budget = Math.floor(n);
    } else if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') {
      out.help = true;
    } else throw new Error(`未知参数 ${a}（本脚本只接受 --project-dir/--goal/--scope/--judgement-ref/--changed/--budget/--json）`);
  }
  return out;
}

function renderHuman(result, changedInfo) {
  const { frame, plan, receipts } = result;
  const lines = [];
  lines.push('══ 影子计划（只读诊断；本入口不执行任何建议）══');
  lines.push(`  项目：${frame.project.root}`);
  lines.push(`  目标：${plan.goal.text || '（未声明）'}${plan.goal.scope.length ? `  ｜ 范围：${plan.goal.scope.join(', ')}` : '  ｜ 范围：未声明'}`);
  lines.push(
    `  证据帧：内容版本 ${frame.content.version ? frame.content.version.slice(0, 12) : '读不到'}` +
      ` ｜ 设计册 ${frame.design_revisions.length ? frame.design_revisions.map((d) => d.revision ?? `${d.feature}:revision 未知`).join(' / ') : '无'}` +
      ` ｜ 索引 ${frame.index.state}` +
      (frame.index.stale_files !== null ? `（不一致 ${frame.index.stale_files}/${frame.index.stale_total ?? '?'}）` : '') +
      ` ｜ runner ${frame.capability.runner ?? '认不出'}`,
  );
  lines.push(
    `  读数：证据 ${frame.signals.length} ｜ 缺口 ${frame.gaps.length} ｜ 冲突 ${frame.conflicts.length} ｜ 排除 ${frame.excluded.length} ｜ 不可判 ${frame.undetermined.length}`,
  );
  lines.push(
    `  改动集：${changedInfo.source}${changedInfo.paths.length ? `（${changedInfo.paths.length} 个）` : ''}${changedInfo.note ? ` —— ${changedInfo.note}` : ''}`,
  );

  if (plan.no_op) {
    lines.push('');
    lines.push('── 建议 ──');
    lines.push('  no_op：没有证据缺口，不制造工作。');
  } else {
    lines.push('');
    lines.push('── 建议（按确定次序；只建议不执行）──');
    plan.actions.forEach((a, i) => {
      lines.push(`  ${i + 1}) ${a.action}  ${a.target}`);
      lines.push(`     关闭缺口：${a.gap} —— ${a.closes}`);
      lines.push(`     用了证据：${a.evidence.length ? a.evidence.join(', ') : '（无：读不到的时候本来就没有证据）'}`);
      lines.push(`     为何先做它：${a.why_before_others}`);
      if (a.depends_on.length) lines.push(`     前置：${a.depends_on.join(', ')}`);
      if (a.blocked_by.length) lines.push(`     ★ 硬阻断（现在不能执行）：${a.blocked_by.join(', ')}`);
      lines.push(`     成本：${a.cost.known ? `${a.cost.ms}ms（实测）` : `未知（${a.cost.why}）`}`);
      lines.push(`     不执行时：${a.if_skipped}`);
    });
    if (plan.deferred.length) {
      lines.push('');
      lines.push(`── 预算不足而未选（${plan.deferred.length} 条；缺口仍留在分母）──`);
      const head = plan.deferred.slice(0, 8);
      for (const a of head) lines.push(`  · ${a.action} ${a.target}（缺口 ${a.gap}）`);
      if (plan.deferred.length > head.length) {
        lines.push(`  · …另有 ${plan.deferred.length - head.length} 条未选（见 --json 的 deferred；它们的缺口在 open_gaps 里）`);
      }
    }
  }

  if (plan.open_gaps.length) {
    lines.push('');
    lines.push(`── 仍未关闭的缺口（${plan.open_gaps.length} 条，全部列出见 --json）──`);
    const gapById = new Map(frame.gaps.map((g) => [g.id, g]));
    const shown = plan.open_gaps.slice(0, 12);
    for (const id of shown) {
      const g = gapById.get(id);
      lines.push(g ? `  · [${g.kind}] ${id}：${g.reason}` : `  · ${id}（由某条证据的过期/缺证据生成）`);
    }
    if (plan.open_gaps.length > shown.length) {
      lines.push(`  · …另有 ${plan.open_gaps.length - shown.length} 条未关闭缺口（分母不删；见 --json 的 open_gaps）`);
    }
  }
  if (plan.excluded.length) {
    lines.push('');
    lines.push('── 判为不执行（retired / node retired）──');
    for (const e of plan.excluded) lines.push(`  · ${e.id}（${e.reason}）`);
  }
  if (plan.undetermined.length) {
    lines.push('');
    lines.push('── 明确不可判（不许读成通过）──');
    for (const u of plan.undetermined.slice(0, 12)) lines.push(`  · ${u.id}：${u.reason}`);
    if (plan.undetermined.length > 12) lines.push(`  · …另有 ${plan.undetermined.length - 12} 条（见 --json）`);
  }
  if (frame.conflicts.length) {
    lines.push('');
    lines.push('── 冲突（两边都留着，不投票）──');
    for (const c of frame.conflicts) lines.push(`  · ${c.subject}：${c.reason}`);
  }
  const bad = receipts.filter((r) => r.status === 'unavailable');
  if (bad.length) {
    lines.push('');
    lines.push('── 读不到的端口（读不到 ≠ 没有）──');
    for (const r of bad) lines.push(`  · ${r.port}：${r.reason ?? '未说明'}`);
  }
  if (frame.limitations.length) {
    lines.push('');
    lines.push('── 本期边界（诚实清单）──');
    for (const l of frame.limitations) lines.push(`  · ${l}`);
  }
  lines.push('');
  lines.push('★ 本入口只读：没有执行任何建议，没有建索引、没有写快照、没有改源码/册/台账。');
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${USAGE}\n`);
    return fail((e instanceof Error ? e.message : String(e)), 1);
  }
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  for (const f of [SCHED_MODULE, DOMAIN_POLICY]) {
    if (!fs.existsSync(f)) {
      return fail(`找不到 ${f}\n  ⇒ 先构建：npm run build（本命令不许自带一份策略实现，否则就是两处权威）`, 1);
    }
  }

  const root = path.resolve(args.projectDir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return fail(`项目根不存在或不是目录：${root}`, 1);
  }

  // 改动集：默认用既有唯一实现（三来源并集）；★ R-06：**逐路**判完整性，不是只看 unavailable。
  let changed = [];
  let changedTrusted = true;
  let changedNote = '';
  let changedInfo;
  if (args.changed) {
    changed = args.changed.map((p) => String(p).replace(/\\/g, '/'));
    changedInfo = { source: '调用方声明', paths: changed, sources: null, note: '调用方显式声明 ⇒ 只覆盖它声明的那几个文件' };
    changedNote = `调用方显式声明 ${changed.length} 个路径：本次只按这份清单判断，未声明的改动不可见`;
  } else {
    try {
      const got = changedPathsOf(root);
      changed = got.paths;
      const s = got.sources ?? {};
      // ★ 调度需要"全时间范围"：worktree 只证明当前工作区；缺上次判据锚 ⇒ 已提交历史不可见；
      //   scan_changes 只覆盖最近一次全量扫描窗口。任一路缺失 ⇒ 不能当"完整可信"。
      const missing = [];
      if (!s.git_worktree?.ok) missing.push('git worktree（当前工作区改动不可见）');
      if (!s.git_since_last_judge?.ok) missing.push('git since-last-judge（已提交历史不可见）');
      if (!s.scan_changes?.ok) missing.push('cache.db scan_changes（索引侧变更窗口不可见）');
      changedTrusted = got.unavailable === null && missing.length === 0;
      changedNote = [
        `来源：scan_changes=${s.scan_changes?.ok ? `ok(${s.scan_changes.rows})` : 'fail'} · ` +
          `git_worktree=${s.git_worktree?.ok ? `ok(${s.git_worktree.rows})` : 'fail'} · ` +
          `git_since_last_judge=${s.git_since_last_judge?.ok ? `ok(${s.git_since_last_judge.rows})` : 'fail'}`,
        missing.length > 0 ? `缺失：${missing.join(' / ')}` : '三路齐备',
        got.unavailable ? `不可用：${got.unavailable}` : '',
      ]
        .filter(Boolean)
        .join(' ｜ ');
      changedInfo = {
        source: 'changed_set（scan_changes ∪ git worktree ∪ git since-last-judge）',
        paths: changed,
        sources: s,
        missing,
        note: changedNote,
      };
    } catch (e) {
      changed = [];
      changedTrusted = false;
      changedNote = `改动集读取抛错（${e instanceof Error ? e.message : String(e)}）⇒ 本次不产生任何"未受影响"结论`;
      changedInfo = { source: 'changed_set 抛错', paths: [], sources: null, missing: ['全部'], note: changedNote };
    }
  }

  const { runShadowScheduler } = await import(pathToFileURL(SCHED_MODULE).href);
  const result = runShadowScheduler({
    root,
    goal: { text: args.goal, judgement_refs: args.refs, scope: args.scope },
    changed,
    changedTrusted,
    changedNote,
    budget: args.budget,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify({ changed: changedInfo, changed_trusted: changedTrusted, ...result }, null, 1)}\n`);
  } else {
    process.stdout.write(`${renderHuman(result, changedInfo)}\n`);
  }

  // 2 = 判不了：关键四路全读不到 ⇒ 不许把"没读到"当"没问题"。
  const critical = new Set(['content', 'indexFacts', 'snapshot', 'designRevisions']);
  const badCritical = [...critical].filter((p) => !result.receipts.some((r) => r.port === p && r.status === 'ok'));
  if (badCritical.length === critical.size) {
    process.stderr.write(`✗ 判不了：关键端口全部读不到（${badCritical.join(', ')}）⇒ 给不出结论（≠ 通过）\n`);
    return 2;
  }
  return 0;
}

process.exitCode = await main();
