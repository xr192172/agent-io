/**
 * parser_presence —— 「**解析器到底能测到哪几门语言**」的**唯一实测派生点**。
 *
 * ## 为什么必须有这一个文件（P0-1 · 审计 `ea-func-ds-1` §1.1 第 1 条）
 * 实测事故（2026-11-17，独立审计席复算）：`capability_audit` 的 `ast_parse_skeleton` 行对
 * **全部 55 门**语言打 🟢AST 全量 —— 因为登记项写的是 `default: 'full_ast'`，而**它从来不读 probe**。
 * 同一台机器上 `probe.isLanguageInstalled` 的实测答案是 **33/55**（`lua`/`erlang`/`yaml`/`markdown`/…
 * 22 门"注册了但用不了"）。
 * ⇒ **能力矩阵是"默认值矩阵"，不是"实测矩阵"**；而这张表的名字与那排 🟢 读起来就是"我们能做"。
 *
 * ## 它回答什么（一句话）
 * 注册名册（`LANGUAGES`）逐门问 probe：**这门语言的解析器本机能不能真的载入**；不能的话，
 * 是「上游没有可用 node 包」（`pkgSpec: null`，装什么都救不了）还是「有包名但这台机器没装」。
 *
 * ## 判据只有一个落点（别在别处再判一次）
 * · 可载入与否 = `probe.ts#isLanguageInstalled`（它内部已收口「派生名 / `pkgSpec` 显式名 / 真筛子」）；
 * · 「上游有没有可用包」= `languages.ts#languageModuleSpec(...) === null`（`pkgSpec: null` 的唯一语义）。
 * 本文件**不**自己 resolve 包、**不**自己拼 `tree-sitter-${pkg}`。
 *
 * ★ 纯读 + 进程内无缓存增量：`isLanguageInstalled` 自己就有进程级缓存，这里再加一层只会制造
 *   「卸包后读数不变」的第二个真相源（本笔的消融用例正是靠"立刻重算"才看得见变化）。
 */
import { LANGUAGES, languageModuleSpec, type LanguageEntry } from './languages.js';
import { isLanguageInstalled } from './probe.js';
import type { SupportProbe } from '../analysis/capability/capability_matrix.js';

/**
 * 「这门口语本机解析不了」的**两种**原因 —— 处置相反，所以**不许合成一句**：
 * · `upstream-no-package`：注册表自己声明了「上游没有可用的 node 原生包」（`pkgSpec: null`）
 *   ⇒ `npm i` 装什么都救不了，只能自编 grammar 或把表项摘掉；
 * · `not-installed`：有包名，只是这台机器上没有（或装的版本过不了真筛子）⇒ 按钉版装包即可；
 * · `load-failed`：包在盘上、也过了清单筛子，但 `getParser` 真加载失败（native ABI 等）
 *   ⇒ 只有预热路径能测到（`prewarmKernel` 传 `loadFailed`），其余调用方不传就看不见这一档。
 */
export type NoParserReason = 'upstream-no-package' | 'not-installed' | 'load-failed';

export interface ParserPresence {
  /** 注册名册里的语言名（分母） */
  registered: string[];
  /** 本机**真能载入**的语言名（分子） */
  loadable: string[];
  /** 在册、但本机解析不了 —— 逐门带原因（分子与分母之间的差集，逐条可查） */
  withoutParser: Array<{ lang: string; reason: NoParserReason }>;
}

/**
 * 实测一遍「注册名册 ∩ 本机解析器」。
 *
 * @param langs      名册（默认 `LANGUAGES`；测试可传子集做消融，不必卸真包）
 * @param loadFailed 预热实测的「包在、但加载失败」语言名（只有 `prewarmKernel` 能给）
 */
export function measureParserPresence(
  langs: readonly LanguageEntry[] = LANGUAGES,
  loadFailed: Iterable<string> = [],
): ParserPresence {
  const failed = new Set(loadFailed);
  const loadable: string[] = [];
  const withoutParser: ParserPresence['withoutParser'] = [];
  for (const l of langs) {
    if (isLanguageInstalled(l.pkg)) {
      // ★ 「包可载入」与「真加载成功」是两件事：预热说它加载失败 ⇒ 如实降级，不粉饰成可解析
      if (!failed.has(l.name)) {
        loadable.push(l.name);
        continue;
      }
      withoutParser.push({ lang: l.name, reason: 'load-failed' });
      continue;
    }
    withoutParser.push({
      lang: l.name,
      reason: languageModuleSpec(l.pkg, l.pkgSpec) === null ? 'upstream-no-package' : 'not-installed',
    });
  }
  return { registered: langs.map((l) => l.name), loadable, withoutParser };
}

/** 逐原因计数（**恒等式**：`loadable + Σ missing = registered`） */
export interface ParserRatio {
  loadable: number;
  registered: number;
  missing: number;
  byReason: Record<NoParserReason, number>;
}

export function parserRatio(p: ParserPresence): ParserRatio {
  const byReason: Record<NoParserReason, number> = {
    'upstream-no-package': 0,
    'not-installed': 0,
    'load-failed': 0,
  };
  for (const w of p.withoutParser) byReason[w.reason] += 1;
  return {
    loadable: p.loadable.length,
    registered: p.registered.length,
    missing: p.withoutParser.length,
    byReason,
  };
}

/**
 * **归一成一句读数**：`可解析语言 33/55（缺 22：在册未装 15 · 上游无包 7）`。
 *
 * ★ 为什么这必须是**一个函数**（P0-1 同批修的第 2 处）：原文案是
 *   `48 个解析器就绪 ★ 另有 24 门语言【注册了但没装】` —— **两个单位混在一句**里
 *   （"个解析器"数的是 **ext**，"门语言"数的是语言），于是 `51+22≠55`、`48+24≠55`，
 *   用户**无法**拿它对上 README 的 33/55。单位归一后只有一个分母：**注册名册**。
 */
export function formatParserRatio(p: ParserPresence): string {
  const r = parserRatio(p);
  const parts: string[] = [];
  if (r.byReason['not-installed'] > 0) parts.push(`在册未装 ${r.byReason['not-installed']}`);
  if (r.byReason['upstream-no-package'] > 0) parts.push(`上游无包 ${r.byReason['upstream-no-package']}`);
  if (r.byReason['load-failed'] > 0) parts.push(`载入失败 ${r.byReason['load-failed']}`);
  return `可解析语言 ${r.loadable}/${r.registered}` + (r.missing > 0 ? `（缺 ${r.missing}：${parts.join(' · ')}）` : '');
}

/**
 * 把实测结果接成能力矩阵要的**探测口**（`capability_matrix.ts#SupportProbe`）。
 *
 * ★ 为什么在 parse 层而不是矩阵层做这个映射：矩阵是**纯数据 + 纯函数**（零 IO），
 *   它只声明「我需要有人告诉我这三件事」；**谁来答**是 infrastructure 的事。
 */
export function parserSupportProbe(p: ParserPresence): SupportProbe {
  const loadable = new Set(p.loadable);
  const noPackage = new Set(p.withoutParser.filter((w) => w.reason === 'upstream-no-package').map((w) => w.lang));
  return {
    loadable: (langName: string) => loadable.has(langName),
    upstreamNoPackage: (langName: string) => noPackage.has(langName),
  };
}
