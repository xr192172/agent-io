/**
 * probe 的「真筛子」（`isLoadablePackage`）单测
 *
 * 为什么单独钉住它：这条判据是**结构性事实**（包的安装模板），不是环境快照 ——
 * 而它一旦被改坏（例如"顺手"把 prebuild 的存在性并入判据），后果是**静默**的：
 * 要么把死包当可用（stderr 刷屏 + 写闸整批落回 L1b），要么误杀真能用的包（kotlin）。
 *
 * ★ 夹具**自造**（临时目录里写 package.json），**不依赖本机装了哪些包** ——
 *   这正是本笔的教训：断言别把"环境里装了什么"写进前提（否则装个包就假红/假绿）。
 *
 * 判据的权威在 `src/tools/install_package_cli.ts` 的 `templateCompatFromPkgJson`
 * （`scripts.install === 'node-gyp-build'` ⇒ prebuildify 模板 ⇒ 可载入），probe 只是复用它。
 * 本机 36 包实测（逐个真 import + setLanguage + parse）：模板兼容的 20 个 20/20 可载入，
 * 其余 16 个 0/16 —— 零例外。详见 probe.ts / install_package_cli.ts 的注释。
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLoadablePackage } from '../../src/tools/ts_kernel/probe.js';

let dir: string;
const roots: string[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sieve-'));
  roots.push(dir);
});

afterAll(() => {
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      /* Windows 句柄未释放，留给 OS */
    }
  }
});

/** 在临时目录里造一个"包"：写清单 + 可选造 prebuilds / build 目录 */
function makePkg(pkgJson: Record<string, unknown> | string, layout: { prebuilds?: string; release?: boolean } = {}): string {
  const pkgDir = fs.mkdtempSync(path.join(dir, 'pkg-'));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), typeof pkgJson === 'string' ? pkgJson : JSON.stringify(pkgJson));
  if (layout.prebuilds) {
    const d = path.join(pkgDir, 'prebuilds', layout.prebuilds);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'x.node'), '');
  }
  if (layout.release) {
    const d = path.join(pkgDir, 'build', 'Release');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'x.node'), '');
  }
  return path.join(pkgDir, 'package.json');
}

const hostPrebuild = `${process.platform}-${process.arch}`;

describe('真筛子 · isLoadablePackage（判据 = 包的安装模板，纯文件判定）', () => {
  it('prebuildify 模板（scripts.install = node-gyp-build）⇒ 可载入', () => {
    const p = makePkg({ name: 'tree-sitter-x', scripts: { install: 'node-gyp-build' } }, { prebuilds: hostPrebuild });
    expect(isLoadablePackage(p)).toBe(true);
  });

  it('★ 无 prebuild 但模板兼容 ⇒ 仍判可载入（kotlin 形态；prebuild 只是"要不要现场编译"的提醒）', () => {
    // 实测 tree-sitter-kotlin：无 prebuilds、本机 node-gyp 编出 build/Release/*.node ⇒ 载入成功。
    // 若把 prebuild 的存在性并入判据，这一条就会误杀（上一笔刚做通的 kotlin 会变成"不可用"）。
    const noBinary = makePkg({ name: 'tree-sitter-y', scripts: { install: 'node-gyp-build' } });
    expect(isLoadablePackage(noBinary)).toBe(true);
    const localBuild = makePkg({ name: 'tree-sitter-y', scripts: { install: 'node-gyp-build' } }, { release: true });
    expect(isLoadablePackage(localBuild)).toBe(true);
  });

  it('老 nan.h 模板（无 install 脚本）⇒ 不可载入 —— 哪怕盘上留着 .node（ABI/平台多半不对）', () => {
    // 实测形态：tree-sitter-scheme（NODE_MODULE_VERSION 57 不匹配）、sql/xml（not a valid Win32 application）、
    // css/markdown/toml…（require 成功但 setLanguage 抛 Invalid language object）。
    // ⇒ 只按"有没有 .node 文件"筛会把这些全放过，故判据必须是模板。
    expect(isLoadablePackage(makePkg({ name: 'tree-sitter-dead' }, { release: true }))).toBe(false);
    expect(isLoadablePackage(makePkg({ name: 'tree-sitter-dead', scripts: { test: 'tree-sitter test' } }))).toBe(false);
  });

  it('清单缺失 / 内容损坏 ⇒ 不可载入（不猜、不假装可用）', () => {
    const pkgDir = fs.mkdtempSync(path.join(dir, 'broken-'));
    expect(isLoadablePackage(path.join(pkgDir, 'package.json'))).toBe(false); // 文件不存在
    const bad = makePkg('{ not json');
    expect(isLoadablePackage(bad)).toBe(false);
  });

  it('已知限度：非 node-gyp-build 的安装脚本一律判不可用（宁可不试，也不刷屏/半同步）', () => {
    // 这是**有意**的保守面：这类包在实际 tree-sitter 生态里极罕见，且一旦误判方向是
    // "少试一个包"（loader 侧另有"过了筛子却失败 ⇒ 记一次 warning 并缓存不可用"的兜底，
    // 反向的"判不可用却本可用"没有兜底）。要放行就得先改权威实现，别在这里偷偷放宽。
    expect(isLoadablePackage(makePkg({ name: 'tree-sitter-z', scripts: { install: 'node-gyp rebuild' } }))).toBe(false);
    expect(isLoadablePackage(makePkg({ name: 'tree-sitter-z', scripts: { install: 'prebuild-install' } }))).toBe(false);
  });
});
