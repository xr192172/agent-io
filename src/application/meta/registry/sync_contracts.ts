/**
 * sync_contracts：以 server_registry 的 zod schema 为唯一事实源，回填 DSL 的 expected_apis。
 *
 * 修复结构性摩擦 D（三份契约漂移：DSL expected_apis / server_registry zod / TS 类型）：
 *   - zod schema（MCP 契约）是唯一源
 *   - 本工具把每个已注册工具的输入契约生成签名 + notes，回填到 DSL semantic.files 的 expected_apis
 *   - 改了 schema 后跑一次 → DSL 契约自动跟上，不再手工对齐
 *
 * 默认（include_all=false）：只更新 DSL 中已存在、且 path 能被 `resolveImplPath()` 解析到的文件，
 *   不新增节点（契约文件属于文档性质，不在架构图里）。
 * include_all=true：为 DSL 中缺失的工具文件补全契约文件节点（连同 geometry 节点），
 *   用于"新工具接入"时让 DSL 契约一次到位。
 *
 * 语义边界：本工具只回填"签名 + notes（机器生成标记）"；设计侧的决策卡/notes 意图由 LLM 维护。
 *
 * ★ 2026-10-01（④-2 按能力改判整条线）：本文件**从 `src/tools/` 搬到 `application/meta/`** ——
 *   它的能力是「以注册表为事实源回填工具契约」= **元数据 / 注册**能力，与 `capability_map` 同族。
 *   ★ 目录**不再 import 聚合器**（那会成环：`handlers → 本文件 → tool_registry → <线>/index → handlers`），
 *     改从**叶子** `./capability_map.js` 取注入目录（`listToolDefs()`，由 `tool_registry` 加载期注入）。
 *     ⇒ 5 条已知 `no-circular` 由此**结构性消失**，而不是"这次特判放过"。
 */
import { listToolDefs } from './capability_map.js';
import { getDSL, saveDSL, getPackageRoot } from '../../../infrastructure/storage.js';
import fs from 'node:fs';
import path from 'node:path';
import type { DesignDSL } from '../../../domain/types.js';
import { withTouched, type Touched, type TouchedProduct } from '../../../domain/b_terms.js';

export interface SyncContractsInput {
  /** feature 名（已存在的 DSL feature） */
  feature: string;
  /** 为 DSL 中缺失的工具文件补全契约节点（默认 false：只更新已存在的） */
  include_all?: boolean;
}

export interface SyncContractsResult {
  message: string;
  feature: string;
  added_files: string[];
  updated_files: string[];
  unchanged: number;
  /** ★ 2026-10-01：解析不到同名实现文件、因而未参与回填的工具名（**显式**，不静默跳过） */
  unresolved: string[];
}

/** zod v4 内部类型标签（_def.type）→ TS 类型 */
function zodToTs(z: unknown): string {
  const d = (z as { _def?: { type?: string; element?: unknown; valueType?: unknown; entries?: Record<string, unknown>; values?: unknown; options?: unknown[]; innerType?: unknown } } | undefined)?._def;
  switch (d?.type) {
    case 'string': return 'string';
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'date': return 'Date';
    case 'array': return `${zodToTs(d.element)}[]`;
    case 'record': return `Record<string, ${zodToTs(d.valueType)}>`;
    case 'enum': return `'${Object.keys(d.entries ?? {}).join("' | '")}'`;
    case 'literal': return `'${String(d.values)}'`;
    case 'union': return (d.options ?? []).map(zodToTs).join(' | ') || 'unknown';
    case 'optional':
    case 'default':
    case 'nullable':
      return zodToTs(d.innerType);
    default:
      return 'unknown';
  }
}

function isOptional(z: unknown): boolean {
  const t = (z as { _def?: { type?: string } } | undefined)?._def?.type;
  return t === 'optional' || t === 'default' || t === 'nullable';
}

/**
 * ★★ 2026-10-01（搬 T11）：**工具实现已按能力线搬离 `src/tools/`**。
 *
 * 本文件原先写死 `src/tools/${name}.ts` 去匹配 DSL 里记的文件路径 ——
 * 搬完之后那条模板**匹配不到任何文件** ⇒ 本工具**静默变成空操作**（走查测试是它的证据）。
 *
 * ⇒ 改为**按 basename 在包根的 `src/` 下解析真实路径**：
 *   · 用 `getPackageRoot()` 自省锚定（与 storage 的既有做法一致，**不依赖 cwd**）；
 *   · **找不到就抛** —— 不许拿旧模板兜底（兜底会让它继续静默空转，违反"失败就说失败"）。
 */
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
/**
 * 解析成功返回仓库相对路径；**找不到返回 null**。
 * ★ 为什么不是"一律抛"：本仓**有些注册工具是在 lane 里内联实现**的（没有同名实现文件）
 *   —— 一致性门自己就写着「无同名文件：允许——主工具（get_dsl/edit_dsl 等）在注册表内实现」。
 *   ⇒ 对它们，"DSL 里没有对应文件条目"是**正常**，不是错误。
 *   ★ 但**不许静默**：跳过谁要如实报出来（见 `unresolved`）。
 */
function resolveImplPath(name: string): string | null {
  const root = getPackageRoot();
  const found = findUnder(path.join(root, 'src'), `${name}.ts`);
  return found ? path.relative(root, found).split(path.sep).join('/') : null;
}

function syncContractsCore(input: SyncContractsInput): SyncContractsResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature ${input.feature} 不存在，请先写 DSL 或 import_project`);
  const includeAll = input.include_all ?? false;

  // 自身不写自己（sync_contracts 的契约由注册表的注册本身保证）
  const tools = listToolDefs().filter((t) => t.name !== 'sync_contracts');
  const files = dsl.semantic?.files ?? [];
  const added: string[] = [];
  const updated: string[] = [];
  let unchanged = 0;

  /** 无同名实现文件的工具（在 lane 内联实现）⇒ 没有 DSL 文件条目可回填，如实记下 */
  const unresolved: string[] = [];

  for (const t of tools) {
    const filePath = resolveImplPath(t.name);
    if (filePath === null) {
      unresolved.push(t.name);
      continue;
    }
    const params = Object.entries(t.inputSchema)
      .map(([k, z]) => `${k}${isOptional(z) ? '?' : ''}: ${zodToTs(z)}`)
      .join('; ');
    const signature = `${t.name}({ ${params} })`;
    const notes = `MCP 工具契约（sync_contracts 自动回填，事实源=server_registry zod schema；LLM review 后保留/修改）`;

    const existing = files.find((f) => f.path === filePath);
    if (existing) {
      const has = existing.expected_apis?.some((a) => a.signature === signature);
      if (has) {
        unchanged++;
        continue;
      }
      existing.expected_apis = [...(existing.expected_apis ?? []), { signature, notes }];
      updated.push(filePath);
    } else if (includeAll) {
      files.push({
        id: `f_sync_contracts_${t.name}`,
        path: filePath,
        responsibility: `工具契约（sync_contracts 生成）：${t.title}`,
        expected_apis: [{ signature, notes }],
      });
      added.push(filePath);
    }
  }

  let next: DesignDSL = { ...dsl, semantic: { ...(dsl.semantic ?? {}), files } };

  // include_all 时补 geometry 节点（file.id ↔ node.id 对齐），避免契约文件悬空
  if (includeAll && added.length > 0) {
    const nodes = [...(next.geometry?.nodes ?? [])];
    for (const f of files) {
      if (!nodes.some((n) => n.id === f.id)) {
        nodes.push({ id: f.id, x: 0, y: 0, width: 200, height: 60, label: f.path });
      }
    }
    next = { ...next, geometry: { ...(next.geometry ?? { layout: 'free', width: 800, height: 400 }), nodes } };
  }

  saveDSL(next);

  const msg =
    `sync_contracts [${input.feature}]：工具契约与注册表对齐完成。` +
    `新增 ${added.length} 个契约文件（${added.join(', ') || '无'}），` +
    `更新 ${updated.length} 个（${updated.join(', ') || '无'}），未变 ${unchanged}。` +
    // ★★ 2026-10-01：**不许静默跳过** —— 解析不到实现文件的工具（在 lane 内联实现的那些）
    //   没有 DSL 文件条目可回填，**必须如实报出来**，否则读者会以为"全都对齐了"。
    (unresolved.length
      ? `\n★ 跳过 ${unresolved.length} 个（无同名实现文件 ⇒ 无 DSL 文件条目可回填，属正常）：${unresolved.join(', ')}`
      : '') +
    (includeAll ? '' : '\n（未传 include_all，未补全新文件节点；如需让新工具一次到位可传 include_all=true）');
  return {
    message: msg,
    feature: input.feature,
    added_files: added,
    updated_files: updated,
    unchanged,
    /** 解析不到实现文件、因而未参与回填的工具名（**显式**，不静默） */
    unresolved,
  };
}

/**
 * ★ 唯一的构造点：把"我动了什么"集中算一次，所有出口都从这一个地方出去。
 *
 * 口径（`Touched` 两类字段，见 domain/b_terms.ts:42-89）：
 *   - 作用域类（`feature`）：随时可给，不依赖成败；
 *   - 对象类（`written_files` / ...）：只有**真发生**才给，否则整项省略。
 */
function touchedOf(input: SyncContractsInput): Touched {
  // 只给作用域类 feature。
  // ★★ **绝不给 written_files** —— `added_files` / `updated_files` 名字像"写了这些文件"，
  //   实际是**回填进 DSL 的语义文件条目路径**（Core :140 / :148 只 push 进 `files` 数组，
  //   随后 `saveDSL` 落 dataHome），**磁盘上根本没写这些文件**（名字像 ≠ 同义）。
  //   本 [B] 唯一的落盘是 `saveDSL`（dataHome 下、不在仓库里）⇒ 给不出"仓库相对"的 written_files。
  return { feature: input.feature };
}

export function syncContracts(input: SyncContractsInput): TouchedProduct<SyncContractsResult> {
  const r = syncContractsCore(input);
  return withTouched(r, touchedOf(input));
}
