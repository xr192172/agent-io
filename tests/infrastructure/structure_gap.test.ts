/**
 * structure_gap 单元测试 —— 「结构意图 vs 现状」四态。
 *
 * ★ 出生证（§4.11：判据必须证明"它凭什么会红"）：
 *   本文件里「flat 子目录」那**三条是刻意配对的** —— 它们一起锁住 `computeStructureGap` 的
 *   **判定方向**（`dd === rel || dd.startsWith(rel + '/')`，即"登记项在检查项**下面**"）。
 *   若有人图省事改成双向包含（再补一句 `rel.startsWith(dd + '/')`），**flat 目录自己的 dir**
 *   会前缀命中它下面**所有**子目录 ⇒ 未登记子目录**全部漏报** ⇒ 第 12 条当场红。
 *   这不是假想：`scripts/structure_gap.mjs` 侧实测过 —— 注入双向包含后，读数从 6 掉到 0。
 *
 * ★ 为什么用**临时项目**而不是扫本仓：本仓的域表会随搬迁不断变化，拿它当断言基准
 *   （"现在必须是 6 个 unlisted"）等于把"进行中的待办"焊进测试 —— 搬完就假红。
 *   本文件只对**本仓**断言一件稳定的事：域表存在且能被工具读通（第 15 条）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRUCTURE_CONFIG_BASENAME, structureGap } from '../../src/infrastructure/analysis/structure/structure_gap.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let root = '';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sgap-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 造一个源码文件（自动建父目录） */
function w(rel: string): void {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'export const x = 1;\n', 'utf-8');
}
/** 写域表 */
function wCfg(cfg: unknown): void {
  fs.writeFileSync(path.join(root, STRUCTURE_CONFIG_BASENAME), JSON.stringify(cfg), 'utf-8');
}
const paths = (items: Array<{ path: string }>): string[] => items.map((i) => i.path).sort();

describe('structure_gap · 两种「没有」必须分开', () => {
  it('① 配置**不存在** ⇒ configured:false（合法状态，不是失败），四态皆空', () => {
    const r = structureGap(root);
    expect(r.configured).toBe(false);
    expect(r.config_path).toBe(STRUCTURE_CONFIG_BASENAME);
    expect([r.misplaced.length, r.unlisted.length, r.missing.length]).toEqual([0, 0, 0]);
  });

  it('② 配置**坏**（JSON 非法）⇒ 抛，且不降级成「没配置」', () => {
    fs.writeFileSync(path.join(root, STRUCTURE_CONFIG_BASENAME), '{ this is not json', 'utf-8');
    expect(() => structureGap(root)).toThrow();
  });

  it('③ id 在本表内重复 ⇒ 抛（读数按 id 索引，重复后无法对应目录）', () => {
    wCfg({ domains: [{ id: 'a', dir: 'src/a' }, { id: 'a', dir: 'src/b' }] });
    expect(() => structureGap(root)).toThrow(/重复/);
  });

  it('④ id 跨 domains 与 flatDirs 重复 ⇒ 抛（两边共用一个命名空间）', () => {
    wCfg({ domains: [{ id: 'a', dir: 'src/a' }], flatDirs: [{ id: 'a', dir: 'src/b' }] });
    expect(() => structureGap(root)).toThrow(/重复/);
  });

  it('⑤ dir 写成绝对路径 / 带反斜杠 ⇒ 抛（口径必须唯一：相对 + 正斜杠）', () => {
    wCfg({ domains: [{ id: 'a', dir: '/abs/src/a' }] });
    expect(() => structureGap(root)).toThrow(/正斜杠|相对/);
    wCfg({ domains: [{ id: 'a', dir: 'src\\a' }] });
    expect(() => structureGap(root)).toThrow(/正斜杠|相对/);
  });

  it('⑤b 缺 domains 数组 ⇒ 抛（★ 省略 ≠ 空数组：不许把它静默当成"没有域"）', () => {
    // 这条是实测换来的：我写 ⑭ 时漏了 `domains: []`，工具当场报「缺 domains 数组」——
    // 说明校验在干活。留成用例，免得日后有人图省事改成 `cfg.domains ?? []`（那就是兜底）。
    wCfg({ flatDirs: [{ id: 'core', dir: 'src/core' }] });
    expect(() => structureGap(root)).toThrow(/缺 domains 数组/);
  });
});

describe('structure_gap · 四态', () => {
  it('⑥ misplaced：域目录的**父目录**下直接堆着的源码 ⇒ 待搬清单', () => {
    w('src/analysis/one/a.ts');
    w('src/analysis/stray.ts');
    wCfg({ domains: [{ id: 'one', dir: 'src/analysis/one' }] });
    const r = structureGap(root);
    expect(paths(r.misplaced)).toEqual(['src/analysis/stray.ts']);
    expect(r.missing).toEqual([]);
  });

  it('⑦ unassigned 里的散文件 ⇒ unlisted（要决定归属，不是待搬）', () => {
    w('src/analysis/one/a.ts');
    w('src/analysis/undecided.ts');
    wCfg({ domains: [{ id: 'one', dir: 'src/analysis/one' }], unassigned: ['undecided'] });
    const r = structureGap(root);
    expect(paths(r.unlisted)).toEqual(['src/analysis/undecided.ts']);
    expect(r.misplaced).toEqual([]);
  });

  it('⑧ 父目录自己的 barrel（index.*）不报 —— 那是它合法的入口', () => {
    w('src/analysis/one/a.ts');
    w('src/analysis/index.ts');
    wCfg({ domains: [{ id: 'one', dir: 'src/analysis/one' }] });
    const r = structureGap(root);
    expect(r.misplaced).toEqual([]);
  });

  it('⑨ missing：声明的域目录不存在 ⇒ 报「目录不存在」', () => {
    wCfg({ domains: [{ id: 'ghost', dir: 'src/analysis/ghost' }] });
    const r = structureGap(root);
    expect(paths(r.missing)).toEqual(['src/analysis/ghost']);
    expect(r.missing[0].note).toContain('目录不存在');
  });

  it('⑩ missing：域已**收编进同名单文件** ⇒ 报出来并说明（不是"目录不存在"）', () => {
    w('src/meta.ts');
    wCfg({ domains: [{ id: 'meta', dir: 'src/meta' }] });
    const r = structureGap(root);
    expect(paths(r.missing)).toEqual(['src/meta']);
    expect(r.missing[0].note).toContain('单文件');
  });
});

describe('structure_gap · flat 不是免检（★ 出生证在这里）', () => {
  it('⑪ flat 目录里的散文件是**终态** ⇒ 不报 misplaced', () => {
    w('src/core/a.ts');
    w('src/core/b.ts');
    wCfg({ domains: [], flatDirs: [{ id: 'core', dir: 'src/core' }] });
    const r = structureGap(root);
    expect(r.misplaced).toEqual([]);
    expect(r.unlisted).toEqual([]);
  });

  it('⑫ ★ flat 目录里长出的子目录**没登记** ⇒ unlisted（方向反了这条会漏报）', () => {
    fs.mkdirSync(path.join(root, 'src', 'core', 'sub'), { recursive: true });
    wCfg({ domains: [], flatDirs: [{ id: 'core', dir: 'src/core' }] });
    const r = structureGap(root);
    expect(paths(r.unlisted)).toEqual(['src/core/sub/']);
  });

  it('⑬ ★ 子目录**已被登记**（某条域的 dir 在它下面）⇒ 不报 —— 与上一条配对锁住方向', () => {
    w('src/core/sub/deep/a.ts');
    wCfg({ domains: [{ id: 'deep', dir: 'src/core/sub/deep' }], flatDirs: [{ id: 'core', dir: 'src/core' }] });
    const r = structureGap(root);
    // `src/core/sub` 是 `src/core/sub/deep` 的祖先 ⇒ 视为已登记；`sub` 自己不算"没登记的容器"
    expect(r.unlisted).toEqual([]);
  });

  it('⑭ 子目录自己也是 flat（`D === rel`）⇒ 不报', () => {
    w('src/core/sub/a.ts');
    wCfg({ domains: [], flatDirs: [{ id: 'core', dir: 'src/core' }, { id: 'sub', dir: 'src/core/sub' }] });
    const r = structureGap(root);
    expect(r.unlisted).toEqual([]);
  });

  it('⑮ ★ 域落在某个 flat 目录下时，该 flat 目录的散文件**仍不报 misplaced**（两条声明不许打架）', () => {
    // ★ 出生证来源（2026-10-02 实测）：把 `src/infrastructure/text/` 登记成域的那一刻，
    //   它的 dirname `src/infrastructure` 进了 parents ⇒ 量具开始扫那个目录的直属散文件
    //   ⇒ 读数「待搬 0 → **10**」—— 而那 10 个横切件**早已被 flatDirs 声明为"有意平铺"**。
    //   即：`domains` 的 dirname 推导与 `flatDirs` 的声明**打架**了。
    //   修法是 `parents` 扣掉 flat 目录本身；去掉那个 `.filter(...)`，本用例立刻红。
    w('src/core/keeper.ts'); // flat 目录里的成员（终态，不是缺口）
    w('src/core/text/refs.ts'); // 域落在 flat 目录下面
    wCfg({
      domains: [{ id: 'text', dir: 'src/core/text' }],
      flatDirs: [{ id: 'core', dir: 'src/core' }],
    });
    const r = structureGap(root);
    expect(r.misplaced).toEqual([]);
    expect(r.unlisted).toEqual([]);
  });
});

describe('structure_gap · 本仓自洽', () => {
  it('⑮ 本仓有域表，且能读通（只断言"能读"，不断言具体数字 —— 数字会随搬迁变）', () => {
    const r = structureGap(REPO);
    expect(r.configured).toBe(true);
    expect(r.domain_count).toBeGreaterThan(0);
    expect(r.flat_count).toBeGreaterThan(0);
  });
});
