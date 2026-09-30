/**
 * ★ 回归门：`slim_brick` 定位 go-slim 目录**不许再按层级数**（2026-09-30 搬家实测踩到）。
 *
 * 现场：`slim_brick.ts:121` 原为 `new URL('../../go-slim', import.meta.url)`（"上溯两级"）。
 * 该文件随搬 ⑦ 从 `src/tools/` 移到 `src/application/harvest/`（**深了一层**）
 * ⇒ 指到 `src/go-slim`（不存在）⇒ `spawnSync('go', ['run','.'], { cwd: <不存在> })` ⇒ **ENOENT**
 * ⇒ 而错误信息渲染成「Go 工具链不在 PATH？」—— **把根因指到了完全错误的地方**（5 个测试同时红）。
 *
 * ★ 这是同一个病第 3 次发作（前两次：`daemon.ts` 的 `findObserveDslBin`、台账 §44.7 形态⑥）。
 * ★ 而且"数层级"这种写法**在 src 态与 dist 态里必然有一个是错的**
 *   （`src/tools/` 与 `dist/src/tools/` 深度不同）—— 它以前"能用"只是因为 vitest 直接从 `src/` 转译。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoSlimDir } from '../../src/application/harvest/slim_brick.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
/** 真实位置（源码态）；编译态只是 src 前面多一层 dist，同样要能对上 */
const SLIM_SRC_URL = new URL('../../src/application/harvest/slim_brick.ts', import.meta.url).href;

describe('★ slim_brick 定位 go-slim：按路标，不按层级', () => {
  it('路标 `go-slim/go.mod` 存在（否则本门的正例无意义）', () => {
    expect(fs.existsSync(path.join(REPO, 'go-slim', 'go.mod')), 'go-slim/go.mod 是本仓独有的路标').toBe(true);
  });

  it('从 slim_brick 自身位置出发 ⇒ 解析到仓库根的 go-slim/', () => {
    expect(resolveGoSlimDir(SLIM_SRC_URL)).toBe(path.join(REPO, 'go-slim'));
  });

  it('从任意其它位置出发也一样（路标法对调用方位置不敏感）', () => {
    expect(resolveGoSlimDir(import.meta.url)).toBe(path.join(REPO, 'go-slim'));
  });

  it('★ 反例：老的「上溯两级」从新位置算出来**不是** go-slim/（这就是它当初会 ENOENT 的原因）', () => {
    const here = path.dirname(fileURLToPath(SLIM_SRC_URL));
    const byDepth = path.resolve(here, '..', '..', 'go-slim');
    expect(byDepth, '`src/application/harvest/` 上溯两级只到 `src/`，不是仓库根').not.toBe(path.join(REPO, 'go-slim'));
    expect(fs.existsSync(byDepth)).toBe(false);
  });
});
