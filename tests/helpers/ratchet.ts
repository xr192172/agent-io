/**
 * tests/helpers/ratchet.ts —— 「棘轮」比较器（**唯一实现**）
 *
 * 语义：**存量不拦、新增即红**。与仓内 `scripts/*_gate` 的棘轮纪律、以及 `apply_rules` 的
 * 「只在新增命中上 fail（存量不拦）」一致。
 *
 * ★ 为什么抽出来：G4（同族副本）与品牌串残留门用的是**同一套比较语义**。
 *   副本的代价不是"多写 20 行"，而是**两边的判定会分叉** —— 那正是本仓反复吃到的那类病。
 *   测试辅助代码同样适用"同一份知识只有一处落点"。
 */

export interface RatchetDiff {
  /** 新增的命中文件（此前没有 ⇒ 疑似又加了一份/又写回了旧名） */
  added: string[];
  /** 已知命中的文件里又多出了命中 */
  grown: Array<{ file: string; was: number; now: number }>;
  /** 命中减少（好事，但应同步收紧基线） */
  shrunk: Array<{ file: string; was: number; now: number }>;
  /** 基线里的文件已归零 */
  cleared: string[];
  /** 基线里登记了但文件已不存在（搬迁/删除后必然出现） */
  missing: string[];
}

/**
 * @param frozen 棘轮基线：文件 → 命中数
 * @param actual 本次实测：文件 → 命中数（只含非零）
 * @param exists 文件是否仍存在（默认全存在）；用于把 `missing` 单独报出来
 */
export function ratchetDiff(
  frozen: Record<string, number>,
  actual: Record<string, number>,
  exists: (file: string) => boolean = () => true,
): RatchetDiff {
  const added = Object.keys(actual).filter((f) => !(f in frozen)).sort();
  const grown: RatchetDiff['grown'] = [];
  const shrunk: RatchetDiff['shrunk'] = [];
  for (const f of Object.keys(frozen).sort()) {
    const was = frozen[f];
    const now = actual[f] ?? 0;
    if (now > was) grown.push({ file: f, was, now });
    else if (now > 0 && now < was) shrunk.push({ file: f, was, now });
  }
  return {
    added,
    grown,
    shrunk,
    cleared: Object.keys(frozen).filter((f) => (actual[f] ?? 0) === 0).sort(),
    missing: Object.keys(frozen).filter((f) => !exists(f)).sort(),
  };
}

/** 把棘轮差异整理成"给人看"的失败信息（新增/增长两类才是红） */
export function ratchetFailureText(id: string, d: RatchetDiff, hint: string): string {
  const parts: string[] = [];
  if (d.added.length) parts.push(`新增命中：\n  ${d.added.join('\n  ')}`);
  if (d.grown.length) parts.push(`已知处又多了：\n  ${d.grown.map((g) => `${g.file}: ${g.was} → ${g.now}`).join('\n  ')}`);
  if (d.shrunk.length || d.cleared.length) {
    parts.push(
      `（债务已减少，请收紧基线：` +
        [...d.shrunk.map((s) => `${s.file} ${s.was}→${s.now}`), ...d.cleared.map((f) => `${f} 已归零`)].join(', ') +
        `）`,
    );
  }
  if (parts.length === 0) return '';
  return `[${id}] ${hint}\n${parts.join('\n')}`;
}
