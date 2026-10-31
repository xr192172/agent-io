#!/usr/bin/env node
/**
 * ★★★ 2026-10-28：**工具 × 测试 的覆盖盘点** —— 把"哪些工具没账"从感觉变成读数。
 *
 * ## 为什么需要它
 * 本仓纪律：**行为断言是账**（"写而无人读 = 等于没写"的兄弟条款：**写了没人验 = 等于没验**）。
 * 但只要没人机械数一遍，就会出现"215KB 的翻译子系统一条断言都没有"这种大块欠账 —— 而且**没人知道**。
 *
 * ## 口径（诚实写在最前面：这是个**上界**）
 * "有测试" = 在 `tests/*.test.ts` 的**文本里出现过该工具名**。
 * ⇒ **提到 ≠ 验过**：一条测试可能只是名字出现在注释里。所以本表的意义是
 *   **"没提到的必定没验"**（那一侧很硬），"提到了的"仍需人工确认验得够不够。
 * ★ 反过来也成立：无测试清单是**可靠的欠账清单**（名字都没出现，绝不可能验过）。
 * ★ 2026-10-31：本脚本原先读 `certs/*.mjs`（第三套验证），该目录已整目录退役 ⇒ 改读 `tests/`
 *   （唯一的行为断言处）。文件名保留（`docs/todo.md#T-#CERT-1` 与历史 commit 都按它引用），
 *   但它现在数的是**测试覆盖**。
 *
 * ## 用法
 *   node scripts/audit-tool-certs.mjs            # 打印读数
 *   node scripts/audit-tool-certs.mjs --json     # 机器读
 *
 * ## 判据（不设阈值、不设棘轮 —— 本仓规矩："不加新门"）
 * 它只**报读数**，不失败、不拦提交。要不要给某个工具建证，是人按风险排的：
 * **破坏性工具（move / delete / upgrade）优先于生成性工具（translate）**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从编译产物里读**运行时注册表**（唯一权威来源） */
async function loadRegistryNames(regFile) {
  const mod = await import(pathToFileURL(regFile).href);
  const defs = mod.TOOL_DEFS;
  if (!Array.isArray(defs)) throw new Error('注册表里没有 TOOL_DEFS');
  return defs.map((t) => t.name);
}

/**
 * 收集工具名 —— ★★ 2026-10-28（量具修正）：**从注册表取真源**，不再正则扫源码。
 *
 * ## 为什么改（量具不准 ⇒ 一切基于它的判断都错）
 * 原来用 `/^\s*name:\s*'…',\s*$/` 扫全 `src/` ⇒ 把**非工具**的 `name:` 也算了进来：
 * · `src/domain/chain_wiring.ts` 里 `name: 'refactor'`（链路名）
 * · `src/domain/expectation_kinds.ts` 里 `name: 'cases'`（判据字段名）
 * ⇒ 实测报「57 个工具」，而 `TOOL_DEFS` 只有 **55** 个。
 * ★ 这正是本仓记过账的病：**量具不全 ⇒ 判断全错**。工具的权威定义只有一处 = 注册表。
 */
async function collectTools() {
  const found = new Map();
  // ① 权威名单：编译产物里的注册表（跑本脚本前需 npm run build）
  const regFile = path.join(ROOT, 'dist/src/application/tool_registry.js');
  if (!fs.existsSync(regFile)) {
    throw new Error('缺 dist 注册表：先 `npm run build`（本审计以注册表为真源，不再正则扫源码）');
  }
  // ★ 权威名单 = 运行时注册表本身（不是正则猜源码）
  const names = await loadRegistryNames(regFile);
  // ② 顺带标记每个工单的**定义文件**（只为报表可读，不参与判定）
  const where = new Map();
  const walk = (dir) => {
    for (const n of fs.readdirSync(dir)) {
      const p = path.join(dir, n);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      if (!n.endsWith('.ts')) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (!text.includes('inputSchema')) continue; // ★ 只认"像工具定义"的文件
      for (const m of text.matchAll(/^\s*name: '([a-z][a-z0-9_]+)',\s*$/gm)) {
        if (!where.has(m[1])) where.set(m[1], path.relative(ROOT, p));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  for (const n of new Set(names)) found.set(n, where.get(n) ?? '(dist)');
  return found;
}

const tools = await collectTools();
// ★ 2026-10-31：读 `tests/*.test.ts`（`certs/` 已整目录退役）。目录读不到 ⇒ 空着并说明（0.12）。
const testsDir = path.join(ROOT, 'tests');
const testText = fs.existsSync(testsDir)
  ? fs
      .readdirSync(testsDir)
      .filter((n) => n.endsWith('.test.ts'))
      .map((n) => fs.readFileSync(path.join(testsDir, n), 'utf8'))
      .join('\n')
  : '';

const noCert = [];
const mentioned = [];
for (const [name, file] of [...tools.entries()].sort()) {
  const hit = new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, 'm').test(testText);
  (hit ? mentioned : noCert).push({ name, file });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: tools.size, mentioned: mentioned.length, no_test: noCert }, null, 2));
  process.exit(0);
}

console.log(`工具（去重）= ${tools.size} · 测试里提到过 = ${mentioned.length} · **无测试提到 = ${noCert.length}**`);
console.log(`（口径：提到 ≠ 验过；但**没提到的必定没验** ⇒ 无测试清单是可靠的欠账清单。读的是 ${path.relative(ROOT, testsDir)}/*.test.ts）\n`);
for (const t of noCert) console.log(`  · ${t.name.padEnd(28)} ${t.file}`);
