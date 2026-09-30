/**
 * 规则载体（P1-7）—— 把"一次性修复"沉淀成可复跑规则
 *
 * 出处：Grit/GritQL 的规则文件形态（实读 docs.grit.io 校准）：
 *   规则 = **一个 `.md` 文件**（frontmatter: title/tags + 一句描述 +
 *   单个 ```grit 块 + 若干 `##` 测试段，每段 = 成对的 before/after 代码块）。
 *   ⇒ **测试即文档**，规则与它的夹具同居一个文件，可整文件复制到别的仓复用。
 *
 * 我们的载体（对齐 Grit 形态，但用我们自己的匹配核）：
 *   ```md
 *   ---
 *   id: no-console-log
 *   title: 禁止裸 console.log
 *   tags: [style, logging]
 *   level: warn            # error | warn | info（check 的严重度）
 *   language: typescript   # 可选；省略 = 按文件后缀自动判
 *   created_from: 2026-09-15T…  # 萃取来源（可追溯）
 *   ---
 *
 *   一句话说明这条规则在防什么。
 *
 *   ```pattern
 *   console.log(...);
 *   ```
 *
 *   ```replace
 *   logger.info(...);
 *   ```
 *
 *   ## 正例（应当命中并改写）
 *
 *   before:
 *   ```ts
 *   console.log(user.id);
 *   ```
 *
 *   after:
 *   ```ts
 *   logger.info(user.id);
 *   ```
 *
 *   ## 反例（不得命中）      ← ★ 我们的差异化：Grit stdlib 零反例
 *
 *   ```ts
 *   logger.info(user.id);
 *   ```
 *   ```
 *
 * 设计纪律：
 *   1. **反例夹具是必需的**（`negative` 段）：规则由 LLM 现场长出来，
 *      没有阴性对照就无法证明它"只在该改的地方改"。缺反例的规则
 *      `rules(action="check")` 会报 `missing_negative` 警告。
 *   2. **单文件自包含**：pattern / replace / 夹具 / 说明同居一文件 ⇒
 *      可整文件复制到其他仓（跨仓共享留给能力库，v1 不做）。
 *   3. **解析宽容、序列化规范**：手写 md 里少几个段也要能读（缺段给默认），
 *      但我们写出去的永远是规范形态。
 */

import { DATA_DIR_NAME } from '../../data_dir.js';
import fs from 'node:fs';
import path from 'node:path';

/** 规则严重度（check 用） */
export type RuleLevel = 'error' | 'warn' | 'info';

/** 规则全部合法级别 */
export const RULE_LEVELS: readonly RuleLevel[] = ['error', 'warn', 'info'] as const;

/** 一条夹具（正例 = 应有 before→after；反例 = 只有一段代码且不得命中） */
export interface RuleFixture {
  /** 夹具说明（`##` 标题） */
  title: string;
  /** 正例的改写前代码；反例为 undefined */
  before?: string;
  /** 正例的改写后代码（期望结果）；反例为 undefined */
  after?: string;
  /** 反例代码（不得命中）；正例为 undefined */
  negative?: string;
  /** 语言标注（```ts 的 ts）；缺省 '' = 无标注 */
  lang: string;
}

export interface Rule {
  /** 规则 id（文件名，去 .md）；唯一 */
  id: string;
  title: string;
  tags: string[];
  level: RuleLevel;
  /** 目标语言（'typescript' | 'go' | …）；'' = 自动 */
  language: string;
  /** 萃取来源（ISO 时间或来源描述），仅追溯用 */
  createdFrom: string;
  /** 一句话说明（frontmatter 之后、首个代码块之前的正文） */
  description: string;
  /** 匹配模式（支持 `$hole` 元变量与 `...` 省略号） */
  pattern: string;
  /** 替换模板（`$hole` 回填） */
  replace: string;
  fixtures: RuleFixture[];
  /** 源文件绝对路径（读入时填；新建写盘时为 null） */
  sourcePath?: string;
}

/** 规则库目录：`<root>/.agent-io/rules/` */
export function rulesDir(root: string): string {
  return path.join(path.resolve(root), DATA_DIR_NAME, 'rules');
}

/** 棘轮基线文件：`<root>/.agent-io/rules/baseline.json` */
export function baselinePath(root: string): string {
  return path.join(rulesDir(root), 'baseline.json');
}

/* ────────────────────────── 解析 ────────────────────────── */

/** 取 ```lang\n…\n``` 的第一个围栏块（lang 精确匹配，缺省 = 无标注） */
function firstFence(body: string, lang: string): string | null {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'm');
  const m = re.exec(body);
  return m ? m[1].replace(/\n$/, '') : null;
}

/** 收集全部 ```lang``` 块（按出现顺序） */
function allFences(body: string, lang: string): string[] {
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(m[1].replace(/\n$/, ''));
  return out;
}

/** 解析极简 YAML frontmatter（只支持 key: value 与 key: [a, b] —— 够用且无依赖） */
function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      out[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      out[key] = val.replace(/^['"]|['"]$/g, '');
    }
  }
  return out;
}

/**
 * 解析一份规则 md。
 * 宽容策略：缺 pattern 直接抛（规则的核心缺失不可恢复）；其余段缺就取默认。
 */
export function parseRule(md: string, id: string, sourcePath?: string): Rule {
  const fmMatch = /^---\s*\n([\s\S]*?)\n---\s*\n?/.exec(md);
  const fm = fmMatch ? parseFrontmatter(fmMatch[1]) : {};
  const body = fmMatch ? md.slice(fmMatch[0].length) : md;

  const pattern = firstFence(body, 'pattern');
  if (pattern === null || pattern.trim() === '') {
    throw new Error(`规则 ${id} 缺少 \`\`\`pattern 块（规则的匹配模式不可缺省）`);
  }
  const replace = firstFence(body, 'replace') ?? '';

  // 说明 = frontmatter 之后、第一个围栏块之前的非空正文
  const firstFenceIdx = body.search(/```/);
  const descBlock = (firstFenceIdx >= 0 ? body.slice(0, firstFenceIdx) : body).trim();
  const description = descBlock.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';

  const levelRaw = String(fm.level ?? 'warn').trim() as RuleLevel;
  const level: RuleLevel = RULE_LEVELS.includes(levelRaw) ? levelRaw : 'warn';

  const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [String(fm.tags)] : [];

  return {
    id,
    title: String(fm.title ?? id),
    tags,
    level,
    language: String(fm.language ?? ''),
    createdFrom: String(fm.created_from ?? ''),
    description,
    pattern,
    replace,
    fixtures: parseFixtures(body),
    sourcePath,
  };
}

/**
 * 解析夹具段。
 * 约定：`## ` 开头的段 = 一个夹具；段内 `before:` / `after:` / `negative:` 标注后跟围栏块。
 * 简化规则（宽容）：
 *   - 段里出现 2 个代码块 ⇒ 正例（before=第1块, after=第2块）
 *   - 出现 1 个代码块且标题含"反例"（或 negative: 标注）⇒ 反例
 *   - 出现 1 个代码块且标题不含反例 ⇒ 单例（视为 negative，宁可保守不漏判）
 */
export function parseFixtures(body: string): RuleFixture[] {
  const sections = body.split(/\n(?=##\s)/).filter((s) => /^##\s/.test(s.trim()));
  const out: RuleFixture[] = [];
  for (const sec of sections) {
    const titleMatch = /^##\s*(.+)$/m.exec(sec);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // 收集本段全部围栏块（带语言标注）
    const fences: { lang: string; code: string }[] = [];
    const re = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sec))) fences.push({ lang: m[1] || '', code: m[2].replace(/\n$/, '') });
    if (fences.length === 0) continue;

    const isNeg = /反例|negative|不得命中|不应命中/.test(title) || /negative\s*:/i.test(sec);
    if (fences.length >= 2 && !isNeg) {
      out.push({ title, before: fences[0].code, after: fences[1].code, lang: fences[0].lang || fences[1].lang });
    } else {
      // 单块（或标了反例的多块取第一块）→ 反例
      out.push({ title, negative: fences[0].code, lang: fences[0].lang });
    }
  }
  return out;
}

/* ────────────────────────── 序列化 ────────────────────────── */

function fmLine(key: string, val: string | string[]): string {
  if (Array.isArray(val)) return `${key}: [${val.join(', ')}]`;
  return `${key}: ${val}`;
}

/** 规范序列化（我们写出去的永远长这样） */
export function serializeRule(rule: Rule): string {
  const lines: string[] = ['---'];
  lines.push(fmLine('id', rule.id));
  lines.push(fmLine('title', rule.title));
  if (rule.tags.length) lines.push(fmLine('tags', rule.tags));
  lines.push(fmLine('level', rule.level));
  if (rule.language) lines.push(fmLine('language', rule.language));
  if (rule.createdFrom) lines.push(fmLine('created_from', rule.createdFrom));
  lines.push('---', '');
  if (rule.description) lines.push(rule.description, '');
  lines.push('```pattern', rule.pattern, '```', '');
  lines.push('```replace', rule.replace, '```', '');
  for (const f of rule.fixtures) {
    lines.push('', `## ${f.title}`);
    if (f.negative !== undefined) {
      lines.push('', `negative:`, '```' + (f.lang || ''), f.negative, '```');
    } else {
      lines.push('', 'before:', '```' + (f.lang || ''), f.before ?? '', '```');
      lines.push('', 'after:', '```' + (f.lang || ''), f.after ?? '', '```');
    }
  }
  return lines.join('\n') + '\n';
}

/* ────────────────────────── 读写 ────────────────────────── */

export interface RuleLoadError {
  file: string;
  error: string;
}

export interface LoadRulesResult {
  rules: Rule[];
  errors: RuleLoadError[];
  dir: string;
}

/** 读入规则库（目录不存在 = 空库，不算错） */
export function loadRules(root: string): LoadRulesResult {
  const dir = rulesDir(root);
  const rules: Rule[] = [];
  const errors: RuleLoadError[] = [];
  if (!fs.existsSync(dir)) return { rules, errors, dir };
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const p = path.join(dir, name);
    const id = name.slice(0, -3);
    try {
      const md = fs.readFileSync(p, 'utf8');
      rules.push(parseRule(md, id, p));
    } catch (e) {
      errors.push({ file: name, error: (e as Error).message });
    }
  }
  rules.sort((a, b) => a.id.localeCompare(b.id));
  return { rules, errors, dir };
}

/** 写一条规则（同 id 覆盖）；返回写入路径 */
export function writeRule(root: string, rule: Rule): string {
  const dir = rulesDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${rule.id}.md`);
  fs.writeFileSync(p, serializeRule(rule), 'utf8');
  return p;
}

/** 合法规则 id（做文件名）：小写字母/数字/连字符，且不以连字符开头结尾 */
export function isLegalRuleId(id: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(id);
}

/** 规则是否带"反例夹具"（可靠性层的必要条件） */
export function hasNegativeFixture(rule: Rule): boolean {
  return rule.fixtures.some((f) => f.negative !== undefined && f.negative.trim() !== '');
}

/** 规则是否带"正例夹具" */
export function hasPositiveFixture(rule: Rule): boolean {
  return rule.fixtures.some((f) => f.before !== undefined && f.after !== undefined);
}
