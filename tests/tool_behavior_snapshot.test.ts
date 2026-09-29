/**
 * G8 · 逐工具行为快照门 —— 「**不退化即可**」的机器判据（用户判据，2026-09-28）
 *
 * 用户对重构验收的要求：
 *   > "一个一个地去每个工具的剪，只剪它的唯一一条链路，然后**只保证这个工具功能完成就可以，
 *   >  就是不退化即可**"
 * G1（工具集快照）守的是**对外契约**（名字/描述/schema）。本门守的是**行为**：
 * 每个注册工具用 `{}` 调一次，**规范化后的输出**必须与基线逐字相同。
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
 * ★★ 「测量集」：输出是**仓库自身内容**的函数，字节快照**在设计上就是错的** ⇒ 改成结构性断言。
 *
 * 成员与**证据来源**（两者都是实测，不是猜）：
 * 1. `harvest_decisions` —— **全量套件跑出来的**：它扫 `docs/` + git log，我往规划书加了 2 节文档，
 *    输出就从 `180 条决策候选（doc 178）` 变成 `182 条（doc 180）`。
 * 2. `index_integrity` —— **扰动实验跑出来的**：往 `src/` 加一个临时文件，它的输出就变
 *    （它是索引自检工具，量的是本仓文件集）。
 *
 * ⚠️ 扰动实验的**已知局限**（如实记下）：我用"往 docs 追加一行 HTML 注释"作扰动，
 * **没能**触发 `harvest_decisions`（扰动太弱）；而用"加一个 src 文件"只测出 `index_integrity`。
 * ⇒ 该实验能**确认**成员，但**不能**证明"不在集合里的就一定稳定" ⇒ 所以集合必须
 * **经验（扰动/套件）+ 登记**双轨：新发现的成员要补进来并写明证据。
 *
 * ★ 纪律：**一个"随被测对象变化"的读数，不能当"不变"的判据** ——
 *   与 G5 那条（"两种状态读数相同的指标不是判据"）**互为镜像**：
 *   G5 治**饱和**（该变却不变），本条治**漂移**（不该变却随对象变）。
 */
const REPO_MEASURING_TOOLS = new Set([
  'harvest_decisions', // 扫 docs/ + git log ⇒ 随仓库文档与提交历史变（证据：全量套件）
  'index_integrity', // 索引自检 ⇒ 随 src 文件集变（证据：扰动实验）
]);

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

/** 捕获全部工具无参调用的行为（不含测量集 —— 它们另做结构断言） */
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
    if (SIDE_EFFECT_TOOLS.has(c.name) || REPO_MEASURING_TOOLS.has(c.name)) continue;
    try {
      const r = (await c.cb({})) as { content?: { text?: string }[]; isError?: boolean } | undefined;
      out.push({ name: c.name, text: normalizeToolOutput(r?.content?.[0]?.text ?? ''), isError: r?.isError === true });
    } catch (e) {
      out.push({ name: c.name, text: 'THROW: ' + ((e as Error)?.message ?? String(e)), isError: true });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 捕获「测量集」的原始输出（不做字节断言，只做结构断言） */
async function captureMeasuringTools(): Promise<Map<string, string>> {
  const captured: Array<{ name: string; cb: (args: Record<string, unknown>) => Promise<unknown> }> = [];
  const fake = {
    registerTool: (name: string, _config: unknown, cb: (args: Record<string, unknown>) => Promise<unknown>) => {
      captured.push({ name, cb });
    },
  };
  registerAllTools(fake as never);
  const out = new Map<string, string>();
  for (const c of captured) {
    if (!REPO_MEASURING_TOOLS.has(c.name)) continue;
    const r = (await c.cb({})) as { content?: { text?: string }[]; isError?: boolean } | undefined;
    out.set(c.name, r?.content?.[0]?.text ?? '');
  }
  return out;
}

describe('G8 · 逐工具行为快照（"不退化即可"）', () => {
  it('每个注册工具（除重活/测量集）的行为与基线逐字相同', async () => {
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

  it('★ 测量集（输出随仓库内容变）只做结构断言，不做字节快照', async () => {
    const measured = await captureMeasuringTools();
    expect(measured.size, '测量集应至少有一个工具（集合写错了？）').toBeGreaterThan(0);
    const problems: string[] = [];
    for (const [name, text] of measured) {
      // 结构：能跑通、非空、没有抛异常、不是错误响应
      if (!text.trim()) problems.push(`${name}: 输出为空`);
      if (/^THROW:|TypeError|ReferenceError/.test(text)) problems.push(`${name}: 抛异常 → ${text.slice(0, 120)}`);
    }
    // harvest_decisions 的**形态**必须在（它是"从仓库抽取决策候选"的报告）
    const hd = measured.get('harvest_decisions') ?? '';
    if (hd) {
      if (!/提取到 \d+ 条决策候选/.test(hd)) problems.push(`harvest_decisions: 报告形态变了（缺"提取到 N 条决策候选"）`);
      if (!/来源分布/.test(hd)) problems.push(`harvest_decisions: 报告形态变了（缺"来源分布"）`);
    }
    expect(problems, `测量集结构断言失败：\n  ${problems.join('\n  ')}`).toEqual([]);
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
