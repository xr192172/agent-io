/**
 * G7 · 宣传-实现一致性门（2026-09-28 建）
 *
 * ★ 为什么需要它（§14 的铁证）：
 *   `EXPLORE_ACTIONS` 就是 `explore_code` 对外**宣传**的 action 枚举 —— 宣传什么，LLM 就看到什么。
 *   实测其中 5 个是空壳/半空壳，**且都对 LLM 公开宣传**：
 *     · `derive_anim_flow` / `derive_algorithm` —— 纯回显（只把 `project_dir` 回填），**没调任何实现**；
 *     · `check_monolith` —— 调了 `assessLines(0, 300, 600)`，**输入硬编码空**；
 *     · `derive_split` —— 调了 `buildSplitPreviewDsl(dir, [], …)`，**文件列表硬编码 []**；
 *     · `derive_chain` —— 调了 `buildCallGraph([], [])`，**两个入参都是空**。
 *   走工具面实测：`explore_code(action=derive_anim_flow)` 返回「**异步 action 已完成**」+ `{"project_dir":…}`
 *   —— **说"已完成"却什么都没做**（对 agent 是主动误导）。
 *   ⇒ **"宣传了但没实现"比"没有这个工具"危害大得多。** 这扇门就是钉这个。
 *
 * ★ 两档判据（单靠机械档会漏掉半空壳）：
 *   【机械档】每个 action 的 `case` 块里必须出现**对已 import 的实现符号的调用**。
 *     —— 抓到的是"纯空壳"（一个调用都没有）。
 *     —— ★ 它**抓不到半空壳**：`check_monolith` 确实调了 `assessLines`，只是参数是假的。
 *   【声明档】每个 action 必须在登记表里**声明它的实现符号**；声明的符号必须真的是**从别处 import**的
 *     （防止把一个本地 no-op 声称为"实现"）。无法声明实现的，必须进 `debt`（附理由）——
 *     而 `debt` 是**棘轮**：条数只许减不许增。
 *
 * ★ 它同时是"堆新工具/新 action"的**准入闸**（用户 2026-09-28 的要求）：
 *   新增 action ⇒ 不声明实现就会被这扇门拦下，或者必须**显式登记为待实现债务**。
 *
 * 收紧基线：UPDATE_EXPLORE_WIRING=1 ./node_modules/.bin/vitest run tests/tools/explore_action_wiring.test.ts
 *
 * ★ P-E（2026-09-28）：本门的**判据**（`case '<action>':` 派发块 ↔ 声明的 import 实现）读的是
 *   `explore_code.ts` 的 switch 结构，**结构上套不到全部工具**（多数工具没有 action 派发表）⇒
 *   「完成 ⇒ 可验证产物」**没有**硬扩到本文件，而是另立一扇对全部工具可机械判定的门：
 *   `tests/tools/tool_completion_receipt.test.ts`（G11 · 回执产物门，判**回执通道**）。
 *   两门纪律同族、判据不同。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPLORE_ACTIONS } from '../../src/application/meta/explore/explore_code.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..', '..');
const SRC = path.join(REPO, 'src', 'application', 'meta', 'explore', 'explore_code.ts');
const REG = path.join(here, '..', 'fixtures', 'explore_action_wiring.json');

interface WiringRegistry {
  note: string;
  /** action → 它调用的实现符号（从别处 import 的）。★ 每个宣传出去的 action 都必须在此出现 */
  implOf: Record<string, string | null>;
  /** 无法声明实现的 action → 理由。★ 棘轮：条数只许减不许增 */
  debt: Record<string, string>;
}

/** 该文件顶部 import 进来的**具名符号**集合（= "别处的实现"的候选集） */
function importedNames(src: string): Set<string> {
  const head = src.slice(0, src.indexOf('\nexport const EXPLORE_ACTIONS'));
  const out = new Set<string>();
  for (const m of head.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/).pop()!.trim();
      if (n) out.add(n);
    }
  }
  return out;
}

/** 把源码按 `case '<action>':` 切成块（到下一个 case/default 为止） */
function caseBlocks(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const marks: Array<{ action: string; at: number }> = [];
  for (const m of src.matchAll(/\n\s*case\s+'([a-z_]+)'\s*:/g)) marks.push({ action: m[1], at: m.index! });
  for (let i = 0; i < marks.length; i += 1) {
    const end = i + 1 < marks.length ? marks[i + 1].at : src.length;
    out.set(marks[i].action, src.slice(marks[i].at, end));
  }
  return out;
}

describe('G7 宣传-实现一致性门', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  const imported = importedNames(src);
  const blocks = caseBlocks(src);
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8')) as WiringRegistry;

  it('检测器自身有效：import 清单与 case 切块都拿到了东西（防"空转绿"）', () => {
    expect(imported.size, '没解析到 import 符号 —— 门的解析失效了').toBeGreaterThan(10);
    expect(blocks.size, '没切出 case 块 —— 门的解析失效了').toBeGreaterThan(0);
    // 反面：随便造一个符号不该被判成"调了实现"
    expect(/semanticSearch\s*\(/.test(src)).toBe(true);
  });

  it('★ 每个**宣传出去**的 action 都必须在登记表里声明实现（新 action 的准入闸）', () => {
    const undeclared = EXPLORE_ACTIONS.filter((a) => !(a in reg.implOf));
    expect(
      undeclared,
      `这些 action 已对外宣传、但没在 tests/fixtures/explore_action_wiring.json 里声明实现：\n` +
        `  ${undeclared.join(', ')}\n` +
        '⇒ 新增 action 必须①声明它调的实现（且该实现是 import 来的），或②登记进 debt 并写明理由。',
    ).toEqual([]);
  });

  it('机械档：声明了实现的 action，其 case 块里必须真出现该符号的调用', () => {
    const bad: string[] = [];
    for (const action of EXPLORE_ACTIONS) {
      const impl = reg.implOf[action];
      if (!impl) continue; // debt 项由下一档管
      if (!imported.has(impl)) {
        bad.push(`${action}: 声明的实现 "${impl}" 不是本文件 import 的符号（不能拿本地 no-op 当实现）`);
        continue;
      }
      const body = blocks.get(action);
      if (!body) {
        bad.push(`${action}: 找不到它的 case 块（实现声明了但根本没派发？）`);
        continue;
      }
      if (!new RegExp('\\b' + impl + '\\s*\\(').test(body)) {
        bad.push(`${action}: case 块里没有调用声明中的实现 "${impl}" —— **宣传了没实现**`);
      }
    }
    expect(bad, `宣传-实现不一致：\n${bad.join('\n')}`).toEqual([]);
  });

  it('声明档棘轮：`debt`（承认是空壳/半空壳的）只许减不许增，且每条必须有理由', () => {
    const debtActions = Object.keys(reg.debt);
    // ① 每条债务必须有非空理由
    const noReason = debtActions.filter((a) => !reg.debt[a]?.trim());
    expect(noReason, `这些债务没写理由：${noReason.join(', ')}`).toEqual([]);
    // ② 债务必须都是真实宣传出去的 action（防止登记了不存在的）
    const ghost = debtActions.filter((a) => !(EXPLORE_ACTIONS as readonly string[]).includes(a));
    expect(ghost, `debt 里登记了不存在的 action：${ghost.join(', ')}`).toEqual([]);
    // ③ ★ 棘轮上界：实测基线 5 条（§14.1：2 纯空壳 + 3 半空壳）。**新增即红。**
    expect(
      debtActions.length,
      `空壳/半空壳债务 ${debtActions.length} 条 > 基线 5 条 —— 新增了"宣传了没实现"的 action。\n` +
        `当前：${debtActions.join(', ')}`,
    ).toBeLessThanOrEqual(5);
    // ④ 反向：implOf 里既没实现、又不在 debt 的 ⇒ 漏登记
    const unaccounted = EXPLORE_ACTIONS.filter((a) => reg.implOf[a] === null && !(a in reg.debt));
    expect(unaccounted, `这些 action 既没实现也没进 debt：${unaccounted.join(', ')}`).toEqual([]);
  });
});
