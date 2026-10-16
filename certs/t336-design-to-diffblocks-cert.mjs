#!/usr/bin/env node
/**
 * ★★★ cert T336 —— **「把'想要的形状'写成设计 DSL ⇒ 对拍 ⇒ 得到差异块（= 任务）」这条主流程的出生证**（2026-10-16）。
 *
 * ## 本证要钉住什么
 * 用户的口述工作流（逐字）：*"你先把所有的设计全都转化为设计 DSL，这样的话我们就能去改源码，
 * 因为设计 DSL 应该是比较容易写的，书写难度比实际写源码简单，因为写源码要考虑很多依赖关系，
 * 但设计 DSL 可以忽略这些依赖关系。"*
 * ⇒ 判据链：**设计 DSL 里写"想要的形状"（expectations）⇒ `consistency_check` 拿它去问代码 ⇒
 *    对不上的地方折成【差异块】= 任务清单**。
 *
 * ## 三条被表达的"想要的形状"（与真仓实测缺口一一对应）
 *   ① `rename_files` / `rename_file` / `symbol_move` **走自家快照、未接 `write_gate`**；
 *   ② `attestation` 的 `source_node_id` **只写不读**（无任何代码比对）；
 *   ③ `opl.ts` 的 `llmDeclare` 拿**现状签名**（`apiSignaturesOf`）喂 LLM 声明契约
 *      ⇒ `oplIntegrate` 写出的 `expected_apis` 与代码同源 = **恒真假绿**。
 *
 * ## ★★ 本证最核心的一条判据：**证伪"恒真"（两个方向都要）**
 *   一个期望若是"照抄现状" ⇒ 它恒真（改坏了也不红）⇒ 是假项。
 *   ⇒ 本证在**夹具**里做**两个方向**：
 *     · **方向 1（能绿）**：夹具里**满足**形状 ⇒ 6 条**全绿、0 块** ⇒ 证明它们**不是"永远红"**；
 *     · **方向 2（能红）**：把夹具源码改成**不符合** ⇒ 该条**必红 `> 0`**、且 `diff_blocks` **真的产出该块**，
 *       而**设计侧期望文本逐字不变**（`EXP_BEFORE === EXP_AFTER`）。
 *   ★ 两个方向合起来才是"这条期望**真的在判代码**"。
 *
 * ## ★★ 走工具层（本仓纪律：证必须走工具层）
 *   写 = `editDslHandler`（`edit_dsl` 的 handler）；判 = `consistencyHandler`（`consistency_check` 的 handler）
 *   —— **不是**直调 `updateFeature` / `judgeExpectations` / `buildDiffBlocks`。
 *   并自证：塞一个未知键 ⇒ 被点名「不被认的键」，且**已知键那段含 `expectations`**。
 *
 * ## ★ 读数纪律：报"某处有某字段" ⇒ **定义与字段出现在同一次读数里**
 *   第 0 节把**定义行**（`export function assertSourceWriteRegistered` / `source_node_id?: string` / …）
 *   与**字段读数**（哪一行写了它、哪一行调了谁）打在**同一段**里，不跨读数拼结论。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **传输/schema 层 [未核]**：直接 import handler，**没经** MCP server 的 `tools/list` JSON Schema。
 *   · **daemon 转发分支 [未核]**：不起 daemon。
 *   · **真仓未被本证改动**：夹具住 `certs/.work/tmp336`，`AGENT_IO_HOME` 指到那里 ⇒ **不碰真仓 `.agent-io/`**。
 *     真仓侧的 6 条期望由**另一条命令**写入 `self-2026-10-15`（报告里给读数），本证**不重做那一步**。
 *   · **`edge-exists` / `call-exists` 只覆盖 TS 相对导入面**：Go/Python 上按设计判不了（本证不声称覆盖）。
 *   · **6 条里 3 条含"新函数名"**（`attestationAppliesTo` / `assertContractNotFromCode`）：那是**设计侧给的目标形状**，
 *     不是既有符号 —— 属于"写下想要的形状"，本证如实声明这一点。
 *
 * ## 用法
 *   node certs/t336-design-to-diffblocks-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const TMP = path.join(HERE, '.work/tmp336');
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

const { saveDSL, getFeaturesDir } = await import('../dist/src/infrastructure/storage.js');
const { editDslHandler, consistencyHandler } = await import('../dist/src/application/design/handlers.js');
const { parseDataBlock } = await import('../dist/src/application/plumbing.js');
const dbmod = await import('../dist/src/infrastructure/index/db.js');
const getProjectCacheDb = dbmod.getProjectCacheDb;
const { syncFile, resolveCrossFileCalls } = await import('../dist/src/infrastructure/index/symbols.js');

const FEAT = 't336';

// ════════════════════════════════════════════════════════════════════
// 0. ★ 现实依据：**定义行 + 字段读数，同一次读数**（硬要求：不许跨读数拼）
// ════════════════════════════════════════════════════════════════════
console.log('════ 0. 三条缺口的"定义/字段在同一段读数里" ════');
{
  const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf-8').split('\n');
  const wg = read('src/application/write_gate.ts');
  const rf = read('src/application/refactor/rename/rename_files.ts');
  const ov = read('src/domain/overlay.ts');
  const st = read('src/application/design/dsl_ops/status_tools.ts');
  const opl = read('src/application/design/derive/opl.ts');

  // ① 定义（闸函数长什么样）+ 字段（rename_files 有没有依赖/调用它）
  dump('① 定义 · write_gate.ts 里的闸函数', wg.filter((l) => /export function assertSourceWriteRegistered/.test(l)).join('\n'));
  dump('① 字段 · rename_files.ts 的 import 段（★ 逐行读）', rf.filter((l) => /^import/.test(l)).join('\n'));
  // ★★ §34.3（2026-10-16 订正）：**证不许断言"某时点的真仓现状"** —— 本行原写"真仓 rename_files.ts **不** import write_gate"，
  //   那是 2026-10-16 的时点状态；而源码已按本证的期望改好（`b4c435b` 补了闸），断言于是**随现实变红**（36/1）。
  //   ⇒ 改为：**断言方向**（这条判据的**绿**与**红**两个方向都真的成立 —— 由本证 3. 的两处偏离在**夹具**里逐条证明：
  //     夹具 `rename_files.ts` **import 了** write_gate ⇒ 方向 1（能绿）；摘掉 import（偏离 B）/ 摘掉调用（偏离 A）⇒ 方向 2（能红））；
  //     **真仓此刻的读数只打印、不判红**（时点读数仅作参考，不是判据）。
  const rfImportsGate = rf.some((l) => /write_gate/.test(l));
  dump(
    '① 时点读数（★ 仅参考、**不判红**）· 真仓 rename_files.ts 是否 import write_gate',
    rfImportsGate
      ? '是 ⇒ 本证缺口① 的那条期望**已在真仓改好**（T336 之后补的闸）；本证不复判真仓，两方向在夹具里验。'
      : '否 ⇒ 真仓缺口仍在；本证不复判真仓，两方向在夹具里验。',
  );
  chk(
    wg.some((l) => /export function assertSourceWriteRegistered/.test(l)),
    '① 定义与字段同段：`assertSourceWriteRegistered` **已定义**（★ 方向判据：闸**存在** ⇒"能绿"有前提；'
      + '"能红"由本证 3. 的两处偏离在夹具里证）',
    `真仓时点读数（仅参考）：rename_files.ts import write_gate = ${rfImportsGate}`,
  );

  // ② 定义（source_node_id 字段）+ 字段（谁写它 / 有没有读端）
  dump('② 定义 · overlay.ts 的 attestation 形状（含 source_node_id）', ov.filter((l) => /kind: 'attestation'/.test(l)).join('\n'));
  dump('② 字段 · status_tools.ts 里写 source_node_id 的那一行', st.filter((l) => /source_node_id/.test(l)).join('\n'));
  const readers = [];
  for (const rel of ['src/domain/overlay.ts', 'src/application/design/dsl_ops/status_tools.ts', 'src/application/design/intent/consistency.ts', 'src/application/meta/explore/query_feature.ts']) {
    const ls = read(rel);
    ls.forEach((l, i) => {
      if (!/source_node_id/.test(l)) return;
      const code = l.trim();
      if (/^(\*|\/\/|\/\*)/.test(code)) return;      // ★ 注释不算读端
      if (/source_node_id\?:/.test(l)) return;       // ★ 类型定义不算读端
      if (/source_node_id: node_id/.test(l)) return; // ★ 写入端（已知的那一处）
      readers.push(`${rel}:${i + 1}: ${code}`);
    });
  }
  // ★★ §34.3（2026-10-16 订正）：**证不许断言"某时点的真仓现状"** —— 本行原写「**没有读端** ⇒ 缺口仍在」，
  //   那是 2026-10-16 的时点状态；一旦按缺口②的期望补上读端（`attestationAppliesTo`），断言就**随现实变红**。
  //   ⇒ 改为：**断言方向**（缺口②那条 `symbol-exists` 的**绿**与**红**两方向都真的成立 —— 由本证 3. 偏离 C 在**夹具**里证明：
  //     夹具 `overlay.ts` **有** `attestationAppliesTo` ⇒ 方向 1（能绿）；把它改名 ⇒ 方向 2（能红））；
  //     **真仓此刻的读端读数只打印、不判红**（时点读数仅作参考，不是判据）。
  dump('② 时点读数（★ 仅参考、**不判红**）· 全仓 `source_node_id` 的读端', readers.length ? readers.join('\n') : '（无 —— 除类型定义与那处写入外，**没有任何读端**）');
  chk(
    ov.some((l) => /kind: 'attestation'/.test(l)) && ov.some((l) => /source_node_id\?:/.test(l)),
    '② 定义与字段同段：`attestation` 形状**定义了** `source_node_id` 字段（★ 方向判据：字段**存在** ⇒'
      + '「要有一处读端把口供绑的节点与当前节点比对」这个目标形状**有可比对的对象**；'
      + '"能红"由本证 3. 偏离 C 在夹具里证）',
    `真仓时点读数（仅参考）：除类型定义与写入端外，读端条数=${readers.length}`,
  );

  // ③ 定义（现状签名 accessor 被喂给 LLM）+ 字段（其产物被写成 expected_apis）
  dump('③ 定义 · opl.ts 里 decl 的来源（喂 LLM 的那行 = apiSignaturesOf 现状签名）', opl.filter((l) => /apiSignaturesOf/.test(l)).join('\n'));
  dump('③ 字段 · opl.ts 里把 decl 写成 expected_apis 的那一行', opl.filter((l) => /expected_apis: f\.apis\.map/.test(l)).join('\n'));
  // ★★ §34.3（2026-10-16 订正）：同上 —— 原写「这行/那行**都在**」，那是把时点现状写进断言（opl.ts 一改就红）。
  //   ⇒ 改为：**断言方向**（缺口③那条 `call-exists` 的绿/红两方向由本证 3. 偏离 D 在**夹具**里证：
  //     夹具 `oplIntegrate` **调了**守卫 ⇒ 方向 1（能绿）；删掉调用 ⇒ 方向 2（能红））；
  //     真仓此刻"现状签名喂 LLM / 产物写成 expected_apis"两条只打印、不判红。
  const oplHasApiSignatures = opl.some((l) => /apiSignaturesOf/.test(l));
  const oplWritesExpectedApis = opl.some((l) => /expected_apis: f\.apis\.map/.test(l));
  dump(
    '③ 时点读数（★ 仅参考、**不判红**）· "现状签名喂 LLM" 与 "产物写成 expected_apis" 是否都在',
    `apiSignaturesOf=${oplHasApiSignatures} · expected_apis 写端=${oplWritesExpectedApis}`,
  );
  chk(
    opl.some((l) => /export (async )?function oplIntegrate/.test(l)),
    '③ 定义与字段同段：`oplIntegrate` **已定义**（★ 方向判据：期望的**主体符号存在** ⇒'
      + '「写 expected_apis 前必须过契约不得自源校验」这条 call-exists **有主体可判**；'
      + '"能红"由本证 3. 偏离 D 在夹具里证）',
    `真仓时点读数（仅参考）：apiSignaturesOf=${oplHasApiSignatures} · expected_apis 写端=${oplWritesExpectedApis}`,
  );
}

// ════════════════════════════════════════════════════════════════════
// 1. 夹具：代码根 + 索引（含跨文件调用解析）+ feature DSL（source_root 指夹具）
// ════════════════════════════════════════════════════════════════════
const CODE = path.join(TMP, 'code');
const P_WG = 'src/application/write_gate.ts';
const P_RF = 'src/application/refactor/rename/rename_files.ts';
const P_R1 = 'src/application/refactor/rename/rename_file.ts';
const P_SM = 'src/application/refactor/rename/symbol_move.ts';
const P_OV = 'src/domain/overlay.ts';
const P_OPL = 'src/application/design/derive/opl.ts';

/** 夹具源码 —— ★ 满足"想要的形状"的**最小实现**（供方向 1 全绿），偏离时会破坏它 */
const SRC = {
  [P_WG]: `export function assertSourceWriteRegistered(projectRoot: string, files: readonly string[]): { applicable: boolean; note: string } {
  return { applicable: files.length > 0, note: projectRoot + ':' + files.length };
}
`,
  [P_RF]: `import { assertSourceWriteRegistered } from '../../write_gate.js';

export async function renameFilesCore(projectDir: string): Promise<number> {
  assertSourceWriteRegistered(projectDir, ['a.ts']);
  return 1;
}

export async function renameFiles(projectDir: string): Promise<number> {
  return renameFilesCore(projectDir);
}
`,
  [P_R1]: `import { assertSourceWriteRegistered } from '../../write_gate.js';

export async function renameFileCore(projectDir: string): Promise<number> {
  assertSourceWriteRegistered(projectDir, ['b.ts']);
  return 2;
}
`,
  [P_SM]: `import { assertSourceWriteRegistered } from '../../write_gate.js';

export async function moveSymbolCore(projectDir: string): Promise<number> {
  assertSourceWriteRegistered(projectDir, ['c.ts']);
  return 3;
}
`,
  [P_OV]: `export interface Evidence { kind: string; source_node_id?: string }

export function attestationAppliesTo(e: Evidence, nodeId: string): boolean {
  return e.kind === 'attestation' && e.source_node_id === nodeId;
}
`,
  [P_OPL]: `export function assertContractNotFromCode(fromCode: boolean): void {
  if (fromCode) throw new Error('contract must not be derived from code');
}

export function oplIntegrate(): number {
  assertContractNotFromCode(false);
  return 4;
}
`,
};
const writeFixture = () => {
  for (const [rel, code] of Object.entries(SRC)) {
    const abs = path.join(CODE, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, code, 'utf-8');
  }
};
writeFixture();
const db = getProjectCacheDb(CODE);
const syncAll = async () => {
  for (const rel of Object.keys(SRC)) await syncFile(db, CODE, path.join(CODE, rel));
  // ★ 跨文件调用要重解析（否则 call-exists 会把"已实现"判成 fail/unsupported）
  resolveCrossFileCalls(db, CODE, { scopeFiles: Object.keys(SRC) });
};
await syncAll();

const ids = {
  rf: 'file_src_application_refactor_rename_rename_files_ts',
  r1: 'file_src_application_refactor_rename_rename_file_ts',
  sm: 'file_src_application_refactor_rename_symbol_move_ts',
  ov: 'file_src_domain_overlay_ts',
  opl: 'file_src_application_design_derive_opl_ts',
  wg: 'file_src_application_write_gate_ts',
};
saveDSL({
  id: `feature_${FEAT}`,
  type: 'feature_diagram',
  feature: FEAT,
  version: '1.0.0',
  title: FEAT,
  source_root: CODE,
  geometry: {
    layout: 'free',
    width: 800,
    height: 600,
    nodes: [
      { id: ids.rf, type: 'file', label: 'rename_files.ts', description: P_RF, arch_layer: 'core' },
      { id: ids.r1, type: 'file', label: 'rename_file.ts', description: P_R1, arch_layer: 'core' },
      { id: ids.sm, type: 'file', label: 'symbol_move.ts', description: P_SM, arch_layer: 'core' },
      { id: ids.opl, type: 'file', label: 'opl.ts', description: P_OPL, arch_layer: 'core' },
      { id: ids.ov, type: 'file', label: 'overlay.ts', description: P_OV, arch_layer: 'service' },
      { id: ids.wg, type: 'file', label: 'write_gate.ts', description: P_WG, arch_layer: 'core' },
    ],
    edges: [],
  },
  semantic: {
    files: [
      { id: ids.rf, path: P_RF, responsibility: 'T336 夹具：rename_files', layer: 'core' },
      { id: ids.r1, path: P_R1, responsibility: 'T336 夹具：rename_file', layer: 'core' },
      { id: ids.sm, path: P_SM, responsibility: 'T336 夹具：symbol_move', layer: 'core' },
      { id: ids.opl, path: P_OPL, responsibility: 'T336 夹具：opl', layer: 'core' },
      { id: ids.ov, path: P_OV, responsibility: 'T336 夹具：overlay', layer: 'service' },
      { id: ids.wg, path: P_WG, responsibility: 'T336 夹具：write_gate', layer: 'core' },
    ],
  },
});

// ════════════════════════════════════════════════════════════════════
// 2. ★ 经【工具层】写"想要的形状"（edit_dsl → editDslHandler）
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 2. 经工具层 edit_dsl 写 decision.summary + expectations ════');
const callEditDsl = (id, data) =>
  editDslHandler({
    feature: FEAT,
    weight: 'routine',
    reason: `经 edit_dsl 给夹具节点 ${id} 写决策卡：summary 是想要的形状，expectations 是它可机判的子集（T336 走工具层）`,
    operations: [{ type: 'decision', op: 'update', id, data }],
  });
const SCOPE = 'all';

const WRITES = [
  {
    id: ids.rf,
    data: {
      summary: '缺口①：rename_files 走自家快照、未接写入闸 ⇒ 必须接上 write_gate（未登记不许落盘）',
      expectations: [
        { kind: 'edge-exists', from: P_RF, to: P_WG, why: '缺口①：rename_files 只用 snapshotBeforeWrite，**根本不依赖 write_gate** ⇒ 必须接上唯一写盘闸' },
        { kind: 'call-exists', path: P_RF, symbol: 'renameFilesCore', target: 'assertSourceWriteRegistered', why: '缺口①：真正落盘的 renameFilesCore **必须过任务闸**；只 import 不调用 = 装饰闸' },
      ],
    },
  },
  { id: ids.r1, data: { summary: '缺口①：rename_file 只 import write_gate、不调任务闸 ⇒ 落盘必须过闸', expectations: [{ kind: 'call-exists', path: P_R1, symbol: 'renameFileCore', target: 'assertSourceWriteRegistered', why: '缺口①：renameFileCore 必须过任务闸，否则落盘可绕过' }] } },
  { id: ids.sm, data: { summary: '缺口①：symbol_move 与 rename_file 同形 ⇒ moveSymbolCore 必须过任务闸', expectations: [{ kind: 'call-exists', path: P_SM, symbol: 'moveSymbolCore', target: 'assertSourceWriteRegistered', why: '缺口①：实测 moveSymbolCore 不调任务闸 ⇒ 必须补上' }] } },
  {
    id: ids.ov,
    data: {
      summary: '缺口②：attestation 的 source_node_id 只写不读 ⇒ 必须有一处读端做比对',
      expectations: [{ kind: 'symbol-exists', path: P_OV, symbol: 'attestationAppliesTo', why: '缺口②：`source_node_id` 全仓只写不读 ⇒ 必须有读端把"口供绑的节点"与"当前节点"比对；否则"改名 ⇒ 旧口供失效"只是注释里的承诺' }],
    },
  },
  {
    id: ids.opl,
    data: {
      summary: '缺口③：oplIntegrate 拿现状签名喂 LLM 声明契约（恒真假绿）⇒ 写 expected_apis 前必须过"契约不得自源"校验',
      expectations: [{ kind: 'call-exists', path: P_OPL, symbol: 'oplIntegrate', target: 'assertContractNotFromCode', why: '缺口③：llmDeclare→apiSignaturesOf（现状签名）的产物被写成 expected_apis ⇒ 与代码同源 = 恒真；必须有守卫且被真实调用' }],
    },
  },
];
for (const w of WRITES) {
  const res = await callEditDsl(w.id, w.data);
  chk(res.isError !== true, `② expectations 经工具层写入成功：${w.id}`, res.isError ? `★ 被拒：${String(res.text).split('\n').slice(-1)[0]}` : String(res.text).split('\n')[0]);
}

// 期望文本的**逐字快照**（改前）—— 后面每处偏离都要拿它对比
const designFile = path.join(getFeaturesDir(), `${FEAT}.json`);
const readDecisions = () => {
  const raw = JSON.parse(fs.readFileSync(designFile, 'utf-8'));
  const out = {};
  for (const n of raw.geometry?.nodes ?? []) if (n.decision?.expectations) out[n.id] = { summary: n.decision.summary, expectations: n.decision.expectations };
  return out;
};
const DESIGN_BEFORE = JSON.stringify(readDecisions());
chk(JSON.parse(DESIGN_BEFORE) && Object.keys(JSON.parse(DESIGN_BEFORE)).length === 5 && JSON.parse(DESIGN_BEFORE)[ids.rf].expectations.length === 2, '②-b 落盘【设计侧文件】原文里，5 张决策卡 + 6 条 expectations 都在（不只在内存读侧）', Object.keys(JSON.parse(DESIGN_BEFORE)).join(', '));
dump('设计侧文件原文 · 6 条 expectations（改前）', JSON.stringify(readDecisions(), null, 1));

// ════════════════════════════════════════════════════════════════════
// 3. ★ 判定 + 差异块：经【工具层】consistency_check（consistencyHandler）
// ════════════════════════════════════════════════════════════════════
const runCC = async () => {
  const res = await consistencyHandler({ feature: FEAT, scope: SCOPE });
  if (res.isError) throw new Error(`consistency_check 抛错：${res.text}`);
  const data = parseDataBlock(res.text);
  return { text: res.text, data };
};
const redKinds = (data) =>
  data.expectation_results.items
    .filter((x) => x.verdict === 'fail')
    .map((x) => {
      const e = x.expectation;
      const subj = e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path;
      return `${e.kind}:${subj}${e.symbol ? '#' + e.symbol : ''}`;
    });
/** 报红项的**主体路径**（块归属用它；见 `expectationSubjectPath` 同口径） */
const redSubj = (data, kind, subj) =>
  data.expectation_results.items.some((x) => {
    const e = x.expectation;
    const p = e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path;
    return x.verdict === 'fail' && e.kind === kind && p === subj;
  });

console.log('\n════ 3. 方向 1（能绿）：夹具满足形状 ⇒ 6 条全绿 · 0 块 ════');
{
  const { text, data } = await runCC();
  const er = data.expectation_results;
  dump('consistency_check 回执（节选）', text.split('\n').filter((l) => /检查项|差异块|范围内文件|块（|没有差异|没得比/.test(l)).join('\n') || '(无匹配行)');
  chk(er.checked === 6 && er.passed === 6 && er.failed === 0 && er.unsupported === 0,
    '3-① 6 条**全判且全绿**（checked=6 passed=6 failed=0 unsupported=0）⇒ 这些期望**不是"永远红"**',
    `checked=${er.checked} passed=${er.passed} failed=${er.failed} unsupported=${er.unsupported}`);
  chk((data.blocks ?? []).length === 0 && (data.clean_files ?? []).length === 6,
    '3-① b 满足时**无差异块**、6 个文件全在 clean_files（"好消息"而不是"没跑"）',
    `blocks=${data.blocks?.length} clean_files=${(data.clean_files ?? []).length}`);
}

/** 偏离 → 断言：该 kind/target 必红 + 块真产出 + 设计侧文本逐字不变 */
const deviate = async (label, patch, expect) => {
  console.log(`\n════ 3. 方向 2（能红）：${label} ════`);
  const before = fs.readFileSync(path.join(CODE, patch.file), 'utf-8');
  const after = before.split(patch.from).join(patch.to);
  chk(after !== before, `偏离已落进夹具（${patch.file} 改动生效）`);
  fs.writeFileSync(path.join(CODE, patch.file), after, 'utf-8');
  await syncAll();
  const { text, data } = await runCC();
  const er = data.expectation_results;
  const reds = redKinds(data);
  dump('consistency_check 回执（节选）', text.split('\n').filter((l) => /检查项|不满足|❌ \[|差异块|范围内文件|\[arch_layer|人写的验收/.test(l)).join('\n'));
  chk(er.failed > 0, `expectation_failures > 0（failed=${er.failed}）`);
  chk(reds.some((r) => r.startsWith(expect)), `报红的正是 ${expect}`, reds.join(', '));
  // ★ 块归属：主体路径（`path` / `from`）—— 与 `expectationSubjectPath` 同口径，不在展示层另推一遍
  const [kind, rest] = [expect.slice(0, expect.indexOf(':')), expect.slice(expect.indexOf(':') + 1)];
  const subj = rest.split('#')[0];
  chk(redSubj(data, kind, subj), `报红项的主体路径 = ${subj}`, '');
  const blk = (data.blocks ?? []).find((b) => b.files.includes(subj));
  chk(!!blk && blk.counts.expectation_failures > 0,
    'diff_blocks **真的产出了该块**（贴块名 + expectation_failures）',
    blk ? `region=${blk.region} expectation_failures=${blk.counts.expectation_failures}` : `未产出 ${subj} 所属路径的块`);
  // ★ 差异必须**只来自人写的验收**（扫描侧干净）—— 证明是"我写的期望"在判，不是扫描对账在动
  chk((blk?.counts.missing ?? 0) + (blk?.counts.mismatched ?? 0) + (blk?.counts.unexpected ?? 0) === 0,
    '该块的差异**全部来自 `expectation_failures`**（扫描侧 missing/mismatched/unexpected 均为 0）',
    `counts=${JSON.stringify(blk?.counts)}`);
  // 复位
  fs.writeFileSync(path.join(CODE, patch.file), before, 'utf-8');
  await syncAll();
};

await deviate(
  '偏离 A（call-exists，缺口①）：摘掉 renameFilesCore 里的任务闸调用',
  { file: P_RF, from: "  assertSourceWriteRegistered(projectDir, ['a.ts']);", to: '  // T336 证伪：任务闸调用被摘掉' },
  'call-exists:src/application/refactor/rename/rename_files.ts#renameFilesCore',
);
await deviate(
  '偏离 B（edge-exists，缺口①）：摘掉 rename_files.ts 对 write_gate 的依赖',
  { file: P_RF, from: "import { assertSourceWriteRegistered } from '../../write_gate.js';", to: '// T336 证伪：write_gate 依赖被摘掉' },
  'edge-exists:src/application/refactor/rename/rename_files.ts',
);
await deviate(
  '偏离 C（symbol-exists，缺口②）：把 overlay.ts 的读端改名',
  { file: P_OV, from: 'function attestationAppliesTo(', to: 'function attestationAppliesTo_RENAMED(' },
  'symbol-exists:src/domain/overlay.ts',
);
await deviate(
  '偏离 D（call-exists，缺口③）：删掉 oplIntegrate 里对守卫的调用',
  { file: P_OPL, from: '  assertContractNotFromCode(false);', to: '  // T336 证伪：守卫调用被删掉' },
  'call-exists:src/application/design/derive/opl.ts#oplIntegrate',
);

// ════════════════════════════════════════════════════════════════════
// 4. ★★★ 核心：设计侧期望文本【逐字不变】（改前 == 改后）
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 4. 期望文本未变（改前 / 改后**逐字对比**）════');
{
  const DESIGN_AFTER = JSON.stringify(readDecisions());
  dump('设计侧文件原文 · 6 条 expectations（改后，节选）', JSON.stringify(JSON.parse(DESIGN_AFTER)[ids.rf], null, 1));
  chk(DESIGN_AFTER === DESIGN_BEFORE,
    '4 设计侧 6 条 expectations + 5 条 summary **逐字未变**（4 次偏离只改夹具源码，DSL 一个字节没动）',
    DESIGN_AFTER === DESIGN_BEFORE ? '两串相等' : '★ 变了！');
}

// ════════════════════════════════════════════════════════════════════
// 5. 自证"确实走了工具层"
// ════════════════════════════════════════════════════════════════════
console.log('\n════ 5. 自证走的是工具层（未知键被点名，已知键那段含 expectations）════');
{
  const res = await callEditDsl(ids.rf, { summary: 'x', definitely_bogus_key: 1 });
  dump('拒绝原文 · 未知键', res.text);
  const unknownSeg = res.text.split('\n').find((l) => /不被认的键/.test(l)) ?? '';
  const knownSeg = res.text.split('\n').find((l) => /已知键/.test(l)) ?? '';
  chk(
    res.isError === true && /definitely_bogus_key/.test(unknownSeg) && !/expectations/.test(unknownSeg) && /expectations/.test(knownSeg),
    '5 未知键被点名，已知键那段含 expectations（⇒ 本证确实在 checkOpSpec 之后，走的是工具层）',
    `未知键段=${JSON.stringify(unknownSeg).slice(0, 90)} · 已知键段=${JSON.stringify(knownSeg).slice(0, 90)}`,
  );
}

// ★★ 清理（Windows EBUSY 时响亮报告，不算判红）
try {
  try { dbmod.closeAllProjectCacheDbs?.(); } catch { /* ignore */ }
  fs.rmSync(TMP, { recursive: true, force: true });
} catch (e) {
  console.log(`\n⚠ 清理未完成（夹具仍在 ${TMP}）—— 原因是宿主删除闸/句柄占用，**不是本证的判据**：`);
  console.log(`   ${String((e && e.message) || e).split('\n')[0]}`);
  console.log('   ⇒ 手动清：删掉 certs/.work/tmp336 即可（gitignored 的临时区）。');
}

console.log(`\n════ 汇总：PASS=${P}  FAIL=${F}`);
if (F > 0) process.exit(1);
