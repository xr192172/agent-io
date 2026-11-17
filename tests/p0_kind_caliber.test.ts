/**
 * P0 · **判据 kind 的"口径唯一"**（T-#KIND-CALIBER）
 *
 * ## 被守的那个病（2026-11-17 实测，混元外审 Top1）
 * "判据有几种"这一个事实在仓里同时存在**三个数**：
 * `README.md` 写「**九种**判据」· `docs/GUIDE-GATE.md` 标题写「判据 **11** kind」·
 * `src/domain/expectation_kinds.ts#KIND_SPECS` 实有 **12** 个键（`journey-cases` 连表里都没有）。
 * 而"哪个数是对的"**没有任何机器判据** —— 于是每次加/退一个 kind，文档里那一份就静默漂一次。
 *
 * ## 它锁的三件事（每一件都对应上面那条病的一支）
 * 1. **人读文档里不许出现写死的种数**（抄数即红）：`README.md` / `README.en.md` / `AGENTS.md` / `docs/*.md`
 *    —— 只允许"以 `KIND_SPECS` 为准 / 全表见它"这种**引用式**表述。
 *    ★ 豁免是**按形态**给的两类（不是一张点名白名单）：
 *    · `docs/todo.md`（台账：记的是"当时那个数"，改它属台账销账，不属口径修正）；
 *    · 带日期的评审/清点记录（`*-2026-11-17-*.md` 之类：那是**当时的读数**，改它等于篡改证据）。
 * 2. **文档的 kind 表 == 注册表**：`docs/GUIDE-GATE.md` §三 表的 `kind` 列必须逐行对得上 `KIND_SPECS`
 *    （缺一行 = 有个能写进去的 kind 文档没教；多一行 = 文档在教写不进去的东西）。
 * 3. **现算口径**：`.agent-io/judge-readings.json#by_kind`（`judge-all` 的产物）里的每个 kind 都必须在
 *    `KIND_SPECS` 里，且**每个 kind 的有无都必须说得出为什么** ——
 *    册里用了的 kind **必须**出现在 `by_kind`；`by_kind` 里有而册里 0 条的不许有。
 *
 * ## 为什么第 3 条**不**写成"两个数相等"
 * 实测：`KIND_SPECS` 12 个键，`by_kind` 11 个 —— 差的那一个是 `journey-cases`（3 册里 **0 条**判据在用，
 * 所以 `judge-all` 不会报它）。断言 `12 === 11` 会是一盏**永远亮的灯**（0.16），
 * ⇒ 真正的判据是**精确分解**：`by_kind` ∪ {册里 0 条的 kind} == `KIND_SPECS`，且那个"0 条"的集合要被点名。
 *
 * ## 消融（抄数即红 —— 第 ① 组就是这条判据的机器形态）
 * 把 `README.md` 那一行改回「**九种判据**」⇒ 第 ① 组当场红，并点名文件与行号。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { EXPECTATION_KINDS, KIND_SPECS } from '../src/domain/expectation_kinds.js';

/** 仓库根（本文件住 `tests/`） */
const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const readText = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel: string): unknown => JSON.parse(readText(rel));

/**
 * 找"写死的 kind 总数"。
 * ★ 只认**种数 + kind 名词**挨着的形态（`九种判据` / `判据 11 kind` / `9 种 kind`）——
 *   不收 `11 个文件` / `12 条判据`（那是别的计数），否则这条判据会变成噪音。
 */
function findHardcodedKindCounts(text: string): string[] {
  const out: string[] = [];
  const pats = [/(?:\d+|九|十一|十二)\s*种\s*(?:判据|kind)/g, /判据\s*(?:\d+|九|十一|十二)\s*(?:kind|种)/g];
  for (const re of pats) for (const m of text.matchAll(re)) out.push(m[0]);
  return out;
}

/** 带日期的记录（评审 / 清点）—— 记的是**当时**的读数，改它等于篡改证据 */
const DATED = /-20\d\d-\d\d-\d\d/;

/** 人读文档的扫描面（★ 台账与带日期的记录不在此列，理由见文件头） */
function caliberDocs(): string[] {
  const docs = fs
    .readdirSync(path.join(ROOT, 'docs'))
    .filter((f) => f.endsWith('.md') && f !== 'todo.md' && !DATED.test(f))
    .map((f) => `docs/${f}`);
  return ['README.md', 'README.en.md', 'AGENTS.md', ...docs].sort();
}

// ════════════════════════════════════════════════════════════════════
// ① 人读文档里不许抄数（抄数即红）
// ════════════════════════════════════════════════════════════════════
test('① 文档里不许写死 kind 种数（引用式表述才算过）；检测器自身要有牙（消融）', () => {
  // 检测器的鉴别力（★ 这一组是"判据会不会永远绿"的证）
  assert.deepEqual(findHardcodedKindCounts('- **九种判据**：symbol-exists / …'), ['九种判据']);
  assert.deepEqual(findHardcodedKindCounts('## 三、判据 11 kind'), ['判据 11 kind']);
  assert.deepEqual(findHardcodedKindCounts('现有 9 种 kind 能表达这四类'), ['9 种 kind']);
  assert.deepEqual(
    findHardcodedKindCounts('全表见 `src/domain/expectation_kinds.ts#KIND_SPECS`（本文不抄数）'),
    [],
    '引用式表述必须放过（否则这条判据就没法满足）',
  );
  assert.deepEqual(findHardcodedKindCounts('11 个文件 / 12 条判据 / 三种载体'), [], '别的计数不是 kind 种数');

  const offenders: string[] = [];
  for (const rel of caliberDocs()) {
    const text = readText(rel);
    text.split(/\r?\n/).forEach((line, i) => {
      for (const hit of findHardcodedKindCounts(line)) offenders.push(`${rel}:${i + 1} 「${hit}」`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    '★ 口径唯一住处是 `src/domain/expectation_kinds.ts#KIND_SPECS`；文档里写死的种数在 kind 加/退时必漂 ' +
      `（本轮修的就是"九种/11 kind"这一对）⇒ 改成"全表见 KIND_SPECS"。实测违规：\n${offenders.join('\n')}`,
  );
});

// ════════════════════════════════════════════════════════════════════
// ② 注册表自洽：KIND_SPECS 是唯一住处，`cert` 已退役
// ════════════════════════════════════════════════════════════════════
test('② 注册表自洽：KIND_SPECS 键集 == EXPECTATION_KINDS（同一份派生），且已退役的 `cert` 不在表里', () => {
  const specs = Object.keys(KIND_SPECS);
  assert.ok(specs.length > 0, 'KIND_SPECS 不许是空表（空表会让③④的相等断言恒真）');
  assert.deepEqual([...specs].sort(), [...EXPECTATION_KINDS].sort(), 'kind 的两个导出面必须是同一份键集');
  assert.ok(
    !specs.includes('cert'),
    '`cert` 已于 2026-10-31 退役 —— 它若回到注册表，"文档教一个写不进去的 kind"又成立',
  );
  for (const k of specs) {
    assert.equal((KIND_SPECS[k] as { kind: string }).kind, k, `KIND_SPECS["${k}"].kind 必须与键同名（派生面靠它）`);
    assert.ok(
      (KIND_SPECS[k] as { phase: string }).phase === 'pre' || (KIND_SPECS[k] as { phase: string }).phase === 'post',
      `"${k}" 的 phase 只有 pre/post 两态`,
    );
  }
});

// ════════════════════════════════════════════════════════════════════
// ③ 文档的 kind 表 == 注册表（缺行 / 多行都红）
// ════════════════════════════════════════════════════════════════════
test('③ `docs/GUIDE-GATE.md` §三 的 kind 表逐行对得上注册表（缺 `journey-cases` 这一行就是它今天的样子）', () => {
  const guide = readText('docs/GUIDE-GATE.md');
  const all = guide.split(/\r?\n/);
  const heading = all.findIndex((l) => l.startsWith('## 三、判据 kind 表'));
  assert.ok(
    heading >= 0,
    '标题必须是 `## 三、判据 kind 表…`（`scripts/lint-prose-as-structure.mjs` 的守卫钉的是这个前缀）',
  );
  const rows: string[] = [];
  for (const l of all.slice(heading + 1)) {
    if (l.startsWith('## ')) break; // 下一节 ⇒ 表结束
    const m = /^\|\s*`([a-z0-9-]+)`\s*\|/.exec(l);
    if (m) rows.push(m[1]);
  }
  const specs = Object.keys(KIND_SPECS).sort();
  const missing = specs.filter((k) => !rows.includes(k));
  const extra = rows.filter((k) => !specs.includes(k));
  assert.deepEqual(missing, [], `★ 注册表里有、文档表里没有的 kind：${missing.join(', ')}（文档在漏教）`);
  assert.deepEqual(extra, [], `★ 文档表里有、注册表里没有的 kind：${extra.join(', ')}（文档在教写不进去的东西）`);
});

// ════════════════════════════════════════════════════════════════════
// ④ 现算口径：judge-all 的 by_kind 与"册里实际用了哪些 kind"精确分解
// ════════════════════════════════════════════════════════════════════
test('④ `judge-readings.json#by_kind` ⊆ 注册表，且 by_kind ∪ {册里 0 条的 kind} == 注册表（差集必须点名）', () => {
  const specs = Object.keys(KIND_SPECS);
  const rd = readJson('.agent-io/judge-readings.json') as { by_kind?: Record<string, unknown> };
  assert.ok(rd && typeof rd === 'object', '`judge-all` 的读数必须存在（它是"现算口径"的那一半）');
  const byKind = Object.keys(rd.by_kind ?? {});
  assert.ok(byKind.length > 0, '`by_kind` 不许为空（空表会让下面的包含断言恒真）');

  const unknown = byKind.filter((k) => !specs.includes(k));
  assert.deepEqual(unknown, [], `★ judge-all 报了一个注册表里没有的 kind：${unknown.join(', ')}`);

  // 册里实际用了哪些（★ 数的是设计册里的判据本体，不是文档）
  const designDir = path.join(ROOT, '.agent-io', 'design');
  const sheets = fs.readdirSync(designDir).filter((f) => f.endsWith('.dsl.json'));
  assert.ok(sheets.length > 0, '设计册必须存在（否则"册里用了哪些 kind"判不了）');
  const texts = sheets.map((f) => fs.readFileSync(path.join(designDir, f), 'utf8'));
  const usage = new Map<string, number>(specs.map((k) => [k, 0]));
  for (const t of texts) {
    for (const k of specs) {
      const re = new RegExp(`"kind"\\s*:\\s*"${k}"`, 'g');
      usage.set(k, (usage.get(k) ?? 0) + (t.match(re) ?? []).length);
    }
  }
  const used = specs.filter((k) => (usage.get(k) ?? 0) > 0);
  const unused = specs.filter((k) => (usage.get(k) ?? 0) === 0);

  const usedMissing = used.filter((k) => !byKind.includes(k));
  assert.deepEqual(
    usedMissing,
    [],
    `★ 册里用了、judge-all 却没报的 kind：${usedMissing.join(', ')}（要么读数陈旧，要么判据没跑）`,
  );
  const reportedButUnused = byKind.filter((k) => !used.includes(k));
  assert.deepEqual(reportedButUnused, [], `★ judge-all 报了、册里 0 条的 kind：${reportedButUnused.join(', ')}`);

  // ★ 精确分解：两个数**不要求相等**，要求差集**说得出名字**（差的那几个必须是"册里 0 条"的 kind）
  assert.deepEqual(
    [...byKind, ...unused].sort(),
    [...specs].sort(),
    `by_kind(${byKind.length}) ∪ 册里 0 条的 kind(${unused.length}) 必须正好等于注册表(${specs.length})` +
      `；差集 = ${specs.filter((k) => !byKind.includes(k) && !unused.includes(k)).join(', ') || '（空）'}`,
  );
  assert.ok(
    unused.length === 0 || unused.every((k) => specs.includes(k)),
    `册里 0 条的 kind（judge-all 不报它们，属正常；但不许悄悄消失）：${unused.join(', ')}`,
  );
});
