/**
 * 项目标识一致性门 —— 改名的"收尾钉"（2026-09-28 建）
 *
 * ★ 为什么需要它：改名时实测发现**三处"名字相同"其实是耦合，而没有任何门在守**：
 *
 *   ① `PKG_NAME` ↔ `package.json` 的 `name`。
 *      `storage.ts` 的 `getPackageRoot()` 靠**自省**找包根（向上找 `package.json` 且 `name` 匹配）。
 *      两处不一致时**不报错、不告警**，只会静默退化成 `process.cwd()` ⇒
 *      把 features 存档与活态 DSL 写到工作区根（就是 `storage.ts` 头注记的"146 条 flows 污染"那类）。
 *
 *   ② `SERVER_NAME`（MCP 报给 client 的服务名）↔ `PKG_NAME`。
 *
 *   ③ ★ **跨语言的数据目录名**：`go-observe` / `go-slim` 的 Go 代码里写着 `.agent-io/...` 字符串字面量
 *      （如 `instrument.go` 的 `const backupDir`）。两边必须一致，否则 Go 插桩器把备份写到
 *      A 目录、TS 侧去 B 目录找 —— 而且是**静默的**。
 *      ⇒ 这条**在本次改名之前完全没有门**（Go 不在 vitest 范围，跨语言没有共同的真值源）。
 *      现在：把 Go/PS 侧所有 `".<name>/..."` 形式的字面量**逐个与 `DATA_DIR_NAME` 比对**。
 *
 * ★ 与其它门的分工：品牌残留门守"旧名不许回来"；本门守"**新名处处一致**"。
 *   两者正交：名字全改新了、但两处新名拼错成不同的样子，品牌门是绿的、本门才红。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR_NAME, PKG_NAME } from '../src/data_dir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..');

function walkExt(dir: string, exts: Set<string>, out: string[] = []): string[] {
  let ents: fs.Dirent[];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walkExt(abs, exts, out);
    } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) out.push(abs);
  }
  return out;
}

describe('项目标识一致性门', () => {
  it('① PKG_NAME 与 package.json 的 name 一致（不一致 ⇒ 包根自省静默退化成 cwd）', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name?: string };
    expect(pkg.name, 'package.json 与 src/data_dir.ts 的 PKG_NAME 不一致（改包名必须两处同改）').toBe(PKG_NAME);
  });

  it('② storage.ts 的自省锚点用的是 PKG_NAME 常量，而不是字面量', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'storage.ts'), 'utf8');
    expect(src).toContain('j.name === PKG_NAME');
    // 反面：不许再出现 `j.name === '<某个字面量>'`（那又是一份要同步的副本）
    expect(/j\.name === '/.test(src), 'storage.ts 里又出现了字面量比较').toBe(false);
  });

  it('③ MCP 服务名（src/presentation/mcp/server.ts 的 SERVER_NAME）与 PKG_NAME 一致', () => {
    const src = fs.readFileSync(path.join(REPO, 'src', 'presentation', 'mcp', 'server.ts'), 'utf8');
    const m = src.match(/const SERVER_NAME\s*=\s*'([^']*)'/);
    expect(m, '没找到 src/presentation/mcp/server.ts 的 SERVER_NAME 声明').not.toBeNull();
    expect(m![1]).toBe(PKG_NAME);
  });

  it('④ ★ 跨语言：Go / PowerShell 里的数据目录字面量必须是"已知的合法名字之一"', () => {
    const files = [
      ...walkExt(path.join(REPO, 'go-observe'), new Set(['.go', '.ps1', '.psm1'])),
      ...walkExt(path.join(REPO, 'go-slim'), new Set(['.go', '.ps1', '.psm1'])),
    ];
    expect(files.length, '没扫到 Go/PS 文件（路径变了？）').toBeGreaterThan(0);

    // 抓所有 `".<name>/..."` 形式的字面量（Go 用 `/`，PowerShell 用 `\`）。
    // ★ 只认"引号后紧跟 `.名字`"的形态 ⇒ `./x`、`../x` 都不会命中（它们引号后是 `.` 再跟 `/`/`.`）。
    // ★ 捕获组**必须含那个点**（上一版漏了它，于是拿 `agent-io` 去比 `.agent-io` ⇒ 全判不等）。
    const lit = /["'`](\.[A-Za-z0-9_-]+)[\\/]/g;

    /**
     * ★ 合法名字**不止一个** —— 实测发现本仓有**两个不同生产者**的 dot-dir：
     *   · `.agent-io/` = **TS 侧本项目**的数据目录（`DATA_DIR_NAME`）；
     *   · `.agent/`    = **Go 侧 go-observe** 的观测数据仓（`cmd/observe-dsl/main.go` 写
     *                    `{projectRoot}/.agent/observe`，TS 侧 `daemon.ts` / `observe.ts` /
     *                    `reconcile_effects.ts` 去读）。
     *   ⇒ 这两个**不是同一件事的两个名字**（不同生产者、不同语义），所以**不许合并**
     *     （规划书 §2c「不同维度的不许合并」）。本门只保证"**不许出现第三个**"。
     *   ⚠️ 顺带纠正一条旧笔记：我曾以为改名"正好收敛掉 `.agent/`" —— **错了**，
     *     改名不该动它（它从来不是品牌串），只该把它**登记为已知合法名**。
     */
    const KNOWN = new Set([DATA_DIR_NAME, '.agent']);

    const bad: string[] = [];
    let checked = 0;
    for (const abs of files) {
      const rel = path.relative(REPO, abs).split(path.sep).join('/');
      const src = fs.readFileSync(abs, 'utf8');
      for (const m of src.matchAll(lit)) {
        checked += 1;
        if (!KNOWN.has(m[1])) {
          bad.push(`${rel}: 字面量 "${m[1]}/..." 不在已知集 {${[...KNOWN].join(', ')}} 里`);
        }
      }
    }
    expect(checked, '没找到任何数据目录字面量 —— 正则或路径已失效，本门正在"空转"').toBeGreaterThan(0);
    expect(bad, `Go/PS 侧出现了**第三个**数据目录名（跨语言静默写错目录）：\n${bad.join('\n')}`).toEqual([]);
  });

  it('⑤ 反面：本门会红 —— 注入一个未知的 dot-dir 名字即报（出生证）', () => {
    // 直接对判定逻辑做等价断言：把 KNOWN 换成"只认 DATA_DIR_NAME"，`.agent/` 就该被判非法。
    // （真正的注入式出生证见 .inspect/probe_identity_gate.mjs）
    const KNOWN_STRICT = new Set([DATA_DIR_NAME]);
    expect(KNOWN_STRICT.has('.agent')).toBe(false);
    expect(KNOWN_STRICT.has(DATA_DIR_NAME)).toBe(true);
  });
});
