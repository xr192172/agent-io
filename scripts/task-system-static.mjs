#!/usr/bin/env node
/**
 * task-system-static.mjs —— 任务系统的结构化静态分析（只读）
 *
 * 目的（2026-10-17 用户问）：
 *   「DSL 的全貌应该也不大吧，你不能直接读整个任务系统的全貌，
 *     然后静态分析出它有什么问题吗？」
 *
 * 全貌规模：9 个源文件 ≈ 3539 行 + 设计 DSL 94KB。
 * 本脚本做的不是逐行读，而是【跨文件的结构对比】—— 那是逐行读最容易漏的地方。
 *
 * 四个检查：
 *   A. 孤儿导出：export 了、除定义处外零引用
 *   B. 同一维两处形状：path / description 各自被哪些文件读
 *   C. 静默失败：catch 块里没有 throw / 没有日志的
 *   D. 判据覆盖：expectation 的每种 kind 在判定实现里都有分支吗
 */
import fs from 'node:fs';
import path from 'node:path';

const FILES = [
  'src/domain/task_schema.ts',
  'src/domain/task_machine.ts',
  'src/domain/expectation.ts',
  'src/domain/geometry.ts',
  'src/application/design/dsl_ops/task_ops.ts',
  'src/application/design/dsl_ops/node_ops.ts',
  'src/application/patrol/task_drift.ts',
  'src/application/write_gate.ts',
  'src/domain/discussion_log.ts',
];

/** 递归收集 src 下所有 .ts 的文本（只读） */
function allSources(dir = 'src', acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) allSources(p, acc);
    else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const SRC = allSources();
const norm = (p) => p.split(path.sep).join('/');
const TEXT = new Map(SRC.map((f) => [norm(f), fs.readFileSync(f, 'utf8')]));
/** ★ 读文件 —— 路径统一走 norm，否则 Windows 下  与 / 不一致会静默读空 */
const rd = (p) => TEXT.get(norm(p)) ?? '';

// ── A. 孤儿导出 ──
const exportsFound = [];
for (const f of FILES) {
  const t = rd(f);
  for (const m of t.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
    exportsFound.push({ name: m[1], file: f });
  }
}
/** ★ 真死代码 = 全仓（含同文件）只出现在 export 定义那一行 ⇒ count<=1。
 *  ★ 第一版只数"其他文件"，把"导出但在同文件内使用"误判成孤儿（publishTask/claimTask 就是）
 *  ⇒ 那是弱孤儿（缺少外部消费方），不是死代码。两者要分开报。 */
const counts = new Map(exportsFound.map((e) => [e.name, 0]));
for (const [, t] of TEXT) {
  for (const name of counts.keys()) {
    counts.set(name, counts.get(name) + [...t.matchAll(new RegExp('\b' + name + '\b', 'g'))].length);
  }
}
const dead = [];
const weakOrphan = [];
for (const { name, file } of exportsFound) {
  const c = counts.get(name) || 0;
  if (c <= 1) dead.push({ name, file, count: c });
  else if (c === 2) weakOrphan.push({ name, file, count: c });
}

// ── B. 同一维两处形状：path vs description ──
const shapeReaders = { path: [], description: [] };
for (const [f, t] of TEXT) {
  const p = (t.match(/\.path\b/g) || []).length;
  const d = (t.match(/\.description\b/g) || []).length;
  if (p) shapeReaders.path.push(`${f}(${p})`);
  if (d) shapeReaders.description.push(`${f}(${d})`);
}

// ── C. 静默失败：catch 块里没有任何动作 ──
const silentCatches = [];
for (const f of FILES) {
  const t = rd(f);
  const lines = t.split('\n');
  lines.forEach((ln, i) => {
    if (!/\bcatch\s*\(/.test(ln)) return;
    // 看 catch 开始后 6 行内有没有 throw / console / log / 赋值给错误变量
    const win = lines.slice(i, i + 7).join('\n');
    if (!/throw|console\.|logger|warn|error\s*=|\.push\(/.test(win)) {
      silentCatches.push({ file: f, line: i + 1, code: ln.trim() });
    }
  });
}

// ── D. 判据覆盖：expectation.kind 每种的判定分支 ──
let kinds = [];
for (const f of FILES) {
  const t = rd(f);
  const m = t.match(/EXPECTATION_KINDS\s*=\s*\[([^\]]+)\]/);
  if (m) kinds = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const judgeFile = 'src/application/design/intent/expectations.ts';
const judgeText = rd(judgeFile);
const covered = kinds.filter((k) => new RegExp(`case\\s+'${k}'`).test(judgeText));
const uncovered = kinds.filter((k) => !covered.includes(k));

// ── 输出 ──
const emptyFiles = FILES.filter((f) => rd(f).length < 100);
if (emptyFiles.length) {
  console.error('★ 自检失败：这些文件读不到内容（路径问题）⇒ 下面的 0 全是假绿，拒绝输出报告：', emptyFiles);
  process.exit(2);
}
console.log('════ 任务系统静态分析 ════');
console.log(`扫描 ${FILES.length} 个文件 / 全仓 ${SRC.length} 个 .ts\n`);

console.log(`【A1】真死代码（全仓只出现在定义行）：${dead.length} 个`);
for (const o of dead) console.log(`  · ${o.name}  ${o.file}  (出现 ${o.count} 次)`);
console.log(`
【A2】弱孤儿（有引用但只 2 次 ⇒ 可能缺外部消费方）：${weakOrphan.length} 个`);
for (const o of weakOrphan.slice(0, 12)) console.log(`  · ${o.name}  ${o.file}`);

console.log(`\n【B】同一维两处形状：path 被 ${shapeReaders.path.length} 个文件读 / description 被 ${shapeReaders.description.length} 个文件读`);
console.log(`  path:        ${shapeReaders.path.join(' , ')}`);
console.log(`  description: ${shapeReaders.description.join(' , ')}`);
const both = shapeReaders.path.filter((x) => shapeReaders.description.some((y) => y.split('(')[0] === x.split('(')[0]));
console.log(`  ★ 两个都读的文件（潜在"取哪个"不一致）：${both.join(' , ') || '无'}`);

console.log(`\n【C】静默 catch（catch 后 6 行内无 throw/日志/记录）：${silentCatches.length} 处`);
for (const s of silentCatches.slice(0, 10)) console.log(`  · ${s.file}:${s.line}  ${s.code}`);

console.log(`\n【D】判据覆盖：EXPECTATION_KINDS ${kinds.length} 种，判定实现覆盖 ${covered.length} 种`);
if (uncovered.length) console.log(`  ★ 未覆盖：${uncovered.join(', ')}`);

console.log('\n★ 说明：A/B/C/D 都是【可指认】的读数，不是推测。');
