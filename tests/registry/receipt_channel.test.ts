/**
 * P-A 门 · 写工具回执必须走 `---DATA---` 通道（规划书 §16.1）
 *
 * ★ 根因（实测）：`registry/plumbing.ts` 里
 *   - `wrap()`     → **只取 `message`，静默丢掉 `data`**（`return { text: r.message }`）；
 *   - `wrapData()` → 把 `data` 以 `---DATA---` + JSON 追加进文本。
 *   而 `edit_code` 原先用 **`wrap`** ⇒ 回执**永远是纯散文**，机器可读通道被扔掉。
 *   ⇒ agent 判成败只能**正则解析文本**；实测我因此踩了两次：
 *     ① 干跑回执以 `[干跑]` 开头、不以 `✓` 开头 ⇒ `startsWith('✓')` 把**成功判成失败** ⇒ **静默跳过落盘**；
 *     ② 正则漏 `from ` ⇒ 6 个文件全判成"无 import"。
 *   ★ 这与本仓 §2d「不许靠猜」**自相矛盾** —— 面向 agent 的工具，却让 agent 靠正则判成败，且猜错不报错。
 *
 * ★ 本门守：**声明为"回执类"的工具，其 handler 必须用 `wrapData`**。
 *   `RECEIPT_TOOLS` 是**棘轮**：只许增（把写工具一族逐个迁完），不许减。
 *
 * ⚠️ **诚实标注本门的边界**：它验的是"**通道没被丢掉**"（声明层），**不验**"字段内容对不对"。
 *    后者由**实测**覆盖（已手验：真 MCP 调 `edit_code` 干跑返回
 *    `---DATA--- {"ok":true,"op":"replace_text","file":"…","dry_run":true,"written":false}`），
 *    并留一条源码断言防字段声明被删。
 *
 * ★ 写这扇门时我踩到的坑（记下来别再犯）：**用一条 `name:'…',[\s\S]*?handler:` 全局扫多个 tool 块**，
 *   惰性匹配会让**前一个工具的匹配跨进下一个工具的区域**并吃掉它的 `handler:` ⇒ 被吃的那个解析不到。
 *   ⇒ 所以这里改用**有界跨度**（`{0,4000}`）而不是无界 `[\s\S]*?`。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..'); // here = tests/registry
const LANES = path.join(REPO, 'src', 'registry', 'lanes');

/** ★ 棘轮：已迁到 wrapData 的"回执类"工具（只许增）。写工具一族应逐个加入。 */
const RECEIPT_TOOLS: readonly string[] = ['edit_code'];

/** 该工具定义所在的 lane 源码 */
function laneSrc(name: string): string {
  for (const f of fs.readdirSync(LANES).filter((x) => x.endsWith('.ts'))) {
    const s = fs.readFileSync(path.join(LANES, f), 'utf8');
    if (new RegExp("name: '" + name + "',").test(s)) return s;
  }
  return '';
}

describe('P-A 门 · 写工具回执必须走 ---DATA--- 通道', () => {
  it('检测器自身有效（防"空转绿"）', () => {
    expect(laneSrc('edit_code').length, '找不到 edit_code 的定义').toBeGreaterThan(100);
    const all = fs
      .readdirSync(LANES)
      .filter((x) => x.endsWith('.ts'))
      .map((x) => fs.readFileSync(path.join(LANES, x), 'utf8'))
      .join('\n');
    // 反面：全仓确实同时存在 wrap 与 wrapData —— 证明"两种都抓得到"
    expect(/handler: wrap\s*\(/.test(all), '居然没有用 wrap 的工具？检测口径可疑').toBe(true);
    expect(/handler: wrapData\s*\(/.test(all), '居然没有用 wrapData 的工具？').toBe(true);
  });

  it('★ 声明为回执类的工具，handler 必须是 wrapData（有界跨度，防跨块误判）', () => {
    const bad: string[] = [];
    for (const t of RECEIPT_TOOLS) {
      const src = laneSrc(t);
      if (!src) {
        bad.push(t + ': 找不到定义');
        continue;
      }
      const bounded = new RegExp("name: '" + t + "',[\\s\\S]{0,4000}?handler: (wrapData|wrap|textOut)\\s*\\(");
      const m = src.match(bounded);
      if (!m) {
        bad.push(t + ': 在其定义块内找不到 handler 包装器');
        continue;
      }
      if (m[1] !== 'wrapData') bad.push(t + ': 用了 ' + m[1] + '（会丢掉 data → 回执又变纯散文）');
    }
    expect(
      bad,
      '回执通道被丢掉：\n  ' + bad.join('\n  ') + '\n⇒ 改 wrapData，并让实现返回 data（字段从**入参**派生）。',
    ).toEqual([]);
  });

  it('edit_code 的回执字段声明存在（防被删）+ 外层包装是"从入参派生"', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'tools', 'edit_code.ts'), 'utf8');
    for (const k of ['ok: boolean', 'dry_run: boolean', 'written: boolean']) {
      expect(src, 'EditReceipt 少了字段声明 ' + k).toContain(k);
    }
    expect(src, '缺少 editCode 外层包装（字段应从入参派生，不从 message 反推）').toContain(
      'export async function editCode(args: EditCodeArgs)',
    );
  });
});
