/**
 * edit_code `targets[]` 批量编辑（P-B，规划书 §16.2）：
 * - 一次调用改 ≥2 文件（替代 N 次 dry-run + N 次 apply）
 * - **逐项独立回报**：注入一个必失败项 ⇒ 该项红、其余按原子性策略处理
 * - **原子性开/关**各一：atomic=true ⇒ 有失败项则整批不落盘；缺省 ⇒ 逐项独立
 * - 批量 dry_run：一次性给出**全部**预览、不写盘
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { editCode } from '../../src/application/refactor/rf-edit/edit_code.js';
import { closeAllProjectCacheDbs } from '../../src/infrastructure/index/db.js';

let dir: string;

function write(rel: string, content: string): string {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

/** 每文件一份可唯一替换的样本：OLD_TOKEN 只出现一次 */
function sample(name: string): string {
  return `export const NAME = '${name}';\n\nexport function use(): string {\n  return 'OLD_TOKEN';\n}\n`;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-code-batch-'));
});

afterEach(() => {
  closeAllProjectCacheDbs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('edit_code targets[] 批量（P-B）', () => {
  it('① 一次调用改 7 个文件：逐项回报 + 每文件都落盘（对应 §16.8 判据"一次调用改 7 文件"）', async () => {
    const files = Array.from({ length: 7 }, (_, i) => `src/f${i}.ts`);
    for (const f of files) write(f, sample(f));
    // 先给每文件建索引基线（首次导入不产 symbol_diff ⇒ 先做一次单文件编辑）
    for (const f of files) {
      await editCode({ project_dir: dir, file: f, op: 'replace_text', old_text: `'${f}'`, new_text: `'${f}!seed'` });
    }

    const r = await editCode({
      project_dir: dir,
      targets: files.map((f, i) => ({ file: f, old_text: "'OLD_TOKEN'", new_text: `'NEW_${i}'` })),
    });

    // 结构化回执
    expect(r.data.op).toBe('batch');
    expect(r.data.ok).toBe(true);
    expect(r.data.total).toBe(7);
    expect(r.data.succeeded).toBe(7);
    expect(r.data.failed).toBe(0);
    expect(r.data.written).toBe(true);
    expect(r.data.dry_run).toBe(false);
    expect(r.data.items?.length).toBe(7);
    for (const it of r.data.items!) {
      expect(it.ok).toBe(true);
      expect(it.written).toBe(true);
      expect(it.error).toBeUndefined();
      expect(it.hit?.level).toBe(1); // 逐字命中
      expect(it.symbol_diff).toBeDefined(); // 落盘后有符号 diff
      expect(it.index_synced).toBeTruthy();
    }
    // 7 个文件都真的被改了
    files.forEach((f, i) => {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).toContain(`'NEW_${i}'`);
    });
    // 消息里逐项一行
    for (const f of files) expect(r.message).toContain(f);
  });

  it('② 注入一个必失败项（old_text 不存在）：该项红、其余按**非原子**策略照常落盘', async () => {
    write('src/ok1.ts', sample('ok1'));
    write('src/ok2.ts', sample('ok2'));
    write('src/bad.ts', sample('bad'));

    const r = await editCode({
      project_dir: dir,
      targets: [
        { file: 'src/ok1.ts', old_text: "'OLD_TOKEN'", new_text: "'OK1'" },
        { file: 'src/bad.ts', old_text: "'NOT_PRESENT_ANYWHERE'", new_text: "'X'" }, // 必失败
        { file: 'src/ok2.ts', old_text: "'OLD_TOKEN'", new_text: "'OK2'" },
      ],
    });

    expect(r.data.ok).toBe(false); // 有失败项 ⇒ 整批 ok=false
    expect(r.data.total).toBe(3);
    expect(r.data.succeeded).toBe(2);
    expect(r.data.failed).toBe(1);
    // 失败项：红 + 带 error，未落盘
    const bad = r.data.items!.find((x) => x.file === 'src/bad.ts')!;
    expect(bad.ok).toBe(false);
    expect(bad.written).toBe(false);
    expect(bad.error).toMatch(/未找到 old_text|四级均未命中/);
    // 成功项：非原子 ⇒ 照常落盘
    const ok1 = r.data.items!.find((x) => x.file === 'src/ok1.ts')!;
    const ok2 = r.data.items!.find((x) => x.file === 'src/ok2.ts')!;
    expect(ok1.ok).toBe(true);
    expect(ok1.written).toBe(true);
    expect(ok2.ok).toBe(true);
    expect(ok2.written).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'src/ok1.ts'), 'utf8')).toContain("'OK1'");
    expect(fs.readFileSync(path.join(dir, 'src/ok2.ts'), 'utf8')).toContain("'OK2'");
    // 失败文件原样
    expect(fs.readFileSync(path.join(dir, 'src/bad.ts'), 'utf8')).toContain("'OLD_TOKEN'");
  });

  it('③ 原子性 **开**：有失败项 ⇒ 成功项也不落盘（全成或全不成）', async () => {
    write('src/ok.ts', sample('ok'));
    write('src/bad.ts', sample('bad'));
    const beforeOk = fs.readFileSync(path.join(dir, 'src/ok.ts'), 'utf8');

    const r = await editCode({
      project_dir: dir,
      atomic: true,
      targets: [
        { file: 'src/ok.ts', old_text: "'OLD_TOKEN'", new_text: "'OK_NEW'" },
        { file: 'src/bad.ts', old_text: "'NOT_PRESENT'", new_text: "'X'" },
      ],
    });

    expect(r.data.atomic).toBe(true);
    expect(r.data.ok).toBe(false);
    expect(r.data.failed).toBe(1);
    expect(r.data.written).toBe(false);
    // 成功项的规划 ok=true，但因原子性**未落盘**
    const ok = r.data.items!.find((x) => x.file === 'src/ok.ts')!;
    expect(ok.ok).toBe(true);
    expect(ok.written).toBe(false);
    expect(fs.readFileSync(path.join(dir, 'src/ok.ts'), 'utf8')).toBe(beforeOk);
    expect(r.message).toContain('整批未落盘');
  });

  it('④ 原子性 **关**（缺省）：同样输入 ⇒ 成功项落盘', async () => {
    write('src/ok.ts', sample('ok'));
    write('src/bad.ts', sample('bad'));

    const r = await editCode({
      project_dir: dir,
      // atomic 缺省 = false
      targets: [
        { file: 'src/ok.ts', old_text: "'OLD_TOKEN'", new_text: "'OK_NEW'" },
        { file: 'src/bad.ts', old_text: "'NOT_PRESENT'", new_text: "'X'" },
      ],
    });

    expect(r.data.atomic).toBe(false);
    expect(r.data.failed).toBe(1);
    expect(r.data.written).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'src/ok.ts'), 'utf8')).toContain("'OK_NEW'");
    expect(fs.readFileSync(path.join(dir, 'src/bad.ts'), 'utf8')).toContain("'OLD_TOKEN'");
  });

  it('⑤ 批量 dry_run：一次性给出全部预览、不写盘', async () => {
    write('src/a.ts', sample('a'));
    write('src/b.ts', sample('b'));
    write('src/bad.ts', sample('bad'));
    const beforeA = fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf8');

    const r = await editCode({
      project_dir: dir,
      dry_run: true,
      targets: [
        { file: 'src/a.ts', old_text: "'OLD_TOKEN'", new_text: "'A_NEW'" },
        { file: 'src/b.ts', old_text: "'OLD_TOKEN'", new_text: "'B_NEW'" },
        { file: 'src/bad.ts', old_text: "'NOT_PRESENT'", new_text: "'X'" },
      ],
    });

    expect(r.data.dry_run).toBe(true);
    expect(r.data.written).toBe(false);
    // 成功项也标未落盘
    for (const it of r.data.items!) if (it.ok) expect(it.written).toBe(false);
    // 一次性给出**全部**预览（两个成功项各一份 diff，失败项也逐项列出）
    expect(r.message).toContain('src/a.ts');
    expect(r.message).toContain('src/b.ts');
    expect(r.message).toContain('src/bad.ts');
    expect(r.message.match(/```diff/g)?.length).toBe(2); // 2 个成功项的预览
    // "-" 侧是实际被命中的文件片段（= old_text 逐字），不是整行
    expect(r.message).toContain("- 'OLD_TOKEN'");
    expect(r.message).toContain("+ 'A_NEW'");
    // 未写盘
    expect(fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf8')).toBe(beforeA);
    expect(fs.readFileSync(path.join(dir, 'src/b.ts'), 'utf8')).toContain("'OLD_TOKEN'");
  });

  it('⑥ targets 为空数组 ⇒ 显式报错（不静默当成功）', async () => {
    await expect(editCode({ project_dir: dir, targets: [] })).rejects.toThrow(/空数组/);
  });

  it('⑦ 同一文件两个 target 按序叠加（等价于先后两次调用）', async () => {
    write('src/s.ts', `export const A = 'ONE';\nexport const B = 'TWO';\n`);
    const r = await editCode({
      project_dir: dir,
      targets: [
        { file: 'src/s.ts', old_text: "'ONE'", new_text: "'ONE2'" },
        { file: 'src/s.ts', old_text: "'TWO'", new_text: "'TWO2'" },
      ],
    });
    expect(r.data.total).toBe(2);
    expect(r.data.items!.map((x) => x.written)).toEqual([true, true]);
    const after = fs.readFileSync(path.join(dir, 'src/s.ts'), 'utf8');
    expect(after).toContain("'ONE2'");
    expect(after).toContain("'TWO2'");
  });
});
