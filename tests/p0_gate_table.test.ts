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
  // ★ 2026-11-03（wire-gates）：两道「能力已有、只差接线」的门 —— 结构意图（文件级沉默缺口 + 目录级域表对账）
  //   与无卡写账（`write_log` 第三本账）。它们此前都**只是工具 / 只是脚本**，不在任何门里跑。
  '结构意图',
  '无卡写账',
  // ★ 2026-11-04（req-gate）：第十三道门 —— 把 `AGENTS.md` 0.29⑥「派生条目无要求权」从散文变成可跑的门
  //   （此前：把设计册改回源码当前值使 drift 变绿，**没有任何机器会发现**）。
  '派生条目要求权',
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

/**
 * 只解析**门表那一个连续区块**（从第一条 `| 1 |` 起，到该表结束的空行/标题为止）。
 * ★ 为什么不用"全文件扫 1..N 连续"：文件里还有「退出码表」，它也从 `| 0 |` / `| 1 |` 开始，
 *   一旦按"全文件连续性"扫，**追加在文件末尾的幽灵门**（`| 11 | 幽灵门 |`）会被前面那张表阻断而漏检
 *   —— 2026-10-31 第八轮复核的 E-1 正是这样漏的。
 * ⇒ 先切区块，再要求**区块内编号恰好是 1..N 无缺口无多余**。
 */
function tableNames() {
  const md = fs.readFileSync(GUIDE, 'utf8');
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\|\s*1\s*\|/.test(l));
  if (start < 0) return [];
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/);
    if (!m) {
      if (rows.length > 0) break; // 表到此结束
      continue;
    }
    rows.push({ n: Number(m[1]), name: m[2] });
  }
  // 编号必须恰好 1..N（有缺口 / 有重复 / 多出来的幽灵行 ⇒ 直接报出来，不静默截断）
  const nums = rows.map((r) => r.n);
  assert.deepEqual(
    nums,
    nums.map((_, i) => i + 1),
    `门表编号不是 1..N 连续：${JSON.stringify(nums)} ⇒ 账本有缺口或顺序乱`,
  );
  return rows.map((r) => r.name);
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
  const table = tableNames();
  assert.equal(
    table.length,
    got.length,
    `门表有 ${table.length} 行、GATES 有 ${got.length} 门 ⇒ 账本不一致（多写的"幽灵门"或漏行都算）\n  门表：${JSON.stringify(table)}\n  实现：${JSON.stringify(got)}`,
  );
  assert.deepEqual(
    table,
    got,
    `门表与 GATES 不一致：\n  门表：${JSON.stringify(table)}\n  实现：${JSON.stringify(got)}\n` +
      '⇒ 改门必须同批改 `docs/GUIDE-GATE.md` 的门表（顺序也一致）。',
  );
});

test('全文件不许出现编号超出 GATES 门数的 `| N |` 行（E-1：末尾幽灵门）', () => {
  // ★ 2026-10-31（第九轮复核）：区块解析挡住了"门表末尾插一行"，但**追加到文件末尾**的幽灵行
  //   会被"区块到此结束"挡住 ⇒ 仍绿。⇒ 再补一条全文件扫描：任何 `| n |` 行的编号不得 > 门数。
  const md = fs.readFileSync(GUIDE, 'utf8');
  const n = gateNames().length;
  const over = md
    .split(/\r?\n/)
    .map((l, i) => ({ i: i + 1, m: l.match(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/) }))
    .filter((x) => x.m && Number(x.m[1]) > n)
    .map((x) => `第 ${x.i} 行：| ${x.m[1]} | ${x.m[2]} |`);
  assert.deepEqual(over, [], `有编号超过门数 ${n} 的表格行 ⇒ 多写的"幽灵门"或错表：${JSON.stringify(over)}`);
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
