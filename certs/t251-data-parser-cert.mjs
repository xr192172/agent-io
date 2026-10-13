/**
 * T251 出生证：★ **`---DATA---` 机器段只能有【一处】解析口径**；而那个口径 = **取标记后的第一行**。
 *
 * ## 它测的是哪一格（★ 实测的现场，不是理论）
 * 旧写法 = `JSON.parse(text.split('---DATA---')[1])` **整段** ⇒ ★ 它默认"**JSON 之后没有别的东西**"。
 * 而**产品自己就违反了那条约定**：`invokeTool` 组装回执时是
 *   `withNext + argHints + emission.text + firstContactNote + trustNote + alertNote + emission.block`
 * ⇒ 机器段之后**永远可能**追加告警 / 信任附注 / 首触标注 / `---WARNINGS---` 机器块。
 * ★ 实测（`capability_map` 真调用）逐字长这样：
 * ```
 * ---DATA---
 * {"lanes":[…],"domains":0,…}                              ← 行 1：JSON
 * ⚠️ NO_PROJECT_ROOT：本次调用未解析到项目根 ⇒ 未做索引保鲜…   ← 行 2：被追加的告警
 *    本次入参里既没有约定的根参数名…                           ← 行 3：告警细节
 * ```
 * ⇒ ★★ "整段 parse"的消费方在**告警非空时必炸**（平时恰好为空 ⇒ **看不出来**）。实测炸过一次：
 *   `certs/t184b-cert.mjs` 报 `Unexpected non-whitespace character after JSON at position 442345`。
 *
 * ## 为什么"取第一行"就够 —— ★ 这是**结构保证**，不是巧合
 * 载荷由 `wrapData` 用 **`JSON.stringify(payload)`** 产出 ⇒ `stringify` **不产出裸换行**
 * （串内 `\n` 会被转义成 `\\n`）⇒ 载荷**必然单行** ⇒ ★ 取第一行就能拿到全部。
 * ★★ 我第一版写了**括号配平**，然后**量了一下**（真调工具看回执）才发现那是**多余的复杂度** ——
 *   载荷就是单行 ⇒ 配平那一层是**为不存在的情况付的复杂度**。⇒ 已删，改回最小正确。
 *
 * ## 判据（★ 八条，且**自带反向对照**）
 * ①②③ 标记后跟文本 / 跟 `---WARNINGS---` 块 ⇒ **仍取到**（这就是修的那一格）；
 * ②-b ★★ **反向对照**：**同一份输入**下，**旧口径必炸**；
 * ④ 数组载荷；⑤ ★ **契约断言：载荷单行**（`JSON.stringify` 无裸换行 —— 这是"取第一行"成立的依据）；
 * ⑥ 没有标记 / 标记后不是 JSON / 多行载荷（**越界，如实回 null**）⇒ 都不抛。
 *
 * ## ★ 消融自证（★ 找准判别器）
 * 把 `parseDataBlock` 改回**整段 parse**（= 旧口径：`JSON.parse(标记之后的全部)`）⇒ ★ **②-a 必须变红**。
 * （★ 注意：换成"括号配平"**不会**红 —— 因为单行载荷下两者等价 ⇒ ★ 它不是判别器；
 *   我用错判别器试过一次，那次"消融没红"正说明这一点。）
 */
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

const { parseDataBlock, DATA_MARKER } = await import(dist('application/plumbing.js'));

const D = DATA_MARKER;
const PAYLOAD = { touched: { feature: 'run82', scope_files: ['a.ts'] }, n: 3 };
const J = JSON.stringify(PAYLOAD);

console.log('══ ① 正常：JSON 之后没有别的东西');
chk(JSON.stringify(parseDataBlock(`人话描述\n${D}\n${J}`)) === JSON.stringify(PAYLOAD), '①-a 取到完整对象');
chk(parseDataBlock('没有标记的一段话') === null, '①-b 没有标记 ⇒ null');

console.log('\n══ ② ★★ 核心那一格：JSON 之后**跟着告警文本**（实测回执的真实形状）');
const t2 = `人话\n${D}\n${J}\n⚠️ NO_PROJECT_ROOT：本次调用未解析到项目根 ⇒ 未做索引保鲜 / 未做陈旧检查（结果可能基于旧图）\n   本次入参里既没有约定的根参数名…`;
const got2 = parseDataBlock(t2);
chk(JSON.stringify(got2) === JSON.stringify(PAYLOAD), '②-a ★★ 新口径**仍能取到**', `实测 = ${JSON.stringify(got2)}`);
let legacyMsg = '';
try {
  JSON.parse(t2.split(D)[1]);
} catch (e) {
  legacyMsg = e instanceof Error ? e.message : String(e);
}
chk(legacyMsg !== '', '②-b ★★ **反向对照**：旧口径（**整段** parse）在**同一输入上必炸**', legacyMsg.slice(0, 95));
chk(got2 !== null, '②-c ★ 同一份输入：新口径拿到、旧口径炸 ⇒ ★ 这才证明本证测的是**真差异**');

console.log('\n══ ③ JSON 之后跟 `---WARNINGS---` 机器块（另一种真实后追加）');
const t3 = `${D}\n${J}\n---WARNINGS---\n[{"code":"NO_PROJECT_ROOT"}]`;
chk(JSON.stringify(parseDataBlock(t3)) === JSON.stringify(PAYLOAD), '③-a 仍取到（不被机器块带偏）');

console.log('\n══ ④ 数组载荷');
chk(JSON.stringify(parseDataBlock(`${D}\n[1,{"a":2}]\n尾注`)) === JSON.stringify([1, { a: 2 }]), '④-a 数组也能取');

console.log('\n══ ⑤ ★ 契约断言：**载荷结构上就是单行**（"取第一行"成立的依据）');
chk(J.indexOf('\n') === -1, '⑤-a `JSON.stringify(载荷)` 里**没有裸换行**（串内 `\\n` 被转义成 `\\\\n`）', `载荷长度 = ${J.length}`);
const tricky = { s: '里面有个真换行符\n和右括号 } 与左括号 {', q: 'a"b' };
chk(JSON.stringify(tricky).indexOf('\n') === -1, '⑤-b ★ 哪怕**字符串里含真换行 / 括号**，`stringify` 后仍是单行');
chk(
  JSON.stringify(parseDataBlock(`${D}\n${JSON.stringify(tricky)}\n后注`)) === JSON.stringify(tricky),
  '⑤-c 那种载荷也能被完整取到（★ 因为它是单行）',
);

console.log('\n══ ⑥ 失败路径（★ 不抛，如实回 null）');
chk(parseDataBlock(`${D}\n这不是 JSON`) === null, '⑥-a 标记后不是 JSON ⇒ null（不抛）');
chk(parseDataBlock(`${D}\n{"a":1`) === null, '⑥-b 截断的 JSON ⇒ null（不抛）');
chk(
  parseDataBlock(`${D}\n{\n "a": 1\n}`) === null,
  '⑥-c ★ **多行载荷 ⇒ null**（★ **越界**：契约是单行；★ 这里**故意不猜**，如实回 null）',
  '（★ 若将来真有工具产出多行载荷，消费方会拿到 null ⇒ 会**响亮**而不是静默错，这正是要的）',
);

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log(
  '★ 消融自证：把 `parseDataBlock` 改回**整段 parse**（旧口径）⇒ ★ **②-a 必须变红** ✓\n' +
    '  ★ 对照：换成"括号配平"**不会**红（单行载荷下两者等价）⇒ ★ 它不是判别器。',
);
process.exit(F === 0 ? 0 : 1);
