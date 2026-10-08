/**
 * closure_multi —— 验**多级连锁解析**：用**手工正向 BFS**（`parseFileFull` 拿 import → `resolveProjectImport` 解析）
 * 逐级走，检查每一级都落到**正确的那个文件**。
 *
 * ★★ 为什么不直接用 `expandClosure`（我第一版就是那么写的，**判据错了**）：
 *   实测（本仓，有索引）：种子 `kernel.ts` 的 `expandClosure` = **310/453** 文件，
 *   而两个"不该可达"的（`install_package_cli.ts` / `handlers.ts`）**也在里面**。
 *   原因在它自己的注释里：「阶段 3：**邻域 importer 扩入**后再扩其 import 边」
 *   ⇒ 它的语义是「种子的**连通邻域**（正向 + 反向）」，**不是**「只包含我依赖谁」。
 *   （无索引时更宽：项目内**全部文件**都进队列 = 兜底免摩擦。）
 *   ⇒ 拿它验"正向多级解析"是**量错了对象**。本探针改用**解析层原语**逐级走。
 */
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const k = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/index.js').replace(/\\/g, '/'));
const { codeSourceExts } = await import('file://' + path.join(REPO, 'dist/src/infrastructure/parse/source_exts.js').replace(/\\/g, '/'));
const EXTS = codeSourceExts(k.listSupportedExtensions());

const ROOT = path.join(REPO, '.inspect', 'closure-multi');
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(path.join(ROOT, 'src', 'util'), { recursive: true });
const W = (rel, code) => fs.writeFileSync(path.join(ROOT, rel), code);
W('src/c.ts', 'export const c = 3\n');
W('src/b.ts', 'import { c } from "./c"\nexport const b = c\n');
W('src/a.ts', 'import { b } from "./b"\nexport const a = b\n');
W('src/util/index.ts', 'export const u = 1\n');
W('src/d.ts', 'import { u } from "./util"\nexport const d = u\n');
W('src/e.ts', 'import { b } from "./b"\nimport { u } from "./util"\nexport const e = b + u\n');
W('src/cr_c.cr', 'C = 3\n');
W('src/cr_b.cr', 'require "./cr_c"\nB = 1\n');
W('src/cr_a.cr', 'require "./cr_b"\nA = 1\n');

/** 手工正向 BFS：从种子出发，逐级解析 import，返回"可达文件（相对路径，含种子）" */
async function forwardClosure(seedRel) {
  const rels = new Set([...fs.readdirSync(path.join(ROOT, 'src')).flatMap((f) => (f === 'util' ? ['src/util/index.ts'] : ['src/' + f]))]);
  const seen = new Set([seedRel]);
  const queue = [seedRel];
  while (queue.length) {
    const cur = queue.shift();
    const code = fs.readFileSync(path.join(ROOT, cur), 'utf8');
    const r = await k.parseFileFull(path.join(ROOT, cur), code);
    for (const im of r.imports || []) {
      const h = k.resolveProjectImport(cur, im.source, rels, { exts: EXTS });
      if (h.rel && !seen.has(h.rel)) { seen.add(h.rel); queue.push(h.rel); }
    }
  }
  return seen;
}

const CASES = [
  { name: '① 三级链 a→b→c', seed: 'src/a.ts', want: ['src/a.ts', 'src/b.ts', 'src/c.ts'] },
  { name: '② 目录式 d→./util', seed: 'src/d.ts', want: ['src/d.ts', 'src/util/index.ts'] },
  { name: '③ 菱形 e→b,util', seed: 'src/e.ts', want: ['src/e.ts', 'src/b.ts', 'src/c.ts', 'src/util/index.ts'] },
  { name: '④ crystal 链 cr_a→cr_b→cr_c', seed: 'src/cr_a.cr', want: ['src/cr_a.cr', 'src/cr_b.cr', 'src/cr_c.cr'] },
];

const rows = [];
for (const c of CASES) {
  let got;
  try { got = await forwardClosure(c.seed); }
  catch (e) { rows.push({ ...c, verdict: '✗ 抛错: ' + (e.message || '').slice(0, 60) }); continue; }
  const want = new Set(c.want);
  const missing = c.want.filter((x) => !got.has(x));
  const extra = [...got].filter((x) => !want.has(x));
  rows.push({ ...c, got: [...got], verdict: !missing.length && !extra.length ? '✅ 逐级恰好' : `✗ 缺 ${JSON.stringify(missing)} 多 ${JSON.stringify(extra)}` });
}
fs.writeFileSync(path.join(REPO, '.inspect', 'closure-multi.json'), JSON.stringify(rows, null, 1));
const ok = rows.filter((r) => r.verdict.startsWith('✅')).length;
console.log('多级连锁解析（手工正向 BFS：parseFileFull → resolveProjectImport）：\n');
console.log(`  ✅ 逐级恰好 ${ok} · ✗ ${rows.length - ok} / ${rows.length}\n`);
for (const r of rows) console.log(`  ${r.verdict}  ${r.name}\n      得到: ${JSON.stringify(r.got ?? '')}`);
