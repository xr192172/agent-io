#!/usr/bin/env node
/**
 * 工具链完整性检查（R74 的检测点）
 *
 * ## 为什么需要
 * 2026-11-05 实测：`node_modules/@esbuild/win32-x64` 在会话中途**消失了** ⇒
 * 一切 `dynamic import *.ts`（tsx）全挂 ⇒ `npm run verify` 的**测试门报 5 个文件红**，
 * **而 `npm test` 单跑当时是绿的**。
 *
 * ⇒ 症状与"测试真有失败"**同形**。于是下一次红会被读成"代码坏了"，
 *   而真相是"上一次跑把工具链改了" —— 这是 0.9.4 第 1 行（读不到 ≠ 没有）在**工具链**上的形态：
 *   **量具还是那个量具，只是它脚下的东西变了。**
 *
 * ## 它做两件事（分工不同，别混）
 * ① **断言**（可判红）：几个关键包必须**仍可解析**。缺一个 ⇒ 非零退出。
 *    ★ 这是"这一次真的坏了"的判据。
 * ② **报告**（只报不判）：`node_modules` 顶层目录 + mtime 的指纹。与上次记录不一致 ⇒
 *    **列出变了哪些包**，但**不判红** —— 因为正当的 `npm install` 也会变。
 *    ★ 若把 ② 也做成红，那就是"永远亮的灯"（0.16）：每次正当装包都会红。
 *
 * ## 用法
 *   node scripts/check-toolchain-intact.mjs            # 断言 + 与上次指纹比对
 *   node scripts/check-toolchain-intact.mjs --record    # 断言 + 记录当前指纹（建账）
 *   node scripts/check-toolchain-intact.mjs --json
 *
 * ## 边界（0.17①）
 * - **只管"还能不能解析"**，不管版本对不对（版本由 `package.json` / lock 管，那是另一处权威）。
 * - **不自动修**（修 = `npm install`，那正是可能把它弄坏的动作用）。
 * - 指纹**只取顶层目录名 + mtime**：不读文件内容（几万个文件读不完），所以它**抓不到**
 *   "包在但内容坏了"—— 那由 ① 的**可解析断言**兜住。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FP_REL = '.agent-io/toolchain-fingerprint.json';
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const record = argv.includes('--record');

/**
 * ★ 关键包清单 —— 每一个都是"缺了就有大量东西静默挂掉"的那种。
 * ★ 判据（加新条目时必须能答）：**它缺了，哪一个门/哪一批测试会红，而那个红看起来像什么？**
 *   答不出 ⇒ 别加（否则清单会变成"凡依赖都列一遍"的噪音）。
 */
const CRITICAL = [
  { pkg: 'esbuild', why: 'tsx 的底座；缺 ⇒ 一切 dynamic import *.ts 挂 ⇒ 测试门整片红' },
  { pkg: '@esbuild/win32-x64', why: 'esbuild 的 Windows 平台二进制（optional）；实测被 npm 当 extraneous 剪掉过' },
  { pkg: 'tsx', why: 'tests/ 与 CLI 的 TS 直跑入口；缺 ⇒ 测试门与多数探针挂' },
  { pkg: 'typescript', why: '「ts 类型」门靠它；缺 ⇒ 那道门直接失效' },
  { pkg: 'tree-sitter', why: '解析内核；缺 ⇒ 判据面大面积 unsupported（会被读成"判不了"而不是"环境坏了"）' },
];

function resolvable(pkg) {
  const req = createRequire(path.join(ROOT, 'noop.cjs'));
  try {
    const p = req.resolve(`${pkg}/package.json`);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ok: true, version: j.version ?? '(无 version 字段)' };
  } catch (e) {
    // ★ 有些包没有 package.json 导出限制 ⇒ 退一步只判"能解析到入口"
    try {
      req.resolve(pkg);
      return { ok: true, version: '(入口可解析，无 package.json exports)' };
    } catch {
      return { ok: false, reason: String(e?.code ?? e?.message ?? e).slice(0, 120) };
    }
  }
}

function fingerprint() {
  const nm = path.join(ROOT, 'node_modules');
  if (!fs.existsSync(nm)) return { ok: false, dirs: 0, map: {} };
  const map = {};
  for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(nm, e.name);
    try {
      map[e.name] = Math.round(fs.statSync(p).mtimeMs);
    } catch {
      /* 读不到就不记 —— 但那会让它看起来"消失了"，正是我们要的信号 */
    }
  }
  return { ok: true, dirs: Object.keys(map).length, map };
}

const results = CRITICAL.map((c) => ({ ...c, r: resolvable(c.pkg) }));
const broken = results.filter((x) => !x.r.ok);
const fp = fingerprint();

/**
 * ★★★ 2026-11-05 实测出来的**真正威胁**：临时项目目录用 `mklink /J` 把 `node_modules`
 * **指回本仓**（冷克隆/冷启动测试为了省安装时间就这么干），于是**在那个目录里跑一次
 * `npm install` 就会 reconcile 并裁剪【本仓】的 node_modules** ——
 * `@esbuild/win32-x64` 就是这样没的（症状：一切 `dynamic import *.ts` 挂、测试门整片红，
 * **与"测试真有失败"同形**）。
 *
 * ⇒ 本函数**只报告**（不判红）：列出**当前有哪些目录的 node_modules 是指回本仓的**。
 *   ★ 为什么不判红：这是**别人正在用的临时工作区**（R43：共享工作区里的异常值可能是活夹具），
 *     本工具无权替人清；但**必须让人看见** —— 否则下次工具链坏了还是查不出来。
 *   ★ 判据：`<dir>/node_modules` 的 ReparsePoint 属性为真且 target 指向本仓的 `node_modules`。
 */
function junctionsIntoThisRepo() {
  const self = path.join(ROOT, 'node_modules');
  const out = [];
  const roots = [ROOT, path.dirname(ROOT), process.env.TEMP].filter(Boolean);
  for (const base of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const nm = path.join(base, e.name, 'node_modules');
      try {
        const st = fs.lstatSync(nm);
        if (!st.isSymbolicLink()) continue;
        let tgt = '';
        try {
          tgt = fs.readlinkSync(nm);
        } catch {
          tgt = '';
        }
        if (!tgt) continue;
        const norm = String(tgt).replace(/^\\\\\?\\/, '').replace(/\\/g, '/').toLowerCase();
        if (norm === self.replace(/\\/g, '/').toLowerCase()) out.push(path.join(base, e.name));
      } catch {
        /* 没有 node_modules 或读不到 ⇒ 不是 junction */
      }
    }
  }
  return out;
}

const junctions = junctionsIntoThisRepo();

const fpAbs = path.join(ROOT, FP_REL);
let prev = null;
if (fs.existsSync(fpAbs)) {
  try {
    prev = JSON.parse(fs.readFileSync(fpAbs, 'utf8'));
  } catch {
    prev = null;
  }
}

const changed = [];
if (prev?.map && fp.ok) {
  const keys = new Set([...Object.keys(prev.map), ...Object.keys(fp.map)]);
  for (const k of keys) {
    if (prev.map[k] !== fp.map[k]) changed.push({ pkg: k, before: prev.map[k] ?? '(没有)', after: fp.map[k] ?? '(消失)' });
  }
}

if (record) {
  fs.mkdirSync(path.dirname(fpAbs), { recursive: true });
  fs.writeFileSync(fpAbs, JSON.stringify({ '//': 'node_modules 顶层目录 + mtime 指纹（scripts/check-toolchain-intact.mjs 写）', at: new Date().toISOString(), count: fp.dirs, map: fp.map }, null, 2) + '\n', 'utf8');
}

if (asJson) {
  console.log(JSON.stringify({ ok: broken.length === 0, critical: results, fingerprint: { dirs: fp.dirs, changed: changed.length }, changed, recorded: record }, null, 2));
} else {
  console.log('════ 工具链完整性（R74 · 断言 + 报告，两件事分开）════');
  console.log(`  关键包 ${CRITICAL.length} 个：`);
  for (const x of results) {
    console.log('    ' + (x.r.ok ? '✓' : '✗') + ' ' + x.pkg.padEnd(26) + (x.r.ok ? x.r.version : '**解析不到** (' + x.r.reason + ')'));
  }
  console.log('');
  console.log(`  node_modules 顶层目录 ${fp.dirs} 个` + (prev ? `（上次记录 ${Object.keys(prev.map ?? {}).length} 个）` : '（★ 没有上次记录 ⇒ 本次只报告，不比对；要记下来跑 --record）'));
  if (changed.length) {
    console.log(`  ★ 与上次相比变了 ${changed.length} 个包（★ 只报不判红 —— 正当的 npm install 也会变）：`);
    for (const c of changed.slice(0, 15)) console.log('      ' + c.pkg + '  ' + c.before + ' → ' + c.after);
    if (changed.length > 15) console.log(`      …余 ${changed.length - 15} 个`);
  } else if (prev) {
    console.log('  ✓ 指纹未变');
  }

  console.log('');
  if (junctions.length) {
    console.log('  ★★ 有 ' + junctions.length + ' 个目录的 node_modules 是【指回本仓】的 junction —— 在那里跑 npm install 会改坏本仓工具链（R74 实测）：');
    for (const j of junctions.slice(0, 15)) console.log('      ' + j);
    if (junctions.length > 15) console.log('      …余 ' + (junctions.length - 15) + ' 个');
    console.log('      处置：在那个目录里别跑 npm install；要跑就先 npm ci 装一份独立的（别借本仓的）。');
    console.log('      ★ 本节只报不判红（那可能是别人正在用的临时工作区 —— R43）。');
    console.log('');
  }
  if (broken.length) {
    console.log(`✗ 工具链**坏了**：${broken.length}/${CRITICAL.length} 个关键包解析不到 ⇒ 这不是"测试真有失败"，是环境坏了`);
    for (const b of broken) console.log(`    · ${b.pkg} —— ${b.why}`);
    console.log('  修：`npm install <pkg> --no-save`（★ 别改 package.json / lock —— 先让它能跑，再决定要不要进依赖）');
    process.exit(1);
  }
  console.log(`✓ 工具链完整：${CRITICAL.length}/${CRITICAL.length} 个关键包都可解析`);
}
process.exit(broken.length ? 1 : 0);
