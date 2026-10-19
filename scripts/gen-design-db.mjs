#!/usr/bin/env node
/**
 * gen-design-db.mjs —— **Design DB 生成器**（★ 2026-10-19 重写）
 *
 * ## 它生成什么（★ 用户的关键定义）
 * ```
 * certs/design-db/<file>.calls.json   ← 每个文件节点一份（★ 全量，641 份）
 * ```
 *
 * ## 为什么必须【全量、和实际 DB 同构】
 * 用户原话（2026-10-19）："一个是渐进式解析，一个是渐入式重写 —— 我们既要重写设计 DSL，
 * 还要重写设计 DB，再最后重写源码。"
 * ```
 * 解析（源码 → 设计）：源码 → 实际 DB → 实际 DSL → 设计 DSL（fork）
 * 重写（设计 → 源码）：设计 DSL → ★ 设计 DB → 源码
 * ⇒ 两条路的三层一一对应：实际 DB ↔ 设计 DB（同构）、实际 DSL ↔ 设计 DSL（同构）
 * ⇒ ★ 而"重写源码"需要一份【完整的设计 DB】（每个文件/符号/import/调用），
 *   不是"设计关心的那几条" —— 那几条只是设计 DB 里的 `requirements[]` 标注。
 * ```
 *
 * ## 每份的形状（与实际 DB 同构）
 * ```json
 * {
 *   "//": "Design DB · <file>",
 *   "symbols":  [{ name, kind, line, signature }],       ← 对标 cache.db nodes
 *   "imports":  [{ specifier, type_only, resolved }],     ← 对标 cache.db imports
 *   "calls":    [{ from, to }],                          ← 对标 cache.db edges(kind=call)
 *   "requirements": [{ kind, symbol, target, why }]       ← ★ 设计 DSL 的意图标注（只在设计侧有）
 * }
 * ```
 *
 * ## 唯一手写源
 * `design/<f>.dsl.json` 的 `geometry.nodes[].description`（文件路径）+ `decision.expectations`（意图）。
 * ★ 符号/import/调用的事实取自 `cache.db`（因为设计 DSL 只存"结构 + 意图"，不存符号级事实）。
 *
 * ## 用法
 *   node scripts/gen-design-db.mjs           # 生成全部
 *   node scripts/gen-design-db.mjs --check   # 只检查是否与设计一致
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const DESIGN_DIR = path.join(ROOT, '.agent-io', 'design');
const OUT_DIR = path.join(ROOT, 'certs', 'design-db');
const CHECK = process.argv.includes('--check');

const norm = (s) => String(s ?? '').replace(/\\/g, '/');
const outNameOf = (rel) => rel.replace(/^src\//, '').replace(/[\/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';

if (!fs.existsSync(DESIGN_DIR)) {
  console.error(`★ 找不到 ${DESIGN_DIR}`);
  process.exit(2);
}
const files = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json'));
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = new DatabaseSync(path.join(ROOT, '.agent-io', 'cache.db'), { readOnly: true });
const qSymbols = db.prepare("SELECT name, kind, start_line, signature FROM nodes WHERE file_path = ? AND parent IS NULL AND kind != 'file' ORDER BY start_line");
const qImports = db.prepare('SELECT source, kind, type_only FROM imports WHERE file_path = ? ORDER BY line');
const qCallsOut = db.prepare("SELECT source, target FROM edges WHERE kind = 'call' AND source LIKE ? ORDER BY target");

let written = 0;
let unchanged = 0;
let total = 0;
const problems = [];

for (const f of files) {
  const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));

  for (const n of dsl.geometry?.nodes ?? []) {
    const rel = norm(n.description);
    if (!rel.startsWith('src/')) continue;
    total++;

    let symbols = [];
    let imports = [];
    let calls = [];
    try {
      symbols = qSymbols.all(rel).map((r) => ({
        name: r.name,
        kind: r.kind,
        line: r.start_line,
        ...(r.signature ? { signature: r.signature } : {}),
      }));
      imports = qImports.all(rel).map((r) => ({
        source: r.source,
        kind: r.kind,
        ...(r.type_only ? { type_only: true } : {}),
      }));
      calls = qCallsOut.all(rel + '#%').map((r) => ({
        from: norm(r.source),
        to: norm(r.target),
      }));
    } catch (e) {
      problems.push(`${rel}: 读 cache.db 失败（${e?.message ?? String(e)}）`);
      continue;
    }

    const requirements = (n.decision?.expectations ?? [])
      .filter((e) => e.kind === 'call-exists')
      .map((e) => ({
        kind: 'call-exists',
        symbol: e.symbol,
        target: e.target,
        ...(e.why ? { why: e.why } : {}),
      }));

    // ★★★ 2026-10-19（用户："全量之后契约门失效了"）：**设计要求单独一个字段** ——
    //   `calls` 是全量的（实际 DB 的镜像，5356 条，必然全绿）；
    //   `requirements_calls` 才是"设计说必须有"的（9 条），`contract:calls` 必须读它。
    //   ★ 格式与 calls 相同（`file#symbol`），但只含 call-exists 的意图。
    const requirementsCalls = [];
    for (const e of n.decision?.expectations ?? []) {
      if (e.kind !== 'call-exists') continue;
      const fromFile = norm(e.path ?? rel);
      const home = db.prepare('SELECT file_path FROM nodes WHERE name = ? AND parent IS NULL ORDER BY (file_path = ?) DESC LIMIT 1').get(e.target, fromFile);
      if (!home) continue;
      requirementsCalls.push({
        from: `${fromFile}#${e.symbol}`,
        to: `${norm(home.file_path)}#${e.target}`,
        ...(e.why ? { why: e.why } : {}),
      });
    }

    const payload = {
      '//': `Design DB —— ${rel}（★ 全量、与实际 DB 同构；从 design/${f} 的节点生成）`,
      '//generated_by': 'scripts/gen-design-db.mjs（★ 不许手改：改了下次生成就冲掉）',
      '//source': `design/${f}`,
      symbols,
      imports,
      calls,
      ...(requirements.length ? { requirements } : {}),
      ...(requirementsCalls.length ? { requirements_calls: requirementsCalls } : {}),
    };
    const outPath = path.join(OUT_DIR, outNameOf(rel));
    const text = JSON.stringify(payload, null, 2) + '\n';
    const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
    if (old === text) {
      unchanged++;
      continue;
    }
    if (CHECK) {
      problems.push(`${outNameOf(rel)}: 与当前设计不一致（该重跑生成器）`);
      continue;
    }
    fs.writeFileSync(outPath, text);
    written++;
  }
}
db.close();

let pruned = 0;
if (!CHECK) {
  const expected = new Set();
  for (const f of files) {
    const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
    for (const n of dsl.geometry?.nodes ?? []) {
      const rel = norm(n.description);
      if (rel.startsWith('src/')) expected.add(outNameOf(rel));
    }
  }
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!expected.has(name)) {
      fs.unlinkSync(path.join(OUT_DIR, name));
      pruned++;
    }
  }
}

console.log(`══ gen-design-db · ${files.length} 个 feature · ${total} 个文件节点 ══`);
console.log(`  生成 ${written} · 未变 ${unchanged} · 清理陈旧 ${pruned}`);
if (problems.length) {
  console.log(`\n  ★ ${problems.length} 个问题：`);
  for (const p of problems.slice(0, 12)) console.log('    ' + p);
  process.exit(1);
}
