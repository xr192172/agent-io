/**
 * package_migration · Python 语言包（.py）
 *
 * 从原单文件 `package_migration.ts` 拆出（逐字不改函数体，仅加 `export` / 改 import）。
 */
import { parseAstRoot } from '../../../../infrastructure/parse/index.js';
import type { SyntaxNodeLike } from '../../../../infrastructure/parse/index.js';
import type { AliasEdit, PmLangPackage } from '../parts.js';

/** `from <module> import …` 的模块路径（点分）。 */
function pyFromModule(stmt: SyntaxNodeLike): string | null {
  const m = stmt.text.match(/^\s*from\s+([.\w]+)\s+import/);
  return m ? m[1] : null;
}

/** 一条 Python import 的来源路径（import_statement 取首个项；import_from 取模块）。 */
function pyImportSource(stmt: SyntaxNodeLike): string | null {
  if (stmt.type === 'import_statement') {
    for (let i = 0; i < stmt.childCount; i++) {
      const c = stmt.child(i);
      if (!c) continue;
      if (c.type === 'aliased_import') {
        const n = c.childForFieldName('name');
        if (n) return n.text;
      }
      if (c.type === 'dotted_name') return c.text;
    }
    return null;
  }
  if (stmt.type === 'import_from_statement') return pyFromModule(stmt);
  return null;
}

/** 收集 Python 「目标 source 的 import」引入的绑定名 identifier（aliased 别名 / 直导入的首段）。 */
function collectPyBinds(
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
    const isFrom = stmt.type === 'import_from_statement';
    const fromModule = isFrom ? pyFromModule(stmt) : null;
    for (let i = 0; i < stmt.childCount; i++) {
      const c = stmt.child(i);
      if (!c) continue;
      if (c.type === 'aliased_import') {
        check(c.childForFieldName('alias')); // `import p as from` / `from p import X as from`
      } else if (c.type === 'dotted_name') {
        if (isFrom && c.text === fromModule) continue; // 模块本身非绑定
        const first = c.child(0);
        if (first && first.type === 'identifier') check(first);
      }
    }
  };
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'import_statement' || n.type === 'import_from_statement') {
      if (pyImportSource(n) === exactPath) collect(n);
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

/** Python 用法点：`attribute` 的 object 标识符 === from → to（`from.X`）。 */
function collectPyUsage(node: SyntaxNodeLike, from: string, to: string): AliasEdit[] {
  const edits: AliasEdit[] = [];
  const walk = (n: SyntaxNodeLike): void => {
    if (n.type === 'attribute') {
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

/** Python AST 守卫 + 精确替换（对齐 Go 语义）。 */
async function pyAliasEdits(
  src: string,
  exactPath: string,
  from: string,
  to: string,
  fileAbs: string,
): Promise<{ ok: boolean; edits: AliasEdit[] }> {
  const r = await parseAstRoot(fileAbs, src);
  if (!r) return { ok: false, edits: [] };
  const b = collectPyBinds(r.root, exactPath, from);
  if (!b.hasFrom) return { ok: true, edits: [] }; // 守卫命中：from 非该 source 的绑定 → 跳过
  const edits: AliasEdit[] = [];
  for (const id of b.fromBinds) {
    const tS = id.startIndex ?? 0;
    const tE = id.endIndex ?? tS + id.text.length;
    edits.push({ start: tS, end: tE, replacement: to });
  }
  if (to && to !== from) edits.push(...collectPyUsage(r.root, from, to));
  return { ok: true, edits };
}

/**
 * ★ 本语言包 —— `exts` 与实现**同文件**（与 `contract_gate` 同形）：
 * 注册表只 import 并收集，**不再把 `exts` 写在别处**。
 */
export const pyPackage: PmLangPackage = {
  exts: ['.py'],
  collect: (a) => pyAliasEdits(a.src, a.exactPath, a.from, a.to, a.fileAbs),
};
