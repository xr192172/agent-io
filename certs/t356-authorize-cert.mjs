#!/usr/bin/env node
/**
 * ★★★ cert T356 —— **按 run 授权**（`authorize`，2026-10-20）
 *
 * ## 本笔新增的方向（B.1：新方向 ⇒ 必须新增一条打它的证）
 *   ① 跨工具保留入参 `authorize`（`server_registry#CALL_AUTHORIZE_FIELD`，与 `actor` 同一处注入）；
 *   ② 写闸里**一个分支**：`evaluateRunAuthorize`（scope → **反查闸自己的 `byPath`** → 文件集）；
 *   ③ `TaskGateBasis` 多一格 `authorized`；
 *   ④ 批量写路（`edit_code targets[]` / `writeSourceFiles`）与单文件路**同一判据**。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **全覆盖**：`authorize` = 一批文件的全集 ∧ anchor 卡 owner=actor ⇒ 放行，note 点名 scope；
 *      ★ 并给出**对照读数**：同一个 scope 的 `resolveScope().paths` **只有 1 条**（漏掉 path-only 的节点）
 *        —— 这就是「必须反查 `byPath`、不许用 `.paths`」的实测依据。
 *   ② **部分覆盖**：本批里有 1 个文件不在 scope 内 ⇒ 仍拒，且**点名那一个**；
 *   ③ `authorize:'all'` ⇒ **拒**（等于关闸，不许有这种后门）；非法 scope 也当场报错；
 *   ④ scope 覆盖但 anchor 卡**不是** actor 的 ⇒ 拒（**授权不绕过 A7**）；
 *   ⑤ 【边界】`files:` 口径的节点集来自 `semantic.files` ⇒ path-only 节点圈不到 ⇒ 仍拒（不静默放行）；
 *   ⑥ 【不分叉】走 `writeSourceFiles` 的写路（`applyWrites`）也认同一个 `authorize`。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home，代码根 = 临时根；
 *   · **MCP 传输层 [未核]**：直接 import `editCode` / `assertSourceWriteRegisteredFor`（不经 stdio）；
 *   · **`refactor_pipeline` [未核]**：它**根本没调写闸**（实测 0 处 `assertSourceWriteRegistered`），
 *     所以 `authorize` 在那里无处生效 —— 那是**既存缺口**，不在本证范围。
 *
 * ## 用法
 *   node certs/t356-authorize-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 夹具用 `mkdtempSync`（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸（`SAFE_DELETE_BULK_REQUIRED`）。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp356auth-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'src'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'src/a.ts'), 'export const a = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/b.ts'), 'export const b = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/c.ts'), 'export const c = 1;\n', 'utf-8');
fs.writeFileSync(path.join(ROOT, 'src/d.ts'), 'export const d = 1;\n', 'utf-8');
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { assertSourceWriteRegisteredFor, collectGateCoverage } = await import('../dist/src/application/write_gate.js');
const { parseScope, resolveScope } = await import('../dist/src/domain/scope.js');
const { editCode } = await import('../dist/src/application/refactor/edit/edit_code.js');
const { applyWrites } = await import('../dist/src/application/refactor/edit/apply_writes.js');

const FEAT = 't356auth';
/** 一张已领取的卡（形状与 `geometry.nodes[].task` 一致） */
const card = (owner) => ({
  id: 'card_t356',
  summary: `t356 夹具：${owner} 领的卡`,
  expectations: [],
  state: 'claimed',
  owner,
  claimed_at: '2026-10-20T00:00:00.000Z',
});

saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: ROOT,
  geometry: {
    layout: 'free',
    width: 400,
    height: 300,
    edges: [],
    nodes: [
      { id: 'n_a', type: 'file', label: 'a.ts', path: 'src/a.ts', task: card('me') },
      { id: 'n_b', type: 'file', label: 'b.ts', path: 'src/b.ts' },
      { id: 'n_c', type: 'file', label: 'c.ts', path: 'src/c.ts', task: card('other') },
      { id: 'n_d', type: 'file', label: 'd.ts', path: 'src/d.ts' },
    ],
  },
  // ★★ 只有 n_a 在 `semantic.files` 里 ⇒ n_b / n_c / n_d 都是 **path-only** 节点。
  //   这正是「scope → 文件必须反查 byPath」的夹具：`.paths` 会漏掉它们。
  semantic: { files: [{ id: 'n_a', path: 'src/a.ts', responsibility: 'fixture' }] },
  layers: {},
  annotations: [],
});

/** 闸的读数（拒 = 抛；放行 = outcome） */
const gate = (rels, actor, authorize) => {
  try {
    return { threw: false, out: assertSourceWriteRegisteredFor(ROOT, rels, actor, authorize) };
  } catch (e) {
    return { threw: true, msg: e.message };
  }
};
const firstLine = (m) => String(m).split('\n')[0];

// ════════════════════════════════════════════════════════════════════
console.log('════ ① 全覆盖：本批 = scope 全集 ∧ anchor 卡是我的 ⇒ 放行 ════');
{
  const scopeText = 'nodes:n_a,n_b';
  const cov = collectGateCoverage(ROOT);
  chk(
    cov.features.length === 1 && cov.features[0].byPath.get('src/b.ts') === 'n_b',
    '①0 收集层：`byPath` 里有 src/b.ts（path-only 节点也进了 byPath）',
    JSON.stringify([...cov.features[0].byPath]),
  );
  const r = gate(['src/a.ts', 'src/b.ts'], 'me', scopeText);
  chk(
    !r.threw && r.out.basis === 'authorized' && r.out.applicable === true,
    '①a 放行且 basis=**authorized**',
    r.threw ? firstLine(r.msg) : JSON.stringify({ basis: r.out.basis, applicable: r.out.applicable }),
  );
  chk(
    !r.threw && r.out.note.includes(scopeText) && r.out.note.includes('n_a') && /按 run 授权放行/.test(r.out.note),
    '①b note **点名 scope 与 anchor 卡**（"按 run 授权放行（`authorize=…`）… anchor 卡 = 节点 n_a…）"',
    r.threw ? '' : r.out.note.split('\n')[0],
  );

  // ★★★ 对照读数：同一个 scope 的 `resolveScope().paths` **漏了 src/b.ts**
  const dsl = getDSL(FEAT);
  const res = resolveScope(dsl, parseScope(scopeText));
  chk(
    res.node_ids.length === 2 && res.paths.length === 1 && res.paths[0] === 'src/a.ts',
    '①c **对照**：同一 scope 的 `resolveScope().paths` 只有 1 条（漏 src/b.ts）⇒ 所以必须反查 byPath',
    `node_ids=${JSON.stringify(res.node_ids)} paths=${JSON.stringify(res.paths)}`,
  );

  // ★ 真写盘：批量（2 文件，只有 n_a 一张卡）
  const before = {
    a: fs.readFileSync(path.join(ROOT, 'src/a.ts'), 'utf-8'),
    b: fs.readFileSync(path.join(ROOT, 'src/b.ts'), 'utf-8'),
  };
  const w = await editCode({
    project_dir: ROOT,
    actor: 'me',
    authorize: scopeText,
    targets: [
      { file: 'src/a.ts', old_text: 'export const a = 1;', new_text: 'export const a = 2; // t356' },
      { file: 'src/b.ts', old_text: 'export const b = 1;', new_text: 'export const b = 2; // t356' },
    ],
  });
  const after = {
    a: fs.readFileSync(path.join(ROOT, 'src/a.ts'), 'utf-8'),
    b: fs.readFileSync(path.join(ROOT, 'src/b.ts'), 'utf-8'),
  };
  chk(
    w.data?.written === true && after.a !== before.a && after.b !== before.b,
    '①d **批量真写盘**：2 个文件都落了（b 自己没有卡，靠 scope 授权）',
    `written=${w.data?.written}`,
  );
  chk(
    /按 run 授权放行/.test(String(w.data?.task_gate ?? '')),
    '①e `task_gate` 带出了授权读数（不是只有闸自己知道）',
    String(w.data?.task_gate ?? '').split('\n')[0],
  );

  // ★ 单文件路径同一个判据（不许"批量认、单文件不认"）
  const w2 = await editCode({
    project_dir: ROOT,
    file: 'src/b.ts',
    op: 'replace_text',
    old_text: 'export const b = 2; // t356',
    new_text: 'export const b = 3; // t356 单文件',
    actor: 'me',
    authorize: scopeText,
  });
  chk(
    w2.data?.written === true && /按 run 授权放行/.test(String(w2.data?.task_gate ?? '')),
    '①f **单文件路径**同样认 authorize（批/单同一判据，不分叉）',
    `written=${w2.data?.written}`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ② 部分覆盖：本批有 1 个不在 scope 内 ⇒ 仍拒，且点名那一个 ════');
{
  const r = gate(['src/a.ts', 'src/d.ts'], 'me', 'nodes:n_a');
  chk(
    r.threw && /没有挂到任何已领取的任务上/.test(r.msg),
    '②a 落回**逐文件判定**（不是"整批授权"，也不是静默放行）',
    r.threw ? firstLine(r.msg) : JSON.stringify(r.out),
  );
  chk(
    r.threw && /src\/d\.ts/.test(r.msg),
    '②b 拒绝信息**点名那一个**文件（src/d.ts）',
    r.threw ? (r.msg.split('\n').find((l) => l.includes('src/d.ts')) ?? '') : '',
  );
  chk(
    r.threw && /没能覆盖本批/.test(r.msg) && /不在 scope 内/.test(r.msg),
    '②c 拒绝信息带出**authorize 没生效的理由**（不静默降级）',
    r.threw ? (r.msg.split('\n').find((l) => l.includes('没能覆盖本批')) ?? '') : '',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log("\n════ ③ authorize:'all' ⇒ 拒（等于关闸，不许有这种后门） ════");
{
  const r = gate(['src/a.ts'], 'me', 'all');
  chk(
    r.threw && /明令不支持/.test(r.msg),
    "③a `authorize:'all'` ⇒ **拒**（不是放行全部，也不是静默忽略）",
    r.threw ? firstLine(r.msg) : JSON.stringify(r.out),
  );
  const r2 = gate(['src/a.ts'], 'me', 'nonsense:zzz');
  chk(
    r2.threw && /不是合法 scope/.test(r2.msg),
    '③b 解不出来的 scope ⇒ **当场报错**（拼错一个字母就得到"授权没生效但没人说"是最忌的静默）',
    r2.threw ? firstLine(r2.msg) : JSON.stringify(r2.out),
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ④ scope 覆盖但 anchor 卡不是我的 ⇒ 拒（授权不绕过 A7） ════');
{
  const r = gate(['src/c.ts'], 'me', 'nodes:n_c');
  chk(
    r.threw && /owner=other/.test(r.msg),
    '④a 拒，且点名**别人的卡**（owner=other）',
    r.threw ? firstLine(r.msg) : JSON.stringify(r.out),
  );
  chk(
    r.threw && /不放宽 A7/.test(r.msg),
    '④b 拒绝信息说清依据：**授权不放宽 A7**（卡必须是你的）',
    r.threw ? (r.msg.split('\n').find((l) => l.includes('不放宽 A7')) ?? '') : '',
  );
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑤ 边界：`files:` 口径只看 semantic.files ⇒ path-only 节点圈不到 ════');
{
  const r = gate(['src/b.ts'], 'me', 'files:src/b.ts');
  chk(
    r.threw,
    '⑤a `files:src/b.ts` 圈不到 n_b（它只在节点 `path` 上，不在 `semantic.files`）⇒ **仍拒**（不静默放行）',
    r.threw ? firstLine(r.msg) : JSON.stringify(r.out),
  );
  chk(
    r.threw && r.msg.includes('没能覆盖本批'),
    '⑤b 理由里写清了"没能覆盖"（这个边界是可读的，不是哑的）',
    r.threw ? (r.msg.split('\n').find((l) => l.includes('没能覆盖本批')) ?? '') : '',
  );
  console.log('   ★ 结论：要圈 path-only 节点，用 `nodes:` / `subtree:` / `layer:`（它们的节点集不来自 semantic.files）。');
}

// ════════════════════════════════════════════════════════════════════
console.log('\n════ ⑥ 不分叉：走 `writeSourceFiles` 的写路也认同一个 authorize ════');
{
  const r = await applyWrites(
    ROOT,
    [{ file: 'src/b.ts', content: 'export const b = 4; // t356 applyWrites\n' }],
    { actor: 'me', authorize: 'nodes:n_a,n_b' },
  );
  chk(
    r.ok === true && String(r.task_gate ?? '').includes('按 run 授权放行'),
    '⑥a `applyWrites`（→ `writeSourceFiles` → 同一个闸）也放行了（b 自己没有卡）',
    `ok=${r.ok}｜${String(r.task_gate ?? '').split('\n')[0]}`,
  );
  let threw = false;
  try {
    await applyWrites(ROOT, [{ file: 'src/d.ts', content: 'export const d = 9;\n' }], { actor: 'me', authorize: 'nodes:n_a,n_b' });
  } catch {
    threw = true;
  }
  chk(threw, '⑥b 同一个入口、**不在 scope 内**的文件 ⇒ 仍拒（照抄同一把尺，不是"这条写路全放"）');
}

console.log(`\n=== T356：${P} 过 / ${F} 败 ===`);
if (F > 0) process.exitCode = 1;
