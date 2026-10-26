/**
 * server_registry：MCP 工具注册表（路线图序号 2 收敛）
 *
 * 只注册主工具（2026-08-17 起旧工具名别名已全部移除，无兼容层）。
 *
 * 设计：
 * - 每个工具定义 = { name, title, description, inputSchema, handler }
 * - handler(args) 返回 MCP content 数组（text + isError）
 * - 主工具走强 schema；explore_code/manage_feature 用宽松 record，内部强校验
 *
 * 主工具 handler 复用现有纯函数（src/tools/*.ts），不重写业务逻辑，因此
 * 500+ 单测（针对纯函数）不受影响。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ensureProjectIndex, detectStaleIndex } from '../../infrastructure/index/index_freshness.js';
// ★ T221：逐调用保鲜**改走统一机制**（★ 评测④：工序表没人调 ⇒ 现在接了 ✓）
import { ensureStage } from '../../application/stage_registry.js';
import { hasLiveIndex, resolveActor } from '../../application/write_gate.js';
// ★★★ 2026-10-21（并发控制·读集比对）：**读集记录的唯一调用点**。
//   为什么在这一层（`invokeTool`）：它是 MCP 面与 CLI 面的**唯一入口** ⇒ 两个面自动同口径；
//   而且『谁在读』（`actor`）只有这一层有（`read` / `facts` 的 args 里没有身份维度）。
//   形状解析（`rel_path` / `symbols` / `start` / `end`）全在 `read_set` 里，本文件只递回执。
import { recordReadFromInvocation } from '../../application/read_set.js';
// ★★★ 2026-10-21（并发控制·账户）：**身份规范 / 校验 / 归一化的唯一落点**就在下面的 `invokeTool`。
//   ★ 为什么在这一层：它是 MCP 面与 CLI 面的**唯一入口** ⇒ 一处生效、以后加工具不用记得；
//     而且读集的分桶键取的就是这层解析出来的 `actor`（`read_set` 从这儿拿）⇒ **校验与使用同源**。
//   ★ 规范本身住在 `domain/actor_spec.ts`（唯一处），本文件只调它，不判第二遍。
import { admitActor, normalizedActorNote } from '../../domain/actor_spec.js';
import { scheduleBackfill, backfillState, isBackfillRunning } from '../../infrastructure/index/index_backfill.js';
import { unknownArgHints, renderArgHints } from '../../infrastructure/text/arg_suggest.js';
import { collectPendingAlertText, dispatchDslEdit } from '../../application/dispatch.js';
// ★★★ 2026-10-22（A1）：**工具面是"系统派生写 DSL"的唯一合法出口** —— 在这里声明一次，
//   25 个派生写点（derive / opl / dag_layout / archive / sync / approval …）全部落在授权内；
//   而 `node -e "import('dist/…/storage.js').saveDSL(…)"` 拿不到它 ⇒ 抛（见 storage.ts#assertDslWriteAllowed）。
//   ★ 为什么在**唯一咽喉**发、而不是逐个写点发：逐个发 = 25 处各写一份声明，
//     漏一处就是一个静默撒谎点（本仓"判据住两处"的经典死法）；而这里本来就是"全部工具都走这里"。
import { runDslWriteScope } from '../../infrastructure/dsl_write_scope.js';
// ★★ 2026-10-06：「下一棒」提示 —— 链的接法（`CHAIN_EDGES`）+ 机器段标记（**单点**，别硬编码）
import { renderNextHops, nextHopsOf } from '../../domain/chain_wiring.js';
// ★ T251（2026-10-13）：`parseDataBlock` = 取 `---DATA---` 后**第一行**的**唯一**解析器
//   （`DATA_MARKER` 单点 + 单行载荷口径都住它那一处）—— 本文件取 `touched` 走它，不再自写切法。
import { DATA_MARKER, parseDataBlock } from '../../application/plumbing.js';
// ★★ 2026-10-06：「面」—— 目录口径（`catalogOf`，单点）+ 面的机算（`facesOf`）+ 各线 direct 白名单
// ★ 2026-10-11：接续段的**入参路径表**改用 `collectInputPaths`（必填判定在 `renderHandoffPanel` 里，
//   复用 `declaredRequiredMembersOf` —— 与 `capability_map` 的「接续」段**同源**，T140 第二处）。
import { catalogOf, collectInputPaths, LANE_META } from '../../application/meta/registry/capability_map.js';
import type { InputPath } from '../../application/meta/registry/capability_map.js';
// ★ T54 收口：「下一棒」印具体值，**共用** capability_map 的同一个渲染（别在这写第二份）
import { renderHandoffPanel } from '../../application/meta/index.js';
import { facesOf, mcpFace, MINIMAL_FACE_TOOLS } from '../../application/meta/registry/tool_faces.js';
// ★ T179：**仓根**要用仓里已有的"向上找"（`resolveProjectRoot`：git 根 → 最近 manifest）——
//   ★ 不许再手算 `'..', '..'`（那是"级数随位置变"的补丁，见下方 STALE SOURCE 段的注释）。
import { resolveProjectRoot } from '../../infrastructure/analysis/project_root/index.js';
// ★★ 2026-10-26（T-②）：**判据合一** —— 本文件不再自比 mtime（那曾是第二把尺，见下方 STALE SOURCE 段），
//   改为委派唯一实现 `stale_check#checkStaleBuild`（mtime 只做触发，内容哈希才是判定）。
import { checkStaleBuild, readBuildManifest } from '../../application/observe/runtime/stale_check.js';
// ★★★ I1（2026-10-25）：根解析的**级 3**（feature → 该 feature 设计 DSL 的 source_root）要读 DSL。
import { getDSL } from '../../infrastructure/storage.js';
// ★ T173：`mcpFace()` 的定义已搬到 `tool_faces.ts`（与「说面」的回执同处）—— 这里 re-export 保持对外 API 不变。
export { mcpFace };

// （`tools/stale_check` 的导入已随 P-F 删除：本文件不再直接消费它 —— 三个 stale 告警各自
//   探测，`stale_check.formatStaleText` 仍由 lanes/observe.ts 的 `run_tests` 前置提示使用。）
import { getProjectCacheDb, nearestCacheDb } from '../../infrastructure/index/db.js';
import { recordDogfoodUsage, type DogfoodVia } from '../../infrastructure/dogfood_stats.js';
import { prewarmKernel } from '../../infrastructure/parse/index.js';

/**
 * ★★ 2026-10-08 补：**把注释承诺的「进程启动预热」真的接上**。
 *
 * 实测：`prewarmKernel(` 在 `src/` 下**一个调用点都没有**（只在 `kernel.ts` 被定义），
 * 而 `write_gate` / `symbols` / `scaffold` / `remove_dead_imports` 的注释**都**在说
 * 「进程启动 `prewarmKernel()` 预热后，同步工具可走同步路径」——**那句承诺是空的**
 * （与 G4 同形：文档说做了，实际没做）。
 *
 * 后果：`parseFileFullSync` 恒返回 `解析器未预热`、`canParseFileSync` 恒 false ⇒
 * **同步解析路径从来没通过** ⇒ 同步工具只能退化（这也是仓里到处是文本回退的根因之一）。
 *
 * 放在**唯一调用入口**（MCP 与 CLI 逐字同路径）⇒ 一处覆盖两面；`prewarmPromise` 保证只起一次。
 * ★ 2026-10-08 更正：原文写「`void` ⇒ **不阻塞本次调用**」——**那句已被下面那段推翻**
 *   （fire-and-forget 会让每次 CLI 调用都落在「预热还没完成」上）⇒ 现在是**首次调用 await 一次**。
 *   开篇声明与实现必须同时改：本文件原样犯过「注释承诺 ≠ 实现」（正是它要修的那件事）。
 */
let prewarmPromise: Promise<void> | null = null;

/**
 * ★★ 2026-10-08 **修正**：预热必须**可等待**，不能 fire-and-forget。
 *
 * 为什么（实测回归）：原版是 `void prewarmKernel()...`（不阻塞本次调用）——
 * 但 **CLI 每次调用都是「第一次调用」**（一次进程一个工具调用）⇒ 处理器执行时预 warm
 * 还没完成 ⇒ `getParserSync` 仍为 null ⇒ **依赖同步 AST 的路径全部拿不到事实**。
 * 后果实测：`dead_imports` 的删除侧（②-c 刚换成共享绑定事实）**一个 import 都不删了，且不报错**
 * —— 又一个「不报错的错」（静默少删）。
 *
 * 所以：**首次调用等它一次**（此后所有调用都命中缓存的 Promise）。
 * 代价：本进程第一次工具调用慢一点（一次性）；收益：同步 AST 路径**真的**可用。
 * ★ 失败也**不吞**（落 stderr）—— 但那会让依赖它的路径退回保守（少删），方向是安全的。
 */
function ensureKernelPrewarmed(): Promise<void> {
  if (!prewarmPromise) {
    prewarmPromise = prewarmKernel()
      .then((r) =>
        console.error(
          `[ts_kernel] prewarm: ${r.warmed} 个解析器就绪` +
            // ★ 2026-10-08：① 原文案说「语言包」是错的（missing 里装的是 **ext**）；
            //   ② **新增**报「注册了但没装」—— 那类是此前**看不见**的（夹缝在最上面那段注释里）。
            (r.missing.length ? `（${r.missing.length} 个扩展名加载失败）` : '') +
            // ★★ 2026-10-08 收（③′）：**只报计数，不逐次刷 33 个名字**。
            //   为什么（上一笔自己留下的形态错误）：一次列 33 个名字是**每次启动都刷的噪音**，
            //   而**噪音会训练人忽略它**（本仓最忌的「狼来了」）。
            //   ★ 那 33 个名字是**静态**的（注册表里 kind 不变、装没装只随机器变）⇒ 它们不携带
            //     「(本次/本项目) 有什么」的信息 —— **按项目交叉**才携带。而按项目的明细已经有人报：
            //     `code_health` 的 `bounds.skipped` 逐后缀报出（只报**本项目真有文件**的那些，
            //     还带「补：npm i xxx」）。
            //   ★ 这不是「静默省略」：计数还在，`prewarmKernel()` 的**返回值**照旧带全量
            //     `notInstalled`（数据 API 未动）—— 去掉的只是**没人要的那次喊话**。
            (r.notInstalled.length
              ? ` ★ 另有 ${r.notInstalled.length} 门语言【注册了但没装】（静态清单，不逐次刷屏；` +
                `本项目真用到哪些 ⇒ 看 code_health 的 bounds.skipped，那里逐后缀带「补 npm i xxx」）`
              : ''),
        ),
      )
      .catch((e) => console.error(`[ts_kernel] prewarm 失败：${e instanceof Error ? e.message : String(e)}`));
  }
  return prewarmPromise;
}
import path from 'node:path';
import { statSync, readFileSync, writeFileSync, readdirSync, existsSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ─────────────────────────────────────────────────────────────
// 陈旧进程检测（版本握手）
// ─────────────────────────────────────────────────────────────

/**
 * 狗食缺陷修复：MCP 进程长驻，dist 重建后进程仍运行旧代码，AI 侧表现为
 * "工具缺失/参数报错却不知原因"（2026-08-18 decisions 查询缺失事件）。
 *
 * 机制：进程加载时记录本文件（dist/server_registry.js）的 mtime；
 * 每次工具调用轻量 stat 比对，dist 更新后在所有返回（含错误）尾部追加
 * 重启警告。警告由 registerAllTools 统一注入（唯一出口，覆盖全部工具；
 * wrap/wrapData 不再各自追加）。开销 = 每调用一次 stat，可忽略。
 *
 * ★ P-F（§16.6）：注入出去的**不是字符串**而是结构化告警（`ToolWarning`），
 *   由 `emitWarnings`（registry/tool_warnings.ts）负责①首次全文/后续一行摘要 ②追加
 *   `---WARNINGS---` 机器块。本文件的三个生产方只负责"判出来"。
 */
const SELF_PATH = (() => {
  try {
    return fileURLToPath(import.meta.url);
  } catch {
    return null; // 异常环境（理论不可达）——禁用检测
  }
})();
const SELF_MTIME_MS: number | null = SELF_PATH ? safeMtimeMs(SELF_PATH) : null;

function safeMtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// ───── 陈旧构建（STALE_BUILD）─────
// ★★★ 2026-10-26（T-#2）：**不再比 mtime，也不再只看一个文件**。
//   原先：`staleBuildWarningFor(SELF_MTIME_MS, safeMtimeMs(SELF_PATH))` —— 只盯
//   `dist/src/presentation/mcp/server_registry.js` 一个文件的 mtime：
//     · 漏：tsc 重建了**别的**文件（如 consistency.js）时它不报；
//     · 误：只要 touch 一下它就报（而内容可能没变）。
//   ⇒ 现在读**同一个事实**：构建清单的 `stamp`（生产者 = `clean_dist.mjs`，见 stale_check.ts）：
//     本进程启动时记下 stamp（`BOOT_MANIFEST_STAMP`），调用时再读一份，**不同 ⇒ dist 被重建过**。
//   这样 STALE_BUILD 与 STALE_SOURCE 两个告警都站在**同一份构建事实**上，不再各比各的 mtime。

/** dist 已在本进程启动后重建 ⇒ 告警；否则 null。判据 = 清单 stamp 变了（不看 mtime）。 */
function staleBuildWarning(): ToolWarning | null {
  if (!PACKAGE_ROOT || !BOOT_MANIFEST_STAMP) return null;
  try {
    const now = readBuildManifest(PACKAGE_ROOT)?.stamp ?? null;
    if (!now || now === BOOT_MANIFEST_STAMP) return null;
    return {
      code: 'STALE_BUILD',
      summary: 'dist 已在本进程启动后重建 ⇒ 当前响应来自旧代码（新增工具/字段/参数可能缺失或报"未知"错误）',
      detail: `构建清单 stamp 从 ${BOOT_MANIFEST_STAMP} 变为 ${now} —— 本进程加载的是重建**之前**的编译产物。`,
      fix: '重启 agent-io MCP server 后再执行写操作',
    };
  } catch {
    return null; // 自检失败不假阳性
  }
}

// ───── STALE SOURCE：改了 src 却忘了 build 的检测 ─────
// 补齐 staleBuildWarning 覆盖不到的缺口——它只在 dist 被重建后(un进程仍旧)提示，
// 若用户改了 src 但没 build，dist mtime 不变则完全无感。此处检测「src 比 dist 新」。
// ★★★ 2026-10-11（T179，**黑盒外的 bug 猎人查出来的 HIGH**）：**原先这里是手算 `'..', '..'`** ——
//   而 `SELF_PATH` = `<root>/dist/src/presentation/mcp/server_registry.js`
//   ⇒ 上溯 2 级只到 `<root>/dist/src`（★ **到仓根要 4 级**）⇒ `SRC_DIR` 算成 `<root>/dist/src/src` **不存在** ✗
//   ⇒ ★★ 后果：`newestMtime` 恒返回 null ⇒ ★ **「改了 src 却忘了 build」的 STALE_SOURCE 告警【永远不触发】**，
//     而且**没有任何报错**（★ 正是本仓最在意的「**检测静默失效**」= 假绿灯）✓
//   ⇒ ★ **修法不是"把 2 改成 4"**（那只是补丁：级数随文件位置变，下次搬家还会错）——
//     **改用仓里已有的 `resolveProjectRoot()`**（向上找 `.git` → 最近 manifest），★ **一处判据** ✓
const PACKAGE_ROOT = SELF_PATH ? resolveProjectRoot(SELF_PATH) : null;

/** 本进程启动时读到的构建清单 stamp（null = 启动时无清单 ⇒ 无法判断"是否重建过"，宁可不报） */
const BOOT_MANIFEST_STAMP: string | null = (() => {
  if (!PACKAGE_ROOT) return null;
  try {
    return readBuildManifest(PACKAGE_ROOT)?.stamp ?? null;
  } catch {
    return null;
  }
})();

// ★ 2026-10-26（T-#2）：本文件旧的 mtime 判据族（newestMtime / cachedSrcMtime / staleSourceWarningFor）
//   已随「判据合一」全部删除 —— 它们与 `stale_check#checkStaleBuild` 构成两把尺。
//   要回头看它们的形状：git log 9b5e43a3 之前的版本。


/**
 * src 比 dist 新（改了源码未 build）⇒ 结构化告警；否则 `null`。
 *
 * ★ P-F（§16.6）：原先的状态位 `_lastStaleState`（"转变时报一次、持续期静默"）**已删除** ——
 *   分级呈现（首次全文 / 后续一行摘要，且后续**不静默**）统一交给 `emitWarnings` 的进程内记账。
 *   删除的原因：那个状态位把"持续陈旧"变成**永久静默**（§2d：把"少做了什么"藏起来 ——
 *   后来加入的读者永远不知道图是旧的）。
 */
function staleSourceWarning(): ToolWarning | null {
  // ★★ 2026-10-26（T-②）：**委派唯一实现**。本文件曾自比「src 树最大 mtime vs dist 树最大 mtime」，
  //   与 `stale_check#checkStaleBuild`（逐文件）构成两把尺 —— 实测修好一把另一把仍在喊。
  //   现在判据只住 `checkStaleBuild`（mtime 触发 + 内容哈希判定），本函数只管**缓存与文案**。
  if (!PACKAGE_ROOT) return null;
  try {
    const r = checkStaleBuild(PACKAGE_ROOT);
    if (!r.stale) return null;
    const head = r.entries
      .slice(0, 3)
      .map((e) => `${e.src}${e.missing ? '（缺产物）' : ''}`)
      .join(' · ');
    return {
      code: 'STALE_SOURCE',
      summary: `\`src/\` 比 \`dist/\` 新（${r.entries.length}/${r.scanned} 个文件）—— 当前工具跑的是旧编译产物`,
      detail: `按**内容哈希**判定（mtime 只做触发，basis=${r.basis}）：${head}${r.entries.length > 3 ? ' …' : ''}`,
      fix: '`npm run build` 后重启 agent-io MCP server 生效',
    };
  } catch {
    return null; // 自检失败不假阳性
  }
}


// ─────────────────────────────────────────────────────────────
// 通用索引陈旧告警（"不撒谎"不变量的**结构性兜底**）
//
// 为什么要有它：索引层的唯一不变量是「LLM 读到的内容要么与磁盘一致，要么**明确标注**可能旧」。
// 但"保鲜"此前靠**每个工具自己记得调** `ensureProjectIndex` —— 实测 60 个工具里有 **17 个**
// 直接开 cache.db 却没任何保鲜入口（`diff_impact`、`function_outline`、`overview`…），
// 其中 `diff_impact` 给的是**行动建议**，读旧图会直接导致改错。
//
// 与其逐个补（下次加工具还会漏），不如在**响应注入层**兜一次：跟 `staleSourceWarning` 同一套
// 做法（5s 探测缓存），一次覆盖全部工具。
// 它只 stat、不解析、不写库 —— 负责"标注"，不负责"修复"（修复让 LLM 去调 refresh:true）。
//
// ★ 诚实标注它的**边界**（别把它当成保证）：
//   ① 有 **5s 探测缓存**（与 `staleSourceWarning` 同一约定）⇒ 刚刚发生的改动最多 5s 内
//      可能还没被标注到；这是"标注"而非"闸门"，真正的保证在 L1a（写穿）与 L3（读前自证）。
//   ② 只比 `size` + `mtime`（毫秒取整）⇒ **等长改写落在同一毫秒**会漏判（见 detectStaleIndex 注释）。
//   ③ ★ P-F（§16.6）：不再"只在状态转变时报一次、持续期静默"（那会把"少做了什么"藏起来，§2d）
//      —— 改为**每轮都给**，但分级：首次全文 / 之后一行摘要。分级的状态位在
//      `registry/tool_warnings.ts` 的进程内记账里（键含本函数的 `scope` = 项目根）。
// ─────────────────────────────────────────────────────────────

const STALE_INDEX_TTL_MS = 5000;

let _staleIndexCache: { root: string; at: number; stale: number; total: number; sampled: boolean; selfWrites: number } | null = null;

/** 从工具入参里取项目根（各工具参数名不统一，四个都认）—— ★ 只是**第一级**，见 `resolveRootFromArgs` */
function projectRootArg(args: Record<string, unknown>): string | null {
  for (const k of ['project_dir', 'project_root', 'root', 'dir']) {
    const v = args[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * ★★★ T228（2026-10-13）：**在使用现场解析根** —— 把「读侧两道索引保障」（逐调用保鲜 +
 *   陈旧告警）从"调用方传了哪个参数名"里**解绑**。此前它们只认 `projectRootArg` 那 4 个名字；
 *   实测**20 个工具**（`go_originals` / `translate_go_ts` / `consistency_check` / `diff_views` …）
 *   的入参里没有这 4 个名字 ⇒ 那两道保障对它们**同时失效、且不说**（静默）。
 *
 * 两级合一（"两级在一处表达"，不散在 `invokeTool` 里）：
 *   ① **级 1**：约定的根参数名（`projectRootArg`，既有行为一字不改）。
 *   ② **级 2**：扫本次调用的**参数值**（含嵌套对象 / 数组里的字符串），挑出**真实存在**的路径，
 *      从它所在目录**向上**找最近的 `<dir>/.agent-io/cache.db`（`nearestCacheDb`——仓里已有的
 *      "向上找"原语，直接复用）⇒ 第一个命中的目录即项目根。
 *   ③ **级 3**（I1，2026-10-25）：入参带 `feature` ⇒ 读该 feature 设计 DSL 的 `source_root`
 *      （真实存在的目录才算）—— 只带 feature 的调用（edit_dsl / get_dsl）不再假报 NO_PROJECT_ROOT。
 *
 * ★★ **绝不用 `cwd` 兜底**：`cwd` 与被分析项目没有关系（不是"更弱的答案"，是**另一个项目的答案**，
 *   见 `storage.ts#requireProjectRoot` 的判据）。这里只在**调用方真给过的路径值**上解析；
 *   一个都解析不到 ⇒ 返回 `null` ⇒ 由调用点**响亮标注**（`NO_PROJECT_ROOT_NOTE`），不静默。
 */
export function resolveRootFromArgs(args: Record<string, unknown>): string | null {
  const named = projectRootArg(args);
  if (named) return named;
  for (const cand of collectArgPaths(args)) {
    let startDir: string;
    try {
      // 文件 ⇒ 取所在目录；目录 ⇒ 直接作起点（`code_dir: "<root>"` 这类别再上跳一级）。
      startDir = statSync(cand).isDirectory() ? cand : path.dirname(cand);
    } catch {
      continue; // 不存在 / 不可读 ⇒ 跳过（与 existsSync 等价：只有真存在的才算数）
    }
    // ★★★ T244（2026-10-14）：**marker 判据优先**（`resolveProjectRoot`：git 根 → 最近 manifest → 所在目录）。
    //   ★ 为什么不再用 `nearestCacheDb`（向上找**最近的 cache.db**）：那是**产物**的代理，嵌套下会认错根 ——
    //     实测夹具（内层有 `.git` 但**没有** `.agent-io/cache.db`、外层有）⇒ 给内层**文件**路径时
    //     `nearestCacheDb` 返回 **外层**（⚠ 于是"逐调用保鲜"去保鲜了**别的项目**），
    //     而 marker 判据正确返回内层。
    //   ★ 判据：问"**这次调用想操作哪个项目**"，该由**项目标记**回答；`cache.db` 是产物
    //     （可能不存在、也可能住在外层）⇒ 不能拿它当"项目在哪"的代理（代理会被"碰巧"骗过）。
    void startDir;
    return resolveProjectRoot(cand);
  }
  // ★★★ I1（2026-10-25）：**级 3 —— feature → 该 feature 设计 DSL 的 `source_root`**。
  //   ★ 病（实测）：`edit_dsl` / `get_dsl` 这类只带 `feature` 的调用，入参里**没有任何路径** ⇒
  //     级 1 / 级 2 全落空 ⇒ 恒报 `NO_PROJECT_ROOT`（"未做索引保鲜 / 未做陈旧检查"）。
  //     但 feature 的 DSL **自己就写着** `source_root`（import_project 保证写入）——
  //     明明能定位项目根，却按"解析不到"响亮告警 = **假警报**（噪音会把真警报淹没）。
  //   ★ 判据：`source_root` 是 DSL 里的**权威字段**（它是"这份设计说的是哪个项目"的答案），
  //     且必须是**真实存在的目录**（防幻觉路径）；取不到 / feature 不存在 ⇒ 照旧返回 null（真警报不灭）。
  return rootFromFeatureArg(args.feature);
}

/**
 * ★★★ I1（2026-10-25）：从 `feature` 参数解析项目根（级 3 的**唯一实现**，单测钉住）。
 *
 * @returns 项目根（`source_root` 解析成真实目录时）；否则 `null`（**不兜底 cwd** —— 与
 *          `resolveRootFromArgs` 同一条纪律：cwd 与被分析项目无关）。
 * ★ 导出是为了能被测试看见（注入型逻辑最容易静默失效）。
 */
export function rootFromFeatureArg(feature: unknown): string | null {
  if (typeof feature !== 'string' || !feature.trim()) return null;
  try {
    const dsl = getDSL(feature.trim());
    const sr = dsl?.source_root;
    if (typeof sr !== 'string' || !sr.trim()) return null;
    const root = path.resolve(sr.trim());
    if (!statSync(root).isDirectory()) return null;
    return root;
  } catch {
    return null; // 读不到 DSL / stat 失败 ⇒ 当"没有这级"（真警报照旧，不静默升级成假根）
  }
}

/**
 * 收集一次调用里**真实存在**的字符串候选（深度优先，保持入参书写顺序；跳过已见值）。
 * ★ 只收 `string`（路径只可能是字符串）；只收 `statSync` 得中的（"存在的文件路径"）。
 * ★ 递归进对象 / 数组 —— `files[...]` / `args:{…}` 这类嵌套也覆盖。
 * ★ 相对路径按 `path` 的默认语义（相对 `cwd`）解析 —— 那是**调用方给的路径**本身的语义，
 *   与工具 handler 对同一入参的解析一致；**不是**拿 `cwd` 当项目根。
 */
function collectArgPaths(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6) return; // 防病态深嵌套
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      try {
        statSync(s);
        out.push(s);
      } catch {
        /* 不是现存路径 ⇒ 略过 */
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1);
      return;
    }
    if (v && typeof v === 'object') {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x, depth + 1);
    }
  };
  walk(args, 0);
  return out;
}

/**
 * ★★ T228：解析不到项目根时的**如实标注**（不许静默）—— 覆盖两半：未做索引保鲜（`firstContactBackfill`）
 *   与 未做陈旧检查（`staleIndexWarning`）。
 *
 * ★ 只在"真解析不到根"时出现；解析到根且索引健康时**不许**出现（否则就是噪音）。
 * ★ 依据：本仓"缺失是沉默的"铁律（同族先例：`infrastructure/parse/source_exts.ts` 的
 *   「排除必须出声」——被排除的东西若连说出来都没有，就是沉默的缺失）。
 */
export const NO_PROJECT_ROOT_NOTE =
  '本次调用未解析到项目根 ⇒ 未做索引保鲜 / 未做陈旧检查（结果可能基于旧图）';

/**
 * 测试隔离用：清掉陈旧告警的**探测缓存**（5s TTL），让下一次调用重新 stat。
 * ★ 与 `resetWarningDelivery()`（清"已投递全文"的记账）**分开**：前者=模拟"过了 5s"，
 *   后者=模拟"新进程"。搅在一起就会让"首次全文/后续摘要"这条性质无法被观测。
 */
export function resetStaleIndexWarningCache(): void {
  _staleIndexCache = null;
}

/**
 * 索引是否落后于磁盘 → 结构化告警。
 * ★★ T228：**无根 ⇒ 不再静默** —— 返回 `NO_PROJECT_ROOT` 告警（见 `NO_PROJECT_ROOT_NOTE`）。
 *   （无索引 / 出错仍 `null`：那两种"没在查"与"查了没根"是不同的事，前者由首触保鲜标注兜。）
 *
 * `scope` = 项目根：换项目各自算"首次全文"（分级键 `STALE_INDEX@<root>`）。
 * 导出是为了**能被测试看见** —— 这类"注入型"逻辑最容易静默失效（永远返回 null 也没人发现）。
 */
export function staleIndexWarning(rawRoot: string | null): ToolWarning | null {
  if (!rawRoot) {
    // ★★ T228：**解析不到根 ⇒ 不许静默**。此前这里 `return null`，把"没做陈旧检查"
    //   藏了起来（正是本仓最反对的"沉默的缺失"）⇒ 改为**结构化标注**（一次，不重复）。
    return {
      code: 'NO_PROJECT_ROOT',
      scope: '(未解析到项目根)',
      summary: NO_PROJECT_ROOT_NOTE,
      detail:
        '本次入参里既没有约定的根参数名（`project_dir` / `project_root` / `root` / `dir`），' +
        '也没有能向上定位到 `.agent-io/cache.db` 的现存路径参数 ⇒ 无法确定"被分析项目"是哪一个，' +
        '于是**没有做**索引保鲜与陈旧检查。',
      fix: '显式传 `project_dir`（或任一能在其目录向上找到 `.agent-io/cache.db` 的现存路径参数）后重试。',
    };
  }
  let root: string;
  try {
    root = path.resolve(rawRoot);
  } catch {
    return null;
  }
  try {
    if (!hasLiveIndex(root)) return null;
    const now = Date.now();
    if (!_staleIndexCache || _staleIndexCache.root !== root || now - _staleIndexCache.at >= STALE_INDEX_TTL_MS) {
      const db = getProjectCacheDb(root);
      const p = detectStaleIndex(db, root);
      _staleIndexCache = { root, at: now, stale: p.stale, total: p.total, sampled: p.sampled, selfWrites: p.selfWritesPending };
    }
    const c = _staleIndexCache;
    if (c.stale <= 0 && c.selfWrites <= 0) return null;
    const scope = c.sampled ? `抽样 ${c.total} 个已索引文件中的一段` : `全部 ${c.total} 个已索引文件`;
    return {
      code: 'STALE_INDEX',
      scope: root,
      summary: `符号索引落后于磁盘（${scope}里有 ${c.stale} 个已被改动${c.selfWrites ? `，另有 ${c.selfWrites} 个自写登记待同步` : ''}）—— 本次结果可能基于旧图`,
      detail:
        '`find_references` / `impact_analysis` 之类可能少报、或指向已改名的符号。' +
        '（探测口径：只比 size + mtime，5s 缓存；这是"标注"而非"闸门"。）',
      fix: '先调 `index_integrity({project_dir, refresh:true})` 保鲜（或直接用任一读工具触发保鲜）',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// 首次接触 ⇒ 后台建索引（2026-09-15，用户拍板："白跑一轮索引对 LLM 是免费的"）
//
// 此前索引只能从"第一次读"开始建（explore_code 拼图 + 后台续建）——"工作区创建"
// 没有钩子，没接线。任何带 project_root 的工具调用都是对项目的**首次接触**：
// 在唯一入口顺手起后台续建（分小批、可中断、unref 定时器，**不阻塞本次调用**），
// 把建索引的起点从"第一次读"提前到"第一次任何调用"。对 LLM 免费：后台跑，
// 本次调用的耗时不受影响；需要索引的工具自身的冷启/拼图照旧优先。
//
// 纪律：
//   - `noAutoFresh` 的工具不触发（`index_integrity` refresh:false 必须纯只读，连库都不该建；
//     `import_project` 自己做全量导入）。
//   - 根必须是真实存在的目录（不给幻觉路径凭空造 `.agent-io`）。
//   - `AGENT_IO_AUTO_BACKFILL=0` 一键关（对齐 `AGENT_IO_AUTO_WATCH` 的 env 约定）。
//   - 起了之后**诚实标注**：索引在建 ⇒ 本轮结果可能不全 —— 这是"不撒谎"不变量的
//     "明确标注"那半边。`staleIndexWarning` 只覆盖"有索引但落后于磁盘"，
//     覆盖不了"索引还没建完"这种**空缺型不全**（查不到 ≠ 不存在），由本标注兜。
// ─────────────────────────────────────────────────────────────

/** 后台续建进行中 → 诚实标注"结果可能不全"（没在跑 → 空串） */
function backfillProgressNote(absRoot: string): string {
  const s = backfillState(absRoot);
  if (!s?.running) return '';
  const prog = s.total > 0 ? `${s.done}/${s.total}` : '刚启动';
  return (
    `\n[索引] 该项目还没有完整索引 —— 后台建索引进行中（${prog}）。` +
    '**本轮结果可能不全**（还没索引到的文件查不到 ≠ 不存在）；建完后自动精确，`index_integrity({project_dir})` 可查进度。'
  );
}

/**
 * 首次接触 ⇒ 起后台建索引；返回要注入响应的诚实标注（已有索引且没在建 → 空串）。
 * 导出是为了**能被测试看见** —— "顺手起后台"这类逻辑最容易静默失效（永远不起也没人发现）。
 */
/**
 * ★★★ T246（2026-10-13）：**"保鲜失败 / 没走完" ⇒ 结构化告警**（不再是一条被吞掉的 `catch`）。
 *
 * 为什么要有它：原来 `invokeTool` 里写的是 `catch { /* 保鲜失败不阻断主流程 *\/ }` ——
 *   ★ 那是本仓明令禁的**静默兜底**形状。而它咽下去的两类里，**第二类最阴**：
 *   ① 无可用索引却不许冷启（T238）；
 *   ② ★★ **走了一趟但超出补全上限**（`state:'partial'`）⇒ **"库在、但不全"被当成完整** ——
 *      正是 `write_gate.ts` 自己命名的"**比不建更糟**"（半成品索引被后续查询当成完整索引）。
 *   ⇒ 现在：**不阻断主流程**（那条判据不变），但**把原因交出去**（走既有 `emitWarnings` 通道）。
 *
 * `scope` = 项目根 ⇒ 换项目各自算"首次全文"；同一项目重复出现时只投一行摘要（防噪音）。
 */
export function freshnessRefusedWarning(msg: string, scope: string | null): ToolWarning | null {
  if (!msg) return null;
  const firstLine = msg.split('\n')[0].slice(0, 200);
  return {
    code: 'INDEX_FRESHNESS_REFUSED',
    scope: scope ?? undefined,
    summary: `★ 索引**本次没保鲜成功** ⇒ 本次结果可能基于**旧图**：${firstLine}`,
    detail:
      msg +
      '\n★ 为什么"没保鲜"要单独说：`staleIndexWarning` 只覆盖"**库落后于磁盘**"，' +
      '而这里覆盖的是"**根本没走成 / 没走完**"（前者是"查了、结果是旧的"，后者是"这次没查"）。',
    fix:
      '① 若原因是"超出补全上限"（`state=partial`）⇒ 跑 `import_project` 重建索引；' +
      '② `index_integrity({project_dir})` 可看覆盖度与进度；' +
      '③ 若原因是"没有可用索引"⇒ 先 `import_project`（本入口**绝不冷启**，见 `symbol_index.produce`）。',
  };
}

export function firstContactBackfill(rawRoot: string | null): string {
  // ★★ T228：**解析不到根 ⇒ 不许静默**（与 `staleIndexWarning` 同一句话，见 `NO_PROJECT_ROOT_NOTE`）。
  if (!rawRoot) return NO_PROJECT_ROOT_NOTE;
  if (process.env.AGENT_IO_AUTO_BACKFILL === '0') return '';
  try {
    const given = path.resolve(rawRoot);
    if (!existsSync(given)) return ''; // 幻觉路径不建库
    // ★ 2026-10-26 实测补：**传文件路径也要能上溯**（寄风的原话就是"解析某文件 ⇒ 自动建索引"）。
    //   原先这里是 `!statSync(given).isDirectory() ⇒ return ''` —— 文件在**上溯之前**就被挡掉了，
    //   于是 `firstContactBackfill('<某个 .ts 文件>')` 恒返回空串（验证时当场发现）。
    const givenDir = statSync(given).isDirectory() ? given : path.dirname(given);
    // ★★★ 2026-10-26（T-#7）：**索引根必须上溯到真项目根**。
    //   寄风的设想：「能不能自己分析，向上回溯定位真实项目根，达成解析某文件/子目录就自动建项目索引」——
    //   能，而且 `resolveProjectRoot` 就是干这个的（① 向上找 `.git` ② 最近 manifest ③ 兜底所在目录）。
    //
    //   病史：这里原先 `const abs = path.resolve(rawRoot)` —— **入参原样当根**。
    //   而 `openDb` 第一句就是 `mkdirSync` ⇒ 任何"只想分析这个子目录"的调用都会在子目录里
    //   长出一个完整 cache.db。实测 8 个（71.7MB），子代理用「库内 applied_at vs usage 的 ts-ms」
    //   毫秒级定位到 5 个出自 code_health、1 个出自 import_project。
    //
    //   ★ 判据复用**级 2 的那一把尺**（`resolveRootFromArgs` 里 T244 已论证：marker 优先，
    //     不用 `nearestCacheDb` —— 那是产物，会被"碰巧存在"骗过），不新造第二套。
    //   ★ 只影响**建索引**：工具自己的分析范围仍用调用方给的原值
    //     （要限定范围是另一个参数的事，见 docs/ROOTS.md §2 硬纪律 ①）。
    const abs = resolveProjectRoot(givenDir);
    const ascended =
      path.resolve(abs) !== givenDir
        ? `★ **索引根已上溯**：\`${given}\` → \`${abs}\`\n` +
          `  （按 git 根 / 最近 manifest 判定真项目根；索引建在真根，**不在子目录**里另起一个）\n`
        : '';
    if (!existsSync(abs) || !statSync(abs).isDirectory()) return ascended;
    if (hasLiveIndex(abs)) return ascended + backfillProgressNote(abs); // 已有索引：只承担"在建中标注"
    scheduleBackfill(abs, { batch: 20, intervalMs: 200 }); // 幂等单飞；首个批次在 +200ms 后台起
    return ascended + backfillProgressNote(abs);
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// 行动工具的可信度自动附注（§5-②，2026-09-15）
//
// 分工（别跟 staleIndexWarning 重复）：
//   - `staleIndexWarning`（全部工具）：索引**落后于磁盘**（not_fresh / 待消费自写登记）
//     —— 靠 stat 就能发现的那类旧。
//   - 本附注（只给"准备基于索引做改动/下结论"的工具）：**陈旧断言**（resolved 但目标符号
//     已不在索引）—— 索引**自己内部**不一致，文件内容没变 ⇒ 保鲜路径（L3①）看不见它，
//     唯一线索是这批行本身。它造成的是**静默漏报**：find_references / impact_analysis
//     "查到了但少了"，LLM 无从察觉 —— 对行动建议类工具是最危险的一种错。
//
// 为什么**不设缓存**：一次纯 SQL 计数（resolved 行 × nodes.name 反查），毫秒级；
// 且 rename_symbols 这类工具**自己会修**陈旧引用（写穿重开）—— 带缓存的附注会在
// 修完之后还报旧的数，那是附注自己在撒谎。宁可每次都查，也不要"过期的诚实"。
// ─────────────────────────────────────────────────────────────

/**
 * 行动工具的可信度附注：陈旧断言 > 0 ⇒ 提示"本结论可能静默漏报"并给可执行修复。
 * 健康时返回空串（不刷屏）。无索引也返回空串（那种"不全"由 firstContactBackfill 标注）。
 * 导出是为了**能被测试看见** —— 注入型逻辑最容易静默失效。
 */
export function trustNoteFor(rawRoot: string | null): string {
  if (!rawRoot) return '';
  try {
    const root = path.resolve(rawRoot);
    if (!hasLiveIndex(root)) return '';
    const db = getProjectCacheDb(root);
    const stale =
      (db
        .prepare(
          `SELECT COUNT(*) c FROM unresolved_refs u
           WHERE u.status = 'resolved'
             AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.name = u.reference_name)`,
        )
        .get() as { c: number } | undefined)?.c ?? 0;
    if (stale <= 0) return '';
    return (
      `\n⚠️ TRUST：符号索引内有 ${stale} 条**陈旧断言**（声称"已解析"、但目标符号已不在索引）——` +
      '本工具的结论可能**静默漏报**（查到了但少了，且无从察觉）。' +
      '先 `index_integrity({project_dir, refresh:true})` 修复（重开重解析：连得上重连、连不上明确标 failed）再采信本结果。'
    );
  } catch {
    return '';
  }
}


// ─────────────────────────────────────────────────────────────
// 基础设施：已抽到 src/registry/（P1a，2026-09-28）
//   抽出的原因：TOOL_DEFS 要按 lane 切文件，而 lane 文件必须用到 ToolDef / 三个包装器 /
//   20 个共享 handler —— 它们原先都定义在本文件内部 ⇒ lane 一 import 就成环
//   （server_registry → lanes → server_registry）。先抽成独立模块，依赖就变成单向。
// ─────────────────────────────────────────────────────────────

import type { ToolDef } from '../../application/types.js';
import { CALL_ACTOR_FIELD, looseInputSchema, textOut, wrap, wrapData } from '../../application/plumbing.js';
import { emitWarnings, type ToolWarning } from './tool_warnings.js';

// 对外仍从本模块导出（原 `export interface ToolDef` 的公开 API 位置不变）
export type { ToolDef };

// ─────────────────────────────────────────────────────────────
// ToolDef 定义：9 主工具 + 别名
// ─────────────────────────────────────────────────────────────


// ★ 2026-10-01（④-2）：工具表的**汇总**已下沉 `application/tool_registry.ts` ——
//   它本是 application 层的事实（6 个 `*_TOOLS` 数组都在那儿）；本文件只负责**注册到 MCP server**。
import { TOOL_DEFS } from '../../application/tool_registry.js';

// ─────────────────────────────────────────────────────────────
// 注册
// ─────────────────────────────────────────────────────────────

/** 注册全部主工具到 McpServer（旧工具名别名已于 2026-08-17 全部移除） */

/**
 * ★★★ 工具的**唯一调用入口**（2026-09-30 抽出）—— MCP 面与 CLI 面调**同一个函数**。
 *
 * 它把「每次调用前保鲜 / 首次接触建索引 / 参数纠错 / 狗食统计 / 响应注入」这五件**外围事**
 * 从注册闭包里搬出来，于是**任何**入口都自动获得它们。
 *
 * ★ 为什么必须抽（**实测的真缺陷**，不是风格问题）：那些**手写的** CLI
 *   （`health_cli` / `impact_cli` / `behavior_cli` / `cross_repo_cli` / `hybrid_cli` …）
 *   **全都没有**保鲜、陈旧告警、狗食统计（实测各 0 命中）⇒ 它们跑的是**旧索引 + 无任何标注**，
 *   给出不可信的结果**还不说**。
 *   ⇒ 「CLI 从唯一真相源投影」的价值不只是消重，是**让 CLI 自动获得这些能力**（结构保证，不是自觉）。
 *
 * ★ 为什么放本文件而不是新开 `registry/invoke.ts`：它需要的 7 个外围函数
 *   （`projectRootArg` / `firstContactBackfill` / `staleIndexWarning` / `trustNoteFor` …）**都定义在本文件里**
 *   ⇒ 另开模块会成环（本仓 §P1a 已为同样的理由抽过一层基础设施）。
 *   等 `server_registry.ts` 按 §44 搬进 `presentation/mcp/` 时，本函数一并搬去 `registry/invoke.ts`。
 */

/**
 * ★★★ 2026-10-10：「**调用失败**」与「**世界不好**」是两件事 —— 这里只判**调用失败**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须有它（实测的真缺陷，不是风格问题）
 * ─────────────────────────────────────────────────────────────
 *   `isError` / 退出码的语义本来就是「**这次调用有没有失败**」，**不是「世界好不好」**
 *   （世界好不好由工具**报表内容**表达 —— 那是另一码事，本函数**不碰**）。
 *
 *   实测（本仓 `scripts/mcp/mcp_scan.mjs` 的产物 `.inspect/mcp_scan.json`）：
 *   拿**同一个** `{}` 调 61 个工具，**只有 5 个**把"缺必填参数"**当成了正常报告**退 0：
 *     `go_originals` / `canvas_notes` / `gateway_provider` / `read_project_docs` / `refactor_judge`
 *   （例：`gateway_provider` 声明了必填 `action`，缺它时 handler 直接落进"stats"分支，
 *     回一句"用量汇总：0 次调用…" ⇒ 退出码 0 ⇒ **调用方永远不知道自己漏了参数**。）
 *   其余 48 个自带 `requireStr` 之类的守卫、**当场抛错** ⇒ 已被 `wrap`/`wrapData` 记成 `isError`。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么放**这里**（而不是逐个工具补守卫）
 * ─────────────────────────────────────────────────────────────
 *   `invokeTool` 是**唯一调用入口** —— MCP 面（`registerAllTools`）与 CLI 面（`cli.ts`）
 *   逐字同路径 ⇒ 一处生效、全体受益，且**以后新增工具不用记得**（结构保证，不是自觉）。
 *
 *   ★ 而且这与 **MCP 面已经是同一条口径**，不是新造判据：SDK 的 `registerTool` 会把同一个
 *     `looseInputSchema(def.inputSchema)` 拿去做 `safeParseAsync`，失败即回 `InvalidParams`
 *     （`@modelcontextprotocol/sdk/dist/esm/server/mcp.js:174-178`）⇒ MCP 面**从来**就拦缺参。
 *     只有 CLI 面（`cli.ts` 直接调 `invokeTool`，绕过 zod）与 `atomic_call`（直接调本函数）
 *     漏了这一格 ⇒ 本函数把这格补齐 ⇒ **两个面从此一致**。
 *
 *   ★ 校验用的**就是** `looseInputSchema(def.inputSchema)` —— 与 SDK 同一份构造器，
 *     所以"允许多余键（供参数纠错）/ 要求必填"的语义**逐字相同**，不引入第二套口径。
 *     只判 `success`，**不用** `parsed.data`（不替 handler 注入默认值 —— 那会改动工具行为）。
 *
 *   ★ 纪律：本函数**只**做"入参能不能开跑"的判定，**不改任何工具的业务判据**；
 *     "工具跑通了但报表说世界不好"（如 `run_tests` 退出码非 0、`structure_gap` 报不一致）
 *     **一律不在此处**，仍是 `isError:false` ⇒ 退 0。
 */
interface ArgValidator {
  safeParse(v: unknown): { success: boolean; error?: { issues: Array<{ path: Array<string | number> }> } };
}

/**
 * ★★★ 2026-10-20（A7 闭合 · 逐调用自报）：**跨工具的保留入参 `actor`**。
 *
 * ## 病（实测）
 * 写闸的判据（`write_gate#assertSourceWriteRegistered` 里 `owner !== actor ⇒ 拒`）早就写好了，
 * 但**没人传 actor**：`.vscode/mcp.json` 与 `~/.workbuddy/mcp.json` 都没设 `AGENT_IO_ACTOR`
 * ⇒ `resolveActor()` 恒 `null` ⇒ 闸永远走"提醒 + 放行" ⇒ **A7 在生产面一次都不会触发**。
 * 今天验证 A7 看到的拒绝，是靠 CLI 手动 `AGENT_IO_ACTOR=xxx` 才造出来的 ——
 * 即"**设计好了但不会用**"（判据在、代码在、**入口没接**）。
 *
 * ## 为什么放在**入口**（而不是逐个工具加字段）
 *   · `invokeTool` 是 MCP 面与 CLI 面的**唯一入口**（本文件上面那段注释已经写过这条理由）——
 *     放这里 ⇒ 以后新增写工具**不用记得**加字段；也**不会**出现"4 个工具各持一份 actor 定义"。
 *   · 入参 schema 是 `looseObject`（`plumbing#looseInputSchema`）⇒ 未知键本来就不会被丢；
 *     这里再声明一次是为了**两件事**：① `tools/list` 里看得见（可发现性）；② `actor: 123` 这类
 *     类型错能被拦住（不声明就只能静默透传）。
 *
 * ## 边界（别包装）
 * 它是**自报**：stdio 侧的 MCP server 拿不到宿主可信身份（宿主只给 HTTP connector 注
 * `X-WorkBuddy-MCP-Context`，stdio 只注入目录变量）⇒ 能买到的只是**协作防撞**，不是**防冒充**。
 */
/**
 * ★ 2026-10-24：`CALL_ACTOR_FIELD` 的**定义搬到 `application/plumbing.ts`**（唯一处）——
 *   refactor 线 5 个写源码工具（edit_code / rename_symbols / move_symbol /
 *   apply_refactor_plan / rename_files）的 inputSchema 要**显式展开**它，
 *   而 application 层不能 import presentation ⇒ 定义必须住在两层都够得着的地方。
 *   注入机制（下面 `withCallActor`）不变 —— 现在注入与显式声明是**同一个对象**，不是两份定义。
 */

/**
 * ★★★ T356（2026-10-20）：**跨工具的保留入参 `authorize`（按 run 授权）** —— 与 `actor` 同一处注入。
 *
 * ## 它是什么
 * 一次 run（= 一个子代理的一轮活）常常要改十几个文件，而它手上只有**一张**卡 —— 逐文件判就拒 12 次
 * （"改个字段要 12 张卡"），于是大家会去找绕过口。`authorize` 把"领活"与"圈范围"拆开：
 *   **卡证明「这块是我的」，scope 证明「这批文件都在这块里」**。
 * 值用 `domain/scope.ts` 的**现成文法**（`files:` / `nodes:` / `subtree:` / `layer:` / `swimlane:` / `arch_layer:`）。
 *
 * ## ★ 为什么放在**入口**而不是加进 DSL（写在这里，别再被别人推翻重来）
 *  ① feature 级太粗：一个 feature 是 200~516 个文件 ⇒ 授权整个 feature ≈ 关闸；
 *  ② 节点级**结构上不成立**：两册都没有 `parent`、`edges` 为空 ⇒ 节点无法「包含」一批文件
 *     （`node.path` 只有8 个，也只是次要理由）；
 *  ③ 做成 DSL 字段 = 新增**第三份路径事实**（`semantic.files` 515 + `node.description` 508 + 新 scope 清单）
 *     —— 本仓最贵的病就是「第二份判据」；
 *  ④ `scope` 这个词**已被占用**（`NodeDecision.scope`，T329）⇒ 用 `authorize`。
 *
 * ## 边界（重要）
 *  · 只有**写工具**认它（它们自己把它传给写闸）；只读工具忽略它。
 *  · 它**不放宽 A7**：scope 里必须有一张 **你领的** claimed 卡（判据只在 `write_gate#evaluateRunAuthorize`）。
 *  · `authorize:'all'` **明令拒绝**（等于关闸）；解不出来的 scope 也**当场报错**，不静默降级。
 */
const CALL_AUTHORIZE_FIELD = {
  authorize: z
    .string()
    .optional()
    .describe(
      '★ 本次 run 的**授权范围**（按 run 授权）：一个 scope 一次授权一批文件 —— 给 `domain/scope.ts` 的文法，' +
        '如 `files:src/application/refactor/`、`nodes:<id>,<id>`、`subtree:<模块节点>`、`layer:main`。' +
        '判据 = 本批要写的文件**全部**落在该 scope 内 ∧ 该 scope 的节点里有**你领的** claimed 卡（A7 不放宽）。' +
        '★ 只有写工具认它；`authorize:\'all\'` 会被**拒**（等于关闸）。不传 ⇒ 落回逐文件判定（老行为）。',
    ),
};
/** 保留键全集（参数纠错要把它们当"已知键"，否则 `actor`/`authorize` 会被当成拼错的参数）。 */
const CALL_RESERVED_KEYS = [...Object.keys(CALL_ACTOR_FIELD), ...Object.keys(CALL_AUTHORIZE_FIELD)];
/** 任何工具的 schema → 同一个（含 `actor` / `authorize` 的）schema。★ 一处拼装，别在调用点各写一遍。 */
const withCallActor = (shape: Record<string, unknown>): Record<string, unknown> => ({
  ...shape,
  ...CALL_ACTOR_FIELD,
  ...CALL_AUTHORIZE_FIELD,
});

/** 每个 `def` 只构造一次 validator（SDK 那边也是注册时构造一次，这里对齐）。 */
const _argValidators = new WeakMap<ToolDef, ArgValidator>();

function argValidatorOf(def: ToolDef): ArgValidator {
  const cached = _argValidators.get(def);
  if (cached) return cached;
  const v = looseInputSchema(withCallActor(def.inputSchema ?? {})) as unknown as ArgValidator;
  _argValidators.set(def, v);
  return v;
}

/**
 * 按 schema 校验入参 —— 通过返 `null`；不通过返**人话错误文本**（调用方据此 `isError` ⇒ 退非 0）。
 *
 * 分类（两类都属"调用失败"，都改不了"世界"）：
 *   · **缺必填**：`a[key] === undefined`（zod 对 string/array 报 `invalid_type`、对 enum 报 `invalid_value`，
 *     但按"值是不是 undefined"分比按 issue 的 code 分**更稳**，不押注 zod 的内部编码）。
 *   · **类型/取值不符**：值**给了**但不符合声明（如 `view:123`、`timeout_ms:"x"`）。
 */
function validateToolArgs(def: ToolDef, a: Record<string, unknown>): string | null {
  const parsed = argValidatorOf(def).safeParse(a);
  if (parsed.success) return null;
  const missing = new Set<string>();
  const bad = new Set<string>();
  for (const iss of parsed.error?.issues ?? []) {
    const key = iss.path.length ? String(iss.path[0]) : '(入参)';
    if (a[key] === undefined) missing.add(key);
    else bad.add(key);
  }
  const required = Object.entries(def.inputSchema ?? {})
    .filter(([, s]) => (s as unknown as { isOptional?: () => boolean }).isOptional?.() === false)
    .map(([k]) => k);
  const lines = [`✗ 调用失败：入参未通过 \`${def.name}\` 的 schema 校验（不是"世界不好"）。`];
  if (missing.size) lines.push(`  缺必填：${[...missing].join(', ')}`);
  if (bad.size) lines.push(`  类型/取值不符：${[...bad].join(', ')}`);
  if (required.length) lines.push(`  \`${def.name}\` 必填：${required.join(', ')}`);
  lines.push('  ⇒ 这是**调用方用错了**（缺参 / 类型错），修好入参再调；不要把它当成工具结果。');
  return lines.join('\n');
}

/**
 * 唯一调用咽喉：MCP 面 / CLI 面 / 证 / 扫射 / 门**全走这里**。
 *
 * ★★ 2026-10-21：第三个入参 `via` = **这次调用是从哪儿来的**，写进狗食账本（`DogfoodUsage.via`）。
 *   ★ 为什么由**调用方声明**、而不是在这儿嗅探：本函数看不出自己是被谁调的 ——
 *     `cli.ts` 与 MCP server 进程里都调它，而 `certs/*.mjs` / `mcp_scan.mjs` 直接 import 源码/产物。
 *     「谁发起」只有发起者自己知道；在这儿猜（比如看 `process.argv`）等于把身份写死在进程长相上。
 *   ★ 缺省 `'mcp'`：本函数最主要的入口是 MCP 面，别的入口**各自显式传**（cli / cert / sweep / gate）。
 *   ★ 不改调用方 ⇒ 行为逐字不变，只是账本里多一个 `via:'mcp'`（历史行仍无 `via`，不回填）。
 */
export async function invokeTool(
  def: ToolDef,
  args: Record<string, unknown> | undefined,
  via: DogfoodVia = 'mcp',
): Promise<{ text: string; isError?: boolean }> {
  // ★ 2026-10-21：**浅拷贝** —— 下面会把 `actor` 换成规范化后的值，不许改调用方手里那个对象
  //   （`atomic_call` / 证脚本会把同一份 args 复用；副作用留在本函数内）。
  const a = { ...(args ?? {}) } as Record<string, unknown>;

  // ★★★ 2026-10-10：**先**判"调用失败" —— 入参不过 schema 就到此为止（不再建索引 / 保鲜 / 注入告警）。
  //   为什么最前置：一次**用错了**的调用不该有任何副作用（不该起后台建索引、不该读旧索引算告警）。
  //   为什么仍记狗食：失败也要被记（"漏参数"的频率本身就是"该怎么收敛/该补哪个文档"的原料）。
  const argError = validateToolArgs(def, a);
  if (argError) {
    // ★ 2026-10-21：失败也记（漏参数的频率本身就是原料），并同样带上 `via` ——
    //   ★ 少了它，「谁在漏参数」这半张账会混进证/扫射的失败（扫射专门拿 `{}` 去撞 schema）。
    recordDogfoodUsage({ ts: new Date().toISOString(), tool: def.name, via, ok: false, ms: 0, err: argError.slice(0, 200) });
    return { text: argError, isError: true };
  }
  // ★★★ 2026-10-21（并发控制·账户）：**身份先过关** —— 位置在保鲜 / 首触建索引**之前**：
  //   一次用错身份的调用不该有任何副作用（与"入参不过 schema 就到此为止"同一条理由）。
  //   三种情况三种处置（实现只有 `domain/actor_spec#admitActor` 一处）：
  //     ① 合法（有前缀且合规）⇒ 通过；
  //     ② 老格式（无前缀，如 `workbuddy`）⇒ 非 STRICT **归一化**为 `agent:workbuddy` 且**回执明说**；
  //        STRICT ⇒ **拒**（报文给正确写法）；
  //     ③ 完全非法（空格 / 中文 / 超长 / 大写）⇒ **两种模式都拒**。
  //   ★ 只在**这一处**做：下游（write_gate / read_set / task.owner）只见规范化后的值。
  //   ★ 拿不到 actor（没传、env 也没有）⇒ 保持 `null`，**不造默认身份**
  //     （造了 = 所有人都是同一个人 ⇒ 读集把两个人合并，比没有更坏）。
  const actorAdm = admitActor(typeof a.actor === 'string' ? a.actor : undefined, process.env.AGENT_IO_ACTOR);
  if (!actorAdm.ok) {
    const msg = actorAdm.error ?? '✗ 拒绝调用：`actor` 不是合法身份。';
    recordDogfoodUsage({ ts: new Date().toISOString(), tool: def.name, via, ok: false, ms: 0, err: msg.slice(0, 200) });
    return { text: msg, isError: true };
  }
  // 显式入参 ⇒ 把归一化值**写回**往下传；env 来源 ⇒ 只在回执里留痕（不伪造"调用方传过"）。
  if (actorAdm.actor && actorAdm.source === 'explicit') a.actor = actorAdm.actor;
  const actorNote = normalizedActorNote(actorAdm);

  // ★ 首次接触 ⇒ 后台建索引（2026-09-15）：带 project_root 的调用若该项目还没有索引，
  //   顺手起后台续建（不阻塞本次调用）——把建索引的起点从"第一次读"提前到"第一次任何调用"。
  //   起了就诚实标注"本轮结果可能不全"（空缺型不全，staleIndexWarning 覆盖不了）。
  // ★★ T228：根的解析**改走 `resolveRootFromArgs`（两级：约定参数名 → 从现存路径值向上找
  //   `.agent-io/cache.db`）** —— 下面这 4 处（保鲜 / 告警 / 可信度附注 / 首触建索引）因此
  //   不再依赖"调用方传了那 4 个参数名"。解析不到 ⇒ `firstContactNote` 与 `staleIndexWarning`
  //   会**响亮标注**（NO_PROJECT_ROOT），不再静默（见该常量）。
  const rootArg = resolveRootFromArgs(a);
  const firstContactNote = def.noAutoFresh ? '' : firstContactBackfill(rootArg);
  // ★ L3① 结构性精确化（2026-09-15）：有索引的项目，**每次调用前先保鲜**。
  //   为什么放这里：保鲜此前靠"每个工具自己记得调 ensureProjectIndex"，实测 60 个工具里有
  //   17 个直接开 cache.db 却没接 ⇒ 只能靠 staleIndexWarning 做**标注**。标注满足了不变量的
  //   "要么标注"那半边，但结果本身仍是旧的。这里在**唯一入口**做一次，全部工具的结果自动精确，
  //   以后新增工具也不用记得（结构保证，不是自觉）。
  //   成本：ready 态实测 ~35ms/次（390 文件）；有变更时付的是本来也要付的重同步钱。
  //   纪律：bootstrap:false —— 绝不因为一次调用就冷启建索引；失败静默（结果里仍有陈旧告警兜底）。
  //   ★ 后台续建在建时跳过（isBackfillRunning）：后台循环本来就在持续同步，逐调用保鲜
  //     只会重复全盘走查 + 触发 MAX_ADDS_PER_REFRESH 噪音；"在建 ⇒ 可能不全"由 firstContactNote 标注。
  // ★ 2026-10-08：预热在**每次调用**都检查（只真起一次）—— 放这儿是为了与「逐调用保鲜」同一处，
  //   不另开生命周期钩子（本仓没有启动钩子，见上一段的注释教训）。
  // ★ 2026-10-08：**等它一次**（不是 fire-and-forget）—— 否则同步 AST 路径在本轮不可用（见函数注释）。
  await ensureKernelPrewarmed();
  // ★★★ T246（2026-10-13）：**保鲜失败/没走完 ⇒ 不许静默** ——
  //   原来这里是 `catch { /* 保鲜失败不阻断主流程 */ }` ⇒ ★ 那是本仓明令禁的"**静默兜底**"形状
  //   （"失败就抛、不许 catch{return []}"）。★ 现在：不阻断主流程，**但把原因交出去**
  //   ⇒ 由下面的 `INDEX_FRESHNESS_REFUSED` **结构化告警**投递（走既有通道，不新开机制）。
  //   ★ 两种来源都会走到这里：① 无可用索引却不许冷启（T238）；② **走了一趟但超出补全上限**
  //     ⇒ `state:'partial'`（T246）—— ★ 后者才是最阴的那一格："库在、但不全"被当成完整。
  let freshnessFailure = '';
  if (rootArg && !def.noAutoFresh) {
    try {
      if (hasLiveIndex(rootArg) && !isBackfillRunning(rootArg)) {
        // ★★★ T221（2026-10-13）：**改走统一机制**（原先直调 `ensureProjectIndex` ✗）——
        //   ★ 外部评测的 ④：*"工序表定义了统一机制，但没有其他模块调用它"* ✓ ⇒ **现在接了** ✓
        //   ★★ 外层那两条守卫**留着** ✓（`hasLiveIndex` ⇒ **绝不冷启** ✓ ·
        //     `isBackfillRunning` ⇒ 后台在建时跳过 ✓）；`ensureStage` 的 `bootstrap` 默认 `false` ✓
        //   ★ **收益**：`symbol_index` 的 `inputs: ['source_files']` ⇒ **主链自动获得【上游补链】** ✓
        //   ★★★ ★ **2026-10-13 更正（T238）**：上面那句"**行为不变**"当时是**假的** ——
        //     `symbol_index` 有 `locate` 却没写 `isFresh` ⇒ 恒判 fresh ⇒ **保鲜一次都没跑**。
        //     已修（`isFresh: () => false`）并出了出生证 `certs/t238-freshness-cert.mjs` ✓
        await ensureStage('symbol_index', { projectRoot: rootArg });
      }
    } catch (e) {
      // ★ 不阻断主流程（结果仍有 `staleIndexWarning` 兜底标注），★ 但**必须说出去**。
      freshnessFailure = e instanceof Error ? e.message : String(e);
    }
  }
  // ★ 参数纠错（Did you mean）：zod object 会**静默丢弃**未知键（错参数 = 结果莫名其妙），
  // 这里对"够像"的未知键给一条建议；只提示不阻断，不够像则静默（避免噪音）。
  // ★★ 2026-10-20：已知键里**永远算上保留键**（否则 `actor` 会被当成拼错的参数，
  //   回一句"你是不是想找 action" —— 而它其实是 A7 的正规入参）。
  const knownArgs = [...Object.keys(def.inputSchema ?? {}), ...CALL_RESERVED_KEYS];
  const argHints = renderArgHints(unknownArgHints(a, knownArgs), knownArgs);
  // 狗食正式统计：记录每次工具调用的成败与子动作（失败静默，不阻断主流程）
  const t0 = Date.now();
  // ★★★ 2026-10-22（A1）：**工具调用期间**才持有 DSL 写授权，`who` = 工具名（写进 `_sync.via` 留痕）。
  //   ★ 工具自己也是"系统派生"的一类：它们造的是扫描/派生结果，表达不成 op，但**必须说得出自己是谁**。
  //   ★ 派生之外的工具（读类）拿这份授权也没用 —— 它们不写；而写类工具的每次写都会在册子上留名。
  const r = await runDslWriteScope({ via: 'tool', who: def.name }, () => def.handler(a));
  // ★★★ 2026-10-21（并发控制·读集比对）：**read / facts 读完就记读集**（写前比对的另一半）。
  //   位置：handler **之后**（拿得到产物）、任何包装/告警注入**之前**（取的是原始 `---DATA---`）。
  //   ★ 只有成功才记（失败的回执没有"读到了什么"）；★ 非 explore_code 的工具本函数直接返回。
  //   ★ 失败**不静默**：加一行说明（但不改变成败 —— 记读集是增强，绝不是读的前提）。
  let readSetNote = '';
  // ★ 只对 read / facts 解 `---DATA---`（其它 action 的产物可能很大，不白解一次 JSON）。
  if (!r.isError && def.name === 'explore_code' && (a.action === 'read' || a.action === 'facts')) {
    try {
      const rec = recordReadFromInvocation({
        tool: def.name,
        action: typeof a.action === 'string' ? a.action : '',
        actor: resolveActor(typeof a.actor === 'string' ? a.actor : undefined),
        root: rootArg,
        data: parseDataBlock(r.text),
      });
      if (!rec.recorded && rec.note) readSetNote = `
★ 读集未记录：${rec.note}`;
    } catch (e) {
      readSetNote = `
★ 读集未记录：${(e as Error).message}`;
    }
  }
  recordDogfoodUsage({
    ts: new Date().toISOString(),
    tool: def.name,
    // ★★ 2026-10-21：**从哪儿来的**（mcp / cli / cert / sweep / gate）—— 见 `DogfoodUsage.via`。
    via,
    action: def.name === 'explore_code'
      ? (typeof a.action === 'string' ? a.action : undefined)
      : def.name === 'edit_code'
        ? (typeof a.op === 'string' ? a.op : undefined)
        : undefined,
    ok: !r.isError,
    ms: Date.now() - t0,
    // ★★ 2026-10-06：把「本次给了几条下一棒」也记下来 —— 收敛靠狗食，这就是那份原料
    //   （能答"什么时候使用频率高"）。★ 0 时记 undefined（= 没给），免得日志里全是 0 的噪音。
    nextHops: nextHopsOf(def.name).length || undefined,
    err: r.isError ? (r.text ?? '').slice(0, 200) : undefined,
  });
  // 响应注入（顺序即拼接顺序）：① 参数纠错（Did you mean）② 陈旧告警家族（BUILD/SOURCE/INDEX，
  //          **结构化** + 首次全文/后续一行摘要，见 registry/tool_warnings.ts）③ 索引在建标注（首触）
  //          ④ 行动工具的可信度附注（陈旧断言 → 静默漏报预警）：在 handler **之后**算 ——
  //          rename_symbols 等工具自己会修陈旧引用，附注必须反映"修完之后"的现状。
  //          ⑤ watch 产出的未读影响提醒借力本次响应自动送达；⑥ `---WARNINGS---` 机器块（最末）。
  //    ★ P-F（§16.6）：三个 stale 告警不再各自拼字符串，而是产出 `ToolWarning`，由 `emitWarnings`
  //      统一分级 + 生成机器块（**追加在文本最末**，好让 `split(marker)[1]` 直接 `JSON.parse`）。
  //      注入点在 handler 之后、`wrap`/`wrapData` **之外** ⇒ 不经过那两个包装器，
  //      所以本笔无需改动 plumbing.ts（`wrap` 丢 `data` 与这里的告警通道无关）。
  const trustNote = def.trustAnnotated ? trustNoteFor(rootArg) : '';
  const alertNote = await collectPendingAlertText(def.name);
  const emission = emitWarnings([
    staleBuildWarning(),
    staleSourceWarning(),
    staleIndexWarning(rootArg),
    // ★★★ T246：第 5 个 producer —— **保鲜失败 / 没走完**（原来是 `catch {}` 咽掉的，见该函数注释）。
    freshnessRefusedWarning(freshnessFailure, rootArg),
  ]);
  // ★ 只回**合成好的文本**（含注入的告警块），**不在这里包 MCP 形状** ——
  //   「怎么呈现」是各面自己的事：MCP 面用 `textOut(...)` 包成 `{content:[...]}`，
  //   CLI 面直接打到 stdout。★ 这样两个面共用的就是**同一份合成逻辑**（唯一真相源）。
  // ⑦ ★★ 2026-10-06：「下一棒」提示（**先不收敛，所有有可能的下一棒都给它**）。
  //    ★ 提示插在 DATA 标记之前，保持载荷首行不变；告警和信任附注可能追加在载荷之后。
  //    ★ T251：取机器载荷统一用 `parseDataBlock`，不再假定标记后的整段都是 JSON。
  //    ★ 只在**有已验证出边**的工具上注入（★ 具体哪些、共几个，一律见 `domain/chain_wiring.ts` 的
  //      `CHAIN_EDGES`，以它为准 —— 不在此硬编码数字：会漂的数字就是下一处漂移），
  //      其余工具文本**一个字符都不变**。
  //    ★★ 它**不进产物**：既不是契约（下游不会用它重算）、也不是剪贴板 —— 是**提示**。
  // ★★★ 2026-10-09（T54 收口）：**「下一棒」现在印具体值**。
  //   本通道手上**正好有**刚跑完那个工具的 `r.text`，而 `touched` 就在它的 `---DATA---` 里
  //   ⇒ 把它喂进**同一个**渲染（`renderHandoffPanel`，与 `capability_map` 的「接续」段共用一份实现）
  //   ⇒ 调用方**不必自己 stringify 一遍 `touched`**，直接照抄入参即可。
  //   ★ 取不到 `touched`（多数工具不产）⇒ **逐字退回**原来的表达式版 `renderNextHops`（行为不变）。
  //   ★ 为什么必须共用一份实现：两个面各写一份"把 touched 变成下一棒" ⇒ **判据分叉**（本仓头号病）。
  const nextNote = renderNextNote(def.name, r.text);
  const withNext =
    nextNote && r.text.includes(DATA_MARKER)
      ? r.text.replace(DATA_MARKER, () => nextNote + '\n' + DATA_MARKER)
      : r.text + nextNote;
  // ★★ T228：解析不到根时，保鲜（firstContactBackfill）与陈旧检查（staleIndexWarning）**各自**
  //   都说同一句 `NO_PROJECT_ROOT_NOTE`；但用户只需**一条**（不许变噪音）⇒ 结构化通道
  //   （`emission` 里那个 NO_PROJECT_ROOT 告警）已带出它时，文本通道不再重复。
  const firstContactText =
    firstContactNote === NO_PROJECT_ROOT_NOTE && emission.text.includes(NO_PROJECT_ROOT_NOTE)
      ? ''
      : firstContactNote;
  // ★ 2026-10-21：读集记录失败的那一行挂在最末（**在 `---WARNINGS---` 之前**：机器块必须留在最后）。
  // ★ 2026-10-21：`actorNote`（归一化留痕）跟在参数纠错之后、告警之前 —— 它是**关于这次调用**的说明，
  //   不是"世界不好"；机器块（`emission.block`）仍然留在最末。
  return { text: withNext + argHints + actorNote + emission.text + firstContactText + trustNote + alertNote + readSetNote + emission.block, isError: r.isError };
}

/**
 * 「下一棒」的合成 —— ★ 有 `touched` 就印**具体值**（共用 `renderHandoffPanel`），否则退回**表达式**版。
 *
 * ★ 从 `r.text` 里取 `touched` 是**只能这么干**（本通道按设计只回**合成好的文本**，见上面那段注释）；
 *   取法**唯一**：`parseDataBlock`（`application/plumbing.ts`，`DATA_MARKER` 单点 + 单行载荷口径
 *   都住它那一处）—— ★ 本函数不再自写 `indexOf`/`slice`/`split` 切法。
 * ★★ **解析失败一律退回**：`parseDataBlock` 找不到标记 / 第一行不是 JSON 时**返回 `null`**（它不抛）；
 *   这里再包一层 try 是为了兜住**渲染**（`renderHandoffPanel`）的异常 —— 提示是"锦上添花"，
 *   **绝不许**因为它让主回执崩掉。
 */
function renderNextNote(tool: string, text: string): string {
  if (nextHopsOf(tool).length === 0) return '';
  try {
    const data = parseDataBlock(text);
    const t =
      data && typeof data === 'object'
        ? (data as { touched?: Record<string, unknown> }).touched
        : undefined;
    if (t && typeof t === 'object' && Object.keys(t).length > 0) {
      const note = renderHandoffPanel(
        tool,
        t,
        (name): readonly InputPath[] => {
          const d = TOOL_DEFS.find((x) => x.name === name);
          return d ? collectInputPaths(d.inputSchema) : [];
        },
      );
      if (note) return '\n' + note;
    }
  } catch {
    // ★ 静默退回**是这里唯一允许的"静默"**：提示不属于契约，不能因为它连累主回执。
  }
  return renderNextHops(tool);
}

/**
 * ★★★ MCP 的「面」（2026-10-06）
 *
 * 规则：**原工具面不用都暴露在 MCP 里，只留一个单独的入口、集中在一起就够**。
 *
 * ★ 为什么这条比"裁 `listTools`"对：实测本仓用的 SDK（`server/mcp.js`）——
 *   `ListTools` handler（`:67-68`）与 `CallTool` handler（`:100-102`）读**同一张** `_registeredTools`
 *   ⇒ **"只不列、仍可调"做不到**；而"**不注册**"恰好是 SDK 支持的形态（`:626` 还有 `delete`）。
 *
 * ★★ 默认 `all` = **与改造前逐字等价**（61 个全注册、**不注册**入口）⇒ 不打断现有下游
 *   （`dsh-brain` / `dsl-workbench` / `elv` / `ai-config/skills/design-canvas-mind`）。
 *   要收敛就设 `AGENT_IO_MCP_FACE=composed`：只注册**编排面** + **一个原子入口**。
 *   ★ I1（2026-10-25）：再收一档 `AGENT_IO_MCP_FACE=minimal` —— 只注册**高频 6 工具** + 原子入口
 *     （名单唯一住处 = `tool_faces.ts#MINIMAL_FACE_TOOLS`；all/composed 原样保留，兼容不打断）。
 */
export const ATOMIC_ENTRY_NAME = 'atomic_call';

// ★ 2026-10-11（T173）：`mcpFace()` 的**本地定义已删除** —— 定义在 `tool_faces.ts`（见上方 import），
//   因为「**说面**」的那一侧（`capability_map` 的回执）也要用它 ⇒ 同一处定义、两边共用。

/** 编排面 = `facesOf` 算出的 `composed`（`direct` ∪ 派生链）—— ★ 零手写。 */
function composedDefs(): ToolDef[] {
  const faces = facesOf(catalogOf(TOOL_DEFS), LANE_META.flatMap((m) => m.direct));
  const names = new Set(faces.find((f) => f.id === 'composed')?.names ?? []);
  return TOOL_DEFS.filter((d) => names.has(d.name));
}

/**
 * ★★★ I1（2026-10-25）：**极简面** = 高频 6 工具（`MINIMAL_FACE_TOOLS`）+ 原子入口。
 *
 * ★ 名单是**手写判据**（依据 = 用量，住 `tool_faces.ts` 唯一一处）；注册时**按注册表过滤**，
 *   名单里漂掉的名字由 `facesOf` 的 `unknown` 信号点名（不静默）。
 * ★ task 系（publish/claim/start/complete）与 pending **不是独立工具**：
 *   分别经 `edit_dsl` 的 op（type=task）与 `get_dsl` 的 query 承载 —— 已在前 2 个工具里，能力不缺。
 * ★ **仍注册 `atomic_call`**：minimal 的目的 = 收敛 MCP 面（listTools 载荷），不是**阉割能力** ——
 *   其余工具经入口照旧可达（与 composed 同款）。
 */
function minimalDefs(): ToolDef[] {
  const names = new Set(MINIMAL_FACE_TOOLS);
  return TOOL_DEFS.filter((d) => names.has(d.name));
}

/**
 * 原子面入口：**一个**工具，能 `list` / `describe` / `call` 全部原子工具。
 *
 * ★★★ 它**不是 `[B]`**，**故意不走那 7 处登记面**（见技能 `dc-add-tool` §一）——
 *   因为它**必须**调 `invokeTool`（唯一咽喉点：保鲜 / 告警 / 狗食统计都挂在那儿），
 *   而 `invokeTool` 住 `presentation/`；若把它做成 `application` 层的 `[B]`，
 *   `application` 就得 import `presentation` ⇒ **分层违规**。
 *   ⇒ ★ **它是传输层的收敛口，不是领域能力。**
 * ★ 因此它**不在 `TOOL_DEFS` 里** ⇒ `mcp_scan` 那道门量不到它（那道门的对象是 `[B]` 的契约）；
 *   也**不能**经 CLI 投影调用（CLI 从 `TOOL_DEFS` 找 def）—— ★ 这是**有意**的：
 *   CLI 本来就是"全量可脚本化"的那个面，不需要入口。
 */
function registerAtomicEntry(server: McpServer, exposedNames: ReadonlySet<string>): void {
  server.registerTool(
    ATOMIC_ENTRY_NAME,
    {
      title: 'Atomic face entry (list / describe / call)',
      description:
        '原子面入口 —— 本会话的 MCP 面是「编排面」，**其余原子工具只能经这里走**。' +
        'action=list 列全部原子工具名（带 * 的是已直接暴露的）；describe 取某个的入参名清单；' +
        'call 调它（args 原样透传，入参校验由被调工具自己做）。拿不准就先 list、再 describe、最后 call。',
      inputSchema: {
        action: z.enum(['list', 'describe', 'call']).optional(),
        tool: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async (raw) => {
      const a = (raw ?? {}) as { action?: 'list' | 'describe' | 'call'; tool?: string; args?: Record<string, unknown> };
      const action = a.action ?? 'list';
      if (action === 'list') {
        const lines = TOOL_DEFS.map((d) => `${exposedNames.has(d.name) ? '*' : ' '} ${d.name}`);
        return textOut(
          `原子工具共 ${TOOL_DEFS.length} 个（带 * 的**也**已在 MCP 面直接可用；其余经 ` +
            `${ATOMIC_ENTRY_NAME} action=call 调）：\n${lines.join('\n')}`,
        );
      }
      const name = a.tool;
      if (!name) return textOut(`action=${action} 需要 tool（先用 action=list）`, true);
      if (name === ATOMIC_ENTRY_NAME) return textOut('拒绝：不能经入口调入口自己（防自递归）', true);
      const def = TOOL_DEFS.find((d) => d.name === name);
      if (!def) return textOut(`没有这个工具："${name}"。先 action=list 看名字。`, true);
      if (action === 'describe') {
        const keys = catalogOf([def])[0]?.inputKeys ?? [];
        return textOut(
          `${def.name} — ${def.title}\n${def.description}\n` +
            `入参名（**深层**收集，含数组元素里的键）：${keys.join(', ') || '（无）'}\n` +
            `★ 类型 / 必填以描述为准；缺参会被人话错误挡回（不会静默）。`,
        );
      }
      const r = await invokeTool(def, a.args ?? {});
      return textOut(`[${def.name}] ${r.text}`, r.isError);
    },
  );
}

export function registerAllTools(server: McpServer): void {
  const face = mcpFace();
  const exposed = face === 'composed' ? composedDefs() : face === 'minimal' ? minimalDefs() : TOOL_DEFS;
  for (const def of exposed) {
    server.registerTool(
      def.name,
      { title: def.title, description: def.description, inputSchema: looseInputSchema(withCallActor(def.inputSchema ?? {})) as unknown as z.ZodRawShape },
      async (args) => {
        const r = await invokeTool(def, args as Record<string, unknown>);
        return textOut(r.text, r.isError);
      },
    );
  }
  // ★ 收敛面（composed / minimal）：额外注册**一个**原子入口（= 原工具面的唯一通道）。
  if (face !== 'all') registerAtomicEntry(server, new Set(exposed.map((d) => d.name)));
}


