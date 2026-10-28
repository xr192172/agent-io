/**
 * rewrite_plan.ts —— **重写计划（画布）** 的读写口：`<proj>/.agent-io/plan/<rel>.plan.json`。
 *
 * ## 它是什么（一段话）
 * 写源码前必须"通读设计指向的区域 → 选定范围 → 写完细节"。那些**选择与细节**就落在这里，
 * 一条 entry = 一处改动。**它替代的是"agent 脑子里的计划"** —— 上下文一压缩就没了的东西。
 *
 * ## 为什么它必须入库、且与底片分家
 * · `design-db/<rel>.calls.json`（**底片**）= 从 `cache.db` 派生的**事实**，整目录被 gitignore；
 * · 本文件的计划是**意图**（人/模型写、算不出来）⇒ 必须进 git，否则换机/clean 就丢。
 *   ⇒ 两个文件、两个家，各自一条判据（`t378` 管同构、`t379` 管这份计划不被生成器吃掉）。
 *
 * ## 纪律
 * · **生成器永不写它**（`gen_design_db` 只读不写）；
 * · 写盘用 `temp + rename`（半份计划比没有计划更坏）；
 * · `status:'stale'` = 锚点在当前代码里对不上（**只标不删**，等人看）；
 * · 空计划 = 没有计划（不是"计划为空"）：闸按"必须有 entries"判。
 */
import fs from 'node:fs';
import path from 'node:path';
import { rootPath } from '../../../infrastructure/roots.js';

/** 一处改动的意图 */
export interface RewritePlanEntry {
  /**
   * 锚点：**只用符号名**（`cache.db` 的 `nodes.name`）。
   * ★ 不用行号：任何一次插入都会让它整体漂移（`sym_hash` 才是"这段变没变"的判据）。
   */
  anchor: { symbol: string };
  /** rewrite = 改现有符号；create = 新建（骨架还没生成）；delete = 删除 */
  kind: 'rewrite' | 'create' | 'delete';
  /** 要改成什么样（一句话，够下一个 agent 接着写） */
  detail: string;
  /** ★ 必填：拿什么验（证/判据引用）。说不出怎么验的细节 = 没写完 */
  judgement_ref: string;
  /** open = 待做；stale = 锚点对不上（只标不删）；done = 源码已到位且判据转绿 */
  status: 'open' | 'stale' | 'done';
  /**
   * ★ 2026-10-28（试点读数 #2）：`judgement_ref` 是 `cert:` 形态时**必填** —— 证里的检查号不登记种类，
   * 不声明就判不出强度。取值必须在已知分类里（`strengthOfKind` 认识的种类），**不许自造**。
   * `decision:` 形态**忽略**它（种类从册里现读，不给人自报的机会）。
   */
  judgement_kind?: string;
  /**
   * ★★★ 2026-10-28（迭代 ⑤）：**这条改动依赖哪些符号先落地**（写的是 `anchor.symbol`）。
   *
   * ## 为什么需要它（用户："设计阶段就了解一个功能的整条路线"）
   * 结构化重写是**有序**的：改签名 → 改调用方 → 改测试。没有这一格，"路线"只能待在模型脑子里，
   * 而脑子会被上下文压缩（今晚实测两次）。有了它，顺序变成**可判**的（见 `planDependencyGaps`）。
   * ★ **不引入 `order` 字段**：拓扑序可由 `depends_on` **派生**（`planTopoOrder`）——
   *   同时存 `order` 与 `depends_on` 就是"两处权威"，必然打架（本仓头号病）。
   */
  depends_on?: string[];
  /** 行号只作注记，**不参与判定** */
  note?: string;
}

/** 一个路径的整份画布 */
export interface RewritePlan {
  /** 源码仓库相对路径（posix），与底片的 `path` 一一对应 */
  path: string;
  /** 冻结时刻（这一刻起本块权威 = 本文件；`gen-db` 只报 drift 不覆盖） */
  frozen_at?: string;
  /** 冻结那一刻的底片指纹（用文件内容哈希，便于判"底片换没换"） */
  base?: { content_hash?: string };
  entries: RewritePlanEntry[];
  /**
   * ★★★ 2026-10-28（用户："模型喜欢补丁式修改，这套流程应该强迫全貌浏览"）：
   * **该文件里"我看过、但不动"的符号** —— 每个符号要么在 `entries`（要改），要么在这里（不动 + 为什么）。
   *
   * ## 为什么要它
   * 只有 `entries` 的话，"计划里只列 1 个符号、也只改这 1 个符号"是**完全合规的补丁式修改** ——
   * 全貌浏览仍然靠自觉。加了这一格，"通读"才有了**可判形态**：漏掉的符号会以"**未表态**"被抓出来。
   * ★ 判据不住这里（这里是形状）：判定在 `planCoverageGaps`。
   */
  untouched?: Array<{ symbol: string; why: string }>;
  /**
   * ★★★ 2026-10-28（真实开发试点读数 #1）：**"其余都不动"的紧凑声明** ——
   * 一个 18 个顶层符号的文件、只改 1 处，逐条写 18 个 `untouched` 手工不现实（我是脚本生成的）。
   *
   * ## 为什么它没有把"通读"变松
   * 用了它就必须同时记 `symbols_at_freeze`（冻结那一刻的符号全集）。**快照之后出现的符号**不在里面
   * ⇒ 判据仍会报"有新符号 ⇒ 重新通读并重新冻结"。⇒ 紧凑只省**打字**，不省**理解**。
   */
  untouched_default?: { why: string };
  /** 冻结那一刻的**顶层符号全集**（`untouched_default` 的牙齿：新符号不在其中就会被抓） */
  symbols_at_freeze?: string[];
}

/** 计划目录：`<proj>/.agent-io/plan`（`rootsOf().plan` 的唯一解析器，别在别处再拼） */
export function planDir(projectRoot: string): string {
  return rootPath('plan', path.resolve(projectRoot));
}

/** 某个源码路径的计划文件：`<planDir>/<rel>.plan.json` */
export function planFileFor(projectRoot: string, relPath: string): string {
  const rel = relPath.split(path.sep).join('/').replace(/^\/+/, '');
  return path.join(planDir(projectRoot), `${rel}.plan.json`);
}

/** 读计划（没有就 null —— **不造假计划**） */
export function readRewritePlan(projectRoot: string, relPath: string): RewritePlan | null {
  const file = planFileFor(projectRoot, relPath);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as RewritePlan;
  } catch {
    return null; // 坏文件当"没有"（闸会拒写 ⇒ 响亮），不在读侧抛
  }
}

/** 写计划（temp + rename：不留半份） */
export function writeRewritePlan(projectRoot: string, plan: RewritePlan): string {
  const file = planFileFor(projectRoot, plan.path);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(plan, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmp, file);
  return file;
}

/**
 * 计划**是否够格放行写源码**（准入闸的唯一判据；`t379` 就是打它的证）。
 * @returns 不合格的原因（空数组 = 合格）
 */
export function planGaps(plan: RewritePlan | null): string[] {
  if (!plan) return ['没有重写计划（`plan/<rel>.plan.json` 不存在）⇒ 先通读 + 选范围 + 写细节'];
  const gaps: string[] = [];
  if (!plan.entries.length) gaps.push('计划里 0 条改动 ⇒ 先说明要改哪个符号、改成什么');
  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    if (!e.anchor?.symbol) gaps.push(`${who} —— 缺锚点（只用符号名，别用行号）`);
    if (!e.detail?.trim()) gaps.push(`${who} —— 缺 detail（要改成什么样）`);
    if (!e.judgement_ref?.trim()) gaps.push(`${who} —— 缺 judgement_ref（拿什么验）`);
    if (e.status === 'stale') gaps.push(`${who} —— 锚点已过期（stale）⇒ 先核对再改`);
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（迭代 ③）：**"通读"的可判形态** —— 该文件的符号是否**逐个表过态**。
 *
 * 判据：文件名里的符号（实际 DB 的 `nodes`，排除 `kind='file'`）**每一个**必须满足其一：
 *   ① 在 `entries[].anchor.symbol` 里（要改）；② 在 `untouched[].symbol` 里（不动 + 有理由）。
 * 两者都没有 ⇒ **未表态** ⇒ 报出来（默认档点名，严格档拦）。
 *
 * ★ 为什么这是"强迫全貌"的那一格：没有它，模型可以只列 1 个符号改 1 个符号，
 *   全程合规，而**文件里其他 20 个符号它根本没看**。有了它，"没看"会变成一条可见的缺口。
 * ★ 纯函数（符号清单由调用方从实际 DB 取）：这样判据可单测，且不把 `cache.db` 依赖塞进本模块。
 */
export function planCoverageGaps(plan: RewritePlan | null, symbolsInFile: readonly string[]): string[] {
  if (!plan) return [];
  const planned = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const declared = new Set((plan.untouched ?? []).map((u) => u.symbol).filter(Boolean));

  // ★ 紧凑声明（`untouched_default`）：省打字，不省理解 —— 快照之后**新增的符号**仍要被抓
  if (plan.untouched_default) {
    const frozen = new Set(plan.symbols_at_freeze ?? []);
    if (!frozen.size) {
      return [`用了 \`untouched_default\`（"其余都不动"）但**没记 \`symbols_at_freeze\`** ⇒ 无凭据，判不出那批符号当时是否存在`];
    }
    const fresh = [...new Set(symbolsInFile)].filter((s) => !planned.has(s) && !frozen.has(s));
    if (!fresh.length) return [];
    return [
      `文件里有 ${fresh.length} 个**冻结之后才出现的符号**：${fresh.slice(0, 6).join(', ')}（\`untouched_default\` 没覆盖它们）` +
        `\n      ⇒ 重新通读这几处，再重新冻结（\`apply:true\` 会刷新快照）`,
    ];
  }

  const silent = [...new Set(symbolsInFile)].filter((s) => !planned.has(s) && !declared.has(s));
  if (!silent.length) return [];
  return [
    `该文件有 ${silent.length} 个符号**没表态**（既不在 \`entries\`、也不在 \`untouched\`）：${silent.slice(0, 6).join(', ')}` +
      (silent.length > 6 ? ` 等 ${silent.length} 个` : '') +
      `\n      ⇒ 要么把它写进 entries（要改），要么写进 untouched（看过、不动，附一句 why）`,
  ];
}

/** `untouched` 的每条都要有理由（空理由 = 等于没表态） */
export function planUntouchedGaps(plan: RewritePlan | null): string[] {
  if (!plan?.untouched?.length) return [];
  const bad = plan.untouched.filter((u) => !u.symbol?.trim() || !u.why?.trim());
  if (!bad.length) return [];
  return [`untouched 里有 ${bad.length} 条缺 symbol 或 why（空理由 = 没表态）`];
}
/**
 * ★★★ 2026-10-28（迭代 ④）：**`judgement_ref` 的规范引用** —— 不收敛成可解析形式，就判不出"判据强不强"。
 *
 * ## 为什么要收敛（用户目标："这套流程还能发现逻辑 bug"）
 * 判据能不能发现**逻辑错**，取决于它的**种类**：
 * · **语义类**（能发现）：`behavior-cases`（给定输入⇒期望输出）· `call-exists`（必须调某函数）·
 *   `edge-absent` / `edge-exists`（依赖关系对不对）· `run`（跑一段脚本看输出）；
 * · **存在/结构类**（**永远发现不了逻辑错**）：`file-exists`（文件在不在）· `source-has`（某段文本在不在）·
 *   `symbol-exists` · `signature-matches`（签名对不对）。
 * ⇒ 自由文本（`cert:t383/②`）**机器读不出种类** ⇒ 强度判不了 ⇒ 只能靠人。收敛后才可判。
 *
 * ## 规范形态（只认这两种；其余算 `unparsed`，**点名但不猜**）
 * · `decision:<node_id>#<index>` —— 判据住设计册该节点的 `decision.expectations[index]`（**首选**：判据的唯一住处）
 * · `cert:<证文件名>#<检查号>` —— 证里的某一条（种类**不登记** ⇒ 强度按 `unknown` 处理，不假装强）
 */
export type JudgementRef = { kind: 'decision'; nodeId: string; index: number } | { kind: 'cert'; file: string; check: string };

/** 解析规范引用；不是规范形态 ⇒ `null`（**不猜**，也不把自由文本当通过） */
export function parseJudgementRef(ref: string | undefined): JudgementRef | null {
  const s = (ref ?? '').trim();
  const m1 = /^decision:([A-Za-z0-9_.:-]+)#(\d+)$/.exec(s);
  if (m1) return { kind: 'decision', nodeId: m1[1], index: Number(m1[2]) };
  const m2 = /^cert:([A-Za-z0-9_.-]+)#(.+)$/.exec(s);
  if (m2) return { kind: 'cert', file: m2[1], check: m2[2] };
  return null;
}

/** 判据强度：`semantic` 能发现逻辑错 · `existence` 发现不了 · `unknown` 判不出（不假装） */
export type JudgementStrength = 'semantic' | 'existence' | 'unknown';

const SEMANTIC_KINDS = new Set(['behavior-cases', 'call-exists', 'edge-absent', 'edge-exists', 'run']);
const EXISTENCE_KINDS = new Set(['file-exists', 'source-has', 'symbol-exists', 'signature-matches']);

/** 由一个判据的 `kind` 判强度（不认识 ⇒ `unknown`，**不许当成强**） */
export function strengthOfKind(kind: string | undefined): JudgementStrength {
  if (!kind) return 'unknown';
  if (SEMANTIC_KINDS.has(kind)) return 'semantic';
  if (EXISTENCE_KINDS.has(kind)) return 'existence';
  return 'unknown';
}

/**
 * 计划的**判据强度缺口**（本轮唯一新增的判据；`resolveKind` 由调用方注入 —— 本模块不读册、不读索引）。
 *
 * @param plan 画布
 * @param resolveKind 把一条 entry 的判据解成 `kind`（解不出 ⇒ 返回 `undefined`）
 * @returns 缺口描述（空数组 = 全都至少是语义类，或没有条目）
 */
export function planJudgementGaps(
  plan: RewritePlan | null,
  resolveKind: (entry: RewritePlanEntry) => { kind?: string; why_not?: string },
): string[] {
  if (!plan) return [];
  const gaps: string[] = [];
  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    const parsed = parseJudgementRef(e.judgement_ref);
    if (!parsed) {
      gaps.push(
        `${who} —— \`judgement_ref\` 不是规范引用（\`${String(e.judgement_ref ?? '')}\`）⇒ 判不出它能不能发现逻辑错。` +
          `\n      规范形态：\`decision:<node_id>#<index>\`（判据住册，首选）或 \`cert:<证文件名>#<检查号>\``,
      );
      continue;
    }
    // ★ 试点读数 #2：`cert:` 形态没有登记 kind ⇒ 允许**显式声明**（`judgement_kind`），
    //   但必须在 `strengthOfKind` 认识的闭集里 —— 自造的种类会被判成 `unknown` 并点名。
    let r = resolveKind(e);
    if (r.why_not && e.judgement_kind) r = { kind: e.judgement_kind };
    if (r.why_not) {
      gaps.push(`${who} —— 判据解不出来：${r.why_not}（**判不出强度 ≠ 强度合格**）`);
      continue;
    }
    const s = strengthOfKind(r.kind);
    if (s === 'existence') {
      gaps.push(
        `${who} —— 判据 \`${r.kind}\` 是**存在/结构类**，**永远发现不了逻辑错**。` +
          `\n      要发现 bug 得换语义类：\`behavior-cases\`（给输入⇒期望输出）/ \`call-exists\` / \`edge-absent\``,
      );
    } else if (s === 'unknown') {
      gaps.push(`${who} —— 判据种类 \`${String(r.kind ?? '?')}\` 不在已知分类里 ⇒ **判不出强度**（不假装强）`);
    }
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（迭代 ⑤）：**路线（拓扑序）与顺序判据**。
 *
 * ## 为什么顺序必须可判
 * 结构化重写是有序的：**改签名 → 改调用方 → 改测试**。顺序错了就是编译不过 ——
 * 而"顺序"原来只住在模型脑子里（上下文一压缩就没了）。`depends_on` 把它写下来，
 * 本函数负责两件事：**算出路线**（`planTopoOrder`）与**抓顺序违规**（`planDependencyGaps`）。
 *
 * ## 判据（四条，缺一不可）
 * ① 依赖必须指向**本计划里存在的锚点**（拼错 / 漏写 ⇒ 路线是假的）；
 * ② **不许自依赖**（`f` 依赖 `f`）；
 * ③ **不许成环**（成环 = 路线不成立；报出环上的符号）；
 * ④ **顺序不许被违反**：某条已 `status:'done'`，而它依赖的条目**还没 done** ⇒ 报
 *    （这是"结构化重写"真正落地的那一条 —— 先做的没做完就往下做）。
 */
export function planTopoOrder(plan: RewritePlan | null): string[] | null {
  if (!plan) return null;
  const nodes = plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s);
  const deps = new Map<string, string[]>();
  for (const s of nodes) deps.set(s, []);
  for (const e of plan.entries) {
    const s = e.anchor?.symbol;
    if (!s) continue;
    for (const d of e.depends_on ?? []) if (deps.has(d)) deps.get(s)!.push(d);
  }
  const out: string[] = [];
  const temp = new Set<string>();
  const perm = new Set<string>();
  let cyclic = false;
  const visit = (n: string): void => {
    if (perm.has(n) || cyclic) return;
    if (temp.has(n)) {
      cyclic = true;
      return;
    }
    temp.add(n);
    for (const d of deps.get(n) ?? []) visit(d);
    temp.delete(n);
    perm.add(n);
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return cyclic ? null : out; // null = 成环 ⇒ 没有合法路线（不编一个出来）
}

/** 依赖/顺序的缺口（空数组 = 路线成立且没有被违反） */
export function planDependencyGaps(plan: RewritePlan | null): string[] {
  if (!plan) return [];
  const gaps: string[] = [];
  const anchors = new Set(plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s));
  const statusOf = new Map<string, string>();
  for (const e of plan.entries) if (e.anchor?.symbol) statusOf.set(e.anchor.symbol, e.status);

  for (const e of plan.entries) {
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    for (const d of e.depends_on ?? []) {
      if (d === e.anchor?.symbol) {
        gaps.push(`${who} —— **自依赖**（依赖了自己）`);
        continue;
      }
      if (!anchors.has(d)) {
        gaps.push(
          `${who} —— 依赖 \`${d}\`，但**本计划里没有这个锚点**（拼错？还是它该作为一条 entry / untouched 写进来？）`,
        );
        continue;
      }
      // ④ 顺序被违反：本条目已完成，而依赖还没完成
      if (e.status === 'done' && statusOf.get(d) !== 'done') {
        gaps.push(
          `${who} —— **顺序被违反**：它标了 \`done\`，但它依赖的 \`${d}\` 还是 \`${statusOf.get(d) ?? '(无)'}\`` +
            `\n      ⇒ 结构化重写是有序的（改签名 → 改调用方 → 改测试），先做的那条没完成就往下做，等于赌编译。`,
        );
      }
    }
  }

  if (planTopoOrder(plan) === null) {
    const nodes = plan.entries.map((e) => e.anchor?.symbol).filter((s): s is string => !!s);
    gaps.push(
      `依赖**成环**（${nodes.join(', ')}）⇒ 路线不成立（没有拓扑序）。` +
        `\n      ⇒ 环上的每一条都自称"要等对方先做"，这种计划落不了地；先把它拆成单向依赖。`,
    );
  }
  return gaps;
}
/**
 * ★★★ 2026-10-28（真实开发试点）：**`kind` 的前提检查** —— `create` / `delete` 的前提错了，路线就错了。
 *
 * 判据（两条）：
 * · `kind:'create'` 但**文件已存在** ⇒ 该用 `rewrite`（"新建"与"改现有"是两件事，混了就会覆盖别人的活）；
 * · `kind:'delete'` 但**文件不存在** ⇒ 已经是删掉的状态（计划过期或路径写错）。
 * ★ 为什么必须判：这两条错了，后面所有 entry 的锚点都建在错的前提上 —— 而"顺序对、判据强"都救不回来。
 */
export function planKindGaps(plan: RewritePlan | null, fileExists: boolean): string[] {
  if (!plan) return []; // 空计划 = 没有判断对象
  const gaps: string[] = [];
  for (const e of plan.entries) {
    // ★ 2026-10-28（严格档真实误报 · 试点读数 #6）：**已完成的条目不判前提** ——
    //   一条 `create` 做完之后文件当然存在；拿"文件已存在"去骂它，就是把"完成了"当成"前提错了"。
    //   （实测：严格档因此拦了一次本该放行的真实改动 ⇒ 这是判据误伤，不是调用方错。）
    if (e.status === 'done') continue;
    const who = `${e.kind}:${e.anchor?.symbol || '(缺 anchor)'}`;
    if (e.kind === 'create' && fileExists) {
      gaps.push(
        `${who} —— \`create\` 但**文件已存在** ⇒ 该用 \`rewrite\`（"新建"与"改现有"是两件事；混了会覆盖已有的活）`,
      );
    }
    if (e.kind === 'delete' && !fileExists) {
      gaps.push(`${who} —— \`delete\` 但**文件不存在** ⇒ 已经是删掉的状态（计划过期，或路径写错）`);
    }
  }
  return gaps;
}
