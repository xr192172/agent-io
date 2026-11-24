// touches: src/infrastructure/project_registry.ts, src/infrastructure/storage.ts, src/infrastructure/graph/import_project.ts
/**
 * P0 · **项目根（册归属）与扫描目录分离**（G-1 · O1 根错位根治）。
 *
 * ## 病史（改前实测）
 * `import_project` 只知道一个 `project_dir`，注册表把它同时当作「册归属根」与「扫描目录」。
 * rebuild_feature 把 `src/` 子树传进 `project_dir` ⇒ 注册表 `project_root=…/src` ⇒
 * `getDesignSheetFile` 把册目录解析到 `src/.agent-io/design/`：错位派生副本（1.36MB 册）+ 0B 侧车，
 * 真册 `.agent-io/design/agent-io.history.jsonl`（855 行）在登记根下读不到 ⇒ 门 7/8/12 红。
 *
 * ## 根治口径（本证钉住）
 * · `project_root` = 项目根（册归属根）：册 / 侧车 / live / baseline 住 `<project_root>/.agent-io/`；
 * · `source_root` = 扫描源码目录：importProject 实际 walk 的树（可与 project_root 不同）；缺省 = project_root。
 *
 * ## 反向牙（fail-closed 突变点）
 * ① 的册落点断言是鉴别器：若把分离改回旧模型（扫描子树当 project_root 登记），`projectRootOf`
 *   指向 src 子树 ⇒ `getDesignSheetFile` 落点进 `src/.agent-io/design/` ⇒ 本证红（证明有牙，不是假绿）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normRoot,
  projectRootOf,
  sourceRootOf,
  readRegistry,
  registerFeature,
} from '../src/infrastructure/project_registry.js';
import { getDesignSheetFile } from '../src/infrastructure/storage.js';

const tmp = (tag: string): string => fs.mkdtempSync(path.join(os.tmpdir(), `agentio-split-${tag}-`));

/** 换独立数据仓（★ AGENT_IO_DATA_ROOT 优先级高于 AGENT_IO_HOME ⇒ 显式摘掉） */
function useHome(tag: string): string {
  delete process.env.AGENT_IO_DATA_ROOT;
  const home = tmp(tag);
  process.env.AGENT_IO_HOME = home;
  return home;
}

test('① 分离登记：project_root=仓根（册归属）· source_root=扫描子树；册目录落在仓根、不进子树', () => {
  const home = useHome('a');
  try {
    const pkgRoot = tmp('pkg');
    const srcRoot = path.join(pkgRoot, 'src');
    fs.mkdirSync(srcRoot, { recursive: true });

    const reg = registerFeature('feat-x', pkgRoot, 'test', srcRoot);
    assert.equal(reg.changed, true, '首次登记必须 changed');

    // 两字段分别落对：project_root=仓根，source_root=扫描子树
    assert.equal(projectRootOf('feat-x'), normRoot(pkgRoot), 'projectRootOf 必须返回册归属根（仓根）');
    assert.equal(sourceRootOf('feat-x'), normRoot(srcRoot), 'sourceRootOf 必须返回扫描子树');
    const entry = readRegistry().features['feat-x'];
    assert.equal(entry.project_root, normRoot(pkgRoot));
    assert.equal(entry.source_root, normRoot(srcRoot));

    // ★ 反向牙：册归属解析走 project_root ⇒ 册目录落在仓根 `.agent-io/design`，不在 src 子树下。
    //   旧模型（子树当 project_root）下落点会进 `<srcRoot>/.agent-io/design/` ⇒ 下面两条断言红。
    const sheet = getDesignSheetFile('feat-x');
    assert.ok(
      sheet.startsWith(path.join(pkgRoot, '.agent-io', 'design')),
      `册目录必须落在仓根 .agent-io/design（改前错位到 src 子树）：${sheet}`,
    );
    assert.ok(
      !sheet.startsWith(path.join(srcRoot, '.agent-io')),
      `册目录不许落进扫描子树 src/.agent-io（O1 错位形态）：${sheet}`,
    );
  } finally {
    delete process.env.AGENT_IO_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('② 同根向后兼容：source_root 缺省 = project_root，且不落 source_root 字段', () => {
  const home = useHome('b');
  try {
    const pkgRoot = tmp('pkg');
    registerFeature('feat-same', pkgRoot, 'test');
    const entry = readRegistry().features['feat-same'];
    assert.equal(entry.project_root, normRoot(pkgRoot));
    assert.equal(entry.source_root, undefined, '同根历史形态不落 source_root 字段（保持旧册形状）');
    assert.equal(sourceRootOf('feat-same'), normRoot(pkgRoot), '缺省回退 project_root');
  } finally {
    delete process.env.AGENT_IO_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('③ 幂等：project_root 与 source_root 都没变 ⇒ 不写盘（changed:false）', () => {
  const home = useHome('c');
  try {
    const pkgRoot = tmp('pkg');
    const srcRoot = path.join(pkgRoot, 'src');
    fs.mkdirSync(srcRoot, { recursive: true });
    registerFeature('feat-i', pkgRoot, 'test', srcRoot);
    const again = registerFeature('feat-i', pkgRoot, 'test', srcRoot);
    assert.equal(again.changed, false, '两字段都没变 ⇒ 幂等不写盘');
    // 仅 project_root 变 ⇒ changed:true
    const other = tmp('other');
    const moved = registerFeature('feat-i', other, 'test', srcRoot);
    assert.equal(moved.changed, true, 'project_root 变了 ⇒ 覆盖');
    assert.equal(projectRootOf('feat-i'), normRoot(other));
  } finally {
    delete process.env.AGENT_IO_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('④ 旧三参调用兼容：只传 (feature, root, by) 不抛，等价于同根登记', () => {
  const home = useHome('d');
  try {
    const pkgRoot = tmp('pkg');
    const r = registerFeature('feat-legacy', pkgRoot, 'test');
    assert.equal(r.changed, true);
    assert.equal(projectRootOf('feat-legacy'), normRoot(pkgRoot));
    assert.equal(sourceRootOf('feat-legacy'), normRoot(pkgRoot));
  } finally {
    delete process.env.AGENT_IO_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
