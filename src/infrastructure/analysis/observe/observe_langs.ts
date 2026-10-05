/**
 * observe_langs —— **观察侧的语言包缝**（2026-10-05 立）
 *
 * ★ 为什么立这道缝（这是「go-observe 与 TS 版 observe 合一化」的第一步，也是唯一能解死结的那一步）：
 *   此前 `observe_instrument` 的语言分派是 handler 里一个**硬编码的 `if (isGoProject(target))`**，
 *   两门语言各写一段 ~35 行、**结构逐字相同**的报告渲染（`✗ file error` / `+ file N 探针点` /
 *   `完成：a 新插桩 / b 跳过 / c 失败，共 d 探针点`）—— 想加第三门语言就得把这两段再抄一遍。
 *   ⇒ 语言包把这道缝变成注册表：**加语言 = 注册一个包**，handler 只做路由与渲染。
 *
 * ★★ 形状**刻意照抄** `infrastructure/analysis/refactor/refactor_langs.ts` 的
 *   `LanguageRefactorExecutor` + `RefactorLangRegistry`（本仓既有的多语言模式，2026-09-28 起在用）
 *   —— 不新造第二套多语言约定。差别只有一处且是必需的：refactor 侧各语言实现同构（都产出
 *   `RunningChangePlan`），而 observe 侧 **Go 必须越界到外部进程**（`go/ast` 解析 Go 语法，
 *   本进程做不到）⇒ 这里多一个 `inProcess` 与一份**统一的报告形状**，让一份渲染管两门。
 *
 * ─────────────────────────────────────────────────────────────
 * 合一化的边界（本文件存在的理由，也是它的判断依据；2026-10-05 逐符号清点）
 * ─────────────────────────────────────────────────────────────
 *   **Go 独有、TS 架构上做不到 ⇒ 必须留**
 *     · Go 源码 AST 插桩（`go/ast` + Go 编译期合法性规则：missing-return、`<-ch` 不可二次求值…）
 *     · 编译进**被测 Go 进程内**的采集 runtime（环形缓冲 + 容量轮转 + 每探针限速 + 分级指标 +
 *       黑匣子）—— 必须与被测代码同一编译单元
 *     · `context.Context` 传播的 trace 三元组（Go 惯用法）
 *
 *   **两边重复且已漂移 ⇒ 合一化的目标**
 *     · `SilentErrorDiscard` —— **3 份**（Go 1 + TS 2），`benign` 严格性已漂移
 *       （Go 严格 `== true`；TS `judge.ts:38` 真值即算）
 *     · 链重建 `RebuildChains` / `isSubsequence` / `matchChainDecl` / 预算 512·4096·128 —— 2 份
 *     · `Comparator` 三段对比 + `DeviationKind` 四态 + 报告渲染 —— 2 份，且**语义已分叉**
 *       （TS 跳过链路声明、Go 不跳；TS 把链路探针算已覆盖、Go 会误报 undesigned）
 *
 *   ⇒ **「合一」的正确形状不是二选一，而是：判定层合一（一份）、插桩层按语言分包。**
 *     这正是本文件的形状：`ObserveLangPack` 只包**插桩与还原**；
 *     判定（judge / chain / comparator）**与语言无关**，留在 `judge.ts` / `chain.ts` / `contract.ts`，
 *     后续把 Go 那份删掉、只留一份权威。
 */

import type { VerifyCommand } from '../../verify_refactor.js';
import { dirHasSource, manifestPresent } from '../refactor/refactor_langs.js';
import {
  buildProbeLedger,
  clearProbeLedger,
  collectTsFiles,
  instrumentProject,
  ledgerSummary,
  restoreInstrumented,
  saveProbeLedger,
  type InstrumentFileResult,
} from './instrument.js';
import {
  checkGoObserveDeps,
  instrumentGoProject,
  isGoProject,
  restoreGoProject,
  type GoInstrumentOptions,
} from './go_instrument.js';

// ─────────────────────────────────────────────────────────────
// 统一形状（两门语言都落到这里 ⇒ handler 一份渲染管两门）
// ─────────────────────────────────────────────────────────────

/** 一个探针点。TS 侧叫 `InstrumentedSite`、Go 侧叫 `GoSite`，字段同构，在此归一。 */
export interface ObserveSite {
  line: number;
  kind: string;
  level: string;
  probe: string;
}

export interface ObserveFileResult {
  file: string;
  sites: ObserveSite[];
  error?: string;
}

/** 插桩结果（统一形状）。`ledger` 只有 TS/JS 包会填（Go 侧无此概念）。 */
export interface ObserveInstrumentReport {
  lang: string;
  dryRun: boolean;
  files: ObserveFileResult[];
  /** 参与扫描的文件数（★ 与 `files.length` 不等：Go 侧报"多少个 .go 进入扫描"） */
  scanned: number;
  /** 该语言的运行前提（Go 需要 go.mod 接 module；TS 不需要 ⇒ 省略） */
  preflight?: string;
  /** 探针台账（仅 TS/JS：写盘成功后记账） */
  ledger?: { file: string; summary: string; raw: unknown };
}

export interface ObserveUninstrumentReport {
  lang: string;
  restored: number;
  restoredFiles: string[];
  ledgerCleared: boolean;
  note?: string;
}

// ─────────────────────────────────────────────────────────────
// 语言包
// ─────────────────────────────────────────────────────────────

/** 一门语言的插桩包（"新语言新包"） */
export interface ObserveLangPack {
  /** 语言 id（注册唯一 key） */
  lang: string;
  /** 人类可读名（报告用） */
  label: string;
  /** 命中该语言源文件的判定（注册表据此挑包） */
  isSourceFile(rel: string): boolean;
  /**
   * 本进程能否直接插桩。
   * ★ `false` ⇒ 必须调外部工具链（当前只有 Go）。这个标志的意义是**如实标注边界**，
   *   不是"暂不支持"—— 边界原因见 {@link limitations}。
   */
  inProcess: boolean;
  instrument(root: string, opts: ObserveInstrumentOptions): Promise<ObserveInstrumentReport>;
  uninstrument(root: string): Promise<ObserveUninstrumentReport>;
  /** 该语言暴露的保守规则（写进报告 / 供人审；照抄 `RefactorStageExecutor.limitations` 的做法） */
  limitations: string[];
  /** 该项目形态的验证命令组；缺省 = 不可自动验证 */
  detectVerifyCommands?(cwd: string): VerifyCommand[];
  /** 该项目形态的 manifest 文件名（相对项目根） */
  manifestFiles?: string[];
}

export interface ObserveInstrumentOptions {
  dryRun: boolean;
  projectRoot?: string;
  /** 契约模式：只注入声明的探针点；缺省/空数组 = 探索模式全量插桩 */
  contractProbes?: string[];
  scope?: boolean;
  deep?: boolean;
  effects?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 共享渲染（★ 从 handler 搬出来的**唯一一份** —— 此前那里有两份逐字相同的）
// ─────────────────────────────────────────────────────────────

/** 插桩报告渲染。 */
export function renderInstrumentReport(
  rep: ObserveInstrumentReport,
  opts: { target: string; contractProbes?: string[] },
): string[] {
  const mode = opts.contractProbes ? `契约模式（${opts.contractProbes.length} 个探针）` : '探索模式（全量插桩）';
  const lines = [
    `Observe 插桩 [${mode}] ${rep.dryRun ? 'DRY-RUN' : 'WRITE'} → ${opts.target}`,
    `  语言包：${rep.lang} · 扫描 ${rep.scanned} 个源文件`,
  ];
  let totalSites = 0;
  let instrumented = 0;
  let skipped = 0;
  let errors = 0;
  for (const r of rep.files) {
    if (r.error) {
      errors++;
      lines.push(`  ✗ ${r.file}  ${r.error}`);
    } else if (r.sites.length > 0) {
      instrumented++;
      totalSites += r.sites.length;
      lines.push(`  + ${r.file}  ${rep.dryRun ? '将注入' : '注入'} ${r.sites.length} 探针点`);
    } else {
      skipped++;
    }
  }
  lines.push(`  完成：${instrumented} 新插桩 / ${skipped} 已含探针跳过 / ${errors} 失败，共 ${totalSites} 探针点`);
  if (rep.dryRun) {
    lines.push(
      rep.lang === 'go'
        ? '  DRY-RUN 未写盘。传 dry_run=false 实际改写源码（备份在 .agent-io/observe-backup，随时可还原）。'
        : '  DRY-RUN 未写盘。传 dry_run=false 实际改写源码（git 可兜底，幂等）。',
    );
  }
  if (rep.preflight) lines.push(`  运行前提：${rep.preflight}`);
  if (rep.ledger) {
    lines.push(`  探针台账已记账 → ${rep.ledger.file}`);
    lines.push(`  统计：${rep.ledger.summary}`);
  }
  return lines;
}

/** 还原报告渲染（同样从 handler 搬出来的唯一一份）。 */
export function renderUninstrumentReport(rep: ObserveUninstrumentReport): string {
  if (rep.restored === 0 && !rep.ledgerCleared) {
    return `Observe 一键全拔（${rep.lang}）：未找到备份与台账，无需还原（可能从未插桩，或备份已删）。`;
  }
  const tail = rep.ledgerCleared ? '，已清理探针台账' : '';
  const files = rep.restoredFiles.length ? `\n` + rep.restoredFiles.map((f) => `  ↺ ${f}`).join('\n') : '';
  return (
    `Observe 一键全拔（${rep.lang}）：已还原 ${rep.restored} 个文件并删除备份目录${tail}。${files}` +
    (rep.note ? `\n  提示：${rep.note}` : '')
  );
}

const TS_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.jsx']);

function extOf(rel: string): string {
  const i = rel.lastIndexOf('.');
  return i < 0 ? '' : rel.slice(i).toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// 两个包
// ─────────────────────────────────────────────────────────────

/** TS/JS 包：本进程直接插桩（`ts_kernel` AST），写盘后记探针台账。 */
export const tsJsObservePack: ObserveLangPack = {
  lang: 'ts_js',
  label: 'TypeScript / JavaScript',
  isSourceFile: (rel) => TS_EXT.has(extOf(rel)),
  inProcess: true,
  limitations: [
    '只改 AST 可安全定位的位点；依赖运行时值的判断（如「参数是否真被读到」）插桩不到。',
    '备份靠 git 兜底（幂等标记在文件头）⇒ dry_run=false 之前应确保工作区已提交。',
  ],
  manifestFiles: ['package.json'],
  async instrument(root, opts) {
    const scanned = collectTsFiles(root);
    const results: InstrumentFileResult[] = await instrumentProject(root, {
      projectRoot: opts.projectRoot,
      write: !opts.dryRun,
      contractProbes: opts.contractProbes,
      scope: opts.scope,
    });
    const rep: ObserveInstrumentReport = {
      lang: 'ts_js',
      dryRun: opts.dryRun,
      scanned: scanned.length,
      files: results.map((r) => ({
        file: r.file,
        sites: r.sites.map((s) => ({ line: s.line, kind: s.kind, level: s.level, probe: s.probe })),
        error: r.error,
      })),
    };
    const total = rep.files.reduce((n, f) => n + (f.error ? 0 : f.sites.length), 0);
    if (!opts.dryRun && total > 0) {
      const ledger = buildProbeLedger(results, root);
      rep.ledger = { file: saveProbeLedger(root, ledger), summary: ledgerSummary(ledger), raw: ledger };
    }
    return rep;
  },
  async uninstrument(root) {
    const restored = restoreInstrumented(root);
    const cleared = clearProbeLedger(root);
    return { lang: 'ts_js', restored: restored.length, restoredFiles: restored, ledgerCleared: cleared };
  },
};

/** Go 包：★ `inProcess: false` —— 必须 `go run ./cmd/instrument`（Go 语法本进程解析不了）。 */
export const goObservePack: ObserveLangPack = {
  lang: 'go',
  label: 'Go',
  isSourceFile: (rel) => rel.endsWith('.go'),
  inProcess: false,
  limitations: [
    '需要 Go 工具链（`go run ./cmd/instrument`）；缺 Go 时**响亮失败**，不是静默跳过。',
    '被插桩工程须在 go.mod 接 go-observe（replace 到本仓路径），否则插桩后编译不过 —— 报告的「运行前提」段会提示。',
  ],
  manifestFiles: ['go.mod'],
  async instrument(root, opts) {
    const out = await instrumentGoProject(root, {
      dryRun: opts.dryRun,
      deep: opts.deep,
      effects: opts.effects,
      contractProbes: opts.contractProbes,
    } as GoInstrumentOptions);
    const deps = checkGoObserveDeps(root);
    return {
      lang: 'go',
      dryRun: opts.dryRun,
      scanned: out.files.length,
      files: out.files.map((f) => ({ file: f.file, sites: f.sites, error: f.error })),
      preflight:
        deps.needs_replace || deps.needs_require
          ? `工程尚未接 go-observe。可在 go.mod 补：\n       ${deps.require_line}\n       ${deps.replace_line}`
          : deps.note,
    };
  },
  async uninstrument(root) {
    const restored = await restoreGoProject(root);
    return {
      lang: 'go',
      restored,
      restoredFiles: [],
      ledgerCleared: false,
      note: '被插桩工程内对 go-observe 的 replace/require 需自行清理（本操作不触碰 go.mod）。',
    };
  },
};

// ─────────────────────────────────────────────────────────────
// 注册表（照 RefactorLangRegistry 的形状）
// ─────────────────────────────────────────────────────────────

export class ObserveLangRegistry {
  private m = new Map<string, ObserveLangPack>();

  register(pack: ObserveLangPack): void {
    this.m.set(pack.lang, pack);
  }

  list(): ObserveLangPack[] {
    return [...this.m.values()].sort((a, b) => (a.lang < b.lang ? -1 : 1));
  }

  /**
   * 挑该项目的语言包。★ 判据**manifest 优先**（照 `refactor_langs` 的 `manifestPresent`），
   *   判不出再退到"目录里有没有该语言的源文件"（复用它的 `dirHasSource`，不自己写 walker）。
   *   理由：多语言项目里"有 .go 文件"不代表 Go 是主语言 —— `refactor_langs` 头注已论证过同一件事。
   */
  pick(root: string): ObserveLangPack | null {
    for (const p of this.m.values()) {
      if (p.manifestFiles?.length && manifestPresent(root, p.manifestFiles)) return p;
    }
    for (const p of this.m.values()) {
      if (dirHasSource(root, p.isSourceFile)) return p;
    }
    return null;
  }

  /** 该项目**能**插桩的语言包（多语言项目里可能不止一种，如 node 后端 + go 工具） */
  pickAll(root: string): ObserveLangPack[] {
    return this.list().filter((p) => manifestPresent(root, p.manifestFiles ?? []) || dirHasSource(root, p.isSourceFile));
  }
}

/** 唯一注册表（模块级单值，照 tool_registry / RefactorLangRegistry 的既有做法）。 */
export const observeLangs = new ObserveLangRegistry();
observeLangs.register(tsJsObservePack);
observeLangs.register(goObservePack);
