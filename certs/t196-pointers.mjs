/**
 * T196 出生证：**"幻影工具"逐条判** —— ★ 只修**真堵点**；★ 并把误报类记清（免得下一个人重踩）。
 *
 * ## 背景：用户裁定"清光吧，就是让工具更顺手"
 * T192 的扫描器报出 **26 个"看起来是工具名、其实不在册"** 的名字。★ **但扫描器只是【候选生成器】**，
 * 逐条判之后，**绝大多数是误报** —— 记住这条：**"名字像" ≠ "指路"**。
 *
 * ## ★★ 误报类（**我当场撞出来的，一共 6 类**）
 * 1. **否定式提及** —— `★ 注意：没有 X 这个工具`（那是在**否认**它）
 * 2. **嵌套参数** —— `decl_line` 住在 `renames[]` **里面**；★ 我的扫描只看顶层 ⇒ 漏一层
 *    （★ 记忆 §2.6 早写着"**量具只到顶层⇒嵌套盲区**" ⇒ ★ 我还是踩了）
 * 3. **目录名** —— `rename_symbol`（是个**目录**，我的扫描只把 `.ts` **文件名**当模块）
 * 4. **`explore_code` 的 `args` 袋子里的键** —— 如 `resolve_id`（★ 袋子不透明 ⇒ 静态看不见）
 * 5. **散文里引用的【原理名】** —— `old_string`（"不信 AI 的 `old_string`" 是一句**设计原则**）
 * 6. ★★★ **日志前缀 / 数据标识 / 历史叙述** —— `ts_kernel` 全仓 **~55 处**，而它绝大多数是
 *    `console.warn('[ts_kernel] …')` 的**日志前缀**、`serve.ts` 里 `nodeId:'file_tools_ts_kernel_kernel_ts'`
 *    的 **DSL 节点 id（= 数据！）**、以及散文 ⇒ ★ **它不是缺陷，改它反而会坏东西**。
 *
 * ## ★★★ 我在这条上犯的错（★ 本证存在的一半理由）
 * 我一度用**全局替换**改 `ts_kernel` ⇒ **37 个文件**、**把构建搞坏了**（反引号插进了字符串/标识符里）。
 * ★ 立刻回退。**教训正是用户裁定里那条**：*「判据靠**逐条查、逐条修**」* —— ★ **全局替换就是普查式修法**，
 * 而我在同一轮里刚承诺过"逐条判"。⇒ 后来逐条看，才看清"它根本不是缺陷"。
 *
 * ## 判据（真堵点 ⇒ 必须"**顺着指路走能走通**"）
 * ① `list_templates`：报错的指路**可跟随**（★ 那之前**连这个 action 都没有** —— 能力在、管道没接）
 * ② `list_features`：指路改指真入口（`manage_feature` 的 `list`）
 * ③ ★ 反例：**不该改的没改**（`ts_kernel` 仍是日志前缀 / DSL 节点 id 原样）
 */
import { execFileSync } from 'node:child_process';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'manage_feature', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};
const head = (s) => s.split('\n')[0].slice(0, 150);

console.log('══ ① `list_templates`：能力在、**管道没接** —— T196 接上了');
const err = call({ action: 'template', template_id: '__nope__', feature: 't196x' });
chk(err.includes('list_templates'), '①-a 报错**指路**到 `list_templates`', head(err));
chk(err.includes('manage_feature'), '①-b ★ 且指的是**真工具**（`manage_feature` 的 action），不再是裸名');
const listed = call({ action: 'list_templates' });
chk(listed.includes('可用模板') && /\[[a-z_]+\]/.test(listed), '①-c ★★ **顺着指路走能走通**（列出模板）', listed.split('\n').slice(0, 2).join(' | ').slice(0, 120));
chk(/\d+ 个/.test(listed), '①-d 报了数量（不是空壳回执）', (listed.match(/可用模板 \(\d+ 个\)/) ?? [''])[0]);
call({ action: 'delete', feature: 't196x' }); // 清理（万一建出来）

console.log('\n══ ② `list_features`（★ 不是工具、也不是参数）⇒ 指路改真入口');
// ★ 静态证：它已不在任何"叫你去调"的文案里（改后）
const fs = await import('node:fs');
const hd = fs.readFileSync('src/application/harvest/harvest_decisions.ts', 'utf8');
chk(!/请先用 list_features /.test(hd), '②-a 旧文案（裸 `list_features`）已不在');
chk(hd.includes('`manage_feature`') && hd.includes('action:"list"'), '②-b ★ 改成真入口 `manage_feature` action=list');

console.log('\n══ ③ ★ 反例：**不该改的没改**（逐条判的意义）');
const serve = fs.readFileSync('src/presentation/http/serve.ts', 'utf8');
chk(serve.includes("nodeId: 'file_tools_ts_kernel_kernel_ts'"), '③-a ★ `ts_kernel` 的 **DSL 节点 id 原样**（那是**数据**，改它会坏东西）');
const kernel = fs.readFileSync('src/infrastructure/parse/kernel.ts', 'utf8');
chk(kernel.includes('[ts_kernel] parse'), '③-b ★ `[ts_kernel] …` **日志前缀原样**（那不是路径、不是指路）');

console.log('\n══ ④ 构建仍绿（★ 我那次全局替换坏过它 —— 现在必须确认）');
const tsc = (() => {
  try { execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return 0; }
  catch (e) { return e.status ?? 1; }
})();
chk(tsc === 0, '④ `tsc --noEmit` ⇒ 0（★ 全局替换的伤已回退干净）', `code=${tsc}`);

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
