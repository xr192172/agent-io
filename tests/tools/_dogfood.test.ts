import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSimilarNames } from '../../src/application/refactor/rf-find/similar_names.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [
  'src/infrastructure/parse/ast_rename.ts',
  // ★ P1b（2026-09-28）：67 条工具定义已从 src/server_registry.ts（现仅 574 行）搬进 lanes/。
  //   原列里的 'src/server_registry.ts' 已扫不到工具定义了 ⇒ 换成最大的那条 lane，保持狗食信号。
  'src/registry/lanes/refactor.ts',
  'src/application/meta/view/derive_mind_map.ts',
  'src/application/harvest/slim_brick.ts',
];

it('狗食：扫描 agent-io 自身源码里的相似名聚类', async () => {
  const root = path.resolve(here, '../../');
  for (const rel of files) {
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) {
      // eslint-disable-next-line no-console
      console.log(`[skip] ${rel} 不存在`);
      continue;
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