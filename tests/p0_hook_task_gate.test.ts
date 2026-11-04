/**
 * P1 · **`scripts/hook-task-gate.mjs` 真的会命中** —— 由原证 `certs/t361-hook-task-gate-cert.mjs` 整张迁入。
 *
 * ## 这张证存在的理由
 * 那个 hook 文件头自称"每会话提醒：写文件前告诉你这一步有没有你的卡"。
 * 2026-10-22 实测：它**一次都没提醒过**，两处叠加把命中率钉在 0：
 *   ① 读 `docs/task-system-plan.dsl.json` —— 该位置已废弃，且 `docs/*` 进了 .gitignore
 *      ⇒ 文件不存在 ⇒ `done('')` **静默 return**；
 *   ② 路径判据与 `write_gate` 各持一套 ⇒ 恒 0 命中。
 * ⇒ "闸在、判据不在、还是静默的" —— 本仓最贵的那一类（**假绿灯**）。本文件钉住"它现在真的会命中"。
 *
 * ## ★★ 为什么本文件可以依赖 `dist/`（= `tests/` 口径的唯一例外，必须写明理由）
 * 本文件**必须 spawn 那个 hook 脚本**（判据就是"喂它一份官方形状的 stdin，看它说什么"）——
 * 而那个脚本自己 `import <repo>/dist/src/application/write_gate.js`（与写闸同一份编译产物）。
 * `tests/` 的常规口径是**读源码不读 dist**；这里是"被 spawn 的子进程读 dist"，不是本文件读 dist
 * ⇒ 允许，但**必须响亮**：`dist` 缺失时本文件**直接红**并点名"先 `npm run build`"，
 * 绝不跳过、绝不静默退化成"没验"（`AGENTS.md` 0.12（旧名 `AGENTS-RULES.md`））。
 *
 * ## 原证断言 → 本文件用例（一条不删，8 条）
 * | 原证断言 | 这里 |
 * |---|---|
 * | ② candidate 卡 ⇒ 提醒里**带 state**（"卡是「candidate」"） | `② candidate` |
 * | ① 同路径上有一张 claimed 卡 ⇒ **静默**（不制造噪音） | `①③④ claimed / exempt / 幽灵`（第 1 条 assert） |
 * | ③ `gate:'exempt'` 的节点 ⇒ 静默（写闸按设计侧声明放行，hook 不唱反调） | 同上（第 2 条） |
 * | ④ 册上查不到的路径 ⇒ 报"不属于任何设计节点" | 同上（第 3 条） |
 * | ⑤ **毒册对照**：旧位置 `docs/` 里那份不许改变结论 | `⑤ 毒册对照` |
 * | ⑥ 每会话每文件只提醒一次：同 session 第二次静默、换 session 再响 | `⑥ 会话去重` |
 * | ⑦ 跑不了要明说（没有 `dist/` ⇒ 报"闸自己跑不了"，不是静默） | `⑦ 跑不了要明说` |
 * | ⑧ 以上每一条都 **exit 0**（本 hook 是提醒，永不阻断） | `⑧ 永远 exit 0` |
 *
 * ## ★ 消融（本文件必须能红 —— 2026-10-31 迁移时实测）
 *   **改哪一行**：`scripts/hook-task-gate.mjs#alreadySeen` 里
 *   `if (seen[target]) return true;` ⇒ `if (false && seen[target]) return true;`（= 去重失效）。
 *   · **红读数**：`用例 1/6 失败` · exit 1 —— `⑥` 红，实测 `1st=true 2nd=false new=true`
 *     （同会话第二次**又响了**；`2nd=false` 那一格本该是"静默"）。
 *   · **还原后**（`git diff` 里该文件消失 = 逐字节相同）⇒ **用例 6/6 · 8 条断言全绿** · exit 0。
 *
 * ## 覆盖边界（诚实清单 · [未核]，与原证一致）
 *   · **没验真实 PreToolUse 接线**：本仓没有 `.claude/settings.json`，hook 是"脚本"不是"已挂的钩子"；
 *     本文件只验"脚本被喂一个官方形状的 stdin 时会说什么"；
 *   · **"是不是你领的"不在本 hook 内**（那是写闸 A7）⇒ 本文件不判；
 *   · ✅ 原证 ①/⑥ 里"节点只写 `description` 也能命中"那两条**已不是判据**（`AnyNode.description`
 *     已整体删除、`write_gate#nodeFilePath` 的回落分支同步删掉）⇒ 现行口径 = 文件路径只住 `path`。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(REPO, 'scripts', 'hook-task-gate.mjs');
const TMP = makeTempHome();
/** ★ 独立 home：`getDataHome()` 读 `AGENT_IO_HOME` ⇒ 册子从这里读，真册一个字节都不碰 */
const HOME = path.join(TMP, 'home');
const PROJ = path.join(TMP, 'proj');
const FEATURE = 'fix5-fixture';
after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// 夹具：一个项目根 + 一份设计册（节点形状覆盖 4 条判定）
// ════════════════════════════════════════════════════════════════════
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
for (const f of ['claimed.ts', 'candidate.ts', 'exempt.ts', 'ghost.ts']) {
  fs.writeFileSync(path.join(PROJ, 'src', f), '// fixture\n');
}
const sheet = {
  feature: FEATURE,
  source_root: PROJ.split(path.sep).join('/'),
  geometry: {
    nodes: [
      { id: 'file_claimed', type: 'file', path: 'src/claimed.ts', task: { state: 'claimed', owner: 'subagent:deepseek-fix5' } },
      { id: 'file_candidate', type: 'file', path: 'src/candidate.ts', task: { state: 'candidate' } },
      // ③ gate='exempt'：写闸按设计侧声明放行（AND 语义：只有一个节点指着它 ⇒ 满足）
      { id: 'file_exempt', type: 'file', path: 'src/exempt.ts', gate: 'exempt' },
    ],
  },
  semantic: { files: [] },
};
fs.mkdirSync(path.join(HOME, '.agent-io', 'design'), { recursive: true });
fs.writeFileSync(path.join(HOME, '.agent-io', 'design', `${FEATURE}.dsl.json`), JSON.stringify(sheet, null, 2));

// ★ ⑤ 毒册：旧位置 `docs/task-system-plan.dsl.json`
//   （若 hook 读这里，`claimed.ts` 会被读成 candidate ⇒ 响）
fs.mkdirSync(path.join(PROJ, 'docs'), { recursive: true });
fs.writeFileSync(
  path.join(PROJ, 'docs', 'task-system-plan.dsl.json'),
  JSON.stringify({
    feature: FEATURE,
    source_root: sheet.source_root,
    geometry: {
      nodes: [{ id: 'poison_claimed', type: 'file', path: 'src/claimed.ts', task: { state: 'candidate' } }],
    },
  }),
);

// ════════════════════════════════════════════════════════════════════
// 跑 hook（子进程；喂官方形状的 stdin）
// ════════════════════════════════════════════════════════════════════
function runHook(
  fileRel: string,
  { session = 'sess-1', hookPath = HOOK, env = {} }: { session?: string; hookPath?: string; env?: Record<string, string> } = {},
): { out: string; rc: number } {
  const input = JSON.stringify({ tool_input: { file_path: path.join(PROJ, fileRel) }, cwd: PROJ, session_id: session });
  try {
    const out = execFileSync(process.execPath, [hookPath], {
      cwd: PROJ,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AGENT_IO_HOME: HOME, ...env },
    });
    return { out: String(out).trim(), rc: 0 };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`.trim(), rc: typeof err.status === 'number' ? err.status : -1 };
  }
}

test('② candidate 卡 ⇒ 提醒里带出 state（不是只说"没卡"）', () => {
  const r = runHook('src/candidate.ts', { session: 's2' });
  assert.ok(
    r.out.includes('candidate') && r.out.includes('不是 claimed'),
    `② candidate 卡必须提醒且**带 state**：实测 out=${JSON.stringify(r.out.slice(0, 120))}`,
  );
});

test('①③④ claimed 静默 · exempt 静默 · 幽灵路径报账外（三条一起）', () => {
  // ★ 前置：hook 自己依赖 dist（见文件头"为什么可以依赖 dist"）—— 缺了直接红并点名
  assert.ok(
    fs.existsSync(path.join(REPO, 'dist', 'src', 'application', 'write_gate.js')),
    '前置不成立：缺 `dist/src/application/write_gate.js` ⇒ 先 `npm run build`（本文件 spawn 的 hook 读它）',
  );
  const claimed = runHook('src/claimed.ts', { session: 's3' });
  assert.ok(
    claimed.out === '' && claimed.rc === 0,
    `① 同路径上有一张 claimed 卡 ⇒ 必须**静默**（不制造噪音）：实测 out=${JSON.stringify(claimed.out)} rc=${claimed.rc}`,
  );
  const exempt = runHook('src/exempt.ts', { session: 's4' });
  assert.ok(
    exempt.out === '' && exempt.rc === 0,
    `③ 节点声明 \`gate=exempt\` ⇒ 必须静默（写闸按设计侧豁免放行，hook 不唱反调）：实测 out=${JSON.stringify(exempt.out)}`,
  );
  const ghost = runHook('src/ghost.ts', { session: 's5' });
  assert.ok(
    ghost.out.includes('不属于任何设计节点'),
    `④ 册上查不到的路径 ⇒ 必须报"不属于任何设计节点"：实测 out=${JSON.stringify(ghost.out.slice(0, 100))}`,
  );
});

test('⑤ 毒册对照：旧位置 `docs/` 里那份不许改变结论', () => {
  const c = runHook('src/claimed.ts', { session: 's7' });
  assert.equal(
    c.out,
    '',
    '⑤ `docs/task-system-plan.dsl.json` 把它写成 candidate ⇒ 仍须以 `.agent-io/design/` 的 claimed 为准（静默，不读旧位置）',
  );
});

test('⑥ 每会话每文件只提醒一次（同会话第二次静默 · 换会话再响）', () => {
  const first = runHook('src/candidate.ts', { session: 'dedupe' });
  const second = runHook('src/candidate.ts', { session: 'dedupe' });
  const other = runHook('src/candidate.ts', { session: 'dedupe-2' });
  assert.ok(
    first.out !== '' && second.out === '' && other.out !== '',
    `⑥ 去重口径：同会话第二次必须静默、换会话必须再响一次 —— 实测 1st=${first.out !== ''} 2nd=${second.out === ''} new=${other.out !== ''}`,
  );
});

test('⑦ 跑不了要明说（缺 dist ⇒ 报"闸自己跑不了"，不是静默）', () => {
  const bare = path.join(TMP, 'nodist', 'scripts');
  fs.mkdirSync(bare, { recursive: true });
  fs.copyFileSync(HOOK, path.join(bare, 'hook-task-gate.mjs'));
  const r = runHook('src/candidate.ts', { session: 's8', hookPath: path.join(bare, 'hook-task-gate.mjs') });
  assert.ok(
    r.out.includes('闸自己跑不了') && r.rc === 0,
    `⑦ 缺 \`dist/\` ⇒ 必须**明说"闸自己跑不了"**（不静默、不假装查过），且仍 exit 0：实测 rc=${r.rc} out=${JSON.stringify(r.out.split('\n')[0].slice(0, 100))}`,
  );
});

test('⑧ hook 永远 exit 0（提醒不是阻断）—— 且这次确实响了', () => {
  const r = runHook('src/candidate.ts', { session: 's9' });
  assert.ok(
    r.rc === 0 && r.out !== '',
    `⑧ hook 必须永远 exit 0，且这次**确实响了**（不是空跑冒充通过）：实测 rc=${r.rc} out=${JSON.stringify(r.out.slice(0, 80))}`,
  );
});
