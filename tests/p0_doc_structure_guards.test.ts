/**
 * P0 · **文档结构守卫**（`DOC_STRUCTURE_GUARDS`）—— AGENTS.md 0.2 的「守卫」那一列必须**可执行**
 *
 * ## 它守的是哪条规则（本证的第一性理由）
 * AGENTS.md 0.2 写了一张表：文档**不能**当判据主体，只能当「证据」或「守卫」；
 * 守卫的载体 = `scripts/lint-prose-as-structure.mjs` 的 `DOC_STRUCTURE_GUARDS` **声明表**。
 * 而 2026-11-05 实测：`grep -rn DOC_STRUCTURE_GUARDS scripts/ src/ tests/` **0 命中**
 * ⇒ 那条规则当时**指着一个不存在的东西**（0.20 的违例：规则里举例必须先 grep 命中）。
 * ⇒ 本证锁四件事，缺任何一件 0.2 就还是"散文"：
 *
 * ① **表在**：声明表非空，且每行都带 `why` 与至少一个判据键
 *    （一行什么都不判的守卫 = 永远绿 ⇒ 按 0.25② 不算检测点）；
 * ② **当前仓全绿**：5 条守卫在**真文件**上零问题（否则它是"永远会亮"的灯，0.16）；
 * ③ **有鉴别力（双向）**：同一行守卫，**该红的输入确实红**、**没坏的输入确实绿**
 *    —— 只有"现状是绿的"不具鉴别力（0.25②）；
 * ④ **消融可复现**：把守卫要防的那件事**精确做出来**（删掉一个 mustHave 串 / 塞回一个 mustNot 串 /
 *    把节数截到下限以下 / 把台账某行改成 7 列）⇒ 必须红，且红的话要点名是哪个键。
 *
 * ## 为什么 `columns` 要单独证
 * 它是唯一需要**解析 md 表格**的键（0.18④：结构载体不许就地 `split('|')`）⇒ 单独证两条边界：
 * 转义竖线 `\|` **不许**切列；**同前缀两张表** ⇒ 必须抛错（不替你挑一张）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DOC_STRUCTURE_GUARDS, checkDocStructureGuards, scanHardcodedCounts, suppressionSummary } from '../scripts/lint-prose-as-structure.mjs';
import { findTableByHeader, splitRow } from '../scripts/lib/md-table.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

/** 在临时根里造一份 `rel` 文件（内容 `text`）⇒ 返回根（守卫按仓库相对路径找文件） */
function rootWith(rel: string, text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-guards-'));
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
  return root;
}

/** 读真文件（守卫表里写的仓库相对路径） */
function realText(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

test('① 声明表非空，且每行都带 why + 至少一个判据键（否则那行永远绿）', () => {
  assert.ok(DOC_STRUCTURE_GUARDS.length > 0, 'DOC_STRUCTURE_GUARDS 是空的 ⇒ 0.2 又变成散文了');
  for (const [i, g] of DOC_STRUCTURE_GUARDS.entries()) {
    const where = `守卫#${i + 1}（${g.file}）`;
    assert.ok(typeof g.file === 'string' && g.file.length > 0, `${where} 缺 file`);
    assert.ok(typeof g.why === 'string' && g.why.trim().length > 20, `${where} 的 why 缺失或太短 —— 「为什么守这个」必须写下来`);
    const keys = ['mustHave', 'mustNot', 'minCount', 'columns', 'maxBytes', 'rowRules'].filter((k) => (g as Record<string, unknown>)[k]);
    assert.ok(keys.length > 0, `${where} 一个判据键都没有（mustHave / mustNot / minCount / columns / maxBytes / rowRules 全空）`);
  }
});

test('② 当前仓库：每条守卫在真文件上零问题（不是"永远会亮"的灯）', () => {
  const problems = checkDocStructureGuards(REPO);
  assert.deepEqual(problems, [], `守卫在真文件上报红：\n${JSON.stringify(problems, null, 1)}`);
});

test('③ 双向：每条守卫「该红的输入确实红 · 没坏的输入确实绿」（表驱动，不逐条 if）', () => {
  for (const [i, g] of DOC_STRUCTURE_GUARDS.entries()) {
    const where = `守卫#${i + 1}（${g.file}）`;
    const real = realText(g.file);
    const guard = [g];

    // 绿的一侧：原样内容必须零问题（这是"同义必命中"方向 —— 防的是"守卫变严了却没人发现"）
    const greenRoot = rootWith(g.file, real);
    try {
      assert.deepEqual(checkDocStructureGuards(greenRoot, guard), [], `${where} 在未改动的原文上就红了 ⇒ 该键钉错了`);
    } finally {
      fs.rmSync(greenRoot, { recursive: true, force: true });
    }

    /** 该红的输入（每个都是"只把守卫要防的那件事做出来"） */
    const reds: { label: string; text: string; expects: string }[] = [];
    for (const s of g.mustHave ?? []) {
      reds.push({ label: `删掉 mustHave 串 ${JSON.stringify(s)}`, text: real.split(s).join(''), expects: 'mustHave' });
    }
    for (const s of g.mustNot ?? []) {
      reds.push({ label: `塞回 mustNot 串 ${JSON.stringify(s)}`, text: `${real}\n\n${s}\n`, expects: 'mustNot' });
    }
    for (const mc of g.minCount ?? []) {
      // 隔离式消融：只留 mustHave 串（它们本身能凑出几条 `### 0.x ` 行）⇒ 内容"没坏"、只是**数量不够**
      // ★ 为什么不"从原文里删掉后 20 条"：那会连带删掉 mustHave 串 ⇒ 红的原因就成了 mustHave 而不是 minCount
      //   （★ 实测踩过：用 /g 正则逐行 test() 判"要不要保留"时 lastIndex 会串位，删的行是随机的 —— 恰好让
      //   断言红在了别处。所以这里造**最小内容**，不用筛选。）
      const minimal = `${(g.mustHave ?? []).join('\n')}\n`;
      const hits = (minimal.match(new RegExp(mc.pattern, 'gm')) ?? []).length;
      assert.ok(hits < mc.atLeast, `${where} 最小内容已命中 ${hits} ⇒ 造不出 minCount 反例（下限 ${mc.atLeast}）`);
      reds.push({ label: `只留 mustHave 串（/${mc.pattern}/ 命中 ${hits} < 下限 ${mc.atLeast}）`, text: minimal, expects: 'minCount' });
    }
    if (g.columns) {
      const { headerStartsWith, expect } = g.columns;
      const table = findTableByHeader(real, headerStartsWith);
      assert.ok(table && table.body.length > 0, `${where} 找不到可改的表格行`);
      const victim = table!.body[0].line;
      const lines = real.split(/\r?\n/);
      lines[victim - 1] = `${lines[victim - 1]} 多出来的一列 |`; // 6 列 ⇒ 7 列
      reds.push({ label: `把第 ${victim} 行改成 ${expect + 1} 列`, text: lines.join('\n'), expects: '列' });
    }

    for (const r of reds) {
      const root = rootWith(g.file, r.text);
      try {
        const got = checkDocStructureGuards(root, guard);
        assert.ok(got.length > 0, `${where} 【消融失败】${r.label} ⇒ 竟然还是绿的`);
        assert.ok(
          got.some((p) => p.msg.includes(r.expects)),
          `${where} 【红错了地方】${r.label} ⇒ 期望消息含 ${JSON.stringify(r.expects)}，实际：${JSON.stringify(got.map((p) => p.msg))}`,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  }
});

test('④ md 表格切分：同义必命中 / 异义必不命中（0.14 双向）', () => {
  const same = (line: string, want: string[] | null) => {
    assert.deepEqual(splitRow(line), want, `切分 ${JSON.stringify(line)} 不对`);
  };
  // 同义必命中：首/尾竖线省略与否、行内空格宽窄，都该切出同样的格
  same('| a | b |', ['a', 'b']);
  same('| a | b', ['a', 'b']);
  same('|a|b|', ['a', 'b']);
  same('  | a |  b  |  ', ['a', 'b']);
  // 异义必不命中：转义竖线不是分隔符（反斜杠个数奇偶决定，`\\|` 里的竖线**算**分隔符）
  same('| a \\| b | c |', ['a \\| b', 'c']);
  same('| a \\\\| b |', ['a \\\\', 'b']);
  // 不是表格行 ⇒ null（不许把散文当表格）
  same('---', null);
  same('', null);
  same('text | more', null);
});

test('④b 同前缀两张表 ⇒ 抛错（不替你挑一张）', () => {
  const text = ['| 日期 | a |', '|---|---|', '| 1 | 2 |', '', '| 日期 | a |', '|---|---|', '| 3 | 4 |'].join('\n');
  assert.throws(() => findTableByHeader(text, '| 日期 |'), /歧义/);
});

/**
 * ⑤ `rowRules`（`docs/RETIRED.md` 的**逐行**规则，2026-11-07 立；PROJECT-DESIGN §14.3「退役必须记代价」）
 *
 * ## 它为什么必须单独证（不能只靠 ③ 的通用消融）
 * ③ 只会从 `mustHave` / `mustNot` / `minCount` / `columns` 造反例 —— `rowRules` 一条都造不出来。
 * 而 `rowRules` 恰恰是**唯一逐行**的那一条：它要判「这一行写全了没有 / ②④ 有没有点名回炉登记 / 基线有没有变松」。
 *
 * ## 双向（0.14）+ 消融（0.25②）—— 每条都说出"什么输入会红"
 * | 输入 | 期望 |
 * |---|---|
 * | 真实台账（11 条存量记账豁免） | 绿 |
 * | 新增一行 ② 不点名 R | **红**（"没点名任何 ### R<n>"） |
 * | 同一行点名 `R1`（存在） | 绿 |
 * | 点名 `R9`（不存在） | **红**（点名一个不存在的登记） |
 * | 代价格留空 | **红**（"6 列是空的"） |
 * | 性质格不写 ①-⑤ | **红**（"没点明是 ①-⑤ 哪一种"） |
 * | 性质 ①/③ 的行不点名 R | 绿（不误伤 —— 只有 ②/④ 需要回炉条件） |
 * | 从基线删掉一条 ⇒ 那一行 | **红**（棘轮不能偷偷放宽） |
 * | 某行补齐后基线条目留着 | **红**（"已经不违规了" ⇒ 强制收紧） |
 */
test('⑤ rowRules：逐行六格非空 + 性质点明 + ②④ 点名存在的回炉登记 + 基线只许收紧', () => {
  const guard = DOC_STRUCTURE_GUARDS.find((g) => (g as Record<string, unknown>).rowRules);
  assert.ok(guard, 'RETIRED.md 的 rowRules 守卫不见了 ⇒ §14.3「退役必须记代价」又变成散文');
  const rr = (guard as unknown as { rowRules: { baseline?: { row: string; why: string }[] } }).rowRules;
  const real = realText(guard.file);
  const anchor = '| 2026-11-06 |';
  assert.ok(real.includes(anchor), `台账里找不到锚点 ${JSON.stringify(anchor)} —— 表形状变了，本证要跟着改`);
  const withRow = (row: string): string => real.replace(anchor, `${row}\n${anchor}`);

  // 绿：真实台账现状（存量 11 条都在基线里）
  const roots: string[] = [];
  try {
    const mk = (text: string) => {
      const root = rootWith(guard.file, text);
      roots.push(root);
      return root;
    };
    const check = (text: string, g: unknown = guard) => checkDocStructureGuards(mk(text), [g as never]);

    assert.deepEqual(check(real).map((p) => p.msg), [], '真实台账必须全绿（存量已在 RETIRED_ROW_BASELINE 记账）');

    const BAD_2 = '| 2026-11-07 | 假新退役甲 | **② 做得不够好** | 判据：有 | 现在用什么：无替代 | 代价：丢了 X |';
    const red1 = check(withRow(BAD_2));
    assert.ok(red1.some((p) => /没点名任何/.test(p.msg)), `【消融失败】② 的行不点名 R ⇒ 必须红；实得 ${JSON.stringify(red1.map((p) => p.msg))}`);

    assert.deepEqual(
      check(withRow(BAD_2.replace('代价：丢了 X', '代价：丢了 X（回炉条件见 R1）'))).map((p) => p.msg),
      [],
      '点名一个**存在**的 R1 ⇒ 必须绿（否则规矩变成"永远写不进去"）',
    );
    assert.ok(
      check(withRow(BAD_2.replace('代价：丢了 X', '代价：丢了 X（回炉条件见 R9）'))).some((p) => /`R9` 在「## 回炉登记」里不存在/.test(p.msg)),
      '点名一个**不存在**的 R9 ⇒ 必须红（指着空气也算登记就白判了）',
    );
    assert.ok(
      check(withRow('| 2026-11-07 | 假新退役乙 | **① 被取代** | 判据：有 | 现在用什么：X | |')).some((p) => /6 列是空的/.test(p.msg)),
      '代价格留空 ⇒ 必须红（§14.3「退役必须记代价」的"代价"就是这一格）',
    );
    assert.ok(
      check(withRow('| 2026-11-07 | 假新退役丙 | 因为没用了 | 判据：有 | 现在用什么：X | 代价：Y |')).some((p) => /没点明是 ①-⑤/.test(p.msg)),
      '性质格不点明 ①-⑤ ⇒ 必须红（"觉得没用了"正是台账纪律禁止的写法）',
    );
    assert.deepEqual(
      check(withRow('| 2026-11-07 | 假新退役丁 | **① 被取代** | 判据：有 | 现在用什么：X | 代价：Y |')).map((p) => p.msg),
      [],
      '性质 ① 的行**不需要**回炉条件 ⇒ 不许误红（0.14 的另一向）',
    );

    // 棘轮两个方向
    const dropped = { ...(guard as Record<string, unknown>), rowRules: { ...rr, baseline: (rr.baseline ?? []).slice(1) } };
    assert.ok(
      check(real, dropped).some((p) => /没点名任何/.test(p.msg)),
      '把基线条目删掉 ⇒ 那一行必须重新变红（棘轮不许偷偷放宽）',
    );
    const target = (rr.baseline ?? [])[1];
    assert.ok(target, '基线里至少要有 2 条，否则本组测不到"补齐后该删账"这一向');
    assert.ok(
      check(real.replace('| 2026-11-02 | 工具面上的**死枚举**', '| 2026-11-02 | 工具面上的**死枚举**（回炉见 R1）')).some((p) =>
        /已经不违规了/.test(p.msg),
      ),
      '某行补齐后，基线里那条必须报「已经不违规了」⇒ 强制收紧（否则它会变成一块永久的静音垫）',
    );
  } finally {
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  }
});
