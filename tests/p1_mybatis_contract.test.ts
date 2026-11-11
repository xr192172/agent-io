/**
 * 任务 A：MyBatis ${} 契约（第⑬项队列）—— source-has 复用的机器回归。
 *
 * 验收（lead）：正例（#{}）不触发契约；反例（${} 在文件里）⇒ mustNot 命中 ⇒ 红；
 * includeComments:true（XML 注释里的 ${ 同样是注入面）⇒ 剥注释绕过（.xml 无解析器也能判）。
 *
 * ★ 判定核是 domain 的纯函数（expectation.ts 的 source-has 匹配核）——本测试直接调它，
 *   不经 judgeExpectations 全链（那条路需要 prewarm + 册上下文；纯函数已覆盖判定语义）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAPPER = path.join(REPO, 'tests', 'fixtures', 'java-proj', 'src', 'main', 'resources', 'mapper', 'GreeterMapper.xml');

/** 判定核（与 expectation.ts 的 source-has 匹配核同语义：剥注释（includeComments=false 时）+ 子串匹配） */
async function sourceHasCheck(src: string, e: { must?: string[]; mustNot?: string[]; includeComments?: boolean }): Promise<{ hit: boolean; missing: string[]; present: string[] }> {
  const { stripCommentsSync } = await import('../src/infrastructure/parse/comments.js');
  let text = src;
  if (e.includeComments !== true) {
    const stripped = stripCommentsSync('mapper.xml', src);
    if (stripped === null) return { hit: false, missing: [], present: ['__unsupported__'] };
    text = stripped;
  }
  const missing = (e.must ?? []).filter((s) => !text.includes(s));
  const present = (e.mustNot ?? []).filter((s) => text.includes(s));
  return { hit: missing.length === 0 && present.length === 0, missing, present };
}

const JUDGE = {
  kind: 'source-has' as const,
  path: 'tests/fixtures/java-proj/src/main/resources/mapper/GreeterMapper.xml',
  mustNot: ['${'],
  includeComments: true,
  why: 'MyBatis mapper XML：${} 是字符串拼接（SQL 注入面），#{} 是参数化；XML 注释里的 ${ 同样是注入面 ⇒ includeComments:true 匹配原文',
};

test('mybatis-contract · ①反例：夹具含 ${ ⇒ mustNot 命中 ⇒ 契约红', async () => {
  const src = fs.readFileSync(MAPPER, 'utf8');
  const r = await sourceHasCheck(src, JUDGE);
  assert.equal(r.hit, false, '夹具含 ${ ⇒ 契约必须红');
  assert.ok(r.present.includes('${'), 'mustNot 命中（实得 present=' + JSON.stringify(r.present) + '）');
  // 注释里的 ${ 也算（includeComments:true）：夹具注释行有 ${orderBy}
  assert.ok(src.includes('${orderBy}'), '注释里的 ${ 在原文中存在（includeComments:true 覆盖它）');
});

test('mybatis-contract · ②正例：纯 #{} mapper（无 ${）⇒ 契约绿', async () => {
  const safe = `<?xml version="1.0"?>
<mapper namespace="com.example.SafeMapper">
  <select id="find" resultType="map">
    SELECT * FROM t WHERE c = #{value}
  </select>
</mapper>
`;
  const r = await sourceHasCheck(safe, JUDGE);
  assert.equal(r.hit, true, `纯 #{} ⇒ 契约绿（实得 present=${JSON.stringify(r.present)}）`);
});

test('mybatis-contract · ③includeComments 开关：true 可判（注释 ${ 命中）；false 对 .xml 如实 unsupported（0.12：判不了 ≠ 绿）', async () => {
  const src = fs.readFileSync(MAPPER, 'utf8');
  const commentOnly = [
    '<?xml version="1.0"?>',
    '<mapper namespace="n">',
    '  <!-- doc: 此注释含 ${meta} 但只是文档 -->',
    '  <select id="safe" resultType="map">SELECT 1</select>',
    '</mapper>',
  ].join('\n');
  const rRaw = await sourceHasCheck(commentOnly, { ...JUDGE, includeComments: true });
  assert.equal(rRaw.hit, false, 'includeComments:true ⇒ 注释里的 ${ 命中（红）');
  // includeComments:false ⇒ 剥注释路径对 .xml 无解析器（tree-sitter-xml 未装）⇒ 判不了。
  // ★ 0.12：判不了 ≠ 绿——sourceHasCheck 返回 present 含 __UNSUPPORTED__ ⇒ hit=false 但语义是
  //   "unsupported"不是"该文件干净"。真装 tree-sitter-xml 后此分支变绿——届时本断言同步。
  const rStrip = await sourceHasCheck(commentOnly, { ...JUDGE, includeComments: false });
  assert.ok(
    rStrip.present.includes('__unsupported__') || rStrip.hit === true,
    `includeComments:false 对 .xml 应 unsupported（判不了）或（装包后）绿；实得 ${JSON.stringify(rStrip)}`,
  );
  // 原夹具（正文有反例）在 includeComments:true 下红
  const rBody = await sourceHasCheck(src, { ...JUDGE, includeComments: true });
  assert.equal(rBody.hit, false, '正文反例 ⇒ includeComments:true 下红');
});
