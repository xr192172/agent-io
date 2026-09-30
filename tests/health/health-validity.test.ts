/**
 * health 量具有效性门（G5）—— "同一量具在已知好 / 已知坏上必须给出不同读数"
 *
 * 为什么要这道门（计划书 §5 的 G5，本仓最贵的一条教训）：
 *   **一个在两种状态下读数相同的指标，不是判据，是常量。**
 * 2026-09-28 实测到的两个方向的失真，本文件逐条钉住：
 *   ① 真仓（12 分层违规 / 443 高复杂度）→ 健康分 **0 (D)**；把违规全修掉也还是 0
 *      ⇒ 旧公式 `100 - Σ(count×常数)` 被压穿，改好了不动。
 *   ② 反向：一个**不存在的路径**（0 个文件）→ **100 (A)**。`health_cli.js --help` 即如此
 *      ⇒ 一个错路径会被读成"体检通过"。这比低分更危险。
 *
 * 所以本门断言的不是"分数好看"，而是**读数必须能区分状态**：
 *   方向（好 > 坏）· 不饱和（坏 ≠ 0）· 分辨率（同维更差 ⇒ 分必须更低）·
 *   单维封顶（一维爆表不可压穿）· 空输入是第三种状态 · 分层判定与调用 root 无关 ·
 *   可达根注入确实消掉入口的假阳。
 *
 * 夹具：
 *   codehealth-good-fixture  已知好：三层方向正确（glue→brick→contract）、零问题
 *   codehealth-fixture       已知坏：1 分层违规 / 2 孤儿 / 1 高复杂度 / 5 未使用导出 / 1 未使用 import
 *   codehealth-roots-fixture 可达根：入口文件天然无消费者，不注入根就会报孤儿 + 假违规
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeHealth, computeScore, classifyLayer, type HealthKind } from '../../src/infrastructure/analysis/health/index.js';
import { detectReachableRoots } from '../../src/application/cross/project_root.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, '..', 'fixtures');
const goodRoot = path.join(fixtures, 'codehealth-good-fixture');
const badRoot = path.join(fixtures, 'codehealth-fixture');
const rootsRoot = path.join(fixtures, 'codehealth-roots-fixture');

const ZERO: Record<HealthKind, number> = {
  unused_export: 0, unused_import: 0, orphan_file: 0, high_complexity: 0, layer_violation: 0,
};

describe('G5 · 方向：已知好必须比已知坏高，且坏不能是 0', () => {
  it('好夹具零问题 → 满分 A', async () => {
    const r = await analyzeHealth(goodRoot);
    expect(r.fileCount).toBe(3);
    expect(r.issues).toEqual([]);
    expect(r.counts).toEqual(ZERO);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
  });

  it('坏夹具有问题 → 明显更低，但**不是 0**（0 就说明又饱和了）', async () => {
    const r = await analyzeHealth(badRoot);
    expect(r.counts.layer_violation).toBe(1);
    expect(r.counts.orphan_file).toBe(2);
    expect(r.counts.high_complexity).toBe(1);
    expect(r.score).toBeGreaterThan(0); // ★ 反饱和：坏 ≠ 压穿成 0
    expect(r.score).toBeLessThan(60); // ★ 且确实落在 D 档
    expect(r.grade).toBe('D');
  });

  it('两者读数必须不同（这是本门的全部意义）', async () => {
    const [good, bad] = await Promise.all([analyzeHealth(goodRoot), analyzeHealth(badRoot)]);
    expect(good.score).not.toBe(bad.score);
    expect(good.score).toBeGreaterThan(bad.score);
  });
});

describe('G5 · 分辨率与封顶（纯函数层，不受夹具规模干扰）', () => {
  it('同一维上更差 ⇒ 分数必须更低（封顶之前逐条都有分辨率）', () => {
    const s1 = computeScore({ ...ZERO, layer_violation: 1 }, 100);
    const s2 = computeScore({ ...ZERO, layer_violation: 3 }, 100);
    const s3 = computeScore({ ...ZERO, layer_violation: 15 }, 100);
    expect(s1.value).toBeGreaterThan(s2.value);
    expect(s2.value).toBeGreaterThan(s3.value);
  });

  it('单维封顶：该维继续恶化不再扣分，但**其余维度仍可继续扣**', () => {
    const capped = computeScore({ ...ZERO, layer_violation: 15 }, 100);
    const beyond = computeScore({ ...ZERO, layer_violation: 1000 }, 100);
    expect(beyond.value).toBe(capped.value); // 封顶
    expect(capped.value).toBe(70); // 100 − w(30)
    // 封顶的维度压不穿总分：另一维再爆也只是各扣各的
    const alsoComplex = computeScore({ ...ZERO, layer_violation: 1000, high_complexity: 30 }, 100);
    expect(alsoComplex.value).toBe(70 - 25); // 再扣满 high_complexity 的 w=25
    expect(alsoComplex.value).toBeGreaterThan(0);
  });

  it('各维贡献可解释：扣掉的每一分都能归到某一维', () => {
    const s = computeScore({ ...ZERO, layer_violation: 15, orphan_file: 5 }, 100);
    expect(Math.round(s.contribution.layer_violation + s.contribution.orphan_file)).toBe(100 - s.value);
    expect(s.contribution.high_complexity).toBe(0);
  });
});

describe('G5 · 空输入是**第三种状态**，不得读成"健康"', () => {
  it('0 个源文件 → grade=N/A、score=0（不是 100/A）', () => {
    const s = computeScore(ZERO, 0);
    expect(s.grade).toBe('N/A');
    expect(s.value).toBe(0);
  });

  it('不存在的路径 → 不报 A，且摘要明说"无输入"', async () => {
    const r = await analyzeHealth(path.join(fixtures, 'definitely-not-a-real-dir-xyz'));
    expect(r.fileCount).toBe(0);
    expect(r.grade).toBe('N/A');
    expect(r.grade).not.toBe('A');
    expect(r.summary).toContain('无输入');
  });

  it('空输入与"极坏"读数可区分（grade 不同）', async () => {
    const empty = await analyzeHealth(path.join(fixtures, 'definitely-not-a-real-dir-xyz'));
    const bad = await analyzeHealth(badRoot);
    expect(empty.grade).not.toBe(bad.grade);
  });
});

describe('G5 · 分层判定与调用 root 无关（防"从哪一级调用读数不同"）', () => {
  it('classifyLayer：根级文件与深层文件同判', () => {
    // 旧实现把正则直接打在 rel 上，而 GLUE_HINTS 的 /server(\.|$)/ 要求前导斜杠 ⇒
    // 'server.ts' 判 brick、'src/server.ts' 判 glue —— 同一文件两种结论。
    expect(classifyLayer('server.ts')).toBe('glue');
    expect(classifyLayer('src/server.ts')).toBe('glue');
    expect(classifyLayer('config/x.ts')).toBe('glue');
    expect(classifyLayer('src/config/x.ts')).toBe('glue');
    expect(classifyLayer('types.ts')).toBe('contract');
  });

  it('同一份源码在 root=夹具根 与 root=夹具/src 下分层计数一致', async () => {
    const atRoot = await analyzeHealth(goodRoot);
    const atSrc = await analyzeHealth(path.join(goodRoot, 'src'));
    expect(atSrc.fileCount).toBe(atRoot.fileCount);
    expect(atSrc.layers).toEqual(atRoot.layers);
  });
});

describe('G5 · 可达根注入确实消掉入口的假阳（P0-②）', () => {
  it('入口能从 package.json 的 scripts / bin 探出来', () => {
    expect(detectReachableRoots(rootsRoot)).toEqual({ roots: ['src/orphan_entry.ts'], skipped: [] });
    expect(detectReachableRoots(goodRoot)).toEqual({ roots: ['src/glue/main.ts'], skipped: [] });
  });

  it('分析子目录时，根会被 rebase 到该子目录的相对路径（manifest 允许在祖先）', () => {
    // 典型用法：`health_cli src` —— package.json 在项目根，而分析范围是 src/
    expect(detectReachableRoots(path.join(rootsRoot, 'src'))).toEqual({ roots: ['orphan_entry.ts'], skipped: [] });
  });

  it('不注入根：入口被当 brick ⇒ 孤儿 + 假分层违规', async () => {
    const r = await analyzeHealth(rootsRoot);
    const files = r.issues.map((i) => i.file);
    expect(files).toContain('src/orphan_entry.ts'); // orphan_file
    expect(r.counts.orphan_file).toBe(1);
    expect(r.counts.layer_violation).toBe(1); // brick → glue（server.ts）
  });

  it('注入根：两条假阳同时消失，真依赖不受影响', async () => {
    const r = await analyzeHealth(rootsRoot, { reachableRoots: detectReachableRoots(rootsRoot).roots });
    expect(r.counts.orphan_file).toBe(0);
    expect(r.counts.layer_violation).toBe(0);
    expect(r.fileCount).toBe(2); // 两个文件仍在统计里，只是不再误判
    expect(r.layers.glue).toBe(2); // 入口按胶水层算
  });
});
