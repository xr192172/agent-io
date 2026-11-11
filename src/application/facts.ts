/**
 * facts —— **文档数字的唯一事实源**（gen-facts 的运行时核心，第⑬项队列补卡）。
 *
 * ## 为什么抽到 src/ 编译
 * `scripts/gen-facts.mjs` 原先 import 了 TS 文件（capability_matrix.ts）⇒ 必须跑 `--import tsx`；
 * 且工具清单靠 **AST 静态解析** 5 个 lane 的 index.ts（"运行时拿不到 TOOL_DEFS 才搞的变通"）。
 * 抽到 src/ 编译后：① tsx 依赖消失（node 直接跑薄壳）；② cascade 可进程内 import（降级警告消除）；
 * ③ 工具清单改从 **TOOL_DEFS + laneOfFromSources()** 取——dist 里现成的权威数据（= MCP 面实际暴露的）。
 *
 * ## 消费者
 * · `scripts/gen-facts.mjs`（薄壳：CLI 参数/退出码）→ `writeFacts(root)`
 * · `src/application/design/cascade.ts` → `writeFacts(root)`（级联第三步，契约面改动时）
 * · `npm run gen-facts:check` → `checkFactsFresh(root)`（比 FACTS.json + README 两块）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TOOL_DEFS, laneOfFromSources } from './tool_registry.js';
import { languageCatalog, diagnoseCapabilitiesByEntries, SUPPORT_META } from '../infrastructure/analysis/capability/capability_matrix.js';
import '../infrastructure/analysis/capability/register_capabilities.js';
import { probeInstalledLanguages } from '../infrastructure/parse/probe.js';

/** 一句话 desc：截到第一个句号；兜底 160 字符（与原 AST 版同一把尺） */
function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  const i = flat.indexOf('。');
  const line = i >= 0 ? flat.slice(0, i + 1) : flat;
  return line.length > 160 ? line.slice(0, 157) + '…' : line;
}

/** 工具清单：从 TOOL_DEFS（运行时权威 = MCP 面实际暴露的）+ lane 归属表组装 */
function extractToolsFromRegistry(root: string): Array<{ name: string; lane: string; desc: string }> {
  // 仓库根定位：package.json 在那里（version 也读它）
  const laneOf = laneOfFromSources();
  return TOOL_DEFS.map((d) => ({
    name: d.name,
    lane: laneOf[d.name]?.lane ?? 'unknown',
    desc: oneLine(d.description),
  }));
}

/** 语言支持矩阵（roster=名册 / installed=本机已装 / semantic 全量数）——**与原 AST 版同一口径** */
function languageMatrix() {
  const roster = languageCatalog();
  const installed = probeInstalledLanguages();
  const rows = diagnoseCapabilitiesByEntries(installed);
  // 与 README 原口径对齐（git show adab9236 的原实现逐字迁）：AST 全量 = 本机已装解析器门数；
  // 语义全量 = 已装门数 − rename_symbol 缺口（"语义操作"那行数字的算法，不是发明新的）。
  const renameGaps = new Set(rows.find((r) => r.decl.id === 'rename_symbol')?.gaps.map((g) => g.lang) ?? []);
  const semanticFull = installed.filter((l) => !renameGaps.has(l.name)).length;
  const gaps = rows.flatMap((r) => r.gaps);
  return {
    rosterCount: roster.length,
    installedCount: installed.length,
    semanticFullCount: semanticFull,
    installed: installed.map((l) => l.name),
    gaps: gaps.map((g) => ({ lang: g.lang, semantic: g.level, note: g.note ?? '' })),
    supportMeta: SUPPORT_META,
    note: 'roster=注册语言名册（tree-sitter 声明）；installed=本机已装包（随机器变）；coverage/gaps 复用 capability_audit 的 diagnoseCapabilitiesByEntries',
  };
}

export interface FactsObject {
  generatedAt: string;
  version: string;
  versionTag: { packageJson: string; latestTag: string; note: string };
  tools: {
    count: number;
    byLane: Record<string, number>;
    atomicEntry: string;
    list: Array<{ name: string; lane: string; desc: string }>;
  };
  languageMatrix: ReturnType<typeof languageMatrix>;
}

/** 组装 FACTS（原 buildFacts 的运行时版） */
export function buildFactsObject(root: string, generatedAt: string): FactsObject {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const tools = extractToolsFromRegistry(root);
  const byLane: Record<string, number> = {};
  for (const t of tools) byLane[t.lane] = (byLane[t.lane] ?? 0) + 1;
  return {
    generatedAt,
    version: pkg.version,
    versionTag: {
      packageJson: pkg.version,
      latestTag: 'v0.1.0',
      note: 'tag 落后于 package.json version（0.1.0 → 0.1.3 之间未打 tag）。口径：package.json 是代码事实；v0.1.3 由主控在下次提交时补打，不回改 version 凑 tag。',
    },
    tools: {
      count: tools.length,
      byLane,
      atomicEntry: 'atomic_call（只在 composed/minimal 面注册的编排入口，不计入原子工具数）',
      list: tools,
    },
    languageMatrix: languageMatrix(),
  };
}

// ───────── README 标记块回写（原 gen-facts.mjs 的壳逻辑，抽进来让 cascade 可完整调用） ─────────
const MK = (id: string) => ({
  begin: `<!-- FACTS:${id}:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->`,
  end: `<!-- FACTS:${id}:END -->`,
});
const TOOLS = MK('TOOLS');
const LANG = MK('LANG');
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockRe = (mk: { begin: string; end: string }): RegExp => new RegExp(`${esc(mk.begin)}[\\s\\S]*?${esc(mk.end)}`);

function toolsBlock(f: FactsObject): string {
  return [
    TOOLS.begin,
    `## 六条能力线（${f.tools.count} 个工具，全部证据闸控）`,
    '',
    `> 工具数与语言矩阵的**唯一事实源**是 [docs/FACTS.json](docs/FACTS.json)（\`node scripts/gen-facts.mjs\` 生成）；本节数字由它回写，**勿手改**。分线：${Object.entries(f.tools.byLane).map(([k, v]) => `${k} ${v}`).join(' / ')}。`,
    TOOLS.end,
  ].join('\n');
}
function langBlock(f: FactsObject): string {
  const m = f.languageMatrix;
  return [
    LANG.begin,
    '## 语言支持（诚实版）',
    '',
    `- **AST 解析**：${m.installedCount} 门已装全量（tree-sitter；名册共注册 ${m.rosterCount} 门，装了才能用——\`capability_audit\` 一键自检）`,
    `- **语义操作**（改名/契约闸/影响面等）：${m.semanticFullCount} 门全量，其余覆盖度递减（\`capability_audit\` 一键出缺口清单）`,
    '',
    `> 数字由 scripts/gen-facts.mjs 回写自 docs/FACTS.json（roster/installed 随机器与版本变），**勿手改**。`,
    LANG.end,
  ].join('\n');
}

/** 仓库根定位（编译产物在 dist/src/... ⇒ 向上找 package.json） */
export function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('facts.ts：向上找不到 package.json（仓库根定位失败）');
}

/** **写 FACTS.json + 回写 README 两份**（gen-facts 的完整产物；cascade 与薄壳共用） */
export function writeFacts(root: string): FactsObject {
  const facts = buildFactsObject(root, new Date().toISOString());
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'FACTS.json'), JSON.stringify(facts, null, 2) + '\n', 'utf8');
  for (const f of ['README.md', 'README.en.md']) {
    patchReadme(root, f, toolsBlock(facts), langBlock(facts));
  }
  return facts;
}

function patchReadme(root: string, file: string, toolsBlk: string, langBlk: string): void {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) return; // README.en.md 可能不存在（新仓）⇒ 不抛（facts 生成不该被 README 卡死）
  let text = fs.readFileSync(p, 'utf8');
  for (const [mk, block] of [[TOOLS, toolsBlk], [LANG, langBlk]] as const) {
    const re = blockRe(mk);
    if (re.test(text)) text = text.replace(re, block);
    // 没有 FACTS 标记块的 README（旧手写数字段）⇒ **跳过不抛**（薄壳的 OLD 正则兜底已退役——
    //   标记块由本函数首次写入；老仓的旧段由主控手动迁移一次，facts 生成不该为它背回滚复杂度）。
  }
  fs.writeFileSync(p, text, 'utf8');
}

/** **只查不写**（gen-facts:check 门）：FACTS.json 与 README 两块是否新鲜 */
export function checkFactsFresh(root: string): { ok: boolean; drift: string[]; summary: string } {
  const factsPath = path.join(root, 'docs', 'FACTS.json');
  if (!fs.existsSync(factsPath)) return { ok: false, drift: ['docs/FACTS.json 不存在（跑一次 gen-facts）'], summary: '缺 FACTS.json' };
  const onDisk = JSON.parse(fs.readFileSync(factsPath, 'utf8')) as FactsObject;
  const fresh = buildFactsObject(root, onDisk.generatedAt); // 对齐时间戳 ⇒ 只比实质内容
  const drift: string[] = [];
  if (JSON.stringify(onDisk) !== JSON.stringify(fresh)) drift.push('docs/FACTS.json 过期（重跑 gen-facts）');
  for (const f of ['README.md', 'README.en.md']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    const t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    for (const [mk, block] of [[TOOLS, toolsBlock(fresh)], [LANG, langBlock(fresh)]] as const) {
      const m = t.match(blockRe(mk));
      if (!m) drift.push(`${f}: 缺 ${mk.begin} 块`);
      else if (m[0].replace(/\r\n/g, '\n') !== block.replace(/\r\n/g, '\n')) drift.push(`${f}: ${mk.begin} 块与生成结果不一致`);
    }
  }
  const summary = `${fresh.tools.count} 工具 / 名册 ${fresh.languageMatrix.rosterCount} 门 / 本机已装 ${fresh.languageMatrix.installedCount} 门`;
  return { ok: drift.length === 0, drift, summary };
}
