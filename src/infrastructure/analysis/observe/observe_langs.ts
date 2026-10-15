/**
 * observe_langs —— **观察侧的语言包缝**（2026-10-05 立）
 *
 * ★ 为什么立这道缝（这是「Go 语言包与 TS 侧 observe 合一化」的第一步，也是唯一能解死结的那一步）：
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
  isInstrumentableTsJsFile,
  ledgerSummary,
  restoreInstrumented,
  saveProbeLedger,
  type InstrumentedSite,
  type InstrumentFileResult,
} from './instrument.js';
import {
  instrumentGoProject,
  isGoProject,
  readGoModuleName,
  restoreGoProject,
  VENDORED_PROBE_DIR,
  type GoInstrumentOptions,
} from './go_instrument.js';
// ★★★ 2026-10-15：**第 3 门语言（Python）** —— 语言包住在 `instrument_py.ts`，走**同一套骨架**
//   （`instrument_skeleton.ts` 的 `instrumentFileWithHooks`）⇒ 这里只注册、不复制主流程。
import { collectPyFiles, instrumentPyProject, isInstrumentablePyFile } from './instrument_py.js';
// ★★★ 2026-10-15：**第 4 门语言（Java）** —— 整份由 `npm run new-observe-lang java …` 生成的**填空题**填出来
//   （只填 ①命名 / ②遍历 / ⑥取值 / ⑦引用方式 / probeCall + 小抄数据）⇒ 走**同一套骨架**。
import { collectJavaFiles, instrumentJavaProject, isInstrumentableJavaFile } from './instrument_java.js';

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
  /**
   * ★ T269（2026-10-14）：本次是否走了 **scope 模式**（`try/finally` 包裹 + `globalThis.__probeScope`）。
   * ★ 为什么回执需要它：两种模式**接线方式不同** ——
   *   点探针模式要 `setGlobalProbeSink(...)`；scope 模式要挂 `globalThis.__probeScope`。
   *   ★ 实测病：回执原先**恒只印点探针那套** ⇒ 照它做，scope 模式的 enter/exit 全走
   *   `?.enter ?? (()=>{})` **静默 no-op** ⇒ **零事件**（用户以为插好了）。
   */
  scope?: boolean;
  /**
   * ★ 语言包自带的「探针就位 ≠ 有事件」接法提示（缺省用 TS 侧的通用文案）。
   * 为什么要有：接线方式**每语言不同**（TS `setGlobalProbeSink` / Python `set_global_probe_sink` /
   * scope 模式 `globalThis.__probeScope`）—— 恒印 TS 那套会把 Python 用户引到一条死路。
   */
  sinkHint?: string[];
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
  /** 该语言「探针就位 ≠ 有事件」的**接法提示**（每语言接线方式不同 —— 见报告渲染）。 */
  sinkHint?: string[];
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
  // ★★★ T266（2026-10-14）：**探针就位 ≠ 有事件** —— `captureProbe` 在**没有 sink** 时是 **no-op**
  //   （`probe.ts:40 hasGlobalProbeSink()` 为 false 就直接返回）。
  //   ★ 实测病：插完桩直接跑 ⇒ **零事件、也不报错** ⇒ 调用方以为"插完就有数据"，实际什么都没观测。
  //   ⇒ 这里【显式说出来】+ 给出**准确**的接法（导出名以 `probe.ts` 真实导出为准：
  //     `setGlobalProbeSink` / `TSProbeCapture`；★ 不要写不存在的 `enableObserveFromEnv`）。
  if (!rep.dryRun && totalSites > 0) {
    if (rep.sinkHint) {
      // ★ 语言包自带接法（每语言接线方式不同 —— 见 ObserveInstrumentReport.sinkHint）
      for (const l of rep.sinkHint) lines.push(l);
    } else if (rep.scope) {
      // ★★★ T269（2026-10-14）：**scope 模式的接线方式与点探针不同** ——
      //   scope 走 `globalThis.__probeScope`（且**不注入** import），点探针走 `captureProbe` + sink。
      //   ★ 实测病：回执原先**恒只印点探针那套** ⇒ 照做 ⇒ scope 的 enter/exit 全走
      //   `?.enter ?? (()=>{})` **静默 no-op** ⇒ **零事件**（用户以为插好了）。
      lines.push(`  ★ scope 模式：探针已就位，但【默认不出事件】—— 它走 globalThis.__probeScope，需要你挂上：`);
      lines.push(`      import { enterScope, exitScope, catchScope, setGlobalProbeSink, TSProbeCapture } from '<本行注入的那个 probe.js 相对路径>';`);
      lines.push(`      (globalThis as any).__probeScope = { enter: enterScope, exit: exitScope, catch: catchScope };`);
      lines.push(`      setGlobalProbeSink(new TSProbeCapture('<events.jsonl 路径>'));`);
      lines.push(`      （不挂 __probeScope ⇒ 所有 enter/exit/catch 走 \`?.enter ?? (()=>{})\` 静默 no-op ⇒ 零事件。）`);
    } else {
      lines.push(
        `  ★ 探针已就位，但【默认不出事件】：无 sink 时 captureProbe 是 no-op。`,
      );
      lines.push(
        `    ⇒ 要真观测，被测项目须在入口处接一次 sink：`,
      );
      lines.push(
        `      import { setGlobalProbeSink, TSProbeCapture } from '<本行注入的那个 probe.js 相对路径>';`,
      );
      lines.push(
        `      setGlobalProbeSink(new TSProbeCapture('<events.jsonl 路径>'));`,
      );
      lines.push(
        `      （接完再跑，事件才会写进 events.jsonl；否则插了也观测不到。）`,
      );
    }
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

// ─────────────────────────────────────────────────────────────
// 两个包
// ─────────────────────────────────────────────────────────────

/** TS/JS 包：本进程直接插桩（`ts_kernel` AST），写盘后记探针台账。 */
export const tsJsObservePack: ObserveLangPack = {
  lang: 'ts_js',
  label: 'TypeScript / JavaScript',
  // ★★★ T302（2026-10-15）：**「收哪些文件」只住一处** —— 原先这里有一份 8 扩展名的 `TS_EXT`
  //   （`observe_langs.ts`），而 `collectTsFiles` 另写死 `endsWith('.ts')` ⇒ 同一件事住两处且不一致。
  //   ⇒ 现在两处都走 `instrument.ts` 的 `isInstrumentableTsJsFile`（其扩展名/产物判据取自
  //     `parse/source_exts.ts` 那份「什么算源码」的唯一权威）。
  isSourceFile: (rel) => isInstrumentableTsJsFile(rel),
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
      scope: opts.scope === true,
      scanned: scanned.length,
      files: results.map((r) => ({
        file: r.file,
        sites: r.sites.map((s) => ({ line: s.line, kind: s.kind, level: s.level, probe: s.probe })),
        error: r.error,
      })),
    };
    const total = rep.files.reduce((n, f) => n + (f.error ? 0 : f.sites.length), 0);
    if (!opts.dryRun && total > 0) {
      // ★ T304：契约模式标记进台账 —— 判据③（零探针文件）在契约模式下跳过（避免假阳性）。
      const ledger = buildProbeLedger(results, root, { contractMode: opts.contractProbes !== undefined });
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
    // ★★★ T294（2026-10-14）：**删掉那句过时的**「被插桩工程须在 go.mod 接 observe-lang-go 语言包
    //   （replace 到本仓路径），否则插桩后编译不过」—— T268 已把机制改成"探针包**拷进**被测工程
    //   `internal/camprobe/`" ⇒ **被测工程零构建配置改动**。★ 上次改 description 时漏了这里
    //   （同一份过时知识住了两处 ⇒ 只改一处必漏另一处 —— 本仓头号病的又一例）。
    '探针包会**拷进**被测工程的 `internal/camprobe/`，注入的 import 指向它 ⇒ **被测工程的 go.mod 无需任何改动**；`uninstrument` 会连该目录一起删。',
  ],
  manifestFiles: ['go.mod'],
  // ★★★ T319（2026-10-15）：**Go 侧原先没有 sinkHint** ⇒ 掉进 renderer 的 else 分支，
  //   被印上**TS 专用的接法**（`import { setGlobalProbeSink, TSProbeCapture } from '…'`）——
  //   `import` 在 Go 里不是这个语法，照抄必错。★ 这正是 T269 那句警告的翻版：
  //   「恒印 TS 那套会把用户引到一条死路」（Python 已经单独立过一条，Go 漏了）。
  sinkHint: [
    '  ★ 探针已就位，但【默认不出事件】：Go 侧没接 sink 时 camprobe.Capture 是 no-op。',
    '    ⇒ 要真观测，被测项目须在入口处接一次 sink（Go 语法，注意下面第 2 行的**别名**）：',
    '      import camprobe "<你的 module 名>/internal/camprobe"   // ★ 必须起别名，见下',
    '      s, err := camprobe.NewSink("events.jsonl"); if err != nil { log.Fatal(err) }',
    '      camprobe.SetGlobalSink(s); defer s.Close()',
    '  ★★ 为什么**必须写别名** `camprobe "…"`：探针拷进来落在 `internal/camprobe/` 目录，',
    '     但目录里的文件声明的是 `package probe` ⇒ 目录名 ≠ 包名。',
    '     不写别名会报一个很误导的错："…/internal/camprobe" imported as probe and not used。',
    '     （本仓插桩器自己在注入端就是 `import camprobe "<module>/internal/camprobe"`。）',
  ],
  async instrument(root, opts) {
    const out = await instrumentGoProject(root, {
      dryRun: opts.dryRun,
      deep: opts.deep,
      effects: opts.effects,
      contractProbes: opts.contractProbes,
    } as GoInstrumentOptions);
    // ★★★ T268（2026-10-14）：**不再要求被测工程改 go.mod** ——
    //   探针包现在随插桩**拷进被测工程**（`internal/camprobe/`），注入的 import 指向它
    //   ⇒ 被测工程的 `go.mod` **一字不改**，换机器 / 换目录 / 换盘符都不会失效。
    //   （旧行为：要求在 go.mod 补 `require` + 一条指向 agent-io **本机绝对路径**的 `replace`
    //    —— 换机器即废，而且会被提交进**被测项目**的受版本管理文件。）
    const moduleName = readGoModuleName(root);
    const rep: ObserveInstrumentReport = {
      lang: 'go',
      dryRun: opts.dryRun,
      scanned: out.files.length,
      files: out.files.map((f) => ({ file: f.file, sites: f.sites, error: f.error })),
      preflight: moduleName
        ? `探针包随插桩拷入被测工程（${VENDORED_PROBE_DIR}/），注入的 import 为 ` +
          `"${moduleName}/${VENDORED_PROBE_DIR}" ⇒ **被测工程的 go.mod 不需要任何改动**` +
          `（uninstrument 会连该目录一起删）。`
        : `★ 被测工程读不到 go.mod 的 module 名 ⇒ Go 侧插桩要求它是一个 Go module。`,
    };
    // ★★★ T294（2026-10-14）：**Go 侧也产出探针台账** —— 原先这里**不填 `ledger`**
    //   ⇒ Go 从不写 `.agent-io/observe-ledger.json` ⇒ `action=lint`（今天新加的量具）
    //     在 Go 上**恒为「未找到台账」** ⇒ ★★ **量具空转**：它专门要抓的"漏插 / 撞名"
    //     （T292/T293 已修；T295 多 `init()` 撞名、T297 方法名丢接收者**仍在**）**一个都抓不到**。
    //   ⇒ 复用 TS 侧**同一份** `buildProbeLedger`（判据只住一处，不许再写第二份）。
    //     Go 的 site 形状少 `file`/`injected` ⇒ 在这里补齐（`file` 取自所属文件）。
    if (!opts.dryRun) {
      const asFiles: InstrumentFileResult[] = rep.files.map((f) => ({
        file: f.file,
        sites: f.sites.map((s) => ({
          file: f.file,
          line: s.line,
          kind: s.kind as InstrumentedSite['kind'],
          level: s.level as InstrumentedSite['level'],
          probe: s.probe,
          injected: '',
        })),
      }));
      const ledger = buildProbeLedger(asFiles, root, { contractMode: opts.contractProbes !== undefined });
      if (ledger.sites.length > 0) {
        rep.ledger = { file: saveProbeLedger(root, ledger), summary: ledgerSummary(ledger), raw: ledger };
      }
    }
    return rep;
  },
  async uninstrument(root) {
    const restored = await restoreGoProject(root);
    return {
      lang: 'go',
      restored,
      restoredFiles: [],
      ledgerCleared: false,
      // ★ T268（2026-10-14）：旧文案是「对 observe-lang-go 的 replace/require 需自行清理」
      //   —— 那是**改 go.mod 那套老路**的话。现在探针包是**拷进来的**（`internal/camprobe/`），
      //   `uninstrument` 已把它一并删掉，而 `go.mod` **本来就一字未动** ⇒ **没有任何要清理的**。
      note: `拷入的探针包（${VENDORED_PROBE_DIR}/）已一并删除；go.mod 本就未被改动 ⇒ 无需清理。`,
    };
  },
};

/**
 * ★★★ **Python 包（第 3 门语言）** —— 2026-10-15 加，用来证明「骨架够通用」。
 *
 * ## 它凭什么这么小
 * 插桩主流程（读盘/幂等/解析/数函数/算根/③应用模型/补头/备份/写盘）全在**骨架**
 * （`instrument_skeleton.ts` 的 `instrumentFileWithHooks`）⇒ 本包只提供**语言钩子**
 * （`instrument_py.ts` 的 `pyInstrumentHooks`：①命名 / ②遍历 / ⑥取值）+ 收文件 + 渲染报告。
 * ★ 对照：TS 侧插桩实现 1257 行、Go 侧 1165 行（它们把主流程也写在了语言实现里）。
 */
export const pyObservePack: ObserveLangPack = {
  lang: 'python',
  label: 'Python',
  isSourceFile: (rel) => isInstrumentablePyFile(rel),
  inProcess: true,
  limitations: [
    '只改 AST 可安全定位的位点；Python 靠**缩进**注入，单行 suite（`def f(): return 1`）退回 `;` 分隔。',
    '`lambda` 体是**表达式**（语法不允许语句）⇒ 包成 `cam_lambda(...)`；`yield` 本身不单独观测（生成器仍录 enter/exit）。',
    'scope 模式（try/finally 调用树录制）**Python 侧未实现**（传 scope 不生效）。',
    '备份靠 `.agent-io/observe-backup`（与 TS 侧同一套，uninstrument 可逐字还原）。',
  ],
  manifestFiles: ['pyproject.toml', 'setup.py', 'setup.cfg'],
  sinkHint: [
    '  ★ 探针已就位，但【默认不出事件】：无 sink 时 `capture_probe` 是 no-op。',
    '    ⇒ 要真观测，被测项目须在入口处接一次 sink：',
    '      from camprobe import set_global_probe_sink, JsonlSink',
    `      set_global_probe_sink(JsonlSink('<events.jsonl 路径>'))`,
    '      （接完再跑，事件才会写进 events.jsonl；否则插了也观测不到。）',
  ],
  async instrument(root, opts) {
    const scanned = collectPyFiles(root);
    const results: InstrumentFileResult[] = await instrumentPyProject(root, {
      projectRoot: opts.projectRoot,
      write: !opts.dryRun,
      contractProbes: opts.contractProbes,
    });
    const rep: ObserveInstrumentReport = {
      lang: 'python',
      dryRun: opts.dryRun,
      scanned: scanned.length,
      files: results.map((r) => ({
        file: r.file,
        sites: r.sites.map((s) => ({ line: s.line, kind: s.kind, level: s.level, probe: s.probe })),
        error: r.error,
      })),
      sinkHint: pyObservePack.sinkHint,
    };
    const total = rep.files.reduce((n, f) => n + (f.error ? 0 : f.sites.length), 0);
    if (!opts.dryRun && total > 0) {
      // 复用 TS 侧**同一份**台账实现（判据只住一处）
      const ledger = buildProbeLedger(results, root, { contractMode: opts.contractProbes !== undefined });
      rep.ledger = { file: saveProbeLedger(root, ledger), summary: ledgerSummary(ledger), raw: ledger };
    }
    return rep;
  },
  async uninstrument(root) {
    // ★ 备份/台账是**语言无关**的（`.agent-io/` 同一套）⇒ 直接复用 TS 侧实现
    const restored = restoreInstrumented(root);
    const cleared = clearProbeLedger(root);
    return { lang: 'python', restored: restored.length, restoredFiles: restored, ledgerCleared: cleared };
  },
};

/**
 * ★★★ **Java 包（第 4 门语言）** —— 2026-10-15 加，**整份由 `npm run new-observe-lang` 生成的填空题填出来的**。
 *
 * ## 它证明什么（这是本仓"补语言到底多贵"的第二次实测）
 * Python（第 3 门）是**手写**的 319 行 / 去注释 205 行；Java 这份**只填了 4 个函数**
 *（①命名 ②遍历 ⑥取值 + probeCall/buildImport）⇒ 整套 pack 291 行、去注释 **238 行**
 *（全部来自模板：头注、SINK 契约说明、通用收集流程、缩进小件）。
 * ⇒ **模板把"必须自己想清楚的事"压到 4 个函数**；剩下的都是照抄的通用流程。
 *
 * ★ 但**有一样没被模板吃掉**：探针运行时要另写（Java 侧 `observe-lang-java/observe/probe/Camprobe.java`，
 *   v2 起住真实包 `observe.probe`）。Python 那份是 148 行。⇒ "补一门语言" = 语言包（填空）+ 运行时（新写）。
 *
 * ★★ v2（2026-10-15，T321）：探针从**默认包**搬进真实包 ⇒ 打包文件也能插了（见 limitations 第 1 条）。
 */
export const javaObservePack: ObserveLangPack = {
  lang: 'java',
  label: 'Java',
  isSourceFile: (rel) => isInstrumentableJavaFile(rel),
  inProcess: true,
  manifestFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
  limitations: [
    // ★★★ T321（2026-10-15 v2 **已解**）：v1 是"探针类在默认包 + 同包零 import"⇒ 打包文件
    //   （`package com.foo;`）里的探针永远解析不了（Java 禁止从默认包 import）⇒ 只能硬失败。
    //   v2 把那个**隐假设**变成显式决策（⑦ 引用方式）：探针进真实包 `observe.probe`，
    //   每个被插桩文件注入 `import observe.probe.Camprobe;`（head 落在 package 声明之后）
    //   ⇒ **默认包与打包文件一视同仁**。代价：编译时该目录须在 sourcepath/classpath 上。
    '★★ 探针类在真实包 `observe.probe`：插桩会往每个文件注入 `import observe.probe.Camprobe;`' +
      '（落在 package 声明之后）⇒ 默认包与打包文件一视同仁。⇒ **编译时须把 `<项目根>/observe-lang-java/` ' +
      '加进 sourcepath/classpath**（或把 `observe-lang-java/observe/probe/Camprobe.java` 一并传给 javac），否则 import 解析不了。',
    '★ **探针运行时【不会】自动拷进被测工程**（不像 Go 侧 T268）⇒ 调用方需自己把 ' +
      '`observe-lang-java/` **整个目录**拷到被测工程根下（探针类落在 ' +
      '`observe-lang-java/observe/probe/Camprobe.java`；它同时是**项目根推断的路标**）。已记 T320。',
    '接口/抽象方法没有体 ⇒ 记 0 探针（台账判据③会把它当"本就无函数"处理）。',
    '`Map.of` 不收 null 且限 10 对 ⇒ 探针走 **flat key/value varargs**，由运行时自行拼装（见 probeCall 头注）。',
    'lambda / 匿名内部类 / 局部类 / 静态初始化块**未观测**（且它们内部的 return **不会**被误记成外层方法的探针）。',
  ],
  sinkHint: [
    '  ★ 探针已就位，但【默认不出事件】：Java 侧没接 sink 时 Camprobe.capture 是 no-op。',
    '    ⇒ 要真观测，须在被测工程入口处接一次 sink（插桩已自动注入 import，无需手写）：',
    '      Camprobe.setGlobalSink(new Camprobe.JsonlSink("events.jsonl"));',
    '      // 程序退出前可 Camprobe.setGlobalSink(null);',
    '    （探针类在 observe.probe 包：<项目根>/observe-lang-java/observe/probe/Camprobe.java，编译时见 limitations。）',
  ],
  async instrument(root, opts) {
    const scanned = collectJavaFiles(root).length;
    const results = await instrumentJavaProject(root, {
      projectRoot: opts.projectRoot,
      write: !opts.dryRun,
      contractProbes: opts.contractProbes,
    });
    const rep: ObserveInstrumentReport = {
      lang: 'java',
      dryRun: opts.dryRun,
      scanned,
      files: results.map((r) => ({
        file: r.file,
        sites: r.sites.map((s) => ({ line: s.line, kind: s.kind, level: s.level, probe: s.probe })),
        error: r.error,
      })),
      sinkHint: javaObservePack.sinkHint,
    };
    const total = rep.files.reduce((n, f) => n + (f.error ? 0 : f.sites.length), 0);
    if (!opts.dryRun && total > 0) {
      // 复用 TS 侧**同一份**台账实现（判据只住一处）
      const ledger = buildProbeLedger(results, root, { contractMode: opts.contractProbes !== undefined });
      rep.ledger = { file: saveProbeLedger(root, ledger), summary: ledgerSummary(ledger), raw: ledger };
    }
    return rep;
  },
  async uninstrument(root) {
    const restored = restoreInstrumented(root);
    const cleared = clearProbeLedger(root);
    return { lang: 'java', restored: restored.length, restoredFiles: restored, ledgerCleared: cleared };
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
observeLangs.register(pyObservePack);
observeLangs.register(javaObservePack);
