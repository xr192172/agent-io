/**
 * resolveProjectImport —— 工程内 import 边的【唯一实现】单元测试
 *
 * ★ 为什么要锁：这个函数回答的是"**这条 import 指向项目内哪个文件**"——本仓曾有三份答案
 *   （`import_project.resolveImport` / `health` 的私有 `resolveImportFile` / `impact` 的
 *   私有 `resolveImportFile` + `resolvePackageImportDir`），彼此**互不一致**：同一个夹具上
 *   `import_project` 能解析点分模块（`app.Helper` → `app/Helper.scala`），而 health/impact 恒 null
 *   ⇒ 同一个仓，量具与产品给出不同答案（本仓最反对的那种分叉）。
 *
 * 背景（2026-09-30，收口）：逻辑已收成一份，六层**串行假设**——
 *   relative / python-dot / dotted / bare-name / go-module / package-dir。
 *   详见 `src/tools/ts_kernel/import_resolve.ts` 的函数头注。
 *
 * ★ 本文件**不用仓内夹具**（`.inspect/` 是 gitignored，别人复现不了）——
 *   直接给 `rels` 一个内存集合，纯函数即可覆盖六层。
 */
import { describe, it, expect } from 'vitest';
import { resolveProjectImport } from '../../src/tools/ts_kernel/import_resolve.js';

const EXTS = ['.ts', '.tsx', '.js', '.py', '.jl', '.hs', '.scala', '.java', '.groovy', '.ex', '.go'];
const S = (...files: string[]): Set<string> => new Set(files);
/** 只关心"解析到哪 + 走哪层"时的简写 */
const hit = (from: string, source: string, rels: Set<string>, exts = EXTS): string | null =>
  resolveProjectImport(from, source, rels, { exts }).rel;

describe('resolveProjectImport: 第 1 层 relative（复用 resolveImportPath）', () => {
  it('相对路径 + 扩展名补全', () => {
    expect(hit('src/a.ts', './b', S('src/a.ts', 'src/b.ts'))).toBe('src/b.ts');
  });

  it('NodeNext：`.js` 引 `.ts`（剥扩展名重试）', () => {
    expect(hit('src/a.ts', './b.js', S('src/b.ts'))).toBe('src/b.ts');
  });

  it('目录 index 回退', () => {
    expect(hit('src/a.ts', './d', S('src/d/index.ts'))).toBe('src/d/index.ts');
  });

  it('★ 相对路径未命中 ⇒ 早退，不越层（否则会拿"已知缺失的文件"去撞目录式尾段匹配、造出假边）', () => {
    // 仓里有 `util/x.ts`，若越层则 layer6 的"尾段匹配"会把它当 `./util` 的目标
    const r = resolveProjectImport('src/a.ts', './util', S('src/a.ts', 'util/x.ts'), { exts: EXTS });
    expect(r.rel).toBeNull();
    expect(r.layer).toBeNull();
  });
});

describe('resolveProjectImport: 第 2 层 python-dot（包相对，**不是**文件系统路径）', () => {
  it('`from .helper import` ⇒ 当前包内 sibling（此前内核生成 `pkg/.helper.*` ⇒ 恒 null）', () => {
    const r = resolveProjectImport('pkg/use.py', '.helper', S('pkg/use.py', 'pkg/helper.py'), { exts: EXTS });
    expect(r.rel).toBe('pkg/helper.py');
    expect(r.layer).toBe('python-dot');
  });

  it('前导点**不**被当路径字面量（回归锚点：候选里不得出现 `pkg/.helper`）', () => {
    const r = resolveProjectImport('pkg/use.py', '.helper', S('pkg/use.py'), { exts: EXTS });
    expect(r.tried.some((c) => c.includes('/.helper'))).toBe(false);
  });

  it('点分模块 + 相对级：`..mod` 上跳一级', () => {
    expect(hit('a/b/use.py', '..mod', S('a/mod.py'))).toBe('a/mod.py');
  });

  it('多点 + 点分：`...pkg.sub` 上跳两级后转路径', () => {
    expect(hit('x/y/z/u.py', '...pkg.sub', S('x/pkg/sub.py'))).toBe('x/pkg/sub.py');
  });
});

describe('resolveProjectImport: 第 3 层 dotted（点分模块 → 路径）', () => {
  it('`app.Helper` ⇒ 项目根下的 `app/Helper.scala`', () => {
    const r = resolveProjectImport('app/Use.scala', 'app.Helper', S('app/Use.scala', 'app/Helper.scala'), { exts: EXTS });
    expect(r.rel).toBe('app/Helper.scala');
    expect(r.layer).toBe('dotted');
  });

  it('项目根未命中 ⇒ 回退导入者目录', () => {
    expect(hit('src/app/Use.scala', 'app.Helper', S('src/app/Helper.scala'))).toBe('src/app/Helper.scala');
  });

  it('★ Maven 式布局：`src/main/java/app/Use.java` + `import app.Helper` ⇒ 包根在导入者**上方**', () => {
    // 旧实现只试 ['', importer.dir] 两个根，此例两处都落空 ⇒ 真实 Java 工程上恒 null。
    // 本笔改为"试每个可能的包根"，这条判据就是它的出生证。
    const rels = S('src/main/java/app/Use.java', 'src/main/java/app/Helper.java');
    const r = resolveProjectImport('src/main/java/app/Use.java', 'app.Helper', rels, { exts: EXTS });
    expect(r.rel).toBe('src/main/java/app/Helper.java');
    expect(r.layer).toBe('dotted');
  });

  it('Java：`import app.Helper` ⇒ `app/Helper.java`（对照项，同形状不同语言）', () => {
    expect(hit('app/Use.java', 'app.Helper', S('app/Use.java', 'app/Helper.java'))).toBe('app/Helper.java');
  });
});

describe('resolveProjectImport: 第 4 层 bare-name（单段模块名）', () => {
  it('julia `using Helper` ⇒ 导入者同目录', () => {
    const r = resolveProjectImport('Use.jl', 'Helper', S('Use.jl', 'Helper.jl'), { exts: EXTS });
    expect(r.rel).toBe('Helper.jl');
    expect(r.layer).toBe('bare-name');
  });

  it('haskell `import Lib` ⇒ 导入者同目录', () => {
    expect(hit('Use.hs', 'Lib', S('Use.hs', 'Lib.hs'))).toBe('Lib.hs');
  });

  it('导入者同目录未命中 ⇒ 回退项目根', () => {
    expect(hit('sub/Use.jl', 'Helper', S('Helper.jl'))).toBe('Helper.jl');
  });

  it('不存在的裸名（如 npm 包 `react`）⇒ null，不硬连', () => {
    expect(hit('src/a.ts', 'react', S('src/a.ts', 'src/b.ts'))).toBeNull();
  });
});

describe('resolveProjectImport: 第 5 层 go-module', () => {
  it('剥离 module 前缀 ⇒ 目标目录内首个文件（按路径序）', () => {
    const rels = S('cmd/main.go', 'core/pkg/a.go', 'core/pkg/b.go');
    const r = resolveProjectImport('cmd/main.go', 'example.com/m/core/pkg', rels, {
      exts: EXTS,
      goModules: [{ module: 'example.com/m', dir: '' }],
    });
    expect(r.rel).toBe('core/pkg/a.go');
    expect(r.layer).toBe('go-module');
  });

  it('不传 goModules ⇒ 该层不触发（但第 6 层尾段匹配仍可能兜到，层名必须是 package-dir）', () => {
    const rels = S('core/pkg/a.go');
    const r = resolveProjectImport('cmd/main.go', 'example.com/m/core/pkg', rels, { exts: EXTS });
    expect(r.layer).not.toBe('go-module');
    expect(r).toMatchObject({ rel: 'core/pkg/a.go', layer: 'package-dir' });
  });
});

describe('resolveProjectImport: 第 6 层 package-dir（宁漏不错：候选必须唯一）', () => {
  it('完整包路径直接匹配目录', () => {
    const r = resolveProjectImport('m.go', 'core/pkg', S('core/pkg/a.go'), { exts: EXTS });
    expect(r.rel).toBe('core/pkg/a.go');
    expect(r.layer).toBe('package-dir');
  });

  it('★ direct 目录里有**多个**文件 ⇒ 拒绝（宁漏不错的旧 impact 语义，逐字保留）', () => {
    // ★ 注意与第 5 层的**有意不对称**：go-module 层"取目录内首个文件"，本层要求**恰好一个文件**。
    //   前者是旧 import_project 的语义、后者是旧 impact 的语义，内化时两份都保留了原样。
    expect(hit('m.go', 'core/pkg', S('core/pkg/a.go', 'core/pkg/b.go'))).toBeNull();
  });

  it('尾段匹配：`tail` 目录唯一时才接受', () => {
    expect(hit('m.go', 'x/y/tail', S('tail/a.go'))).toBe('tail/a.go');
  });

  it('★ 尾段目录有多个 ⇒ 拒绝（宁漏不错，不猜）', () => {
    expect(hit('m.go', 'x/y/tail', S('p/tail/a.go', 'q/tail/b.go'))).toBeNull();
  });
});

describe('resolveProjectImport: 层间是**串行假设**（未命中继续往下试）', () => {
  it('★ bare-name 未命中 ⇒ 落到 package-dir（旧 impact 的目录式回退，不能被早退吃掉）', () => {
    const rels = S('Use.jl', 'Helper/Helper.jl');
    const r = resolveProjectImport('Use.jl', 'Helper', rels, { exts: EXTS });
    expect(r.rel).toBe('Helper/Helper.jl');
    expect(r.layer).toBe('package-dir');
  });

  it('dotted 未命中 ⇒ 继续往下试（不早退）', () => {
    const r = resolveProjectImport('a/U.kt', 'app.Helper', S('a/pkg/Helper.kt'), { exts: EXTS });
    // 层 3 无命中；层 6 尾段 'app.Helper' 也不匹配 ⇒ 如实为 null（此例证明的是"走到了后面")
    expect(r.rel).toBeNull();
  });
});

describe('resolveProjectImport: API 陷阱与回执', () => {
  it('★ 不传 exts ⇒ 用 IMPORT_EXTS 兜底（**不得**变成"空表"导致补全消失）', () => {
    // {exts: []} 会让 completionCandidates 只剩 index 候选（实测）⇒ 这里必须仍能补全
    expect(resolveProjectImport('src/a.ts', './b', S('src/b.ts')).rel).toBe('src/b.ts');
  });

  it('显式空 exts 时只有 index 候选（如实反映传参，不静默改语义）', () => {
    const r = resolveProjectImport('src/a.ts', './b', S('src/b.ts'), { exts: [] });
    expect(r.rel).toBeNull();
  });

  it('未命中时返回 tried（"为什么没建边"可查证）', () => {
    const r = resolveProjectImport('Use.jl', 'Nope', S('Use.jl'), { exts: EXTS });
    expect(r.rel).toBeNull();
    expect(r.layer).toBeNull();
    expect(r.tried.length).toBeGreaterThan(0);
  });

  it('命中时 tried 以命中的候选结尾', () => {
    const r = resolveProjectImport('src/a.ts', './b', S('src/b.ts'), { exts: EXTS });
    expect(r.tried[r.tried.length - 1]).toBe(r.rel);
  });
});
