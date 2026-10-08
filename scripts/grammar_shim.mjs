/**
 * grammar_shim —— **一份绑定**编所有 tree-sitter 语法。这是我们自己维护的那一层。
 *
 * ## 它解决什么
 * 上游把「Node 绑定」这层**跟语言无关的胶水**交给每个语言包各自维护（复制了 400+ 份），
 * 于是一半老化成 NAN（核心只认 N-API）⇒ 语法本身是好的，却载入不了。
 * 本脚本把那层胶水**收回来只写一份**：读语法的 `src/parser.c` → 生成绑定 → 编译 → 产出可 import 的包。
 *
 * ## 判据（必须先满足，否则白编）
 * `src/parser.c` 里的 `#define LANGUAGE_VERSION` ∈ {13, 14}
 *   —— 对齐核心 0.21 的 `MIN_COMPATIBLE=13` / `LANGUAGE_VERSION=14`（见 `api.h`）。
 *   低于 13（太老）或高于 14（太新）⇒ **必须先用 `tree-sitter generate` 重生成**，本脚本帮不了。
 *
 * ## 用法
 *   node scripts/grammar_shim.mjs list                     # 看声明表
 *   node scripts/grammar_shim.mjs fetch <lang>             # 只取语法源码到 .inspect/grammar-src/<lang>/
 *   node scripts/grammar_shim.mjs build <lang>             # 取源 + 生成绑定 + 编译 + 真加载验证
 *   node scripts/grammar_shim.mjs build-all                # 表里所有
 *   node scripts/grammar_shim.mjs install <lang>           # 把产物放进 vendor/grammars/<lang>/ 并声明 file: 依赖
 *
 * ★ 判据不是"编译成功"，是**真加载**：`import` + `setLanguage` + `parse`。
 *   而且**每门一个子进程**验证 —— 同进程连加载多个原生模块会让进程无声猝死（实测）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SOURCES = path.join(REPO, 'vendor', 'grammars', 'SOURCES.json');
const SRCROOT = path.join(REPO, '.inspect', 'grammar-src');
const TS_INCLUDE = path.join(REPO, 'node_modules', 'tree-sitter', 'vendor', 'tree-sitter', 'lib', 'include');
const NODE_GYP = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const PROBE = path.join(REPO, '.inspect', '_probe_spec.mjs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const MIN_ABI = 13, MAX_ABI = 14;

const table = JSON.parse(fs.readFileSync(SOURCES, 'utf8'));
// ★ Windows 上 `git`/`npm` 是 .cmd ⇒ 需要 shell；而 **`tar` 不能走 shell** ——
//   cmd 会吃掉参数（实测：`-C <dir>` 那条解包静默什么都没解出来）。这与 `curl` 是同一个坑。
const run = (cmd, args, cwd, timeout = 900000, useShell = process.platform === 'win32') => new Promise((res) =>
  execFile(cmd, args, { cwd, timeout, shell: useShell, maxBuffer: 1 << 24 },
    (e, o, se) => res({ ok: !e, out: `${o}\n${se}` })));

const readAbi = (parserC) => {
  const m = fs.readFileSync(parserC, 'utf8').slice(0, 400000).match(/#define\s+LANGUAGE_VERSION\s+(\d+)/);
  return m ? Number(m[1]) : null;
};
const readSymbol = (parserC) => {
  const m = fs.readFileSync(parserC, 'utf8').match(/TSLanguage\s*\*\s*(tree_sitter_[A-Za-z0-9_]+)\s*\(\s*void\s*\)/);
  return m ? m[1] : null;
};

async function fetchSrc(name) {
  const e = table[name];
  if (!e) throw new Error(`表里没有 ${name}`);
  const dir = path.join(SRCROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  if (e.from.kind === 'npm') {
    const tarball = path.join(REPO, '.inspect', 'ts-bundle', 'npm', `${e.from.pkg}-${e.from.version}.tgz`);
    if (!fs.existsSync(tarball)) {
      const r = await run(npm, ['pack', `${e.from.pkg}@${e.from.version}`, '--pack-destination', path.dirname(tarball), '--silent'], REPO);
      if (!r.ok) throw new Error(`npm pack ${e.from.pkg}@${e.from.version} 失败`);
    }
    // ★ `-C` 必须给**相对路径**：Windows 的 tar 是 bsdtar，它把 `C:\...` 里的盘符当成
    //   **远程主机**（`tar -C host:path` 那套语法）⇒ 报 `Error is not recoverable: exiting now`。
    //   （反例参照：gyp 那边恰好相反，**必须**绝对路径。同一个环境里两条相反的规矩。）
    // ★ 三个坑叠在一起（都在 Windows 的 bsdtar 上）：
    //   ① 走 `cmd` 会吃掉参数 ⇒ 不能有 shell；
    //   ② `-C C:\...` 里的盘符被当成**远程主机**（tar 的 host:path 语法）⇒ 必须相对路径；
    //   ③ `path.relative` 给的是**反斜杠**，而 bsdtar 把 `\` 当转义符 ⇒ 必须转正斜杠。
    const toPosix = (p) => p.split(path.sep).join('/');
    const ex = await run('tar', ['-xzf', toPosix(path.relative(REPO, tarball)), '-C', toPosix(path.relative(REPO, dir))],
      REPO, 600000, false /* 见 ① */);
    if (!ex.ok) throw new Error(`解包 ${path.basename(tarball)} 失败: ${ex.out.split('\n').filter(Boolean).slice(-3).join(' | ').slice(0, 160)}`);
    return path.join(dir, 'package', e.from.subpath ?? '');
  }
  if (e.from.kind === 'git') {
    const dst = path.join(dir, path.basename(e.from.repo));
    if (!fs.existsSync(dst)) {
      // ★ 有 `rev` 就**钉到那个 revision** —— 否则"重建"只是"从 default 分支拉最新的"，
      //   哪天上游一动，重编出来的就不是同一份东西了（"可复现"变成谎话）。
      const useShell = process.platform === 'win32';
      if (e.from.rev) {
        await run('git', ['init', '--quiet', dst], REPO, 120000, useShell);
        await run('git', ['-C', dst, 'remote', 'add', 'origin', e.from.repo], REPO, 120000, useShell);
        let fetched = false, lastErr = '';
        // 同样两条路都试（代理 / 绕开代理）
        for (const a of [[], ['-c', 'http.proxy=', '-c', 'https.proxy=']]) {
          const r = await run('git', [...a, '-C', dst, 'fetch', '--depth', '1', 'origin', e.from.rev], REPO, 600000, useShell);
          if (r.ok) { fetched = true; break; }
          lastErr = (r.out.split('\n').filter(Boolean).pop() || '').slice(0, 90);
        }
        if (!fetched) { fs.rmSync(dst, { recursive: true, force: true }); throw new Error(`fetch ${e.from.rev} 两条路都失败：${lastErr}`); }
        const co = await run('git', ['-C', dst, 'checkout', '--quiet', 'FETCH_HEAD'], REPO, 120000, useShell);
        if (!co.ok) throw new Error(`checkout ${e.from.rev} 失败`);
        // ★ 钉了就得**验**：结果必须真等于钉的那个 hash（否则"钉了"也是假账）
        const got = (await run('git', ['-C', dst, 'rev-parse', 'HEAD'], REPO, 60000, useShell)).out.trim();
        if (!got.startsWith(e.from.rev)) throw new Error(`钉的 revision 对不上：要 ${e.from.rev}，得到 ${got.slice(0, 12)}`);
        console.log(`  （按钉住的 revision 取源：${e.from.rev.slice(0, 12)}）`);
        return path.join(dst, e.from.subpath ?? '');
      }
      // 没钉：退化成"拉 default 分支最新"，并**明说**这一点
      console.log('  ⚠ SOURCES.json 里没钉 revision ⇒ 拉的是 default 分支最新（重建不保证逐字节一致）');
      const attempts = [
        { label: '按 git 配置（走 ~/.gitconfig 的代理）', args: [] },
        { label: '绕开代理', args: ['-c', 'http.proxy=', '-c', 'https.proxy='] },
      ];
      let lastErr = '';
      let done = false;
      for (const a of attempts) {
        const r = await run('git', [...a.args, 'clone', '--depth', '1', '--quiet', e.from.repo, dst], REPO);
        if (r.ok) { console.log(`  （clone 走的是：${a.label}）`); done = true; break; }
        lastErr = (r.out.split('\n').filter(Boolean).pop() || '').slice(0, 90);
        fs.rmSync(dst, { recursive: true, force: true });
      }
      if (!done) throw new Error(`git clone ${e.from.repo} 两条路都失败：${lastErr}`);
    }
    return path.join(dst, e.from.subpath ?? '');
  }
  throw new Error(`未知来源 kind=${e.from.kind}`);
}

/** ★ 从**冻结副本**取源（不联网）：解析 vendor/grammars/sources/<lang>.tar.gz 到本地暂存目录。
 *  这是"我们自己的副本"的**验收**：冻结件必须能独立重建。 */
async function extractFrozen(name) {
  const tgz = path.join(REPO, 'vendor', 'grammars', 'sources', `${name}.tar.gz`);
  if (!fs.existsSync(tgz)) throw new Error(`没有冻结件：vendor/grammars/sources/${name}.tar.gz`);
  const dir = path.join(REPO, '.inspect', 'frozen-src', name);
  fs.mkdirSync(dir, { recursive: true });
  const toPosix = (p) => p.split(path.sep).join('/');
  const r = await run('tar', ['-xzf', toPosix(path.relative(REPO, tgz)), '-C', toPosix(path.relative(REPO, dir))], REPO, 600000, false);
  if (!r.ok) throw new Error(`解冻结件失败: ${r.out.split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 140)}`);
  // ★ 语法目录**不一定就在归档根**：`grammarPath` 由冻结脚本写进 PROVENANCE
  //   （`ocaml` 那类需要 `../common/`，归档根是包根而不是语法目录）。
  const prov = JSON.parse(fs.readFileSync(path.join(dir, 'PROVENANCE.json'), 'utf8'));
  return path.join(dir, prov.grammarPath ?? '.');}

async function build(name, opts = {}) {
  const e = table[name];
  // ★ 已撤下的（disabled）：**跳过**，不当失败 —— 否则每次 build-all 都会为它报一次假红。
  //   但也不是"静默跳过"：如实说清为什么。
  if (e.disabled) return { name, ok: false, skipped: true, why: '已撤下（disabled）: ' + (e.disabledWhy ?? '') };
  const grammarDir = opts.frozen ? await extractFrozen(name) : await fetchSrc(name);
  return compileAndProbe(name, grammarDir);
}

/** 取到源之后的那半段：验 ABI → 写 binding.c/gyp → node-gyp → **真加载**。build 与 build-frozen 共用。 */
async function compileAndProbe(name, grammarDir) {
  const e = table[name];
  const parserC = path.join(grammarDir, 'src', 'parser.c');
  if (!fs.existsSync(parserC)) return { name, ok: false, why: `没有 src/parser.c（取到的目录：${path.relative(REPO, grammarDir)}）` };
  const abi = readAbi(parserC);
  if (abi === null || abi < MIN_ABI || abi > MAX_ABI) {
    return { name, ok: false, why: `ABI ${abi} ∉ [${MIN_ABI},${MAX_ABI}] ⇒ 要 tree-sitter generate 重生成，本脚本帮不了` };
  }
  const sym = readSymbol(parserC);
  if (!sym) return { name, ok: false, why: 'parser.c 里找不到 `TSLanguage *tree_sitter_xxx(void)`' };

  const pkgDir = path.join(REPO, '.inspect', 'napi-grammars', name);
  fs.mkdirSync(pkgDir, { recursive: true });
  const scanner = ['src/scanner.c', 'src/scanner.cc'].map((p) => path.join(grammarDir, p)).find((p) => fs.existsSync(p));
  // ★ 唯一的一份绑定模板
  fs.writeFileSync(path.join(pkgDir, 'binding.c'), `/* 由 scripts/grammar_shim.mjs 生成 —— 请勿手改。
 * 语法 ${name} | 符号 ${sym} | ABI ${abi}
 * tag 值取自 node_modules/tree-sitter/src/language.cc（本机源码，不是猜的） */
#include <node_api.h>
#include "tree_sitter/api.h"
extern const TSLanguage *${sym}(void);
static const napi_type_tag LANGUAGE_TYPE_TAG = { 0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16 };
static napi_value Init(napi_env env, napi_value exports) {
  napi_value lang;
  if (napi_create_external(env, (void *)${sym}(), NULL, NULL, &lang) != napi_ok) return NULL;
  if (napi_type_tag_object(env, lang, &LANGUAGE_TYPE_TAG) != napi_ok) return NULL;
  if (napi_set_named_property(env, exports, "language", lang) != napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
`);
  const sources = [parserC.replace(/\\/g, '/'), path.join(pkgDir, 'binding.c').replace(/\\/g, '/')];
  if (scanner) sources.push(scanner.replace(/\\/g, '/'));
  fs.writeFileSync(path.join(pkgDir, 'binding.gyp'), JSON.stringify({ targets: [{
    target_name: `tree_sitter_${name}_binding`, sources,
    include_dirs: [TS_INCLUDE.replace(/\\/g, '/'), path.join(grammarDir, 'src').replace(/\\/g, '/')],
    cflags: ['-O2'] }] }, null, 2));

  const b = await run(process.execPath, [NODE_GYP, 'rebuild'], pkgDir);
  const nodeFile = path.join(pkgDir, 'build', 'Release', `tree_sitter_${name}_binding.node`);
  if (!fs.existsSync(nodeFile)) {
    // ★ 上一版这里会**报一个空原因**（筛选不到编译错误行时 why 就是空的）—— 那是"沉默的失败"。
    //   改成：筛到就用筛到的，筛不到就**带出输出的尾部**，绝不留空。
    const hit = b.out.split('\n').filter((l) => /error C|fatal error|LNK|error MSB/.test(l)).slice(0, 1).join('');
    const tail = b.out.split('\n').filter(Boolean).slice(-3).join(' | ');
    return { name, ok: false, why: '编译失败: ' + (hit || tail || '（node-gyp 无输出，且产物不在）').slice(0, 150) };
  }
  // ★ 真加载（子进程，避免同进程多原生模块互扰）
  const p = await probe(nodeFile);
  // ★★ 子进程**可能一个字都不吐**（加载它的时候把进程弄挂了）—— 实测 lua 就是这样。
  //   上一版这时 `why` 会是空串 ⇒ 报"❌ lua "（空原因）= 沉默的失败。这里补上退出码。
  const why = p.out.startsWith('OK') ? null
    : (p.out || `真加载的子进程没有输出（退出码 ${p.code}${p.err ? '：' + p.err : ''}）—— 这个包可能把加载它的进程弄挂了`);
  return { name, ok: p.out.startsWith('OK'), abi, sym, scanner: !!scanner, root: p.out.slice(3), nodeFile, why };
}

const probe = (target) => new Promise((res) => {
  if (!fs.existsSync(PROBE)) {
    fs.writeFileSync(PROBE, `import Parser from 'tree-sitter';\nimport { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\ntry { const p = new Parser(); p.setLanguage(req(process.argv[2])); console.log('OK ' + p.parse('x').rootNode.type); } catch (e) { console.log('BAD ' + ((e && e.message) || '').slice(0, 70)); }\n`);
  }
  execFile(process.execPath, [PROBE, target], { timeout: 90000, maxBuffer: 1 << 20 },
    (e, o, se) => res({ out: (o || '').trim(), code: e ? (e.code ?? (e.killed ? 'killed' : '?')) : 0, err: (se || '').trim().slice(0, 70) }));
});

function install(name) {
  const nodeFile = path.join(REPO, '.inspect', 'napi-grammars', name, 'build', 'Release', `tree_sitter_${name}_binding.node`);
  if (!fs.existsSync(nodeFile)) return false;
  const dest = path.join(REPO, 'vendor', 'grammars', name);
  fs.mkdirSync(path.join(dest, 'build', 'Release'), { recursive: true });
  fs.copyFileSync(nodeFile, path.join(dest, 'build', 'Release', path.basename(nodeFile)));
  fs.writeFileSync(path.join(dest, 'index.js'), `module.exports = require('./build/Release/${path.basename(nodeFile)}');\n`);
  fs.writeFileSync(path.join(dest, 'package.json'), JSON.stringify({
    name: `agent-io-grammar-${name}`, version: '0.0.0', private: true, main: 'index.js',
    description: `通用 N-API 绑定从语法源码构建（${name}）。重建：node scripts/grammar_shim.mjs build ${name}` }, null, 2) + '\n');
  const pkgPath = path.join(REPO, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  pkg.optionalDependencies ??= {};
  pkg.optionalDependencies[`agent-io-grammar-${name}`] = `file:vendor/grammars/${name}`;
  pkg.optionalDependencies = Object.fromEntries(Object.entries(pkg.optionalDependencies).sort());
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  return true;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'list') {
  for (const [k, v] of Object.entries(table)) {
    console.log(`${k.padEnd(10)} ${v.from.kind.padEnd(5)} ${(v.from.pkg ? v.from.pkg + '@' + v.from.version : v.from.repo).padEnd(34)} ${v.note ?? ''}`);
  }
} else if (cmd === 'fetch') {
  console.log('取源 ->', await fetchSrc(arg));
} else if (cmd === 'build') {
  const r = await build(arg, { frozen: process.argv.includes('--frozen') });
  // ★ 失败时**顺带打 JSON** —— 因为我已经吃过一次"报错是空的"的亏（沉默的失败）。
  const tag = process.argv.includes('--frozen') ? '（源取自冻结副本，未联网）' : '';
  console.log(r.ok ? `✅ ${arg} ABI ${r.abi} root=${r.root}${tag}` : `❌ ${arg} ${r.why}\n   raw=${JSON.stringify(r)}`);
  process.exitCode = r.ok ? 0 : 1;
} else if (cmd === 'verify-frozen') {
  // ★ 「我们自己的副本」的验收：**只用冻结件**重建，逐门真加载 + ★ 与**仓里在册的产物**比行为等价。
  //
  // ★★ 2026-10-08 补这道比较（**因为不加它就漏了一次真事故**）：
  //   上一版的 verify-frozen 只验"能用冻结件重建 + 真加载" ⇒ 全绿；
  //   而 swift 的**在册产物**其实是从 **0.7.1** 编的（旧工具用**前缀匹配**挑 tarball，挑错了），
  //   冻结件却是 **0.6.0** ⇒ 两者**不是同一个东西**，验收却全绿。
  //   ⇒ 判据必须包含"**重建出来的 == 在册的**"（同输入 ⇒ 同树），否则"能重建"不等于"是同一份"。
  const TREE_PROBE = path.join(REPO, '.inspect', '_probe_tree.mjs');
  fs.mkdirSync(path.dirname(TREE_PROBE), { recursive: true });
  fs.writeFileSync(TREE_PROBE, `
import Parser from 'tree-sitter';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
try { const p = new Parser(); p.setLanguage(req(process.argv[2]));
  console.log(JSON.stringify({ root: p.parse(process.argv[3]).rootNode.type, sexp: p.parse(process.argv[3]).rootNode.toString() })); }
catch (e) { console.log(JSON.stringify({ err: ((e && e.message) || '').slice(0, 60) })); }
`);
  const SAMPLE = 'a b c\nx = 1\nfoo(bar, 2)\n';
  const tree = (file) => new Promise((res) =>
    execFile(process.execPath, [TREE_PROBE, file, SAMPLE], { timeout: 90000, maxBuffer: 1 << 22 },
      (e, o) => res((o || '').trim() || `{"err":"无输出 code=${e ? e.code : 0}"}`)));

  const out = [];
  for (const k of Object.keys(table)) {
    if (table[k].disabled) continue;
    if (!fs.existsSync(path.join(REPO, 'vendor', 'grammars', 'sources', `${k}.tar.gz`))) {
      console.log(`  ·  ${k} 没有冻结件`); continue;
    }
    const r = await build(k, { frozen: true });
    if (!r.ok) { out.push(r); console.log(`  ❌ ${k.padEnd(9)} ${r.why}`); continue; }
    // ★ 与在册产物比行为等价
    const vendored = path.join(REPO, 'vendor', 'grammars', k, 'build', 'Release', `tree_sitter_${k}_binding.node`);
    let same = null, detail = '';
    if (fs.existsSync(vendored)) {
      const [a, b] = [await tree(r.nodeFile), await tree(vendored)];
      try {
        const A = JSON.parse(a), B = JSON.parse(b);
        same = !!(A.sexp && B.sexp && A.sexp === B.sexp && A.root === B.root);
        if (!same) detail = `  ← 与在册产物**不一致**：新 root=${A.root} / 在册 root=${B.root}`;
      } catch { same = false; detail = '  ← 比较时输出无法解析'; }
    }
    out.push({ ...r, same });
    console.log(`  ${r.ok && same !== false ? '✅' : '❌'} ${k.padEnd(9)} ABI ${r.abi} root=${r.root}` +
      (same === null ? '  （在册产物不存在，未比）' : same ? '  ＝ 与在册一致' : detail));
  }
  const pass = out.filter((r) => r.ok && r.same !== false).length;
  console.log(`\n只用冻结副本重建 **且与在册产物行为等价**：${pass}/${out.length} 通过`);
  process.exitCode = pass === out.length && out.length > 0 ? 0 : 1;
} else if (cmd === 'build-all') {
  const out = [];
  for (const k of Object.keys(table)) {
    const r = await build(k);
    out.push(r);
    console.log(r.skipped ? `·  ${k} 跳过 —— ${r.why}` : r.ok ? `✅ ${k} ABI ${r.abi} root=${r.root}` : `❌ ${k} ${r.why}`);
  }
  const pass = out.filter((r) => r.ok).length, skip = out.filter((r) => r.skipped).length;
  console.log(`\n通过 ${pass} · 跳过 ${skip} · 失败 ${out.length - pass - skip} / ${out.length}`);
} else if (cmd === 'pins') {
  // ★ 「统一到某一个版本」的**校验**：声明（PINS.json）必须与**现实**对得上。
  const pinsPath = path.join(REPO, 'vendor', 'grammars', 'PINS.json');
  const pins = JSON.parse(fs.readFileSync(pinsPath, 'utf8'));
  const apiH = path.join(TS_INCLUDE, 'tree_sitter', 'api.h');
  const api = fs.readFileSync(apiH, 'utf8');
  const grab = (n) => { const m = api.match(new RegExp(`#define\\s+${n}\\s+(\\d+)`)); return m ? Number(m[1]) : null; };
  const coreVer = JSON.parse(fs.readFileSync(path.join(REPO, 'node_modules', 'tree-sitter', 'package.json'), 'utf8')).version;
  const win = [grab('TREE_SITTER_MIN_COMPATIBLE_LANGUAGE_VERSION'), grab('TREE_SITTER_LANGUAGE_VERSION')];
  const rows = [],
    bad = [];
  rows.push(['核心版本', pins.core.version, coreVer, pins.core.version === coreVer]);
  rows.push(['ABI 窗口', JSON.stringify(pins.core.abiWindow), JSON.stringify(win), JSON.stringify(pins.core.abiWindow) === JSON.stringify(win)]);
  rows.push(['在册语言数', String(pins.grammarsInScope.length), String(Object.keys(table).filter((k) => !table[k].disabled).length),
    pins.grammarsInScope.length === Object.keys(table).filter((k) => !table[k].disabled).length]);
  for (const [what, want, got, ok] of rows) {
    console.log(`  ${ok ? '✅' : '❌'} ${what.padEnd(12)} 声明=${want}  现实=${got}`);
    if (!ok) bad.push(what);
  }
  // 每门在册语法的 ABI（有源码才读得到；没有就标"未取源"）
  for (const n of pins.grammarsInScope) {
    const e = table[n];
    // ★ 路径要**认 subpath** —— ocaml 的 parser.c 在 package/grammars/ocaml/src/ 下，
    //   上一版只顾了 package/src/ 与 <repo>/src/，于是它被误报成"未取源"。
    const roots = e.from.kind === 'npm'
      ? [path.join(SRCROOT, n, 'package', e.from.subpath ?? '')]
      : [path.join(SRCROOT, n, path.basename(e.from.repo), e.from.subpath ?? '')];
    const f = roots.map((r) => path.join(r, 'src', 'parser.c')).find((x) => fs.existsSync(x))
      ?? (fs.existsSync(roots[0]) ? (function walk(d) {
        for (const x of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, x.name);
          if (x.isDirectory()) { const r2 = walk(p); if (r2) return r2; }
        }
        return fs.existsSync(path.join(d, 'src', 'parser.c')) ? path.join(d, 'src', 'parser.c') : null;
      })(roots[0]) : null);
    if (!f) { console.log(`  ·  ${n.padEnd(12)} 未取源（跳过 ABI 核对 —— 跑过 build ${n} 才有）`); continue; }
    const abi = readAbi(f);
    const ok = abi >= win[0] && abi <= win[1];
    console.log(`  ${ok ? '✅' : '❌'} ${n.padEnd(12)} ABI=${abi}`);
    if (!ok) bad.push(n);
  }
  console.log(bad.length ? `\n❌ ${bad.length} 项与声明不符` : '\n✅ 声明与现实一致');
  process.exitCode = bad.length ? 1 : 0;
} else if (cmd === 'install') {
  console.log(install(arg) ? `已装进 vendor/grammars/${arg} 并声明 file: 依赖` : `没有产物可装（先 build ${arg}）`);
} else {
  console.log('用法: node scripts/grammar_shim.mjs list | fetch <lang> | build <lang> | build-all | install <lang>');
}
