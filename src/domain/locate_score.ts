/**
 * locate_score —— 「功能 → 它在设计册里的哪一处」的**排序算法**（零依赖纯函数）。
 *
 * ★ 为什么这件事只能"给候选"、不能"下判定"：
 *   - 有实证基线的部分：VSM / LSI 是 feature location 的**标准基线**（Marcus et al. 2004 LSI；
 *     VSM-Lucene / LSI-Matlab 在实证比较里表现最好）⇒ 用 TF-IDF 余弦是有出处的；
 *   - **没有**基线的部分：Type-4 语义克隆（不同实现、同一功能）至今是开放问题
 *     ⇒ 任何"这就是它"的判定都是**假装确定**。
 *   ⇒ 本模块只产出 `score + 依据（命中了哪些词、各自 df）+ 三档判读`，判定交给调用方。
 *
 * ★ 为什么住 `domain` 且**零 import**：`behavior-cases` 判据的 harness 把目标文件单独转译再 import
 *   ⇒ 目标必须零依赖（`docs/SUBAGENT-HANDBOOK.md` §8）。排序器恰恰最该被行为判住 ——
 *   它坏起来**没有声音**：把"差得远"排成"最像"，回执上长得和"真像"一模一样。
 *
 * ★ 分词口径（AGENTS-RULES 0.14 双向判据的落点）：
 *   - ASCII：按非字母数字切 + 驼峰切，小写，单字符丢弃（`a` / `x` 这类不携带信息）；
 *   - CJK：**只取二元组**（`消费者计数` → `消费`,`费者`,`者计`,`计数`）。
 *     ★ 不取一元组：中文一元组（`代`/`码`/`件`）几乎每份文档都有 ⇒ 会把"读代码"排成任意含"代码"的文件。
 *     唯一例外：一段 CJK 只有一个字（`改`）⇒ 该字本身成一个 token（否则查询向量为空 = 静默返回空集）。
 *
 * ★ 三档判读（不合并成一个布尔值）：`strong` / `weak` / `none`。
 *   阈值是**标定值**（见 `READING-NOTES` 注释里的实测分布），不是物理常量。
 */

/**
 * ★★ 每个输出都必须带上这一句（判据 c：不许下判定）。
 * 调用方（人或 agent）看到候选后要**逐个表态**，而不是把 top-1 当结论执行。
 */
export const LOCATE_DISCLAIMER =
  '本结果是**候选**不是判定；语义克隆（Type-4）无完备算法 ⇒ 由调用方逐个表态';

/** 算法自述（给回执用；★ 写清"用了哪套"，不许含糊）。 */
export const LOCATE_ALGORITHM =
  'VSM：TF-IDF 加权余弦相似度（feature location 标准基线）+ 字面量通道（符号名/路径/原文包含）';

/**
 * 达标线（标定读数，见 `docs` 注释）：
 *   - 工具名/符号名查询（`rename_symbols` / `consumer_tally`）：0.65 ~ 1.30
 *   - 有手写职责的领域文件 + 中文功能描述（`消费者计数`）：0.30 ~ 0.34
 *   - 自动生成职责的文件 + 中文功能描述（`检查代码健康度`）：0.12 ~ 0.13
 *   - 设计册里确实没有的功能（`生成 PDF 报告`）：0.07 ~ 0.10
 * ⇒ 0.20 之上是"值得逐个表态"的候选；0.05~0.20 是弱线索（点名但不许当结论）；<0.05 视为无。
 */
export const LOCATE_STRONG_FLOOR = 0.2;
export const LOCATE_WEAK_FLOOR = 0.05;

/** 一份可检索的设计册文档（文件节点 / 非文件节点各一份）。 */
export interface LocateDoc {
  /** 去重键：同一 path 在多册出现 ⇒ 同一个 key（跨册互查时才不会被自己的副本挤掉） */
  key: string;
  feature: string;
  kind: 'file' | 'node';
  id: string;
  /** 仓库相对路径（非文件节点为空） */
  path?: string;
  label: string;
  /** 参与打分的原文（路径 + 职责 + 标题 + 符号名/签名 + 决策文本） */
  text: string;
  /** 该文档声明的符号名（字面量通道用） */
  symbols: readonly string[];
}

/** 查询词在某个文档里的命中读数（`df` = 含该词的文档数；越小越"有鉴别力"）。 */
export interface LocateTermHit {
  term: string;
  df: number;
  /** 该词在本次打分里的贡献（query 权重 × 文档权重） */
  weight: number;
}

export type LocateVerdict = 'strong' | 'weak' | 'none';

export interface LocateHit {
  key: string;
  doc: LocateDoc;
  /** 总分 = 词法分 + 字面量分 */
  score: number;
  /** TF-IDF 余弦（0~1） */
  lexical: number;
  /** 字面量加分（0 / 0.2 / 0.3 / 0.35 / 0.5） */
  literal: number;
  /** 为什么像：命中的查询词，按贡献降序（最多 4 条） */
  terms: LocateTermHit[];
  verdict: LocateVerdict;
}

export interface LocateIndex {
  docs: LocateDoc[];
  /** 词 → 文档频次 */
  df: Map<string, number>;
  /** 与 `docs` 同序的单位向量 */
  vectors: Map<string, number>[];
  /** 语料规模（回执里的分母：只报 top-N 而不报语料大小 = 没验） */
  n: number;
}

/**
 * 分词（唯一实现 —— 索引侧与查询侧必须用同一把尺，否则两套 token 会静默对不上）。
 * 返回顺序对打分无影响（词袋）。
 */
export function tokenizeLocate(text: string): string[] {
  const s = String(text ?? '');
  const out: string[] = [];

  // ① ASCII/数字：非字母数字切开 ⇒ 驼峰再切 ⇒ 小写 ⇒ 丢弃单字符
  for (const m of s.matchAll(/[A-Za-z0-9]+/g)) {
    for (const part of m[0].split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
      const low = part.toLowerCase();
      if (low.length > 1) out.push(low);
    }
  }

  // ② CJK：按**连续段**取二元组（被 ASCII/空白打断即断开）
  //    ★ 一段只有一个字（`改`）⇒ 该字本身成一个 token：否则单字查询的向量为空 = 静默返回空集，
  //      与"设计里没有"同形（0.12）。
  for (const run of s.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []) {
    if (run.length === 1) {
      out.push(run);
      continue;
    }
    for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 词的逆文档频次。`+0.5` 平滑 ⇒ 未登录词（df=0）也有值，不会除零。 */
function idfOf(df: number, n: number): number {
  return Math.log((n + 1) / (df + 0.5));
}

/** 词频 → 权重（sublinear tf：出现 10 次不比出现 1 次重要 10 倍）；然后 L2 归一化。 */
function toUnitVector(tf: Map<string, number>, df: Map<string, number>, n: number): Map<string, number> {
  const v = new Map<string, number>();
  let norm = 0;
  for (const [term, count] of tf) {
    const w = (1 + Math.log(count)) * idfOf(df.get(term) ?? 0, n);
    if (w <= 0) continue;
    v.set(term, w);
    norm += w * w;
  }
  const len = Math.sqrt(norm) || 1;
  for (const [term, w] of v) v.set(term, w / len);
  return v;
}

function tfOf(tokens: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** 建索引（语料一次性建；查询侧只建一个向量）。 */
export function buildLocateIndex(docs: readonly LocateDoc[]): LocateIndex {
  const df = new Map<string, number>();
  const tfs = docs.map((d) => tfOf(tokenizeLocate(d.text)));
  for (const tf of tfs) for (const term of tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  const n = docs.length;
  return { docs: [...docs], df, vectors: tfs.map((tf) => toUnitVector(tf, df, n)), n };
}

/** 字面量通道：查询串直接出现在符号名/路径/原文里时加分（最可信的一类"像"）。 */
function literalBoost(doc: LocateDoc, rawQuery: string, queryTerms: ReadonlySet<string>): number {
  const raw = rawQuery.trim().toLowerCase();
  if (!raw) return 0;
  const identifierLike = !/\s/.test(raw) && /^[\x20-\x7e]+$/.test(raw);
  if (identifierLike) {
    const bySymbol = doc.symbols.some((s) => s.toLowerCase() === raw);
    const pathLow = (doc.path ?? '').toLowerCase();
    const base = pathLow.split('/').pop() ?? '';
    const stem = base.replace(/\.[^.]+$/, '');
    let boost = 0;
    if (bySymbol) boost = 0.5;
    else if (stem && stem === raw) boost = 0.5;
    else if (pathLow.includes(raw)) boost = 0.35;
    else if (queryTerms.size >= 2) {
      // ★ 词序不同也算"路径里全是这些词"（`move_symbol` vs `symbol_move`）—— 否则同义写法拿不到分
      const pathTerms = new Set(tokenizeLocate(pathLow));
      let all = 0;
      for (const t of queryTerms) if (pathTerms.has(t)) all++;
      if (all === queryTerms.size) boost = 0.3;
    }
    // ★ 非文件节点（目录/模块容器）**不实现功能**：同名字面量只能给一半分。
    //   否则「examples/search/」这种同名目录会把 `search` 的真入口挤到候选之外。
    return doc.kind === 'node' ? Math.min(boost, 0.2) : boost;
  }
  // 中文/短语：整串出现在原文里才加（不做"部分字面量"——那会把 单字 当命中，噪音）
  return doc.text.toLowerCase().includes(raw) ? 0.2 : 0;
}

function verdictOf(score: number, lexical: number, literal: number): LocateVerdict {
  // ★ 只看分数不看"有词命中"：0 命中词的文档分只能是 0（词法分 0、字面量 0）
  if (score >= LOCATE_STRONG_FLOOR && (lexical > 0 || literal > 0)) return 'strong';
  if (score >= LOCATE_WEAK_FLOOR) return 'weak';
  return 'none';
}

export interface LocateRankResult {
  hits: LocateHit[];
  /** 查询词与它在**语料**里的文档频次（`df=0` = 设计册里根本没这个词 —— 判据 b 的取证） */
  terms: Array<{ term: string; df: number }>;
  /** 整批的判读：取 top-1 的档位（无候选 = none） */
  verdict: LocateVerdict;
}

/**
 * 排序。`top` 缺省 5。
 * ★ 不相等的候选**全部返回 0 分的**吗？不 —— 只返回 `score > 0` 的，且按分降序。
 *   无候选时 `hits` 为空、`verdict='none'`（调用方必须把"搜了什么"一并回给用户）。
 */
export function rankLocate(index: LocateIndex, query: string, opts: { top?: number } = {}): LocateRankResult {
  const top = Math.max(1, Math.floor(opts.top ?? 5));
  const qtf = tfOf(tokenizeLocate(query));
  const terms = [...qtf.keys()].map((term) => ({ term, df: index.df.get(term) ?? 0 }));
  if (qtf.size === 0) return { hits: [], terms, verdict: 'none' };

  const qv = toUnitVector(qtf, index.df, index.n);
  const scored: LocateHit[] = [];
  for (let i = 0; i < index.docs.length; i++) {
    const doc = index.docs[i]!;
    const v = index.vectors[i]!;
    let lexical = 0;
    const hitTerms: LocateTermHit[] = [];
    for (const [term, qw] of qv) {
      const dw = v.get(term);
      if (!dw) continue;
      const contribution = qw * dw;
      lexical += contribution;
      hitTerms.push({ term, df: index.df.get(term) ?? 0, weight: contribution });
    }
    const literal = literalBoost(doc, query, new Set(qtf.keys()));
    const score = lexical + literal;
    if (score <= 0) continue;
    hitTerms.sort((a, b) => b.weight - a.weight);
    scored.push({
      key: doc.key,
      doc,
      score,
      lexical,
      literal,
      terms: hitTerms.slice(0, 4),
      verdict: verdictOf(score, lexical, literal),
    });
  }
  scored.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
  const hits = scored.slice(0, top);
  return { hits, terms, verdict: hits.length > 0 ? hits[0]!.verdict : 'none' };
}
