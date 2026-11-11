/**
 * gen-facts —— 文档数字的**唯一事实源**（I5，2026-10-25；第⑬项补卡 2026-11-11 起为**薄壳**）。
 *
 * 产出（核心逻辑住 `src/application/facts.ts`，编译进 dist——本壳只做 CLI 参数/退出码）：
 *   1. docs/FACTS.json        —— 工具清单/工具数/语言矩阵/版本号/生成时间
 *   2. README.md / README.en.md 的两个 FACTS 标记块（工具数段 / 语言段）自动回写，**勿手改**
 *
 * 运行：`npm run gen-facts`          （生成/回写 FACTS.json + README 两段）
 *       `npm run gen-facts:check`    （只校验，漂移则退非 0 —— 供提交前 / CI 棘轮）
 *
 * ★★ 第⑬项补卡（2026-11-11）：**tsx 依赖消失** —— 核心逻辑抽到 src/application/facts.ts 编译进 dist
 *   （工具清单从 AST 静态解析改为 TOOL_DEFS 运行时权威——dist 里现成的数据，= MCP 面实际暴露的）。
 *   本壳 `node scripts/gen-facts.mjs` 直接跑（不再 `--import tsx`）。
 *   ★ 消费者二：`cascade.ts` 进程内 import 同一个 writeFacts（gen-facts 降级警告已消除）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 优先 dist（构建产物）；dist 不存在（首次开发）⇒ 退回 src 直跑需要 tsx——**不兜底**（响亮报错，让跑 build）
const factsDist = path.join(REPO, 'dist', 'src', 'application', 'facts.js');
if (!fs.existsSync(factsDist)) {
  console.error('✗ dist/src/application/facts.js 不存在 —— 先跑 `npm run build`（facts 核心已移进 src/application/facts.ts 编译产物）');
  process.exit(1);
}
const { writeFacts, checkFactsFresh } = await import(`file://${factsDist.replace(/\\/g, '/')}`);

const CHECK = process.argv.includes('--check');

if (CHECK) {
  const r = checkFactsFresh(REPO);
  if (!r.ok) {
    console.error('✗ 文档数字漂移：\n' + r.drift.map((d) => '  - ' + d).join('\n'));
    process.exit(1);
  }
  console.log(`✓ FACTS 与 README 数字一致（${r.summary}）`);
} else {
  const facts = writeFacts(REPO);
  console.log(`✓ docs/FACTS.json 已生成（${facts.tools.count} 工具；语言名册 ${facts.languageMatrix.rosterCount} / 本机已装 ${facts.languageMatrix.installedCount}），README 两份已回写`);
}
