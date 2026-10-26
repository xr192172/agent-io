/**
 * gen_design_db —— 设计 DSL → 设计 DB（工具 `design_line` 的 `action=gen-db`）
 *
 * ## 它生成什么（用户的关键定义，逐字留在注释里）
 * ```
 * design-db/<file>.calls.json   ← 每个文件一份（全量）
 * ```
 * ★ 2026-10-20 订正：原文写的是"每个**文件节点**一份" —— 那是假门的源头。
 *   一个路径可以被**多个 feature 各持一个节点**（实测今天 344 个路径 / 367 个节点 / 23 个多持有者），
 *   而 `design-db` 只有**一份**投影 ⇒ 第二个节点永远对不上。
 *   ⇒ 现在按**路径**归并：判据取并集、表头列出全部持有者、矛盾单独判真冲突
 *     （`planDesignDb` 是唯一那一处；`DesignDbConflict` 写着什么是"真"什么不是）。
 *
 * ## 为什么必须【全量、和实际 DB 同构】
 * 规则：解析与重写都是**渐进**的两条路 —— 既要重写设计 DSL，
 * 还要重写设计 DB，最后才重写源码。
 * ```
 * 解析（源码 → 设计）：源码 → 实际 DB → 实际 DSL → 设计 DSL（fork）
 * 重写（设计 → 源码）：设计 DSL → ★ 设计 DB → 源码
 * ⇒ 两条路的三层一一对应：实际 DB ↔ 设计 DB（同构）、实际 DSL ↔ 设计 DSL（同构）
 * ⇒ "重写源码"需要一份【完整的设计 DB】，不是"设计关心的那几条"
 *   —— 那几条只是设计 DB 里的 `requirements[]` 标注。
 * ```
 *
 * ## 每份的形状（与实际 DB 同构）
 * ```
 * { "//"…, "path": <仓库相对路径>, "symbols": […], "imports": […], "calls": […],
 *   "reverse_calls"?: [<被谁调：source 节点 id，一跳反向，排序可复现>],
 *   "requirements"?: […], "requirements_calls"?: […] }
 * ```
 * ★ `calls` 是**全量镜像**（必然全绿）；`requirements_calls` 才是"设计说必须有"的
 *   —— `contract:calls` 必须读后者，否则契约门在全量之后会失效（用户 2026-10-19 指出过）。
 *
 * ## 搬家纪律（从 scripts/gen-design-db.mjs）
 * **输出必须逐字相同**。所以下面这些格式细节一律不得擅自调整：
 * `JSON.stringify(payload, null, 2) + '\n'`、键的插入顺序、`outNameOf` 的替换规则、
 * 可选字段的"空就不写"。
 *
 * ## 边界（写在代码里，别让调用方以为它全管）
 * - 只处理 `description` 以 `src/` 开头的节点（其他目录不进设计 DB）
 * - `symbols` / `imports` / `calls` 的**事实**取自 `cache.db`（设计 DSL 不存符号级事实）
 * - `check=true` **不写盘**（只报不一致），也不清理陈旧副本
 * - ★ `check=true` 的红分两类，**不许合成一个计数**：
 *   `drift`（重跑生成器就绿）vs `conflicts`（重跑一百遍也绿不了 ⇒ 该改设计）
 * - ★ **门只由 `checkDesignDbStructure` 提供**（`scripts/gen-db-check.mjs`）：它只比设计侧
 *   可复现的三样（`//source` / `requirements` / `requirements_calls` 的调用方），
 *   因为 `cache.db` **不入库** —— 拿它当门 = 同一次提交在不同机器上红绿不同（另一种假门）。
 * - ★ 本工具是**诊断**，不是门：要判"设计进没进投影"请跑 `node scripts/gen-db-check.mjs`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// ★ 2026-10-20：`GenDesignDbOptions` / `GenDesignDbResult` 已下移到归并逻辑旁边
//   （与 `DesignDbPlanItem` / `DesignDbConflict` 同住）—— 此前它们在这里，改归并时又在下面
//   重写了一份，两份同名 interface 会**静默合并**（tsc 不报）⇒ 改字段时只改一份也编得过。
//   ★ 这就是本仓头号病（同一判据住两处）的又一次现形：**编译通过 ≠ 只有一份**。

type RawExpectation = {
  kind?: string;
  path?: string;
  symbol?: string;
  target?: string;
  from?: string;
  to?: string;
  signature?: string;
  must?: string[];
  mustNot?: string[];
  expect?: string;
  input?: unknown;
  why?: string;
};

type AnyNode = {
  id?: string;
  description?: string;
  decision?: { expectations?: RawExpectation[] };
};

const norm = (s: unknown): string => String(s ?? '').replace(/\\/g, '/');

/** 副本文件名：`src/a/b.ts` → `a-b.calls.json`（★ 与旧脚本逐字一致，别改） */
export const outNameOf = (rel: string): string =>
  rel.replace(/^src\//, '').replace(/[/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';

/**
 * 设计 DB 的输出目录 —— ★ **唯一住所**（2026-10-20 从 `certs/` 下搬到**仓根** `design-db/`）。
 *
 * 消费者全部认这一处，不许各写一遍字面量：
 * - `gen_design_db.ts` 自己
 * - `design_line.ts` / `symbol_diff.ts`（TS 侧直接 import 本函数）
 * - `scripts/gen-contracts.mjs` / `contract-calls.mjs`（.mjs 侧 import dist 里的编译产物；`dep.mjs` 已于 2026-10-24 按裁 A 退役——calls 只读，意图走 call-exists 判据）
 */
export const designDbDir = (root: string): string => path.join(root, 'design-db');

/** 一个路径的一个**持有者**（= 某个 feature 里的那个节点） */
export interface DesignDbHolder {
  /** feature 名（= 设计文件名去后缀） */
  feature: string;
  /** 表头里的来源串：`design/<feature>.dsl.json` */
  source: string;
  node: AnyNode;
}

/** 归并后的一份投影的**设计侧输入**（★ 不含事实：symbols / imports / calls 全在 cache.db） */
export interface DesignDbPlanItem {
  /** 仓库相对路径 */
  path: string;
  /** 所有持有者的 feature（★ 稳定序 = 设计文件名排序） */
  holders: string[];
  /** 所有持有者的来源串（顺序与 holders 一致） */
  sources: string[];
  /** 所有持有者的判据**并集**（去重、稳定序） */
  expectations: RawExpectation[];
}

/**
 * ★★★ **真冲突**（2026-10-20）：两个 feature 对同一文件的要求**不可能同时满足**。
 *
 * 为什么必须与「投影陈旧」分开：
 * - 投影陈旧 ⇒ **重跑生成器**就绿（`GenDesignDbResult.drift`）；
 * - 真冲突 ⇒ 重跑一百遍也绿不了（`GenDesignDbResult.conflicts`）—— 只有**改设计**能修。
 * 把两者混成一个计数，就是本仓最反对的那种读数：「红着，但没人知道该动哪儿」。
 *
 * 判据只有两条（★ 都是**可机器判定**的，不靠"两个 decision 逐字不同"）：
 * ① 同一符号的两条 `signature-matches` 给出**不同签名** ⇒ 不可能同时成立；
 * ② 一个 feature 的 `source-has.must` 与另一个的 `source-has.mustNot` 撞同一串 ⇒ 互斥。
 * ★ 其余主张（file-exists / symbol-exists / call-exists / edge-* / run）都是**正向断言**，
 *   两个 feature 各说一条只能**并集**，构不成矛盾 —— 所以今天 23 个多持有者路径里
 *   真冲突是 **0 条**（实测，2026-10-20）。
 */
export interface DesignDbConflict {
  path: string;
  kind: 'signature-matches' | 'source-has';
  /** 人话，点名两边的 feature 与各自的要求 */
  detail: string;
}

/** 判据的去重键：**只含判据本体**（`why` 是理由，不进键 —— 同一判据两说理由不算两条） */
const expectationKey = (e: RawExpectation): string =>
  JSON.stringify([
    e.kind ?? '',
    norm(e.path ?? ''),
    e.symbol ?? '',
    norm(e.target ?? ''),
    norm(e.from ?? ''),
    norm(e.to ?? ''),
    e.signature ?? '',
    (e.must ?? []).join('\n'),
    (e.mustNot ?? []).join('\n'),
    e.expect ?? '',
    JSON.stringify(e.input ?? null),
  ]);

/** 同一路径上两个持有者之间的**真冲突**（判据见 {@link DesignDbConflict}） */
function conflictsOf(rel: string, holders: DesignDbHolder[]): DesignDbConflict[] {
  const out: DesignDbConflict[] = [];

  // ① signature-matches：同一符号被要求不同签名
  const sigs = new Map<string, Map<string, string[]>>();
  for (const h of holders) {
    for (const e of h.node.decision?.expectations ?? []) {
      if (e.kind !== 'signature-matches' || !e.symbol) continue;
      const key = `${norm(e.path ?? rel)}#${e.symbol}`;
      const bySig = sigs.get(key) ?? new Map<string, string[]>();
      const sig = String(e.signature ?? '');
      bySig.set(sig, [...(bySig.get(sig) ?? []), h.feature]);
      sigs.set(key, bySig);
    }
  }
  for (const [key, bySig] of sigs) {
    if (bySig.size < 2) continue;
    const said = [...bySig.entries()].map(([sig, who]) => `${who.join('+')} 要求 \`${sig}\``).join('；');
    out.push({ path: rel, kind: 'signature-matches', detail: `${key} —— ${said}` });
  }

  // ② source-has：一边说"必须有"、另一边说"必须没有"同一串
  const byFile = new Map<string, Array<{ feature: string; must: Set<string>; mustNot: Set<string> }>>();
  for (const h of holders) {
    for (const e of h.node.decision?.expectations ?? []) {
      if (e.kind !== 'source-has') continue;
      const file = norm(e.path ?? rel);
      const list = byFile.get(file) ?? [];
      let slot = list.find((x) => x.feature === h.feature);
      if (!slot) {
        slot = { feature: h.feature, must: new Set<string>(), mustNot: new Set<string>() };
        list.push(slot);
      }
      for (const m of e.must ?? []) slot.must.add(String(m));
      for (const m of e.mustNot ?? []) slot.mustNot.add(String(m));
      byFile.set(file, list);
    }
  }
  for (const [file, list] of byFile) {
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        for (const m of a.must) {
          if (!b.mustNot.has(m)) continue;
          out.push({
            path: rel,
            kind: 'source-has',
            detail: `${file} —— ${a.feature} 要求源码里**必须有** \`${m}\`，而 ${b.feature} 要求**必须没有**它`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * **归并计划**：读 `design/*.dsl.json`，把「一个路径」归成「一份投影」。
 *
 * ★ 这是本生成器的**唯一一处**决定"同一路径多个节点怎么办"的地方：
 *   - **不是**各写一份（否则同一文件的 symbols/calls 会被复制 N 份，消费者还得再挑一次）；
 *   - **不是**第一个/最后一个 feature 赢（那会让另一个节点**永远**对不上 —— 假门就是这么来的）；
 *   - **而是**判据取并集 + 表头列出**全部**持有者 + 矛盾单独判（{@link DesignDbConflict}）。
 *
 * ★ 纯 DSL 读取（**不碰 cache.db**）⇒ 结构可复现（`checkDesignDbStructure` 靠它当门）。
 */
export function planDesignDb(
  root: string,
  opts: { feature?: string } = {},
): {
  features: string[];
  nodes: number;
  items: Map<string, DesignDbPlanItem>;
  conflicts: DesignDbConflict[];
  missingDir: boolean;
} {
  const DESIGN_DIR = path.join(root, '.agent-io', 'design');
  const plan = {
    features: [] as string[],
    nodes: 0,
    items: new Map<string, DesignDbPlanItem>(),
    conflicts: [] as DesignDbConflict[],
    missingDir: !fs.existsSync(DESIGN_DIR),
  };
  if (plan.missingDir) return plan;

  let files = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json')).sort();
  if (opts.feature) files = files.filter((f) => f === `${opts.feature}.dsl.json`);
  plan.features = files.map((f) => f.replace(/\.dsl\.json$/, ''));

  // ① 按路径收集**所有**持有者（同一路径允许被多个 feature 各持一个节点）
  // ★ 2026-10-24（管辖范围收口，裁 A）：范围权威从硬编码 `startsWith('src/')` 迁到**每册的 excluded 清单**——
  //   observe-lang 等非 src 产品文件由此入投影；certs/scripts 等量具由 excluded 挡住。
  //   ★ 2026-10-26（T-#28）：路径取法已改为 **`path` 优先、回落 `description`**（见下面 `rel` 处）；
  //     原先只认 `description` ⇒ 手写节点的散文会变成文件名。
  const excludedAll: Array<{ path: string; reason: string }> = [];
  for (const f of files) {
    const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
    for (const x of (dsl.excluded ?? []) as Array<{ path: string; reason: string }>) excludedAll.push(x);
  }
  const isExcludedPath = (p: string) => excludedAll.some((x) => p === x.path || p.startsWith(x.path));
  const byPath = new Map<string, DesignDbHolder[]>();
  for (const f of files) {
    const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
    const feature = f.replace(/\.dsl\.json$/, '');
    for (const raw of (dsl.geometry?.nodes ?? []) as AnyNode[]) {
      // ★★★ 2026-10-26（T-#28）：**`path` 优先、回落 `description`** —— 与 `write_gate#nodeFilePath` 同口径。
      //   病史：这里原先**只**取 `description` ⇒ 手写节点（`description` 是职责散文）的整句中文
      //   会变成 design-db 的**文件名**。实测产出过：
      //     design-db/本仓的愿景-理想文档：回答「这个工具到底为什么存在」，是判据与取舍的最终依据。.calls.json
      //   旧 dump 里更夸张：“考古冻结声明（不挂判据、不阻断任何工具）.calls.json”。
      //   ★ 这是第 4 处“散文当结构”（前 3 处：`design-check` 拿 description 当 path ·
      //     `write_gate` 回落 description · `node.update` 的 responsibility 优先级）。
      //   ★ T-#23 已让 `import_project` 给 file 节点写 `path` ⇒ 扫描节点走 path 分支，产出不变。
      const rel = norm((raw as { path?: string }).path ?? raw.description);
      if (!rel) continue;
      if (isExcludedPath(rel)) continue;
      plan.nodes += 1;
      const list = byPath.get(rel) ?? [];
      list.push({ feature, source: `design/${f}`, node: raw });
      byPath.set(rel, list);
    }
  }

  // ② 一个路径 ⇒ 一份投影：判据并集（去重、稳定序）+ 真冲突单独收集
  for (const [rel, holders] of byPath) {
    const seen = new Set<string>();
    const expectations: RawExpectation[] = [];
    for (const h of holders) {
      for (const e of h.node.decision?.expectations ?? []) {
        const k = expectationKey(e);
        if (seen.has(k)) continue;
        seen.add(k);
        expectations.push(e);
      }
    }
    plan.items.set(rel, {
      path: rel,
      holders: holders.map((h) => h.feature),
      sources: holders.map((h) => h.source),
      expectations,
    });
    plan.conflicts.push(...conflictsOf(rel, holders));
  }
  return plan;
}

/** 投影里的 `requirements`（★ 只收 `call-exists` —— 契约门读的是这个） */
export function requirementsOf(item: DesignDbPlanItem): Array<Record<string, unknown>> {
  return item.expectations
    .filter((e) => e.kind === 'call-exists')
    .map((e) => ({ kind: 'call-exists', symbol: e.symbol, target: e.target, ...(e.why ? { why: e.why } : {}) }));
}

/**
 * 投影里的 `requirements_calls` 的**未解析形状**（`to` 要 cache.db 才能定住符号的家）。
 * ★ 结构检查（无 cache.db）只比 `from` 与条数 —— 这就是"设计要求进没进投影"的可复现判据。
 */
export function requirementCallsOf(item: DesignDbPlanItem): Array<{ from: string; target: string; why?: string }> {
  const out: Array<{ from: string; target: string; why?: string }> = [];
  for (const e of item.expectations) {
    if (e.kind !== 'call-exists') continue;
    const fromFile = norm(e.path ?? item.path);
    out.push({ from: `${fromFile}#${e.symbol}`, target: String(e.target ?? ''), ...(e.why ? { why: e.why } : {}) });
  }
  return out;
}

export interface GenDesignDbOptions {
  /** 只处理这个 feature（不传 = design/ 下全部） */
  feature?: string;
  /** 只比对不写盘（真写会改 design-db/） */
  check?: boolean;
}

export interface GenDesignDbResult {
  /** 参与生成的 feature 数 */
  features: number;
  /** 参与生成的**文件节点**数（同一路径被两个 feature 持有 ⇒ 计 2） */
  files: number;
  /** 归并后的**投影份数**（一个路径一份） */
  paths: number;
  /** 本次写入的副本数 */
  written: number;
  /** 内容未变、跳过的副本数 */
  unchanged: number;
  /** 清理掉的陈旧副本数（check 模式恒 0） */
  pruned: number;
  /** 问题清单（读库失败 / 找不到设计目录） */
  problems: string[];
  /** ★ 投影与设计/事实不一致（**重跑生成器**能修） */
  drift: string[];
  /** ★ 真冲突（**重跑修不好**，只能改设计） */
  conflicts: string[];
  /** 本次是否 check 模式 */
  check: boolean;
}

/** 真冲突的人话（生成器与结构检查共用同一句，别各写一份） */
export const renderConflict = (c: DesignDbConflict): string =>
  `${c.path}: ${c.detail} —— 两个 feature 对同一文件的要求不可能同时满足（该改设计；重跑生成器修不好）`;

/**
 * 生成（或检查）设计 DB。
 * ★ 纯 I/O：读 `design/*.dsl.json` + `cache.db`，写 `designDbDir(root)`（= `<root>/design-db/`）。
 *
 * ★ 2026-10-20：**一个路径只写一份**（此前是"逐节点各写一遍同一个文件名" ⇒ 后写的覆盖前面的，
 *   于是另一个 feature 的节点**永远**对不上 ⇒ `check=true` 结构上不可能绿）。
 *   现在按 `planDesignDb` 归并后写，表头列出**全部**持有者。
 */
export function genDesignDb(root: string, opts: GenDesignDbOptions = {}): GenDesignDbResult {
  const OUT_DIR = designDbDir(root);
  const CHECK = opts.check === true;

  const result: GenDesignDbResult = {
    features: 0,
    files: 0,
    paths: 0,
    written: 0,
    unchanged: 0,
    pruned: 0,
    problems: [],
    drift: [],
    conflicts: [],
    check: CHECK,
  };

  const plan = planDesignDb(root, { feature: opts.feature });
  result.features = plan.features.length;
  result.files = plan.nodes;
  result.paths = plan.items.size;
  result.conflicts = plan.conflicts.map(renderConflict);
  if (plan.missingDir) {
    result.problems.push(`找不到 ${path.join(root, '.agent-io', 'design')}`);
    return result;
  }
  if (!CHECK) fs.mkdirSync(OUT_DIR, { recursive: true });

  const dbPath = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const qSymbols = db.prepare(
    // ★ 2026-10-20：带上 members（type/interface 的定义；function 恒为 NULL）
    "SELECT name, kind, start_line, signature, members FROM nodes WHERE file_path = ? AND parent IS NULL AND kind != 'file' ORDER BY start_line",
  );
  const qImports = db.prepare('SELECT source, kind, type_only FROM v_imports WHERE file_path = ? ORDER BY line');
  const qCallsOut = db.prepare("SELECT source, target FROM edges WHERE kind = 'call' AND source LIKE ? ORDER BY target");
  const qHome = db.prepare(
    'SELECT file_path FROM nodes WHERE name = ? AND parent IS NULL ORDER BY (file_path = ?) DESC LIMIT 1',
  );

  // ★★★ 2026-10-24（影响面 · 决策卡 file_src_application_design_db_gen_design_db_ts）：
  //   **反向调用索引**（一次性建）：target 文件 → 谁调它（source 节点 id 集合）。
  //   ★ 事实只取 cache.db 边表（与 calls 同源反向，不引第二份事实源）；
  //   ★ 一跳落库；跨文件传递闭包由消费者沿 reverse_calls 行走（渐进式披露：DSL 浅 → DB 深一层）。
  const reverseByFile = new Map<string, Set<string>>();
  for (const e of db.prepare("SELECT source, target FROM edges WHERE kind = 'call'").all() as Array<{
    source: string;
    target: string;
  }>) {
    const i = e.target.lastIndexOf('#');
    if (i <= 0) continue;
    const targetFile = norm(e.target.slice(0, i));
    let set = reverseByFile.get(targetFile);
    if (!set) reverseByFile.set(targetFile, (set = new Set()));
    set.add(norm(e.source));
  }

  // ★ 2026-10-24（裁 A 落地）：**期望段上投影** —— 设计册的符号期望（无行号）与现状并列，
  //   gap 一眼可见。意图的源在设计册，gen-db 幂等重生成 ⇒ 不需要锁（VISION §冲突已裁：calls 只读、dep 已退役）。
  const expectedByPath = new Map<string, Array<{ name: string; kind: string; signature?: string }>>();
  for (const f of fs.readdirSync(path.join(root, '.agent-io', 'design'))) {
    if (!f.endsWith('.dsl.json')) continue;
    const book = JSON.parse(fs.readFileSync(path.join(root, '.agent-io', 'design', f), 'utf8')) as {
      semantic?: { files?: Array<{ path?: string; symbols?: Array<{ name: string; kind: string; signature?: string }> }> };
    };
    for (const sf of book.semantic?.files ?? []) {
      if (!sf.path) continue;
      const key = norm(sf.path);
      if (!expectedByPath.has(key)) expectedByPath.set(key, []);
      const arr = expectedByPath.get(key)!;
      const seen = new Set(arr.map((s) => s.name));
      for (const s of sf.symbols ?? []) {
        if (seen.has(s.name)) continue;
        seen.add(s.name);
        arr.push({ name: s.name, kind: s.kind, ...(s.signature ? { signature: s.signature } : {}) });
      }
    }
  }

  try {
    for (const item of plan.items.values()) {
      const rel = item.path;

      let symbols: Array<Record<string, unknown>> = [];
      let imports: Array<Record<string, unknown>> = [];
      let calls: Array<Record<string, unknown>> = [];
      try {
        symbols = (qSymbols.all(rel) as Array<{ name: string; kind: string; start_line: number; signature: string | null; members: string | null }>).map(
          (r) => ({
            name: r.name,
            kind: r.kind,
            line: r.start_line,
            ...(r.signature ? { signature: r.signature } : {}),
            // ★ 2026-10-20：类型成员（JSON 里存的是字符串，这里还原成数组）
            ...(r.members ? { members: JSON.parse(String(r.members)) } : {}),
          }),
        );
        imports = (qImports.all(rel) as Array<{ source: string; kind: string; type_only: number | null }>).map((r) => ({
          source: r.source,
          kind: r.kind,
          ...(r.type_only ? { type_only: true } : {}),
        }));
        calls = (qCallsOut.all(rel + '#%') as Array<{ source: string; target: string }>).map((r) => ({
          from: norm(r.source),
          to: norm(r.target),
        }));
      } catch (e) {
        result.problems.push(`${rel}: 读 cache.db 失败（${(e as Error)?.message ?? String(e)}）`);
        continue;
      }

      // ★ 设计要求单独一个字段：`calls` 是全量镜像（必然全绿），
      //   `requirements_calls` 才是"设计说必须有"的 —— 契约门必须读它。
      const requirementsCalls: Array<Record<string, unknown>> = [];
      for (const spec of requirementCallsOf(item)) {
        const home = qHome.get(spec.target, spec.from.split('#')[0]) as { file_path?: string } | undefined;
        if (!home) continue;
        requirementsCalls.push({
          from: spec.from,
          to: `${norm(home.file_path)}#${spec.target}`,
          ...(spec.why ? { why: spec.why } : {}),
        });
      }

      const sources = item.sources.join(', ');
      // ★ 2026-10-24（影响面）：谁调我 —— 一跳反向调用（source 节点 id，排序保证可复现）。
      const reverseCalls = [...(reverseByFile.get(norm(rel)) ?? [])].sort();
      const payload = {
        '//': `Design DB —— ${rel}（★ 全量、与实际 DB 同构；从 ${sources} 的节点生成）`,
        '//generated_by': 'scripts/gen-design-db.mjs（★ 不许手改：改了下次生成就冲掉）',
        '//source': sources,
        /** 副本自报路径（机器可读；此前只在首行注释里，消费者只能解析注释） */
        path: rel,
        symbols,
        imports,
        calls,
        ...(expectedByPath.get(norm(rel))?.length ? { expected_symbols: expectedByPath.get(norm(rel)) } : {}),
        ...(reverseCalls.length ? { reverse_calls: reverseCalls } : {}),
        ...(requirementsOf(item).length ? { requirements: requirementsOf(item) } : {}),
        ...(requirementsCalls.length ? { requirements_calls: requirementsCalls } : {}),
      };
      const outPath = path.join(OUT_DIR, outNameOf(rel));
      const text = JSON.stringify(payload, null, 2) + '\n';
      const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
      if (old === text) {
        result.unchanged += 1;
        continue;
      }
      if (CHECK) {
        result.drift.push(`${outNameOf(rel)}: 与当前设计不一致（该重跑生成器）`);
        continue;
      }
      fs.writeFileSync(outPath, text);
      result.written += 1;
    }
  } finally {
    db.close();
  }

  const expected = new Set([...plan.items.keys()].map(outNameOf));
  if (CHECK) {
    // ★ check 也要看"多出来的"：否则删了一个节点、副本留在盘上，这道读数永远是绿的
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!expected.has(name)) result.drift.push(`${name}: 设计里没有这个路径的节点（陈旧副本，该重跑生成器以清理）`);
    }
  } else {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!expected.has(name)) {
        fs.unlinkSync(path.join(OUT_DIR, name));
        result.pruned += 1;
      }
    }
  }
  return result;
}

/** 结构检查的读数（★ 只覆盖**设计侧可复现**的那一半） */
export interface DesignDbStructureResult {
  paths: number;
  files: number;
  /** 设计里有、盘上没有 */
  missing: string[];
  /** 盘上有、但与设计的**设计要求/表头**对不上 */
  stale: string[];
  /** 盘上有、设计里没有 */
  extra: string[];
  conflicts: string[];
  problems: string[];
}

/**
 * ★★★ **结构检查 = 可以当门的那一半**（门：`scripts/gen-db-check.mjs`）。
 *
 * ## 为什么它与 `check=true` 不是同一件事（★ 别合并）
 * `genDesignDb({check:true})` 比的是**整份字节**，其中 `symbols` / `imports` / `calls` 来自
 * `cache.db` —— 而 `cache.db` **不入库**（实测：`git ls-files .agent-io` 只有 2 份 DSL）。
 * ⇒ 把它当门 = 换一种假门：**同一次提交，在不同机器/不同索引版本上红绿不同**。
 *
 * 本函数只比**设计侧可复现**的三样（全部只依赖入库的 `design/*.dsl.json`）：
 * ① `//source` 是否列出**全部**持有者；② `requirements` 是否等于设计判据的并集；
 * ③ `requirements_calls` 的**调用方与条数**是否与设计一致（`to` 要 cache.db，不比）。
 * 外加 ④ 缺副本 / ⑤ 多余副本。
 *
 * ## 它挡的是哪一类事故（这不是"普查"）
 * 「设计加了 `call-exists` 但没重跑 gen-db」⇒ design-db 里的 `requirements_calls` 是**旧的**，
 * 而 `scripts/contract-calls.mjs`（契约门）读的正是它 ⇒ **契约门在拿旧要求判新的代码**，静默撒谎。
 */
export function checkDesignDbStructure(root: string): DesignDbStructureResult {
  const OUT_DIR = designDbDir(root);
  const r: DesignDbStructureResult = {
    paths: 0,
    files: 0,
    missing: [],
    stale: [],
    extra: [],
    conflicts: [],
    problems: [],
  };
  const plan = planDesignDb(root);
  r.paths = plan.items.size;
  r.files = plan.nodes;
  if (plan.missingDir) {
    r.problems.push(`找不到 ${path.join(root, '.agent-io', 'design')}`);
    return r;
  }
  r.conflicts = plan.conflicts.map(renderConflict);

  for (const item of plan.items.values()) {
    const name = outNameOf(item.path);
    const outPath = path.join(OUT_DIR, name);
    if (!fs.existsSync(outPath)) {
      r.missing.push(`${name}: 没有这份投影（设计里有 ${item.path}）`);
      continue;
    }
    let disk: Record<string, unknown>;
    try {
      disk = JSON.parse(fs.readFileSync(outPath, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      r.problems.push(`${name}: 读不出 JSON（${(e as Error)?.message ?? String(e)}）`);
      continue;
    }
    const why: string[] = [];
    if (norm(disk['//source']) !== item.sources.join(', ')) {
      why.push(`//source 写的是 ${JSON.stringify(disk['//source'])}，设计里的持有者是 ${JSON.stringify(item.sources.join(', '))}`);
    }
    if (JSON.stringify(disk.requirements ?? []) !== JSON.stringify(requirementsOf(item))) {
      why.push('requirements 与设计的判据不一致');
    }
    const wantFrom = requirementCallsOf(item).map((x) => x.from);
    const gotFrom = ((disk.requirements_calls ?? []) as Array<{ from?: string }>).map((x) => norm(x.from));
    if (JSON.stringify(gotFrom) !== JSON.stringify(wantFrom)) {
      why.push(`requirements_calls 的调用方 ${JSON.stringify(gotFrom)} 与设计的 ${JSON.stringify(wantFrom)} 不一致`);
    }
    if (why.length) r.stale.push(`${name}: ${why.join('；')}（该重跑生成器）`);
  }

  const expected = new Set([...plan.items.keys()].map(outNameOf));
  if (fs.existsSync(OUT_DIR)) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!expected.has(name)) r.extra.push(`${name}: 设计里没有对应的节点（陈旧副本，该重跑生成器清理）`);
    }
  }
  return r;
}
