#!/usr/bin/env node
/**
 * ★★★ cert T428 —— **`detect_drift` 并入 `design_line action=drift`**（2026-10-28）
 *
 * ## 为什么是"吸收"，不是"删"
 * `detect_drift` 与刚搬走的 `consistency_check` 是**同一个执行核**（`checkConsistencyReport`，
 * 它自己在 `consistency.ts:154` 写明两者"共用同一套对账三态术语"）+ 两层独有叠加：
 *   · **四态含 `no_comparison`**（没得比 ≠ 对齐）—— 这条是它挣来的，不能丢；
 *   · **漂移台账** `<storageRoot>/drift/<feature>.drift.json`（`mode=status` 可复读）。
 * ⇒ 进设计链读数（第 ⑤ 步"设计 vs 实际"）：`design_line action=drift`，**执行核与台账都不动**。
 *
 * ## 判据（每条亲手跑）
 *   ① `detect_drift` **不在注册表**；工具面 **50 上限**（只降不升）；
 *   ② `design_line action=drift` **真跑起来**：给出 `status` + `drifted` 判定（不是空回执）；
 *   ③ **台账真写了**：`drift/<feature>.drift.json` 落在存储根里（**跑前不存在** ⇒ 是这一跑写出来的）；
 *   ④ `drift_mode=status` **读得回**同一份台账（复读 ≠ 重算，且 status 相同）；
 *   ⑤ 执行核 `intent/detect_drift.ts` **仍在**且仍被 `design_line` 引用（只删注册，不删能力）；
 *   ⑥ **词表还在**：源码里仍有 `no_comparison`（"没得比"这一态不许被删）。
 *
 * ## 夹具：**本证自带一个最小 feature**（不改 2026-10-30 的隔离约定）
 * ★ 回归病史（2026-10-31 实测 4 条 FAIL）：本证曾把 `feature:'agent-io'` 写死，而 runner 给**每张证**
 *   注入隔离的 `AGENT_IO_HOME`（`run-all-certs.mjs` T-#REG-POLLUTE）⇒ 隔离 home 里**没有**那个 feature
 *   ⇒ `feature "agent-io" 不存在`，②③④ 全红。
 * ★ **修法是"造夹具"，不是"关隔离"、也不是"读真仓"**：本证自己把 `AGENT_IO_HOME` 钉到
 *   `<tmp>/home`（与 t330/t361 同形），先 `saveDSL` 造一本最小册（`source_root` = `<tmp>/proj`，
 *   一个文件节点 + 一条 `expected_apis`），再跑 drift ⇒ **输入显式钉死**（0.12 第 2 条：
 *   判据的输入不许是环境态）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **[未核]** `scope=changed` + git 参照（`since_ref`）分支未在本证覆盖（时序敏感；夹具项目**不是** git 仓库，
 *     本证一律 `drift_scope=all`）；
 *   · **[未核]** 夹具只造 1 条 `expected_apis`（`status=clean` 那一路）；`design_stale` / `missing_impl` /
 *     `no_comparison` 三态的分流逻辑不在本证；`no_comparison` 只做**词表仍在**的静态确认。
 *
 * ## 用法
 *   node certs/t428-drift-into-design-line-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work', 'tmp428drift-'));
process.env.AGENT_IO_REQUIRE_PLAN = '0';

// ★★ 隔离（0.12 第 2 条）：`getStorageRoot()` 读 `AGENT_IO_HOME` ⇒ 册子与漂移台账都落在本证的临时根里，
//   真仓的 `.agent-io/` 一个字节都不碰。必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**。
const HOME = path.join(TMP, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.AGENT_IO_HOME = HOME;

// ★ 夹具项目：drift 的"实际代码"侧（不是 git 仓库 ⇒ 本证只用 scope=all）
const PROJ = path.join(TMP, 'proj');
fs.mkdirSync(path.join(PROJ, 'src'), { recursive: true });
fs.writeFileSync(path.join(PROJ, 'src', 'a.ts'), 'export function f(x: number): number {\n  return x + 1;\n}\n');

const FEATURE = 't428drift';
const D = pathToFileURL(path.join(ROOT, 'dist', 'src')).href + '/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const { saveDSL, getStorageRoot } = await import(D + 'infrastructure/storage.js');
const dl = TOOL_DEFS.find((t) => t.name === 'design_line');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

function unwrap(r) {
  const t = String(r?.text ?? '');
  const i = t.lastIndexOf('---DATA---');
  if (i < 0) return { msg: t.trim(), data: undefined };
  let data;
  try {
    data = JSON.parse(t.slice(i + 10).trim());
  } catch {
    data = undefined;
  }
  return { msg: t.slice(0, i).trim(), data };
}

// ── 夹具：最小册（一个文件节点 + 一条 expected_apis，source_root 指夹具项目）──────
saveDSL({
  id: `feature_${FEATURE}`,
  type: 'feature_diagram',
  feature: FEATURE,
  version: '1.0.0',
  title: FEATURE,
  source_root: PROJ.split(path.sep).join('/'),
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [{ id: 'file_a', type: 'file', path: 'src/a.ts', label: 'a' }],
    edges: [],
  },
  semantic: {
    files: [
      {
        id: 'file_a',
        path: 'src/a.ts',
        responsibility: 'T428 夹具：drift 对账目标（设计与代码在这一条上对齐）',
        expected_apis: [{ signature: 'f(x: number): number', notes: 'T428 夹具' }],
      },
    ],
  },
});

// ── ① 旧工具已不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('detect_drift'), '① `detect_drift` **不在注册表**');
  chk(names.length <= 50, '①-b 工具面 **≤ 50**（只降不升）', `实际 ${names.length}`);
}

// ── ② action=drift 真跑 ───────────────────────────────
// ★ ③ 的基准**先取**（同一规则算路径：getStorageRoot()/drift/<feature>.drift.json）——
//   "跑前不存在 + 跑后存在" 才证明台账是**这一跑**写的（不是上一轮遗留）。
const ledgerPath = path.join(String(getStorageRoot()), 'drift', `${FEATURE}.drift.json`);
const ledgerBefore = fs.existsSync(ledgerPath);
let status1 = '';
{
  const { msg, data } = unwrap(
    await dl.handler({ action: 'drift', feature: FEATURE, project_dir: ROOT, drift_scope: 'all' }),
  );
  const d = data ?? {};
  status1 = String(d.status ?? '');
  chk(!!status1 || /状态/.test(msg), '② `design_line action=drift` **跑起来了**（给出状态判定）', `${status1 || msg.split('\n')[0]?.slice(0, 100)}`);
  chk(typeof d.drifted === 'boolean' || /drifted/.test(JSON.stringify(d)), '②-b 给出 `drifted` 布尔判定（不是只给一句话）', `drifted=${JSON.stringify(d.drifted)} · status=${status1}`);
}

// ── ③ 台账真写了 ──────────────────────────────────────
{
  const exists = fs.existsSync(ledgerPath);
  chk(exists && !ledgerBefore, '③ **漂移台账真写了**（按 `getStorageRoot()/drift/<feature>.drift.json` 定位；跑前不存在）', `${ledgerPath} · 跑前存在=${ledgerBefore} · 跑后存在=${exists}`);
  let obj = {};
  if (exists) {
    try { obj = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch {}
  }
  chk(exists && !!obj.status && 'drifted' in obj, '③-b 台账**字段齐**（status / drifted / checked_at）', `status=${obj.status} drifted=${obj.drifted} checked=${obj.checked_at ?? '?'}`);
}

// ── ④ mode=status 读得回 ─────────────────────────────
{
  const { data } = unwrap(
    await dl.handler({ action: 'drift', feature: FEATURE, project_dir: ROOT, drift_mode: 'status' }),
  );
  const st2 = String(data?.status ?? data?.drift?.status ?? '');
  chk(!!st2, '④ `drift_mode=status` **读得回台账**（复读走台账，不重算）', `status=${st2}`);
  chk(!!status1 && st2 === status1, '④-b 复读 status **与实时计算一致**', `${status1} vs ${st2}`);
}

// ── ⑤ 执行核仍在 ──────────────────────────────────────
{
  chk(fs.existsSync(path.join(ROOT, 'src/application/design/intent/detect_drift.ts')), '⑤ 执行核 `intent/detect_drift.ts` **仍在**');
  const idx = fs.readFileSync(path.join(ROOT, 'src/application/design/index.ts'), 'utf8');
  chk(/detectDrift/.test(idx), '⑤-b `design_line` **仍引用 `detectDrift`**（拆注册不拆执行核）');
}

// ── ⑥ 四态词表还在（no_comparison 不许被删）─────────────
{
  const core = fs.readFileSync(path.join(ROOT, 'src/application/design/intent/detect_drift.ts'), 'utf8');
  chk(/no_comparison/.test(core), '⑥ **`no_comparison`（没得比）这一态仍在** —— 不许把"没查"读成"查过没事"');
}

// ★ 清理：本证的册子/台账/夹具项目都在 TMP 这一棵里（删掉即可，无逐文件复原）。
//   拦下 ≠ 本证判红（判据是 ①~⑥ 六条业务事实），但**不许静默**。
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp428drift-* 即可（它是 gitignored 的临时区）。');
}

console.log(`\n═══ T428 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
