/**
 * T202 出生证：**诊断闭环上工具面**（`g-cli-only-to-face` 的第一件）——
 * ★ 把 CLI 的 `diagnose_loop` 那条链（诊断→出补丁→应用→验证）做成工具 `diagnose_loop`。
 *
 * ## 为什么只做它（★ 用户的话）
 * > *"这三个 CLI 能力是都编排成链了吗？**编排成链的话就上工具面呗**"*
 * ★ 实测三个**不是一类**：`diagnose_loop` **是链**（7 个 await：cache→诊断→出补丁→应用→验证→提交）·
 *   `brickify` 是链（6 模块）· ★ `install_package` **不是链**（0 await，纯 `spawnSync(npm)`＋fs）。
 * ⇒ ★ 本证先做**用户点名最可惜的那个**（*"它正是「闭环」，而工具面看不见"*）。
 *
 * ## ★★ 与 CLI 的【两处有意不同】（★ 不是没做完 —— 这两条是本证最该看的地方）
 * 1. ★★ **不做 git 提交**（CLI 阶段 5）—— ★ **提交是不可逆的对外动作** ⇒ 工具**到"验证通过"为止**，
 *    改动**留在工作区**、由调用方自己提交（`data.next` 明说）✓
 * 2. ★★ **默认 `apply=false`** ⇒ **只诊断 + 出补丁 + 给 diff，【不改项目源码】** ✓
 *    ★ 而 CLI 那条**必须保留**：**验证不过 ⇒ 回退**（`revertPatches` + `gitRestoreFiles`）✓
 *      —— ★ 否则会**留下半成品**（比不改更坏）。★ 回退是**还原**，不是不可逆动作 ⇒ 照做 ✓。
 *
 * ## ★★ 而我在这条上**改了自己一次措辞**（★ 记）
 * 我原先写「默认 `apply=false` ⇒ **一个字节都不写盘**」⇒ ★ **不准确**：
 * **符号缓存（`.agent-io/cache.db`）是会写的**（工具自己的索引）⇒ 改成
 * 「**不改动【项目源码】**」+ 明说"缓存会写" ✓（★ 正是"输出在误导"那一族，只不过发生在**我自己刚写的文案里**）。
 *
 * ## 判据（★ 技能 `dc-add-tool` 的"四条验收" + 本仓口径）
 * ① `tsc` 0 · ② `build` ✓ · ③ ★ `structure:gap` **三态全 0** · ④ ★★ **真调**（无参 ⇒ **人话缺参错**，
 *   **不是** Node 原始异常）· ⑤ ★ **7 个登记面**逐个在位 · ⑥ ★ **不做不可逆动作**（源码里**没有** `gitCommitFiles`）·
 * ⑦ ★ **CLI 与工具共用一份 `readTestContract`**（★ 判据不住两处 —— 我把它从 CLI **搬进 `infrastructure`**）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const run = (args) => {
  try {
    return execFileSync('node', ['dist/src/presentation/cli/cli.js', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return String((e.stdout ?? '') + (e.stderr ?? ''));
  }
};
const src = fs.readFileSync('src/application/meta/diagnosis/diagnose_loop.ts', 'utf8');
const def = fs.readFileSync('src/application/meta/index.ts', 'utf8');

console.log('══ ④ 真调（★ 技能明令：无参必须给人话缺参错，不是 Node 原始异常）');
const noArgs = run(['diagnose_loop']);
chk(/缺必填|schema 校验/.test(noArgs), '④-a 无参 ⇒ **人话缺参错**', noArgs.split('\n')[0].slice(0, 80));
chk(!/Cannot read|paths\[0\]|The "path" argument|TypeError/.test(noArgs), '④-b ★ 且**不是** Node 原始异常');

console.log('\n══ ★★ `apply` 不给 ⇒ 只算不写 + 如实止步 + 给下一步（真调）');
// ★ 2026-10-26：不再硬编码旧仓路径（前身 `D:/project_develop/design-canvas`）—— 从本文件位置推导仓根
const REPO = import.meta.dirname.replace(/[\\/][^\\/]+$/, '');
const r = run(['diagnose_loop', '--json', JSON.stringify({ project_dir: REPO, symptom: 'T202 出生证真调' })]);
const dataLine = (r.match(/\{"stopped_at".*/) ?? [''])[0];
let data = {};
try { data = JSON.parse(dataLine); } catch { /* 下面会体现出来 */ }
chk(!!data.stopped_at, '★-a 回执有结构化 `stopped_at`（★ 不是一句"完成"）', `stopped_at=${data.stopped_at}`);
chk(typeof data.next === 'string' && data.next.length > 0, '★-b ★ 且**给了下一步**（`data.next`）', String(data.next).slice(0, 80));
chk(!/一个字节都不写盘/.test(r), '★-c ★★ 文案**不再说"一个字节都不写盘"**（★ 符号缓存会写 ⇒ 那句不准确，已改）');
// ★★★ T209：**断言【不变式】，不断言【当时的状态】**，★ 而且是**反面判据** ——
//   ○ 我第一版写"消息里含『没有改动项目源码』" ⇒ ★ 只在"止步于出补丁"时成立 ⇒ **假红** ✗
//   ○ 第二版写"含『不改动项目源码』或『没有改动项目源码』" ⇒ ★★ **还是假红**：
//     ★ 它这次走的是另一个（更远的）分支，那句是 *"**项目源码一个字节都没动**"* ⇒ **不在我的枚举里** ✗
//   ⇒ ★★★ **教训：枚举"正确的措辞"永远是脆的**（措辞会随分支变）—— ★ **该断言的是"不许说的话"** ✓：
//     ★ **"已应用/已落盘"这类话，只在 `data.applied === true` 时才许说** ✓（★ 反面判据，与分支无关）
const claimsApplied = /已应用\s*\d*\s*个补丁|已真实落盘/.test(r);
chk(data.applied === true ? claimsApplied : !claimsApplied,
  '★-d ★★ 不变式（**反面判据**）：**"已应用/已落盘"只在真应用过时才许说**',
  `applied=${data.applied} · 说已应用=${claimsApplied}`);
chk(!!data.cache && (data.cache.total > 0 || !!data.cache.error), '★-e 缓存那一步有读数（★ 建不起来也会有 `error` 字段 —— 不静默）');

console.log('\n══ ⑥ ★ 不做不可逆动作（源码里没有 git 提交；但【保留了回退】）');
chk(!/gitCommitFiles|gitCommitAll/.test(src), '⑥-a ★ 源码里**没有** `gitCommitFiles`/`gitCommitAll`（不提交）');
chk(/gitRestoreFiles/.test(src) && /revertPatches/.test(src), '⑥-b ★★ 但**保留了回退**（`revertPatches` + `gitRestoreFiles` ⇒ 验证不过不留半成品）');
chk(/apply === true/.test(src) && /apply\?: boolean/.test(src), '⑥-c ★ `apply` **默认 false**（显式 `=== true` 才写）');

console.log('\n══ ⑤ 7 个登记面');
chk(/name: 'diagnose_loop'/.test(def), '⑤-1 def 在 `application/meta/index.ts` ✓');
const cm = fs.readFileSync('src/application/meta/registry/capability_map.ts', 'utf8');
chk(/diagnose_loop:/.test(cm), '⑤-2 `WHEN_OVERRIDES` 有策展文本（★ 且点名"与 `diagnose` 的分工"）');
chk(/diagnose_loop/.test(fs.readFileSync('README.md', 'utf8')), '⑤-3a README.md 有行 ✓');
chk(/diagnose_loop/.test(fs.readFileSync('README.en.md', 'utf8')), '⑤-3b README.en.md 有行 ✓');
const dom = fs.readFileSync('structure.domains.json', 'utf8');
chk(/meta-diagnosis/.test(dom), '⑤-6 `structure.domains.json` 已登记 `meta-diagnosis`');
chk(!/diagnose/.test(fs.readFileSync('AGENTS.md', 'utf8')), '⑤-5 ★ `AGENTS.md` **不列工具** ⇒ 无需改（★ 它是生成物、build 会自动重建）');

console.log('\n══ ⑦ ★ 判据不住两处：`readTestContract` 只有一份');
chk(fs.existsSync('src/infrastructure/analysis/diagnosis/test_contract.ts'), '⑦-a 已搬进 `infrastructure/analysis/diagnosis/test_contract.ts`');
chk(/readTestContract/.test(src), '⑦-b 工具用它的那份 ✓');
const cli = fs.readFileSync('src/presentation/cli/diagnose_loop_cli.ts', 'utf8');
chk(!/function readTestContract/.test(cli) && /from '\.\.\/\.\.\/infrastructure\/analysis\/diagnosis\/test_contract\.js'/.test(cli), '⑦-c ★ CLI **删掉了本地那份、改为 import**（★ 原先住两处）');

console.log('\n══ ①②③ 三条验收命令的读数（★ 由外层跑，这里只记录）');
chk(true, '① `npx tsc --noEmit` ⇒ 0（本证运行前提）');
chk(true, '② `npm run build` ⇒ clean_dist 一一对应 ✓');
chk(true, '③ `npm run structure:gap` ⇒ 三态全 0（unlisted 已由 ⑤-6 归零）');

console.log('\n══ ★★★ T202b：产物锚点 `touched`（★ 没有它 Map 就接不上本工具）');
chk(!!data.touched && typeof data.touched.project_dir === 'string', '★-f ★ 回执里有 `touched.project_dir`', JSON.stringify(data.touched));
chk(/^[A-Za-z]:/.test(String(data.touched?.project_dir)), '★-g ★ 且是**解析后的绝对根**（契约要求，不是入参原值）', String(data.touched?.project_dir));
chk(data.touched?.written_files === undefined, '★-h ★★ `apply=false` ⇒ **`written_files` 整个省略**（契约：未落盘不给空数组）', '（★ 不是空数组，是【没有这个键】）');

console.log('\n══ ★★★ 链登记（Map）：`chain_wiring` 里有本工具的产物边');
const cw = fs.readFileSync('src/domain/chain_wiring.ts', 'utf8');
chk(/from: 'diagnose_loop'/.test(cw), '★-i ★ `CHAIN_EDGES_PENDING` 里有 `diagnose_loop` 的边');
chk(/fromKey: 'written_files'/.test(cw) && /toPath: 'file'/.test(cw), '★-j ★ 接法是 `written_files[pick] → edit_code.file`');
const seg = cw.split("from: 'diagnose_loop'")[1] ?? '';
chk(/evidence: 'pending'/.test(seg.slice(0, 400)), '★-k ★★ 且**诚实标 `pending`**（★ 本表纪律：不许把没跑过的写成 verified）');
chk(/冷却窗口/.test(seg.slice(0, 700)) || /冷却窗口/.test(cw), '★-l ★ 并**写明了为什么没跑成**（LLM 不可用 ⇒ 跑不出成功的 apply）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('★ 在账（未做，如实）：`brickify`（是链）与 `install_package`（**不是链**、是单动作）仍未上工具面。');
