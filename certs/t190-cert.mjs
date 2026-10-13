/**
 * T190 出生证：**"活态 DSL 回退"进 MCP 告警通道** —— 接手方在【工具回执】里看得见。
 *
 * ## 判据（四个方向都要自证）
 * ① **干净时不许报**（不误报）—— ★ **并连带断言"探针真的跑了"**（否则 ① 可以**空过**）；
 * ② **坏掉时必须在回执里报**，且**首次带 `detail`/`fix`**（全文）；
 * ③ ★ **同一进程内第二次只剩摘要**（不带 `fix`）—— 验 `emitWarnings` 的"首次全文/后续摘要"；
 * ④ ★★ **修好之后必须【不再报】** —— 验自清（不这么做就"粘住不放"，把"已恢复"说成"仍然坏着"）。
 *
 * ## ★★ 探针是**证出来的、不是猜的**（我为此白跑一轮，记下来当反面教材）
 * 第一版用 `get_dsl {feature:'run82'}` —— ★ 而它**要求 `query`**（枚举）⇒ 被 **zod 拒** ⇒
 * **探针根本没跑** ⇒ ②③ 全红，而 ①「干净时不许报」**是空过的**（没跑当然没告警）。
 * ⇒ 换 `consistency_check`（**确定**调 `getDSL`），并**每条都先断言"探针没被 schema 拒"**。
 * ★ 教训：**"没报错"与"没跑"在回执里长得一样** —— 必须显式区分（`gate-authoring`：空过最隐蔽）。
 *
 * ## ★ 为什么必须**在同一个进程内**测
 * `lastLiveFallback` 是**进程级**的，而 `mcp_call` **每次都是新进程** ⇒ 分级（②→③）与自清（④）
 * 在那种测法下**观察不到** ⇒ ★ 本证用 **`invokeTool` 直调**（= 服务器真实形态）。
 */
import fs from 'node:fs';
import { TOOL_DEFS } from '../dist/src/application/tool_registry.js';
import { invokeTool, liveDslFallbackWarning } from '../dist/src/presentation/mcp/server_registry.js';
import { getLiveDslFile, getLiveFallback } from '../dist/src/infrastructure/storage.js';

const LIVE = getLiveDslFile();
const BACKUP = LIVE + '.t190-bak';
const CODE = 'LIVE_DSL_FALLBACK';

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 真调 gateway（与服务器同一条路）。★ 返回 isError，好用断言"真的跑了" */
const runOnce = async () => {
  const def = TOOL_DEFS.find((d) => d.name === 'consistency_check');
  const r = await invokeTool(def, { feature: 'run82' });
  return { text: r.text ?? '', isError: !!r.isError };
};
const short = (s) => s.split('\n').slice(0, 2).join(' | ').slice(0, 150);

console.log('活态文件：' + LIVE);
fs.copyFileSync(LIVE, BACKUP);
console.log('（已备份）');

try {
  console.log('\n════ ① 干净时：不许报（★ 且先证探针真的跑了，否则这条会空过）');
  fs.copyFileSync(BACKUP, LIVE);
  chk(liveDslFallbackWarning() === null, 'producer 直接调 ⇒ null（干净）');
  const t0 = await runOnce();
  chk(!t0.isError, '★★ 探针**真的跑了**（不是被 schema 拒）', short(t0.text));
  chk(!t0.text.includes(CODE), '★ 工具回执里**没有**这条告警（干净时不误报）');

  console.log('\n════ ② 把活态文件写坏 ⇒ 必须在回执里报，且首次带全文');
  fs.writeFileSync(LIVE, '{ 这不是合法 JSON', 'utf8');
  const t1 = await runOnce();
  chk(!t1.isError, '★★ 探针真的跑了（坏文件下是"人话返回"，不是 schema 拒）', short(t1.text));
  chk(t1.text.includes(CODE), '★★ 回执里**出现了**这条告警（★ T188 之前它只在 stderr 上，用户看不见）');
  chk(t1.text.includes('已回退到 feature 存档'), '★ 摘要说清"已回退到存档"（读者据此知道读到的是旧的）');
  chk(t1.text.includes('下次 `saveDSL` 会重建'), '★ **首次带 `fix`**（可执行修复）');
  console.log(`     [回执片段] ${t1.text.split('\n').filter((l) => l.includes('回退')).slice(0, 1).join('').slice(0, 150)}`);

  console.log('\n════ ③ ★ 同一进程内第二次：只剩摘要（不带 fix）');
  const t2 = await runOnce();
  chk(t2.text.includes(CODE), '第二条回执里**仍在**（★ 后续**不静默**）');
  const firstHasFix = t1.text.includes('下次 `saveDSL` 会重建');
  const secondHasFix = t2.text.includes('下次 `saveDSL` 会重建');
  chk(firstHasFix && !secondHasFix, '★★ 首次带 `fix`、后续**不带** ⇒ "首次全文/后续摘要"真的生效', `first=${firstHasFix} second=${secondHasFix}`);

  console.log('\n════ ④ ★★ 修好之后：必须不再报（自清）');
  fs.copyFileSync(BACKUP, LIVE);
  chk(liveDslFallbackWarning() === null, '★ producer 现在返回 **null**（自清：告警必须反映【现在】）');
  const t3 = await runOnce();
  chk(!t3.text.includes(CODE), '★★ 复原后的回执里**不再有**那条告警（★ 不粘住）');
  chk(getLiveFallback() !== null, '（如实）历史记录**仍在** —— 自清靠"现在还能解析"，不是抹掉历史');
} finally {
  fs.copyFileSync(BACKUP, LIVE);
  fs.rmSync(BACKUP, { force: true });
  const raw = fs.readFileSync(LIVE, 'utf8');
  let ok = false;
  try { ok = JSON.parse(raw).feature === 'run82'; } catch { ok = false; }
  chk(ok, '收尾：活态文件已还原且**可解析**（回读断言）');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
