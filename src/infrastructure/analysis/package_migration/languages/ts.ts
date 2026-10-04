/**
 * package_migration · TS/JS 家族语言包（.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts）
 *
 * 从原单文件 `package_migration.ts` 拆出（逐字不改函数体，仅加 `export` / 改 import）。
 */
import { parseAstRoot } from '../../../../infrastructure/parse/index.js';
import type { SyntaxNodeLike } from '../../../../infrastructure/parse/index.js';
import { stripQuotes, type AliasEdit, type PmLangPackage } from '../parts.js';
import { TS_JS_EXTS } from '../../../../infrastructure/parse/source_exts.js';

/** 收集 TS 中「目标 source 的 import」引入的绑定名 identifier 节点（default/namespace/named）。 */
function collectTsBinds(
  node: SyntaxNodeLike,
  exactPath: string,
  from: string,
): { hasFrom: boolean; fromBinds: SyntaxNodeLike[] } {
  const fromBinds: SyntaxNodeLike[] = [];
  let hasFrom = false;
  const check = (id: SyntaxNodeLike | null): void => {
    if (id && id.type === 'identifier' && id.text === from) {
      hasFrom = true;
      fromBinds.push(id);
    }
  };
  const collect = (stmt: SyntaxNodeLike): void => {
    for (let i = 0; i < stmt.childCount; i++) {
      const c = stmt.child(i);
      if (!c || c.type !== 'import_clause') continue;
      for (let j = 0; j < c.childCount; j++) {
        const cc = c.child(j);
        if (!cc) continue;
        if (cc.type === 'identifier') {
          // default import：`import from "p"`
          check(cc);
        } else if (cc.type === 'namespace_import') {
          // `import * as from "p"`
          for (let k = 0; k < cc.childCount; k++) {
            const x = cc.child(k);
            if (x && x.type === 'identifier') check(x);
          }
        } else if (cc.type === 'named_imports') {
          for (let k = 0; k < cc.childCount; k++) {
            const sp = cc.child(k);
            if (!sp || sp.type !== 'import_specifier') continue;
            const alias = sp.childForFieldName('alias');
            check(alias ?? sp.childForFieldName('name'));
          }
        }
      }
    }
  };
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'import_statement') {
      const s = n.childForFieldName('source');
      if (s && stripQuotes(s.text) === exactPath) collect(n);
      return;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) walk(c);
    }
  };
  walk(node);
  return { hasFrom, fromBinds };
}

/** TS 用法点：`member_expression` 的 object 标识符 === from → to（`from.X`）。 */
function collectTsUsage(node: SyntaxNodeLike, from: string, to: string): AliasEdit[] {
  const edits: AliasEdit[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'member_expression') {
      const obj = n.childForFieldName('object');
      if (obj && obj.type === 'identifier' && obj.text === from) {
        const tS = obj.startIndex ?? 0;
        const tE = obj.endIndex ?? tS + obj.text.length;
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

/** TS 家族 AST 守卫 + 精确替换（对齐 Go 语义）。 */
async function tsAliasEdits(
  src: string,
  exactPath: string,
  from: string,
  to: string,
  fileAbs: string,
): Promise<{ ok: boolean; edits: AliasEdit[] }> {
  const r = await parseAstRoot(fileAbs, src);
  if (!r) return { ok: false, edits: [] };
  const b = collectTsBinds(r.root, exactPath, from);
  if (!b.hasFrom) return { ok: true, edits: [] }; // 守卫命中：from 非该 source 的绑定 → 跳过
  const edits: AliasEdit[] = [];
  for (const id of b.fromBinds) {
    const tS = id.startIndex ?? 0;
    const tE = id.endIndex ?? tS + id.text.length;
    edits.push({ start: tS, end: tE, replacement: to });
  }
  if (to && to !== from) edits.push(...collectTsUsage(r.root, from, to));
  return { ok: true, edits };
}

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 * ★ TS/JS 家族用内核权威 `TS_JS_EXTS`（**不要手抄**那 8 个扩展名）。
 */
export const tsPackage: PmLangPackage = {
  exts: TS_JS_EXTS,
  collect: (a) => tsAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
};
