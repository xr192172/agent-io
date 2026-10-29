#!/usr/bin/env node
/**
 * ★★★ cert T449 —— **函数体回译**：`IR → Go → IR` 等构（2026-10-29 · `T-#PIVOT-BODY-ROUNDTRIP`）
 *
 * ## 判什么
 * `t446` 证明了**类型层**穿过轴心无损；体层此前没有对手方（体 IR 不落盘、也没有 Go 渲染器）。
 * 现在补上第三个渲染器（`go_body_codegen`）后，可以判最强的一条：
 * ```
 * 体 IR ──render──→ Go 文本 ──parse+lift──→ 体 IR'      要求 IR' ≡ IR（结构等构）
 * ```
 * 这才是"函数体在轴心里有没有走丢"的直接证据；比文本比较公平（Go 侧是规范形，文本必不同）。
 *
 * ## 判据
 *   ① **等构率**：IR → Go → IR 后深比较相等 —— 必须 100%（不等于就是渲染器或 lift 丢了信息）；
 *   ② **反向控制**：故意改 IR 一个字段，等构必须**失败**（证明比较真的在比结构，不是恒真）；
 *   ③ **覆盖率读数**：册子里多少符号带体 IR（= 体层能回译的比例）。
 *
 * ## 边界（诚实）
 *   · 只覆盖本竖切支持的 IR 构造（未覆盖的构造压根没有 IR）；
 *   · `composite` 的元素类型用占位（`[]int` 等）⇒ 重新 lift 时类型名不同，但**不影响 IR 结构比较**
 *     （类型在 `pivot` 的名词层，不在体 IR 里）；
 *   · 本证不判"译文行为对不对"（那要靠对拍 `t441`/harness）。
 *
 * ## 用法
 *   npm run build && node certs/t449-body-roundtrip-cert.mjs [pivot 产物路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PIVOT = process.argv[2] ?? 'D:/agentio/dev/agent-memory/.agent-io/design/memory.pivot.json';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { renderGoBody } = await import(D + 'infrastructure/authoring/translate/go_body_codegen.js');
const { liftGoBody } = await import(D + 'infrastructure/authoring/translate/body_pivot.js');
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const pivot = JSON.parse(fs.readFileSync(PIVOT, 'utf8'));
const entries = Object.entries(pivot.symbols ?? {}).filter(([, v]) => Array.isArray(v.body) && v.body.length);
console.log(`册子轴心：符号 ${Object.keys(pivot.symbols ?? {}).length} · **带体 IR ${entries.length}**`);

/** 从生成的 Go 文本里重新 lift 出 IR：包成一个函数体再解析 */
async function roundTrip(ir) {
  const src = `package p\n\nfunc __rt() {\n${renderGoBody(ir)}\n}\n`;
  const parsed = await parseAstRoot('__rt.go', src);
  // 找函数体 block
  const stack = [parsed.root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.type === 'function_declaration') {
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i);
        if (c && c.type === 'block') return liftGoBody(c);
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) stack.push(c);
    }
  }
  return null;
}

const norm = (v) => JSON.stringify(v);

// ① 等构率
{
  const bad = [];
  let ok = 0;
  for (const [id, v] of entries) {
    let ir2 = null;
    try {
      ir2 = await roundTrip(v.body);
    } catch (e) {
      bad.push({ id, why: 'render/parse 抛错：' + String(e.message).slice(0, 60) });
      continue;
    }
    if (!ir2) {
      bad.push({ id, why: '重新 lift 失败（null）' });
      continue;
    }
    if (norm(ir2) === norm(v.body)) ok++;
    else bad.push({ id, why: '结构不等构' });
  }
  chk(
    bad.length === 0,
    '① **函数体穿过轴心等构**（IR → Go → IR 深比较相等）',
    `参与 ${entries.length} · 等构 ${ok} · 不等构 ${bad.length}` +
      (bad.length ? '\n     ' + bad.slice(0, 3).map((b) => `${b.id}：${b.why}`).join('\n     ') : ''),
  );
}

// ② 反向控制：改一个字段，等构必须失败
{
  const [id, v] = entries[0] ?? [];
  if (!v) {
    chk(false, '② 反向控制（没有样本）');
  } else {
    const tampered = JSON.parse(JSON.stringify(v.body));
    tampered[0] = { k: 'return', values: [{ k: 'int', value: '424242' }] };
    const ir2 = await roundTrip(tampered);
    // 正确口径：回环是忠实的 ⇒ ir2 应等于 **篡改后**的 IR，且 **不等于原 IR**
    chk(norm(ir2) === norm(tampered) && norm(ir2) !== norm(v.body), '② **反向控制**：篡改后的 IR 回环后等于篡改版、**不等于原版**（比较不是恒真）', `${id}`);
  }
}

console.log(`\n═══ T449 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
