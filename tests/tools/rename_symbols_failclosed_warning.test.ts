/**
 * `[C]` 层（registry/lanes/refactor.ts）改名回执的 **skipped 显式警告** 测试。
 *
 * 依据：§27.4 裁定 + §28.3 第 7 条 —— 改名是**正确性敏感**操作：
 *   漏改一个引用文件 = 产出**损坏的代码**（定义改了、引用没改）。
 *   而 `skipped` 是"我少看了一个文件"的**可读的数** ⇒ 必须在回执**显著位置**看得见，
 *   否则退化成 §2d 的"少做一点事而不说话"。
 *
 * 本测试**只**验证 `[C]` 层（registry）的**回执渲染**，不测底层改名逻辑（那在别的测试里）。
 *
 * ★ 测试手段为何是"真场景"而非插桩：
 *   `.mts` 属于 `TS_JS_EXTS`（会被当作 TS/JS 家族纳扫），但语言注册表里**没有任何条目**
 *   声明 `.mts`（typescript=[.ts] / tsx=[.tsx] / javascript=[.js,.mjs,.cjs]）
 *   ⇒ `analyzeModuleSource('.mts')` 返回 null ⇒ `rename_symbol` 记一条
 *   `{ path, why: '无可用 TS 解析器…' }` 的 skipped。这是**真实可达**的 skipped 场景，
 *   不依赖 mock，也不碰 `src/tools/*`。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TOOL_DEFS } from '../../src/presentation/mcp/server_registry.js';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as {
    handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  };
};

function mkProj(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drs-warn-'));
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content, 'utf-8');
  }
  return dir;
}

function rmForce(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 句柄未释放，忽略（临时目录） */
  }
}

describe('[C] 层改名回执：skipped 非空 ⇒ 显式警告"改名可能不完整"', () => {
  it('skipped 非空（.mts 无解析器）→ 回执显著位置有警告 + 逐条列出 {path, why}', async () => {
    const dir = mkProj({
      'src/a.ts': 'export function alpha(a: number) { return a; }\n',
      'src/use.ts': "import { alpha } from './a';\nexport function run() { return alpha(1); }\n",
      // `.mts` 在 TS_JS_EXTS 内但语言注册表无对应条目 ⇒ 必然记一条 skipped
      'src/weird.mts': "import { alpha } from './a';\nexport const v = alpha(1);\n",
    });

    const r = await def('rename_symbols').handler({
      project_dir: dir,
      renames: [{ file: 'src/a.ts', symbol: 'alpha', to: 'aleph' }],
    });
    expect(r.isError).not.toBe(true);

    const msg = r.text;
    // ① 显著警告到位
    expect(msg).toContain('⚠ 改名可能不完整');
    expect(msg).toContain('个文件未能扫描');
    // ② 逐条列出被跳过的文件与原因
    expect(msg).toContain('weird.mts');
    expect(msg).toContain('无可用 TS 解析器');
    // ③ 警告出现在正文靠前（显著位置），而非埋在末尾
    expect(msg.indexOf('⚠ 改名可能不完整')).toBeLessThan(msg.indexOf('weird.mts'));

    rmForce(dir);
  });

  it('skipped 为空（干净的 .ts 项目）→ 回执**不含**该警告（防噪音）', async () => {
    const dir = mkProj({
      'src/a.ts': 'export function alpha(a: number) { return a; }\n',
      'src/use.ts': "import { alpha } from './a';\nexport function run() { return alpha(1); }\n",
    });

    const r = await def('rename_symbols').handler({
      project_dir: dir,
      renames: [{ file: 'src/a.ts', symbol: 'alpha', to: 'aleph' }],
    });
    expect(r.isError).not.toBe(true);

    const msg = r.text;
    // 正常改名回执：不应出现"不完整"警告
    expect(msg).not.toContain('⚠ 改名可能不完整');
    expect(msg).not.toContain('未能扫描');
    // 但改名本身确实完成了（防"因为没命中而误判无警告"）
    expect(msg).toContain('批量改名完成');
    expect(fs.readFileSync(path.join(dir, 'src/a.ts'), 'utf-8')).toContain('function aleph');
    expect(fs.readFileSync(path.join(dir, 'src/use.ts'), 'utf-8')).toContain('aleph(1)');

    rmForce(dir);
  });
});
