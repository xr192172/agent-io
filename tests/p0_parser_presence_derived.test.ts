/**
 * P0-1 · **能力矩阵必须由 probe 实测派生**，预热读数必须**单一单位** —— 审计 `ea-func-ds-1` §1.1 ①② 的落点。
 *
 * ## 它钉的是哪两处「自述 ≠ 实测」（审计原文，可复算）
 * ① `capability_audit` 的 `ast_parse_skeleton` 对**全部 55 门**打 🟢AST 全量 ——
 *    因为登记写的是 `default: 'full_ast'`，而**它从不读 probe**。同一台机器上
 *    `probe.isLanguageInstalled` 实测只有 **33 门**能载入（`lua`/`erlang`/`yaml`/`markdown`… 全绿）。
 *    ⇒ 那张矩阵是**默认值矩阵**，不是**实测矩阵**；而它的名字与那排 🟢 读起来就是"我们能做"。
 * ② 预热那行 `48 个解析器就绪 ★ 另有 24 门语言【注册了但没装】` —— **两个单位混在一句**
 *    （前半数 **ext**、后半数**语言**）⇒ `51+22≠55`，对不上 README 的 33/55。
 *
 * ## 判据（可判、可消融）
 * · **恒等式**：`可解析 + 缺 = 注册名册`（`measureParserPresence` 的分子分母必须自己闭合）；
 * · **派生**：`parserBound` 的能力档位 = **声明上限 ∩ 实测** ——
 *   `lua`（在册无包）⇒ 🔴未实现、`yaml`（在册未装）⇒ 🟡AST 部分、`typescript`（已装）⇒ 🟢原档；
 * · **同源**：`docs/FACTS.json` 的 `rosterCount` / `installedCount` 与本文件算出的读数**逐字相等**
 *   （README「诚实版」那两行就是它回写的 ⇒ 矩阵与 README 不许各算一套）。
 *
 * ## 消融（真跑读数，见交付书 §验证）
 * 把 `capability_matrix.ts#levelFor` 里 `if (!c.parserBound || !probe) return declared;` 改成
 * `if (true) return declared;`（= 退回"只读声明"）⇒ 用例 `② 派生` 三条一起红；
 * 把 `register_capabilities.ts` 的 `parserBound: true` 删掉 ⇒ 同三条红（两条路各自承重）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { LANGUAGES } from '../src/infrastructure/parse/languages.js';
import { probeInstalledLanguages } from '../src/infrastructure/parse/probe.js';
import {
  formatParserRatio,
  measureParserPresence,
  parserRatio,
  parserSupportProbe,
} from '../src/infrastructure/parse/parser_presence.js';
import {
  diagnoseCapabilities,
  getCapability,
  levelFor,
} from '../src/infrastructure/analysis/capability/capability_matrix.js';
import '../src/infrastructure/analysis/capability/register_capabilities.js';

test('① 恒等式：可解析 + 缺 = 注册名册（预热那行的两个单位归一到这里）', () => {
  const p = measureParserPresence();
  const r = parserRatio(p);
  assert.equal(p.registered.length, LANGUAGES.length, '分母必须是注册名册');
  assert.equal(
    r.loadable + r.missing,
    r.registered,
    `恒等式破了：可解析 ${r.loadable} + 缺 ${r.missing} ≠ 名册 ${r.registered}`,
  );
  assert.equal(
    r.missing,
    r.byReason['not-installed'] + r.byReason['upstream-no-package'] + r.byReason['load-failed'],
    '三档原因之和必须等于缺额（不许有"说不清为什么"的语言）',
  );
  // 读数必须是**单一单位**的一句话（前半是"门语言"，后半也是），且带分母
  const line = formatParserRatio(p);
  assert.match(line, /^可解析语言 \d+\/\d+/, `读数单位必须是语言口径：${line}`);
  assert.ok(line.includes(`/${LANGUAGES.length}`), '分母必须是名册总数');
});

test('② 派生：档位 = 声明上限 ∩ probe 实测（三条方向都要有）', () => {
  const probe = parserSupportProbe(measureParserPresence());
  const decl = getCapability('ast_parse_skeleton');
  assert.ok(decl, 'ast_parse_skeleton 必须已登记');
  assert.equal(decl!.parserBound, true, '本能力必须声明"由解析器实测派生"');
  // 已装 ⇒ 保持声明档（🟢AST 全量）
  assert.equal(levelFor(decl!, 'typescript', probe), 'full_ast', 'typescript 已装 ⇒ 不该被降级');
  // 在册但本机没装 ⇒ 🟡AST 部分（补包就能读）
  assert.equal(levelFor(decl!, 'yaml', probe), 'partial_ast', 'yaml 在册未装 ⇒ 必须降到 AST 部分');
  // 在册但上游无可用 node 包 ⇒ 🔴未实现（装什么都救不了）
  assert.equal(levelFor(decl!, 'lua', probe), 'unimplemented', 'lua 在册无包 ⇒ 必须是未实现');
  // 不给 probe ⇒ 退回纯声明（旧行为；这是"兼容"不是"默认"）
  assert.equal(levelFor(decl!, 'lua'), 'full_ast', '不给实测口时保持纯声明（调用方必须显式传 probe）');

  // 整行看一遍：矩阵里 lua 那格不再可能是 🟢
  const rows = diagnoseCapabilities(['typescript', 'yaml', 'lua'], probe);
  const row = rows.find((x) => x.decl.id === 'ast_parse_skeleton')!;
  assert.equal(row.probeApplied, true, '这一行必须标"已与实测求交"');
  const cell = (lang: string) => row.cells.find((c) => c.lang === lang)!;
  assert.equal(cell('lua').level, 'unimplemented');
  assert.match(String(cell('lua').note ?? ''), /实测降级/, '降级的格子必须写明声明值 → 实测值');
  assert.equal(cell('typescript').note, undefined, '没降级的格子不该刷一句解释');
});

test('③ 消融（进程内）：把 typescript 判成"加载失败" ⇒ 矩阵该门必须当场降级', () => {
  // ★ 不卸真包（那会污染本机 node_modules），而是走 `measureParserPresence` 的 loadFailed 口 ——
  //   它正是预热实测用的那条路（`prewarmKernel` 传的就是它）。
  const p = measureParserPresence(LANGUAGES, ['typescript']);
  const probe = parserSupportProbe(p);
  const decl = getCapability('ast_parse_skeleton')!;
  assert.equal(levelFor(decl, 'typescript', probe), 'partial_ast', '载入失败 ⇒ 必须从 🟢 掉下来');
  const r = parserRatio(p);
  assert.equal(r.loadable + r.missing, r.registered, '消融后恒等式仍须成立');
  assert.equal(r.byReason['load-failed'], 1, '载入失败必须单独计一档（不许并进"没装"）');
});

test('④ 同源：docs/FACTS.json 的 roster/installed 与实测读数逐字相等', () => {
  const factsPath = path.join(process.cwd(), 'docs', 'FACTS.json');
  // ★ 读不到 ≠ 通过（0.9.4）：FACTS.json 是仓内文件，缺了就是红，不是"跳过"
  assert.ok(fs.existsSync(factsPath), `读不到 docs/FACTS.json（当前目录 ${process.cwd()}）⇒ 同源判不了，按红处理`);
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8')) as {
    languageMatrix: { rosterCount: number; installedCount: number };
  };
  const r = parserRatio(measureParserPresence());
  assert.equal(facts.languageMatrix.rosterCount, r.registered, 'FACTS 的名册数必须等于实测分母');
  assert.equal(
    facts.languageMatrix.installedCount,
    probeInstalledLanguages().length,
    'FACTS 的已装数必须等于 probe 的已装数（capability_audit 那句 33/55 的另一半）',
  );
  assert.equal(
    r.loadable,
    probeInstalledLanguages().length,
    '能力矩阵的"可解析语言"必须与 probe 的已装集合同一个集合（同一把尺）',
  );
});
