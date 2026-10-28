#!/usr/bin/env node
/**
 * ★★★ cert T410 —— **两个落地器产出同一份改写**（T-#OBSERVE-5 ① 前置）（2026-10-28）
 *
 * ## 这一步在做什么
 * "零污染插桩"（T-#OBSERVE-5 方案 ④）要的是：**源码不动，改写发生在内存里**。
 * 而插桩骨架早就把流程拆成 `collectSites → applyInsertions(content) → [写盘]` ——
 * 唯独 `write:false`（只规划）时**把算好的改写文本扔了**（又一个"读数在中间层蒸发"）。
 * ⇒ 本证钉住：**把 `content` 交出来之后，"内存落地"与"落盘落地"产出的文本逐字节相等**。
 *
 * ## 判据（每条亲手跑）
 *   ① `write:false` ⇒ **盘上文件逐字节不变**（一个字节都不许动），但 `result.content` **有改写后文本**
 *      且含 `captureProbe(`、含 `.enter` 与 `.exit` 两种探针；
 *   ② 同一文件 `write:true` 落盘后的内容，与 ① 的 `content` **逐字节相等**
 *      ⇒ "两个落地器"没有第二套改写逻辑；
 *   ③ 幂等：对**已插过**的文件再规划 ⇒ `content === undefined`（"没有变化"是信号，不拿原文冒充）；
 *   ④ 零插入点文件（纯类型）⇒ 也 `undefined`，不误报。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 只核 TS/JS 语言包（Python/Java/Go 语言包没进本证）；
 *   · **[未核]** 内存改写跑起来是否真能产事件（那要 loader + 真进程，属 ② 步）；
 *   · **[未核]** `commit`（写闸事务）缺失时的抛错路径（① 用 write:false 走不到）。
 *
 * ## 用法
 *   node certs/t410-instrument-plan-apply-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp410ia-'));
process.env.AGENT_IO_HOME = path.join(TMP, 'home');
process.env.AGENT_IO_REQUIRE_PLAN = '0';
fs.mkdirSync(process.env.AGENT_IO_HOME, { recursive: true });

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const ROOT = 'D:/agentio/dev/agent-io';
const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { instrumentFile } = await import(D + 'infrastructure/analysis/observe/instrument.js');

const proj = path.join(TMP, 'proj');
fs.mkdirSync(proj, { recursive: true });
const file = path.join(proj, 'a.ts');
const original = `export function fa(n: number): number {\n  if (n < 0) {\n    throw new Error('neg');\n  }\n  return n + 1;\n}\n`;
fs.writeFileSync(file, original);
const bytesOf = () => fs.readFileSync(file, 'utf-8');

const opts = {
  // ★ 落在**夹具目录**里：备份（backupRoot）与 fileRel 都相对它，绝不碰真仓
  projectRoot: proj,
  backupRoot: proj,
  probeImport: 'file:///D:/agentio/dev/agent-io/dist/src/infrastructure/analysis/observe/probe.js',
};

// ── ① 内存落地：盘不动，但拿到改写文本 ───────────────────
let planned;
{
  const before = bytesOf();
  planned = await instrumentFile(file, { ...opts, write: false });
  const after = bytesOf();
  chk(after === before, '① `write:false` ⇒ **盘上文件逐字节不变**');
  chk(typeof planned.content === 'string' && planned.content.length > before.length, '①-b `result.content` **有改写后文本**', `原 ${before.length}B → 改写后 ${planned.content?.length ?? 0}B`);
  const c = planned.content ?? '';
  chk(c.includes('captureProbe(') && c.includes('.enter') && c.includes('.exit'), '①-c 改写文本里含 `captureProbe(` + `.enter` + `.exit`（四类探针的 core 两类）');
}

// ── ② 落盘落地：内容与 ① 逐字节相等 ─────────────────────
{
  const r = await instrumentFile(file, {
    ...opts,
    write: true,
    // ★ SourceWriteHook 是**函数**（abs, content）=> void，不是对象
    commit: (abs, data) => fs.writeFileSync(abs, data, 'utf-8'),
  });
  const onDisk = bytesOf();
  chk(!r.error, '② 落盘落地成功（无 error）', r.error ?? '');
  chk(onDisk === planned.content, '②-b **两个落地器产出的文本逐字节相等**（没有第二套改写逻辑）', `盘上 ${onDisk.length}B vs 内存 ${planned.content?.length ?? 0}B`);
}

// ── ③ 幂等：已插过的文件再规划 ⇒ content undefined ──────
{
  const again = await instrumentFile(file, { ...opts, write: false });
  chk(again.content === undefined, '③ 已插过的文件再规划 ⇒ `content === undefined`（"没有变化"是信号，不拿原文冒充）', `content=${again.content === undefined ? 'undefined' : again.content.length + 'B'}`);
}

// ── ④ 纯类型文件：零插入点 ⇒ undefined ──────────────────
{
  const t = path.join(proj, 'types.ts');
  fs.writeFileSync(t, 'export interface Foo {\n  a: number;\n}\n');
  const r = await instrumentFile(t, { ...opts, write: false });
  chk(r.content === undefined && (r.sites?.length ?? 0) === 0, '④ 纯类型文件（零函数体）⇒ `undefined` + 0 探针（不误报）', `sites=${r.sites?.length ?? 0}`);
}

console.log(`\n═══ T410 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
