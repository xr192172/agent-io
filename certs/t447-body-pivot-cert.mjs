#!/usr/bin/env node
/**
 * ★★★ cert T447 —— **函数体也走轴心**：`lift_go → 体 IR → project_ts` 与 legacy 直连等价
 *                                  （2026-10-29 · `T-#PIVOT-LIFTPROJ`）
 *
 * ## 判什么
 * `body_mech` 今天是 **Go→TS 直连**（读 Go AST 直接吐 TS 文本）。轴心要求中间有中立表示，
 * 否则加第三种语言就要再写一遍"Go→Rust"⇒ 回到 N²。
 *
 * 本证检查新建的竖切：`liftGoBody(Go AST) → IrStmt[] → projectTsBody()` 与 legacy 的输出是否**等价**。
 *
 * ## 判据
 *   ① **走轴心的体，输出必须与 legacy 等价**（去掉空白后逐字符相同）——不等价即"拆分改变了语义"；
 *   ② **覆盖率读数**：多少体 100% 落在本竖切支持的构造里（其余 `lift` 返回 `null` ⇒ 回落 legacy，
 *      **绝不半翻**：半翻出来的东西既不是 Go 也不是 TS）；
 *   ③ **反向控制**：篡改 IR 一个字面量，project 结果必须变化（证明比较真的在看 project 输出）。
 *
 * ## 边界（诚实）
 *   · 本竖切只覆盖 `return` / `expression_statement` / `:=` / `=` + 六种表达式；
 *     `if` / `for` / `switch` / `defer` / 字面量集合仍走 legacy（下一批）；
 *   · "等价"是**去掉空白后的字符级比较**，不判语义；语义只能靠运行时对拍（`[未核]`）；
 *   · 覆盖率小是**如实读数**，不是失败——本步目标是"打通竖切、不回归"，不是"一次全覆盖"。
 *
 * ## 用法
 *   npm run build && node certs/t447-body-pivot-cert.mjs [Go 仓库目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = process.argv[2] ?? 'D:/agentio/dev/agent-memory';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
const { translateGoBodyMech } = await import(D + 'infrastructure/authoring/translate/body_mech.js');
const { liftGoBody, projectTsBody } = await import(D + 'infrastructure/authoring/translate/body_pivot.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const goFiles = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git|\.agent-io/.test(p)) walk(p);
    } else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) goFiles.push(p);
  }
};
if (!fs.existsSync(SRC)) {
  console.log(`✗ 源目录不存在：${SRC}`);
  process.exit(2);
}
walk(SRC);

const strip = (s) => String(s ?? '').replace(/\s+/g, '');

let bodies = 0;
let covered = 0;
const mismatches = [];
let sample = null;

for (const f of goFiles) {
  let parsed;
  try {
    parsed = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  const stack = [parsed.root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'function_declaration' || n.type === 'method_declaration') {
      let block = null;
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'block') block = c;
      }
      if (!block) continue;
      bodies++;
      const legacy = translateGoBodyMech(block);
      const ir = liftGoBody(block);
      if (!ir) continue; // 未覆盖 ⇒ 回落 legacy（不算失败）
      covered++;
      const projected = projectTsBody(ir);
      if (strip(projected) !== strip(legacy)) {
        if (mismatches.length < 4) {
          mismatches.push({
            file: path.basename(f),
            line: n.startPosition?.row,
            pivot: strip(projected).slice(0, 120),
            legacy: strip(legacy).slice(0, 120),
          });
        }
      } else if (!sample) {
        sample = { file: path.basename(f), src: strip(legacy).slice(0, 120) };
      }
      continue;
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
}

// ① 等价性
chk(
  mismatches.length === 0,
  '① 走轴心的体，project 输出与 legacy **等价**（去空白逐字符相同）',
  `走轴心的体 ${covered} 个 · 不一致 ${mismatches.length}` +
    (mismatches.length
      ? '\n     ' +
        mismatches
          .slice(0, 2)
          .map((m) => `${m.file}:${m.line}\n       pivot →${m.pivot}\n       legacy→${m.legacy}`)
          .join('\n     ')
      : ''),
);

// ② 覆盖率（如实读数）
console.log(`\n── 覆盖率读数 ──`);
console.log(`   有体函数 ${bodies} 个 · 100% 落在本竖切 ${covered} 个（${((covered / bodies) * 100).toFixed(1)}%）`);
console.log(`   其余 ${bodies - covered} 个回落 legacy 直连（未覆盖构造，**不半翻**）`);
if (sample) console.log(`   等价样本（${sample.file}）：${sample.src}`);

// ③ 反向控制
{
  const ir = [{ k: 'return', values: [{ k: 'int', value: '42' }] }];
  const a = projectTsBody(ir);
  const b = projectTsBody([{ k: 'return', values: [{ k: 'int', value: '43' }] }]);
  chk(a !== b, '③ **反向控制**：篡改 IR 字面量 ⇒ project 输出必须变化', `${strip(a)} ≠ ${strip(b)}`);
}

console.log(`\n═══ T447 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
