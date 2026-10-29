#!/usr/bin/env node
/**
 * ★★★ cert T445 —— **特性槽 + 失真账是“算出来的”，不是“写出来的”**（2026-10-29 · `T-#PIVOT-SLOTS`）
 *
 * ## 判什么
 * 轴心要支持 N 语言，失真必须**由规则从事实推出**：
 * ```
 * 源槽位（走 pivot 的类型树）× 目标语言能力声明 ⇒ 失真标签
 * ```
 * 只有这样，任意语言对的失真才是**两条已知失真的复合**，而不是每对实测一遍。
 *
 * ## 判据
 *   ① **七条硬轴逐条可识别**：每轴造一个类型样例，断言槽位被走出、失真被判定；
 *   ② **能力表是唯一入口**：虚构一个"原生 i64 环绕"的目标语言，`int-overflow` 必须**消失**
 *      —— 证明判定读的是 capability，不是硬编码（反向控制）；
 *   ③ **复合规则可用**：`compose(exact, x) === x`，且可交换；
 *   ④ **mut 轴不靠类型树**：Go 值语义 → TS 引用语义，无论有没有 struct 参数都必须记一条
 *      （这是最容易静默漏掉的真失真）。
 *
 * ## 全仓读数（本证的主要产出）
 * 走一遍册子里所有 `pivot` 单元的 params/result，输出**按轴的失真分布** ——
 * 这是"这套翻译到底有哪些语义偏离"的第一份完整清单。
 *
 * ## 边界（诚实）
 *   · 权重（`WEIGHT`）只用于排序，**不是严格语义**；复合是近似，不是定理；
 *   · `qualified` 类型（`time.Time` 等）**不猜槽位**（内部形态未知，交给外部依赖策略）；
 *   · 本证不判"译文是否真的实现了这些语义"，只判"失真有没有被算出来并记账"。
 *
 * ## 用法
 *   npm run build && node certs/t445-pivot-slots-cert.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const P = await import(D + 'infrastructure/authoring/translate/pivot.js');

let pass = 0;
let fail = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? pass++ : fail++;
};

const ident = (name) => ({ kind: 'ident', name });
const go = P.CAPABILITIES['go'];
const ts = P.CAPABILITIES['ts'];

// ── ① 七条硬轴逐条可识别 ──
const axisCases = [
  ['int', { kind: 'ident', name: 'int64' }, 'int-overflow'],
  ['str', { kind: 'ident', name: 'string' }, 'str-index'],
  ['null', { kind: 'pointer', elem: ident('Foo') }, 'null-implicit'],
  ['mut', undefined, 'mut-value-copy'], // 语言级差异，不靠类型树
  ['err', undefined, 'exact'], // 本项目约定 (T, error) 元组 ⇒ 等价
  ['conc', { kind: 'chan', elem: ident('int') }, 'conc-approximate'],
  ['own', undefined, 'exact'], // 双方 GC
];
for (const [axis, ref, wantLoss] of axisCases) {
  const slots = P.slotsOf(ref);
  const entries = P.lossinessOfUnit([ref], 'go', 'ts');
  const hit = entries.find((e) => e.axis === axis);
  chk(
    !!hit && hit.loss === wantLoss,
    `① 轴 \`${axis}\` 可识别且判为 \`${wantLoss}\``,
    `槽位 ${slots.length ? slots.map((s) => s.form).join(' · ') : '(语言级)'} · 实得 ${hit ? hit.loss : '未识别'}`,
  );
}

// ── ② 反向控制：虚构"原生 i64 环绕"的目标语言，int-overflow 必须消失 ──
{
  const fake = {
    ...ts,
    lang: 'fake64',
    int: { widths: [64], overflow: 'wrap', exactMax: Number.MAX_SAFE_INTEGER },
  };
  P.CAPABILITIES['fake64'] = fake;
  const ref = { kind: 'ident', name: 'int64' };
  const with64 = P.lossinessOfUnit([ref], 'go', 'fake64').find((e) => e.axis === 'int');
  const toTs = P.lossinessOfUnit([ref], 'go', 'ts').find((e) => e.axis === 'int');
  chk(
    with64?.loss === 'exact' && toTs?.loss === 'int-overflow',
    '② **反向控制**：同一份源码，换目标能力表 ⇒ 失真标签随之改变（判定读 capability）',
    `→fake64（有 i64 环绕）：${with64?.loss} · →ts（只有 f64）：${toTs?.loss}`,
  );
  delete P.CAPABILITIES['fake64'];
}

// ── ③ 复合规则 ──
{
  const ok = P.composeLoss('exact', 'int-overflow') === 'int-overflow' && P.composeLoss('str-index', 'int-overflow') === 'int-overflow' && P.composeLoss('int-overflow', 'str-index') === 'int-overflow';
  chk(ok, '③ 复合规则可用（`exact` 为幺元、可交换）', '用于 A→B = A→pivot 复合 pivot→B');
}

// ── ④ mut 轴不靠类型树 ──
{
  const entries = P.lossinessOfUnit([], 'go', 'ts');
  chk(
    entries.some((e) => e.axis === 'mut' && e.loss === 'mut-value-copy'),
    '④ **mut 轴**即使无类型信息也必须记（Go 值语义 → TS 引用语义）',
    entries.map((e) => `${e.axis}:${e.loss}`).join(' · '),
  );
}

// ── 全仓读数 ──
console.log('\n── 全仓失真分布（册子里的 pivot 单元，Go→TS）──');
const BOOK = 'D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json';
if (!fs.existsSync(BOOK)) {
  console.log('   册子不存在，跳过读数');
} else {
  const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
  const units = (book.symbols ?? []).filter((s) => s.pivot);
  const byAxis = new Map();
  const byLoss = new Map();
  let withAnyLoss = 0;
  for (const s of units) {
    const refs = [...(s.pivot.params ?? []).map((p) => p.ref), s.pivot.result].filter(Boolean);
    const entries = P.lossinessOfUnit(refs, 'go', 'ts');
    const real = entries.filter((e) => e.loss !== 'exact');
    if (real.length) withAnyLoss++;
    for (const e of entries) {
      byAxis.set(e.axis, (byAxis.get(e.axis) ?? 0) + 1);
      byLoss.set(e.loss, (byLoss.get(e.loss) ?? 0) + 1);
    }
  }
  console.log(`   单元 ${units.length} 个 · 含至少一条已知失真 ${withAnyLoss} 个（${((withAnyLoss / units.length) * 100).toFixed(1)}%）`);
  console.log('   按轴：' + [...byAxis.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · '));
  console.log('   按标签：' + [...byLoss.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · '));
}

console.log(`\n═══ T445 读数：PASS=${pass} FAIL=${fail} ═══`);
console.log('════ 汇总：PASS=' + pass + '  FAIL=' + fail);
process.exit(fail === 0 ? 0 : 1);
