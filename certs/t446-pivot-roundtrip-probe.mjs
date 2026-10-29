#!/usr/bin/env node
/**
 * ★★★ cert T446 —— **回译探针**：`Go → pivot → Go`（2026-10-29 · `T-#PIVOT-ROUNDTRIP`）
 *
 * ## 为什么回译是轴心的判据
 * 用户的原话：语言间互相翻译就像"中→英→葡→西→德→中"，往返一定会有问题。
 * 那么**问题有多少、落在哪里**，就是轴心质量的唯一客观读数：
 * ```
 * Go → pivot → Go     差异必须为 0（类型这一维）
 * ```
 * 如果回译对不上、而失真账里又没写 ⇒ **轴心缺一维**，这就是最早的暴露点。
 * （MT 里这叫 back-translation；比 tsc 错误数有意义得多——tsc 只判"能不能编译"。）
 *
 * ## 本证只做**类型维**（诚实边界）
 * 函数体不参与回译：body 目前仍由 `body_mech` 直连（`T-#PIVOT-LIFTPROJ` 才拆）。
 * 所以本证证明的是"**类型信息穿过轴心无损**"，不是"整段代码无损"。
 *
 * ## 判据
 *   ① 每个有 `pivot` 的符号，其**参数类型**能被 Go 渲染器从 pivot 复原，且复原文本出现在源侧
 *      `sig`（Go 原文投影）里 —— 一致率必须 100%；
 *   ② 结果类型同理；
 *   ③ **反向控制**：把 pivot 里某参数类型改掉，回译文本必须变化（证明判据真在读 pivot）；
 *   ④ 报告 unsupported 度（渲染不出来的类型）—— 这些是**已知缺口**，不算通过。
 *
 * ## 用法
 *   npm run build && node certs/t446-pivot-roundtrip-probe.mjs [册子路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BOOK = process.argv[2] ?? 'D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { renderGoType, goSignatureFromPivot } = await import(
  D + 'infrastructure/authoring/translate/go_codegen.js'
);

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const syms = (book.symbols ?? []).filter((s) => s.pivot && s.sig);

/** 归一化：去掉多余空白，便于"是不是同一段类型文本"的比较（形状本身就是答案） */
const norm = (t) =>
  String(t ?? '')
    .replace(/\s+/g, ' ')
    .replace(/;\s*/g, ' ')   // Go 源码 struct 字段间是空格，渲染器是 '; ' ⇒ 分号不算信息
    .replace(/struct\s+\{/g, 'struct{')   // `struct {` vs `struct{`：空格不算信息
    .replace(/interface\s+\{/g, 'interface{')
    .trim();

// ① 参数类型回译（跳过接收者：Go 原文 sig 里没有它）
{
  let checked = 0;
  const misses = [];
  let unsupported = 0;
  for (const s of syms) {
    if (s.pivot.kind !== 'func' && s.pivot.kind !== 'method') continue;
    const params = s.pivot.params ?? [];
    // 方法的第一个参数是接收者（合成），Go 签名里不含 ⇒ 跳过
    const effective = s.pivot.kind === 'method' ? params.slice(1) : params;
    if (!effective.length) continue;
    checked++;
    const sig = norm(s.sig);
    for (const p of effective) {
      const r = renderGoType(p.ref);
      if (r.unsupported) {
        unsupported++;
        continue;
      }
      if (!sig.includes(norm(r.text))) {
        misses.push({ id: s.id, param: p.name, back: norm(r.text), sig });
      }
    }
  }
  chk(
    misses.length === 0,
    '① **参数类型穿过轴心无损**（回译文本出现在源侧 Go 签名里）',
    `参与 ${checked} 个符号 · 不一致参数 ${misses.length} · unsupported ${unsupported}` +
      (misses.length
        ? '\n     ' +
          misses
            .slice(0, 3)
            .map((m) => `${m.id} 参数 ${m.param}：回译「${m.back}」不在「${m.sig.slice(0, 70)}」里`)
            .join('\n     ')
        : ''),
  );
}

// ② 结果类型回译
//  ★ 口径：Go 允许**命名结果** `(principle, fix string)`，而轴心只存类型不存名字 ⇒
//    这里判「**结果个数一致** + 每个回译类型文本在源侧结果段里出现」。
//    结果名属**文档性信息**，轴心未存 —— 如实记为 `[未核]`（T-#PIVOT-RESULTNAMES），不假装无损。
{
  let checked = 0;
  const misses = [];
  for (const s of syms) {
    if (!s.pivot.result) continue;
    const r = renderGoType(s.pivot.result);
    if (r.unsupported) continue;
    checked++;
    const sig = norm(s.sig);
    // 回译出来的结果类型：元组则逐项，单项则一个
    const backItems =
      s.pivot.result.kind === 'tuple' ? s.pivot.result.items.map((i) => norm(renderGoType(i).text)) : [norm(r.text)];
    // 源侧结果段：最后一个 ')' 之后的部分（形如 `(principle, fix string)` 或 `(A, B)`）
    const tail = (() => {
      const t = sig.trim();
      if (!t.endsWith(')')) return t.slice(t.lastIndexOf(')') + 1).trim();
      let depth = 0;
      for (let i = t.length - 1; i >= 0; i--) {
        if (t[i] === ')') depth++;
        else if (t[i] === '(') {
          depth--;
          if (depth === 0) return t.slice(i);
        }
      }
      return '';
    })();
    const srcItems = tail.replace(/^\(/, '').replace(/\)$/, '').split(',').map((x) => x.trim()).filter(Boolean);
    const arityOk = backItems.length === srcItems.length;
    const typesPresent = backItems.every(
      (t) => sig.includes(t) || srcItems.some((x) => x.endsWith(t)),
    );
    if (!arityOk || !typesPresent) {
      misses.push({ id: s.id, back: backItems.join(' , '), arity: backItems.length + '/' + srcItems.length, tail });
    }
  }
  chk(
    misses.length === 0,
    '② **结果类型穿过轴心无损**（个数 + 类型文本；结果**名**未存，见边界）',
    `参与 ${checked} 个 · 不一致 ${misses.length}` +
      (misses.length
        ? '\n     ' +
          misses.slice(0, 3).map((m) => `${m.id}：回译「${m.back}」 个数 ${m.arity} 源侧「${m.tail.slice(0, 60)}」`).join('\n     ')
        : ''),
  );
}

// ③ 反向控制
{
  const victim = syms.find((s) => (s.pivot.params ?? []).length && s.pivot.kind !== 'method');
  if (!victim) {
    chk(false, '③ 反向控制（找不到可篡改样本）');
  } else {
    const back1 = goSignatureFromPivot(victim.pivot, 'X').text;
    const tampered = JSON.parse(JSON.stringify(victim.pivot));
    tampered.params[0].ref = { kind: 'ident', name: 'DefinitelyNotOriginType' };
    const back2 = goSignatureFromPivot(tampered, 'X').text;
    chk(back1 !== back2, '③ **反向控制**：篡改 pivot ⇒ 回译文本必须变化（判据真在读 pivot）', `${back1.slice(0, 62)} ≠ ${back2.slice(0, 62)}`);
  }
}

// ④ 整条签名的回译样本（给人看得见）
{
  const sample = syms.find((s) => s.pivot.kind === 'method' && (s.pivot.params ?? []).length > 2);
  if (sample) {
    const bt = goSignatureFromPivot(sample.pivot, sample.id.split('#').pop().split('.').pop());
    console.log(`\n── 回译样本（${sample.id}）──`);
    console.log(`   源侧 Go：${norm(sample.sig)}`);
    console.log(`   轴心→Go：${norm(bt.text)}`);
  }
}

console.log(`\n═══ T446 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
