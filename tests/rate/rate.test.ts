/**
 * `src/domain/rate.ts` 的两条判据（`docs/todo.md` §一 · 2.5「分母口径」）。
 *
 * ## 它钉两件事（两件都"错而没有声音"）
 * ① **行为**：`rateOf` 的分子必须是分母的子集，越界要**逐项**报出差集（不是只抛一句"不合法"）；
 *    分母为 0 要印「不算率」而不是 `0.0%`（否则「没有」与「很小」在读数上同形，0.12）。
 * ② **枚举与产出点 1:1**：`RATE_QUESTIONS` 是 `RateQuestion` 的**唯一**住处，
 *    所以必须能机械判住"表里没有多余项、仓里没有表外项、同一个 id 不被两处用"。
 *
 * ## 为什么扫调用点用 AST 而不是正则（0.18 ①）
 * 要判的是**语法结构**（"这是一次 `rateOf(...)` 调用，它的 `question` 实参是哪个字符串字面量"）。
 * 正则会把注释里的 `rateOf({…})`、字符串里的 `rateOf(` 都算命中，而且拿不到"实参"这层结构
 * ⇒ 同一事实在 AST 层已经可得，就不许再从文本里猜一遍。
 *
 * ## 扫描范围与它的边界（如实写）
 * · 只扫 `src/` 与 `scripts/`（`tests/` 里本来就要调 `rateOf`，扫进来会自己把自己判成"第二个调用点"）；
 * · `question` 写成**非字面量**（变量 / 模板插值）⇒ 直接判红：那样枚举与调用点就不再是机械可比的了；
 * · [未核] 用别名（`const r = rateOf; r({…})`）或动态 `import()` 拿到的 `rateOf` 调用不在本扫描内（本仓无此用法）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { RATE_QUESTIONS, rateOf, ratioPercent } from '../../src/domain/rate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ════════════════════════════════════════════════════════════════════
// ① 行为：分子 ⊆ 分母 是**强制**的，且越界要逐项点名
// ════════════════════════════════════════════════════════════════════
test('① rateOf 行为：n⊆d 正常 / n⊄d 逐项报差集 / d=0 不算率 / 未知 question 列合法值', () => {
  // ①a 正常：文本必须同时带「回答哪个问题」+ 分子 + 分母 + 百分比
  const ok = rateOf({ n: 3, d: 4, question: 'design-db-covers-source' });
  assert.equal(ok.text, '设计 DB 副本 → 源码文件 = 3/4 = 75.0%', `①a 文本四件必须同场（问题/分子/分母/百分比）：实测 ${ok.text}`);
  assert.equal(ok.question, 'design-db-covers-source', '①b question 必须原样回传（读端据此分辨"这是哪个问题"）');

  // ①c 带清单且越界 ⇒ 抛，且**逐项**列出差集（下一个人要知道是哪几项）
  assert.throws(
    () => rateOf({ n: 3, d: 2, question: 'design-db-covers-source', nItems: ['a', 'b', 'c'], dItems: ['a', 'b'] }),
    (e: Error) => {
      assert.match(e.message, /不在分母里/, `①c 拒因必须说清"分子不是分母的子集"：${e.message}`);
      assert.match(e.message, /n 不在 d 里：c（共 1 个）/, `①c 拒因必须**逐项点名**（不是只抛一句"不合法"）：${e.message}`);
      return true;
    },
  );

  // ①d 不带清单 ⇒ 仍抛，但必须**明说报不出是哪几项**（不许装作查过）
  assert.throws(
    () => rateOf({ n: 3, d: 2, question: 'design-db-covers-source' }),
    (e: Error) => {
      assert.match(e.message, /n=3 > d=2/, `①d 没有清单时至少要把两个数报出来：${e.message}`);
      assert.match(e.message, /报不出是哪几项/, `①d 必须明说自己点不出名（0.12：失败要与"没有"可区分）：${e.message}`);
      return true;
    },
  );

  // ①e 分母为 0 ⇒ 印「不算率」，不印 0.0%（"没有分母"与"很小"必须能分开读）
  const zero = rateOf({ n: 0, d: 0, question: 'sheet-nodes-cover-src' });
  assert.match(zero.text, /0\/0（分母为 0 ⇒ 不算率）/, `①e 分母 0 不许印成 0.0%：实测 ${zero.text}`);
  assert.equal(ratioPercent(0, 0), '—', '①e 百分比原语同口径：分母 0 回 —');

  // ①f 自造 question ⇒ 抛，且把合法值列出来（否则下一个人只能猜）
  assert.throws(
    () => rateOf({ n: 1, d: 2, question: 'not-a-real-question' as never }),
    (e: Error) => {
      assert.match(e.message, /不在 RATE_QUESTIONS 里/, `①f 自造问题必须被拒：${e.message}`);
      for (const r of RATE_QUESTIONS) assert.ok(e.message.includes(r.id), `①f 拒因必须列出合法值（缺 ${r.id}）：${e.message}`);
      return true;
    },
  );

  // ①g 报的数与算的数对不上 ⇒ 抛（"n 写大了"和"清单少一项"都不许静默）
  assert.throws(
    () => rateOf({ n: 2, d: 4, question: 'design-db-covers-source', nItems: ['a'], dItems: ['a', 'b', 'c', 'd'] }),
    /与分子清单的去重项数 1 对不上/,
    '①g n 与 nItems 条数不一致必须抛（否则文本里的 n 是编出来的）',
  );
});

// ════════════════════════════════════════════════════════════════════
// ② RATE_QUESTIONS ↔ 全仓 rateOf 调用点：**双向 1:1**
// ════════════════════════════════════════════════════════════════════
const SCAN_EXTS = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.agent-io']);

/** 递归收集要扫的源文件（只 `src/` 与 `scripts/`） */
function scanTargets(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (SCAN_EXTS.some((x) => e.name.endsWith(x))) {
        out.push(path.join(dir, e.name));
      }
    }
  };
  for (const d of ['src', 'scripts']) walk(path.join(REPO, d));
  return out;
}

/** 一个文件里每次 `rateOf({…})` 的 `question` 实参（字面量取文本；非字面量留标记 ⇒ 后续判红） */
function questionsOf(file: string): Array<{ file: string; question: string }> {
  const src = fs.readFileSync(file, 'utf-8');
  const kind = file.endsWith('.mjs') || file.endsWith('.js') || file.endsWith('.cjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, kind);
  const out: Array<{ file: string; question: string }> = [];
  const rel = path.relative(REPO, file).replace(/\\/g, '/');
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'rateOf') {
      const arg = n.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) {
        out.push({ file: rel, question: '<实参不是对象字面量>' });
      } else {
        let found = false;
        for (const p of arg.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const nm = p.name;
          const key = ts.isIdentifier(nm) || ts.isStringLiteral(nm) ? nm.text : null;
          if (key !== 'question') continue;
          found = true;
          const init = p.initializer;
          out.push({
            file: rel,
            question: ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init) ? init.text : `<非字面量:${init.getText(sf)}>`,
          });
        }
        if (!found) out.push({ file: rel, question: '<缺 question>' });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

test('② RATE_QUESTIONS 与全仓 rateOf 调用点双向 1:1（表外值=自造问题 / 无调用点=死枚举 / 同 id 两处=同一问题两个答案）', () => {
  const files = scanTargets();
  assert.ok(files.length > 0, `②a 扫描器必须真扫到文件（否则"0 命中"可能只是没扫到）：实测 ${files.length} 个`);

  const calls = files.flatMap((f) => questionsOf(f));
  assert.ok(
    calls.length > 0,
    `②b 全仓必须至少有一个 rateOf 调用点（否则 RATE_QUESTIONS 恒是死枚举，本判据会空转）：扫了 ${files.length} 个文件`,
  );

  // ②c 每个调用点都必须给**字面量** question
  const bad = calls.filter((c) => !RATE_QUESTIONS.some((r) => r.id === c.question));
  assert.equal(
    bad.length,
    0,
    `②c 有调用点用了 RATE_QUESTIONS 表外的 question（= 自造问题 = 第二处权威）：${bad.map((b) => `${b.file} → ${b.question}`).join(' / ')}`,
  );

  // ②d 表里每一条都必须**恰好**被一个调用点用 —— 0 个是死枚举，>1 个是"同一问题两个答案"（2.5 的红线）
  const byId = new Map<string, string[]>();
  for (const c of calls) byId.set(c.question, [...(byId.get(c.question) ?? []), c.file]);
  const dead = RATE_QUESTIONS.filter((r) => !byId.has(r.id)).map((r) => r.id);
  assert.deepEqual(dead, [], `②d 死枚举（表里有、全仓没有调用点）：${dead.join(' / ')}`);
  const dup = [...byId.entries()].filter(([, fs_]) => fs_.length > 1);
  assert.deepEqual(
    dup.map(([id, fs_]) => `${id} ← ${fs_.join(' + ')}`),
    [],
    `②d 同一个 question 被两个调用点用 = 同一问题两个答案（2.5 的红线）：${dup.map(([id, fs_]) => `${id} ← ${fs_.join(' + ')}`).join(' / ')}`,
  );

  // ②e 调用点覆盖的问题数必须等于枚举条数（写死个数会让"新增产出点"变成假绿，所以只判结构）
  assert.equal(
    byId.size,
    RATE_QUESTIONS.length,
    `②e 调用点覆盖的问题数（${byId.size}）必须等于枚举条数（${RATE_QUESTIONS.length}）—— 差一条就是上面 ②c/②d 之一`,
  );
});
