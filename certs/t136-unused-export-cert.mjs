#!/usr/bin/env node
/**
 * cert T136 —— **`unused_export` 的"表达式位置调用"盲区**（2026-10-15 修，用户裁定「堵」）。
 *
 * ## 病（最小复现，唯一变量对照）
 *   · `ch_fix`：调用写在【表达式位置】（模块顶层 `const VALUE = usedTwo();`）
 *     ⇒ 旧版报 `provider.ts:1 usedTwo`（**假阳**：consumer 明明 import 且调用了）。
 *   · `ch_ctl`：**只把调用挪进函数体**（其余一字不改）⇒ 不报。
 *   ⇒ 归因唯一：**"调用写在表达式里"那种边漏了**（不是"跨文件解析坏了"）。
 *   ★ 旧判据错在哪（代码级）：`traverseAndExtractCalls` 的模块顶层支要求
 *     `isCallNode(child)` —— 而 `const VALUE = usedTwo();` 的顶层语句是**声明**，
 *     调用在它的**初始化器**里 ⇒ 直接抓不到。
 *
 * ## 判据（三态，T136 原文给的；★ 只"减少误报"不算过，"不再报了"更不算过）
 *   ① `usedTwo`（表达式位置调用）**不许再报**；
 *   ② `neverCalledAnywhere`（真死代码）**仍要报**；
 *   ③ `getValue`（真无引用）**仍要报**。
 *   ④ 对照组 `ch_ctl` 的三态**与改前一致**（修的是盲区，不是放宽判定）。
 *   ⑤ Python 侧同一概念（顶层 `VALUE = used_py()`）一并成立。
 *
 * ★ 真仓读数（2026-10-15，本证之外的点时读数，**不进判据**——它会随仓漂移）：
 *   改前 `unused_export=170` ⇒ 改后 **104**（−66 假阳；`orphan_file` 484→481）。
 *   ★ 判据是"**不是骤降到 0**"（那才会是"不再报了"= 修坏）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

// ★ 只读 dist（与 t316 同款）—— 证书**不改**构建产物；改了 src 请先 `npm run build`。
const { analyzeHealth } = require(path.join(REPO, 'dist/src/infrastructure/analysis/health/index.js'));

const BASE = path.join(HERE, '.work/tmp-t136');
let P = 0;
let F = 0;
const check = (name, ok, detail) => {
  if (ok) P++;
  else F++;
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  —— ${detail}` : ''}`);
};

const PROVIDER = `export function usedTwo(): number { return 2; }\n`;
const DEAD = `export function neverCalledAnywhere(): number { return 9; }\n`;
const CASES = {
  // ★ 病态：调用在【表达式位置】（变量初始化器、模块顶层）
  ch_fix: {
    'provider.ts': PROVIDER,
    'consumer.ts': `import { usedTwo } from './provider';\nconst VALUE = usedTwo();\nexport function getValue(): number { return VALUE; }\n`,
    'dead.ts': DEAD,
  },
  // ★ 对照：只把调用挪进函数体（其余一字不改）
  ch_ctl: {
    'provider.ts': PROVIDER,
    'consumer.ts': `import { usedTwo } from './provider';\nexport function getValue(): number { return usedTwo(); }\n`,
    'dead.ts': DEAD,
  },
  // ★ 同概念的 Python 侧（顶层 `VALUE = used_py()` 的顶层语句也是"声明"，不是 call 节点）
  py_fix: {
    'provider.py': `def used_py():\n    return 2\n`,
    'consumer.py': `from provider import used_py\nVALUE = used_py()\n\ndef get_value():\n    return VALUE\n`,
    'dead.py': `def never_called():\n    return 9\n`,
  },
  // ★ 盲区「带 parent 的方法」（T136 标题里的**第二处**；正文自述它与 T4 是两回事，
  //   T4 已于 2026-10-04 修了"取 callee_expr 第一段（receiver 根）再查"那条兜底 ⇒ 此处**复量它是否真已闭**）
  parent_call: {
    'helper.ts': `export class Helper {\n  static twice(n: number): number { return n * 2; }\n}\n`,
    'consumer.ts': `import { Helper } from './helper';\nexport function useIt(): number { return Helper.twice(3); }\n`,
    'dead.ts': `export function neverCalledAnywhere(): number { return 9; }\n`,
  },
};

/** 跑一个夹具 ⇒ 返回 `unused_export` 的符号名集合。 */
async function readCase(name) {
  const dir = path.join(BASE, name);
  const files = CASES[name];
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c, 'utf8');
  const rep = await analyzeHealth(dir, {});
  return new Set(rep.issues.filter((i) => i.kind === 'unused_export').map((i) => i.symbol));
}

console.log('=== T136 · `unused_export` 表达式位置调用盲区 ===');
{
  const fix = await readCase('ch_fix');
  check('① 表达式位置的调用 ⇒ **不再报假阳**（usedTwo）', !fix.has('usedTwo'), [...fix].join(',') || '（空）');
  check('② 真死代码 ⇒ **仍报**（neverCalledAnywhere）', fix.has('neverCalledAnywhere'), [...fix].join(','));
  check('③ 真无引用 ⇒ **仍报**（getValue）', fix.has('getValue'), [...fix].join(','));

  const ctl = await readCase('ch_ctl');
  check('④ 对照组（调用在函数体内）三态不变：不报 usedTwo', !ctl.has('usedTwo'), [...ctl].join(','));
  check('④ 对照组：仍报另外两条', ctl.has('neverCalledAnywhere') && ctl.has('getValue'), [...ctl].join(','));

  const py = await readCase('py_fix');
  check('⑤ Python 同一概念：不报 used_py（顶层 `VALUE = used_py()`）', !py.has('used_py'), [...py].join(','));
  check('⑤ Python：仍报另外两条', py.has('never_called') && py.has('get_value'), [...py].join(','));

  // ★ 第二处盲区「带 parent 的方法」（`Helper.twice(3)`）—— 复量它是否已被 T4 那条兜底闭掉
  const par = await readCase('parent_call');
  check('⑥ 带 parent 的方法（`Helper.twice(3)`）⇒ 不报假阳（Helper）', !par.has('Helper'), [...par].join(','));
  check('⑥ 同夹具里真死代码仍报', par.has('neverCalledAnywhere'), [...par].join(','));
}

try {
  fs.rmSync(BASE, { recursive: true, force: true });
} catch {
  /* 有人还在用就算了 */
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
console.log('★ 「表达式位置的调用」已建边：假阳消失、真死代码与真无引用**仍报**（减少误报 ≠ 不再报了）。');
