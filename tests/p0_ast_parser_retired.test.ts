/**
 * P0 · `parse/ast_parser` 兼容层已无消费者，且它那份能力**没跟着消失**（T-04-16 的「搬」那一半）
 *
 * ## 它挡的事故
 * `parse/ast_parser.ts` 是 `parse/index.ts` 的同步兼容层：几条导出里**只有 `isSupportedFile` 是自有能力**，
 * 其余是 `parseFile` 的换名/转调，以及 `index.ts` 早已有的同名重复再导出。台账判它与 `parse/index.ts`
 * 「相同」，动作分两段：**搬**（本文件所验）与 **删**（另有卡，前置是译文册重生成）。
 *
 * ## 为什么两半都要判（缺一半就是假绿）
 * 只判「没人 import 了」的话，「兼容层退场」与「能力一起消失」长得一模一样：把 `isSupportedFile` 连同
 * 两个调用点一起删掉，负半照样全绿。所以本文件同时判：
 *   ① 正半 —— `parse/index.ts` 的公开面够得着 `isSupportedFile`，且**行为**与旧实现一致（给输入看输出）；
 *   ② 负半 —— 全仓没有文件再从 `parse/ast_parser` 取东西（带分母：扫了多少个文件）。
 * ★ 本文件**不判**兼容层文件本身还在不在：删它是下一段，前置是译文册重生成（独立风险，独立卡）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isSupportedFile, parseFile } from '../src/infrastructure/parse/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** 兼容层的模块说明符（拆开拼：这个字符串本身不该被负半扫成命中） */
const LEGACY_SPECIFIER = ['parse', 'ast_parser'].join('/');
/** 负半跳过本文件自己：它的注释必须能谈论那个路径，否则说明文字与被判的东西打架 */
const SELF = 'p0_ast_parser_retired.test.ts';

function collectSources(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') || e.name.endsWith('.mts') || e.name.endsWith('.mjs')) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

test('① 正半：公开面够得着 isSupportedFile，且行为与旧实现一致', async () => {
  assert.equal(typeof isSupportedFile, 'function', 'parse/index.ts 的公开面没有再导出 isSupportedFile');
  // 旧实现的语义：`'.' + 路径末段` → isSupported()。搬歪了（比如换成 path.extname）这几条就会红。
  assert.equal(isSupportedFile('a.ts'), true, 'a.ts 应当被支持');
  assert.equal(isSupportedFile('nested/dir/b.mts'), true, '嵌套路径的 .mts 应当被支持');
  assert.equal(isSupportedFile('a.nolanguage'), false, '未注册的扩展名不应当被支持');
  // 能力还在：内核真能解析出符号名（整个内核被"搬空"时这条会红，而不只是少一个名字）
  const syms = await parseFile('x.ts', 'export function movedCapabilityProbe() { return 1; }');
  assert.ok(
    syms.some((s) => s.name === 'movedCapabilityProbe'),
    `parseFile 没解析出 movedCapabilityProbe，现取到：${syms.map((s) => s.name).join(',') || '（空）'}`,
  );
});

test('② 负半：全仓没有文件再从 parse/ast_parser 取东西（带分母）', () => {
  const files = [
    ...collectSources(path.join(REPO, 'src')),
    ...collectSources(path.join(REPO, 'tests')),
    ...collectSources(path.join(REPO, 'scripts')),
  ];
  assert.ok(files.length > 0, '一个源文件都没扫到 ⇒ 这个判据是空转（分母为 0 时不许算绿）');
  // ★ 只匹配**模块说明符**（引号包住的那个串）—— 不匹配散文：注释里谈"那个文件"是允许的，
  //   判据问的是"谁 import 它"。裸文本扫会把说明性注释也算成消费者（本判据第一版就栽在这：
  //   实测两条误报都来自本轮新写的注释，而不是任何真实 import）。
  const specifier = new RegExp(`['"][^'"\\n]*${LEGACY_SPECIFIER.replace(/[/\\]/g, '[/\\\\]')}(?:\\.js)?['"]`);
  const hits: string[] = [];
  for (const f of files) {
    if (path.basename(f) === SELF) continue;
    if (specifier.test(fs.readFileSync(f, 'utf-8'))) hits.push(path.relative(REPO, f));
  }
  assert.deepEqual(
    hits,
    [],
    `扫了 ${files.length} 个文件，仍有 ${hits.length} 个在 import ${LEGACY_SPECIFIER}：${hits.join(', ')}`,
  );
});
