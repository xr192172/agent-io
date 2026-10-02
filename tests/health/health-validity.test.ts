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
 * 夹具（★ 三个夹具目录都是**旧三层命名** `contracts`/`bricks`/`glue` —— 不在新四层
 *   `src/<domain|infrastructure|application|presentation>/` 下 ⇒ `classifyLayer` 一律判 `null`（记 `outside`）。
 *   这个事实决定了下面所有 `layers.*` 的期望值，别再按"旧三层"倒推）：
 *   codehealth-good-fixture  已知好：方向正确（glue→brick→contract）、**注入可达根后**零问题
 *   codehealth-fixture       已知坏：2 孤儿 / 1 高复杂度 / 5 未使用导出 / 1 未使用 import
 *                            （原「1 分层违规」在新四层口径下**不再成立**：contracts/bricks 都不在四层里 ⇒ 不判违规）
 *   codehealth-roots-fixture 可达根：入口文件天然无消费者，不注入根就会被报 `orphan_file`
 *                            （旧实现靠"入口特判成 glue 层"豁免；新实现只认 `options.reachableRoots`）
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

/**
 * 可达根的口径（★ 新判据下"入口免于孤儿"**只**来自 `options.reachableRoots`，不再来自"某层"）：
 *   · good / roots 夹具带 `package.json` ⇒ 用 `detectReachableRoots` 从 bin/scripts 探（与生产一致）；
 *   · bad 夹具**没有** `package.json` ⇒ 探不到，只能显式喂入它唯一的入口 `src/glue/app.ts`
 *     （依据：夹具顶层注释声明它是"入口，正常消费积木/契约"；实测它也确实是唯一无消费者的胶水文件）。
 */
const goodRoots = { reachableRoots: detectReachableRoots(goodRoot).roots };
const badRoots = { reachableRoots: ['src/glue/app.ts'] };

const ZERO: Record<HealthKind, number> = {
  unused_export: 0, unused_import: 0, orphan_file: 0, high_complexity: 0, layer_violation: 0,
  // ★ 2026-10-03：`circular_dependency` 是 `counts` 的**必填键**（`HealthKind` 从 5 值扩到 6 值）。
  //   漏了它 ⇒ `computeScore` 里 `counts[k] / fileCount` = NaN ⇒ 整个分数算成 NaN（下面三条纯函数断言会红）。
  circular_dependency: 0,
};

describe('G5 · 方向：已知好必须比已知坏高，且坏不能是 0', () => {
  it('好夹具零问题 → 满分 A', async () => {
    // ★ 必须**显式注入可达根**（生产调用 `application/cross/index.ts` 同样传 detectReachableRoots 的结果）。
    //   旧实现把入口特判成 glue 层 ⇒ 不传根也能靠"层"豁免孤儿；新判据把两件事拆开了：
    //   **层 = 文件在哪（按目录）/ 是不是入口 = 可达根（由调用方喂入）** ⇒ 不传根时 main.ts 天然无消费者
    //   ⇒ 被报 orphan_file ⇒ 掉到 80/B（实测）。这正是本夹具"已知好"必须注入根的原因。
    const r = await analyzeHealth(goodRoot, goodRoots);
    expect(r.fileCount).toBe(3);
    expect(r.issues).toEqual([]);
    expect(r.counts).toEqual(ZERO);
    expect(r.score).toBe(100);
    expect(r.grade).toBe('A');
  });

  it('坏夹具有问题 → 明显更低，但**不是 0**（0 就说明又饱和了）', async () => {
    const r = await analyzeHealth(badRoot, badRoots);
    // ★ 由 1 → 0：夹具目录是**旧三层命名**（`src/contracts/`、`src/bricks/`），新判据只认 `src/<四层>/`
    //   ⇒ 这条 `contract → brick` 依赖的**两端 `classifyLayer` 都是 null** ⇒ 不再被判为违规。
    //   这是判据改口径的**如实结果**（依据：classifyLayer 的 `^src/(domain|infrastructure|application|presentation)/`），
    //   不是把断言放宽 —— 夹具的"坏"改由 孤儿/未用导出/高复杂度 承载（见下），方向性仍然成立。
    expect(r.counts.layer_violation).toBe(0);
    expect(r.counts.orphan_file).toBe(2);
    expect(r.counts.high_complexity).toBe(1);
    expect(r.score).toBeGreaterThan(0); // ★ 反饱和：坏 ≠ 压穿成 0（实测 40）
    expect(r.score).toBeLessThan(60); // ★ 且确实落在 D 档
    expect(r.grade).toBe('D');
  });

  it('两者读数必须不同（这是本门的全部意义）', async () => {
    const [good, bad] = await Promise.all([analyzeHealth(goodRoot, goodRoots), analyzeHealth(badRoot, badRoots)]);
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
  it('classifyLayer：只认 src/<四层>/，其余一律 null（不参与分层判定）', () => {
    // ★ 2026-10-03 整块替换：旧断言测的是**已删除的**路径启发式（`'glue'`/`'contract'`/`'brick'`）。
    //   新判据只有一个事实：**文件在不在 `src/<四层>/` 下**（正则 `^src/(domain|...)/ `）。
    //   命中 → 层名；不在 → **null**（`tests/`、`scripts/`、仓库根散文件、**夹具里的 src** …）。
    expect(classifyLayer('src/domain/x.ts')).toBe('domain');
    expect(classifyLayer('src/infrastructure/db.ts')).toBe('infrastructure');
    expect(classifyLayer('src/application/use.ts')).toBe('application');
    expect(classifyLayer('src/presentation/cli/a.ts')).toBe('presentation');
    // 旧实现把这条判 brick；新判据里 `src/presentation/**` 就是**展现层**——这条最能说明口径换了。
    expect(classifyLayer('src/presentation/http/helper.ts')).toBe('presentation');

    // 以下都不在 `src/<四层>/` 下 ⇒ null（旧实现会按正则"猜"成 glue/contract/brick，正是要根除的分叉）：
    expect(classifyLayer('server.ts')).toBe(null); // 仓库根散文件（旧：brick）
    expect(classifyLayer('src/server.ts')).toBe(null); // src 根下的非四层文件（旧：glue）
    expect(classifyLayer('config/x.ts')).toBe(null); // 非 src 目录（旧：glue）
    expect(classifyLayer('src/contracts/models.ts')).toBe(null); // 夹具用的旧三层命名
    expect(classifyLayer('src/glue/app.ts')).toBe(null);
    expect(classifyLayer('types.ts')).toBe(null); // 旧：contract
    // ★ `^src/` 锚定：**夹具里的 src 不算真源码**（旧实现把 tests/fixtures/** 一起判了）
    expect(classifyLayer('tests/fixtures/foo/src/domain/x.ts')).toBe(null);
  });

  it('★ 新口径：分层是**相对被分析 root** 的（同一文件在不同 root 下判层可以不同 —— 这是设计）', async () => {
    // ★ 2026-10-03 改写。旧标题是「分层判定与调用 root 无关」—— 那是**路径启发式时代**的性质
    //   （旧正则锚 `/(^|\/)server\./` 之类，补个前导 `/` 两边都命中，所以"无关"成立）。
    //   新判据是**目录位置**（`^src/<四层>/`）⇒ **root 决定"哪里算顶层"**：
    //     · 以**仓根**为 root：`src/domain/x.ts` → `domain`（在四层里）
    //     · 以**仓根的 src** 为 root：`domain/x.ts` → `null`（`src/` 前缀没了 ⇒ 不算层）
    //   这是**有意的语义**（"这个文件落在哪一层"必须相对一个顶层才有意义），不是读数漂移
    //   ⇒ 所以本用例反过来**钉住它**。旧断言在新口径下会**平凡成立**（夹具文件两种 root 下都不在四层），
    //     即它已退化成空门 —— 执行者如实报出，这里改成有内容的形式。
    expect(classifyLayer('src/domain/x.ts')).toBe('domain');
    expect(classifyLayer('domain/x.ts')).toBe(null);

    const atRoot = await analyzeHealth(goodRoot);
    const atSrc = await analyzeHealth(path.join(goodRoot, 'src'));
    // good 夹具的文件都是 `src/<旧三层>/` 或 `src/` 根 ⇒ 两种 root 下**都不在四层**。
    // 所以"计数一致"的一致点是 **outside**，不是"判层结果"（后者两边都是 0，不携带信息）。
    expect(atRoot.layers.outside).toBe(atSrc.layers.outside);
    expect(atRoot.layers.domain + atRoot.layers.infrastructure + atRoot.layers.application + atRoot.layers.presentation).toBe(0);
    expect(atSrc.layers.domain + atSrc.layers.infrastructure + atSrc.layers.application + atSrc.layers.presentation).toBe(0);
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

  it('不注入根：入口被报 orphan_file（新判据不再靠"层"豁免入口）', async () => {
    const r = await analyzeHealth(rootsRoot);
    const files = r.issues.map((i) => i.file);
    expect(files).toContain('src/orphan_entry.ts'); // orphan_file
    expect(r.counts.orphan_file).toBe(1);
    // ★ 由 1 → 0：这条"假分层违规"的前提（入口判 brick、server.ts 命中 GLUE_HINTS 判 glue）已不存在 ——
    //   两个文件都在 `src/` 根下、都不在四层里 ⇒ classifyLayer 皆为 null ⇒ **根本不判违规**。
    //   旧实现是"先按正则猜层，再判违规"，才需要这条根注入去消假阳；新实现从源头就没这假阳。
    expect(r.counts.layer_violation).toBe(0);
    expect(r.layers.outside).toBe(2); // 如实计数：两个文件都不在四层里（不判层，但不静默丢）
  });

  it('注入根：入口孤儿假阳消失，真依赖不受影响', async () => {
    const r = await analyzeHealth(rootsRoot, { reachableRoots: detectReachableRoots(rootsRoot).roots });
    expect(r.counts.orphan_file).toBe(0);
    expect(r.counts.layer_violation).toBe(0);
    expect(r.fileCount).toBe(2); // 两个文件仍在统计里，只是不再误判
    // ★ 由旧 `layers.glue === 2` 换成 `layers.outside === 2`：夹具文件在 `src/` 根下（非四层）
    //   ⇒ 新口径记 outside。旧值 2 是"入口+server 都算 glue"的产物，那个层表已删除。
    expect(r.layers.outside).toBe(2);
  });
});

/**
 * ★★ 2026-10-03 新增：**四层夹具** —— 补上「分层违规 / 循环依赖」这两维在夹具层的空缺。
 *
 * 为什么必须补（缺口是判据重写时**同步暴露**出来的，由执行者如实报出）：
 *   上面三个夹具都是**旧三层命名**（`contracts` / `bricks` / `glue`），在新口径下
 *   `classifyLayer` 对它们**一律判 `null`** ⇒ **`layer_violation` 与 `circular_dependency`
 *   一个都触发不了** ⇒ 这两维**在测试层是无门的**（改坏了不会红）。生产上它们在工作
 *   （本仓实测 9 条违规 / 2 条环），但"能跑出数"不等于"有门兜着"。
 *
 * 夹具形状（`tests/fixtures/codehealth-four-layer-fixture`）：6 个文件**全在四层里**，
 *   其中 ① `src/domain/leaky.ts` **向上** import `src/application/service.ts` ⇒ 1 条分层违规；
 *        ② `src/infrastructure/{a,b}.ts` **互引** ⇒ 1 条环。其余三条边都是合法的向下依赖。
 */
describe('★ 四层夹具：两维新判据（向上依赖 / 循环依赖）的出生证', () => {
  const fourLayerRoot = path.join(fixtures, 'codehealth-four-layer-fixture');

  it('向上依赖 ⇒ 1 条 layer_violation；互引成环 ⇒ 1 条 circular_dependency', async () => {
    const r = await analyzeHealth(fourLayerRoot);

    // 先钉住"夹具建对了"：6 个文件**全部**落在四层里。`outside` 非 0 就说明夹具建歪、判据又要落空。
    expect(r.layers.outside).toBe(0);
    expect(r.layers.domain + r.layers.infrastructure + r.layers.application + r.layers.presentation).toBe(6);

    expect(r.counts.layer_violation).toBe(1);
    const lv = r.issues.find((i) => i.kind === 'layer_violation');
    expect(lv?.message).toContain('domain'); // 违规方是最底层的 domain
    expect(lv?.evidence).toContain('application'); // 它却依赖了 application（向上）

    expect(r.counts.circular_dependency).toBe(1);
    const cd = r.issues.find((i) => i.kind === 'circular_dependency');
    expect(cd?.message).toContain('成环');
    expect(cd?.evidence).toContain('infrastructure');
  });

  it('对照项：合法夹具（无向上依赖、无环）两维必须为 0 —— 证明判据不是"见文件就报"', async () => {
    // 把违规/成环那份换成 good 夹具：它的依赖全向下、无环 ⇒ 两维必须是 0。
    const r = await analyzeHealth(goodRoot);
    expect(r.counts.layer_violation).toBe(0);
    expect(r.counts.circular_dependency).toBe(0);
  });
});
