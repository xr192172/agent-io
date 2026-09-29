/**
 * ts_kernel 跨文件 import 边（2026-09-29 第二笔）—— scala / groovy / julia / haskell 四门
 *
 * 本笔补的是**内核侧的 import 声明数据**（`languages.ts: import_nodes` +
 * `kernel.ts: LANG_ADAPTERS[x].extractImportSources/Bindings`），判据分三层：
 *   ① 注册表：4 门的 `import_nodes` 值 = **实测**的节点名（node-types.json / grammar.js + dump 真树）
 *   ② 真跑：一段该语言母语形态的 import 源码 ⇒ `imports[].source` / `bindings` 逐条对得上
 *   ③ 不误报（类别正确性，与 ruby「`require` 是普通 call 故不声明」同一纪律）：
 *      · scala `import a.b.{C, D}` 的 `C`/`D` 是**被引入的名字**，不是模块源
 *      · julia `import Helper: twice` 的 `twice` 同上；`export foo` **不产边**（无模块源）
 *      · groovy `import static a.b.C.m` 的 source 含成员名（与 java 的 static import 同口径）
 *      · elixir **仍不声明** import_nodes —— 该 grammar 里 import/alias/require/use 全是普通
 *        `call`，无专用节点（详见 languages.ts 的 elixir 注释）；本测试把该现状**钉住**，
 *        免得后来者误以为"忘了加"
 *
 * ★ 边界（别把本测试读宽）：它证的是"内核真的把这些语言的 import 抽了出来"，
 *   **不是**"impact/health 的跨文件边已通" —— 那两个量具的工程内解析只认相对路径，
 *   本笔未动（见 `register_capabilities.ts` 的 impact/code_health 注释与本笔提交信息）。
 */
import { describe, it, expect } from 'vitest';
import { parseFileFull } from '../../src/tools/ts_kernel/index.js';
import { LANG_ADAPTERS } from '../../src/tools/ts_kernel/kernel.js';
import { LANGUAGES } from '../../src/tools/ts_kernel/languages.js';

const nodesOf = (lang: string): string[] | undefined => LANGUAGES.find((l) => l.name === lang)?.import_nodes;

describe('import 边 · 注册表（import_nodes 值 = 实测节点名）', () => {
  it('scala：import_declaration（+ 同形的 export_declaration）', () => {
    expect(nodesOf('scala')).toEqual(['import_declaration', 'export_declaration']);
    expect(typeof LANG_ADAPTERS['scala'].extractImportSources).toBe('function');
    expect(typeof LANG_ADAPTERS['scala'].extractImportBindings).toBe('function');
  });

  it('groovy：import_declaration（与 Java 同族的 scoped_identifier 链）', () => {
    expect(nodesOf('groovy')).toEqual(['import_declaration']);
    expect(typeof LANG_ADAPTERS['groovy'].extractImportSources).toBe('function');
    expect(typeof LANG_ADAPTERS['groovy'].extractImportBindings).toBe('function');
  });

  it('julia：import_statement + using_statement（**不含** export_statement：无模块源）', () => {
    expect(nodesOf('julia')).toEqual(['import_statement', 'using_statement']);
    expect(typeof LANG_ADAPTERS['julia'].extractImportSources).toBe('function');
    expect(typeof LANG_ADAPTERS['julia'].extractImportBindings).toBe('function');
  });

  it('haskell：import（module/alias/names 三字段）', () => {
    expect(nodesOf('haskell')).toEqual(['import']);
    expect(typeof LANG_ADAPTERS['haskell'].extractImportSources).toBe('function');
    expect(typeof LANG_ADAPTERS['haskell'].extractImportBindings).toBe('function');
  });

  it('elixir：**有意不声明**（import/alias/require/use 全是普通 call，无专用节点）', () => {
    // 与 ruby 同一纪律：声明 `call` 会让每次调用成为 import 候选（类别错误），
    // 且内核"命中 import_nodes 即 return"会让 defmodule 体内的 import 扫不到。
    expect(nodesOf('elixir')).toBeUndefined();
    expect(LANG_ADAPTERS['elixir'].extractImportSources).toBeUndefined();
  });
});

describe('import 边 · 真跑读数（parseFileFull 的实际产出）', () => {
  it('scala：点分路径 / 选择器列表 / 通配 / as 别名 / 逗号多源', async () => {
    const src = [
      'package app',
      'import scala.collection.mutable',
      'import scala.util.{Try, Success}',
      'import scala.util.{Try => T, Success as S}',
      'import allinone.*',
      'import app.Helper as H',
      'import a.b, c.d',
      'object Use { def run(): Int = Helper.twice(3) }',
    ].join('\n');
    const pf = await parseFileFull('Use.scala', src);
    expect(pf.error).toBeUndefined();
    expect(pf.imports.map((i) => i.source)).toEqual([
      'scala.collection.mutable',
      'scala.util',
      'scala.util',
      'allinone',
      'app.Helper',
      'a.b', // `import a.b, c.d` 是**一条** import_declaration 的两个源
      'c.d',
    ]);
    expect(pf.imports[0].kind).toBe('package');
    // 选择器列表里的名字是**绑定**、不是源（类别正确性）
    expect(pf.imports[1].bindings).toEqual(['Try', 'Success']);
    expect(pf.imports[2].bindings).toEqual(['T', 'S']);
    expect(pf.imports[4].bindings).toEqual(['H']);
  });

  it('scala：export_declaration 同形产边（Scala 3 再导出 = 同向依赖）', async () => {
    const pf = await parseFileFull('O.scala', 'object O { export app.Helper.* }\n');
    expect(pf.error).toBeUndefined();
    expect(pf.imports.map((i) => i.source)).toEqual(['app.Helper']);
  });

  it('groovy：普通 / static / as 别名 / 通配（尾部 DELIMITER 不许粘进 source）', async () => {
    const src = [
      'import helper.Helper',
      'import static helper.Helper.twice',
      'import java.util.List as L',
      'import allin.*',
      'def run() { return Helper.twice(3) }',
    ].join('\n');
    const pf = await parseFileFull('Use.groovy', src);
    expect(pf.error).toBeUndefined();
    expect(pf.imports.map((i) => i.source)).toEqual([
      'helper.Helper',
      'helper.Helper.twice', // static import：保留成员名（与 java 的 static import 同口径）
      'java.util.List',
      'allin',
    ]);
    expect(pf.imports[0].bindings).toEqual(['Helper']);
    expect(pf.imports[1].bindings).toEqual(['twice']);
    expect(pf.imports[2].bindings).toEqual(['L']);
  });

  it('julia：using / import:names / as 别名 / 逗号列表（成员名不当模块源）', async () => {
    const src = [
      'using Helper',
      'import Helper: twice',
      'import Other.Helper as H',
      'using A, B',
      'function run()\n    return Helper.twice(3)\nend',
    ].join('\n');
    const pf = await parseFileFull('Use.jl', src);
    expect(pf.error).toBeUndefined();
    expect(pf.imports.map((i) => i.source)).toEqual(['Helper', 'Helper', 'Other.Helper', 'A', 'B']);
    // 索引 1 是 `import Helper: twice`：源是 Helper，twice 是本地名
    expect(pf.imports[1].bindings).toEqual(['twice']);
    expect(pf.imports[2].bindings).toEqual(['H']);
  });

  it('julia：`export foo` 不产边（该节点**有意**不在 import_nodes 里）', async () => {
    const pf = await parseFileFull('M.jl', 'module M\nexport foo\nfunction foo()\n    1\nend\nend\n');
    expect(pf.error).toBeUndefined();
    expect(pf.imports).toEqual([]);
  });

  it('haskell：names 列表给出裸名绑定；alias 优先；裸 import 不给绑定', async () => {
    const src = [
      'module Use where',
      'import Lib (twice)',
      'import qualified Data.List as L',
      'import Data.Map (Map, empty)',
      'import Helper',
      'run :: Int',
      'run = twice 3',
    ].join('\n');
    const pf = await parseFileFull('Use.hs', src);
    expect(pf.error).toBeUndefined();
    expect(pf.imports.map((i) => i.source)).toEqual(['Lib', 'Data.List', 'Data.Map', 'Helper']);
    expect(pf.imports[0].bindings).toEqual(['twice']);
    expect(pf.imports[1].bindings).toEqual(['L']); // 有 as ⇒ 别名（而非模块末段 List）
    expect(pf.imports[2].bindings).toEqual(['Map', 'empty']);
    expect(pf.imports[3].bindings ?? []).toEqual([]); // 裸 import：不提供裸名 ⇒ 不给绑定
  });

  it('elixir：现状钉住 —— 有 import/alias 语句，但内核产出 0 条 import 边', async () => {
    const pf = await parseFileFull(
      'Use.ex',
      'defmodule Use do\n  import Helper\n  alias App.Helper\n  def run do\n    twice(3)\n  end\nend\n',
    );
    expect(pf.error).toBeUndefined();
    expect(pf.imports).toEqual([]);
  });
});
