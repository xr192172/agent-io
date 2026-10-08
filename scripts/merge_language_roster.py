#!/usr/bin/env python3
"""★ 双上游合并：kreuzberg 的 372（已整理） ∪ 官方 wiki 的 440（我们补整理）。
对**它没有的** wiki 条目，做**同样的整理**：钉 rev + 读 ABI + 判"要不要 generate"。
★ 全部离线（用已 clone 在 .inspect/ts-bundle/gh 的 202 个仓），不联网。"""
import io, json, os, re, subprocess, glob, collections

R = r'D:\project_develop\design-canvas'
GH = os.path.join(R, r'.inspect\ts-bundle\gh')
UP = json.load(io.open(os.path.join(R, r'.inspect\upstream_languages.json'), encoding='utf-8'))
WIKI = json.load(io.open(os.path.join(R, r'.inspect\parsers_full.json'), encoding='utf-8'))

SYN = {'protobuf': 'proto', 'csharp': 'c_sharp', 'embeddedtemplate': 'embedded_template', 'objc': 'objective_c'}
norm = lambda s: SYN.get(s.lower().replace('-', '_'), s.lower().replace('-', '_'))

# 本地克隆：按目录名索引（我们当初按 wiki 的 name 建的目录）
local = {os.path.basename(d): d for d in glob.glob(os.path.join(GH, '*')) if os.path.isdir(d)}


def git_rev(d):
    try:
        o = subprocess.run(['git', '-C', d, 'rev-parse', 'HEAD'], capture_output=True, text=True, timeout=30).stdout.strip()
        return o or None
    except Exception:
        return None


def abi_from(d):
    """./src/parser.c 或任意深度下的 src/parser.c 里的 #define LANGUAGE_VERSION。缺了就 None。"""
    for p in [os.path.join(d, 'src', 'parser.c')] + glob.glob(os.path.join(d, '**', 'src', 'parser.c'), recursive=True):
        if os.path.exists(p):
            try:
                m = re.search(r'#define\s+LANGUAGE_VERSION\s+(\d+)',
                              io.open(p, encoding='utf-8', errors='replace').read(400000))
                return int(m.group(1)) if m else None
            except Exception:
                pass
    return None


roster = {}
# ① 它那份（已整理）
for name, v in UP.items():
    roster[norm(name)] = {
        'name': name, 'provenance': ['kreuzberg'],
        'repo': v.get('repo'), 'rev': v.get('rev'), 'branch': v.get('branch'),
        'extensions': v.get('extensions') or [], 'abi': v.get('abi_version'),
        'generate': bool(v.get('generate')), 'local_vendored': bool(v.get('local')),
        'ambiguous': v.get('ambiguous'),
    }
# ② 官方 wiki：在的标 provenance；不在的**补齐同样的整理**
added = 0
for p in WIKI:
    k = norm(p['name'])
    d = local.get(p['name'])
    item = roster.setdefault(k, {'name': p['name'], 'provenance': [], 'repo': None, 'rev': None,
                                 'extensions': [], 'abi': None, 'generate': False})
    if 'wiki' not in item['provenance']:
        item['provenance'].append('wiki')
    item.setdefault('wiki_url', p.get('url'))
    item.setdefault('wiki_abi', p.get('abi'))
    item.setdefault('wiki_date', p.get('date'))
    if 'kreuzberg' not in item['provenance']:
        # ★ 同样的整理：仓库取 wiki，rev/ABI 从**本地克隆**读（没有克隆就如实留空）
        item['repo'] = item['repo'] or p.get('url')
        if d:
            item['rev'] = item['rev'] or git_rev(d)
            item['abi'] = item['abi'] if item['abi'] is not None else abi_from(d)
            item['local_clone'] = True
        added += 1

out = os.path.join(R, r'vendor\grammars\roster.merged.json')
io.open(out, 'w', encoding='utf-8', newline='\n').write(json.dumps(roster, ensure_ascii=False, indent=1) + '\n')

both = [v for v in roster.values() if len(v['provenance']) == 2]
only_up = [v for v in roster.values() if v['provenance'] == ['kreuzberg']]
only_wiki = [v for v in roster.values() if v['provenance'] == ['wiki']]
print('合并名册：%d 门（写出 %s，%.0fKB）' % (len(roster), os.path.relpath(out, R), os.path.getsize(out) / 1024))
print('  · 两边都有（kreuzberg+wiki）: %d' % len(both))
print('  · 只有它（kreuzberg 独有）  : %d' % len(only_up))
print('  · 只有 wiki（**我们要补的**）: %d' % len(only_wiki))
print('  · 其中本地已有克隆可核      : %d / %d' % (sum(1 for v in only_wiki if v.get('local_clone')), len(only_wiki)))
print()
# 补整理的成绩单
have_rev = [v for v in only_wiki if v.get('rev')]
have_abi = [v for v in only_wiki if v.get('abi') is not None]
ok_abi = [v for v in have_abi if v['abi'] in (13, 14)]
need_gen = [v for v in have_abi if v['abi'] not in (13, 14)]
print('「只有 wiki」那 %d 门，我们按同样规格整理到：' % len(only_wiki))
print('  钉到 rev : %d' % len(have_rev))
print('  读到 ABI : %d  （其中 ABI 13/14 可直接编: %d' % (len(have_abi), len(ok_abi)))
print('                        需 tree-sitter generate 重生成: %d）' % len(need_gen))
print('  连克隆都没有（要联网取）: %d' % (len(only_wiki) - sum(1 for v in only_wiki if v.get('local_clone'))))
print()
print('需要重生成的（前 30）:', ' '.join(sorted(v['name'] for v in need_gen)[:30]))
print()
print('既没克隆、也没 ABI 的（前 30）:',
      ' '.join(sorted(v['name'] for v in only_wiki if not v.get('local_clone'))[:30]))
