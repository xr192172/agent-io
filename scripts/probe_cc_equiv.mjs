/**
 * 「等价重写」验收样板（`completionCandidates` 版）—— 把**旧逻辑逐字抄回来**，
 * 对 `base` × 选项的**全组合**比**候选数组**（`JSON.stringify` ⇒ **顺序敏感**）。
 *
 * ★ 为什么要这样验（上一轮的教训）：探针只覆盖它**走过的路径**；
 *   而重写一个纯函数时，风险恰恰在"**没被覆盖的那一格**"（上轮我在 `usesNan === null` 那格翻过车）。
 */
const REPO = 'D:/project_develop/design-canvas';
const ir = await import('file://' + REPO + '/dist/src/infrastructure/parse/import_resolve.js');
const path = await import('node:path');

const IMPORT_EXTS = ir.IMPORT_EXTS;
const INDEX_FILES = ir.INDEX_FILES;
const IMPORT_EXT_SET = new Set(IMPORT_EXTS);

/** ★ 重写前的实现（逐字抄回；只把未导出的 `IMPORT_EXT_SET` 就地构造） */
function OLD(base, options = {}) {
  const exts = options.exts ?? IMPORT_EXTS;
  const indexFiles = options.indexFiles ?? INDEX_FILES;
  const baseExt = path.posix.extname(base);
  const isImportExt = IMPORT_EXT_SET.has(baseExt);
  const out = [];
  if (isImportExt) {
    out.push(base);
    const bare = base.slice(0, -baseExt.length);
    for (const e of exts) out.push(bare + e);
    for (const f of indexFiles) out.push(`${bare}/${f}`);
  } else {
    if (options.bareBaseFirst || (baseExt !== '' && exts.includes(baseExt))) out.push(base);
    for (const e of exts) out.push(base + e);
    for (const f of indexFiles) out.push(`${base}/${f}`);
  }
  return out.filter((c) => !c.startsWith('..'));
}

const BASES = ['./a', './a.ts', './a.js', './a.mts', './a.go', './a.sol', 'a', 'a.ts', './dir/a', './dir/a.ts', '../x', '../../z'];
const OPTS = [
  {},
  { exts: ['.go', '.py'] },
  { exts: ['.go', '.py'], bareBaseFirst: true },
  { indexFiles: ['idx.ts'] },
  { exts: ['.sol'], indexFiles: [] },
  { exts: ['.ts', '.js'], bareBaseFirst: true, indexFiles: ['index.ts'] },
];

let n = 0, diff = 0;
const bad = [];
for (const b of BASES) {
  for (const o of OPTS) {
    n++;
    const a = JSON.stringify(OLD(b, o));
    const c = JSON.stringify(ir.completionCandidates(b, o));
    if (a !== c) { diff++; bad.push({ b, o, old: a, now: c }); }
  }
}
console.log(`逐点对照（候选数组，**顺序敏感**）：${n} 种组合，**不一致 ${diff} 处**`);
for (const r of bad.slice(0, 5)) {
  console.log(`  base=${r.b} opts=${JSON.stringify(r.o)}`);
  console.log(`    旧: ${r.old}`);
  console.log(`    新: ${r.now}`);
}
if (!diff) console.log('✅ 全部组合逐字（含顺序）一致 ⇒ **等价重写**');
// 顺手展示"策略"这条线：import 级 vs 真实扩展名
console.log('\n策略抽样（同一 base 换扩展名，候选形状就换一支）：');
for (const b of ['./a', './a.ts', './a.go', './a.sol']) {
  const c = ir.completionCandidates(b);
  console.log(`  ${b.padEnd(9)} 字面=${c[0] === b ? '是' : '否'}  前 3 个=${c.slice(0, 3).join(' ')}`);
}
