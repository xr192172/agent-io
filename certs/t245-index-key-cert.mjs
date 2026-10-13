/**
 * T245 出生证（① 那一半）：**「路径 → 索引键」只能有一处，且根外必须响亮**。
 *
 * ## 它测的是哪一格
 * 此前**两份实现、只有一份有护栏**：
 * · `symbols.toRelPath`：裸 `path.relative` ⇒ ★ **根外路径静默造出 `../x.ts` 这种键**（污染键空间）；
 * · `write_gate.toRelPosix`：根外 ⇒ `null`（"不参与索引，避免键污染"）。
 * ⇒ ★★ 护栏那一半住在**上层**（application），而"路径 → 索引键"是**索引自己的事**
 *   ⇒ 下层没法复用 ⇒ 只能各写一份。
 * ⇒ 现在收成 `symbols.toIndexKey`（唯一住处，含护栏）；`toRelPosix` **已删**，5 个文件改用它。
 *
 * ## 判据（★ 六个，且带**反向**）
 * ① 根内绝对路径 ⇒ 相对 posix 键；② 根内**相对**路径 ⇒ 同样按根解析（上层原来靠这个）；
 * ③ ★★ 根外 ⇒ `toIndexKey` = **null**（跳过语义）；④ ★★ 根外 ⇒ `toRelPath` **抛**（响亮语义，
 *    ★ 修复前它**静默**给出 `../x.ts`）；⑤ 根自身 / 空相对 ⇒ null（不许把根当键）；
 * ⑥ ★ **回归**：正常项目内路径的键**逐字**等于 `path.relative` 的 posix 形态（别改对正常路径的行为）。
 *
 * ## ★ 本证【不】覆盖的那一半（如实说）
 * T245 的另一半（`edit_code.ts` 批量路原来的 `void _rw` —— 算出来又扔掉，
 * 而内联四件套那条路是**报出来**的）**已改**（改用同一个 `reopenNote` 并入同一个字段），
 * ★★ 但**给不出便宜的二值判据** —— 要一个"批量编辑 + 引用重开"的夹具（`editCodeBatch` 是私有的，
 * 只能经 `edit_code` 的 `targets` 走）。⇒ **记账，不假装本证覆盖了它**。
 * 本证只在末尾**打印** `void _` 的计数（读得出，不是断言）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const REPO = path.resolve(dir, '..');
const dist = (p) => pathToFileURL(path.join(REPO, 'dist', 'src', p)).href;

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { toIndexKey, toRelPath } = await import(dist('infrastructure/index/symbols.js'));

// 用仓自己当夹具（★ 不写任何文件，纯函数，零副作用）
const ROOT = REPO;
const INSIDE = path.join(ROOT, 'src', 'application', 'write_gate.ts');
const OUTSIDE = path.join(ROOT, '..', 'sibling-project', 'src', 'x.ts');

console.log('══ ① 根内');
chk(toIndexKey(ROOT, INSIDE) === 'src/application/write_gate.ts', '①-a 绝对路径 ⇒ 相对 posix 键（正斜杠）', `实测 = ${toIndexKey(ROOT, INSIDE)}`);
chk(toIndexKey(ROOT, 'src/application/write_gate.ts') === 'src/application/write_gate.ts', '①-b ★ 相对路径入参也按根解析（上层原来靠这个语义）', `实测 = ${toIndexKey(ROOT, 'src/application/write_gate.ts')}`);

console.log('\n══ ② 根外');
chk(toIndexKey(ROOT, OUTSIDE) === null, '②-a ★★ `toIndexKey` = **null**（"跳过不索引"语义）', `实测 = ${toIndexKey(ROOT, OUTSIDE)}`);
chk(toIndexKey(ROOT, '../escape.ts') === null, '②-b ★ `../escape.ts` 也判 null（不许造 `../` 键）');

console.log('\n══ ③ ★★ 根外 ⇒ `toRelPath` 必须**响亮**（修复前它静默给 `../x.ts`）');
let threw = '';
try {
  toRelPath(ROOT, OUTSIDE);
} catch (e) {
  threw = e instanceof Error ? e.message : String(e);
}
chk(threw !== '', '③-a ★★ 抛了（不再静默造污染键）', threw ? threw.split('\n')[0].slice(0, 120) : '（★ 没抛 ⇒ 洞还在 ✗）');
chk(/索引键/.test(threw) && /toIndexKey/.test(threw), '③-b ★ 错误里点名"索引键"并指路 `toIndexKey`（可读 + 可修）');

console.log('\n══ ④ 边界');
chk(toIndexKey(ROOT, ROOT) === null, '④-a 根自身 ⇒ null（`rel === ""`，别把根当键）');
chk(toIndexKey(ROOT, path.join(ROOT, '.')) === null, '④-b 根的 `.` ⇒ null');

console.log('\n══ ⑤ ★ 回归：正常路径的键**逐字等于** `path.relative` 的 posix 形态');
const samples = ['src/infrastructure/index/symbols.ts', 'package.json', 'certs/t238-freshness-cert.mjs'];
const same = samples.every((rel) => toIndexKey(ROOT, path.join(ROOT, rel)) === rel);
chk(same, `⑤-a ${samples.length} 个样本逐字一致（★ 别改对正常路径的行为）`, samples.map((r) => `${r}→${toIndexKey(ROOT, path.join(ROOT, r))}`).join(' · '));
chk(toIndexKey(ROOT, path.join(ROOT, 'a', '..', 'b.ts')) === 'b.ts', '⑤-b `a/../b.ts` 归一成 `b.ts`');

console.log('\n══ ★ 打印（本证**不断言**的那一半 —— T245-②）');
const ec = fs.readFileSync(path.join(REPO, 'src/application/refactor/edit/edit_code.ts'), 'utf8');
// ★ 只数**代码**里的（排除注释）—— ★ 第一版把注释里那句历史描述也算进去了 ⇒ **证自己报了个假读数**。
//   （★ 这正是本证在打的那类病：**读数本身也得先被量过**。）
const voids = ec
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .filter((l) => /\bvoid _\w+;/.test(l)).length;
console.log(`     edit_code.ts 里 **代码中**"算出来又扔掉"（void _x;）的处数 = ${voids}  ⇒ ${voids === 0 ? '已清 ✓' : '★ 还在 ✗'}`);
console.log('     ★ 为什么不断言：要一个"批量编辑 + 引用重开"的夹具才判得准；★ 记账，不假装覆盖。');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证：把 `toIndexKey` 的护栏（`if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;`）\n' +
    '  改成直接 `return rel.split(path.sep).join("/")` ⇒ ★ **②-a / ②-b / ④-a 必须变红** ✓',
);
process.exit(F === 0 ? 0 : 1);
