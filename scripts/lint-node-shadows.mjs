#!/usr/bin/env node
/**
 * lint:node-shadows —— **代码级**：Node 视图不许自己编字段 / 不许用索引签名兜
 *
 * ## 为什么要它（2026-10-27，一天内 4 个静默 bug 全从这里来）
 * `Node` 的字段被**局部 interface 重新声明**一份（"影子声明"）⇒ 编译器看见的是**影子**：
 *   · `update_feature.ts:940` 局部 interface 声明 `description?` ⇒ 读已删字段、永远 undefined ⇒ 路径静默退成 id
 *   · `design_diff.ts` `AnyNode = Record<string, unknown> & {id?}` ⇒ `.description` 是 `unknown` ⇒ tsc 不管 ⇒ 路径配对全失效
 *   · `file_snapshot.ts` / `dataflow_core.ts` 同型
 * ⇒ **真字段改了，影子不会跟着报错**。这就是类型系统本该提供的保护被绕过去了。
 *
 * ## 两条可机器判的规则（★ 只判能判的，判不了的不假装判）
 * E. 一处 `description` 出现在 **`nodes` 相关类型声明/断言**的 ±6 行窗口里
 *    ⇒ 疑似"Node 视图自己编了 description"（`Node.description` 已删，任何节点视图都不该有它）
 * F. `nodes` 的类型是**裸 `Record<string, unknown>`**（或 `unknown`）
 *    ⇒ 类型漏洞：任意属性都是 unknown ⇒ tsc 不管 ⇒ 今天的 bug 就是这么躲过去的
 *
 * ## 局限（诚实写在代码里，不假装）
 * 这是**文本窗口扫描**，不是 AST。它抓"字段名 + nodes 同现"，抓不到"别名绕两层"那种。
 * ⇒ 它是**防线**不是**证明**：绿了不代表没有影子，但红了**一定**有。
 *
 * 用法：node scripts/lint-node-shadows.mjs [--json]
 * 退出码：0 = 无问题；1 = 有问题（可当门）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const JSON_OUT = process.argv.includes('--json');
const WINDOW = 6;

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
};

const problems = [];
if (!fs.existsSync(SRC)) {
  console.log('[lint:node-shadows] 没有 src ⇒ 无事可判');
  process.exit(0);
}

for (const file of walk(SRC)) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = fs.readFileSync(file, 'utf8').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isComment = /^\s*(\/\/|\*|\/\*)/.test(line);
    if (isComment) continue; // 注释里提到 description 是**说明**，不是声明/读点

    // F：nodes 的类型是**裸 Record<string, unknown>** ⇒ 类型漏洞
    // ★ 2026-10-27 收紧：**只抓 `Record<string, unknown>`** —— `unknown[]` 是合法的
    //   （`sub_dsl.geometry.nodes` 递归遍历时本来就不知道元素类型），抓它 = 假阳性。
    if (/nodes\??\s*:\s*(Array<)?\s*Record<string,\s*unknown>/.test(line)) {
      problems.push({ file: rel, line: i + 1, rule: 'F', msg: `nodes 的类型是裸 Record<string, unknown> ⇒ 类型漏洞（任意属性 unknown，tsc 不管）`, text: line.trim().slice(0, 110) });
    }

    // E：**类型声明** `description?: …` 出现在 nodes 相关类型的上下文里 ⇒ Node 影子
    // ★ 2026-10-27 收紧（第一版 12 处里 ~10 处假阳性）：**只抓"可选字段声明"**。
    //   不抓的（tsc 自己会管）：对象字面量的 `description: …` 键、读取 `x.description`、
    //   行尾注释里提到 description、字符串里的 description（SQL/文案）。
    //   ⇒ 真病是**影子声明**（自己编一份 Node 的字段），那长成 `description?: <type>`。
    // ★★ 2026-10-27 二次修正：**不要求行首** —— 真实影子最常见的形态是**行内**
    //   `nodes: Array<{ id: string; description?: string }>`（负向测试第一版就漏了它）。
    //   ⇒ 同一行有 `nodes` 类型上下文，或 ±WINDOW 行内有，都算。
    if (/description\?:\s*\S/.test(line)) {
      const nodesTypeRe = /nodes\??\s*:\s*(Array<|\{)/;
      const nodesAccessRe = /geometry\??\.nodes/;
      let sawNodesType = nodesTypeRe.test(line) || nodesAccessRe.test(line);
      if (!sawNodesType) {
        const from = Math.max(0, i - WINDOW);
        const to = Math.min(lines.length - 1, i + WINDOW);
        for (let k = from; k <= to; k++) {
          if (k === i) continue;
          const l = lines[k];
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue;
          if (nodesTypeRe.test(l) || nodesAccessRe.test(l)) { sawNodesType = true; break; }
        }
      }
      if (sawNodesType) {
        problems.push({ file: rel, line: i + 1, rule: 'E', msg: `Node 视图**自己声明了 description** ⇒ 影子声明（该字段已删；路径用 path、说明用 title）`, text: line.trim().slice(0, 110) });
      }
    }
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ files: walk(SRC).length, problems }, null, 2));
} else if (problems.length === 0) {
  console.log('[lint:node-shadows] ✓ 无问题（Node 视图没有自己编字段）');
} else {
  console.log(`[lint:node-shadows] ✗ ${problems.length} 处 Node 影子/类型漏洞：`);
  for (const p of problems.slice(0, 40)) console.log(`  · [${p.rule}] ${p.file}:${p.line}\n      ${p.msg}\n      ${p.text}`);
  if (problems.length > 40) console.log(`  …另有 ${problems.length - 40} 处`);
}
process.exit(problems.length ? 1 : 0);
