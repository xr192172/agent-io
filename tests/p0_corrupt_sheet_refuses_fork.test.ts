/**
 * P0 · **设计册被截断 ⇒ 不许 fork 覆盖它**（第二轮外审 §4 第 1 条：唯一会**真丢数据**的一条）。
 *
 * ## 被守的那个洞（实测复现，改前读数见文件末尾）
 * 册被截断成 66 字节 ⇒ `JSON.parse` 失败 ⇒ `getDesignSheet` 的 `catch` 回 `null`
 * ⇒ `import_project` 的 `designExists = !!getDSL(...)` = **false** ⇒ 默认分支**从扫描产物 fork 一份**
 * ⇒ **整本手写决策卡被扫描产物覆盖**，而回执只说"已导入项目"、`allow_design_drop` **不触发**
 * （它基于"读到的设计"算差集，读到 `null` 就**没有可丢项**）。
 *
 * ★ 病根不是"catch 返回 null"本身，而是**「没有」与「读失败」在同一个值上合流**
 *   （AGENTS-RULES 0.12：静默失败 = 假绿的源头）。
 *
 * ## 三条判据（每条都能证红）
 * | # | 断言 | 改前 |
 * |---|---|---|
 * | ① | `designSheetState` 三态可分：`missing` / `corrupt`（带 file+error）/ `ok` | 函数不存在（只有 `null`） |
 * | ② | 损坏册 + 再导入 ⇒ **拒绝**，册 **sha256 前后一致**（66 字节不变），报文含 路径 / 解析错误 / 救援指令 | 不抛、册 66→1822 字节、回执说"已导入项目" |
 * | ③ | `missing`（真没有设计）⇒ **照旧 fork 成功**（没把正常导入打死） | 也是绿的（证明这条修法不是靠"一律拒绝"蒙过去） |
 *
 * ## 兼容断言（2026-11-02 第三轮外检 A **把它反过来了**：不是改坏读端，是改对）
 * 改前这里钉的是「`getDesignSheet` / `getDSL` 对外**仍是 `null`**」—— 因为当时只有 `import_project` 需要三态。
 * 实测后果：同一本被截断的册在 `get_dsl query=dsl` 上被说成「feature "X" 不存在（视图: design）」
 * = **把"坏"说成"没有"**（0.12）。⇒ 三态**下沉到唯一读出端**：`corrupt` / 根不可达 ⇒ **抛**，只有 `missing` 回 `null`。
 * ★ 判据：把 `getDesignSheet` 改回 `state==='ok'?dsl:null` ⇒ 本文件的 ① 立刻变红。
 *
 * ## 隔离（踩过的坑，别重踩）
 * 册的位置**由注册表决定**（`getDesignSheetFile` 走 `projectRootOf`）⇒ 必须先真导入一次
 * 让 `feature → 项目根` 登记成立，册才会落在**夹具项目自己的** `.agent-io/design/` 下；
 * 否则手工造的册落在数据仓、而导入读的是别处 ⇒ 测的是两条不相干的路径（假绿）。
 * 临时 `AGENT_IO_HOME` + 临时夹具项目 + 独立 feature 名，`finally` 里整棵删。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { importProject } from '../src/infrastructure/graph/import_project.js';
import { designSheetState, getDSL, getDesignSheet, getDesignSheetFile, saveDSL } from '../src/infrastructure/storage.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

const TMP = makeTempHome();
const HOME = path.join(TMP, 'home');
/** ② 的夹具：先导入一次（留下真册）再把册截断 */
const PROJ_CORRUPT = path.join(TMP, 'proj_corrupt');
/** ③ 的夹具：从未导入过（= `missing`） */
const PROJ_FRESH = path.join(TMP, 'proj_fresh');

/** 内容指纹（"一个字节都不许动"唯一可判的读数） */
function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** `AGENT_IO_HOME` 必须在**任何** storage 调用之前钉住（`getStorageRoot()` 每次调用现读 env） */
function ensureEnv(): void {
  process.env.AGENT_IO_HOME = HOME;
  fs.mkdirSync(HOME, { recursive: true });
}

/** 最小夹具项目（一个 `.ts` + package.json；够 `import_project` 扫出 1 文件/1 符号） */
function makeProj(dir: string): void {
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export function fa(): number {\n  return 1;\n}\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', type: 'module' }, null, 2));
}

/** 66 字节的**半截 JSON** —— 长度与"解析必失败"都在用例里当场断言，不靠人造假设 */
function truncated66(): string {
  const valid = JSON.stringify({ feature: 'x', geometry: { nodes: [{ id: 'n1' }] }, semantic: { files: [] } }, null, 2);
  return valid.slice(0, 66);
}

after(() => rmRf(TMP));

// ════════════════════════════════════════════════════════════════════
// ① 三态：missing / corrupt / ok（+ 兼容：getDSL 仍是 null/null/dsl）
// ════════════════════════════════════════════════════════════════════
test('① 三态可分：缺文件⇒missing · 66 字节半截⇒corrupt(带 file+error) · 正常⇒ok；getDSL 对坏册**抛**、对 missing 回 null', () => {
  ensureEnv();

  // —— 前置：这 66 字节确实是"66 字节"且确实"解析不了"（不靠假设）
  const half = truncated66();
  assert.equal(Buffer.byteLength(half, 'utf-8'), 66, '夹具前提：截断后恰好 66 字节');
  assert.throws(() => JSON.parse(half), '夹具前提：66 字节半截必须 JSON.parse 失败');

  // —— (1) missing：文件不存在
  const F_MISSING = 'p0cs_state_missing';
  assert.deepEqual(designSheetState(F_MISSING), { state: 'missing' }, '缺文件必须是 missing（不是 corrupt）');

  // —— (2) corrupt：文件在、但解析失败
  const F_CORRUPT = 'p0cs_state_corrupt';
  const fileC = getDesignSheetFile(F_CORRUPT);
  fs.mkdirSync(path.dirname(fileC), { recursive: true });
  fs.writeFileSync(fileC, half, 'utf-8');
  const sc = designSheetState(F_CORRUPT);
  assert.equal(sc.state, 'corrupt', '66 字节半截必须是 corrupt（★ 不许与 missing 合流成 null）');
  assert.equal(sc.file, fileC, 'corrupt 必须点名**哪个文件**（= 读失败的那个绝对路径）');
  assert.ok(path.isAbsolute(sc.file), `损坏读数里的 file 必须是绝对路径，实际：${sc.file}`);
  assert.ok(sc.error.length > 0, 'corrupt 必须带**解析错误原文**（空串 = 又一次静默）');
  assert.match(sc.error, /JSON|解析/, `error 里要能看出是解析失败，实际：${sc.error}`);
  assert.match(sc.error, /position|line|Unexpected|Unterminated|end of/i, `error 要带解析器原文，实际：${sc.error}`);

  // —— (3) ok：正常册
  const F_OK = 'p0cs_state_ok';
  saveDSL(
    {
      feature: F_OK,
      source_root: HOME,
      geometry: { nodes: [{ id: 'n1', label: '手写节点' }] },
      semantic: { files: [] },
    } as never,
    'mcp',
  );
  const so = designSheetState(F_OK);
  assert.equal(so.state, 'ok', '正常册必须是 ok');
  assert.equal(so.state === 'ok' ? so.dsl.feature : null, F_OK, 'ok 必须把册原样交出来');

  // —— 兼容断言（2026-11-02 反转）：三态下沉到唯一读出端 ⇒ 坏册**不许**静默回 null
  assert.equal(getDSL(F_MISSING), null, 'getDSL(missing) 仍是 null（「没有」就该是 null）');
  assert.throws(
    () => getDSL(F_CORRUPT),
    (e: Error) => String(e.message).includes('设计册读不出来') && String(e.message).includes(fileC),
    'getDSL(corrupt) 必须**抛**且点名文件（改前回 null ⇒ 读端把「坏」说成「没有」）',
  );
  assert.throws(
    () => getDesignSheet(F_CORRUPT),
    (e: Error) => String(e.message).includes('设计册读不出来'),
    'getDesignSheet(corrupt) 必须**抛**（同一实现的另一视图，两处行为必须一致）',
  );
  assert.ok(getDSL(F_OK), 'getDSL(ok) 必须读得到册');
});

// ════════════════════════════════════════════════════════════════════
// ② ★ 核心：损坏册 ⇒ 拒绝导入 · 册逐字节不变（改前：册被扫描产物覆盖）
// ════════════════════════════════════════════════════════════════════
test('② 损坏册 + 再导入 ⇒ 拒绝（非 0）· 册 sha256 前后一致 · 报文含 路径+解析错误+救援指令', async () => {
  ensureEnv();
  const F = 'p0cs_fork_guard';

  // —— 前置：先真导入一次 ⇒ 落一本**真册**，并登记 feature → 项目根
  makeProj(PROJ_CORRUPT);
  await importProject({ project_dir: PROJ_CORRUPT, feature: F });
  const file = getDesignSheetFile(F);
  assert.ok(
    path.resolve(file).startsWith(path.resolve(PROJ_CORRUPT)),
    `前置：册必须落在夹具项目自己的 design/ 下（否则测的是两条路），实际：${file}`,
  );
  assert.ok(fs.existsSync(file), `前置：首次导入必须落下真册，实际不存在：${file}`);

  // —— 把它截成 66 字节（= 外审复现的那个情形）
  const full = fs.readFileSync(file);
  fs.writeFileSync(file, full.subarray(0, 66));
  const before = fs.readFileSync(file);
  const beforeSha = sha256(before);
  assert.equal(before.length, 66, '前置：册已被截成 66 字节');
  assert.throws(() => getDSL(F), /设计册读不出来/, '前置：被截断后 getDSL 直接抛（这就是「坏 ≠ 无」的入口）');

  // —— 再导一次（用户重跑 import_project）
  let err: unknown = null;
  let receipt = '';
  try {
    const r = await importProject({ project_dir: PROJ_CORRUPT, feature: F });
    receipt = r.message;
  } catch (e) {
    err = e;
  }

  // ★★ 核心断言 1：必须拒绝
  assert.ok(
    err,
    `损坏册时 import_project **必须拒绝**（改前：不抛、回执说"已导入项目"、册被扫描产物覆盖）。` +
      `改前回执：${receipt.slice(0, 200)}`,
  );
  const msg = String((err as Error).message);
  // ★★ 核心断言 2：册逐字节不变（拒绝 = 一个字节都不写）
  const afterBuf = fs.readFileSync(file);
  assert.equal(afterBuf.length, 66, `拒写必须保留原字节数（改前被覆盖成扫描产物），实际：${afterBuf.length}`);
  assert.equal(sha256(afterBuf), beforeSha, '拒写必须保留原内容：sha256 前后一致');

  // ★ 报文三件套：① 哪个文件 ② 什么错 ③ 怎么救（+ ③ 分母露出来）
  assert.ok(msg.includes(file), `报文必须点名**哪个文件**（绝对路径 ${file}），实际：${msg}`);
  assert.match(msg, /JSON|解析|结构/, `报文必须说**什么错**，实际：${msg}`);
  assert.match(msg, /git checkout/, `报文必须给**救援指令**（git checkout 这条），实际：${msg}`);
  assert.match(msg, /code-snapshots/, `报文必须给**第二救援通道**（code-snapshots），实际：${msg}`);
  assert.match(msg, /allow_design_drop/, `报文必须点名 allow_design_drop **为什么看不见可丢节点**，实际：${msg}`);
  assert.match(msg, /没能读到|看不见|读不到/, `报文必须把"分母看不见"这件事显形（0.12 第 3 条），实际：${msg}`);
});

// ════════════════════════════════════════════════════════════════════
// ③ 正常路径不变：真没有设计（missing）⇒ 照旧 fork 成功
// ════════════════════════════════════════════════════════════════════
test('③ missing（真没有设计）⇒ 照旧 fork 成功（没把正常导入打死）', async () => {
  ensureEnv();
  const F = 'p0cs_fresh_fork';
  makeProj(PROJ_FRESH);

  // 前置：此刻确实是 missing（不是 corrupt）
  assert.deepEqual(designSheetState(F), { state: 'missing' }, '前置：从未导入过 ⇒ missing');

  const r = await importProject({ project_dir: PROJ_FRESH, feature: F });
  assert.match(r.message, /已导入项目/, '正常导入必须照旧成功');
  assert.match(r.message, /fork/i, `回执必须说清这次是 fork（而不是重建），实际：${r.message.slice(-300)}`);

  // 后置：册真的落下来了，且是 ok 态
  const file = getDesignSheetFile(F);
  const st = designSheetState(F);
  assert.equal(st.state, 'ok', 'fork 之后册必须可读（ok）');
  assert.ok(fs.statSync(file).size > 66, 'fork 出来的册必须是完整 JSON（远大于 66 字节）');
});
