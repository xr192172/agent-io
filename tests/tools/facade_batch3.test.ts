/**
 * 面收敛**第三批** —— 三个单入口的工具层测试（`scaffold` / `design_intent` / `memory_observe`）
 *
 * ★ 2026-09-29（面收敛第三批）：本笔把三族各 2 个**注册入口**收敛为 1 个入口 + action 枚举。
 *   判据（`docs/tool-convergence.md` §2.0）：**按「操作对象」聚合**，不按前缀/实现机制：
 *     · `scaffold`（action=generate / backfill）—— 同一对象「脚手架输出目录 `<cwd>/scaffold/<feature>/`」，
 *       两个 [B] 的默认目录**逐字相同**（`output_dir` vs `scaffold_dir`，值等价），动作互补 = **生成 + 回填**；
 *     · `design_intent`（action=set / propose）—— 同一对象「设计意图 overlay（goals + edge_intents）」，
 *       propose 是 set 的"先请人批再落"前置闸（复用 set 的写端）；
 *     · `memory_observe`（新增 action=targets）—— 同一对象「目标 node 进程（--inspect）」，
 *       一个是"选 target 的那一端"、一个是"用 target 诊断"。
 *
 * 为什么这层测试值得单写（判据要落成机器可判的）：
 *   ① 收敛**不许丢能力**：生成的骨架文件真落盘、回填真解析出 actual_apis、
 *      `design_intent(action=set)` 真写 overlay/base、`action=propose` 真产出 pending 提案；
 *   ② 新入口自己的**前置校验**：缺 feature / 未知 action ⇒ 明确报错（而不是拿 `undefined` 当 feature 名）；
 *   ③ ★ 本笔**没有**给任何一族硬加 `dry_run`（三族语义与旧入口逐字相同），这条"没改"也要被钉住：
 *      description 必须写明「默认目录 / 默认不覆盖 / propose 不写盘 / target 除 targets 外必填」。
 *
 * ★ 旧注册名**不出现在本文件**（`contract_docs_gate` 会把旧名的任何字符串/注释判成"改名残留"）。
 *   "旧入口已消失"由 **G1 快照基线**的 `removed` 差集机器证明（`tests/fixtures/tool_set_snapshot.json`），
 *   本文件只钉"新入口能力齐 + 工具总数"。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { getDSL, saveDSL } from '../../src/infrastructure/storage.js';
import type { DesignDSL } from '../../src/domain/types';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as { description: string; handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }> };
};

/** 调用工具并拆开 MCP 文本（`message\n---DATA---\n<json>`）—— 见 wrapData 契约 */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ message: string; data: Record<string, unknown>; isError: boolean }> {
  const r = await def(name).handler(args);
  const [message, dataRaw] = r.text.split('\n---DATA---\n');
  return {
    message: message ?? '',
    data: dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {},
    isError: r.isError === true,
  };
}

let home: string;
let work: string;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'facade3_home_'));
  work = mkdtempSync(path.join(tmpdir(), 'facade3_work_'));
  process.env.AGENT_IO_HOME = home;
});

afterEach(() => {
  delete process.env.AGENT_IO_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(work, { recursive: true, force: true });
});

/** 最小 DSL：一条 a→b 边 + 可选一个语义文件（骨架/回填/意图三条路都要它） */
function seed(feature: string, opts: { withFile?: boolean } = {}) {
  const files = opts.withFile
    ? [{ id: 'f_a', path: 'a.ts', responsibility: '测试文件', expected_apis: [{ signature: 'hello(): void' }] }]
    : [];
  saveDSL({
    feature,
    geometry: {
      nodes: [
        { id: 'a', label: 'A', x: 0, y: 0, width: 100, height: 40 },
        { id: 'b', label: 'B', x: 0, y: 0, width: 100, height: 40 },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'b' }],
    },
    semantic: files.length ? { files } : undefined,
  } as unknown as DesignDSL);
}

describe('第三方单入口 · 工具总数', () => {
  it('★ 对外工具数 = 58（三族各 2→1，61 → 58）；旧入口的消失由 G1 的 removed 差集证明', () => {
    // ★ 不在本文件重抄旧注册名（抄了 `contract_docs_gate` 会判"改名残留"）——
    //   旧名已消失这件事由 tests/fixtures/tool_set_snapshot.json 的 removed 差集钉住（G1）。
    expect(TOOL_DEFS).toHaveLength(58);
  });
});

describe('scaffold 单入口（action=generate / backfill）', () => {
  it('已注册；description 写明两个 action + 默认目录 + 默认不覆盖 + backfill 只写 DSL', () => {
    const desc = def('scaffold').description;
    expect(desc.length).toBeGreaterThan(80);
    for (const k of ['action=generate', 'action=backfill', 'scaffold/<feature>', '不覆盖', '只写 DSL']) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
  });

  it('★ 前置校验：缺 feature / 未知 action ⇒ 明确报错（含可选值）', async () => {
    const noFeature = await call('scaffold', { action: 'generate' });
    expect(noFeature.isError).toBe(true);
    expect(noFeature.message).toContain('feature');

    const badAction = await call('scaffold', { action: 'nope', feature: 'x' });
    expect(badAction.isError).toBe(true);
    expect(badAction.message).toContain('generate');
    expect(badAction.message).toContain('backfill');
  });

  it('★ 能力不丢 · generate：骨架文件真落盘，回执给出 files + dir', async () => {
    seed('sc_gen', { withFile: true });
    const out = path.join(work, 'gen');
    const r = await call('scaffold', { action: 'generate', feature: 'sc_gen', output_dir: out });
    expect(r.isError).toBe(false);
    expect(r.data.action).toBe('generate');
    expect(Array.isArray(r.data.files)).toBe(true);
    expect((r.data.files as string[]).length).toBeGreaterThan(0);
    expect(path.resolve(String(r.data.dir))).toBe(path.resolve(out));
    expect(existsSync(path.join(out, 'a.ts'))).toBe(true);
  });

  it('★ 能力不丢 · backfill：解析实现文件回填 actual_apis，回执给出 updates', async () => {
    seed('sc_bf', { withFile: true });
    writeFileSync(path.join(work, 'a.ts'), 'export function hello(): void {}\n', 'utf8');
    const r = await call('scaffold', { action: 'backfill', feature: 'sc_bf', scaffold_dir: work });
    expect(r.isError).toBe(false);
    expect(r.data.action).toBe('backfill');
    expect(r.data.feature).toBe('sc_bf');
    const updates = r.data.updates as Array<{ id: string; actual_count: number }>;
    expect(Array.isArray(updates)).toBe(true);
    expect(updates[0]!.id).toBe('f_a');
    expect(updates[0]!.actual_count).toBeGreaterThan(0); // 真解析到了 hello()
  });
});

describe('design_intent 单入口（action=set / propose）', () => {
  it('已注册；description 写明两个 action + propose 不写盘 + 须人 approve', () => {
    const desc = def('design_intent').description;
    expect(desc.length).toBeGreaterThan(80);
    for (const k of ['action=set', 'action=propose', '不写盘', 'approve']) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
  });

  it('★ 前置校验：缺 feature / 未知 action ⇒ 明确报错', async () => {
    const noFeature = await call('design_intent', { action: 'set' });
    expect(noFeature.isError).toBe(true);
    expect(noFeature.message).toContain('feature');

    seed('di_x');
    const badAction = await call('design_intent', { action: 'nope', feature: 'di_x' });
    expect(badAction.isError).toBe(true);
    expect(badAction.message).toContain('set');
    expect(badAction.message).toContain('propose');
  });

  it('★ 能力不丢 · set：goals / edge_intents 真写进 overlay + base（立即可读）', async () => {
    seed('di_set');
    const r = await call('design_intent', {
      action: 'set',
      feature: 'di_set',
      goals: [{ id: 'g1', title: '统一读端', status: 'active' }],
      edge_intents: [{ from: 'a', to: 'b', reason: 'A 依赖 B 的缓存' }],
    });
    expect(r.isError).toBe(false);
    expect(r.data.feature).toBe('di_set');
    expect(r.data.goals).toBe(1);
    expect(r.data.edges_written).toEqual([{ id: 'e1', from: 'a', to: 'b' }]);

    const dsl = getDSL('di_set')!;
    expect((dsl as unknown as { meta?: { goals?: unknown[] } }).meta?.goals).toHaveLength(1);
    expect(dsl.geometry.edges[0]?.intent?.reason).toBe('A 依赖 B 的缓存');
  });

  it('★ 能力不丢 · propose：只算提案、不写盘 ⇒ pending 审批卡；缺 goals/edge_intents ⇒ 报错', async () => {
    seed('di_prop');
    const noPayload = await call('design_intent', { action: 'propose', feature: 'di_prop', project_dir: work });
    expect(noPayload.isError).toBe(true);
    expect(noPayload.message).toContain('goals');

    const r = await call('design_intent', {
      action: 'propose',
      feature: 'di_prop',
      project_dir: work,
      goals: [{ id: 'g2', title: '改方向', status: 'active' }],
    });
    expect(r.isError).toBe(false);
    expect(r.data.action).toBe('propose');
    expect(r.data.ok).toBe(true);
    const proposal = r.data.proposal as { id: string; status: string; label: string };
    expect(typeof proposal.id).toBe('string');
    expect(proposal.status).toBe('pending');
    // ★ propose **不写盘**：DSL 的 meta.goals 仍为空（只有 approve 才落）
    expect(((getDSL('di_prop') as unknown as { meta?: { goals?: unknown[] } }).meta?.goals ?? [])).toEqual([]);
  });
});

describe('memory_observe 单入口（并入 action=targets）', () => {
  it('已注册；description 写明 action=targets + 除 targets 外 target 必填', () => {
    const desc = def('memory_observe').description;
    expect(desc).toContain('targets');
    expect(desc).toContain('必填');
  });

  it('★ action=targets：不需要 target，返回进程清单（data 为数组，不报错）', async () => {
    const r = await call('memory_observe', { action: 'targets' });
    expect(r.isError).toBe(false);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('★ 其余 action 缺 target ⇒ 明确报错，且报错文案指向 action=targets', async () => {
    const r = await call('memory_observe', { action: 'status' });
    expect(r.isError).toBe(true);
    expect(r.message).toContain('target');
    expect(r.message).toContain('targets');
  });
});
