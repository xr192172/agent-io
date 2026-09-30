/**
 * tool_sources —— 「工具定义在哪些文件里」的【唯一实现】
 *
 * ★ 为什么有这个文件（P1b，2026-09-28 的现场教训）：
 *   67 条工具定义原先全在 `src/server_registry.ts` 里，于是**两个门都写死读那一个文件**：
 *     · `readme_tools_gate.mjs`       —— 数工具数（README「共注册 N 个」）
 *     · `contract_docs_gate.mjs`      —— 对比 HEAD 找「新增契约 / 改名残留」
 *   P1b 把条目按能力线搬进 `src/registry/lanes/*.ts` 之后：
 *     · 前者扫出 **0 个工具**、直接把一次全绿回归打成红的；
 *     · 后者更凶 —— `cur` 空而 `prev` 有 67 个 ⇒ 会把 **67 个工具全判成"改名残留未清"**，
 *       在 CI 里报一堆假残留。
 *   ⇒ 门跟着被搬走的代码一起失效了。这不是"忘改一行"，是**知识散在两处**的老毛病再现。
 *
 * ★ 本模块的两条纪律：
 *   1. **扫目录，不写死文件清单** —— 再搬、再拆、再加 lane 都不用改门。
 *   2. **只此一份**：两个门都 import 这里，不允许再各自维护一份路径知识。
 *
 * 语义边界：只收集**工具定义**所在处（注册表 + lanes）。内核 / 各工具实现 / 其它模块都不算，
 * 否则 `name: 'xxx'` 会把一堆无关字面量算成工具名。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * 工具定义所在的文件（仓库根相对路径，posix，已排序）。
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function toolSourceRelPaths(repoRoot) {
  const out = [];
  // ★ 2026-09-30（搬 ⑥/⑦）：这两处的路径都跟着搬迁变了 ——
  //   注册表：`src/server_registry.ts` → `src/presentation/mcp/server_registry.ts`
  //   lane：  `src/registry/lanes/<线>.ts` → `src/application/<线>/index.ts`
  //   ★ 依旧是**扫目录/按约定 glob**，不写死 6 个文件名（加了第七条线这里自动跟上）。
  const registry = 'src/presentation/mcp/server_registry.ts';
  if (existsSync(path.join(repoRoot, ...registry.split('/')))) out.push(registry);
  const appDir = path.join(repoRoot, 'src', 'application');
  if (existsSync(appDir)) {
    for (const lane of readdirSync(appDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()) {
      const rel = `src/application/${lane}/index.ts`;
      if (existsSync(path.join(repoRoot, ...rel.split('/')))) out.push(rel);
    }
  }
  return out;
}

/**
 * 拼接读出的工具定义源码。**注意**：拼接后再用 `name:` 正则扫描，
 * 与旧实现（只读一个文件）同语义 —— 调用方无须改动其提取逻辑。
 * @param {string} repoRoot
 * @returns {string}
 */
export function readToolSources(repoRoot) {
  const parts = [];
  for (const rel of toolSourceRelPaths(repoRoot)) {
    try {
      parts.push(readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf-8'));
    } catch {
      /* 缺文件不致命：调用方对「扫出 0 个」会自行判定 */
    }
  }
  return parts.join('\n');
}
