#!/usr/bin/env node
/**
 * ★★★ cert T339 —— **「未实现的条目不住 `nodes[]`」的出生证**（2026-10-16）。
 *
 * ## 这一笔要钉住什么（`docs/replan-log-2026-10-15.md` §42.4 的落地）
 *   §42.4 裁定：**未实现的占位不该进 `nodes[]`**（`nodes[]` 是"**已实现的结构**"），
 *   而要**单列一区、就用名字/路径**（`expectations` / `scope` 那种形态，不伪装成 node）。
 *   ⇒ 本证把 `design/<f>.dsl.json` 里那条"要实现"的条目**移出 `nodes[]`**，
 *     让它**过同一把 `validateDSL`（`valid=true`）**，同时**对拍语义一字不变**。
 *
 * ## ★★ 第 0 步（先找既有解法，不新造）—— 本笔的住处就是"既有的"
 *   同类问题 = "**一个不该进 `nodes[]` 的东西，本仓把它放在哪？**"，仓里 ≥2 处既有解法：
 *   · ① `src/domain/expectation.ts:35-40` —— `expectations` 六种 kind **全用「路径/符号名」指代、
 *     无一用 id**（`file-exists {path}` 可指**还不存在的文件**），且**挂在决策卡上、不在 `nodes[]` 里**
 *     （`src/domain/geometry.ts:206` `NodeDecision.expectations`）；
 *   · ② `src/domain/scope.ts:31` —— `scope` 的 `files:<仓库相对路径>` 是**字符串**，**根本不在 `nodes[]`**；
 *   · ③ `src/domain/overlay.ts:331-333` `nodePath` —— file 节点的**路径住 `description`**（按名字认亲的既有口径）；
 *   · ④ ★ 本证采用的：**`meta.goals`** —— `meta` 是本仓**已声明**的"**无类型袋子**"
 *     （`application/design/dsl_ops/update_feature.ts:554` 逐字："DSL 的 `meta` 是**无类型袋子**（goals/storyboard 已住此处）"），
 *     而 `goals` 每一格正是"**待建条目**"的形状（`domain/overlay.ts:262-268` `OverlayGoal {id?; title; description?; status?}`），
 *     **且工具层允许它没有 `id`**（`application/design/index.ts:736` `id: z.string().optional()`，`title` 才必填）
 *     —— 与"**未实现的不自造 id、用名字/路径指代**"同一条规则。
 *   ⇒ ★ **零新增区块**：不放宽 schema、不加新键、不动 `overlay`/`edit_dsl`。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ `validateDSL(design/<f>.dsl.json)` 返回 **`valid=true`**（贴原文）；
 *      ★ 并给**对照**：同一条目**塞回 `nodes[]`** ⇒ `valid=false`（证明"住对地方"有读数支撑）；
 *   ② ★ 那条"要实现"的条目**仍被判为 `只在设计里(要实现)`**（**经工具层**），且**它不在 `nodes[]` 里**（贴落盘原文 + 键名）；
 *   ③ ★★ `rebuild_design=true` 前后 `design/<f>.dsl.json` **逐字节相同**、条目**重建后仍在**（禁退化）；
 *   ④ ★ `meta.goals` 里**带 `id` 的既有条目不被误伤**（贴前后对比：不进 `design_only`、原样存在）；
 *   ⑤ ★ **自证走工具层**（`diffDesignSheetHandler`）：缺 `feature` ⇒ `requireStr` 当场报错（纯函数没这道守卫）。
 *   ★ 另两条作"三类判定**语义未变**"的旁证：只在 live 里（未纳入设计）· 同名属性差。
 *
 * ## ★★ 诚实清单（[未核] —— 不许把推测写成实测）
 *   · ★ **① 走的是 domain 层 `validateDSL`（不是工具层）**：本仓**没有**"校验 design 文件"的工具入口
 *     （`validateDSL` 全仓只被 `presentation/http/serve.ts:194` 用，那是**浏览器存盘**那条已退役的路）。
 *     ⇒ ① 是**直调**，**不声称**它经 MCP 工具层；②③④⑤ 才走 `diffDesignSheetHandler`（工具入参适配层）。
 *   · **MCP 可达性 [未核]**：`diff_design_sheet` 未注册进 `TOOL_DEFS`（`t326` 工具面零余量）⇒ LLM 暂时调不到它。
 *   · **传输 / MCP schema 层 [未核]**：直接 import handler，没经 MCP server 的 `tools/list`。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · **真 feature [未核]**：真仓 `design/<f>.dsl.json` **从不存在**（全仓只有夹具写过）⇒ 本证**全程夹具**，
 *     真仓数据**只读不碰**。
 *   · ★ **`OverlayGoal.id` 在 TS 接口里是必填**（`domain/overlay.ts:263`），而**工具层是 optional**
 *     （`application/design/index.ts:736`）—— 本证只证**设计图文件里**那条 id-less 形状过 `validateDSL` 与对拍；
 *     **`overlay` 那条链（applyOverlay/seedOverlayFromDsl）未改、未核**。
 *
 * ## 用法
 *   node certs/t339-design-sheet-pending-home-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp339`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓的 `.agent-io/`**。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按删除【操作】数累计，阈值 50）——
 *   故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp339');
fs.mkdirSync(TMP, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const dump = (label, text) => {
  console.log(`   ── ${label} ──`);
  for (const line of String(text).split('\n')) console.log(`     ${line}`);
};

// ★ AGENT_IO_HOME 必须在**任何模块读它之前**设好 ⇒ 下面全部用**动态 import**
const HOME = fs.mkdtempSync(path.join(TMP, 'home-'));
process.env.AGENT_IO_HOME = HOME;

const { saveDesignSheet, getDesignSheet, getDesignSheetFile, getDesignDir, getLiveFeature } = await import(
  '../dist/src/infrastructure/storage.js'
);
const { diffDesignSheetHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const { validateDSL } = await import('../dist/src/domain/validator.js');
const { designSheetPendingRefs } = await import('../dist/src/domain/design_sheet.js');

const FEAT = 't339';
/** ★ 未实现的对象：**没有 id**，只有**名字/路径**（用户规则："没实现的没 ID"） */
const PENDING_PATH = 'src/planned/thing.ts';
const PENDING_NAME = '待建模块 X';
/** ④ 的对照组：`meta.goals` 里**本来就带 id** 的既有条目（不得被误伤） */
const EXISTING_GOAL = { id: 'goal_existing', title: '既有目标（带 id）', status: 'active' };

console.log('════ 0. 夹具：两文件项目 → import_project（扫描出"实际"）════');
const projDir = path.join(TMP, 'proj');
fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(projDir, 'src', 'a.ts'), 'export function alpha(){ return 1; }\n');
fs.writeFileSync(path.join(projDir, 'src', 'b.ts'), "import { alpha } from './a';\nexport const beta = alpha();\n");
await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir });

const live = getLiveFeature(FEAT);
if (!live) throw new Error('夹具异常：live 快照没生成');
const liveFileIds = live.geometry.nodes.filter((n) => n.type === 'file').map((n) => n.id);
dump('live 文件节点 id（扫描给的唯一 id 空间）', liveFileIds.join('\n'));
chk(liveFileIds.length >= 2, '0 夹具就位：live 里有 ≥2 个文件节点', liveFileIds.join(', '));

const SAME = liveFileIds[0]; // 两边都有（同 id）⇒ 比属性
const LIVE_ONLY = liveFileIds[1]; // 设计**故意不写它** ⇒ 只在 live 里

console.log('\n════ 1. 手写 design/<f>.dsl.json：★ 未实现的条目**不在 `nodes[]`**、住既有的 `meta.goals` ════');
const designSheet = {
  id: `design_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: `${FEAT} 手写设计图`,
  status: 'draft',
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    // ★ `nodes[]` 只装**已实现**的结构（每条都有扫描给的 id）
    nodes: [
      { id: SAME, type: 'file', label: '手写：a', title: '手写标题 A', description: '手写设计：A 的职责（与扫描给的不一样）' },
    ],
    edges: [],
  },
  // ★★ 未实现的条目：住既有的 `meta.goals`（零新增区块），**没有 id**，用名字/路径指代
  meta: {
    goals: [
      { title: PENDING_NAME, description: PENDING_PATH, status: 'active' },
      EXISTING_GOAL,
    ],
  },
  semantic: { files: [{ id: SAME, path: 'src/a.ts', responsibility: '手写设计：A 的职责（与扫描给的不一样）' }] },
};
const dsFile = saveDesignSheet(designSheet);
const rawBefore = fs.readFileSync(dsFile, 'utf-8');
const goalsBeforeRaw = JSON.stringify(JSON.parse(rawBefore).meta?.goals);
chk(
  dsFile === getDesignSheetFile(FEAT) && dsFile === path.join(getDesignDir(), `${FEAT}.dsl.json`),
  '1 住处落定：`design/<feature>.dsl.json`',
  `getDesignSheetFile → ${dsFile}`,
);

{
  const rawObj = JSON.parse(rawBefore);
  // ── ②（前半）落盘原文：那条"要实现"**不在 `nodes[]`**，它住的键是 `meta.goals` ──
  const inNodes = (rawObj.geometry?.nodes ?? []).some((n) => n.description === PENDING_PATH || !('id' in n));
  const goal = (rawObj.meta?.goals ?? []).find((g) => g.description === PENDING_PATH);
  dump('② 落盘原文 · 那条"要实现"的条目（整个对象）', JSON.stringify(goal, null, 2));
  chk(
    !!goal && !('id' in goal) && !inNodes,
    '② ★ 它**不住 `nodes[]`**（`nodes[]` 每条都有 id）· **住 `meta.goals`** · **没有 `id` 键**（不自造 `node_pending_*`）',
    `它所在的键 = meta.goals · 该条目的键 = [${Object.keys(goal ?? {}).join(', ')}] · nodes[] = ${JSON.stringify((rawObj.geometry?.nodes ?? []).map((n) => n.id))}`,
  );
  chk(
    JSON.stringify(designSheetPendingRefs(rawObj)) === JSON.stringify([PENDING_PATH]),
    '②-b 指代口径（`designSheetPendingRefs`，路径取 `description`、与 `overlay.nodePath` 对 file 同款）',
    `designSheetPendingRefs = ${JSON.stringify(designSheetPendingRefs(rawObj))}`,
  );
}

console.log('\n════ 2. ① ★★ 判据：这份手写设计图**过同一把** `validateDSL` ⇒ valid=true ════');
{
  const v = validateDSL(JSON.parse(rawBefore));
  dump('① validateDSL(design/<f>.dsl.json) 的实测读数（原文）', `valid=${v.valid}${v.valid ? '' : `\nerrors=${JSON.stringify(v.errors)}`}`);
  chk(v.valid === true, '① ★★ `validateDSL` 对那份手写设计文件返回 **`valid=true`**（errors=[]）', `valid=${v.valid} · errors=${JSON.stringify(v.errors)}`);
  // ── 对照：同一条目**塞回 `nodes[]`** ⇒ schema 当场拒（证明"移出"是必要且有效的）──
  const rawObj = JSON.parse(rawBefore);
  const back = {
    ...rawObj,
    geometry: { ...rawObj.geometry, nodes: [...rawObj.geometry.nodes, { type: 'file', label: PENDING_NAME, description: PENDING_PATH }] },
  };
  const vBack = validateDSL(back);
  dump('①-b 对照读数：同一条目**塞回 `nodes[]`**（无 id）', `valid=${vBack.valid} · ${vBack.errors[0] ?? ''}`);
  chk(
    vBack.valid === false && /nodes\/\d+[\s\S]*id/.test(String(vBack.errors[0])),
    '①-b ★ 对照：塞回 `nodes[]` ⇒ **`valid=false`**（`required property \'id\'`）⇒ 移出是**必要**的，不是偏好',
    `valid=${vBack.valid} · ${vBack.errors[0] ?? ''}`,
  );
}

console.log('\n════ 3. ② 经**工具层**读三类差异（`diffDesignSheetHandler`）════');
const res = await diffDesignSheetHandler({ feature: FEAT });
dump('工具回执原文', res.text);
const data = parseDataBlock(res.text);
chk(res.isError !== true && data && data.diff, '3 前置：经工具层拿到**结构化**三类差异（回执带 `---DATA---` 机器段）', res.isError ? `★ isError：${res.text.split('\n')[0]}` : `design_only=${JSON.stringify(data?.diff?.design_only)}`);

// ② ★ 那条未实现条目 ⇒ 判为「只在设计里(要实现)」，列的是它的**名字/路径**
chk(
  Array.isArray(data?.diff?.design_only) && data.diff.design_only.includes(PENDING_PATH) && /要实现/.test(String(res.text)),
  '② ★★ 那条**无 id**、**不在 `nodes[]`** 的条目**仍被判为 `只在设计里(要实现)`**（列的是名字/路径，不是自造 id）',
  `design_only=${JSON.stringify(data?.diff?.design_only)}`,
);
chk(
  !(data?.diff?.design_only ?? []).some((x) => /^node_pending|pending_/.test(x)),
  '②-c `design_only` 里**没有**任何 `node_pending_*` 之类自造 token',
  `design_only=${JSON.stringify(data?.diff?.design_only)}`,
);

// ④ ★ `meta.goals` 里**带 id** 的既有条目不被误伤
{
  const inDesignOnly = (data?.diff?.design_only ?? []).includes(EXISTING_GOAL.id) || (data?.diff?.design_only ?? []).includes(EXISTING_GOAL.title);
  const rawObj = JSON.parse(rawBefore);
  const stillThere = (rawObj.meta?.goals ?? []).some((g) => g.id === EXISTING_GOAL.id && g.title === EXISTING_GOAL.title);
  dump('④ 对照组：`meta.goals` 里带 id 的既有条目', `before = ${JSON.stringify(stillThere ? EXISTING_GOAL : null)} · after = ${JSON.stringify((rawObj.meta?.goals ?? []).find((g) => g.id === EXISTING_GOAL.id) ?? null)}`);
  chk(
    !inDesignOnly && stillThere,
    '④ ★ **带 `id` 的既有 goal 不被误伤**：不进 `design_only`（有 id ⇒ 指已实现的对象）、且原样仍在 `meta.goals` 里',
    `design_only=${JSON.stringify(data?.diff?.design_only)} · 该 goal 仍在 = ${stillThere}`,
  );
}

// ── 旁证：另两类判定**语义未变** ──
chk(
  Array.isArray(data?.diff?.live_only) && data.diff.live_only.includes(LIVE_ONLY) && /未纳入设计/.test(String(res.text)),
  '旁证-③\'(未纳入设计) 只在 live 里 ⇒ 仍判为 **`未纳入设计`**（live 全是已实现的 ⇒ 列 id，语义未变）',
  `live_only=${JSON.stringify(data?.diff?.live_only)}`,
);
{
  const entry = (data?.diff?.same_id ?? []).find((s) => s.id === SAME);
  const desc = (entry?.attrs ?? []).find((x) => x.key === 'description');
  chk(
    !!desc && desc.design !== desc.live,
    '旁证-同名属性差：已实现的那对（**同 id**）仍被判为**属性差**（`description` 两侧原值不同，语义未变）',
    desc ? `设计=${JSON.stringify(desc.design)} · live=${JSON.stringify(desc.live)}` : '★★ 没报出 description 差',
  );
}

console.log('\n════ 4. ③ ★★ 重建不许动它：rebuild_design=true 前后逐字节相同 + 条目仍在（且经工具层复读仍在）════');
await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir, rebuild_design: true });
const rawAfter = fs.readFileSync(dsFile, 'utf-8');
chk(
  rawAfter === rawBefore,
  '③ ★★ `rebuild_design=true` 前后，`design/<feature>.dsl.json` **逐字节相同**（重建不碰它）',
  `before ${rawBefore.length} 字节 / after ${rawAfter.length} 字节`,
);
{
  const after = getDesignSheet(FEAT);
  chk(
    designSheetPendingRefs(after).includes(PENDING_PATH) && !(after?.geometry?.nodes ?? []).some((n) => n.description === PENDING_PATH),
    '③ ★★ 那条**无 id** 的条目**重建之后仍在**设计图里（★ 仍住 `meta.goals`、仍不在 `nodes[]`）—— 不许退化："挪建筑"的判据',
    `重建后 meta.goals 指代 = ${JSON.stringify(designSheetPendingRefs(after))} · nodes[] = ${JSON.stringify((after?.geometry?.nodes ?? []).map((n) => n.id))}`,
  );
  chk(JSON.stringify(after?.meta?.goals) === goalsBeforeRaw, '③-c 重建前后 `meta.goals` **原样**（含带 id 的既有条目）', `goals=${JSON.stringify(after?.meta?.goals)}`);
}
{
  const res2 = await diffDesignSheetHandler({ feature: FEAT });
  const d2 = parseDataBlock(res2.text);
  chk(
    (d2?.diff?.design_only ?? []).includes(PENDING_PATH),
    '③-b ★ 重建**之后**经工具层复读：那条仍在 `只在设计里(要实现)`',
    `design_only=${JSON.stringify(d2?.diff?.design_only)}`,
  );
}

console.log('\n════ 5. ⑤ 自证：确实走的是**工具层入口**（不是直调 domain 纯函数）════');
{
  const bad = await diffDesignSheetHandler({});
  dump('缺 feature 的回执原文', bad.text);
  chk(
    bad.isError === true && /缺参数 "feature"/.test(bad.text),
    '⑤ 缺 `feature` ⇒ 由 `requireStr` **当场报错**（`domain/design_sheet.ts` 的纯函数没有这道守卫）',
    bad.isError ? bad.text.split('\n')[0] : '★★ 没报错',
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp339 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
