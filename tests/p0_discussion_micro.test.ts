/**
 * P0 · discussion 格「**微缩在前、按需展开**」—— `task_plan.invariant_checks[3]` 的可执行落点。
 *
 * 设计出处：`.agent-io/design/task-system-plan.dsl.json` 的 `task_plan.invariant_checks[3]`
 * （`check` 原文即本文件的判据；`cmd` = `node --test --import tsx tests/p0_discussion_micro.test.ts`）。
 *
 * ## 它治什么病
 * 这条不变量原来是 `node certs/.work/probe-discussion-e2e.mjs` —— 而 `certs/.work/` **从不入版本控制**
 * ⇒ 在**任何干净 checkout 上恒红**（`MODULE_NOT_FOUND`）⇒ 它一直是"纸上的判据"：
 * 有 cmd、有 red_when，但执行者不在仓里。判据没有执行者 = 等于没有。
 * ⇒ 断言搬进来，`cmd` 指向本文件。
 *
 * ## 两条断言（与 `invariant_checks[3].check` 逐条对应）
 * ① `renderMicro` 的输出键 **== `MICRO_KEYS`**（白名单外的键数 == 0），且输出正文里**不含**
 *    `user_quote` 的任一段（以及 `conclusion` / `supersedes` / `decided_at` 的值）——
 *    即"`user_quote` 结构上到不了默认视野"不是一句注释，而是**字段级排除的读数**；
 * ② `shouldExpand` 在 `claim` / `judge-failed` / `explicit` 三种触发下 `true`、
 *    无触发 `false`、`discussion` 为空 `false` —— 展开条件**机器可判**。
 *
 * ## ★ 夹具：内联"真讨论"，不读仓内文件
 * 原来读 `docs/discussion-log.md` §①，但文档一被清理（2026-10-17 把 54 个 md 收敛成一份）这条就红，
 * 而它测的其实是 `renderMicro` 的行为、与文档内容无关。
 * ⇒ 夹具是 §① 那段讨论的**内联副本**，并**真的从 markdown 解析**成 `TaskDiscussion`
 *   （引文 / 微缩 / 未定项各走一遍解析 ⇒ "真讨论灌进去、再取出来"这一步没有被简化掉）。
 */
// touches: src/domain/discussion_log.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MICRO_KEYS,
  EXPAND_ONLY_FIELDS,
  EXPAND_TRIGGERS,
  renderMicro,
  shouldExpand,
  excludedFields,
} from '../src/domain/discussion_log.js';
import type { TaskDiscussion } from '../src/domain/task_schema.js';

// ─────────────────────────────────────────────────────────────
// 夹具：§① 讨论的 markdown 原文（内联）→ 解析成 TaskDiscussion
// ─────────────────────────────────────────────────────────────
const SECTION_1_MD = `
## ① 任务系统 = 候选任务

**微缩**：决策卡 = 候选任务 ⇒ 领取时校验（过期？还成立吗）⇒ 通过则锁定 ⇒ 做完用自带的期望对拍。

**用户设想（原话）**：
> 这个决策卡实际上和我们的任务系统不是一样的吗？就是他做好决策，就是发布任务嘛。
> 或者说它是任务的上一步，它是那个待领取的任务，然后有人要领任务的时候才把它真正发布出去。

**整理结果**：见 GOAL.md G1。

**未定 / 待拍**：
1. 领取要不要真加
2. 领取时校验接哪根线
3. 过期判据怎么定

## ② 结束
`;

/** 从 §① 的 markdown 解析出 `TaskDiscussion`（引文 / 微缩 / 未定项三处都走解析，不再手写常量）。 */
function fixtureFromMarkdown(md: string): TaskDiscussion {
  const sec = md.slice(md.indexOf('## ① 任务系统 = 候选任务'));
  const secEnd = sec.indexOf('\n## ②');
  const body = secEnd > 0 ? sec.slice(0, secEnd) : sec;
  const lines = body.split('\n');

  // 引文：`**用户设想（原话）**` 之后的连续 `>` 行，逐行去前缀再拼接
  const qi = lines.findIndex((l) => l.includes('**用户设想（原话）**'));
  assert.ok(qi >= 0, '夹具必须含「用户设想（原话）」段（否则解析出的 user_quote 是空的 ⇒ 断言变成空判据）');
  const quoteLines: string[] = [];
  for (let i = qi + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('>')) quoteLines.push(l.replace(/^>\s?/, ''));
    else if (l === '' && quoteLines.length > 0) break;
  }
  const userQuote = quoteLines.join('').replace(/\*/g, '').trim();

  // 微缩：`**微缩**：` 之后的一行
  const mi = lines.findIndex((l) => l.includes('**微缩**'));
  assert.ok(mi >= 0, '夹具必须含「微缩」段');
  const micro = (lines[mi].split('**微缩**：')[1] ?? lines[mi]).replace(/\*/g, '').trim().slice(0, 80);

  // 未定项：`未定 / 待拍` 之后的编号列表
  const oi = lines.findIndex((l) => l.includes('未定 / 待拍'));
  const open: string[] = [];
  for (let i = oi + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(\d+)\.\s*(.+)$/);
    if (m) open.push(m[2].replace(/\*/g, '').slice(0, 60).trim());
    else if (lines[i].trim() === '' && open.length > 0) break;
  }

  // ★ 夹具本身要非空 —— 否则下面的"输出里不含引文"会**因为引文是空串而假绿**
  assert.ok(userQuote.length > 20, `解析出的 user_quote 太短（${userQuote.length}）⇒ 排除断言会退化成空判据`);
  assert.ok(micro.length > 0, '解析出的 micro 为空');
  assert.equal(open.length, 3, `解析出的未定项应为 3 条，实得 ${open.length} 条`);

  return {
    micro,
    user_quote: userQuote,
    conclusion: '任务 = 候选任务：载体已有（overlay 锚点），缺的只是「接点」—— judgeExpectations 是现成的',
    open,
    decided_at: '2026-10-16T11:00:00+08:00',
    supersedes: 'discussion#2026-10-14--task-system-v0',
  };
}

const fixture = fixtureFromMarkdown(SECTION_1_MD);

// ─────────────────────────────────────────────────────────────
// 判据 ①：微缩只出「micro + open 计数」，user_quote 等**结构上**到不了默认视野
// ─────────────────────────────────────────────────────────────
test('invariant_checks[3]·① renderMicro 的输出键 == MICRO_KEYS（白名单外键数 == 0），且 user_quote 不在正文里', () => {
  const m = renderMicro(fixture);

  // 白名单：输出键集合与 MICRO_KEYS 逐键相等（多了 / 少了都算破坏「微缩」承诺）
  assert.deepEqual(Object.keys(m).sort(), [...MICRO_KEYS].sort(), 'renderMicro 的输出键必须恰好等于 MICRO_KEYS');
  assert.equal(
    Object.keys(m).filter((k) => !MICRO_KEYS.includes(k as (typeof MICRO_KEYS)[number])).length,
    0,
    '白名单外的键数必须为 0',
  );

  // 微缩 = 一句话（逐字不改写）+ open 计数（只给计数、不给内容）
  assert.equal(typeof m.micro, 'string');
  assert.equal(m.micro, fixture.micro, 'micro 必须逐字取 discussion.micro（不改写）');
  assert.equal(m.open_count, fixture.open?.length);

  // ★ 字段级排除：正文（序列化后）不得含被排除字段的**任一段**值
  const payload = JSON.stringify(m);
  const quoteProbes = [
    fixture.user_quote!.slice(0, 20),
    fixture.user_quote!.slice(40, 60),
    fixture.user_quote!.slice(-20),
  ];
  for (const p of quoteProbes) {
    assert.ok(p.length > 0, '探针片段不得为空（空串在任何串里都 includes ⇒ 假红/假绿）');
    assert.ok(!payload.includes(p), `微缩正文里出现了 user_quote 片段 ${JSON.stringify(p)}`);
  }
  assert.ok(!payload.includes('user_quote'), '微缩正文里出现了键名 user_quote');
  assert.ok(!payload.includes(fixture.conclusion!.slice(0, 20)), '微缩正文里出现了 conclusion');
  assert.ok(!payload.includes(fixture.supersedes!), '微缩正文里出现了 supersedes 的值');
  assert.ok(!payload.includes(fixture.decided_at!), '微缩正文里出现了 decided_at 的值');

  // 「我排除了什么」是可查读数（键名，不是内容）
  const excluded = excludedFields(fixture);
  assert.deepEqual(
    [...excluded].sort(),
    [...EXPAND_ONLY_FIELDS].sort(),
    'fixture 把 EXPAND_ONLY_FIELDS 全部填了 ⇒ excludedFields 必须全报出来',
  );
});

// ─────────────────────────────────────────────────────────────
// 判据 ②：shouldExpand 三种触发机器可判（正例 3 + 反例 4）
// ─────────────────────────────────────────────────────────────
test('invariant_checks[3]·② shouldExpand 三种触发 == true（claim / judge-failed / explicit）', () => {
  assert.deepEqual([...EXPAND_TRIGGERS], ['claim', 'judge-failed', 'explicit'], '三触发清单是穷举的');

  const positives: Array<[string, Parameters<typeof shouldExpand>[1]]> = [
    ['claim（闸内领取该卡时）', { claiming: true }],
    ['judge-failed（判失败需裁决时）', { judgeFailed: true }],
    ["explicit（expand='discussion'）", { expand: 'discussion' }],
  ];
  for (const [label, ctx] of positives) {
    assert.equal(shouldExpand(fixture, ctx), true, `触发 ${label} 必须展开`);
  }

  // 多触发同时命中 ⇒ 仍然 true（不是"只能一个"）
  assert.equal(shouldExpand(fixture, { claiming: true, judgeFailed: true, expand: 'discussion' }), true);
});

test('invariant_checks[3]·② 无触发 == false（默认只出微缩），discussion 为空 == false', () => {
  const negatives: Array<[string, Parameters<typeof shouldExpand>[1]]> = [
    ['无触发（默认）', {}],
    ['三个都显式否定', { claiming: false, judgeFailed: false, expand: null }],
    ["expand 是别的值（'all'）—— 逐字比较，别的值不算触发", { expand: 'all' }],
    ['ctx 缺省', undefined],
    ['ctx 为 null', null],
  ];
  for (const [label, ctx] of negatives) {
    assert.equal(shouldExpand(fixture, ctx), false, `${label} ⇒ 必须不展开`);
  }

  // 没有登记 ⇒ 无可展开，与触发条件无关（三种触发逐个验，不是只验一个）
  assert.equal(shouldExpand(undefined, { claiming: true }), false);
  assert.equal(shouldExpand(null, { judgeFailed: true }), false);
  assert.equal(shouldExpand(null, { expand: 'discussion' }), false);
  assert.equal(shouldExpand(null, undefined), false);
});
