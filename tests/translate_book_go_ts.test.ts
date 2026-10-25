/**
 * I3 · 翻译双层（翻译 DSL → 翻译 DB → 翻译代码）单测：
 *
 * ① 翻译 DB 生成器（book.ts 改 Go→TS 正向）：Go 样例（cache.db 夹具）→ 投影断言
 *    —— symbols[].to 与管线同源（tsPath/tsSymbolName）、blocked 四档、judgments（复用
 *    expectations kinds，过 assertValidExpectations）、external_deps 区块（strategy 不倒退）。
 * ② 管线消费：attachBookFacts 注入 + buildHolePrompt / buildBatchFillPrompt 渲染断言。
 * ③ 硬依赖清单区块：buildExternalDeps（strategy 初始空、去重）+ buildUnknowns 不再产 missing_lib。
 *
 * 跑法：node_modules/.bin/tsx --test tests/translate_book_go_ts.test.ts
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'agentio-i3-book-'));
const projRoot = path.join(HOME, 'proj');
fs.mkdirSync(path.join(projRoot, '.agent-io', 'design'), { recursive: true });

const { SCHEMA_SQL } = await import('../src/infrastructure/index/schema.js');
const bookMod = await import('../src/infrastructure/authoring/translate/book.js');
const { rebuildBook, attachBookFacts, loadTranslateBooks } = bookMod;
type TranslateBook = import('../src/infrastructure/authoring/translate/book.js').TranslateBook;
const { buildHolePrompt, buildBatchFillPrompt } = await import('../src/infrastructure/authoring/translate/prompts.js');
const { buildExternalDeps, buildUnknowns } = await import('../src/infrastructure/authoring/translate/receipt.js');
type Receipt = import('../src/infrastructure/authoring/translate/receipt.js').Receipt;
const { assertValidExpectations, EXPECTATION_KINDS } = await import('../src/domain/expectation.js');

/** cache.db 夹具：一个 Go 小项目（src/user.go 无外部依赖；src/legacy.go import github.com/foo/bar） */
function seedCacheDb(): void {
  const db = new DatabaseSync(path.join(projRoot, '.agent-io', 'cache.db'));
  db.exec(SCHEMA_SQL);
  const insFile = db.prepare(
    `INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at, node_count) VALUES ($p, $h, 'go', 10, 1, 1700000000000, 0)`,
  );
  insFile.run({ p: 'src/user.go', h: 'a1' });
  insFile.run({ p: 'src/legacy.go', h: 'a2' });
  const ids = new Map(
    (db.prepare(`SELECT id, path FROM files`).all() as Array<{ id: number; path: string }>).map((r) => [r.path, r.id]),
  );
  const insNode = db.prepare(
    `INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, parent, params, return_type, members, type_params, modifiers, is_closure, updated_at)
     VALUES ($id, $kind, $name, $qn, $fp, 'go', $sl, $el, $parent, $params, $ret, $members, NULL, NULL, 0, 1700000000000)`,
  );
  // 无外部依赖文件的符号（应 pending；Add 带 Timestamp ⇒ 术语命中）
  insNode.run({ id: 'src/user.go#Add', kind: 'function', name: 'Add', qn: 'Add', fp: 'src/user.go', sl: 3, el: 5, parent: null, params: JSON.stringify([{ name: 'a', type: 'int' }, { name: 'b', type: 'int' }]), ret: 'int', members: null });
  insNode.run({ id: 'src/user.go#Stamp', kind: 'function', name: 'Stamp', qn: 'Stamp', fp: 'src/user.go', sl: 7, el: 9, parent: null, params: JSON.stringify([{ name: 't', type: 'Timestamp' }]), ret: 'int', members: null });
  insNode.run({ id: 'src/user.go#User_Greet', kind: 'method', name: 'Greet', qn: 'User.Greet', fp: 'src/user.go', sl: 11, el: 13, parent: 'User', params: JSON.stringify([{ name: 'n', type: 'string' }]), ret: 'string', members: null });
  insNode.run({ id: 'src/user.go#Store', kind: 'type', name: 'Store', qn: 'Store', fp: 'src/user.go', sl: 15, el: 18, parent: null, params: null, ret: null, members: JSON.stringify([{ name: 'items', type: 'map[string]int' }]) });
  // 外部依赖文件的符号：Fetch（LegacyBlob 已定 to:null ⇒ term_null）；Raw（纯内建类型 ⇒ external_dep）
  insNode.run({ id: 'src/legacy.go#Fetch', kind: 'function', name: 'Fetch', qn: 'Fetch', fp: 'src/legacy.go', sl: 3, el: 5, parent: null, params: JSON.stringify([{ name: 'u', type: 'LegacyBlob' }]), ret: 'int', members: null });
  insNode.run({ id: 'src/legacy.go#Raw', kind: 'function', name: 'Raw', qn: 'Raw', fp: 'src/legacy.go', sl: 7, el: 9, parent: null, params: '[]', ret: 'int', members: null });
  const insImp = db.prepare(`INSERT INTO imports (file_id, line, source, kind, type_only) VALUES ($fid, $line, $src, $kind, 0)`);
  insImp.run({ fid: ids.get('src/user.go')!, line: 1, src: 'fmt', kind: 'package' }); // stdlib：首段无 '.'
  insImp.run({ fid: ids.get('src/legacy.go')!, line: 1, src: 'github.com/foo/bar', kind: 'package' }); // 外部：首段含 '.'
  db.close();
}
/** 底册：人写的 types（含一条 to:null）+ 已填 strategy 的 external_deps */
function seedBaseBook(): string {
  const book: TranslateBook = {
    id: 'demo',
    kind: 'translate',
    version: 1,
    feature: 'demo',
    meta: { target_language: 'ts' },
    types: [
      { from: 'Timestamp（毫秒时间戳）', to: 'number (ms)', note: '时间戳统一毫秒' },
      { from: 'LegacyBlob', to: null, note: '结构问题：字段由什么承载待定' },
    ],
    symbols: [],
    shapes: [],
    atoms: [],
    unknowns: [],
    external_deps: [{ from: 'github.com/foo/bar', strategy: 'npm_equiv', note: '人已定策略' }],
  };
  const p = path.join(projRoot, '.agent-io', 'design', 'demo.translate.json');
  fs.writeFileSync(p, JSON.stringify(book, null, 2), 'utf-8');
  return p;
}

before(() => {
  seedCacheDb();
  seedBaseBook();
});

after(() => {
  fs.rmSync(HOME, { recursive: true, force: true });
});

test('翻译 DB 生成：Go 样例 → 投影（to 与管线同源 / pending 与 blocked 四档读数）', () => {
  const bookPath = path.join(projRoot, '.agent-io', 'design', 'demo.translate.json');
  const r = rebuildBook({ projectDir: projRoot, bookPath, expectTargetLanguage: 'ts' });
  const s = r.stats;
  // 6 个源符号：Add/Stamp/User_Greet/Store pending；Fetch(term_null)/Raw(external_dep) blocked
  assert.equal(s.symbols, 6);
  assert.equal(s.pending, 4);
  assert.equal(s.blocked, 2);
  assert.equal(s.blockedByTerm, 0);
  assert.equal(s.blockedByTermNull, 1);
  assert.equal(s.blockedByCollision, 0);
  assert.equal(s.blockedByExternalDep, 1);
  const next = JSON.parse(fs.readFileSync(bookPath, 'utf-8')) as TranslateBook;
  const byFrom = new Map(next.symbols.map((x) => [x.from, x]));
  // to = tsPath（.go→.ts 镜像）+ tsSymbolName（方法 = recv_method；顶层原名）—— 与 go_extractor/pipeline 同源
  assert.equal(byFrom.get('src/user.go#Add')!.to, 'src/user.ts#Add');
  assert.equal(byFrom.get('src/user.go#User_Greet')!.to, 'src/user.ts#User_Greet');
  assert.equal(byFrom.get('src/legacy.go#Raw')!.state, 'blocked');
  assert.match(byFrom.get('src/legacy.go#Raw')!.note!, /外部硬依赖/);
  assert.match(byFrom.get('src/legacy.go#Fetch')!.note!, /术语已定但无 TS 目标/);
  // judgments 只挂 pending 符号
  assert.equal(byFrom.get('src/legacy.go#Raw')!.judgments, undefined);
  assert.ok(byFrom.get('src/user.go#Add')!.judgments!.length > 0);
});

test('judgments 复用 expectations kinds（过 assertValidExpectations）：symbol-exists / signature-matches / source-has 术语命中', () => {
  const bookPath = path.join(projRoot, '.agent-io', 'design', 'demo.translate.json');
  const next = JSON.parse(fs.readFileSync(bookPath, 'utf-8')) as TranslateBook;
  const byFrom = new Map(next.symbols.map((x) => [x.from, x]));
  const add = byFrom.get('src/user.go#Add')!;
  const stamp = byFrom.get('src/user.go#Stamp')!;
  const greet = byFrom.get('src/user.go#User_Greet')!;
  for (const sym of [add, stamp, greet]) assertValidExpectations(sym.judgments!);
  // kind 全部在 EXPECTATION_KINDS 内（不新造 kind）
  for (const j of [...add.judgments!, ...stamp.judgments!, ...greet.judgments!]) {
    assert.ok((EXPECTATION_KINDS as readonly string[]).includes(j.kind), `kind ${j.kind} 应是既有 kind`);
  }
  // ① 对应物存在
  const se = add.judgments!.find((j) => j.kind === 'symbol-exists')! as { path: string; symbol: string };
  assert.equal(se.path, 'src/user.ts');
  assert.equal(se.symbol, 'Add');
  // ② 签名匹配：用管线同一把尺（mapGoType）机械渲染；(int,int)→int
  const sig = add.judgments!.find((j) => j.kind === 'signature-matches')! as { signature: string };
  assert.equal(sig.signature.replace(/\s+/g, ''), 'exportfunctionAdd(a:number,b:number):number');
  // 方法投影 = recv_method 自由函数，但 cache.db method 行不带 receiver 形参 ⇒ 不挂假红签名判据
  assert.equal(greet.judgments!.some((j) => j.kind === 'signature-matches'), false);
  // ③ 术语命中：译出的 TS 必须使用术语表给定的对应物名
  const sh = stamp.judgments!.find((j) => j.kind === 'source-has')! as { path: string; must: string[] };
  assert.deepEqual(sh.must, ['number (ms)']);
  // Add 的类型面全是内建 ⇒ 无术语命中判据
  assert.equal(add.judgments!.some((j) => j.kind === 'source-has'), false);
});

test('硬依赖清单区块（册子侧）：from 面重算、strategy 人的填写不倒退、stdlib 不入账', () => {
  const bookPath = path.join(projRoot, '.agent-io', 'design', 'demo.translate.json');
  rebuildBook({ projectDir: projRoot, bookPath });
  const next = JSON.parse(fs.readFileSync(bookPath, 'utf-8')) as TranslateBook;
  assert.equal(next.external_deps!.length, 1);
  const dep = next.external_deps![0];
  assert.equal(dep.from, 'github.com/foo/bar');
  assert.equal(dep.strategy, 'npm_equiv'); // 人已填 ⇒ 不倒退（初始空由模型填，填了就保留）
  assert.deepEqual(dep.usedBy, ['src/legacy.go']);
});

test('管线消费：attachBookFacts 注入投影事实与术语命中，buildHolePrompt / buildBatchFillPrompt 渲染', async () => {
  const { DEFAULT_CONSTRAINTS } = await import('../src/infrastructure/authoring/translate/unit.js');
  const books = loadTranslateBooks(projRoot);
  assert.equal(books.length, 1);
  const mkUnit = (name: string, params: Array<{ name: string; type: string }>) =>
    ({
      id: name, kind: 'func', dstLang: 'ts', name,
      params, result: 'int', srcSnippet: 'func ...', skeleton: 'export function ...', bodyHole: true, constraints: [...DEFAULT_CONSTRAINTS],
    });
  const units = [mkUnit('Stamp', [{ name: 't', type: 'Timestamp' }]), mkUnit('NoBookSym', [{ name: 'x', type: 'int' }])];
  const n = attachBookFacts(units, books, 'src/user.go');
  assert.equal(n, 1); // NoBookSym 在册上无命中 ⇒ 不注入（不猜）
  assert.ok(units[0].bookFacts!.some((f) => f.startsWith('src/user.go#Stamp → src/user.ts#Stamp')));
  assert.ok(units[0].bookFacts!.some((f) => f.includes('术语 Timestamp → number (ms)')));

  const prompt = buildHolePrompt(units[0] as never);
  assert.match(prompt, /【翻译 DB 投影与术语表（按图索骥，优先照此映射）】/);
  assert.match(prompt, /- src\/user\.go#Stamp → src\/user\.ts#Stamp/);
  assert.match(prompt, /- 术语 Timestamp → number \(ms\)/);
  // 无 bookFacts 的单元不渲染该区块（没册子是常态）
  const bare = mkUnit('Bare', []);
  assert.doesNotMatch(buildHolePrompt(bare as never), /翻译 DB 投影/);

  // 批量路径：同一份数据进批量块
  const batch = buildBatchFillPrompt(
    [{ unit: units[0] as never, skeleton: units[0].skeleton, srcSnippet: units[0].srcSnippet, constraints: units[0].constraints, bookFacts: units[0].bookFacts }],
  );
  assert.match(batch, /【翻译 DB 投影与术语表（按图索骥，优先照此映射）】/);
});

test('硬依赖清单区块（回执侧）：buildExternalDeps 初始空 + 去重；buildUnknowns 不再产 missing_lib', () => {
  const deps = buildExternalDeps(['github.com/foo/bar', 'github.com/foo/bar', 'gitlab.com/x/y']);
  assert.equal(deps.length, 2); // 去重保序
  assert.deepEqual(deps[0], { import: 'github.com/foo/bar', strategy: '' }); // strategy 初始空，由模型填
  assert.deepEqual(deps[1], { import: 'gitlab.com/x/y', strategy: '' });

  // 升格：外部 import 不再进 unknowns（此前是 missing_lib 诊断）
  const unknowns = buildUnknowns({ units: [] });
  assert.equal(unknowns.length, 0);
  // Receipt 形状带 external_deps 区块
  const receipt: Receipt = { known: [], unknowns: [], verification: { status: 'unverified', summary: '', units: [], repo_tests: [], notes: [] }, external_deps: deps };
  assert.equal(receipt.external_deps.length, 2);
});
