/**
 * sync_contracts：以 server_registry 的 zod schema 为唯一事实源，回填 DSL 的 expected_apis。
 *
 * 修复结构性摩擦 D（三份契约漂移：DSL expected_apis / server_registry zod / TS 类型）：
 *   - zod schema（MCP 契约）是唯一源
 *   - 本工具把每个已注册工具的输入契约生成签名 + notes，回填到 DSL semantic.files 的 expected_apis
 *   - 改了 schema 后跑一次 → DSL 契约自动跟上，不再手工对齐
 *
 * 默认（include_all=false）：只更新 DSL 中已存在且 path 匹配 src/tools/{name}.ts 的文件，
 *   不新增节点（契约文件属于文档性质，不在架构图里）。
 * include_all=true：为 DSL 中缺失的工具文件补全契约文件节点（连同 geometry 节点），
 *   用于"新工具接入"时让 DSL 契约一次到位。
 *
 * 语义边界：本工具只回填"签名 + notes（机器生成标记）"；设计侧的决策卡/notes 意图由 LLM 维护。
 * 循环依赖说明：TOOL_DEFS 由 server_registry 导出，本模块仅在函数执行期读取（handler 调用时），
 *   不在模块加载期求值，ESM 循环 import 安全。
 */
import { TOOL_DEFS } from '../presentation/mcp/server_registry.js';
import { getDSL, saveDSL, getPackageRoot } from '../infrastructure/storage.js';
import fs from 'node:fs';
import path from 'node:path';
import type { DesignDSL } from '../domain/types.js';

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

export function syncContracts(input: SyncContractsInput): SyncContractsResult {
  const dsl = getDSL(input.feature);
  if (!dsl) throw new Error(`feature ${input.feature} 不存在，请先写 DSL 或 import_project`);
  const includeAll = input.include_all ?? false;

  // 自身不写自己（sync_contracts 的契约由 server_registry 的注册本身保证）
  const tools = TOOL_DEFS.filter((t) => t.name !== 'sync_contracts');
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
    `sync_contracts [${input.feature}]：工具契约与 server_registry 对齐完成。` +
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
