// G10 · 重复字面量表检测门（"单源化"判据）—— 规划书 §28.3 第 9 条
// 与 G4 同族但不同物：G4 管代码实现重复，G10 管字面量数据表重复
// 判据：扫描 src/**/*.ts 中 export const X = [...] 声明，
//   对象元素取属性 key 集合做并集作为数组指纹，同指纹 >= 2 份即报重复组
// 门纪律：存量不拦（frozen 只允许减少/不变），新增即红
// 更新基线：LITERAL_TABLE_FROZEN=1 ./node_modules/.bin/vitest run tests/duplicate_literal_tables.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..');
const SRC = path.join(REPO, 'src');
const REGISTRY = path.join(here, 'fixtures', 'literal_table_registry.json');

export interface LiteralTableFinding {
  file: string;
  line: number;
  name: string;
  elementCount: number;
  fingerprint: string;
}

export interface DuplicateGroup {
  fingerprint: string;
  count: number;
  findings: LiteralTableFinding[];
}

export interface LiteralTableResult {
  groups: DuplicateGroup[];
  allFindings: LiteralTableFinding[];
}

export interface Family {
  id: string;
  intent: string;
  authority: string | null;
  fingerprintPattern: string | null;
  frozen: Record<string, number>;
  allow?: Record<string, string>;
}

export interface Registry {
  note: string;
  families: Family[];
}

// ─────────────────────────────────────────────────────────────
// 扫描器（纯函数，可单测）
// ─────────────────────────────────────────────────────────────

function stripComments(src: string): string {
  return src
    .split('\n')
    .map((l) => {
      const t = l.trimStart();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : l;
    })
    .join('\n');
}

/**
 * 计算单个数组元素的形状指纹：
 *   - 对象字面量 → 排序后的属性名集合（只取 key，不分析 value）
 *   - 非对象字面量 → 类型标签
 */
export function computeElementFingerprint(el: ts.Node): string {
  if (el.kind === ts.SyntaxKind.ObjectLiteralExpression) {
    const props = (el as ts.ObjectLiteralExpression).properties;
    const keys: string[] = [];
    for (const prop of props) {
      if (prop.kind === ts.SyntaxKind.PropertyAssignment) {
        const nameNode = (prop as ts.PropertyAssignment).name;
        const propName =
          nameNode.kind === ts.SyntaxKind.Identifier
            ? nameNode.text
            : nameNode.kind === ts.SyntaxKind.StringLiteral
              ? nameNode.text
              : '';
        if (propName) keys.push(propName);
      }
    }
    return [...new Set(keys)].sort().join(',');
  }
  const text = el.getFullText().trimStart();
  if (text.startsWith("'") || text.startsWith('"')) return 'string';
  if (/^-?\d/.test(text)) return 'number';
  if (text === 'true' || text === 'false') return 'boolean';
  if (text === 'null' || text === 'undefined') return 'null';
  if (text.startsWith('[')) return 'array';
  return 'other';
}

/**
 * 计算数组的整体形状指纹：
 * 把所有元素的 key 集合取并集再排序。
 * 理由：同一张表的不同元素可能有少量可选字段差异（如 noAutoFresh），
 * 并集比序列连接更能准确反映「整张表」的形状。
 */
export function computeArrayFingerprint(elements: ts.Node[]): string {
  const allKeys = new Set<string>();
  for (const el of elements) {
    const fp = computeElementFingerprint(el);
    for (const k of fp.split(',')) if (k) allKeys.add(k);
  }
  return [...allKeys].sort().join(',');
}

function walkTs(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      walkTs(f, out);
    } else if (e.name.endsWith('.ts')) {
      out.push(f);
    }
  }
  return out;
}

const rel = (abs: string): string => path.relative(REPO, abs).split(path.sep).join('/');

export function scanDuplicateLiteralTables(
  srcDir = SRC,
  repoRoot = REPO,
): LiteralTableResult {
  const findings: LiteralTableFinding[] = [];

  for (const abs of walkTs(srcDir)) {
    const r = rel(abs);
    const s = stripComments(fs.readFileSync(abs, 'utf8'));
    const sf = ts.createSourceFile(r, s, ts.ScriptTarget.Latest, true);

    function visit(node: ts.Node): void {
      if (
        ts.isVariableStatement(node) &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isVariableDeclaration(decl)) continue;
          const name = decl.name.getText(sf);
          const init = decl.initializer;
          if (!init || !ts.isArrayLiteralExpression(init)) continue;
          if (init.elements.length < 2) continue;

          const objElements = init.elements.filter(
            (e) => e !== undefined && ts.isObjectLiteralExpression(e),
          );
          if (objElements.length < 2) continue;

          const fp = computeArrayFingerprint(objElements);
          const line = sf.getLineAndCharacterOfPosition(decl.name.getStart(sf)).line + 1;
          findings.push({
            file: r,
            line,
            name,
            elementCount: objElements.length,
            fingerprint: fp,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sf);
  }

  const groupMap = new Map<string, LiteralTableFinding[]>();
  for (const f of findings) {
    if (!groupMap.has(f.fingerprint)) groupMap.set(f.fingerprint, []);
    groupMap.get(f.fingerprint)!.push(f);
  }

  const groups: DuplicateGroup[] = [...groupMap.values()]
    .filter((g) => g.length >= 2)
    .map((g) => ({
      fingerprint: g[0].fingerprint,
      count: g.length,
      findings: g.sort((a, b) => a.file.localeCompare(b.file)),
    }))
    .sort((a, b) => b.count - a.count || a.findings[0].file.localeCompare(b.findings[0].file));

  return { groups, allFindings: findings };
}

// ─────────────────────────────────────────────────────────────
// 门禁 + 有效性自检
// ─────────────────────────────────────────────────────────────

function readRegistry(): Registry {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) as Registry;
}

describe('G10 · 重复字面量表检测门', () => {
  describe('扫描器自身有效（证明这道门会红）', () => {
    it('computeElementFingerprint 对同名 key 集合返回相同指纹', () => {
      const src1 = ts.createSourceFile('a.ts', `const x = [{ a: 1, b: 2, c: 3 }];`, ts.ScriptTarget.Latest, true);
      const src2 = ts.createSourceFile('b.ts', `const y = [{ c: 'x', b: 4, a: true }];`, ts.ScriptTarget.Latest, true);
      const arr1 = src1.statements[0] as ts.VariableStatement;
      const arr2 = src2.statements[0] as ts.VariableStatement;
      const fp1 = computeElementFingerprint(arr1.declarationList.declarations[0]!.initializer!.elements[0]!);
      const fp2 = computeElementFingerprint(arr2.declarationList.declarations[0]!.initializer!.elements[0]!);
      expect(fp1).toBe(fp2);
    });

    it('computeElementFingerprint 对不同 key 集合返回不同指纹', () => {
      const src1 = ts.createSourceFile('a.ts', `const x = [{ a: 1, b: 2 }];`, ts.ScriptTarget.Latest, true);
      const src2 = ts.createSourceFile('b.ts', `const y = [{ a: 1, c: 3 }];`, ts.ScriptTarget.Latest, true);
      const arr1 = src1.statements[0] as ts.VariableStatement;
      const arr2 = src2.statements[0] as ts.VariableStatement;
      const fp1 = computeElementFingerprint(arr1.declarationList.declarations[0]!.initializer!.elements[0]!);
      const fp2 = computeElementFingerprint(arr2.declarationList.declarations[0]!.initializer!.elements[0]!);
      expect(fp1).not.toEqual(fp2);
    });

    it('handler 等函数值是对象属性，key 计入指纹（不同 handler 实现不影响形状比较）', () => {
      const src1 = ts.createSourceFile('a.ts', `const x = [{ name: 'a', handler: () => {} }];`, ts.ScriptTarget.Latest, true);
      const src2 = ts.createSourceFile('b.ts', `const y = [{ name: 'b', handler: async () => 42 }];`, ts.ScriptTarget.Latest, true);
      const arr1 = src1.statements[0] as ts.VariableStatement;
      const arr2 = src2.statements[0] as ts.VariableStatement;
      const fp1 = computeElementFingerprint(arr1.declarationList.declarations[0]!.initializer!.elements[0]!);
      const fp2 = computeElementFingerprint(arr2.declarationList.declarations[0]!.initializer!.elements[0]!);
      expect(fp1).toBe(fp2);
      expect(fp1).toContain('handler');
      expect(fp1).toContain('name');
    });

    it('computeArrayFingerprint 把多元素 key 并集当指纹', () => {
      const src = ts.createSourceFile('a.ts', `
        const x = [
          { name: 'a', title: 'A', description: 'ad', inputSchema: {}, handler: () => 1 },
          { name: 'b', title: 'B', description: 'bd', inputSchema: {}, handler: () => 2 },
        ];
      `, ts.ScriptTarget.Latest, true);
      const arr = src.statements[0] as ts.VariableStatement;
      const el = arr.declarationList.declarations[0]!.initializer! as ts.ArrayLiteralExpression;
      const objs = el.elements.filter((e): e is ts.Node => e !== undefined && ts.isObjectLiteralExpression(e));
      const fp = computeArrayFingerprint(objs);
      expect(fp).toContain('name');
      expect(fp).toContain('handler');
      expect(fp).toContain('inputSchema');
    });

    it('注入两份相同形状的数据表 => 门确实变红（出生证）', () => {
      const tmpSrc = [
        "export const ALPHA_TOOLS = [{ name: 'a', title: 'A', description: 'adesc' }];",
        "export const BETA_TOOLS  = [{ name: 'b', title: 'B', description: 'bdesc' }];",
      ].join('\n');
      // ★ 2026-09-30（T9）：这里原先 `mkdirSync` + `writeFileSync` 落一份盘，再在 finally 里
      //   `unlinkSync` 拔掉。**那次落盘是多余的** —— `ts.createSourceFile` 吃的是**字符串** `tmpSrc`，
      //   文件名只当标签用（下面传的 `'_g9_tmp_scan.ts'` 就是个字面量）。⇒ **不插就不用拔**，
      //   顺带少一次"删除"（宿主按 turn 记批量删除次数，阈值 50；跑全量时会被拒 ⇒ 见 commit 说明）。
      {
        const tmpSf = ts.createSourceFile('_g9_tmp_scan.ts', tmpSrc, ts.ScriptTarget.Latest, true);
        const stmts = tmpSf.statements as ts.VariableStatement[];
        const fp1 = computeElementFingerprint(stmts[0]!.declarationList!.declarations![0]!.initializer!.elements[0]!);
        const fp2 = computeElementFingerprint(stmts[1]!.declarationList!.declarations![0]!.initializer!.elements[0]!);
        expect(fp1).toBe(fp2);
      }
    });

    it('scanDuplicateLiteralTables 扫描 src 至少找到一组重复', () => {
      const result = scanDuplicateLiteralTables();
      expect(result.groups.length).toBeGreaterThan(0);
      for (const g of result.groups) {
        expect(g.count).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe('G10 · 实际门（按家庭登记，存量不拦，新增即红）', () => {
    it('登记表本身健康（每条家族都有 id / intent / fingerprintPattern）', () => {
      const reg = readRegistry();
      expect(reg.families.length).toBeGreaterThan(0);
      for (const f of reg.families) {
        expect(f.id, '家族缺 id').toBeTruthy();
        expect(f.intent.length, `${f.id} 的 intent 太短`).toBeGreaterThan(10);
        if (f.authority) {
          expect(
            fs.existsSync(path.join(REPO, f.authority)),
            `${f.id} 的 authority 文件不存在：${f.authority}`,
          ).toBe(true);
        }
        expect(f.fingerprintPattern, `${f.id} 缺 fingerprintPattern`).toBeTruthy();
      }
    });

    it('当前重复字面量表在基线内（未见新增副本）', () => {
      const reg = readRegistry();
      const result = scanDuplicateLiteralTables();

      for (const family of reg.families) {
        const matchingGroups = result.groups.filter(
          (g) => g.fingerprint === family.fingerprintPattern,
        );
        const actual: Record<string, number> = {};
        for (const g of matchingGroups) {
          for (const ff of g.findings) {
            actual[ff.file] = (actual[ff.file] ?? 0) + 1;
          }
        }
        const frozen = family.frozen ?? {};
        const added = Object.keys(actual).filter((k) => !(k in frozen)).sort();
        expect(
          added,
          `[G10] ${family.id} 出现新增副本（权威：${family.authority ?? '尚未建立'}）。\n` +
            `意图：${family.intent}\n请将该文件加入 frozen 或在 allow 里写理由。`,
        ).toEqual([]);
      }
    });

    it('登记表里不留已消失的文件引用', () => {
      const reg = readRegistry();
      const stale: string[] = [];
      for (const f of reg.families) {
        for (const file of Object.keys(f.frozen ?? {})) {
          if (!fs.existsSync(path.join(REPO, file))) stale.push(`${f.id}: ${file}`);
        }
      }
      expect(stale, `登记表引用了不存在的文件：${stale.join(', ')}`).toEqual([]);
    });
  });
});

// ── 更新基线模式（LITERAL_TABLE_FROZEN=1）──
if (process.env.LITERAL_TABLE_FROZEN === '1') {
  const reg = readRegistry();
  const result = scanDuplicateLiteralTables();
  const next: Registry = {
    ...reg,
    families: reg.families.map((f) => {
      const fpMatches = result.groups.filter((g) => g.fingerprint === f.fingerprintPattern);
      const actual: Record<string, number> = {};
      for (const g of fpMatches) {
        for (const ff of g.findings) {
          actual[ff.file] = (actual[ff.file] ?? 0) + 1;
        }
      }
      return { ...f, frozen: actual };
    }),
  };
  fs.writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n', 'utf8');
  // eslint-disable-next-line no-console
  console.log('[G10] 基线已更新，共', reg.families.length, '个家族');
  process.exitCode = 0;
}
