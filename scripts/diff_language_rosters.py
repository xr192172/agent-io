#!/usr/bin/env python3
"""★ 直接回答「它那个仓全吗？」—— 拿**官方 wiki 的 440 门**去减**它的 372 门**。

归一化（否则会误报"缺"）：
  · `_` / `-` 互换、大小写无关
  · 已知同义：`proto/protobuf`、`csharp/c_sharp`、`embeddedtemplate/embedded_template`
    —— ★ 但同义表**只写我实际遇到的**，不猜；对不上的**列出来给人看**。
"""
import io, json, os, re, collections

R = r'D:\project_develop\design-canvas'


def norm(s):
    s = s.lower().replace('-', '_')
    return s


SYN = {
    'protobuf': 'proto', 'csharp': 'c_sharp', 'c__sharp': 'c_sharp',
    'embeddedtemplate': 'embedded_template', 'objc': 'objective_c',
    'tsx': 'tsx', 'gitignore': 'gitignore',
}


def key(s):
    s = norm(s)
    return SYN.get(s, s)


wiki = json.load(io.open(os.path.join(R, r'.inspect\parsers_full.json'), encoding='utf-8'))
up = json.load(io.open(os.path.join(R, r'.inspect\upstream_languages.json'), encoding='utf-8'))

wiki_names = {key(p['name']): p['name'] for p in wiki}          # 归一 -> 原名
up_names = {key(k): k for k in up}
# 上游还带 extensions —— 用它做**第二判据**（名字对不上但扩展名对得上 ⇒ 可能是同一个语言改了名）
up_ext = {}
for k, v in up.items():
    for e in (v.get('extensions') or []):
        up_ext.setdefault(e.lower(), []).append(k)
wiki_ext = {}
for p in wiki:
    for e in (p.get('exts') or []):
        wiki_ext.setdefault(str(e).lower().lstrip('.'), []).append(p['name'])

only_wiki = sorted(set(wiki_names) - set(up_names))
only_up = sorted(set(up_names) - set(wiki_names))

print('官方 wiki（去重名）: %d' % len(wiki_names))
print('它的清单          : %d' % len(up_names))
print()
print('★ 只在 wiki 有、**它没有** 的: %d 门' % len(only_wiki))
for k in only_wiki:
    w = wiki_names[k]
    # 用扩展名找找它有没有换个名字收
    hits = set()
    for e in (wiki_ext.get('', []) if False else []):
        pass
    cand = []
    for p in wiki:
        if key(p['name']) == k:
            for e in (p.get('exts') or []):
                cand += up_ext.get(str(e).lower().lstrip('.'), [])
    tag = ('← 它可能叫: ' + ' / '.join(sorted(set(cand))[:3])) if cand else ''
    print('   %-22s %s' % (w, tag))
print()
print('只在上游有、wiki 没有的: %d 门（多半是 wiki 没收的新语言）' % len(only_up))
print('   ' + ' '.join(up_names[k] for k in only_up[:40]))
