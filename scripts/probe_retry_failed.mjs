// 实验（T-#42）：把存量的 failed 引用**重新打开**再跑一遍当前解析器
// 假设：那 13341 条 failed 里大部分是**旧版本解析器**留下的（当前代码对带点调用走 updExternal，
//       不会标 failed）⇒ 重跑一次应该大批归位 external / resolved。
// 安全：cache.db 是派生品（.agent-io/ 已 gitignore）⇒ 先备份再改。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DB = path.join(ROOT, '.agent-io', 'cache.db');
const BAK = `${DB}.bak-before-retry-failed`;

if (!fs.existsSync(BAK)) {
  fs.copyFileSync(DB, BAK);
  console.log(`已备份 → ${path.basename(BAK)}`);
} else {
  console.log('备份已存在，复用');
}

const db = new DatabaseSync(DB);
const dist = () =>
  db.prepare('SELECT status, COUNT(*) n FROM unresolved_refs GROUP BY status ORDER BY n DESC').all();
const edges = () => db.prepare('SELECT COUNT(*) n FROM edges').get().n;

console.log('\n=== 改前 ===');
console.log('  refs  =', JSON.stringify(dist()));
console.log('  edges =', edges());

const before = db.prepare("SELECT COUNT(*) n FROM unresolved_refs WHERE status='failed'").get().n;
console.log(`\n把 ${before} 条 failed 改回 pending …`);
db.exec("UPDATE unresolved_refs SET status='pending' WHERE status='failed'");
db.close();

// 跑当前解析器（用编译产物）
const { openDb, projectCacheDbPath } = await import('file://' + path.join(ROOT, 'dist/src/infrastructure/index/db.js').replace(/\\/g, '/'));
const { resolveCrossFileCalls } = await import('file://' + path.join(ROOT, 'dist/src/infrastructure/index/symbols.js').replace(/\\/g, '/'));
const db2 = openDb(projectCacheDbPath(ROOT));
const t0 = Date.now();
const stats = resolveCrossFileCalls(db2, ROOT);
console.log(`\nresolveCrossFileCalls 耗时 = ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('  stats =', JSON.stringify(stats));

const db3 = new DatabaseSync(DB, { readOnly: true });
console.log('\n=== 改后 ===');
console.log('  refs  =', JSON.stringify(db3.prepare('SELECT status, COUNT(*) n FROM unresolved_refs GROUP BY status ORDER BY n DESC').all()));
console.log('  edges =', db3.prepare('SELECT COUNT(*) n FROM edges').get().n);
const tot = db3.prepare('SELECT COUNT(*) n FROM unresolved_refs').get().n;
const res = db3.prepare("SELECT COUNT(*) n FROM unresolved_refs WHERE resolved_node_id IS NOT NULL").get().n;
console.log(`  解析率 = ${res}/${tot} = ${((res / tot) * 100).toFixed(1)}%`);
console.log('\n=== 仍 failed 的 reference_name 前 12 ===');
for (const r of db3.prepare("SELECT reference_name, COUNT(*) n FROM unresolved_refs WHERE status='failed' GROUP BY reference_name ORDER BY n DESC LIMIT 12").all()) {
  console.log(`  ${String(r.n).padStart(4)}  ${r.reference_name}`);
}
db3.close();
