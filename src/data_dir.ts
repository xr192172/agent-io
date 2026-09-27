/**
 * data_dir.ts —— 工具数据目录名（在目标项目根下）的【唯一落点】
 *
 * ★ 为什么要有它（2026-09-28，为品牌改名铺路）：
 *   这个目录名此前**硬写在 193 处、散在 130 个文件**里（`storage.ts` / `db.ts` / `daemon.ts` /
 *   `observe/*` / `java_refactor/*` / 一堆 tools …）。而品牌改名 DesignCanvas → AgentIO
 *   要改的正是它 ⇒ 193 处散落意味着：**必然漏改**，而且**没法加"旧名回退"的兼容层**
 *   （兼容要判断"新目录不存在而旧目录存在"，散落时无处安放这段逻辑）。
 *   ⇒ 先收成单点（**本次值不变、零行为变化**），改名时才只需改这一个常量 + 加回退。
 *
 * ★ 兼容（改名执行时启用，现在不做）：
 *   数据目录是**运行时契约** —— 盘上已有项目的数据住在这里，纯改名会让老项目"数据消失"。
 *   故改名时本模块要提供 `resolveDataDir(root)`：优先新名，若不存在而旧名存在 ⇒ 用旧名，
 *   并在日志里提示"建议迁移"。`DATA_DIR_NAME_LEGACY` 就是为那一刻预留的。
 *
 * ★ 不变量：`DATA_DIR_NAME` 是唯一真相。**任何地方再写一次这个目录名字面量就是副本**
 *   （已由 G4 登记表 + 品牌串残留门共同兜底）。
 */

import path from 'node:path';

/** 当前数据目录名（目标项目根下） */
export const DATA_DIR_NAME = '.design-canvas';

/**
 * 旧名（历史/兼容用）。
 *
 * 现在与 `DATA_DIR_NAME` 相同 —— **改名执行的那一刻**才把它改为历史名，并启用回退逻辑。
 * 预留在此是为了让"改名"变成一处改动，而不是一次全仓搜索。
 */
export const DATA_DIR_NAME_LEGACY = '.design-canvas';

/** 扫描应跳过的数据目录名集合（新名 + 旧名都要跳，改名迁移期两者可能并存） */
export const DATA_DIR_NAMES: readonly string[] = [...new Set([DATA_DIR_NAME, DATA_DIR_NAME_LEGACY])];

/** 目标项目根下的数据目录绝对路径 */
export function dataDirOf(root: string): string {
  return path.join(root, DATA_DIR_NAME);
}

/** 数据目录下的子路径（`dataDirUnder(root, 'observe', 'events.jsonl')`） */
export function dataDirUnder(root: string, ...segments: string[]): string {
  return path.join(root, DATA_DIR_NAME, ...segments);
}

/** 目录名是否就是数据目录（目录扫描跳过用；**新旧都算**，迁移期两者可能并存） */
export function isDataDirName(name: string): boolean {
  return DATA_DIR_NAMES.includes(name);
}

/** 路径**片段**是否落在数据目录内（`startsWith` 语义，供按段判断的调用方用） */
export function isUnderDataDir(segment: string): boolean {
  return DATA_DIR_NAMES.some((n) => segment.startsWith(n));
}
