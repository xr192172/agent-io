/**
 * P0 · `expected_apis` 的 **const 盲区**：`isFunctionLikeSignature` 的**双向**判据（AGENTS 0.14）。
 *
 * ## 它锁的是哪一条错（会"错而没有声音"的那种）
 * `nodes.signature` 对 `kind='const'` 存的是**整条声明文本**（`const NAME = <值>`）。
 * 想判"这个 const 的值是不是函数"，最顺手的写法是"文本里有没有 `=>` / 有没有 `(`" ——
 * **这两条都会静默误收数据常量**（本仓实测：粗筛 83 条，真函数只有 10 条）：
 *   · `OBSERVE_RULE_TABLE.map((r) => r.rule)` 含 `=>`，值是**数组**；
 *   · `{ lang: 'go', isSourceFile: (rel) => … }` 含 `=>`，值是**对象**；
 *   · `new Set([...])` / `buildDefaultLangs()` 含 `(`，值是**数据**。
 * 它们同形于"带函数实参的调用/字面量"，而"调用的返回值是不是函数"**语法证不出**
 * （`wrapData(fn)` 返回函数、`A.map(fn)` 返回数组）⇒ 判据必须是
 * **initializer 本身是函数表达式**，不是"里面出现了函数"。
 *
 * ## 两个方向都必须断言（只有第一向不具鉴别力）
 * | 方向 | 本文件断言 |
 * |---|---|
 * | 同义必命中 | 排版/写法不同（`async` / 单参裸箭头 / `function` / 泛型箭头 / 带返回类型注解）⇒ 仍判真 |
 * | 异义必不命中 | 对象字面量 / 数组 / `new Set(…)` / `map(fn)` / IIFE / 字符串 / 数字 ⇒ 必须判假 |
 *
 * ★ **消融**：把 `isFunctionLikeSignature` 改成恒 `true` ⇒ 第二向必须红（数据常量会被误收）。
 *   只有恒 `false` 能过 ⇒ 说明第一向没被覆盖；只有恒 `true` 能过 ⇒ 说明第二向没被覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  isApiSymbol,
  isExportedSymbol,
  isFunctionLikeSignature,
} from '../src/application/meta/registry/project_actual_fields.js';

/**
 * 同义必命中 —— initializer **本身**是函数表达式。
 * 每条都是 cache.db 里真实出现过的形状（或它的等价排版）。
 */
const FUNCTION_LIKE: Array<[label: string, signature: string]> = [
  ['带返回类型注解的箭头（intentMarker 实测形状）', 'const intentMarker = (path: string, desc: string): string => { const h = shortHint(desc); }'],
  ['async 箭头（wrapData 的实参形状）', 'const observeJudgeHandler = async (a) => { const events = a.events; }'],
  ['泛型箭头', 'const pick = <T>(xs: T[], i: number): T => xs[i]'],
  ['裸单参箭头', 'const toPosix = p => p.replace(/\\\\/g, "/")'],
  ['函数表达式', 'const norm = function (s) { return s.trim(); }'],
  ['async 函数表达式', 'const load = async function () { return 1; }'],
  ['无缩进 / 多余空格（只是排版不同）', 'const  f  =  ( a )  =>  a'],
  ['返回类型是函数类型', 'const curry = (f: (a: number) => number): ((b: number) => number) => (b) => f(b)'],
  ['带类型注解的声明头（顶层 `=` 必须跳过 `=>`）', 'const f: (a: number) => number = (a) => a'],
];

/**
 * 异义必不命中 —— **数据常量**（值是对象/数组/集合/标量/调用结果）。
 * ★ 每一条都能骗过"含 `=>` 或含 `(`"那种粗判据。
 */
const DATA_CONSTANT: Array<[label: string, signature: string]> = [
  ['对象字面量（COMPARABLE 实测形状）', "const COMPARABLE = { function: 'signature', class: null, type: null }"],
  ['`as const` 数组（RULE_LEVELS 实测形状）', "const RULE_LEVELS = ['error', 'warn', 'info'] as const"],
  ['字符串字面量（FNHASH_PREFIX 实测形状）', "const FNHASH_PREFIX = '@fnhash'"],
  ['`new Set(...)`：构造调用 ⇒ 值是集合，不是可调用物', "const DESIGN_DB_KINDS = new Set(['function', 'class', 'type'])"],
  ['零参构造', 'const SELF_CARRYING_TOOLS = new Set<string>()'],
  ['`A.map(fn)`：含函数实参，但值是数组', 'const OBSERVE_RULE_IDS = OBSERVE_RULE_TABLE.map((r) => r.rule)'],
  ['对象字面量里带箭头成员', "const goObservePack = { lang: 'go', isSourceFile: (rel) => rel.endsWith('.go') }"],
  ['IIFE：括号配对到末尾，`()` 不是 `=>`（LEASE_TTL_MS 实测形状）', 'const LEASE_TTL_MS = (() => { const n = Number(process.env.X); return n; })()'],
  ['工厂调用（DEFAULT_LANGS 实测形状：返回注册表实例 = 数据）', 'const DEFAULT_LANGS = buildDefaultLangs()'],
  ['`.filter(fn).length`：值是数字', 'const B_TERMS_DEBT = Object.values(B_TERMS).filter((t) => t.debt).length'],
  ['`flatMap(fn)`：值是数组', 'const TOOL_DEFS = LANE_SOURCES.flatMap(([, defs]) => [...defs])'],
  ['布尔字面量', 'const DEBUG = true'],
  ['数字字面量', 'const PORT = 2000'],
  ['正则字面量（含括号）', 'const ACTOR_RE = /^(human|agent):(?=.*[a-z0-9])[a-z0-9_-]{1,40}$/'],
  ['`path.dirname(...)`：值是字符串', 'const OBSERVE_DIR = path.dirname(fileURLToPath(import.meta.url))'],
  ['带括号的算术表达式', 'const TOTAL = (a + b) * 2'],
];

test('P0 · isFunctionLikeSignature **同义必命中**：initializer 本身是函数表达式（排版不同也判真）', () => {
  for (const [label, sig] of FUNCTION_LIKE) {
    assert.equal(isFunctionLikeSignature(sig), true, `同义必命中失败：${label} ⇒ 判成了假\n  输入：${sig}`);
  }
});

test('P0 · isFunctionLikeSignature **异义必不命中**：数据常量一律判假（含 new Set / map(fn) / 对象字面量 / IIFE）', () => {
  for (const [label, sig] of DATA_CONSTANT) {
    assert.equal(isFunctionLikeSignature(sig), false, `异义必不命中失败：${label} ⇒ 被误收成 API\n  输入：${sig}`);
  }
});

test('P0 · 截断兜底：signature 被截成 `…` 时，`(参数): 返回类型…` 仍判真（`withCallFields` 实测样例）', () => {
  // ★ 逐字取自 cache.db（`nodes.signature` 有长度上限，`=>` 被截掉了）。
  const truncated = 'const withCallFields = (shape: Record<string, unknown>): Record<string, unknown>…';
  assert.equal(isFunctionLikeSignature(truncated), true);

  // ★ 另一向：截断**不是**万能通行证 —— 截断的对象字面量 / 调用仍判假。
  assert.equal(isFunctionLikeSignature("const CONCEPTS = [ { id: 'generic', name: '泛型', explanation: '…' )…"), false);
  assert.equal(isFunctionLikeSignature('const FEATURE_EXTS = Object.fromEntries( // 注释…'), false);
  // ★ 括号没配对（截断在参数表中间）⇒ 判不了就不猜（0.12：不静默当"是"）。
  assert.equal(isFunctionLikeSignature('const f = (a: string, b: Record<string, unknow'), false);
});

test('P0 · isApiSymbol：`const` 只在函数形态时准入；function/method 恒收；未知 kind 判否', () => {
  const exp = '["export"]';
  // const：函数形态收，数据常量不收 —— 这是本卡唯一的行为变化
  assert.equal(
    isApiSymbol({ name: 'renameCSharpSymbol', kind: 'const', modifiers: exp, language: 'ts', signature: 'const renameCSharpSymbol = (args: A): B => c(a)' }),
    true,
  );
  assert.equal(isApiSymbol({ name: 'csPackage', kind: 'const', modifiers: exp, language: 'ts', signature: "const csPackage = { exts: ['.cs'] }" }), false);
  // function / method：恒收（签名就是函数签名）
  assert.equal(isApiSymbol({ name: 'fa', kind: 'function', modifiers: exp, language: 'ts', signature: 'fa(): number' }), true);
  assert.equal(isApiSymbol({ name: 'm', kind: 'method', modifiers: '["public"]', language: 'ts', signature: 'm(): void' }), true);
  // 其余 kind 不收（签名退化 ⇒ 收进来会全判「缺实现」= 假红）
  assert.equal(isApiSymbol({ name: 'T', kind: 'type', modifiers: exp, language: 'ts', signature: 'T()' }), false);
  assert.equal(isApiSymbol({ name: 'I', kind: 'interface', modifiers: exp, language: 'ts', signature: 'I()' }), false);
  // 未知 / 缺失 kind ⇒ 判否（**不给默认值**：默认值会让新 kind 静默变成"当成函数收进来"）
  assert.equal(isApiSymbol({ name: 'x', kind: 'weird', modifiers: exp, language: 'ts', signature: 'x()' }), false);
  assert.equal(isApiSymbol({ name: 'x', modifiers: exp, language: 'ts', signature: 'x()' }), false);
  // 非导出 ⇒ 一律不收（导出判定是唯一过滤器）
  assert.equal(isApiSymbol({ name: 'x', kind: 'function', modifiers: '[]', language: 'ts', signature: 'x()' }), false);
  // ★ 拆开的两问各自独立：isExportedSymbol 仍**只**判导出（不因 kind 改变口径）
  assert.equal(isExportedSymbol({ name: 'csPackage', kind: 'const', modifiers: exp, language: 'ts' }), true);
});
