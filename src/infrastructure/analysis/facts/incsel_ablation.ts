/**
 * incsel_ablation —— **消融验证：选择自身的判据**（T-#INC-TEST-SEL 柱 4）
 *
 * ## 信任的牙齿
 * 增量选择说"我只跑这些测试"。凭什么信？——把选择**自己**也拿去消融：
 *   ① 全量跑一遍 ⇒ 每个测试文件的真实 verdict（pass / fail）；
 *   ② 增量跑一遍（--changed X）⇒ 选中的测试文件集合 S；
 *   ③ 逐文件对照：**全量红了、但增量没选中**的测试 = 选择有洞（漏选）⇒ 判红。
 * 这就是"选择有判据"的元判据：不是"增量绿了就信"，而是"增量敢漏谁，全量来审判"。
 *
 * 本模块实现 ③ 的**纯函数判定**（①②由 `run-tests.mjs --audit-ablation` 编排）：
 * `ablationCheck(fullVerdicts, selected, changed)` 返回漏选的测试文件（洞）+ 分母。
 *
 * 另给 `coveringTestsOf` 的邻接支撑：改了 X，覆盖 X 的测试集合 C；
 * 审计席可**手动从选择中剔除 C 中某一个**再跑，若它红 ⇒ 证明"它本该被选中" ⇒ 选择有洞。
 */
import { norm, type CoverageMap, coveringTestsOf } from './test_coverage.js';

export type Verdict = 'pass' | 'fail' | 'error' | 'skip';

export interface AblationResult {
  ok: boolean;
  /** 全量红、但增量没选中 ⇒ 选择有洞（这些是"被漏掉的嘴"） */
  holes: string[];
  /** 影子覆盖：改动波及、但覆盖映射里没有任何测试覆盖的源码文件（报告，不直接判红） */
  uncoveredChanged: string[];
  denominator: {
    /** 全量跑了几个文件 */
    fullFiles: number;
    /** 全量红的文件数 */
    fullRed: number;
    /** 增量选了几个 */
    selected: number;
    /** 漏选（洞）数 */
    holes: number;
  };
}

/**
 * ③ 元判据：全量结果 vs 增量选择逐文件对照。
 *
 * 判据：任一 `fullVerdicts[f] ∈ {fail,error,skip}` 且 `f ∉ selected` ⇒ `ok=false`，f 进 holes。
 * ★ `skip` 也算洞：本仓口径 skip/todo = 没验（0.16）。
 * ★ `uncoveredChanged` 单独报告：它说明"改动的文件没有任何测试覆盖"——那是覆盖面存量状况，
 *   不直接判红（否则内环天天红），但审计席必须看得见（0.12 ③ 分母）。
 */
export function ablationCheck(
  fullVerdicts: Record<string, Verdict>,
  selected: readonly string[],
  changedCoveredBy?: { map: CoverageMap; changedFiles: readonly string[] },
): AblationResult {
  const sel = new Set(selected.map(norm));
  const holes: string[] = [];
  let fullRed = 0;
  for (const [f, v] of Object.entries(fullVerdicts)) {
    if (v === 'fail' || v === 'error' || v === 'skip') {
      fullRed++;
      if (!sel.has(norm(f))) holes.push(norm(f));
    }
  }
  holes.sort();
  const uncoveredChanged: string[] = [];
  if (changedCoveredBy) {
    const covering = new Set(coveringTestsOf(changedCoveredBy.map, changedCoveredBy.changedFiles));
    // 覆盖测试集合为空的改动文件 = 影子覆盖
    for (const f of changedCoveredBy.changedFiles) {
      const n = norm(f);
      if (!n.startsWith('src/')) continue;
      let covered = false;
      for (const t of covering) {
        if ((changedCoveredBy.map.byTest.get(t) ?? new Set()).has(n)) { covered = true; break; }
      }
      if (!covered) uncoveredChanged.push(n);
    }
  }
  return {
    ok: holes.length === 0,
    holes,
    uncoveredChanged: uncoveredChanged.sort(),
    denominator: {
      fullFiles: Object.keys(fullVerdicts).length,
      fullRed,
      selected: sel.size,
      holes: holes.length,
    },
  };
}

/**
 * 手动消融的判定助手：审计席说"把覆盖 X 的测试 t 从选择里剔除"，
 * 本函数确认 t 确实在覆盖集里（否则那次剔除是假消融，证明不了任何事）。
 */
export function assertAblationTarget(
  map: CoverageMap,
  changedFile: string,
  removedTest: string,
): { valid: boolean; covering: string[]; why: string } {
  const covering = coveringTestsOf(map, [changedFile]);
  const valid = covering.includes(norm(removedTest));
  return {
    valid,
    covering,
    why: valid
      ? `${norm(removedTest)} 确实覆盖 ${norm(changedFile)}（真消融）`
      : `${norm(removedTest)} 不覆盖 ${norm(changedFile)}（假消融；覆盖者=${covering.join(',') || '无'}）`,
  };
}
