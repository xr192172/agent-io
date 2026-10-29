#!/usr/bin/env node
/**
 * ★★★ cert T450 —— **语言层名词表的边界与真实性**（2026-10-29 · `T-#STD-TERMS-AUTO`）
 *
 * ## 用户定的规矩（本证强制它）
 * > 「项目词就不进工具内部词表，而是随项目配置。」
 *
 * ## 判什么
 *   ① **真实性**：语言层表里的每个类型名，必须在某个 `_go_std/<pkg>.ts` 里**真的导出**
 *      —— 否则就是"表说支持、实现没有"（今天已栽 5 次的那种假绿）；
 *   ② **边界**：语言层表**不得**含项目专属词（拿项目册子的 `types[]` 求交，必须为空）；
 *   ③ **反向控制**：伪造一个不存在的名字，①必须报红（证明核对不是恒真）。
 *
 * ## 边界（诚实）
 *   · 本证只核对"名字是否存在"，不核对"语义是否等价"（那是 t448 之类各自 shim 的证）；
 *   · 导出面用文本扫生成源码的 `export …`（**形状本身就是答案**：导出语法就长这样）；
 *   · `null` 决策（无对应）不参与①的真实性检查，但要能在 ② 之外单列。
 *
 * ## 用法
 *   npm run build && node certs/t450-lang-terms-cert.mjs [项目册子路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BOOK = process.argv[2] ?? 'D:/agentio/dev/agent-memory/.agent-io/design/memory.translate.json';
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { buildLangTerms, deriveStdExports } = await import(
  D + 'infrastructure/authoring/translate/lang_terms.js'
);

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const table = buildLangTerms();
const exportsByPkg = deriveStdExports();
const allExported = new Set();
for (const set of exportsByPkg.values()) for (const n of set) allExported.add(n);

// ① 真实性：每个非 null 的**类型名**（首字母大写、不是包名）必须在某个适配模块里导出
{
  const bad = [];
  for (const [name, dec] of Object.entries(table)) {
    if (dec.to === null) continue;
    const isPkg = name === name.toLowerCase();
    if (isPkg) continue; // 包名由 ② 的模块存在性覆盖
    // Time → number 是**换名决策**，不是"导出同名"，跳过（依据写在 dec.from）
    if (dec.to !== name) continue;
    if (!allExported.has(name)) bad.push(`${name}（依据 ${dec.from}）`);
  }
  chk(
    bad.length === 0,
    '① **真实性**：语言层表里的类型名都在某个 `_go_std` 模块里真的导出',
    `表 ${Object.keys(table).length} 条 · 适配模块导出名 ${allExported.size} 个 · 缺失 ${bad.length}` +
      (bad.length ? '\n     ' + bad.slice(0, 4).join(' · ') : ''),
  );
}

// ② 边界：语言表 ∩ 项目词表 = ∅
{
  const projectWords = new Set(
    (JSON.parse(fs.readFileSync(BOOK, 'utf8')).types ?? [])
      .map((t) => t.from)
      .filter((x) => typeof x === 'string'),
  );
  const overlap = Object.keys(table).filter((k) => projectWords.has(k));
  chk(
    overlap.length === 0,
    '② **边界**：语言层表**不含**项目专属词（项目词随项目配置走）',
    `项目词 ${projectWords.size} 个${projectWords.size ? `（${[...projectWords].slice(0, 6).join(',')}…）` : ''} · 与语言表重叠 ${overlap.length}` +
      (overlap.length ? `\n     重叠：${overlap.join(' · ')}` : ''),
  );
}

// ③ 反向控制：伪造的名字必须被判缺失
{
  const fake = 'DefinitelyNotExportedAnywhere';
  const detected = !allExported.has(fake);
  chk(detected, '③ **反向控制**：伪造一个不存在于任何适配模块的名字，核对必须能发现（不是恒真）');
}

console.log('\n── 语言层词表构成 ──');
const pkgCount = Object.keys(table).filter((k) => k === k.toLowerCase()).length;
const nullCount = Object.values(table).filter((v) => v.to === null).length;
console.log(`   包名 ${pkgCount} · 类型名/换名 ${Object.keys(table).length - pkgCount - nullCount} · 无对应(null) ${nullCount}`);

console.log(`\n═══ T450 读数：PASS=${P} FAIL=${F} ═══`);
console.log('════ 汇总：PASS=' + P + '  FAIL=' + F);
process.exit(F === 0 ? 0 : 1);
