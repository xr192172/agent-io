/**
 * P1 · **`design_intent` 的设计册必须锚在调用方给的 `project_dir` 上**
 *      （延迟普查席 `latency-ds-1` §8 的写端缺陷 · 2026-11-19）
 *
 * ## 被守的那个洞（实测，不是推测）
 * §8 现场读数：`design_intent action=set feature=…` 的探针 `cwd` 与 `project_dir` **都指向砂箱**，
 * 设计册却被写进**另一个仓**（`_dsl_rev` 28→36），砂箱里那份同名册**逐字节未变**；
 * 显式再传 `project_dir=<砂箱绝对路径>` 仍然写错地方。
 * 根因不在"某个工具忘了判断"，而在**锚点只有一个答案**：`getDesignSheetFile(feature)` 的解析顺序是
 * `baseDir ?? 注册表 ?? 数据家`，而 `design_intent` **有 `project_dir` 入参却从不往下传**
 * （`edit_dsl` 更直接：`handlers.ts` 的顶层键白名单里写着"工具忽略它"）。
 *
 * ## 本证钉什么（四条，一条一读数）
 * | # | 方向 | 期望 |
 * |---|---|---|
 * | ① | `design_intent` **给** `project_dir` | 落 `project_dir` 那本册；注册表那本**字节不变** |
 * | ② | 消融：同一夹具**不给** `project_dir`（= 改前的行为） | 落**注册表**那本；`project_dir` 那本字节不变 |
 * | ③ | 迁移语义：`edit_dsl { operations:[{type:'goal',…}] }` + `project_dir` | 与 ① 同口径（op=goal 也认锚点） |
 * | ④ | `project_dir` 指到一个**没有这本册**的根 | **响亮失败**，且**不回落**注册表那本（字节不变） |
 *
 * ★ ② 是"回退即红"的可机检等价读数：把锚点那一段（`design_book_scope` + `getDesignSheetFile` 的
 *   `?? anchor`）回退掉，①③ 的读数就退化成 ② —— 而 ① 的断言是"注册表那本字节不变"，当场红。
 * ★ 夹具把"另一个仓"放在**临时目录**里（不碰真仓）：本笔**不写**任何真实仓库的册。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { registerFeature } from '../src/infrastructure/project_registry.js';

const FEATURE = 'p1_anchor_probe';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-anchor-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

/** 注册表里记的那个根 —— 改前**唯一**会被写的册（本笔里它扮演"包安装根 / 另一个仓"） */
let REG_ROOT = '';
/** 调用方**显式**指的那个根（= 本笔要它写的地方） */
let PICKED_ROOT = '';

function bookFile(root: string): string {
  return path.join(root, '.agent-io', 'design', `${FEATURE}.dsl.json`);
}

/** 一本最小可写的册（形状与 `design/<f>.dsl.json` 同；`_dsl_rev` 用来判"谁被写了"） */
function bookBody(root: string): Record<string, unknown> {
  return {
    feature: FEATURE,
    title: '锚点探针册',
    source_root: root.replace(/\\/g, '/'),
    geometry: { nodes: [], edges: [] },
    semantic: { files: [], apis: [] },
    meta: {},
    _dsl_rev: 28,
  };
}

function writeBook(root: string): void {
  const f = bookFile(root);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${JSON.stringify(bookBody(root), null, 2)}\n`, 'utf-8');
}

function readBook(root: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(bookFile(root), 'utf-8')) as Record<string, any>;
}

/** 册文件的**字节**指纹（"它有没有被动过"的唯一读数；不靠 mtime） */
function shaOf(root: string): string {
  return createHash('sha256').update(fs.readFileSync(bookFile(root))).digest('hex');
}

/** 每个用例一套干净夹具：两个根各一本同名册，注册表指向 REG_ROOT */
function setup(): void {
  const id = Math.random().toString(36).slice(2, 8);
  REG_ROOT = path.join(TMP, `registry-root-${id}`);
  PICKED_ROOT = path.join(TMP, `picked-root-${id}`);
  writeBook(REG_ROOT);
  writeBook(PICKED_ROOT);
  registerFeature(FEATURE, REG_ROOT, 'p1_design_intent_anchor');
}

function def(name: string) {
  const d = TOOL_DEFS.find((x) => x.name === name);
  assert.ok(d, `TOOL_DEFS 里必须注册了 ${name}`);
  return d;
}

/** 工具面调用：把"抛"与"isError"两种拒法读成同一个 `{ok,text}`（调用方不该关心它是哪一种） */
async function callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; text: string }> {
  try {
    const r = await invokeTool(def(name), args);
    return { ok: !r.isError, text: r.text ?? '' };
  } catch (e) {
    return { ok: false, text: (e as Error).message };
  }
}

test('① design_intent 给了 project_dir ⇒ 只写 project_dir 那本册，注册表那本字节不变', async () => {
  setup();
  const regBefore = shaOf(REG_ROOT);
  const pickedBefore = readBook(PICKED_ROOT)._dsl_rev;
  assert.equal(pickedBefore, 28, '夹具前提：project_dir 那本册的 _dsl_rev 起始 28');

  const r = await callTool('design_intent', {
    feature: FEATURE,
    project_dir: PICKED_ROOT,
    goals: [{ title: 'anchor-probe-goal' }],
  });
  assert.ok(r.ok, `写入必须成功：${r.text}`);

  // ★ 核心断言 A：注册表那本**一个字节都没动**（改前它才是被写的那一本，`_dsl_rev` 28→36）
  assert.equal(shaOf(REG_ROOT), regBefore, '注册表那本册的字节必须不变（写错地方就是这条红）');
  // ★ 核心断言 B：目标真的落在 project_dir 那本上
  const picked = readBook(PICKED_ROOT);
  assert.ok(picked._dsl_rev > pickedBefore, `project_dir 那本册的 _dsl_rev 必须前进（实际 ${picked._dsl_rev}）`);
  assert.deepEqual(
    (picked.overlay_global?.goals ?? []).map((g: { title?: string }) => g.title),
    ['anchor-probe-goal'],
    'goals 必须写进 project_dir 那本册',
  );
});

test('② 消融对照：同一夹具不给 project_dir（= 改前的行为）⇒ 落注册表那本，project_dir 那本不变', async () => {
  setup();
  const regBefore = readBook(REG_ROOT)._dsl_rev;
  const pickedBefore = shaOf(PICKED_ROOT);

  const r = await callTool('design_intent', { feature: FEATURE, goals: [{ title: 'no-anchor-goal' }] });
  assert.ok(r.ok, `写入必须成功：${r.text}`);

  // 这条钉住"差异只由 project_dir 造成"：不给 ⇒ 就是注册表口径（与改前逐字相同）
  assert.ok(readBook(REG_ROOT)._dsl_rev > regBefore, '不给 project_dir ⇒ 写注册表那本（这是既有语义，不许改）');
  assert.equal(shaOf(PICKED_ROOT), pickedBefore, '不给 project_dir 时，别的根上的册不许被碰');
});

test('③ 迁移语义钉死：edit_dsl op=goal + project_dir ⇒ 与 design_intent 同一口径', async () => {
  setup();
  const regBefore = shaOf(REG_ROOT);

  const r = await callTool('edit_dsl', {
    feature: FEATURE,
    project_dir: PICKED_ROOT,
    // ★ reason 走 L1–L4：含一个路径形态的实体（L3），不给 evidence ⇒ 不触发 L4
    reason: '把锚点探针目标写进 src/anchor_probe.ts 所属那本册（op=goal 认 project_dir）',
    operations: [{ type: 'goal', op: 'set', data: { goals: [{ title: 'goal-op-anchored' }] } }],
  });
  assert.ok(r.ok, `op=goal 必须成功：${r.text}`);

  assert.equal(shaOf(REG_ROOT), regBefore, 'op=goal 也必须落到 project_dir 那本（注册表那本字节不变）');
  assert.deepEqual(
    (readBook(PICKED_ROOT).overlay_global?.goals ?? []).map((g: { title?: string }) => g.title),
    ['goal-op-anchored'],
    'goals 必须写进 project_dir 那本册',
  );
});

test('④ project_dir 指到一个没有这本册的根 ⇒ 响亮失败，且**不回落**注册表那本', async () => {
  setup();
  const regBefore = shaOf(REG_ROOT);
  const emptyRoot = path.join(TMP, `empty-root-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(emptyRoot, { recursive: true });

  const r = await callTool('design_intent', {
    feature: FEATURE,
    project_dir: emptyRoot,
    goals: [{ title: 'must-not-land-anywhere' }],
  });

  assert.equal(r.ok, false, '显式锚点下找不到册 ⇒ 必须失败（不许静默改道）');
  assert.ok(/project_dir/.test(r.text), `报错必须点名 project_dir（实际：${r.text.slice(0, 200)}）`);
  // ★ 这条是"不静默"的另一半：失败时也不许把那本**别人的**册改掉
  assert.equal(shaOf(REG_ROOT), regBefore, '失败路径也不许回落去写注册表那本');
});
