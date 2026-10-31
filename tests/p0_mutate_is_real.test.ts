/**
 * P0 · 判据突变器**变异的是 `src/` 的代码**（不是判据自己的字段），且判据真的会红、还原逐字节。
 *
 * ## 它挡的事故（2026-10-31 定论）
 * `scripts/mutate.mjs` 曾声称回答「346 条判据是不是装饰」，但它的 `mutantsOf()` **变异的是判据自身**
 * （把判据里的 `symbol` 改成 `symbol + '__MUTANT__'`、把 `input` 的叶子换成边界值）。
 * 那样 `survived === 0` **按构造成立**（判据点名一个不存在的符号，当然 fail）⇒
 * 它证明的是「判据对自己字段的变化敏感」，**不是**「判据能发现代码被改坏」。
 * 于是 `design:check` 的 D7/D9 一路绿灯，而 704 条零执行者的判据没人发现。
 *
 * ## 三条断言（缺一条就等于没验）
 * ① `planMutants()` 的变异体里 `file` 必须在 `src/` 下，`before` 逐字等于磁盘源码，
 *    `after` 是**改写过后的源码**（只差**一处**、且仍可解析），而**判据对象逐字等于册里原文**
 *    （没有 `__MUTANT__` 之类"变异过的判据"）；
 * ② 真跑一次：至少 1 条 `behavior-cases` 样本被变异**抓到**（`killed ≥ 1`），
 *    而且证据里点名了哪条 case 变了（"行为差异 N/M：case-k 输入 … 期望 … 实得 …"）；
 * ③ **没有样本 ≠ 绿**：给一本只有 `source-has` 的册（没有 `behavior-cases` 候选）时
 *    `killed === 0` 且 `ok === false` —— 「删掉依赖它还会绿吗」的永久版答案。
 *
 * ## 消融（★ 本文件必须能红 —— 2026-10-31 实测，两个方向各一次）
 * ① **把"还原"注释掉**（`scripts/mutate.mjs` 的 `runMutant` 里 `finally` 的
 *    `fs.writeFileSync(abs, rec.buf)` 改成空操作）⇒ 该用例如期红：
 *    `还原必须逐字节（sha256 相等）` 断言失败，且 `git diff src/` 里留着那个变异体。
 *    还原回去 ⇒ 全绿（读数见交付回执）。
 * ② 把 `planMutants` 换回"变异判据"（`after` 返回 `JSON.stringify({...expectation, symbol: symbol+'__MUTANT__'})`）
 *    ⇒ 断言 ① 的「`after` 只差一处且仍可解析」/「`before` 逐字等于磁盘」当场红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MUT = await import(pathToFileURL(path.join(ROOT, 'scripts', 'mutate.mjs')).href);

const sha = (abs: string): string => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const absOf = (rel: string): string => path.join(ROOT, rel);

/** 目标文件里**只改了一处**：去掉公共前后缀后，中间那段就是被替换的片段 */
function changedSpan(a: string, b: string): { start: number; oldText: string; newText: string } {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { start: i, oldText: a.slice(i, a.length - j), newText: b.slice(i, b.length - j) };
}

test('① 变异点落在 src/ 的**代码**上：判据对象逐字未改，after 是改写过一处、仍可解析的源码', async () => {
  const plan = await MUT.planMutants(ROOT, MUT.listFeatures(ROOT), { n: 5, structural: 1 });

  assert.ok(plan.expectations > 0, '册里没有判据 ⇒ 断言无从成立');
  assert.ok(plan.plans.length > 0, `没有可变异样本（候选 ${plan.semantic.length}）⇒ 突变器等于没接线`);
  const sem = plan.plans.filter((p: { class: string }) => p.class === 'semantic');
  assert.ok(sem.length > 0, '没有语义样本（behavior-cases ∩ src）');

  // 册里的判据原文（用来证明"判据一个字节都没被改"）
  const dslExpectation = (feature: string, nodeId: string, file: string, sym: string) => {
    const dsl = JSON.parse(fs.readFileSync(absOf(`.agent-io/design/${feature}.dsl.json`), 'utf8'));
    const node = (dsl.geometry?.nodes ?? []).find((n: { id: string }) => n.id === nodeId);
    return ((node?.decision?.expectations ?? []) as Array<{ kind: string; path?: string; symbol?: string }>).filter(
      (e) => e.kind === 'behavior-cases' && e.path === file && e.symbol === sym,
    );
  };

  for (const pl of plan.plans) {
    assert.match(pl.file, /^src\//, `变异目标必须在 src/ 下，实得 ${pl.file}`);
    assert.ok(pl.mutants.length > 0, `${pl.file}#${pl.symbol} 没算出突变体（${pl.reason}）`);

    for (const m of pl.mutants) {
      // (a) before 逐字等于**磁盘上的源码** ⇒ 变异的是代码文件本体
      assert.equal(m.before, fs.readFileSync(absOf(pl.file), 'utf8'), `${pl.file} 的 before 不是磁盘现有源码`);

      // (b) after 是**改写后的代码**：只差一处、且仍是可解析的 TS
      assert.notEqual(m.after, m.before, 'after 与 before 相同 ⇒ 没变异');
      const span = changedSpan(m.before, m.after);
      assert.ok(span.oldText.length + span.newText.length <= 200, `看起来不是"一处"突变：${JSON.stringify(span)}`);
      const sf = ts.createSourceFile(pl.file, m.after, ts.ScriptTarget.Latest, false);
      assert.deepEqual(
        ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).map((d) => String(d)),
        [],
        `变异体语法不可解析 ⇒ 它会让判据报 unsupported（"判不了"冒充"抓到"）：${pl.file}`,
      );

      // (c) 变异**在函数体内部**：符号名本身不许被改（"改名字"是结构代理的活，不是语义突变）
      assert.ok(m.after.includes(String(pl.symbol)), `after 里连符号名都没了：${pl.file}#${pl.symbol}`);
    }

    if (pl.kind === 'behavior-cases') {
      const orig = dslExpectation(pl.feature, pl.node_id, pl.file, String(pl.symbol));
      assert.ok(orig.length > 0, `册里找不到这条判据：${pl.file}#${pl.symbol}`);
      assert.ok(
        orig.some((e) => JSON.stringify(e) === JSON.stringify(pl.expectation)),
        `判据对象被改过（应与册里 .agent-io/design/${pl.feature}.dsl.json 的原文逐字相同）`,
      );
      assert.ok(
        !JSON.stringify(pl.expectation).includes('__MUTANT__'),
        '判据被变异了（本次要的不是"判据对自己字段敏感"）',
      );
    }
  }
});

test('② 真跑：至少 1 条判据抓到代码变异（killed ≥ 1），且被改文件逐字节还原', async () => {
  // 固定样本（读数可复现）：`sameBehaviorRet` 的 `ret === expect` 翻成 `!==` ⇒ 6/10 case 变红
  const only = 'src/domain/behavior_compare.ts#sameBehaviorRet';
  const beforeSha = sha(absOf('src/domain/behavior_compare.ts'));
  const beforeMtime = fs.statSync(absOf('src/domain/behavior_compare.ts')).mtimeMs;

  const rep = await MUT.runMutate(MUT.listFeatures(ROOT), ROOT, { n: 1, structural: false, only });

  assert.equal(rep.killed >= 1, true, `killed=${rep.killed} ⇒ 判据没抓到任何代码变异（这正是"装饰判据"的读数）`);
  assert.equal(rep.survived, 0, `survived=${rep.survived} ⇒ 那条判据对代码变异无感`);
  assert.equal(rep.unsupported, 0, `unsupported=${rep.unsupported} ⇒ "判不了"不算抓到`);

  // 证据必须是"哪个 case 变了"，不是"符号找不到"
  const kill = rep.items.find((i: { verdict: string }) => i.verdict === 'killed');
  assert.ok(kill, '没有 killed 条目');
  const hit = (kill.attempts as Array<{ verdict: string; detail: string; mutation: string }>).find((a) => a.verdict === 'fail');
  assert.ok(hit, 'killed 条目里没有 fail 那次尝试');
  assert.match(hit.detail, /行为差异/, `killed 的证据不像语义判据给的：${hit.detail}`);
  assert.match(hit.mutation, /===|!==/, `突变点不像代码里的运算符：${hit.mutation}`);

  // ★ 还原必须逐字节（注释掉还原那一步 ⇒ 这条断言就是红的那一条）
  assert.equal(sha(absOf('src/domain/behavior_compare.ts')), beforeSha, '被变异的 src 文件没有逐字节还原');
  // ★ 连 mtime 也要还原：只还字节会让「dist 不比 src 旧」（verify 的 MCP 门 ④）把这次测量读成"源码刚改过"
  //   ★ 判据是"没被 bump"（同一毫秒内），不是位级相等 —— 文件系统时间戳精度因平台而异，别把量具做成 flaky。
  const afterMtime = fs.statSync(absOf('src/domain/behavior_compare.ts')).mtimeMs;
  assert.ok(Math.abs(afterMtime - beforeMtime) < 1, `被变异的 src 文件 mtime 被 bump 了（${afterMtime} vs ${beforeMtime}）`);
  assert.deepEqual(rep.restored_files, ['src/domain/behavior_compare.ts']);
});

test('③ 没有样本 ≠ 绿：只有 source-has 的册 ⇒ killed=0 且 ok=false', async () => {
  // agent-io-toolface 册只有 1 条 source-has（存在类）⇒ 没有语义样本可变异
  const rep = await MUT.runMutate(['agent-io-toolface'], ROOT, { n: 5 });
  assert.equal(rep.candidates, 0, '这本册不该有 behavior-cases 候选');
  assert.equal(rep.killed, 0);
  assert.equal(rep.survived, 0);
  assert.equal(rep.ok, false, '★ killed=0 时 ok 必须为 false —— 「没验」不许读成「全绿」');
});
