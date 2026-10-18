#!/usr/bin/env node
/**
 * gen-contracts —— **从设计侧的 decision.expectations 生成符号级契约**。
 *
 * ## 为什么是"生成"而不是"手写"
 * 手写契约 = 我挑我认为重要的 ⇒ ★ **漏的正是我没想到的**（今天 7 次教训）。
 * 从 `decision.expectations` 生成 ⇒ **设计里每一条 `symbol-exists` 都有一条对应** ⇒ **漏不了**。
 *
 * ## 生成什么（★ 关键：type 还是 value）
 * 对每条 `symbol-exists { path, symbol }`：
 *   `import * as mN from '<相对路径>';`
 *   然后——**取决于这个符号在实际代码里是 type 还是 value**：
 *     · `interface` / `type` / `enum` ⇒ `export type _N = mN.<symbol>;`
 *     · `function` / `const` / `let`  ⇒ `export type _N = typeof mN.<symbol>;`
 *   ★ 为什么必须区分：`export type _N = mN.listPool` 会报
 *     `'listPool' refers to a value, but is being used as a type` —— **假红**，会淹没真红。
 *   ★ kind 从 `cache.db` 的 `nodes.kind` 取（**那是实际侧的事实**）；查不到默认 `typeof`（value 更常见），
 *     并在文件里标 `// kind 未知`。
 *
 * ## 边界（明说）
 * ★ 不测签名（`signature-matches` 需要参数形状，DSL 里没有）
 * ★ 不测调用（`call-exists` 的 from 可能不存在 ⇒ 归 `contract-calls`）
 * ★ 不测文件存在（归 `design-diff`）
 *
 * 用法：node scripts/gen-contracts.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DESIGN = '.agent-io/design/task-system-plan.dsl.json';
const OUT_DIR = path.join('certs', 'design-contracts');
const DB = path.join('.agent-io', 'cache.db');
const dry = process.argv.includes('--dry');

const design = JSON.parse(fs.readFileSync(DESIGN, 'utf8'));
const nodes = design.geometry?.nodes ?? [];

// ★ 符号 kind：来自 cache.db（实际侧的事实）
const db = new DatabaseSync(DB, { readOnly: true });
const kindOf = (filePath, symbol) => {
  const r = db.prepare('SELECT kind FROM nodes WHERE file_path = ? AND name = ? LIMIT 1').get(filePath, symbol);
  return r?.kind ?? null;
};

const TYPE_KINDS = new Set(['interface', 'type', 'enum', 'class']);

const rel = (p) => '../../' + p.replace(/^src\//, 'src/').replace(/\.ts$/, '.js');
const slug = (id) => id.replace(/^file_src_/, '').replace(/\.ts$/, '').replace(/\//g, '-');

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
let symbols = 0;
let unknownKind = 0;

for (const n of nodes) {
  const exps = (n.decision?.expectations ?? []).filter((e) => e.kind === 'symbol-exists' && e.symbol && e.path);
  if (!exps.length) continue;

  const lines = [
    '/**',
    ` * ★★★ 符号级契约（**自动生成**，勿手改）—— ${n.id}`,
    ' *',
    ` * 来源：\`.agent-io/design/<f>.dsl.json\` 的 \`geometry.nodes[${n.id}].decision.expectations\``,
    ' * 生成器：`scripts/gen-contracts.mjs`（改设计 ⇒ 重跑 ⇒ 契约自动跟上）',
    ' *',
    ' * ★ 每行的含义：该符号在**实际代码**里可导出。tsc 通过 = 在；不通过 = ★ **设计有、实际没有**。',
    ' * ★ 不测签名（DSL 无参数形状）· 不测调用（归 contract-calls）· 不测文件存在（归 design-diff）。',
    ' */',
    '',
  ];

  exps.forEach((e, i) => {
    const k = kindOf(e.path, e.symbol);
    if (k === null) unknownKind++;
    const useTypeof = !(k && TYPE_KINDS.has(k));
    lines.push(`import * as m${i} from '${rel(e.path)}'; // ${e.path}`);
    lines.push(
      `export type _${i} = ${useTypeof ? 'typeof ' : ''}m${i}.${e.symbol};` +
        ` // ★ ${e.symbol}（${k ?? 'kind 未知⇒按 value'}）—— ${String(e.why ?? '').slice(0, 50)}`,
    );
    symbols++;
  });

  const f = path.join(OUT_DIR, `${slug(n.id)}.contract.ts`);
  if (!dry) fs.writeFileSync(f, lines.join('\n') + '\n');
  written++;
}

console.log('════ 生成符号级契约 ════');
console.log(`  节点 ${nodes.length} · 有 symbol-exists 的 ${written} 个 · 生成符号 ${symbols} 条（kind 未知 ${unknownKind} 条）`);
if (dry) console.log('  （--dry：没写文件）');
