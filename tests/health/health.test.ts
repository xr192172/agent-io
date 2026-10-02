/**
 * health —— 代码健康度单元测试
 *
 * 夹具：tests/fixtures/codehealth-fixture（5 文件，**旧三层命名** contracts/bricks/glue）
 *   src/contracts/models.ts      契约层：User(被积木/胶水引用) / Order(未使用导出)
 *   src/contracts/bad_contract.ts 契约层：反向依赖积木层(旧口径下的分层违规) + 自身无消费者(孤儿) + ScoreBand/bandOf 未使用导出
 *   src/bricks/user_service.ts   积木层：computeScore/superComplex(被胶水消费) / unusedFn(未使用导出) /
 *                                 Order 未使用 import / superComplex 高复杂度
 *   src/bricks/orphan.ts         积木层孤立模块：孤儿文件 + legacyHelper 未使用导出
 *   src/glue/app.ts              胶水层：入口（夹具注释声明），正常消费积木/契约
 *
 * ★ 2026-10-03 判据重写后的**口径变化**（下面期望值全部据此，别按旧注释倒推）：
 *   · 层定义换成**真实四层目录** `src/<domain|infrastructure|application|presentation>/`；
 *     本夹具的 `contracts`/`bricks`/`glue` **都不在其中** ⇒ 5 个文件全部 `classifyLayer → null` ⇒ 记 `layers.outside`。
 *   · 因此原来的 `layer_violation ×1`（contract→brick）**不再成立**（两端都不在四层里 ⇒ 不判违规）。
 *   · 入口不再靠"层"免于孤儿：`app.ts` 无 package.json，须由调用方显式喂 `reachableRoots` 才不被报 orphan。
 *
 * 预期体检结果（注入入口根 `src/glue/app.ts` 后）：
 *   unused_export ×5（Order / ScoreBand / bandOf / unusedFn / legacyHelper）
 *   unused_import ×1（user_service 的 Order）
 *   orphan_file  ×2（bad_contract + orphan）
 *   high_complexity ×1（superComplex）
 *   layer_violation ×0（四层口径下 contracts/bricks 不在四层里，见上）
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyLayer, estimateComplexity, unusedImportsIn, analyzeHealth } from '../../src/infrastructure/analysis/health/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, '..', 'fixtures', 'codehealth-fixture');
const esmFixtureRoot = path.join(here, '..', 'fixtures', 'codehealth-esm-fixture');

/**
 * 夹具入口（相对各自 root）。
 * ★ 新判据下"入口免于 orphan"**只**来自 `options.reachableRoots`；两个夹具都**没有 package.json**
 *   ⇒ `detectReachableRoots` 探不到，只能按夹具自身注释显式喂入（`src/glue/app.ts` = 声明的入口）。
 */
const FIXTURE_ENTRY = 'src/glue/app.ts';

describe('health: 分层分类（四层目录）', () => {
  it('只认 src/<四层>/；不在其中的路径（含旧三层命名）一律 null', () => {
    // 命中四层 → 返回层名（按**目录**，不是按文件名猜）
    expect(classifyLayer('src/domain/models.ts')).toBe('domain');
    expect(classifyLayer('src/infrastructure/db.ts')).toBe('infrastructure');
    expect(classifyLayer('src/application/use_case.ts')).toBe('application');
    expect(classifyLayer('src/presentation/http/helper.ts')).toBe('presentation');
    // 不在 `src/<四层>/` 下 → null（★ 旧实现会命中特征或兜底成 contract/brick/glue）
    expect(classifyLayer('src/contracts/models.ts')).toBe(null); // 本夹具用的旧三层命名
    expect(classifyLayer('src/glue/app.ts')).toBe(null);
    expect(classifyLayer('src/bricks/user_service.ts')).toBe(null);
    expect(classifyLayer('src/foo.ts')).toBe(null); // 旧实现兜底 'brick'（已删除的能力）
  });
});

describe('health: 圈复杂度（AST 分支节点计数）', () => {
  it('无分支 = 1', async () => {
    expect(await estimateComplexity('x.ts', 'function a() { return 1; }')).toBe(1);
  });
  it('if/for/&&/|| 线性累加', async () => {
    const src = `function f(n) {\n  if (n > 1) {}\n  for (let i = 0; i < n; i++) {}\n  if (a && b) {}\n  if (x || y) {}\n  return n;\n}`;
    // 基1 + if×3 + for×1 + &&×1 + ||×1 = 7
    expect(await estimateComplexity('x.ts', src)).toBe(7);
  });
  it('剥离注释后计数（注释里的 if 不计）', async () => {
    const src = `function f() {\n  // if (true) x\n  if (false) {}\n  return 0;\n}`;
    expect(await estimateComplexity('x.ts', src)).toBe(2);
  });
  it('三元表达式计入（AST 不再漏 Python 三元）', async () => {
    const py = `def f(a, b):\n    return a if a else b\n`;
    // 基1 + conditional_expression×1 = 2
    expect(await estimateComplexity('x.py', py)).toBe(2);
  });
});

describe('health: 未使用 import 提取', () => {
  it('只导入未使用 → 报未使用；已使用不报', async () => {
    const src = `import { User, Order } from '../contracts/models';\n\nexport function f(u: User): number { return u.id; }\n`;
    const unused = await unusedImportsIn('x.ts', src);
    expect(unused).toHaveLength(1);
    expect(unused[0].name).toBe('Order');
    expect(unused[0].module).toBe('../contracts/models');
  });
  it('无 import → 空', async () => {
    expect(await unusedImportsIn('x.ts', 'export const a = 1;')).toEqual([]);
  });
  it('Python 别名 import：别名未使用才报，原始名不报', async () => {
    const src = `from mod import a, b as c\n\ndef f(x):\n    return a + x\n`;
    const unused = await unusedImportsIn('x.py', src);
    expect(unused).toHaveLength(1);
    expect(unused[0].name).toBe('c');
    expect(unused[0].module).toBe('mod');
  });
});

describe('health: 夹具整体体检', () => {
  it('五个文件 + 各类问题数量精确匹配（注入入口根后）', async () => {
    const r = await analyzeHealth(fixtureRoot, { reachableRoots: [FIXTURE_ENTRY] });
    expect(r.fileCount).toBe(5);
    // ★ 层统计换成真实四层：夹具目录是 contracts/bricks/glue（旧三层命名），**都不在四层里**
    //   ⇒ 5 个文件全部落 `outside`、四层计数全 0、violations 0（旧值 contract2/brick2/glue1/unclassified2/violations1 已废）。
    expect(r.layers).toEqual({
      domain: 0, infrastructure: 0, application: 0, presentation: 0, outside: 5, violations: 0,
    });
    // ★ counts 现为**必填 6 键**（新增 circular_dependency）；夹具无环 ⇒ 0。
    //   layer_violation 由 1 → 0：contracts/bricks 不在四层里 ⇒ contract→brick 不判违规（见文件头说明）。
    expect(r.counts).toEqual({
      unused_export: 5,
      unused_import: 1,
      orphan_file: 2,
      high_complexity: 1,
      layer_violation: 0,
      circular_dependency: 0,
    });
    expect(r.issues).toHaveLength(9); // 5 未用导出 + 1 未用 import + 2 孤儿 + 1 高复杂度（原 10 少的那条是旧分层违规）
  });

  it('问题清单逐条定位（文件/类型/符号）', async () => {
    const r = await analyzeHealth(fixtureRoot, { reachableRoots: [FIXTURE_ENTRY] });
    const by = (kind: string) => r.issues.filter((i) => i.kind === kind);

    // 未使用导出
    const unusedExports = by('unused_export');
    expect(unusedExports.map((i) => `${i.file}:${i.symbol}`).sort()).toEqual([
      'src/bricks/orphan.ts:legacyHelper',
      'src/bricks/user_service.ts:unusedFn',
      'src/contracts/bad_contract.ts:ScoreBand',
      'src/contracts/bad_contract.ts:bandOf',
      'src/contracts/models.ts:Order',
    ]);

    // 未使用 import
    const unusedImports = by('unused_import');
    expect(unusedImports).toHaveLength(1);
    expect(unusedImports[0].file).toBe('src/bricks/user_service.ts');
    expect(unusedImports[0].symbol).toBe('Order');
    expect(unusedImports[0].severity).toBe('warn');

    // 孤儿文件
    const orphans = by('orphan_file').map((i) => i.file).sort();
    expect(orphans).toEqual(['src/bricks/orphan.ts', 'src/contracts/bad_contract.ts']);

    // 高复杂度
    const complex = by('high_complexity');
    expect(complex).toHaveLength(1);
    expect(complex[0].file).toBe('src/bricks/user_service.ts');
    expect(complex[0].symbol).toBe('superComplex');
    expect(Number(complex[0].evidence)).toBeGreaterThan(10);

    // 分层违规 —— ★ 四层口径下**为 0**：bad_contract(`src/contracts/`) → user_service(`src/bricks/`)
    //   两端的 classifyLayer 都是 null（`contracts`/`bricks` 不在四层里）⇒ 判据**主动不判**这条依赖。
    //   所以这里断言的是"不再报"，而不是旧实现的 bad_contract 那条 error。这是判据改口径的如实结果，
    //   不是把断言放宽：夹具目录仍是旧三层命名，本身就落在四层之外（见文件头说明）。
    const viol = by('layer_violation');
    expect(viol).toHaveLength(0);
  });

  it('健康分/等级/摘要 + 复杂度 Top 含 superComplex', async () => {
    const r = await analyzeHealth(fixtureRoot);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(['A', 'B', 'C', 'D']).toContain(r.grade);
    expect(r.summary).toContain(`${r.score} 分`);
    const top = r.complexity.find((c) => c.symbol === 'superComplex');
    expect(top).toBeDefined();
    expect(top!.complexity).toBeGreaterThan(10);
    // 复杂度清单按分数降序
    for (let i = 1; i < r.complexity.length; i++) {
      expect(r.complexity[i - 1].complexity).toBeGreaterThanOrEqual(r.complexity[i].complexity);
    }
  });

  it('threshold 参数：调高阈值后 high_complexity 消失', async () => {
    const r = await analyzeHealth(fixtureRoot, { complexityThreshold: 100 });
    expect(r.counts.high_complexity).toBe(0);
  });
});

describe('health: Java 未使用 import（AST 绑定）', () => {
  it('Java 用了 Foo 未用 Bar → 只报 Bar', async () => {
    const src = 'package p;\nimport com.acme.Foo;\nimport com.acme.Bar;\nclass A { Foo f; }\n';
    const unused = await unusedImportsIn('a.java', src);
    expect(unused.map((u) => u.name)).toEqual(['Bar']);
  });
});

describe('health: NodeNext ESM 的 `.js` 后缀 import（回归门，2026-09-28）', () => {
  // 夹具 tests/fixtures/codehealth-esm-fixture（3 文件）：
  //   src/glue/app.ts → src/bricks/parent.js → src/bricks/child.js   （import 全写 `.js` 后缀）
  // 背景：本仓是 NodeNext ESM，相对 import 必须写 `.js`（实测 961/971 条如此），
  //   而源码文件是 `.ts`。resolveImportFile 若不会「剥 .js 再试 .ts」⇒ 两条边整条丢失
  //   ⇒ parent/child 双双被判孤儿（orphan_file=2），且分层违规恒为 0（量具空转）。
  // 旧夹具 codehealth-fixture 用的是【无后缀】import，故该缺陷长期未被测试覆盖。
  it('沿 `.js` 后缀 import 连成链 → 无孤儿文件、链路被看见', async () => {
    // ★ 注入入口根（夹具无 package.json）：新判据下入口靠 `reachableRoots` 免于 orphan；
    //   不注入则 app.ts 本身被判孤儿（orphan_file=1），那是与"链是否连上"无关的干扰项。
    const r = await analyzeHealth(esmFixtureRoot, { reachableRoots: [FIXTURE_ENTRY] });
    expect(r.fileCount).toBe(3);
    // 链路 app→parent→child 只要有一条 `.js` 解析不到，下游文件就会变孤儿 ⇒ 0 才是链连上的证据。
    expect(r.counts.orphan_file).toBe(0);
    expect(r.counts.layer_violation).toBe(0);
    // ★ 旧断言 `layers.glue===1 / layers.brick===2` 已废：夹具目录是 glue/bricks（旧三层命名），
    //   不在新四层里 ⇒ 3 个文件全记 `outside`。层计数不再表达"链长"，孤儿数才是本门的证据。
    expect(r.layers.outside).toBe(3);
  });
});
