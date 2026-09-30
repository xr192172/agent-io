/**
 * refactor 线（20 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const REFACTOR_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'refactor'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 * ★ 2026-09-29（本笔）：本线 21 → 20 —— 「文件内局部变量批量改名」并入 `rename_symbols`
 *   （两品是同一操作对象「标识符改名」的两个**作用域粒度**，按 `docs/tool-convergence.md` §2.0 的
 *   「按操作对象聚合」口径合一；合一方式是 [B] 内部按「作用域 × 语言」路由 + 共享一份落盘内核，
 *   **不是**外面再包一个 action 分发壳）。对外工具数 69 → 68。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 *
 * ★ 2026-09-29（回执通道清扫本笔）：本线 **8 个 `wrap` → `wrapData`** ——
 *   `rename_files` / `move_symbol` / `find_references` / `impact_analysis` /
 *   `remove_dead_imports` / `annotate_functions` / `refactor_pipeline` / `refactor_judge`。
 *   判据（逐处人读 [B] 的返回类型，不是按名字猜）：它们的 [C] 都已经在回 `data: r`
 *   （或已构造 data 对象），而 `src/registry/plumbing.ts` 的 `wrap()` 只取 `r.message` ⇒
 *   **结构化产物（逐项 preview/applied、引用点/行号、影响面文件表、失效清单、逐阶段 outcome、
 *   裁决台账 …）在传输层蒸发**，agent 只能正则解析散文。8 处的理由是同一条，故不逐处重写注释。
 *   ★ 两处**刻意例外**（不在本线，见 handlers.ts 的逐处说明）：`edit_dsl`（[B] 的 EditResult 只有
 *   `{message, feature}`，压根没有 data）、`render_design` / `observe_judge`（data 与 message 逐字重复）。
 */
import { z } from 'zod';
import { requireStr, wrapData } from '../plumbing.js';
import path from 'node:path';
import { analyzeHubs, analyzeImpact } from '../../infrastructure/analysis/impact/index.js';
import type { ImpactChangePoint } from '../../infrastructure/analysis/impact/index.js';
import { suggestRenamesInFile } from '../../tools/ast_suggest.js';
import type { SuggestOptions } from '../../tools/ast_suggest.js';
import { applyWrites } from '../../tools/apply_writes.js';
import { editCode } from '../../tools/edit_code.js';
import { listFileSnapshots, rollbackFileSnapshot } from '../../tools/file_snapshot.js';
import { findReferences } from '../../tools/find_references.js';
import { planFunctionAnnotation } from '../../tools/function_annotation.js';
import { renderGranularityNote } from '../../tools/parse_capability.js';
import { runRefactorJudge } from '../../tools/refactor_judge.js';
import type { JudgeDecision, JudgeIssue } from '../../tools/refactor_judge.js';
import { runRefactorPipeline } from '../../tools/refactor_pipeline.js';
import { removeDeadImports, removeDeadImportsWithVerify } from '../../tools/remove_dead_imports.js';
import type { RemoveDeadImportsVerifyOptions } from '../../tools/remove_dead_imports.js';
import { renameFiles } from '../../tools/rename_files.js';
import { renameSymbols } from '../../tools/rename_symbols.js';
import { applyRulesToFiles, collectRuleTargets, loadBaseline, ratchetDelta, runFixtures, writeBaseline } from '../../tools/rule_apply.js';
import { extractRule } from '../../tools/rule_extract.js';
import { isLegalRuleId, loadRules, rulesDir, writeRule } from '../../tools/rule_library.js';
import type { Rule } from '../../tools/rule_library.js';
import { disambiguationItems, suggestDisambiguationsInFile } from '../../tools/similar_names.js';
import { moveSymbol } from '../../tools/symbol_move.js';
import { buildRefactorPlan, applyRefactorPlan } from '../../tools/refactor_plan.js';
import type { RefactorTarget, RefactorPlan } from '../../tools/refactor_plan.js';
import { diffViewsHandler } from '../handlers.js';
import type { ScanBounds } from '../../tools/scan_bounds.js';
import type { ToolDef } from '../types.js';

// ★ 2026-09-29（面收敛第二批）：本文件原先自带一个**私有** `requireStr` 守卫，本笔把它上提到
//   `registry/plumbing.ts`（跨 lane 共用）—— 因为 `lanes/harvest.ts` 的新入口 `bricks` 也要用它，
//   留在原地等于长出第二份副本（G4 要消灭的形态）。函数体与错误文案**逐字未改**。

/** `plan_refactor` 产出的清单形状（`apply_refactor_plan` 的入参 schema —— 逐字接受上一环的 data） */
const refactorPlanSchema = z.object({
  schema: z.literal('refactor_plan/1'),
  plan_id: z.string().describe('清单指纹（由 old/new/base_fingerprint 派生）；apply 会重算比对，不符即报错'),
  items: z.array(
    z.object({
      file: z.string().describe('相对 project_dir 的路径（正斜杠）'),
      old: z.string(),
      new: z.string(),
      hit: z.object({
        level: z.number(),
        label: z.string(),
        start_line: z.number(),
        old_lines: z.number(),
        new_lines: z.number(),
      }),
      preview: z.string().describe('diff 预览（展示用；不参与 plan_id）'),
    }),
  ),
  files: z.array(
    z.object({
      file: z.string(),
      base_fingerprint: z.string().describe('规划时刻内容指纹'),
      post_fingerprint: z.string().describe('把本文件清单项全应用后的内容指纹（幂等快路径用）'),
    }),
  ),
  summary: z.object({
    items: z.number(),
    files: z.number(),
    by_level: z.record(z.string(), z.number()),
  }),
});

export const REFACTOR_TOOLS: ToolDef[] = [
  {
    name: 'diff_views',
    title: 'Compare design view vs live code snapshot',
    description:
      '双视图对比：加载同一 feature 的 design（设计视图）和 live（实际代码快照）两个 DSL，' +
      '逐层比对文件级/符号级/API 级/依赖级变更。' +
      '输出结构化数据供 LLM 分析 + 可读摘要。' +
      '适用于：重构后验证设计一致性、代码生成后检查偏差、追踪代码演进。',
    inputSchema: {
      feature: z.string().describe('feature 名'),
      live_dir: z.string().optional().describe('live 视图的 baseDir（可选，默认 dataHome），与 import_project 的 live_dir 一致'),
    },
    handler: diffViewsHandler,
  },

  {
    name: 'edit_code',
    title: 'Symbol-level code editing (AST-located)',
    description:
      '符号级语义编辑：按 文件+符号名 定位函数/方法/类/接口，AST 确定边界后整体替换/插入/删除。' +
      '这是 Agent 第一性编辑路径——不依赖行号与 old_string 文本匹配，杜绝改错行/改错函数。' +
      '安全设计：编辑后 re-parse 整个文件，解析失败自动放弃（不写盘）；' +
      'replace 要求新代码解析出同名符号（防粘贴错函数）；同名多候选时报错列出签名行号，传 parent 消歧。' +
      '写盘后自动重建该文件索引（新鲜度闭环）。' +
      'op: replace（symbol 必填 + code 完整新定义）| insert（code 新符号，symbol 可选=锚点其后插入，缺省文件末尾；新文件也走 insert）| delete（symbol 必填）| range（显式行区间：start/end 必填 + code，不依赖符号）| replace_text（old_text 唯一文本替换：**不需要符号索引、不需要行号**，4 级模糊级联定位——L1 逐字 → L2 空白归一（宽容 CRLF/行尾空格/行内空格差异）→ L3 缩进弹性（宽容整块缩进层级差异，new_text 自动按命中缩进重排）→ L4 省略号占位（old_text 里的 ... 或 … 行=省略任意行，适合只默写头尾）；每级都要求全文件恰好 1 处命中，歧义即报错并列行号、绝不猜；回执明示命中级别（exact/空白归一/缩进弹性/省略号占位），模糊命中时 diff 展示**实际被替换的文件片段**而非 old_text；适合凭记忆默写代码的小改）。' +
      'range：1-based 含端点的 start/end 行号 + code=区间新内容（传空串=删除区间）；dry_run=true 只出 diff 预览 + 语法门结果不写盘；' +
      '同 replace 的语法门兜底（编辑后 re-parse，新引入语法错误 → 拒绝不写盘），并列出区间穿透的符号供复核。' +
      '定位优先 qualified_name（如 Class.method），短名兜底；Go 方法用短名 + parent（receiver 类型）消歧。' +
      '★ 批量（P-B，规划书 §16.2）：传 targets=[{file, old_text, new_text}, ...] 一次调用对**多个文件**做唯一文本替换，' +
      '省去"每文件一次 dry-run + 一次 apply"（N 文件 = 2N 次调用）。逐项**独立回报**（每项 ok/hit/error 各自独立，一项失败不影响其余）；' +
      'atomic=true ⇒ 任一项失败则**整批不落盘**（全成或全不成，缺省 false=逐项独立）；dry_run=true 一次性给出**全部**预览、不写盘。' +
      '批量落盘走写闸（写前快照 + 索引写穿保鲜），每文件只写一次。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（索引归属；编辑后重建该文件索引）'),
      file: z.string().describe('目标文件（相对 project_dir 或绝对路径）'),
      op: z.enum(['replace', 'insert', 'delete', 'range', 'replace_text']).describe('replace=替换符号；insert=插入新符号；delete=删除符号；range=显式行区间替换；replace_text=唯一文本替换（不依赖符号索引/行号；4 级模糊级联：逐字→空白归一→缩进弹性→省略号占位，回执明示级别）。注：传 targets 时忽略 file/op 等单文件参数'),
      symbol: z
        .string()
        .optional()
        .describe('目标符号：replace/delete 必填（qualified_name 优先，短名兜底）；insert 可选（锚点符号，其后插入；缺省=文件末尾）；range 不需要'),
      parent: z.string().optional().describe('符号父级（类名 / Go receiver 类型名），同名消歧'),
      code: z.string().optional().describe('replace/insert 的新代码（完整符号定义，含声明；insert 到新文件=全文）；range=区间新内容，传空串=删除区间'),
      start: z.number().int().min(1).optional().describe('range 专用：1-based 含端点起始行号'),
      end: z.number().int().min(1).optional().describe('range 专用：1-based 含端点结束行号'),
      old_text: z
        .string()
        .optional()
        .describe('replace_text 专用：要替换的旧文本（4 级模糊级联：逐字 → 空白归一 → 缩进弹性 → 省略号占位，逐级降级；每级须全文件恰好 1 处命中，否则报歧义并列命中行号；回执明示实际命中级别）'),
      new_text: z.string().optional().describe('replace_text 专用：替换后的新文本（传空串=删除该文本；L3/L4 模糊命中时自动按实际命中首行缩进重排）'),
      dry_run: z.boolean().optional().describe('range / replace_text 专用：true=只出 diff 预览 + 语法门结果，不写盘'),
      targets: z
        .array(
          z.object({
            file: z.string().describe('目标文件（相对 project_dir 或绝对路径）'),
            old_text: z.string().describe('要替换的唯一旧文本（同 replace_text 的 4 级模糊级联）'),
            new_text: z.string().describe('替换后的新文本（传空串=删除该文本）'),
          }),
        )
        .optional()
        .describe('★ 批量（P-B）：一次调用对多文件做唯一文本替换。每项等价于一次 op=replace_text；逐项独立回报；给了非空 targets ⇒ 忽略 file/op/symbol/code/old_text/new_text'),
      atomic: z.boolean().optional().describe('★ 批量专用原子性：true=任一项失败则整批不落盘（全成或全不成）；缺省 false=逐项独立（一项失败不影响其余）。dry_run 天然不落盘'),
    },
    handler: wrapData(async (a) => editCode(a as never)),
  },

  {
    name: 'rename_symbols',
    trustAnnotated: true, // 改名决策读的是引用清单 ⇒ 陈旧断言会漏报改名点（见 trustNoteFor）
    title: 'Rename identifiers — module-level symbols (cross-file) or file-local bindings (scope-isolated)',
    description:
      '标识符改名**统一入口**：一个工具、两种作用域粒度，用 scope 选；**入参两种 scope 同形**：renames=[{file,symbol,to,decl_line?,rename_file_if_matching?}]（单条或批量）。' +
      '· scope=module（缺省，即老行为）：改**模块级符号**（函数/const/class/interface/type/enum，或 import 进来的远程名），跨文件联动定义点 + import 子句 + 全部引用点（含 tsconfig 别名、re-export）；**全批原子** —— 任一条被阻断（撞名/星号转发/非模块级符号/根外文件）⇒ 整体不落盘，返回预览报告。' +
      '· scope=local：改**文件内局部绑定**（函数/块内 const·let·var、形参、catch 参数），作用域隔离（同作用域不撞名；不同函数/块的同名绑定互不误伤）；**逐项独立** —— 某一项找不到绑定/名字歧义/撞名/非法名 ⇒ 只跳它，其余照改，跳过项逐条可见。' +
      '两种 scope 共有：先算结构化预览（每处 old→new 可验证）、true=dry_run 只看不写、**一次解析多编辑逆序合并**（避免串行改名导致的偏移错位）、一批一份写前快照（撤回通道）、落盘后索引写穿（改完立刻读不会读到旧索引）。' +
      'scope=local 按 **symbol（名字）+ 可选 decl_line（声明行，1-based）** 寻址：名字在文件内唯一就直接命中；同名多于一个（不同函数/块级遮蔽）而没给 decl_line ⇒ 该条被拒并列出候选行号（**不猜**，改错变量是这类工具最不能出的错）。' +
      'report_literals=true（仅 scope=module）：额外扫描每个旧符号 snake 变体在项目文本里的字面量引用（如工具名 render_dsl 出现在错误提示/README 里的串），按 kind 分治（契约/历史/文档/测试/代码），仅报告不改动。' +
      '★ 与 rename_files 是**两个对象**（那个改文件系统路径 + 全仓 import 源），不聚合；suggest_renames / find_similar_names 是它的上游只读分析层。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（可选；缺省按条目自动定位；统一定位时传）'),
      scope: z
        .enum(['module', 'local'])
        .optional()
        .describe('作用域粒度：module（缺省）=模块级符号、跨文件联动、全批原子；local=文件内局部绑定、作用域隔离、逐项独立。两种 scope 的条目形态相同（renames=[{file,symbol,to,…}]）'),
      renames: z
        .array(
          z.object({
            file: z.string().describe('目标文件（绝对路径；或相对 cwd/project_dir 路径）。module=符号定义所在文件；local=绑定所在文件（可跨多文件）'),
            symbol: z.string().describe('要改名的标识符当前名。module=模块级声明名/被 import 的远程名；local=局部绑定名（含形参/catch 参数）'),
            to: z.string().describe('新符号名（合法标识符 /^[A-Za-z_$][\\w$]*$/）'),
            decl_line: z
              .number()
              .int()
              .min(1)
              .optional()
              .describe('★ 仅 scope=local：声明所在行号（1-based）——同名绑定多于一个时消歧（缺省且唯一则不必给；缺省且不唯一 ⇒ 该条被拒并列出候选）'),
            rename_file_if_matching: z.boolean().optional().describe('★ 仅 scope=module：true=符号是文件主导出时联动改文件名（默认 false）。scope=local 传 true 会拒该项（响亮报错，不静默忽略）'),
          }),
        )
        .describe('待改名的条目（两种 scope 同形）'),
      dry_run: z.boolean().optional().describe('true=只算全部预览 diff 不落盘（默认：module 先整体校验全通过才落盘；local 逐项改）'),
      report_literals: z.boolean().optional().describe('★ 仅 scope=module：true=扫描旧符号 snake 变体的字面量引用清单（错误提示/README 等纯字符串），仅报告不改动'),
    },
    handler: wrapData(async (a) => {
      const r = await renameSymbols({
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        scope: a.scope === 'local' ? 'local' : 'module',
        renames: (a.renames as Array<{ file: string; symbol: string; to: string; decl_line?: number; rename_file_if_matching?: boolean }>).map((x) => ({
          file: String(x.file),
          symbol: String(x.symbol),
          to: String(x.to),
          decl_line: typeof (x as { decl_line?: number }).decl_line === 'number' ? (x as { decl_line: number }).decl_line : undefined,
          rename_file_if_matching: (x as { rename_file_if_matching?: boolean }).rename_file_if_matching === true,
        })),
        dry_run: a.dry_run === true,
        report_literals: a.report_literals === true,
      });
      /**
       * ★ 去重后的「跳过的文件」清单 —— **一处实现、两处消费**（① 显著警告文本 ② `bounds.skipped`）。
       * 数据来源：每条 preview/applied 的 `result.skipped`（`rename_symbol` 只在非空时返回）。
       */
      const skippedEntries = (): Array<{ path: string; why: string }> => {
        const seen = new Set<string>();
        const entries: Array<{ path: string; why: string }> = [];
        const take = (s?: Array<{ path: string; why: string }>): void => {
          for (const x of s ?? []) {
            const k = `${x.path}\u0000${x.why}`;
            if (seen.has(k)) continue;
            seen.add(k);
            entries.push(x);
          }
        };
        for (const p of r.previews) take(p.result?.skipped);
        for (const a of r.applied) take(a.result.skipped);
        return entries;
      };
      // ★ scope 分支只影响**渲染** —— [C] 是路由器 + 回执渲染器，不在这里写第二套改名/落盘实现。
      if (r.scope === 'local') {
        const done = r.previews.filter((p) => p.ok);
        const parts: string[] = [
          r.dryRun
            ? `[局部改名 dry-run 预览·未落盘] 共 ${r.previews.length} 条：可改 ${done.length} 条，跳过 ${r.previews.length - done.length} 条`
            : `局部改名完成：共 ${r.previews.length} 条（改 ${done.length} 条，跳过 ${r.previews.length - done.length} 条），落盘 ${r.filesWritten} 个文件`,
        ];
        if (!r.ok) {
          parts.push('⚠ 整批未落盘（一个字节都没写）：');
          for (const b of r.blocked ?? []) parts.push(`\t${b}`);
        }
        for (const p of r.previews) {
          const note = p.result?.definition?.note;
          parts.push(`  ${p.ok ? '✓' : '✗'} ${p.item.file} 的 ${p.item.symbol} → ${p.item.to}${note ? ` —— ${note}` : ''}`);
          for (const b of p.blocked ?? []) parts.push(`\t✗ 跳过：${b}`);
        }
        // ★ 统一「扫描边界」（唯一落点：`src/tools/scan_bounds.ts`）：局部支**无跨文件闭包**，
        //   边界就是"逐条目所在文件"；跳过项 = 被拒的那些条目（名字歧义/撞名/非法名…）。
        const localBounds: ScanBounds = {
          scope: '文件内局部绑定（作用域隔离，不跨文件；无 import 闭包扩展）',
          scanned: { files: r.previews.length },
          ...(skippedEntries().length > 0 ? { skipped: skippedEntries() } : {}),
        };
        return { message: parts.join('\n'), data: { ...r, bounds: localBounds } };
      }
      const fmt = (item: { file: string; symbol: string; to: string }, res?: { definition?: { file: string }; importers?: { file: string; ops?: { old: string; new: string }[] }[] }): string => {
        const lines = [`  - ${item.file} 的 ${item.symbol} → ${item.to}`];
        if (res?.definition) lines.push(`\t定义 ${res.definition.file}`);
        if (res?.importers?.length) {
          for (const i of res.importers) lines.push(`\t导入 ${i.file}（${i.ops ? [...new Map(i.ops.map((o) => [`${o.old}→${o.new}`, true])).keys()].join('，') : ''}）`);
        }
        return lines.join('\n');
      };
      const appendLiterals = (parts: string[], res: typeof r): void => {
        const hits = (res.literals || []).filter((l) => l.matches.length > 0);
        if (hits.length === 0) return;
        parts.push('\n字面量引用（report_literals，仅报告未改动）：');
        const kindLabel = { contract: '契约名', history: '历史', docs: '文档', test: '测试', code: '源码' } as const;
        for (const l of hits) {
          const tally: Partial<Record<string, number>> = {};
          for (const m of l.matches) tally[m.kind] = (tally[m.kind] || 0) + 1;
          const sum = Object.entries(tally)
            .map(([k, n]) => `${kindLabel[k as keyof typeof kindLabel] ?? k}×${n}`)
            .join(' ');
          parts.push(`  • "${l.needle}" → ${l.matches.length} 处（${sum}），如 ${l.matches[0].file}:${l.matches[0].line}`);
        }
        const contractHits = hits.some((l) => l.matches.some((m) => m.kind === 'contract'));
        if (contractHits) {
          parts.push('  ⚠ 命中【契约名】= 对外 MCP 注册名（name:）——改名会破坏调用契约，需人审同步契约而非自动落盘。');
        }
      };
      // ★ §27.4 / §28.3-7（2026-09-28）：改名是**正确性敏感**操作 —— `skipped` 非空意味着
      //   "有文件我没看"（读不了 / 该扩展名无解析器 / 闭包扫描失败）⇒ 那些文件里的引用**可能没被改写**，
      //   改名会产出**损坏的代码**（定义改了、引用没改）。故必须在回执**显著位置**显式警告，
      //   并逐条列出 {path, why}；不能让它混在普通回执里（否则退化成 §2d 的"少做而不说话"）。
      //   数据来源：每条 preview/applied 的 result.skipped（rename_symbol 只在非空时返回）。
      //   ★ 2026-09-29（本笔）：去重逻辑上提为 `skippedEntries()`（本函数顶部），与 `bounds.skipped` 共用。
      const skippedWarning = (): string | null => {
        const entries = skippedEntries();
        if (entries.length === 0) return null;
        const lines = [
          `⚠ 改名可能不完整：${entries.length} 个文件未能扫描（原因见下）——这些文件里的引用可能未改写，请人工复核：`,
        ];
        for (const e of entries) lines.push(`  · ${e.path} —— ${e.why}`);
        return lines.join('\n');
      };
      /**
       * ★ 统一「扫描边界」（唯一落点：`src/tools/scan_bounds.ts`）。
       *   scope = 两条候选来源（import 反向闭包 + report_literals 的文本扫描）；
       *   scanned.files = 各条目**闭包分析到的文件数**（定义文件 1 + 它解析到的 importer 数，逐条累加）；
       *   skipped = 上面那份去重清单。
       */
      const bounds = (): ScanBounds => {
        let scanned = 0;
        const add = (res?: { importers?: unknown[] }): void => {
          if (res) scanned += 1 + (res.importers?.length ?? 0);
        };
        for (const p of r.previews) add(p.result);
        for (const a of r.applied) add(a.result);
        const entries = skippedEntries();
        return {
          scope:
            'import 反向闭包（工作区内引用方；含 tsconfig 别名 / re-export）' +
            (r.literals ? ' + 字面量文本扫描（report_literals：项目文本里的 snake 变体命中）' : ''),
          scanned: { files: scanned },
          ...(entries.length > 0 ? { skipped: entries } : {}),
        };
      };
      if (!r.ok) {
        const parts = [`批量改名被阻断（${r.dryRun ? '整体未落盘' : '部分已应用后中止'}）：`];
        const warn = skippedWarning();
        if (warn) parts.push(warn);
        parts.push(`\t${(r.blocked || []).join('\n\t')}`);
        parts.push('\tdry-run 各条状态：');
        for (const p of r.previews) parts.push(`\t  [${p.ok ? '可落盘' : '被阻断'}] ${fmt(p.item, p.result)}`.replace(/\n/g, '\n\t  '));
        appendLiterals(parts, r);
        return { message: parts.join('\n'), data: { ...r, bounds: bounds() } };
      }
      const parts = [
        r.dryRun ? `[批量 dry-run 预览·未落盘] 共 ${r.previews.length} 条` : `批量改名完成：${r.previews.length} 条，落盘 ${r.filesWritten} 个文件`,
      ];
      const warn = skippedWarning();
      if (warn) parts.push(warn);
      for (const p of r.previews) parts.push(fmt(p.item, p.result).replace(/\n/g, '\n\t'));
      appendLiterals(parts, r);
      return { message: parts.join('\n'), data: { ...r, bounds: bounds() } };
    }),
  },

  {
    name: 'rename_files',
    trustAnnotated: true, // 改文件名决策同理（见 trustNoteFor）
    title: 'Batch file renames with import-reference rewrites (whole-batch dry-run first)',
    description:
      '文件改名/移动（单条或批量统一入口）并联动全仓 import 引用改写，对标脚本效率（消除"70 文件改名=70 次调用"的粒度问题）。' +
      '支持单条或批量——renames 传 1 条即单文件改名（原独立的 rename_file 单条目工具已并入本入口）。' +
      '输入 renames=[{from,to}]（from/to 相对 project_dir 或绝对路径）。' +
      '先对所有条目按原始文件态 dry_run 算影响面；任一条被阻断（源缺失 / 目标已存在 / 命中冻结行）→ 整体不落盘，返回预览报告。' +
      '全部可落盘时才逐条落盘（复用 rename_file 的原子语义：先复制→改写引用→删源+重索引，失败可回滚）。' +
      'apply 阶段串行，前面改动使后续条目被阻断时立即中止，如实报告已应用条数。' +
      '冻结行保护 / 生成物识别：逐条内部走 rename_file，天然继承（body 文件不套 / importer 命中冻结行 → 该条阻断）。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（可选；缺省按第一条 from 自动定位，兜底 cwd）'),
      renames: z
        .array(z.object({ from: z.string().describe('源文件：相对 project_dir 或绝对路径'), to: z.string().describe('目标文件：相对 project_dir 或绝对路径') }))
        .describe('待批量改名的文件条目'),
      dry_run: z.boolean().optional().describe('true=只算全部 dry-run 影响面不落盘（默认：先整体校验，全通过才落盘）'),
    },
    handler: wrapData(async (a) => {
      const r = await renameFiles({
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        renames: (a.renames as Array<{ from: string; to: string }>).map((x) => ({ from: String(x.from), to: String(x.to) })),
        dry_run: a.dry_run === true,
      });
      const fmt = (p: { from: string; to: string }, res?: { references: Array<{ file: string; fromSource: string; toSource: string }> }): string => {
        const lines = [`  - ${p.from} → ${p.to}`];
        if (res?.references) {
          for (const ref of res.references) lines.push(`\t改 ${ref.file}：${ref.fromSource} → ${ref.toSource}`);
        }
        return lines.join('\n');
      };
      if (!r.ok) {
        const parts = [`批量文件改名被阻断（${r.dryRun ? '整体未落盘' : '部分已应用后中止'}）：`];
        parts.push(`\t${(r.blocked || []).join('\n\t')}`);
        parts.push('\tdry-run 各条状态：');
        for (const p of r.previews) parts.push(`\t  [${p.ok ? '可落盘' : '被阻断'}] ${fmt(p, p.result)}`.replace(/\n/g, '\n\t  '));
        return { message: parts.join('\n'), data: r };
      }
      const parts = [
        r.dryRun ? `[批量文件改名 dry-run 预览·未落盘] 共 ${r.previews.length} 条` : `批量文件改名完成：${r.previews.length} 条，联动改写引用 ${r.filesWritten} 处`,
      ];
      for (const p of r.previews) parts.push(fmt(p, p.result).replace(/\n/g, '\n\t'));
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'move_symbol',
    title: 'Move a module-level symbol across files (semantic refactor, redirects importers)',
    description:
      '跨文件移动模块级符号（语义重构第一棒）：把 file 里的模块级符号 symbol 搬到 to_file，' +
      '并自动把工作区内所有「仅引入该符号」的 import/再导出目标从源文件重定向到 to_file（只改 import 的 source，远程名/别名/使用点不动）。' +
      '导入到工作区外（外部仓库）的引用只反馈（externalRefs）不追外。' +
      '防护（任一触发→整体不落盘并说明）：目标文件撞同名 / namespace import / export * 转发 / 一条 import 同时引入其它符号 / 非模块级符号 / 源文件是 import 绑定。' +
      'v1 仅 TS/JS 模块级符号；to_symbol 改名未启用（改名著 safe_rename）。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（可选；缺省按 file 自动定位）'),
      file: z.string().describe('定义符号的源文件（相对 project_dir 或绝对路径）'),
      symbol: z.string().describe('要移动的模块级符号名'),
      to_file: z.string().describe('目标文件（相对 project_dir 或绝对路径；不存在则创建；仅 TS/JS）'),
      to_symbol: z.string().optional().describe('可选：移动后改名为该名（v1 未启用，仅提示走 safe_rename）'),
      dry_run: z.boolean().optional().describe('true=只出结构化预览不落盘（默认：先整体校验，全通过才落盘）'),
    },
    handler: wrapData(async (a) => {
      const r = await moveSymbol({
        project_dir: typeof a.project_dir === 'string' && a.project_dir ? a.project_dir : undefined,
        file: String(a.file),
        symbol: String(a.symbol),
        to_file: String(a.to_file),
        to_symbol: typeof a.to_symbol === 'string' && a.to_symbol ? a.to_symbol : undefined,
        dry_run: a.dry_run === true,
      });
      if (!r.ok) {
        return {
          message: `移动被阻断（${r.dryRun ? '整体未落盘' : ''}）：\n` + (r.blocked || []).join('\n') +
            (r.toSymbolDeferred ? '\n⚠ to_symbol 改名未启用，改名请走 safe_rename。' : ''),
          data: r,
        };
      }
      const parts = [
        r.dryRun ? `[move_symbol dry-run 预览·未落盘] ${r.symbol}：${r.source?.file} → ${r.target?.file}` : `move_symbol 完成：${r.symbol} 已移到 ${r.target?.file}（改写 ${r.affectedFiles?.length ?? 0} 文件）`,
      ];
      if (r.source) parts.push(`源文件删除 ${r.source.file}（L${r.source.startLine}-${r.source.endLine}）：\n` + (r.source.removed ?? []).map((l) => `  - ${l.trimEnd()}`).join('\n'));
      if (r.target) parts.push(`目标文件 ${r.target.file}（${r.target.created ? '新建' : '追加'}）: + ${r.target.symbol ?? r.symbol}`);
      if (r.redirects?.length) {
        parts.push(`import 重定向 ${r.redirects.length} 处（远程名/用法不变）：`);
        for (const d of r.redirects) parts.push(`  ~ ${d.file}: ${d.oldSource} → ${d.newSource}`);
      }
      if (r.externalRefs?.length) {
        parts.push(`项目边界（不追外）: ${r.externalRefs.length} 处 import 解析到工作区外，未改动外部：`);
        for (const e of r.externalRefs.slice(0, 8)) parts.push(`  - ${e.resolved}${e.source ? `（import ${e.source}）` : ''}`);
      }
      if (r.toSymbolDeferred) parts.push('⚠ to_symbol 改名未启用，改名请走 safe_rename。');
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'find_references',
    trustAnnotated: true, // 陈旧断言 = 引用清单静默漏报（见 trustNoteFor）
    title: 'Find symbol references (callers/importers, structural field refs), read-only',
    description:
      '查找符号/字段的引用——改/删前看波及面。只读，不改文件。' +
      'mode=symbol（默认）：输入 {file(定义文件), symbol}，返回定义文件 + 所有 import 该符号的文件' +
      '（含 import 子句 source、无别名使用点位置与行号）。复用 rename 的闭包/引用图内核（自动定位项目根 + 闭包 + 别名边 + 跨语言）。' +
      'mode=field：输入 {field, project_dir}（可选 file 定 scope，默认 closure 按 file 闭包扫，all 全项目），' +
      '返回字段的「读取点」(obj.field/obj.field)、「构造点」({field: v})、「解构点」、「声明点」，' +
      'AST 分类 + 行内上下文 snapshot，**含定义文件内部**——用于"加字段/改签名"前看清谁读谁构造。' +
      'mode=type：输入 {file, symbol(类型名), min_hit?}，从类型声明解出成员字段集，找与其交叠 ≥ min_hit 的' +
      '对象字面量候选构造点（启发式，非类型求解器）。' +
      'report_literals=true：任一模式额外扫描符号 snake 变体（renderDsl→render_dsl）在项目文本（文档/测试/契约/工具注册名）里的字面量命中，' +
      '返回清单待核验——补 AST 查不到的字符串/文档引用，改名/删符号前一次看清全量波及面。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根（可选；缺省自动定位）'),
      mode: z.enum(['symbol', 'field', 'type']).optional().describe('symbol=找符号引用（默认）；field=找字段读/构/解/声明点；type=找形如某类型的对象字面量构造候选'),
      scope: z.enum(['closure', 'all']).optional().describe('field/type 模式：closure=按 file 的 import 闭包扫（默认）；all=全项目扫'),
      min_hit: z.number().optional().describe('type 模式：与类型成员交叠 ≥ 该值才判候选构造点（默认 2）'),
      file: z.string().optional().describe('mode=symbol 必填：定义符号的文件（绝对路径或相对 cwd/project_dir）；field/type 可选（用于定 scope）'),
      symbol: z.string().optional().describe('mode=symbol/type 必填：符号/类型名（模块级声明名）'),
      field: z.string().optional().describe('mode=field 必填：要查的字段名'),
      report_literals: z.boolean().optional().describe('true=额外扫描符号 snake 变体在项目文本里的字面量命中（文档/测试/契约/工具注册名），返回清单待核验，不改动'),
    },
    handler: wrapData(async (a) => {
      // ★ §16.4 P-D：file/symbol/field 是「模式相关必填」，schema 里只能 optional。
      //   这里**不做 `String(a.x)` 强转**——`String(undefined)==='undefined'` 会把缺参变成
      //   一个合法字符串，静默去查名叫 "undefined" 的符号或拼出 `...\undefined` 路径。
      //   原样透传 undefined，由 findReferences 体（[B]）前置校验 throw「缺什么 + 怎么给」。
      const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
      const common = {
        project_dir: optStr(a.project_dir),
        scope: a.scope === 'all' ? ('all' as const) : ('closure' as const),
        file: optStr(a.file),
        report_literals: a.report_literals === true,
      };
      // mode=field：AST 分类的读/构/解/声明点 + snippet
      if (a.mode === 'field') {
        const r = await findReferences({ ...common, mode: 'field', field: optStr(a.field) });
        if (!r.ok) return { message: `字段引用查找失败：\n- ${(r.blocked || []).join('\n- ')}`, data: r };
        const kindLabel = { 'field-read': '读', 'field-key': '构', 'field-destructure': '解', 'field-decl': '声明' } as Record<string, string>;
        const lines = [`字段 ${r.symbol} 的引用（${r.fieldRefs!.length} 个文件；scope=${common.scope}）：`];
        for (const f of r.fieldRefs!) {
          const cnt = new Map<string, number>();
          for (const x of f.refs) cnt.set(x.kind, (cnt.get(x.kind) ?? 0) + 1);
          const summary = ['read', 'key', 'destructure', 'decl']
            .map((k) => (cnt.has(`field-${k}`) ? `${kindLabel[`field-${k}`]}${cnt.get(`field-${k}`)}` : ''))
            .filter(Boolean)
            .join(' ');
          lines.push(`\t- ${f.file}（${summary}）：`);
          for (const x of f.refs) lines.push(`\t    L${x.line}[${kindLabel[x.kind]}] ${x.snippet}`);
        }
        if (r.literals) for (const kv of r.literals) for (const m of kv.matches) lines.push(`\t[字面 ${kv.needle}] ${path.basename(m.file)} L${m.line} [${m.kind}] ${m.snippet}`);
        // P10 能力自述：涉及文件是非调用级语言 ⇒ 诚实标注"文本级，零引用不可全信"
        const granField = renderGranularityNote([common.file], 'refs');
        if (granField) lines.push(granField);
        return { message: lines.join('\n'), data: r };
      }
      // mode=type：成员 + 候选构造点
      if (a.mode === 'type') {
        const r = await findReferences({ ...common, mode: 'type', symbol: optStr(a.symbol), min_hit: typeof a.min_hit === 'number' ? a.min_hit : undefined });
        if (!r.ok) return { message: `类型构造查找失败：\n- ${(r.blocked || []).join('\n- ')}`, data: r };
        const lines = [
          `类型 ${r.symbol} 的成员（${r.typeMembers!.length}）：${r.typeMembers!.join(', ')}`,
          `候选构造点（交叠 ≥ 命中成员数）：${r.typeCandidates!.length} 处`,
        ];
        for (const c of r.typeCandidates!) {
          lines.push(`\t- ${c.file}:L${c.line}（命中 ${c.matched.join(', ')}） ${c.snippet}`);
        }
        if (r.literals) for (const kv of r.literals) for (const m of kv.matches) lines.push(`\t[字面 ${kv.needle}] ${path.basename(m.file)} L${m.line} [${m.kind}] ${m.snippet}`);
        const granType = renderGranularityNote([common.file], 'refs');
        if (granType) lines.push(granType);
        return { message: lines.join('\n'), data: r };
      }
      // mode=symbol：既有逻辑
      const r = await findReferences({
        project_dir: optStr(a.project_dir),
        file: optStr(a.file),
        symbol: optStr(a.symbol),
        report_literals: common.report_literals,
      });
      if (!r.ok) {
        return { message: `引用查找失败：\n- ${(r.blocked || []).join('\n- ')}`, data: r };
      }
      const parts = [`符号 ${r.symbol} 的引用（定义文件 ${r.definition!.file}，${r.importerCount} 个 import 方）：`];
      if (r.definition) {
        parts.push(`\t定义 ${r.definition.file}（${r.definition.kind}），${r.definition.refs.length} 处引用点`);
      }
      for (const imp of r.importers!) {
        parts.push(`\t- ${imp.file}（import ${imp.importSources.join(', ')}）：行 ${imp.refs.map((x) => x.line).join(', ')}`);
      }
      if (r.literals) for (const kv of r.literals) for (const m of kv.matches) parts.push(`\t[字面 ${kv.needle}] ${path.basename(m.file)} L${m.line} [${m.kind}] ${m.snippet}`);
      // P10 能力自述：定义文件是非调用级语言 ⇒ 诚实标注"文本级，零引用不可全信"
      const granSymbol = renderGranularityNote([common.file], 'refs');
      if (granSymbol) parts.push(granSymbol);
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'impact_analysis',
    trustAnnotated: true, // 陈旧断言 = 影响面静默漏报（见 trustNoteFor）
    title: 'Impact analysis - pre-change risk closure report',
    description:
      '影响面分析（改前风险闭包报告）：从变更点（文件 + 可选顶层导出符号）沿 import/调用/类型引用依赖图做反向可达闭包，' +
      '输出直接/间接受影响文件、引用证据与风险排序——回答"我要改这里，会炸哪里"。' +
      'change_points=[{file, symbol?}] 支持改整个文件或只改某个符号；解析不到符号消费方时保守降级为整文件闭包（fell_back）。' +
      'hubs=true 时切换为热区盘点模式（无变更点）：全项目按"被直接依赖数"排序，找出改哪些文件风险最高。' +
      '风险启发式：受影响文件自身的波及半径 × 距离；depth=1 的直接消费方附带引用证据行。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（绝对路径）'),
      change_points: z
        .array(z.object({ file: z.string().describe('相对 project_dir 的源码文件路径'), symbol: z.string().optional().describe('可选：顶层导出符号名') }))
        .optional()
        .describe('变更点列表；hubs 模式可省略'),
      hubs: z.boolean().optional().describe('true = 热区盘点模式（不传 change_points）'),
      top: z.number().optional().describe('热区只列前 N（默认 10）'),
      max_depth: z.number().optional().describe('闭包最大距离（默认不限）'),
    },
    handler: wrapData(async (a) => {
      const root = String(a.project_dir);
      if (a.hubs) {
        const h = await analyzeHubs(root, typeof a.top === 'number' ? a.top : 10);
        const lines = [`风险热区盘点 · ${root}（${h.fileCount} 文件 / ${h.edgeCount} 依赖边）`, '按"被直接依赖数"排序 —— 改这些文件会炸最多下游', ''];
        for (const f of h.files) lines.push(`${f.risk === 'high' ? '⚠' : f.risk === 'medium' ? '·' : ' '} [${f.risk}] ${f.file}  被 ${f.dependents} 个文件依赖 / 依赖 ${f.dependencies} 个文件`);
        return { message: lines.join('\n'), data: h };
      }
      const cps: ImpactChangePoint[] = Array.isArray(a.change_points)
        ? (a.change_points as Array<{ file: string; symbol?: string }>).map((c) => ({ file: c.file, symbol: c.symbol }))
        : [];
      const r = await analyzeImpact(root, cps, typeof a.max_depth === 'number' ? { maxDepth: a.max_depth } : {});
      const lines = [
        `影响面报告 · ${root}`,
        `变更点 ${r.changePoints.length} 个，受影响文件 ${r.total} 个（直接 ${r.direct}，高风险 ${r.high_risk}）`,
      ];
      if (r.fell_back) lines.push('⚠ 存在符号级消费方解析失败 → 已保守降级为"改整个文件"的闭包');
      if (r.missing.length > 0) lines.push(`⚠ 未定位到变更点：${r.missing.join(', ')}`);
      // P10 能力自述：变更点里有非调用级语言 ⇒ 闭包结论会低估（"零波及"不可信）
      const granImpact = renderGranularityNote(cps.map((c) => c.file), 'impact');
      if (granImpact) lines.push(granImpact);
      lines.push('');
      if (r.files.length === 0) lines.push('（零波及：该变更点没有任何文件依赖链）');
      for (const f of r.files) {
        lines.push(`${f.risk === 'high' ? '⚠' : f.risk === 'medium' ? '·' : ' '} [${f.risk}] ${f.file}  (depth=${f.depth}, 被${f.dep_count}个文件依赖)`);
        for (const s of f.sites) lines.push(`      ${s.kind.padEnd(9)} L${s.line}  ${s.detail}`);
      }
      return { message: lines.join('\n'), data: r };
    }),
  },

  {
    name: 'remove_dead_imports',
    title: 'Remove dead imports reported by dead_deps',
    description:
      '移除死 import 执行器：把 dead_deps 报告的死三方依赖（DeadDepCandidate 列表，含 source + files）' +
      '从对应文件里删掉对应的 import/require/re-export 语句。Go 与 TS/JS 各形态都支持：' +
      '单行 import、块 import（删空块壳 `import (...) `）、别名/空导入 `_`/点导入 `.`、' +
      '具名/默认/命名空间/type/副作用 import、export * / export {...} from、CommonJS require。' +
      '保守规则：只删整条 import 语句；识别不出的形态不动；动态 import("x") 等使用点绝不碰。' +
      '原子性：预读全部待改文件，任一读取失败 → 整批中止、一个都不写。' +
      'dead 参数可直接传 dead_deps 工具返回结果里的 dead 数组。' +
      'verify=true（推荐）：启用改前/改后验证闭环——改写前先跑 build+test 基线，' +
      '改写后再跑同一批验证；基线失败则一个都不改，改后回归则自动回滚原位。' +
      'verify 也可传 { commands: [{label, cmd, args, timeoutMs}] } 自定义验证命令组（缺省按项目形态探测）' +
      '：有 go.mod → go build ./... + go test ./...；有 package.json → tsc --noEmit + npm test。' +
      'verify=false/缺省 = 只执行不验证。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（用于把 files 解析为绝对路径）'),
      dead: z
        .array(
          z.object({
            source: z.string().describe('死三方源，如 Go import 路径或 TS 模块说明符'),
            files: z.array(z.string()).describe('导入该源的闭包文件（相对 project_dir 或绝对路径）'),
            reason: z.enum(['no_reference', 'unreachable_only']).optional().describe('dead_deps 判定的死因，仅供记录'),
          }),
        )
        .describe('dead_deps 报告的 DeadDepCandidate 列表'),
      verify: z
        .union([
          z.boolean(),
          z.object({
            commands: z
              .array(
                z.object({
                  label: z.string().describe('命令标签（写进验证详情便于排查）'),
                  cmd: z.string().describe('可执行命令名，如 go / npm / npx'),
                  args: z.array(z.string()).describe('命令参数'),
                  timeoutMs: z.number().optional().describe('单命令超时（毫秒，默认 300000）'),
                }),
              )
              .optional()
              .describe('自定义验证命令组；缺省按项目形态自动探测'),
          }),
        ])
        .optional()
        .describe('true 启用改前/改后验证闭环；{commands} 自定义验证命令；缺省只执行不验证'),
    },
    handler: wrapData(async (a) => {
      const { project_dir, dead, verify } = a;
      if (!Array.isArray(dead) || dead.length === 0) {
        return { message: '无可删除的死 import（dead 列表为空）', data: { files: [], files_changed: 0, statements_removed: 0, verification: { enabled: Boolean(verify), outcome: 'no_change', baseline: null, after: null } } };
      }
      const r = removeDeadImportsWithVerify({
        project_dir: String(project_dir),
        dead,
        verify: verify as RemoveDeadImportsVerifyOptions['verify'] | undefined,
      });
      const parts = [
        `移除死 import 完成：改写 ${r.files_changed} 个文件，删除 ${r.statements_removed} 条 import 语句。`,
      ];
      if (r.verification.enabled) {
        const v = r.verification;
        const kind =
          v.outcome === 'applied_verified' ? '改前/改后验证全绿，改动落盘'
          : v.outcome === 'baseline_fail' ? '改前基线失败——拒绝执行，未改动任何文件'
          : v.outcome === 'regression_rolled_back' ? '改后验证回归——已自动回滚原位'
          : v.outcome === 'no_change' ? '无实际变更，未改动文件'
          : '项目形态不可自动验证（无 go.mod/package.json）——已执行但未验证';
        parts.push(`\t[$kind] 基线=${v.baseline?.status ?? '-'} 改后=${v.after?.status ?? '-'}`);
        if (v.detail) parts.push(`\t详情：${v.detail}`);
      }
      if (r.files.length === 0) parts.push('\t没有命中任何可操作的文件（输入 dead 清单的文件均非 TS/Go 系）。');
      for (const f of r.files) {
        const detail = f.removals.filter((x) => x.changed).map((x) => `${x.source}×${x.removed}`).join('、') || '无变更';
        parts.push(`\t- ${f.file}（${f.lang}）：${detail}`);
      }
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'annotate_functions',
    title: '函数语义注释：扫描覆盖 → LLM 补全缺失 → body指纹同步过期（TS/JS + Go）',
    description:
      '让"函数做什么"由源码自带语义注释承载，而非每次由 LLM 从中重新提取。对 TS/JS + Go 项目的每个函数检查其上方是否有语义化注释：' +
      '缺失 → 用 LLM 依据 签名+函数体 生成一句"这函数做什么"，按语言惯例（TS/JS 用 JSDoc，Go 用 `//` 近 godoc）注入到函数名上方；' +
      '带 `@fnhash <sha256(body)>` 指纹标记的函数被改动过（指纹失配 = 过期）→ LLM 重注同步。' +
      '任何对函数体的修改都会改变 fingerprint，因此"每次修改都同步注释"被机械覆盖。' +
      '安全：只替换带自己 `@fnhash` 标记的块，手写无指纹注释一律不动，绝不误删用户注释。' +
      'mode=scan 只读报告覆盖（不生成、不写盘）；dry_run 生成并给出预览 diff、不写盘；apply（默认）生成并写盘。' +
      '未配置 LLM 时 scan 照常，apply/dry_run 退化为仅报告缺/过期名单。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（扫描其下 TS/JS 源文件）'),
      files: z.array(z.string()).optional().describe('限定只处理这些文件（相对 project_dir 或绝对路径）；缺省扫目录全部'),
      mode: z.enum(['apply', 'dry_run', 'scan']).optional().default('apply').describe('apply=生成并写盘；dry_run=生成但只预览；scan=只读报告'),
    },
    handler: wrapData(async (a) => {
      const project_dir = String(a.project_dir);
      const mode = (a.mode as string | undefined) || 'apply';
      const files = Array.isArray(a.files) ? a.files.map((f) => String(f)) : undefined;
      // ★ 不再在 [C] 里 existsSync 过滤：`planFunctionAnnotation`（[B]）逐文件已有**同一道**存在性检查，
      //   在这里再过滤一遍 = 第二份判据（两边口径一旦分叉就静默不一致）。本层只做"路径归一 + 转发"。
      const absFiles = files
        ? files.map((f) => (path.isAbsolute(f) ? path.resolve(f) : path.resolve(project_dir, f)))
        : undefined;
      const useLlm = mode !== 'scan';
      const r = await planFunctionAnnotation({ project_dir, absFiles, llm: useLlm });
      const s = r.summary;
      if (mode === 'apply') {
        // ★ 落盘走共享内核（写前快照一次 + 真写 + 索引写穿）：此前这里是裸 writeFileSync 循环，
        //   落盘后既不进索引、也没有撤回通道。
        const receipt = await applyWrites(
          project_dir,
          [...r.absToNew].map(([abs, content]) => ({ file: abs, content })),
          { note: 'annotate_functions' },
        );
        const written = receipt.written.length;
        const parts = [
          `函数语义注释完成：扫描 ${s.scanned} 个函数 / ${s.files} 个文件；`,
          `已有注释 ${s.with_comment}，缺失 ${s.missing}，过期 ${s.stale}；`,
          `本轮新注入 ${s.annotated}、同步重注 ${s.updated}，改写 ${written} 个文件。`,
        ];
        if (r.note) parts.push(` 备注：${r.note}`);
        // ★ 在 project_dir 之外的文件进不了快照/索引 ⇒ 内核拒绝落盘。绝不静默：
        //   否则上面那句"改写 0 个文件"会被读成"没什么要改的"，而其实是有改动被拒了。
        if (receipt.blocked?.length) {
          parts.push(
            `  ⚠ ${receipt.blocked.length} 个文件在 project_dir 之外，**未落盘**（无法做写前快照与索引写穿）：` +
              receipt.blocked.join(', '),
          );
        }
        if (written === 0 && !receipt.blocked?.length) parts.push('  无待补全/无过期注释，或 LLM 未配置——未写任何文件。');
        return { message: parts.join('\n'), data: { summary: s, files_changed: written, note: r.note } };
      }
      if (mode === 'dry_run') {
        const preview = [...r.absToNew.keys()].map((abs) => {
          const lines = (r.absToNew.get(abs) ?? '').split(/\r?\n/);
          const added = lines.reduce((n, ln) => n + (/^[ \t]*[/][*][*]/.test(ln) || /@fnhash/.test(ln) ? 1 : 0), 0);
          return { file: abs, functions_annotated: added };
        });
        const parts = [
          `【干跑】函数语义注释计划：扫描 ${s.scanned} 个函数，缺失 ${s.missing}、过期 ${s.stale}，`,
          `本轮将新注入 ${s.annotated}、重注 ${s.updated}，改写 ${r.absToNew.size} 个文件（未落盘）。`,
        ];
        for (const p of preview) parts.push(`  - ${p.file.replace(/\\/g, '/')}：+${p.functions_annotated}`);
        if (r.note) parts.push(`  备注：${r.note}`);
        return { message: parts.join('\n'), data: { summary: s, preview, note: r.note } };
      }
      const parts = [
        `【扫描】函数语义注释覆盖：${s.files} 个文件 / ${s.scanned} 个函数；`,
        `已有语义注释 ${s.with_comment}；待补（缺失）${s.missing}；待同步（body 已改，过期）${s.stale}。`,
      ];
      if (r.note) parts.push(`  备注：${r.note}`);
      return { message: parts.join('\n'), data: { summary: s, note: r.note } };
    }),
  },

  {
    name: 'refactor_pipeline',
    title: 'Run deterministic refactor pipeline (dead imports + dead statements + package migration + function annotation)',
    description:
      '确定性重构管线：把可自动执行的瘦身改写串成一条链，一次调用按序执行、统一增量验证、失败只回滚到最近绿点。' +
      '入口只跑一次改前基线（build+test），其后每步基于上一步已绿的内容只跑一次改后验证——不改动的步骤不验证（性能友好）。' +
      '内置步骤：' +
      '  1) dead_imports：一键自动检测并删除死 import——未给 dead 清单时自动调用 detect_dead_imports 做文件级扫描；' +
      '     给了清单则用给定清单（可直接用 dead_deps 的 dead 数组）。复用 removeDeadImports 同源规则删除指向死源的 import/require/re-export 语句。' +
      '  2) dead_statements：自动扫描（可选 files 收敛范围）删除 return/throw/continue 后不可达语句与死分支（TS/Go）。' +
      '  3) package_migration（包改名/提级）：把缺换代的包一次性涤荡干净——全项目 import 引用面重写（prefix→to）、' +
      '     package 声明改名（v2→hub，from_test→to_test）、import 别名清洗（hubv2→hub）；可选目录物理移动。' +
      '  4) function_annotation（函数语义注释，TS/JS + Go）：扫覆盖→缺失的用 LLM 依据 签名+函数体 生成一句话语义注释；' +
      '     用 @fnhash body 指纹标记，函数体一改即判过期 → 下次管线重注同步；手写无指纹注释绝不动。' +
      '失败语义：某步改后验证回归 → 只还原该步预读的原始内容，回到上一步绿点，前面已绿的改动保留；管线结果 ok=false。' +
      '基线失败 → 一个文件都不改。verify=true 启用验证；{commands} 自定义命令组；缺省/verify=false 仅落盘不验证（not_verifiable）。' +
      'rename 步骤需人工候选，暂不内置。' +
      'result.stages[] 含每步 outcome（applied/no_change/rolled_back/not_verifiable/skipped）+ baseline/after 验证状态。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录'),
      steps: z
        .object({
          dead_imports: z
            .object({
              enabled: z.boolean().optional().default(false).describe('是否启用死 import 移除步骤'),
              dead: z
                .array(
                  z.object({
                    source: z.string().describe('死三方源（Go import 路径或 TS 模块说明符）'),
                    files: z.array(z.string()).describe('导入该源的文件（相对 project_dir 或绝对路径）'),
                  }),
                )
                .optional()
                .describe('已检测的死依赖清单；直接用 dead_deps 结果 dead 数组，或省略（缺省自动文件级检测死 import，实现一键）'),
            })
            .optional(),
          dead_statements: z
            .object({
              enabled: z.boolean().optional().default(false).describe('是否启用死语句删除步骤（自动扫描）'),
              files: z.array(z.string()).optional().describe('收敛到指定文件（相对或绝对路径）；缺省递归扫全部 TS/Go 源'),
            })
            .optional(),
          package_migration: z
            .object({
              enabled: z.boolean().optional().default(false).describe('是否启用包改名/提级步骤'),
              moduleBase: z.string().describe('模块根，如 github.com/acme/widget/server'),
              prefix: z.string().describe('被改写的旧 import 前缀（相对 project_dir），如 internal/hub/v2'),
              to: z.string().describe('新 import 前缀（相对 project_dir），如 internal/hub'),
              packageRename: z
                .object({
                  from: z.string().describe('旧包名，如 v2'),
                  to: z.string().describe('新包名，如 hub'),
                })
                .optional()
                .describe('顶层源文件 package 声明改名；from_test 包自动改 to_test'),
              packageRenameDir: z
                .string()
                .optional()
                .describe('package 改名作用的物理目录（相对 project_dir）；缺省取 to'),
              sourceExts: z.array(z.string()).optional().describe('参与改写的源文件扩展名（缺省 .go/.ts/.tsx…）'),
              aliases: z
                .array(
                  z.object({
                    importPath: z.string().describe('重写后的规范化 import 路径'),
                    from: z.string().describe('现别名'),
                    to: z.string().describe('清洗目标名'),
                  }),
                )
                .optional()
                .describe('import 别名清洗：声明改名 + 用法重写'),
              skipDirs: z.array(z.string()).optional().describe('跳过目录名（缺省 node_modules/.git 等）'),
              packageRenameTopLevelOnly: z
                .boolean()
                .optional()
                .describe('只改直接位于 packageRenameDir 下的源文件（缺省 true）'),
            })
            .optional(),
          function_annotation: z
            .object({
              enabled: z.boolean().optional().default(false).describe('是否启用函数语义注释步骤（TS/JS + Go，需 LLM 已配置才生成）'),
              files: z.array(z.string()).optional().describe('限定只注释这些文件（相对或绝对路径）；缺省扫目录内全部 TS/JS + Go 源'),
            })
            .optional(),
        })
        .describe('按序执行的步骤开关（至少启用一个才有产出）'),
      verify: z
        .union([
          z.boolean(),
          z.object({
            commands: z
              .array(
                z.object({
                  label: z.string().describe('命令标签'),
                  cmd: z.string().describe('可执行命令名，如 go / npm / npx'),
                  args: z.array(z.string()).describe('命令参数'),
                  timeoutMs: z.number().optional().describe('单命令超时（毫秒，默认 300000）'),
                }),
              )
              .optional()
              .describe('自定义验证命令组；缺省按项目形态自动探测'),
          }),
        ])
        .optional()
        .describe('true 启用统一验证闭环；{commands} 自定义命令；缺省/verify=false 仅落盘不验证'),
    },
    handler: wrapData(async (a) => {
      const project_dir = String(a.project_dir);
      const steps = a.steps as
        | {
            dead_imports?: { enabled?: boolean; dead?: Array<{ source: string; files: string[] }> };
            dead_statements?: { enabled?: boolean; files?: string[] };
            package_migration?: {
              enabled?: boolean;
              moduleBase: string;
              prefix: string;
              to: string;
              packageRename?: { from: string; to: string };
              packageRenameDir?: string;
              sourceExts?: string[];
              aliases?: Array<{ importPath: string; from: string; to: string }>;
              skipDirs?: string[];
              packageRenameTopLevelOnly?: boolean;
            };
            function_annotation?: { enabled?: boolean; files?: string[] };
          }
        | undefined;
      const verify = a.verify as Parameters<typeof runRefactorPipeline>[0]['verify'];
      const migrate = steps?.package_migration;
      const r = await runRefactorPipeline({
        project_dir,
        steps: {
          dead_imports: steps?.dead_imports?.enabled
            ? { enabled: true, dead: steps.dead_imports.dead ?? [] }
            : undefined,
          dead_statements: steps?.dead_statements?.enabled
            ? { enabled: true, files: steps.dead_statements.files }
            : undefined,
          package_migration: migrate?.enabled
            ? {
                enabled: true,
                migrate: {
                  moduleBase: migrate.moduleBase,
                  prefix: migrate.prefix,
                  to: migrate.to,
                  packageRename: migrate.packageRename,
                  packageRenameDir: migrate.packageRenameDir,
                  sourceExts: migrate.sourceExts,
                  aliases: migrate.aliases,
                  skipDirs: migrate.skipDirs,
                  packageRenameTopLevelOnly: migrate.packageRenameTopLevelOnly,
                },
              }
            : undefined,
          function_annotation: steps?.function_annotation?.enabled
            ? { enabled: true, files: steps.function_annotation.files }
            : undefined,
        },
        verify,
      });

      const parts = [
        `确定性重构管线完成：全局 ${r.ok ? '通过' : '已停（存在回滚）'}，`,
        `共 ${r.planned_steps} 步，${r.total_files_changed} 个文件被改写，`,
        `删除 ${r.total_units_removed} 单位（import 语句×文件 / 死语句文件数）。`,
        `基线=${r.baseline?.status ?? '未验证'}`,
      ];
      for (const s of r.stages) {
        const kind =
          s.outcome === 'applied' ? '已落盘并通过改后验证'
          : s.outcome === 'no_change' ? '无实际改动'
          : s.outcome === 'rolled_back' ? '改后验证回归，已回滚到绿点'
          : s.outcome === 'not_verifiable' ? '未启用验证，已落盘'
          : '未启用';
        parts.push(`\t[${s.label}] ${s.outcome}——${kind}（改动 ${s.files_changed} 文件，${s.units_removed} 单位）`);
        if (!r.ok && s.outcome === 'rolled_back') parts.push(`\t\t回滚详情：${s.detail}`);
      }
      return { message: parts.join('\n'), data: r };
    }),
  },

  {
    name: 'suggest_renames',
    title: 'Suggest semantic names for short/unmeaningful variables',
    description:
      '智能化改名建议：识别文件中短名/无意义局部变量（含形参），结合纯逻辑候选识别 + LLM 命名建议，' +
      '为每个候选给出 suggested（建议新名）与 reason（理由）。' +
      'use_llm=true（默认）调 LLM 建议；false 或未配置 LLM 时降级为仅候选识别（suggested 留空）。' +
      '返回 candidates 含 id/name/kind/parentFunction/refs/declLine/suggested/reason，' +
      '可直接把 {file, symbol: name, to: suggested} 作为 rename_symbols(scope="local") 的 renames 条目完成批量改名' +
      '（同文件同名绑定多于一个时再补 decl_line=声明行号；候选里的 declLine 是**行文本**、不是行号）。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（用于解析 file 为绝对路径）'),
      file: z.string().describe('目标文件（相对 project_dir 或绝对路径）'),
      min_len: z.number().optional().default(2).describe('短名长度阈值（默认 2，≤min_len 视为短名候选）'),
      max: z.number().optional().default(40).describe('LLM 建议的候选数量上限（其余只识别不取名）'),
      use_llm: z.boolean().optional().default(true).describe('是否用 LLM 生成命名建议（默认 true；false/未配置 LLM 则降级为仅候选识别）'),
    },
    handler: wrapData(async (a) => {
      const opts: SuggestOptions = {
        max: typeof a.max === 'number' ? a.max : undefined,
        minLen: typeof a.min_len === 'number' ? a.min_len : undefined,
        llm: a.use_llm === false ? null : undefined,
      };
      // ★ [C] 只转发：解析 file → 读源码 → 建议 全在 [B]（suggestRenamesInFile）
      const result = await suggestRenamesInFile({
        project_dir: String(a.project_dir),
        file: a.file as string,
        opts,
      });
      return {
        message:
          `识别到 ${result.candidates.length} 个短名/无意义变量候选；` +
          `LLM 建议：${result.llm ? '已启用' : '未启用/降级'}${result.note ? `（${result.note}）` : ''}。` +
          `建议名可直接作为 rename_symbols(scope="local") 的 renames 条目使用（{file, symbol, to}）。`,
        data: result,
      };
    }),
  },

  {
    name: 'find_similar_names',
    title: 'Detect confusable similar names and disambiguate',
    description:
      '相似名称检测与一键消歧：识别同一函数内"易看错"的孪生名（仅大小写不同 / 数字后缀 count-count2 / ' +
      '相邻换位 typo total-totla / 小编辑距离），按相似度连通块聚类。每个 cluster 保留最清晰名 basis，' +
      '其余为待改名 offenders；use_llm=true（默认）请 LLM 为每个 offender 建议语义化且与 basis 明显区分的新名。' +
      'use_llm=false 或未配置 LLM 时降级为仅聚类（suggested 留空）。' +
      '返回 clusters（含 offenders.suggested 与 reason）+ 可直接作为 rename_symbols(scope="local") 的 renames 条目使用的 items 数组（{file, symbol, to}），' +
      '实现"检测→建议→批量改名"闭环。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（用于解析 file 为绝对路径）'),
      file: z.string().describe('目标文件（相对 project_dir 或绝对路径）'),
      max_clusters: z.number().optional().default(20).describe('LLM 处理的最大聚类数（其余仅检测不取名）'),
      use_llm: z.boolean().optional().default(true).describe('是否用 LLM 生成消歧新名（默认 true；false/未配置 LLM 则降级为仅聚类）'),
    },
    handler: wrapData(async (a) => {
      const opts = {
        maxClusters: typeof a.max_clusters === 'number' ? a.max_clusters : undefined,
        llm: a.use_llm === false ? null : undefined,
      };
      // ★ [C] 只转发：解析 file → 读源码 → 聚类+消歧 全在 [B]（suggestDisambiguationsInFile）
      const result = await suggestDisambiguationsInFile({
        project_dir: String(a.project_dir),
        file: a.file as string,
        opts,
      });
      const items = disambiguationItems(result, String(a.file));
      return {
        message:
          `识别到 ${result.clusters.length} 个相似名聚类；` +
          `LLM 消歧：${result.llm ? '已启用' : '未启用/降级'}${result.note ? `（${result.note}）` : ''}；` +
          `可直接改名的项 ${items.length} 条，已附在 data.items（形如 {file,symbol,to}）供 rename_symbols(scope="local") 使用。`,
        data: { ...result, items },
      };
    }),
  },

  {
    name: 'refactor_judge',
    title: 'LLM review gate: collect issues, decide adopt/reject, escalate the unsure to human (via context/inbox)',
    description:
      'LLM 审闭环的裁决门：接受候选问题清单，逐条裁【采纳/驳回/不确定(+置信度+理由)】，' +
      '把"拿不定主意"的（uncertain）上抛回控制台/上下文（经 alert_inbox 入箱，下一次工具响应自动附带），' +
      '其余进 decided（adopt/reject）。' +
      '这是"用工具收集问题 → 问题回吐给 LLM → 再给人审"的最小闭环，无需交互审核 UI。' +
      '用法：给我 issues（type/file/desc/severity/evidence 数组）；不传 decide → 全部判"不确定"全部上抛（等 LLM/人拍板），' +
      '或传 decide 裁决器自动路由（adopt→做/继续，reject→忽略，unsure→上抛）。' +
      '返回 result：{ decided:{adopt,reject}, escalated, decisions, meta, review_prompt }，' +
      '其中 review_prompt 可直接贴给人看。',
    inputSchema: {
      project_dir: z.string().optional().describe('目标项目根目录（用于入箱定位；可省略）'),
      issues: z
        .array(
          z.object({
            type: z.string().describe('问题类型：dead_code/dead_import/mixed_signals/package_migration…'),
            file: z.string().optional().describe('关联文件'),
            desc: z.string().describe('人话描述'),
            severity: z.enum(['low', 'medium', 'high']).optional().describe('严重度，默认 medium'),
            evidence: z.string().optional().describe('支撑证据'),
            confidence: z.number().min(0).max(1).optional().describe('预备置信度'),
          }),
        )
        .describe('候选问题清单'),
      verdicts: z
        .array(
          z.object({
            issue_id: z.string().describe('对应 issue 的 id；缺省自动补 type#序号'),
            verdict: z.enum(['adopt', 'reject', 'unsure']).describe('采纳/驳回/拿不定主意'),
            reason: z.string().describe('一句话理由'),
            confidence: z.number().min(0).max(1).optional().describe('置信度 0..1'),
          }),
        )
        .optional()
        .describe('裁决结果；不传则全部判"不确定"上抛（最小形态）'),
      escalate_to_inbox: z.boolean().optional().default(true).describe('uncertain 是否入收件箱回上下文'),
    },
    handler: wrapData(async (a) => {
      const issues = (a.issues as JudgeIssue[]) ?? [];
      const verdicts = a.verdicts as JudgeDecision[] | undefined;
      const result = await runRefactorJudge({
        project_dir: a.project_dir ? String(a.project_dir) : undefined,
        issues,
        // 传了 verdicts 就用它当裁决器，否则缺省（全部上抛）
        decide: verdicts ? () => verdicts : undefined,
        escalate_to_inbox: a.escalate_to_inbox !== false,
      });
      // ★ `review_prompt` 与 message **是同一个字符串** ⇒ 从 data 里剔掉再走 `---DATA---`，
      //   否则回执里那一段裁决摘要会逐字打两遍。剩下的 decided/escalated/decisions/meta
      //   才是 message 里没有的**结构化裁决台账**（这才是本工具原先在通道层丢掉的东西）。
      const { review_prompt, ...data } = result;
      return { message: review_prompt, data };
    }),
  },

  {
    name: 'snapshot',
    title: 'Code snapshots (undo points): list them / roll back to one — single entry',
    description:
      '代码快照统一入口（**2 个注册入口收敛为 1 个入口 + action 分派**；按「操作对象」聚合的理由：两者操作的是同一个快照库）。' +
      '快照 = 每次 edit_code / rename_files / move_symbol **落盘前**自动存的一份文件副本' +
      '（住 <project_dir>/.agent-io/code-snapshots/，默认保留最近 20 份）。' +
      'action=list 列出快照（id / 时间 / 原因 / 涉及文件数）—— 回答"我能不能撤回刚才那一步"，limit 默认 10；' +
      'action=rollback 回滚到某份快照（snapshot 省略或 "latest" = 最近一份）：快照里存在的文件写回原内容，' +
      '快照时"还不存在"的文件（= 那次改动新建的）会被删除；传 file 可只回滚单个文件。' +
      '★ 语义明写（**不静默改**）：rollback **立即落盘、没有 dry_run 预览**（与收敛前的 rollback 入口逐字同语义）；' +
      '且**回滚本身不再存快照 ⇒ 这一步不可再撤回** —— 要留后路请先 action=list 确认目标快照，或依赖 git。' +
      '★ 别与设计稿快照混淆：本工具管**代码文件**快照；**DSL 设计快照**走 get_dsl(query="snapshots")。',
    inputSchema: {
      action: z.enum(['list', 'rollback']).describe('list=列代码快照（撤回点） | rollback=回滚到某份快照'),
      project_dir: z.string().describe('目标项目根目录'),
      limit: z.number().optional().describe('list 用：最多返回几条（默认 10）'),
      snapshot: z.string().optional().describe('rollback 用：快照 id，或 "latest"（缺省 = 最近一份）'),
      file: z.string().optional().describe('rollback 用：只回滚该文件（相对项目根或绝对路径）'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'list' | 'rollback' | undefined;
      // ★ 前置校验（安全策略前移）：入口与锚点先判，缺参**明确报错**，不把 'undefined' 拼进路径。
      if (action !== 'list' && action !== 'rollback') {
        throw new Error(`缺参数或非法 "action"（可选值：list / rollback）`);
      }
      const root = requireStr(a, 'project_dir');

      if (action === 'list') {
        const list = listFileSnapshots(root).slice(0, (a.limit as number | undefined) ?? 10);
        const body = list.length
          ? list.map((m) => `  ${m.id}  ${m.createdAt}  ${m.reason}（${m.files.length} 文件）`).join('\n')
          : '（暂无快照：任何 edit_code / rename_files / move_symbol 落盘前都会自动存一份）';
        return { message: `代码快照 ${list.length} 条：\n${body}`, data: { snapshots: list } };
      }

      // rollback
      const r = rollbackFileSnapshot(
        root,
        a.snapshot === undefined ? undefined : String(a.snapshot),
        typeof a.file === 'string' && a.file ? { file: a.file } : undefined,
      );
      // ★ 回执编排：恢复/删除/未恢复分组（这些是 agent 判"撤回到位没"的机器可判产物），
      //   并把"不可再撤回"这条**不可逆事实**放在真落了盘的回执里（策略前移的第二半）。
      const lines = [r.message];
      if (r.restored.length) lines.push(`  恢复：${r.restored.join(', ')}`);
      if (r.removed.length) lines.push(`  删除：${r.removed.join(', ')}`);
      if (r.failed.length) lines.push(`  ⚠ 未恢复 ${r.failed.length} 个：${r.failed.join(', ')}`);
      if (r.restored.length || r.removed.length) {
        lines.push('★ 回滚本身不留快照 ⇒ 这一步不可再撤回（要留后路请先用 action=list 记下当前快照 id，或用 git）。');
      }
      return { message: lines.join('\n'), data: r };
    }),
  },

  {
    name: 'rules',
    title: 'Rule library (fix → rule): export / apply / check with CI ratchet — single entry',
    description:
      '规则库统一入口（**3 个注册入口收敛为 1 个入口 + action 分派**；三者操作的是**同一个库**，故按「操作对象」聚合成一面）。' +
      '规则 = 一个自包含 `.md`（frontmatter + 说明 + `pattern`/`replace` + 正/反例夹具），' +
      '住在 `<project_dir>/.agent-io/rules/` —— 三个动作操作的是**同一个库**，故按「操作对象」聚合成一面。' +
      'action=export（修复→规则沉淀）：把一次已完成的修复**沉淀成可复跑规则**：给一段 before/after，自动泛化出 pattern/replace ' +
      '并生成夹具，过「验收三关」后才允许落盘。' +
      '这是与 Grit/GritQL 的核心差异：Grit 的规则全靠专家手写，没有"从改动本身长出规则"的机制。' +
      '泛化：before/after 先做行级 diff 取**变化行窗口**（pattern/replace/夹具三者同 scope）；' +
      '两侧都出现的标识符抽象成 `$hole`（保持"同一实参"），只在一侧的保留字面量，关键字/全局对象/属性名不抽象。' +
      '★ 泛化的"度"不靠猜：从最多抽象开始逐级放宽，每级用三关裁决 —— ① 出生回归（pattern 必须能复现这次修复）' +
      '② 反例不命中（修好的代码/阴性样本不得被命中）③ 幂等（对 after 再跑不得再命中）；' +
      '某级通过就采纳（泛化尽量强），全败则退化为**纯字面量**规则并在回执里如实标注降级。' +
      '落盘位置：`<project_dir>/.agent-io/rules/<id>.md`（单文件自包含）。' +
      'action=apply（三态语义）：把规则库批量应用到项目源码 —— ① applied（命中且唯一 ⇒ 按 replace 改写）；' +
      '② todo（命中但歧义 >1 处 ⇒ 在命中处插入 TODO(rule-id) 注释，不失败）；③ clean（无命中 ⇒ 对该文件干净）。' +
      '纪律：**唯一才动**（歧义绝不挑一个改），**不改文件就不报成功**。' +
      'glob 可限定文件（正则，匹配相对路径）；rule_ids 可只跑指定规则。' +
      'action=check（lint + CI 棘轮）：结果与 `<project_dir>/.agent-io/rules/baseline.json` 的存量比对 —— ' +
      '命中数**未增加** ⇒ 通过（哪怕这条规则当下就有一堆存量命中）；出现**新增命中** ⇒ 不通过。' +
      '这样"先启用一条当前就失败的规则"不会炸 CI，而新引入的问题会被立刻拦住。' +
      'update_baseline=true 把当前存量记为基线（修完一批后收紧棘轮）。' +
      '同时跑每条规则的**自身夹具**（正例须命中且改写一致、反例不得命中），夹具不过的规则单独列出（规则本身坏了）。' +
      '★ 安全策略前移（默认值**明写在这里**，不是隐藏知识）：两个**写** action（export / apply）的 dry_run 都默认 `true`' +
      ' —— 只出预览 / 三态计数、**不写盘**；确认后必须**显式**传 dry_run=false 才落盘（apply 落盘走写闸：写前快照 + 索引写穿保鲜）。' +
      '★ check 的 update_baseline=true 会**改写棘轮基线**（收紧后不会自动回退），属不可逆动作 ⇒ 只在修完一批后显式传。',
    inputSchema: {
      action: z
        .enum(['export', 'apply', 'check'])
        .describe('export=从 before/after 萃取规则 | apply=把规则库应用到源码（三态） | check=当 lint 跑（CI 棘轮）'),
      project_dir: z.string().describe('项目根目录（规则库落在 <project_dir>/.agent-io/rules/）'),
      // ── export ──
      id: z.string().optional().describe('export 用：规则 id（同时是文件名）：小写字母/数字/连字符，如 no-console-log'),
      before: z.string().optional().describe('export 用：修复前的代码片段（含足够上下文，用于行级 diff 取变化窗口）'),
      after: z.string().optional().describe('export 用：修复后的代码片段'),
      title: z.string().optional().describe('export 用：规则标题（缺省 = id）'),
      tags: z.array(z.string()).optional().describe('export 用：标签（如 [style, logging]）'),
      level: z.enum(['error', 'warn', 'info']).optional().describe('export 用：严重度（check 用；缺省 warn）'),
      language: z.string().optional().describe('export 用：目标语言（如 typescript / go；缺省自动）'),
      created_from: z.string().optional().describe('export 用：来源描述（追溯用；缺省记当前时间）'),
      // ── apply / check ──
      rule_ids: z.array(z.string()).optional().describe('apply/check 用：只跑这些规则 id（缺省 = 全部）'),
      glob: z.string().optional().describe('apply/check 用：文件过滤（正则，匹配相对路径），如 "src/.*\\.ts$"'),
      max_files: z.number().int().positive().optional().describe('apply/check 用：最多扫描文件数（缺省 5000）'),
      todo: z.boolean().optional().describe('apply 用：命中但歧义时是否插 TODO 注释（缺省 true；false=只如实报告）'),
      update_baseline: z.boolean().optional().describe('check 用：true = 把当前命中存量写为新基线（收紧棘轮）；缺省 false'),
      // ── 写策略（两个写 action 共用） ──
      dry_run: z.boolean().optional().describe('export/apply 用：true（默认）=只算不写盘；false=把通过三关的规则 / applied 的文件落盘'),
    },
    handler: wrapData(async (a) => {
      const action = a.action as 'export' | 'apply' | 'check' | undefined;
      // ★ 前置校验（安全策略前移第一半）：入口与锚点先判。
      //   为什么要它：旧版三个入口都是 `String(a.project_dir)` —— 缺参时 `String(undefined)` 会变成
      //   字符串 `'undefined'`（**看着像合法值**），于是"没传参"表现为"结果莫名其妙"，而 `id='undefined'`
      //   甚至能通过 isLegalRuleId 的全小写字母检查。这里改成缺参**当场报错**（requireStr）。
      if (action !== 'export' && action !== 'apply' && action !== 'check') {
        throw new Error(`缺参数或非法 "action"（可选值：export / apply / check）`);
      }
      const root = requireStr(a, 'project_dir');

      if (action === 'export') {
        const id = requireStr(a, 'id');
        const before = requireStr(a, 'before');
        const after = requireStr(a, 'after');
        if (!isLegalRuleId(id)) {
          throw new Error(`非法规则 id「${id}」：只允许小写字母/数字/连字符，且不以连字符开头或结尾`);
        }
        const r = extractRule({
          before,
          after,
          id,
          title: a.title === undefined ? undefined : String(a.title),
          tags: Array.isArray(a.tags) ? (a.tags as string[]).map(String) : undefined,
          level: a.level as Rule['level'] | undefined,
          language: a.language === undefined ? undefined : String(a.language),
          createdFrom: a.created_from === undefined ? undefined : String(a.created_from),
        });

        const g = r.generalization;
        const lines: string[] = [];
        lines.push(r.validation.ok ? '✅ 三关通过，规则可用' : '❌ 三关未过，规则不可落盘（如实报告，不写盘）');
        lines.push(`  泛化：候选 ${g.candidateHoles} 个标识符 → 实采 ${g.holes.length} 个 $hole` +
          (g.ladderSteps > 0 ? `（放宽了 ${g.ladderSteps} 级）` : '') +
          (g.degraded ? ' ⚠️ 已降级：泛化后过宽，退化为字面量规则' : ''));
        for (const at of g.attempts) {
          lines.push(`    · ${at.holes.length ? at.holes.map((h) => '$' + h).join(' ') : '(字面量)'} → ${at.ok ? '通过' : '未过 ' + at.codes.join(',')}`);
        }
        lines.push(`  pattern:\n${g.pattern.split('\n').map((l) => '    ' + l).join('\n')}`);
        lines.push(`  replace:\n${g.replace.split('\n').map((l) => '    ' + l).join('\n')}`);
        lines.push(`  夹具 ${r.rule.fixtures.length} 条（反例 ${r.rule.fixtures.filter((f) => f.negative !== undefined).length} 条）`);
        if (!r.validation.ok) {
          for (const i of r.validation.issues.filter((x) => x.severity === 'error')) lines.push(`  [${i.code}] ${i.message}`);
        } else {
          for (const i of r.validation.issues) lines.push(`  [warn:${i.code}] ${i.message}`);
        }

        const dry = a.dry_run !== false;
        if (!dry && r.validation.ok) {
          const p = writeRule(root, r.rule);
          lines.push(``, `已落盘：${p}`);
        } else if (!dry && !r.validation.ok) {
          lines.push(``, `dry_run=false 但三关未过 ⇒ **未写盘**（不会把没验证的规则放进库里）。`);
        } else {
          lines.push(``, `（dry_run：未写盘。确认后可传 dry_run=false 落盘）`);
        }
        return {
          message: lines.join('\n'),
          data: { ok: r.validation.ok, written: !dry && r.validation.ok, rule: r.rule, validation: r.validation, generalization: g },
        };
      }

      if (action === 'apply') {
        const { rules, errors } = loadRules(root);
        const want = Array.isArray(a.rule_ids) ? (a.rule_ids as string[]).map(String) : null;
        const use = want ? rules.filter((r) => want.includes(r.id)) : rules;
        if (use.length === 0) {
          return {
            message: `规则库为空或未命中指定规则（库目录：${rulesDir(root)}）` +
              (errors.length ? `\n  读取失败 ${errors.length} 条：${errors.map((e) => e.file + ':' + e.error).join('; ')}` : ''),
            data: { outcomes: [], applied: 0, todo: 0, clean: 0, totalHits: 0 },
          };
        }
        const files = collectRuleTargets(root, { glob: a.glob === undefined ? undefined : String(a.glob), maxFiles: a.max_files as number | undefined });
        const summary = applyRulesToFiles(root, files, use, { todo: a.todo !== false });

        // ★ 夹具自检先行：库里有规则自身的夹具都不过 ⇒ 先别拿它去改代码
        const badFixtures = use.map(runFixtures).filter((x) => !x.passed);

        const dry = a.dry_run !== false;
        const lines: string[] = [];
        lines.push(`规则 ${use.length} 条 × 文件 ${files.length} 个 ⇒ applied ${summary.applied} / todo ${summary.todo} / clean ${summary.clean}（命中 ${summary.totalHits}）`);
        for (const o of summary.outcomes) {
          lines.push(`  [${o.state}] ${o.file} ← ${o.ruleId}（命中 ${o.hits}）${o.todoReason ? '：' + o.todoReason : ''}`);
        }
        if (badFixtures.length > 0) {
          lines.push(``, `⚠️ 有 ${badFixtures.length} 条规则的**自身夹具没过**（先修规则再应用）：`);
          for (const b of badFixtures) for (const f of b.failures) lines.push(`  · ${b.ruleId}: ${f}`);
        }
        if (errors.length) lines.push(``, `⚠️ 规则读取失败 ${errors.length} 条：${errors.map((e) => e.file).join(', ')}`);

        if (!dry) {
          const writes = summary.outcomes.filter(
            (o) => (o.state === 'applied' || o.state === 'todo') && o.after !== undefined && o.before !== o.after,
          );
          // ★ 落盘走共享内核：此前是"动态 import 写闸 + 在 mutate 回调里裸 writeFileSync"——
          //   回调里的 fs 调用即 [C] 自己落盘。[B]（applyRulesToFiles）已算好 before/after，
          //   本层只需把 {file, content} 交给内核（快照一次 + 逐文件写 + 索引写穿）。
          const receipt = await applyWrites(
            root,
            writes.map((o) => ({ file: o.file, content: o.after as string })),
            { note: `rules(apply:${use.map((r) => r.id).join(',')})` },
          );
          lines.push(``, `已写盘 ${receipt.written.length} 个文件（走写闸：写前快照 + 索引写穿保鲜）。`);
        } else {
          lines.push(``, `（dry_run：未写盘。确认后传 dry_run=false 落盘）`);
        }
        return { message: lines.join('\n'), data: { ...summary, dryRun: dry, badFixtures } };
      }

      // ── check ──
      const { rules, errors } = loadRules(root);
      const want = Array.isArray(a.rule_ids) ? (a.rule_ids as string[]).map(String) : null;
      const use = want ? rules.filter((r) => want.includes(r.id)) : rules;

      const fixtureResults = use.map(runFixtures);
      const bad = fixtureResults.filter((x) => !x.passed);

      if (a.update_baseline === true) {
        const files = collectRuleTargets(root, { glob: a.glob === undefined ? undefined : String(a.glob), maxFiles: a.max_files as number | undefined });
        const summary = applyRulesToFiles(root, files, use, { todo: false });
        const bl = writeBaseline(root, summary);
        return {
          message: `已把当前存量写为棘轮基线：${bl.entries.length} 条（规则 ${use.length} 条，命中 ${summary.totalHits} 处）`,
          data: { updated: true, baseline: bl },
        };
      }

      const files = collectRuleTargets(root, { glob: a.glob === undefined ? undefined : String(a.glob), maxFiles: a.max_files as number | undefined });
      const summary = applyRulesToFiles(root, files, use, { todo: false });
      const baseline = loadBaseline(root);
      const added = ratchetDelta(summary, baseline);

      const lines: string[] = [];
      const pass = added.length === 0 && bad.length === 0;
      lines.push(pass ? '✅ 规则检查通过（无新增命中）' : '❌ 规则检查未通过');
      lines.push(`  规则 ${use.length} 条 × 文件 ${files.length} 个 ⇒ 命中 ${summary.totalHits} 处；基线 ${baseline ? baseline.entries.length + ' 条' : '（无，视存量全为新增）'}`);
      if (added.length > 0) {
        lines.push(`  **新增命中 ${added.length} 条**（棘轮不放行）：`);
        for (const d of added) lines.push(`    · ${d.ruleId} @ ${d.file}：当前 ${d.current}，基线 ${d.baseline}，新增 ${d.added}`);
      }
      if (bad.length > 0) {
        lines.push(`  ⚠️ ${bad.length} 条规则**自身夹具不过**（规则坏了，先修规则）：`);
        for (const b of bad) for (const f of b.failures) lines.push(`    · ${b.ruleId}: ${f}`);
      }
      if (!baseline && summary.totalHits > 0) {
        lines.push(``, `提示：无基线时所有存量都被视为新增。存量若为"先启用的规则"，跑一次 update_baseline=true 把它记为基线。`);
      }
      if (errors.length) lines.push(``, `⚠️ 规则读取失败 ${errors.length} 条：${errors.map((e) => e.file).join(', ')}`);
      return {
        message: lines.join('\n'),
        data: { pass, added, baseline: baseline ? baseline.updatedAt : null, totalHits: summary.totalHits, fixtureFailures: bad },
      };
    }),
  },

  {
    name: 'plan_refactor',
    title: 'Compute a reviewable, replayable refactor plan (read-only)',
    description:
      '「先算清单 → 预览 → 批量落盘」的**第一半**（规划书 §16.3 P-C）：**只读**算出一份可审、可复跑、可入账的重构清单，不写任何文件。' +
      '输入 targets=[{file, old_text, new_text}, ...]（与 edit_code 批量同形状，每项 = 文件内一次**唯一**文本替换）；' +
      '输出结构化清单 data：plan_id（内容派生指纹）+ items（每项 file/old/new/**命中级别**/diff 预览）+ files（规划时刻源文件指纹 base_fingerprint 与"全应用后"指纹 post_fingerprint）+ summary（项数/文件数/按命中级别分布）。' +
      '定位与语法门**复用** edit_code 的 replace_text 同一实现（4 级模糊级联：逐字→空白归一→缩进弹性→省略号占位；歧义即报错、绝不猜）。' +
      '纪律（§21）：清单必须**全部可执行**——任一项规划不出来（old_text 不在/歧义/新引入语法错误）⇒ 报错并列全每项原因，不产出半成品；targets 为空 ⇒ 产出**显式空清单**（items=[]）。' +
      '★ 把本品的 data **原样**交给 apply_refactor_plan 落盘（同一份清单 = 同一 plan_id；清单被改动会被指纹检出）。' +
      '与 refactor_pipeline 的分工：pipeline 是"内置步骤自动检测"（dead import/语句/迁移）；本品是"**调用方给定清单**"的算清单入口（无自动检测，只算你要的那批替换）。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（相对路径的锚点）'),
      targets: z
        .array(
          z.object({
            file: z.string().describe('目标文件（相对 project_dir 或绝对路径）'),
            old_text: z.string().describe('要替换的旧文本（在文件内须恰好 1 处命中，否则报歧义）'),
            new_text: z.string().describe('替换后的新文本（传空串=删除该文本）'),
          }),
        )
        .describe('重构目标清单（每项 = 文件内一次唯一文本替换；空数组 ⇒ 显式空清单）'),
    },
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      if (!Array.isArray(a.targets)) throw new Error('缺参数 "targets"（[{file, old_text, new_text}, ...]）');
      const plan = await buildRefactorPlan({ project_dir, targets: a.targets as RefactorTarget[] });
      const lines: string[] = [];
      if (plan.summary.items === 0) {
        lines.push(`[空清单] 没有可执行的替换项（targets 为空）—— plan_id ${plan.plan_id}，未写任何文件。`);
      } else {
        const levels = Object.entries(plan.summary.by_level)
          .sort(([x], [y]) => Number(x) - Number(y))
          .map(([lv, n]) => `L${lv}×${n}`)
          .join(' ');
        lines.push(
          `清单 ${plan.plan_id}：${plan.summary.items} 项 / ${plan.summary.files} 个文件（命中级别 ${levels}）—— 只读，未写任何文件。`,
        );
        for (const it of plan.items) {
          lines.push(
            `  · ${it.file} L${it.hit.start_line}（L${it.hit.level}·${it.hit.label}）${it.hit.old_lines} 行 → ${it.hit.new_lines} 行`,
          );
        }
        lines.push('', '把本回执的 data 原样交给 apply_refactor_plan 落盘（清单被改动会被 plan_id 指纹检出）。');
      }
      return { message: lines.join('\n'), data: plan };
    }),
  },

  {
    name: 'apply_refactor_plan',
    title: 'Apply a refactor plan from plan_refactor (idempotent, fingerprint-checked)',
    description:
      '「先算清单 → 预览 → 批量落盘」的**第二半**（规划书 §16.3 P-C）：按 plan_refactor 的清单落盘（不重算清单、不再要 old_text）。' +
      '**幂等**：先按**文件级指纹**判（当前内容指纹 == 清单里的 post_fingerprint ⇒ 该文件的项全部已应用），再用逐项判——old 仍唯一命中 ⇒ 改；old 已不在而 new 唯一命中 ⇒ 判 already_applied、**不写盘**；两者都不成立 ⇒ failed（源被别处改过，绝不猜）。' +
      '⇒ 同一份清单重复 apply：第二次全部落 already_applied，ok=true / written=false / 文件字节不变。' +
      '**篡改检出**：apply 前重算 plan_id 与声明值比对，不符即报错（改 old/new/顺序/base_fingerprint/增删项都会变）。' +
      '**复用 edit_code(targets[]) 的落地路径**（写闸 + 写前快照 + 索引写穿保鲜 + 逐项回报），不另写一套；落盘走同一批量编排。' +
      'atomic=true ⇒ 任一项失败（含"清单与实际源冲突"与落盘失败）则**整批不落盘**（全成或全不成）；缺省 false = 逐项独立。' +
      '结果 data：{ok, plan_id, written, items[{file,status:applied|already_applied|failed,...}], total, applied, already_applied, failed, atomic}。' +
      '空清单（items=[]）⇒ 合法 no-op（ok=true / written=false）。',
    inputSchema: {
      project_dir: z.string().describe('项目根目录（清单里的相对路径以此为锚点）'),
      plan: refactorPlanSchema.describe('plan_refactor 的 data 原样传入（含 plan_id / items / files / summary）'),
      atomic: z
        .boolean()
        .optional()
        .describe('true ⇒ 任一项失败（含清单与实际源冲突）则整批不落盘（全成或全不成）；缺省 false = 逐项独立'),
    },
    handler: wrapData(async (a) => {
      const project_dir = requireStr(a, 'project_dir');
      const plan = a.plan;
      if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
        throw new Error('缺参数 "plan"（把 plan_refactor 回执的 data 原样传入）');
      }
      const r = await applyRefactorPlan({
        project_dir,
        plan: plan as RefactorPlan,
        atomic: a.atomic === true,
      });
      const lines: string[] = [];
      lines.push(
        `${r.failed === 0 ? '✓' : '⚠'} apply_refactor_plan ${r.plan_id}：${r.total} 项` +
          `（applied ${r.applied} / already_applied ${r.already_applied} / failed ${r.failed}）` +
          `${r.written ? '，已落盘' : '，未写盘'}`,
      );
      for (const it of r.items) {
        if (it.status === 'applied') {
          lines.push(
            `  ✓ ${it.file} L${it.hit?.start_line ?? '?'} 已落盘` +
              `${it.symbol_diff ? `（符号 diff: +${it.symbol_diff.added} -${it.symbol_diff.removed} ~${it.symbol_diff.changed}）` : ''}`,
          );
        } else if (it.status === 'already_applied') {
          lines.push(`  = ${it.file} 已应用（幂等跳过，未写盘）`);
        } else {
          lines.push(`  ✗ ${it.file}：${it.error ?? '未知失败'}`);
        }
      }
      return { message: lines.join('\n'), data: r };
    }),
  },
];
