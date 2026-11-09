/**
 * OPL「目标 → 设计 → 施工项」入口（2026-11-09）
 *
 * ## 它补的是哪一段
 * `changeset_draft` 能出**草案**（候选 / 消费方 / 工作项 / 需人决定），但草案是"建议"。
 * 本模块把草案接进**既有 `opl` 产线**，让引擎真的建东西：
 *
 * ```
 * 用户给 projectRoot + goal
 *   → opl action=propose   引擎出候选 ChangeSet + **确认清单**（只读，一个字节不写）
 *   → 用户只回两样：subject（选哪个主体）+ contracts（各项独立预期 given/expect）
 *   → opl action=adopt     引擎写**设计决策 + 施工卡**（复用既有 updateFeature 写入口），
 *                          并给出**画布/执行/判定/核销**的现成命令（依赖序已排好）
 *   → 按序执行（edit_code → judge → verifyProject → complete）
 * ```
 *
 * ## 硬边界（写死在代码里）
 * ① **候选未确认不能施工**：`adopt` 的 `subject` 必须**出现在** `propose` 给出的候选里，否则直接拒；
 * ② **不从当前实现生成预期**：`contracts` 的 `cases` 必须由调用方给（`given`/`expect`）；本模块**不读源码猜期望**；
 * ③ **设计未形成前不写源码**：`adopt` 只写决策与卡，源码写仍走 `edit_code`（要过画布闸/任务闸）；
 * ④ **已有契约复用**：草案里标 `reuse` 的项**不再新增**判据，`adopt` 直接跳过；
 * ⑤ **只给当前任务必要上下文**：返回的是"这一步要的命令"，不倾倒全仓候选。
 *
 * ## 如实记录的边界（不是遗漏）
 * **画布不由本模块代写**：`design_line action=plan` 的写端住在它的 handler 里（含归属判据 / 冻结快照 / 出口闭环），
 * 没有可复用的纯函数；在这里再写一遍就是**第二份画布实现**。所以 `adopt` 返回**参数已拼好的** `plan` 命令，
 * 由调用方原样执行。这是设计的取舍，不是没做完。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { getDSL } from '../../../infrastructure/storage.js';
import { draftChangeSet, type ChangeSetDraft, type DraftWorkItem } from '../db/changeset_draft.js';
import { updateFeature } from '../dsl_ops/update_feature.js';

export type OplGoalAnswer = {
  /** 候选主体（人从这里挑一个） */
  subject: string;
  /** 还需要跟进的消费方（`file#symbol` 或 `file`） */
  consumers: string[];
  /** 每项独立预期（人写；不从当前实现抄） */
  contracts: Array<{
    /** 指向哪个工作项：`file#symbol` */
    of: string;
    kind: 'behavior-cases' | 'call-exists';
    /** behavior-cases 必填；call-exists 可省（接线事实已够） */
    cases?: Array<{ given: unknown[]; expect: string }>;
    why: string;
  }>;
};

export type ProposeResult = {
  action: 'propose';
  goal: string;
  outcome: ChangeSetDraft['outcome'];
  /** 候选（**均未确认**） */
  subjects: ChangeSetDraft['subjects'];
  consumers: ChangeSetDraft['consumers'];
  /** 复用（已有契约，不重复造） */
  reuse: ChangeSetDraft['reuse'];
  unsupported: ChangeSetDraft['unsupported'];
  /** ★ 用户只需要回这些 */
  need_from_human: {
    subject: string;
    contracts: string[];
    notes: string[];
  };
  next: string[];
};

function nodeIdOfPath(feature: string, file: string): string | null {
  try {
    const dsl = getDSL(feature) as unknown as { geometry?: { nodes?: Array<{ id: string; path?: string }> } } | null;
    const hit = (dsl?.geometry?.nodes ?? []).find((n) => String(n.path ?? '').replace(/\\/g, '/') === file.replace(/\\/g, '/'));
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

/** 只读：出草案 + 确认清单（不写任何东西） */
export async function oplPropose(input: { feature: string; projectRoot: string; goal: string }): Promise<ProposeResult> {
  const d = await draftChangeSet({ projectRoot: input.projectRoot, goal: input.goal, feature: input.feature });
  const contracts = d.work_items
    .filter((w) => w.contract.status !== 'reuse')
    .map((w) => `${w.file}#${w.symbol} :: ${w.contract.kind}${w.contract.target ? ' → ' + w.contract.target : ''}（需填 ${w.contract.needs.join('/')}）`);
  return {
    action: 'propose',
    goal: input.goal,
    outcome: d.outcome,
    subjects: d.subjects,
    consumers: d.consumers,
    reuse: d.reuse,
    unsupported: d.unsupported,
    need_from_human: {
      subject: d.subjects.length ? `从 ${d.subjects.length} 个候选里挑一个（如 ${d.subjects[0].file}#${d.subjects[0].symbol}）` : '没有候选 ⇒ 请直接给一个 file#symbol',
      contracts,
      notes: d.unconfirmed,
    },
    next: d.outcome === 'draft' ? ['opl action=adopt（带 subject + contracts）'] : ['证据不足：opl action=propose 已拒绝出草案 ⇒ 请人指定主体'],
  };
}

export type AdoptResult = {
  action: 'adopt';
  ok: boolean;
  wrote: { decisions: string[]; cards: string[]; skipped_reuse: string[] };
  /** 步骤队列落点（advance 从这里读） */
  steps_saved_at?: string;
  /** ★ 参数已拼好，原样执行即可（依赖序已排） */
  commands: Array<{ step: number; tool: string; args: Record<string, unknown>; why: string }>;
  refused?: { why: string };
};

/** 写：把**人确认过**的选择落成设计决策 + 施工卡，并给出执行命令 */
export async function oplAdopt(input: {
  feature: string;
  projectRoot: string;
  goal: string;
  answer: OplGoalAnswer;
  owner?: string;
  /** 允许"只落设计不落卡"（用于先审查后开工） */
  claimCards?: boolean;
}): Promise<AdoptResult> {
  const d = await draftChangeSet({ projectRoot: input.projectRoot, goal: input.goal, feature: input.feature });
  // ★ 允许两种已确认来源：草案工作项，或**草案候选**（干净项目上职责文本还没写 ⇒ outcome 可能是 no_candidate，
  //   但候选人已经列出来了；人从这里挑一个 = 语义选择已确认，仍守住"候选之外不许施工"）。
  const allowed = new Set<string>([
    ...d.work_items.map((w) => `${w.file}#${w.symbol}`),
    ...d.subjects.map((x) => `${x.file}#${x.symbol}`),
  ]);
  // ① 候选未确认不能施工：subject 必须是草案里出现过的
  if (!allowed.has(input.answer.subject)) {
    return {
      action: 'adopt',
      ok: false,
      wrote: { decisions: [], cards: [], skipped_reuse: [] },
      commands: [],
      refused: {
        why: `subject=${input.answer.subject} **不在**草案候选里（候选：${[...allowed].slice(0, 6).join(' / ')}）⇒ 候选未确认不许施工`,
      },
    };
  }

  // ② 组装 DSL 操作（decision + claim），复用唯一写入口 updateFeature
  // ★ 草案没给工作项时（no_candidate），按**人已确认**的主体 + 消费方补最小工作项
  const synth = (key: string, role: 'primary' | 'consumer'): DraftWorkItem | null => {
    const [file, symbol] = key.includes('#') ? key.split('#') : [key, ''];
    if (!file) return null;
    return {
      order: role === 'primary' ? 1 : 2,
      role,
      file,
      symbol: symbol || '(待指定)',
      goal_ref: input.goal,
      depends_on: role === 'primary' ? [] : [1],
      kind: 'rewrite',
      detail: role === 'primary' ? `${symbol}：实现目标行为` : `消费方跟上：${file} 必须按新语义调用`,
      contract: {
        kind: role === 'primary' ? 'behavior-cases' : 'call-exists',
        path: file,
        symbol: symbol || '(待指定)',
        ...(role === 'primary' ? {} : { target: input.answer.subject.split('#')[1] ?? '' }),
        needs: role === 'primary' ? ['given', 'expect'] : ['symbol'],
        note: '（由人确认后补出的工作项；草案当时证据不足，未自动选定）',
        status: 'empty_shell',
      },
      counterexample: '把实现改回旧写法/删掉这次调用 ⇒ 契约必须变红',
    };
  };
  if (d.work_items.length === 0) {
    const p0 = synth(input.answer.subject, 'primary');
    if (p0) d.work_items.push(p0);
    for (const c of input.answer.consumers) {
      const cc = synth(c, 'consumer');
      if (cc) d.work_items.push(cc);
    }
  }
  const targets: Array<{ key: string; file: string; symbol: string; item: DraftWorkItem }> = [];
  for (const w of d.work_items) {
    const key = `${w.file}#${w.symbol}`;
    if (key === input.answer.subject || input.answer.consumers.includes(w.file) || input.answer.consumers.includes(key)) {
      targets.push({ key, file: w.file, symbol: w.symbol, item: w });
    }
  }
  const ops: Array<Record<string, unknown>> = [];
  const decisions: string[] = [];
  const cards: string[] = [];
  const skipped: string[] = [];
  const owner = input.owner ?? 'agent:opl';

  for (const t of targets) {
    const nodeId = nodeIdOfPath(input.feature, t.file);
    if (!nodeId) {
      return {
        action: 'adopt',
        ok: false,
        wrote: { decisions, cards, skipped_reuse: skipped },
        commands: [],
        refused: { why: `${t.file} 在设计册里没有节点（先 import_project 建档）` },
      };
    }
    if (t.item.contract.status === 'reuse') {
      skipped.push(`${t.key}（已有 ${t.item.contract.kind}，复用不新增）`);
    } else {
      const c = input.answer.contracts.find((x) => x.of === t.key);
      if (!c) {
        return {
          action: 'adopt',
          ok: false,
          wrote: { decisions, cards, skipped_reuse: skipped },
          commands: [],
          refused: { why: `${t.key} 缺独立预期（contracts 里没有 of=${t.key}）⇒ 不从当前实现代生成` },
        };
      }
      const exp: Record<string, unknown> =
        c.kind === 'call-exists'
          ? { kind: 'call-exists', path: t.file, symbol: t.symbol, target: t.item.contract.target, phase: 'post', why: c.why }
          : { kind: 'behavior-cases', path: t.file, symbol: t.symbol, phase: 'post', cases: c.cases ?? [], why: c.why };
      ops.push({
        type: 'decision',
        op: 'update',
        id: nodeId,
        data: { summary: `${t.symbol}：${input.goal.slice(0, 60)}`, expectations: [exp] },
      });
      decisions.push(t.key);
    }
    // ★幂等：节点上**已有 claimed 卡** 时不再 publish/claim（否则 publish 会被拒：
    //   “换掉已领卡的验收标准必须说明为什么”）。重复 adopt = 只补/复用，不重新开卡。
    const alreadyClaimed = (() => {
      try {
        const dsl = getDSL(input.feature) as unknown as { geometry?: { nodes?: Array<{ path?: string; task?: { state?: string } }> } } | null;
        const n = (dsl?.geometry?.nodes ?? []).find((x) => String(x.path ?? '').replace(/\\/g, '/') === t.file);
        return n?.task?.state === 'claimed';
      } catch {
        return false;
      }
    })();
    if (input.claimCards !== false && !alreadyClaimed) {
      // ★ 立卡必须先 publish（决策卡⇒任务卡；内容只能来自 decision），再 claim
      ops.push({ type: 'task', op: 'publish', id: nodeId });
      ops.push({ type: 'task', op: 'claim', id: nodeId, data: { owner, intent: 'modify', reason: `OPL：${input.goal.slice(0, 60)}` } });
      cards.push(t.key);
    }
  }

  if (ops.length > 0) {
    await updateFeature({
      feature: input.feature,
      reason: `OPL adopt：为 ${targets.map((t) => t.key).join(' / ')} 写设计决策与施工卡（目标：${input.goal.slice(0, 50)}）`,
      operations: ops as never,
      weight: 'routine',
      agent: owner,
    } as never);
  }

  // ③ 执行命令（依赖序：主体 → 判据(应红) → 消费方 → 判据(应绿) → 验证 → 核销）
  const primary = targets.find((t) => t.key === input.answer.subject)!;
  const consumers = targets.filter((t) => t.key !== primary.key);
  const commands: AdoptResult['commands'] = [];
  let step = 1;
  const planFor = (t: typeof primary, judgeRef: string): { tool: string; args: Record<string, unknown>; why: string } => ({
    tool: 'design_line',
    args: {
      project_dir: input.projectRoot,
      feature: input.feature,
      action: 'plan',
      file: t.file,
      card: nodeIdOfPath(input.feature, t.file) ?? '',
      apply: true,
      entries: [{ anchor: { symbol: t.symbol }, kind: 'rewrite', detail: t.item.detail, judgement_ref: judgeRef, status: 'open' }],
      untouched_default: true,
      untouched_why: '本轮只改这个符号（其余符号不动）',
    },
    why: `画布：${t.file}#${t.symbol}（不代写的原因见模块头注）`,
  });
  const plan = planFor(primary, `decision:${nodeIdOfPath(input.feature, primary.file)}#0`);
  commands.push({ step: step++, tool: plan.tool, args: plan.args, why: plan.why });
  commands.push({
    step: step++,
    tool: 'edit_code',
    args: { project_dir: input.projectRoot, file: primary.file, op: 'replace_text', old_text: '<你确认过的旧片段>', new_text: '<按目标的实现>', actor: owner },
    why: '执行主体（只改主项）',
  });
  commands.push({
    step: step++,
    tool: 'design_line',
    args: { project_dir: input.projectRoot, feature: input.feature, action: 'judge' },
    why: '★ 此时消费方契约应当仍**红**（证明没有靠"只改主项"收口）',
  });
  for (const c of consumers) {
    const p = planFor(c, `decision:${nodeIdOfPath(input.feature, c.file)}#0`);
    commands.push({ step: step++, tool: p.tool, args: p.args, why: p.why });
    commands.push({
      step: step++,
      tool: 'edit_code',
      args: { project_dir: input.projectRoot, file: c.file, op: 'replace_text', old_text: '<你确认过的旧片段>', new_text: '<按目标的实现>', actor: owner },
      why: `消费方跟上：${c.key}`,
    });
  }
  commands.push({
    step: step++,
    tool: 'design_line',
    args: { project_dir: input.projectRoot, feature: input.feature, action: 'judge' },
    why: '全项完成后判据应全绿',
  });
  commands.push({ step: step++, tool: 'verifyProject', args: { projectRoot: input.projectRoot }, why: '重建事实 + 只重验受影响项' });
  commands.push({
    step: step++,
    tool: 'edit_dsl',
    args: { feature: input.feature, reason: '核销：判据全绿 + verifyProject 可作数', operations: targets.map((t) => ({ type: 'task', op: 'complete', id: nodeIdOfPath(input.feature, t.file), data: { reason: `${t.key} 契约已绿且验证可作数`, evidence: { kind: 'reading', command: 'design_line action=judge + verifyProject', observed: '<填实测读数>', at: new Date().toISOString() } } })) },
    why: '核销（无证据/不可判时**不许**执行这一步）',
  });

  const stepsSavedAt = saveSteps(input.projectRoot, input.feature, input.goal, commands);
  return { action: 'adopt', ok: true, wrote: { decisions, cards, skipped_reuse: skipped }, commands, steps_saved_at: stepsSavedAt };
}

/* ────────────────────── 步骤执行（不再手抄八步） ────────────────────── */

/** 步骤队列落点：引擎自己的运行态（**不是**第二套计划体系 —— 计划仍是画布 tasks.db#plans） */
function stepsFile(projectRoot: string, feature: string): string {
  return path.join(projectRoot, '.agent-io', 'opl', feature + '.steps.json');
}

export function saveSteps(projectRoot: string, feature: string, goal: string, commands: AdoptResult['commands']): string {
  const f = stepsFile(projectRoot, feature);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ feature, goal, at: new Date().toISOString(), commands }, null, 2));
  return f.replace(/\\/g, '/');
}

export function loadSteps(projectRoot: string, feature: string): { goal: string; commands: AdoptResult['commands'] } | null {
  try {
    const raw = fs.readFileSync(stepsFile(projectRoot, feature), 'utf-8');
    const j = JSON.parse(raw) as { goal?: string; commands?: AdoptResult['commands'] };
    return j.commands && j.commands.length ? { goal: String(j.goal ?? ''), commands: j.commands } : null;
  } catch {
    return null;
  }
}

export type AdvanceStep = { step: number; tool: string; ok: boolean; tail: string };

export type AdvanceResult = {
  action: 'advance';
  ok: boolean;
  executed: AdvanceStep[];
  /** 失败那一步的拒绝原文；全绿时 null（★ 失败即停，不跳步） */
  stopped_at: { step: number; tool: string; reason: string } | null;
  remaining: number;
};

/**
 * 按依赖序执行 adopt 给出的步骤 —— **同一条引擎入口**（构建产物的 CLI 驱动同一 handler）。
 *
 * 为什么这样接：design_line action=plan 的守卫（归属判据 / 冻结快照 / 出口闭环）住在它的 handler 里，
 * 没有可复用的纯函数；再写一遍就是**第二份实现**，会与主路径悄悄分叉。所以这里调的是**同一个入口**。
 * ★ 这不是绕过写闸 —— 恰恰是**只走写闸**：任何一步被闸拒 ⇒ 立刻停、点名、后面的步不执行。
 */
export function oplAdvance(input: {
  feature: string;
  projectRoot: string;
  /** 最多执行到第几步（1-based，含；缺省 = 全部） */
  upto?: number;
  cliPath?: string;
}): AdvanceResult {
  const loaded = loadSteps(input.projectRoot, input.feature);
  if (!loaded) return { action: 'advance', ok: false, executed: [], stopped_at: null, remaining: 0 };
  const cli = input.cliPath ?? path.join(process.cwd(), 'dist', 'src', 'presentation', 'cli', 'cli.js');
  const executed: AdvanceStep[] = [];
  const limit = input.upto ?? Number.POSITIVE_INFINITY;
  for (const c of loaded.commands) {
    if (c.step > limit) break;
    const argv = [cli, c.tool];
    for (const [k, v] of Object.entries(c.args)) argv.push(k + '=' + (typeof v === 'string' ? v : JSON.stringify(v)));
    try {
      const out = execFileSync(process.execPath, argv, { encoding: 'utf8', cwd: process.cwd() });
      const last = out.split('\n').filter(Boolean).slice(-1)[0] ?? '';
      executed.push({ step: c.step, tool: c.tool, ok: true, tail: last.slice(0, 160) });
    } catch (e) {
      const raw = String((e as { stdout?: string }).stdout ?? '') + String((e as { stderr?: string }).stderr ?? '');
      const reason =
        raw
          .split('\n')
          .filter((l) => /^\s*(失败原因|拒绝|拒|缺口|E-[A-Z]+-\d+)/.test(l))
          .slice(0, 2)
          .join(' | ')
          .slice(0, 300) || raw.slice(-200);
      executed.push({ step: c.step, tool: c.tool, ok: false, tail: reason });
      return { action: 'advance', ok: false, executed, stopped_at: { step: c.step, tool: c.tool, reason }, remaining: loaded.commands.filter((x) => x.step > c.step).length };
    }
  }
  return { action: 'advance', ok: true, executed, stopped_at: null, remaining: 0 };
}
