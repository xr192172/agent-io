/**
 * design_book_scope —— 「这一笔读/写的是**哪一本**设计册」的唯一锚点载体（2026-11-19）
 *
 * ## 它挡的是什么（实测，不是推测）
 * `docs` 之外的现场读数：延迟普查席 `Temp\latency-ds-1.md` §8 ——
 *   `design_intent action=set feature=agent-io-toolface` 的探针 `cwd` 与 `project_dir` **都指向砂箱**，
 *   设计册却被写进**另一个仓**（真仓 `.agent-io/design/agent-io-toolface.dsl.json`，`_dsl_rev` 28→36），
 *   砂箱里那份同名册**逐字节未变**；显式再传 `project_dir=<砂箱绝对路径>` 仍然写错地方。
 *
 * ⇒ 病灶不在"哪个工具忘了判断"，在 **`getDesignSheetFile(feature)` 只有一个解析器**：
 *   `baseDir ?? projectRootOf(feature) ?? 数据家`。
 *   而 `design_intent` **有 `project_dir` 入参、却从不往下传**（`design/index.ts` 的 handler 把它丢了），
 *   `edit_dsl` 甚至在 `handlers.ts` 的顶层键白名单里写着"工具忽略它" ————
 *   于是"人指的那个目录"在整条写链上**根本不存在**，只剩注册表那一个答案。
 *   对单仓开发无害；对"照着一个仓跑工具、改另一个仓"是**写错地方且不报错**（本仓最重的病：静默）。
 *
 * ## 口径（与全仓其他写端一致，不新造第二把尺）
 * 册的锚点**只有一个解析点**：`storage.ts#getDesignSheetFile`（`getDesignSheet` 读、`saveDesignSheet` 写都走它）。
 * 本模块只提供"这次调用的显式锚点"，由那一个解析点按
 *   **显式 `project_dir`（本模块的作用域） > `feature → 项目根` 注册表 > 数据家（迁移通道）**
 * 取第一个成立的。★ 顺序不是新发明的：它就是 `saveDSL(…, { baseDir })` 早已在用的那条
 * （`storage.ts#saveDSL` 的 `writeRoot = opts?.baseDir ?? projectRootOf(...)`），
 * 本轮只是**让工具入参里的 `project_dir` 真能走到它**。
 *
 * ## 为什么用 `AsyncLocalStorage`（而不是给 20 个 dsl_ops 各加一个参数）
 * 写链是"读册 → 改 → 落盘"三段，中间穿过 `node_ops` / `edge_ops` / `task_ops` / `storage_overlay` …
 * 十几个模块；逐个加参数 = 新增第十几处"记得传"，迟早漏一处，而漏的那一处**写的是另一本册**（比报错坏得多）。
 * ⇒ 与 `dsl_write_scope`（"谁在写"）同构：**一个进程内、按调用栈传播的锚点**，包在
 *   `updateFeature` 的**最外层**（那里是 `edit_dsl` / `design_intent` 两条路的共同入口）。
 *
 * ★ 能力边界（如实写）：它不拦"蓄意绕过的人"，拦的是**默认路径**——
 *   只要走 `edit_dsl` / `design_intent`，`project_dir` 就真的决定册的位置；不传则行为与改前逐字相同。
 *
 * ★ 与 `dsl_write_scope.ts` 的分工（别合并）：`dsl_write_scope` 答"**谁**在写"（授权，缺了要抛）；
 *   本模块答"写**哪一本**"（锚点，缺了有默认值）。两者都是按调用栈传播的，但判据完全不同。
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';

/** 当前调用的册锚点（= 该项目根；册落在 `<root>/.agent-io/design/<feature>.dsl.json`） */
const als = new AsyncLocalStorage<string>();

/**
 * 把 `project_dir` 归一成一个**显式锚点**；缺省 / 空串 / 非字符串 ⇒ `undefined`（= 沿用注册表口径）。
 *
 * ★ 为什么在**这里**就 `path.resolve`：写端是唯一知道"这是哪个目录"的地方，把 `.` 之类的相对值
 *   一路带到 `getDesignSheetFile` 里，它只能靠 cwd 再解析一次 —— 而 cwd 与本项目**没有关系**
 *   （`storage.ts#requireProjectRoot` 那段"cwd 是另一个项目"的裁定同一条）。
 * ★ 为什么不把空串当"没给"之外的意思：空串不是"更弱的答案"，是"给了个无效值"，
 *   但本函数不做裁决（裁决在调用方：给了空串就当没给，与 `project_dir?: string` 的形状一致）。
 */
export function designBookBaseDir(projectDir?: unknown): string | undefined {
  if (typeof projectDir !== 'string') return undefined;
  const raw = projectDir.trim();
  if (!raw) return undefined;
  return path.resolve(raw);
}

/** 在锚点作用域里跑一段（同步 / 异步都成立：原样返回 `fn()` 的返回值，`await` 之后锚点仍在）。 */
export function runDesignBookAnchor<T>(baseDir: string | undefined, fn: () => T): T {
  if (baseDir === undefined) return fn(); // 没给锚点 ⇒ 不进作用域（行为与改前逐字相同，零额外状态）
  return als.run(baseDir, fn);
}

/** 当前锚点（没有 ⇒ `undefined`）。读端唯一入口是 `storage.ts#getDesignSheetFile` 的那一行。 */
export function currentDesignBookAnchor(): string | undefined {
  return als.getStore();
}

/** 已出过声的 (feature, 锚点) —— 每对一次，热路径上不刷屏（与 `storage.ts` 的迁移告警同款） */
const noted = new Set<string>();

/**
 * **显式锚点与注册表不一致 ⇒ 出声一次**（AGENTS 0.12：跨册写必须可见）。
 *
 * 为什么必须出声：改前的那种"写错地方不报错"正是本节要根除的病；改后"按人指的目录写"是**对的**，
 * 但"注册表里这本册住别处、这次却写到这儿"是一个**人需要知道的事实**（可能是探针、也可能是
 * 注册表过期），一句 stderr 就够，不必拒。★ 只在**真的不一致**时说话，正常单仓开发零噪声。
 */
export function noteDesignBookAnchorOverride(feature: string, anchor: string, registryRoot: string): void {
  const key = `${feature}\u0000${anchor}`;
  if (noted.has(key)) return;
  noted.add(key);
  process.stderr.write(
    `[design-book-anchor] feature "${feature}"：本次按**显式 project_dir** 读写设计册 —— ${anchor}\n` +
      `  （注册表里这本册住 ${registryRoot}；两处不一致 ⇒ 本笔**没有**碰注册表那一本）\n`,
  );
}

/** 测试 / 诊断用：清空"已出声"记录（★ 不是生产失效入口）。 */
export function forgetDesignBookAnchorNotes(): void {
  noted.clear();
}
