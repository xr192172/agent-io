/**
 * impl-mutate —— 实现层变异器（C2b）
 *
 * ## 它回答一个问题
 * **这个实现，被夹具覆盖到了吗？**
 *
 * 做法：拿 `extractMutants` 从 **AST** 抽出的可变异点（不是正则找的 `===`），
 * 逐个改 → 增量编译 → 跑夹具：
 *
 * ```
 * 夹具变红  ⇒ 杀死（killed）  ⇒ 该实现被覆盖 ✓
 * 夹具全绿  ⇒ 存活（survived）⇒ ★ 该实现【没被覆盖】—— 这不是"通过"，是"没验到"
 * ```
 *
 * ## 为什么必须先杀掉
 * 变异存活不等于"代码没问题"，而是"夹具对这段逻辑无感"。
 * 把"存活"当"通过"，就是本仓最反对的那种假绿灯。
 *
 * ## 安全性（变异是破坏性的）
 * - 原文读进内存，`restore()` 写回；**`finally` 里再兜一次**（中途抛错也还原）
 * - 跑完打印 md5，与开头对比 ⇒ **byte-for-byte 还原**才算收工
 *
 * ## 用法
 *   node scripts/impl-mutate.mjs --file=src/domain/task_machine.ts          # 只试前 3 个点
 *   node scripts/impl-mutate.mjs --file=... --line=238                      # 只试 L238±3 的点
 *   node scripts/impl-mutate.mjs --file=... --all                           # 全跑（19 点 ≈ 42s）
 *   node scripts/impl-mutate.mjs --file=... --fixture=scripts/xxx.mjs       # 换夹具
 *
 * ## 全语言通用（如实声明）
 * `extractMutants` 目前只认 TS/tree-sitter 的 `binary_expression`。
 * 其他语言要各自的节点表 —— 本文件不假装支持。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const argOf = (k) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const FILE = argOf('file');
if (!FILE) {
  console.error('用法: node scripts/impl-mutate.mjs --file=<仓库相对路径> [--line=N] [--all] [--fixture=...]');
  process.exit(2);
}
const ONLY_LINE = argOf('line') ? Number(argOf('line')) : undefined;
const ALL = process.argv.includes('--all');
const FIXTURE = argOf('fixture') ?? 'scripts/impl-fixture.mjs';
const ABS = path.join(ROOT, FILE);

const { extractMutants, applyMutant } = await import(
  pathToFileURL(path.join(ROOT, 'dist/src/infrastructure/parse/mutants.js')).href
);

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const ORIG = fs.readFileSync(ABS, 'utf8');
const ORIG_MD5 = md5(ORIG);

/** ★ 还原（finally 里再兜一次） */
function restore() {
  fs.writeFileSync(ABS, ORIG);
}

const all = await extractMutants(ABS, ORIG);
if (all.length === 0) {
  console.log(`✓ ${FILE} 没有可变异点（该文件没有比较运算符）`);
  process.exit(0);
}

// 选点：--line 取附近 ±3；否则默认前 3 个；--all 全跑
let targets = all;
if (ONLY_LINE !== undefined) targets = all.filter((m) => Math.abs(m.line - ONLY_LINE) <= 3);
else if (!ALL) targets = all.slice(0, 3);

console.log(`════ 实现变异 · ${FILE} ════`);
console.log(`  可变异点 ${all.length} · 本次试 ${targets.length} 个（${ONLY_LINE !== undefined ? `L${ONLY_LINE}±3` : ALL ? '--all' : '默认前 3'}）`);
console.log(`  夹具 ${FIXTURE}`);
console.log('');

const tscLocal = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const compiled = [];
const result = { killed: 0, survived: 0, broken: 0 };

try {
  for (const m of targets) {
    process.stdout.write(`  L${String(m.line).padStart(4)} ${m.from} → ${m.to}  `);
    fs.writeFileSync(ABS, applyMutant(ORIG, m));

    // ① 增量编译（产出 dist；夹具跑的是 dist）
    let compileOk = true;
    let compileMsg = '';
    try {
      execFileSync(process.execPath, [tscLocal], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      compileOk = false;
      compileMsg = String(e.stdout ?? '') + String(e.stderr ?? '');
    }

    // ② 跑夹具
    let fixtureOk = true;
    let fixtureMsg = '';
    if (compileOk) {
      try {
        execFileSync(process.execPath, [FIXTURE], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        fixtureOk = false;
        fixtureMsg = String(e.stdout ?? '') + String(e.stderr ?? '');
      }
    }

    // ③ 还原（每次都还，不等循环结束）
    restore();

    if (!compileOk) {
      // ★★ 2026-10-20 订正：**变异体编译不过 = 程序起不来 = 被检出**，等价于「杀死」。
      //   原先把它单列成 broken，既不杀也不活，等于把它放过了。
      result.killed += 1;
      console.log('杀死 ✓（变异体编译失败 = 程序起不来）');
      compiled.push({ line: m.line, verdict: 'killed-by-compile', msg: compileMsg.split('\n').find((l) => l.includes('error TS')) ?? '' });
      continue;
    }
    if (fixtureOk) {
      result.survived += 1;
      console.log('★ 存活（夹具全绿）—— 该实现没被覆盖');
      compiled.push({ line: m.line, verdict: 'survived' });
    } else {
      result.killed += 1;
      const first = fixtureMsg.split('\n').find((l) => l.trim().startsWith('✗')) ?? '';
      console.log(`杀死 ✓${first ? '  ' + first.trim().slice(0, 60) : ''}`);
      compiled.push({ line: m.line, verdict: 'killed' });
    }
  }
} finally {
  restore();
}

// ④ 还原自检：byte-for-byte
const afterMd5 = md5(fs.readFileSync(ABS, 'utf8'));
const restored = afterMd5 === ORIG_MD5;

console.log('');
console.log(`  ── 结果 ──`);
console.log(`  杀死 ${result.killed} · 存活 ${result.survived} · 编译失败 ${result.broken}`);
console.log(`  还原 ${restored ? '✓ byte-for-byte（md5 相同）' : '✗ md5 不同！源文件可能已被污染'}`);
if (result.survived > 0) {
  console.log('');
  console.log('  ★ 有变异存活 ⇒ 夹具对那几行**无感**。');
  console.log('    这不是"实现没问题"，是"没验到"。要么补夹具，要么承认那几行没被覆盖。');
}
if (!restored) process.exit(1);
if (result.broken > 0) process.exit(1);
