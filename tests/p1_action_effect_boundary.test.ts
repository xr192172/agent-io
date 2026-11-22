/**
 * P1-ACTION-EFFECT-BOUNDARY-01 · **动作效果边界** 聚焦测试（§10 R1–R13）。
 *
 * ## 隔离纪律
 * - AGENT_IO_HOME 指向临时目录；临时项目目录；随机回环端口；handler 全部注入 spy 或走临时夹具；
 *   绝不触真实项目 / 快照 / 运行中 daemon / 外部服务。
 * - R1–R4 做受控消融：拒绝路径 spy 计数 0；同一路径直调 spy 证明探针有效（有牙）；
 *   记录临时项目树与 HOME 前后哈希/留证路径。
 *
 * ## 覆盖映射（企划 §10）
 * R1 GET snapshot rollback → 405/403，handler 0，哈希不变
 * R2 恶意 Origin POST 通用写工具 → 403，项目树零变化；HOME 仅框架 dogfood/驳回留证
 * R3 恶意 Origin POST daemon shutdown → 403，handler 0，不退出
 * R4 非法 Host serve/daemon 拒绝；合法回环 Host 对照可用（serve 走真实 HTTP 端口）
 * R5 合法回环 safe-read 回执与基线一致
 * R6 无 Origin 本地写：有效兼容限期放行；清单外/缺要素/过期 deny
 * R7 list/check/scan vs rollback/apply 动作效果正确；写分支不受静态只读标注影响
 * R8 非回环写无认证 deny；转发头不能提升为回环
 * R9 Origin:null / unknown action / 未知子动作 / 缺资源域 显式 deny
 * R10 /api/opl 真实 HTTP：拒绝不进执行核（spy 0）；放行过同一裁决（spy 1）
 * R11 条件写回执不反降 safe-read（消费真实 handler 回执写证据）
 * R12 改 actor/via/session 不改变裁决
 * R13 临时项目 + 临时快照库真实 rollback，对照 restored/removed/failed 与哈希
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ────────────────────────────────────────────────────────────────────────
// 隔离夹具（先于业务模块求值落环境）
// ────────────────────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'p1-action-effect-'));
const HOME = path.join(TMP, 'home');
const PROJECT = path.join(TMP, 'project');
const PROJ2 = path.join(TMP, 'proj2');
const PROJ3 = path.join(TMP, 'proj3');
fs.mkdirSync(HOME, { recursive: true });
fs.mkdirSync(PROJECT, { recursive: true });
fs.mkdirSync(PROJ2, { recursive: true });
fs.mkdirSync(PROJ3, { recursive: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
fs.copyFileSync(
  path.join(HERE, 'fixtures', 'p1-boundary', 'sample.txt'),
  path.join(PROJECT, 'sample.txt'),
);
process.env.AGENT_IO_HOME = HOME;
process.env.AGENT_IO_ACTOR = 'agent:action-effect-boundary';

import { TOOL_DEFS } from '../src/application/tool_registry.js';
import {
  actionEffectOf,
  adjudicateActionEffect,
  extractActionKey,
  ACTION_EFFECT_COMPAT,
  type ActionEffect,
  type TransportFacts,
} from '../src/application/action_effect.js';
import { invokeTool } from '../src/presentation/mcp/server_registry.js';
import { createDaemonServer } from '../src/presentation/daemon/server.js';
import {
  startServer,
  setOplCoreSpy,
  stopActiveServeServer,
  activeServePort,
} from '../src/presentation/http/serve.js';
import {
  createFileSnapshot,
  rollbackFileSnapshot,
} from '../src/application/refactor/snapshot/file_snapshot.js';
import { parseDataBlock } from '../src/application/plumbing.js';
import { closeAllProjectCacheDbs } from '../src/infrastructure/index/db.js';

/** 临时项目目录树哈希（拒绝路径零副作用对照）。 */
function hashTree(dir: string): string {
  const h = crypto.createHash('sha256');
  if (fs.existsSync(dir)) {
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) walk(p);
        else h.update(`${path.relative(dir, p)}\0${fs.readFileSync(p)}\0`);
      }
    };
    walk(dir);
  }
  return h.digest('hex');
}

/** 目录树 → { 相对路径: 内容 }，用于列出 HOME 前后发生变化的留证路径。 */
function treeMap(dir: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p);
    }
  };
  walk(dir);
  return out;
}

/** 前后两棵树之间新增/改动/删除的相对路径（只列路径，不比对内容指纹以外的东西）。 */
function changedPaths(before: Record<string, Buffer>, after: Record<string, Buffer>): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const p of paths) {
    const b = before[p];
    const a = after[p];
    if (!b || !a || !b.equals(a)) changed.push(p);
  }
  return changed.sort();
}

const LOOPBACK_HOST = '127.0.0.1';
const SAFE_ORIGIN = 'http://127.0.0.1:7600';
const EVIL_ORIGIN = 'http://evil.example';

function httpFacts(over: Partial<TransportFacts> = {}): TransportFacts {
  return {
    channel: 'http-serve',
    method: 'POST',
    host: `${LOOPBACK_HOST}:7600`,
    origin: SAFE_ORIGIN,
    remoteAddress: LOOPBACK_HOST,
    now: '2026-11-22T12:00:00+08:00',
    ...over,
  };
}

/** 造一个挂在已登记工具名下、handler 为 spy 的夹具 def（不触真实实现链）。 */
function spyDef(name: string, spy: () => Promise<{ text: string }>) {
  return {
    name,
    writes: false,
    title: `[fixture] ${name}`,
    description: 'p1 边界夹具',
    inputSchema: {},
    handler: spy,
  };
}

// ────────────────────────────────────────────────────────────────────────
// R7 · 登记完整性：41 个工具效果派生自 TOOL_DEFS；动作级拆分与校准表一致
// ────────────────────────────────────────────────────────────────────────
test('R7 登记完整性：42 工具全有效果；8 safe-read / 34 may-write；动作级只读/写拆分在位', () => {
  assert.equal(TOOL_DEFS.length, 42, '工具总数必须仍是 42（P2 +1 只读恢复工具 recover_run）');
  const safe = TOOL_DEFS.filter((d) => actionEffectOf(d.name)?.effect === 'safe-read');
  const may = TOOL_DEFS.filter((d) => actionEffectOf(d.name)?.effect === 'may-write');
  assert.equal(safe.length, 8, `safe-read 实得 ${safe.length}`);
  assert.equal(may.length, 34, `may-write 实得 ${may.length}`);

  const safeNames = safe.map((d) => d.name).sort();
  assert.deepEqual(safeNames, [
    'capability_audit',
    'capability_map',
    'chain_hop_args',
    'cross_repo_symbol_index',
    'diff_views',
    'go_originals',
    'recover_run',
    'structure_gap',
  ]);

  // 写分支不受静态只读标注影响：snapshot 旧 writes:false / readOnlyHint 提示偏只读，
  // 但真实 rollback 恢复/删除源码 ⇒ 工具级 may-write + destructive；动作级 list 才是只读。
  const snap = actionEffectOf('snapshot');
  assert.ok(snap, 'snapshot 效果已登记');
  assert.equal(snap!.effect, 'may-write');
  assert.equal(snap!.destructive, true);
  assert.equal(actionEffectOf('snapshot', 'list')!.effect, 'safe-read');
  assert.equal(actionEffectOf('snapshot', 'rollback')!.effect, 'may-write');
  assert.equal(actionEffectOf('snapshot', 'rollback')!.destructive, true);

  // ── opl 动作级（§2.6.3，S1/M1 订正后口径）──
  assert.equal(actionEffectOf('opl', 'list')!.effect, 'safe-read');
  assert.equal(actionEffectOf('opl', 'get')!.effect, 'safe-read');
  assert.equal(actionEffectOf('opl', 'propose')!.effect, 'safe-read');
  // locate 是无条件 may-write（writeState + placeProposals teachFile + LLM 分支），不得再标只读。
  assert.equal(actionEffectOf('opl', 'locate')!.effect, 'may-write');
  assert.deepEqual(actionEffectOf('opl', 'locate')!.resources, ['design', 'derived-state', 'external']);
  for (const [op, resources] of [
    ['add', ['derived-state']],
    ['adopt', ['design', 'derived-state']],
    ['advance', ['source', 'external', 'derived-state']],
    ['declare', ['derived-state']],
    ['implement', ['derived-state']],
    ['check', ['derived-state']],
    ['integrate', ['design', 'derived-state']],
    ['auto', ['design', 'derived-state', 'external']],
  ] as const) {
    const e = actionEffectOf('opl', op);
    assert.ok(e, `opl ${op} 已登记`);
    assert.equal(e!.effect, 'may-write', `opl ${op} 是写动作`);
    assert.deepEqual(e!.resources, [...resources], `opl ${op} 资源域`);
  }
  assert.equal(actionEffectOf('opl', 'advance')!.destructive, true);
  // auto 的实现文件写 implRoot 派生沙箱，不标 source。
  assert.ok(!actionEffectOf('opl', 'auto')!.resources.includes('source'));

  // ── 其余混合工具动作级抽样（§2.6.1/2/4/5/6/7/8/9）──
  assert.equal(actionEffectOf('observe', 'log')!.effect, 'safe-read');
  assert.equal(actionEffectOf('observe', 'line')!.effect, 'safe-read');
  assert.equal(actionEffectOf('observe', 'judge')!.effect, 'may-write');
  assert.equal(actionEffectOf('observe', 'proposals#list')!.effect, 'safe-read');
  assert.equal(actionEffectOf('observe', 'proposals#approve')!.effect, 'may-write');
  assert.equal(actionEffectOf('design_line', 'report')!.effect, 'safe-read');
  assert.equal(actionEffectOf('design_line', 'compile')!.effect, 'may-write');
  assert.equal(actionEffectOf('explore_code', 'facts')!.effect, 'safe-read');
  assert.equal(actionEffectOf('explore_code', 'docs')!.effect, 'safe-read');
  assert.equal(actionEffectOf('explore_code', 'watch#status')!.effect, 'safe-read');
  assert.equal(actionEffectOf('explore_code', 'watch#start')!.effect, 'may-write');
  assert.equal(actionEffectOf('explore_code', 'run_simulation')!.effect, 'may-write');
  assert.equal(actionEffectOf('explore_code', 'reset_simulation')!.effect, 'may-write');
  assert.equal(actionEffectOf('ledger', 'list')!.effect, 'safe-read');
  assert.equal(actionEffectOf('ledger', 'review_queue')!.effect, 'safe-read');
  assert.equal(actionEffectOf('ledger', 'hang')!.effect, 'may-write');
  assert.equal(actionEffectOf('rules', 'check')!.effect, 'may-write');
  assert.equal(actionEffectOf('annotate_functions', 'scan')!.effect, 'safe-read');
  assert.equal(actionEffectOf('upgrade', 'scan')!.effect, 'may-write');
  assert.equal(actionEffectOf('upgrade', 'apply')!.destructive, true);
  assert.equal(actionEffectOf('translate', 'book')!.effect, 'may-write');
  assert.equal(actionEffectOf('rename_symbols', 'analyze=suggest')!.effect, 'may-write');

  // 每个 may-write 必须带真实资源域证据。
  for (const d of may) {
    const e = actionEffectOf(d.name)!;
    assert.ok(e.resources.length > 0, `${d.name} may-write 缺资源域证据`);
  }
});

// ────────────────────────────────────────────────────────────────────────
// 动作键提取（schema 校验前原始 args）
// ────────────────────────────────────────────────────────────────────────
test('extractActionKey：op/action/子动作/analyze/mode/book 正确提取；缺省内层与显式等价；提取不到回落工具级', () => {
  assert.equal(extractActionKey({ op: 'add' }), 'add');
  assert.equal(extractActionKey({ action: 'list' }), 'list');
  assert.equal(extractActionKey({ action: 'proposals', op: 'approve' }), 'proposals#approve');
  assert.equal(extractActionKey({ action: 'watch', args: { action: 'status' } }), 'watch#status');
  assert.equal(extractActionKey({ analyze: 'similar' }), 'analyze=similar');
  assert.equal(extractActionKey({ mode: 'scan' }), 'scan');
  assert.equal(extractActionKey({ book: true }), 'book');
  assert.equal(extractActionKey({}), undefined);
  assert.equal(extractActionKey(undefined), undefined);

  // 缺省内层动作与真实 handler 缺省等价：proposals 缺省 list；watch 缺省 start。
  assert.equal(extractActionKey({ action: 'proposals' }), 'proposals#list');
  assert.equal(extractActionKey({ action: 'proposals', op: 'list' }), 'proposals#list');
  assert.equal(extractActionKey({ action: 'watch' }), 'watch#start');
  assert.equal(extractActionKey({ action: 'watch', args: { action: 'start' } }), 'watch#start');

  // 缺省键命中子动作效果：proposals#list 只读；watch#start 写。
  assert.equal(actionEffectOf('observe', extractActionKey({ action: 'proposals' })!)!.effect, 'safe-read');
  assert.equal(actionEffectOf('explore_code', extractActionKey({ action: 'watch' })!)!.effect, 'may-write');
});

test('L1 未知内层子动作仍显式 404：proposals/watch 未登记子动作不回落工具级', () => {
  for (const actionKey of ['proposals#bogus', 'watch#bogus']) {
    const toolName = actionKey.startsWith('proposals') ? 'observe' : 'explore_code';
    const adj = adjudicateActionEffect({ toolName, actionKey, transport: httpFacts() });
    assert.equal(adj.allowed, false, `${actionKey} 必须 deny`);
    assert.equal(adj.reason, 'unsupported-action');
    assert.equal(adj.status, 404);
  }
});

// ────────────────────────────────────────────────────────────────────────
// R9 · Origin:null / unknown tool / 未知子动作 / 缺资源域 显式 deny
// ────────────────────────────────────────────────────────────────────────
test('R9 显式 deny：unknown tool 404；未知子动作 404 不回落工具级；Origin:null 403；缺资源域 400', () => {
  const unknown = adjudicateActionEffect({ toolName: 'no_such_tool_xyz', transport: httpFacts() });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.reason, 'unsupported-action');
  assert.equal(unknown.status, 404);

  // §2.6.15：已登记工具的未登记 action/op 显式 deny，不回退工具级 safe-read/may-write。
  const unknownSub = adjudicateActionEffect({
    toolName: 'observe',
    actionKey: 'lint',
    transport: httpFacts(),
  });
  assert.equal(unknownSub.allowed, false);
  assert.equal(unknownSub.reason, 'unsupported-action');
  assert.equal(unknownSub.status, 404);

  const unknownOplOp = adjudicateActionEffect({
    toolName: 'opl',
    actionKey: 'no-such-op',
    transport: httpFacts(),
  });
  assert.equal(unknownOplOp.allowed, false);
  assert.equal(unknownOplOp.reason, 'unsupported-action');

  const nullOrigin = adjudicateActionEffect({
    toolName: 'edit_code',
    transport: httpFacts({ origin: 'null' }),
  });
  assert.equal(nullOrigin.allowed, false);
  assert.equal(nullOrigin.reason, 'null-origin');
  assert.equal(nullOrigin.status, 403);

  const noResources = adjudicateActionEffect({
    effect: { effect: 'may-write', resources: [] },
    transport: httpFacts(),
  });
  assert.equal(noResources.allowed, false);
  assert.equal(noResources.reason, 'no-resource-evidence');
  assert.equal(noResources.status, 400);
});

// ────────────────────────────────────────────────────────────────────────
// S1 反例 · opl locate 是 may-write：非回环远端 / 无 Origin / GET 一律 deny
// ────────────────────────────────────────────────────────────────────────
test('S1 locate 反例：非回环远端 403；无 Origin 403；GET 405（不得再被 safe-read 放行）', () => {
  const nonLoopback = adjudicateActionEffect({
    toolName: 'opl',
    actionKey: 'locate',
    transport: httpFacts({ remoteAddress: '203.0.113.9' }),
  });
  assert.equal(nonLoopback.allowed, false);
  assert.equal(nonLoopback.reason, 'non-loopback-remote');
  assert.equal(nonLoopback.status, 403);

  const noOrigin = adjudicateActionEffect({
    toolName: 'opl',
    actionKey: 'locate',
    transport: httpFacts({ origin: undefined }),
  });
  assert.equal(noOrigin.allowed, false);
  assert.equal(noOrigin.reason, 'no-origin-write');

  const getWrite = adjudicateActionEffect({
    toolName: 'opl',
    actionKey: 'locate',
    transport: httpFacts({ method: 'GET' }),
  });
  assert.equal(getWrite.allowed, false);
  assert.equal(getWrite.reason, 'get-write');
  assert.equal(getWrite.status, 405);

  // 对照：list 是真只读，回环 Origin 下 GET 放行。
  const listGet = adjudicateActionEffect({
    toolName: 'opl',
    actionKey: 'list',
    transport: httpFacts({ method: 'GET' }),
  });
  assert.equal(listGet.allowed, true);
});

// ────────────────────────────────────────────────────────────────────────
// R4(serve 侧) · 真实 HTTP 随机回环端口：非法 Host 403；合法回环 Host 对照可用
// ────────────────────────────────────────────────────────────────────────
test('R4(serve 真实 HTTP) 非法 Host 403；合法回环 Host 放行（/api/opl list）', async () => {
  const calls: string[] = [];
  setOplCoreSpy((op) => calls.push(op));
  await startServer(0);
  const port = activeServePort();
  assert.ok(port > 0, '随机回环端口已绑定');

  const req = (method: string, pathName: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request(
        { host: LOOPBACK_HOST, port, path: pathName, method, headers: { 'content-type': 'application/json', ...headers } },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        },
      );
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });

  try {
    // 非法 Host：裁决层 invalid-host 403，执行核 0 进入。
    const badHost = await req('POST', '/api/opl', { host: `evil.example:${port}`, origin: SAFE_ORIGIN }, JSON.stringify({ feature: 'p1-fixture', op: 'list' }));
    assert.equal(badHost.status, 403);
    assert.equal(calls.length, 0);

    // 合法回环 Host + 回环 Origin：只读 list 放行，执行核 1 次。
    const ok = await req('POST', '/api/opl', { host: `${LOOPBACK_HOST}:${port}`, origin: SAFE_ORIGIN }, JSON.stringify({ feature: 'p1-fixture', op: 'list' }));
    assert.equal(ok.status, 200, ok.body);
    assert.deepEqual(calls, ['list']);
  } finally {
    await stopActiveServeServer();
    setOplCoreSpy(null);
  }
});

// ────────────────────────────────────────────────────────────────────────
// R8 · 非回环写 deny；远端地址未知按非回环；转发头不参与裁决
// ────────────────────────────────────────────────────────────────────────
test('R8 非回环写 deny；未知远端按非回环；X-Forwarded-* 不能提升为回环', () => {
  const nonLoopback = adjudicateActionEffect({
    toolName: 'edit_code',
    transport: httpFacts({ remoteAddress: '203.0.113.9' }),
  });
  assert.equal(nonLoopback.allowed, false);
  assert.equal(nonLoopback.reason, 'non-loopback-remote');
  assert.equal(nonLoopback.status, 403);

  const unknownRemote = adjudicateActionEffect({
    toolName: 'edit_code',
    transport: httpFacts({ remoteAddress: undefined }),
  });
  assert.equal(unknownRemote.allowed, false);
  assert.equal(unknownRemote.reason, 'non-loopback-remote');

  // 回环远端 + 回环 Origin 的写才放行（转发头根本不在裁决输入里 —— 见 action_effect.ts 头注）。
  const loopback = adjudicateActionEffect({ toolName: 'edit_code', transport: httpFacts() });
  assert.equal(loopback.allowed, true);
});

// ────────────────────────────────────────────────────────────────────────
// R12 · actor / via / session / User-Agent 不进入裁决
// ────────────────────────────────────────────────────────────────────────
test('R12 裁决不读 actor/via/session/User-Agent：两套留痕输入产出同一裁决', () => {
  const base = adjudicateActionEffect({ toolName: 'edit_code', transport: httpFacts() });
  const other = adjudicateActionEffect({
    toolName: 'edit_code',
    transport: httpFacts(),
    // 下列键不是 AdjudicationInput 字段；即便夹带也必须被忽略（结构同型对照）。
    ...({ actor: 'someone-else', via: 'web', session: 'sess-9', 'user-agent': 'curl/9' } as object),
  });
  assert.equal(base.allowed, other.allowed);
  assert.equal(base.reason, other.reason);
  assert.equal(base.status, other.status);
});

// ────────────────────────────────────────────────────────────────────────
// R6 · 无 Origin 本地写：兼容条目五要素齐备且未过期才放行；清单外/过期 deny
// ────────────────────────────────────────────────────────────────────────
test('R6 兼容条目五要素齐备；dsl/watch 未过期放行；清单外与过期 deny', () => {
  for (const entry of ACTION_EFFECT_COMPAT) {
    assert.ok(entry.actionKey, '条目缺 actionKey');
    assert.ok(entry.channel, '条目缺 channel');
    assert.ok(entry.task, '条目缺关联任务');
    assert.ok(entry.evidence.length > 0, `${entry.actionKey} 缺现役调用证据`);
    assert.ok(Number.isFinite(Date.parse(entry.expiresAt)), `${entry.actionKey} expiresAt 非法`);
    assert.ok(entry.guardTest, `${entry.actionKey} 缺守护测试定位`);
    assert.ok(entry.revokeWhen.length > 0, `${entry.actionKey} 缺删除条件`);
  }

  const noOrigin: Partial<TransportFacts> = { origin: undefined };
  const dsl = adjudicateActionEffect({ actionKey: 'daemon:dsl', effect: daemonEffect('dsl'), transport: httpFacts({ channel: 'http-daemon', ...noOrigin }) });
  assert.equal(dsl.allowed, true);
  assert.ok(dsl.compat, 'dsl 放行应携带兼容条目留痕');
  assert.equal(dsl.compat!.actionKey, 'daemon:dsl');

  const watch = adjudicateActionEffect({ actionKey: 'daemon:watch', effect: daemonEffect('watch'), transport: httpFacts({ channel: 'http-daemon', ...noOrigin }) });
  assert.equal(watch.allowed, true);

  // 清单外：HTTP serve 通用工具面 / opl 无调用证据，不得秘密兼容。
  const toolNoOrigin = adjudicateActionEffect({ toolName: 'edit_code', transport: httpFacts(noOrigin) });
  assert.equal(toolNoOrigin.allowed, false);
  assert.equal(toolNoOrigin.reason, 'no-origin-write');

  const oplNoOrigin = adjudicateActionEffect({ toolName: 'opl', actionKey: 'implement', transport: httpFacts(noOrigin) });
  assert.equal(oplNoOrigin.allowed, false);
  assert.equal(oplNoOrigin.reason, 'no-origin-write');

  // 合法未过期：注入时钟早于 expiresAt（2027-02-22）⇒ 放行，证明真靠时间比较。
  const unexpired = adjudicateActionEffect({
    actionKey: 'daemon:dsl',
    effect: daemonEffect('dsl'),
    transport: httpFacts({ channel: 'http-daemon', origin: undefined, now: '2026-12-01T00:00:00+08:00' }),
  });
  assert.equal(unexpired.allowed, true);
  assert.ok(unexpired.compat);

  // 合法过期：注入时钟晚于 expiresAt ⇒ expired-compat（合法 ISO，非非法日期假绿）。
  const expired = adjudicateActionEffect({
    actionKey: 'daemon:dsl',
    effect: daemonEffect('dsl'),
    transport: httpFacts({ channel: 'http-daemon', origin: undefined, now: '2027-03-01T00:00:00+08:00' }),
  });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'expired-compat');

  // now 缺失 ⇒ fail-closed compat-clock-unavailable，不得静默取进程时钟兜底。
  const missingClock = adjudicateActionEffect({
    actionKey: 'daemon:dsl',
    effect: daemonEffect('dsl'),
    transport: httpFacts({ channel: 'http-daemon', origin: undefined, now: undefined }),
  });
  assert.equal(missingClock.allowed, false);
  assert.equal(missingClock.reason, 'compat-clock-unavailable');
  assert.equal(missingClock.status, 403);

  // now 非法 ISO ⇒ 同一 fail-closed 原因。
  const invalidClock = adjudicateActionEffect({
    actionKey: 'daemon:dsl',
    effect: daemonEffect('dsl'),
    transport: httpFacts({ channel: 'http-daemon', origin: undefined, now: 'not-a-iso-date' }),
  });
  assert.equal(invalidClock.allowed, false);
  assert.equal(invalidClock.reason, 'compat-clock-unavailable');
  assert.equal(invalidClock.status, 403);
});

function daemonEffect(kind: 'dsl' | 'watch'): ActionEffect {
  return {
    effect: 'may-write',
    resources: kind === 'dsl' ? ['design', 'derived-state'] : ['derived-state'],
    conditionalWrite: kind === 'watch',
  };
}

// ────────────────────────────────────────────────────────────────────────
// R1 · GET snapshot rollback：405，handler 0，项目树哈希不变（含消融探针）
// ────────────────────────────────────────────────────────────────────────
test('R1 GET 写动作 405：handler 计数 0，前后哈希不变；直调探针证明 spy 有效（消融可达 handler）', async () => {
  const before = hashTree(PROJECT);
  let calls = 0;
  const spy = async () => {
    calls += 1;
    fs.writeFileSync(path.join(PROJECT, 'should-not-exist.txt'), 'leak');
    return { text: 'rollback-applied' };
  };
  const def = spyDef('snapshot', spy);

  const r = await invokeTool(def, { action: 'rollback' }, 'http', httpFacts({ method: 'GET' }));
  assert.equal(r.isError, true);
  assert.equal(r.boundary?.allowed, false);
  assert.equal(r.boundary?.reason, 'get-write');
  assert.equal(r.boundary?.status, 405);
  assert.equal(calls, 0, 'handler 不得被调用');
  assert.equal(hashTree(PROJECT), before, '拒绝路径零副作用');

  // 受控消融：绕过边界直调 spy ⇒ 探针确实能计数并落盘（证明上面的 0 是边界拦的，不是 spy 失效；
  // 即边界关闭/绕过时代码路径可达 handler）。
  await spy();
  assert.equal(calls, 1);
  fs.rmSync(path.join(PROJECT, 'should-not-exist.txt'), { force: true });
  assert.equal(hashTree(PROJECT), before, '消融探针产物已清回');
});

// ────────────────────────────────────────────────────────────────────────
// R2 · 恶意 Origin POST 通用写工具：403，项目树零变化；HOME 仅框架 dogfood/驳回留证
// ────────────────────────────────────────────────────────────────────────
test('R2 恶意 Origin 写工具 403：handler 0；项目树零变化；HOME 变化仅限框架留证账册', async () => {
  const beforeProject = hashTree(PROJECT);
  const beforeHome = treeMap(HOME);
  let calls = 0;
  const spy = async () => {
    calls += 1;
    return { text: 'should-not-run' };
  };
  const def = spyDef('edit_code', spy);

  const r = await invokeTool(def, {}, 'http', httpFacts({ origin: EVIL_ORIGIN }));
  assert.equal(r.isError, true);
  assert.equal(r.boundary?.allowed, false);
  assert.equal(r.boundary?.reason, 'malicious-origin');
  assert.equal(r.boundary?.status, 403);
  assert.equal(calls, 0);
  assert.equal(hashTree(PROJECT), beforeProject, '目标动作派生态/台账/源码零变化');

  // HOME 对照：框架公共 dogfood 用量账 + 驳回 sidecar 允许追加（控制面留证，不计入动作效果）；
  // 除此之外 HOME 不得出现目标动作的派生态/台账/缓存落盘。
  const afterHome = treeMap(HOME);
  const homeChanged = changedPaths(beforeHome, afterHome);
  for (const p of homeChanged) {
    assert.ok(p.startsWith('.agent-io/dogfood/'), `HOME 出现非框架留证路径：${p}`);
    assert.ok(['usage.jsonl', 'rejections.jsonl', 'usage-rollup.json'].includes(path.basename(p)), `非留证账册文件：${p}`);
  }

  // 消融探针：直调 spy 证明计数有效（绕过边界可达 handler）。
  await spy();
  assert.equal(calls, 1);
  assert.equal(hashTree(PROJECT), beforeProject);
});

// ────────────────────────────────────────────────────────────────────────
// R5 · 合法回环 safe-read 回执与基线一致
// ────────────────────────────────────────────────────────────────────────
test('R5 合法回环 safe-read 放行，回执与 spy 基线一致', async () => {
  let calls = 0;
  const spy = async () => {
    calls += 1;
    return { text: 'baseline-read-receipt' };
  };
  const def = spyDef('go_originals', spy);
  const r = await invokeTool(def, {}, 'http', httpFacts());
  assert.equal(r.isError, undefined);
  assert.equal(calls, 1);
  // 回执主体 = spy 基线；尾部既有 STALE/NO_PROJECT_ROOT 告警块不归本卡管辖。
  assert.ok(r.text.startsWith('baseline-read-receipt'), `回执主体不符：${r.text.slice(0, 80)}`);
});

// ────────────────────────────────────────────────────────────────────────
// R11 · 条件写预分类不被回执反降（消费真实 handler 回执的写证据）
// ────────────────────────────────────────────────────────────────────────
test('R11 真实 dry_run 编辑：回执 written=false / 文件哈希不变；预分类仍 may-write', async () => {
  const editDef = TOOL_DEFS.find((d) => d.name === 'edit_code');
  assert.ok(editDef, 'edit_code 已登记');
  const pre = actionEffectOf('edit_code')!;
  assert.equal(pre.effect, 'may-write');

  const sampleBefore = fs.readFileSync(path.join(PROJECT, 'sample.txt'), 'utf-8');
  const beforeProjectTree = treeMap(PROJECT);

  // 真实 handler：dry_run=true 只出预览 diff，不快照、不写盘。
  const r = await invokeTool(
    editDef,
    {
      project_dir: PROJECT,
      file: 'sample.txt',
      op: 'replace_text',
      old_text: '失败用例若改动它',
      new_text: '失败用例若改动它-干跑预览',
      dry_run: true,
    },
    'mcp',
  );
  assert.equal(r.isError, undefined, `dry_run 调用不应报错：${r.text.slice(0, 200)}`);

  // 消费回执实际效果证据：data.written=false、无 written_files；源码字节未变。
  const data = parseDataBlock(r.text) as { written?: boolean; written_files?: string[]; dry_run?: boolean };
  assert.equal(data.written, false, 'dry_run 回执必须声明未写盘');
  assert.ok(!data.written_files || data.written_files.length === 0, 'dry_run 不得回报已写文件');
  assert.equal(fs.readFileSync(path.join(PROJECT, 'sample.txt'), 'utf-8'), sampleBefore, '干跑不得改动源码');
  // 项目树允许的唯一变化是框架/索引派生缓存（.agent-io/ 下 cache.db 等）；源码文件一个字节不得变。
  const afterProjectTree = treeMap(PROJECT);
  for (const p of changedPaths(beforeProjectTree, afterProjectTree)) {
    assert.ok(p.startsWith('.agent-io/'), `干跑路径出现源码/业务文件变化：${p}`);
  }

  // 回执没写不改变预分类：仍是 may-write（条件写执行前的保守口径）。
  const after = actionEffectOf('edit_code')!;
  assert.equal(after.effect, 'may-write', '回执未写不得反降预分类');
});

// ────────────────────────────────────────────────────────────────────────
// R13 · 临时项目 + 临时快照库真实 rollback：回执分组形状 + 源码/快照哈希对照
// ────────────────────────────────────────────────────────────────────────
test('R13 真实 rollback：restored/removed/failed 形状正确；源码回到快照字节；新建文件被删', () => {
  const aRel = 'a.txt';
  const bRel = 'b.txt';
  const aAbs = path.join(PROJ2, aRel);
  const bAbs = path.join(PROJ2, bRel);
  fs.writeFileSync(aAbs, 'v1\n');

  // 先建快照：a.txt 存在（existed=true）；b.txt 不存在（existed=false，本次改动新建）。
  const snap = createFileSnapshot(PROJ2, { reason: 'p1-fixture:write-before', files: [aRel, bRel] });
  const aSnapshotHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(fileSnapshotsDirOf(PROJ2), snap.id, 'files', aRel)))
    .digest('hex');

  // 改动工作树：a.txt 改 v2；新建 b.txt。
  fs.writeFileSync(aAbs, 'v2-changed\n');
  fs.writeFileSync(bAbs, 'new-file\n');

  // 对执行核做端到端对照（回执形状 = snapshot handler 编排的同一 RollbackResult：
  // restored / removed / failed 三分组，见 refactor/index.ts:1447-1454）。
  const result = rollbackFileSnapshot(PROJ2, snap.id);
  assert.equal(result.ok, true);
  assert.deepEqual(result.restored, [aRel]);
  assert.deepEqual(result.removed, [bRel]);
  assert.deepEqual(result.failed, []);

  // 源码字节回到快照内容；快照库副本哈希与恢复后文件一致。
  const aAfter = fs.readFileSync(aAbs);
  const aAfterHash = crypto.createHash('sha256').update(aAfter).digest('hex');
  assert.equal(aAfterHash, aSnapshotHash, '恢复后 a.txt 与快照副本逐字节一致');
  assert.ok(!fs.existsSync(bAbs), '快照时不存在的新建文件应被删除');

  // 登记层事实：rollback = destructive may-write；本卡不声称它经过源码写闸。
  const rollbackEffect = actionEffectOf('snapshot', 'rollback')!;
  assert.equal(rollbackEffect.effect, 'may-write');
  assert.equal(rollbackEffect.destructive, true);
  assert.ok(!('sourceWriteGatePassed' in rollbackEffect));
});

function fileSnapshotsDirOf(root: string): string {
  return path.join(root, '.agent-io', 'code-snapshots');
}

// ────────────────────────────────────────────────────────────────────────
// R13(包装层) · 经真实 snapshot ToolDef handler / invokeTool 复跑本地 rollback
// ────────────────────────────────────────────────────────────────────────
test('R13(包装层) invokeTool 真实 snapshot handler 回滚：回执分组 + 哈希对照；框架留痕单独记账', async () => {
  const snapDef = TOOL_DEFS.find((d) => d.name === 'snapshot');
  assert.ok(snapDef, 'snapshot 已登记');

  const aRel = 'a3.txt';
  const cRel = 'c3.txt';
  const aAbs = path.join(PROJ3, aRel);
  const cAbs = path.join(PROJ3, cRel);
  fs.writeFileSync(aAbs, 'v1\n');

  // 专属临时项目 + 临时快照库：a3 存在；c3 快照时不存在（新建）。
  const snap = createFileSnapshot(PROJ3, { reason: 'p1-fixture:write-before', files: [aRel, cRel] });
  const aSnapshotHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(fileSnapshotsDirOf(PROJ3), snap.id, 'files', aRel)))
    .digest('hex');

  fs.writeFileSync(aAbs, 'v2-changed\n');
  fs.writeFileSync(cAbs, 'new-file\n');

  // 经 invokeTool 包装层走真实 snapshot ToolDef handler（本地通道），不直调执行核。
  const homeBefore = treeMap(HOME);
  const r = await invokeTool(
    snapDef,
    { action: 'rollback', project_dir: PROJ3, snapshot: snap.id },
    'mcp',
  );
  assert.equal(r.isError, undefined, `包装层回滚不应报错：${r.text.slice(0, 200)}`);

  const data = parseDataBlock(r.text) as { restored: string[]; removed: string[]; failed: string[] };
  assert.deepEqual(data.restored, [aRel]);
  assert.deepEqual(data.removed, [cRel]);
  assert.deepEqual(data.failed, []);

  const aAfterHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(aAbs))
    .digest('hex');
  assert.equal(aAfterHash, aSnapshotHash, '包装层恢复后 a3.txt 与快照副本逐字节一致');
  assert.ok(!fs.existsSync(cAbs), '快照时不存在的新建文件应被删除');

  // 公共框架留痕单独记账：HOME 变化仅限 dogfood 用量账 / 驳回 sidecar；
  // 目标动作专属派生态 / 台账不在 HOME 新增。
  const homeAfter = treeMap(HOME);
  for (const p of changedPaths(homeBefore, homeAfter)) {
    assert.ok(p.startsWith('.agent-io/dogfood/'), `HOME 出现非框架留证路径：${p}`);
    assert.ok(['usage.jsonl', 'rejections.jsonl', 'usage-rollup.json'].includes(path.basename(p)), `非留证账册文件：${p}`);
  }
});

// ────────────────────────────────────────────────────────────────────────
// R10 · /api/opl 真实 HTTP：拒绝不进执行核（spy 0）；放行过同一裁决（spy 1）
// ────────────────────────────────────────────────────────────────────────
test('R10 真实 HTTP /api/opl：恶意 Origin / 无 Origin / 未知 op 拒绝 spy 0；回环 list 放行 spy 1', async () => {
  const calls: string[] = [];
  setOplCoreSpy((op) => calls.push(op));
  await startServer(0);
  const port = activeServePort();

  const req = (method: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request(
        { host: LOOPBACK_HOST, port, path: '/api/opl', method, headers: { 'content-type': 'application/json', ...headers } },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        },
      );
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });

  try {
    // ① 恶意 Origin POST implement（写 op）⇒ 403，执行核 0 进入。
    const evil = await req('POST', { host: `${LOOPBACK_HOST}:${port}`, origin: EVIL_ORIGIN }, JSON.stringify({ feature: 'p1-fixture', op: 'implement' }));
    assert.equal(evil.status, 403, evil.body);
    assert.equal(calls.length, 0, '恶意 Origin 不得触达执行核');

    // ② 无 Origin POST add（写 op，无兼容条目）⇒ 403，执行核 0 进入。
    const noOrigin = await req('POST', { host: `${LOOPBACK_HOST}:${port}` }, JSON.stringify({ feature: 'p1-fixture', op: 'add', idea: 'x' }));
    assert.equal(noOrigin.status, 403, noOrigin.body);
    assert.equal(calls.length, 0, '无 Origin 清单外写动作不得触达执行核');

    // ③ 未知 op ⇒ 404 unsupported-action，执行核 0 进入（不回退工具级放行）。
    const unknownOp = await req('POST', { host: `${LOOPBACK_HOST}:${port}`, origin: SAFE_ORIGIN }, JSON.stringify({ feature: 'p1-fixture', op: 'bogus-op' }));
    assert.equal(unknownOp.status, 404, unknownOp.body);
    assert.equal(calls.length, 0, '未知 op 不得触达执行核');

    // ④ 回环 Origin 只读 list ⇒ 200，执行核恰好 1 次，且经过同一纯裁决（spy 打点在裁决放行后）。
    const ok = await req('POST', { host: `${LOOPBACK_HOST}:${port}`, origin: SAFE_ORIGIN }, JSON.stringify({ feature: 'p1-fixture', op: 'list' }));
    assert.equal(ok.status, 200, ok.body);
    assert.deepEqual(calls, ['list'], '放行路径恰好经过执行核一次');
  } finally {
    await stopActiveServeServer();
    setOplCoreSpy(null);
  }
});

// ────────────────────────────────────────────────────────────────────────
// R3 / R4(daemon) / R6(daemon) · 注入真实 daemon server，随机回环端口
// ────────────────────────────────────────────────────────────────────────
test('R3/R4/R6 daemon：恶意 Origin shutdown 403 不退出；非法 Host 403；dsl/watch 无 Origin 限期兼容放行', async () => {
  const calls = { dsl: 0, watch: 0, shutdown: 0 };
  const server = createDaemonServer(
    {
      health: () => ({ ok: true, watchers: 0 }),
      watch: async (input) => {
        calls.watch += 1;
        return { ok: true, input };
      },
      dslWrite: async () => {
        calls.dsl += 1;
        return { ok: true, rev: 1, conflict: false, touched: [] };
      },
      alertsSince: () => ({ alerts: [], cursor: 0 }),
      shutdown: async () => {
        calls.shutdown += 1;
      },
    },
    { port: 0 },
  );
  const { port } = await server.start();

  const req = (method: string, pathName: string, headers: Record<string, string>, body?: string) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const r = http.request(
        { host: LOOPBACK_HOST, port, path: pathName, method, headers: { 'content-type': 'application/json', ...headers } },
        (res) => {
          let buf = '';
          res.on('data', (c) => (buf += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: buf }));
        },
      );
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });

  try {
    // R3：恶意 Origin POST shutdown ⇒ 403，shutdown spy 0，服务不退出。
    const evilShutdown = await req('POST', '/api/shutdown', { origin: EVIL_ORIGIN });
    assert.equal(evilShutdown.status, 403);
    assert.equal(calls.shutdown, 0);
    const healthAfter = await req('GET', '/api/health', {});
    assert.equal(healthAfter.status, 200, 'daemon 不得退出');

    // R4(daemon)：非法 Host ⇒ 403。
    const badHost = await req('POST', '/api/shutdown', { host: `evil.example:${port}` });
    assert.equal(badHost.status, 403);
    assert.equal(calls.shutdown, 0);

    // R6(daemon)：无 Origin 的 dsl/watch 命中限期兼容 ⇒ 放行，spy 各 1 次。
    const dsl = await req('POST', '/api/dsl', { host: `${LOOPBACK_HOST}:${port}` }, JSON.stringify({ feature: 'p1-fixture', ops: { action: 'noop' } }));
    assert.equal(dsl.status, 200, dsl.body);
    assert.equal(calls.dsl, 1);

    const watch = await req('POST', '/api/watch', { host: `${LOOPBACK_HOST}:${port}` }, JSON.stringify({ project_dir: PROJECT }));
    assert.equal(watch.status, 200, watch.body);
    assert.equal(calls.watch, 1);

    // shutdown 无 Origin：零调用者，不默认兼容 ⇒ 403。
    const shutdownNoOrigin = await req('POST', '/api/shutdown', { host: `${LOOPBACK_HOST}:${port}` });
    assert.equal(shutdownNoOrigin.status, 403);
    assert.equal(calls.shutdown, 0);

    // R4 对照：合法回环 Host 的 health 可用。
    const health = await req('GET', '/api/health', { host: `${LOOPBACK_HOST}:${port}` });
    assert.equal(health.status, 200);
  } finally {
    await server.stop();
  }
});

// ────────────────────────────────────────────────────────────────────────
// 守护：兼容条目未过期（对照 ACTION_EFFECT_COMPAT.expiresAt）
// ────────────────────────────────────────────────────────────────────────
test('daemon-dsl-watch-compat-unexpired：两条兼容条目在当前时钟下均未过期', () => {
  const now = new Date().toISOString();
  for (const entry of ACTION_EFFECT_COMPAT) {
    assert.ok(Date.parse(now) <= Date.parse(entry.expiresAt), `${entry.actionKey} 已过期，必须撤下兼容条目`);
  }
});

after(() => {
  // Windows 上 cache.db 句柄关闭后再删临时目录，避免 EBUSY。
  closeAllProjectCacheDbs();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* 临时目录可残留；不触真实项目 */
  }
});
