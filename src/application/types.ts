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
   * ★★★ 2026-11-17（T-#HEARTBEAT-DERIVED）：**系统派生写不算"工具写"** —— 写闸 A7 通过时顺手刷的
   *   心跳（`task_ops#touchTaskHeartbeat`）在**写端自己身上**发 `via:'derived', who:'heartbeat'` 授权
   *   （与 dag_layout / opl / snapshot / arch_layer 同一范式）⇒ 只改源码的工具即使经过写闸，也**不必**
   *   登记 writes:true（那会是对注册表说谎：心跳不是它的业务写）。本字段只管
   *   "该工具**自己的功能**写不写设计册"。
   */
  writes: boolean;
  /**
   * ★★ 第⑥项（2026-11-10 · 用户裁定）：**MCP 标准工具注解**（2025-06-18 规范的 ToolAnnotations）——
   * `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`，字段名对齐规范 ⇒
   * 任意 MCP 客户端可通用读取（审批/确认策略）。
   * ★ 规范语义：**全是 hints，不是安全保证**（"a declaration, never an observation"）——
   *   本仓的**写闸判定**仍住 `writes` 布尔（saveDSL 闸）与 write_gate；注解是**对外**的标准声明，
   *   两层共存不混用（writes = 内部分闸读数，annotations = 对外客户端提示）。
   * ★ **全 43 工具显式标注**（规范说缺省按保守处理 ⇒ 消歧义更稳）。
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
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
