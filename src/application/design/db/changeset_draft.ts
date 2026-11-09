/**
 * 功能目标 + 项目事实 → **可审查的 ChangeSet 草案**（2026-11-09，第二轮修缺陷）
 *
 * 一句话：给我「项目根 + 一条功能目标」，还我一份能被人逐条打回的草案。
 *
 * ## 本轮修的两个已定位缺陷
 * ① **候选排序**：上一版让 goal A / goal B 都落到 `src/protocol.ts`（不同目标共享同一无条件首选）。
 *    现在按**四个信号族**分别计价，并要求**至少 2 族同时命中**才给草案：
 *      · `sym` 符号名 ↔ 目标词元（3.0/处）
 *      · `lit` 目标里的标识符字面量 ↔ **源码文本**（2.0/处，`_`/`-` 视作同一分隔符）
 *      · `text` 目标词 bigram ↔ 节点职责文本（按 IDF，1/df）
 *      · `dep` call 边 ↔ 目标词元（1.5/处）
 *    证据不足 ⇒ **`no_candidate`**（`changeSet:null`），不硬凑一份草案。
 * ② **契约复用**：上一版自己拼路径读册、读不到（册上明明有 1 条却报 0）。
 *    现在改读权威 `getDSL(feature)`（`infrastructure/storage`），并且：
 *      · 同主体 + 同 kind ⇒ **引用既有契约**（`reuse`），不生成第二条；
 *      · 同主体但**语义不同**（例如既有是 `behavior-cases`、本次要 `call-exists`）⇒ 明确标 `needs_new`，
 *        不靠文本相似度判"相同"。
 *
 * ## 依然成立的硬规则
 * · 候选一律 `chosen:false`，`unconfirmed` 点名要人挑；· 行为契约只给 `kind/symbol/needs` 骨架，
 *   `cases` 留空（**不许从当前实现抄预期**）；· 类方法/引用不可用 ⇒ `unsupported` 点名；· 每项带 `goal_ref`。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { ChangeSetInput, ChangeSetPlanInput } from '../../../domain/change_set.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import { getDSL } from '../../../infrastructure/storage.js';
import { locateFeature } from '../../meta/explore/locate_feature.js';
import { findReferences } from '../../refactor/find/find_references.js';

export type DraftGoal = { text: string; feature?: string };

export type DraftSubject = {
  file: string;
  symbol: string;
  total: number;
  signals: { sym: number; lit: number; text: number; dep: number };
  /** 几个信号族同时命中（<2 视为证据不足） */
  families: number;
  why: string;
  chosen: false;
  existing_expectations: number;
};

export type DraftWorkItem = {
  order: number;
  role: 'primary' | 'consumer';
  file: string;
  symbol: string;
  goal_ref: string;
  depends_on: number[];
  kind: 'rewrite';
  detail: string;
  contract: {
    kind: 'behavior-cases' | 'call-exists';
    path: string;
    symbol: string;
    target?: string;
    needs: string[];
    note: string;
    /** 复用既有契约 / 必须新建 / 待填 */
    status: 'reuse' | 'needs_new' | 'empty_shell';
  };
  counterexample: string;
};

export type ChangeSetDraft = {
  goal: DraftGoal;
  /** `no_candidate` ⇒ 后面全是空、changeSet 为 null（不硬凑） */
  outcome: 'draft' | 'no_candidate';
  subjects: DraftSubject[];
  consumers: Array<{ file: string; symbol: string | null; evidence: string; source: 'symbol-refs' | 'call-edge' | 'import-edge' }>;
  work_items: DraftWorkItem[];
  reuse: Array<{ file: string; symbol: string; kind: string; why: string }>;
  unsupported: Array<{ what: string; reason: string }>;
  unconfirmed: string[];
  changeSet: ChangeSetInput | null;
};

const norm = (p: string): string => String(p).replace(/\\/g, '/');
const MIN_TOTAL = 2.0;
const MIN_FAMILIES = 2;

/** 目标里的 ascii 词元（符号名可能命中） */
const ASCII_TOKEN = /[A-Za-z][A-Za-z0-9_]{2,}/g;
/** 目标里的"标识符样"字面量：大写下划线 或 带数字的 snake/camel 段 */
const LITERAL_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b|\b[a-z]+[0-9]+\b/g;
/** 中文 bigram */
function bigramsOf(goal: string): string[] {
  const out = new Set<string>();
  for (const run of goal.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2));
  }
  return [...out];
}
const sep = (s: string): string => s.replace(/[_\-\s]+/g, '-').toLowerCase();

function symbolsOf(root: string, file: string): string[] {
  try {
    const db = getProjectCacheDb(root);
    return [
      ...new Set(
        (db.prepare("SELECT name FROM nodes WHERE file_path = ? AND kind IN ('function','method')").all(file) as Array<{ name: string }>).map((r) => String(r.name)),
      ),
    ];
  } catch {
    return [];
  }
}

function isMethod(root: string, file: string, symbol: string): boolean {
  try {
    const row = getProjectCacheDb(root).prepare('SELECT kind FROM nodes WHERE file_path = ? AND name = ? LIMIT 1').get(file, symbol) as { kind?: string } | undefined;
    return String(row?.kind ?? '') === 'method';
  } catch {
    return false;
  }
}

function callConsumers(root: string, symbol: string): Array<{ file: string; symbol: string }> {
  try {
    const db = getProjectCacheDb(root);
    const rows = db
      .prepare(
        `SELECT DISTINCT s.file_path AS f, s.name AS n FROM edges e
           JOIN nodes t ON t.id = e.target JOIN nodes s ON s.id = e.source
          WHERE e.kind = 'call' AND t.name = ? AND s.file_path <> t.file_path`,
      )
      .all(symbol) as Array<{ f: string; n: string }>;
    return rows.map((r) => ({ file: norm(String(r.f)), symbol: String(r.n) }));
  } catch {
    return [];
  }
}

function importConsumers(root: string, file: string): string[] {
  try {
    const db = getProjectCacheDb(root);
    const rows = db
      .prepare(
        `SELECT DISTINCT s.file_path AS f FROM edges e
           JOIN nodes t ON t.id = e.target JOIN nodes s ON s.id = e.source
          WHERE t.file_path = ? AND s.file_path <> ? AND e.kind = 'import'`,
      )
      .all(file, file) as Array<{ f: string }>;
    return [...new Set(rows.map((r) => norm(String(r.f))))];
  } catch {
    return [];
  }
}

/** 册上节点（权威读取：`getDSL`，不再自己拼路径） */
type SheetNode = { path?: string; summary?: string; decision?: { summary?: string; expectations?: Array<Record<string, unknown>> } };

function sheetNodes(feature: string | undefined, root: string): SheetNode[] {
  const features = feature ? [feature] : (() => {
    try {
      const dir = path.join(root, '.agent-io', 'design');
      return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dsl.json')).map((f) => f.replace(/\.dsl\.json$/, '')) : [];
    } catch {
      return [];
    }
  })();
  const out: SheetNode[] = [];
  for (const f of features) {
    try {
      const dsl = getDSL(f) as unknown as { geometry?: { nodes?: SheetNode[] } } | null;
      for (const n of dsl?.geometry?.nodes ?? []) out.push(n);
    } catch {
      /* 单册读失败不影响其它册 */
    }
  }
  return out;
}

const summaryOf = (n: SheetNode): string => String(n.decision?.summary ?? n.summary ?? '');
const expectationsOf = (n: SheetNode): Array<Record<string, unknown>> => (n.decision?.expectations as Array<Record<string, unknown>> | undefined) ?? [];

/** 已有契约（同主体）：返回该符号上已有的判据 */
function existingOf(nodes: SheetNode[], file: string, symbol: string): Array<{ kind: string; why: string }> {
  const n = nodes.find((x) => norm(String(x.path ?? '')) === norm(file));
  if (!n) return [];
  return expectationsOf(n)
    .filter((e) => String(e.symbol ?? '') === symbol || String(e.target ?? '') === symbol)
    .map((e) => ({ kind: String(e.kind ?? ''), why: `册上 ${norm(file)} 的 decision.expectations 里已有 ${String(e.kind ?? '')}（symbol=${String(e.symbol ?? '-')}${e.target ? `, target=${String(e.target)}` : ''}）` }));
}

/** 源码文本（做字面量信号用；读不到就当没有 —— 不猜） */
function sourceText(root: string, file: string): string {
  try {
    return fs.readFileSync(path.join(root, file), 'utf-8').toLowerCase();
  } catch {
    return '';
  }
}

export async function draftChangeSet(input: { projectRoot: string; goal: string; feature?: string }): Promise<ChangeSetDraft> {
  const root = input.projectRoot.replace(/\\/g, '/');
  const goal: DraftGoal = { text: input.goal, ...(input.feature ? { feature: input.feature } : {}) };
  const nodes = sheetNodes(input.feature, root);
  const grams = bigramsOf(input.goal);
  const asciiTokens = [...new Set((input.goal.match(ASCII_TOKEN) ?? []).map((t) => t.toLowerCase()))];
  const literals = [...new Set((input.goal.match(LITERAL_TOKEN) ?? []).map((t) => t.toLowerCase()))];

  const unsupported: Array<{ what: string; reason: string }> = [];
  const unconfirmed: string[] = [];
  const reuse: Array<{ file: string; symbol: string; kind: string; why: string }> = [];

  // ① 文件候选（locate 语料 + 册上节点，两者取并集，来源各自标注）
  const located = locateFeature({ text: input.goal, ...(input.feature ? { feature: input.feature } : {}), project_dir: root, top: 6 });
  const locatedPaths = ((located.data as { candidates?: Array<Record<string, unknown>> }).candidates ?? []).map((c) => norm(String(c.path ?? ''))).filter(Boolean);
  const candidateFiles = [...new Set([...locatedPaths, ...nodes.map((n) => norm(String(n.path ?? ''))).filter(Boolean)])];
  if (candidateFiles.length === 0) {
    return {
      goal,
      outcome: 'no_candidate',
      subjects: [],
      consumers: [],
      work_items: [],
      reuse,
      unsupported: [{ what: '文件候选', reason: '册上没有任何可检索节点（先 import_project 建档）' }],
      unconfirmed: ['没有候选 ⇒ 需要人给一个文件/符号作为起点'],
      changeSet: null,
    };
  }

  // ② 四信号打分（逐族可读；族数 < 2 或总分 < 阈值 ⇒ 证据不足）
  const docText = new Map<string, string>();
  for (const n of nodes) {
    const p = norm(String(n.path ?? ''));
    if (p) docText.set(p, (docText.get(p) ?? '') + ' ' + summaryOf(n));
  }
  const subjects: DraftSubject[] = [];
  for (const file of candidateFiles) {
    const text = docText.get(file) ?? '';
    const src = sourceText(root, file);
    const syms = symbolsOf(root, file);
    let symBest = 0;
    let symWhy = '';
    for (const sym of syms) {
      const low = sep(sym);
      let hit = 0;
      for (const t of asciiTokens) if (low.includes(sep(t)) || sep(t).includes(low)) hit += 1;
      if (hit > 0 && hit * 3 > symBest) {
        symBest = hit * 3;
        symWhy = `符号名 ${sym} 命中目标词元 ${hit} 处`;
      }
    }
    let lit = 0;
    const litWhy: string[] = [];
    for (const L of literals) {
      const variants = [L, sep(L)];
      if (variants.some((v) => v.length > 3 && src.includes(v.toLowerCase()))) {
        lit += 2;
        litWhy.push(L);
      }
    }
    let textScore = 0;
    const textWhy: string[] = [];
    for (const g of grams) {
      const df = [...docText.values()].filter((t) => t.includes(g)).length;
      if (df === 0 || df > Math.max(1, docText.size * 0.6)) continue; // 到处都有 ⇒ 没鉴别力
      if (text.includes(g)) {
        textScore += 1 / df;
        textWhy.push(g);
      }
    }
    let dep = 0;
    const depWhy: string[] = [];
    for (const sym of syms) {
      for (const c of callConsumers(root, sym)) {
        const hitTok = asciiTokens.some((t) => sep(c.symbol).includes(sep(t)));
        if (hitTok) {
          dep += 1.5;
          depWhy.push(`${c.file}#${c.symbol} 调 ${sym}`);
        }
      }
    }
    const total = Number((symBest + lit + textScore + dep).toFixed(3));
    const families = [symBest, lit, textScore, dep].filter((v) => v > 0).length;
    const primarySym = symBest > 0 ? syms.find((s) => { const low = sep(s); return asciiTokens.some((t) => low.includes(sep(t)) || sep(t).includes(low)); }) : syms[0];
    if (!primarySym) continue;
    subjects.push({
      file,
      symbol: primarySym,
      total,
      signals: { sym: Number(symBest.toFixed(3)), lit: Number(lit.toFixed(3)), text: Number(textScore.toFixed(3)), dep: Number(dep.toFixed(3)) },
      families,
      why: [symWhy, litWhy.length ? `目标字面量出现在源码：${litWhy.join('/')}` : '', textWhy.length ? `职责文本命中 bigram ${textWhy.slice(0, 4).join('/')}` : '', depWhy.length ? `依赖：${depWhy.slice(0, 2).join('；')}` : '']
        .filter(Boolean)
        .join(' · ') || '(无信号命中)',
      chosen: false,
      existing_expectations: existingOf(nodes, file, primarySym).length,
    });
    // ★★ 2026-11-09（真实项目暴露的缺陷）：**每个文件只给一个候选符号** ⇒ 人根本选不到真正的目标
    //   （实测：review-hub 上 parseEnvelope 明明存在，却因为该文件只列了 baseRole 而无法采纳）。
    //   修法：同文件的其它函数/方法也列出来（**只是候选**，chosen 仍为 false；符号级信号未单独计，如实写明）。
    for (const sym of syms) {
      if (sym === primarySym) continue;
      subjects.push({
        file,
        symbol: sym,
        total: Number(Math.max(0, total - 0.1).toFixed(3)),
        signals: { sym: 0, lit: 0, text: 0, dep: 0 },
        families,
        why: '同文件候选（文件级信号命中；符号级信号未单独计）⇒ 由人确认',
        chosen: false,
        existing_expectations: existingOf(nodes, file, sym).length,
      });
    }
  }
  subjects.sort((a, b) => b.total - a.total || b.families - a.families);

  const top = subjects[0];
  if (!top || top.total < MIN_TOTAL || top.families < MIN_FAMILIES) {
    return {
      goal,
      outcome: 'no_candidate',
      subjects,
      consumers: [],
      work_items: [],
      reuse,
      unsupported: [
        {
          what: '候选主体的证据',
          reason:
            subjects.length === 0
              ? '候选文件在索引里没有函数/方法节点'
              : `最高分候选 ${top.file}#${top.symbol} 仅 ${top.total}（阈值 ${MIN_TOTAL}）· 命中信号族 ${top.families}（要求 ≥${MIN_FAMILIES}）⇒ **证据不足，不出草案**`,
        },
      ],
      unconfirmed: [
        `证据不足 ⇒ 需要人指定主体。逐文件信号：${subjects
          .slice(0, 4)
          .map((s) => `${s.file}(sym ${s.signals.sym}/lit ${s.signals.lit}/text ${s.signals.text}/dep ${s.signals.dep})`)
          .join(' · ')}`,
      ],
      changeSet: null,
    };
  }

  // ③ 消费方（三种来源分别标）
  const consumers: ChangeSetDraft['consumers'] = [];
  try {
    const refs = (await findReferences({ file: top.file, symbol: top.symbol, mode: 'symbol', project_dir: root } as never)) as unknown as {
      data?: { importers?: Array<{ file?: string }> };
    };
    const importers = refs.data?.importers ?? [];
    if (importers.length === 0) {
      unsupported.push({
        what: `符号级引用（${top.file}#${top.symbol}）`,
        reason: isMethod(root, top.file, top.symbol)
          ? '解析返回 0：这是**类/方法成员**，引用闭包有已知缺口 ⇒ 只能退回 call/import 边，不代表没有消费方'
          : '解析返回 0（**引用闭包不足，未定因**）⇒ 只能退回 call/import 边，不代表没有消费方',
      });
    }
    for (const im of importers) if (im.file) consumers.push({ file: norm(im.file), symbol: null, evidence: '符号引用闭包', source: 'symbol-refs' });
  } catch (e) {
    unsupported.push({ what: '符号级引用', reason: `findReferences 失败：${String((e as Error).message).slice(0, 80)}` });
  }
  for (const cc of callConsumers(root, top.symbol)) {
    if (cc.file === top.file) continue;
    if (!consumers.some((c) => c.file === cc.file && c.symbol === cc.symbol))
      consumers.push({ file: cc.file, symbol: cc.symbol, evidence: `cache.db 的 call 边（${cc.symbol} → ${top.symbol}）`, source: 'call-edge' });
  }
  for (const f of importConsumers(root, top.file)) {
    if (f === top.file || consumers.some((c) => c.file === f)) continue;
    consumers.push({ file: f, symbol: null, evidence: 'cache.db 的 import 边（文件级；哪个符号在调需人确认）', source: 'import-edge' });
  }

  // ④ 工作项（主体在前，消费方在后；复用判定逐项做）
  const work_items: DraftWorkItem[] = [];
  const primaryExisting = existingOf(nodes, top.file, top.symbol);
  const haveBehavior = primaryExisting.find((e) => e.kind === 'behavior-cases' || e.kind === 'run' || e.kind === 'domain-independent');
  if (haveBehavior) reuse.push({ file: top.file, symbol: top.symbol, kind: haveBehavior.kind, why: haveBehavior.why + ' ⇒ 复用它，不新建第二条' });
  work_items.push({
    order: 1,
    role: 'primary',
    file: top.file,
    symbol: top.symbol,
    goal_ref: input.goal,
    depends_on: [],
    kind: 'rewrite',
    detail: `${top.symbol}：实现目标行为（证据：${top.why}）`,
    contract: {
      kind: 'behavior-cases',
      path: top.file,
      symbol: top.symbol,
      needs: haveBehavior ? ['cases（补到既有那条里）'] : ['given', 'expect'],
      status: haveBehavior ? 'reuse' : 'empty_shell',
      note: haveBehavior
        ? `★ 复用既有判据（${haveBehavior.kind}）—— 只补 cases，不改 kind、不新建第二条`
        : '空壳：只给 kind/symbol；`cases` 由人按目标填，**不许**从当前实现抄既成行为',
    },
    counterexample: '造一个"当前会红"的输入：把实现改回旧写法，这条契约必须变红（不许拿现值当期望）',
  });
  consumers.forEach((c, i) => {
    const existing = c.symbol ? existingOf(nodes, c.file, c.symbol) : [];
    const haveCall = existing.find((e) => e.kind === 'call-exists');
    work_items.push({
      order: i + 2,
      role: 'consumer',
      file: c.file,
      symbol: c.symbol ?? '(该文件里调用主体的符号需人指定)',
      goal_ref: input.goal,
      depends_on: [1],
      kind: 'rewrite',
      detail: `消费方跟上：${c.file} 必须按新语义调用 ${top.symbol}（证据：${c.evidence}）`,
      contract: {
        kind: 'call-exists',
        path: c.file,
        symbol: c.symbol ?? '(待指定)',
        target: top.symbol,
        needs: haveCall ? ['（无：已存在同主体 call-exists）'] : ['symbol'],
        status: haveCall ? 'reuse' : c.symbol ? 'needs_new' : 'empty_shell',
        note: haveCall
          ? '★ 复用：该消费方上已有 call-exists，别再加第二条'
          : c.symbol
            ? '新契约：现有判据里**没有**同主体 call-exists ⇒ 必须新增（语义不同 ≠ 文本相似）'
            : '消费方符号未定 ⇒ 先由人确认在调主体的是哪个符号',
      },
      counterexample: '把消费方里的这次调用删掉/换回旧写法 ⇒ 该 call-exists 必须变红',
    });
  });

  // ⑤ 人必须决定
  if (subjects.length > 1) {
    unconfirmed.push(`主函数候选未确认（top-${Math.min(3, subjects.length)}：${subjects.slice(0, 3).map((s) => `${s.file}#${s.symbol}(${s.total}, ${s.families} 族)`).join(' / ')}）⇒ 草案不替你选主体`);
  }
  if (consumers.some((c) => c.symbol === null)) unconfirmed.push('消费方文件已定位，但**哪个符号在调主体**需要人确认（符号级引用不可用）');
  unconfirmed.push('行为的期望值（given/expect）必须由人按目标写，草案**不**从当前实现抄');

  // ⑥ 复用既有 ChangeSet 形状
  const plans: ChangeSetPlanInput[] = work_items.map((w) => ({
    file: w.file,
    entries: [
      {
        file: w.file,
        kind: 'rewrite',
        detail: `[草案·order ${w.order}] ${w.detail}`,
        judgement_ref: `card:${w.file}#${w.symbol}`,
        status: 'open',
        note: `goal: ${w.goal_ref} ｜ 契约 ${w.contract.kind}（${w.contract.status}）待填：${w.contract.needs.join('/')}`,
      },
    ],
  }));
  const changeSet: ChangeSetInput = {
    card: { id: `draft:${top.symbol}`, kind: 'unknown', feature: input.feature ?? null, node_id: null, state: null, owner: null, claimed_at: null, life: null },
    decision: {
      summary: input.goal,
      rationale: `引擎草案：候选 ${subjects.length}（**均未确认**）· 消费方 ${consumers.length} · 复用 ${reuse.length} · 不支持 ${unsupported.length}`,
      acceptance: work_items.map((w) => `order ${w.order} ${w.file}#${w.symbol}：${w.contract.kind}(${w.contract.status}) + 反例（${w.counterexample}）`).join(' ｜ '),
      expectations: [],
    },
    plans,
    evidence: [{ kind: 'changeset-draft', at: new Date().toISOString() }],
  };

  return { goal, outcome: 'draft', subjects, consumers, work_items, reuse, unsupported, unconfirmed, changeSet };
}
