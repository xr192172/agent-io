/**
 * lang_hint —— 「缺失语言/能力」的**可执行**提示（纯函数，零副作用）
 *
 * 为什么需要（用户方针，逐字）：
 *   「…并且**语言无关**（工具自动根据语言路由到对应语言接口（模式），
 *     **如果缺失提示下载或自己开发补齐**）。」
 * 现状（2026-09-29 实测）：全仓 5 处"缺失"文案都**不可执行** —— 只说"没有解析器" /
 * "暂只支持 TS/JS"，**不说装什么包、也不说照哪份清单补**：
 *   `ts_kernel/kernel.ts: parseFileFull` / `tools/rename_symbol.ts`（两处）/
 *   `behavior/index.ts: langOfFile` / `tools/parse_capability.ts: granularityOf`；
 * 另有 `tools/contract_gate.ts: scanContracts` 一处**静默跳过**（`if (!l) continue`）。
 *
 * 本模块把那句话升级成**四要件一句话**（不给四行废话，也不刷屏）：
 *   ① 缺哪个语言的哪个能力（ext 反查语言名；capabilityId 可选）
 *   ② 装什么包（`tree-sitter-<pkg>` ★ 含钉版；不在注册表则直说"注册表里还没有它"）
 *   ③ 照哪份清单补（指向 `docs/adding-a-language.md` 的**稳定节名**，编号漂移也能定位）
 *   ④ 当前缺口数（**复用** capability_matrix 的 diagnose+aggregate，不自己重算）
 *
 * ★ 纯计算纪律：本函数会被 [B] 层的多处（每文件级）调用，**不许有 IO 副作用** ——
 *   只读 `LANGUAGES` / probe 缓存 / 能力声明表，不写盘、不 spawn、不改全局。
 *   probe 的 `isExtSupported` 是**带缓存**的可解析性判定（非新建进程），与
 *   `parse_capability.ts` 的既有用法同一口径。
 *
 * ★ 节名为什么带 `§2.x` 编号：`docs/adding-a-language.md` 的小节标题本身就写成
 *   「### 2.2 `rename_symbol`（代码驱动）」—— 编号 + 能力 id 同时在标题里，
 *   即使编号漂移，用 id 也能搜到（比裸编号稳，比裸文件名准）。
 */

import { findLanguageByExt } from './ts_kernel/languages.js';
import { isExtSupported } from './ts_kernel/probe.js';
import {
  aggregateGaps,
  diagnoseCapabilities,
  getCapability,
  languageCatalog,
  levelFor,
  SUPPORT_META,
} from './capability_matrix.js';
import { PACK_PINS } from './install_package_cli.js';
import './register_capabilities.js'; // side-effect：填充能力声明表（否则缺口数恒为 0）

/** 补齐清单（只读，别改；docs/* 被 .gitignore 忽略，本提示只**指向**它） */
const DOC = 'docs/adding-a-language.md';

/** 第 ① 层（加一条 LANGUAGES 表项 + 装包）—— 不给 capabilityId 时的落点 */
const LAYER1_SECTION = '§1 第 ① 层（加 1 条 LANGUAGES 表项 + 装包）';

/**
 * capabilityId → 清单里的稳定节名。
 * 值里的 id 与 `docs/adding-a-language.md §2.x` 的标题逐字对应 ⇒ 编号漂移仍可检索。
 * 未登记的 id 退回 `§2 第 ② 层`（那节是"逐能力补一处"总表）。
 */
const CAP_SECTION: Record<string, string> = {
  ast_parse_skeleton: '§2.1 ast_parse_skeleton',
  rename_symbol: '§2.2 rename_symbol',
  contract_gate: '§2.3 contract_gate',
  extract_contracts: '§2.4 extract_contracts',
  package_migration: '§2.5 package_migration',
  version_upgrade_detection: '§2.6 version_upgrade_detection',
  impact_analysis: '§2.7 impact_analysis',
  cross_repo_symbol_index: '§2.8 cross_repo_symbol_index',
  hybrid_precheck: '§2.9 hybrid_precheck',
  behavior_baseline: '§2.10 behavior_baseline',
  code_health: '§2.11 code_health',
  spring_mvc_layering: '§2.12 spring_mvc_layering',
};

/** 能力缺口现状：总数 + 逐能力缺哪几门语言（复用既有聚合，不自己重算） */
export interface CapabilityGapStats {
  /** 全部功能的「功能×语言」缺口对数 */
  total: number;
  /** 功能 id → 该功能缺口语言清单（无缺口的功能不出现） */
  byCapability: Record<string, string[]>;
}

/** 取当前能力缺口（纯计算；语言名单取自 LANGUAGES，与 `npm run capability` 同一数据源） */
export function capabilityGaps(): CapabilityGapStats {
  const rows = diagnoseCapabilities(languageCatalog().map((l) => l.name));
  const byCapability = aggregateGaps(rows);
  const total = Object.values(byCapability).reduce((n, langs) => n + langs.length, 0);
  return { total, byCapability };
}

/** 归一化扩展名（'kt' → '.kt'） */
function normExt(ext: string): string {
  const e = ext.trim().toLowerCase();
  return e.startsWith('.') ? e : `.${e}`;
}

/**
 * 这几个能力的缺失**不是"装个 tree-sitter 包"能补的** —— 它们根本不吃 tree-sitter，
 * 要的是该语言自身的运行时/工具链 + 一个专用语言分支（harness / 适配器）。
 * ⇒ 对它们别喊"装 tree-sitter-x"（装了也没用，属不诚实提示），改说前置是什么。
 */
const RUNTIME_SIDE_CAP: Record<string, string> = {
  behavior_baseline: '一个 harness 分支（真编译/真跑该语言）',
  version_upgrade_detection: '一个适配器文件（声明文件格式 + 特性/废弃 API 规则表）',
};

/** 该能力对这门语言的**当前档位**（needWork 时才写进提示，避免"已全量"也刷一句） */
function levelClause(capabilityId: string, langName: string | null): string {
  if (!langName) return '';
  const decl = getCapability(capabilityId);
  if (!decl) return '';
  const level = levelFor(decl, langName);
  return SUPPORT_META[level].needWork ? `，${langName} 该能力现为「${SUPPORT_META[level].label}」` : '';
}

/**
 * ★ 装包前的「真筛子」一句（静态知识，不是本函数的 IO —— 所以纯计算纪律不破）：
 *   peer 声明靠不住。核心 tree-sitter 0.21 用 N-API 的 LANGUAGE_TYPE_TAG 认语言对象，
 *   而包的**安装模板**决定它导出的是不是这种对象：
 *     `scripts.install === 'node-gyp-build'` ⇒ 可载入；其它（老 nan.h 模板）⇒ 装上也会
 *     setLanguage 抛 "Invalid language object"（本机 36 包实测：20/20 命中 vs 0/16）。
 *   ⇒ 提示里只**指向**那条命令（`install-package check`），不在这里做任何探测。
 */
const SIEVE_HINT =
  '（装前先验：npm run install-package check <lang> —— 判据是 scripts.install === node-gyp-build，' +
  '老 nan.h 模板的包装上也载入失败）';

/**
 * 缺失语言能力的**可执行**提示（一句四要件）。
 * @param ext          文件扩展名（带不带 `.` 均可，大小写不敏感）
 * @param capabilityId 可选：具体能力 id（给了就带上"该能力缺多少门"，并指到对应小节）
 */
export function missingLanguageHint(ext: string, capabilityId?: string): string {
  const e = normExt(ext);
  const registered = findLanguageByExt(e);
  const installed = isExtSupported(e);
  const langName = (installed ?? registered)?.name ?? null;
  const { total, byCapability } = capabilityGaps();

  // ① 缺哪个语言的哪个能力
  const langText = langName ? `${e}（${langName}）` : `${e}（未登记语言）`;
  const capText = capabilityId ? `缺「${capabilityId}」能力` : '缺解析能力';
  const level = capabilityId ? levelClause(capabilityId, langName) : '';

  // ② 装什么包（含钉版）
  let packText: string;
  const runtimeSide = capabilityId ? RUNTIME_SIDE_CAP[capabilityId] : undefined;
  if (runtimeSide) {
    packText = `装包：本能力不吃 tree-sitter 包（它要的是${runtimeSide}），前置是该语言运行时/工具链本机可用`;
  } else if (!registered) {
    packText = '装包：注册表里还没有它（languages.ts: LANGUAGES 无此扩展名，得先加表项才有包名）';
  } else if (!installed) {
    const pin = PACK_PINS[registered.pkg];
    const spec = pin ? `tree-sitter-${registered.pkg}@${pin}` : `tree-sitter-${registered.pkg}@latest（未登记钉版）`;
    packText = `装包：${spec}，或 npm run install-package install ${registered.name}${SIEVE_HINT}`;
  } else {
    packText = `装包：tree-sitter-${registered.pkg} 已装（不是缺包；若解析仍失败按钉版重装：npm run install-package install ${registered.name}）`;
  }

  // ③ 照哪份清单补
  const section = capabilityId ? (CAP_SECTION[capabilityId] ?? '§2 第 ② 层（逐能力补一处总表）') : LAYER1_SECTION;
  const docText = `补齐：照 ${DOC}「${section}」改`;

  // ④ 当前缺口数
  const capGaps = capabilityId ? byCapability[capabilityId]?.length : undefined;
  const gapText =
    capGaps !== undefined
      ? `现状：能力矩阵缺口 ${total} 个「功能×语言」对（其中 ${capabilityId} 缺 ${capGaps} 门）`
      : `现状：能力矩阵缺口 ${total} 个「功能×语言」对`;

  return `⚠️ 语言能力缺失：${langText}${capText}${level} —— ${packText}；${docText}；${gapText}。`;
}
