#!/usr/bin/env node
/**
 * ★★★ 2026-10-28：**工具 × 证 的覆盖盘点** —— 把"哪些工具没账"从感觉变成读数。
 *
 * ## 为什么需要它
 * 本仓纪律：**证是判据**（"写而无人读 = 等于没写"的兄弟条款：**写了没人证 = 等于没验**）。
 * 但只要没人机械数一遍，就会出现"215KB 的翻译子系统一张证都没有"这种大块欠账 —— 而且**没人知道**。
 *
 * ## 口径（诚实写在最前面：这是个**上界**）
 * "有证" = 在 `certs/*.mjs` 的**文本里出现过该工具名**。
 * ⇒ **提到 ≠ 验过**：一个证可能只是名字出现在注释里。所以本表的意义是
 *   **"没提到的必定没验"**（那一侧很硬），"提到了的"仍需人工确认验得够不够。
 * ★ 反过来也成立：无证清单是**可靠的欠账清单**（名字都没出现，绝不可能验过）。
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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 收集工具名（工具定义形如 `  name: 'tool_name',`，散在各线的 index.ts / tool.ts 里） */
function collectTools() {
  const found = new Map();
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
      const src = fs.readFileSync(p, 'utf8');
      const re = /^\s*name:\s*'([a-z][a-z0-9_]+)',\s*$/gm;
      let m;
      while ((m = re.exec(src))) if (!found.has(m[1])) found.set(m[1], path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, 'src'));
  return found;
}

const tools = collectTools();
const certText = fs
  .readdirSync(path.join(ROOT, 'certs'))
  .filter((n) => n.endsWith('.mjs'))
  .map((n) => fs.readFileSync(path.join(ROOT, 'certs', n), 'utf8'))
  .join('\n');

const noCert = [];
const mentioned = [];
for (const [name, file] of [...tools.entries()].sort()) {
  const hit = new RegExp(`(^|[^a-z0-9_])${name}([^a-z0-9_]|$)`, 'm').test(certText);
  (hit ? mentioned : noCert).push({ name, file });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: tools.size, mentioned: mentioned.length, no_cert: noCert }, null, 2));
  process.exit(0);
}

console.log(`工具（去重）= ${tools.size} · 证里提到过 = ${mentioned.length} · **无证 = ${noCert.length}**`);
console.log('（口径：提到 ≠ 验过；但**没提到的必定没验** ⇒ 无证清单是可靠的欠账清单）\n');
for (const t of noCert) console.log(`  · ${t.name.padEnd(28)} ${t.file}`);
