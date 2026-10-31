/**
 * P1 · **`unused_export` 的「表达式位置调用」盲区** —— 由原证 `certs/t136-unused-export-cert.mjs` 整张迁入。
 *
 * ## 原证挡的事故（最小复现，唯一变量对照）
 *   · `ch_fix`：调用写在【表达式位置】（模块顶层 `const VALUE = usedTwo();`）
 *     ⇒ 旧版报 `provider.ts:1 usedTwo`（**假阳**：consumer 明明 import 且调用了）。
 *   · `ch_ctl`：**只把调用挪进函数体**（其余一字不改）⇒ 不报。
 *   ⇒ 归因唯一：**"调用写在表达式里"那种边漏了**（不是"跨文件解析坏了"）。
 *   ★ 旧判据错在哪（代码级）：`src/infrastructure/parse/kernel.ts#traverseAndExtractCalls` 的
 *     模块顶层支只认"直接子节点是 call"—— 而 `const VALUE = usedTwo();` 的顶层语句是**声明**，
 *     调用在它的**初始化器**里 ⇒ 直接抓不到（T136 的修法：那一支改走**子树**）。
 *
 * ## 判据（三态，T136 原文给的；★ 只"减少误报"不算过，"不再报了"更不算过）
 *   ① `usedTwo`（表达式位置调用）**不许再报**；
 *   ② `neverCalledAnywhere`（真死代码）**仍要报**；
 *   ③ `getValue`（真无引用）**仍要报**；
 *   ④ 对照组 `ch_ctl` 的三态**与改前一致**（修的是盲区，不是放宽判定）；
 *   ⑤ Python 侧同一概念（顶层 `VALUE = used_py()`）一并成立；
 *   ⑥ 第二处盲区「带 parent 的方法」（`Helper.twice(3)`）—— 复量它是否已被 T4 那条兜底闭掉。
 *
 * ## 原证断言 → 本文件用例（一条不删，9 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ① 表达式位置的调用 ⇒ 不再报假阳（`usedTwo`） | `① ch_fix` |
 * | ② 真死代码 ⇒ 仍报（`neverCalledAnywhere`） | `① ch_fix`（第 2 条 assert） |
 * | ③ 真无引用 ⇒ 仍报（`getValue`） | `① ch_fix`（第 3 条 assert） |
 * | ④ 对照组：不报 `usedTwo` / 仍报另外两条 | `④ ch_ctl`（2 条 assert） |
 * | ⑤ Python：不报 `used_py` / 仍报另外两条 | `⑤ py_fix`（2 条 assert） |
 * | ⑥ 带 parent 的方法不报假阳 / 同夹具真死代码仍报 | `⑥ parent_call`（2 条 assert） |
 *
 * ## ★ 消融（本文件必须能红 —— 2026-10-31 迁移时实测，两次读数都记在这里）
 *   **改哪一行**：`src/infrastructure/parse/kernel.ts` 的 T136 那一支（`traverseAndExtractCalls` 的
 *   模块顶层支），把 `if (LANG_ADAPTERS[lang.name]?.topLevelCall && funcStack.length === 0) {`
 *   改成 `… && funcStack.length === 0 && false) {`（= 退回"只认直接子节点是 call"的旧行为）。
 *   · **红读数**：`用例 2/4 失败` · exit 1 ——
 *     `① ch_fix` 红：实测报告 `getValue,neverCalledAnywhere,usedTwo`（假阳回来了）；
 *     `⑤ py_fix` 红：实测报告 `get_value,never_called,used_py`（Python 侧同断）。
 *   · **还原后**（`git diff` 里该文件消失 = 逐字节相同）⇒ **用例 4/4 · 9 条断言全绿** · exit 0。
 *
 * ## 诚实边界（与原证一致）
 *   · 断言只用**该证自己的夹具**；真仓读数（2026-10-15：`unused_export` 170 → 104）**不进判据**，
 *     因为它是仓态读数、会随仓漂移（本仓纪律：证不许抄读数）。
 *   · 夹具落在**临时目录**（`makeTempHome()`），不写仓内任何文件；`AGENT_IO_HOME` 也指到临时 home。
 *   · 本文件 import 的是 `../src/…`（与 `tests/` 其余文件同口径：**读源码不读 dist**）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { analyzeHealth } from '../src/infrastructure/analysis/health/index.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

// ★ 数据隔离：`getDataHome()` 每次调用现读 env ⇒ 这里钉死后，本文件不碰真实数据仓。
const TMP = makeTempHome();
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });
after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// 夹具（逐字搬自原证：只有目录基准从 `certs/.work` 换成临时目录）
// ════════════════════════════════════════════════════════════════════
const PROVIDER = `export function usedTwo(): number { return 2; }\n`;
const DEAD = `export function neverCalledAnywhere(): number { return 9; }\n`;
const CASES: Record<string, Record<string, string>> = {
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
  // ★ 盲区「带 parent 的方法」（T136 标题里的**第二处**；T4 的兜底是否真已闭它 —— 复量）
  parent_call: {
    'helper.ts': `export class Helper {\n  static twice(n: number): number { return n * 2; }\n}\n`,
    'consumer.ts': `import { Helper } from './helper';\nexport function useIt(): number { return Helper.twice(3); }\n`,
    'dead.ts': `export function neverCalledAnywhere(): number { return 9; }\n`,
  },
};

/** 跑一个夹具 ⇒ 返回 `unused_export` 的符号名集合（★ 判据落在**符号名**上，不落在条数上） */
async function unusedExportsOf(name: string): Promise<{ set: Set<string>; listed: string }> {
  const dir = path.join(TMP, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, c] of Object.entries(CASES[name] as Record<string, string>)) {
    fs.writeFileSync(path.join(dir, n), c, 'utf8');
  }
  const rep = await analyzeHealth(dir, {});
  const names = rep.issues.filter((i) => i.kind === 'unused_export').map((i) => i.symbol);
  return { set: new Set(names), listed: names.join(',') || '（空）' };
}

// ════════════════════════════════════════════════════════════════════
// ① 表达式位置的调用（原证 ①②③）
// ════════════════════════════════════════════════════════════════════
test('① ch_fix：表达式位置的调用不再报假阳 · 真死代码与真无引用仍报', async () => {
  const { set, listed } = await unusedExportsOf('ch_fix');
  assert.equal(set.has('usedTwo'), false, `① 假阳回来了：\`usedTwo\` 明明被 \`const VALUE = usedTwo()\` 调用过，却报成 unused_export —— 实测报告 ${listed}`);
  assert.equal(set.has('neverCalledAnywhere'), true, `② 真死代码必须**仍报**（"不再报了"= 修坏）—— 实测报告 ${listed}`);
  assert.equal(set.has('getValue'), true, `③ 真无引用必须**仍报**（减少误报 ≠ 把判定放宽到不报）—— 实测报告 ${listed}`);
});

// ════════════════════════════════════════════════════════════════════
// ④ 对照组：只把调用挪进函数体 ⇒ 三态与改前一致（原证 ④）
// ════════════════════════════════════════════════════════════════════
test('④ ch_ctl（调用在函数体内）三态不变：不报 usedTwo · 仍报另外两条', async () => {
  const { set, listed } = await unusedExportsOf('ch_ctl');
  assert.equal(set.has('usedTwo'), false, `对照组不该报 usedTwo —— 实测报告 ${listed}`);
  assert.equal(set.has('neverCalledAnywhere') && set.has('getValue'), true, `对照组必须仍报另外两条（否则夹具本身失效）—— 实测报告 ${listed}`);
});

// ════════════════════════════════════════════════════════════════════
// ⑤ Python 同一概念（原证 ⑤）
// ════════════════════════════════════════════════════════════════════
test('⑤ py_fix：顶层 `VALUE = used_py()` 同样不再报假阳 · 另外两条仍报', async () => {
  const { set, listed } = await unusedExportsOf('py_fix');
  assert.equal(set.has('used_py'), false, `Python 侧的表达式位置调用漏边（假阳）—— 实测报告 ${listed}`);
  assert.equal(set.has('never_called') && set.has('get_value'), true, `Python 侧必须仍报另外两条 —— 实测报告 ${listed}`);
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 第二处盲区：带 parent 的方法（原证 ⑥）
// ════════════════════════════════════════════════════════════════════
test('⑥ parent_call：`Helper.twice(3)` 不报假阳 · 同夹具里真死代码仍报', async () => {
  const { set, listed } = await unusedExportsOf('parent_call');
  assert.equal(set.has('Helper'), false, `带 parent 的方法调用漏边（T4 的兜底没闭住）—— 实测报告 ${listed}`);
  assert.equal(set.has('neverCalledAnywhere'), true, `同夹具里真死代码必须仍报 —— 实测报告 ${listed}`);
});
