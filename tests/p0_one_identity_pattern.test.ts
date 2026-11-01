/**
 * 「一个身份判定只许有一处实现」—— 挡住把 `path.resolve(dsl.source_root) === absRoot` 再写回去。
 *
 * ## 为什么需要（2026-11-01 外审 + 只读侦察卡实测）
 * 这句判定曾经**一字不差地散在四处**（`write_gate` / `file_snapshot` / `ledger_membership` / `claim_conflict`）。
 * `source_root` 里存的是**写册那台机器**的绝对路径 ⇒ 换一台机器比较**恒 false**
 * ⇒ `rootFeatureCount = 0` ⇒ `applicable:false` ⇒ **任务闸对全仓静默放行**（不拦、不报、不响）。
 *
 * 现已收成 `storage#isSameProject`（判据 = 「册住在谁家」，不是比较 `source_root`）。
 * 本用例守两件：
 *   ① 那个唯一实现还在，且四处调用点都还在用它；
 *   ② 四处调用点里**不许再出现**直接比较 `source_root` 的表达式（注释不算 —— 注释里举例说明"别这么写"是合法的）。
 *
 * ★ 口径说明：`storage#isSameProject` 内部**有一处**合法的 `path.resolve(sr) === absRoot`
 *   （数据仓里未登记册的第二支：位置不携带归属，只能问它自己记的 source_root）。
 *   所以本用例**只扫那四个调用点**，不扫 `storage.ts` —— 否则会误红。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** 四个曾经各写一遍的调用点 */
const SITES = [
  'src/application/write_gate.ts',
  'src/application/refactor/snapshot/file_snapshot.ts',
  'src/application/design/ledger_membership.ts',
  'src/application/claim_conflict.ts',
];

/** 去掉行注释与块注释（保留代码）；字符串里的 `//` 极少见且不影响本判据 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

test('身份判定收在一处：四处调用点都走 isSameProject', () => {
  const storage = fs.readFileSync(path.join(ROOT, 'src/infrastructure/storage.ts'), 'utf8');
  assert.match(
    storage,
    /export function isSameProject\(/,
    'storage.ts 里找不到 `export function isSameProject(` —— "一个身份判定只许一处实现"的唯一实现不见了',
  );

  const missing = SITES.filter((f) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    return !code.includes('isSameProject(');
  });
  assert.deepEqual(missing, [], `这些调用点没走 isSameProject（换机器会静默放行）：${JSON.stringify(missing)}`);
});

test('四处调用点里不许再直接比较 source_root（注释里说"别这么写"是合法的）', () => {
  const BAD = [
    /path\.resolve\(\s*[^)]*source_root[^)]*\)\s*[!=]==?/, // path.resolve(x.source_root) === absRoot
    /\bsource_root\b[^;\n]{0,40}[!=]==?[^;\n]{0,40}\babsRoot\b/, // sr === absRoot
    /\babsRoot\b[^;\n]{0,40}[!=]==?[^;\n]{0,40}\bsource_root\b/, // absRoot === sr
  ];
  const hits: string[] = [];
  for (const f of SITES) {
    const lines = stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8')).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (BAD.some((re) => re.test(line))) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(
    hits,
    [],
    '这些地方又出现"直接比较 source_root"了 —— source_root 是**写册那台机器**的绝对路径，换机器恒 false。\n' +
      '改用 `storage#isSameProject(sheet, absRoot)`（判据 = 册住在谁家）。\n' +
      hits.join('\n'),
  );
});
