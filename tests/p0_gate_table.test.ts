/**
 * 钉住「门表账本」与 `GATES` 实现**一致** —— 防止有人悄悄删门 / 加门而不改账本。
 *
 * ## 为什么需要（2026-10-31 第七轮独立复核抓到）
 * `docs/GUIDE-GATE.md` 的门表与 `scripts/verify.mjs` 的 `GATES` 是**同一件事的两份真相**。
 * 实测过的两种死法：
 *  ① **删掉一整道门**（把「文档与事实」从 `GATES` 拿掉）⇒ `npm run verify` 报 `全部 9 道门通过` EXIT=0，
 *     没有任何东西会响 —— 第六轮刚补上的那个洞可以被静默重开；
 *  ② 门表**漏一行**（漏「文档与事实」）⇒ 读账本的人以为一共 9 门。
 * ⇒ 所以这里钉两条：**门名集合必须与期望一致**、**门表顺序必须与 `GATES` 一致**。
 *
 * ## 口径
 * · 静态解析两处源码/文档（**不 import** `verify.mjs` —— 它一被 import 就会跑全部门）；
 * · 任一处不同 ⇒ 红，并逐条打印"账本有 / 实现有"的差集。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY = path.join(ROOT, 'scripts', 'verify.mjs');
const GUIDE = path.join(ROOT, 'docs', 'GUIDE-GATE.md');

/**
 * ★ 期望的门名与顺序 —— **这里是第三份真相，但它是有意的**：
 * 它是"人确认过的清单"，改动任何一门都必须同时改这三处（实现 / 门表 / 这里），
 * 否则本测试红。若你觉得三份太多：删掉本测试就等于放弃"删门会被发现"，二选一。
 */
const EXPECTED = [
  'ts 类型',
  'MCP 工具签名',
  'Go 编译',
  'Go 静态检查',
  '实现夹具',
  '设计 DB 结构',
  '设计册判据',
  '判据突变',
  '文档与事实',
  '测试',
];

function gateNames() {
  const src = fs.readFileSync(VERIFY, 'utf8');
  const start = src.indexOf('const GATES = [');
  assert.notEqual(start, -1, 'verify.mjs 里找不到 `const GATES = [`');
  const end = src.indexOf('\n];', start);
  assert.notEqual(end, -1, 'GATES 数组没有闭合的 `];`');
  const body = src.slice(start, end);
  // ★ 第一门是**惰性函数引用** `tsGate,`（它的 `name:` 在函数体里、不在数组字面量里）⇒ 单独补
  const lazy = /\btsGate\b/.test(body) ? ['ts 类型'] : [];
  // 其余门的 `name:` 可能与 `{` 同行，所以**不能**要求行首
  const names = [...body.matchAll(/\bname:\s*'([^']+)'/g)].map((m) => m[1]);
  return [...lazy, ...names];
}

function tableNames() {
  const md = fs.readFileSync(GUIDE, 'utf8');
  // 门表行形如：`| 3 | Go 编译 | ...`
  const rows = [...md.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/gm)].map((m) => m[2]);
  // 排除退出码表（它的第一列是 0/1/2 且第二列是整句），只留门表：名字里不含空格长句、且编号从 1 连续
  const numbered = [...md.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/gm)]
    .filter((m) => Number(m[1]) >= 1 && Number(m[1]) <= 20)
    .map((m) => m[2]);
  return { all: rows, numbered };
}

test('GATES 的门名与顺序 == 期望清单（删门/加门必须同时改三处）', () => {
  const got = gateNames();
  assert.deepEqual(
    got,
    EXPECTED,
    `GATES 与期望不一致：\n  实现有：${JSON.stringify(got)}\n  期望是：${JSON.stringify(EXPECTED)}\n` +
      '⇒ 若是**故意**改门：实现 / docs/GUIDE-GATE.md 门表 / 本测试的 EXPECTED 三处一起改。',
  );
});

test('GUIDE-GATE 门表的门名与顺序 == GATES（账本必须与实现同一份真相）', () => {
  const got = gateNames();
  const table = tableNames().numbered;
  assert.ok(table.length >= got.length, `门表只解析到 ${table.length} 行，而 GATES 有 ${got.length} 门 ⇒ 账本漏行`);
  const head = table.slice(0, got.length);
  assert.deepEqual(
    head,
    got,
    `门表与 GATES 不一致：\n  门表：${JSON.stringify(head)}\n  实现：${JSON.stringify(got)}\n` +
      '⇒ 改门必须同批改 `docs/GUIDE-GATE.md` 的门表（顺序也一致）。',
  );
});

test('门表不写死"门数"这类会漂的计数（0.10 / 目标⑤）', () => {
  const md = fs.readFileSync(GUIDE, 'utf8');
  // 门表标题/正文里出现「N 道门 / N 门」且附近没有"由命令打印 / 别抄数字"限定 ⇒ 红
  // ★ 排除小节号（`### 4.7 门的输入` 会被 naive 正则误判成"7 门"）—— 与 lint 规则 E 同一批误报源
  const bad = [...md.matchAll(/(?<![\d.])(\d+)\s*(道门|门)/g)]
    .filter((m) => {
      const at = m.index ?? 0;
      const near = md.slice(Math.max(0, at - 120), at + 120);
      return !/(由命令|自打印|别抄数字|见 `GATES`|数量由)/.test(near);
    })
    .map((m) => m[0]);
  assert.deepEqual(bad, [], `门表里还有写死的门数：${JSON.stringify(bad)} ⇒ 改成"由 GATES 现算"`);
});
