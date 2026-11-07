/**
 * §9.5.5 第 1 条「纯函数契约编译」的**试点 driver**（`docs/PROJECT-DESIGN.md` §15 阶段 B）。
 *
 * ## 它为什么住在这里（不是一个随手脚本）
 * 判据④要求「§9.5 的编译器在本卡里**真的被用了**」，而 `call-exists` 的 callerId 是
 * **`<仓库相对路径>#<符号名>`**（`src/application/design/intent/expectations.ts` L666）
 * ⇒ 调用必须发生在**一个具名符号**里。匿名 arrow 拿不到 callerId ⇒ 判据无处可挂。
 * ⇒ 所以本文件有一个**具名导出** `compilePilotContract()`，它调 `compileBehaviorContracts`。
 *
 * ## 边界（§9.5.7 逐字：自动化消除的是测试的机械写法，不是独立语义预期）
 * `CONTRACT.cases[].expect` 是**人按需求写下的期望**（v2 的目标行为），
 * **不是**从当前实现跑出来抄的。「不自动填 expect」这条边界由编译器第 1/4 步把关。
 *
 * ## 用法
 *   node --import tsx scripts/pilot/behavior_pilot.mjs <夹具项目绝对路径>
 */

import { compileBehaviorContracts } from '../../src/application/design/intent/behavior_compile.js';

/**
 * 试点契约：**独立期望**（v2 目标行为），`subject` 只给 symbol。
 *
 * v2 规则（写期望时只看这句话，不看实现）：
 *   · `text` 长度 ≤ `max` ⇒ 原样返回；
 *   · 否则在 `max` 以内**最后一个空格**处截断、去掉尾部空格，再追加 `...`；
 *   · `max` 以内没有空格 ⇒ 硬切到 `max`，再追加 `...`。
 *
 * 公共签名 `truncate(text: string, max: number): string` 本次**不许变**。
 */
export const CONTRACT = {
  id: 'pilot-truncate-word-boundary',
  subject: { symbol: 'truncate' },
  intent:
    'truncate 应在词边界截断并追加省略号，而不是硬切到 max 个字符；长度不超 max 时原样返回',
  cases: [
    { given: ['hello world', 8], expect: 'hello...' },
    { given: ['ab cd ef', 5], expect: 'ab...' },
    { given: ['abcdefgh', 3], expect: 'abc...' },
    { given: ['hello', 8], expect: 'hello' },
  ],
  source: 'design',
  setupRefs: [],
};

/**
 * 用 §9.5 编译器把 {@link CONTRACT} 编到现有 `behavior-cases` 执行核上真跑。
 *
 * @param projectDir 夹具项目根（绝对路径；P37）
 * @returns 编译 + 真跑报告（`pass` / `fail` / `unsupported` + 具名的 skipped/unverified）
 */
export async function compilePilotContract(projectDir) {
  return compileBehaviorContracts([CONTRACT], { project_dir: projectDir });
}

// ── CLI 入口（只在直接执行时跑；被 import 时不跑）──────────────────
const invokedDirectly = process.argv[1] && /behavior_pilot\.mjs$/.test(process.argv[1]);
if (invokedDirectly) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('用法: node --import tsx scripts/pilot/behavior_pilot.mjs <夹具项目绝对路径>');
    process.exit(2);
  }
  const rep = await compilePilotContract(dir);
  console.log(JSON.stringify(rep, null, 2));
  console.log('── verdict ──');
  for (const it of rep.items) {
    console.log(`${it.contract_id} => ${it.verdict}${it.stage ? ` @ 第${it.stage_no}步 ${it.stage}` : ''}`);
    console.log(`  detail: ${String(it.detail).split('\n')[0]}`);
  }
  process.exit(rep.pass === rep.input ? 0 : 1);
}
