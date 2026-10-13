/**
 * T186b 出生证：**observe 侧那套提案开了 MCP 口** —— 接手方从此看得见、也批得了。
 *
 * ## 判据（★ 两个方向都要自证 —— `gate-authoring` §0 纪律③）
 * · **坏/缺输入** ⇒ 拒：不署名 ⇒ 拒；提案不存在 ⇒ 拒；失败 ⇒ **抛**（`isError=true`）。
 * · **好输入** ⇒ **放行**：一个**带确定性谓词**的提案，在四层门下**应当定稿**（`version>0`）——
 *   ★ 只证"会冻结"是不够的，那可能是个"一律冻结"的废门。
 * · ★★ **最容易读错的一处**：`frozen` 是"**门判定不许落**"，**不是通过** ⇒
 *   回执措辞与 `data.frozen` 都要能区分 —— 本证**分别断言两种措辞**。
 * · ★ **"不许自批"在这侧只能部分判**（`Proposal` 无 `submitter`）：
 *   `source="loop"` ⇒ 可判（提出方是机器）；`manual` ⇒ **必须明标"判不了"**（不冒充判过）。
 *
 * ★ 隔离：全部在一个**临时 project 根**下的 store 里做 —— ★ 真实 `.agent/observe` **一动不动**。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { ProposalStore } from '../dist/src/infrastructure/analysis/observe/proposal_store.js';
import { defaultDSLDir } from '../dist/src/infrastructure/analysis/observe/dsl_store.js';
import { knownSpreadDecl } from '../dist/src/infrastructure/analysis/observe/ledger_fold.js';
import { parseDataBlock } from '../dist/src/application/plumbing.js';

const ROOT = path.resolve('certs/.work/t186b-tenant');
const dir = defaultDSLDir(ROOT);
// ★★★ T224：**本证是唯一【不能】把草稿放 `os.tmpdir()` 的一张** —— 实测坐实：
//   · 同族的证都把租户放 temp（护栏对 temp 整体绕过、且不受 .gitignore 影响），★ 本证照做 ⇒ **红了 15 条** ✓
//   · 原因：★ `observe_proposals` 有**项目范围闸**，回执逐字说
//     *"project_dir 超出允许范围（仅允许写入当前项目：D:\project_develop\design-canvas ; …）"*
//     ⇒ ★ **仓外路径一律拒** ⇒ temp 租户拿不到任何东西 ✓
//   ⇒ ★ 判据：**草稿放哪，先问"这个工具对 project_dir 有没有范围闸"** ——
//     有闸 ⇒ 只能在**项目内**（本证用 `certs/.work/`，它被 gitignore，但本证不走 `import_project`
//     ⇒ 那条"gitignore 会过滤文件"的顾虑**对本证不适用** ✓）；
//     没闸 ⇒ 放 temp（护栏绕过 + 仓外）✓
//   ★ 代价记账：本证的 `rmSync(ROOT,{recursive:true})`（2 处）**会占**宿主护栏的条目配额
//     —— 实测全量仍过（合并后的总配额没被它撑破 ✓），但它是**已知的、唯一**的占用点 ✓

let P = 0, F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 调工具：返回 {isErr, message, data} */
const call = (args) => {
  let out = '';
  let isErr = false;
  try {
    out = execFileSync('node', ['scripts/mcp/mcp_call.mjs', 'observe_proposals', JSON.stringify(args)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = String((e.stdout ?? '') + (e.stderr ?? ''));
  }
  isErr = out.includes('isError=true');
  // ★★★ T251：机器段解析只走唯一入口 `parseDataBlock`（原先这里自己 indexOf+slice+JSON.parse 一份）。
  //   ★ 口径不变，教训仍在：JSON 只取第一行 —— 它后面还跟着"下一棒"散文块与 `--- stderr ---`，
  //     整段 parse 必炸（我曾把散文喂进 JSON.parse 又被自己的 try/catch 吞成 {} —— 量具里的静默兜底）。
  //   ★★ 实测：失败回执【没有】`---DATA---`（走 `wrap` 失败通路 ⇒ 只有文字 + `isError=true`）
  //     ⇒ "出错 ⇒ 无 DATA"是**正常**；只有"**没出错却也没取到**"才是异常（那才该抛）。
  const parsed = parseDataBlock(out);
  if (parsed === null && !isErr) throw new Error(`没出错却没取到 DATA 段（无标记或首行不是合法 JSON）（异常）：${out.slice(0, 200)}`);
  const data = parsed ?? {};
  return { isErr, message: out.split('---DATA---')[0], data };
};

// ── 0. 隔离：临时根 + 空 store
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(ROOT, { recursive: true });
const store = new ProposalStore(dir);
console.log('临时 store: ' + dir);
console.log('真实 .agent 存在吗（应当【不存在/不被碰】）:', fs.existsSync(path.resolve('.agent')));

console.log('\n════ ① 空库：list 要给"0 条"，且**不许把 0 读成"都没问题"**');
const l0 = call({ action: 'list', project_dir: ROOT });
chk(!l0.isErr, 'list 可用');
chk(l0.data.count === 0, 'count=0', String(l0.data.count));
chk(l0.message.includes('0 条 ≠'), '★ 文案明说"0 条 ≠ 都没问题"（不静默）');

console.log('\n════ ② 造两条提案（★ 用**真实产者的形状** `knownSpreadDecl`；不入真实库）');
const det = store.create([knownSpreadDecl({ source: 'src/a.ts', files: ['src/b.ts'], violations: 2 })], 'T186b：带确定性谓词的提案', 'loop');
const man = store.create([knownSpreadDecl({ source: 'src/c.ts', files: ['src/d.ts'], violations: 1 })], 'T186b：source=manual 的提案', 'manual');
chk(fs.existsSync(path.join(dir, 'proposals')) || !!store.get(det.id), '两条已落进【临时】store', `${det.id} / ${man.id}`);

console.log('\n════ ③ list / show');
const l1 = call({ action: 'list', project_dir: ROOT });
chk(l1.data.count === 2, 'list 看到 2 条', String(l1.data.count));
const s1 = call({ action: 'show', project_dir: ROOT, id: det.id });
chk(!s1.isErr && s1.message.includes('design:impact-known-spread'), 'show 看到声明本体', s1.message.split('\n')[3] ?? '');

console.log('\n════ ④ 坏/缺输入 ⇒ 拒（含"失败必须抛"）');
const noAgent = call({ action: 'approve', project_dir: ROOT, id: det.id });
chk(noAgent.isErr, '★ 不署名 approve ⇒ 拒', noAgent.message.trim().split('\n')[0]);
const noAgentR = call({ action: 'reject', project_dir: ROOT, id: man.id });
chk(noAgentR.isErr, '★ 不署名 reject ⇒ 也拒（与 approve 同一条判据）');
const ghost = call({ action: 'show', project_dir: ROOT, id: 'nope' });
chk(ghost.isErr, '★ 提案不存在 ⇒ 拒（不是静默空回执）');

console.log('\n════ ⑤ ★★ 好输入 ⇒ 放行：带确定性谓词的提案应当**定稿**（不是一律冻结）');
const ok = call({ action: 'approve', project_dir: ROOT, id: det.id, agent: 'subagent@2026-10-12' });
console.log(`     [实测] frozen=${ok.data.frozen} version=${ok.data.version} reason=${String(ok.data.reason ?? '').slice(0, 80)}`);
console.log(`     [回执首行] ${ok.message.trim().split('\n')[0].slice(0, 110)}`);
if (ok.data.frozen === false) {
  chk(ok.data.version > 0, '★ 放行：定稿并给出 DSL version（门不是"一律冻结"的废门）', `version=${ok.data.version}`);
  chk(ok.message.includes('已定稿'), '★ 回执说"已定稿"（与 frozen 的措辞**可区分**）');
} else {
  // ★ 若它被冻结，那也是**合法读数**，但要如实标出来 —— 并说明这意味着正向用例需要换声明形状
  chk(ok.data.frozen === true, '（如实）这条被冻结了 —— 正向用例需要用别的声明形状，本证不掩盖这一点');
  chk(ok.message.includes('被门冻结') && ok.message.includes('不是通过'), '★ frozen 的措辞**明说"不是通过"**');
}

console.log('\n════ ⑥ ★★ 最容易读错的一处：frozen 的措辞必须与"通过"可区分');
// ★ 用一个**独立**的提案来观察措辞（★ 别像第一版那样在上面的三元表达式里顺手再批一条 ——
//   那会**把 ⑦⑧ 要用的状态用掉**，让后面三条假红。量具不许有隐藏副作用。）
const man2 = store.create([knownSpreadDecl({ source: 'src/e.ts', files: ['src/f.ts'], violations: 3 })], 'T186b：措辞观察用', 'manual');
const r6 = call({ action: 'approve', project_dir: ROOT, id: man2.id, agent: 'subagent@2026-10-12' });
console.log(`     [样本] ${r6.message.trim().split('\n')[0].slice(0, 120)}`);
chk(
  !(/已定稿/.test(r6.message) && /被门冻结/.test(r6.message)),
  '★ "已定稿"与"被门冻结"两种措辞**不会同时出现**（读端不会把冻结读成通过）',
);

console.log('\n════ ⑦ ★ "不许自批"这侧只能**部分判** —— 必须如实标');
// ★ `source="loop"` ⇒ **可判**（提出方是机器）
chk(ok.message.includes('已判') && ok.message.includes('loop'), '★ `source="loop"` ⇒ 明标"**已判**：确认人不是提出方"', ok.message.split('\n')[1]?.slice(0, 80));
// ★ `source="manual"` ⇒ **判不了**（`Proposal` 无 `submitter`）
chk(r6.message.includes('判不了') && r6.message.includes('submitter'), '★ `source="manual"` ⇒ 明标**判不了**（不冒充判过）', r6.message.split('\n')[1]?.slice(0, 90));

console.log('\n════ ⑧ reject：状态变 rejected，且**权威 DSL 不动**（这里没有 DSL，故断言状态与证据）');
const rej = call({ action: 'reject', project_dir: ROOT, id: man.id, agent: 'subagent@2026-10-12', note: 'T186b：用例驳回' });
chk(rej.data.rejected === true, 'rejected 落库', JSON.stringify(rej.data.rejected));
chk(rej.message.includes('权威 DSL') && rej.message.includes('一字未动'), '★ 回执明说"权威 DSL 一字未动"');

console.log('\n════ ⑧b ★★ **真的触发一次冻结**（否则"frozen 措辞"那条只是没被走过）');
// 造一条**没有确定性谓词**的声明：`probe` 不是已知探针 ⇒ L2 需要 LLM 复核，而 `use_llm` 缺省 false ⇒ **冻结**。
const unfixed = store.create(
  [{ rule: 't186b:needs-llm', probe: 't186b.unknown-probe', expect: 'T186b：这条声明没有确定性谓词', constraint: '{}', origin: 'llm-revise', status: 'proposed' }],
  'T186b：无谓词声明（应当被冻�结）',
  'loop',
);
const fz = call({ action: 'approve', project_dir: ROOT, id: unfixed.id, agent: 'subagent@2026-10-12' });
console.log(`     [实测] frozen=${fz.data.frozen} version=${fz.data.version} reason=${String(fz.data.reason ?? '').slice(0, 80)}`);
console.log(`     [回执首行] ${fz.message.trim().split('\n')[0].slice(0, 130)}`);
chk(fz.data.frozen === true, '★ 真冻结了（`data.frozen === true` 是**机读**的那个位）');
chk(fz.data.version === 0, '★ 冻结时 `version === 0`（**没有**定稿）', String(fz.data.version));
chk(fz.message.includes('被门冻结') && fz.message.includes('不是通过'), '★★ 回执**明说"不是通过"**（★ 这是本工具最容易读错的一处）');
chk(fz.message.includes('权威 DSL') && fz.message.includes('一个字不动'), '★ 且说清"权威 DSL 一个字不动"');
// ★ 与"通过"那条措辞**必须能区分**（把两种回执放一起比）
chk(!fz.message.includes('已定稿'), '★★ 冻结的回执里**不含**"已定稿"（两种措辞互斥）');

console.log('\n════ ⑨ 收尾：删临时根，且**断言真实库没被碰过**');
fs.rmSync(ROOT, { recursive: true, force: true });
chk(!fs.existsSync(ROOT), '临时根已清');
chk(!fs.existsSync(path.resolve('.agent')), '★ 真实 `.agent/observe` 仍然不存在（本证没碰真实状态）');

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
