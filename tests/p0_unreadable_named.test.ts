/**
 * P0-4 + P0-5 · **「这个文件为什么没被读」只有一个判定表**，且**被跳过的必须点名**。
 * 审计 `ea-func-ds-1` §1.1 第 3 条（`.lua` 诊断结论错）+ §2.3 G2（`import_project.skipped` 不点名）。
 *
 * ## 两处事故（都是"同一件事的第二份/缺失的判据"）
 * | # | 现场（审计原文） | 根因 |
 * |---|---|---|
 * | ① | `.lua` 被报成「语言注册表里**没有** .lua 这门口语，内核不认识它」 | `code_health` 的判定写成 `if (u.pkg)`：**在册且 `pkgSpec: null`** 时 `pkg` 也是 `null` ⇒ 与"不在册"被同一个条件吞掉 |
 * | ② | 样本 6 个 `.ts` + `.yaml/.md/.lua` ⇒ 回执 `"files_parsed":6, "skipped":[]` | 走查只交回「可解析但非代码」（`.json/.html/.css`），三种"在册但读不了"的**一个字都不说** |
 *
 * ## 判据（三态/四态各一条夹具 + 点名带 path + 理由）
 * · `classifyUnreadable` 的**每一档**都要有一条真夹具（`.lua`=在册无包 / `.yaml`=在册未装 /
 *   `.zzz`=不在册 / 无后缀=no-ext）；
 * · `.lua` 的**文案里不许出现**「注册表里没有」（这是审计点名的那句错话）；
 * · `import_project.skipped` 必须**逐文件**出现 `unreadable <path> —— <理由>`（3 个文件 = 3 条）；
 * · `code_health` 的 `bounds.skipped` 必须给出**同一批后缀**的同源理由（不许两处各说一套）。
 *
 * ## 消融（两种，都要能红）
 * ① 把 `import_project.ts` 里那句 `skipped.push(\`unreadable …\`)` 删掉 ⇒ 本文件「③ 点名」红（skipped 里 3 条变 0 条）；
 * ② 把 `source_exts.ts#classifyUnreadable` 的 `if (fact.lang === null) return { ...fact, state: 'not-registered' };`
 *    **挪到** `no-package` 判断之后（= 退回 `if (u.pkg)` 那种吞并）⇒ 「② .lua 三态」红（
 *    `.lua` 会被判成 `not-registered`，文案里重新出现「注册表里没有」）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
import { classifyUnreadable, unreadableReason } from '../src/infrastructure/parse/source_exts.js';
import { analyzeHealth } from '../src/infrastructure/analysis/health/index.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';

const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

/** 夹具：6 个 `.ts` + 三种"在册但读不了"（.yaml / .md / .lua）+ 一个"不在册"（.zzz） */
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
for (let i = 0; i < 6; i += 1) {
  fs.writeFileSync(path.join(PROJ, 'src', `m${i}.ts`), `export const v${i} = ${i};\n`, 'utf-8');
}
fs.writeFileSync(path.join(PROJ, 'src', 'broken.ts'), 'export const b = ;\n', 'utf-8');
fs.writeFileSync(path.join(PROJ, 'cfg.yaml'), 'a: 1\n', 'utf-8');
fs.writeFileSync(path.join(PROJ, 'NOTES.md'), '# notes\n', 'utf-8');
fs.writeFileSync(path.join(PROJ, 'legacy.lua'), 'local x = 1\n', 'utf-8');
fs.writeFileSync(path.join(PROJ, 'weird.zzz'), 'nothing\n', 'utf-8');

after(() => rmRf(TMP));

type AnyRec = Record<string, any>;

test('① 判定表：四种"读不了"各一条夹具，且互不吞并', () => {
  // 在册、上游无可用 node 包（审计点名的 `.lua`）
  const lua = classifyUnreadable('.lua');
  assert.equal(lua.state, 'no-package', `.lua 在册且 pkgSpec:null ⇒ 必须是 no-package，实得 ${lua.state}`);
  assert.equal(lua.lang, 'lua', '.lua 必须被认出语言名（证明它**在册**）');
  assert.equal(lua.pkg, null, '.lua 的模块说明符必须是 null（这正是"装包救不了"的判据）');
  // 在册、有包名、本机压根没装（`tree-sitter-powershell` 不在本仓依赖里 ⇒ 换机器也仍是这一档）
  const ps = classifyUnreadable('.ps1');
  assert.equal(ps.state, 'not-installed', `.ps1 在册未装 ⇒ not-installed，实得 ${ps.state}`);
  assert.equal(ps.lang, 'powershell');
  // 在册、包名有、**本机那份过不了真筛子**（.yaml 在本机是这一档；审计把它归"没装"大类）
  //   ⇒ 断言按**大类**写（not-installed ∪ incompatible），否则换台机器就会误红
  const yaml = classifyUnreadable('.yaml');
  assert.ok(
    yaml.state === 'not-installed' || yaml.state === 'incompatible',
    `.yaml 必须是"在册、有包名、本机用不了"这两档之一，实得 ${yaml.state}`,
  );
  assert.equal(yaml.pkg, 'tree-sitter-yaml', '.yaml 必须给出包名（证明它有包、只是读不了）');
  // 不在册
  assert.equal(classifyUnreadable('.zzz').state, 'not-registered', '.zzz 不在册 ⇒ not-registered');
  // 没有后缀（不是"缺语言"）
  assert.equal(classifyUnreadable('').state, 'no-ext', '无后缀 ⇒ no-ext');
  // 文档类（.md 在册）
  const md = classifyUnreadable('.md');
  assert.equal(md.lang, 'markdown', '.md 必须被认出语言名');
  assert.notEqual(md.state, 'not-registered', '.md 在册 ⇒ 绝不许判成 not-registered');
});

test('② .lua 的文案不许再说「注册表里没有」（审计点名的那句错话）', () => {
  const why = unreadableReason('.lua');
  assert.ok(!why.includes('注册表里没有'), `文案仍是错的：${why}`);
  assert.match(why, /pkgSpec/, '必须点名真因（pkgSpec: null ⇒ 上游无可用 node 包）');
  // 反向：真的不在册才说"注册表里没有"
  assert.match(unreadableReason('.zzz'), /注册表里没有/, '不在册那一档才该说"注册表里没有"');
});

test('③ import_project：被跳过的 3 个文件必须逐条点名（path + 理由）', async () => {
  const r = await importProject({ feature: 'p0_unreadable', project_dir: PROJ, include_tests: true } as AnyRec);
  const skipped: string[] = r.skipped ?? [];
  const unreadable = skipped.filter((s) => s.startsWith('unreadable '));
  const named = ['.yaml', '.md', '.lua'];
  for (const ext of named) {
    assert.ok(
      unreadable.some((s) => s.includes(ext)),
      `回执里没有点名 ${ext}（实得 ${JSON.stringify(skipped)}）`,
    );
  }
  // 每条都要带**完整 path**（不是只有后缀）—— 审计要求"能回答我那 3 个文件去哪了"
  for (const s of unreadable) {
    assert.match(s, /unreadable \S+\.(yaml|md|lua) —— /, `条目形状不对（要 path + 理由）：${s}`);
    assert.ok(s.length > 30, `理由太短（等于没给下一步）：${s}`);
  }
  // 源码文件数不受影响：6 个 .ts（broken.ts 会被收，解析失败另计）+ 0 个非源码
  assert.equal(r.files_parsed, 7, `files_parsed 应仍是 7 个 .ts（实得 ${r.files_parsed}）`);
  // ★ 不在册的 .zzz 不该被逐条点名（那是噪音，不是"注册表认识但读不了"）
  assert.ok(!unreadable.some((s) => s.includes('.zzz')), '.zzz 不在册 ⇒ 不该进 unreadable（别把噪音当缺陷）');
});

test('④ code_health 的未读后缀：同一批后缀给同类判定（两处不许各说一套）', async () => {
  const report = (await analyzeHealth(PROJ, {})) as AnyRec;
  // ★ `bounds.skipped` 的统一形状是 `{ path, why, count? }`（`scan_bounds.ts#ScanSkip`），
  //   族级粒度 ⇒ `.yaml` 落在 `**/*.yaml` 上（不是 `ext` 字段 —— 那是旧形状）
  const skipped: Array<{ path: string; why: string; count?: number }> = report.bounds?.skipped ?? [];
  const byExt = new Map<string, { path: string; why: string; count?: number }>();
  for (const s of skipped) {
    const m = /\*(\.[^/]*)$/.exec(String(s.path ?? ''));
    if (m) byExt.set(m[1], s);
  }
  for (const ext of ['.lua', '.yaml']) {
    const row = byExt.get(ext);
    assert.ok(row, `bounds.skipped 里没有 ${ext}（实得 ${JSON.stringify(skipped.map((s) => s.path))}）`);
    assert.ok((row!.count ?? 0) >= 1, `${ext} 的计数必须 ≥1`);
    assert.ok(row!.why.length > 10, `${ext} 的 why 太短`);
  }
  const luaWhy = byExt.get('.lua')!.why;
  assert.ok(!luaWhy.includes('注册表里没有'), `code_health 的 .lua 结论仍是错的：${luaWhy}`);
  assert.ok(!(report.summary as string).includes('.lua×1(不在册)'), 'summary 里 .lua 不许被标成「不在册」');
});
