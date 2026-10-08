#!/usr/bin/env python3
"""★ 把「在用的那 8 门」语法的**构建必需件**冻进我们自己的仓。

为什么只冻这些：
  · 全部 244 个仓的源码树 = **1433 MB**（仅 parser.c 就 812 MB）⇒ 进仓不现实
  · 而**真正在用**的只有 `PINS.json` 里 `grammarsInScope` 的 8 门 ⇒ 冻它们就够了
  · 清单里另外 483 门继续**用 rev 钉**（上游删仓才会痛；那时按需冻即可）

每门冻结什么（**只放"能重建"所需**）：
  src/parser.c、src/scanner.c|.cc（若有）、grammar.json（若有）、LICENSE*（若有）
  + PROVENANCE.json（repo / rev / ABI / 符号 / 每个文件的 sha256）

产出：vendor/grammars/sources/<lang>.tar.gz
"""
import io, json, os, re, glob, hashlib, tarfile, subprocess

R = r'D:\project_develop\design-canvas'
SOURCES = json.load(io.open(os.path.join(R, r'vendor\grammars\SOURCES.json'), encoding='utf-8'))
PINS = json.load(io.open(os.path.join(R, r'vendor\grammars\PINS.json'), encoding='utf-8'))
GH = os.path.join(R, r'.inspect\ts-bundle\gh')
SRCROOT = os.path.join(R, r'.inspect\grammar-src')
OUT = os.path.join(R, r'vendor\grammars\sources')
os.makedirs(OUT, exist_ok=True)


def include_closure(root, seeds):
    """★★ 递归抓 `#include "本地文件"` 的**闭包** —— 冻的必须是**编译器真正会读到的**那些文件。

    为什么不能靠手写清单（实测两次踩到，都是验收测试逼出来的）：
      ① 只冻 parser.c/scanner.c ⇒ 报 `cannot open include file 'tree_sitter/parser.h'`
      ② 补上 `src/tree_sitter/*` 之后，`vue` 还报 `./tree_sitter_html/scanner.cc`、
         `ocaml` 还报 `../../../common/scanner.h` —— **语法之间会互相引用**。
    ⇒ 只能照着 include 图走，不猜。只跟**引号形式**（本地头），跳过 `<...>`（系统/运行时）。
    """
    seen, out, queue = set(), [], list(seeds)
    while queue:
        p = queue.pop(0)
        rp = os.path.realpath(p)
        if rp in seen or not os.path.isfile(p):
            continue
        seen.add(rp)
        out.append(p)
        try:
            txt = io.open(p, encoding='utf-8', errors='replace').read()
        except Exception:
            continue
        # ★ 两种形式都要跟：`#include "x"` **和** `#include <x>`。
        #   实测踩到：`crystal` 用的是**尖括号**形式 `<tree_sitter/parser.h>`，
        #   只跟引号 ⇒ 漏掉头文件 ⇒ 冻结件根本编不出来。
        #   安全性：只有在"本地能解出文件"时才收（系统头如 <stdint.h> 解析不到，自然跳过）。
        for inc in re.findall(r'#\s*include\s*[<"]([^>"]+)[>"]', txt):
            for base in (os.path.dirname(p), root, os.path.join(root, 'src')):
                cand = os.path.normpath(os.path.join(base, inc))
                if os.path.isfile(cand):
                    queue.append(cand)
                    break
    return out


def rel(root, p):
    return os.path.relpath(p, root).replace(os.sep, '/')


def find_grammar_root(name, e):
    """在本地找这门语法的仓根（优先 grammar-src 的新取，其次 ts-bundle/gh 的老克隆）。"""
    cands = []
    if e['from']['kind'] == 'git':
        cands.append(os.path.join(SRCROOT, name, os.path.basename(e['from']['repo'])))
        cands.append(os.path.join(GH, name))
    else:
        cands += glob.glob(os.path.join(SRCROOT, name, 'package', e['from'].get('subpath') or ''))
        cands += [os.path.join(SRCROOT, name, 'package'), os.path.join(R, '.inspect', 'unpacked', name, 'package')]
    for c in cands:
        if c and os.path.isdir(c) and os.path.exists(os.path.join(c, 'src', 'parser.c')):
            return c
    for c in cands:
        if c and os.path.isdir(c):
            hits = glob.glob(os.path.join(c, '**', 'src', 'parser.c'), recursive=True)
            # ★★ 2026-10-09 修：glob 回退**多候选时必须报错**，不许静默取 `hits[0]`。
            #   隐患实测（子代理排查）：`ocaml` 包里有 **3 个** parser.c（interface / ocaml / type）
            #   —— 现在靠 `subpath: grammars/ocaml` 的快路径抢先命中才没事；**subpath 一丢就会编错语言**，
            #   而且是**静默**编错（产物能用、只是不是那门语言）。
            #   与"前缀匹配挑 tarball 挑到 0.7.1"是**同一个病**：模糊挑一个 + 不核对。
            if len(hits) > 1:
                raise SystemExit(
                    '★ %s 的 parser.c 有 %d 个候选，无法确定要哪一份：\n  %s\n'
                    '  ⇒ 请在 SOURCES.json 的 from.subpath 里写清；本脚本**拒绝猜**。'
                    % (name, len(hits), '\n  '.join(rel(c, h) for h in hits)))
            if hits:
                return os.path.dirname(os.path.dirname(hits[0]))
    return None


def rev_of(d):
    """★ 只有当那个目录**自己就是 git 仓**（有 .git）才算数。
    否则 `git -C` 会**往上找到父仓** —— 实测踩到：npm 来源的目录在 `.inspect/` 里（在我们仓内），
    `rev-parse HEAD` 返回的是**我们自己的 HEAD**（`ebbd6eda…`），一个看着对、其实完全错的 rev。"""
    if not os.path.isdir(os.path.join(d, '.git')):
        return None
    try:
        return subprocess.run(['git', '-C', d, 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=30).stdout.strip() or None
    except Exception:
        return None


def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


report = []
for name in PINS['grammarsInScope']:
    e = SOURCES[name]
    root = find_grammar_root(name, e)
    if not root:
        report.append({'name': name, 'ok': False, 'why': '本地找不到仓根'})
        print('  ✗ %-9s 本地找不到仓根' % name)
        continue
    files = []
    seeds = [os.path.join(root, p) for p in ('src/parser.c', 'src/scanner.c', 'src/scanner.cc') if os.path.exists(os.path.join(root, p))]
    # ★ 闭包 = 编译器真正会读到的那些本地文件（parser.c / scanner + 它们 #include 的一切）
    closure = include_closure(root, seeds)
    for pat in ('grammar.json', 'LICENSE', 'LICENSE.txt', 'LICENSE.md'):
        p = os.path.join(root, pat)
        if os.path.exists(p):
            closure.append(p)

    # ★★ 归档根 = **能覆盖全部所需文件的最小公共目录**（不是"语法根"）。
    #    实测：`ocaml` 的 scanner 要 `../../../common/scanner.h` —— 在语法目录**之外**、但在包内。
    #    若按语法根打包，路径里会带 `..`，tar 直接拒绝（`Member name contains '..'`）⇒ 解不出来。
    base = os.path.commonpath([root] + closure)
    for p in closure:
        arc = os.path.relpath(p, base).replace(os.sep, '/')
        files.append((arc, p, sha(p), os.path.getsize(p)))
    grammar_path = os.path.relpath(root, base).replace(os.sep, '/') or '.'
    parser_c = os.path.join(root, 'src', 'parser.c')
    m = re.search(r'#define\s+LANGUAGE_VERSION\s+(\d+)', io.open(parser_c, encoding='utf-8', errors='replace').read(400000))
    sym = re.search(r'TSLanguage\s*\*\s*(tree_sitter_[A-Za-z0-9_]+)\s*\(\s*void\s*\)', io.open(parser_c, encoding='utf-8', errors='replace').read()).group(1)

    prov = {
        '_note': '构建必需件的冻结副本（不含 .git / tests / corpus）。重编：见 vendor/grammars/README.md',
        'name': name, 'pkg': 'agent-io-grammar-' + name,
        'from': {k: v for k, v in e['from'].items()},
        # ★ git 来源才有 rev；npm 来源按**版本号**钉（`from.pkg@from.version`），rev 明确写 null ——
        #   不许用"父仓的 HEAD"冒充（上一版就是这么错的）。
        'rev': rev_of(root) or e['from'].get('rev') or None,
        'sourceKind': e['from']['kind'],
        # ★ 归档内的**语法目录相对路径** —— 解冻结件的人靠它找到 src/parser.c（见 extractFrozen）
        'grammarPath': grammar_path,
        'abi': int(m.group(1)) if m else None, 'symbol': sym,
        'core': {'package': PINS['core']['package'], 'version': PINS['core']['version'], 'abiWindow': PINS['core']['abiWindow']},
        'files': [{'path': a, 'sha256': c, 'bytes': d} for a, _, c, d in files],
        'frozenAt': '2026-10-08',
    }
    tmp = os.path.join(OUT, name + '.prov.json')
    io.open(tmp, 'w', encoding='utf-8', newline='\n').write(json.dumps(prov, ensure_ascii=False, indent=1) + '\n')
    tgz = os.path.join(OUT, name + '.tar.gz')
    with tarfile.open(tgz, 'w:gz') as t:
        t.add(tmp, arcname='PROVENANCE.json')
        for arc, p, _, _ in files:
            t.add(p, arcname=arc)
    os.remove(tmp)
    kb = os.path.getsize(tgz) / 1024
    raw = sum(d for _, _, _, d in files) / 1048576
    report.append({'name': name, 'ok': True, 'tgzKB': round(kb), 'rawMB': round(raw, 1), 'rev': prov['rev'][:12] if prov['rev'] else None, 'abi': prov['abi']})
    print('  ✅ %-9s %7.0f KB（原始 %.1f MB，压了 %.0fx）rev=%s ABI=%s' % (name, kb, raw, raw * 1048576 / max(kb * 1024, 1), (prov['rev'] or '?')[:12], prov['abi']))

json.dump(report, io.open(os.path.join(R, r'.inspect\freeze-report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = [x for x in report if x['ok']]
print('\n冻好 %d/%d 门，合计 %.0f KB' % (len(ok), len(report), sum(x['tgzKB'] for x in ok)))
