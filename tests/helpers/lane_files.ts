/**
 * ★ lane 文件的**唯一落点**（测试侧）。
 *
 * 为什么有它（2026-09-30，搬 ⑦）：lane 不再同住一个目录 —— 每条线现在住在
 * **`src/application/<线名>/index.ts`**（该文件 = 那条线的 ToolDef 定义 + 路由）。
 * 原先 4 个测试各自 `fs.readdirSync('src/registry/lanes')` 取 `*.ts`
 * ⇒ 目录一消失就**集体变红**，而且红的理由（"找不到目录"）跟它们要测的东西毫无关系。
 *
 * ★ 线名**从 `LANE_SOURCES` 派生**，不在这里另抄一份名单 —— 否则就是本仓反复踩的
 *   「同一份判据两份实现」：加了第七条线，这里不会跟着长。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANE_SOURCES } from '../../src/presentation/mcp/server_registry.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 线名列表（来自代码里的唯一真相源） */
export const LANE_IDS: readonly string[] = LANE_SOURCES.map(([id]) => id);

/** 线名 → 该线 lane 源文件的绝对路径 */
export function laneFileOf(id: string): string {
  return path.join(REPO, 'src', 'application', id, 'index.ts');
}

/** 全部 lane 源文件（存在性由调用方断言；这里不做兜底） */
export function laneFiles(): string[] {
  return LANE_IDS.map((id) => laneFileOf(id));
}

/** lane 源文件 + 其内容（4 个门最常用的形态） */
export function laneTexts(): Array<{ id: string; file: string; text: string }> {
  return LANE_IDS.map((id) => {
    const file = laneFileOf(id);
    return { id, file, text: fs.readFileSync(file, 'utf8') };
  });
}
