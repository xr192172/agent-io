#!/usr/bin/env node
/**
 * gate_caps.mjs —— S-2 门/任务**读写能力分类一处权威**（§13.6 S-2 / §13.12 10.6）。
 *
 * ## 它是什么
 * 每道 verify 门（及 S-EXEC 后续的 part 任务）在此**一处登记**：它读哪些资源、写哪些资源、
 * 是否有外部副作用、归哪个并发池。S-EXEC 调度器（§13.12 10.2–10.9）**只读消费**这张表，
 * 不自己从命令文本/脚本名反推能力（反推 = 第二处权威，改一次漂一次）。
 *
 * ## 资源类别（资源秩表，一处登记）
 * 资源不是逐文件列，而是类别；同类别共享同一把并发/隔离口径。
 *
 * ## fail-closed 纪律
 * · 门未在表内登记 ⇒ 不当只读：按写面 + 保守池（`db-write`）串行处置，`unregistered=true` 留痕。
 *   「算不出 ⇒ 回退保守」，不许默认并发。
 * · 与既有门级继承白名单（`verify_inheritance.INHERITABLE`）互斥：白名单门必须 `writes=[]`；
 *   写面门误标只读由 `validateCaps` 点名拒绝。
 * · 聚合门的次级写面逐子检查登记（`SUBCHECK_CAPS`），不许总门一张只读标签盖住子检查。
 *
 * ## 边界（一期口径，阈值待探针标定后 Main 另冻结）
 * · 池类别是**起步分类**：`cpu`（只读/隔离临时写，可入并发槽）、`db-write`（共享可写资源，串行/互斥）、
 *   `heavy`（重活排他，对齐 `heavy_lock.mjs`）。并发度数不在这里冻结。
 * · 仅在 `--update-baseline` / 逃生口才写盘的门，默认跑口径只读（逃生口不在常规 verify 路径）。
 */

/** 资源类别常量（资源秩表唯一住处）。 */
export const RES = Object.freeze({
  SRC: 'src',
  TESTS: 'tests',
  DOCS: 'docs',
  DESIGN_DB: 'design-db',
  DESIGN_DSL: 'design-dsl',
  GO_PKG: 'observe-lang-go',
  AGENT_IO: '.agent-io',
  CACHE_DB: 'cache.db',
  DIST: 'dist',
  JUDGE_CACHE: 'judge-cache',
  JUDGE_READINGS: 'judge-readings',
  ISOLATED_HOME: 'isolated-home',
  DERIVED_FINGERPRINT: 'derived-fingerprint',
  BASELINE: 'baseline',
});

/** 并发池类别（S-EXEC 消费）。 */
export const POOL = Object.freeze({
  /** 只读 / 隔离临时写：可入 P-CPU 并发槽。 */
  CPU: 'cpu',
  /** 共享可写资源：P-DB-WRITE 互斥，串行处置。 */
  DB_WRITE: 'db-write',
  /** 重活排他：对齐 heavy_lock.mjs（dist · judge-cache · cache.db · design-db 共享）。 */
  HEAVY: 'heavy',
});

/** 合法资源类别集合（校验用）。 */
const RESOURCE_KEYS = new Set(Object.values(RES));
/** 合法池类别集合。 */
const POOL_KEYS = new Set(Object.values(POOL));

/**
 * 门能力登记（权威表）。键 = verify.mjs#GATES 的门名（逐字相同）。
 * 字段：
 * · `reads` / `writes`：资源类别数组（RES.*）。
 * · `side_effect`：是否产生命令/磁盘之外的外部副作用（网络、装包、改工作树文件）。
 * · `pool`：并发池类别（POOL.*）。
 * · `rank`：资源秩（0 只读 → 3 重活；调度参考，起步值）。
 * · `note`：口径留痕。
 */
export const GATE_CAPS = Object.freeze({
  'ts 类型': {
    reads: [RES.SRC, RES.DIST], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'tsc --noEmit：只读 src，不写 dist（noEmit）。',
  },
  '工具链完整': {
    reads: [RES.SRC, RES.DIST], writes: [RES.DERIVED_FINGERPRINT], side_effect: false, pool: POOL.CPU, rank: 1,
    note: '写 .agent-io 内工具链指纹（派生）；不碰共享判据数据。',
  },
  'MCP 工具签名': {
    reads: [RES.SRC], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'semantic 模式：扫描 TOOL_DEFS 签名 / 注册一致 / 孤立集 / dist 新鲜 / top10 明细，只读 src。',
  },
  'MCP 工具面开销': {
    reads: [RES.SRC, RES.DIST, RES.BASELINE], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'surface 模式：起 server 取 wire 字节/工具数对基线棘轮；只读 src/dist/基线。--surface --update 逃生口才写基线，不在常规 verify 路径。',
  },
  'Go 编译': {
    reads: [RES.GO_PKG], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'go build ./...（无 -o）；只读包树。继承白名单。',
  },
  'Go 静态检查': {
    reads: [RES.GO_PKG], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'go vet ./...；只读包树。继承白名单。',
  },
  '实现夹具': {
    reads: [RES.DIST], writes: [RES.ISOLATED_HOME], side_effect: false, pool: POOL.CPU, rank: 1,
    note: '在 STAGE 临时目录写夹具 + 临时 cache.db；不写真仓。',
  },
  '设计 DB 结构': {
    reads: [RES.DESIGN_DB, RES.DESIGN_DSL, RES.JUDGE_READINGS, RES.BASELINE], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: '只读 design-db / DSL / judge-readings / 基线；--update-baseline 逃生口写基线，不在常规 verify 路径。',
  },
  '设计 DB 调用对账': {
    reads: [RES.DESIGN_DB, RES.DESIGN_DSL, RES.CACHE_DB], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: '--calls-index：只核 requirements_calls 调用方索引对账（qHome 落点解析）；读 design-db 副本 / DSL / cache.db。车道外 offLane 不计码，本地全量仍计入。',
  },
  '设计册判据': {
    reads: [RES.DESIGN_DB, RES.SRC, RES.JUDGE_READINGS], writes: [RES.JUDGE_CACHE, RES.CACHE_DB, RES.JUDGE_READINGS, RES.DESIGN_DB], side_effect: true, pool: POOL.HEAVY, rank: 3,
    note: 'judge-all：跑判定并刷新 judge-cache / cache.db / judge-readings；重活排他。',
  },
  '判据突变': {
    reads: [RES.DIST, RES.SRC], writes: [RES.DIST, RES.JUDGE_CACHE], side_effect: true, pool: POOL.HEAVY, rank: 3,
    note: 'mutate：临时改 dist 再还原；重活排他。',
  },
  '文档与事实': {
    reads: [RES.DOCS, RES.SRC, RES.AGENT_IO], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: '聚合门；六个子检查逐子登记于 SUBCHECK_CAPS，全部只读三向对账。',
  },
  '测试': {
    reads: [RES.SRC, RES.TESTS], writes: [RES.ISOLATED_HOME], side_effect: false, pool: POOL.CPU, rank: 1,
    note: 'run-tests：每文件一个隔离临时 home；不写真册。并行档产者护栏降级（见 run-tests.mjs）。',
  },
  '结构意图': {
    reads: [RES.SRC, RES.DESIGN_DB], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'structure-gate：只读 src 与 design-db 对账。',
  },
  '无卡写账': {
    reads: [RES.AGENT_IO], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'write-log-audit：只读 .agent-io 写账。',
  },
  '派生条目要求权': {
    reads: [RES.BASELINE, RES.DESIGN_DB], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'req-baseline-gate：只读基线与 design-db。',
  },
  '索引可信度': {
    reads: [RES.CACHE_DB], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'index-integrity-gate：只读 cache.db。',
  },
  '任务镜像对账': {
    reads: [RES.DESIGN_DB, RES.DESIGN_DSL], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'tasks-mirror-gate：只读册与任务镜像对账。',
  },
  '结案投影点名': {
    reads: [RES.DESIGN_DB, RES.DESIGN_DSL], writes: [], side_effect: false, pool: POOL.CPU, rank: 0,
    note: 'report 型：只读投影点名，不写。',
  },
});

/**
 * 聚合门「文档与事实」的子检查能力登记（次级写面逐子核对；§13.6 S-2 聚合门要求）。
 * 键 = docs-facts-check.mjs#CHECKS 的 script 名。
 */
export const SUBCHECK_CAPS = Object.freeze({
  'lint:prose': { reads: [RES.DOCS, RES.SRC], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
  'gen-facts:check': { reads: [RES.SRC, RES.DOCS], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
  'manifest:check': { reads: [RES.AGENT_IO, RES.SRC], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
  'cognition:check': { reads: [RES.DESIGN_DSL, RES.DOCS], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
  'ledger:check': { reads: [RES.DESIGN_DSL, RES.DOCS], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
  'doc:check': { reads: [RES.DOCS, RES.SRC], writes: [], side_effect: false, pool: POOL.CPU, rank: 0 },
});

/** 未登记门的保守缺省（fail-closed：不当只读，按写面串行）。 */
function fallbackCap(name) {
  return {
    name, reads: [], writes: [], side_effect: false, pool: POOL.DB_WRITE, rank: 2,
    unregistered: true, note: '未在 GATE_CAPS 登记 ⇒ 保守按写面串行处置（fail-closed）。',
  };
}

/** 取一道门的能力；未登记返回保守缺省（不抛，调度方读 `unregistered` 留痕）。 */
export function capOf(gateOrName) {
  const name = typeof gateOrName === 'string' ? gateOrName : gateOrName?.name;
  const registered = GATE_CAPS[name];
  if (!registered) return { ...fallbackCap(name), name };
  return { name, ...registered };
}

/** 是否写面（有写资源或外部副作用）。 */
export function isWriteCap(cap) {
  return Boolean(cap) && ((cap.writes?.length ?? 0) > 0 || Boolean(cap.side_effect));
}

/** 是否可入并发槽（只读 + cpu 池）。 */
export function isConcurrentRead(cap) {
  return !isWriteCap(cap) && cap?.pool === POOL.CPU;
}

/**
 * 校验能力表与门清单、继承白名单一致（fail-closed，返回问题数组；空 = 通过）。
 * @param {Array<{name:string}>} gates 现取 GATES（函数门已求值）。
 * @param {string[]} inheritable 只读继承白名单（verify_inheritance.INHERITABLE）。
 */
export function validateCaps(gates, inheritable = [], caps = GATE_CAPS, subchecks = SUBCHECK_CAPS) {
  const problems = [];
  const names = gates.map((g) => g.name);
  const seen = new Set();

  for (const name of names) {
    if (seen.has(name)) problems.push({ code: 'GATE_CAP_DUP', msg: `门名重复：${name}` });
    seen.add(name);

    const cap = caps[name];
    if (!cap) {
      problems.push({ code: 'GATE_CAP_UNREGISTERED', msg: `门「${name}」未在 GATE_CAPS 登记 ⇒ 保守串行，须补登记。` });
      continue;
    }
    for (const r of [...(cap.reads ?? []), ...(cap.writes ?? [])]) {
      if (!RESOURCE_KEYS.has(r)) problems.push({ code: 'GATE_CAP_BAD_RESOURCE', msg: `门「${name}」资源类别未登记：${r}` });
    }
    if (!POOL_KEYS.has(cap.pool)) problems.push({ code: 'GATE_CAP_BAD_POOL', msg: `门「${name}」池类别未登记：${cap.pool}` });
    if (!Number.isInteger(cap.rank) || cap.rank < 0) problems.push({ code: 'GATE_CAP_BAD_RANK', msg: `门「${name}」资源秩非法：${cap.rank}` });

    // 写面门不得进只读继承白名单。
    if (inheritable.includes(name) && ((cap.writes?.length ?? 0) > 0 || cap.side_effect)) {
      problems.push({ code: 'GATE_CAP_WRITE_MISLABELED', msg: `门「${name}」是写面（writes=${JSON.stringify(cap.writes)} side_effect=${cap.side_effect}）却出现在只读继承白名单 ⇒ 拒绝。` });
    }
    // 重活/写面池不得标成 cpu 并发槽却带共享写资源。
    if (cap.pool === POOL.CPU && (cap.writes ?? []).some((w) => [RES.DIST, RES.DESIGN_DB, RES.CACHE_DB, RES.JUDGE_CACHE, RES.JUDGE_READINGS].includes(w))) {
      problems.push({ code: 'GATE_CAP_POOL_MISMATCH', msg: `门「${name}」写共享资源 ${cap.writes.join(',')} 却归 cpu 并发池 ⇒ 须 db-write/heavy。` });
    }
  }

  // 白名单内不在 GATES 的子检查（聚合门内表）在 SUBCHECK_CAPS 核对。
  for (const sub of inheritable) {
    if (names.includes(sub)) continue; // 顶层门，上面已核
    const cap = subchecks[sub];
    if (!cap) {
      problems.push({ code: 'SUBCHECK_CAP_UNREGISTERED', msg: `只读子检查「${sub}」未在 SUBCHECK_CAPS 登记。` });
    } else if ((cap.writes?.length ?? 0) > 0 || cap.side_effect) {
      problems.push({ code: 'SUBCHECK_CAP_WRITE_MISLABELED', msg: `子检查「${sub}」写面却进只读继承白名单 ⇒ 拒绝。` });
    }
  }

  return problems;
}
