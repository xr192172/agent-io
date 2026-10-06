/**
 * cross 线（4 个工具）—— ★ **本文件即该线归属的唯一来源**。
 *
 * ★ P1b（2026-09-28）：按当时 `capability_map.LANE_OF` 的归属从 `TOOL_DEFS` 切分而来，
 *   条目**逐字搬移**，只加了 `export const CROSS_TOOLS` 外壳 —— 归属自此由文件路径表达。
 * ★ P1c（2026-09-28）：`capability_map.LANE_OF` 已删除。`server_registry` 的 `LANE_SOURCES` 把本文件
 *   接到线 id `'cross'`，并派生「工具 → 线」归属表注入 capability_map。
 *   ⇒ **把工具挪出本线 = 把它从本数组移到另一条线的数组，一处改动**（不再有第二处要同步）。
 *
 * 为什么能切了：依赖已先行抽到 `registry/{types,plumbing,handlers}.ts`（P1a）——
 *   否则本文件 import 它们就会成环（server_registry → lanes → server_registry）。
 */
import { z } from 'zod';
import { wrap, wrapData, requireStr } from '../plumbing.js';
import path from 'node:path';
import { compareProjects } from '../../infrastructure/analysis/cross_repo/index.js';
import { analyzeHealth } from '../../infrastructure/analysis/health/index.js';
import { detectReachableRoots } from '../../infrastructure/analysis/project_root/index.js';
import { extractGoFromFile } from '../../infrastructure/authoring/translate/go_extractor.js';
import { translateGoTsHandler } from '../../infrastructure/authoring/translate/tool.js';
import type { ToolDef } from '../types.js';

export const CROSS_TOOLS: ToolDef[] = [
  {
    name: 'translate_go_ts',
    title: 'Go→TS 半自动翻译（骨架 + 可选 LLM 填 + 可选行为对拍）',
    description:
      '把 Go 源文件机械生成 TS 骨架 + 验证闸（默认）；fill=true 用 AGNES key 池 LLM 逐孔填函数体（需 AGNES_KEY_POOL 或本地 key-pool-proxy）；verify=true 再对已填的纯函数跑 Go↔TS 行为对拍（需 go 工具链）。跨语言翻译：函数/方法/struct/接口/named 别名/多返回元组/map·slice·指针/泛型/chan(近似)。★ 本工具即原 `translate_cli` 的能力载体（该 CLI 已于 2026-10-06 删除；argv 面由 `cli.js translate_go_ts` 投影提供 —— 下文「原 translate_cli 的 …」是历史对应关系）。',
    inputSchema: {
      file: z.string().optional().describe('Go 源文件路径（绝对或相对 cwd）；与 projectDir 二选一'),
      projectDir: z.string().optional().describe('Go 项目目录：一次翻译整个项目（枚举 .go、跨文件 import、镜像落盘）'),
      outDir: z.string().optional().describe('projectDir 模式下落盘根（镜像 source 结构）'),
      out: z.string().optional().describe('★ 单文件模式的目标 .ts 路径（原 translate_cli 的 --out）：把产出写进该文件。★ 两条规则：目标已存在且未 fill ⇒ **不覆盖**（防止丢弃已填的函数体）；机械骨架验证闸未过 ⇒ **整份不落盘**（原子性，避免半成品）'),
      fill: z.boolean().optional().describe('用 AGNES key 池 LLM 逐孔填函数体'),
      holes: z.boolean().optional().describe('★ 一并返回每个待填孔给 LLM 的 prompt（原 translate_cli 的 --holes），见 data.hole_prompts。★ 与 fill 同一条门：只在 fill=false 时给（fill 时那些 prompt 已被消费）'),
      batchSize: z.number().int().min(1).optional().describe('★ projectDir 模式：一批函数一次 LLM 调用（原 translate_cli 的 --batch-size），默认 5'),
      verify: z.boolean().optional().describe('★ 同名两义（如实写，别只看半句）：**projectDir 模式** = 全工程 tsc 门禁（原 translate_cli 的 --verify）；**单文件模式** = 对已填纯函数跑 Go↔TS 行为对拍（需 go 工具链）'),
      maxRetries: z.number().int().min(0).max(6).optional().describe('LLM 纠错重试次数，默认 2'),
    },
    handler: wrapData(async (a) => translateGoTsHandler(a)),
  },

  {
    name: 'go_originals',
    title: '读取 Go 源文件每个顶层符号的原文片段（ground-truth 即取即读）',
    description:
      '解析单个 Go 源码文件，返回其中每个顶层符号(func/const/var/type)的 Go 原文片段(srcSnippet)与起始行(srcLine)。' +
      '文件级直接解析（复用共享 tree-sitter-go，无需 import_project 建全工程索引）。' +
      '用途：语义修复/评审时拿 Go 原文当 ground truth，不再对着翻译后的 TS 壳猜；可选 symbol 过滤只取指定符号。',
    inputSchema: {
      file: z.string().describe('Go 源文件路径（绝对或相对 cwd）'),
      symbol: z.string().optional().describe('可选：只返回该符号名的原文'),
    },
    handler: wrapData(async (a) => {
      // ★ [C] 只做路由：读文件（含存在性判定）在 [B]（extractGoFromFile），本层不碰文件系统
      const file = a.file ? path.resolve(String(a.file)) : '';
      if (!file) return { message: 'Go 文件不存在: (未提供 file)' };
      const r = await extractGoFromFile(file);
      if (r.missing) return { message: 'Go 文件不存在: ' + file };
      if (r.error) return { message: 'Go 解析失败: ' + r.error };
      let units = r.units ?? [];
      if (a.symbol) { const want = String(a.symbol); units = units.filter((u) => u.name === want); }
      const symbols = units.map((u) => ({ name: u.name, kind: u.kind, line: u.srcLine, snippet: u.srcSnippet }));
      const skipped = (r.skipped ?? []).map((s) => s.name + '[' + s.kind + ']:' + s.reason);
      const msg = '共 ' + symbols.length + ' 个符号' + (skipped.length ? '；跳过 ' + skipped.length + '：' + skipped.join('; ') : '') + (a.symbol ? '（过滤 symbol=' + a.symbol + '）' : '');
      return { message: msg, data: { file, symbols, skipped } };
    }),
  },

  {
    name: 'cross_repo_symbol_index',
    title: 'Cross-repo symbol index - two-project conflict & migration scope',
    description:
      '跨项目符号索引（杂交前"会不会撞名"）：对两个项目根各建顶层符号集合，再求交/求差。' +
      '①冲突清单（同名不同签 = 真冲突，杂交前需改名/错位，附两侧定义文件与签名）；' +
      '②双胞胎（同名同签 = 语义重复，可去重一个）；' +
      '③迁移范围 aOnly/bOnly（只在一方的顶层符号 = 搬到对侧不撞名的安全候选）。' +
      '是 rename_symbol / package_migration / impact_analysis 跨项目版与跨项目符号层的地基。' +
      '顶层符号 = 所有模块级符号（未显式 export 的也计入，保守超集）。',
    inputSchema: {
      project_dir_a: z.string().describe('项目 A 根目录（绝对路径）'),
      project_dir_b: z.string().describe('项目 B 根目录（绝对路径）'),
    },
    handler: wrapData(async (a) => {
      const r = await compareProjects(requireStr(a, 'project_dir_a'), requireStr(a, 'project_dir_b'));
      const fmtSym = (defs: Array<{ file: string; signature: string }>) => defs.map((d) => `${d.file}  ${d.signature}`).join(' ; ');
      const lines = [
        `跨项目符号索引 · ${r.aRoot} ↔ ${r.bRoot}`,
        `A：${r.aFiles} 文件 / ${r.aSymbols} 顶层符号     B：${r.bFiles} 文件 / ${r.bSymbols} 顶层符号`,
        '',
        `■ 冲突 ${r.conflicts.length}（同名不同签，杂交前需改名/错位）`,
      ];
      for (const c of r.conflicts) {
        lines.push(`  ! ${c.name}`, `      A: ${fmtSym(c.a)}`, `      B: ${fmtSym(c.b)}`);
      }
      if (r.conflicts.length === 0) lines.push('  （无）');
      lines.push('', `■ 双胞胎 ${r.duplicates.length}（同名同签，可去重一个）`);
      for (const c of r.duplicates) lines.push(`  = ${c.name}   A: ${c.a[0].file} ↔ B: ${c.b[0].file}`);
      if (r.duplicates.length === 0) lines.push('  （无）');
      lines.push('', `■ 迁移范围：A→B 候选 ${r.aOnly.length} 个`);
      if (r.aOnly.length > 0) lines.push(`  ${r.aOnly.join(', ')}`);
      lines.push('', `■ 迁移范围：B→A 候选 ${r.bOnly.length} 个`);
      if (r.bOnly.length > 0) lines.push(`  ${r.bOnly.join(', ')}`);
      return { message: lines.join('\n'), data: r };
    }),
  },

  {
    name: 'code_health',
    title: 'Code health - dead code / complexity / layer violation',
    description:
      '代码健康度（选材体检）：对 project_dir 全项目做三层体检，输出健康分 + 问题清单。' +
      '三维度：①死代码——未使用导出（复用调用边/类型引用边反查，外部消费者不可见一律标 info 不自动删）、' +
      '未使用 import（TS/JS/Python/Java 命名导入）、孤儿文件（无任何项目内消费者的非胶水文件）；' +
      '②复杂度——顶层函数/方法圈复杂度启发式（剥注释后数分支，默认阈值 10，超阈值标 warn）；' +
      '③分层违规——依赖方向向上（契约→积木/胶水、积木→胶水）标 error。' +
      '守护"积木/契约/胶水"三分层哲学，是项目杂交选材的评分依据。' +
      '输出：score(0-100)/grade(A-D，0 个源文件时为 N/A)/summary + issues 逐条(file/line/symbol/message/evidence) + complexity Top 清单。',
    inputSchema: {
      project_dir: z.string().describe('目标项目根目录（绝对路径）'),
      complexity_threshold: z.number().int().optional().describe('圈复杂度阈值（默认 10）'),
      top: z.number().int().optional().describe('复杂度清单最多列多少个（默认 10）'),
    },
    handler: wrapData(async (a) => {
      const root = requireStr(a, 'project_dir');
      const r = await analyzeHealth(root, {
        complexityThreshold: a.complexity_threshold == null ? undefined : Number(a.complexity_threshold),
        top: a.top == null ? undefined : Number(a.top),
        // P0-②：入口文件（package.json 的 bin / main / `node <路径>` script）喂给分析器，
        // 否则它们会被当成无人消费的 dead code + "积木依赖胶水"（实测本仓 2 条假阳）。
        reachableRoots: detectReachableRoots(root).roots,
      });
      const sevMark: Record<string, string> = { error: '✗', warn: '!', info: '·' };
      const lines = [
        `代码健康度 · ${r.root}`,
        `${r.fileCount} 个文件 → 健康分 ${r.score}（${r.grade}）`,
        `分层（四层，按目录）: domain ${r.layers.domain} / infrastructure ${r.layers.infrastructure} / application ${r.layers.application} / presentation ${r.layers.presentation}` +
          `　｜四层外(不判层) ${r.layers.outside}｜违规 ${r.layers.violations}`,
        `循环依赖: ${r.counts.circular_dependency}`,
        r.summary,
        '',
        '—— 问题清单 ——',
      ];
      if (r.issues.length === 0) lines.push('（无问题）');
      for (const i of r.issues) {
        const loc = `${i.file}${i.line ? `:${i.line}` : ''}${i.symbol ? ` ${i.symbol}` : ''}`;
        lines.push(`${sevMark[i.severity]} [${i.kind}] ${loc}`);
        lines.push(`      ${i.message}`);
      }
      if (r.complexity.length > 0) {
        lines.push('', `—— 最高复杂度 Top ${r.complexity.length} ——`);
        for (const c of r.complexity) lines.push(`  ${c.complexity}  ${c.file}:${c.line}  ${c.symbol}`);
      }
      return { message: lines.join('\n'), data: r };
    }),
  },
];
