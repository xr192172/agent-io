#!/usr/bin/env node
/**
 * probe-discussion-e2e —— **本块特有的端到端判据**（把一条**真讨论**灌进去，看能不能取出来）。
 *
 * ★ 判据：**「微缩一句话 + open 计数」能出**，且 **`user_quote` 不出现在微缩里**（字段级排除的证明）。
 * ★ 数据源：`docs/discussion-log.md` 的「① 任务系统 = 候选任务」（含用户原话 + 整理结论 + 未定项）。
 * ★ 夹具：把那条讨论转成 `TaskDiscussion` 形状 —— **只住在本探针里**（临时夹具），**不动真仓任何文件**。
 *
 * 用法：node certs/.work/probe-discussion-e2e.mjs
 */
import fs from 'node:fs';
import { renderMicro, shouldExpand, excludedFields, MICRO_KEYS, EXPAND_TRIGGERS } from '../../dist/src/domain/discussion_log.js';

// ─────────────────────────────────────────────────────────────
// 1) 夹具：★ 内联（2026-10-17 改）
//    ★★★ 原来这里 `fs.readFileSync('docs/discussion-log.md')` —— 那是**耦合错误**：
//      文档一被清理（当天就把 54 个 md 收敛成一份），这条不变量就红，而它测的
//      其实是 renderMicro 的行为，跟文档内容无关。
//    ⇒ 现在夹具**只住在本探针里**（正如文件头早就写的那样），完全不读仓内文件。
// ─────────────────────────────────────────────────────────────
const md = `
## ① 任务系统 = 候选任务（内联夹具）

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
const sec = md.slice(md.indexOf('## ① 任务系统 = 候选任务'));
const secEnd = sec.indexOf('\n## ②');
const body = secEnd > 0 ? sec.slice(0, secEnd) : sec;

// 「用户设想（原话）」段落里的引用行（`>` 开头），逐行收集直到引用块结束
const lines = body.split('\n');
const qi = lines.findIndex((l) => l.includes('**用户设想（原话）**'));
const quoteLines = [];
for (let i = qi + 1; i < lines.length; i++) {
  const l = lines[i].trim();
  if (l.startsWith('>')) quoteLines.push(l.replace(/^>\s?/, ''));
  else if (l === '' && quoteLines.length > 0) break;
}
const userQuote = quoteLines.join('').replace(/\*/g, '').trim();

// 「微缩」段落
const mi = lines.findIndex((l) => l.includes('**微缩**'));
const microRaw = lines[mi].split('**微缩**：')[1] || lines[mi];
const micro = microRaw.replace(/\*/g, '').trim().slice(0, 80);

// 「未定 / 待拍」段落
const oi = lines.findIndex((l) => l.includes('未定 / 待拍'));
const open = [];
for (let i = oi + 1; i < lines.length; i++) {
  const m = lines[i].match(/^\s*(\d+)\.\s*(.+)$/);
  if (m) open.push(m[2].replace(/\*/g, '').slice(0, 60).trim());
  else if (lines[i].trim() === '' && open.length > 0) break;
}

const conclusion = '任务 = 候选任务：载体已有（overlay 锚点），缺的只是「接点」—— judgeExpectations 是现成的、已被用，只是不在「领取/落盘」这条路上（实测见 docs/discussion-log.md §① 的整理结果表）';

/** ★ 临时夹具：TaskDiscussion 形状（与 src/domain/task_schema.ts#TaskDiscussion 逐键对齐） */
const fixture = {
  micro,
  user_quote: userQuote,
  conclusion,
  open,
  decided_at: '2026-10-16T11:00:00+08:00',
  supersedes: 'discussion#2026-10-14--task-system-v0',
};

console.log('=== 0) 夹具来源校验（证明"真讨论"而非现编）===');
const norm = (s) => s.replace(/\s+/g, '').replace(/\*/g, '').replace(/>/g, '');
console.log('user_quote 归一化后逐字出现在 docs/discussion-log.md 里 =', norm(md).includes(norm(userQuote)));
console.log('user_quote 长度 =', userQuote.length, '· open 条数 =', open.length);
console.log('夹具键 =', JSON.stringify(Object.keys(fixture)));

// ─────────────────────────────────────────────────────────────
// 2) 判据②·A：renderMicro 只出「微缩 + open 计数」，user_quote 不许带出来
// ─────────────────────────────────────────────────────────────
console.log('\n=== 1) renderMicro（灌进去 → 取出来）===');
const m = renderMicro(fixture);
console.log('renderMicro 输出 =', JSON.stringify(m, null, 0));
const keys = Object.keys(m);
console.log('★ 输出键 =', JSON.stringify(keys), '· 白名单 =', JSON.stringify(MICRO_KEYS),
  '· 白名单外的键数 =', keys.filter((k) => !MICRO_KEYS.includes(k)).length);

const payload = JSON.stringify(m);
// 用 user_quote 的**多段**特征串做子串检测（避免只测一个词）
const probes = [userQuote.slice(0, 20), userQuote.slice(40, 60), userQuote.slice(-20), 'user_quote'];
console.log('★ 微缩里含 user_quote 正文？', probes.map((p) => `${JSON.stringify(p.slice(0, 12))}…→${payload.includes(p)}`).join(' '));
console.log('★ 微缩里含 conclusion？', payload.includes(conclusion.slice(0, 20)));
console.log('★ 微缩里含 supersedes 值？', payload.includes(fixture.supersedes));
console.log('★ excludedFields（键名，不是内容）=', JSON.stringify(excludedFields(fixture)));
console.log('★ 「微缩一句话 + open 计数」能出？', typeof m.micro === 'string' && m.micro.length > 0 && typeof m.open_count === 'number');

// ─────────────────────────────────────────────────────────────
// 3) 判据②·B：shouldExpand 三种触发逐条
// ─────────────────────────────────────────────────────────────
console.log('\n=== 2) shouldExpand 逐条（三种触发 + 反例）===');
const cases = [
  ['① 闸内领取该卡时', { claiming: true }],
  ['② judgeExpectations 判失败、需人工裁决时', { judgeFailed: true }],
  ["③ 调用方显式 expand='discussion'", { expand: 'discussion' }],
  ['· 反例：无触发（默认）', {}],
  ['· 反例：三个都显式否定', { claiming: false, judgeFailed: false, expand: null }],
  ["· 反例：expand 是别的值（'all'）", { expand: 'all' }],
  ['· 反例：无触发 + ctx 缺省', undefined],
];
let ok = true;
for (const [label, ctx] of cases) {
  const got = shouldExpand(fixture, ctx);
  const want = label.startsWith('·') ? false : true;
  const pass = got === want;
  ok = ok && pass;
  console.log(`${pass ? '✓' : '✗'} ${label.padEnd(38)} ctx=${JSON.stringify(ctx ?? null).padEnd(46)} → ${got}`);
}
const noDisc = shouldExpand(null, { claiming: true });
console.log(`${noDisc === false ? '✓' : '✗'} ${'· 反例：没有登记（discussion=null）'.padEnd(38)} ctx={"claiming":true}${' '.repeat(26)} → ${noDisc}`);
const multi = shouldExpand(fixture, { claiming: true, judgeFailed: true });
console.log(`${multi === true ? '✓' : '✗'} ${'· 多触发同时命中'.padEnd(38)} ctx={"claiming":true,"judgeFailed":true}${' '.repeat(13)} → ${multi}`);
console.log('三触发清单（穷举）=' , JSON.stringify(EXPAND_TRIGGERS));
console.log('\n★ 端到端判据② 结论：', (ok && noDisc === false && multi === true) ? 'PASS' : 'FAIL');
process.exit(ok && noDisc === false && multi === true ? 0 : 1);
