/**
 * verify_rebuild —— 「重建出来的，和仓里那份是同一个东西吗？」
 *
 * 判据不是比字节：`.node` 是 PE 文件，里面带**链接时间戳**，同一份源码编两次字节也会不同。
 * ⇒ 用**行为等价**：同一段输入，两边解析出的 **S-expression 必须逐字相同**；根节点类型也要相同。
 * 而且**每门一个子进程**（同进程连加载多个原生模块会让进程挂住/猝死 —— 实测过，别踩）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const STAGE = path.join(REPO, '.inspect', 'napi-grammars');
const VENDOR = path.join(REPO, 'vendor', 'grammars');
const PROBE = path.join(REPO, '.inspect', '_probe_tree.mjs');

// 同一段输入给两边 —— 内容不需要"像"那门语言，只要两边一样（比的是可复现性）
const SAMPLE = 'a b c\nx = 1\nfoo(bar, 2)\n# c\n"str"\n';

fs.writeFileSync(PROBE, `
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
try {
  const p = new Parser();
  p.setLanguage(req(process.argv[2]));
  const t = p.parse(process.argv[3]);
  console.log(JSON.stringify({ root: t.rootNode.type, sexp: t.rootNode.toString() }));
} catch (e) { console.log(JSON.stringify({ err: ((e && e.message) || '').slice(0, 70) })); }
`);

const probe = (file) => new Promise((res) =>
  execFile(process.execPath, [PROBE, file, SAMPLE], { timeout: 90000, maxBuffer: 1 << 22 },
    (e, o) => res((o || '').trim() || `{"err":"子进程无输出 code=${e ? e.code : 0}"}`)));

const names = fs.readdirSync(STAGE).filter((n) =>
  fs.existsSync(path.join(STAGE, n, 'build/Release', `tree_sitter_${n}_binding.node`)));
if (names.length === 0) { console.log('staging 里没有产物'); process.exit(0); }

console.log(`比较 ${names.length} 个：新建的（staging） vs 仓里在册的（vendor/）\n`);
let same = 0, diff = 0, missing = 0;
for (const n of names.sort()) {
  const fresh = path.join(STAGE, n, 'build/Release', `tree_sitter_${n}_binding.node`);
  const plain = path.join(VENDOR, n, 'build/Release', `tree_sitter_${n}_binding.node`);
  if (!fs.existsSync(plain)) { console.log(`  ·  ${n.padEnd(9)} vendor 里没有（未在册）`); missing++; continue; }
  const [a, b] = await Promise.all([probe(fresh), probe(plain)]);
  let A, B;
  try { A = JSON.parse(a); B = JSON.parse(b); } catch { A = { err: a.slice(0, 60) }; B = { err: b.slice(0, 60) }; }
  const sizeA = fs.statSync(fresh).size, sizeB = fs.statSync(plain).size;
  const equal = A.sexp && B.sexp && A.sexp === B.sexp && A.root === B.root;
  if (equal) { same++; console.log(`  ✅ ${n.padEnd(9)} root=${A.root}  树逐字相同  (${(sizeA / 1024) | 0}KB vs ${(sizeB / 1024) | 0}KB)`); }
  else {
    diff++;
    console.log(`  ❌ ${n.padEnd(9)} 不一致`);
    console.log(`      新: root=${A.root} ${A.err ?? ''} sexp=${String(A.sexp).slice(0, 70)}`);
    console.log(`      仓: root=${B.root} ${B.err ?? ''} sexp=${String(B.sexp).slice(0, 70)}`);
  }
}
console.log(`\n行为等价 ${same} · 不一致 ${diff} · 不在册 ${missing}`);
console.log('★ 结论口径：**行为等价**（同输入 ⇒ 同树）。不比字节 —— PE 里有链接时间戳，字节本就会变。');

// ★★ 2026-10-10：判据（`diff` = 行为**不**等价）原先**只用来打文案、从不设退出码**
//   ⇒ 重建产物与在册的**对不上**时脚本仍退 0（"算出来了、却不设退出码"的又一例，与 structure_gap 同型）。
//   现在：只要有一门**行为不等价** ⇒ 退 1（这就是"重建坏了"的硬信号）。
//   ★ 只按 `diff` 判 —— `missing`（vendor 里没这份）是"**未在册**"，可能是有意的新产物，不等于不一致。
process.exitCode = diff > 0 ? 1 : 0;
