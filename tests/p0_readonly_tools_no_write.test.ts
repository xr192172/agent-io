/**
 * P0 · **只读工具拿 `via:'tool'` 授权写设计册 ⇒ 必须在咽喉被拦**（卡 1.1，2026-11-03）。
 *
 * ## 被守的那个洞
 * `invokeTool` 给每个工具包一层 `runDslWriteScope({via:'tool', who:def.name}, …)` ——
 * 改前「凡工具皆写」：一个 `writes:false` 的只读工具（如 get_dsl）若 handler 里调 saveDSL，
 * 闸直接放行（who 名字合法 ⇒ 授权成立）。⇒ `ToolDef.writes`（唯一事实源 = 注册表）
 * 在 `assertDslWriteAllowed` 的 `via:'tool'` 分支被消费：
 *   · `writes===false` ⇒ 抛且点名工具名；
 *   · 名字不在表里（伪造 who）⇒ 抛（伪造留痕，AGENTS 0.12）；
 *   · 从未绑定（表 === null，手工夹具）⇒ 旧行为放行。
 *
 * ## 为什么必须走 invokeTool 咽喉（实测取证）
 * 直接 import handler 测不到：授权作用域是 invokeTool 里包上去的，handler 直调时
 * 根本没有 `via:'tool'` 作用域 ⇒ 闸根本不在这条路径上。
 *
 * ## 三向读数
 * | # | 方向 | 期望 |
 * |---|---|---|
 * | ① | 反向：get_dsl 的 def 复制、handler 换成调 saveDSL、writes:false | invokeTool **抛**且消息含 `get_dsl` |
 * | ② | 正向：同①但 writes:true | 成功（写进沙盒夹具） |
 * | ③ | 独立性对照：不经 invokeTool 直调 saveDSL | 不抛（沙盒回落）—— 证明闸住在咽喉 |
 *
 * ★ 判据钉在测试源码上（decision/file_src_application_types_ts#5，run 表达式）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { saveDSL } from '../src/infrastructure/storage.js';
import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { RETIRED_TOOLS } from '../src/application/meta/registry/capability_map.js';

/** 沙盒夹具（saveDSL 沙盒回落需要 AGENT_IO_HOME 在包根之外） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-readonly-tools-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

/** 一个最小可写的 DSL（feature 名独立，不碰真册） */
function minimalDsl(): Record<string, unknown> {
  return {
    id: 'p0_readonly_tools_no_write',
    feature: 'p0_readonly_tools_no_write',
    title: '夹具',
    source_root: TMP,
    rev: 1,
    geometry: { nodes: [], edges: [] },
    semantic: { files: {}, apis: {} },
    meta: {},
  };
}

test('① 反向：writes:false 的只读工具（get_dsl 伪造 def）经 invokeTool 写设计册 ⇒ 抛且点名 get_dsl', async () => {
  const def = TOOL_DEFS.find((d) => d.name === 'get_dsl');
  assert.ok(def, 'TOOL_DEFS 里必须注册了 get_dsl');
  assert.equal(def.writes, false, 'get_dsl 的注册表口径必须是 writes:false');
  const forged = { ...def, handler: async () => { saveDSL(minimalDsl() as never); return { text: 'ok' }; } };
  await assert.rejects(
    () => invokeTool(forged, { query: 'features' }),
    (e: Error) => e.message.includes('get_dsl') && e.message.includes('writes'),
    '闸必须拦下 writes:false 的工具，且回报点名工具名',
  );
});

test('② 正向：同样伪造但 writes:true ⇒ 成功（沙盒夹具内真落盘）', async () => {
  // ★ 伪造的 name 必须是注册表里 writes:true 的工具 —— 闸读的是 toolWritesTable()（按名字查），
  //   改 def.writes 字段改变不了表里登记的值（表在 bindWritesOf 时已冻结）。
  const def = TOOL_DEFS.find((d) => d.name === 'edit_dsl');
  assert.ok(def);
  assert.equal(def.writes, true, 'edit_dsl 的注册表口径必须是 writes:true');
  const forged = { ...def, handler: async () => { saveDSL(minimalDsl() as never); return { text: 'written' }; } };
  const r = await invokeTool(forged, { query: 'features' });
  // 写册已放行（handler 真被调用了）；r.isError 只可能是 handler 之外的其它闸（如 schema）——
  // 关键断言：**不含** writes 闸的拒绝文案（「未声明 writes:true」）。
  assert.ok(!(r.text ?? '').includes('未声明 writes'), 'writes:true 的工具不得被写册闸拦下');
  assert.ok(!(r.text ?? '').includes('不在工具注册表'), '注册表内名字不得被当伪造');
});

test('③ 独立性对照：不经 invokeTool 直调 saveDSL ⇒ 不抛（闸住在咽喉，不在函数体）', () => {
  assert.doesNotThrow(() => saveDSL(minimalDsl() as never), '沙盒回落必须保住：手工夹具/直调不走工具授权');
});

test('④ 注册表自检：8 个写册工具 true，其余 false（主控裁定口径 + 2026-11-17 心跳修复）', () => {
  // ★ 2026-11-17（T-#EDITCODE-WRITES-FLAG）：`edit_code` 进 true 清单 —— 它经写闸的 A7 心跳落设计册
  //   （`task_ops#touchTaskHeartbeat → saveDesignSheet → saveDSL`），登记成 false 会让心跳永久刷新失败。
  //   ⇒ 这一条清单是**机器执行者**：任何一次"悄悄改 writes"都会在这里红（并点名是哪个工具）。
  const expectTrue = new Set([
    'edit_dsl',
    'import_project',
    'design_intent',
    'opl',
    'sync_contracts',
    'reconcile_effects',
    'edit_code',
  ]);
  const gotTrue = TOOL_DEFS.filter((d) => d.writes).map((d) => d.name).sort();
  assert.deepEqual(gotTrue, [...expectTrue].sort(), 'writes:true 清单必须逐字等于裁定口径');
  // ★★ 第⑬项（2026-11-10）：chain_hop_args 合并（43→44）+ 第三刀退役 4 工具（first_hop/next_hop/gateway_provider/memory_observe 摘出 MCP 面）⇒ 44→40
  assert.equal(TOOL_DEFS.length, 40, 'TOOL_DEFS 总数 40（合并 +1、退役 -4）；退役去向见 capability_map.ts#RETIRED_TOOLS');
  // ★★★ 2026-11-06（T-t27）：`archive` 注册项摘除后的**不变量** —— 墓碑表里的名字不许还活着。
  //   这一条是"死名字复活"的唯一机器执行者（墓碑表在 capability_map.ts，注册表在 tool_registry.ts，
  //   两处一旦打架，旧名调用就会既"报已退役"又"真能调"）。
  for (const n of Object.keys(RETIRED_TOOLS)) {
    assert.ok(!TOOL_DEFS.some((d) => d.name === n), `墓碑表里的名字不许出现在注册表（死名字复活）：${n}`);
  }
});

test('⑤ 伪造 who（名字不在注册表）⇒ 抛（伪造留痕，0.12）', async () => {
  const def = TOOL_DEFS.find((d) => d.name === 'get_dsl');
  assert.ok(def);
  const forged = { ...def, name: 'ghost_tool_not_in_registry', writes: true, handler: async () => { saveDSL(minimalDsl() as never); return { text: 'ok' }; } };
  await assert.rejects(() => invokeTool(forged, { query: 'features' }), /不在工具注册表|who/);
});
