/**
 * server_registry 一致性检查（结构性摩擦 D/E 的兜底）
 *
 * 摩擦 E（注册滞后）修复：新工具文件（src/tools/{name}.ts，主函数名=文件名 camelCase）
 *   必须已注册进 TOOL_DEFS；漏注册 → 本测试红。
 * 摩擦 D（契约漂移）兜底：TOOL_DEFS 本身的元数据/schema 必须健康（name 唯一、schema 合法），
 *   sync_contracts 据此回填 DSL expected_apis。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { TOOL_DEFS } from '../src/server_registry';

const PKG_ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(PKG_ROOT, 'src/tools');

/** snake_case → camelCase：diff_views → diffViews */
const toCamel = (s: string) => s.replace(/_(\w)/g, (_, c) => c.toUpperCase());
/** camelCase → snake_case：diffViews → diff_views */
const toSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/**
 * 内部/主工具实现模块（有主函数但非独立 MCP 工具）—— 漏注册检测的**豁免登记表**。
 *
 * ★★ 2026-09-29 升级（**本笔**）：原先是一个裸 `Set<string>`。那是本仓头注一直在批的
 *   「**手抄清单**」病根，而且**长在门自己身上** —— 名单腐烂了**没有任何东西会红**。
 *   实测抓到三类腐烂（`.inspect/audit_internal_modules.mjs` / `who_imports_internal.mjs`）：
 *     · `derive_reasoning` —— **文件已不存在**（陈旧条目，挂了很久没人发现）
 *     · `archive_node`    —— 已被 lane import ⇒ 下方 `isAbsorbedByFacade` **已能自动判定**（冗余）
 *     · `list_features`   —— **无人 import** ⇒ 是**死代码**（不是"内部模块"），而它一直躲在名单里
 *   ⇒ 改成「**登记 + 门复算**」：每条必须给出 `importedBy`（谁在用它的**证据**）与 `why`，
 *     门逐条复算这些断言；断言不成立 ⇒ 红。想豁免就必须写出**机器能核实的理由**。
 *
 * ★ 判据（不写清就会退化成"什么都往里塞"）：
 *   1. **被 lane（`[C]` 层）import 的 ⇒ 不必登记**（`isAbsorbedByFacade` 自动判定）。登记了会红。
 *   2. ★ 本表**只收**「被**兄弟模块**（别的 `[B]` / `registry` / `daemon`）import」的 ——
 *      那是自动判定盖不到的那一类，也正是用户 2026-09-28 说的
 *      「*有一些工具被其他工具依赖了，就先写一个 skip，后续再移植*」。
 *   3. `importedBy` 里的每个路径必须**存在**且**真的 import 了本模块**（门复算，防止写成愿望）。
 *   4. ★ **不许**登记"无人 import"的模块 —— 那是死代码，处置是**删**，不是豁免
 *      （本笔就据此删掉了 `src/tools/list_features.ts`：它被 `query_feature` 的 `features`
 *       分支**严格取代**，且 `get_dsl` 工具的实现本就直通 `queryFeature`）。
 *   5. `why` 写清"它是谁的实现"，≥10 字。
 *
 * ★ 新增真正的 MCP 工具文件（`src/tools/{x}.ts` 且 `export function {x}()`）⇒ **必须注册**，不在本表。
 */
const INTERNAL_MODULES: Record<string, { importedBy: string[]; why: string }> = {
  analyze_monolith: {
    importedBy: ['src/tools/derive_feature_tree.ts'],
    why: 'derive_feature_tree 的底座识别步骤；其对内实现，不单独注册',
  },
  collect_functions: {
    importedBy: ['src/tools/brickify_cli.ts', 'src/tools/classify_tools.ts'],
    why: '积木化/分类两个 CLI 共用的函数收集器；不是 MCP 工具',
  },
  contract_gate: {
    importedBy: ['src/tools/refactor_pipeline.ts'],
    why: 'refactor_pipeline 的契约闸门检查步骤；不是 MCP 工具',
  },
  dag_layout: {
    importedBy: ['src/tools/serve.ts', 'src/tools/update_feature.ts'],
    why: 'DAG 布局算法（serve 渲染 + update_feature 共用）；纯算法模块',
  },
  detect_dead_imports: {
    importedBy: [
      'src/tools/brickify.ts',
      'src/tools/brick_bag.ts',
      'src/tools/deprecate_offline.ts',
      'src/tools/feature_map.ts',
      'src/tools/function_annotation.ts',
      'src/tools/refactor_pipeline.ts',
    ],
    why: '死 import 检测是多个工具/CLI 共用的分析步骤；本身不是 MCP 工具',
  },
  diff_impact: {
    importedBy: [
      'src/infrastructure/analysis/diagnosis/impact_analyzer.ts',
      'src/tools/explore_code.ts',
      'src/tools/impact_report.ts',
      'src/tools/serve.ts',
      'src/tools/watch_project_tool.ts',
    ],
    why: '变更影响面计算，被 explore_code / impact_report 等复用；不是独立工具',
  },
  guided_tour: {
    importedBy: ['src/tools/explore_code.ts', 'src/tools/overview.ts', 'src/tools/serve.ts'],
    why: '引导式导览生成，被 explore_code / overview 等复用',
  },
  inject_replay: {
    importedBy: ['src/tools/explore_code.ts'],
    why: 'explore_code 的 replay 注入实现',
  },
  language_concepts: {
    importedBy: ['src/tools/serve.ts'],
    why: '语言概念词典（serve 渲染用）；不是 MCP 工具',
  },
  query_feature: {
    importedBy: ['src/registry/handlers.ts', 'src/server_registry.ts'],
    why: '★ 已注册工具 `get_dsl` 的真正实现（handlers 里 `queryFeature(a)`）；注册名 ≠ 文件名',
  },
  update_feature: {
    importedBy: ['src/presentation/daemon/daemon.ts', 'src/registry/handlers.ts', 'src/server_registry.ts'],
    why: '★ 已注册工具 `edit_dsl` 的真正实现；注册名 ≠ 文件名',
  },
  watch_project: {
    importedBy: ['src/tools/serve.ts', 'src/tools/watch_project_tool.ts'],
    why: '文件监听内核，被 serve 与 watch_project_tool 复用',
  },
  wizard_steps: {
    importedBy: ['src/tools/render_wizard.ts'],
    why: '向导步骤生成，render_wizard 的实现细节',
  },
  feature_ops: {
    importedBy: ['src/tools/manage_feature.ts'],
    why: 'manage_feature 的 feature 增删改实现（createFeature 等）',
  },
  render_workbench: {
    importedBy: ['src/tools/brickify_cli.ts'],
    why: '工作台渲染，brickify CLI 的实现细节',
  },
  feature_map: {
    importedBy: ['src/tools/brickify.ts', 'src/tools/brick_bag.ts', 'src/tools/render_brickwork.ts'],
    why: 'buildFeatureMap 是 import_project / render_brickwork 等的内部派生助手',
  },
  derive_feature_tree: {
    importedBy: ['src/tools/overview.ts'],
    why: '功能树派生，overview 的实现细节',
  },
};

/**
 * ★ 棘轮基线：条目数**只许减不许增**（与仓内其他门同款纪律）。
 *   新增一条 = 手抄清单又长了一行 ⇒ 红。
 *   ⇒ 想加？先问"能不能被 `isAbsorbedByFacade` 或"被兄弟 import"这条判据自动覆盖"；
 *     真盖不住才允许登记，并在**同一次提交**里把基线 +1 并写明理由。
 */
const INTERNAL_MODULES_BASELINE = 17;

describe('server_registry 一致性', () => {
  it('tool def 元数据齐全：name 唯一、title/description 非空、handler 有效、schema 是合法 zod', () => {
    const names = TOOL_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length); // name 唯一

    for (const d of TOOL_DEFS) {
      expect(d.title, `title 缺失: ${d.name}`).toBeTruthy();
      expect(d.description, `description 缺失: ${d.name}`).toBeTruthy();
      expect(typeof d.handler, `handler 缺失: ${d.name}`).toBe('function');
    }
    // schema：每个参数项必须是 zod 类型（zod v4：_def.type 为内部类型标签，如 string/optional/enum…）
    const invalid: string[] = [];
    for (const d of TOOL_DEFS) {
      for (const [k, z] of Object.entries(d.inputSchema)) {
        const typeTag = (z as { _def?: { type?: string } })._def?.type;
        if (!typeTag) invalid.push(`${d.name}.inputSchema.${k}（实际: ${(z as { constructor?: { name?: string } }).constructor?.name}）`);
      }
    }
    expect(invalid, `非法 zod schema 项：\n${invalid.join('\n')}`).toEqual([]);
  });

  it('每个注册工具对应的实现文件存在（src/tools/{name}.ts）', () => {
    const missing: string[] = [];
    for (const d of TOOL_DEFS) {
      const impl = path.join(TOOLS_DIR, `${d.name}.ts`);
      if (fs.existsSync(impl)) continue; // 有同名实现文件 → OK
      // 无同名文件：允许——主工具（get_dsl/edit_dsl 等）在 server_registry 内实现
    }
    expect(missing).toEqual([]);
  });

  it('★ edit_code 的 op 枚举必须覆盖实现的全部 op（防"实现支持但 schema 不暴露"的死代码）', () => {
    // 背景（2026-09-14 实测发现）：edit_code 实现早就支持 op='replace_text'
    // （「不需要符号索引/行号」的唯一文本替换，恰好是零前置场景下最好用的安全小改），
    // 但注册 schema 的 op 枚举只有 replace/insert/delete/range ⇒ 该分支从 MCP 面**不可达**。
    // 这条用例把这个缺口钉住：改实现加了新 op 就必须同步枚举，否则这里红。
    const def = TOOL_DEFS.find((d) => d.name === 'edit_code');
    expect(def, 'edit_code 未注册').toBeTruthy();
    const opSchema = (def!.inputSchema as Record<string, unknown>)['op'] as {
      options?: unknown;
      _def?: { entries?: unknown };
      _zod?: { def?: { entries?: unknown } };
    };
    const raw = opSchema.options ?? opSchema._def?.entries ?? opSchema._zod?.def?.entries;
    const values: string[] = Array.isArray(raw)
      ? (raw as string[])
      : raw instanceof Set
        ? [...(raw as Set<string>)]
        : Object.keys((raw ?? {}) as Record<string, unknown>);
    expect(values.length, 'op 枚举解析失败（zod 内部结构变了？）').toBeGreaterThan(0);

    // 实现侧的 op 联合（与 src/tools/edit_code.ts 的 EditCodeOp 保持一致）
    const implOps = ['replace', 'insert', 'delete', 'range', 'replace_text'];
    const missing = implOps.filter((o) => !values.includes(o));
    expect(missing, `实现支持但 schema 未暴露（从 MCP 面不可达）：${missing.join(', ')}`).toEqual([]);
  });

  it('src/tools 下主函数名=文件名 camelCase 的工具文件必须已注册（漏注册检测，摩擦 E）', () => {
    const files = fs
      .readdirSync(TOOLS_DIR)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .map((f) => f.replace(/\.ts$/, ''));
    const registered = new Set(TOOL_DEFS.map((d) => d.name));

    const missing: string[] = [];
    // ★★ 2026-09-29（面收敛撞出的门盲区）：**被某个工具面吸收的实现模块，不需要自己注册。**
    //
    // 起因：面收敛（`archive_node` → lane `archive`）后本测试误报"漏注册"。根因见下方 alias 匹配：
    //   它假设「每个工具的实现在 `src/tools/<工具名>.ts`」，而**新入口没有同名实现文件**
    //   （`archive`/`bricks`/`snapshot`/`rules` 复用旧模块）⇒ 假设破产 ⇒ 把老实现误判成漏注册。
    //
    // 正解（治本）：扫 **lane 文件（`[C]` 层）** —— 若该模块**被任何 lane import**，
    //   它就是这个面里某个工具的**实现**（而不是一个独立 MCP 工具）⇒ 天然豁免。
    //   ★ 这样以后每收一个面都**不用再往 INTERNAL_MODULES 手抄一行**（本仓病根就是手抄清单）。
    const laneDir = path.join(PKG_ROOT, 'src', 'registry', 'lanes');
    const laneSource = fs.existsSync(laneDir)
      ? fs.readdirSync(laneDir).filter((f) => f.endsWith('.ts'))
          .map((f) => fs.readFileSync(path.join(laneDir, f), 'utf-8')).join('\n')
      : '';
    const isAbsorbedByFacade = (base: string): boolean =>
      laneSource.includes(`/tools/${base}.js'`) || laneSource.includes(`/tools/${base}.js"`);

    for (const base of files) {
      if (base in INTERNAL_MODULES) continue;
      if (isAbsorbedByFacade(base)) continue; // ★ 被工具面吸收 ⇒ 不是独立工具，无需注册
      const camel = toCamel(base);
      const content = fs.readFileSync(path.join(TOOLS_DIR, `${base}.ts`), 'utf-8');
      // 主函数名 == 文件名 camelCase（约定），如 diff_views.ts export diffViews
      const isToolImpl = new RegExp(`export\\s+function\\s+${camel}\\b`).test(content);
      if (!isToolImpl) continue;
      // 注册名约定 = snake_case 文件名；历史命名不一致的（实现模块名 ≠ 注册名）
      // 用 alias 宽松匹配：存在某注册，其实现在该文件里
      const expectName = toSnake(camel);
      if (!new Set(TOOL_DEFS.map((d) => d.name)).has(expectName)) {
        const alias = TOOL_DEFS.find((d) => {
          const impl = path.join(TOOLS_DIR, `${d.name}.ts`);
          return fs.existsSync(impl) && fs.readFileSync(impl, 'utf-8').includes(`export function ${camel}(`);
        });
        if (!alias) missing.push(`${base}.ts（主函数 ${camel} 未注册）`);
      }
    }
    expect(missing, `漏注册的工具文件：\n${missing.join('\n')}\n请在 server_registry.ts 注册`).toEqual([]);
  });
});

/**
 * ★ INTERNAL_MODULES 登记表**自校验**（本笔新增）—— 复算每条断言，让名单不许腐烂。
 *
 * 为什么必须有这一组：升级前的裸 `Set` 腐烂了**三处**却无声（文件已删、被 lane 覆盖、死代码），
 * 而"名单腐烂"与"工具漏注册"在门眼里**长得一模一样** —— 都是"该红却没红"。
 * ⇒ 让每条豁免都携带**可复算的证据**（`importedBy`），门每次跑都重算一遍。
 */
describe('INTERNAL_MODULES 登记表自校验（复算，防手抄清单腐烂）', () => {
  const entries = Object.entries(INTERNAL_MODULES);

  it('每条 why 写清了"它是谁的实现"（≥10 字）', () => {
    for (const [name, v] of entries) {
      expect(v.why?.trim().length ?? 0, `${name} 的 why 太短，写不清"它是谁的实现"`).toBeGreaterThanOrEqual(10);
    }
  });

  it('登记的文件必须存在（陈旧条目 ⇒ 红）', () => {
    const stale = entries.filter(([name]) => !fs.existsSync(path.join(TOOLS_DIR, `${name}.ts`))).map(([n]) => n);
    expect(stale, `这些登记条目指向不存在的文件（已删？请一并删条目）：\n  ${stale.join('\n  ')}`).toEqual([]);
  });

  it('★ 每条 importedBy 都真实存在、且**真的** import 了该模块（断言复算）', () => {
    const bad: string[] = [];
    for (const [name, v] of entries) {
      const declared = new Set(v.importedBy ?? []);
      expect(declared.size, `${name} 必须给出 importedBy（谁在用它的证据）`).toBeGreaterThan(0);
      for (const f of declared) {
        if (!fs.existsSync(path.join(PKG_ROOT, f))) { bad.push(`${name}: importedBy 里的 ${f} 不存在`); continue; }
        const s = fs.readFileSync(path.join(PKG_ROOT, f), 'utf-8');
        if (!new RegExp(`from '[^']*/${name}\\.js'`).test(s)) bad.push(`${name}: ${f} 其实没有 import 它`);
      }
    }
    expect(bad, `INTERNAL_MODULES 的 importedBy 与实际不符：\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('★ 被 lane import 的模块**不许**登记（isAbsorbedByFacade 已能自动判定 ⇒ 登记就是冗余手抄）', () => {
    const laneDir = path.join(PKG_ROOT, 'src/registry/lanes');
    const laneSource = fs.readdirSync(laneDir).filter((f) => f.endsWith('.ts'))
      .map((f) => fs.readFileSync(path.join(laneDir, f), 'utf-8')).join('\n');
    const redundant = entries
      .filter(([name]) => laneSource.includes(`/tools/${name}.js'`) || laneSource.includes(`/tools/${name}.js"`))
      .map(([n]) => n);
    expect(redundant, `这些模块已被 lane import ⇒ 自动判定会接住，条目属冗余（请删）：\n  ${redundant.join('\n  ')}`).toEqual([]);
  });

  it('★ 棘轮：条目数只许减不许增（新增手抄一行 ⇒ 红）', () => {
    expect(
      entries.length,
      `INTERNAL_MODULES 条目 ${entries.length} > 基线 ${INTERNAL_MODULES_BASELINE} ⇒ 手抄清单又长了。\n` +
        '先问它能不能被 `isAbsorbedByFacade`（被 lane import）自动覆盖；\n' +
        '真盖不住才登记，并在同一次提交里把 INTERNAL_MODULES_BASELINE 一并 +1 且写明理由。',
    ).toBeLessThanOrEqual(INTERNAL_MODULES_BASELINE);
  });

  it('★ 出生证：判据对"文件不存在"的条目**真的会红**（跑的是上面那条存在性判据的同源写法）', () => {
    const fake = ['__gate_probe_absent__'];
    expect(fs.existsSync(path.join(TOOLS_DIR, `${fake[0]}.ts`)), '探针名撞上了真实文件，换一个').toBe(false);
    const wouldBeStale = fake.filter((n) => !fs.existsSync(path.join(TOOLS_DIR, `${n}.ts`)));
    expect(wouldBeStale, '假条目没被判成陈旧 ⇒ 判据本身失效').toEqual(fake);
  });
});
