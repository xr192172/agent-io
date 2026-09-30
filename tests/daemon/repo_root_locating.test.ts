/**
 * ★ 回归门：daemon 定位仓库根**不许再按层级数**（2026-09-30 搬家时踩到的静默 bug）。
 *
 * 证据（出生证就在本文件里，不用注入）：`resolveRepoRoot` 的上一版是
 *   `path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')`
 * —— 即「`dist/src/daemon/daemon.js` 上溯 3 级 = 仓库根」。
 * 本文件随 §44.3 ⑥ 搬到 `presentation/daemon/` 后层级变成 4 ⇒ 那一版会算出 `dist/`，
 * **不报错、不返回 null**，只是悄悄退回 PATH ⇒ 这类 bug 只能靠"钉住行为"来防。
 *
 * 所以这里同时钉两件事：
 *   ① 路标法从**任何**位置都算出真仓库根（正例）；
 *   ② 数层级法从**新**位置算出来的是错的（反例 —— 这条就是它凭什么会变红）。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRepoRoot } from '../../src/presentation/daemon/daemon.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
/** daemon 的**源**文件位置（与编译产物同形：`<repo>/src/presentation/daemon/daemon.ts`） */
const DAEMON_SRC_URL = new URL('../../src/presentation/daemon/daemon.ts', import.meta.url).href;

describe('★ daemon 定位仓库根：按路标，不按层级', () => {
  it('路标 `go-observe/` 存在（否则本门的正例无意义）', () => {
    expect(fs.existsSync(path.join(REPO, 'go-observe')), 'go-observe/ 是本仓独有的路标目录').toBe(true);
  });

  it('从 daemon 自身位置出发 ⇒ 解析到真仓库根', () => {
    expect(resolveRepoRoot(DAEMON_SRC_URL)).toBe(REPO);
  });

  it('从任意其它位置出发也一样（路标法对调用方位置不敏感）', () => {
    expect(resolveRepoRoot(import.meta.url)).toBe(REPO);
  });

  it('★ 反例：老的「上溯 3 级」从**编译产物**位置算出来不是仓库根（这就是它当初会静默出错的原因）', () => {
    // ⚠ 必须用 **dist 侧**的位置来算：运行时 `import.meta.url` 指向
    //   `<repo>/dist/src/presentation/daemon/daemon.js`（或源码态同形路径）。
    //   从 `src/presentation/daemon/` 上溯 3 级**恰好**是仓库根 ——
    //   所以"数层级"这条错法只在 dist 侧显形（这也正是它难被发现的原因）。
    const distShaped = path.join(REPO, 'dist', 'src', 'presentation', 'daemon', 'daemon.js');
    const byDepth = path.resolve(path.dirname(distShaped), '..', '..', '..');
    expect(byDepth, '`dist/src/presentation/daemon/` 上溯 3 级只到 `dist/`，不是仓库根').not.toBe(REPO);
    expect(fs.existsSync(path.join(byDepth, 'go-observe'))).toBe(false);
  });
});
