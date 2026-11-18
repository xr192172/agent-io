/**
 * SQL / XML 轻量 TS 降级提取器（card-mybatis / T-#SQLXML-NATIVE）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ★★ 诚实降级：**原生 grammar 不可用时使用**，不假装精确。
 *
 * 为什么存在（本机实测，2026-11-17）：
 *   tree-sitter-sql / tree-sitter-xml 两个 npm 包只有 `node-gyp rebuild`、
 *   没有预编译 .node；本机无 C++ 编译器（cl/clang/gcc 全无、VS/Windows Kits 未装）
 *   ⇒ 无法编译。其余 grammar 能工作是因为包内自带 prebuild .node。
 *   ⇒ 这里只提取本卡真实需要的东西，且每个符号的 signature 都带 `[ts-fallback]`
 *     前缀、ParsedFile.parser='ts-fallback'，消费方与回执都能看出来源。
 *
 * 可回切（T-#SQLXML-NATIVE）：装了 VS C++ Build Tools 后，原生 grammar 可用 ⇒
 *   kernel 优先用 tree-sitter，本降级自然退场（见 kernel.parseFileFull 的分支）。
 *
 * 提取范围（刻意最小，不产出装作精确的东西）：
 *   XML：`<mapper namespace="…">` 一个 type 符号；`<select|insert|update|delete id="…">`
 *        每条一个 method 符号；元素名（mapper 的子元素）不单独造符号（避免噪音）。
 *   SQL：`CREATE TABLE [IF NOT EXISTS] <name>` 每个一个 type 符号（表名去掉引号/库前缀）。
 *        不提取列、约束、索引（那需要真正的语法树，本降级不假装能做）。
 * ═══════════════════════════════════════════════════════════════════════════
 */
import type { ParsedFile, ParsedSymbol } from './kernel.js';

export const FALLBACK_PARSER = 'ts-fallback';

/** 这条符号由降级提取器产出（signature 前缀，可读可查；不改 DB schema） */
export const FALLBACK_SIG_PREFIX = `[${FALLBACK_PARSER}]`;

function sym(
  name: string,
  kind: ParsedSymbol['kind'],
  line: number,
  signature: string,
  parent?: string,
): ParsedSymbol {
  return {
    name,
    kind,
    start_line: line,
    end_line: line,
    qualified_name: parent ? `${parent}.${name}` : name,
    signature: `${FALLBACK_SIG_PREFIX} ${signature}`,
    parent,
  };
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** XML：namespace + CRUD statement id（轻量文本提取，非完整 XML 解析） */
function parseXml(text: string): ParsedFile {
  const symbols: ParsedSymbol[] = [];
  const mapper = /<mapper\b[^>]*\bnamespace\s*=\s*(["'])([^"']+)\1/i.exec(text);
  const ns = mapper?.[2] ?? '';
  // namespace 也是"接口 FQN 候选"——造一个 type 符号承载它，供 mapper_statement 边定位
  if (ns) symbols.push(sym(ns, 'type', mapper ? lineOf(text, mapper.index) : 1, `namespace ${ns}`));
  const stmtRe = /<(select|insert|update|delete)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(text)) !== null) {
    const id = /\bid\s*=\s*(["'])([^"']+)\1/i.exec(m[2])?.[2];
    if (!id) continue; // 没有 id 的语句无法与接口方法对账 ⇒ 不造符号（不假装）
    symbols.push(sym(id, 'method', lineOf(text, m.index), `${m[1].toLowerCase()} ${id}`, ns || undefined));
  }
  return { symbols, imports: [], calls: [], type_refs: [], parser: FALLBACK_PARSER };
}

/** SQL：CREATE TABLE 表名（轻量文本提取，非完整 SQL 解析） */
function parseSql(text: string): ParsedFile {
  const symbols: ParsedSymbol[] = [];
  // 表名 = 点分的一段或多段标识符，每段可被引号包裹（`mydb`.`users`、`[dbo].[t]`、"s"."t"）
  // 用宽松扫描：从 CREATE TABLE 后截取到空白/左括号，再逐段剥引号、去库前缀。
  const re = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/[`"[\]]/g, ''); // 剥引号 → mydb.users
    const name = raw.split('.').pop() ?? raw; // 去库名前缀
    if (!name || !/^[\w$]+$/.test(name)) continue; // 拿不到干净标识符就不造（不假装）
    symbols.push(sym(name, 'type', lineOf(text, m.index), `CREATE TABLE ${raw}`));
  }
  return { symbols, imports: [], calls: [], type_refs: [], parser: FALLBACK_PARSER };
}

/**
 * 降级入口。只有 sql/xml 扩展名会命中；其余返回 null（调用方照旧走原生路径）。
 * 即使 grammar 后来可装，kernel 也只在原生不可用时才调用本函数。
 */
export function parseSqlXmlFallback(filePath: string, content: string): ParsedFile | null {
  const ext = '.' + (filePath.split('.').pop() || '').toLowerCase();
  if (ext === '.xml') return parseXml(content);
  if (ext === '.sql') return parseSql(content);
  return null;
}
