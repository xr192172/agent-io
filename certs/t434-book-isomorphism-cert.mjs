#!/usr/bin/env node
/**
 * ★★★ cert T434 —— **翻译册的同构不变量**：*空人工内容 ⇒ 册子 ≡ 实际侧*（2026-10-28）
 *
 * ## 这条不变量是谁提的、为什么要证
 * 用户原话：「设计侧现在如果没有设计内容的话应该是**完全等价实际侧**吧，所以翻译侧也要这样。」
 * —— 这是一条**可判定的不变量**，不是口号：
 *   把一个 feature 的册子清空人工内容（`types` / `atoms` / `unknowns` 全空）后重算，
 *   册子必须与实际侧（`cache.db` 的 go 子集）**一个字段、一条边都不差**。
 *
 * ## 改之前的实测缺口（这就是为什么要有这张证）
 * | | 实际侧 `cache.db` | 改前册子 |
 * |---|---|---|
 * | nodes 列 | **21** | 只读 **11** ⇒ 丢 `signature` / `docstring` / `qualified_name` / `end_line` / `language` … |
 * | 边 | `call:7428` · `type_ref:5349` · `import:1559` | **完全不碰 `edges` 表** ⇒ call / type_ref 一条不进册 |
 * ★ 而且漏得**静默**：册子没有任何对账（连 `stage_registry` 都没登记）。
 *
 * ## 判据（每条亲手跑 · **冻结夹具**，避免项目级读数在动）
 *   ① **符号覆盖**：册子符号数 == 实际侧 go 符号数（同口径）；
 *   ② **签名逐字**：每个签名非空的源节点，册子 `sig` **逐字相等**（这是"权威在 signature"的落点）；
 *   ③ **文档逐字**：每个 `docstring` 非空者，册子 `doc` 逐字相等（TS 注释的唯一来源）；
 *   ④ **边覆盖**：册子 `refs` 总数 == 实际侧 go 节点发出的 `call`+`type_ref` 边数；
 *   ⑤ **列覆盖静态守卫**：`book.ts` 的 SQL 列清单必须含 `signature` / `docstring` / `qualified_name` / `end_line` / `language`
 *      （否则以后有人删列，本证会红）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 夹具只有 4 个符号 / 5 条边 —— **规模不足以**证大仓（agent-memory 51 模块）上的行为；
 *   · **[未核]** 内部符号（小写、非 activeFiles）的覆盖：册子按设计**只收 activeFiles 的内部符号** ⇒ 该口径下不是 100%；
 *   · 只覆盖 `call` / `type_ref`；`import` 边走 `imports` 表（→ `external_deps`），未纳入本证比对。
 *
 * ## 用法
 *   node certs/t434-book-isomorphism-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const T = (n) => TOOL_DEFS.find((t) => t.name === n);
const unwrap = (r) => {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  return { msg: (i > 0 ? t.slice(0, i) : t).trim(), data: i > 0 ? JSON.parse(t.slice(i + 10).trim()) : undefined };
};

// ── 冻结夹具：泛型 / 函数类型 / doc 注释都带上 ──────────
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'triso-'));
const FEAT = 'iso';
fs.writeFileSync(
  path.join(proj, 'store.go'),
  `package main

// Store 是记忆存储。
type Store struct {
	items map[string]Item
}

// Item 一条记录。
type Item struct {
	Key string
	N   int
}

// Put 写入。
func (s *Store) Put(k string, it Item) error {
	s.items[k] = it
	return nil
}

// Load 读取（带回调）。
func (s *Store) Load(k string, fn func(pattern string, brain string) bool) (Item, error) {
	return s.items[k], nil
}
`,
);
fs.mkdirSync(path.join(proj, '.agent-io', 'design'), { recursive: true });

// ① 建实际侧（cache.db）
await T('import_project').handler({ project_dir: proj, feature: FEAT });

// ② 写一份"**空人工内容**"的底册（types / atoms / unknowns 全空）
const bookPath = path.join(proj, '.agent-io', 'design', `${FEAT}.translate.json`);
fs.writeFileSync(
  bookPath,
  JSON.stringify(
    { schema: 'translate_book/1', meta: { target_language: 'ts' }, types: [], atoms: [], symbols: [], shapes: [], unknowns: [], external_deps: [] },
    null,
    2,
  ),
);

// ③ 重算册子
const bookRes = unwrap(await T('translate').handler({ book: true, project_dir: proj, feature: FEAT, dry_run: false }));
chk(/已写回/.test(bookRes.msg), '① 册子在**空人工内容**下能重算并写回', bookRes.msg.split('\n')[0]?.slice(0, 150));

// ④ 对比实际侧
const db = new DatabaseSync(path.join(proj, '.agent-io', 'cache.db'), { readOnly: true });
const goNodes = db
  .prepare("select id, signature, docstring from nodes where language='go' and kind in ('function','method','type','struct','interface')")
  .all();
const goEdges = db
  .prepare("select count(*) c from edges e join nodes n on n.id=e.source where n.language='go' and e.kind in ('call','type_ref')")
  .get().c;
const book = JSON.parse(fs.readFileSync(bookPath, 'utf8'));
const syms = (book.symbols ?? []).filter((s) => s.from);

// ① 符号覆盖
chk(syms.length === goNodes.length, '② **符号覆盖**：册子符号数 == 实际侧 go 符号数', `册子 ${syms.length} / 实际 ${goNodes.length}`);

// ② 签名逐字
const withSig = goNodes.filter((n) => n.signature);
const sigOk = withSig.filter((n) => syms.find((s) => s.from === n.id)?.sig === n.signature);
chk(withSig.length > 0 && sigOk.length === withSig.length, '③ **signature 逐字相等**（权威在原文，不在拼出来的 params）', `${sigOk.length}/${withSig.length}`);

// ③ 文档逐字
const withDoc = goNodes.filter((n) => n.docstring);
const docOk = withDoc.filter((n) => syms.find((s) => s.from === n.id)?.doc === n.docstring);
chk(withDoc.length > 0 && docOk.length === withDoc.length, '④ **docstring 逐字相等**（TS 注释的唯一来源）', `${docOk.length}/${withDoc.length}`);

// ④ 边覆盖
const refs = syms.reduce((a, s) => a + (s.refs?.length ?? 0), 0);
chk(refs === goEdges, '⑤ **引用边覆盖**：册子 refs 总数 == 实际侧 go 的 call+type_ref 边数', `册子 ${refs} / 实际 ${goEdges}`);

// ⑤ 静态守卫：列清单不许再瘦
const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/book.ts'), 'utf8');
const colsLine = src.split('\n').find((l) => l.includes('const cols =')) ?? '';
const need = ['signature', 'docstring', 'qualified_name', 'end_line', 'language'];
const missing = need.filter((c) => !colsLine.includes(c));
chk(missing.length === 0, '⑥ **静态守卫**：SQL 列清单含 signature / docstring / qualified_name / end_line / language', missing.length ? `缺：${missing.join(', ')}` : '5/5 齐');
chk(/FROM edges e JOIN nodes n/.test(src), '⑥-b 册子**确实读 edges 表**（call / type_ref 不再是盲区）');

console.log(`\n═══ T434 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
