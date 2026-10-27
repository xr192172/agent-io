// T-#45 验证：删掉派生缓存并重建索引，看嵌套函数有没有被收集、调用边有没有长出来
// cache.db 是派生品（.agent-io/ 已 gitignore）⇒ 先备份再删
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const DB = path.join(ROOT, '.agent-io', 'cache.db');
const BAK = `${DB}.bak-before-t45`;

const snapshot = (label) => {
  if (!fs.existsSync(DB)) { console.log(`  [${label}] cache.db 不存在`); return null; }
  const db = new DatabaseSync(DB, { readOnly: true });
  const g = (s) => db.prepare(s).get()?.n ?? 0;
  const out = {
    nodes: g('SELECT COUNT(*) n FROM nodes'),
    edges: g('SELECT COUNT(*) n FROM edges'),
    edgesCall: g("SELECT COUNT(*) n FROM edges WHERE kind='call'"),
    closure: g('SELECT COUNT(*) n FROM nodes WHERE is_closure=1'),
    failed: g("SELECT COUNT(*) n FROM unresolved_refs WHERE status='failed'"),
    resolved: g("SELECT COUNT(*) n FROM unresolved_refs WHERE status='resolved'"),
    refsCall: g("SELECT COUNT(*) n FROM unresolved_refs WHERE reference_kind='call'"),
  };
  db.close();
  console.log(`  [${label}] nodes=${out.nodes} edges=${out.edges}(call ${out.edgesCall}) is_closure=${out.closure} refs: call=${out.refsCall} resolved=${out.resolved} failed=${out.failed}`);
  return out;
};

console.log('=== 改前 ===');
const before = snapshot('before');

if (!fs.existsSync(BAK)) {
  fs.copyFileSync(DB, BAK);
  console.log(`  已备份 → ${path.basename(BAK)}`);
}
for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
  if (fs.existsSync(f)) fs.rmSync(f, { force: true });
}
console.log('  已删 cache.db（含 -wal/-shm）⇒ 下面全量重建');

process.env.AGENT_IO_HOME = ROOT;
const D = 'file:///' + path.join(ROOT, 'dist/src/').replace(/\\/g, '/');
const { importProject } = await import(D + 'infrastructure/graph/import_project.js');
const t0 = Date.now();
const r = await importProject({ project_dir: ROOT, feature: 'agent-io' });
console.log(`\nimportProject 耗时 = ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('  回执:', String(r.message ?? '').split('\n').slice(0, 3).join(' | '));

// 后台补齐（跨文件解析在索引完整后才有意义）
const { resolveCrossFileCalls } = await import(D + 'infrastructure/index/symbols.js');
const { openDb, projectCacheDbPath } = await import(D + 'infrastructure/index/db.js');
const db = openDb(projectCacheDbPath(ROOT));
const t1 = Date.now();
const st = resolveCrossFileCalls(db, ROOT);
console.log(`resolveCrossFileCalls 耗时 = ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log('  stats =', JSON.stringify(st));

console.log('\n=== 改后 ===');
const after = snapshot('after');

if (before && after) {
  console.log('\n=== 差值 ===');
  console.log(`  nodes      ${before.nodes} → ${after.nodes}  (+${after.nodes - before.nodes})`);
  console.log(`  edges      ${before.edges} → ${after.edges}  (+${after.edges - before.edges})`);
  console.log(`  edges.call ${before.edgesCall} → ${after.edgesCall}  (+${after.edgesCall - before.edgesCall})`);
  console.log(`  is_closure ${before.closure} → ${after.closure}  (+${after.closure - before.closure})`);
  console.log(`  resolved   ${before.resolved} → ${after.resolved}  (+${after.resolved - before.resolved})`);
  console.log(`  failed     ${before.failed} → ${after.failed}  (${after.failed - before.failed})`);
}

const db2 = new DatabaseSync(DB, { readOnly: true });
console.log('\n=== 剩余 failed 前 10 ===');
for (const x of db2.prepare("SELECT reference_name, COUNT(*) n FROM unresolved_refs WHERE status='failed' GROUP BY reference_name ORDER BY n DESC LIMIT 10").all()) {
  console.log(`  ${String(x.n).padStart(4)}  ${x.reference_name}`);
}
console.log('\n=== 抽样：嵌套函数进了吗（is_closure=1 的 const）===');
for (const x of db2.prepare("SELECT qualified_name, file_path, start_line FROM nodes WHERE is_closure=1 AND kind='const' LIMIT 8").all()) {
  console.log(`  ${String(x.qualified_name).padEnd(40)} ${x.file_path}:${x.start_line}`);
}
db2.close();
