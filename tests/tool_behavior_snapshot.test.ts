/**
 * G8 · 逐工具行为快照门 —— 「**不退化即可**」的机器判据（用户判据，2026-09-28）
 *
 * 用户对重构验收的要求：
 *   > "一个一个地去每个工具的剪，只剪它的唯一一条链路，然后**只保证这个工具功能完成就可以，
 *   >  就是不退化即可**"
 * G1（工具集快照）守的是**对外契约**（名字/描述/schema）。本门守的是**行为**：
 * 66 个工具用 `{}` 调一次，**规范化后的输出**必须与基线逐字相同。
 *
 * ⇒ 于是"剪枝/搬迁有没有弄坏某个工具"从"靠人看"变成**可判**：
 *   剪完跑本门，全绿 = 没有任何工具的行为发生变化 = 不退化。
 *
 * ★ 可行性已实测（不是设想）：66 个工具连调两次，规范化后输出**逐字一致**（0 处漂移）。
 *   规范化只抹掉**本来就会变**的东西，且每一项都写明了理由（见 `normalize`）：
 *   绝对路径 / 时间戳 / 耗时 / pid·端口 / 长十六进制 hash。
 *
 * ★ 为什么"变了就红"而不是棘轮：本门守的是**行为等价**，不是"减债"。
 *   行为变化**要么是 bug（红），要么是有意的改进（那就显式更新基线并记账）** —— 没有第三种。
 *
 * ⚠️ 两个刻意的排除：
 *   1. `run_tests`：无参调用会跑**整个测试套件**（实测 120s+），不适合本门；
 *      它仍被 G1 覆盖（契约层），且仓内另有 `tests/tools/run_tests.test.ts` 专门测它。
 *   2. 输出里**规范化掉**的部分：本门**不保证**路径/时间戳/耗时稳定 —— 那是它们的本性。
 *
 * 更新基线（**只在确认是"有意的行为变更"时**）：
 *   UPDATE_TOOL_BEHAVIOR=1 ./node_modules/.bin/vitest run tests/tool_behavior_snapshot.test.ts
 * 更新后请把这次变更写进 docs/architecture-refactor-plan.md 的台账。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAllTools } from '../src/server_registry';

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(here, 'fixtures', 'tool_behavior_snapshot.json');

/** 无参调用会真的干重活/有副作用 ⇒ 排除（理由见文件头） */
const SIDE_EFFECT_TOOLS = new Set(['run_tests']);

/**
 * 规范化：只抹掉**本来就会变**的部分。每一项都写明理由 —— 否则后人会觉得"这门的判据是软的"。
 */
export function normalizeToolOutput(s: string): string {
  return (
    s
      // 绝对路径（本机 / 项目根各不相同）
      .replace(/[A-Za-z]:[\\/][^\s"'`,)\]]+/g, '<ABS>')
      // 时间戳（ISO 日期或带时间的）
      .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, '<TS>')
      // 耗时（ms / s）
      .replace(/\b\d+(\.\d+)?\s?(ms|s)\b/g, '<DUR>')
      // pid / 端口
      .replace(/\b(pid|port)[=: ]+\d+/gi, '$1=<N>')
      // 长十六进制 hash（内容指纹，随内容变）
      .replace(/\b[0-9a-f]{16,}\b/g, '<HASH>')
  );
}

interface Snapshot {
  name: string;
  /** 规范化后的输出（本门比对的就是它） */
  text: string;
  isError: boolean;
}

/** 捕获全部工具无参调用的行为 */
export async function captureToolBehavior(): Promise<Snapshot[]> {
  const captured: Array<{ name: string; cb: (args: Record<string, unknown>) => Promise<unknown> }> = [];
  const fake = {
    registerTool: (name: string, _config: unknown, cb: (args: Record<string, unknown>) => Promise<unknown>) => {
      captured.push({ name, cb });
    },
  };
  registerAllTools(fake as never);

  const out: Snapshot[] = [];
  for (const c of captured) {
    if (SIDE_EFFECT_TOOLS.has(c.name)) continue;
    try {
      const r = (await c.cb({})) as { content?: { text?: string }[]; isError?: boolean } | undefined;
      out.push({ name: c.name, text: normalizeToolOutput(r?.content?.[0]?.text ?? ''), isError: r?.isError === true });
    } catch (e) {
      out.push({ name: c.name, text: 'THROW: ' + ((e as Error)?.message ?? String(e)), isError: true });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

describe('G8 · 逐工具行为快照（"不退化即可"）', () => {
  it('66 个工具的行为与基线逐字相同', async () => {
    const cur = await captureToolBehavior();

    if (process.env.UPDATE_TOOL_BEHAVIOR === '1') {
      fs.writeFileSync(BASELINE, JSON.stringify(cur, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`[G8] 基线已更新：${BASELINE}（${cur.length} 个工具）—— 请把这次行为变更写进规划书台账`);
      return;
    }

    expect(fs.existsSync(BASELINE), `基线缺失：${BASELINE}；用 UPDATE_TOOL_BEHAVIOR=1 生成`).toBe(true);
    const base = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) as Snapshot[];
    expect(cur.length, `工具数变了：基线 ${base.length} → 当前 ${cur.length}`).toBe(base.length);

    const byName = new Map(base.map((b) => [b.name, b]));
    const problems: string[] = [];
    for (const c of cur) {
      const b = byName.get(c.name);
      if (!b) {
        problems.push(`${c.name}: 基线里没有（新增工具？）`);
        continue;
      }
      if (b.isError !== c.isError) {
        problems.push(`${c.name}: isError ${b.isError} → ${c.isError}`);
        continue;
      }
      if (b.text !== c.text) {
        // 报**首次分歧点**，比"整段不等"有用得多
        let i = 0;
        while (i < b.text.length && i < c.text.length && b.text[i] === c.text[i]) i++;
        problems.push(
          `${c.name}: 输出在 @${i} 处分歧\n      基线: …${JSON.stringify(b.text.slice(Math.max(0, i - 30), i + 60))}\n      当前: …${JSON.stringify(c.text.slice(Math.max(0, i - 30), i + 60))}`,
        );
      }
    }
    const missing = base.map((b) => b.name).filter((n) => !cur.some((c) => c.name === n));
    for (const n of missing) problems.push(`${n}: 基线里有但当前没跑（被删了？）`);

    expect(
      problems,
      `工具行为发生变化（剪枝/搬迁不该改变行为；若是有意的改进，请 UPDATE_TOOL_BEHAVIOR=1 并在台账记账）：\n  ${problems.join('\n  ')}`,
    ).toEqual([]);
  }, 60_000);

  it('规范化器自身有效（抹掉该抹的、保留该留的）', () => {
    expect(normalizeToolOutput('see D:/a/b/c.ts for details')).toBe('see <ABS> for details');
    expect(normalizeToolOutput('at 2026-09-28T07:45:25.123Z done')).toBe('at <TS> done');
    expect(normalizeToolOutput('took 1234ms')).toBe('took <DUR>');
    expect(normalizeToolOutput('pid=8899 port: 7600')).toBe('pid=<N> port=<N>');
    // ★ 不该被抹掉的：工具名、错误信息、计数
    expect(normalizeToolOutput('find_references: 3 hits')).toBe('find_references: 3 hits');
    expect(normalizeToolOutput('Error: 未找到项目根')).toBe('Error: 未找到项目根');
  });
});
