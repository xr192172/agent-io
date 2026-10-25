/**
 * ★ T202（2026-10-12）：**验证契约**的读取 —— ★ 从 `presentation/cli/diagnose_loop_cli.ts` **搬到这里**。
 *
 * ## 为什么搬
 * 它原先**只住在 CLI 里**（局部函数）⇒ ★ 而工具面也要走同一条闭环 ⇒ ★ 若让它再抄一份，
 * 就是「**同一判据住两处**」（本仓头号病）⇒ 所以**往上提到 `infrastructure`**，**两个调用方共用** ✓
 * （★ 与 `removeFileFromDsl` 从两处收口到一处是同一手法。）
 *
 * ## 它是什么
 * 把「这个项目怎么验证」——**测试命令 + 测试文件摘要**——读成一段文本，喂给**修复 LLM**，
 * 让补丁知道"改完要过什么"。★ 读不到就返回 `undefined`（★ 不编一个假的）。
 */
import fs from 'node:fs';
import path from 'node:path';

export function readTestContract(root: string): string | undefined {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const testCmd = pkg?.scripts?.test;
    if (!testCmd) return undefined;
    const m = /node\s+([\w./\\-]+\.(?:js|ts|cjs|mjs))/.exec(testCmd);
    const candidates = m ? [m[1]] : ['test.js', 'test.ts', 'tests/test.js', 'test/index.js'];
    for (const c of candidates) {
      const abs = path.resolve(root, c);
      if (fs.existsSync(abs)) {
        const body = fs.readFileSync(abs, 'utf-8');
        return `测试命令: ${testCmd}\n测试文件 ${c}:\n${body.slice(0, 2000)}`;
      }
    }
    return `测试命令: ${testCmd}`;
  } catch {
    return undefined;
  }
}
