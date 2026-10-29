#!/usr/bin/env node
/**
 * ★★★ cert T444 —— **类型树落盘 + 签名不再是第二处权威**（2026-10-29 · `T-#PIVOT-TYPEREF`）
 *
 * ## 判什么
 * 轴心要支持 N 语言，类型必须是**实体**（落盘的树），不能是"每次下游重新推一遍"的中间值。
 * 落盘后 \`targets.ts.signature\` 只剩**缓存**身份：它的每一个字都必须能由 \`pivot\` 重算出来。
 * 若重算对不上 ⇒ 签名是**第二处权威**（今天已经因此栽过 4 次：\`to\`/\`sigTs\`/缓存/策略）。
 *
 * ## 判据
 *   ① \`pivot\` 落盘率（缺的是源文件不在盘上的，如实列出，不算成功）；
 *   ② **可由 pivot 重算签名且逐字相等**（\`tsSignatureFromPivot(pivot, name) === signature\`）——
 *      对不上就是双权威，必须红；
 *   ③ **反向控制**：把一个符号的 pivot 参数类型改掉，②必须报不一致（证明判据真在读 pivot）。
 *
 * ## 边界（诚实）
 *   · 只覆盖 func/method（type/const 的签名走另一支渲染，未纳入重算）；
 *   · pivot 里的 \`ident.name\` 仍是**源侧文本**，未解析成轴心 id（\`T-#PIVOT-TYPEREF-IDS\`）；
 *   · 本证不判语义保真，只判"有没有第二处权威"。
 *
 * ## 用法
 *   npm run build && node certs/t444-pivot-typeref-cert.mjs [册子路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BOOK = process.argv[2] ?? 'D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { tsSignatureFromPivot } = await import(D + 'infrastructure/authoring/translate/book_ts.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const book = JSON.parse(fs.readFileSync(BOOK, 'utf8'));
const syms = book.symbols ?? [];
const withSig = syms.filter((s) => s.targets?.ts?.signature);
const withPivot = syms.filter((s) => s.pivot);

// ① 落盘率
chk(
  withPivot.length > 0,
  '① 类型树**已落盘**（`pivot` 是实体，不是内存中间值）',
  `pivot ${withPivot.length} / ${syms.length} · 有 TS 签名 ${withSig.length} · 差 ${withSig.length - withPivot.length}（源文件不在盘上 ⇒ 跳过）`,
);

// ② 签名可由 pivot 重算且逐字相等（单权威）
{
  const mismatches = [];
  let checked = 0;
  for (const s of syms) {
    if (!s.pivot || !s.targets?.ts?.signature) continue;
    if (s.pivot.kind !== 'func' && s.pivot.kind !== 'method') continue;
    checked++;
    const name = s.targets.ts.name;
    const { sig } = tsSignatureFromPivot(s.pivot, name);
    if (sig !== s.targets.ts.signature) {
      mismatches.push({ id: s.id, got: sig, want: s.targets.ts.signature });
    }
  }
  chk(
    mismatches.length === 0,
    '② **签名不是第二处权威**：逐字可由 pivot 重算（`signature` 只是缓存）',
    `参与重算 ${checked} 个 · 不一致 ${mismatches.length}` +
      (mismatches.length
        ? '\n     ' +
          mismatches
            .slice(0, 2)
            .map((m) => `${m.id}\n       pivot→${m.got}\n       磁盘→${m.want}`)
            .join('\n     ')
        : ''),
  );
}

// ③ 反向控制：篡改 pivot，②必须察觉
{
  const victim = syms.find((s) => s.pivot?.params?.length && s.targets?.ts?.signature);
  if (!victim) {
    chk(false, '③ 反向控制（找不到可篡改的样本）');
  } else {
    const tampered = JSON.parse(JSON.stringify(victim));
    // 把第一个参数的类型改成明显不同的东西
    tampered.pivot.params[0].ref = { kind: 'ident', name: 'DefinitelyNotTheSameType' };
    const { sig } = tsSignatureFromPivot(tampered.pivot, victim.targets.ts.name);
    chk(
      sig !== victim.targets.ts.signature,
      '③ **反向控制**：篡改 pivot 的参数类型，重算结果必须变化（判据真在读 pivot）',
      `${victim.id}：${sig.slice(0, 72)}`,
    );
  }
}

console.log(`\n═══ T444 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
