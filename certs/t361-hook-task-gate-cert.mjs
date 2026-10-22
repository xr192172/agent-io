#!/usr/bin/env node
/**
 * cert T361 —— **hook-task-gate.mjs 真的会命中**（2026-10-22）
 *
 * ## 这张证存在的理由
 * 那个 hook 文件头自称"每会话提醒：写文件前告诉你这一步有没有你的卡"。
 * 2026-10-22 实测：它**一次都没提醒过**，两处叠加把命中率钉在 0：
 *   ① 读 `docs/task-system-plan.dsl.json` —— 该位置 2026-10-18 废弃（`storage.ts#getDesignDir`："现在只有一处"），
 *      且 `docs/*` 进了 .gitignore ⇒ 文件不存在 ⇒ `return done('')` **静默 return**；
 *   ② 路径只认 `x.path` —— 册上 650 个节点只有 **8 个**有 `path`，543 个 file 节点把路径写在 `description` 里
 *      ⇒ 恒 0 命中。
 * ⇒ "闸在、判据不在、还是静默的" —— 本仓最贵的那一类（**假绿灯**）。本证钉住"它现在真的会命中"。
 *
 * ## 判据（全部实跑，读数见 stdout）
 *   ① **只写 `description` 的文件节点能命中**（这是 ② 的洞；若退回只认 `x.path`，本条当场红 ——
 *      因为报出来的会是"不属于任何设计节点"而不是"落在节点 X 上但没有任务卡"）；
 *   ② 同一批里 `path` 型 claimed 卡 ⇒ **静默**（闸不能对已领的活乱响）；
 *   ③ candidate 卡 ⇒ 提醒里**带 state**（"卡是「candidate」"）；
 *   ④ `gate:'exempt'` 的节点 ⇒ 静默（写闸按设计侧声明放行，hook 不唱反调）；
 *   ⑤ 册上查不到的路径 ⇒ 报"不属于任何设计节点"；
 *   ⑥ **毒册对照**：把一份"同名节点 + claimed"的旧位置册子放回 `docs/` ⇒ **不许**改变结论
 *      （若有人把路径改回 `docs/`，①会变成静默 ⇒ 本条与①一起红）；
 *   ⑦ **每会话每文件只提醒一次**：同 session 第二次静默；换 session 再响一次；
 *   ⑧ **跑不了要明说**：把 hook 复制到一个没有 `dist/` 的目录里跑 ⇒ 报"闸自己跑不了"（不是静默）；
 *   ⑨ 以上每一条都 **exit 0**（本 hook 是提醒，永不阻断）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **没验真实 PreToolUse 接线**：本仓没有 `.claude/settings.json`，hook 是"脚本"不是"已挂的钩子"；
 *     本证只验"脚本被喂一个官方形状的 stdin 时会说什么"；
 *   · **没验 dist 变旧**：`dist` 与本证同时存在即可；`collectGateCoverage` 的语义由 t352/t355/t356 负责；
 *   · **"是不是你领的"不在本 hook 内**（那是写闸 A7）⇒ 本证不判。
 *
 * ## 用法
 *   node certs/t361-hook-task-gate-cert.mjs      # 只写 `certs/.work/tmp361-*`，不碰真册
 *
 * touches: scripts/hook-task-gate.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const HOOK = path.join(REPO, 'scripts', 'hook-task-gate.mjs');
const TMP = fs.mkdtempSync(path.join(HERE, '.work', 'tmp361-'));
/** ★ 独立 home：`getDataHome()` 读 `AGENT_IO_HOME` ⇒ 册子从这里读，真册一个字节都不碰 */
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
const FEATURE = 'fix5-fixture';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

// ════════════════════════════════════════════════════════════════════
// 夹具：一个项目根 + 一份设计册（节点形状覆盖 4 条判定）
// ════════════════════════════════════════════════════════════════════
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
for (const f of ['desc-only.ts', 'claimed.ts', 'candidate.ts', 'exempt.ts', 'ghost.ts']) {
  fs.writeFileSync(path.join(PROJ, 'src', f), '// fixture\n');
}
const sheet = {
  feature: FEATURE,
  source_root: PROJ.split(path.sep).join('/'),
  geometry: {
    nodes: [
      // ★ ① 的核心：**只有 description，没有 path**（本仓 543 个 file 节点的真实形状）
      { id: 'file_desc_only', type: 'file', description: 'src/desc-only.ts' },
      { id: 'file_claimed', type: 'file', path: 'src/claimed.ts', task: { state: 'claimed', owner: 'subagent:deepseek-fix5' } },
      { id: 'file_candidate', type: 'file', path: 'src/candidate.ts', task: { state: 'candidate' } },
      // ④ gate='exempt'：写闸按设计侧声明放行（AND 语义：只有一个节点指着它 ⇒ 满足）
      { id: 'file_exempt', type: 'file', path: 'src/exempt.ts', gate: 'exempt' },
    ],
  },
  semantic: { files: [] },
};
fs.mkdirSync(path.join(HOME, '.agent-io', 'design'), { recursive: true });
const SHEET = path.join(HOME, '.agent-io', 'design', `${FEATURE}.dsl.json`);
fs.writeFileSync(SHEET, JSON.stringify(sheet, null, 2));

// ★ ⑥ 毒册：旧位置 `docs/task-system-plan.dsl.json`（若 hook 读这里，① 会被这张 claimed 卡噎成静默）
fs.mkdirSync(path.join(PROJ, 'docs'), { recursive: true });
fs.writeFileSync(
  path.join(PROJ, 'docs', 'task-system-plan.dsl.json'),
  JSON.stringify({
    feature: FEATURE,
    source_root: sheet.source_root,
    geometry: {
      nodes: [
        { id: 'poison_desc_only', type: 'file', description: 'src/desc-only.ts', task: { state: 'claimed', owner: 'subagent:poison' } },
        { id: 'poison_claimed', type: 'file', path: 'src/claimed.ts', task: { state: 'candidate' } },
      ],
    },
  }),
);

// ════════════════════════════════════════════════════════════════════
// 跑 hook（子进程；喂官方形状的 stdin）
// ════════════════════════════════════════════════════════════════════
/** @returns {{out:string, rc:number}} */
function runHook(fileRel, { session = 'sess-1', hookPath = HOOK, env = {} } = {}) {
  const input = JSON.stringify({ tool_input: { file_path: path.join(PROJ, fileRel) }, cwd: PROJ, session_id: session });
  try {
    const out = execFileSync(process.execPath, [hookPath], {
      cwd: PROJ,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AGENT_IO_HOME: HOME, ...env },
    });
    return { out: out.trim(), rc: 0 };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim(), rc: typeof e.status === 'number' ? e.status : -1 };
  }
}

console.log(`══ T361 · hook-task-gate 能不能命中（夹具 ${FEATURE}，home=${HOME}）══`);

// ── ① description-only 节点必须命中（退回 x.path-only ⇒ 红）
{
  const r = runHook('src/desc-only.ts', { session: 's1' });
  chk(
    r.out.includes('file_desc_only') && r.out.includes('没有任务卡') && !r.out.includes('不属于任何设计节点'),
    '① **只有 `description` 的文件节点也能命中**（报的是"落在节点 file_desc_only 上没有任务卡"）',
    `rc=${r.rc} out=${JSON.stringify(r.out.slice(0, 120))}`,
  );
  chk(r.rc === 0, '⑨ hook 永远 exit 0（提醒不是阻断）', `rc=${r.rc}`);
}

// ── ③ candidate 卡：提醒里带 state
{
  const r = runHook('src/candidate.ts', { session: 's2' });
  chk(
    r.out.includes('candidate') && r.out.includes('不是 claimed'),
    '③ 卡是 candidate ⇒ 提醒里**带出 state**（不是只说"没卡"）',
    `out=${JSON.stringify(r.out.slice(0, 120))}`,
  );
}

// ── ② claimed 卡 ⇒ 静默；④ exempt ⇒ 静默；⑤ 幽灵路径 ⇒ 报账外
{
  const claimed = runHook('src/claimed.ts', { session: 's3' });
  chk(claimed.out === '' && claimed.rc === 0, '② 同路径上有一张 claimed 卡 ⇒ **静默**（不制造噪音）', `out=${JSON.stringify(claimed.out)} rc=${claimed.rc}`);
  const exempt = runHook('src/exempt.ts', { session: 's4' });
  chk(exempt.out === '' && exempt.rc === 0, '④ 节点声明 `gate=exempt` ⇒ 静默（写闸按设计侧豁免放行）', `out=${JSON.stringify(exempt.out)}`);
  const ghost = runHook('src/ghost.ts', { session: 's5' });
  chk(ghost.out.includes('不属于任何设计节点'), '⑤ 册上查不到的路径 ⇒ 报"不属于任何设计节点"', `out=${JSON.stringify(ghost.out.slice(0, 100))}`);
}

// ── ⑥ 毒册：旧位置 docs/ 里那份不许改变结论
{
  const r = runHook('src/desc-only.ts', { session: 's6' });
  chk(
    r.out.includes('file_desc_only') && !r.out.includes('poison'),
    '⑥ **毒册对照**：`docs/task-system-plan.dsl.json` 里给了 claimed 卡 ⇒ 结论**不变**（不读旧位置）',
    `out=${JSON.stringify(r.out.slice(0, 120))}`,
  );
  const c = runHook('src/claimed.ts', { session: 's7' });
  chk(c.out === '', '⑥\' 同上：毒册把 claimed.ts 写成 candidate ⇒ 仍以 `.agent-io/design/` 的 claimed 为准（静默）', `out=${JSON.stringify(c.out)}`);
}

// ── ⑦ 每会话每文件只提醒一次
{
  const first = runHook('src/candidate.ts', { session: 'dedupe' });
  const second = runHook('src/candidate.ts', { session: 'dedupe' });
  const other = runHook('src/candidate.ts', { session: 'dedupe-2' });
  chk(first.out !== '' && second.out === '' && other.out !== '', '⑦ 同会话第二次**静默**；换会话**再响一次**', `1st=${first.out !== ''} 2nd=${second.out === ''} new=${other.out !== ''}`);
}

// ── ⑧ 跑不了要明说（不是静默）
{
  const bare = path.join(TMP, 'nodist', 'scripts');
  fs.mkdirSync(bare, { recursive: true });
  fs.copyFileSync(HOOK, path.join(bare, 'hook-task-gate.mjs'));
  const r = runHook('src/candidate.ts', { session: 's8', hookPath: path.join(bare, 'hook-task-gate.mjs') });
  chk(
    r.out.includes('闸自己跑不了') && r.rc === 0,
    '⑧ 缺 `dist/` ⇒ **明说"闸自己跑不了"**（不静默、不假装查过），且仍 exit 0',
    `rc=${r.rc} out=${JSON.stringify(r.out.split('\n')[0].slice(0, 100))}`,
  );
}

// ════════════════════════════════════════════════════════════════════
console.log(`\n════ 汇总：PASS=${P}  FAIL=${F} ════`);
if (F > 0) process.exit(1);
