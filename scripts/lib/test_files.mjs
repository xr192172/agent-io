import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 测试文件清单（`tests/` 下**递归**的 `*.test.ts`），返回**相对 `tests/` 的路径**。
 *
 * ★★ **唯一实现（0.9.1）**：`scripts/run-tests.mjs`（测试门的口径）与
 *   `scripts/verify-changed.mjs`（增量内环的口径）**都调这里**，谁也不许再自己 walk 一遍。
 *
 * ★ 为什么必须抽出来（2026-11-05 实测）：两者原先各写一份 ——
 *   `run-tests` **递归**（85 个）、`verify-changed` **只扫顶层**（82 个），
 *   而 `verify-changed.mjs` 的注释还写着「收集规则与 `scripts/run-tests.mjs` 一致」——
 *   **注释在撒谎**，后果是 `tests/budget/` · `tests/locate/` · `tests/rate/` 三个文件
 *   **在内环里永远选不中，而它自己不知道**（少跑 = 假绿的入口）。
 *   同一个坑 `run-tests.mjs` 在 2026-11-02 已经踩过并修过，只是没修另一处。
 *
 * ★ 只有 `.test.ts` 才进清单 ⇒ `fixtures/budget-proj/generate.ts`（夹具生成器）不会混进用例。
 * ★ 排除 `node_modules` / `.git`（`tests/` 下不该有，但扫到就死循环）。
 * ★ 排序保证**确定性**（同样输入两次结果逐字相同 —— 0.16 的"连跑两次必须同结论"）。
 */
export function collectTestFiles(testsDir) {
  if (!existsSync(testsDir)) return [];
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(path.join(testsDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(r);
        continue;
      }
      if (e.name.endsWith('.test.ts')) out.push(r);
    }
  };
  walk('');
  return out.sort();
}
