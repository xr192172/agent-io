/**
 * dsl_write_scope —— 「**谁在写设计 DSL**」的唯一授权载体（2026-10-22）
 *
 * ## 它挡的是什么（实测，不是推测）
 * 卡：`todo_设计-DSL-有多个写端-saveDSL-谁都能调-…`。实测 2026-10-22 当天
 * **41 次 DSL 改动全走 `saveDSL` 直写**（`node -e` + `import('dist/…/storage.js')`），
 * `edit_dsl` 一次没用 ⇒ `checkOpSpec`（键闸）/ `validateDSL`（结构闸）/ rev（乐观锁）**一道都没过**。
 * 用户原话：「我做设计 DSL 出来的理由就是**为了不让你直接在实际 DSL 上面改**，
 * 但是又需要你简单地拥有在实际 DSL 上改的写作难度」。
 *
 * ⇒ 病灶不在 `saveDSL` 的实现，在**它没有问"你是谁"**。
 *   本模块就是那个"你是谁"：一个**进程内、按调用栈传播**的授权（`AsyncLocalStorage`）。
 *   `storage.ts#saveDSL` 拿不到授权 ⇒ **抛**（不是警告）。
 *
 * ## 授权在哪儿发（**只有这几处**，加一处就要在这里登记）
 * | via | 发在哪 | 覆盖谁 |
 * |---|---|---|
 * | `edit_dsl` | `dsl_ops/update_feature.ts#updateFeatureCore` | 20 个 `dsl_ops/**` 写点（**人改设计的正路**） |
 * | `import`   | `graph/import_project.ts` 的落盘块 | 导入 / fork / 重建（扫描产物，不是人手改） |
 * | `tool`     | `presentation/mcp/server_registry.ts#invokeTool` | 25 个"工具派生"写点（derive / opl / dag_layout / archive / sync / approval …） |
 *
 * ★ 为什么 `edit_dsl` 之外还要给 `import` / `tool`：它们是**系统派生**，
 *   从来就不该走 op（`import_project` 造的是 640 个节点的扫描产物，没有一条 op 能表达它）。
 *   卡里那句"允许直写，但**调用点必须说得清自己是谁**"就是这个意思 ——
 *   现在"说不清"的代价是**运行期抛**，不再是一句注释。
 *
 * ## ★★★ 能力边界（如实写，别当成"安全墙"）
 * 同进程内**没有真能力隔离**：任何能 `import` 本模块的代码都能 `runDslWriteScope('tool', …)`。
 * 这道闸挡住的是**默认路径**（"顺手 import 就写"⇒ 现在是"顺手 import 就抛"），
 * 并让伪造**必须留下一行显式声明**（`runDslWriteScope` / `_sync.via`），可被 grep / 审阅点名。
 * ★ 不要指望它挡"蓄意绕过的人"；它挡的是 2026-10-22 那种**无意识的顺手直写**。
 *
 * ★ 另有两条**不需要授权**的通道，都在 `storage.ts#saveDSL` 里判（不在本模块）：
 *   ① **沙盒**（`AGENT_IO_HOME` 指到包根之外）—— 写的不是真设计册，写坏也没人受损；
 *   ② **画布补丁**（只改 `annotations` / `user_nodes` / `canvas_notes` 三格）—— 人手在浏览器上批注。
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 授权来源（闭集）。★ 新增一种 = 新增一个"合法写端" ⇒ 必须同时回答
 * "它在哪一行发的、为什么不能走 edit_dsl"，否则就是给自己开后门。
 */
export type DslWriteVia =
  /** 人/agent 改设计：`edit_dsl` → checkOpSpec → validateDSL → applyOperation → saveDSL */
  | 'edit_dsl'
  /** 扫描产物落盘：`import_project`（fork / 重建 / 重扫） */
  | 'import'
  /** 工具派生：`invokeTool` 之内（derive / archive / sync / approval … 那些**只**经工具面调用的） */
  | 'tool'
  /**
   * 派生写端**自己声明自己**：`dag_layout` / `opl` / `snapshot` / `arch_layer` / `monolith`。
   * ★ 为什么它们不能只靠 `tool`：`serve.ts` **直接 import** 这几个模块（画布布局、`/api/opl`、
   *   快照回滚、架构分层、单文件化预览）⇒ 走 HTTP 时**没有** `invokeTool` 作用域
   *   ⇒ 只在工具面发授权会把画布打断。
   * ⇒ 授权发在**写端自己身上**：谁写，谁声明（比"假设一定有人包了我"可靠）。
   */
  | 'derived';

export interface DslWriteGrant {
  readonly via: DslWriteVia;
  /** 具体入口（写进 `_sync.via` 做留痕）：`edit_dsl` / `import_project` / 工具名 */
  readonly who: string;
  readonly feature?: string;
  readonly at: string;
}

const als = new AsyncLocalStorage<DslWriteGrant>();

/**
 * 在授权作用域里跑一段（同步 / 异步都成立：原样返回 `fn()` 的返回值）。
 *
 * ★ 必须**包住真正的落盘调用**，不是包住"准备数据"—— 授权按**调用栈**传播，
 *   `await` 之后仍在同一个 `AsyncLocalStorage` 上下文里（`als.run` 的 store 会跟着 promise 走）。
 */
export function runDslWriteScope<T>(
  grant: { via: DslWriteVia; who: string; feature?: string },
  fn: () => T,
): T {
  const g: DslWriteGrant = { via: grant.via, who: grant.who, feature: grant.feature, at: new Date().toISOString() };
  return als.run(g, fn);
}

/** 当前是否在某个写授权里（没有 ⇒ `null`）。`storage.ts#saveDSL` 的唯一判据入口。 */
export function currentDslWriteScope(): DslWriteGrant | null {
  return als.getStore() ?? null;
}
