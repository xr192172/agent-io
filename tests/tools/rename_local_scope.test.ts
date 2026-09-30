/**
 * `rename_symbols(scope='local')` —— 合并后**单一入口**的局部作用域支（[C] → [B] → ast_rename 资产）。
 *
 * 为什么另立一个文件：合并前的"局部改名"入口**没有任何 handler 级测试**（只有 [B] 内部的
 * `analyzeLocals`/`renameLocal` 单测），于是它的 [C] 自己 readFileSync/writeFileSync、漏掉
 * `dry_run`/写前快照/索引写穿，**没有一道门看得见**。本文件把这条链从 MCP 处理器一路验到盘上。
 *
 * 逐条对应 §3「不许丢能力」里属于局部支的那几项：
 *   - 作用域隔离（不同函数/块的同名绑定互不误伤）+ 同名歧义**拒而不猜**（列出候选行）
 *   - `changed=0` 的跳过项**可见**（逐条给出**具体**理由：撞名 / 原名相同 / 名字不存在）
 *   - 一次解析、多编辑**逆序合并**（同文件多项一次改完 ⇒ 偏移不错位；下面用逐字断言把它钉住）
 *   - `dry_run`（这次真的暴露在工具面上：算出结果但一个字节都不写、连快照都不建）
 *   - 落盘走写闸 ⇒ **写前快照**（撤回通道真的能撤回）
 *   - scope 专用参数误用 ⇒ **响亮拒绝**（不静默忽略）
 *
 * ★ 断言为什么读 `text` 而不是 `data`：`rename_symbols` 的回执通道是 `wrap`（历史形态，G11 基线里
 *   登记为 dropData），`data` 在传输层会被丢掉 —— 所以本文件验的是"agent 真正看得到的那段话"。
 *   这恰好也是"逐项可见"该有的判据：**看得见**才算数。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/application/tool_registry.js';
import { listFileSnapshots, rollbackFileSnapshot } from '../../src/application/refactor/file_snapshot.js';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as {
    handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  };
};

function mkProj(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rsl-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
}

function read(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf-8');
}

function rmForce(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 句柄未释放，忽略（临时目录） */
  }
}

/** 两个函数各有一个同名局部 t —— 作用域隔离与"歧义拒"都用它 */
const TWO_SCOPES = ['export function left(): number {', '  const t = 1;', '  return t + t;', '}', 'export function right(): number {', '  const t = 2;', '  return t;', '}'].join('\n') + '\n';

/** 同文件两个待改绑定 —— "一次解析多编辑逆序合并"用它（串行改会因偏移错位而改花） */
const TWO_LOCALS = ['export function f(): number {', '  const a = 1;', '  const b = 2;', '  return a + b;', '}'].join('\n') + '\n';

describe("rename_symbols(scope='local') · 作用域隔离与寻址", () => {
  it('同名绑定多于一个而没给 decl_line ⇒ 该条被拒 + 列出候选行（**不猜**）', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_SCOPES });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 't', to: 'tt' }],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('跳过 1 条');
    expect(r.text).toContain('有 2 个绑定');
    expect(r.text).toContain('decl_line');
    expect(r.text, '候选要连行号一起列出来，调用方才补得上这一刀').toContain('第 2 行');
    expect(r.text).toContain('第 6 行');
    expect(read(dir, 'src/a.ts'), '拒了就不许动盘').toBe(TWO_SCOPES);
    rmForce(dir);
  });

  it('给了 decl_line ⇒ 只改那一个绑定，另一个同名绑定**分毫不动**（作用域隔离）', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_SCOPES });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 't', to: 'tt', decl_line: 2 }],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('改 1 条，跳过 0 条');
    const got = read(dir, 'src/a.ts');
    expect(got).toBe(
      ['export function left(): number {', '  const tt = 1;', '  return tt + tt;', '}', 'export function right(): number {', '  const t = 2;', '  return t;', '}'].join('\n') + '\n',
    );
    rmForce(dir);
  });

  it('scope 专用参数误用 ⇒ 响亮拒绝，不静默忽略：local 传 report_literals 拒整批', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 'a', to: 'alpha' }],
      report_literals: true,
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('不支持字面量引用扫描');
    expect(read(dir, 'src/a.ts')).toBe(TWO_LOCALS);
    rmForce(dir);
  });

  it('local 的条目传 rename_file_if_matching ⇒ 只拒**该项**（逐项独立），并说明该走 scope=module', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 'a', to: 'alpha', rename_file_if_matching: true }],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('不支持 rename_file_if_matching');
    expect(r.text).toContain('scope=module');
    expect(read(dir, 'src/a.ts')).toBe(TWO_LOCALS);
    rmForce(dir);
  });
});

describe("rename_symbols(scope='local') · 逐项独立 + 跳过项可见", () => {
  it('撞名 / 原名相同 / 名字不存在 ⇒ 各自跳过并给出**具体**理由；其余项照改', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [
        { file: 'src/a.ts', symbol: 'a', to: 'b' }, // 同作用域已有 b ⇒ 撞名
        { file: 'src/a.ts', symbol: 'nope', to: 'c' }, // 文件里没有这个绑定
        { file: 'src/a.ts', symbol: 'b', to: 'beta' }, // 这条应当成功
      ],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('改 1 条，跳过 2 条');
    expect(r.text, '撞名的理由要说清"同作用域已有同名绑定"').toContain('同作用域已有同名绑定');
    expect(r.text, '名字不存在的理由要说清"没有名为 … 的局部绑定"').toContain('没有名为 "nope" 的局部绑定');

    const got = read(dir, 'src/a.ts');
    expect(got, 'a 没被改（撞名跳过），b 改成了 beta').toBe(
      ['export function f(): number {', '  const a = 1;', '  const beta = 2;', '  return a + beta;', '}'].join('\n') + '\n',
    );
    rmForce(dir);
  });
});

describe("rename_symbols(scope='local') · 一次解析多编辑 + dry_run + 撤回通道", () => {
  it('同文件两项一次改完 ⇒ 逐字正确（串行改会因偏移错位而改花）', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [
        { file: 'src/a.ts', symbol: 'a', to: 'alphaLonger' },
        { file: 'src/a.ts', symbol: 'b', to: 'betaLonger' },
      ],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('改 2 条，跳过 0 条');
    expect(r.text).toContain('落盘 1 个文件');
    expect(read(dir, 'src/a.ts')).toBe(
      ['export function f(): number {', '  const alphaLonger = 1;', '  const betaLonger = 2;', '  return alphaLonger + betaLonger;', '}'].join('\n') + '\n',
    );
    rmForce(dir);
  });

  it('dry_run=true ⇒ 算出逐项结果但**一个字节都不写**、连快照都不建', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 'a', to: 'alpha' }],
      dry_run: true,
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('dry-run 预览');
    expect(r.text).toContain('未落盘');
    expect(r.text).toContain('声明第 2 行');
    expect(read(dir, 'src/a.ts')).toBe(TWO_LOCALS);
    expect(listFileSnapshots(dir), '干跑不该碰盘（连快照都不该有）').toEqual([]);
    rmForce(dir);
  });

  it('真落盘 ⇒ 留下一份写前快照，且它**真能撤回**（撤回通道可用）', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [{ file: 'src/a.ts', symbol: 'a', to: 'alpha' }],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('落盘 1 个文件');

    const snaps = listFileSnapshots(dir);
    expect(snaps.length, '一次改动 = 一份快照 = 一个撤回点').toBe(1);
    expect(snaps[0].reason, '快照要写清是谁触发的').toContain('rename_symbols(scope=local)');
    expect(read(dir, 'src/a.ts')).not.toBe(TWO_LOCALS);

    const rb = rollbackFileSnapshot(dir, snaps[0].id);
    expect(rb.ok, rb.message).toBe(true);
    expect(read(dir, 'src/a.ts')).toBe(TWO_LOCALS);
    rmForce(dir);
  });

  it('★ 跨多个文件一次调用：每条带自己的 file，全部落盘且**只有一份**快照（一个撤回点）', async () => {
    const dir = mkProj({ 'src/a.ts': TWO_LOCALS, 'src/b.ts': TWO_LOCALS });
    const r = await def('rename_symbols').handler({
      project_dir: dir,
      scope: 'local',
      renames: [
        { file: 'src/a.ts', symbol: 'a', to: 'alphaA' },
        { file: 'src/b.ts', symbol: 'b', to: 'betaB' },
      ],
    });
    expect(r.isError).not.toBe(true);
    expect(r.text).toContain('改 2 条，跳过 0 条');
    expect(r.text).toContain('落盘 2 个文件');
    expect(read(dir, 'src/a.ts')).toBe(
      ['export function f(): number {', '  const alphaA = 1;', '  const b = 2;', '  return alphaA + b;', '}'].join('\n') + '\n',
    );
    expect(read(dir, 'src/b.ts')).toBe(
      ['export function f(): number {', '  const a = 1;', '  const betaB = 2;', '  return a + betaB;', '}'].join('\n') + '\n',
    );
    const snaps = listFileSnapshots(dir);
    expect(snaps.length, '一批改动 = 一份快照（含全部文件）').toBe(1);
    expect(snaps[0].files.map((f) => f.rel).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    rmForce(dir);
  });
});
