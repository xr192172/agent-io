#!/usr/bin/env node
/**
 * ★★★ cert T344 —— **第四类判定「已认亲」的出生证**（2026-10-16）。
 *
 * ## 用户逐字（本证要钉住的那件事 —— 本笔存在的全部理由）
 *   *"对拍的话，不应该是发现有一模一样的节点，然后一边是已实现一边是未实现，就是说一边有 ID 一边没 ID，
 *     就自动把这个一模一样的节点赋予实际的 ID 吗？… 其他的节点的位置都定好了、功能名字都定好了、ID 也定好了，
 *     **只有这几个点的 ID 没定好，但它们的形状是一模一样的，能不能拍出来？然后赋予同一个 ID**"*
 *
 * ## 病（本证要证伪的旧路径："要实现"永远不会自己收口）
 *   `src/domain/design_sheet.ts` 旧口径**只看 id**：设计侧**无 id** 的条目（住 `meta.goals`）指代是"名字/路径"，
 *   **永远 ≠ live 的 id** ⇒ 那条**永远被判成 `只在设计里(要实现)`** —— 东西做好了它还挂着。
 *
 * ## ★★ 第 0 步（先找既有解法，不新造）—— 同类问题 = "**怎么把两个『同一个东西』认出来（认亲）**"
 *   仓里 ≥2 处既有解法：
 *   · ★ ① `src/domain/overlay.ts:439` `const byPathHit = a.path ? byPath.get(a.path) : undefined;`
 *     —— **按 path 认亲**（对账锚点用稳定路径当身份）；
 *   · ★ ② `src/domain/overlay.ts:442-444` `} else if (a.signature) { … target = bySig.get(a.signature)?.[0]; }`
 *     —— 路径认不到时**换键**（按接口签名认亲，改名检测）；
 *   · ③ `src/domain/overlay.ts:447-451` 认不到 ⇒ `anchors[oldKey] = { ...a, orphaned: true }`（**不静默丢**）；
 *   · ④ `src/domain/overlay.ts:331/333` 字段定义 `orphaned?: boolean` / `_migratedFrom?: string`，
 *     `:462` 命中后记 `na._migratedFrom = oldKey`（**认到了就带上新身份**）。
 *   ⇒ ★ 本笔**照它的口径办**：**键** = 路径优先、认不到再换键（`path` → `name`）；**认不到怎么办** = 不冒充命中
 *     （overlay 标 `orphaned`，本笔**仍留在 `design_only`**）。live 侧"路径"用**同一把** `overlay.nodePath`
 *     （`domain/overlay.ts:365-370`）算，保证两边同口径。
 *
 * ## ★★ 第四类的形状（开发者已拍 —— 本证只读它的行为，不改它）
 *   · **判据**：设计侧**无 id** 的条目 按"路径 ↔ live 节点的 `nodePath`"认亲（★ 名字兜底：`title` ↔ `label`/`title`）；
 *   · **命中 ⇒ 判为第四类**（`resolved`，带**认到的 live 节点 id**）、**不再计入 `design_only`**；
 *   · **没命中 ⇒ 仍判 `design_only`**（**不许**把认不出的一律当已实现）；
 *   · ★ 不许改 `same_id`/`design_only`/`live_only` 的判定口径、不许改 `validateDSL`、不许改 schema。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ **核心**：设计侧一条"无 id、路径指向一个 live 里已存在节点"的 goal ⇒ 判为第四类 `resolved`、
 *      输出里带那个 live `id`，且**不在 `design_only` 里**；★ 并给**名字兜底**的旁证（只给名字也能认上）；
 *   ② ★ **对照 A**：同一条目**路径改成 live 里不存在的** ⇒ **仍判 `design_only`**（贴输出）；
 *   ③ ★ **对照 B（旧行为）**：按**旧口径**（设计侧指代 ∉ live id 集 ⇒ design_only）复算，①那条**落在 design_only** ——
 *      证明"永远不收口"是真病（★ 等价复算，非另一份旧码，见诚实清单）；
 *   ④ ★★ 重建不许退化：`rebuild_design=true` 前后 `design/<f>.dsl.json` **逐字节相同**、条目仍在（T337/T338/T339 的判据）；
 *   ⑤ ★ **走工具层**（`diffDesignSheetHandler`）：①②的读数都取自它的回执；并自证在工具层（缺 `feature` ⇒ `requireStr` 当场报错）。
 *   ★ 旁证：`same_id`（同名属性差）与 `live_only`（未纳入设计）**语义未变**。
 *
 * ## ★★ 诚实清单（[未核] —— 不许把推测写成实测；不许声称"没有行为改变"）
 *   · ★ **③ 是"等价复算"**：本证**没有**第二份旧代码可跑 —— 旧口径 = `设计侧指代 ∉ live id 集 ⇒ design_only`
 *     （= 旧源码 `design_only = [...designRefs].filter(ref => !lById.has(ref))`）。本证用**导出的** `designSheetRef`
 *     + `designSheetPendingRefs` 复刻 `designRefs` 后照旧式过滤 ⇒ 是**同一判据的复算**，**不是**另一份编译产物。
 *     ★ **未**跑 git 历史里的旧 `design_sheet.js`（旧源码需另编译，本证不做）。
 *   · ★★ **观察（待开发者拍，不是本证判红）**：一条 live 节点被第四类**认亲**后，它的 `id` **仍会**出现在
 *     `live_only`（未纳入设计）—— 因为 `live_only` 按 `designRefs` 复算、而认亲**不**把 id 塞进 `designRefs`
 *     （照"不许改已有三类的语义"办）。本证判据 ⑤-b 把这处读数**如实贴出**，请开发者裁定是否该同步。
 *   · ★ **名字兜底有歧义**（实测真仓 `live/run82.dsl.json`，243 节点）：`path` 重复 **0** 处（**可靠**）、
 *     `title` 重复 0 处、但 `label` 重复 **3** 处（`index.ts · 0 APIs` ×4 / `handlers.ts · 0 APIs` ×2 /
 *     `📁 instrument` ×2）⇒ 换键到 `label` 时可能撞。本笔取**首个命中**（`Map` 先到先得），
 *     ⇒ 名字兜底**弱于**路径。★ 真仓读数见本证判据 ⑤-c。
 *   · **MCP 可达性 [未核]**：`diff_design_sheet` 未注册进 `TOOL_DEFS`（`t326` 工具面零余量）⇒ LLM 暂时调不到它。
 *   · **传输 / MCP schema 层 [未核]**：直接 import handler，没经 MCP server 的 `tools/list`。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · ★ **真 feature 只读**：本证全程在夹具 feature（`t344`）里做，**不碰**真仓的 `.agent-io/`（真仓 live 只读，见 ⑤-c）。
 *
 * ## 用法
 *   node certs/t344-design-sheet-resolved-cert.mjs     # ★ 先 npm run build（本证只读 dist/）
 * ★ 夹具住 `certs/.work/tmp344`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓的 `.agent-io/`**。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按删除【操作】数累计，阈值 50）——
 *   故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp344');
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
const { diffDesignSheet, designSheetRef, designSheetPendingRefs } = await import('../dist/src/domain/design_sheet.js');
const { nodePath } = await import('../dist/src/domain/overlay.js');

const FEAT = 't344';

console.log('════ 0. 夹具：两文件项目 → import_project（扫描出"实际"）════');
const projDir = path.join(TMP, 'proj');
fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(projDir, 'src', 'a.ts'), 'export function alpha(){ return 1; }\n');
fs.writeFileSync(path.join(projDir, 'src', 'b.ts'), "import { alpha } from './a';\nexport const beta = alpha();\n");
await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir });

const live = getLiveFeature(FEAT);
if (!live) throw new Error('夹具异常：live 快照没生成');
const liveNodes = live.geometry.nodes;
const byPath = new Map(liveNodes.map((n) => [nodePath(n), n]));
const aNode = byPath.get('src/a.ts');
const bNode = byPath.get('src/b.ts');
if (!aNode || !bNode) throw new Error(`夹具异常：live 里没有 src/a.ts 或 src/b.ts（实际路径=${JSON.stringify([...byPath.keys()])}）`);
const ID_A = aNode.id; // ★ 认亲的**目标**（live 里已实现 ⇒ 有 id）
const PATH_A = nodePath(aNode); // = 'src/a.ts'
const ID_B = bNode.id; // 只用来造"同名属性差"（旁证）
const PATH_B = nodePath(bNode);
dump('live 文件节点（id / nodePath / label / title）', [aNode, bNode].map((n) => `${n.id} | ${nodePath(n)} | ${n.label ?? ''} | ${n.title ?? ''}`).join('\n'));
chk(
  ID_A !== ID_B && PATH_A === 'src/a.ts' && PATH_B === 'src/b.ts',
  '0 夹具就位：live 里有 src/a.ts 与 src/b.ts（有 id、有 nodePath）',
  `a=${ID_A} (${PATH_A}) · b=${ID_B} (${PATH_B})`,
);

// ★ 名字兜底的**唯一**目标：一个 label/title 在 live 里**只出现一次**、且不是 a/b 的节点（避免撞键）
const nameCount = new Map();
for (const n of liveNodes) for (const v of [n.label, n.title]) { const t = typeof v === 'string' ? v.trim() : ''; if (t) nameCount.set(t, (nameCount.get(t) ?? 0) + 1); }
let nameTarget = null;
for (const n of liveNodes) {
  if (n.id === ID_A || n.id === ID_B) continue;
  for (const v of [n.title, n.label]) {
    const t = typeof v === 'string' ? v.trim() : '';
    if (t && nameCount.get(t) === 1) { nameTarget = { key: t, id: n.id, via: v === n.title ? 'title' : 'label' }; break; }
  }
  if (nameTarget) break;
}

console.log('\n════ 1. 手写 design/<f>.dsl.json：一条**无 id** 的 goal，其**路径**指向 live 里已存在的 src/a.ts ════');
const goals = [
  // ★ ①/③ 认亲**目标**：无 id、description = live 里已存在的路径（名字故意不可命中 ⇒ 逼出"路径优先"）
  { title: '★名字故意不可命中的模块', description: PATH_A, status: 'active' },
  // ★ ①-c 名字兜底：无 id、无 description、只给一个 live 里**唯一**的名字
  ...(nameTarget ? [{ title: nameTarget.key, status: 'active' }] : []),
  // ★ 旁证（T339 判据④）：带 id 的既有 goal **不被误伤**
  { id: 'goal_existing', title: '既有目标（带 id）', status: 'active' },
];
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
    // ★ `nodes[]` 只装**已实现**的结构（每条都有扫描给的 id）—— 用 b 造"同名属性差"（旁证）
    nodes: [{ id: ID_B, type: 'file', label: '手写：b', title: '手写标题 B', description: '手写设计：B 的职责（与扫描给的不一样）' }],
    edges: [],
  },
  meta: { goals },
  semantic: { files: [{ id: ID_B, path: PATH_B, responsibility: '手写设计：B 的职责（与扫描给的不一样）' }] },
};
const dsFile = saveDesignSheet(designSheet);
const rawBefore = fs.readFileSync(dsFile, 'utf-8');
const rawObj = JSON.parse(rawBefore);
chk(
  dsFile === getDesignSheetFile(FEAT) && dsFile === path.join(getDesignDir(), `${FEAT}.dsl.json`),
  '1 住处落定：`design/<feature>.dsl.json`',
  `getDesignSheetFile → ${dsFile}`,
);
{
  const g = (rawObj.meta?.goals ?? []).find((x) => x.description === PATH_A);
  dump('1-b 落盘原文 · 那条**无 id** 的 goal（整个对象）', JSON.stringify(g, null, 2));
  chk(
    !!g && !('id' in g) && designSheetPendingRefs(rawObj).includes(PATH_A),
    '1-b ★★ 落盘原文：它是**无 id** 的条目（`designSheetPendingRefs` 的指代 = 路径）',
    `键 = [${Object.keys(g ?? {}).join(', ')}] · designSheetPendingRefs = ${JSON.stringify(designSheetPendingRefs(rawObj))}`,
  );
}

console.log('\n════ 2. ① ★★ 核心：经**工具层**读四类差异 ⇒ 那条被判为「已认亲」、带 live id、且不在 design_only ════');
const res = await diffDesignSheetHandler({ feature: FEAT });
dump('工具回执原文（diffDesignSheetHandler）', res.text);
const data = parseDataBlock(res.text);
const d = data?.diff;
chk(res.isError !== true && d && Array.isArray(d.resolved), '2 前置：经工具层拿到**结构化**四类差异（回执带 `---DATA---` 机器段）', res.isError ? `★ isError：${res.text.split('\n')[0]}` : `resolved=${JSON.stringify(d?.resolved)}`);
{
  const hit = (d?.resolved ?? []).find((r) => r.ref === PATH_A);
  dump('① 第四类条目（判据目标那条）', JSON.stringify(hit, null, 2));
  chk(
    !!hit && hit.id === ID_A && hit.matched_by === 'path',
    '① ★★ 无 id 的 goal（路径 = 已存在的 src/a.ts）**被判为第四类 `resolved`**，**带出 live 的 id**、按**路径**认亲',
    hit ? `ref=${hit.ref} ⇒ id=${hit.id}（期望 ${ID_A}）· matched_by=${hit.matched_by}` : '★★ 没认上（resolved 里没有它以路径为 ref 的条目）',
  );
  chk(
    !(d?.design_only ?? []).includes(PATH_A),
    '① ★★ 同一条**不再计入 `design_only`**（"要实现"自己收口：东西做好了它就不再挂着）',
    `design_only=${JSON.stringify(d?.design_only)}`,
  );
  chk(
    new RegExp(`live id = ${ID_A}`).test(String(res.text)) && /赋予同一个 ID/.test(String(res.text)),
    '① ★★ 输出（人读段）里**能看到那个 live id**（用户原话"赋予同一个 ID"）',
    `回执含「live id = ${ID_A}」= ${new RegExp(`live id = ${ID_A}`).test(String(res.text))}`,
  );
}
// ①-c ★ 名字兜底（只给名字、无路径 ⇒ 逼出换键）
if (nameTarget) {
  const hit = (d?.resolved ?? []).find((r) => r.ref === nameTarget.key);
  chk(
    !!hit && hit.id === nameTarget.id && hit.matched_by === 'name',
    `①-c ★ 名字兜底：无 id、**无路径**、只有名字「${nameTarget.key}」⇒ 仍按**名字**认上（` +
      `键序 = 路径认不到再换键，对齐 overlay.ts:439→442-444）`,
    hit ? `ref=${hit.ref} ⇒ id=${hit.id}（期望 ${nameTarget.id}）· matched_by=${hit.matched_by}` : `★★ 没认上（名字目标 key=${nameTarget.key}）`,
  );
} else {
  console.log('   ⚠ ①-c [未核]：夹具里找不到"名字在 live 里唯一"的目标节点 ⇒ 跳过（不造假读数）');
}

console.log('\n════ 3. ② 对照 A：同一条目**路径改成 live 里不存在的** ⇒ 仍判 `design_only`（不冒充命中）════');
{
  const variant = {
    ...rawObj,
    meta: {
      goals: rawObj.meta.goals.map((g) => (g.description === PATH_A ? { ...g, description: 'src/planned/ghost.ts' } : g)),
    },
  };
  saveDesignSheet(variant);
  const res2 = await diffDesignSheetHandler({ feature: FEAT });
  const d2 = parseDataBlock(res2.text)?.diff;
  dump('② 回执原文（路径改成 src/planned/ghost.ts 之后）', res2.text);
  chk(
    (d2?.design_only ?? []).includes('src/planned/ghost.ts') && !(d2?.resolved ?? []).some((r) => r.ref === 'src/planned/ghost.ts'),
    '② ★ 路径换成 live 里**不存在**的 ⇒ **仍判 `design_only`**（不冒充命中；"不许把认不出的一律当已实现"）',
    `design_only=${JSON.stringify(d2?.design_only)} · resolved=${JSON.stringify(d2?.resolved)}`,
  );
  // ★ 复原：**直写原始字节**（`saveDesignSheet` 每次会重写 `_sync.saved_at` ⇒ 非确定，不能用来"还原"）
  fs.writeFileSync(dsFile, rawBefore, 'utf-8');
  chk(fs.readFileSync(dsFile, 'utf-8') === rawBefore, '②-b 复原：设计文件已逐字节还原为原始那份', `${fs.readFileSync(dsFile, 'utf-8').length} 字节`);
}

console.log('\n════ 4. ③ 对照 B（旧行为·等价复算）：旧口径只看 id ⇒ ①那条**落在 design_only** ════');
{
  const liveIds = new Set(liveNodes.map((n) => n.id));
  // ★ 旧口径复刻：designRefs = 设计侧指代（nodes[] ∩ meta.goals）；design_only = designRefs \ liveIds
  const designRefsOld = new Set([...rawObj.geometry.nodes.map(designSheetRef), ...designSheetPendingRefs(rawObj)]);
  const legacyDesignOnly = [...designRefsOld].filter((r) => !liveIds.has(r)).sort();
  const newD = diffDesignSheet(JSON.parse(rawBefore), live);
  dump(
    '③ 旧口径 vs 新口径（同一条目：路径 = src/a.ts）',
    `旧 design_only 含它 = ${legacyDesignOnly.includes(PATH_A)}\n` +
      `新 design_only 含它 = ${newD.design_only.includes(PATH_A)}\n` +
      `旧 design_only（全）= ${JSON.stringify(legacyDesignOnly)}\n` +
      `新 design_only（全）= ${JSON.stringify(newD.design_only)}\n` +
      `新 resolved = ${JSON.stringify(newD.resolved)}`,
  );
  chk(
    legacyDesignOnly.includes(PATH_A) && !newD.design_only.includes(PATH_A),
    '③ ★★ **旧行为下它被判成 `design_only`**（"要实现"永远不会自己收口），**接上第四类后**它从 `design_only` 收口到 `resolved`',
    `旧含=${legacyDesignOnly.includes(PATH_A)} ⇒ 新含=${newD.design_only.includes(PATH_A)}`,
  );
}

console.log('\n════ 5. ⑤ 走工具层 · 旁证（语义未变）· 认亲键歧义实测 ════');
{
  const bad = await diffDesignSheetHandler({});
  dump('⑤ 缺 feature 的回执原文', bad.text);
  chk(
    bad.isError === true && /缺参数 "feature"/.test(bad.text),
    '⑤ ★ 自证走**工具层入口**：缺 `feature` ⇒ 由 `requireStr` **当场报错**（`domain/design_sheet.ts` 的纯函数没有这道守卫）',
    bad.isError ? bad.text.split('\n')[0] : '★★ 没报错',
  );
}
{
  const res3 = await diffDesignSheetHandler({ feature: FEAT });
  const d3 = parseDataBlock(res3.text)?.diff;
  const entry = (d3?.same_id ?? []).find((s) => s.id === ID_B);
  const desc = (entry?.attrs ?? []).find((x) => x.key === 'description');
  chk(
    !!desc && desc.design !== desc.live,
    '旁证-a ★ `same_id`（同名属性差）**语义未变**：已实现那对（同 id）仍报 `description` 差',
    desc ? `设计=${JSON.stringify(desc.design)} · live=${JSON.stringify(desc.live)}` : '★★ 没报出 description 差',
  );
  // ★ 观察（待开发者拍）：被认亲的 live id 仍会出现在 live_only
  const claimedIdInLiveOnly = (d3?.live_only ?? []).includes(ID_A);
  dump(
    '⑤-b ★ 观察（不是判红）：被第四类认亲的那条 live id 是否仍出现在 `live_only`',
    `live_only（全）= ${JSON.stringify(d3?.live_only)}\n` +
      `被认亲的 ${ID_A} 仍在 live_only？= ${claimedIdInLiveOnly}\n` +
      `⇒ 照"不许改已有三类语义"办，认亲**不**把 id 塞进 designRefs ⇒ 它**仍会**列在"未纳入设计"。请开发者裁定是否该同步。`,
  );
  chk(
    Array.isArray(d3?.live_only) && d3.live_only.includes(ID_B) === false,
    '旁证-b ★ `live_only`（未纳入设计）**语义未变**：设计 nodes[] 里已按 id 写了 b ⇒ b **不在** live_only（criterion 照旧：按 designRefs 复算）',
    `live_only=${JSON.stringify(d3?.live_only)}`,
  );
}
{
  // ★ 认亲键歧义：真仓 live **只读**实测（不碰真仓数据）
  const realLive = path.resolve(HERE, '../.agent-io/live/run82.dsl.json');
  if (fs.existsSync(realLive)) {
    const rn = JSON.parse(fs.readFileSync(realLive, 'utf-8')).geometry.nodes ?? [];
    const cnt = (arr) => { const m = new Map(); for (const x of arr) { if (!x) continue; m.set(x, (m.get(x) ?? 0) + 1); } return [...m.entries()].filter(([, c]) => c > 1); };
    const dupPath = cnt(rn.map((n) => nodePath(n)));
    const dupLabel = cnt(rn.map((n) => n.label));
    const dupTitle = cnt(rn.map((n) => n.title));
    dump(
      '⑤-c ★ 认亲键的歧义（真仓 live/run82.dsl.json，**只读**）',
      `节点=${rn.length} · 路径位重复=${dupPath.length} 处（**可靠**） · title 重复=${dupTitle.length} 处 · label 重复=${dupLabel.length} 处 ${JSON.stringify(dupLabel.slice(0, 3))}`,
    );
    chk(dupPath.length === 0, '⑤-c ★ 真仓 live 上**路径键无重复** ⇒ 路径认亲**可靠**（名字兜底另见诚实清单：label 有 3 处撞）', `路径重复=${dupPath.length} · label 重复=${dupLabel.length}`);
  } else {
    console.log(`   ⚠ ⑤-c [未核]：真仓 ${realLive} 不存在 ⇒ 跳过歧义实测（不造假读数）`);
  }
}

console.log('\n════ 6. ④ ★★ 重建不许动它：rebuild_design=true 前后逐字节相同 + 那条无 id 条目仍在 ════');
await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir, rebuild_design: true });
const rawAfter = fs.readFileSync(dsFile, 'utf-8');
chk(
  rawAfter === rawBefore,
  '④ ★★ `rebuild_design=true` 前后，`design/<feature>.dsl.json` **逐字节相同**（重建不碰它；T337/T338/T339 的判据不许退化）',
  `before ${rawBefore.length} 字节 / after ${rawAfter.length} 字节`,
);
{
  const after = getDesignSheet(FEAT);
  const g = (after?.meta?.goals ?? []).find((x) => x.description === PATH_A);
  chk(
    !!g && !('id' in g) && designSheetPendingRefs(after).includes(PATH_A),
    '④ ★★ 那条**无 id** 的条目**重建之后仍在**设计图里（住 `meta.goals`，★ 仍无 `id`）—— 不许退化',
    `重建后 meta.goals 指代 = ${JSON.stringify(designSheetPendingRefs(after))}`,
  );
}
{
  const res4 = await diffDesignSheetHandler({ feature: FEAT });
  const d4 = parseDataBlock(res4.text)?.diff;
  chk(
    (d4?.resolved ?? []).some((r) => r.ref === PATH_A && r.id === ID_A),
    '④-b ★ 重建**之后**经工具层复读：那条**仍被判为第四类**、仍带同一个 live id',
    `resolved=${JSON.stringify(d4?.resolved)}`,
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp344 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
