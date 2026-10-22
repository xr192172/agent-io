#!/usr/bin/env node
/**
 * ★★★ cert T359 —— **L1 卡的两侧到底读哪把尺**（2026-10-22 · todo_状态机结构-l1-卡挂在两把尺中间 的「待验」）。
 *
 * ## 它在问什么
 * 卡住那张卡的疑问是：「`t_claim` 的 guard 逐字要 `isClaimable(cardStanding(card))`，而 L1 卡
 * `expectations: []` ⇒ `cardStanding` 必给 `unknowable` ⇒ L1 卡绕开了它。那 **complete 侧读什么？**」
 * 旧卡只靠注释（`task_ops.ts:663`）作答 ⇒ 本证**不用注释**，用运行时读数把两侧钉住。
 *
 * ## 本证的结论（读数见 stdout）
 * · **L1**：claim 与 complete **读同一个函数** `constructionVerdict` —— 方向相反：
 *   `complete === false` ⇒ 可领；`complete === true` ⇒ 可收口。
 * · **L2**：claim 读 `isClaimable(cardStanding)`、complete 读 `isSatisfied`（同一读数、两个谓词）。
 * ⇒ **不是**「claim 用一把、状态判定用另一把」：**每一级内部两侧同一把**；跨级（L1/L2）才是两把尺。
 *
 * ## 判据（每条亲手跑）
 *   ① `publish` 一张无 decision 的节点 ⇒ **L1 卡**（0 条期望；卡上没有 `expectations` 字段）；
 *   ② 同一张 L1 卡 `claim` **成功**（建构不完整 ⇒ 有活）；
 *   ③ ★ 同一张卡**同一时刻** `cardStanding = unknowable` ⇒ ②证明 claim **没有**读它；
 *   ④ 同一张卡 `complete` 被拒，拒因是 **「L1 建构未完成」**（`constructionVerdict`），
 *      ★ 不是 **「可收口性：unknowable」**（那才是 `isSatisfied` 的句式）；
 *   ⑤ 只有**前态**判据的 L1：claim 成功、complete 拒因是「没有后态判据」（同一把尺的第二条）；
 *   ⑥ L2（后态必红）：claim 成功且回执写 `站位=work`（这把尺是 `cardStanding`）；
 *   ⑦ L2（后态全绿）：claim 被拒「可领性：satisfied」、complete 成功（同一读数、两个谓词）；
 *   ⑧ 静态对拍：`task_ops.ts` 里 `constructionVerdict(dsl, node_id)` 恰好 **2 处**（claim / complete 各一）。
 *
 * ## ★ 本证怎么被打红（自己坏）
 * · 把 L1 的 claim 改成 `cardStanding` ⇒ **②** 直接红（`unknowable` ⇒ 拒领），③ 就成了反证；
 * · 把 L1 的 complete 改成 `isSatisfied` ⇒ **④** 的拒因变成「可收口性：unknowable」⇒ 红；
 * · 把 L2 的 claim/complete 退回到**同一个谓词** ⇒ **⑥/⑦** 必有一边红（work 可领但不可收口、satisfied 反之）。
 *
 * ## 边界（诚实清单 · 未核）
 * · 不写真仓 `.agent-io/`：`AGENT_IO_HOME` 指向临时 home；
 * · `file-exists` 现读真仓（只读）⇒ 本证对源码**只读**；
 * · **只证明「读的是哪个函数」**，不证明那两个函数自己的判定都对（`t351` / `t358` 管那一层）；
 * · **不证明** L1/L2 的「选哪把」是对的 —— 级别是派生值，交接流待裁（`todo_l1-l2-handoff-gap`）。
 *
 * ## 用法
 *   node certs/t359-l1-two-rulers-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
// ★ 夹具目录用 mkdtempSync（每次新目录、不删旧目录）：宿主有「每回合 50 次删除」的闸（同 t350）。
fs.mkdirSync(path.join(HERE, '.work'), { recursive: true });
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp359-'));
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');
const { cardStanding } = await import('../dist/src/domain/task_machine.js');
const { expectationsOf, taskLevel } = await import('../dist/src/domain/task_schema.js');
const { judgeExpectations } = await import('../dist/src/application/design/intent/expectations.js');

const FEAT = 't359';
const L1_NONE = 'node_l1_no_decision';
const L1_PRE = 'node_l1_pre_only';
const L2_WORK = 'node_l2_red';
const L2_GREEN = 'node_l2_green';
const ABSENT = 'src/domain/t359_fixture_absent.ts'; // ★ 盘上不存在 ⇒ file-exists 必红
const ABSENT_RED = 'src/domain/t359_fixture_red_target.ts'; // ★ L2 必红用独立路径（与 L1 那颗的读集不相交——否则 claim 会因读集冲突被拒）
const PRESENT = 'src/domain/task_machine.ts'; // ★ 盘上存在 ⇒ file-exists 必绿（只读）

saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: REPO,
  geometry: {
    layout: 'free',
    width: 400,
    height: 300,
    nodes: [
      { id: L1_NONE, type: 'file', label: 'L1（无 decision）', description: ABSENT },
      {
        id: L1_PRE,
        type: 'file',
        label: 'L1（只有前态判据）',
        description: 'src/domain/t359_fixture_pre.ts',
        decision: {
          summary: 'T359 夹具：只有前态判据的 L1',
          expectations: [
            { kind: 'edge-absent', from: 'src/domain/t359_fixture_pre.ts', to: PRESENT, why: 'T359 夹具：前态判据' },
          ],
        },
      },
      {
        id: L2_WORK,
        type: 'file',
        label: 'L2（后态必红）',
        description: 'src/domain/t359_fixture_red.ts',
        decision: {
          summary: 'T359 夹具：后态必红的 L2',
          expectations: [{ kind: 'file-exists', path: ABSENT_RED, why: 'T359 夹具：该文件不存在 ⇒ 后态必红 ⇒ work' }],
        },
      },
      {
        id: L2_GREEN,
        type: 'file',
        label: 'L2（后态全绿）',
        description: 'src/domain/t359_fixture_green.ts',
        decision: {
          summary: 'T359 夹具：后态全绿的 L2',
          expectations: [{ kind: 'file-exists', path: PRESENT, why: 'T359 夹具：该文件存在 ⇒ 后态必绿 ⇒ satisfied' }],
        },
      },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: L1_NONE, path: ABSENT, responsibility: 'T359 夹具：L1 无 decision' },
      { id: L1_PRE, path: 'src/domain/t359_fixture_pre.ts', responsibility: 'T359 夹具：L1 只有前态' },
      { id: L2_WORK, path: 'src/domain/t359_fixture_red.ts', responsibility: 'T359 夹具：L2 必红' },
      { id: L2_GREEN, path: 'src/domain/t359_fixture_green.ts', responsibility: 'T359 夹具：L2 全绿' },
    ],
  },
});

const run = async (ops, reason) => {
  const r = await editDslHandler({ feature: FEAT, weight: 'routine', agent: 'agent-t359', reason, operations: ops });
  return { text: String(r?.text ?? ''), isError: r?.isError === true };
};
const first = (s) => s.split('\n')[0];
const nodeOf = (id) => (getDSL(FEAT).geometry.nodes ?? []).find((n) => n.id === id);
const evidence = () => ({ kind: 'attestation', by: 'llm', at: new Date().toISOString(), why: 'T359 夹具：收口证据' });

// ════════════════════════════════════════════════════════════════════
console.log('════ ① L1（无 decision）：publish / claim = 同一把尺的「false 可领」侧 ════');
{
  const p = await run([{ type: 'task', op: 'publish', id: L1_NONE }], `T359：publish ${L1_NONE}`);
  const card = nodeOf(L1_NONE)?.task;
  chk(!p.isError && /L1/.test(p.text), '①a publish 立出 **L1 建构卡**', first(p.text));
  chk(
    card?.state === 'candidate' && !('expectations' in (card ?? {})),
    '①b 卡上**没有** expectations 字段（判据只住 decision）',
    `keys=${JSON.stringify(Object.keys(card ?? {}))}`,
  );

  const c = await run([{ type: 'task', op: 'claim', id: L1_NONE, data: { owner: 'agent-t359' } }], `T359：claim ${L1_NONE}`);
  chk(!c.isError && /L1 建构卡/.test(c.text), '② L1 的 claim **成功**，且回执点名「L1 建构卡」（可领性 = 建构完整吗）', first(c.text));

  const st = await cardStanding(nodeOf(L1_NONE).task, expectationsOf(nodeOf(L1_NONE)), {
    root: REPO,
    nodes: getDSL(FEAT).geometry.nodes,
    judge: judgeExpectations,
  });
  chk(
    st.standing === 'unknowable' && taskLevel(expectationsOf(nodeOf(L1_NONE))) === 'L1',
    '③ ★ 同一张卡**同一时刻** cardStanding = unknowable ⇒ ② 证明 claim **没有**读它',
    `standing=${st.standing} · level=${taskLevel(expectationsOf(nodeOf(L1_NONE)))} · post=${st.judged.post.length}`,
  );

  const d = await run([{ type: 'task', op: 'complete', id: L1_NONE, data: { evidence: evidence() } }], `T359：complete ${L1_NONE}`);
  chk(
    d.isError && /L1 建构未完成/.test(d.text) && !/可收口性/.test(d.text),
    '④ L1 的 complete 拒因是「**L1 建构未完成**」（constructionVerdict），不是「可收口性：unknowable」（isSatisfied）',
    d.text.split('\n').slice(0, 2).join(' / ').slice(0, 240),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ L1（只有前态判据）：同一把尺的第二条 —— 后态 0 条 ════');
{
  const p = await run([{ type: 'task', op: 'publish', id: L1_PRE }], `T359：publish ${L1_PRE}`);
  chk(!p.isError && /L1/.test(p.text), '⑤a publish 仍是 **L1**（只有前态判据）', first(p.text));
  const c = await run([{ type: 'task', op: 'claim', id: L1_PRE, data: { owner: 'agent-t359' } }], `T359：claim ${L1_PRE}`);
  chk(!c.isError, '⑤b claim 成功（建构不完整 ⇒ 有活）', first(c.text));
  const d = await run([{ type: 'task', op: 'complete', id: L1_PRE, data: { evidence: evidence() } }], `T359：complete ${L1_PRE}`);
  chk(
    d.isError && /L1 建构未完成/.test(d.text) && /后态判据/.test(d.text),
    '⑤c complete 拒因点名「没有后态判据」（同一把尺的第二条）',
    d.text.split('\n').slice(0, 2).join(' / ').slice(0, 240),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ L2（后态必红）：claim 读的是 cardStanding ════');
{
  const p = await run([{ type: 'task', op: 'publish', id: L2_WORK }], `T359：publish ${L2_WORK}`);
  chk(!p.isError && /L2/.test(p.text), '⑥a publish 立出 **L2 实现卡**', first(p.text));
  const c = await run([{ type: 'task', op: 'claim', id: L2_WORK, data: { owner: 'agent-t359' } }], `T359：claim ${L2_WORK}`);
  chk(!c.isError && /站位=work/.test(c.text), '⑥b claim 成功且回执写「站位=work」（这把尺是 cardStanding）', first(c.text));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑦ L2（后态全绿）：同一个读数、两个谓词 ════');
{
  const p = await run([{ type: 'task', op: 'publish', id: L2_GREEN }], `T359：publish ${L2_GREEN}`);
  chk(!p.isError && /L2/.test(p.text), '⑦a publish 立出 **L2**', first(p.text));
  const c = await run([{ type: 'task', op: 'claim', id: L2_GREEN, data: { owner: 'agent-t359' } }], `T359：claim ${L2_GREEN}`);
  chk(c.isError && /可领性：satisfied/.test(c.text), '⑦b claim 被拒（`isClaimable(satisfied)` = false：没活干不许领）', first(c.text));
  const d = await run([{ type: 'task', op: 'complete', id: L2_GREEN, data: { evidence: evidence() } }], `T359：complete ${L2_GREEN}`);
  chk(!d.isError && /站位=satisfied/.test(d.text), '⑦c complete **成功**（`isSatisfied` = true）—— 同一读数、方向相反', first(d.text));
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑧ 静态对拍：两侧真的是同一个函数 ════');
{
  const src = fs.readFileSync(path.join(REPO, 'src/application/design/dsl_ops/task_ops.ts'), 'utf8');
  const n = (src.match(/const c = constructionVerdict\(dsl, node_id\);/g) ?? []).length;
  chk(n === 2, '⑧ task_ops.ts 里 `constructionVerdict(dsl, node_id)` 恰 **2 处**（claim / complete 各一）', `count=${n}`);
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
process.exit(F > 0 ? 1 : 0);
