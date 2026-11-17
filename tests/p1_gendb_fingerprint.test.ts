/**
 * P1 · **gen-db per-path 输入签名**（T-#INC-GENDB 的检测点）
 *
 * ## 它守的那句话
 * 「输出侧已增量（`old === text ? skip`），但**读取侧是全量**」—— 每次 gen-db 都把
 * 555 个路径 × 4 条 SQL 重跑一遍，为的只是发现"什么都没变"。签名要做的就一件事：
 * **输入没变 ⇒ 连查询和 stringify 都不做**。省下的必须**不是判断力**。
 *
 * ## 判据（每条都说得出"什么输入让它红"）
 * | # | 输入 | 期望 | 它会红的条件 |
 * |---|---|---|---|
 * | R1 | 同一份册 + 同一份 cache.db，连跑两次 | 第二次 `reused=paths` · `recomputed=0` · **`dbQueries=0`** · `written=0` | 签名没命中（白算）/ 命中却仍发了查询（假命中）/ 命中却重写了盘 |
 * | R2a | 改册里**一条**判据（`why`） | 恰好 **1** 份重算，其余全命中 | 册侧没进签名 ⇒ 命中 ⇒ 假绿 |
 * | R2b | 改 `cache.db#files` 里**一个** path 的行（`content_hash`） | 全量重算（`recomputed=paths`） | 事实侧没进签名 ⇒ 假绿 |
 * | R2c | 改副本里的格式版本号（`v2 → v1`） | 那一份重算；`format` 变 ⇒ 全量 | 格式版本没进签名 ⇒ 改形状的旧副本被当新的 |
 * | R2d | **手改一份产物正文**（`//inputs` 原样不动） | 那一份不命中 ⇒ 重算 ⇒ 写回**逐字节复原** | 把"逐字节比"拆掉 ⇒ 手改会被静默接受 |
 * | R3 | `check` 模式下手改产物 | 报 `drift` 且**不写盘** | 命中路径替掉了门的判断力 |
 * | R4 | 产物形态 | 摘掉 `//inputs` 那一行之后 **逐字节等于**"不含该键的 payload"；顶层键集 = 原键集 + `//inputs` | 摘行规则与 stringify 不再等价 ⇒ 签名替不了逐字节比 |
 * | R5 | `cache.db` 没有 `files` 表（签名不可用） | **一个都不命中** + `fingerprintNote` 说出原因 | 算不出来被当成"一致" |
 *
 * ## 消融（本文件 2026-11-17 沙箱实测：改一处源码 ⇒ 哪条红）
 * · 命中判定去掉 `head.body === bodyDigestOf(old)` ⇒ **R2d／R3 红**（手改被接受）
 * · 命中判定去掉 `head.sig === sig` ⇒ **R2a／R2b／R2c 红**
 * · 签名里去掉 `factDigest` / `factsEpoch` ⇒ **R2b 红**
 * · 签名里去掉 `format` ⇒ **R2c 红**
 * · 命中时仍发查询（把 `continue` 挪到查询之后）⇒ **R1 红**（`dbQueries` 不是 0）
 * · `snapshotCacheFacts` 读不到 `files` 时返回空快照而不是 `null` ⇒ **R5 红**
 *
 * ## 夹具完全自治
 * 临时项目根 + 自带 `.agent-io/design/fx.dsl.json` + **自带 cache.db**（`genDesignDb` 会
 * `readOnly` 打开 `<root>/.agent-io/cache.db`）；行是**直接插**的（`files` / `nodes` / `edges`），
 * 不跑真索引器 —— 本文件判的是"签名有没有把输入算全"，不是"索引器对不对"。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  DESIGN_DB_FORMAT_VERSION,
  bodyDigestOf,
  designDbInputSignature,
  formatInputHeader,
  genDesignDb,
  parseInputHeader,
  projectionDigest,
  readInputHeaderFromText,
  stripInputHeaderLine,
} from '../src/application/design/db/gen_design_db.js';
import { closeProjectCacheDb, getProjectCacheDb } from '../src/infrastructure/index/db.js';

const roots: string[] = [];

type Fixture = { root: string; dsl: string; dbFile: string; aCopy: string; bCopy: string };
/**
 * 造一个自带册 + cache.db 的临时项目根。
 * ★ `nodes` / `edges` 的行是**手插**的：`fa`（在 `src/a.ts`）调 `fb`，这正是 `calls` 与
 * `requirements_calls` 两条腿的最小输入。
 */
function makeProject(tag: string): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `t-inc-gendb-${tag}-`));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.agent-io', 'design'), { recursive: true });
  const dslObj = {
    id: 'feature_fx',
    type: 'feature_diagram',
    feature: 'fx',
    version: '1.0.0',
    title: 'fx',
    source_root: root,
    geometry: {
      layout: 'free',
      width: 400,
      height: 300,
      nodes: [
        {
          id: 'n_a',
          type: 'file',
          label: 'a',
          path: 'src/a.ts',
          decision: {
            expectations: [
              { kind: 'call-exists', path: 'src/a.ts', symbol: 'fa', target: 'fb', why: 'a 必须调 fb' },
              { kind: 'file-exists', path: 'src/a.ts', why: '夹具判据' },
            ],
          },
        },
        { id: 'n_b', type: 'file', label: 'b', path: 'src/b.ts', decision: { expectations: [{ kind: 'file-exists', path: 'src/b.ts', why: '夹具判据' }] } },
      ],
      edges: [],
    },
    semantic: { files: [{ id: 'n_a', path: 'src/a.ts' }] },
  };
  const dsl = path.join(root, '.agent-io', 'design', 'fx.dsl.json');
  fs.writeFileSync(dsl, JSON.stringify(dslObj, null, 2), 'utf8');

  // ★ 前置：genDesignDb 会 readOnly 打开 <root>/.agent-io/cache.db（夹具先建库、再关句柄）
  getProjectCacheDb(root);
  closeProjectCacheDb(root);

  const dbFile = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbFile);
  const t = 1_700_000_000_000;
  for (const [p, ch, n] of [
    ['src/a.ts', 'hash-a1', 2],
    ['src/b.ts', 'hash-b1', 1],
  ] as const) {
    db.prepare(
      'INSERT INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count) VALUES (?,?,?,?,?,?,?)',
    ).run(p, ch, 'ts', 10, t, t, n);
  }
  const node = (id: string, name: string, file: string, line: number) =>
    db
      .prepare(
        'INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,?)',
      )
      .run(id, 'function', name, name, file, 'ts', line, line + 2, t);
  node('src/a.ts#fa', 'fa', 'src/a.ts', 1);
  node('src/a.ts#fb', 'fb', 'src/a.ts', 10);
  node('src/b.ts#fb2', 'fb2', 'src/b.ts', 1);
  db.prepare("INSERT INTO edges(source, target, kind) VALUES ('src/a.ts#fa','src/a.ts#fb','call')").run();
  const faFileId = (db.prepare('SELECT id FROM files WHERE path = ?').get('src/a.ts') as { id: number }).id;
  db.prepare("INSERT INTO imports(file_id, line, source, kind, type_only) VALUES (?,?,?,?,0)").run(
    faFileId,
    1,
    './b',
    'relative',
  );
  db.close();

  return {
    root,
    dsl,
    dbFile,
    aCopy: path.join(root, 'design-db', 'a.calls.json'),
    bCopy: path.join(root, 'design-db', 'b.calls.json'),
  };
}

/** 一份副本的原文（不存在 ⇒ null） */
const read = (p: string): string | null => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

test('R1 同名同库连跑两次 ⇒ 第二次**全命中**：reused=paths · dbQueries=0 · written=0', () => {
  const f = makeProject('r1');
  const first = genDesignDb(f.root);
  assert.equal(first.problems.length, 0, `夹具上不该有 problem（实得 ${JSON.stringify(first.problems)}）`);
  assert.ok(first.written > 0, `第一遍必须真的写了（written=${first.written}）—— 否则第二遍的"命中"是空转`);
  assert.equal(first.reused, 0, '第一遍没有 `//inputs` 可依 ⇒ 一份都不许命中');
  assert.equal(first.recomputed, first.paths, `第一遍 = 全量现算（recomputed=${first.recomputed} paths=${first.paths}）`);

  const second = genDesignDb(f.root);
  assert.equal(second.paths, first.paths, '两次的路径分母必须一致（否则读数没有意义）');
  assert.equal(second.reused, second.paths, `★ 第二遍必须**全命中**（reused=${second.reused}/${second.paths}）`);
  assert.equal(second.recomputed, 0, `命中 ⇒ 一份都不许重算（recomputed=${second.recomputed}）`);
  assert.equal(second.dbQueries, 0, `★★ 命中必须**跳过查询**（dbQueries=${second.dbQueries}）—— 不是"查询后再说"`);
  assert.equal(second.written, 0, `命中 ⇒ 不写盘（written=${second.written}）`);
  assert.equal(second.unchanged, second.paths, '命中计入 unchanged（"没变"与"没算"必须分开数：reused 才是"没算"）');
});

test('R2a 册侧任一元变（改一条判据的 why）⇒ 恰好那 1 份重算，其余仍命中', () => {
  const f = makeProject('r2a');
  const first = genDesignDb(f.root);
  assert.ok(first.paths >= 2, `夹具至少 2 个路径（实得 ${first.paths}）`);

  const book = JSON.parse(fs.readFileSync(f.dsl, 'utf8'));
  book.geometry.nodes[0].decision.expectations[0].why = 'a 必须调 fb（改过）';
  fs.writeFileSync(f.dsl, JSON.stringify(book, null, 2), 'utf8');

  const second = genDesignDb(f.root);
  assert.equal(second.recomputed, 1, `★ 只有被改的那 1 个路径该重算（recomputed=${second.recomputed}）`);
  assert.equal(second.reused, second.paths - 1, '其余必须仍然命中（册侧没动的路径不受牵连）');
  assert.ok(second.written >= 1, '判据变了 ⇒ 该重写那一份（why 进了 requirements）');
  assert.equal(second.problems.length, 0, JSON.stringify(second.problems));
});

test('R2b cache.db 该 path 的行集变（content_hash）⇒ 事实侧失效 ⇒ 全量重算', () => {
  const f = makeProject('r2b');
  genDesignDb(f.root);
  const db = new DatabaseSync(f.dbFile);
  db.prepare('UPDATE files SET content_hash = ? WHERE path = ?').run('hash-a2', 'src/a.ts');
  db.close();

  const second = genDesignDb(f.root);
  assert.equal(second.reused, 0, '★ 事实输入变了 ⇒ **一个都不许命中**（不许拿旧字节冒充新投影）');
  assert.equal(second.recomputed, second.paths, `全量重算（recomputed=${second.recomputed} paths=${second.paths}）`);
  // ★ 代价要说实话（卡上读数）：`factsEpoch` 进了签名 ⇒ 它一变，**每份副本自述的 sig 都变了** ⇒ 全量重写。
  //   路径里的 payload 一个字都没改，是"自述"变了 —— 这是这条设计的已知代价（见提案「二阶影响」）。
  assert.equal(second.written, second.paths, `★ epoch 变 ⇒ 每份 //inputs 都变 ⇒ 全量重写（written=${second.written}）`);
});

test('R2c 格式版本变 ⇒ 全量重算（版本也进签名，不只是进 payload）', () => {
  const f = makeProject('r2c');
  genDesignDb(f.root);
  const copy = path.join(f.root, 'design-db', 'a.calls.json');
  const txt = read(copy)!;
  assert.match(txt, /\n {2}"\/\/inputs": "v\d+ sig=[0-9a-f]{64} body=[0-9a-f]{64}",\n/, '副本必须自述输入');
  fs.writeFileSync(copy, txt.replace(/^ {2}"\/\/inputs": "v\d+ /m, '  "//inputs": "v0 '), 'utf8');

  const second = genDesignDb(f.root);
  assert.ok(second.recomputed >= 1, '★ 版本号被改 ⇒ 那一份必须重算（不许"看起来签名在"就放行）');
  assert.match(read(copy)!, new RegExp(`"//inputs": "v${DESIGN_DB_FORMAT_VERSION} sig=`), '重写后版本号回到当前值');

  // ★ 结构层：format 真的进了 sig 的计算（而不只是进了那一行的字面量）
  const common = { designDigest: 'a', factDigest: 'b', factsEpoch: 'c', projectionDigest: 'd' };
  assert.notEqual(
    designDbInputSignature({ ...common, format: 2 }),
    designDbInputSignature({ ...common, format: 3 }),
    'format 必须参与 sig 合成',
  );
  assert.notEqual(
    designDbInputSignature({ ...common, format: 2 }),
    designDbInputSignature({ ...common, format: 2, projectionDigest: 'e' }),
    '映射表 sha 必须参与 sig 合成（Turborepo #14820：映射表也是输入）',
  );
  assert.notEqual(
    designDbInputSignature({ ...common, format: 2 }),
    designDbInputSignature({ ...common, format: 2, factsEpoch: 'zz' }),
    '全库事实 epoch 必须参与 sig 合成（跨文件解析的兜底）',
  );
});

test('R2d 手改产物正文（`//inputs` 原样不动）⇒ 不命中 ⇒ 逐字节写回（逐字节比不许拆）', () => {
  const f = makeProject('r2d');
  genDesignDb(f.root);
  const copy = path.join(f.root, 'design-db', 'b.calls.json');
  const good = read(copy)!;
  fs.writeFileSync(copy, good.replace('"path": "src/b.ts"', '"path": "src/b.ts0"'), 'utf8');

  const second = genDesignDb(f.root);
  assert.equal(second.recomputed, 1, `★ 被手改的那一份必须重算（recomputed=${second.recomputed}）—— "输入没变"不是放行它的理由`);
  assert.ok(second.written >= 1, 'write 模式 ⇒ 必须写回');
  assert.equal(read(copy), good, '★★ 写回后必须**逐字节复原**（这正是不拆逐字节比的理由）');
});

test('R3 check 模式下的手改 ⇒ 报 drift 且**不写盘**（命中路径不许替掉门的判断力）', () => {
  const f = makeProject('r3');
  genDesignDb(f.root); // build-then-check：先建出投影（check 自己不会建目录）
  const copy = path.join(f.root, 'design-db', 'b.calls.json');
  const good = read(copy)!;
  fs.writeFileSync(copy, good.replace('"path": "src/b.ts"', '"path": "src/b.ts0"'), 'utf8');

  const chk = genDesignDb(f.root, { check: true });
  assert.equal(chk.written, 0, 'check 模式恒不写盘');
  assert.equal(chk.drift.length, 1, `★ 手改的那一份必须被点名为 drift（drift=${JSON.stringify(chk.drift)}）`);
  assert.notEqual(read(copy), good, '★ check 模式**不许**顺手把产物修好 —— 那一改会让门永远绿');
});

test('R4 产物形态：摘掉 `//inputs` 后逐字节等于"不含该键的 payload"；键集只多这一个', () => {
  const f = makeProject('r4');
  genDesignDb(f.root);
  const copy = path.join(f.root, 'design-db', 'a.calls.json');
  const txt = read(copy)!;

  const head = readInputHeaderFromText(txt);
  assert.ok(head, '副本必须有 `//inputs` 且形态可解析');
  assert.equal(head!.format, DESIGN_DB_FORMAT_VERSION);
  assert.equal(head!.body, bodyDigestOf(txt), '`body` 必须等于"摘掉该行后的正文"的 sha');
  assert.deepEqual(parseInputHeader(formatInputHeader(head!)), head, '格式化与解析必须互逆');

  const obj = JSON.parse(txt) as Record<string, unknown>;
  const { ['//inputs']: _ignored, ...rest } = obj;
  assert.equal(
    stripInputHeaderLine(txt),
    JSON.stringify(rest, null, 2) + '\n',
    '★★ 摘行规则必须与 `JSON.stringify(x, null, 2) + "\\n"` **逐字节**等价 —— 否则签名替不了逐字节比',
  );
  assert.equal(
    JSON.stringify(Object.keys(obj)),
    JSON.stringify([
      '//',
      '//generated_by',
      '//source',
      '//inputs',
      'path',
      'symbols',
      'imports',
      'calls',
      'requirements',
      'requirements_calls',
    ]),
    '键序必须稳定：`//inputs` 紧跟 `//source`（摘行规则靠"后面还有键"）',
  );
  assert.ok(projectionDigest(import.meta.url), '映射表 sha 必须算得出来（否则签名字段为空）');
  assert.match(String(projectionDigest(import.meta.url)), /^[0-9a-f]{64}$/);
});

test('R5 签名不可用（cache.db 没有 files 表）⇒ fail-closed：一个都不命中，并说出原因', () => {
  const f = makeProject('r5');
  genDesignDb(f.root);
  const db = new DatabaseSync(f.dbFile);
  db.exec('ALTER TABLE files RENAME TO files_hidden');
  db.close();

  const second = genDesignDb(f.root, { check: true });
  assert.equal(second.reused, 0, '★ 算不出来 ≠ 一致 —— 一份都不许命中');
  assert.equal(second.recomputed, second.paths, '全部走原来的全量路径');
  assert.match(second.fingerprintNote, /不可用/, `必须说出原因（实得 ${JSON.stringify(second.fingerprintNote)}）`);

  const db2 = new DatabaseSync(f.dbFile);
  db2.exec('ALTER TABLE files_hidden RENAME TO files');
  db2.close();
  const third = genDesignDb(f.root, { check: true });
  assert.equal(third.reused, third.paths, '恢复之后必须又能命中（不可用是**当时**的状态，不是永久降级）');
});

test.after(() => {
  for (const r of roots) {
    try {
      closeProjectCacheDb(r);
    } catch {
      /* 已关 */
    }
    fs.rmSync(r, { recursive: true, force: true });
  }
});
