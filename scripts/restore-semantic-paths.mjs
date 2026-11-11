/**
 * 一次性恢复脚本：semantic.files[].path 回填（第⑬项 Java ② cognition 崩溃的数据恢复，方案 b）
 *
 * 数据源：cache.db 的 files 表（path 列，**唯一权威**——import_project 索引产物）。
 * 匹配键：semantic.files[].id（= `file_<路径形态>` 的 id 形态）与 files.path 的对应关系
 *   —— id 形态如 `file_src_application_verify_verify_project_ts`（路径→id 的规则：/ → _、. → _、前缀 file_）。
 *   ⚠ 该形态可逆性不完美（`a-b.ts` 与 `a_b.ts` 同 id）⇒ 先按 id 反推，反推多义/失败时**跳过并统计**（不猜）。
 *
 * 用法：node scripts/restore-semantic-paths.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const BOOK = path.join(ROOT, '.agent-io', 'design', 'agent-io.dsl.json');
const CACHE = path.join(ROOT, '.agent-io', 'cache.db');
const DRY = process.argv.includes('--dry-run');

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const files = book.semantic?.files ?? [];
const db = new DatabaseSync(CACHE);
const dbPaths = new Set(db.prepare('SELECT path FROM files').all().map((r) => r.path));

/** id → 仓库相对 path（id 形态：file_<rel 替换 / . 为 _>）；用 cache.db 的 path 集合验证可逆性 */
function pathFromId(id) {
  if (typeof id !== 'string' || !id.startsWith('file_')) return null;
  const guessed = id.slice('file_'.length).replace(/_/g, (m, off) => m); // 先做纯替换，再验证
  // 直接反推：把 id 剩余部分的 `_` 逐一尝试还原为 `/` 或 `.` —— 组合爆炸 ⇒ 改为**从 dbPaths 反向构造**：
  return null;
}

// ★ 反向构造更稳：对 cache.db 每个 path，按同规则生成 id，建 id→path 映射（正射，无歧义）
// ★ 特殊映射：id 不可逆的已知条目（`-` 被替换成 `_`，反推歧义）——人工核实过的对应关系
const SPECIAL_ID_PATH = {
  file_scripts_verify_project_mjs: 'scripts/verify-project.mjs', // 盘上文件名用连字符（verify-project.mjs）
};
const idToPath = new Map();
for (const [id, p] of Object.entries(SPECIAL_ID_PATH)) idToPath.set(id, p);
for (const p of dbPaths) {
  const id = 'file_' + p.replace(/[\/.]/g, '_');
  if (!idToPath.has(id)) idToPath.set(id, p); // 同 id 多 path（歧义）⇒ 保留首个并统计
  else if (idToPath.get(id) !== p) idToPath.set(id, '__AMBIGUOUS__');
}

let restored = 0;
let skippedAmbiguous = 0;
let skippedNotFound = 0;
const restoredSamples = [];
for (const f of files) {
  if (typeof f.path === 'string' && f.path.trim() !== '') continue; // 已有 path ⇒ 不动
  const p = idToPath.get(f.id);
  if (p === '__AMBIGUOUS__') { skippedAmbiguous++; continue; }
  if (!p) { skippedNotFound++; continue; }
  f.path = p;
  restored++;
  if (restoredSamples.length < 5) restoredSamples.push({ id: f.id, path: p });
}

console.log(`semantic.files 总数 ${files.length} · 已回填 ${restored} · 歧义跳过 ${skippedAmbiguous} · 找不到 ${skippedNotFound}`);
console.log('回填样例:', JSON.stringify(restoredSamples, null, 1));
if (skippedNotFound > 0) {
  const nf = files.filter((f) => (typeof f.path !== 'string' || !f.path.trim()) && !idToPath.has(f.id));
  console.log('找不到名单（id 在 cache.db 无对应 path——需人工核）:', JSON.stringify(nf.map((f) => f.id), null, 1));
}

if (DRY) {
  console.log('--dry-run：未写盘。确认无误后去掉 --dry-run 重跑。');
} else {
  if (restored > 0) {
    fs.writeFileSync(BOOK, JSON.stringify(book, null, 2) + '\n', 'utf8');
    console.log(`✓ 已写回 ${BOOK}`);
  } else {
    console.log('无可回填条目，未写盘。');
  }
}
