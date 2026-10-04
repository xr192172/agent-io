/**
 * self_writes —— 自写登记文件的**读取侧原语**（纯读，无编排）
 *
 * 为什么独立成模块：`pendingSelfWrites` / `readSelfWrites` 只是"读
 * `<root>/.agent-io/self-writes.json` + TTL 过滤"的**纯读原语**，
 * 读路径（`infrastructure/index/index_freshness.ts`、`meta/integrity`）要用它们。
 * 若把它们留在 `application/observe/runtime/write_gate.ts`（写闸门编排所在层），
 * 就会出现「下层（infrastructure）import 上层（application）」的分层违规。
 * 故把**读**这一小块下沉到 infrastructure；**写**侧（`recordSelfWrite` / `writeSelfWrites`
 * / `SELF_WRITE_MAX`）连同写闸门编排仍留在 `write_gate.ts`，从本模块 import 它需要的那几样。
 *
 * 数据形状（`.agent-io/self-writes.json`）：`{ v: 1, writes: SelfWriteEntry[] }`
 */

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR_NAME } from '../data_dir.js';

/** 自写登记文件路径 */
export function selfWritesPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), DATA_DIR_NAME, 'self-writes.json');
}

/** 自写登记条目的有效期：够读路径消费到即可，过期自然消失（避免文件无限长大） */
export const SELF_WRITE_TTL_MS = 10 * 60 * 1000;

export interface SelfWriteEntry {
  at: number;
  files: string[];
  note?: string;
}

/** 读登记文件（坏数据当空，绝不抛；索引是增强不是前提） */
export function readSelfWrites(root: string): SelfWriteEntry[] {
  try {
    const raw = fs.readFileSync(selfWritesPath(root), 'utf-8');
    const parsed = JSON.parse(raw) as { writes?: SelfWriteEntry[] };
    const list = Array.isArray(parsed?.writes) ? parsed.writes : [];
    return list.filter((e) => e && Array.isArray(e.files) && typeof e.at === 'number');
  } catch {
    return [];
  }
}

/**
 * 取**待消费**的自写登记（去重后的相对路径），供读路径优先同步。
 * 不过期项不会被清掉 —— 消费方要幂等（按 hash 判定），这里只做"提示"。
 */
export function pendingSelfWrites(projectRoot: string, opts: { maxAgeMs?: number } = {}): string[] {
  const root = path.resolve(projectRoot);
  const ttl = opts.maxAgeMs ?? SELF_WRITE_TTL_MS;
  const now = Date.now();
  const out = new Set<string>();
  for (const e of readSelfWrites(root)) {
    if (now - e.at >= ttl) continue;
    for (const f of e.files) out.add(f);
  }
  return [...out];
}
