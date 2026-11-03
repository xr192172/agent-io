/**
 * P0 · 事实权威导航（`@authority` 标记 + 现扫 + `@authority-via` 陈旧校验）
 *
 * 由来：AGENTS.md 0.20 —— 判仓级事实的唯一权威都在**内部函数**上，agent 结构性看不见
 * ⇒ 每次自己拼 SQL / 正则 / 分类逻辑（实测四次，0 次自省发现）⇒ 重造第二处权威。
 * 修法：权威自己带 `@authority` 标记，`capability_map` **每次现扫**（不落第二份清单）。
 *
 * 判据（双向，见 AGENTS.md 0.14）：
 *   ① 同义必命中：合法标记（JSDoc / 行注释 / 带 -via -note）⇒ 都认
 *   ② 异义必不命中：`@authorityX` / 非注释行里的同名串 / 无 `@` 的 authority ⇒ 都不认
 *   ③ 改名不漂：把声明名改掉 ⇒ symbol 跟着变（不是丢条目）
 *   ④ 删即变：删掉标记行 ⇒ 条数 -1（**不是静默少一条**）
 *   ⑤ 不静默：标记悬空（后面没有声明）⇒ problems 有一条，且不进 entries
 *   ⑥ 陈旧校验双向：via 点了不存在的工具 ⇒ 该条判陈旧 + 计数；`internal` **不算**陈旧
 *   ⑦ 真源码自洽：现扫条数 ≥ 11、每条 symbol 在它那个文件里确有声明、via 全部 ∈ TOOL_DEFS ∪ {internal}
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { parseAuthorityMarks, scanAuthorities, viaTokens, isInternalVia, INTERNAL_VIA } = await import(
  '../src/infrastructure/authority/scan_authorities.js'
);
const { renderAuthoritiesText, countStaleAuthorities, staleViasOf, bindAuthorities, resetAuthoritiesForTest, catalogOf } =
  await import('../src/application/meta/registry/capability_map.js');
const { TOOL_DEFS } = await import('../src/application/tool_registry.js');

const marked = (question = '判某个事实', via = '', note = '') => {
  const lines = ['/**', ' * 说明一句。', ' *', ` * @authority ${question}`];
  if (via) lines.push(` * @authority-via ${via}`);
  if (note) lines.push(` * @authority-note ${note}`);
  lines.push(' */', 'export function targetFn(): void {', '  /* body */', '}');
  return lines.join('\n');
};

test('① 同义必命中：JSDoc 三行标记 / 行注释标记 / 只有 @authority 一条 ⇒ 都认', () => {
  const r1 = parseAuthorityMarks(marked('判卡活不活', 'design_line', '口径三源合一'), 'a.ts');
  assert.equal(r1.entries.length, 1);
  assert.equal(r1.entries[0].question, '判卡活不活');
  assert.equal(r1.entries[0].symbol, 'targetFn');
  assert.equal(r1.entries[0].via, 'design_line');
  assert.equal(r1.entries[0].note, '口径三源合一');
  assert.equal(r1.entries[0].file, 'a.ts');
  assert.equal(r1.problems.length, 0);

  // 行注释形态
  const r2 = parseAuthorityMarks('// @authority 哪个目录不算源码\nexport const skipIt = 1;\n', 'b.ts');
  assert.equal(r2.entries.length, 1);
  assert.equal(r2.entries[0].symbol, 'skipIt');
  assert.equal(r2.entries[0].via, INTERNAL_VIA, '缺省工具面 = internal（还没到工具面，属欠账）');

  // CRLF 也要认（只是排版不同）
  const r3 = parseAuthorityMarks(marked().replace(/\n/g, '\r\n'), 'c.ts');
  assert.equal(r3.entries.length, 1, 'CRLF 不许让标记失配');
});

test('② 异义必不命中：@authorityX / 非注释行同名串 / 无 @ 的 authority ⇒ 都不认', () => {
  const bad = [
    '// @authorityX 这不是标记\n', // 标签名不完整
    'const s = "@authority 字符串里的不算";\n', // 非注释行
    '// 这里提到 authority 但没有 @\n', // 没有 @
    '/**\n * @authorities 复数不算\n */\n', // 复数
  ].join('');
  const r = parseAuthorityMarks(bad, 'x.ts');
  assert.equal(r.entries.length, 0, '异义形态一律不许命中（否则导航里会混进假权威）');
});

test('③ 改名不漂：声明名改掉 ⇒ symbol 跟着变，条目仍在', () => {
  const a = parseAuthorityMarks(marked('判某个事实'), 'a.ts');
  const b = parseAuthorityMarks(marked('判某个事实').replace('targetFn', 'renamedFn'), 'a.ts');
  assert.equal(a.entries.length, 1);
  assert.equal(b.entries.length, 1, '改名不许把条目弄丢');
  assert.equal(a.entries[0].symbol, 'targetFn');
  assert.equal(b.entries[0].symbol, 'renamedFn', '标记描述的是"它之后第一条声明" ⇒ 改名自动跟随');
});

test('④ 删即变：删掉标记行 ⇒ 条数 -1（显著变化，不是静默少一条）', () => {
  const withMark = parseAuthorityMarks(marked(), 'a.ts').entries.length;
  const without = parseAuthorityMarks(marked().replace(/ \* @authority .*\n/, ''), 'a.ts').entries.length;
  assert.equal(withMark, 1);
  assert.equal(without, 0);
});

test('⑤ 不静默：标记悬空（后面没有声明）⇒ problems 有一条且不进 entries', () => {
  const src = '/**\n * @authority 悬空的标记\n */\n// 这后面没有声明\nconst x = 1;\n'.replace('const x = 1;', '');
  const r = parseAuthorityMarks(src, 'ghost.ts');
  assert.equal(r.entries.length, 0);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].file, 'ghost.ts');
  assert.match(r.problems[0].reason, /悬空|没有声明/);
});

test('⑥ 陈旧校验双向：via 点了不存在的工具 ⇒ 判陈旧并计数；internal 不算陈旧', () => {
  const catalog = catalogOf(TOOL_DEFS);
  const good = { question: 'q', symbol: 's', file: 'f.ts', line: 1, decl_line: 2, via: 'capability_map' };
  const internal = { ...good, via: 'internal' };
  const dead = { ...good, via: 'remove_dead_imports' }; // ★ 已被 refactor_pipeline 吸收（历史真实案例）
  const names = new Set(catalog.map((t) => t.name));

  assert.deepEqual(staleViasOf(good, names), []);
  assert.deepEqual(staleViasOf(internal, names), [], 'internal 不是工具名，但它是**保留词**，不算陈旧');
  assert.deepEqual(staleViasOf(dead, names), ['remove_dead_imports']);
  assert.equal(countStaleAuthorities([good, internal, dead], catalog), 1);

  bindAuthorities([good, internal, dead], '');
  try {
    const text = renderAuthoritiesText([good, internal, dead], catalog);
    assert.match(text, /3 条 @authority 标记/, '表头必须给条数（统计型输出带分母）');
    assert.match(text, /⚠ 1 条陈旧/, '陈旧必须**计数**（不是软提示）');
    assert.match(text, /⚠ 陈旧 remove_dead_imports/, '陈旧条目本身要显眼标注');
    assert.match(text, /仍 internal 1/);
  } finally {
    resetAuthoritiesForTest();
  }
});

test('⑥b 没扫 / 扫到 0 条 / 有内容 是三个不同的态（0.12 不许合并）', () => {
  const catalog = catalogOf(TOOL_DEFS);
  bindAuthorities(null, '源码根不可达：/nope');
  try {
    const t = renderAuthoritiesText(null, catalog);
    assert.match(t, /没扫|不可达/, 'null 必须说"没看"，不许渲染成"没有权威"');
  } finally {
    resetAuthoritiesForTest();
  }
  assert.match(renderAuthoritiesText([], catalog), /0 条/, '扫到 0 条要单独说"一条都没有"');
});

test('⑦ 真源码自洽：现扫 ≥11 条 · 每条 symbol 在它那个文件里确有声明 · via 全绿', () => {
  const scan = scanAuthorities();
  assert.ok(!scan.error, `现扫不许失败：${scan.error ?? ''}`);
  assert.ok(scan.files_scanned > 100, `必须给出分母（扫过多少个源文件），实测 ${scan.files_scanned}`);
  assert.ok(
    scan.entries.length >= 11,
    `本仓至少要标 11 个权威（实测 ${scan.entries.length} 条）—— 删/改名一个权威会让条数下降，这条会红`,
  );
  assert.deepEqual(scan.problems, [], '不许有悬空标记');
  const catalog = catalogOf(TOOL_DEFS);
  const names = new Set(catalog.map((t) => t.name));
  for (const e of scan.entries) {
    const abs = path.resolve(e.file); // 输入是"现扫产出的相对路径"，锚 cwd（本仓测试都以仓根为 cwd）
    assert.ok(fs.existsSync(abs), `标记指的文件存在：${e.file}`);
    const src = fs.readFileSync(abs, 'utf-8');
    const declRe = new RegExp(`(function|const|class|interface|type|let|enum)\\s+${e.symbol}\\b`);
    assert.match(src, declRe, `${e.file} 里必须真有 ${e.symbol}（标记不许指向不存在的符号）`);
    assert.deepEqual(staleViasOf(e, names), [], `${e.symbol} 的 @authority-via 点了不存在的工具`);
  }
  // 至少这两个必须是"有工具面"的（否则这段等于没接到工具面上）
  const bySym = new Map(scan.entries.map((e) => [e.symbol, e]));
  assert.ok(!isInternalVia(bySym.get('detectDeadImports')?.via), 'detectDeadImports 必须点名工具面（refactor_pipeline）');
  assert.ok(!isInternalVia(bySym.get('cardLivesOf')?.via), 'cardLivesOf 必须点名工具面（design_line）');
});

test('⑧ 围栏里的不算：注释里用 \`\`\` 围起来的是格式示例（双向：围栏外仍命中）', () => {
  // ★ 这条不是洁癖：本仓库的模块头就要"演示怎么写标记"，而演示写法本身会被解析成一条假权威
  //   （实测：scan_authorities.ts 头注最初就把 AuthorityEntry 变成了一条 via 指向不存在工具的权威）。
  const src = [
    '/**',
    ' * \`\`\`',
    ' * @authority 示例：判某事实',
    ' * @authority-via 不存在的工具',
    ' * \`\`\`',
    ' * @authority 真标记',
    ' */',
    'export const realFn = 1;',
  ].join('\n');
  const r = parseAuthorityMarks(src, 'f.ts');
  assert.equal(r.entries.length, 1, '围栏内的示例不许变成权威');
  assert.equal(r.entries[0].question, '真标记', '围栏外的那条仍要命中');
  assert.equal(r.entries[0].symbol, 'realFn');
  assert.equal(r.entries[0].via, INTERNAL_VIA);
});
