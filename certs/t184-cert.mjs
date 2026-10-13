/**
 * T184 出生证：**三步流的②** —— 对拍能不能认出「设计说该删，实现删完了没有」。
 *
 * ## 判据（先问"凭什么变红"）
 *   · 设计标了 `deprecated` + **实现里还在**  ⇒ `retire_pending=1`，报告说"②尚未完成"
 *   · 设计标了 `deprecated` + **实现里也没了** ⇒ `retire_ready=1`，报告说"可以走③归档"
 *   · **没有任何标记** ⇒ 两个计数都是 0（★ **不是**"都删完了"）
 *   · ★★ **不许混着比**：本轴的读数变化**不得**改动线 2 的 `state` / `compared`（T85 那根病根）
 *
 * ## ★ 反例（必须证明判据能区分，不是恒真）
 *   ① 只有"实现还在"那种 ⇒ **不许**出现"可归档"
 *   ② 把标记撤掉 ⇒ 两个计数**必须**回到 0
 */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkConsistencyReport } from '../dist/src/application/design/intent/consistency.js';

const FEATURE = 'run82';
const LIVE = 'agent-io.json';
const FEATFILE = `.agent-io/features/${FEATURE}.json`;
const OVERLAY = `.agent-io/features/${FEATURE}.overlay.json`;
const EXISTS_FILE = 'dogfood/build_cache.mjs';          // 实现里【在】
const GONE_FILE = 'src/application/meta/llm/gateway.ts'; // 实现里【不在】（真实读数：400 个里唯一一个）
const SNAPSHOT = [LIVE, FEATFILE, OVERLAY].map((p) => [p, fs.readFileSync(p, 'utf8')]);

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 直接改 DSL（本脚本测的是【对账】这一环，不是 `edit_dsl` 的写入路径 —— 那条另有用具） */
function setLifecycle(path, lc) {
  for (const p of [LIVE, FEATFILE]) {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    const f = (d.semantic?.files ?? []).find((x) => x.path === path);
    if (!f) continue;
    if (lc === undefined) delete f.lifecycle;
    else f.lifecycle = lc;
    fs.writeFileSync(p, JSON.stringify(d, null, 2), 'utf8');
  }
}
const restore = () => { for (const [p, s] of SNAPSHOT) fs.writeFileSync(p, s, 'utf8'); };

async function report() { return await checkConsistencyReport({ feature: FEATURE }); }

console.log('════ ⓪ 基线：没有任何 deprecated 标记');
restore();
let r = await report();
chk(r.retireFlow.length === 0, 'retireFlow 为空', `len=${r.retireFlow.length}`);
chk(r.summary.retire_pending === 0 && r.summary.retire_ready === 0, '两个计数都是 0',
  `pending=${r.summary.retire_pending} ready=${r.summary.retire_ready}`);
chk(!r.message.includes('可以走③归档'), '★ 反例：没有标记 ⇒ 不提"可归档"（不是恒真）');
chk(!r.message.includes('待实现侧删除'), '★ 反例：没有标记 ⇒ 不提"待删除"');
const baseState = r.summary.state, baseCompared = r.summary.compared;
console.log(`     （基线：线2 state=${baseState} compared=${baseCompared}；文件总数=${r.summary.total_files}）`);
chk(r.message.includes('反向信号'), '★ 反向信号也在工作（DSL 里有 1 个实现已不存在的文件）');

console.log('\n════ ① 标一个**实现里还在**的文件 ⇒ ②尚未完成');
setLifecycle(EXISTS_FILE, { status: 'deprecated', retire_reason: 'T184 出生证：设计说该删，而实现还在' });
r = await report();
chk(r.summary.retire_pending === 1 && r.summary.retire_ready === 0, 'retire_pending=1 / retire_ready=0',
  `pending=${r.summary.retire_pending} ready=${r.summary.retire_ready}`);
chk(r.retireFlow[0]?.stage === 'awaiting_implementation_delete', 'stage=awaiting_implementation_delete（判据一处 retireStage）',
  String(r.retireFlow[0]?.stage));
chk(r.message.includes('待实现侧删除（1）'), '报告说"②尚未完成"');
chk(r.message.includes('设计说该删，而实现还在'), '报告带上了①写的理由（考古要用）');
chk(!r.message.includes('可以走③归档'), '★ 反例：实现还在 ⇒ **不许**说"可归档"');

console.log('\n════ ② 标一个**实现里已不存在**的文件 ⇒ 可以走③归档');
setLifecycle(EXISTS_FILE, undefined);
setLifecycle(GONE_FILE, { status: 'deprecated', retire_reason: 'T184 出生证：设计说该删，实现也确实没了' });
r = await report();
chk(r.summary.retire_ready === 1 && r.summary.retire_pending === 0, 'retire_ready=1 / retire_pending=0',
  `pending=${r.summary.retire_pending} ready=${r.summary.retire_ready}`);
chk(r.retireFlow[0]?.stage === 'ready_to_archive', 'stage=ready_to_archive', String(r.retireFlow[0]?.stage));
chk(r.message.includes('可以走③归档'), '报告说"②已被证明、可以走③归档"');
chk(r.message.includes('不要') && r.message.includes('deleteFile') && r.message.includes('T180'),
  '★ 且指路"别用 deleteFile"（T180 的教训：它会留幽灵节点）');
chk(!r.message.includes('待实现侧删除'), '★ 反例：实现没了 ⇒ 不再说"待实现侧删除"');

console.log('\n════ ③ 两种同时存在 ⇒ 各数各的');
setLifecycle(EXISTS_FILE, { status: 'deprecated', retire_reason: 'T184 出生证：A' });
r = await report();
chk(r.summary.retire_pending === 1 && r.summary.retire_ready === 1, 'pending=1 且 ready=1',
  `pending=${r.summary.retire_pending} ready=${r.summary.retire_ready}`);
chk(r.message.includes('待实现侧删除（1）') && r.message.includes('可归档（1）'), '报告两段都在');

console.log('\n════ ④ ★★ 不混着比：本轴**不得**改动线 2 的读数');
chk(r.summary.state === baseState, `线2 state 未被本轴影响（${baseState} → ${r.summary.state}）`);
chk(r.summary.compared === baseCompared, `线2 compared 未被本轴影响（${baseCompared} → ${r.summary.compared}）`);
chk(r.summary.unexpected === 0, '线2 的 unexpected 仍恒 0（没被塞进新东西）');

console.log('\n════ ⑤ 撤掉所有标记 ⇒ 回到 ⓪');
setLifecycle(EXISTS_FILE, undefined);
setLifecycle(GONE_FILE, undefined);
r = await report();
chk(r.summary.retire_pending === 0 && r.summary.retire_ready === 0, '两个计数回到 0');
chk(r.retireFlow.length === 0, 'retireFlow 回到空');

restore();
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
console.log('（已还原 agent-io.json / features / overlay）');
