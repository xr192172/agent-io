/**
 * T187 真跑：**退役流 ②→③ 到底接不接得上**（`consistency_check` → `archive`）。
 *
 * ★ T254：本证**自摆前置**（= 三步流的①）—— 把 base 上的 `gateway.ts` 标成 `deprecated`。
 *   不摆的后果（实测）：`retireFlow` 是空的 ⇒ "不再有它"那两条是**空过**（压根没有输入）。
 *   ★ 写 base 走 `saveDSL`（活态 + run82 存档）+ `syncLifecycleToOverlay`（与 `edit_dsl` 同一条收口），
 *     **不调 `edit_dsl`** —— 它会对"盘上已删"的文件做 facts 校验，而本证测的是②→③、不是①的写入路径。
 * ★ 起点与收尾都跑 `certs/t185-reset.mjs`（整份还原：活态 · 存档 · overlay · 归档库）。
 * ★ 明细写 `certs/.work/t187-out.txt`；stdout 与它同一份（含标准 `汇总：PASS=n  FAIL=m`，套件靠它判红/绿）。
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { consistencyHandler } from '../dist/src/application/design/handlers.js';
import { parseDataBlock } from '../dist/src/application/plumbing.js';
import { getDSL, saveDSL } from '../dist/src/infrastructure/storage.js';
import { syncLifecycleToOverlay, loadOverlay } from '../dist/src/infrastructure/storage_overlay.js';

const FEATURE = 'run82';
const TARGET = 'src/application/meta/llm/gateway.ts';
const TARGET_ID = 'file_src_application_meta_llm_gateway_ts';
const REASON = 'T187 真跑：验证②→③的交接（本证自摆的待删标记）';
const OUT = 'certs/.work/t187-out.txt';
const ARCHIVE_DIR = '.agent-io/archive/run82';

const L = [];
let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  L.push(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const mcp = (tool, args) =>
  execFileSync('node', ['scripts/mcp/mcp_call.mjs', tool, JSON.stringify(args)], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });

/** `[C]` 回执的机器段 —— 解析只走唯一入口 `parseDataBlock`（取不到 ⇒ 响亮报，不静默）。 */
const dataOf = (r) => {
  if (r.isError) throw new Error(`consistency_check 返回错误：${r.text}`);
  const d = parseDataBlock(r.text);
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.retireFlow) ||
      !d.touched || typeof d.touched !== 'object' || Array.isArray(d.touched)) {
    throw new Error('consistency_check 没有给出本证需要的 retireFlow 数组与 touched 对象');
  }
  if (d.touched.scope_files !== undefined && !Array.isArray(d.touched.scope_files)) {
    throw new Error('consistency_check 的 scope_files 不是数组');
  }
  return d;
};

/** 摆前置：把 TARGET 标成 base 上的 `deprecated`（活态 + run82 存档），并同步进 overlay。 */
const markDeprecated = () => {
  const d = getDSL(FEATURE);
  const f = d.semantic?.files?.find((x) => x.id === TARGET_ID);
  if (!f) throw new Error(`base 里没有 ${TARGET_ID}（前置摆不下去 —— 先跑 t185-reset）`);
  f.lifecycle = { status: 'deprecated', retire_reason: REASON };
  saveDSL(d);
  syncLifecycleToOverlay(FEATURE, getDSL(FEATURE));
};

const reset = () => execFileSync('node', ['certs/t185-reset.mjs'], { encoding: 'utf8' });

try {
  // ⓪ 起点：复位到已知 good，再摆前置（自证标记真的进去了）
  reset();
  L.push('════ ⓪ 前置（本证自摆：base 上 gateway.ts = deprecated）');
  markDeprecated();
  const base = getDSL(FEATURE).semantic?.files?.find((x) => x.id === TARGET_ID);
  chk(!!base, '目标在语义 base 里', TARGET_ID);
  chk(
    base?.lifecycle?.status === 'deprecated' && base?.lifecycle?.retire_reason === REASON,
    '标记读回（base 上 = deprecated + 理由）',
    JSON.stringify(base?.lifecycle),
  );
  chk(!!loadOverlay(FEATURE)?.anchors?.[TARGET_ID]?.lifecycle, 'overlay 上也同步了这笔标记（终态收口才有对象可清）');
  chk(!fs.existsSync(TARGET), '盘上确实已无（⇒ 该走③归档，不是"等实现删"）', TARGET);

  // ① ② 这一棒交出什么（[C] 编排后的 touched）
  L.push('\n════ ① ② 这一棒交出什么（[C] 编排后的 touched）');
  const r1 = await consistencyHandler({ feature: FEATURE });
  const d1 = dataOf(r1);
  L.push('  touched    = ' + JSON.stringify(d1.touched));
  L.push('  retireFlow = ' + JSON.stringify(d1.retireFlow));
  const sf1 = d1.touched.scope_files ?? [];
  const retiring = d1.retireFlow.find((x) => x.file_path === TARGET);
  chk(retiring?.stage === 'ready_to_archive', '退役轴确实报出目标且为 ready_to_archive', JSON.stringify(retiring));
  const targetFacts = Array.isArray(d1.fileResults) ? d1.fileResults.find((x) => x.file?.path === TARGET) : undefined;
  chk(!!targetFacts && Array.isArray(targetFacts.apis) && targetFacts.apis.length === 0,
    '目标没有 API 对拍差异（不能用契约缺失冒充退役折入 scope_files）');
  chk(retiring?.stage === 'ready_to_archive' && sf1.includes(TARGET),
    '★★ 待归档的文件在 scope_files 里（②把"待退役"折进了差异面）', JSON.stringify(sf1));

  // ② 真跑交接：把 scope_files 里的 TARGET 直接喂给 archive.file_path
  L.push('\n════ ② ★★★ 真跑交接：把 scope_files 里的 TARGET 直接喂给 archive.file_path');
  const p0 = sf1.find((x) => x === TARGET);
  chk(!!p0, '从 scope_files 取到待归档路径', String(p0));
  const aOut = p0
    ? mcp('archive', { action: 'node', feature: FEATURE, file_path: p0, retire_reason: 'T187 真跑：验证②→③的交接' })
    : '';
  const aFirst = aOut.split('\n')[0] ?? '';
  const archiveAccepted = !!aOut && !aOut.includes('isError=true') && aOut.includes('已把') && aOut.includes(TARGET);
  chk(archiveAccepted, '★ archive 接受了这个路径（**无 isError + 真实回执正对照**，不是空回执）', aFirst);
  chk(archiveAccepted && aOut.includes('三清'), '★ 且真的三清了', aFirst);

  // ③ 交接后：归档是终态 —— 三个读回（retireFlow / scope_files / getDSL）
  L.push('\n════ ③ 交接后：归档是终态（retireFlow / scope_files / getDSL 三处读回）');
  const r2 = await consistencyHandler({ feature: FEATURE });
  const d2 = dataOf(r2);
  chk(archiveAccepted && !d2.retireFlow.some((x) => x.file_path === TARGET), '真归档后 retireFlow 里不再有它', JSON.stringify(d2.retireFlow));
  chk(archiveAccepted && !(d2.touched.scope_files ?? []).includes(TARGET), '真归档后 scope_files 里也没有它了（差异已消解）', JSON.stringify(d2.touched.scope_files));
  chk(
    archiveAccepted && !(getDSL(FEATURE).semantic?.files ?? []).some((f) => f.path === TARGET),
    '★ getDSL 的 base 里也没有它了（归档真发生了，不是"本来就不在"）',
  );
  L.push(`\n      （归档后 scope_files 条数 = ${(d2.touched?.scope_files ?? []).length}）`);
} catch (e) {
  // ★ 意外异常**不许静默吞成绿**：记一条红、把 message 留在明细里（rc 由 F>0 决定）
  chk(false, `★★ 意外异常（本证自己的失败）：${String(e && e.message).slice(0, 300)}`);
} finally {
  // 收尾：无论成败都复位（活态/存档/overlay/归档库）—— 量具不许留污染
  L.push('\n════ ④ 收尾：复位并自证已还原');
  try {
    reset();
    const back = getDSL(FEATURE).semantic?.files?.find((x) => x.id === TARGET_ID);
    chk(!!back && !back.lifecycle, 'base 已还原（目标回来了、且没有 lifecycle）', JSON.stringify(back?.lifecycle ?? null));
    chk(!loadOverlay(FEATURE)?.anchors?.[TARGET_ID]?.lifecycle, 'overlay 上那笔 lifecycle 已清');
    chk(!fs.existsSync(ARCHIVE_DIR), `归档库已清（${ARCHIVE_DIR} 不存在）`);
  } catch (e) {
    chk(false, `★★ 收尾失败（复位没跑成）：${String(e && e.message).slice(0, 300)}`);
  }
  L.push(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
  const body = L.join('\n');
  fs.mkdirSync('certs/.work', { recursive: true });
  fs.writeFileSync(OUT, body, 'utf8');
  console.log(body);
  if (F > 0) process.exitCode = 1; // ★ 只设 exitCode：不提前 process.exit（否则 finally 里这行都不会跑到）
}
