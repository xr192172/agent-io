/**
 * package_migration · Go 语言包
 *
 * 从原单文件 `package_migration.ts` 拆出（逐字不改函数体，仅加 `export` / 改 import）。
 * 只做 Go 的「import 别名声明 + `alias.X` 选择器用法」采集，产出编辑点交 core 应用。
 */
import { parseAstRoot } from '../../../../infrastructure/parse/index.js';
import type { SyntaxNodeLike } from '../../../../infrastructure/parse/index.js';
import { stripQuotes, type AliasEdit, type PmLangPackage } from '../parts.js';

/** 收集 `from` 在该文件中作为 `exactPath` 的 import 别名声明点。 */
function collectGoImportAliasEdits(
  node: SyntaxNodeLike,
  exactPath: string,
  from: string,
  to: string,
): { edits: AliasEdit[]; confirmed: boolean } {
  let confirmed = false;
  const edits: AliasEdit[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (!c) continue;
      if (c.type === 'import_spec') {
        const pathNode = c.childForFieldName('path');
        const p = pathNode ? stripQuotes(pathNode.text) : '';
        if (pathNode && p === exactPath) {
          const aliasNode = c.childForFieldName('name'); // import_spec 的"别名"字段
          if (aliasNode && aliasNode.text === from) {
            confirmed = true;
            if (!to) {
              // 去掉别名：删 `alias "path"` 中 alias+空白，保留 path
              const specStart = c.startIndex ?? 0;
              const pathStart = pathNode.startIndex ?? specStart;
              if (pathStart > specStart) edits.push({ start: specStart, end: pathStart, replacement: '' });
            } else if (to !== from) {
              const tS = aliasNode.startIndex ?? 0;
              const tE = aliasNode.endIndex ?? tS + aliasNode.text.length;
              edits.push({ start: tS, end: tE, replacement: to });
            }
          }
        }
        continue; // import_spec 内部不再深挖
      }
      walk(c);
    }
  };
  walk(node);
  return { edits, confirmed };
}

/** 收集 Go `selector_expression` 左操作数 `from` 的用法点（包别名调用 `from.X`）→ `to`。 */
function collectGoSelectorEdits(node: SyntaxNodeLike, from: string, to: string): AliasEdit[] {
  const edits: AliasEdit[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'import_declaration' || n.type === 'import_spec_list') return; // 跳过 import 区
    if (n.type === 'selector_expression') {
      const x = n.child(0);
      if (x && x.type === 'identifier' && x.text === from) {
        const tS = x.startIndex ?? 0;
        const tE = x.endIndex ?? tS + x.text.length;
        edits.push({ start: tS, end: tE, replacement: to });
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return edits;
}

/**
 * Go AST 作用域守卫 + 精确替换（root cause 拦截）：
 * 仅在「本文件确有 `from` 作为 `exactPath` 的 import 别名」时才生成编辑点；
 * 否则（守卫命中）返回空编辑，调用方按原样跳过——修复「from 是局部变量
 * （如 v2.Get）却被正则无差别地 `\bfrom\.` 改掉」的根因。
 * 返回 { ok:false } 表示解析失败（语言包缺失/退化环境），调用方据此回退正则。
 */
async function goAliasEdits(
  src: string,
  exactPath: string,
  from: string,
  to: string,
  fileAbs: string,
): Promise<{ ok: boolean; edits: AliasEdit[] }> {
  const r = await parseAstRoot(fileAbs, src);
  if (!r || r.langName !== 'go') return { ok: false, edits: [] };
  const { root } = r;

  const imp = collectGoImportAliasEdits(root, exactPath, from, to);
  if (!imp.confirmed) return { ok: true, edits: [] }; // 守卫命中：from 非该 importPath 别名 → 跳过

  const edits = [...imp.edits];
  if (to && to !== from) edits.push(...collectGoSelectorEdits(root, from, to));
  return { ok: true, edits };
}

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 */
export const goPackage: PmLangPackage = {
  exts: ['.go'],
  collect: (a) => goAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
};
