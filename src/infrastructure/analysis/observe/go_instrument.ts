/**
 * go_instrument —— 把 observe-lang-go 的 Go 插桩器桥接进 agent-io 工具面。
 *
 * 背景：observe_instrument 原本只支持 TS（instrumentProject，往 .ts 插 captureProbe）；
 * Go 工程的自动插桩（observe-lang-go：go/ast 注入 camprobe.Capture）退在同一仓库但没接线。
 * 本模块把它接上：检测是否 Go 工程 → 驱动 `go run ./cmd/instrument`（observe-lang-go）→
 * 解析统一报告 {files:[{file,sites:[{line,kind,level,probe}]}], restored}。
 *
 * 运行前提：被测 Go 工程须能编译含 `import camprobe "observe-lang-go/probe"` 的代码，
 * 即需在其 go.mod 加 replace/require 指向 observe-lang-go（插桩本身不校验，编译时见）。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import { commitSourceWrite, type SourceWriteHook } from '../../source_write_port.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface GoSite { line: number; kind: string; level: string; probe: string }
export interface GoFileResult { file: string; sites: GoSite[]; error?: string }
export interface GoInstrumentOut { files: GoFileResult[]; restored: number }

export interface GoInstrumentOptions {
  dryRun?: boolean;
  deep?: boolean;
  effects?: boolean;
  contractProbes?: string[];
}

/**
 * 递归找 .go 文件：目录含 go.mod 时才会被调用；排除 `.agent-io`/`node_modules`/`.git`/`bin`。
 *
 * ★★★ **2026-10-12（T188）改掉一处"静默兜底"** —— 这里原先写
 *   `try { entries = fs.readdirSync(…) } catch { return false; }`：
 *   ★ 它把「**这个目录读不了**（权限 / 不是目录 / IO 错）」和「**这里没有 .go**」
 *     **答成了同一个 `false`** ⇒ 上层会说"**不是 Go 工程**"，而真相是"**我没读到**"。
 * ★ 判据（本仓 §5 ③「失败就抛」）：**读不到就是失败，不是"没有"**。
 *   ⇒ 现在**删掉那个 catch**：读不了**当场抛**（带上路径），让人看得见"是读不到、不是不存在"。
 * ★ 为什么以前那样写"看起来没事"：`readdirSync` 在**正常仓**上几乎不失败 ⇒ 这条路**长期没被走到**；
 *   而它一旦走到（权限/软链/并发删），给出的就是一句**方向相反的结论**。
 */
function scanDir(root: string): boolean {
  // ★ 不吞异常：读不了 ⇒ 抛（消息里带上路径，便于定位）
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(`扫描 Go 源码时**读不到目录**（不是"这里没有 Go 文件"）：${root} —— ${(e as Error).message}`);
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === DATA_DIR_NAME || e.name === 'node_modules' || e.name === '.git' || e.name === 'bin') continue;
      if (scanDir(path.join(root, e.name))) return true;
    } else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) {
      return true;
    }
  }
  return false;
}

/**
 * 是否 Go 工程：目录含 `go.mod` 且扫到离散 `.go` 文件（排除 `.agent-io`/`node_modules`/`.git`/`bin`）。
 *
 * ★★ **2026-10-12（T188）**：删掉了外面那层 `catch { return false; }` ——
 *   它把「**目录读不了**」也答成 `false`（= "不是 Go 工程"），**两种病同因**（本仓"输出在误导"族）。
 *   ⇒ 现在：**没有 `go.mod`** ⇒ `false`（这是**真的**"不是 Go 工程"）；
 *     **扫的时候读不到目录** ⇒ **抛**（带路径）—— ★ 不再冒充一个"不是"的结论。
 * ★ 现状说明（如实）：本函数**当前没有生产调用方**（语言分派已改为语言包注册表，见
 *   `application/observe/handlers.ts:92` 的注释）；它仍留在 `observe_langs` 的登记里。
 *   ⇒ 所以这次改动**不改变任何在跑的流程**，只是**不再撒谎**。
 */
export function isGoProject(root: string): boolean {
  if (!fs.existsSync(path.join(root, 'go.mod'))) return false;
  return scanDir(root);
}

/**
 * 定位 observe 的 **Go 语言包**目录（含 go.mod 的 `observe-lang-go`）。
 *
 * ★ 2026-10-05 改名：`observe-lang-go/` → `observe-lang-go/`。理由：合一化后 Go 侧只剩两件事
 *   （Go 源码 AST 插桩 + 同编译单元采集 runtime）—— 它是**observe 的一个语言包**，
 *   不是"observe 的 Go 实现"。原名把"语言"当成了"角色"，与 P0 立的语言包架构矛盾。
 *   ★ 同时把 module path 从 `observe-lang-go`（**非可解析路径、无 domain 前缀**，
 *     是 P0 登记的基础设施缺陷）改成可解析的 `github.com/xr192172/agent-io/observe-lang-go`。
 *   ⚠ 改名**当时零迁移成本**（已核实：无已插桩工程、无 observe-backup 备份目录、
 *     本仓 Go 源码里 `camprobe` import 0 处）—— 若将来已有插桩工程，改 module path 会打断它们。
 */
export function goObserveDir(): string {
  if (process.env.AGENT_IO_GO_OBSERVE_DIR && fs.existsSync(path.join(process.env.AGENT_IO_GO_OBSERVE_DIR, 'go.mod'))) {
    return process.env.AGENT_IO_GO_OBSERVE_DIR;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'observe-lang-go');
    if (fs.existsSync(path.join(cand, 'go.mod'))) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('未定位 observe 的 Go 语言包目录 observe-lang-go/（可设环境变量 AGENT_IO_GO_OBSERVE_DIR）');
}

function runGo(moduleDir: string, args: string[], timeoutMs = 60000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn('go', args, { cwd: moduleDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      p.kill('SIGKILL');
      reject(new Error(`observe-lang-go 插桩执行超时（${timeoutMs}ms）`));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`无法启动 go（请确认已安装 Go 工具链）：${e.message}`));
    });
    p.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error((err || `go 退出码 ${code}`).trim().slice(0, 300)));
      else resolve(out);
    });
  });
}

function parseReport(raw: string): GoInstrumentOut {
  try {
    return JSON.parse(raw.trim()) as GoInstrumentOut;
  } catch {
    return { files: [], restored: 0 };
  }
}

// ─────────────────────────────────────────────
// ★★★ T268（2026-10-14）：把探针包**拷进被测工程**，不再要求它改 go.mod
//
// ## 病（实测，真实 Go 项目）
// 默认探针路径是 `github.com/xr192172/agent-io/observe-lang-go/probe` ⇒ 被测工程必须在
// **自己的 go.mod** 里补：
//     require github.com/xr192172/agent-io/observe-lang-go v0.0.0
//     replace github.com/xr192172/agent-io/observe-lang-go => "<agent-io 的本机路径>"
// ★ 第二行是**本机绝对路径** ⇒ 换机器 / 换目录 / 换盘符即失效；更糟的是它会被
//   **提交进被测项目的受版本管理文件**（go.mod）。
// ★ 对照 TS 侧：被测项目零配置（只在调用方传 `project_root`）⇒ Go 侧应对齐到同一形态。
//
// ## 做法（Go 侧本来就留了口子）
// `instrument.Options.ExcludeDirs` 的注释写着「如 internal/probe，避免把探针打进探针包自身」
// ⇒ **"探针包住在被测工程里"本来就是设计内的用法**，只是没接线。现在接上：
//   · 拷 `<agent-io>/observe-lang-go/probe/*.go` → `<target>/internal/camprobe/`
//   · 注入的 import 改为 **`<被测 module>/internal/camprobe`**（module 名从被测 go.mod 读）
//   · `--exclude-dirs internal/camprobe`（别把探针打进它自己）
//   · `uninstrument` 时**连目录一起删**（它是生成物，不是被测项目的代码）
// ─────────────────────────────────────────────

/** 探针包在被测工程里的落点（相对被测工程根，posix）。★ 用 `internal/` 是因为它不该被外部 import。 */
export const VENDORED_PROBE_DIR = 'internal/camprobe';

/** 读被测工程的 module 名（go.mod 第一行的第二个字段）。取不到 ⇒ 返回 null。 */
export function readGoModuleName(root: string): string | null {
  try {
    const gomod = fs.readFileSync(path.join(root, 'go.mod'), 'utf-8');
    for (const line of gomod.split(/\r?\n/)) {
      const m = /^\s*module\s+(\S+)/.exec(line);
      if (m) return m[1];
    }
  } catch {
    /* 读不到 ⇒ null（调用方响亮处理） */
  }
  return null;
}

/**
 * 把本仓的探针包拷进被测工程（幂等：已存在则覆盖为最新，保证与语言包同期）。
 * ★ 返回注入 import 应使用的**完整包路径**（`<module>/internal/camprobe`）。
 * ★ 拷不进去（没有 go.mod / 读不到 module / 源包缺失）⇒ **抛**（不静默退化成"改 go.mod"那条老路）。
 * ★★ 分类（2026-10-22）：字面 `classifyWriteSubject` = **source**（落点在根内 `internal/camprobe/**`），但**主体**是
 *   **product**：整目录由本仓 `observe-lang-go/probe` 拷来、 `uninstrument` 全删，用户从不手改（见上「它是生成物」）。
 *   ⇒ **不搬**；且原语**表达不了**（`copy` 两端都必须在本项目根内，这里的 from 在 agent-io 仓）⇒ 已立下一环卡。
 */
export function vendorGoProbe(root: string): string {
  const moduleName = readGoModuleName(root);
  if (!moduleName) {
    throw new Error(
      `被测工程 ${root} 里读不到 go.mod 的 module 名 ⇒ 无法决定探针包该 import 成什么路径。` +
        `（Go 侧插桩要求被测工程是一个 Go module。）`,
    );
  }
  const src = path.join(goObserveDir(), 'probe');
  if (!fs.existsSync(src)) throw new Error(`本仓的探针包不存在：${src}（observe-lang-go/probe 缺失）`);
  const dst = path.join(root, VENDORED_PROBE_DIR);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    // ★ 只拷 .go；`_test.go` 也拷（无害，且让被测工程自带探针的自测）
    if (!f.endsWith('.go')) continue;
    fs.copyFileSync(path.join(src, f), path.join(dst, f));
  }
  return `${moduleName}/${VENDORED_PROBE_DIR}`;
}

/** 删掉拷进去的探针包（`uninstrument` 用）。返回是否删掉了东西。
 *  ★★ 分类（2026-10-22）：同 {@link vendorGoProbe} —— 字面 source、主体 product（工具自有生成物）⇒ **不搬**；
 *  且原语**表达不了**（`remove` 只删文件、不递归删目录，这里删的是整棵 `internal/camprobe`）⇒ 已立下一环卡。 */
export function unvendorGoProbe(root: string): boolean {
  const dst = path.join(root, VENDORED_PROBE_DIR);
  if (!fs.existsSync(dst)) return false;
  fs.rmSync(dst, { recursive: true, force: true });
  // ★★★ T296（2026-10-14）：**连空掉的父目录一起删** —— 原先只删 `internal/camprobe`，
  //   而 `internal/` 若**本来不存在**（是我们为放探针包而建的）⇒ 还原后留一个**空目录**
  //   ⇒ 被测工程的 `git status` 多一条，而它**不是**被测项目的代码（是生成物）。
  //   ★ 安全边界（重要）：只删**一层**、且**仅当为空**；`parent !== root` 保证绝不会删到项目根；
  //     删不掉（占用/权限）⇒ 留着，**不是错误**（与 `clean_dist.mjs` 的 pruneEmpty 同一纪律）。
  const parent = path.dirname(dst);
  if (parent !== root && fs.existsSync(parent)) {
    try {
      if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
    } catch {
      /* 占用/权限 ⇒ 留着 */
    }
  }
  return true;
}

/** 对 Go 工程插桩（或 dry-run）。返回与 observe-lang-go CLI 一致的报告。
 * ★ `root` **必须是绝对路径**（或调用方已归一）：它作为**位置参数**传给 `go run`，
 *   而那个子进程的 `cwd` 是**语言包目录**（`goObserveDir()`）⇒ 相对路径会被按**语言包目录**解析
 *   （实测会多拼一层：`open <repo>\observe-lang-go\observe-lang-go`）。
 *   归一在 `application/observe/handlers.ts` 入口一处完成（改这里前先看那段注释）。 */
export async function instrumentGoProject(root: string, opts: GoInstrumentOptions = {}): Promise<GoInstrumentOut> {
  const mod = goObserveDir();
  const args = ['run', './cmd/instrument', root];
  if (opts.dryRun) args.push('--dry-run');
  if (opts.deep) args.push('--deep');
  if (opts.effects) args.push('--effects');
  if (opts.contractProbes && opts.contractProbes.length > 0) {
    args.push('--probes', JSON.stringify(opts.contractProbes));
  }
  // ★★★ T268：**干跑不拷包**（dry-run 不该往被测工程写任何东西）——
  //   但要**算出**该 import 成什么，好让报告里的预览与真实插桩一致。
  if (opts.dryRun) {
    const moduleName = readGoModuleName(root);
    if (moduleName) {
      args.push('--probe-import', `${moduleName}/${VENDORED_PROBE_DIR}`);
      args.push('--exclude-dirs', VENDORED_PROBE_DIR);
    }
  } else {
    // 真插桩：先把探针包拷进被测工程，再让插桩器 import 它 ⇒ **被测工程的 go.mod 一字不改**。
    const probeImport = vendorGoProbe(root);
    args.push('--probe-import', probeImport);
    args.push('--exclude-dirs', VENDORED_PROBE_DIR);
  }
  const raw = await runGo(mod, args);
  return parseReport(raw);
}

/** 一键还原被插桩的 Go 工程（从 .agent-io/observe-backup 拷回原文件并删备份）。 */
export async function restoreGoProject(root: string): Promise<number> {
  const mod = goObserveDir();
  const raw = await runGo(mod, ['run', './cmd/instrument', root, '--restore']);
  const rep = parseReport(raw);
  // ★ T268：连**拷进去的探针包**一起删（它是生成物，不属于被测工程）
  unvendorGoProbe(root);
  return rep.restored ?? 0;
}

/** 统计报告（与 TS instrument 一致的展示形态） */
export function goReportSummary(rep: GoInstrumentOut): { totalSites: number; instrumented: number; skipped: number; errors: number } {
  let totalSites = 0, instrumented = 0, skipped = 0, errors = 0;
  for (const f of rep.files) {
    if (f.error) errors++;
    else if (f.sites.length > 0) { instrumented++; totalSites += f.sites.length; }
    else skipped++;
  }
  return { totalSites, instrumented, skipped, errors };
}

// ─────────────────────────────────────────────
// 被测 Go 工程接 observe-lang-go（go.mod replace/require）—— ★★ **T268 起不再是前置**
//
// ★★★ 2026-10-14（T268）：下面这套「改 go.mod」的检查/补齐**已不再被插桩流程调用**。
//   原因（实测）：它要求在**被测工程**的 go.mod 里写一条指向 agent-io **本机绝对路径**的
//   `replace` ⇒ 换机器 / 换目录即失效，且会被提交进被测项目的受版本管理文件。
//   ⇒ 现在改为**把探针包拷进被测工程**（`vendorGoProbe`，落点 `internal/camprobe/`），
//     注入的 import 指向 `<被测 module>/internal/camprobe` ⇒ **被测工程零改动**。
//   ★ 本函数**保留导出**：给"确实想走 go.mod 那条路"的调用方（如被测工程希望探针包由
//     自己的 module 管理）用；但它**不是插桩的前置条件**。
// ─────────────────────────────────────────────

const GO_OBSERVE_MODULE = 'github.com/xr192172/agent-io/observe-lang-go';

export interface GoDepsCheck {
  /** 是否需要补 replace（false=工程已能解析 observe-lang-go） */
  needs_replace: boolean;
  /** 是否需要补 require */
  needs_require: boolean;
  /** 若需补，写入的前缀行（require/replace），已在行内带路径 */ 
  require_line?: string;
  replace_line?: string;
  /** 若已就绪，简要说明 */
  note?: string;
}

/** 检查被测工程 go.mod 是否已能解析 observe-lang-go（有 require + 有 replace 指向 observe-lang-go）。 */
export function checkGoObserveDeps(root: string, moduleDir?: string): GoDepsCheck {
  const modPath = path.join(root, 'go.mod');
  let src = '';
  try { src = fs.readFileSync(modPath, 'utf-8'); } catch {
    return { needs_replace: true, needs_require: true, require_line: `require ${GO_OBSERVE_MODULE} v0.0.0`, replace_line: `// 无 go.mod：${modPath}`, note: '目标目录缺少 go.mod，插桩需先有可编译的 Go 工程' };
  }
  const hasRequire = new RegExp(`(^|\\s)require\\s+${GO_OBSERVE_MODULE}\\b`, 'm').test(src);
  const hasBlockRequire = new RegExp(`require\\s*\\([^)]*${GO_OBSERVE_MODULE}`, 's').test(src);
  const needsRequire = !(hasRequire || hasBlockRequire);
  const hasReplace = new RegExp(`replace\\s+${GO_OBSERVE_MODULE}\\s*=>`).test(src);
  const needsReplace = !hasReplace;
  if (!needsRequire && !needsReplace) {
    return { needs_replace: false, needs_require: false, note: 'go.mod 已含 observe-lang-go 的 require 与 replace，可直接编译插桩后代码' };
  }
  const goDir = moduleDir ?? (() => { try { return goObserveDir(); } catch { return ''; } })();
  const replacePath = goDir ? JSON.stringify(goDir.replace(/\\/g, '/')) : `<observe-lang-go 模块目录>`;
  return {
    needs_replace: needsReplace,
    needs_require: needsRequire,
    require_line: `require ${GO_OBSERVE_MODULE} v0.0.0`,
    replace_line: `replace ${GO_OBSERVE_MODULE} => ${replacePath}`,
    note: `待补 require + replace（指向 ${goDir || 'observe-lang-go 模块目录'}）`,
  };
}

/** 补桥：把 observe-lang-go 的 require/replace 追加到被测工程 go.mod（默认 dry-run 只返回将写内容）。
 *  返回是否实际写盘 changed。
 *  ★★ 2026-10-22（写原语收口）：`go.mod` 按 `write_gate#classifyWriteSubject` 是 **source**
 *  —— 它是被测工程**受版本管理的模块声明**，改它就是改用户源码 ⇒ 必须过闸。
 *  `commit` = 写闸事务的 `commit`（应用层注 `txn.commit`）：缺注入 ⇒ `commitSourceWrite` **抛**，
 *  不回落裸 `fs.writeFileSync`；闸拒也**原样上抛**（原先这里把写盘失败吞成 `changed:false`，
 *  会让调用方把“没写成”读成“无需改” —— 静默降级正是本仓点名的病灶）。 */
export function ensureGoObserveIntegration(root: string, moduleDir?: string, write = false, commit?: SourceWriteHook): { changed: boolean; check: GoDepsCheck } {
  const check = checkGoObserveDeps(root, moduleDir);
  if (!check.needs_require && !check.needs_replace) return { changed: false, check };
  if (!write) return { changed: false, check };
  const modPath = path.join(root, 'go.mod');
  let src = '';
  try { src = fs.readFileSync(modPath, 'utf-8'); } catch { return { changed: false, check }; }
  const adds: string[] = [];
  if (check.needs_require && check.require_line) adds.push(check.require_line);
  if (check.needs_replace && check.replace_line && !check.replace_line.startsWith('//')) adds.push(check.replace_line);
  if (adds.length === 0) return { changed: false, check };
  const sep = src.endsWith('\n') ? '' : '\n';
  const next = src + sep + '\n' + adds.join('\n') + '\n';
  // ★ 与搬前**逐字一致**的只有内容与路径：`next` 拼法、`modPath`、utf-8 都没动 —— 换的只是“谁来落盘”。
  commitSourceWrite(commit, modPath, next);
  return { changed: true, check };
}