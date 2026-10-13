/**
 * T187 真跑：**退役流 ②→③ 到底接不接得上**（`consistency_check` → `archive`）。
 *
 * ★ 结果写进 `certs/.work/t187-out.txt`（**不往 stdout 灌**）—— 因为它要打印 `touched` 之类的
 *   小字段，而 `consistency_check` 的 `[C]` 回执里带着**全量 `fileResults`（400 文件）**，
 *   稍不注意就把终端淹了（我为此白折腾了两轮）。
 * ★ 本仓纪律：链边的 `evidence:'verified'` = **真跑过**。本脚本的产物就是那条边的**出生证**。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { consistencyHandler } from '../dist/src/application/design/handlers.js';
import { parseDataBlock } from '../dist/src/application/plumbing.js';

const TARGET = 'src/application/meta/llm/gateway.ts';
const FEATURE = 'run82';
const OUT = 'certs/.work/t187-out.txt';

const L = [];
let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  L.push(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const mcp = (tool, args) =>
  execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });

/** 取 `[C]` 回执里的机器段 —— ★★★ T251：解析只走唯一入口 `parseDataBlock`
 *   （原先这里自己写了一份 `indexOf + 整段 JSON.parse` —— ★ 整段 parse 正是"JSON 之后有追加文本就必炸"的旧口径）。
 *   ★ 先确认取到了，别让"没标记"变成一句难懂的解析错。 */
const dataOf = (r) => {
  const d = parseDataBlock(r.text);
  if (d === null) throw new Error(`回执里没有 DATA 段（或 DATA 首行不是合法 JSON）；text 头 200 字：${r.text.slice(0, 200)}`);
  return d;
};

L.push('════ ① ② 这一棒交出什么（[C] 编排后的 touched）');
const r1 = await consistencyHandler({ feature: FEATURE });
const d1 = dataOf(r1);
L.push('  touched    = ' + JSON.stringify(d1.touched));
L.push('  retireFlow = ' + JSON.stringify(d1.retireFlow));
const sf1 = d1.touched?.scope_files ?? [];
chk(sf1.includes(TARGET), '★★ 待归档的文件现在**在 scope_files 里**了吗（改前：不在）', JSON.stringify(sf1));

L.push('\n════ ② ★★★ 真跑交接：把 scope_files[0] 直接喂给 archive.file_path');
const p0 = sf1.find((x) => x === TARGET);
chk(!!p0, '取到待归档路径', String(p0));
const aOut = p0
  ? mcp('archive', { action: 'node', feature: FEATURE, file_path: p0, retire_reason: 'T187 真跑：验证②→③的交接' })
  : '';
chk(!!aOut && !aOut.includes('isError=true'), '★ archive 接受了这个路径（**零字段名翻译**）', (aOut.split('\n')[0] ?? ''));
chk(aOut.includes('三清'), '★ 且真的三清了', (aOut.split('\n')[0] ?? ''));

L.push('\n════ ③ 交接后：那个文件确实从 DSL 里没了（归档是终态）');
const r2 = await consistencyHandler({ feature: FEATURE });
const d2 = dataOf(r2);
chk(!(d2.retireFlow ?? []).some((x) => x.file_path === TARGET), '★ retireFlow 里不再有它');
chk(!(d2.touched?.scope_files ?? []).includes(TARGET), '★ scope_files 里也没有它了（差异已消解）');

L.push('\n════ ④ 反例：run82 里此时应当**没有**别的退役标记 ⇒ scope_files 只剩 API 差异');
L.push(`      scope_files 条数 = ${(d2.touched?.scope_files ?? []).length}（应 = API 差异条数，不含退役）`);

L.push(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log(`结果已写入 ${OUT}（PASS=${P} FAIL=${F}）`);
