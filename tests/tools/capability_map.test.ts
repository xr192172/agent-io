/**
 * capability_map 能力线导航 —— 目录派生 + 渲染
 *
 * ★ 关键变化（2026-09-14）：目录不再手抄，测试也不再自带工具清单。
 *   旧版测试里有一份手写的 55 工具清单（等于第三份副本）—— 工具增删它不会红，
 *   所以 capability_map 漏掉 memory_observe/go_originals 等 4 个工具时它照样绿。
 *   现在直接对**真实 TOOL_DEFS**断言：注册了没归线 → 本测试红。
 */
import { describe, it, expect } from 'vitest';
import { TOOL_DEFS, laneOfFromSources } from '../../src/presentation/mcp/server_registry.js';
import {
  LANE_IDS,
  LANE_META,
  WHEN_OVERRIDES,
  bindLaneOf,
  resetLaneOfForTest,
  buildLanes,
  validateLanes,
  laneMaintenanceReport,
  renderLaneText,
  renderUnassigned,
  describeForNav,
  makeCapabilityMapHandler,
  type ToolCatalogEntry,
} from '../../src/application/meta/capability_map.js';

/** 真实注册目录（唯一真相源） */
const catalog: ToolCatalogEntry[] = TOOL_DEFS.map((d) => ({
  name: d.name,
  title: d.title,
  description: d.description,
}));
const handler = makeCapabilityMapHandler(() => catalog);

describe('capability_map 目录与注册表同源', () => {
  it('每个注册工具都已归线（漏归 → 红）', () => {
    expect(validateLanes(catalog)).toEqual([]);
  });

  it('工具总数 = 注册表工具数；线内不重复；无陈旧标注', () => {
    const { lanes, unassigned, stale } = buildLanes(catalog);
    const names = lanes.flatMap((l) => l.tools.map((t) => t.name));
    expect(names.length + unassigned.length).toBe(TOOL_DEFS.length);
    expect(unassigned).toEqual([]);
    expect(stale).toEqual([]);
    expect(new Set(names).size).toBe(names.length); // 无跨线重复
  });

  it('6 条能力线，id 与 LANE_META 一致', () => {
    expect(LANE_IDS).toHaveLength(6);
    expect(LANE_META.map((l) => l.id)).toEqual([...LANE_IDS]);
  });

  it('direct 白名单都落在各自线内；并集 = 6 个高频工具', () => {
    const { lanes } = buildLanes(catalog);
    for (const lane of lanes) {
      const names = new Set(lane.tools.map((t) => t.name));
      for (const d of lane.direct) expect(names.has(d), `${lane.id}.direct 含线外工具 ${d}`).toBe(true);
    }
    const directSet = new Set(lanes.flatMap((l) => l.direct));
    expect([...directSet].sort()).toEqual(
      ['get_dsl', 'edit_dsl', 'explore_code', 'rename_symbols', 'rename_files', 'find_references'].sort(),
    );
  });

  it('回归：曾漏归的工具必须在导航里可见', () => {
    const { lanes } = buildLanes(catalog);
    const shown = new Set(lanes.flatMap((l) => l.tools.map((t) => t.name)));
    // ★ 面收敛第三批（2026-09-29）：原独立的「列出本机 --inspect 进程」入口已并进 `memory_observe`
    //   （新增 action=targets）⇒ 它不再是独立注册项，从本回归清单移除。
    for (const n of ['memory_observe', 'go_originals', 'move_symbol', 'capability_map']) {
      expect(shown.has(n), `${n} 未出现在能力线里`).toBe(true);
    }
  });

  it('维护视图：仍有多少 when 是自动摘要（可见的待补清单）', () => {
    const r = laneMaintenanceReport(catalog);
    expect(r.curated + r.derived.length).toBe(TOOL_DEFS.length);
    expect(r.unassigned).toEqual([]);
    expect(r.stale).toEqual([]);
  });
});

describe('目录派生（不依赖真实注册表的部分）', () => {
  it('when 优先级：注入表的 when > WHEN_OVERRIDES > 描述首句自动摘要', () => {
    const mini: ToolCatalogEntry[] = [
      { name: 'get_dsl', description: '统一只读入口：通过 query 参数查询 DSL 数据。后面还有解释。' },
      { name: 'run_tests', description: '运行测试并汇总结果。其余细节省略。' },
      { name: 'brand_new_tool', description: '做某件新事情：一句话说清用途。其余细节省略。' },
    ];
    const { lanes } = buildLanes(mini, {
      get_dsl: { lane: 'design', when: '人工写的时机说明' }, // ① 注入表显式 when 胜出
      run_tests: { lane: 'observe' }, // ② 注入表无 when → 落到 WHEN_OVERRIDES
      brand_new_tool: { lane: 'meta' }, // ③ 两处都没有 → 描述首句
    });
    const all = lanes.flatMap((l) => l.tools);
    const curated = all.find((t) => t.name === 'get_dsl');
    expect(curated?.when).toBe('人工写的时机说明');
    expect(curated?.whenSource).toBe('curated');
    const fromOverrides = all.find((t) => t.name === 'run_tests');
    expect(fromOverrides?.when).toBe(WHEN_OVERRIDES.run_tests);
    expect(fromOverrides?.whenSource).toBe('curated');
    const derived = all.find((t) => t.name === 'brand_new_tool');
    expect(derived?.when).toBe('做某件新事情：一句话说清用途。');
    expect(derived?.whenSource).toBe('derived');
    expect(lanes.find((l) => l.id === 'meta')!.tools.map((t) => t.name)).toEqual(['brand_new_tool']);
  });

  it('未归线的工具不会消失：进 unassigned 段并在渲染里显式暴露', () => {
    const mini: ToolCatalogEntry[] = [{ name: 'totally_unmapped', description: '一个还没归线的新工具。' }];
    const { lanes, unassigned } = buildLanes(mini, {});
    expect(lanes.flatMap((l) => l.tools)).toEqual([]);
    expect(unassigned.map((t) => t.name)).toEqual(['totally_unmapped']);
    const text = renderUnassigned(unassigned);
    expect(text).toContain('未归线工具（1）');
    expect(text).toContain('totally_unmapped');
    expect(text).toContain('一个还没归线的新工具。');
  });

  it('validateLanes 能抓出：漏归线 / 陈旧标注 / direct 越线', () => {
    // ① 漏归线
    const mini: ToolCatalogEntry[] = [{ name: 'orphan_tool', description: '没归线。' }];
    expect(
      validateLanes(mini, {}).some((e) => e === '已注册但未归线：orphan_tool（把它加成 application/<line>/index.ts 里对应线数组的一项）'),
    ).toBe(true);
    // ② 陈旧标注：标注里有、注册目录里没有
    const staleErrs = validateLanes([], { ghost_tool: { lane: 'meta' } });
    expect(staleErrs.some((e) => e.includes('陈旧标注') && e.includes('ghost_tool'))).toBe(true);
    // ③ direct 越线：线内为空而 direct 非空（LANE_META 静态白名单失效）
    const directErrs = validateLanes([], {});
    expect(directErrs.some((e) => e.includes('direct 引用了线外'))).toBe(true);
  });

  it('describeForNav：取首句；过长截断；空描述退回工具名', () => {
    expect(describeForNav({ name: 'x', description: '第一句。第二句。' })).toBe('第一句。');
    expect(describeForNav({ name: 'x', description: 'a'.repeat(200) })).toHaveLength(60);
    expect(describeForNav({ name: 'no_desc_tool' })).toBe('no_desc_tool');
    expect(describeForNav({ name: 'no_desc_tool', title: 'Some title' })).toBe('Some title');
  });

  it('渲染：laneIds=空 出全部线，指定 lane 只出该线', () => {
    const { lanes } = buildLanes(catalog);
    const all = renderLaneText(lanes);
    for (const id of LANE_IDS) expect(all).toContain(`◆ ${id}`);
    const only = renderLaneText(lanes, ['refactor']);
    expect(only).toContain('◆ refactor');
    expect(only).not.toContain('◆ design');
  });
});

describe('P1c：归属表注入（capability_map 不再持有归属清单）', () => {
  it('未注入就派生 ⇒ 抛错，而不是给"看起来能用"的空表', () => {
    resetLaneOfForTest();
    try {
      // 为什么必须抛：空表会让 67 个工具**全部**变成"未归线"，而"未归线"在导航里是
      // **正常可见**的一类（设计如此，防新工具静默消失）—— 于是"忘了注入"会被伪装成
      // "这些工具确实没归线"，静默且极难查。抛错把加载期接线错误变成立刻可见的失败。
      expect(() => buildLanes(catalog)).toThrow(/归属表未注入/);
      expect(() => validateLanes(catalog)).toThrow(/归属表未注入/);
      expect(() => laneMaintenanceReport(catalog)).toThrow(/归属表未注入/);
    } finally {
      bindLaneOf(laneOfFromSources()); // 还原，避免污染后续用例
    }
  });

  it('每个工具的 when 都非空（导航里不出现空条目）', () => {
    const { lanes } = buildLanes(catalog);
    for (const l of lanes) for (const t of l.tools) expect(t.when.trim().length, `${t.name} 的 when 为空`).toBeGreaterThan(0);
  });

  it('WHEN_OVERRIDES 里的陈旧策展文本能被抓出（工具删了、说明忘删）', () => {
    const { staleWhen } = buildLanes([], {});
    expect(staleWhen).toEqual(Object.keys(WHEN_OVERRIDES).sort());
    expect(validateLanes([], {}).some((e) => e.includes('陈旧策展文本') && e.includes('get_dsl'))).toBe(true);
    // 真实注册表下：策展文本与工具集**完全**对上
    expect(laneMaintenanceReport(catalog).staleWhen).toEqual([]);
    expect(Object.keys(WHEN_OVERRIDES)).toHaveLength(TOOL_DEFS.length);
  });
});

describe('capabilityMapHandler 渲染', () => {
  it('无参返回全部 6 线 + 工具数说明', async () => {
    const r = await handler({});
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain('能力线导航');
    expect(r.text).toContain(`${TOOL_DEFS.length} 工具 / 6 线`); // 目录由注册表派生，数目同源
    for (const id of LANE_IDS) expect(r.text).toContain(`◆ ${id}`);
    expect(r.text).toContain('rename_symbols');
    expect(r.text).toContain('run_tests');
    expect(r.text).toContain('memory_observe');
  });

  it('传 lane=refactor 只返回该线', async () => {
    const r = await handler({ lane: 'refactor' });
    expect(r.text).toContain('◆ refactor');
    expect(r.text).not.toContain('◆ design');
    expect(r.text).not.toContain('◆ observe');
  });

  it('未知 lane 返回 isError 并列出可选线', async () => {
    const r = await handler({ lane: 'xyz' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('未知能力线');
    expect(r.text).toContain('design');
  });

  it('目录为空时也不抛异常（注入缺失只表现为空地图）', async () => {
    const empty = makeCapabilityMapHandler(() => []);
    const r = await empty({});
    expect(r.isError).toBeUndefined();
    expect(r.text).toContain('能力线导航');
  });
});
