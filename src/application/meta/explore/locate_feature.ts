/**
 * locate_feature —— `get_dsl query=locate`：**"改/加功能"的第一步**（设计侧定位原权威）。
 *
 * ## 为什么它必须存在
 * 现有查询方向全是「已知在哪 → 问它的细节」：
 *   `get_dsl query=files` 要 feature · `design_line action=brief` 要 node_id/path · `capability_map` 只到目录级。
 * ⇒ 做功能的第一步只能"新建"，而不是"找到原节点去改它"（代价：同生态位工具越加越多、45 次人工修整）。
 * 本查询补的是**相反方向**：给一段功能描述 / 符号名 / 关键词，回答"设计册里最像的是哪一处"。
 *
 * ## 它**不**做什么（边界，判据 c）
 * 只给**候选 + 分数 + 依据**；语义克隆（Type-4）无完备算法 ⇒ **不许**把 top-1 当判定。
 * 回执里固定带 `LOCATE_DISCLAIMER`。
 *
 * ## 数据来源（全部只读）
 *   - 语料 = 各 feature 的**设计册**（`semantic.files` + `geometry.nodes` 里非文件的节点）；
 *   - 消费者 = 代码事实（`cache.db` 的 `edges kind='import'`）+ 设计意图（`expected_deps` 反查）；
 *   - 权威位置 = **设计 DB** 投影（`design-db/<outNameOf(path)>`）+ 其中的 `symbols[]` 条目。
 * ★ 三条都不落盘、不写 DSL。
 */

import fs from 'node:fs';
import path from 'node:path';
import { listDesignSheets } from '../../../infrastructure/storage.js';
import { getProjectCacheDb } from '../../../infrastructure/index/db.js';
import type { Database } from '../../../infrastructure/index/db.js';
import { designDbDir, outNameOf } from '../../design/db/gen_design_db.js';
import {
  LOCATE_ALGORITHM,
  LOCATE_DISCLAIMER,
  LOCATE_STRONG_FLOOR,
  LOCATE_WEAK_FLOOR,
  buildLocateIndex,
  rankLocate,
  tokenizeLocate,
  type LocateDoc,
  type LocateHit,
} from '../../../domain/locate_score.js';
import type { DesignDSL } from '../../../domain/types.js';

/** 一个候选在册里的身份 + 权威位置 + 消费方。 */
interface LocatedCandidate {
  score: number;
  verdict: 'strong' | 'weak';
  feature: string;
  /** 同一 path 还出现在哪些 feature（★ 册之间互相有副本，不合并就全是噪音） */
  also_in: string[];
  kind: 'file' | 'node';
  id: string;
  path: string | null;
  label: string;
  /** 为什么像（一句人话，由命中的词拼出来） */
  why: string;
  matched_terms: Array<{ term: string; df: number; weight: number }>;
  authority: {
    db_file: string | null;
    /** 设计 DB 里命中的 `symbols[]` 条目（`symbols[i] name (kind @L行)`） */
    symbol_entries: string[];
    note?: string;
  };
  consumers: {
    /** 设计册声明依赖本文件的文件（`expected_deps` 反查） */
    design: string[];
    /** cache.db 里 import 本文件的文件（代码事实；含行号） */
    code: Array<{ file: string; line: number | null }>;
    note?: string;
  };
}

export interface LocateFeatureOptions {
  /** 功能描述 / 符号名 / 关键词（必填） */
  text: string;
  /** 只在这一册里找（省略 = 全部册，跨册互查） */
  feature?: string;
  /** 返回几条候选（默认 5） */
  top?: number;
  /** 项目根（用于打开 cache.db 找消费者 + 定位 design-db） */
  project_dir?: string;
}

export interface LocateFeatureResult {
  message: string;
  data: Record<string, unknown>;
}

const normText = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 把一册设计册展开成可检索文档（★ 唯一住处：语料口径只在这里定义一次）。 */
function docsOfSheet(dsl: DesignDSL): LocateDoc[] {
  const byId = new Map<string, NonNullable<DesignDSL['geometry']>['nodes'][number]>();
  for (const n of dsl.geometry?.nodes ?? []) byId.set(n.id, n);
  const out: LocateDoc[] = [];
  const fileIds = new Set<string>();

  for (const f of dsl.semantic?.files ?? []) {
    fileIds.add(f.id);
    const n = byId.get(f.id);
    const parts: string[] = [f.path ?? '', f.responsibility ?? ''];
    if (n) parts.push(n.title ?? '', n.label ?? '');
    const symbols = (f.symbols ?? []).map((s: { name: string }) => s.name);
    for (const s of f.symbols ?? []) parts.push(s.name, s.signature ?? '');
    for (const a of f.expected_apis ?? []) parts.push(a.signature ?? '', a.notes ?? '');
    const decision = n?.decision;
    if (decision) {
      parts.push(decision.summary ?? '');
      for (const e of decision.expectations ?? []) parts.push(e.kind ?? '', e.why ?? '');
    }
    out.push({
      key: f.path ? `file:${f.path}` : `file-id:${f.id}`,
      feature: dsl.feature,
      kind: 'file',
      id: f.id,
      path: f.path,
      label: normText(n?.label ?? f.path ?? f.id),
      text: parts.filter(Boolean).join(' '),
      symbols,
    });
  }
  // 非文件节点（目录 / 模块 / 服务…）：决策文本常常只挂在这里 ⇒ 必须进语料
  for (const n of dsl.geometry?.nodes ?? []) {
    if (fileIds.has(n.id)) continue;
    const parts: string[] = [n.label ?? '', n.title ?? '', n.arch_layer ?? ''];
    if (n.decision) {
      parts.push(n.decision.summary ?? '');
      for (const e of n.decision.expectations ?? []) parts.push(e.kind ?? '', e.why ?? '');
    }
    out.push({
      key: `node:${n.id}`,
      feature: dsl.feature,
      kind: 'node',
      id: n.id,
      path: n.path,
      label: normText(n.label ?? n.id),
      text: parts.filter(Boolean).join(' '),
      symbols: [],
    });
  }
  return out;
}

/** 设计 DB 投影里与本查询相关的 `symbols[]` 条目（★ 权威位置＝这份 json 的这一条）。 */
function symbolEntriesOf(root: string, relPath: string, query: string): { dbFile: string | null; entries: string[]; note?: string } {
  const dir = designDbDir(root);
  const name = outNameOf(relPath);
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    return { dbFile: null, entries: [], note: `设计 DB 无此投影（${name} 不存在 ⇒ 跑 design_line action=gen-db）` };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { symbols?: Array<{ name?: string; kind?: string; line?: number }> };
    const terms = new Set(tokenizeLocate(query));
    const rawLower = query.trim().toLowerCase();
    const entries: string[] = [];
    (raw.symbols ?? []).forEach((s, i) => {
      const nm = String(s.name ?? '');
      if (!nm) return;
      const low = nm.toLowerCase();
      // ★ 逐字命中 / 整串包含 / **分词后与查询词有交集**（`renameSymbols` 要认 `rename_symbols`）
      const symTerms = tokenizeLocate(nm);
      const hit = terms.has(low) || (rawLower.length > 2 && low.includes(rawLower)) || symTerms.some((t) => terms.has(t));
      if (hit) entries.push(`symbols[${i}] ${nm} (${s.kind ?? '?'} @L${s.line ?? '?'})`);
    });
    return {
      dbFile: path.relative(root, file).replace(/\\/g, '/'),
      entries: entries.slice(0, 3),
      ...(entries.length === 0 ? { note: '该文件的 symbols 里没有名字命中查询词（权威位置仍是这份 json）' } : {}),
    };
  } catch (err) {
    // ★ 0.12：读失败 ≠ 没有 —— 必须显式说，不许回落成空数组装作"没命中"
    return {
      dbFile: path.relative(root, file).replace(/\\/g, '/'),
      entries: [],
      note: `设计 DB 投影读取失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** 代码事实里的消费者（cache.db 已解析的 import 边）。打不开就**明确说**，不静默返回空。 */
function codeConsumersOf(db: Database | null, relPath: string): { list: Array<{ file: string; line: number | null }>; note?: string } {
  if (!db) return { list: [], note: 'cache.db 不可用（未给 project_dir / 未建索引）⇒ 代码侧消费者未查' };
  try {
    const rows = db.prepare("SELECT source, line FROM edges WHERE kind = 'import' AND target = ?").all(relPath) as Array<{
      source: string;
      line: number | null;
    }>;
    return { list: rows.map((r) => ({ file: r.source, line: r.line })) };
  } catch (err) {
    return { list: [], note: `cache.db 查询失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

/** 一句人话的"为什么像"：把命中的词连同它的鉴别力(df)写出来。 */
function whyOf(hit: LocateHit): string {
  const parts: string[] = [];
  if (hit.terms.length > 0) {
    parts.push('命中词 ' + hit.terms.map((t) => `${t.term}(df ${t.df})`).join(' + '));
  }
  if (hit.literal > 0) parts.push(`字面量命中（加 ${hit.literal}）`);
  return parts.join(' · ') || '(无词命中)';
}

export function locateFeature(o: LocateFeatureOptions): LocateFeatureResult {
  const query = normText(o.text);
  if (!query) throw new Error('query "locate" 需要 text 参数（功能描述 / 符号名 / 关键词）');

  const t0 = Date.now();
  const sheets = listDesignSheets().filter((d) => !o.feature || d.feature === o.feature);
  if (sheets.length === 0) {
    return {
      message:
        `设计册里没有可检索的 feature${o.feature ? `（给了 feature="${o.feature}"，但它不在册里）` : '（一册都没有）'}` +
        ` ⇒ **不是"没有匹配"，是"没有可搜的东西"**（先 import_project 建档）`,
      data: { matched: false, reason: 'no_corpus', searched: { features: 0, docs: 0 } },
    };
  }
  const docs: LocateDoc[] = [];
  for (const dsl of sheets) docs.push(...docsOfSheet(dsl));
  const tLoad = Date.now() - t0;

  const t1 = Date.now();
  const index = buildLocateIndex(docs);
  const tIndex = Date.now() - t1;

  const t2 = Date.now();
  // ★ 多取几倍再按 key 去重：同一 path 在 2~3 册里都有副本，直接截 top 会被副本占满
  const ranked = rankLocate(index, query, { top: Math.max(1, (o.top ?? 5) * 4) });
  const tRank = Date.now() - t2;

  const root = o.project_dir ?? process.cwd();
  let db: Database | null = null;
  if (o.project_dir) {
    try {
      db = getProjectCacheDb(o.project_dir);
    } catch {
      db = null; // 已经会在 consumers.note 里如实说"不可用"
    }
  }

  // 按 key 折叠跨册副本（保留分数最高的一册，其余记进 also_in）
  const folded = new Map<string, { hit: LocateHit; features: string[] }>();
  for (const h of ranked.hits) {
    const cur = folded.get(h.key);
    if (cur) {
      if (!cur.features.includes(h.doc.feature)) cur.features.push(h.doc.feature);
    } else folded.set(h.key, { hit: h, features: [h.doc.feature] });
  }
  const picked = [...folded.values()].slice(0, Math.max(1, o.top ?? 5));

  // 设计意图侧的消费者（expected_deps 反查）：册里没人声明依赖 = 0，也要如实报 0
  const allFiles = sheets.flatMap((d) => d.semantic?.files ?? []);
  const candidates: LocatedCandidate[] = picked.map(({ hit, features }) => {
    const doc = hit.doc;
    const authority = doc.kind === 'file' && doc.path
      ? symbolEntriesOf(root, doc.path, query)
      : { dbFile: null, entries: [] as string[], note: '非文件节点没有 design-db 投影（投影按文件生成）' };
    const designDeps = doc.path ? allFiles.filter((f) => (f.expected_deps ?? []).includes(doc.path!)).map((f) => f.path) : [];
    const code = doc.path ? codeConsumersOf(db, doc.path) : { list: [], note: '非文件节点没有文件级 import 边' };
    return {
      score: Number(hit.score.toFixed(3)),
      verdict: hit.verdict === 'strong' ? 'strong' : 'weak',
      feature: doc.feature,
      also_in: features.filter((f) => f !== doc.feature),
      kind: doc.kind,
      id: doc.id,
      path: doc.path ?? null,
      label: doc.label,
      why: whyOf(hit),
      matched_terms: hit.terms.map((t) => ({ term: t.term, df: t.df, weight: Number(t.weight.toFixed(3)) })),
      authority: {
        db_file: authority.dbFile,
        symbol_entries: authority.entries,
        ...(authority.note ? { note: authority.note } : {}),
      },
      consumers: {
        design: designDeps,
        code: code.list,
        ...(designDeps.length === 0 ? { note: '设计册没有任何文件在 expected_deps 里声明依赖它（册内依赖意图为 0 条）' } : {}),
        ...(code.note ? { note: [code.note, designDeps.length === 0 ? '册内依赖意图 0 条' : ''].filter(Boolean).join('；') } : {}),
      },
    };
  });

  // ── 判读与文案 ────────────────────────────────────────────────
  // ★★ `candidates` 只放**达标**的；低于线的进 `weak_leads`。
  //   为什么必须分开（判据 b）：把"最像的"和"候选"放同一个数组里，调用方就会当它是匹配 ——
  //   而"空手返回"与"硬凑一个最像的"是同一种谎的两面。
  const strong = candidates.filter((c) => c.verdict === 'strong');
  const weakLeads = candidates.filter((c) => c.verdict !== 'strong');
  const lines: string[] = [
    `══ 设计侧定位（query=locate）：把"功能"映到"册里既有节点" ══`,
    `  算法：${LOCATE_ALGORITHM}`,
    `  语料：${sheets.length} 册 / ${docs.length} 个节点（文件 ${docs.filter((d) => d.kind === 'file').length} · 非文件 ${docs.filter((d) => d.kind === 'node').length}）` +
      ` · 耗时 载入 ${tLoad}ms + 建索引 ${tIndex}ms + 排序 ${tRank}ms`,
    `  ★ ${LOCATE_DISCLAIMER}`,
    '',
    `  查询「${query}」→ 分词 ${ranked.terms.length} 个：` +
      (ranked.terms.map((t) => (t.df === 0 ? `${t.term}(★ 册里没有)` : `${t.term}(df ${t.df})`)).join(' · ') || '(空)'),
  ];

  if (strong.length === 0) {
    const absent = ranked.terms.filter((t) => t.df === 0).map((t) => t.term);
    lines.push(
      '',
      `  ★★ **设计里没有匹配**（没有节点到 ${LOCATE_STRONG_FLOOR} 的达标线）—— 这不是"我没搜"：`,
      `     搜了 ${sheets.length} 册 / ${docs.length} 个节点（文件 + 非文件）；` +
        `${ranked.terms.filter((t) => t.df > 0).length}/${ranked.terms.length} 个查询词在册里出现过` +
        (absent.length ? `，${absent.length} 个**一次都没出现**：${absent.join('、')}` : '') +
        `；最高分 ${candidates[0]?.score ?? 0}。`,
      `     ⇒ 结论：**册里确实没有这一处**（按上面的分词口径）。若你确信它该有，先换册里实际用的词/工具名再查 ——`,
      `        不要拿下面那几条"最接近的"当匹配。`,
    );
    if (weakLeads.length) {
      lines.push('', `     ─ 低于线的最接近几条（**不是候选**，只是"搜到过它"的取证）─`);
      for (const c of weakLeads) {
        lines.push(`       [${c.score}] ${c.feature} · ${c.kind} ${c.path ?? c.id} ← ${c.why}`);
      }
    }
  } else {
    strong.forEach((c, i) => {
      lines.push(
        '',
        `  ${i + 1}. ● [${c.score}] ${c.feature} · ${c.kind} ${c.path ?? c.id}`,
        `     为什么像：${c.why}`,
        `     权威位置：${c.authority.db_file ? `${c.authority.db_file} → ${c.authority.symbol_entries.join(' · ') || '(symbols 无名词命中)'}` : '(无 design-db 投影)'}` +
          (c.authority.note ? `\n       注：${c.authority.note}` : ''),
        `     消费方：代码侧 ${c.consumers.code.length} 个导入方` +
          (c.consumers.code.length
            ? `（${c.consumers.code.slice(0, 4).map((x) => `${x.file}${x.line ? `:${x.line}` : ''}`).join('，')}${c.consumers.code.length > 4 ? ' …' : ''}）`
            : '') +
          ` · 设计意图侧 ${c.consumers.design.length} 条` +
          (c.consumers.note ? `\n       注：${c.consumers.note}` : ''),
        ...(c.also_in.length ? [`     同路径也出现在：${c.also_in.join(' / ')}（已折叠，未重复计分）`] : []),
      );
    });
    if (weakLeads.length) {
      lines.push('', `  ─ 另有 ${weakLeads.length} 条低于线的弱线索（不进候选）：` +
        weakLeads.map((c) => `${c.path ?? c.id}(${c.score})`).join(' · '));
    }
  }

  lines.push(
    '',
    `  判读：达标 ${strong.length} 条 · 弱线索 ${weakLeads.length} 条（达标线 ${LOCATE_STRONG_FLOOR} / 弱线索线 ${LOCATE_WEAK_FLOOR}）`,
    `  下一步（按候选逐个表态，不许跳）：get_dsl query=file file_id=<命中节点 id> → design_line action=brief path=<path>`,
  );

  return {
    message: lines.join('\n'),
    data: {
      query,
      matched: strong.length > 0,
      verdict: strong.length > 0 ? 'strong' : candidates.length > 0 ? 'weak' : 'none',
      disclaimer: LOCATE_DISCLAIMER,
      algorithm: LOCATE_ALGORITHM,
      floors: { strong: LOCATE_STRONG_FLOOR, weak: LOCATE_WEAK_FLOOR },
      searched: {
        features: sheets.map((d) => d.feature),
        docs: docs.length,
        file_docs: docs.filter((d) => d.kind === 'file').length,
        node_docs: docs.filter((d) => d.kind === 'node').length,
        terms: ranked.terms,
        /** 册里连一次都没出现的查询词 —— 判据 b「设计里没有」的取证 */
        absent_terms: ranked.terms.filter((t) => t.df === 0).map((t) => t.term),
      },
      timing_ms: { load: tLoad, index: tIndex, rank: tRank },
      candidates: strong,
      /** ★ 低于达标线的"最接近的" —— **不是候选**（判据 b：不许硬凑一个最像的当匹配） */
      weak_leads: weakLeads,
    },
  };
}
