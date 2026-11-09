/**
 * **引擎首次接管的自动评估协议**（2026-11-09）
 *
 * 一句话：接管任何项目之前，先判"这本册处在什么状态"，再决定**允许做什么**。
 *
 * | 场景 | 判据 | 引擎动作 |
 * |---|---|---|
 * | `fresh`    | `.agent-io/design/` 不存在 / 没有 `.dsl.json` | 派生设计侧，正常开始（fork） |
 * | `resume`   | 有册 **且** 每个节点的历史形态一致（全内联 / 全侧车 / 两者都没有） | **读入现有状态，不派生不覆盖**；未完成任务可认领；新目标挂**新**节点 |
 * | `conflict` | 某节点**内联与侧车同时存在且内容不对应** | **列出两侧内容与差异**，要求人裁定权威侧；**引擎不自动选边** |
 *
 * ★ 两条铁律（写死在返回值里，不靠调用方记）：
 * ① `conflict` 时 `safe_to_write=false` —— 任何 `decision.update` 都会被"两处都在"拦；本模块**不提供**"自动取其一"的入口。
 * ② `resume` 时 `fork_design=false` 且 `preserve_existing=true` —— 新目标只能挂**新节点**，已有节点的决策**原样保留**。
 *
 * ★ 收敛入口：冲突裁定后**用现有脚本** `scripts/migrate-decision-history.mjs --authoritative <inline|sidecar>`，
 *   本模块只负责"说清楚"，不负责"替你选"。
 */
import fs from 'node:fs';
import path from 'node:path';


export type TakeoverScenario = 'fresh' | 'resume' | 'conflict';

export type HistorySide = {
  /** 节点 id */
  node_id: string;
  /** 册里内联条数 */
  inline: number;
  /** 侧车条数 */
  sidecar: number;
  /** 形态：inline-only / sidecar-only / both / none */
  shape: 'inline-only' | 'sidecar-only' | 'both' | 'none';
  /** 两侧内容摘要（只做"能看出来是哪两条"的程度，不做判定） */
  diff?: {
    /** 第 i 条：内联 side 在前、侧车 side 在后 */
    at_index: number;
    inline_preview: string;
    sidecar_preview: string;
    same: boolean;
  }[];
};

export type AutoResolve = {
  /** 自动裁决的权威侧 */
  authoritative: 'inline' | 'sidecar';
  /** 被吸收的一侧（**不删除**，记入接管日志） */
  absorbed: 'inline' | 'sidecar';
  /** 依据（人可复核：时间差 + 兼容性 + 无 supersedes 矛盾） */
  basis: string[];
  /** 时间差（小时） */
  gap_hours: number;
};

export type TakeoverAssessment = {
  scenario: TakeoverScenario;
  project_root: string;
  feature: string;
  /** 找到的册（仓库相对或绝对；空 = 没有） */
  books: string[];
  /** 允许派生设计侧吗 */
  fork_design: boolean;
  /** 必须原样保留既有决策吗 */
  preserve_existing: boolean;
  /** 允许写设计册吗（conflict ⇒ false，直到收敛） */
  safe_to_write: boolean;
  /** 每个节点看到的历史形态（conflict 时逐条给差异） */
  history: HistorySide[];
  /** ★ 自动裁决（全部节点都能机械判定时才有；否则 undefined ⇒ 上抛人） */
  auto_resolve?: AutoResolve;
  /** 冲突的处置档位：auto（引擎可判）/ human（语义矛盾或时间戳不足） */
  resolution?: 'auto' | 'human';
  /** 人需要做什么（fresh / resume / auto ⇒ 通常为空） */
  needs_human: string[];
  /** 下一步建议命令（人读，不自动执行） */
  next: string[];
  /** 人读的一句话 */
  message: string;
};

const preview = (v: unknown): string => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
};

/* ─────────────── 机械可判 ⇔ 语义矛盾：两档分解 ─────────────── */

/** 一条历史条目的 `at`（毫秒；接受数字或 ISO 串）。取不到 ⇒ null（**不许当 0**） */
function atOf(e: unknown): number | null {
  const rec = (e ?? {}) as Record<string, unknown>;
  const raw = rec['at'] ?? rec['updated_at'] ?? rec['timestamp'];
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** 关键语义字段（只取"说了什么"，不取"什么时候说的"） */
function semanticsOf(e: unknown): { acceptance: string; summary: string; expectations: string } {
  const rec = (e ?? {}) as Record<string, unknown>;
  const d = (rec['decision'] ?? {}) as Record<string, unknown>;
  const norm = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : JSON.stringify(v ?? ''));
  return {
    acceptance: norm(d['acceptance'] ?? rec['acceptance']),
    summary: norm(d['summary'] ?? rec['summary']),
    expectations: JSON.stringify(d['expectations'] ?? rec['expectations'] ?? null),
  };
}

/** 语义等价（时间戳/格式不同不算差异） */
export function sameSemantics(a: unknown, b: unknown): boolean {
  const x = semanticsOf(a);
  const y = semanticsOf(b);
  return x.acceptance === y.acceptance && x.summary === y.summary && x.expectations === y.expectations;
}

/**
 * ★★ 2026-11-09：**兼容**判定（比"全等"松一档，按 spec 只认 acceptance/summary）：
 *  · summary 必须相同（说的事不同 ⇒ 直接矛盾）；
 *  · acceptance 相同，**或**一方是另一方的前缀/子集（较短侧被较长侧吸收）；
 *  · `expectations` 不参与 —— 它是"判据细节"，长侧补了细节不算矛盾（实测 review-hub 正是这种）。
 */
function compatibleSemantics(a: unknown, b: unknown): boolean {
  const x = semanticsOf(a);
  const y = semanticsOf(b);
  if (x.summary !== y.summary) return false;
  if (x.acceptance === y.acceptance) return true;
  const s = (v: string): string => v.replace(/\s+/g, ' ').trim();
  const ax = s(x.acceptance);
  const by = s(y.acceptance);
  if (!ax || !by) return false;
  if (ax.startsWith(by) || by.startsWith(ax)) return true;
  // ★ 实测：短侧末条以"。"结尾、长侧把它换成"；⑤ …" ⇒ 字面前缀不成立，但**条款是子集**。
  //   口径：按 ；/; 切条款（去尾部 。），短的每条都必须能在长的里找到。
  const clauses = (v: string): string[] =>
    v
      .split(/[；;]/)
      .map((c) => c.replace(/[。.\s]+$/g, '').trim())
      .filter(Boolean);
  const cx = clauses(ax);
  const cy = clauses(by);
  const [short, long] = cx.length <= cy.length ? [cx, cy] : [cy, cx];
  return short.length > 0 && short.every((c) => long.some((l) => l === c || l.includes(c) || c.includes(l)));
}

/** ★ 侧车**按 projectRoot 读**（不依赖 dataHome）：接管任何项目时，侧车就在该项目的 .agent-io 下 */
function sidecarEntriesOf(designDir: string, book: string): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  const file = path.join(designDir, book + '.history.jsonl');
  let text = '';
  try {
    if (!fs.existsSync(file)) return out;
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return out;
  }
  for (const raw of text.split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    try {
      const o = JSON.parse(s) as { node_id?: string; index?: number; entry?: unknown };
      if (!o.node_id) continue;
      const arr = out.get(o.node_id) ?? [];
      if (typeof o.index === 'number') arr[o.index] = o.entry ?? null;
      else arr.push(o.entry ?? null);
      out.set(o.node_id, arr);
    } catch {
      /* 坏行跳过：真正的一致性由 migrate 脚本的 bad_lines 负责 */
    }
  }
  return out;
}

/** supersedes 指向（字符串或数组；取不到 ⇒ 空） */
function supersedesOf(e: unknown): string[] {
  const rec = (e ?? {}) as Record<string, unknown>;
  const raw = rec['supersedes'];
  if (typeof raw === 'string') return [raw];
  return Array.isArray(raw) ? raw.map(String) : [];
}

const HOUR = 3600 * 1000;

/**
 * 判一对（内联 vs 侧车）能不能**机械裁决**。三条全满足才自动，缺一即上抛人：
 *  ① 两侧都有可靠 `at`，且差距 > 1 小时（排除同轮双写）；
 *  ② 内容兼容：重叠下标逐条**语义相同**，或较短侧是较长侧的语义前缀；
 *  ③ 无 supersedes 反指矛盾（两侧互指）。
 */
function judgePair(inlineArr: unknown[], sidecarArr: unknown[]): { auto: AutoResolve } | { why: string[] } {
  const why: string[] = [];

  const inlineAt = inlineArr.map(atOf).filter((x): x is number => x !== null);
  const sideAt = sidecarArr.map(atOf).filter((x): x is number => x !== null);
  if (inlineAt.length === 0 || sideAt.length === 0) why.push('至少一侧缺可靠 at 时间戳 ⇒ 判不了先后');
  const newestInline = inlineAt.length ? Math.max(...inlineAt) : null;
  const newestSide = sideAt.length ? Math.max(...sideAt) : null;
  const gap = newestInline !== null && newestSide !== null ? Math.abs(newestInline - newestSide) : 0;
  if (newestInline !== null && newestSide !== null && gap <= HOUR) why.push(`两侧时间差仅 ${(gap / HOUR).toFixed(2)} 小时（≤1 小时 ⇒ 可能同轮双写）`);

  // ② 语义兼容：重叠段逐条等价（较短侧 = 前缀）
  const overlap = Math.min(inlineArr.length, sidecarArr.length);
  const mismatch: number[] = [];
  for (let i = 0; i < overlap; i += 1) if (!compatibleSemantics(inlineArr[i], sidecarArr[i])) mismatch.push(i);
  if (mismatch.length > 0) why.push(`第 ${mismatch.slice(0, 3).join('/')} 条的 summary 或 acceptance **不能互容**（既不相同、也不是前缀关系）`);

  // ③ supersedes 反指
  const iSup = new Set(inlineArr.flatMap(supersedesOf));
  const sSup = new Set(sidecarArr.flatMap(supersedesOf));
  const contradiction = [...iSup].some((x) => sSup.has(x)) && [...sSup].some((x) => iSup.has(x));
  if (contradiction) why.push('两侧 supersedes 互指（谁是新的存在矛盾）');

  if (why.length > 0 || newestInline === null || newestSide === null) return { why };
  const inlineNewer = newestInline > newestSide;
  return {
    auto: {
      authoritative: inlineNewer ? 'inline' : 'sidecar',
      absorbed: inlineNewer ? 'sidecar' : 'inline',
      gap_hours: Number((gap / HOUR).toFixed(2)),
      basis: [
        `时间差 ${(gap / HOUR).toFixed(2)} 小时（>1h ⇒ 不是同轮双写），较新侧 = ${inlineNewer ? 'inline' : 'sidecar'}`,
        `语义兼容：重叠 ${overlap} 条逐条可相容（summary 相同；acceptance 相同或一方是另一方的前缀）`,
        '无 supersedes 反指矛盾',
        `被淘汰侧（${inlineNewer ? 'sidecar' : 'inline'}）**不删除**，记入接管日志`,
      ],
    },
  };
}

/**
 * 评估一个项目能不能被接管。
 * `feature` 缺省 ⇒ 看该根下**所有**册，任一册冲突即整体 `conflict`（接管前必须干净）。
 */
export function assessTakeover(input: { projectRoot: string; feature?: string }): TakeoverAssessment {
  const root = path.resolve(input.projectRoot).replace(/\\/g, '/');
  const designDir = path.join(root, '.agent-io', 'design');
  const feature = input.feature ?? '';

  const allBooks = (() => {
    try {
      if (!fs.existsSync(designDir)) return [];
      return fs
        .readdirSync(designDir)
        .filter((f) => f.endsWith('.dsl.json'))
        .map((f) => f.slice(0, -'.dsl.json'.length));
    } catch {
      return [];
    }
  })();
  const books = feature ? allBooks.filter((f) => f === feature) : allBooks;

  const base = {
    project_root: root,
    feature,
    books: books.map((b) => `.agent-io/design/${b}.dsl.json`),
  };

  // ① 全新
  if (books.length === 0) {
    return {
      ...base,
      scenario: 'fresh',
      fork_design: true,
      preserve_existing: false,
      safe_to_write: true,
      history: [],
      needs_human: [],
      next: ['import_project（派生设计侧）→ opl action=propose'],
      message:
        feature && allBooks.length > 0
          ? `本根有 ${allBooks.length} 册，但没有 "${feature}" ⇒ 按**全新**处理（只派生这一册，不动其它册）`
          : '没有设计册 ⇒ **全新接管**：派生设计侧，正常开始',
    };
  }

  // ② 逐节点看历史形态
  const history: HistorySide[] = [];
  const needsHuman: string[] = [];
  const verdicts: Array<{ node: string; auto?: AutoResolve; why?: string[] }> = [];
  let conflict = false;

  for (const b of books) {
    let dsl: { geometry?: { nodes?: Array<Record<string, unknown>> } } | null = null;
    try {
      dsl = JSON.parse(fs.readFileSync(path.join(designDir, b + '.dsl.json'), 'utf-8')) as {
        geometry?: { nodes?: Array<Record<string, unknown>> };
      };
    } catch {
      needsHuman.push(`${b}: 册读不出来（JSON 坏 / 结构校验失败）⇒ 这不是"没有历史"，需要先修册`);
      conflict = true;
      continue;
    }
    const nodes = dsl?.geometry?.nodes ?? [];
    const bookHasInline = nodes.some((n) => Array.isArray(n['decision_history']) && (n['decision_history'] as unknown[]).length > 0);
    const sidecarByNode = sidecarEntriesOf(designDir, b);
    for (const n of nodes) {
      const nodeId = String(n['id'] ?? '');
      const inlineArr = Array.isArray(n['decision_history']) ? (n['decision_history'] as unknown[]) : [];
      let sidecarArr: unknown[] = [];
      try {
        sidecarArr = (sidecarByNode.get(nodeId) ?? []).filter((x) => x !== null && x !== undefined);
      } catch {
        sidecarArr = [];
      }
      const shape: HistorySide['shape'] =
        inlineArr.length && sidecarArr.length ? 'both' : inlineArr.length ? 'inline-only' : sidecarArr.length ? 'sidecar-only' : 'none';
      const side: HistorySide = {
        node_id: nodeId,
        inline: inlineArr.length,
        sidecar: sidecarArr.length,
        shape,
      };
      if (shape === 'both') {
        // 两侧都不许我判"谁对"：只把差异逐条摆出来
        const diffs: NonNullable<HistorySide['diff']> = [];
        const n2 = Math.max(inlineArr.length, sidecarArr.length);
        for (let i = 0; i < n2; i += 1) {
          const a = inlineArr[i];
          const c = sidecarArr[i];
          const same = JSON.stringify(a) === JSON.stringify(c);
          diffs.push({ at_index: i, inline_preview: preview(a), sidecar_preview: preview(c), same });
        }
        side.diff = diffs;
        if (diffs.some((d) => !d.same)) {
          conflict = true;
          // ★ 两档：先试**机械可判**（时间差 + 语义兼容 + 无 supersedes 矛盾）；判不了才上抛人
          const j = judgePair(inlineArr, sidecarArr);
          if ('auto' in j) {
            verdicts.push({ node: nodeId, auto: j.auto });
            needsHuman.push(`${b}/${nodeId}：可**自动裁决**（${j.auto.authoritative} 权威，时间差 ${j.auto.gap_hours}h）`);
          } else {
            verdicts.push({ node: nodeId, why: j.why });
            needsHuman.push(`${b}/${nodeId}：**需要人裁定** —— ${j.why.join('；')}`);
          }
        } else {
          // 两侧内容一一对应（只是没删内联）⇒ 只需收敛，不需裁定
          needsHuman.push(`${b}/${nodeId}：两侧内容一致、只是内联没删 ⇒ 跑 migrate 即可收敛（不需要选边）`);
        }
      }
      if (shape !== 'none') history.push(side);
    }
  }

  if (conflict) {
    const conflicted = history.filter((h) => h.shape === 'both' && (h.diff ?? []).some((d) => !d.same));
    const autoOnes = verdicts.filter((v) => v.auto);
    const humanOnes = verdicts.filter((v) => !v.auto);
    const sides = new Set(autoOnes.map((v) => v.auto!.authoritative));
    // 只有**全部**冲突节点都能机械判定、且它们指向**同一侧**，才允许自动（否则仍是人的事）
    const allAuto = humanOnes.length === 0 && autoOnes.length > 0 && sides.size === 1;
    if (allAuto) {
      const side = [...sides][0];
      const absorbed = side === 'inline' ? 'sidecar' : 'inline';
      const gap = Math.max(...autoOnes.map((v) => v.auto!.gap_hours));
      return {
        ...base,
        scenario: 'conflict',
        resolution: 'auto',
        fork_design: false,
        preserve_existing: true,
        safe_to_write: false,
        history,
        auto_resolve: {
          authoritative: side,
          absorbed,
          gap_hours: gap,
          basis: [...autoOnes.flatMap((v) => v.auto!.basis), `共 ${autoOnes.length} 个冲突节点，全部指向 ${side}`],
        },
        needs_human: [],
        next: [
          `可**自动裁决**：较新侧 = ${side}（被吸收侧 ${absorbed} 不删除、写入接管日志）`,
          `node scripts/migrate-decision-history.mjs --project ${root} --authoritative ${side} --apply`,
          '收敛后重跑接管评估（应为 resume），再走 adopt',
        ],
        message: `**冲突（可自动裁决）**：${autoOnes.length} 个节点时间差 ${gap}h、语义兼容、无 supersedes 矛盾 ⇒ 取 ${side} 为权威`,
      };
    }
    return {
      ...base,
      scenario: 'conflict',
      resolution: 'human',
      fork_design: false,
      preserve_existing: true,
      safe_to_write: false,
      history,
      needs_human: needsHuman,
      next: [
        '⚠ 引擎**不替你选边**（存在语义矛盾 / 时间戳不足 / supersedes 反指）。确认权威侧后执行其一：',
        `  · 侧车权威：node scripts/migrate-decision-history.mjs --project ${root} --authoritative sidecar --apply`,
        `  · 内联权威：node scripts/migrate-decision-history.mjs --project ${root} --authoritative inline --apply`,
        '收敛后重跑接管评估（应为 resume）',
      ],
      message: `**冲突（需要人）**：${humanOnes.length} 个节点无法机械裁决（${conflicted.length} 个节点分叉）`,
    };
  }

  // ③ 续接管
  return {
    ...base,
    scenario: 'resume',
    fork_design: false,
    preserve_existing: true,
    safe_to_write: true,
    history,
    needs_human: needsHuman,
    next: [
      '读入现有状态（**不派生、不覆盖**）',
      '未完成任务：`edit_dsl task.claim`（带 reason）',
      '新目标：挂**新节点**，不要改已有节点的决策',
      ...(needsHuman.length ? ['或先跑 migrate 把内联收敛成侧车'] : []),
    ],
    message: `**续接管**：${books.length} 册可读 · 既有决策原样保留（新目标只能挂新节点）`,
  };
}
