/**
 * T197 出生证：`explore_code` 的 `args` **键名校验** —— 拼错的键从"静默丢掉"改成"当场抛"。
 *
 * ## ★★ 为什么**不能**用"重新跑一遍派生正则"来验证（那会"判据恒真"）
 * 表是**用正则从源码派生**的 ⇒ ★ 若再用**同一个正则**去核对 ⇒ **恒等**、**零信息**（§2.4「判据恒真=装饰」）。
 * ⇒ 本证**只看行为**：★ **15 个 action 逐个真跑两次**
 *   ① 只给**表里列出的键** ⇒ ★ **不许出现"不认识的键"**（否则表**多收**了 ⇒ 会误拒合法键，是最危险的错向）
 *   ② 塞一个**假键** ⇒ ★ **必须出现**（否则表**漏收**了 ⇒ 等于没校验）
 * ★★ 两个方向都要证 —— 只证一个方向会漏掉另一半。
 *
 * ## 另外三条
 * ③ "是不是想写 X" 的提示要对（拼 `feture` ⇒ 提示 `feature`）；
 * ④ 一个**真调用**（`guided_tour {feature:'run82'}`）必须照常成功 —— ★ 不许变成"一律拒"的废门；
 * ⑤ 表**覆盖全部 action**（★ 漏一个 = 那个 action 静默不校验 ⇒ 是个洞）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXPLORE_ARGS } from '../dist/src/application/meta/explore/explore_arg_spec.js';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const call = (args) => {
  let out = '';
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'explore_code', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  return out;
};
const UNKNOWN = '不认识的键';

console.log('══ ⑤ 表覆盖全部 action（★ 漏一个 = 那个 action 静默不校验）');
const def = TOOL_DEFS.find((d) => d.name === 'explore_code');
const allActions = def.inputSchema.action.def.entries
  ? Object.keys(def.inputSchema.action.def.entries)
  : def.inputSchema.action.def.values;
const tbl = Object.keys(EXPLORE_ARGS);
const missing = allActions.filter((a) => !tbl.includes(a));
const extra = tbl.filter((a) => !allActions.includes(a));
chk(missing.length === 0 && extra.length === 0, `⑤ 表与 action 枚举**恰好一致**（${allActions.length} 个）`, `缺=${missing.join(',') || '无'} 多=${extra.join(',') || '无'}`);

console.log('\n══ ① + ② 十五个 action 逐个真跑两次（★ 两个方向都验）');
const wrongDirection = []; // ① 合法键却被拒 ⇒ 最危险
const holeDirection = [];  // ② 假键却没拒 ⇒ 等于没校验
for (const a of allActions) {
  const good = Object.fromEntries(EXPLORE_ARGS[a].map((k) => [k, k === 'feature' ? 'run82' : undefined]));
  const r1 = call({ action: a, args: good });
  if (r1.includes(UNKNOWN)) wrongDirection.push(a);
  const r2 = call({ action: a, args: { ...good, zz_t197_bogus: 1 } });
  if (!r2.includes(UNKNOWN)) holeDirection.push(a);
}
chk(wrongDirection.length === 0, '① ★ **没有**把合法键拒掉（表多收 ⇒ 会误拒 ⇒ 最危险的错向）', wrongDirection.length ? `被误拒: ${wrongDirection.join(', ')}` : '15/15 都没被误拒');
chk(holeDirection.length === 0, '② ★ **每个 action**都拦住了假键（表漏收 ⇒ 等于没校验）', holeDirection.length ? `漏拦: ${holeDirection.join(', ')}` : '15/15 都拦住了');

console.log('\n══ ③ "是不是想写 X" 的提示');
const typo = call({ action: 'guided_tour', args: { feture: 'run82' } });
chk(typo.includes(UNKNOWN), '③-a 拼错的键（`feture`）⇒ 抛', typo.split('\n')[0].slice(0, 110));
chk(typo.includes('是不是想写') && typo.includes('feature'), '③-b ★ 且**指出**"是不是想写 `feature`"', (typo.split('\n')[1] ?? '').slice(0, 110));
chk(typo.includes('静默丢掉'), '③-c 报错里**解释了为什么必须拒**（不是一句"参数错"）');

console.log('\n══ ④ 真调用照常成功（★ 不许变成"一律拒"的废门）');
const real = call({ action: 'guided_tour', args: { feature: 'run82' } });
chk(!real.includes(UNKNOWN) && real.includes('total_nodes'), '④ `guided_tour {feature:"run82"}` ⇒ 照常成功', (real.match(/"total_nodes":\d+/) ?? [''])[0]);

console.log('\n══ ⑤ 形状判据（T191）与键名判据（T197）是**两把尺**，都在');
const shape = call({ action: 'derive_mind_map', args: { feature: 'run82', gen_descriptions: 'yes' } });
chk(shape.includes('形状不对'), '⑤-a 值形状错 ⇒ 仍由 `plumbing.optionalBool` 抛（T191 那条没被顶掉）', shape.split('\n')[0].slice(0, 100));
const both = call({ action: 'derive_mind_map', args: { feature: 'run82', zz_bogus: 1, gen_descriptions: 'yes' } });
chk(both.includes(UNKNOWN), '⑤-b ★ 键名错**先**被拦（键名判据在 switch 之前 ⇒ 任何 action 都拦得住）', both.split('\n')[0].slice(0, 100));

console.log('\n★★★ 尾注：**本证 ① 是【弱】的,别把它读强了**（★ 我第一版读强了，被回归套件打脸）');
console.log('  · ① 喂进去的"合法键"就是**表自己的键** ⇒ ★ 它**只能**证明"表不会拒自己列的东西"；');
console.log('  · ★★ 若表**漏了**某个源码真读的键 ⇒ ① 也照样绿（那个键压根没进输入）⇒ **恒真**；');
console.log('  · ★★★ **真正发现"漏收"的是【回归套件】** —— 它抓到 `t191-cert.mjs` 一直在传 `project_dir`，');
console.log('    而 `derive_mind_map` **只读 4 个键**（那个 `project_dir` 一直被**静默忽略**）。');
console.log('  ⇒ ★ 教训：**验证方式的来源不能与生成方式同源**；本条的独立来源 = **在表之前就写好的那些证**。');

// ★★★ T215（2026-10-13）：**"漏参数"那一半** —— ★ 外部评测的 ③
//   评测原话：*"入口合并了…增加**选错动作、漏参数、漏读限制**的机会"* ✓
//   ★ 上面那些证的是"**键名拼错**"（T197 加的 ✓）；★ 这里证"**硬必填缺失**"（T215 加的 ✓）
//   ★★ 判据（★ 正反两面都要 —— ★ 只证"该拒"会漏掉"**误拒**" ✗）：
//     ① 缺必填 ⇒ **拒，且说清缺哪个** ✓
//     ② ★ **不缺的【不许】被这道拦** ✓（★ 否则就是"过度设防"：★ 那会把好调用也挡掉 ✓）
//
// ★★★ T223（2026-10-13）**修一个坏证**：本块原先写的是 `call('explore_code', {...})` 并读
//   `miss1.text` —— ★ 而那**不是本文件的 `call` 约定** ✗（本文件是 `call(args) => string`，
//   工具名写死成 `explore_code`）⇒ ★ `miss1` 是字符串、`miss1.text` 是 `undefined`
//   ⇒ `undefined.split(...)` **当场 TypeError** ⇒ ★★ **这三条断言【从来没跑过】** ✓
//   而它在套件里只显示"崩" ⇒ ★ 看着像环境噪声，其实是**坏证**（★ §2.4"没报错与没跑长得一样"的同类）✓
//   ⇒ 改用本文件的约定；★ 且反例断言**不许恒真**：`search` 成功时会回"查询为空"
//     （实测 ✓）⇒ 把它一并断言，免得"命令没跑成"被读成"没被拦" ✓
const EXT_FOR_T215 = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-io-t215-root-'));
fs.writeFileSync(path.join(EXT_FOR_T215, 'a.ts'), 'export const a = 1;\n');  // ★ 自建，不借别的证的夹具 ✓

console.log('\n══ T215 硬必填（★ 缺 ⇒ 拒；★ 不缺 ⇒ 不拦）');
{
  const miss1 = call({ action: 'run_simulation', args: {} });
  chk(/缺\*\*必填\*\*参数/.test(miss1) && /feature/.test(miss1),
    'T215-a 缺必填 ⇒ **拒，且说清缺哪个**', `run_simulation 缺 feature ⇒ ${miss1.split('\n')[0].slice(0, 70)}`);

  const miss2 = call({ action: 'inject_replay', args: { feature: 'f' } });
  chk(/缺\*\*必填\*\*参数/.test(miss2) && /flow_id/.test(miss2),
    'T215-b ★ 多个必填时，**只缺一个也要说清是哪个**', `inject_replay 给了 feature、缺 flow_id ⇒ ${miss2.split('\n')[0].slice(0, 70)}`);

  // ★★ 反例：★ `search` 的 `query` **不在**必填表里（★ 描述说"空则返回『查询为空』提示" ✓）
  //   ⇒ ★ 只给 `project_dir` **不该**被必填这道拦 ✓
  //   ★★ 且要**同时**证明"它真的跑起来了"（`查询为空`）—— ★ 否则命令失败也会让上面那条绿 ✗
  const ok = call({ action: 'search', args: { project_dir: EXT_FOR_T215 } });
  chk(ok.includes('查询为空') && !/缺\*\*必填\*\*参数/.test(ok),
    'T215-c ★★ **反例**：不缺的不许被这道拦（★ 否则是"过度设防" ✗）★ 且真跑起来了',
    `search 只给 project_dir ⇒ ${ok.split('\n')[0].slice(0, 70)}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
