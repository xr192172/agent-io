/**
 * T183 出生证：**`'archived'` 是【不可达】的状态 ⇒ 已从类型里删掉**（连同 `archive_id`）。
 *
 * ## 判据（先问"凭什么变红"）
 * 1. ★ **静态**：全仓**零个写端**（`grep` 实证）—— 这是"不可达"的**机器证据**，不是印象。
 * 2. ★ **类型层**：`lc.status === 'archived'` 会 **TS2367（无重叠）**—— 编译器**证明**它产不出来。
 *    （本证把它当"应当发生"来断言：编译过 = 类型里真删干净了。）
 * 3. ★ **运行期仍要拦**（`data` 是自由袋子、类型被擦除）⇒ 写 `'archived'` **必须红**，
 *    且**指路 `archive` 工具**（不是笼统的"非法值"）—— **能力没了，路还指着**。
 * 4. ★ **能力没被砍掉**：`deprecated` / `active` / `merged` 照旧；`archive` 工具照旧工作。
 * 5. ★ **`archive_id` 也是死的**（`grep` 零读端）⇒ 已删；现在写它 ⇒ "不被认的键"（不静默落盘）。
 *
 * ## 反例
 *  · 别把判据放宽成"status 随便写"：`'gone'` 仍须拒（且是**笼统**非法值文案，不是指路文案）
 *  · 合法值必须**绿**（否则就是把能力砍掉了还不自知）
 *
 * ## ★ 关于"能不能【取消归档】"（本节的问题之一）
 * ⇒ **不能，且这是【声明的契约】不是漏做**：`archive` 的 action 只有 `node`（写，**不可逆**）/ `list`（只读），
 *   描述里逐字写着"**立即落盘**、**没有 dry_run 预览**"。
 *   ★ 技术上可行（归档条目里存着**完整的前置 DSL 快照**）⇒ 但**今天不提供**、也**不假装提供**。
 *   ⇒ 本证把这条"不可逆"当**可核对的事实**来钉：断言 `archive` 的 action 枚举**只有** node/list。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const SRC = 'src';
let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (tool, args) =>
  execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
const { assertLifecycle } = await import('../dist/src/domain/semantic.js');
const throwsMsg = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };

console.log('════ ① 静态取证：`archived` 与 `lifecycle.archive_id` 的写/读端【全仓为零】');
/**
 * ★★ 直接调 `rg`（**不经 shell、不经嵌套 `node -e`**）——
 *   第一版我把 `rg` 套在 `node -e '…'` 里，**模式里的单引号把内层脚本弄成了语法错误**，
 *   而我内层的 `catch` 又把它吞成空串 ⇒ ★ **检查"通过"了，但通过的原因是错的**
 *   （本仓最忌的"因为别的原因绿"）。⇒ 现在：**不用 shell 拼字符串**，
 *   且**区分三种结果**：有命中 / 无命中（rg 退出码 1，正常）/ 真出错（必须抛，不许吞）。
 */
const rg = (pat, glob = '*.ts') => {
  let lines;
  try {
    lines = execFileSync('rg', ['-n', '--no-heading', '-g', glob, pat, SRC], { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
  } catch (e) {
    // rg 无命中 ⇒ 退出码 1（正常）；其他 ⇒ 真错，必须抛（★ 不许把"量具坏了"读成"没有"）
    if (e.status === 1) return [];
    throw e;
  }
  // ★ 去掉**注释行** —— 否则我会搜到"我自己的注释里引用了这个模式"（自指噪声，不是代码）
  //   形如 `path:12:  // …` / `path:12: * …` ⇒ 只看真正的代码行
  return lines.filter((l) => !/:\d+:\s*(\/\/|\*|\/\*)/.test(l));
};
// ★ 写端 = 「`status:` 后面直接跟 `'archived'`」这个形状（`=== 'archived'` 那种比较不算写）
const writers = rg("status\\s*:\\s*'archived'");
chk(writers.length === 0, '★ `status: \'archived\'` 全仓【零个写端】', writers.join('\n') || '(零命中)');

const archHits = rg('archive_id');
const inType = archHits.filter((l) => l.includes('domain/semantic.ts') || l.includes('domain\\semantic.ts'));
chk(inType.length === 0, '★ `archive_id` 已从 `FileLifecycle` 类型里消失', inType.join('\n') || '(零命中)');
// ★ 其余命中应是**另一个概念**：`archive` 工具**回执**里的 `archive_id`（ArchiveNodeResult），那个还在用、合法
const others = archHits.filter((l) => !inType.includes(l));
const onlyToolResult = others.every((l) => /archive_node\.ts|meta[\\/]index\.ts/.test(l));
chk(onlyToolResult, '★ 其余 `archive_id` 命中都属【另一个概念】（`archive` 工具回执字段），不是 `FileLifecycle` 的',
  others.map((l) => l.slice(0, 96)).join('\n') + (others.length ? `\n     （共 ${others.length} 处）` : ''));

console.log('\n════ ② 运行期守卫：写 \'archived\' 必须红，且【指路 archive】');
let m = throwsMsg(() => assertLifecycle({ status: 'archived' }));
chk(m !== null, '★ 写 archived ⇒ 抛（运行期拦住了）');
chk(!!m && m.includes('不是设计 DSL 里的一种状态'), '★ 文案说清"归档不是 DSL 里的状态"', (m ?? '').split('\n')[0]);
chk(!!m && m.includes('archive(action=node'), '★★ 且**指路 `archive` 工具**（不是笼统的"非法值"）');

console.log('\n════ ③ 反例：判据没被放宽');
m = throwsMsg(() => assertLifecycle({ status: 'gone' }));
chk(m !== null, '  枚举外的值仍拒');
chk(!!m && !m.includes('archive(action=node'), '★ 但 `gone` **不许**拿指路文案（只有 archived 配那句）', (m ?? '').split('\n')[0]);
m = throwsMsg(() => assertLifecycle({ status: 'deprecated' }));
chk(m !== null && m.includes('retire_reason'), '  `deprecated` 缺理由仍拒（原判据没丢）');

console.log('\n════ ④ 能力没被砍掉：合法值必须绿');
for (const [lc, label] of [
  [{ status: 'active' }, 'active'],
  [{ status: 'deprecated', retire_reason: '该删' }, 'deprecated + 理由'],
  [{ status: 'merged', merged_from: ['a.ts'] }, 'merged（目标那头）'],
  [{ status: 'merged', merged_into: 'b.ts' }, 'merged（源那头）'],
]) {
  chk(throwsMsg(() => assertLifecycle(lc)) === null, `  ${label} ⇒ 放行`);
}

console.log('\n════ ⑤ `archive_id` 字段已删 ⇒ 写它必须"不被认"（不静默落盘）');
m = throwsMsg(() => assertLifecycle({ status: 'deprecated', retire_reason: 'x', archive_id: 'zzz' }));
chk(m !== null && m.includes('不被认的键') && m.includes('archive_id'), '★ 带 archive_id ⇒ 报"不被认的键"', (m ?? '').split('\n')[0]);

console.log('\n════ ⑥ 端到端（走真工具）：edit_dsl 写 archived ⇒ 红且指路；写 deprecated ⇒ 绿');
const FEATURE = 'run82';
const A = 'file_dogfood_build_cache_mjs', PA = 'dogfood/build_cache.mjs';
const reset = () => execFileSync('node', ['certs/t185-reset.mjs'], { encoding: 'utf8' });
const edit = (data) => call('edit_dsl', {
  feature: FEATURE, reason: `T183 出生证：对 ${PA} 操作`, weight: 'routine',
  evidence: [{ type: 'diff', ref: PA }],
  operations: [{ type: 'file', op: 'update', id: A, data }],
});
reset();
const bad = edit({ lifecycle: { status: 'archived' } });
chk(bad.includes('isError=true'), '★ 端到端：写 archived 被拒');
chk(bad.includes('archive(action=node'), '★ 端到端：回执把 `archive` 这条路指出来');
const good = edit({ lifecycle: { status: 'deprecated', retire_reason: 'T183 出生证' } });
chk(!good.includes('isError=true'), '★ 端到端：deprecated 照旧可写（能力没砍）');
reset();

console.log('\n════ ⑦ "取消归档"= 【不可逆】是【声明的契约】，不是漏做（钉住它）');
const src = fs.readFileSync('src/application/meta/index.ts', 'utf8');
chk(/action: z\.enum\(\['node', 'list'\]\)/.test(src), '★ `archive` 的 action 枚举【只有】 node / list（没有 restore/unarchive）');
chk(src.includes('不可逆'), '★ 且描述里逐字声明"不可逆"（不是隐含行为）');
chk(src.includes('没有 dry_run 预览'), '★ 且声明"没有 dry_run 预览"');
console.log('     ⇒ 技术上可行（归档条目里存着**完整的前置 DSL 快照**），但**今天不提供、也不假装提供**。');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
