#!/usr/bin/env node
/**
 * ★★★ cert T337 —— **「给设计那一侧一份独立的住处」的出生证**（2026-10-15）。
 *
 * ## 用户逐字（这张证要钉住的那件事）
 *   *"机器只能算出它的那些 DSL，我的意思是让你**手写一份和机器算出来的东西同一性质的东西**，
 *     只不过那个是机器算出来的，而你是对于项目的一个设计。"*
 *   ⇒ **两份同性质 DSL**（`live/<f>.dsl.json` 扫描 ⊕ `design/<f>.dsl.json` 手写）、**直接对拍**。
 *
 * ## 病（本证要证伪的旧路径）
 *   旧的设计侧 = `mergeDesignLayer(扫描 ⊕ overlay)` ⇒ **寄生在扫描上**；overlay 锚点**按扫描 id 对齐**
 *   ⇒ **只能改扫描认得出的对象、声明不了新结构**。⇒ 往设计里加一个现状不存在的节点，**一重建就没了**。
 *   本证的 ① 把这条**旧路径**（同一个节点放进【现设计视图】）与**新住处**（
 *
 *   `design/<f>.dsl.json`）**在同一流程里对读** —— 一边丢、一边在。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ **手写设计图里有一个扫描里根本不存在的节点** ⇒ `import_project rebuild_design=true` **之后它仍在**
 *      （同一次流程里给出对照：同一个节点放进【现设计视图】⇒ 被 `allow_design_drop` 闸拦 / 显式允许后**被抹掉**）。
 *   ② 那个节点在对拍里被正确判为 **`只在设计里(要实现)`**。
 *   ③ 造一个 **`只在 live 里`** 的节点 ⇒ 判为 **`未纳入设计`**。
 *   ④ 造一个 **`两边都有但属性不同`** 的节点 ⇒ 报差异（贴两侧原值）。
 *   ⑤ ★ **走工具层**：②③④ 经 `diffDesignSheetHandler`（design 线的**工具入参适配层** `handlers.ts`），
 *      **不是**直调 `domain/design_sheet.ts` 的纯函数；并自证在工具层（缺 `feature` ⇒ 由 `requireStr` 当场报错，
 *      而纯函数没有这道守卫；回执带 `---DATA---` 机器段）。
 *
 * ## ★★ 诚实清单（[未核] —— 不许把推测写成实测）
 *   · ★★ **MCP 可达性 [未核]**：本入口**没有**注册进 `TOOL_DEFS`（即 LLM 暂时调不到它）。
 *     原因（实测）：`t326` 的工具面**零余量** —— 基线 158261 字符 / 69 工具，当前读数**逐字相同**（差 0）；
 *     新增一个工具 ⇒ `t326` ①② 必红。本笔**刻意不 --update 基线**（那是"有意识的动作"，归开发者）。
 *   · **传输 / MCP schema 层 [未核]**：本证**直接 import handler**，没经 MCP server 的 `tools/list` JSON Schema。
 *   · **daemon 转发分支 [未核]**：本证不起 daemon。
 *   · **schema 一致性**只证到「手写过同一把 `validateDSL`」（⑥）；**没**逐字段比对两份 JSON 的键集。
 *   · ★ **真 feature 只读**：本证全程在夹具 feature（`t337`）与临时项目根里做，**不碰** run82 / self-2026-10-15。
 *
 * ## 用法
 *   node certs/t337-design-sheet-cert.mjs
 * ★ 夹具住 `certs/.work/tmp337`；`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓的 `.agent-io/`**。
 * ★ 本证**只读** `dist/`：改了 `src/` 请先 `npm run build`。
 * ★★ 全证**只 1 次删除操作**（末尾清理；本仓"宿主删除闸"按**一个回合内的删除【操作】数**累计，
 *   阈值 50，见 `t328`/`t316` 头注释）—— 故清理那处 **catch 住并响亮报告**：**被闸拦下 ≠ 本证判红**，但不许静默。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp337');
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

const { saveDSL, getDSL, getLiveFeature, saveDesignSheet, getDesignSheet, getDesignSheetFile, getDesignDir } = await import(
  '../dist/src/infrastructure/storage.js'
);
const { diffDesignSheetHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const { validateDSL } = await import('../dist/src/domain/validator.js');

const FEAT = 't337';
/** ★ 扫描里**根本不存在**的节点（"挪建筑"要实现的那些东西） */
const PENDING = 'node_pending_x';

console.log('════ 0. 夹具：一个两文件的项目 → 首次 import_project（扫描出"实际"并 fork 设计）════');
const projDir = path.join(TMP, 'proj');
fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
fs.writeFileSync(path.join(projDir, 'src', 'a.ts'), 'export function alpha(){ return 1; }\n');
fs.writeFileSync(path.join(projDir, 'src', 'b.ts'), "import { alpha } from './a';\nexport const beta = alpha();\n");
await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir });

const live = getLiveFeature(FEAT);
if (!live) throw new Error('夹具异常：live 快照没生成');
const liveFileIds = live.geometry.nodes.filter((n) => n.type === 'file').map((n) => n.id);
dump('live 节点 id（扫描产物）', live.geometry.nodes.map((n) => `${n.id} [${n.type}]`).join('\n'));
chk(liveFileIds.length >= 2, '0 夹具就位：live 里有 ≥2 个文件节点（够造"同名"与"只在 live 里"各一个）', liveFileIds.join(', '));

const SAME = liveFileIds[0]; // 两边都有 ⇒ 比属性
const LIVE_ONLY = liveFileIds[1]; // 设计**故意不写它** ⇒ 只在 live 里
const liveSameNode = live.geometry.nodes.find((n) => n.id === SAME);
dump(`live 侧 ${SAME} 的原值`, JSON.stringify({ id: liveSameNode.id, label: liveSameNode.label, title: liveSameNode.title, description: liveSameNode.description, type: liveSameNode.type }, null, 2));

console.log('\n════ 1. 手写一份 design/<f>.dsl.json（★ 与 live 同 schema；含一个扫描里没有的节点）════');
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
    nodes: [
      // ① 两边都有（同 id）—— 但 `description` 与扫描**故意不同** ⇒ 判据 ④
      { id: SAME, type: 'file', label: '手写：a', title: '手写标题 A', description: '手写设计：A 的职责（与扫描给的不一样）' },
      // ② ★ 扫描里根本没有 ⇒ 判据 ①②（"要实现"）
      { id: PENDING, type: 'module', label: '待建模块 X', title: '尚未存在的模块', description: '扫描结果里根本没有这个节点' },
    ],
    edges: [],
  },
  semantic: { files: [{ id: SAME, path: 'src/a.ts', responsibility: '手写设计：A 的职责（与扫描给的不一样）' }] },
};
const dsFile = saveDesignSheet(designSheet);
const rawBefore = fs.readFileSync(dsFile, 'utf-8');
chk(
  dsFile === getDesignSheetFile(FEAT) && dsFile === path.join(getDesignDir(), `${FEAT}.dsl.json`),
  '1 住处落定：`design/<feature>.dsl.json`（与 live/ baseline/ 同族，同 baseDir 规则）',
  `getDesignSheetFile → ${dsFile}`,
);
chk(
  getDesignSheet(FEAT)?.geometry.nodes.some((n) => n.id === PENDING) && getDesignSheet(FEAT)?._sync?.source === 'design_sheet',
  '1-b 回读得到（且与 saveLiveFeature 同形：同 spec 的 `_sync` 标记）',
  `nodes=${(getDesignSheet(FEAT)?.geometry.nodes ?? []).map((n) => n.id).join(',')} · _sync.source=${getDesignSheet(FEAT)?._sync?.source}`,
);
{
  const v = validateDSL(getDesignSheet(FEAT));
  chk(v.valid === true, '1-c ★ 「同 schema」取证：手写那份过**同一把** `validateDSL`（与扫描产物同一校验器）', v.valid ? 'valid' : JSON.stringify(v.errors));
}

console.log('\n════ 2. ① ★★ 重建不许动它：rebuild_design=true 前后逐字节相同，且"扫描里没有的"节点仍在 ════');
// ── 对照：把**同一个** PENDING 节点也放进【现设计视图】（旧路径：设计寄生在扫描上）──
{
  const base = getDSL(FEAT);
  base.geometry.nodes.push({ id: PENDING, type: 'module', label: '待建模块 X' });
  saveDSL(base);
  let gateErr = null;
  try {
    await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir, rebuild_design: true });
  } catch (e) {
    gateErr = e;
  }
  dump('旧路径 · 重建被闸拦下的原文（首行）', String(gateErr?.message ?? '（★ 没抛 —— 闸没拦住）').split('\n').slice(0, 4).join('\n'));
  chk(
    gateErr !== null && /拒绝重建设计 DSL/.test(String(gateErr.message)) && /allow_design_drop/.test(String(gateErr.message)),
    '2-a 对照（旧路径仍在病）：同一节点放进【现设计视图】⇒ 重建被 `allow_design_drop` 闸**拦下**',
    gateErr ? String(gateErr.message).split('\n')[0] : '★★ 没被拦（与"已实测的根因"不符，需复核）',
  );
  await importProject({ project_dir: projDir, feature: FEAT, source_root: projDir, rebuild_design: true, allow_design_drop: true });
  const afterBase = getDSL(FEAT);
  chk(
    !afterBase.geometry.nodes.some((n) => n.id === PENDING),
    '2-b 对照：显式 `allow_design_drop=true` 后重建成功，而【现设计视图】里那个节点**没了**（这就是必须给设计另立住处的原因）',
    `现设计视图节点=${afterBase.geometry.nodes.map((n) => n.id).join(',')}`,
  );
}
// ── 正题：独立文件**不受重建影响** ──
{
  const rawAfter = fs.readFileSync(dsFile, 'utf-8');
  chk(rawAfter === rawBefore, '① ★★ `rebuild_design=true` 前后，`design/<feature>.dsl.json` **逐字节相同**（重建不碰它）',
    `before ${rawBefore.length} 字节 / after ${rawAfter.length} 字节`);
  const afterSheet = getDesignSheet(FEAT);
  chk(
    afterSheet?.geometry.nodes.some((n) => n.id === PENDING),
    `① ★★ 那个"扫描里根本不存在"的节点（${PENDING}）**重建之后仍在**设计图里`,
    `重建后设计图节点=${(afterSheet?.geometry.nodes ?? []).map((n) => n.id).join(',')}`,
  );
}

console.log('\n════ 3. ②③④ 经**工具层**（`diffDesignSheetHandler`）读三类差异 ════');
const res = await diffDesignSheetHandler({ feature: FEAT });
dump('工具回执原文（diffDesignSheetHandler · design 线的工具入参适配层）', res.text);
const data = parseDataBlock(res.text);
chk(
  res.isError !== true && data && data.diff,
  '3 前置：经工具层拿到**结构化**三类差异（回执带 `---DATA---` 机器段）',
  res.isError ? `★ isError：${res.text.split('\n')[0]}` : `design_only=${JSON.stringify(data?.diff?.design_only)} live_only=${JSON.stringify(data?.diff?.live_only)}`,
);
// ② 只在设计里（要实现）
chk(
  Array.isArray(data?.diff?.design_only) && data.diff.design_only.includes(PENDING) && /要实现/.test(String(res.text)),
  '② ★ 那个节点被判为 **`只在设计里(要实现)`**',
  `design_only=${JSON.stringify(data?.diff?.design_only)}`,
);
// ③ 只在 live 里（未纳入设计）
chk(
  Array.isArray(data?.diff?.live_only) && data.diff.live_only.includes(LIVE_ONLY) && /未纳入设计/.test(String(res.text)),
  '③ ★ 故意不写进设计图的那个节点被判为 **`未纳入设计`**',
  `live_only=${JSON.stringify(data?.diff?.live_only)}`,
);
// ④ 同名属性差
{
  const entry = (data?.diff?.same_id ?? []).find((s) => s.id === SAME);
  const desc = (entry?.attrs ?? []).find((x) => x.key === 'description');
  dump(`④ ${SAME} 的同名属性差（逐字段两侧原值）`, JSON.stringify(entry, null, 2));
  chk(
    !!desc && desc.design !== desc.live,
    '④ ★ 两边都有但属性不同的节点 ⇒ 被报成**同名属性差**（`description` 两侧原值不同）',
    desc ? `设计=${JSON.stringify(desc.design)} · live=${JSON.stringify(desc.live)}` : '★★ 没报出 description 差',
  );
}
// 第三份读数（现设计视图）：只作上下文
chk(
  data?.current_design_view?.exists === true && Array.isArray(data.current_design_view.design_only_already_in_current) &&
    data.current_design_view.design_only_already_in_current.length === 0,
  '3-b 第三份（现设计视图）确实被读了：重建后它已**不含**该节点 ⇒ `design_only_already_in_current=[]`（上下文，不参与配对）',
  `current_design_view=${JSON.stringify(data?.current_design_view)}`,
);

console.log('\n════ 4. ⑤ 自证：确实走的是**工具层入口**（不是直调 domain 纯函数）════');
{
  const bad = await diffDesignSheetHandler({});
  dump('缺 feature 的回执原文', bad.text);
  chk(
    bad.isError === true && /缺参数 "feature"/.test(bad.text),
    '⑤ 缺 `feature` ⇒ 由 `requireStr` **当场报错**（`domain/design_sheet.ts` 的纯函数没有这道守卫 ⇒ 这一条只可能在工具层入口上发生）',
    bad.isError ? bad.text.split('\n')[0] : '★★ 没报错',
  );
}

// ★★ 清理：**全证只此 1 次删除操作**（宿主删除闸按删除【操作】数累计，见头注释）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主的删除闸，不是本证的判据：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp337 即可（它是 gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
