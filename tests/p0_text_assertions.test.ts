/**
 * P0 · **文本断言（`source-has`）的两个方向 + 剥注释权威 + 判定缓存失效**（T-#TEXTHAS）。
 *
 * ## 它钉的四件事（每件都是"错而没有声音"的那一类）
 * ① **`looksLikeCommentSpan` 双向**（0.14）：同义必命中（`//` / `/*`）/ 异义必不命中
 *    （`'//'` 的引号、`a /` 的除号、`/re/` 的正则 —— 正则字面量不可能以 `//` 或 `/*` 开头）。
 * ② **剥注释真的剥干净**（AST 注释区间）：拿本仓两个**现成夹具**（注释里出现、正文没有）
 *    —— `rename_file.ts` 的 `已回滚拷贝`、`daemon.ts` 的 `updateFeature` —— **剥后必须不命中**；
 *    并拿**带引号的正则字面量**（`detect_dead_imports.ts` 的 `/^import\s+['"]/`）当回归夹具：
 *    它之后的正文仍必须被正确剥（手写状态机就是在这一行失步的）。
 * ③ **消融（"删掉它能红"）**：把 AST 注释区间这一腿摘掉（用"只认 type==='comment'"的旧判据重跑同一个
 *    夹具）⇒ 必须**重新变成命中**。只测"现在绿"测不出这条腿有没有在起作用。
 * ④ **判定缓存的内核指纹**：同一个判据 + 同一个文件哈希，**内核指纹不同 ⇒ 缓存 key 必须不同**
 *    （否则"修好剥注释"之后，修之前算出的 `pass` 会被原样复用 ⇒ 修了等于没修）。
 *
 * ## 为什么住 `npm test` 而不是册里的 `behavior-cases`
 * `comments.ts` 的值 import 会 pull 进 tree-sitter ⇒ 不满足 `behavior-cases` 的 E-CRIT-006（零值 import）。
 * 所以：**纯谓词**那条判据挂册（`behavior-cases`，目标文件 `src/domain/text_strip.ts` 零 import），
 * **端到端 + 消融**这一层落在这里由 `npm test` 跑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { looksLikeCommentSpan } from '../src/domain/text_strip.js';
import { commentRangesSync, stripCommentsSync } from '../src/infrastructure/parse/comments.js';
import { prewarmKernel, parseContent } from '../src/infrastructure/parse/kernel.js';
import { getParserSync } from '../src/infrastructure/parse/loader.js';
import { judgeCacheKey, kernelFingerprintOf } from '../src/application/design/intent/judge_cache.js';
import { judgeExpectations } from '../src/application/design/intent/expectations.js';
import { KIND_SPECS } from '../src/domain/expectation_kinds.js';
import type { Expectation } from '../src/domain/expectation.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 判定链路上**必须进内核指纹**的模块（相对 `judge_cache.ts` 的说明符，与 `KERNEL_MODULES` 同形）。
 * ★ 为什么在测试里再列一遍：这张单子是"哪些模块改了会让结论变"的**判据**，
 *   把它写在测试里 ⇒ 名单漏一个，⑤ 就红；写在源码里而没有用例 ⇒ 没人知道它漏了（0.25①）。
 */
const VERDICT_PATH_MODULES = [
  './expectations',
  './judge_cache',
  '../../../domain/expectation',
  '../../../domain/expectation_kinds',
  '../../../domain/text_strip',
  '../../../infrastructure/parse/comments',
  '../../../infrastructure/parse/kernel',
  '../../../infrastructure/parse/loader',
  '../../../infrastructure/parse/probe',
] as const;
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/** 字符串 / 模板 / 正则字面量的区间 —— 这些里面的 `//` 与 `/*` **不是**注释 */
function literalRanges(file: string, src: string): Array<[number, number]> {
  const parser = getParserSync('.' + file.split('.').pop());
  if (!parser) return [];
  const out: Array<[number, number]> = [];
  const walk = (n: { type?: string; startIndex?: number; endIndex?: number; namedChildren?: unknown[] }): void => {
    if (/^(string|template_string|regex)$/.test(String(n.type ?? ''))) {
      out.push([n.startIndex ?? 0, n.endIndex ?? 0]);
      return;
    }
    for (const c of (n.namedChildren ?? []) as Array<typeof n>) walk(c);
  };
  walk(parseContent(parser, src).rootNode as Parameters<typeof walk>[0]);
  return out;
}

/** 剥注释后仍是「注释标记」的偏移个数（排除字面量内部）—— 0 = 真的剥干净了 */
function residualCommentMarks(file: string, src: string, stripped: string): number {
  const lits = literalRanges(file, src);
  const inLit = (o: number): boolean => lits.some(([a, b]) => o >= a && o < b);
  let bad = 0;
  for (let i = 0; i < stripped.length - 1; i++) {
    if (stripped[i] !== '/') continue;
    if (stripped[i + 1] !== '/' && stripped[i + 1] !== '*') continue;
    if (inLit(i)) continue;
    bad++;
  }
  return bad;
}

/**
 * 复现**修好之前**的注释定型判据（`type === 'comment'` 这一条）——
 * 只用于消融：证明"第二条判据"确实在承担东西，而不是装饰。
 */
function commentRangesOldWay(file: string, src: string): Array<[number, number]> {
  const parser = getParserSync('.' + file.split('.').pop());
  if (!parser) return [];
  const out: Array<[number, number]> = [];
  const walk = (n: { type?: string; startIndex?: number; endIndex?: number; namedChildren?: unknown[] }): void => {
    const kids = (n.namedChildren ?? []) as Array<typeof n>;
    if (/comment/i.test(String(n.type ?? ''))) {
      out.push([n.startIndex ?? 0, n.endIndex ?? 0]);
      return;
    }
    for (const c of kids) walk(c);
  };
  walk(parseContent(parser, src).rootNode as Parameters<typeof walk>[0]);
  return out;
}

function stripOldWay(src: string, ranges: Array<[number, number]>): string {
  let out = src;
  for (const [a, b] of [...ranges].sort((x, y) => y[0] - x[0])) {
    out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, ' ') + out.slice(b);
  }
  return out;
}

/** 一个只出现在**注释里**的串，剥注释后必须消失（0.14 的「异义必不命中」） */
const COMMENT_ONLY_FIXTURES = [
  { file: 'src/application/refactor/rename/rename_file.ts', needle: '已回滚拷贝' },
  { file: 'src/presentation/daemon/daemon.ts', needle: 'updateFeature' },
];

test('① looksLikeCommentSpan 同义必命中 / 异义必不命中（0.14 双向）', () => {
  // 同义：真的注释开头
  for (const head of ['//', '// x', '/*', '/** doc */', '/*\n']) {
    assert.equal(looksLikeCommentSpan(head), true, `应判为注释：${JSON.stringify(head)}`);
  }
  // 异义：不是注释开头（引号 / 除号 / 正则 / 空）
  for (const head of ['', "'", '"', '`', 'a ', 'a/', '/x', '/ /', ' /*', '*/']) {
    assert.equal(looksLikeCommentSpan(head), false, `不应判为注释：${JSON.stringify(head)}`);
  }
});

test('② 剥注释：现成夹具（只在注释里出现的串）剥后必须不命中', async () => {
  await prewarmKernel();
  let checked = 0;
  for (const { file, needle } of COMMENT_ONLY_FIXTURES) {
    const src = read(file);
    // 前提：该串**确实**在原文里（否则这条夹具是空的，测了个寂寞）
    assert.ok(src.includes(needle), `夹具前提不成立：${file} 原文里没有 ${JSON.stringify(needle)}`);
    const stripped = stripCommentsSync(file, src);
    assert.ok(stripped !== null, `${file} 取不到 AST 注释区间（判不了 ≠ 通过）`);
    assert.equal(stripped.includes(needle), false, `${file}：${JSON.stringify(needle)} 只在注释里 ⇒ 剥后必须不命中`);
    assert.equal(residualCommentMarks(file, src, stripped), 0, `${file} 剥后仍有注释标记残留`);
    checked++;
  }
  assert.equal(checked, COMMENT_ONLY_FIXTURES.length);
});

test('② 剥注释：带引号的正则字面量之后，正文仍必须被正确剥（手写状态机就是在这失步的）', async () => {
  await prewarmKernel();
  const file = 'src/infrastructure/analysis/deadcode/detect_dead_imports.ts';
  const src = read(file);
  // 回归夹具：这一行的正则里带引号（`['"]` 在字符类里，不是字符串开始）
  assert.ok(/\/\^import\\s\+\[/.test(src) || src.includes("/^import\\s+['\"]/"), '正则夹具不见了：请更新本用例');
  const stripped = stripCommentsSync(file, src);
  assert.ok(stripped !== null);
  assert.equal(residualCommentMarks(file, src, stripped), 0, '正则字面量之后出现了注释残留 ⇒ 状态机式失步');
  // 同时：正则字面量本身没被吃掉（否则"剥干净"是靠删代码换来的）
  assert.ok(stripped.includes("/^import\\s+['\"]/"), '正则字面量被误剥了');
});

test('③ 消融：摘掉「零子节点 + 文本以注释开头」这条判据 ⇒ 同一个夹具必须重新命中', async () => {
  await prewarmKernel();
  const file = 'src/domain/geometry.ts';
  const src = read(file);
  const nowRanges = commentRangesSync(file, src);
  const oldRanges = commentRangesOldWay(file, src);
  assert.ok(nowRanges !== null && oldRanges.length > 0, '两种取法都必须能跑');
  // 消融有牙：旧判据漏掉的注释块必须**明显存在**（本仓实测 24 vs 121）
  assert.ok(
    nowRanges.length > oldRanges.length * 2,
    `消融没牙：新判据 ${nowRanges.length} 个区间、旧判据 ${oldRanges.length} 个 —— 差距不足以证明第二条判据在起作用`,
  );
  // 且旧判据确实留下注释残留（这就是"假绿"的来源）
  assert.ok(residualCommentMarks(file, src, stripOldWay(src, oldRanges)) > 0, '旧判据应当留下注释残留');
  assert.equal(residualCommentMarks(file, src, stripCommentsSync(file, src) as string), 0);
});

test('④ 判定缓存：内核指纹不同 ⇒ 缓存 key 必须不同（否则修好剥注释后旧 pass 会被复用）', () => {
  const e = {
    kind: 'source-has',
    path: 'src/domain/text_strip.ts',
    must: ['looksLikeCommentSpan'],
    mustNot: [],
    why: '夹具：只要 key 里含内核指纹，两个不同指纹必须给出不同 key',
  } as unknown as Expectation;
  const h = 'deadbeef'.repeat(8);
  const k1 = judgeCacheKey(e, h, 'aaaaaaaaaaaaaaaa');
  const k2 = judgeCacheKey(e, h, 'bbbbbbbbbbbbbbbb');
  assert.notEqual(k1, k2, '同一判据 + 同一文件哈希，但内核指纹不同 ⇒ key 必须不同（否则改了判定逻辑仍命中旧结论）');
  // 反向：指纹相同 ⇒ key 相同（别把 key 写成随机的）
  assert.equal(judgeCacheKey(e, h, 'aaaaaaaaaaaaaaaa'), k1);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑤ **哪些模块进了判定内核指纹** —— 不靠读代码相信，靠扰动真打（0.25①：加了指纹就必须有检测点）
// ══════════════════════════════════════════════════════════════════════════
/**
 * 为什么这条必须有：内核指纹是"改了判定逻辑 ⇒ 旧缓存不再命中"的**唯一机制**。
 * 而"哪些模块算判定内核"是一张**手写名单** ⇒ 名单漏一个模块 = 那个模块改了结论变、key 不变 = 假绿。
 * 实测漏过两次：① 只列了 4 个模块，`comments.ts`（剥注释权威）不在里面
 *   ② 补了 `comments` 之后，它自己的 3 个传递依赖（parseContent / getParserSync / isExtSupported）
 *      与定型谓词所在模块（`domain/text_strip.ts#looksLikeCommentSpan`）仍然漏着。
 * 判据形态：**扰动名单里任一模块的内容 ⇒ 指纹必须变**；漏一个 ⇒ 该模块扰动后指纹不变 ⇒ 红。
 */
test('⑤ 内核指纹：判定链路 9 个模块逐个扰动，指纹都必须变（漏一个就是一条假绿入口）', () => {
  const base: Record<string, string> = {};
  for (const mod of VERDICT_PATH_MODULES) base[mod] = `// ${mod}\nconst a = 1;\n`;
  const clean = kernelFingerprintOf((m) => base[m] ?? '');
  for (const mod of VERDICT_PATH_MODULES) {
    const perturbed = kernelFingerprintOf((m) => (m === mod ? base[m] + '// changed\n' : base[m]));
    assert.notEqual(
      perturbed,
      clean,
      `判定链路模块 ${mod} 不在 KERNEL_MODULES 里（扰动它指纹没变）⇒ 改它就改结论、而缓存 key 不变 ⇒ 旧 pass 继续命中`,
    );
  }
  // 反向：不扰动 ⇒ 指纹稳定（别把它做成随机的）
  assert.equal(kernelFingerprintOf((m) => base[m] ?? ''), clean);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑥ **缓存 key 的字段集必须从注册表派生** —— 不是手写白名单
// ══════════════════════════════════════════════════════════════════════════
/**
 * 病史：白名单是 `kind/path/symbol/signature/must/mustNot/pattern`；后来给 `source-has` 加了
 * `includeComments`（它直接决定剥不剥注释 ⇒ 翻一下就翻结论），**白名单没跟上**
 * ⇒ 翻开关时 key 不变、旧 `pass` 继续命中。⇒ 改成从 `KIND_SPECS[kind].fields` 派生，
 * 这条用例对**每个** kind 的**每个**字段都打一针：改了它，key 必须变。
 */
test('⑥ 缓存 key：注册表里每个 kind 的每个字段改了都必须换 key（含 includeComments）', () => {
  const h = 'deadbeef'.repeat(8);
  const fp = '0123456789abcdef';
  let checked = 0;
  for (const [kind, spec] of Object.entries(KIND_SPECS)) {
    const base: Record<string, unknown> = { kind, why: '夹具' };
    spec.fields.forEach((f, i) => {
      base[f.name] = f.type === 'string[]' ? [`v${i}`] : f.type === 'boolean' ? false : `v${i}`;
    });
    if (spec.atLeastOneOf) for (const n of spec.atLeastOneOf) if (base[n] === undefined) base[n] = ['x'];
    const k0 = judgeCacheKey(base as unknown as Expectation, h, fp);
    for (const f of spec.fields) {
      const flipped = { ...base, [f.name]: f.type === 'boolean' ? true : f.type === 'string[]' ? ['zzz'] : 'zzz' };
      const k1 = judgeCacheKey(flipped as unknown as Expectation, h, fp);
      assert.notEqual(k1, k0, `${kind} 的字段 ${f.name} 没进缓存 key ⇒ 改它结论变而 key 不变 = 假绿`);
      checked++;
    }
  }
  // 分母：真的把注册表扫过一遍（不是"一个字段都没扫到"也算过）
  assert.ok(checked >= 20, `只打了 ${checked} 个字段针（应 20+）⇒ 这条判据的输入有问题，不许当通过`);
});

// ══════════════════════════════════════════════════════════════════════════
// ⑦ **`run` 抛错 ⇒ unsupported，不是 fail**（判不了 ≠ 违反）
// ══════════════════════════════════════════════════════════════════════════
test('⑦ run 的表达式抛错 ⇒ unsupported（改前记成 fail：假失败冒充真失败）', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'texthas-run-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = root;
  try {
    const report = await judgeExpectations(root, [
      { node_id: 'x', expectation: { kind: 'run', expect: '(() => { throw new Error("boom") })()', why: '夹具：表达式抛错' } } as never,
      { node_id: 'y', expectation: { kind: 'run', expect: 'false', why: '夹具：跑出来了但为假 ⇒ 这才是 fail' } } as never,
    ]);
    const v = report.items.map((i) => i.verdict);
    assert.deepEqual(v, ['unsupported', 'fail'], '抛错必须是 unsupported（判不了），只有"跑出来为假"才是 fail');
  } finally {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
