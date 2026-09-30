/**
 * lane 来源门（P1c）—— 「工具属于哪条线」只能有**一个**来源
 *
 * ★ 为什么需要它（P1c 之后真正剩下的风险）：
 *   P1c 把 `capability_map.LANE_OF`（第二份归属清单）删掉，归属改由 lane 文件所在表达，
 *   由 `server_registry.LANE_SOURCES` 汇总后 `bindLaneOf()` 注入。
 *   ⇒ 于是「归属表 vs lane 文件是否一致」这类检查**变成同义反复**（两边同源，永远一致），
 *     没有存在的价值。真正**还**能出错、且后果不轻的是下面这四类：
 *
 *   ① 6 行映射（lane 文件 → 线 id）写错/**写反**：这是唯一剩下的"人工第二处"——
 *      文件名 `design.ts` 与线 id `'design'` 之间没有机器可读的联系，必须有处映射；
 *      把两个 id 互换 ⇒ 工具在导航里整片跑到别的线，且**没有任何报错**。
 *   ② 同一个 def 被复制进两条线的数组（复制粘贴加工具时极易发生）：
 *      ⇒ `buildLanes` 会把它记进两条线，导航里同一工具出现两次。
 *   ③ 某个 lane 文件**没被 import**（新建了 `lanes/foo.ts` 却忘接）：整条线的工具从注册表消失。
 *      这类"静态看着都在、运行时少一批"的漏，只有真去读磁盘目录才发现。
 *   ④ 第二份归属清单**又被写回来**（回到 P1c 之前那种"两处要同步"的状态）。
 *
 * ★ 本门的出生证（逐个制造、确认变红；见 §7 进度日志）：
 *      P1 僵尸 lane 文件 → ① 红 ／ P2 同一工具归两条线 → ② 红
 *      P4 LANE_OF 写回 → ⑦ 红 ／ P5 两条线 id 互换 → ④ 红
 *   ★ 同时暴露并**移除**了一条空门：我第一版断言"`TOOL_DEFS` 里的 def 就是 lane 数组里那个对象"，
 *     而 `TOOL_DEFS` 正是 `LANE_SOURCES.flatMap` 派生的 ⇒ 恒真、探针照绿。**同义反复不是门，已删。**
 *
 * ★ 与既有门的分工（别重复）：
 *   - G1（tests/server_registry.tool_snapshot.test.ts）：对外契约快照（name/title/description/schema）。
 *   - G4（tests/single_source.test.ts）：同族副本棘轮。
 *   - 本门：**归属来源的唯一性 + 映射与 lane 文件的一致性**。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_DEFS, LANE_SOURCES, laneOfFromSources } from '../../src/presentation/mcp/server_registry.js';
import { LANE_IDS, LANE_META } from '../../src/tools/capability_map.js';
import * as capabilityMap from '../../src/tools/capability_map.js';
import { LANE_IDS, laneFileOf } from '../helpers/lane_files.js';

const here = path.dirname(fileURLToPath(import.meta.url));


/** 磁盘上真实存在的线名 —— ★ 从**唯一落点**取，且每条都要落到一个真实文件上（读盘确认，不用记忆） */
function laneIdsOnDisk(): string[] {
  return LANE_IDS.filter((id) => fs.existsSync(laneFileOf(id))).slice().sort();
}

describe('lane 来源门：归属只能有一个来源', () => {
  it('① 六个 lane 文件与六条线一一对应（磁盘文件名 = LANE_IDS = 映射里的 id）', () => {
    const disk = laneIdsOnDisk();
    const ids = LANE_SOURCES.map(([id]) => id);
    expect(disk).toEqual([...LANE_IDS].sort());
    expect([...ids].sort()).toEqual([...LANE_IDS].sort());
    expect(new Set(ids).size, '同一线 id 出现两次').toBe(ids.length);
  });

  it('② 六份来源两两不交（同一工具不许同时在两条线）', () => {
    const owner = new Map<string, string>();
    const dupes: string[] = [];
    for (const [lane, defs] of LANE_SOURCES) {
      for (const d of defs) {
        const prev = owner.get(d.name);
        if (prev !== undefined) dupes.push(`${d.name}（${prev} + ${lane}）`);
        else owner.set(d.name, lane);
      }
    }
    expect(dupes, `这些工具同时归了两条线：${dupes.join(', ')}`).toEqual([]);
  });

  it('③ 六份来源的并集 = TOOL_DEFS（没有工具被漏在注册表外，也没有凭空多出的）', () => {
    const fromSources = LANE_SOURCES.flatMap(([, defs]) => defs.map((d) => d.name));
    const fromDefs = TOOL_DEFS.map((d) => d.name);
    expect(fromSources.length).toBe(fromDefs.length);
    expect([...fromSources].sort()).toEqual([...fromDefs].sort());
    // ★ 这里**不**断言"TOOL_DEFS 里的 def 就是 lane 数组里那个对象"：
    //   TOOL_DEFS 正是由 LANE_SOURCES.flatMap 派生出来的，该断言恒真 —— 是同义反复，不是门。
    //   （我第一版写了它，探针 P3 立刻暴露：故意改成 `map(d => ({...d}))` 产出复制品，它照样全绿。）
    //   真正要防的"注册表里多出一个不在任何 lane 里的工具"，上面两条名字集合比对已经覆盖。
  });

  it('④ 映射里挂的数组，必须真的是该线文件导出的那个（把 design/cross 的 id 互换 → 红）', async () => {
    // 这是 P1c 之后**唯一剩下的"人工第二处"**：`LANE_SOURCES` 那 6 对 `['id', XXX_TOOLS]`。
    // 为什么必须单独兜：把两条线的 **id 互换**（`['design', CROSS_TOOLS]` / `['cross', DESIGN_TOOLS]`）
    // 时，id 集合仍是那 6 个、工具数不变、名字集合也不变 ⇒ 前面 ①②③ 全绿，导航里两条线的成员静默对调。
    //   ⇒ 只有把「id → 文件 → 该文件到底导出了哪个数组」跑通，才能抓到这个。
    const mismatched: string[] = [];
    for (const [id, defs] of LANE_SOURCES) {
      const mod = (await import(/* @vite-ignore */ `../../src/application/${id}/index.js`)) as Record<string, unknown>;
      const owner = Object.entries(mod).find(([, v]) => v === defs);
      if (!owner) {
        mismatched.push(`线 '${id}'：映射里挂的数组不是 application/${id}/index.ts 导出的任何值`);
      } else if (!owner[0].endsWith('_TOOLS')) {
        mismatched.push(`线 '${id}'：${id}.ts 导出名 ${owner[0]} 不以 _TOOLS 结尾（惯例：${id.toUpperCase()}_TOOLS）`);
      }
    }
    expect(mismatched, mismatched.join('\n')).toEqual([]);
  });

  it('⑤ 派生出的归属表：每个工具有且只有一条线', () => {
    const table = laneOfFromSources();
    expect(Object.keys(table)).toHaveLength(TOOL_DEFS.length);
    for (const [name, a] of Object.entries(table)) {
      expect(LANE_IDS, `${name} 归到了未知线 ${a.lane}`).toContain(a.lane);
    }
  });

  it('⑥ 线元信息（LANE_META）与 LANE_IDS 一致 —— 线 id 集合是同一个', () => {
    expect(LANE_META.map((l) => l.id).sort()).toEqual([...LANE_IDS].sort());
  });

  it('⑦ 棘轮：capability_map 不再导出第二份归属清单（LANE_OF 不许回来）', () => {
    // P1c 之前 `LANE_OF` 就是那份"要与 lane 文件同步"的清单 —— 删掉它是本阶段的全部意义。
    // 这条断言是**防回退**：有人图省事再存一份手写归属表，这里立刻红。
    expect('LANE_OF' in capabilityMap).toBe(false);
    // 归属表是**注入**进来的（模块内持有一个可注入的单值），不是本文件的数据
    expect(typeof capabilityMap.bindLaneOf).toBe('function');
    expect(typeof capabilityMap.resetLaneOfForTest).toBe('function');
  });
});
