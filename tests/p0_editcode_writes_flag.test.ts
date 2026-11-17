/**
 * P0 · **`edit_code` 必须登记 `writes: true`**（T-#EDITCODE-WRITES-FLAG）
 *
 * ## 实测的病（2026-11-17，领卡施工时）
 * `edit_code` 改源码成功后，回执里那一条心跳永远是这个样子：
 * ```
 * ★ 心跳（A7 通过 ⇒ 这张卡证明了"我还在动手"，顺手刷新）：file_x 刷新失败
 *   （拒绝写入设计 DSL（saveDSL，feature "…"）：工具 `edit_code` 未声明 writes:true。
 *     ★ 该工具在注册表（ToolDef.writes）里登记为**不写设计册**，却试图落盘 —— 注册声明与实际行为不符。）
 * ```
 * ⇒ 租约永远不会被刷（卡被别人判"僵"），而工具**没做错任何事** —— 错的是注册表那一格。
 *
 * ## 机理（三处各自都对，拼起来才看得见）
 * ① `invokeTool` 给每个工具包 `runDslWriteScope({via:'tool', who:def.name})`（`server_registry.ts:990`）；
 * ② 写闸 A7 通过 ⇒ `write_gate#touchCoveredHeartbeats` → `task_ops#touchTaskHeartbeat` → `writeTask`
 *    → `saveDesignSheet` → `saveDSL`（心跳是**卡**的状态，卡住在设计册里）；
 * ③ `saveDSL` 的写授权闸按 `ToolDef.writes` 判（`storage.ts#assertDslWriteAllowed`，唯一事实源）。
 * ⇒ 任何**经过写闸**的工具都会替系统落一次设计册；登记成 writes:false 就是对注册表说谎。
 *
 * ## 两条断言（结构 + 行为）
 * · **结构**：`TOOL_DEFS` 里 `edit_code` 的 `writes` 在场且为 `true`，且与注入给写闸的那张表
 *   （`dsl_write_scope#toolWritesOf`）读到的**同一个值**（一处权威，两个读端）。
 * · **行为**：**不真跑 `edit_code`**，而是直接驱动它失败的那条路径 ——
 *   在 `via:'tool', who:'edit_code'` 作用域里调 `saveDSL` 与 `touchTaskHeartbeat`，必须成功；
 *   再把 `who` 换成仍登记 writes:false 的工具（`rename_symbols`），必须**同一个错误**复现。
 *   两者一起才说明：闸有牙、而 `edit_code` 那一格是**它不再咬人**的唯一原因。
 *
 * ## 消融（弄坏必红）
 * 把 `edit_code` 的 `writes` 改回 `false` ⇒ 第 ②③ 组当场红（错误文案会原样出现）；
 * 把 `assertDslWriteAllowed` 的 `writes` 检查删掉 ⇒ 第 ③ 组红（对照组必须被拒）。
 *
 * ## 边界
 * · 只在临时 `AGENT_IO_HOME` 里落盘（临时数据根）；**不碰真册**、不改任何仓库文件；
 * · 心跳那条路径是**真函数**（`touchTaskHeartbeat`），只是不经过 `edit_code` 的编辑分支
 *   —— 本证要锁的是"写授权"那一格，不是 AST 编辑。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { toolWritesOf, toolWritesTable, runDslWriteScope } from '../src/infrastructure/dsl_write_scope.js';
import { saveDSL, getDesignSheet } from '../src/infrastructure/storage.js';
import { touchTaskHeartbeat } from '../src/application/design/dsl_ops/task_ops.js';
import type { DesignDSL } from '../src/domain/types.js';

/** 临时数据根（★ `AGENT_IO_HOME` 每次调用都现读 ⇒ 在这里设一次即可隔离） */
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'p0-editcode-writes-'));
process.env.AGENT_IO_HOME = HOME;

const FEATURE = 'p0_editcode_writes_flag';
const CARD = 'node_writes';
/** 5 分钟前的心跳（> `LEASE_HEARTBEAT_MIN_GAP_MS` ⇒ 下一次触碰真的会写盘） */
const STALE_HB = new Date(Date.now() - 5 * 60_000).toISOString();

/** 一份最小册：一个节点 + 一张 claimed 卡（A7 的"被覆盖的卡"就是它） */
function sheet(): Record<string, unknown> {
  return {
    feature: FEATURE,
    title: FEATURE,
    geometry: {
      nodes: [
        {
          id: CARD,
          label: '被写闸覆盖的节点',
          type: 'service',
          x: 0,
          y: 0,
          path: 'src/x.ts',
          task: {
            id: CARD,
            summary: '夹具卡',
            state: 'claimed',
            owner: 'subagent:p0-writes',
            claimed_at: STALE_HB,
            last_heartbeat_at: STALE_HB,
            evidence: [],
          },
        },
      ],
      edges: [],
    },
    semantic: { files: [] },
    todos: [],
  };
}

/** 直接落一份册到临时数据根（★ 不经过写闸：这是夹具准备，不是被测行为） */
function seedSheet(): void {
  const dir = path.join(HOME, '.agent-io', 'design');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${FEATURE}.dsl.json`), JSON.stringify(sheet(), null, 2), 'utf-8');
}

const minimalDsl = (): never =>
  ({
    id: 'p0_editcode_writes_flag_fixture',
    feature: 'p0_editcode_writes_flag_fixture',
    title: '夹具',
    rev: 1,
    geometry: { nodes: [], edges: [] },
    semantic: { files: [], apis: {} },
    meta: {},
  }) as never;

// ════════════════════════════════════════════════════════════════════
// ① 结构：注册表那一格在场且为 true；两个读端读同一个值
// ════════════════════════════════════════════════════════════════════
test('① 结构：`TOOL_DEFS` 里 `edit_code` 的 writes 在场且为 true，与注入写闸的那张表同值', () => {
  const def = TOOL_DEFS.find((d) => d.name === 'edit_code');
  assert.ok(def, 'TOOL_DEFS 里必须注册了 edit_code');
  assert.equal(def.writes, true, '★ edit_code 经写闸心跳落设计册 ⇒ 必须登记 writes:true（登记 false 会让心跳永久刷新失败）');
  assert.equal(toolWritesOf('edit_code'), true, '注入给写闸的表（唯一事实源）必须与 ToolDef 同值');
  assert.notEqual(toolWritesTable(), null, '加载 tool_registry 时就必须 bindWritesOf（表为 null = 闸整段放行）');
  // 反向对照：仍在改源码的工具里，至少还有一个是 writes:false —— 证明"true"不是被一刀切成默认值
  assert.equal(toolWritesOf('rename_symbols'), false, '对照：rename_symbols 仍登记 writes:false（本卡只修 edit_code 那一格）');
});

// ════════════════════════════════════════════════════════════════════
// ② 行为（写授权那一格）：同一个 saveDSL，who 决定成败
// ════════════════════════════════════════════════════════════════════
test('② 行为：`via:tool` + who=edit_code ⇒ saveDSL 放行；who=rename_symbols ⇒ 同一句拒绝（闸仍有牙）', () => {
  assert.doesNotThrow(
    () => runDslWriteScope({ via: 'tool', who: 'edit_code' }, () => saveDSL(minimalDsl())),
    '★ edit_code 的写授权必须放行（它就是"心跳落册"那条路）',
  );
  assert.throws(
    () => runDslWriteScope({ via: 'tool', who: 'rename_symbols' }, () => saveDSL(minimalDsl())),
    (e: Error) => e.message.includes('rename_symbols') && e.message.includes('未声明 writes:true'),
    '【消融】对照工具必须被拒 —— 否则"放行"不是因为 flags，而是因为闸坏了',
  );
  // `via:'derived'`（系统派生）不受 writes 检查（口径：writes 只管 `via:'tool'` 那一支）
  assert.doesNotThrow(() => runDslWriteScope({ via: 'derived', who: 'heartbeat' }, () => saveDSL(minimalDsl())));
});

// ════════════════════════════════════════════════════════════════════
// ③ 行为（实测那条失败回执）：心跳刷新路径
// ════════════════════════════════════════════════════════════════════
test('③ 行为：`edit_code` 作用域下心跳刷新成功（last_heartbeat_at 变新）；对照工具复现"未声明 writes:true"', () => {
  seedSheet();
  const readHb = (): string | undefined => {
    const dsl = getDesignSheet(FEATURE) as unknown as DesignDSL | null;
    const node = (dsl?.geometry?.nodes ?? []).find((n) => n.id === CARD);
    return (node?.task as { last_heartbeat_at?: string } | undefined)?.last_heartbeat_at;
  };
  assert.equal(readHb(), STALE_HB, '前置：夹具里的心跳确实是旧的');

  // ① 真实的那条路径：写闸 A7 通过时刷心跳（`touchTaskHeartbeat` 内部判 <60s 跳过）
  const touched = runDslWriteScope({ via: 'tool', who: 'edit_code' }, () => touchTaskHeartbeat(FEATURE, CARD, Date.now()));
  assert.equal(touched, 'touched', `★ 心跳必须真写盘（实得 ${JSON.stringify(touched)}）`);
  const fresh = readHb();
  assert.ok(fresh && fresh !== STALE_HB, '刷成"就在此刻"（不是原样退回）');
  assert.ok(Date.now() - Date.parse(String(fresh)) < 5_000, '心跳时刻必须贴近现在');

  // ② 对照：同一个调用换成一个仍 writes:false 的工具 ⇒ 复现实测那条回执
  const fail = runDslWriteScope({ via: 'tool', who: 'rename_symbols' }, () =>
    touchTaskHeartbeat(FEATURE, CARD, Date.now() + 10 * 60_000),
  );
  assert.equal(typeof fail, 'object', '★ 该工具必须拿到 {error}（这就是"心跳刷新失败"的形态）');
  const msg = String((fail as { error?: string }).error ?? '');
  assert.match(msg, /未声明 writes:true/, '错误文案必须是写册闸那一句（读端靠它认出问题）');
  assert.match(msg, /rename_symbols/, '必须点名是哪个工具');
  assert.equal(readHb(), fresh, '被拒的心跳一个字节都不许落盘');
});
