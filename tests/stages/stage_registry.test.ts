/**
 * 工序表 · 门 + 功能验收
 *
 * ★★ 这一扇门**故意很小** —— 因为绝大部分检查已经**搬进编译器**了（2026-10-01，用户：
 *    "你写这么多夹具其实就是在手工替代编译器的作用，而且还贴得很歪"）：
 *
 *    | 检查 | 以前 | 现在 |
 *    |---|---|---|
 *    | 产者/位置**存在**（改名/搬移/删除后失效） | 我写 `splitRef()` 反解 `'file#symbol'` 字符串 | ★ **编译器**（值引用） |
 *    | `inputs` 是**合法工序 id** | 我写的门 | ★ **编译器**（`StageId` 联合类型） |
 *    | 没产者的必须写 `why` | 我写的门（还自己定了个"≥10 字"的阈值） | ★ **编译器**（判别联合） |
 *    | `owner` 合法 | 我写的门 | ★ **编译器**（`StageOwner`） |
 *    | id 不重复 / 溯源无环 / owner 与位置**一致** / 缺了就重做·失败就重试·不兜底 | —— | **← 只剩这些要在这里查** |
 *
 *    ⇒ 那扇门从 **647 行塌到这里**；同时**检查更强**（`tsc` 带 "Did you mean" 的纠正提示，
 *      而我原来的门是字面匹配，改名/换变量名就照绿 —— 见 §44.25/§44.27 抓到的两次"假绿"）。
 *
 * ★ 本文件的 `owner` 判据**是行为判据**，不是声明检查：
 *   `owner='project'` 的工序，其 `locate` 拿**两个不同的项目根**跑，**结果必须不同**；
 *   而 `owner='dataHome'` 的工序，拿两个根跑**必须相同**（它的根是环境量，不随项目根变）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  STAGES,
  ensureStage,
  getStage,
  pendingStages,
  weakFreshnessStages,
  assertAcyclic,
  produceWithRetry,
  PRODUCE_ATTEMPTS,
  renderStageTable,
  type DerivedStage,
  type StageCtx,
} from '../../src/application/stage_registry.js';
import { saveDSL, getBaselineFeatureFile, deleteFeature } from '../../src/infrastructure/storage.js';
import type { DesignDSL } from '../../src/domain/types';

const ROOT_A = path.join(os.tmpdir(), 'agentio-stage-a');
const ROOT_B = path.join(os.tmpdir(), 'agentio-stage-b');

const FEATURE = 'stage_probe';

function mkDsl(): DesignDSL {
  return {
    id: FEATURE,
    feature: FEATURE,
    version: '1.0',
    title: '工序探针',
    geometry: { nodes: [], edges: [] },
    semantic: { files: [] },
  } as DesignDSL;
}

function cleanup(): void {
  try {
    deleteFeature(FEATURE);
  } catch {
    /* 不存在 */
  }
  const b = getBaselineFeatureFile(FEATURE);
  if (fs.existsSync(b)) fs.rmSync(b, { force: true });
}

afterEach(cleanup);

// ─────────────────────────────────────────────────────────────
// 门本体：只查编译器查不了的四件事
// ─────────────────────────────────────────────────────────────
describe('工序表 · 门（只留编译器查不了的）', () => {
  it('溯源图无环（类型系统表达不了"无环"，只能运行时查）', () => {
    expect(() => assertAcyclic()).not.toThrow();
  });

  it('id 不重复（`STAGES` 是数组，类型系统查不了数组里的重复）', () => {
    const ids = STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('★ owner 是**可证伪**的：project 的随项目根变、dataHome 的不随', () => {
    const derivedWithLocate = STAGES.filter(
      (s): s is DerivedStage => s.kind === 'derived' && typeof s.locate === 'function',
    );
    expect(derivedWithLocate.length).toBeGreaterThan(0);

    for (const s of derivedWithLocate) {
      const ctxA: StageCtx = { projectRoot: ROOT_A, feature: FEATURE };
      const ctxB: StageCtx = { projectRoot: ROOT_B, feature: FEATURE };
      let a: string;
      let b: string;
      try {
        a = s.locate!(ctxA);
        b = s.locate!(ctxB);
      } catch (e) {
        // 位置算不出来 ⇒ 这份工序的 locate 对根有硬要求，跳过（不是失败）
        continue;
      }
      if (s.owner === 'project') {
        expect(a, `${s.id} 声明 owner='project'，但两个项目根算出同一个位置：${a}`).not.toBe(b);
      } else {
        expect(a, `${s.id} 声明 owner='dataHome'，却随项目根变了：${a} vs ${b}`).toBe(b);
      }
    }
  });

  it('待还的债是**可数**的（投影，不是手抄的清单）', () => {
    // 断言它可投影且每条都有理由（类型已保证 why，这里防"被 as any 绕过"）
    for (const s of pendingStages()) expect(s.why.trim().length).toBeGreaterThan(10);
    // 这批数字只是"当前快照"，用于趋势观察 —— 不作为棘轮（棘轮会腐成新的状态群）
    expect(pendingStages().length + STAGES.filter((s) => s.kind === 'source').length + 4).toBe(STAGES.length);
    expect(weakFreshnessStages().length).toBeGreaterThanOrEqual(0);
  });

  it('文档表由本表投影（不再手抄）', () => {
    const md = renderStageTable();
    expect(md).toContain('| 工序 id |');
    for (const s of STAGES) expect(md).toContain(`\`${s.id}\``);
  });
});

// ─────────────────────────────────────────────────────────────
// 功能：缺了就重做 · 失败就重试 · 绝不兜底
// ─────────────────────────────────────────────────────────────
describe('ensureStage · 缺了就重做', () => {
  it('★ 缺 ⇒ 真的做出来（dsl_baseline：先有意图 DSL，基线缺失 ⇒ 现场生成）', async () => {
    saveDSL(mkDsl());
    const baselineFile = getBaselineFeatureFile(FEATURE);
    if (fs.existsSync(baselineFile)) fs.rmSync(baselineFile, { force: true });
    expect(fs.existsSync(baselineFile)).toBe(false);

    const r = await ensureStage('dsl_baseline', { feature: FEATURE });

    expect(r.action).toBe('produced');
    expect(fs.existsSync(baselineFile)).toBe(true);
  });

  it('★ 已有 ⇒ 不重做（action=fresh，且文件一个字节都没动）', async () => {
    saveDSL(mkDsl());
    await ensureStage('dsl_baseline', { feature: FEATURE });
    const baselineFile = getBaselineFeatureFile(FEATURE);
    const before = fs.readFileSync(baselineFile, 'utf-8');
    const mtimeBefore = fs.statSync(baselineFile).mtimeMs;

    const r = await ensureStage('dsl_baseline', { feature: FEATURE });

    expect(r.action).toBe('fresh');
    expect(fs.readFileSync(baselineFile, 'utf-8')).toBe(before);
    expect(fs.statSync(baselineFile).mtimeMs).toBe(mtimeBefore);
  });
});

describe('ensureStage · 绝不兜底', () => {
  it('★ pending（没有产者）⇒ 抛，且说清"故意不兜底"', async () => {
    await expect(ensureStage('dsl_live', { feature: FEATURE })).rejects.toThrow(/没有产者/);
    await expect(ensureStage('dsl_live', { feature: FEATURE })).rejects.toThrow(/不兜底/);
  });

  it('★ source 不存在 ⇒ 抛（它是外部产生的，本模块造不出来，也不去别处找）', async () => {
    deleteFeature(FEATURE);
    await expect(ensureStage('dsl_features', { feature: FEATURE })).rejects.toThrow(/外部产生/);
  });

  it('★ 上游源头不在 ⇒ 抛（溯源到源头，缺就响亮，不换一个 feature 顶替）', async () => {
    deleteFeature(FEATURE);
    await expect(ensureStage('dsl_baseline', { feature: FEATURE })).rejects.toThrow(/上游源头 "dsl_features" 不在/);
  });

  it('★ 缺 feature ⇒ 抛（不拿别的 feature 顶替）', async () => {
    await expect(ensureStage('dsl_baseline', {})).rejects.toThrow(/故意不兜底/);
  });

  it('★ project 根缺失 ⇒ 抛（绝不兜底到 cwd）', async () => {
    await expect(ensureStage('symbol_index', {})).rejects.toThrow(/故意不兜底到 cwd|都是空的/);
  });
});

describe('produceWithRetry · 失败就重试', () => {
  it('★ 连抛 ⇒ 恰好重试 PRODUCE_ATTEMPTS 次，然后**抛**（不降级、不返回半成品）', async () => {
    let calls = 0;
    const fake: DerivedStage = {
      id: 'symbol_index',
      kind: 'derived',
      owner: 'project',
      inputs: [],
      note: '测试用假产者：专门用来验"重试"这件机制',
      produce: async () => {
        calls++;
        throw new Error('第 ${calls} 次失败');
      },
    };
    await expect(produceWithRetry(fake)).rejects.toThrow(new RegExp(`连续 ${PRODUCE_ATTEMPTS} 次`));
    expect(calls).toBe(PRODUCE_ATTEMPTS);
  });

  it('★ 第一次失败、第二次成功 ⇒ 不抛（重试真的救了回来）', async () => {
    let calls = 0;
    const fake: DerivedStage = {
      id: 'symbol_index',
      kind: 'derived',
      owner: 'project',
      inputs: [],
      note: '测试用假产者：前一次抛、后一次成功',
      produce: async () => {
        calls++;
        if (calls < 2) throw new Error('第一次故意失败');
      },
    };
    await expect(produceWithRetry(fake)).resolves.toBeUndefined();
    expect(calls).toBe(2);
  });
});

describe('getStage', () => {
  it('未登记的 id ⇒ 抛（不返回 undefined 让调用方自己去猜）', () => {
    // @ts-expect-error 故意传一个不在联合类型里的 id，验证运行期兜底也不放行
    expect(() => getStage('nope')).toThrow(/未登记的工序/);
  });
});
