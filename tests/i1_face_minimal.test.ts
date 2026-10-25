/**
 * I1 · 第 9 条：face=minimal 档。
 *
 * 判据（寄风批准）：AGENT_IO_MCP_FACE=minimal 只暴露高频 10 项能力（edit_dsl / get_dsl / edit_code /
 * consistency_check / task 系 publish-claim-start-complete / capability_map / index_integrity / pending）。
 * 其中 task 系与 pending 分别是 edit_dsl 的 op 与 get_dsl 的 query（非独立工具）⇒ 注册 6 个工具；
 * all / composed 原样保留（兼容）。
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const HOME = process.env.AGENT_IO_HOME; // 沿用本进程其它测试可能设置的值；本文件不读存储

process.env.AGENT_IO_MCP_FACE = 'minimal';
const { mcpFace, facesOf, MINIMAL_FACE_TOOLS } = await import('../src/application/meta/registry/tool_faces.js');
const { TOOL_DEFS } = await import('../src/application/tool_registry.js');
const { catalogOf, LANE_META } = await import('../src/application/meta/registry/capability_map.js');
const { ATOMIC_ENTRY_NAME } = await import('../src/presentation/mcp/server_registry.js');

after(() => {
  delete process.env.AGENT_IO_MCP_FACE;
  void HOME;
});

test('mcpFace：env=minimal ⇒ minimal；all/composed 保留（兼容）', () => {
  assert.equal(mcpFace(), 'minimal');
  process.env.AGENT_IO_MCP_FACE = 'composed';
  assert.equal(mcpFace(), 'composed');
  process.env.AGENT_IO_MCP_FACE = 'all';
  assert.equal(mcpFace(), 'all');
  delete process.env.AGENT_IO_MCP_FACE;
  assert.equal(mcpFace(), 'all'); // 缺省 = all（不打断现有下游）
  process.env.AGENT_IO_MCP_FACE = 'minimal';
});

test('minimal 名单 = 批准的 6 个真实工具名（task 系/pending 由 edit_dsl/get_dsl 承载，不重复列）', () => {
  assert.deepEqual(
    [...MINIMAL_FACE_TOOLS].sort(),
    ['capability_map', 'consistency_check', 'edit_code', 'edit_dsl', 'get_dsl', 'index_integrity'].sort(),
  );
  const names = new Set(TOOL_DEFS.map((d) => d.name));
  for (const n of MINIMAL_FACE_TOOLS) assert.ok(names.has(n), `minimal 名单里的 ${n} 必须是真实注册工具`);
});

test('facesOf：minimal 视图列出全部名单且无跨层漂移（unknown 为空）', () => {
  const faces = facesOf(catalogOf(TOOL_DEFS), LANE_META.flatMap((m) => m.direct));
  const minimal = faces.find((f) => f.id === 'minimal');
  assert.ok(minimal, 'facesOf 必须产出 minimal 视图');
  assert.equal(minimal.names.length, MINIMAL_FACE_TOOLS.length);
  assert.deepEqual(minimal.unknown, []);
  // all/composed 仍在（兼容）：atomic = 全部，composed ⊇ minimal 不必成立（两份依据不同），但两者都必须在
  assert.ok(faces.some((f) => f.id === 'atomic' && f.names.length === TOOL_DEFS.length));
  assert.ok(faces.some((f) => f.id === 'composed' && f.names.length > 0));
});

test('minimal 面语义自足：批准清单里非工具的两项确由前两个工具承载（防清单与能力脱节）', () => {
  const editDsl = TOOL_DEFS.find((d) => d.name === 'edit_dsl');
  const getDsl = TOOL_DEFS.find((d) => d.name === 'get_dsl');
  // task publish/claim/start/complete 是 edit_dsl 的 op（type=task）
  assert.match(editDsl.description, /publish/);
  assert.match(editDsl.description, /claim/);
  // pending 是 get_dsl 的 query
  assert.match(getDsl.description, /pending/);
  void ATOMIC_ENTRY_NAME; // minimal 面也注册原子入口（由 server_registry 的 face!=='all' 分支保证，见注册测试缺口说明）
});
