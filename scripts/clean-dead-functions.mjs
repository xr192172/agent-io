#!/usr/bin/env node
/**
 * clean-dead-functions.mjs —— 用 `edit_code` 删【文件内私有 + 零调用】的死函数
 *
 * ## ⚠️⚠️⚠️ 本脚本的判据【已被实测证伪】（2026-10-19）
 * ```
 * 判据："cache.db 里该函数零 call 入边" ⇒ 认定死函数
 * 实测：按它删 84 个 ⇒ npm run build 报 103 个错
 *       ⇒ 删掉了 renderExpectationsSection / groupExpectationFails / argName 这些【活函数】
 * 根因：cache.db 的 call 边只有 7,182 条，而符号有 8,798 个
 *       ⇒ "没有入边"可能是【根本没解析出那条边】，不是"没人调用"
 * ⇒ ★ 本脚本【不要直接 --apply】。正确判据是【编译器】：
 *     删一批 → npm run build → 报错 ⇒ 那个不能删（恢复）· 不报错 ⇒ 真死
 * ```
 *
 * ## 保留它的原因
 * ① 它演示了正确调用 `edit_code(op='delete', dry_run)` 的方式
 * ② `--dry` 模式安全（只出 diff，不写盘），可用来"看符号边界"
 *
 * ## 用法
 *   node scripts/clean-dead-functions.mjs          # 干跑（只出 diff，★ 推荐）
 *   node scripts/clean-dead-functions.mjs --apply  # ★ 危险：判据不可靠，别用
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const BS = String.fromCharCode(92);
const norm = (s) => String(s ?? '').split(BS).join('/');

// ── 1. 从 cache.db 取候选：私有 + 零调用 ─────────────────────
const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
const rows = db.prepare(`
  SELECT DISTINCT n.name, n.file_path, n.start_line
  FROM nodes n
  WHERE n.kind = 'function' AND n.parent IS NULL AND n.file_path LIKE 'src/%'
    AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.kind = 'call' AND e.target = n.id)
  ORDER BY n.file_path, n.start_line
`).all();
db.close();

// ── 2. 过滤：只要"源码里没写 export"的 ─────────────────────
const candidates = [];
for (const r of rows) {
  const file = norm(r.file_path);
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) continue;
  const text = fs.readFileSync(abs, 'utf8');
  const isExported = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${r.name}\\b`).test(text);
  if (!isExported) candidates.push({ file, name: r.name, line: r.start_line });
}

console.log(`══ 私有 + 零调用的死函数：${candidates.length} 个 ══`);
console.log(`   模式：${APPLY ? '★ 真删' : '干跑（不写盘）'}`);

// ── 3. 逐个调 edit_code ────────────────────────────────────
const { editCode } = await import(pathToFileURL(path.join(ROOT, 'dist/src/application/refactor/edit/edit_code.js')).href);

let okCount = 0;
let fail = [];
for (const c of candidates) {
  try {
    const r = await editCode({
      project_dir: ROOT,
      file: c.file,
      op: 'delete',
      symbol: c.name,
      dry_run: !APPLY,
    });
    const msg = String(r.message ?? '');
    if (/语法门通过|已删除|已写入/.test(msg)) {
      okCount++;
      if (!APPLY) console.log(`  ✓ ${c.file.replace('src/', '')}  ${c.name}`);
    } else {
      fail.push({ ...c, reason: msg.slice(0, 100) });
    }
  } catch (e) {
    fail.push({ ...c, reason: String(e).slice(0, 100) });
  }
}

console.log('');
console.log(`  ✓ 成功 ${okCount} · ✗ 失败 ${fail.length}`);
if (fail.length) {
  console.log('  ── 失败清单 ──');
  for (const f of fail.slice(0, 12)) console.log(`     ${f.file.replace('src/', '')}  ${f.name}  ← ${f.reason}`);
}
if (!APPLY) console.log('\n  ★ 干跑模式：没写任何文件。确认无误后加 --apply');
