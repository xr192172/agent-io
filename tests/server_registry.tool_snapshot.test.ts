/**
 * G1 · 工具集快照门 —— **对外契约不许漂移**（重构规划书 §5-G1，P1 的前置）
 *
 * 为什么必须先有它：P1/P2 要动 `server_registry.ts`（3,586 行）与 `src/tools/`（200 文件 / 71k 行）。
 * 搬迁本身"零行为变化"的说法需要一个**与文件位置无关**的判据来兜底 ——
 * 否则"搬完了"只能靠人看 diff，而 71k 行的 diff 没人看得完。
 *
 * ★ 快照的是什么：不是"重新推导一遍"，而是**注册时真正传给 SDK 的东西** ——
 *   用假 server 捕获 `registerTool(name, config, cb)` 的入参，把 `config.inputSchema`
 *   经 zod v4 原生 `z.toJSONSchema()` 转成 JSON Schema。
 *   这正是 MCP 客户端实际收到的契约（`looseInputSchema` 的包装也已包含在内）。
 *
 * ★ 顺序不是契约：按 name 排序后比较。
 *   理由：lane 拆分（P1）会改变 `TOOL_DEFS` 的数组顺序，但 MCP 工具是**按名寻址**的，
 *   顺序对客户端无语义。把顺序当契约会让"按 lane 重组"变成不可做的操作，
 *   而真正的契约（名字 / 标题 / 描述 / schema）一条都不会因此放松 ——
 *   这三样任一变化都会红。这是**有意放宽 + 写明理由**，不是漏判。
 *
 * ★ 基线怎么更新：只在**确认是故意的契约变更**时执行
 *     `UPDATE_TOOL_SNAPSHOT=1 ./node_modules/.bin/vitest run tests/server_registry.tool_snapshot.test.ts`
 *   更新后请把这次变更写进 `docs/architecture-refactor-plan.md` 的进度台账
 *   （对外契约变更属于要单独拍板的类别，见该文档 §6-5）。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { registerAllTools } from '../src/server_registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(here, 'fixtures', 'tool_set_snapshot.json');

export interface ToolSnap {
  name: string;
  title: string;
  description: string;
  /** 客户端实际看到的 inputSchema（JSON Schema） */
  schema: unknown;
}

interface RegisteredConfig {
  title?: string;
  description?: string;
  inputSchema?: unknown;
}

/** 捕获"注册时真正传给 SDK 的东西"—— 与 `server_registry.stale_build.test.ts` 同一套假 server 手法 */
export function captureRegisteredTools(): ToolSnap[] {
  const captured: Array<{ name: string; config: RegisteredConfig }> = [];
  const fakeServer = {
    registerTool: (name: string, config: RegisteredConfig) => {
      captured.push({ name, config });
    },
  };
  registerAllTools(fakeServer as never);
  return captured
    .map((c) => ({
      name: c.name,
      title: c.config?.title ?? '',
      description: c.config?.description ?? '',
      schema: z.toJSONSchema(c.config?.inputSchema as never),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface SnapDiff {
  added: string[];
  removed: string[];
  changed: Array<{ name: string; fields: string[] }>;
}

/**
 * 纯函数：两份快照的差异（按 name 对齐，逐字段列出）。
 * 单独抽出来是为了能对"差异检测器本身"做单测 ——
 * 否则门一旦永远返回空差异，它是绿的但毫无意义（G5 那条教训的同款陷阱）。
 */
export function diffSnapshots(base: ToolSnap[], cur: ToolSnap[]): SnapDiff {
  const b = new Map(base.map((e) => [e.name, e]));
  const c = new Map(cur.map((e) => [e.name, e]));
  const added = [...c.keys()].filter((n) => !b.has(n)).sort();
  const removed = [...b.keys()].filter((n) => !c.has(n)).sort();
  const changed: Array<{ name: string; fields: string[] }> = [];
  for (const n of [...b.keys()].filter((n) => c.has(n)).sort()) {
    const x = b.get(n)!;
    const y = c.get(n)!;
    const fields: string[] = [];
    if (x.title !== y.title) fields.push('title');
    if (x.description !== y.description) fields.push('description');
    if (JSON.stringify(x.schema) !== JSON.stringify(y.schema)) fields.push('inputSchema');
    if (fields.length > 0) changed.push({ name: n, fields });
  }
  return { added, removed, changed };
}

describe('G1 · 差异检测器自身有效（证明这道门会红）', () => {
  const a: ToolSnap = { name: 't', title: 'T', description: 'D', schema: { type: 'object' } };
  it('完全相同 → 无差异', () => {
    expect(diffSnapshots([a], [a])).toEqual({ added: [], removed: [], changed: [] });
  });
  it('title / description / schema 任一改动都能检出', () => {
    expect(diffSnapshots([a], [{ ...a, title: 'T2' }]).changed).toEqual([{ name: 't', fields: ['title'] }]);
    expect(diffSnapshots([a], [{ ...a, description: 'D2' }]).changed).toEqual([{ name: 't', fields: ['description'] }]);
    expect(diffSnapshots([a], [{ ...a, schema: { type: 'string' } }]).changed).toEqual([{ name: 't', fields: ['inputSchema'] }]);
  });
  it('新增 / 删除工具能检出', () => {
    const b: ToolSnap = { name: 'u', title: 'U', description: 'D', schema: {} };
    expect(diffSnapshots([a], [a, b]).added).toEqual(['u']);
    expect(diffSnapshots([a, b], [a]).removed).toEqual(['u']);
  });
  it('顺序不同不算差异（顺序不是契约 —— 见文件头说明）', () => {
    const b: ToolSnap = { name: 'a', title: 'A', description: 'D', schema: {} };
    expect(diffSnapshots([a, b], [b, a])).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe('G1 · 工具集对外契约快照', () => {
  it('与基线逐字一致（名字 / 标题 / 描述 / inputSchema）', () => {
    const cur = captureRegisteredTools();

    if (process.env.UPDATE_TOOL_SNAPSHOT === '1') {
      fs.writeFileSync(BASELINE, JSON.stringify(cur, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`[G1] 基线已更新：${BASELINE}（${cur.length} 个工具）—— 请把这次契约变更写进规划书台账`);
      return;
    }

    expect(fs.existsSync(BASELINE), `基线缺失：${BASELINE}；用 UPDATE_TOOL_SNAPSHOT=1 生成`).toBe(true);
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) as ToolSnap[];

    // 先报"数量"这一层，让最常见的错误一眼可见
    expect(cur.length, `工具数变了：基线 ${base.length} → 当前 ${cur.length}`).toBe(base.length);

    const d = diffSnapshots(base, cur);
    expect(
      d.added,
      `新增工具（对外契约变更，需单独拍板）：\n  ${d.added.join('\n  ')}`,
    ).toEqual([]);
    expect(
      d.removed,
      `删除工具（对外契约变更，需单独拍板）：\n  ${d.removed.join('\n  ')}`,
    ).toEqual([]);
    expect(
      d.changed.map((c) => `${c.name} → ${c.fields.join(', ')}`),
      `以下工具的契约字段变了（P1/P2 搬迁本不该动它们）：\n  ${d.changed.map((c) => `${c.name}: ${c.fields.join(', ')}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('每个工具的 schema 都是可序列化的合法 JSON Schema 对象', () => {
    const cur = captureRegisteredTools();
    const bad: string[] = [];
    for (const t of cur) {
      const s = t.schema as Record<string, unknown> | null;
      if (!s || typeof s !== 'object' || Array.isArray(s)) bad.push(`${t.name}: schema 非对象`);
      else if (s.type !== 'object') bad.push(`${t.name}: 顶层 type=${String(s.type)}（应为 object）`);
    }
    expect(bad, `schema 形态异常：\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
