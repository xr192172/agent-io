#!/usr/bin/env node
/**
 * ★★★ cert T332 —— **显式前置 `requires` + 解锁闸的出生证**（2026-10-15）。
 *
 * ## 这张证要钉住什么（`docs/replan-log-2026-10-15.md` §28.3 · `docs/replan-2026-10-15.md` §28）
 * 「任务前置」必须是**显式声明**：某条 edge 的意图声明 `requires: [节点 id...]`
 * （= 这些节点须先 `progress === 'done'`），**前置未满足 ⇒ 改相关源码被 `write_gate` 拒绝**。
 *
 * ## ★★ 全证最重要的一条（防误伤 —— 本条的成败在此）
 * 本仓 edge **默认装的是 import 依赖**（扫描产出的依赖边），**它不等于任务前置**。
 * ⇒ **只有显式标了 `requires` 的 edge 才产生拦截**；**没标 `requires` 的一律不拦**。
 *   这一点由 **③** 单独钉住（造一条只有 import 依赖、没有 `requires` 的同类边 ⇒ 必须放行）。
 *
 * ## 判据（全部只看**事实**：抛没抛 + overlay 落盘了什么，不看回执文案的措辞）
 *   ① 标了 `requires` 且前置**未 done** ⇒ 改该边**源节点(from)**的源码**被拒**（含"怎么办"）。
 *   ② 把前置节点 `progress` 置 **done** ⇒ **同一改动通过**。
 *   ③ ★★ **没标 `requires` 的 edge 不拦**（只有 import 依赖的同类边 ⇒ 落盘成功）。
 *   ④ 非法 `requires`（引**不存在**的节点 id）⇒ 写入口**拒绝**（存在性校验，不做 T329 `scope` 那种半截）。
 *   ⑤ 显式**解除**（`requires: []`）⇒ 恢复放行（前置是显式声明，可显式撤回）。
 *
 * ## 用法
 *   node certs/t332-requires-gate-cert.mjs
 * ★ 夹具住 `certs/.work/tmp`（`AGENT_IO_HOME` 也指到那里 ⇒ 不碰真仓的 `.agent-io/`）。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按**一个回合内的删除【操作】数**累计，
 *   阈值 50，全量套件必然越过，见 `t328`/`t316` 头注释）—— 故清理那处 **catch 住并响亮报告**：
 *   **被闸拦下 ≠ 本证判红**，但**不许静默**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
/** 跑一段"应当抛"的代码，返回错误文案（没抛 ⇒ 返回空串） */
const catchMsg = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e && e.message) || e);
  }
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDSL } = await import('../dist/src/infrastructure/storage.js');
const { loadOverlay } = await import('../dist/src/infrastructure/storage_overlay.js');
const { setDesignIntent } = await import('../dist/src/application/design/intent/set_design_intent.js');
const { updateStatus } = await import('../dist/src/application/design/dsl_ops/status_tools.js');
const { assertSourceWriteRegistered } = await import('../dist/src/application/write_gate.js');

/** 造一个"项目根 + 设计 feature（两个文件节点 + 一条边 n_x→n_y）"的夹具 */
function fixture(feature, suffix) {
  const proj = fs.mkdtempSync(path.join(TMP, `proj-${suffix}-`));
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'src', 'x.ts'), 'export function x(){ return 1; }\n');
  fs.writeFileSync(path.join(proj, 'src', 'y.ts'), "import { x } from './x';\nexport const y = x();\n");
  saveDSL({
    id: `feature_${feature}`,
    type: 'feature_diagram',
    feature,
    version: '1.0.0',
    title: feature,
    source_root: proj,
    geometry: {
      layout: 'free', width: 800, height: 600,
      nodes: [
        { id: 'n_x', type: 'file', description: 'src/x.ts' },
        { id: 'n_y', type: 'file', description: 'src/y.ts' },
      ],
      // 边 n_x → n_y：语义 = "n_x 依赖 n_y"（from = 依赖方 = 被闸门拦的一侧）
      edges: [{ id: 'e_xy', from: 'n_x', to: 'n_y' }],
    },
    semantic: { files: [{ id: 'n_x', path: 'src/x.ts' }, { id: 'n_y', path: 'src/y.ts' }] },
  });
  return { proj, xPath: path.join(proj, 'src', 'x.ts'), yPath: path.join(proj, 'src', 'y.ts') };
}

// ═══════════ ① 标了 requires（前置未 done）⇒ 改源码被拒 ═══════════
console.log('════ ① · 显式 requires（前置未 done）⇒ 改源码被拒 ════');
const A = fixture('fx', 'a');
{
  // 先把 n_x 登记进度（in_progress）⇒ 过掉"未登记"那道既有闸，隔离出本笔的"前置闸"。
  updateStatus({ feature: 'fx', node_id: 'n_x', status: 'in_progress' });

  // 标 requires：e_xy（from=n_x）要求先完成 n_y。
  const r = setDesignIntent({
    feature: 'fx',
    edge_intents: [{ id: 'e_xy', from: 'n_x', to: 'n_y', reason: 'a 为何依赖 b', requires: ['n_y'] }],
  });
  const persisted = loadOverlay('fx')?.edges?.['e_xy']?.requires;
  chk(
    JSON.stringify(persisted) === JSON.stringify(['n_y']),
    '①a requires 落进 overlay 权威（design_intent 写入口）',
    `overlay.edges.e_xy.requires=${JSON.stringify(persisted)} · since=${r.feature}`,
  );

  // 前置 n_y 尚未 done ⇒ 改 n_x 的源码（src/x.ts）应被拒
  const msg = catchMsg(() => assertSourceWriteRegistered(A.proj, [A.xPath]));
  chk(
    msg !== '' && /前置闸/.test(msg) && /requires/.test(msg) && /edit_dsl/.test(msg) && /n_y/.test(msg),
    '①b requires 前置未 done ⇒ 改源节点源码**被拒**（错误里给出 n_y + "怎么办"）',
    msg === '' ? '★ 没抛（静默放行了）' : msg.split('\n').slice(0, 2).join(' / '),
  );

  // 反证：同一文件若不涉前置（另一条无 requires 的场景见 ③）—— 这里不做，③ 单独钉。
  // 反证：改**非源节点**（n_y 自己）的文件**不该**被这条前置拦（拦的是 from 一侧）
  const msgTo = catchMsg(() => assertSourceWriteRegistered(A.proj, [A.yPath]));
  chk(
    msgTo !== '' && /任务闸/.test(msgTo) && !/前置闸/.test(msgTo),
    '①c 同一前置只拦**源节点(from)**一侧；改另一端(n_y)不会被"前置闸"拦（它走的是既有"任务闸/未登记"）',
    msgTo === '' ? '★ 另一端竟无任何闸（意外）' : msgTo.split('\n')[0],
  );
}

// ═══════════ ② 前置置 done ⇒ 同一改动通过 ═══════════
console.log('\n════ ② · 前置 n_y 置 done ⇒ 同一改动通过 ════');
{
  updateStatus({
    feature: 'fx', node_id: 'n_y', status: 'done',
    evidence: { kind: 'attestation', by: 'human', at: '2026-10-15T00:00:00.000Z', why: '前置已亲手做完（T332 证书夹具）' },
  });
  let out;
  const msg = catchMsg(() => {
    out = assertSourceWriteRegistered(A.proj, [A.xPath]);
  });
  chk(
    msg === '' && out && out.applicable === true,
    '② 把前置置 done（带 evidence）⇒ **同一改动通过**（前置闸不再拦）',
    msg === '' ? `applicable=${out?.applicable} · ${out?.note?.slice(0, 60)}…` : `★ 仍被拒：${msg.split('\n')[0]}`,
  );
}

// ═══════════ ③ ★★ 没标 requires 的 edge 不拦（防误伤）═══════════
console.log('\n════ ③ · ★★ 只有 import 依赖、没有 requires 的同类边 ⇒ 不拦 ════');
{
  const C = fixture('fy', 'c');
  // 同款场景：n_x 依赖 n_y（import 边），但**不标 requires** ⇒ 必须放行。
  updateStatus({ feature: 'fy', node_id: 'n_x', status: 'in_progress' }); // 登记进度（过既有闸）
  setDesignIntent({
    feature: 'fy',
    edge_intents: [{ id: 'e_xy', from: 'n_x', to: 'n_y', reason: 'import 依赖（扫描产出）', boundary: '同层' }],
  });
  const persisted = loadOverlay('fy')?.edges?.['e_xy']?.requires;
  chk(persisted === undefined, '③a 无 requires ⇒ overlay 里该边没有 requires 字段', `requires=${JSON.stringify(persisted)}`);

  let out;
  const msg = catchMsg(() => {
    out = assertSourceWriteRegistered(C.proj, [C.xPath]);
  });
  chk(
    msg === '' && out && out.applicable === true,
    '③b ★★ 没标 requires 的 edge **不拦**（同类场景落盘成功）—— 绝不许"有 import 边就拦"',
    msg === '' ? `applicable=${out?.applicable} · ${out?.note?.slice(0, 60)}…` : `★ 被误伤：${msg.split('\n')[0]}`,
  );
}

// ═══════════ ④ 非法 requires（不存在的节点 id）⇒ 被拒 ═══════════
console.log('\n════ ④ · 非法 requires（引不存在的节点 id）⇒ 写入口拒绝 ════');
{
  const before = loadOverlay('fx')?.edges?.['e_xy']?.requires;
  const msg = catchMsg(() =>
    setDesignIntent({
      feature: 'fx',
      edge_intents: [{ id: 'e_xy', from: 'n_x', to: 'n_y', requires: ['n_x', 'no_such_node'] }],
    }),
  );
  chk(
    msg !== '' && /不存在/.test(msg) && /no_such_node/.test(msg),
    '④a requires 引不存在的节点 id ⇒ 写入口**拒绝**（存在性校验，非只语法校验）',
    msg === '' ? '★ 没抛（静默接受了非法引用）' : msg.split('\n').slice(0, 3).join(' / '),
  );
  const after = loadOverlay('fx')?.edges?.['e_xy']?.requires;
  chk(
    JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(after) === JSON.stringify(['n_y']),
    '④b 被拒后**没有偷偷改写** requires（不静默、不降级）',
    `before=${JSON.stringify(before)} · after=${JSON.stringify(after)}`,
  );
}

// ═══════════ ⑤ 显式解除（requires: []）⇒ 恢复放行 ═══════════
console.log('\n════ ⑤ · 显式解除 requires ⇒ 恢复放行 ════');
{
  // 把前置退回未 done（in_progress 不需 evidence），此时 ① 的前置本该拦
  updateStatus({ feature: 'fx', node_id: 'n_y', status: 'in_progress' });
  const stillBlocked = catchMsg(() => assertSourceWriteRegistered(A.proj, [A.xPath]));
  chk(/前置闸/.test(stillBlocked), '⑤a 前置再次未 done ⇒ 仍被前置闸拦（对照）', stillBlocked.split('\n')[0]);

  // 显式解除：requires: []
  setDesignIntent({ feature: 'fx', edge_intents: [{ id: 'e_xy', from: 'n_x', to: 'n_y', requires: [] }] });
  const cleared = loadOverlay('fx')?.edges?.['e_xy']?.requires;
  let out;
  const msg = catchMsg(() => {
    out = assertSourceWriteRegistered(A.proj, [A.xPath]);
  });
  chk(
    Array.isArray(cleared) && cleared.length === 0 && msg === '' && out?.applicable === true,
    '⑤b requires: [] 显式解除 ⇒ overlay 记空数组且**恢复放行**',
    `requires=${JSON.stringify(cleared)} · ${msg === '' ? '放行' : '★ 仍被拒：' + msg.split('\n')[0]}`,
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
