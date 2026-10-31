#!/usr/bin/env node
/**
 * 「文档与事实一致」四件套 —— 让 `npm run verify` 绿 ⇔ 全仓绿。
 *
 * ## 为什么需要它（2026-10-31 第六轮独立复核抓到的洞）
 * `lint:prose` / `gen-facts:check` / `manifest:check` / `cognition:check` 这四个断言式检查
 * 当时**都不在任何门里**：`GATES` 九项没有它们、`ci.yml` 只跑 build+verify、`pre-commit` 只跑 gen_agents。
 * 实测后果：`npm run verify` 报全绿的同时，其中三个是 **EXIT=1**（FACTS 说 55 工具而实为 44、
 * MANIFEST 有 27 个未登记条目、COGNITION.txt 根本不存在）。
 * ⇒ **verify 绿 ≠ 仓绿**。这个脚本把四个并成一道门，让"总门绿"重新等于"这些东西都验过"。
 *
 * ## 口径
 * · 每个子检查**原样执行**（`npm run <script>`，走 package.json 的唯一定义，不在这里重实现）；
 * · 任一非 0 ⇒ 本门非 0（逐个打印，先失败先看见）；
 * · **子检查缺失（script 不存在）⇒ 也算红**（0.12：读不到 ≠ 通过）。
 */
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const CHECKS = [
  ['lint:prose', '散文当结构 / 写死计数（规则 A–E）'],
  ['gen-facts:check', 'FACTS.json 与 README 的数字是否与实际一致'],
  ['manifest:check', 'MANIFEST 卷表与 `.agent-io/` 实际内容是否一致'],
  ['cognition:check', 'COGNITION.txt 是否最新（枚举源必须读 `design/*.dsl.json`）'],
];

let failed = 0;
for (const [script, what] of CHECKS) {
  const r = spawnSync('npm', ['run', script, '--silent'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true, // npm 在 Windows 上是 .cmd
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${script.padEnd(18)} ${what}`);
  if (!ok) {
    const missing = /Missing script/i.test(out);
    console.log(
      missing
        ? `       ★ package.json 里没有 \`${script}\` 这个 script ⇒ 这个检查**不存在**（不是通过）`
        : out
            .split('\n')
            .slice(-6)
            .map((l) => `       ${l}`)
            .join('\n'),
    );
  }
}

console.log(`  —— 文档与事实：${CHECKS.length - failed}/${CHECKS.length} 通过`);
process.exit(failed ? 1 : 0);
