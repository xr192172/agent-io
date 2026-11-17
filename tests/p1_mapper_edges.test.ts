/**
 * card-mybatis：mapper_statement 边 + 索引期对账（消费者钉死）机器回归。
 *
 * 判据有牙：
 *   · 正例：XML namespace+statement id ↔ Java 接口同名方法 ⇒ 建边（metadata 带 namespace/id/parser）；
 *   · 反例1：接口少一个方法 ⇒ 该 statement 进 xmlStatementUnmatched、不建边；
 *   · 反例2：XML 少一个 statement ⇒ 该接口方法进 javaMethodUnmatched；
 *   · 幂等：连跑两次不重复建边；
 *   · 砍掉 import_project 里的调用 ⇒ 边消失 + 回执无读数（由端到端夹具覆盖，见回报）。
 *
 * touches: src/infrastructure/analysis/mybatis_mapper_edges.ts, src/infrastructure/graph/import_project.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { reconcileMapperStatements, type MapperReconcileResult } from '../src/infrastructure/analysis/mybatis_mapper_edges.js';

function mkDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE nodes(id TEXT PRIMARY KEY, kind TEXT, name TEXT, qualified_name TEXT, file_path TEXT, signature TEXT, parent TEXT);
    CREATE TABLE edges(id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, target TEXT, kind TEXT, line INTEGER, col INTEGER, metadata TEXT);
  `);
  return db;
}
const ins = (db: DatabaseSync, id: string, kind: string, name: string, qn: string, fp: string, sig: string | null, parent: string | null) =>
  db.prepare('INSERT INTO nodes(id,kind,name,qualified_name,file_path,signature,parent) VALUES(?,?,?,?,?,?,?)').run(id, kind, name, qn, fp, sig, parent);

const XML = 'src/main/resources/mapper/UserMapper.xml';
const JAVA = 'src/main/java/com/x/UserMapper.java';
function seed(db: DatabaseSync, methods: string[], stmts: string[]): void {
  ins(db, `${XML}#com.x.UserMapper`, 'type', 'com.x.UserMapper', 'com.x.UserMapper', XML, '[ts-fallback] namespace com.x.UserMapper', null);
  for (const id of stmts) ins(db, `${XML}#com.x.UserMapper.${id}`, 'method', id, `com.x.UserMapper.${id}`, XML, '[ts-fallback] select', 'com.x.UserMapper');
  ins(db, `${JAVA}#UserMapper`, 'interface', 'UserMapper', 'UserMapper', JAVA, null, null);
  for (const m of methods) ins(db, `${JAVA}#UserMapper.${m}`, 'method', m, `UserMapper.${m}`, JAVA, null, 'UserMapper');
}

test('mapper-edges · ①双向匹配建边 + metadata 如实', () => {
  const db = mkDb();
  seed(db, ['findById', 'addUser'], ['findById', 'addUser']);
  const r = reconcileMapperStatements(db as never);
  assert.equal(r.edges, 2, `建 2 条边，实得 ${r.edges}`);
  assert.equal(r.xmlStatementUnmatched.length, 0);
  assert.equal(r.javaMethodUnmatched.length, 0);
  assert.equal(r.interfaceNotFound.length, 0);
  const rows = db.prepare("SELECT source,target,metadata FROM edges WHERE kind='mapper_statement'").all() as Array<{ source: string; target: string; metadata: string }>;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    const md = JSON.parse(row.metadata);
    assert.equal(md.namespace, 'com.x.UserMapper');
    assert.equal(md.parser, 'ts-fallback');
    assert.equal(md.statement_id, md.method);
  }
  // 幂等
  const r2 = reconcileMapperStatements(db as never);
  assert.equal(r2.edges, 2);
  assert.equal((db.prepare("SELECT count(1) n FROM edges WHERE kind='mapper_statement'").get() as { n: number }).n, 2);
});

test('mapper-edges · ②接口缺方法 ⇒ XML statement unmatched、不建边', () => {
  const db = mkDb();
  seed(db, ['findById'], ['findById', 'findAll']); // XML 多一个 findAll
  const r: MapperReconcileResult = reconcileMapperStatements(db as never);
  assert.equal(r.edges, 1);
  assert.deepEqual(r.xmlStatementUnmatched, ['com.x.UserMapper.findAll']);
});

test('mapper-edges · ③XML 缺 statement ⇒ Java 方法 unmatched', () => {
  const db = mkDb();
  seed(db, ['findById', 'findAll'], ['findById']); // Java 多一个 findAll
  const r = reconcileMapperStatements(db as never);
  assert.equal(r.edges, 1);
  assert.deepEqual(r.javaMethodUnmatched, ['UserMapper.findAll']);
});

test('mapper-edges · ④namespace 找不到接口 ⇒ 如实降级、不假装一致', () => {
  const db = mkDb();
  ins(db, `${XML}#com.x.GhostMapper`, 'type', 'com.x.GhostMapper', 'com.x.GhostMapper', XML, '[ts-fallback] namespace com.x.GhostMapper', null);
  ins(db, `${XML}#com.x.GhostMapper.gone`, 'method', 'gone', 'com.x.GhostMapper.gone', XML, '[ts-fallback] select', 'com.x.GhostMapper');
  const r = reconcileMapperStatements(db as never);
  assert.equal(r.edges, 0);
  assert.deepEqual(r.interfaceNotFound, ['com.x.GhostMapper']);
  assert.deepEqual(r.xmlStatementUnmatched, ['com.x.GhostMapper.gone']);
});
