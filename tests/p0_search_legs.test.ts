// touches: src/infrastructure/index/symbols.ts, src/application/meta/llm/semantic_search.ts
/**
 * R65 · 检索层的**三条腿 + RRF 融合**（检测点，0.25①）。
 *
 * ## 不变量（要守住的东西，不是某一版的复盘故事）
 * ① **精确名必须顶第一**：`saveDSL` 在库里等值命中只有 1 条，而单路 FTS 会把它排到后面
 *    （诱饵的 docstring 里出现了同一个串）⇒ 「名字等值」必须自成一路，融合后它排第 1。
 * ② **2 字中文查询必须非空**：`tokenize='trigram'` 的最短可匹配长度是 3 ⇒ 短于它的查询在
 *    FTS 腿里**恒 0 条**，而库里的命中一条没少 ⇒ 必须有子串兜底腿；且排序不能把 `scripts/`
 *    顶到前面（2 字中文词的高相关命中在 `src/`）。
 * ③ **反向**：3 字以上的长查询**不许变差** —— 腿 1/腿 3 都不该插手，结果与改前的单路 FTS 逐条同序。
 * ④⑤ **消融**（0.25②）：摘掉哪条腿，对应判据就必须重新变红 —— 否则那条腿没有鉴别力。
 *
 * ## 夹具（合成语料，0.14）
 * 语料是**造的**（`CORPUS`），只为复现两个实测缺陷的形状：**真答案的 docstring 里没有那个串，
 * 诱饵的 docstring 里有**。语料形状与实仓读数一一对应（`写闸`：FTS 0 条 / LIKE 42 条，分母 9577
 * 个节点；`saveDSL`：等值 1 条 / FTS 第 4）⇒ 这些用例红了 = 真缺陷回来了，不是夹具漂了。
 *
 * ## 为什么喂临时库而不是查本仓索引
 * 判据的输入不许是环境态（0.12②）：本仓 `cache.db` 的内容随每次提交变（符号会改名/消失），
 * 拿它当输入 ⇒ 这条门会在"有人重命名了某个符号"时红，而缺陷其实没回来。合成语料是**固定的**。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDb, type Database } from '../src/infrastructure/index/db.js';
import {
  searchSymbols,
  searchSymbolsBySubstring,
  searchSymbolsHybrid,
} from '../src/infrastructure/index/symbols.js';

interface CorpusRow {
  kind: string;
  name: string;
  qn: string;
  file: string;
  line: number;
  sig: string;
  doc: string;
}

/**
 * 合成语料：四组查询各自的真答案与诱饵。
 * ★ 每组的形状都一样 —— **真答案的 doc 里不出现查询串**（只能靠名字/等值命中），
 *   **诱饵的 doc 里出现**（bm25 会把它们排到真答案前面）。
 */
const CORPUS: CorpusRow[] = [
  // ── saveDSL 组（R65 ①）
  { kind: 'function', name: 'saveDSL', qn: 'saveDSL', file: 'src/infrastructure/storage.ts', line: 1349, sig: 'saveDSL(feature: string): void', doc: '/** 把整份设计 DSL 原子写回盘（生产环境唯一的写入口）。 */' },
  { kind: 'function', name: 'realSaveDslSites', qn: 'realSaveDslSites', file: 'tests/p0_dsl_write_ends.test.ts', line: 48, sig: 'realSaveDslSites(src: string): number[]', doc: '/** 真实 `saveDSL(...)` 调用点的行号：saveDSL 在注释里出现不算，被注释掉的 saveDSL 也不算。 */' },
  { kind: 'const', name: 'writeAtomic', qn: 'saveDSL.writeAtomic', file: 'src/infrastructure/storage.ts', line: 1422, sig: 'const writeAtomic', doc: '/** saveDSL 的内部原子写：saveDSL 只用 tmp + rename 落盘。 */' },
  { kind: 'const', name: 'm', qn: 'm', file: 'scripts/stat-raw-writes.mjs', line: 46, sig: 'const m', doc: '// saveDSL 裸写统计用的正则' },

  // ── 写闸 组（R65 ② · 2 字中文）：src/ 命中次数多，scripts/ 各 1 次
  { kind: 'function', name: 'touchTaskHeartbeat', qn: 'touchTaskHeartbeat', file: 'src/application/design/dsl_ops/task_ops.ts', line: 700, sig: 'touchTaskHeartbeat()', doc: '/** 心跳的写盘入口（只给写闸用）。写闸只判不写；让写闸自己拼一份就是第二个写端 ⇒ 写闸只调这一格。 */' },
  { kind: 'function', name: 'assertSourceWriteRegistered', qn: 'assertSourceWriteRegistered', file: 'src/application/write_gate.ts', line: 1080, sig: 'assertSourceWriteRegistered(root: string)', doc: '/** 写闸入口：断言源码写入已登记；写闸拒绝时给五步取卡。 */' },
  { kind: 'type', name: 'WriteSubject', qn: 'WriteSubject', file: 'src/application/write_gate.ts', line: 725, sig: 'WriteSubject()', doc: '/** 写闸主体四类：source / product / temp / outside-root —— 写闸只认这四类。 */' },
  { kind: 'const', name: 'REPO', qn: 'REPO', file: 'scripts/hook-task-gate.mjs', line: 12, sig: 'const REPO', doc: '// 写闸覆盖率的仓库根' },
  { kind: 'function', name: 'loadClassifier', qn: 'loadClassifier', file: 'scripts/registry_repair.mjs', line: 30, sig: 'loadClassifier()', doc: '// 写闸用的分类器加载' },

  // ── 决策 组（②的第二个查询 + ③ 的 3 字中文查询）
  { kind: 'type', name: 'NodeDecision', qn: 'NodeDecision', file: 'src/domain/geometry.ts', line: 240, sig: 'NodeDecision()', doc: '/** 决策卡：节点上的设计决策；决策卡只住这一格。 */' },
  { kind: 'function', name: 'decisionOf', qn: 'decisionOf', file: 'src/domain/overlay.ts', line: 88, sig: 'decisionOf(n: string)', doc: '/** 读决策卡（没有就返回 null）。 */' },
  { kind: 'function', name: 'renderDecisionCard', qn: 'renderDecisionCard', file: 'src/application/design/index.ts', line: 501, sig: 'renderDecisionCard()', doc: '/** 把决策卡渲染进消息。 */' },

  // ── 漂移 组（②的第三个查询）
  { kind: 'function', name: 'detectDrift', qn: 'detectDrift', file: 'src/application/design/intent/detect_drift.ts', line: 40, sig: 'detectDrift()', doc: '/** 设计↔实际漂移探测（漂移 = 要求与代码不一致）。 */' },
  { kind: 'const', name: 'DRIFT_KINDS', qn: 'DRIFT_KINDS', file: 'src/application/design/intent/detect_drift.ts', line: 12, sig: 'const DRIFT_KINDS', doc: '/** 漂移的四态。 */' },

  // ── heartbeat 组（③的 ASCII 长查询；★ 没有任何节点叫 `heartbeat`，所以腿 1 必空）
  { kind: 'function', name: 'renewTask', qn: 'renewTask', file: 'src/application/design/dsl_ops/task_ops.ts', line: 420, sig: 'renewTask()', doc: '/** 续租 heartbeat：heartbeat 间隔低于阈值就跳过。 */' },
  { kind: 'const', name: 'LEASE_TTL_MS', qn: 'LEASE_TTL_MS', file: 'src/domain/task_machine.ts', line: 60, sig: 'const LEASE_TTL_MS', doc: '/** heartbeat 租约 TTL。 */' },
  { kind: 'function', name: 'shouldTouchHeartbeat', qn: 'shouldTouchHeartbeat', file: 'src/domain/task_machine.ts', line: 640, sig: 'shouldTouchHeartbeat()', doc: '/** 是否该刷 heartbeat。 */' },

  // ── 通配符组（0.14 异义必不命中）：查 `a_` 只许命中字面含 `a_` 的 `a_b`，不许通配到 `axb`
  { kind: 'function', name: 'a_b', qn: 'a_b', file: 'src/fixture/wild.ts', line: 10, sig: 'a_b()', doc: '// 下划线名字：a_ 开头' },
  { kind: 'function', name: 'axb', qn: 'axb', file: 'src/fixture/wild.ts', line: 20, sig: 'axb()', doc: '// 只有 x，没有下划线' },
];

/**
 * 建一份**只含 CORPUS** 的临时 cache.db（走 `openDb` 的真实 schema + FTS 触发器，
 * 不手写 DDL —— schema 改了这里自动跟上）。返回 db 与清理函数。
 */
function openCorpus(): { db: Database; close: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-search-legs-'));
  const db = openDb(path.join(dir, '.agent-io', 'cache.db'));
  const ins = db.prepare(
    'INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, signature, docstring, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  );
  for (const r of CORPUS) {
    ins.run(`${r.file}#${r.qn}:${r.line}`, r.kind, r.name, r.qn, r.file, 'ts', r.line, r.line + 1, r.sig, r.doc, 1);
  }
  return {
    db,
    close: () => {
      try {
        db.close();
      } finally {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          // 临时目录清不掉不影响判据（Windows 句柄延迟释放）；不在判据里断言它
        }
      }
    },
  };
}

/** 命中的「文件名#符号名」序列（读数用，避免把整个 hit 对象塞进断言消息）。 */
function idOf(hits: ReadonlyArray<{ file_path: string; name: string }>): string[] {
  return hits.map((h) => `${h.file_path}#${h.name}`);
}

test('① 精确名必顶第一：查 saveDSL ⇒ top-1 是 src/infrastructure/storage.ts 的 saveDSL', () => {
  const c = openCorpus();
  try {
    const hits = searchSymbolsHybrid(c.db, 'saveDSL');
    assert.ok(hits.length > 0, 'saveDSL 必须有命中（否则整条腿都没跑起来）');
    assert.equal(hits[0].name, 'saveDSL', `top-1 必须是真答案，实得：${JSON.stringify(idOf(hits))}`);
    assert.equal(hits[0].file_path, 'src/infrastructure/storage.ts');
    assert.equal(
      hits[0].legs.exact,
      1,
      '它必须是靠「精确名」腿的第 1 名进来的（否则融合赢了也不是这条腿的功劳）',
    );
    // ★ 缺陷基线（改前形状）：单路 FTS 的 top-1 **不是**真答案 —— ④ 的消融就是把这句变成结论
    const ftsOnly = searchSymbols(c.db, 'saveDSL');
    assert.notEqual(ftsOnly[0].file_path, 'src/infrastructure/storage.ts', '单路 FTS 的 top-1 应是诱饵（缺陷形状）');
    assert.ok(
      ftsOnly.findIndex((h) => h.name === 'saveDSL') > 0,
      `单路 FTS 里真答案不许是 top-1（本仓实测是第 4），实得：${JSON.stringify(idOf(ftsOnly))}`,
    );
  } finally {
    c.close();
  }
});

test('② 短查询必非空：写闸 / 决策 / 漂移（2 字中文）都非空，且前 3 条都在 src/', () => {
  const c = openCorpus();
  try {
    for (const q of ['写闸', '决策', '漂移']) {
      const hits = searchSymbolsHybrid(c.db, q);
      assert.ok(hits.length > 0, `2 字中文查询「${q}」必须非空（改前 FTS 恒 0 条：trigram 最短 3 字符）`);
      const top3 = hits.slice(0, 3).map((h) => h.file_path);
      assert.ok(
        top3.every((f) => f.startsWith('src/')),
        `「${q}」前 3 条必须都在 src/，实得：${JSON.stringify(top3)}`,
      );
    }
    // ★ 语料里确实有 scripts/ 的命中 ⇒ ② 靠的是**排序**，不是"语料里没有 scripts/"
    const sub = searchSymbolsBySubstring(c.db, '写闸');
    assert.ok(sub.some((h) => h.file_path.startsWith('scripts/')), '语料必须含 scripts/ 命中，否则 ② 没有鉴别力');
    assert.ok(sub.some((h) => h.file_path.startsWith('src/')), '语料必须含 src/ 命中');
    assert.equal(sub[0].file_path.startsWith('src/'), true, '腿 3 的排序必须把 src/ 排在最前（按命中次数）');
  } finally {
    c.close();
  }
});

test('③ 反向：3 字以上查询不劣于改前（与单路 FTS 逐条同序）', () => {
  const c = openCorpus();
  try {
    for (const q of ['决策卡', 'heartbeat']) {
      const fused = idOf(searchSymbolsHybrid(c.db, q));
      const fts = idOf(searchSymbols(c.db, q));
      assert.ok(fts.length > 0, `「${q}」在单路 FTS 里必须有命中（否则这条反向用例是空跑）`);
      assert.deepEqual(fused, fts, `「${q}」是长查询 ⇒ 腿 1/腿 3 都不该插手，结果必须与改前逐条同序`);
    }
  } finally {
    c.close();
  }
});

test('④ 消融：摘掉「精确名」腿 ⇒ ① 重新变成"不是 top-1"', () => {
  const c = openCorpus();
  try {
    const off = searchSymbolsHybrid(c.db, 'saveDSL', { legs: { exact: false } });
    assert.ok(off.length > 0, '摘掉一条腿后仍应命中（否则这条消融分不清"腿有用"与"全挂了"）');
    assert.notEqual(
      `${off[0].file_path}#${off[0].name}`,
      'src/infrastructure/storage.ts#saveDSL',
      `摘掉精确名腿后真答案不许还是 top-1，实得：${JSON.stringify(idOf(off))}`,
    );
    assert.equal(off[0].legs.exact, undefined, '摘掉之后不该有任何命中带 exact 名次');
  } finally {
    c.close();
  }
});

test('⑤ 消融：摘掉「短查询兜底」腿 ⇒ ② 重新变空', () => {
  const c = openCorpus();
  try {
    for (const q of ['写闸', '决策']) {
      const off = searchSymbolsHybrid(c.db, q, { legs: { short: false } });
      assert.deepEqual(off, [], `摘掉子串腿后「${q}」必须重新变空（这正是改前的缺陷）`);
    }
  } finally {
    c.close();
  }
});

test('0.14 双向：腿 1 只认等值（saveDS 不算命中）；腿 3 异义必不命中', () => {
  const c = openCorpus();
  try {
    // 同义必命中：等值查询靠腿 1
    const exact = searchSymbolsHybrid(c.db, 'saveDSL');
    assert.equal(exact.find((h) => h.name === 'saveDSL')?.legs.exact, 1);
    // 异义必不命中：`saveDS` 是**前缀**，不是等值 —— 腿 1 不许把它当精确命中（子串伪装成整词）
    const prefix = searchSymbolsHybrid(c.db, 'saveDS');
    assert.ok(prefix.length > 0, '`saveDS` 靠 FTS 腿应当有命中（否则这条对照组是空跑）');
    for (const h of prefix) {
      assert.equal(h.legs.exact, undefined, `前缀查询不许被精确名腿命中：${h.file_path}#${h.name}`);
    }
    // 异义必不命中：语料里根本不存在的 2 字词 ⇒ 三条腿全空（不是"返回了一堆不相关"）
    assert.deepEqual(searchSymbolsHybrid(c.db, '校验'), [], '语料里没有的 2 字词必须返回空');
  } finally {
    c.close();
  }
});

test('腿 2 行为不许变：短于 TRIGRAM_MIN_CHARS 的查询在 FTS 腿里恒空（这是腿 3 存在的理由）', () => {
  const c = openCorpus();
  try {
    assert.deepEqual(searchSymbols(c.db, '写闸'), [], 'trigram 最短 3 字符 ⇒ 2 字查询在腿 2 里必须恒空');
    assert.deepEqual(searchSymbols(c.db, 'ab'), [], '2 字符 ASCII 同理');
    assert.ok(searchSymbols(c.db, '决策卡').length > 0, '3 字查询在腿 2 里必须有命中（长度闸只拦 <3）');
  } finally {
    c.close();
  }
});

test('0.14 异义必不命中：腿 3 必须转义 LIKE 通配符（a_ 不许通配到 axb）', () => {
  const c = openCorpus();
  try {
    const hits = searchSymbolsBySubstring(c.db, 'a_');
    assert.ok(hits.some((h) => h.name === 'a_b'), '字面含 a_ 的符号必须命中（同义必命中）');
    assert.equal(
      hits.some((h) => h.name === 'axb'),
      false,
      'axb 不含字面 a_ ⇒ 必须不命中（不转义的话下划线是通配符，会把它一起命中 = 静默错命中）',
    );
  } finally {
    c.close();
  }
});
