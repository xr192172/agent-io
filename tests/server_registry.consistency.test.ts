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
import { TOOL_DEFS } from '../src/application/tool_registry.js';
import { laneTexts } from './helpers/lane_files.js';

const PKG_ROOT = path.resolve(__dirname, '..');
const TOOLS_DIR = path.join(PKG_ROOT, 'src/tools');

/**
 * ★★ 2026-10-01（搬 T11）：**工具实现已不再住 `src/tools/`** ——
 *   它们按能力线搬进了 `src/application/<线>/`，少数进了 `src/infrastructure/**` 与 `src/presentation/cli/`。
 *   ⇒ 原先四处"拿 `src/tools/<name>.ts` 拼路径"的写法**全部失效**。
 *   ⇒ 收敛成**一个落点**：`resolveToolFile(name)` 按 basename 在 `src/` 下查找（不另抄名单）。
 */
const SRC_DIR = path.join(PKG_ROOT, 'src');
const _findCache = new Map<string, string | null>();
function findUnder(dir: string, fileName: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const r = findUnder(p, fileName);
      if (r) return r;
    } else if (e.name === fileName) return p;
  }
  return null;
}
/** 按 basename（不含 .ts）在 `src/` 下找实现文件；找不到返回 null */
function resolveToolFile(name: string): string | null {
  if (!_findCache.has(name)) {
    // ★ 2026-10-01：模块可以是「单文件」也可以是「文件夹 + index barrel」
    //   （`rename_symbol` 已按语言拆成文件夹）⇒ 两种形态都认。
    //   这不是放宽判据：`<name>/index.ts` 就是该模块的入口。
    _findCache.set(name, findUnder(SRC_DIR, `${name}.ts`) ?? findFolderModule(SRC_DIR, name));
  }
  return _findCache.get(name) ?? null;
}
/** 找「文件夹形式的模块」：某个名为 `name` 的目录下有 `index.ts` */
function findFolderModule(dir: string, name: string): string | null {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name === name) {
      const idx = path.join(p, 'index.ts');
      if (fs.existsSync(idx)) return idx;
    }
    const r = findFolderModule(p, name);
    if (r) return r;
  }
  return null;
}
/** 「工具实现」现在住的两处：能力线目录 + CLI/HTTP 面 */
function toolImplBasenames(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) {
        out.push(e.name.replace(/\.ts$/, ''));
      }
    }
  };
  for (const rel of ['application', 'presentation/cli']) {
    const abs = path.join(SRC_DIR, rel);
    if (fs.existsSync(abs)) walk(abs);
  }
  return out;
}

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
    importedBy: ['src/infrastructure/analysis/structure/derive_feature_tree.ts'],
    why: 'derive_feature_tree 的底座识别步骤；其对内实现，不单独注册',
  },
  collect_functions: {
    importedBy: ['src/presentation/cli/brickify_cli.ts', 'src/application/meta/registry/classify_tools.ts'],
    why: '积木化/分类两个 CLI 共用的函数收集器；不是 MCP 工具',
  },
  contract_gate: {
    importedBy: ['src/application/refactor/refactor_pipeline.ts'],
    why: 'refactor_pipeline 的契约闸门检查步骤；不是 MCP 工具',
  },
  dag_layout: {
    importedBy: ['src/presentation/http/serve.ts', 'src/application/design/update_feature.ts'],
    why: 'DAG 布局算法（serve 渲染 + update_feature 共用）；纯算法模块',
  },
  detect_dead_imports: {
    importedBy: [
      'src/application/design/brickify.ts',
      'src/application/design/brick_bag.ts',
      'src/presentation/cli/deprecate_offline.ts',
      'src/infrastructure/analysis/structure/feature_map.ts',
      'src/application/refactor/function_annotation.ts',
      'src/application/refactor/refactor_pipeline.ts',
    ],
    why: '死 import 检测是多个工具/CLI 共用的分析步骤；本身不是 MCP 工具',
  },
  diff_impact: {
    importedBy: [
      'src/infrastructure/analysis/diagnosis/impact_analyzer.ts',
      'src/application/meta/explore/explore_code.ts',
      'src/application/meta/impact/impact_report.ts',
      'src/presentation/http/serve.ts',
      'src/infrastructure/index/watch_project_tool.ts',
    ],
    why: '变更影响面计算，被 explore_code / impact_report 等复用；不是独立工具',
  },
  guided_tour: {
    importedBy: ['src/application/meta/explore/explore_code.ts', 'src/application/meta/view/overview.ts', 'src/presentation/http/serve.ts'],
    why: '引导式导览生成，被 explore_code / overview 等复用',
  },
  inject_replay: {
    importedBy: ['src/application/meta/explore/explore_code.ts'],
    why: 'explore_code 的 replay 注入实现',
  },
  language_concepts: {
    importedBy: ['src/presentation/http/serve.ts'],
    why: '语言概念词典（serve 渲染用）；不是 MCP 工具',
  },
  query_feature: {
    importedBy: ['src/application/handlers.ts', 'src/presentation/mcp/server_registry.ts'],
    why: '★ 已注册工具 `get_dsl` 的真正实现（handlers 里 `queryFeature(a)`）；注册名 ≠ 文件名',
  },
  update_feature: {
    importedBy: ['src/presentation/daemon/daemon.ts', 'src/application/handlers.ts', 'src/presentation/mcp/server_registry.ts'],
    why: '★ 已注册工具 `edit_dsl` 的真正实现；注册名 ≠ 文件名',
  },
  watch_project: {
    importedBy: ['src/presentation/http/serve.ts', 'src/infrastructure/index/watch_project_tool.ts'],
    why: '文件监听内核，被 serve 与 watch_project_tool 复用',
  },
  wizard_steps: {
    importedBy: ['src/presentation/cli/render_wizard.ts'],
    why: '向导步骤生成，render_wizard 的实现细节',
  },
  feature_ops: {
    importedBy: ['src/application/design/manage_feature.ts'],
    why: 'manage_feature 的 feature 增删改实现（createFeature 等）',
  },
  render_workbench: {
    importedBy: ['src/presentation/cli/brickify_cli.ts'],
    why: '工作台渲染，brickify CLI 的实现细节',
  },
  feature_map: {
    importedBy: ['src/application/design/brickify.ts', 'src/application/design/brick_bag.ts', 'src/application/design/render_brickwork.ts'],
    why: 'buildFeatureMap 是 import_project / render_brickwork 等的内部派生助手',
  },
  derive_feature_tree: {
    importedBy: ['src/application/meta/view/overview.ts'],
    why: '功能树派生，overview 的实现细节',
  },
  // ─────────────────────────────────────────────────────────────
  // ★★ T14 新增的 8 条（2026-10-01）：把"正则不认 async"的盲区补上后**当场掀出来的**。
  //   它们共同的特征：**有 `export async function <文件名camelCase>()`**，所以此前被整类漏检；
  //   而它们的真实身份**不是独立 MCP 工具**，是「被兄弟模块 import 的实现零件」——
  //   正是本表规则 #2 收的那一类。逐条已核过真实的 import 者（门每次跑都会复算）。
  //   ★ 处置口径：按本门棘轮的要求先问过"能不能被自动判据盖住"——
  //     答：盖不住。`isAbsorbedByFacade` 只看**工具面（lane index）**的直接 import；
  //     这 8 条的 import 者都是**别的实现模块**（explore_code / derive_chain / split_stage /
  //     rename_files / brickify_cli …）⇒ 正是"自动判定盖不到的那一类"。
  // ─────────────────────────────────────────────────────────────
  classify_bricks: {
    importedBy: ['src/presentation/cli/brickify_cli.ts', 'src/application/design/workbench_data.ts'],
    why: '积木解剖/分类算法：brickify 工作台 CLI 与 workbench_data 共用；不是 MCP 工具',
  },
  classify_tools: {
    importedBy: ['src/presentation/cli/brickify_cli.ts', 'src/presentation/cli/render_tools_map.ts'],
    why: '工具域分类（TOOL_DOMAINS 那套映射）；brickify_cli / render_tools_map 共用的内部算法',
  },
  derive_algorithm: {
    importedBy: ['src/application/design/derive_chain.ts'],
    why:
      '算法结构派生。★ 诚实备注：其主函数 `deriveAlgorithm` **目前无调用方** —— ' +
      'explore_code 的 `derive_algorithm` 分支仍是空壳（只回显 project_dir）；' +
      '真正被复用只有常量 `KIND_SHAPE`（derive_chain 引）。属"explore_code 空壳 action"那一笔，已记入 docs/todo.md',
  },
  derive_anim_flow: {
    importedBy: ['src/application/meta/explore/explore_code.ts'],
    why: 'explore_code 的 `derive_anim_flow` action 实现（2026-10-01 接线，替换原空壳）',
  },
  derive_split: {
    importedBy: ['src/application/design/split_stage.ts'],
    why: 'split_stage（CLI 引擎）的拆分算法实现；explore_code 的 derive_split 分支另走 monolith.buildSplitPreviewDsl',
  },
  rename_file: {
    importedBy: ['src/application/refactor/rename_files.ts', 'src/application/refactor/rename_symbol/languages/typescript.ts'],
    why: '★ 已注册工具 `rename_files` 的**单数引擎**（注册入口是 rename_files.ts）；注册名 ≠ 文件名',
  },
  rename_symbol: {
    importedBy: [
      'src/application/refactor/rename_symbols.ts',
      'src/application/refactor/find_references.ts',
      'src/application/refactor/symbol_move.ts',
    ],
    why: '★ 已注册工具 `rename_symbols` 的**单数引擎**（注册入口是 rename_symbols.ts）；注册名 ≠ 文件名',
  },
  semantic_search: {
    importedBy: ['src/application/meta/explore/explore_code.ts', 'src/presentation/http/serve.ts'],
    why: 'explore_code 的 `search` action 实现（符号索引/向量/trigram 三层检索内核）；serve 也复用',
  },
};

/**
 * ★ 棘轮基线：条目数**只许减不许增**（与仓内其他门同款纪律）。
 *   新增一条 = 手抄清单又长了一行 ⇒ 红。
 *   ⇒ 想加？先问"能不能被 `isAbsorbedByFacade` 或"被兄弟 import"这条判据自动覆盖"；
 *     真盖不住才允许登记，并在**同一次提交**里把基线 +1 并写明理由。
 *
 * ★★ 2026-10-01（T14）：17 → 25（+8，一次）。理由见上：补上 `async` 盲区后，
 *   这 8 个文件第一次被门看见，而它们确实是"被兄弟模块 import 的实现零件"（本表规则 #2 的那一类）。
 *   ★ 这不是"清单又腐了一格"，而是"门此前**看不见**它们，所以清单里从来没有它们"。
 *   ⇒ 反向验证：这 8 条**全部**依赖 `export async function` —— 若不修 T14，它们永远不该被登记。
 */
const INTERNAL_MODULES_BASELINE = 25;

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
      const impl = resolveToolFile(d.name);
      if (impl !== null) continue; // 有同名实现文件 → OK
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

    // 实现侧的 op 联合（与 src/application/refactor/edit_code.ts 的 EditCodeOp 保持一致）
    const implOps = ['replace', 'insert', 'delete', 'range', 'replace_text'];
    const missing = implOps.filter((o) => !values.includes(o));
    expect(missing, `实现支持但 schema 未暴露（从 MCP 面不可达）：${missing.join(', ')}`).toEqual([]);
  });

  it('src/tools 下主函数名=文件名 camelCase 的工具文件必须已注册（漏注册检测，摩擦 E）', () => {
    const files = toolImplBasenames();
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
    // ★ 2026-09-30（搬 ⑦）：lane 不再同目录 —— 每条线住 `src/application/<线名>/index.ts`。
    //   这里改用**唯一落点** `tests/helpers/lane_files.ts`（线名从 `LANE_SOURCES` 派生，不另抄名单）；
    //   原先 `readdirSync('src/registry/lanes')` 在目录消失后直接 ENOENT。
    const laneSource = laneTexts().map((t) => t.text).join(String.fromCharCode(10));
    // ★★★ 2026-10-02（第 3 次修）：**改成"看真实文件路径"而不是"看说明符字面"**。
    //   本门已经被搬动作坏三次了（注释自己记着）：`'/tools/<name>.js'` → `'./<name>.js'` → 现在
    //   实现按域进了子目录（`'./archive/<name>.js'`、`'./view/<name>.js'`…）⇒ 字面模式**又**失效，
    //   把「被工具面吸收」误判成「漏注册」。
    //   ★ 根因：**说明符的字面随文件位置变，而"被谁 import"这件事不变**。
    //   ⇒ 判据改成：把 lane 里的相对 import **解析到真实的仓内文件**，再看目标文件是不是它。
    //     这一步与目录层级**无关** —— 以后再搬也不会坏。
    const laneImportTargets = new Set<string>();
    for (const { file, text } of laneTexts()) {
      const dir = path.dirname(file);
      for (const m of text.matchAll(/['"](\.[^'"]*)['"]/g)) {
        const spec = m[1];
        if (!spec.startsWith('.')) continue;
        const abs = path.resolve(dir, spec).replace(/\.(js|ts|tsx|jsx|mjs|cjs)$/, '');
        laneImportTargets.add(path.relative(PKG_ROOT, abs).split(path.sep).join('/'));
      }
    }
    const isAbsorbedByFacade = (base: string): boolean => {
      const f = resolveToolFile(base);
      if (!f) return false;
      const modPath = path.relative(PKG_ROOT, f).split(path.sep).join('/').replace(/\.tsx?$/, '');
      return laneImportTargets.has(modPath);
    };

    for (const base of files) {
      if (base in INTERNAL_MODULES) continue;
      if (isAbsorbedByFacade(base)) continue; // ★ 被工具面吸收 ⇒ 不是独立工具，无需注册
      const camel = toCamel(base);
      const content = fs.readFileSync(resolveToolFile(base)!, 'utf-8');
      // 主函数名 == 文件名 camelCase（约定），如 diff_views.ts export diffViews
      // ★★ T14（2026-10-01）：原先只认 `export function` ⇒ **`export async function` 被整类漏掉**。
      //   实测命中 29 个工具实现（edit_code / explore_code / find_references / import_project /
      //   detect_drift / derive_mind_map / index_integrity / rename_* / reconcile_* …）
      //   ⇒ isToolImpl 恒 false ⇒ 本门直接 continue ⇒ **这些工具丢了注册也报不出来**。
      const isToolImpl = new RegExp(`export\\s+(?:async\\s+)?function\\s+${camel}\\b`).test(content);
      if (!isToolImpl) continue;
      // 注册名约定 = snake_case 文件名；历史命名不一致的（实现模块名 ≠ 注册名）
      // 用 alias 宽松匹配：存在某注册，其实现在该文件里
      const expectName = toSnake(camel);
      if (!new Set(TOOL_DEFS.map((d) => d.name)).has(expectName)) {
        // ★★ T14 顺带修（同一处方上的另一半）：这里原先拼 `path.join(TOOLS_DIR, …)`，
        //   而 `TOOLS_DIR = src/tools` 已被 P2 搬空 ⇒ 该查找**恒不命中**，alias 永远 undefined。
        //   本文件自己的头注（见上「本门原先就栽在"假设实现在 src/tools/ 下"」）正是这个病，
        //   而这一行**没跟着改干净**。⇒ 复用同一个落点函数 `resolveToolFile()`。
        const alias = TOOL_DEFS.find((d) => {
          const impl = resolveToolFile(d.name);
          return impl !== null && fs.readFileSync(impl, 'utf-8')
            .match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${camel}\\b`)) !== null;
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
    const stale = entries.filter(([name]) => !fs.existsSync(resolveToolFile(name) ?? path.join(SRC_DIR, '__not_found__', `${name}.ts`))).map(([n]) => n);
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
        // ★ 2026-10-01：模块可以是「单文件」也可以是「文件夹 + index barrel」（rename_symbol 已按语言拆成文件夹）
        //   ⇒ 两种形态都算"真的 import 了它"。这**不是放宽判据**：barrel 就是该模块的入口，
        //   而 `src/application/refactor/rename_symbol/index.js` 与老的 `rename_symbol.js` 是同一个模块。
        if (!new RegExp(`from '[^']*/${name}(?:/index)?\\.js'`).test(s)) bad.push(`${name}: ${f} 其实没有 import 它`);
      }
    }
    expect(bad, `INTERNAL_MODULES 的 importedBy 与实际不符：\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('★ 被 lane import 的模块**不许**登记（isAbsorbedByFacade 已能自动判定 ⇒ 登记就是冗余手抄）', () => {
    const laneSource = laneTexts().map((t) => t.text).join(String.fromCharCode(10));
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
