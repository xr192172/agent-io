#!/usr/bin/env node
/**
 * ★★★ cert T338 —— **「未实现的对象用『名字/路径』指代、不自造 id」的出生证**（2026-10-16）。
 *
 * ## 用户逐字（本证要钉住的那条身份规则）
 *   *"那就是**实现了的，有 ID；没实现的没 ID**，不就好了"*
 *   ⇒ **id 空间只有一套（扫描给的）**、只覆盖**已实现**的对象；**未实现的设计用「名字/路径」指代**。
 *
 * ## 病（本证要证伪的旧路径）
 *   `src/domain/design_sheet.ts` 旧头注释：*"两份图**各用各的 `id`**、对拍时**按 id 同名配对**"*
 *   ⇒ 于是"想要的东西"得**自造一个 id** 才能进图（旧夹具就叫 `node_pending_x` / `node_want_future`）。
 *   ★ 那是**第二套 id 体系** —— 而本仓**早已解决过同类问题**（见下）。
 *
 * ## ★★ 对齐的既有解法（本证的前提：不是新造）
 *   · `expectations` 六种 kind **全用「路径/符号名」指代、无一用 id**
 *     （`src/domain/expectation.ts:35`；`file-exists { path }` 可指向**还不存在的文件**）；
 *   · `scope` 的 `files:<路径>`（`src/domain/scope.ts:31`，按**仓库相对路径**命中）；
 *   · `overlay` 对账**按 `path` 认亲**（`src/domain/overlay.ts:406` `byPath.get(a.path)`）、
 *     认不出才标孤儿（`:416`）、改名记 `_migratedFrom`（`:429`）。
 *   ⇒ 三条都是"**用名字/路径当身份、不自造 id**"。本笔照抄这套做法（口径只此一处：`designSheetRef`）。
 *
 * ## 判据（★ 每条都亲手跑、贴原文）
 *   ① ★★ 设计图里那个"要实现"的占位节点**没有自造 id**（**贴落盘原文**：该节点**没有 `id` 键**）；
 *   ② ★ 它**仍被正确判为 `只在设计里(要实现)`**（经**工具层** `diffDesignSheetHandler`，输出里贴出来）；
 *   ③ ★★ `rebuild_design=true` 前后 `design/<f>.dsl.json` **逐字节相同**、那个节点**重建后仍在**（不许退化）。
 *   ★ 另三条只作"三类判定**语义未变**"的旁证：同名属性差 · 只在 live 里 · 现设计视图上下文。
 *
 * ## ★★ 走工具层（本仓纪律：证必须走工具层）
 *   读 = `diffDesignSheetHandler`（`diff_design_sheet` 的入参适配层），**不是**直调
 *   `domain/design_sheet.ts` 的纯函数；并自证在工具层（缺 `feature` ⇒ `requireStr` 当场报错，
 *   而纯函数没有这道守卫）。
 *
 * ## ★★ 诚实清单（[未核] —— 不许把推测写成实测）
 *   · ★★ **发现（本条须人裁定）**：`validateDSL` 要求 `Node.id`（`schema/design_dsl.schema.json`
 *     → `definitions.Node.required = ["id"]`）⇒ 一个**没有 `id` 键**的占位节点**过不了** `validateDSL`。
 *     ⇒ 两条路（**本证不替人决定，也不改 schema**）：(a) 设计侧 schema 放宽 `id` 必填；
 *     (b) 把**路径本身**写进 `id`（仍无"自造 token"）。本证按用户原话（"**没实现的没 ID**"）走 (a) 的读法，
 *     并在第 1 节**贴出 `validateDSL` 的实测读数**，不藏。
 *   · **MCP 可达性 [未核]**：本入口未注册进 `TOOL_DEFS`（`t326` 工具面零余量）⇒ LLM 暂时调不到它。
 *   · **传输 / MCP schema 层 [未核]**：直接 import handler，没经 MCP server 的 `tools/list`。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · ★ **真 feature 只读**：本证全程在夹具 feature（`t338`）与临时项目根里做，**不碰**真仓数据。
 *
 * ## 用法
 *   node certs/t338-design-sheet-ref-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, '.work/tmp338');
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

const { saveDesignSheet, getDesignSheet, getDesignSheetFile, getDesignDir } = await import(
  '../dist/src/infrastructure/storage.js'
);
const { diffDesignSheetHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const { getLiveFeature } = await import('../dist/src/infrastructure/storage.js');
const { validateDSL } = await import('../dist/src/domain/validator.js');
const { designSheetRef } = await import('../dist/src/domain/design_sheet.js');

const FEAT = 't338';
/** ★ 未实现的对象：**没有 id**，只有**名字/路径**（用户规则："没实现的没 ID"） */
const PENDING_PATH = 'src/planned/thing.ts';
const PENDING_NAME = '待建模块 X';

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

console.log('\n════ 1. 手写 design/<f>.dsl.json（★ 未实现的那个节点：**没有 id**、用名字/路径指代）════');
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
      // ① 已实现 ⇒ 用**扫描给的 id** 指代（与 live 同 id ⇒ 进"比属性"）
      { id: SAME, type: 'file', label: '手写：a', title: '手写标题 A', description: '手写设计：A 的职责（与扫描给的不一样）' },
      // ② ★ 未实现 ⇒ **没有 id**，用**名字/路径**指代（★ 这就是本证要钉的那件事）
      { type: 'file', label: PENDING_NAME, title: '尚未存在的文件（要实现）', description: PENDING_PATH, status: 'draft' },
    ],
    edges: [],
  },
  semantic: { files: [{ id: SAME, path: 'src/a.ts', responsibility: '手写设计：A 的职责（与扫描给的不一样）' }] },
};
const dsFile = saveDesignSheet(designSheet);
const rawBefore = fs.readFileSync(dsFile, 'utf-8');
chk(
  dsFile === getDesignSheetFile(FEAT) && dsFile === path.join(getDesignDir(), `${FEAT}.dsl.json`),
  '1 住处落定：`design/<feature>.dsl.json`',
  `getDesignSheetFile → ${dsFile}`,
);

// ── ① ★★ 落盘原文：那个"要实现"的占位节点**没有自造 id** ──
const rawObj = JSON.parse(rawBefore);
const pendingNode = (rawObj.geometry?.nodes ?? []).find((n) => n.description === PENDING_PATH);
dump('① 落盘原文 · 那个"要实现"的占位节点（**整个节点对象**）', JSON.stringify(pendingNode, null, 2));
chk(
  !!pendingNode && !('id' in pendingNode),
  '① ★★ 落盘原文里：那个"要实现"的占位节点**没有 `id` 键**（没有 `node_pending_x` 这种自造 token）',
  `该节点的键 = [${Object.keys(pendingNode ?? {}).join(', ')}]`,
);
chk(
  designSheetRef(pendingNode) === PENDING_PATH,
  '①-b ★ 它的**指代** = **名字/路径**（`designSheetRef` 唯一口径；file 节点取路径 `description`，与 `overlay.nodePath` 同口径）',
  `designSheetRef = ${JSON.stringify(designSheetRef(pendingNode))}`,
);
{
  const v = validateDSL(JSON.parse(rawBefore));
  // ★ 只**报读数**、不判红：这是"schema 仍要求 Node.id"的诚实声明（见头注释「诚实清单」）
  dump('①-c ★ 诚实读数：这份**含无 id 占位节点**的设计图过 validateDSL 的结果（不藏）', `valid=${v.valid}` + (v.valid ? '' : `\n${v.errors.slice(0, 3).join('\n')}`));
}
{
  // ★ 另一条读法（**并行给出，不藏**）：把**路径本身**写进 `id` ⇒ 依然没有"自造 token"、且**过 schema**。
  const alt = { ...pendingNode, id: PENDING_PATH };
  const vAlt = validateDSL({ ...rawObj, geometry: { ...rawObj.geometry, nodes: [rawObj.geometry.nodes[0], alt] } });
  dump(
    '①-d ★ 同一条规则的**另一读法**（把路径写进 `id`，仍无"自造 token"）',
    `designSheetRef = ${JSON.stringify(designSheetRef(alt))}（← 指代仍是**路径**） · validateDSL.valid = ${vAlt.valid}`,
  );
}

console.log('\n════ 2. ② 经**工具层**读三类差异（`diffDesignSheetHandler`）════');
const res = await diffDesignSheetHandler({ feature: FEAT });
dump('工具回执原文', res.text);
const data = parseDataBlock(res.text);
chk(res.isError !== true && data && data.diff, '2 前置：经工具层拿到**结构化**三类差异（回执带 `---DATA---` 机器段）', res.isError ? `★ isError：${res.text.split('\n')[0]}` : `design_only=${JSON.stringify(data?.diff?.design_only)}`);

// ② ★ 未实现的那个 ⇒ 判为「只在设计里(要实现)」，且**列的是名字/路径**
chk(
  Array.isArray(data?.diff?.design_only) && data.diff.design_only.includes(PENDING_PATH) && /要实现/.test(String(res.text)),
  '② ★★ 那个**无 id** 的占位节点仍被判为 **`只在设计里(要实现)`**（列出的是它的**名字/路径**，不是自造 id）',
  `design_only=${JSON.stringify(data?.diff?.design_only)}`,
);
chk(
  !(data?.diff?.design_only ?? []).some((x) => /^node_pending|pending_/.test(x)),
  '②-b ★ `design_only` 里**没有**任何 `node_pending_*` 之类自造 token（旧路径已收窄）',
  `design_only=${JSON.stringify(data?.diff?.design_only)}`,
);

// ── 三类判定的另两类：语义未变（旁证） ──
chk(
  Array.isArray(data?.diff?.live_only) && data.diff.live_only.includes(LIVE_ONLY) && /未纳入设计/.test(String(res.text)),
  '③\'(旁证) 只在 live 里 ⇒ 仍被判为 **`未纳入设计`**（live 全是已实现的 ⇒ 列 id，语义未变）',
  `live_only=${JSON.stringify(data?.diff?.live_only)}`,
);
{
  const entry = (data?.diff?.same_id ?? []).find((s) => s.id === SAME);
  const desc = (entry?.attrs ?? []).find((x) => x.key === 'description');
  dump(`③'(旁证) ${SAME} 的同名属性差（逐字段两侧原值）`, JSON.stringify(entry, null, 2));
  chk(
    !!desc && desc.design !== desc.live,
    '③\'(旁证) 已实现的那对（**同 id**）仍被判为**属性差**（`description` 两侧原值不同，语义未变）',
    desc ? `设计=${JSON.stringify(desc.design)} · live=${JSON.stringify(desc.live)}` : '★★ 没报出 description 差',
  );
}

console.log('\n════ 3. ③ ★★ 重建不许动它：rebuild_design=true 前后逐字节相同 + 那个节点仍在 ════');
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
    (after?.geometry?.nodes ?? []).some((n) => n.description === PENDING_PATH && !('id' in n)),
    '③ ★★ 那个**无 id** 的占位节点**重建之后仍在**设计图里（★ 不许退化：这正是"挪建筑"的判据）',
    `重建后设计图节点键=${JSON.stringify((after?.geometry?.nodes ?? []).map((n) => (n.id === undefined ? `<无id:${n.description}>` : n.id)))}`,
  );
}
// ③ 复核：重建后工具层读数不变（那个点仍判"要实现"）
{
  const res2 = await diffDesignSheetHandler({ feature: FEAT });
  const d2 = parseDataBlock(res2.text);
  chk(
    (d2?.diff?.design_only ?? []).includes(PENDING_PATH),
    '③-b ★ 重建**之后**经工具层复读：那个点**仍在** `只在设计里(要实现)`',
    `design_only=${JSON.stringify(d2?.diff?.design_only)}`,
  );
}

console.log('\n════ 4. ★ 自证：确实走的是**工具层入口**（不是直调 domain 纯函数）════');
{
  const bad = await diffDesignSheetHandler({});
  dump('缺 feature 的回执原文', bad.text);
  chk(
    bad.isError === true && /缺参数 "feature"/.test(bad.text),
    '4 缺 `feature` ⇒ 由 `requireStr` **当场报错**（`domain/design_sheet.ts` 的纯函数没有这道守卫）',
    bad.isError ? bad.text.split('\n')[0] : '★★ 没报错',
  );
}

// ★★ 清理（Windows EBUSY 时响亮报告，不算判红）
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主删除闸/句柄占用，**不是本证的判据**：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp338 即可（gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
