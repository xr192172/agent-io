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
      // ★ 走"配置里的代理"还是"绕开代理"，**两条都试**（一天里两条路各挂过一次的实测教训）。
      //   别把哪条写死。这也是 `npm run net:probe` 的结论落地：先探路，再走。
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

async function build(name) {
  const e = table[name];
  const grammarDir = await fetchSrc(name);
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
    const err = b.out.split('\n').filter((l) => /error C|fatal error|LNK|error MSB/.test(l)).slice(0, 1).join('');
    return { name, ok: false, why: '编译失败: ' + (err || '').slice(0, 110) };
  }
  // ★ 真加载（子进程，避免同进程多原生模块互扰）
  const p = await probe(nodeFile);
  return { name, ok: p.out.startsWith('OK'), abi, sym, scanner: !!scanner, root: p.out.slice(3), nodeFile, why: p.out.startsWith('OK') ? null : p.out };
}

const probe = (target) => new Promise((res) => {
  if (!fs.existsSync(PROBE)) {
    fs.writeFileSync(PROBE, `import Parser from 'tree-sitter';\nimport { createRequire } from 'node:module';\nconst req = createRequire(import.meta.url);\ntry { const p = new Parser(); p.setLanguage(req(process.argv[2])); console.log('OK ' + p.parse('x').rootNode.type); } catch (e) { console.log('BAD ' + ((e && e.message) || '').slice(0, 70)); }\n`);
  }
  execFile(process.execPath, [PROBE, target], { timeout: 90000, maxBuffer: 1 << 20 },
    (e, o) => res({ out: (o || '').trim() }));
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
  const r = await build(arg);
  console.log(r.ok ? `✅ ${arg} ABI ${r.abi} root=${r.root}` : `❌ ${arg} ${r.why}`);
  process.exitCode = r.ok ? 0 : 1;
} else if (cmd === 'build-all') {
  const out = [];
  for (const k of Object.keys(table)) { const r = await build(k); out.push(r); console.log(r.ok ? `✅ ${k} ABI ${r.abi} root=${r.root}` : `❌ ${k} ${r.why}`); }
  console.log(`\n通过 ${out.filter((r) => r.ok).length}/${out.length}`);
} else if (cmd === 'install') {
  console.log(install(arg) ? `已装进 vendor/grammars/${arg} 并声明 file: 依赖` : `没有产物可装（先 build ${arg}）`);
} else {
  console.log('用法: node scripts/grammar_shim.mjs list | fetch <lang> | build <lang> | build-all | install <lang>');
}
