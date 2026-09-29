/**
 * ★ 契约门 · 内核里不许有「按语言 if」（2026-09-29 扩契约的**判据**）
 *
 * 用户方针（逐字）：
 *   「**语言无关**（工具自动按语言路由到对应语言接口（模式））」
 *   「**if 会不会太屎山了**」⇒ 同意做契约扩展，**不许**再用"加一门语言加一个 if"的方式补。
 *
 * 本门的判据（可 grep、可判红、与文件位置无关）：
 *   ① `src/tools/ts_kernel/kernel.ts` 里**不许出现按语言分支** ——
 *      `langName === 'xxx'` / `lang.name === 'xxx'` / `lang.pkg === 'xxx'` /
 *      `new Set(['typescript', …])` 这类"把语言名写进控制流"的写法。
 *      知识只有两个合法落点：`languages.ts` 的 LANGUAGES 表项（注册事实）
 *      与 kernel.ts 的 LANG_ADAPTERS 表项（深适配契约）—— **都是数据**。
 *   ② 三个"屎山原址"的具体知识不许回潮：cpp 声明符包装 Set、callee 的
 *      `'function'|'name'|'method'` 串、body 的 `'body'|'suite'` 两个字面量。
 *   ③ 反向自检（证明本门不哑）：判据函数对**注入**的按语言 if 必须判红；
 *      且剥离函数**只去注释、保留字符串**（剥字符串会把证据一并抹掉 ⇒ 空门，已修）。
 *
 * ⚠️ 已知**保留项**（不是漏改，见提交信息「没验什么」）：
 *   · `DEFAULT_NAME_NODE_TYPES` / `DEFAULT_BODY_FIELDS`：两个**跨语言命名惯例默认值**
 *     （不是按语言分支），保留它是为了不让表里 50+ 门未实测语言的既有行为退化。
 *   · `nodeTypeToKind` 的节点名启发式链、TS 系 `type_identifier`/`lexical_declaration` 等
 *     **跨语言的节点名形态**：本笔不在范围内（是"结构知识"，不是"按语言分派"）。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANG_ADAPTERS } from '../../src/tools/ts_kernel/kernel.js';
import { LANGUAGES } from '../../src/tools/ts_kernel/languages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const KERNEL = path.join(REPO, 'src', 'tools', 'ts_kernel', 'kernel.ts');

/**
 * 只去掉注释、**保留字符串字面量** —— 判据要看的是"代码里有没有把语言名写进比较"，
 * 所以字符串必须留着（`langName === 'go'` 的 `'go'` 正是证据）。
 *
 * ⚠️ 早期版本这里自己写了一个逐字符扫描器、把字符串也替换成 `STR`，两个后果：
 *   ① `langName === 'go'` → `langName === STR` ⇒ 正则永远匹配不到 ⇒ **主断言退化成空门（假绿）**；
 *   ② 逐字符扫描会被正则字面量带失步（本仓 kernel.ts 有 `/…[<"]…/` 含引号的正则）。
 * 现改为**按行剥注释**，与 G4 同族的 `tests/duplicate_literal_tables.test.ts` 用同一形态
 * （仓内既有约定：注释行以 `//` / `*` / `/*` 开头即整行丢弃，字符串不动）。
 * 副作用方向是安全的：漏剥一条行尾注释只会造成**误报（判红）**，不会漏掉真分支。
 * 出生证见 `it('剥注释保留字符串…')` 与 `it('判据自身有效…')`。
 */
export function stripComments(src: string): string {
  return src
    .split('\n')
    .map((l) => {
      const t = l.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l;
    })
    .join('\n');
}

/**
 * 判据本体（纯函数：吃源码文本，吐命中列表）。
 * 两类命中：
 *   ① 按语言分支：`<langish> === '语言名'`，其中 langish 形如 lang/langName/pkg/defExt
 *   ② 「把语言名集合写进代码」：`new Set(['typescript', 'tsx', …])` 且集合里 ≥2 个已知语言名
 */
export function findPerLanguageBranches(code: string): string[] {
  const known = new Set(LANGUAGES.map((l) => l.name).concat(['ts', 'js', 'py', 'csharp']));
  const hits: string[] = [];
  // ① langName === 'go' / lang.name === 'go' / lang.pkg === 'cpp' / ext === '.py'
  for (const m of code.matchAll(/\b(langName|langName2|lang|langs|pkg|defExt|extension|ext)\b[^\n]{0,24}?[!=]==?\s*['"]([A-Za-z_][\w]*|\.\w+)['"]/g)) {
    const raw = m[2].replace(/^\./, '').toLowerCase();
    if (raw === 'ts' || raw === 'js' || raw === 'py') continue; // 裸缩写太泛（可能是局部变量），另有手段覆盖
    if (known.has(raw)) hits.push(`按语言分支：${m[0].trim()}`);
  }
  // ② new Set(['typescript', 'tsx', …]) 里塞语言名
  for (const m of code.matchAll(/new\s+Set\(\s*\[([^\]]*)\]/g)) {
    const words = [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map((w) => w[1]).filter((w) => known.has(w));
    if (words.length >= 2) hits.push(`代码里的语言名单集合：new Set([${words.join(', ')}])`);
  }
  return hits;
}

describe('G12 · 内核无「按语言 if」门（契约扩展的判据）', () => {
  it('判据自身有效：对注入的按语言 if 会判红（出生证）', () => {
    expect(findPerLanguageBranches("if (langName === 'go') { x(); }").length).toBeGreaterThan(0);
    expect(findPerLanguageBranches("if (lang.name === 'python') { y(); }").length).toBeGreaterThan(0);
    expect(findPerLanguageBranches("const F = new Set(['typescript', 'tsx', 'javascript']);").length).toBeGreaterThan(0);
    // 对照：数据表（不是控制流）不该判红
    expect(findPerLanguageBranches("go: { callNode: 'call_expression' },")).toEqual([]);
    expect(findPerLanguageBranches("const name = 'go';")).toEqual([]);
  });

  it('判据只看代码不看注释：注释里引用历史写法不算违规', () => {
    expect(stripComments("// 原先这里是 langName === 'java' ? … : null\nconst a = 1;")).not.toContain('java');
    expect(findPerLanguageBranches(stripComments("/* langName === 'go' */ const a = 1;"))).toEqual([]);
  });

  it('剥注释保留字符串：真·按语言 if 仍能判红（修掉"剥字符串 ⇒ 空门"的盲区）', () => {
    const real = "if (langName === 'go') { x(); }";
    // 剥离后，字符串字面量 'go' 必须仍在，才能被 ① 抓到
    expect(stripComments(real)).toContain("'go'");
    expect(findPerLanguageBranches(stripComments(real)).length).toBeGreaterThan(0);
    // 同样地，硬编码 callee 字段串剥离后必须仍可被 test ④ 的正则命中
    expect(stripComments("callNode.childForFieldName('name')")).toContain("'name'");
  });

  it('★ src/tools/ts_kernel/kernel.ts 里没有按语言分支', () => {
    const code = stripComments(fs.readFileSync(KERNEL, 'utf8'));
    const hits = findPerLanguageBranches(code);
    expect(
      hits,
      '内核里出现按语言分支 —— 这门语言的知识该落进 LANGUAGES / LANG_ADAPTERS 的**数据字段**：\n  ' +
        hits.join('\n  '),
    ).toEqual([]);
  });

  it('三个"屎山原址"的具体知识不许回潮（cpp 包装 Set / callee 字段串 / body 字面量串）', () => {
    const code = stripComments(fs.readFileSync(KERNEL, 'utf8'));
    // 原先 extractCallee 的 `'function' || 'name' || 'method'` 硬编码串
    expect(code).not.toMatch(/childForFieldName\(\s*'name'\s*\)\s*\|\|\s*callNode\.childForFieldName/);
    // 原先 findBodyNode 的字段字面量串（现走适配器 bodyFields；缺省值在 DEFAULT_BODY_FIELDS 常量里）
    expect(code).not.toMatch(/childForFieldName\(\s*'body'\s*\)\s*\|\|\s*node\.childForFieldName\(\s*'suite'\s*\)/);
    // 原先 extractName 的 cpp 包装 Set 名（现是 C/C++ 表项的 nameNodeTypes 数据）
    expect(code).not.toContain('CPP_DECLARATOR_WRAPPERS');
  });

  it('知识都在数据里：C/C++ 声明符链、Java/Groovy object 字段、Haskell 体字段都能从表项读到', () => {
    for (const lang of ['c', 'cpp']) {
      expect(LANG_ADAPTERS[lang]!.nameNodeTypes, `${lang} 缺 nameNodeTypes`).toContain('pointer_declarator');
    }
    expect(LANG_ADAPTERS['java']!.calleeObjectField).toBe('object');
    expect(LANG_ADAPTERS['groovy']!.calleeObjectField).toBe('object');
    expect(LANG_ADAPTERS['haskell']!.bodyFields).toContain('match');
    expect(LANG_ADAPTERS['elixir']!.symbolDispatch?.kinds.defmodule).toBe('class');
    expect(LANG_ADAPTERS['julia']!.bodyIsSelf).toBe(true);
  });
});
