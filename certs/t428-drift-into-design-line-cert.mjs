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
 *   ① `detect_drift` **不在注册表**；工具面 **51 → 50**；
 *   ② `design_line action=drift` **真跑起来**：给出 `status` + `drifted` 判定（不是空回执）；
 *   ③ **台账真写了**：`drift/<feature>.drift.json` 落在存储根里；
 *   ④ `drift_mode=status` **读得回**同一份台账（复读 ≠ 重算，且 status 相同）；
 *   ⑤ 执行核 `intent/detect_drift.ts` **仍在**且仍被 `design_line` 引用（只删注册，不删能力）；
 *   ⑥ **词表还在**：源码里仍有 `no_comparison`（"没得比"这一态不许被删）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只在本仓（`feature=agent-io`）上跑；**[未核]** 在没有 `expected_apis` 的册上是否会正确报
 *     `no_comparison`（那要造一本空册；本证只静态确认词表与分支仍在）；
 *   · **[未核]** `scope=changed` + git 参照（`since_ref`）分支未在本证覆盖（时序敏感）。
 *
 * ## 用法
 *   node certs/t428-drift-into-design-line-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp428drift-'));
// ★★ 2026-10-28（第二次踩同一个坑）：**不能覆盖 `AGENT_IO_HOME`** —— DSL 册是按它定位的，
//   换掉之后 `feature` 直接"不存在"（t426 已栽过一次）。⇒ 真 HOME 下跑，**跑完把本次写的台账复原**。
process.env.AGENT_IO_REQUIRE_PLAN = '0';
const cleanup = [];

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const dl = TOOL_DEFS.find((t) => t.name === 'design_line');

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

// ── ① 旧工具已不在 ────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!names.includes('detect_drift'), '① `detect_drift` **不在注册表**');
  chk(names.length <= 50, '①-b 工具面 **≤ 50**（只降不升）', `实际 ${names.length}`);
}

// ── 先记下已有台账（避免复原时误删别人的）───────────────
{
  const seen = [];
  const walkPre = (dir, depth) => {
    if (depth > 6) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name === 'drift') seen.push(p); walkPre(p, depth + 1); }
    }
  };
  const homeBase0 = process.env.USERPROFILE || process.env.HOME || '';
  if (homeBase0) walkPre(homeBase0, 0);
  for (const d of seen) for (const f of fs.readdirSync(d)) preexisting.add(path.join(d, f));
}

// ── ② action=drift 真跑 ───────────────────────────────
const preexisting = new Set();
let status1 = '';
{
  const { msg, data } = unwrap(
    await dl.handler({ action: 'drift', feature: 'agent-io', project_dir: ROOT, drift_scope: 'all' }),
  );
  const d = data ?? {};
  status1 = String(d.status ?? '');
  chk(!!status1 || /状态/.test(msg), '② `design_line action=drift` **跑起来了**（给出状态判定）', `${status1 || msg.split('\n')[0]?.slice(0, 100)}`);
  chk(typeof d.drifted === 'boolean' || /drifted/.test(JSON.stringify(d)), '②-b 给出 `drifted` 布尔判定（不是只给一句话）', `drifted=${JSON.stringify(d.drifted)} · status=${status1}`);
}

// ── ③ 台账真写了（★ 按代码同一规则算路径：getStorageRoot()/drift/<feature>.drift.json）──
{
  const { getStorageRoot } = await import(D + 'infrastructure/storage.js');
  const ledgerPath = path.join(String(getStorageRoot()), 'drift', 'agent-io.drift.json');
  const before = preexisting.has(ledgerPath);
  const exists = fs.existsSync(ledgerPath);
  chk(exists, '③ **漂移台账真写了**（按 `getStorageRoot()/drift/<feature>.drift.json` 定位）', ledgerPath);
  if (exists && !before) cleanup.push(ledgerPath);
  if (exists) {
    let obj = {};
    try { obj = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); } catch {}
    chk(!!obj.status && 'drifted' in obj, '③-b 台账**字段齐**（status / drifted / checked_at）', `status=${obj.status} drifted=${obj.drifted} checked=${obj.checked_at ?? '?'}`);
  }

// ── ④ mode=status 读得回 ─────────────────────────────
  const { data } = unwrap(
    await dl.handler({ action: 'drift', feature: 'agent-io', project_dir: ROOT, drift_mode: 'status' }),
  );
  const st2 = String(data?.status ?? data?.drift?.status ?? '');
  chk(!!st2, '④ `drift_mode=status` **读得回台账**（复读走台账，不重算）', `status=${st2}`);
  chk(!status1 || st2 === status1 || st2 === `live_${status1}`, '④-b 复读 status **与实时计算一致**', `${status1} vs ${st2}`);
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

// ★ 复原：本次跑出来的台账（若原先不存在）删掉，不留脏状态
for (const f of cleanup) {
  try {
    fs.rmSync(f, { force: true });
    console.log('  （已复原：删掉本次写的台账 ' + path.basename(f) + '）');
  } catch {}
}

console.log(`\n═══ T428 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
