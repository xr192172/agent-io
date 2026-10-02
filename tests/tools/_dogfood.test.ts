import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSimilarNames } from '../../src/application/refactor/rf-find/similar_names.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'src/infrastructure/parse/ast_rename.ts',
  // ★ P1b（2026-09-28）：67 条工具定义已从 src/server_registry.ts 搬进 lanes/。
  // ★★ 2026-10-02 **第二次修正**：上一版这里写的是 `src/registry/lanes/refactor.ts` ——
  //   而 lane 文件后来又从 `registry/lanes/` 搬进了 `application/<lane>/index.ts`
  //   ⇒ 那路径**根本不存在**，本测试却用 `console.log('[skip]') + continue` **静默跳过**，
  //   **哑了很久没人发现**。这正是"静默降级"长在**门自己**身上（本仓头号病）。
  //   ⇒ 两处一起修：路径改对 + **不存在就抛**（见下方）。
  'src/application/refactor/index.ts',
  'src/application/meta/view/derive_mind_map.ts',
  'src/application/harvest/slim_brick.ts',
];

it('狗食：扫描 agent-io 自身源码里的相似名聚类', async () => {
  const root = path.resolve(here, '../../');
  for (const rel of files) {
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) {
      // ★★ 2026-10-02：**不许静默跳过**。原先这里是 `console.log('[skip] …')` + `continue` ——
      //   于是上面那个已被搬迁架空的路径**哑了很久**：狗食照跑、照绿，只是**少扫一个文件**。
      //   ⇒ 改成**响亮失败**：路径要么是对的，要么本测试红。**门不许对自己降级。**
      throw new Error(
        `狗食列的文件不存在：${rel}\n` +
          `  ⇒ 要么改这里的路径，要么把该文件加回来。**不要**退回"不存在就跳过" —— 那会让狗食静默少扫。`,
      );
    }
    const src = fs.readFileSync(abs, 'utf-8');
    const clusters = await findSimilarNames(src, abs);
    // eslint-disable-next-line no-console
    console.log(`\n===== ${rel} : ${clusters.length} 个聚类 =====`);
    for (const c of clusters) {
      const lines = c.entries.map((e) => `   - ${e.name}${e.name === c.basis ? ' [basis]' : ' →改'}\n      ${e.declLine}`).join('\n');
      // eslint-disable-next-line no-console
      console.log(`[cluster #${c.id} @${c.scopeLabel}] ${c.reason}\n${lines}`);
    }
  }
});