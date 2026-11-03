/**
 * registry/types.ts —— 工具定义类型
 *
 * ★ P1a（2026-09-28）：从 `server_registry.ts`（3,586 行）抽出的**基础设施**。
 *   工具注册表的最小类型契约。
 *
 * 为什么必须先抽这一层（而不是直接按 lane 切 TOOL_DEFS）：
 *   lane 文件要用到这里的东西，而它们原先都定义在 `server_registry.ts` 内部 ⇒
 *   lane 一 import 就成环（server_registry → lanes → server_registry）。
 *   拆出本模块后，lane 文件可以单向依赖它。
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  /**
   * ★ 该工具是否经 saveDSL/saveDesignSheet **写「设计册」**（saveDSL 写闸的唯一读数）。
   * 口径（2026-11-03 主控裁定）：写源码（edit_code）、写 output/（get_dsl render）、
   * 写报告文件（observe / explore_code）**都不算** —— 它们由 write_gate / 各工具自管，不是这道闸。
   * true = 该工具落盘设计册 ⇒ saveDSL 闸按 `toolWritesOf(name)` 放行；
   * false = 该工具拿 `via:'tool'` 授权写设计册 ⇒ **抛且点名工具名**（storage.ts#assertDslWriteAllowed）。
   */
  writes: boolean;
  inputSchema: Record<string, z.ZodType>;
  handler: (args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  /**
   * true = 本工具**不要**被自动保鲜（L3①）。
   * 只有"自检类 / 自己做全量导入"的工具需要它：
   *   - `index_integrity`：refresh:false 必须是**纯只读** —— 若被自动保鲜，它报告的就是
   *     "修完之后"的现状而非"LLM 马上要读到的"现状，那是另一种撒谎。
   *   - `import_project`：自己做全量导入，前置保鲜纯属浪费。
   */
  noAutoFresh?: boolean;
  /**
   * true = 本工具的结果**自动附可信度标注**（陈旧断言检测）。
   * 只有"准备基于索引做改动 / 下的结论会被拿去行动"的工具需要它：
   * `find_references` / `explore_code action=impact` / `rename_symbols` / `rename_files`。
   * 陈旧断言（resolved 但目标符号已不在索引）在这类工具上表现为**静默漏报** ——
   * 与 `staleIndexWarning`（落后于磁盘，全部工具）分工不同，见 trustNoteFor 注释。
   */
  trustAnnotated?: boolean;
}
