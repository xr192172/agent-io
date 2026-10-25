/**
 * gen-facts —— 文档数字的**唯一事实源**（I5，2026-10-25）。
 *
 * 背景（外部审计发现的台账漂移）：README 写"65 个工具"实测 64（本次收敛后 63）、
 *   "33 门语言"其实是**本机已装数**而非名册数（名册 55）——根因：文档数字手写。
 *
 * 产出：
 *   1. docs/FACTS.json        —— 工具清单/工具数/语言矩阵/版本号/生成时间
 *   2. README.md / README.en.md 的两个 FACTS 标记块（工具数段 / 语言段）自动回写，**勿手改**
 *
 * 运行：node --import tsx scripts/gen-facts.mjs        （生成/回写）
 *       node --import tsx scripts/gen-facts.mjs --check（只校验，漂移则退非 0——供 CI 棘轮）
 *
 * 实现说明：工具清单用 **AST 静态提取**（不 import tool_registry）——因为
 *   meta/diagnosis/diagnose_loop.ts 引用了缺失的 test_contract 模块（已知红），
 *   任何运行时 import 注册表都会被连坐；capability_matrix / probe 在 infrastructure 层，无此问题。
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  languageCatalog,
  diagnoseCapabilitiesByEntries,
  SUPPORT_META,
} from '../src/infrastructure/analysis/capability/capability_matrix.ts';
import '../src/infrastructure/analysis/capability/register_capabilities.ts';
import { probeInstalledLanguages } from '../src/infrastructure/parse/probe.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ───────── 1. 工具清单（AST 静态提取 6 条能力线） ─────────
const LANES = ['observe', 'cross', 'design', 'meta', 'refactor', 'harvest'];
function strOf(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return strOf(node.left) + strOf(node.right);
  if (ts.isParenthesizedExpression(node)) return strOf(node.expression);
  return undefined;
}
function extractTools() {
  const out = [];
  for (const lane of LANES) {
    const p = path.join(ROOT, 'src', 'application', lane, 'index.ts');
    const sf = ts.createSourceFile(p, readFileSync(p, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (n) => {
      if (ts.isObjectLiteralExpression(n)) {
        const props = n.properties.filter((pr) => ts.isPropertyAssignment(pr));
        const nameP = props.find((pr) => pr.name && pr.name.getText(sf) === 'name');
        if (nameP) {
          const name = strOf(nameP.initializer);
          if (name) {
            const descP = props.find((pr) => pr.name && pr.name.getText(sf) === 'description');
            out.push({ name, lane, desc: oneLine(strOf(descP?.initializer) ?? '') });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return out;
}
/** 一句话 desc：截到第一个句号；兜底 160 字符 */
function oneLine(s) {
  const flat = s.replace(/\s+/g, ' ').trim();
  const i = flat.indexOf('。');
  const line = i >= 0 ? flat.slice(0, i + 1) : flat;
  return line.length > 160 ? line.slice(0, 157) + '…' : line;
}

// ───────── 2. 语言矩阵（复用 capability_audit 的数据结构，一行统计不重造） ─────────
function languageMatrix() {
  const roster = languageCatalog();
  const installed = probeInstalledLanguages();
  const rows = diagnoseCapabilitiesByEntries(installed);
  const features = rows.map((r) => ({
    id: r.decl.id,
    label: r.decl.label,
    coverage: Object.fromEntries(r.cells.map((c) => [c.lang, SUPPORT_META[c.level].label])),
    gaps: r.gaps.map((g) => g.lang),
  }));
  // 与 README 原口径对齐：AST 全量 = 本机已装解析器门数；语义全量 = 已装门数 − rename_symbol 缺口
  const renameGaps = new Set(features.find((f) => f.id === 'rename_symbol')?.gaps ?? []);
  const semanticFull = installed.filter((l) => !renameGaps.has(l.name)).length;
  return {
    rosterCount: roster.length,
    roster: roster.map((l) => l.name),
    installedCount: installed.length,
    installed: installed.map((l) => l.name),
    features,
    semanticFullCount: semanticFull,
    note: 'roster=注册语言名册（tree-sitter 声明）；installed=本机已装包（随机器变）；coverage/gaps 复用 capability_audit 的 diagnoseCapabilitiesByEntries',
  };
}

// ───────── 3. 组装 FACTS ─────────
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tools = extractTools();
const byLane = {};
for (const t of tools) byLane[t.lane] = (byLane[t.lane] ?? 0) + 1;
function buildFacts(generatedAt) {
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

// ───────── 4. 回写 README 标记块（两段各自独立标记，互不覆盖） ─────────
const MK = (id) => ({
  begin: `<!-- FACTS:${id}:BEGIN（由 scripts/gen-facts.mjs 生成，勿手改） -->`,
  end: `<!-- FACTS:${id}:END -->`,
});
const TOOLS = MK('TOOLS');
const LANG = MK('LANG');

function toolsBlock(f) {
  return [
    TOOLS.begin,
    `## 六条能力线（${f.tools.count} 个工具，全部证据闸控）`,
    '',
    `> 工具数与语言矩阵的**唯一事实源**是 [docs/FACTS.json](docs/FACTS.json)（\`node --import tsx scripts/gen-facts.mjs\` 生成）；本节数字由它回写，**勿手改**。分线：${Object.entries(f.tools.byLane).map(([k, v]) => `${k} ${v}`).join(' / ')}。`,
    TOOLS.end,
  ].join('\n');
}
function langBlock(f) {
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
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function blockRe(mk) {
  return new RegExp(`${esc(mk.begin)}[\\s\\S]*?${esc(mk.end)}`);
}
/** 首次接入时用于定位旧手写数字段的正则 */
const OLD = {
  tools: /## 六条能力线（65 个工具，全部证据闸控）/,
  lang: /## 语言支持（诚实版）\n\n- \*\*AST 解析\*\*[^\n]*\n- \*\*语义操作\*\*[^\n]*/,
};
function patchReadme(file, mk, oldRe, block) {
  const p = path.join(ROOT, file);
  let text = readFileSync(p, 'utf8');
  const re = blockRe(mk);
  if (re.test(text)) text = text.replace(re, block);
  else {
    const m = text.match(oldRe);
    if (!m) throw new Error(`${file}: 既无 ${mk.begin} 也匹配不到旧段（${oldRe}）`);
    text = text.replace(m[0], block);
  }
  writeFileSync(p, text);
}

const CHECK = process.argv.includes('--check');
const factsPath = path.join(ROOT, 'docs', 'FACTS.json');

if (CHECK) {
  const onDisk = JSON.parse(readFileSync(factsPath, 'utf8'));
  const fresh = buildFacts(onDisk.generatedAt); // 对齐时间戳 ⇒ 只比实质内容
  const drift = [];
  if (JSON.stringify(onDisk) !== JSON.stringify(fresh)) drift.push('docs/FACTS.json 过期（重跑 gen-facts）');
  for (const f of ['README.md', 'README.en.md']) {
    const t = readFileSync(path.join(ROOT, f), 'utf8');
    for (const [mk, block] of [[TOOLS, toolsBlock(fresh)], [LANG, langBlock(fresh)]]) {
      const m = t.match(blockRe(mk));
      if (!m) drift.push(`${f}: 缺 ${mk.begin} 块`);
      else if (m[0] !== block) drift.push(`${f}: ${mk.begin} 块与生成结果不一致`);
    }
  }
  if (drift.length) {
    console.error('✗ 文档数字漂移：\n' + drift.map((d) => '  - ' + d).join('\n'));
    process.exit(1);
  }
  console.log(`✓ FACTS 与 README 数字一致（${fresh.tools.count} 工具 / 名册 ${fresh.languageMatrix.rosterCount} 门 / 本机已装 ${fresh.languageMatrix.installedCount} 门）`);
} else {
  const facts = buildFacts(new Date().toISOString());
  writeFileSync(factsPath, JSON.stringify(facts, null, 2) + '\n');
  for (const f of ['README.md', 'README.en.md']) {
    patchReadme(f, TOOLS, OLD.tools, toolsBlock(facts));
    patchReadme(f, LANG, OLD.lang, langBlock(facts));
  }
  console.log(`✓ docs/FACTS.json 已生成（${facts.tools.count} 工具；语言名册 ${facts.languageMatrix.rosterCount} / 本机已装 ${facts.languageMatrix.installedCount}），README 两份已回写`);
}
