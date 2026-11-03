// touches: src/infrastructure/index/db.ts, src/infrastructure/index/schema.ts
/**
 * 迁移**改名/删表之前**必须丢掉依赖这些基表的视图（AGENTS-RULES 0.12 / 0.18）。
 *
 * ## 不变量（这是要守住的东西，不是某一版的复盘故事）
 * SQLite ≥3.25 的 `ALTER TABLE x RENAME TO x_v15` 会**改写引用 x 的视图 SQL**（指到 `x_v15`）；
 * 随后 `SCHEMA_SQL` 的 `CREATE VIEW **IF NOT EXISTS**` 见视图已存在 ⇒ **跳过**；再
 * `DROP TABLE x_v15` **不检查视图依赖** ⇒ 视图**悬空**，只在读时报 `no such table: main.x_v15`。
 * ⇒ 结论：DROP VIEW 必须在**第一句 ALTER 之前**（丢了之后 `CREATE VIEW` 才会真的建出指向新表的视图）。
 *
 * ## ★★ 夹具身份（诚实标注 —— 它不是「v15 的历史形状」）
 * · **表 = 真的**：`tests/fixtures/schema_v15_28eba7f8.sql` 是 schema v15 的 DDL **原文**，
 *   取自 git `28eba7f8^` 的 `src/infrastructure/index/schema.ts`（那版 `SCHEMA_VERSION = 15`），逐字未改。
 * · ★ **v15 那版没有视图**，这是真的：`git grep -n "CREATE VIEW" 28eba7f8^ -- src scripts tests` ⇒ 0 命中；
 *   4 个视图是 v16 那一笔（`28eba7f8`）**自己**带进来的 ⇒ 「v15 → v16」本身**不是**今天可达的中招路径。
 * · **视图 = 植入的**：本用例自己 `PLANTED_VIEWS`。它代表的是
 *   **「v16+ 的库（现役每个 cache.db 都有这 4 个视图）再经历一次改名/删表迁移」**
 *   ⇒ **预演未来**，不是伪造过去（"未来"今天可证：现役库真有这 4 个视图）。
 *
 * ## 用例（每条都是"改前红 / 改后绿"的鉴别器）
 *   ① 植入视图 + git 原文 v15 表 ⇒ 迁移 ⇒ 每个视图可查、**指向新表**、读得到种子行、行数不变
 *      改前读数：4 个视图全部 `no such table: main.<表>_v15`，而 `sqlite_master` 里视图仍在（静默悬空）
 *   ② 全新库 ⇒ 4 个视图可查；重复打开（视图已在、不需迁移）也不因 `DROP VIEW IF EXISTS` 报错
 *   ③ 视图清单只有一个住处：本用例**从 `SCHEMA_SQL` 现算**视图名，不许出现第二份清单
 *      （★ 消融 ③：迁移侧把"从 SCHEMA_SQL 派生"换成写死的 4 个名字 ⇒ 加第 5 个视图时 ① 会漏掉它；
 *        这条用例同时守住"现在真的有 4 个、名字是这 4 个"，防止 SCHEMA_SQL 被悄悄改空后 ① 变成空跑）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { openDb } from '../src/infrastructure/index/db.js';
import { SCHEMA_SQL } from '../src/infrastructure/index/schema.js';
import { rmRf } from './helpers/i1_fixture.js';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'schema_v15_28eba7f8.sql');

/**
 * `SCHEMA_SQL` 声明的视图名 —— 本用例**自己**从 DDL 文本现算（不 import 迁移侧那份，
 * 也不抄第二份清单）：迁移侧若把"派生"换成写死清单，新增的第 5 个视图就会从这里露出来。
 */
function declaredViews(): string[] {
  return [...SCHEMA_SQL.matchAll(/CREATE\s+VIEW\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/gi)].map((m) => m[1]);
}

/** v15 形状下的等价视图（基表自己就有 file_path，不需要 JOIN files）——**植入的**，见头注 */
const PLANTED_VIEWS = `
CREATE VIEW v_identifiers AS SELECT i.file_path, i.name, i.kind, i.line, i.col, i.start_index, i.end_index FROM identifiers i;
CREATE VIEW v_imports AS SELECT i.file_path, i.line, i.source, i.kind, i.type_only, i.bindings, i.start_index, i.end_index FROM imports i;
CREATE VIEW v_unresolved_refs AS SELECT u.id, u.from_node_id, u.reference_name, u.reference_kind, u.line, u.col, u.candidates, u.file_path, u.language, u.status, u.name_tail FROM unresolved_refs u;
CREATE VIEW v_symbol_diffs AS SELECT s.file_path, s.from_hash, s.to_hash, s.added, s.removed, s.changed, s.norm_from, s.norm_to, s.updated_at FROM symbol_diffs s;
`;

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-migviews-'));
}

/** 用 git 原文的 v15 DDL 建库 + 植入视图 + 每张表一行种子；返回库路径 */
function buildV15WithViews(dir: string): string {
  const dbPath = path.join(dir, 'cache.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(fs.readFileSync(FIXTURE, 'utf8'));
  const plantViews = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'view'").get() as { c: number };
  assert.equal(plantViews.c, 0, 'v15 原文 DDL 不该带视图（带了说明 fixture 被改过）');
  db.exec(PLANTED_VIEWS);
  db.exec(`INSERT INTO files(path, content_hash, language, size, modified_at, indexed_at, node_count, errors, norm_hash)
           VALUES ('src/a.ts', 'h1', 'typescript', 10, 1, 1, 1, NULL, 'n1')`);
  db.exec(`INSERT INTO nodes(id, kind, name, qualified_name, file_path, language, start_line, end_line, type_params, modifiers, updated_at)
           VALUES ('n1', 'function', 'a', 'a', 'src/a.ts', 'typescript', 1, 3, '[]', '[]', 1)`);
  db.exec(`INSERT INTO identifiers(file_path, name, kind, line, col, start_index, end_index)
           VALUES ('src/a.ts', 'a', 'identifier', 1, 0, 0, 1)`);
  db.exec(`INSERT INTO imports(file_path, line, source, kind, type_only, bindings, start_index, end_index)
           VALUES ('src/a.ts', 1, './b', 'relative', 0, '["b"]', 0, 18)`);
  db.exec(`INSERT INTO unresolved_refs(from_node_id, reference_name, reference_kind, line, col, candidates, file_path, language, status, name_tail)
           VALUES ('n1', 'b', 'call', 2, 1, NULL, 'src/a.ts', 'typescript', 'pending', 'b')`);
  db.exec(`INSERT INTO symbol_diffs(file_path, from_hash, to_hash, added, removed, changed, norm_from, norm_to, updated_at)
           VALUES ('src/a.ts', 'a', 'b', '[]', '[]', '[]', 'x', 'y', 1)`);
  db.exec(`INSERT INTO schema_versions(version, applied_at, description) VALUES (15, 1, 'v15 原文 DDL + 植入视图')`);
  db.close();
  return dbPath;
}

function viewSql(db: DatabaseSync, name: string): string {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?').get('view', name) as
    | { sql: string }
    | undefined;
  assert.ok(row, `迁移后 sqlite_master 里**没有**视图 ${name} —— 视图连建都没建（不是"悬空"是"丢失"）`);
  return row.sql;
}

test('① 改名/删表迁移后 · 4 个视图全部可查且**指向新表**（改前：4 个视图全部悬空，读时报 no such table: main.<表>_v15）', () => {
  const dir = makeTempDir();
  try {
    const dbPath = buildV15WithViews(dir);
    // 真跑迁移（openDb 的形状对齐）——不是复刻"迁移四步"
    openDb(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      const hasId = (db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>).some((c) => c.name === 'id');
      assert.ok(hasId, '迁移没有真的发生（files 仍无 id 列）⇒ 本用例没测到迁移路径');

      for (const view of declaredViews()) {
        // ① 可查（改前这里抛 no such table: main.<表>_v15）
        let rows: unknown[];
        try {
          rows = db.prepare(`SELECT * FROM ${view}`).all() as unknown[];
        } catch (e) {
          assert.fail(
            `迁移后读视图 ${view} 失败：${(e as Error).message} —— ` +
              `说明视图被改名迁移改写成了指向已删除的 <表>_v15（DROP VIEW 没在 ALTER 之前）`,
          );
        }
        // ② 指向新表（SQL 里不许出现 _v15）
        const sql = viewSql(db, view);
        assert.doesNotMatch(sql, /_v15\b/, `视图 ${view} 仍指向临时表：${sql}`);
        assert.match(sql, /\bfiles\b/, `视图 ${view} 必须 JOIN files（file_id → path 的还原就是它）：${sql}`);
        // ③ 读得到种子行（不只是"能编译"，是真的接在新表上）
        assert.equal(rows.length, 1, `视图 ${view} 应读到 1 行种子（拿到 ${rows.length}）⇒ 视图没接上新表`);
      }

      // ④ 护栏不许吞数据
      const n = (t: string): number => (db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
      assert.deepEqual(
        {
          files: n('files'),
          identifiers: n('identifiers'),
          imports: n('imports'),
          unresolved_refs: n('unresolved_refs'),
          symbol_diffs: n('symbol_diffs'),
        },
        { files: 1, identifiers: 1, imports: 1, unresolved_refs: 1, symbol_diffs: 1 },
        '迁移丢行（DROP VIEW 不该动数据）',
      );
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0, '迁移后不许有孤儿行');
    } finally {
      db.close();
    }
  } finally {
    rmRf(dir);
  }
});

test('② 全新库：4 个视图可查，重复打开也不报错（DROP VIEW IF EXISTS 不把建库弄红）', () => {
  const dir = makeTempDir();
  try {
    const dbPath = path.join(dir, 'cache.db');
    openDb(dbPath);
    openDb(dbPath); // 第二次：视图已在、schema 已是最新 ⇒ 一条都不许炸
    const db = new DatabaseSync(dbPath);
    try {
      for (const view of declaredViews()) {
        const rows = db.prepare(`SELECT * FROM ${view} LIMIT 0`).all() as unknown[];
        assert.equal(rows.length, 0, `${view} 在全新库上不可查`);
        assert.doesNotMatch(viewSql(db, view), /_v15\b/, `${view} 不该指向 _v15`);
      }
    } finally {
      db.close();
    }
  } finally {
    rmRf(dir);
  }
});

test('③ 视图清单只有一个住处（SCHEMA_SQL）：派生出的名字数 = 声明数，且现役就是这 4 个', () => {
  const declared = declaredViews();
  assert.ok(declared.length > 0, 'SCHEMA_SQL 里应当至少有一个 CREATE VIEW（没有 ⇒ ①② 变成空跑，失去判别力）');
  const total = (SCHEMA_SQL.match(/CREATE\s+VIEW/gi) ?? []).length;
  assert.equal(
    total,
    declared.length,
    `SCHEMA_SQL 里有 ${total} 处 CREATE VIEW，只认出 ${declared.length} 个名字 ⇒ 有视图会在迁移前漏 DROP`,
  );
  // 现役就是这 4 个（钉住"① 真的覆盖到了 4 个视图"，而不是"循环了 0 次也算过"）
  assert.deepEqual([...declared].sort(), ['v_identifiers', 'v_imports', 'v_symbol_diffs', 'v_unresolved_refs']);
});
