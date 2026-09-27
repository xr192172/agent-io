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
   * `find_references` / `impact_analysis` / `rename_symbols` / `rename_files`。
   * 陈旧断言（resolved 但目标符号已不在索引）在这类工具上表现为**静默漏报** ——
   * 与 `staleIndexWarning`（落后于磁盘，全部工具）分工不同，见 trustNoteFor 注释。
   */
  trustAnnotated?: boolean;
}
