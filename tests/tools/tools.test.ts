/**
 * get_dsl / get_dsl(query=features) 工具测试
 *
 * 覆盖 e2e 未触及的边界场景：
 * - get_dsl 找不到 feature 时抛错
 * - features 查询：空列表返回提示 / 排序 / 统计文件数·决策数·不变式数 / status 默认 draft
 *
 * ★ 2026-09-29：本文件的 `list_features` 组原先 import `src/tools/list_features.ts`。
 *   该模块是**死代码**（`query_feature.ts` 的 `features` 分支是它的**严格超集** —— 多"决策"计数
 *   与结构化 `data`，且 `src/registry/handlers.ts` 的 `get_dsl` 工具直接走 `queryFeature`）
 *   ⇒ 模块已删（用户裁定"不留墓碑"）。
 *   ★ **断言一条没少**：5 条行为契约**原样迁到活入口** `queryFeature({ query: 'features' })`，
 *   并补一条"结构化 `data` 也回来了"（死模块根本给不出，这是删除的**收益**而非代价）。
 *   ★ 为什么不能连测试一起删：测试是**行为契约**，死模块可以死，契约必须继续被守。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderDesign } from '../../src/tools/render_design';
import { getDsl } from '../../src/tools/get_dsl';
import { queryFeature } from '../../src/tools/query_feature';
import { clearAllFeatures } from '../../src/storage';
import type { DesignDSL } from '../../src/dsl/types';

function makeDSL(feature: string, status: DesignDSL['status']): DesignDSL {
  return {
    id: `id_${feature}`,
    type: 'feature_diagram',
    feature,
    status,
    geometry: {
      layout: 'free',
      width: 200,
      height: 100,
      nodes: [{ id: 'n1', x: 0, y: 0, width: 100, height: 50, label: 'n1' }],
    },
    semantic: {
      files: [
        { id: 'n1', path: `${feature}.go`, responsibility: 'r' },
      ],
      multi_file_invariants: status === 'done' ? ['inv1', 'inv2'] : [],
    },
  };
}

describe('get_dsl', () => {
  beforeEach(() => clearAllFeatures());
  afterEach(() => clearAllFeatures());

  it('feature 不存在时抛错', () => {
    expect(() => getDsl({ feature_name: 'not_exist' })).toThrow(/feature not found/);
  });

  it('能读回已保存的 DSL', () => {
    const dsl = makeDSL('alpha', 'in_progress');
    renderDesign({ dsl_json: JSON.stringify(dsl) });
    const result = getDsl({ feature_name: 'alpha' });
    const parsed = JSON.parse(result.json);
    expect(parsed.feature).toBe('alpha');
    expect(parsed.status).toBe('in_progress');
  });

  it('feature 名含特殊字符时抛错（路径安全）', () => {
    expect(() => getDsl({ feature_name: '../etc/passwd' })).toThrow(/非法 feature 名/);
    expect(() => getDsl({ feature_name: 'a/b' })).toThrow(/非法 feature 名/);
    expect(() => getDsl({ feature_name: 'a b' })).toThrow(/非法 feature 名/);
  });
});

describe('get_dsl(query=features) —— 原 list_features 的行为契约（模块已删，契约保留）', () => {
  beforeEach(() => clearAllFeatures());
  afterEach(() => clearAllFeatures());

  it('无 feature 时返回提示', () => {
    const result = queryFeature({ query: 'features' });
    expect(result.data).toEqual([]);
    expect(result.message).toContain('尚无');
  });

  it('单个 feature 正确列出', () => {
    renderDesign({ dsl_json: JSON.stringify(makeDSL('alpha', 'done')) });
    const result = queryFeature({ query: 'features' });
    expect(result.data).toHaveLength(1);
    expect(result.message).toContain('alpha');
    expect(result.message).toContain('done');
    expect(result.message).toContain('1 文件');
    expect(result.message).toContain('2 不变式');
  });

  it('多个 feature 按字母序排列', () => {
    renderDesign({ dsl_json: JSON.stringify(makeDSL('zeta', 'draft')) });
    renderDesign({ dsl_json: JSON.stringify(makeDSL('alpha', 'draft')) });
    renderDesign({ dsl_json: JSON.stringify(makeDSL('middle', 'draft')) });
    const result = queryFeature({ query: 'features' });
    expect(result.data).toHaveLength(3);
    // alpha 应该在 zeta 之前
    const alphaIdx = result.message.indexOf('alpha');
    const middleIdx = result.message.indexOf('middle');
    const zetaIdx = result.message.indexOf('zeta');
    expect(alphaIdx).toBeLessThan(middleIdx);
    expect(middleIdx).toBeLessThan(zetaIdx);
  });

  it('draft 状态的 feature 无不变式时不显示不变式计数异常', () => {
    renderDesign({ dsl_json: JSON.stringify(makeDSL('draft_one', 'draft')) });
    const result = queryFeature({ query: 'features' });
    expect(result.message).toContain('0 不变式');
  });

  it('status 默认 draft（DSL 未设 status 时）', () => {
    const dsl = makeDSL('no_status', 'done');
    delete dsl.status;
    renderDesign({ dsl_json: JSON.stringify(dsl) });
    const result = queryFeature({ query: 'features' });
    expect(result.message).toContain('no_status');
    expect(result.message).toContain('draft');
  });

  it('★ 结构化 data 也回来（死模块给不出 ⇒ 这是删掉它的收益）', () => {
    const dsl = makeDSL('alpha', 'done');
    dsl.geometry.nodes.push({ id: 'n2', x: 0, y: 60, width: 100, height: 50, label: 'n2', decision: 'd1' });
    renderDesign({ dsl_json: JSON.stringify(dsl) });
    const result = queryFeature({ query: 'features' });
    expect(result.data).toEqual([
      { id: 'id_alpha', feature: 'alpha', status: 'done', decisions: 1 },
    ]);
    expect(result.message).toContain('1 决策');
  });
});
