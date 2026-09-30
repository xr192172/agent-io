/**
 * import_resolve —— 项目内 import 候选解析（唯一实现）单元测试
 *
 * ★ 为什么要锁：候选**顺序**就是契约 —— health / impact / db 三处共用它，
 *   顺序一变会**静默改变"解析到哪个文件"**（例如 `x.ts` 与 `x/index.ts` 同时存在时）。
 *
 * 背景（2026-09-28）：该逻辑曾被复制成 3 份，只有 1 份处理了 "NodeNext ESM 用 `.js` 引 `.ts`"，
 * 而本仓 961/971 条相对 import 带 `.js` ⇒ 漏的那两份解析恒 null ⇒ import 图整体断掉
 * ⇒ 量具双向失真（orphan_file 284 假阳 + layer_violation 0 空转）+ impact_analysis 漏报引用方。
 * 详见 `src/infrastructure/parse/import_resolve.ts` 头部说明。
 */
import { describe, it, expect } from 'vitest';
import {
  IMPORT_EXTS,
  INDEX_FILES,
  importPathCandidates,
  resolveImportPath,
} from '../../src/infrastructure/parse/import_resolve.js';

describe('import_resolve: 候选顺序（契约）', () => {
  it('带 .js 后缀：原样 → 剥后缀重试 → 目录 index（且 .ts 早于 index）', () => {
    const c = importPathCandidates('src/a/b.ts', './x/y.js');
    expect(c[0]).toBe('src/a/x/y.js');
    expect(c).toContain('src/a/x/y.ts');
    expect(c).toContain('src/a/x/y.tsx');
    expect(c).toContain('src/a/x/y/index.ts');
    expect(c.indexOf('src/a/x/y.js')).toBeLessThan(c.indexOf('src/a/x/y.ts'));
    expect(c.indexOf('src/a/x/y.ts')).toBeLessThan(c.indexOf('src/a/x/y/index.ts'));
  });

  it('无后缀：按扩展名补全 → 目录 index', () => {
    const c = importPathCandidates('src/a/b.ts', './x/y');
    expect(c).toContain('src/a/x/y.ts');
    expect(c).toContain('src/a/x/y/index.ts');
    expect(c).not.toContain('src/a/x/y');
  });

  it('目录级 index 回退', () => {
    const c = importPathCandidates('src/a/b.ts', './sub');
    expect(c).toContain('src/a/sub/index.ts');
  });

  it('逃出项目根：仍带前导 `..` 的候选被剔除（fromRel 在根层时报 null）', () => {
    const c = importPathCandidates('b.ts', '../z');
    expect(c).toHaveLength(0);
  });

  it('★ 兼容性怪癖：`../..` 越过根后被 normalize 折叠回根，**不是**被拒绝', () => {
    // path.posix.join('src/a', '../../z') → normalize → 'z'（不残留 `..`）
    // ⇒ 旧的三份实现里 `base.startsWith('..')` 均为 false，于是照样按【项目根】解析。
    // 本模块必须与旧行为逐字一致 ⇒ 这里把该怪癖钉住，**不要"顺手修正"**它：
    // 真改语义会让 resolveImportTarget 的既有调用方（含 rename_file）行为漂移。
    const c = importPathCandidates('src/a/b.ts', '../../z');
    expect(c[0]).toBe('z.ts');
    expect(c.every((x) => !x.startsWith('..'))).toBe(true);
    expect(c).toHaveLength(10);
  });

  it('exts / indexFiles 可覆盖（health 与 impact 传内核扩展名表）', () => {
    const c = importPathCandidates('a.ts', './x', { exts: ['.mts'], indexFiles: ['index.mts'] });
    expect(c).toContain('x.mts');
    expect(c).toContain('x/index.mts');
    expect(c).not.toContain('x.ts');
  });

  it('默认扩展名表与仓内既有约定一致（勿随手改）', () => {
    expect([...IMPORT_EXTS]).toEqual(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
    expect([...INDEX_FILES]).toEqual(['index.ts', 'index.tsx', 'index.js', 'index.jsx']);
  });
});

describe('import_resolve: resolveImportPath 取首个命中', () => {
  it('按候选顺序取第一个 exists 命中的', () => {
    const rels = new Set(['src/a/x/y.ts', 'src/a/x/y/index.ts']);
    expect(resolveImportPath('src/a/b.ts', './x/y', (c) => rels.has(c))).toBe('src/a/x/y.ts');
  });

  it('同名 .ts 与 index.ts 并存时优先 .ts（顺序契约的实证）', () => {
    const rels = new Set(['src/a/x/y.ts', 'src/a/x/y/index.ts']);
    const hit = resolveImportPath('src/a/b.ts', './x/y.js', (c) => rels.has(c));
    expect(hit).toBe('src/a/x/y.ts');
  });

  it('全不命中 → null', () => {
    expect(resolveImportPath('src/a/b.ts', './nope', () => false)).toBeNull();
  });

  it('逃逸根（fromRel 在根层）→ null（即使 exists 恒 true）', () => {
    expect(resolveImportPath('b.ts', '../z', () => true)).toBeNull();
  });
});
