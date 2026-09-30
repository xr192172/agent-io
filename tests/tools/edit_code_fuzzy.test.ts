/**
 * replace_text 模糊编辑级联测试（P0-4，2026-09-15）：
 * - L1 exact：逐字命中行为不变（回执标 L1·exact，无 ⚠）
 * - L2 空白归一：CRLF/LF、行内空格差异 → 命中；dry_run 的 "-" 侧展示实际文件片段
 * - L3 缩进弹性：整块缩进不同 → 命中且 new_text 自动按命中缩进重排
 * - L4 省略号占位：old_text 只默写头尾（... 行）→ 整段替换
 * - 歧义即停：某级命中 >1 处 → 报错列行号、绝不猜，文件不动
 * - 全部未命中：报错列出四级尝试（诚实）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editCode } from '../../src/tools/edit_code.js';
import { closeAllProjectCacheDbs } from '../../src/infrastructure/index/db.js';

let dir: string;

function write(rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-code-fuzzy-'));
});

afterEach(() => {
  closeAllProjectCacheDbs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('replace_text 模糊编辑级联（P0-4）', () => {
  it('L1 exact：逐字命中行为不变，回执标 L1·exact 且无模糊警告', async () => {
    const p = write(
      'src/l1.ts',
      `export function add(a: number, b: number): number {
  return a + b;
}
`,
    );
    const r = await editCode({
      project_dir: dir,
      file: p,
      op: 'replace_text',
      old_text: '  return a + b;',
      new_text: '  return a + b + 1;',
    });
    expect(r.message).toContain('L1·exact');
    expect(r.message).not.toContain('⚠');
    expect(r.message).not.toContain('模糊命中');
    const after = fs.readFileSync(p, 'utf8');
    expect(after).toContain('return a + b + 1;');
  });

  it('L2 空白归一：CRLF 文件 + 行内多空格的 old_text（LF）→ 命中并明示级别', async () => {
    const p = write(
      'src/l2.ts',
      "export function greet(): string {\r\n  const msg = 'hello';\r\n  return msg;\r\n}\r\n",
    );
    const r = await editCode({
      project_dir: dir,
      file: p,
      op: 'replace_text',
      // LF 换行 + 双空格：字节级必然 L1 未命中，只能靠 L2 归一
      old_text: "  const msg  =  'hello';\n  return msg;",
      new_text: "  const msg  =  'hi';\n  return msg;",
    });
    expect(r.message).toContain('L2·空白归一');
    expect(r.message).toContain('模糊命中');
    expect(r.message).toContain('old_text 非逐字一致');
    const after = fs.readFileSync(p, 'utf8');
    expect(after).toContain("'hi'");
    expect(after).toContain('return msg;');
  });

  it('L2 dry_run：diff 的 "-" 侧是实际文件片段（非模型 old_text），不写盘', async () => {
    const p = write(
      'src/l2dry.ts',
      `const config = {
  name: 'svc',
  retries: 3,
};
`,
    );
    const before = fs.readFileSync(p, 'utf8');
    const r = await editCode({
      project_dir: dir,
      file: p,
      op: 'replace_text',
      old_text: "  name:  'svc',\n  retries:  3,",
      new_text: "  name:  'svc2',\n  retries:  5,",
      dry_run: true,
    });
    expect(r.message).toContain('[干跑]');
    expect(r.message).toContain('L2·空白归一');
    // "-" 侧 = 文件里的真实文本（单空格），不是模型写的双空格 old_text
    expect(r.message).toContain("-   name: 'svc',");
    expect(r.message).toContain("+   name:  'svc2',");
    expect(fs.readFileSync(p, 'utf8')).toBe(before); // 未写盘
  });

  it('L3 缩进弹性：模型给零缩进、文件 4 空格 → 命中且 new_text 自动重排到 4 空格', async () => {
    const p = write(
      'src/l3.ts',
      `class Svc {
  run(): void {
    if (ok()) {
      stepA();
    }
  }
}
`,
    );
    const r = await editCode({
      project_dir: dir,
      file: p,
      op: 'replace_text',
      old_text: 'if (ok()) {\nstepA();\n}',
      new_text: 'if (ok()) {\nstepNEW();\n}',
    });
    expect(r.message).toContain('L3·缩进弹性');
    expect(r.message).toContain('new_text 已按命中缩进重排');
    const after = fs.readFileSync(p, 'utf8');
    expect(after).toMatch(/^ {4}if \(ok\(\)\) \{$/m);
    expect(after).toMatch(/^ {4}stepNEW\(\);$/m);
    expect(after).toMatch(/^ {4}\}$/m);
    expect(after).not.toContain('stepA');
  });

  it('L4 省略号占位：old_text 只默写头尾（... 行）→ 整段替换、new_text 重排', async () => {
    const p = write(
      'src/l4.ts',
      `export function cleanup(): void {
  removeTemp();
  rotateLogs();
  vacuumDb();
  notifyUser();
  writeAudit();
}
`,
    );
    const r = await editCode({
      project_dir: dir,
      file: p,
      op: 'replace_text',
      old_text: '  rotateLogs();\n...\n  writeAudit();',
      new_text: 'rotateLogs();\ncompactLogs();\nwriteAudit();',
    });
    expect(r.message).toContain('L4·省略号占位');
    expect(r.message).toContain('模糊命中');
    const after = fs.readFileSync(p, 'utf8');
    expect(after).not.toContain('vacuumDb');
    expect(after).not.toContain('notifyUser');
    expect(after).toContain('compactLogs');
    expect(after).toMatch(/^ {2}compactLogs\(\);$/m); // 重排到文件实际缩进
    expect(after).toContain('removeTemp'); // 头部之前的内容不动
  });

  it('歧义即停：L3 匹配到 2 处 → 报错列级别与行号，文件不动', async () => {
    const p = write(
      'src/amb.ts',
      `export function one(): void {
  doThing( 1 );
  return;
}

export function two(): void {
  doThing( 1 );
  return;
}
`,
    );
    const before = fs.readFileSync(p, 'utf8');
    await expect(
      editCode({
        project_dir: dir,
        file: p,
        op: 'replace_text',
        old_text: 'doThing( 1 );\nreturn;', // 两个函数体归一后相同 → 歧义
        new_text: 'doThing( 2 );\nreturn;',
      }),
    ).rejects.toThrow(/不唯一（L3·缩进弹性 匹配到 2 处：行号 2, 7）/);
    expect(fs.readFileSync(p, 'utf8')).toBe(before);
  });

  it('四级全未命中：报错列出四级尝试（诚实），引导改用 range', async () => {
    const p = write('src/miss.ts', 'const A = 1;\n');
    await expect(
      editCode({
        project_dir: dir,
        file: p,
        op: 'replace_text',
        old_text: '这块内容完全不存在xyz123',
        new_text: 'x',
      }),
    ).rejects.toThrow(/四级均未命中/);
    await expect(
      editCode({
        project_dir: dir,
        file: p,
        op: 'replace_text',
        old_text: '这块内容完全不存在xyz123',
        new_text: 'x',
      }),
    ).rejects.toThrow(/L1 逐字[\s\S]*省略号占位/);
  });
});
