/**
 * card-mybatis：SQL/XML 轻量 TS 降级提取器（T-#SQLXML-NATIVE）机器回归。
 *
 * 判据有牙：
 *   · 正例 XML ⇒ namespace + select/insert id 出符号，且每条 signature 带 [ts-fallback]；
 *   · 正例 SQL ⇒ CREATE TABLE 表名出符号；
 *   · 反例 XML 无 id 的 select / SQL 非 CREATE ⇒ 不造符号（不假装精确）；
 *   · parseFileFull 对 .sql/.xml 在 grammar 未装时走降级（parser='ts-fallback'）——
 *     砍掉 kernel 里的 fallback 分支 ⇒ 该文件符号为空 ⇒ 红。
 *
 * touches: src/infrastructure/parse/sql_xml_fallback.ts, src/infrastructure/parse/kernel.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSqlXmlFallback, FALLBACK_PARSER, FALLBACK_SIG_PREFIX } from '../src/infrastructure/parse/sql_xml_fallback.js';
import { parseFileFull } from '../src/infrastructure/parse/kernel.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.example.UserMapper">
  <select id="findById" resultType="int">SELECT 1 FROM t</select>
  <insert id="addUser">INSERT INTO t VALUES(1)</insert>
  <select>SELECT without id</select>
</mapper>`;

test('sqlxml-fallback · ①XML namespace + CRUD id 出符号，来源如实标注', () => {
  const r = parseSqlXmlFallback('M.xml', XML);
  assert.ok(r, 'xml 扩展名命中降级');
  assert.equal(r!.parser, FALLBACK_PARSER, 'ParsedFile 标 parser=ts-fallback');
  const names = r!.symbols.map((s) => s.name);
  assert.ok(names.includes('com.example.UserMapper'), `namespace 出符号，实得 ${names}`);
  assert.ok(names.includes('findById') && names.includes('addUser'), `CRUD id 出符号，实得 ${names}`);
  assert.ok(!names.some((n) => n === ''), '无 id 的 select 不造符号');
  for (const s of r!.symbols) assert.ok(s.signature.startsWith(FALLBACK_SIG_PREFIX), `每条签名标降级来源: ${s.signature}`);
  // statement 的 parent = namespace ⇒ qualified_name 可定位
  const stmt = r!.symbols.find((s) => s.name === 'findById')!;
  assert.equal(stmt.parent, 'com.example.UserMapper');
  assert.equal(stmt.qualified_name, 'com.example.UserMapper.findById');
});

test('sqlxml-fallback · ②SQL CREATE TABLE 表名出符号（去库前缀/反引号）', () => {
  const r = parseSqlXmlFallback('schema.sql', 'CREATE TABLE IF NOT EXISTS `mydb`.`users` (id INT); CREATE TABLE orders(id INT); SELECT 1;');
  assert.ok(r, 'sql 扩展名命中降级');
  const names = r!.symbols.map((s) => s.name);
  assert.deepEqual(names.sort(), ['orders', 'users'], `只出表名，实得 ${names}`);
  for (const s of r!.symbols) assert.ok(s.signature.startsWith(FALLBACK_SIG_PREFIX));
});

test('sqlxml-fallback · ③非 sql/xml 不命中（不吞别的扩展名）', () => {
  assert.equal(parseSqlXmlFallback('a.java', 'class A {}'), null);
  assert.equal(parseSqlXmlFallback('a.json', '{}'), null);
});

test('sqlxml-fallback · ④parseFileFull 在 grammar 未装时走降级（砍 kernel 分支即红）', async () => {
  const rXml = await parseFileFull('M.xml', XML);
  assert.equal(rXml.parser, FALLBACK_PARSER, 'parseFileFull 标降级来源');
  assert.ok(rXml.symbols.some((s) => s.name === 'findById'), 'XML statement 经内核可达');
  const rSql = await parseFileFull('schema.sql', 'CREATE TABLE t(id INT);');
  assert.equal(rSql.parser, FALLBACK_PARSER);
  assert.ok(rSql.symbols.some((s) => s.name === 't'), 'SQL 表名经内核可达');
  // 未注册语言仍静默空（不因本次改动误伤）
  const rOther = await parseFileFull('x.xyzzy', 'whatever');
  assert.deepEqual(rOther.symbols, []);
  assert.equal(rOther.parser, undefined);
});
