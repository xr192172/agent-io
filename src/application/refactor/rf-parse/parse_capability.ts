/**
 * parse_capability —— **解析能力自述**（P10：按语言如实声明"索引能看见什么"）
 *
 * 为什么需要（用户 2026-09-14/15）：索引对不同语言的解析粒度不一样 ——
 *   TS/JS/Go/Python/Java/Rust/C/C#/PHP 有**深适配**（调用边 + import 边，TS 系另有类型引用边）；
 *   其余注册语言（cpp/kotlin/ruby/css/md…）只有**符号定义级**（装了解析器才提取符号，没有边）；
 *   解析器没装 / 不在支持列表 ⇒ **完全不建符号索引**（只剩文本级检索）。
 * 危险：LLM 把"**解析不到**"当成"**不存在**"—— 对一个只有符号级的语言问
 *   `find_references` 得到"零引用"、问 `impact_analysis` 得到"零波及"，然后放心去删。
 *   注意 L0（首次接触建索引）解决不了这个：L0 补的是**覆盖**（文件进没进索引），
 *   本模块说的是**解析器能力**（进来了能看见什么）。这是"不撒谎"不变量里还剩的大块。
 *
 * 分层依据（与 kernel 实现严格对齐，别凭感觉写）：
 *   - `LANG_ADAPTERS[lang].callNode` 存在 ⇒ 提取调用边（call tier）；
 *   - `LANGUAGES` 注册表有 `symbol_nodes` 但无 callNode 适配 ⇒ 仅符号（symbol tier）；
 *   - `probe.isExtSupported(ext)` 为 null（解析器未装/不在注册表）⇒ 不解析（none tier）。
 */

import path from 'node:path';
import { findLanguageByExt, type LanguageEntry } from '../../../infrastructure/parse/languages.js';
import { LANG_ADAPTERS } from '../../../infrastructure/parse/kernel.js';
import { isExtSupported } from '../../../infrastructure/parse/probe.js';
import { missingLanguageHint } from '../../../infrastructure/parse/lang_hint.js';

/** 解析层级：call = 调用级（最深） / symbol = 仅符号定义 / none = 不解析 */
export type ParseTier = 'call' | 'symbol' | 'none';

export interface ParseCapability {
  tier: ParseTier;
  /** 语言显示名（未注册语言为 null） */
  lang: string | null;
  /** 人读一句话：该语言的索引能看见什么 */
  granularity: string;
  /** "零引用 / 零波及"是否可以直接当真（只有 call 级为 true） */
  zeroTrustworthy: boolean;
}

/**
 * 纯分层判定（不碰文件系统，便于测试）：注册表语言 + 解析器是否已装 ⇒ 层级。
 * `parserInstalled` 用 `probe.isExtSupported(ext) !== null` 的结果。
 */
export function tierForLanguage(lang: LanguageEntry | undefined, parserInstalled: boolean): ParseTier {
  if (!lang || !parserInstalled) return 'none';
  return LANG_ADAPTERS[lang.name]?.callNode ? 'call' : 'symbol';
}

/**
 * 人读粒度说明（与 kernel 实际行为对齐）。
 *
 * ★ P11（2026-09-29）：`none` 档（真缺）追加**可执行**提示 —— 这是全仓最通用的落点
 *   （find_references / impact_analysis 等行动类工具都经 `renderGranularityNote` 走这里）。
 *   `call`/`symbol` 档**不追加**：包都装了，再喊"装什么包"是噪音（§2d：别把警告重复 N 遍；
 *   symbol 档的精度提示原文已够）。`none` 提示由调用方按整串去重 ⇒ 同一语言只说一次。
 */
function granularityOf(tier: ParseTier, lang: string | null, ext: string): string {
  switch (tier) {
    case 'call':
      return `${lang ?? '该语言'} = 调用级：符号定义 + import 边 + 调用边（TS 系另有类型引用边）`;
    case 'symbol':
      return `${lang ?? '该语言'} = 仅符号定义级（无 import/调用/类型边；引用检索并入文本级扫描）`;
    case 'none': {
      const base = lang
        ? `${lang} = 不建符号索引（解析器未安装；该文件不入图，只剩文本级检索）`
        : '该语言不在支持列表，不建符号索引';
      return `${base}；${missingLanguageHint(ext)}`;
    }
  }
}

/**
 * 按文件扩展名给出解析能力（扩展名为主键 —— 与 kernel 的分派方式一致）。
 * 未知扩展名 / 注册表语言但解析器未装 ⇒ tier 'none'。
 */
export function parseCapabilityForFile(relOrAbs: string): ParseCapability {
  const ext = path.extname(relOrAbs).toLowerCase();
  const registered = findLanguageByExt(ext);
  const installed = isExtSupported(ext);
  const tier = tierForLanguage(registered, installed !== null);
  const lang = (installed ?? registered)?.name ?? null;
  return { tier, lang, granularity: granularityOf(tier, lang, ext), zeroTrustworthy: tier === 'call' };
}

/**
 * 行动类工具结果的**粒度标注**：所有涉及文件都是 call 级 ⇒ 空串（健康不刷屏）；
 * 有 symbol/none 级 ⇒ 一行诚实的"本结论在该语言上会低估"。
 * @param tool 'refs' = 引用清单（find_references）；'impact' = 影响面闭包（impact_analysis）
 */
export function renderGranularityNote(
  files: Array<string | undefined>,
  tool: 'refs' | 'impact',
): string {
  const byLang = new Map<string, { granularity: string; tier: ParseTier }>();
  for (const f of files) {
    if (!f) continue;
    const cap = parseCapabilityForFile(f);
    if (cap.tier === 'call') continue;
    const key = cap.granularity; // 同一句话 = 同一种情况，去重
    byLang.set(key, { granularity: cap.granularity, tier: cap.tier });
  }
  if (byLang.size === 0) return '';
  const details = [...byLang.values()].map((v) => v.granularity).join('；');
  const flavor =
    tool === 'impact'
      ? '影响面沿 import/调用**边**闭包计算，上述语言**没有这些边** ⇒ "零波及/少报"不可信；行动前用文本检索补一遍。'
      : '上述语言的引用结论是**文本级**（名称精确匹配）而非编译器级；"零引用"不可全信。';
  return `\n⚠️ 解析粒度（能力自述）：${details}——${flavor}`;
}

export interface LanguageTierSummary {
  lang: string;
  tier: ParseTier;
  /** 该语言的已索引文件数 */
  files: number;
}

/**
 * 按语言汇总已索引文件的解析层级（供 index_integrity 的"自述"一节）。
 * 输入 = 已索引文件的相对路径列表；输出按文件数降序。
 */
export function summarizeLanguagesByTier(relFiles: string[]): LanguageTierSummary[] {
  const acc = new Map<string, { tier: ParseTier; files: number }>();
  for (const rel of relFiles) {
    const ext = path.extname(rel).toLowerCase();
    if (!ext) continue;
    const cap = parseCapabilityForFile(rel);
    const key = cap.lang ?? ext;
    const prev = acc.get(key);
    acc.set(key, { tier: cap.tier, files: (prev?.files ?? 0) + 1 });
  }
  return [...acc.entries()]
    .map(([lang, v]) => ({ lang, tier: v.tier, files: v.files }))
    .sort((a, b) => b.files - a.files);
}
