#!/usr/bin/env node
/**
 * ★★★ cert T342 —— **「真仓 observe-skeleton 的 5 条 [anchor_broken] 修复」的出生证**（2026-10-16）。
 *
 * ## 这一笔要钉住什么
 *   T340 全量扫描发现真仓 feature **`observe-skeleton` 现状 `valid=false`，5 条 `[anchor_broken]`**
 *   （判据 = `src/domain/validator.ts:104-114`：**`semantic.files.id` 不在 `geometry.nodes`**）。
 *   ⇒ 本笔经工具层修掉它，并**留下可复跑的判据**：修后 `valid=true`，且另外两个主 feature 没被弄坏。
 *
 * ## ★★ 第 0 步（先找既有解法，不新造）—— "DSL 里出现孤儿/悬空引用，本仓怎么处理？"≥2 处
 *   · ① `src/application/design/dsl_ops/update_feature.ts:246-251` —— **`anchor_broken` 的既有规定修法**：
 *     `prefixFix.anchor_broken` 逐字写着「**为它 `node/add` 一个同 id 节点，或删掉该 semantic.files 条目**」
 *     （即"该在 ⇒ 补节点" / "不该在 ⇒ 清条目"两条路）。★ 本笔照它选①。
 *   · ② `src/domain/overlay.ts:414-419` —— 真相面删掉锚点时**孤儿暂存**（`{...a, orphaned:true}`，
 *     "**不静默丢**"）；`:421-429` 改名/换 id 走 `_migratedFrom` 认亲 —— 口径 = **先判"它在不在"，不一律删**。
 *   · ③ `src/infrastructure/graph/import_project.ts:1045-1064 allow_design_drop` —— 重建前**点名**要丢哪些节点
 *     （`willDrop` 按 id 算差集）+ **三选一**（live_only / allow_design_drop / 先记进设计）—— 破坏性操作**不许默认静默**。
 *   · ④ `src/application/design/dsl_ops/file_ops.ts:150-196 delete_file` —— 删文件是"**三清**"（语义+几何+边），
 *     且回执**首行**必须自足（"删了几条 + ⚠ 不留历史"）—— 即"删"是一个**有交代**的操作，不是拼接。
 *   ⇒ 本笔的处置（为 5 个条目补同 id 几何节点）**就是①选的①**，没有新造处置方式。
 *
 * ## ★ 判据（★ 每条都亲手跑、贴读数）
 *   **Part B — 真仓（只读）**
 *     B1 真仓 `observe-skeleton`：★ **经工具层** `get_dsl query=nodes` ⇒ 文本含 **10 个节点**，其中 5 个是
 *        `type=file` 的新文件节点（修完才看得到）。
 *     B2 真仓 `observe-skeleton` 存档：`validateDSL` ⇒ **valid=true / errors=0**（改前是 5 条）。
 *     B3 ★ 不变式：`semantic.files` 里**每个 id 都在 `geometry.nodes`**（orphan = 0）。
 *     B4 5 个 file 条目**各有同 id、`type='file'`、`description=path`** 的几何节点（补的是"同 id 节点"，不是别的）。
 *     B5 真仓 `self-2026-10-15`：`valid=true`（**没被弄坏**）。
 *     B6 真仓 `run82`：`valid=true`（**没被弄坏**）。
 *   **Part A — 夹具（★ 走工具层）**
 *     A0 夹具自洽基线：`validateDSL` ⇒ valid=true。
 *     A1 复现病：`saveDSL` 塞一个"有 file 条目、无几何节点" ⇒ `validateDSL` 报 **`[anchor_broken]`**。
 *     A2 ★★ **经工具层** `edit_dsl`（`node/add` 同 id）⇒ **成功**、`validateDSL` **valid=true**、
 *        且回执**未被 T340 自洽性闸拦**（无「拒绝提交」）—— 这正是本笔在真仓做的那一步。
 *     A3 对照：**同一处**若走既有口径②（**经工具层** `edit_dsl` `file/delete`）⇒ 也 `valid=true`，且条目消失
 *        —— 两条既有口径都成立（选①是因为"职责文本"是设计内容，不该丢；见设计里的决策卡 `rationale`）。
 *
 * ## ★★ 诚实清单（[未核] · 不许把推测写成实测）
 *   · ★★ **Part B 读的是【本机真仓】 `.agent-io/`**（certs 其余多为夹具）—— 这是**本笔的对象本身**（真数据修复）。
 *     仓库里 `.agent-io/` 是 **gitignored**（`.gitignore:37`）⇒ 换机器/新 clone **没有它** ⇒ Part B 的 6 条会
 *     **标 SKIP 而不是判红**（"没跑"与"跑过且通过"分开；跳过数进横幅，不计入 PASS/FAIL）。★ **本机实跑：不跳过。**
 *   · **MCP 传输 / `tools/list` schema 层 [未核]**：直接 import `editDslHandler` / `getDslHandler`，没经 MCP server 协议。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · ★ **不声称"没有行为改变"**（真仓数据改了，逐条）：
 *       1. `.agent-io/features/observe-skeleton.json`：`geometry.nodes` **5 → 10**（新增 5 个 `file_*` 节点，
 *          `type='file'`、`description`=仓库相对路径）；`_dsl_rev` 16 → 22；
 *       2. `.agent-io/features/observe-skeleton.overlay.json`：锚点 **5 → 6**（新增
 *          `file_src_infrastructure_analysis_observe_instrument_skeleton_ts` 的锚点，带本笔的决策卡）；
 *       3. `.agent-io/snapshots/observe-skeleton/` 新增 1 份动手前快照（`pre-t342-snapshot`）；
 *       4. **`semantic.files` 5 条一字未改**（path / responsibility 原样）—— 本笔只**补**几何节点，不删不改条目。
 *   · ★ **根活态文件 `<repo>/agent-io.json` 会被 `saveDSL` 覆盖**（这是本仓机制：单个活态文件）—— 本笔
 *     **动手前备份、事后逐字节还原**（sha1 比对），使 `getDSL('run82')` 的读取**与改动前完全一致**。
 *     ★ 该文件的覆盖/还原**不在本证判据内**（它是运行时缓存、gitignored）；此处**如实记**，不假装它不存在。
 *   · ★ **同族观察（未处置）**：`contract_obs_5.decision.evidence_source` 指 `observe_langs.ts`，而它**不在**
 *     `semantic.files` 里 —— 这**不是** `[anchor_broken]`（那条只查 `semantic.files`）。本笔**不动**它（超范围）。
 *
 * ## 用法
 *   node certs/t342-anchor-broken-repair-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp342`；Part A 把 `AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓**（Part B 只读真仓）。
 * ★★ 全证**只 1 次删除操作**（末尾清理 `certs/.work/tmp342`；宿主删除闸按删除【操作】数累计，阈值 50）
 *   —— 故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp342');
const REAL_FEATURES = path.join(REPO, '.agent-io', 'features');

let P = 0;
let F = 0;
let SKIP = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const skip = (label, why) => {
  console.log(`○ SKIP ${label}\n     ${why}`);
  SKIP++;
};
const dump = (label, text) => {
  console.log(`   ── ${label} ──`);
  for (const line of String(text).split('\n').slice(0, 14)) console.log(`     ${line}`);
};

// ═══════════════════════════════════════════════════════════════════
// Part B：真仓（只读）—— ★ 必须在设 AGENT_IO_HOME 之前跑
// ═══════════════════════════════════════════════════════════════════
const { validateDSL } = await import('../dist/src/domain/validator.js');
const { getDslHandler } = await import('../dist/src/application/design/handlers.js');

const readReal = (feat) => {
  const p = path.join(REAL_FEATURES, `${feat}.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
};

const OBS = 'observe-skeleton';
const obs = readReal(OBS);

console.log('════ Part B · 真仓 observe-skeleton（只读）════');
if (!obs) {
  for (const l of [
    'B1 经工具层 get_dsl query=nodes 看得到 10 个节点（含 5 个 file 节点）',
    'B2 observe-skeleton 存档 validateDSL valid=true / errors=0',
    'B3 semantic.files 全部有几何节点（orphan=0）',
    'B4 5 个 file 条目各有同 id / type=file / description=path 的几何节点',
    'B5 self-2026-10-15 valid=true',
    'B6 run82 valid=true',
  ]) skip(l, `真仓无 .agent-io/features/${OBS}.json（.agent-io 为 gitignored，换机器即不存在）`);
} else {
  const obsV = validateDSL(obs);
  const obsNodeIds = new Set((obs.geometry?.nodes ?? []).map((n) => n.id));
  const obsFiles = obs.semantic?.files ?? [];
  const orphan = obsFiles.filter((f) => !obsNodeIds.has(f.id));

  // B1：经工具层看节点（这 5 个 file 节点是修完才存在的）
  {
    const r = await getDslHandler({ feature: OBS, query: 'nodes' });
    const txt = String(r?.text ?? '');
    const hit = obsFiles.every((f) => txt.includes(`[${f.id}]`)) && /节点总数:\s*10\b/.test(txt);
    dump('get_dsl query=nodes（真仓，工具层）· 前 12 行', txt);
    chk(
      hit,
      'B1 ★ 经工具层 `get_dsl(query:"nodes")` 看得到 10 个节点、且 5 个 `file_*` 文件节点都在',
      `含全部 5 个 file id = ${obsFiles.every((f) => txt.includes(`[${f.id}]`))} · 节点总数:10 = ${/节点总数:\s*10\b/.test(txt)}`,
    );
  }
  // B2
  chk(
    obsV.valid === true && obsV.errors.length === 0,
    'B2 ★★ 真仓 observe-skeleton：`validateDSL` **valid=true / errors=0**（改前：valid=false，5 条 anchor_broken）',
    `valid=${obsV.valid} · errors=${JSON.stringify(obsV.errors)} · nodes=${obs.geometry?.nodes?.length} · files=${obsFiles.length} · rev=${obs._dsl_rev}`,
  );
  // B3
  chk(
    orphan.length === 0,
    'B3 ★ 不变式：`semantic.files` 里每个 id 都在 `geometry.nodes`（orphan = 0）',
    `files=${obsFiles.length} · orphan=${orphan.length}${orphan.length ? ' · ' + orphan.map((o) => o.id).join(', ') : ''}`,
  );
  // B4
  {
    const wrong = obsFiles.filter((f) => {
      const n = (obs.geometry?.nodes ?? []).find((x) => x.id === f.id);
      return !n || n.type !== 'file' || n.description !== f.path;
    });
    chk(
      wrong.length === 0,
      'B4 5 个 file 条目各有同 id / `type=\'file\'` / `description=path` 的几何节点（补的是「同 id 节点」）',
      `不匹配=${wrong.length}${wrong.length ? ' · ' + wrong.map((w) => w.id).join(', ') : ''}`,
    );
  }
  // B5 / B6
  for (const [feat, key] of [['self-2026-10-15', 'B5'], ['run82', 'B6']]) {
    const d = readReal(feat);
    if (!d) {
      skip(`${key} 真仓 ${feat} valid=true`, `真仓无 .agent-io/features/${feat}.json`);
      continue;
    }
    const v = validateDSL(d);
    chk(
      v.valid === true,
      `${key} 真仓 \`${feat}\`：**valid=true**（**没被本笔弄坏**）`,
      `valid=${v.valid} · errors=${v.errors.length} · nodes=${d.geometry?.nodes?.length} · files=${d.semantic?.files?.length}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════
// Part A：夹具（★ 走工具层）—— 设 AGENT_IO_HOME 之后跑
// ═══════════════════════════════════════════════════════════════════
fs.mkdirSync(TMP, { recursive: true });
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME; // ★ 之后所有 storage/handler 都读这个临时 home

const { saveDSL, getDSL } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler } = await import('../dist/src/application/design/handlers.js');

const FEAT_A = 't342a';
const FEAT_B = 't342b';
/** 自洽基线：node_a 同时有几何节点与 file 条目 */
const base = (feat) => ({
  id: `feature_${feat}`,
  type: 'feature_diagram',
  feature: feat,
  version: '1.0.0',
  title: feat,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [{ id: 'node_a', type: 'file', label: 'a.ts', description: 'src/a.ts' }],
    edges: [],
  },
  semantic: { files: [{ id: 'node_a', path: 'src/a.ts', responsibility: 'A 的职责' }] },
});
/** 病态：再塞一个"有 file 条目、无几何节点"的孤儿条目 */
const broken = (feat) => {
  const d = base(feat);
  d.semantic.files.push({ id: 'file_src_orphan_ts', path: 'src/orphan.ts', responsibility: '孤儿条目（无几何节点）' });
  return d;
};

console.log('\n════ Part A · 夹具（★ 走工具层）════');
// A0
saveDSL(base(FEAT_A));
chk(
  validateDSL(getDSL(FEAT_A)).valid === true,
  'A0 夹具自洽基线：`validateDSL` ⇒ valid=true',
  `valid=${validateDSL(getDSL(FEAT_A)).valid}`,
);
// A1 复现病（用 saveDSL 直接摆，绕过 edit_dsl 的自洽性闸 —— 那道闸不许你"新引入"这条错）
saveDSL(broken(FEAT_A));
{
  const v = validateDSL(getDSL(FEAT_A));
  chk(
    v.valid === false && v.errors.some((e) => e.startsWith('[anchor_broken]') && e.includes('file_src_orphan_ts')),
    'A1 复现病：塞一个"有 file 条目、无几何节点" ⇒ `validateDSL` 报 **`[anchor_broken]`**（= 真仓那 5 条的同一判据）',
    `valid=${v.valid} · ${v.errors.join(' | ')}`,
  );
}
// A2 ★★ 经工具层 edit_dsl node/add 同 id ⇒ 成功 + valid=true + 未被自洽性闸拦
{
  const res = await editDslHandler({
    feature: FEAT_A,
    weight: 'normal',
    agent: 'cert-t342',
    reason: 'T342 夹具：为孤儿 file 条目 src/orphan.ts 补 node/add 同 id 几何节点（复现真仓那一步）',
    operations: [{ type: 'node', op: 'add', id: 'file_src_orphan_ts', data: { type: 'file', label: 'orphan.ts', description: 'src/orphan.ts' } }],
  });
  dump('工具回执原文（edit_dsl → editDslHandler）', res?.text);
  const v = validateDSL(getDSL(FEAT_A));
  chk(
    res?.isError !== true && v.valid === true && !/拒绝提交/.test(String(res?.text ?? '')),
    'A2 ★★ **经工具层** `edit_dsl`（`node/add` 同 id）⇒ **成功**、`validateDSL` **valid=true**，且未被 T340 自洽性闸拦（无「拒绝提交」）',
    res?.isError ? `★ 被拒：${String(res.text).split('\n')[0]}` : `回执首行 = ${String(res.text).split('\n')[0]} · valid=${v.valid} · errors=${v.errors.length}`,
  );
}
// A3 对照：既有口径②（经工具层 file/delete）也成立
{
  saveDSL(broken(FEAT_B));
  const before = validateDSL(getDSL(FEAT_B));
  const res = await editDslHandler({
    feature: FEAT_B,
    weight: 'normal',
    agent: 'cert-t342',
    reason: 'T342 夹具对照：按既有口径②删掉孤儿 file 条目 src/orphan.ts（看它是否同样使 valid=true）',
    operations: [{ type: 'file', op: 'delete', id: 'file_src_orphan_ts' }],
  });
  const after = validateDSL(getDSL(FEAT_B));
  chk(
    before.valid === false && res?.isError !== true && after.valid === true && !(getDSL(FEAT_B)?.semantic?.files ?? []).some((f) => f.id === 'file_src_orphan_ts'),
    'A3 ★ 对照：既有口径②（**经工具层** `edit_dsl` `file/delete` 该条目）⇒ 同样 `valid=true`、条目消失 —— 两条既有口径都成立',
    `before.valid=${before.valid} · after.valid=${after.valid} · 条目仍在=${(getDSL(FEAT_B)?.semantic?.files ?? []).some((f) => f.id === 'file_src_orphan_ts')}`,
  );
}

// ★★ 清理：**全证只此 1 次删除操作**
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp342 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (SKIP > 0) console.log(`★ 另有 ${SKIP} 条因"真仓无对应 feature 存档"被跳过（○ SKIP，不计入 PASS/FAIL）`);
if (F > 0) process.exit(1);
