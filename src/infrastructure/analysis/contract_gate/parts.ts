/**
 * contract_gate · 公共零件（语言无关的接线层）
 *
 * ★★ 为什么单独一个文件（照 `rename_symbol` 第 1 例，2026-10-01）：
 *   这些零件**语言包和 core 都要用**。若它们住在 `core.ts` 里，就形成
 *     `core → languages/registry → languages/<lang> → core` 的**环**。
 *   抽出来之后：`core → parts`、`languages/<lang> → parts` —— **回边消失**。
 */

/** 语言代号（`.` 左侧裸标识符定义源对账所支持的语言） */
export type Lang = 'go' | 'ts' | 'py' | 'java' | 'cs' | 'c';

/**
 * 单文件"定义来源"并集：声明 ∪ import 别名 ∪ 局部名。
 * ★ 采用文件级并集（非精确作用域）——牺牲一丝精度换取近零误报（见模块头注"低误报优先"）。
 */
export interface FileSymbols {
  declared: Set<string>;
  aliases: Set<string>;
  locals: Set<string>;
}

/** 一处 `X.` 形式引用（行号 + 裸标识符） */
export interface RefHit {
  line: number;
  ident: string;
}

/**
 * `X.` 形式引用的**语言无关**扫描主流程。
 * 各语言包只提供自己的 `skip` 保留字集，以及可选的"整行跳过"钩子
 * （如 Java/C# 的 `import`/`package`/`using`/`namespace` 行不是"使用点"）。
 */
export function scanDotRefs(
  text: string,
  skip: ReadonlySet<string>,
  skipLine?: (line: string) => boolean,
): RefHit[] {
  const out: RefHit[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (skipLine && skipLine(line)) continue;
    for (const m of line.matchAll(/([A-Za-z_][\w]*)\s*\./g)) {
      const ident = m[1];
      if (skip.has(ident)) continue;
      out.push({ line: i + 1, ident });
    }
  }
  return out;
}

/**
 * 语言包契约：`Lang → { 扩展名 / 保留字 / 全局白名单 / 符号与引用采集 }`。
 * `core` 只认这个接口，按 `Lang` 查表，不认识具体语言。
 */
export interface CgLangPackage {
  readonly lang: Lang;
  /** 这个包负责哪些扩展名（小写，含点，如 '.go'）—— 供 langOfFile 派生映射，**不另抄一份** */
  readonly exts: readonly string[];
  /** `.` 左侧绝不可能代表"包/接收者引用"的标识符（保留字 / 关键字） */
  readonly reserved: ReadonlySet<string>;
  /** 全局对象白名单（避免 Math/System/内建类型等误判成未定义）；无内建对象引用的语言省略 */
  readonly globals?: ReadonlySet<string>;
  collectSymbols(text: string): FileSymbols;
  collectReferences(text: string): RefHit[];
}

/**
 * 死代码保留（逐字搬迁，2026-10-01）：原 `collectSymbols` 里定义的 `addDeclared` ——
 * 全仓**从未被调用**（各语言分支一律直接 `declared.add(...)`）。为守"函数体逐字不改"纪律，
 * 随拆分搬到公共零件层，只做机械改写：闭包捕获的 `declared` → 参数 `set`。
 * ★ 诚实备注：这是死代码；如需清理应单独一笔（不在本次搬迁范围内）。
 */
export function addDeclared(set: Set<string>, m: RegExpMatchArray | null, idx = 1): void {
  if (m && m[idx]) {
    for (const g of m.slice(idx)) if (g) set.add(g);
  }
}
