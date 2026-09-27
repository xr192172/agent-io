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

// ★ 刻意**不**提供"把整个 diff 拼成一条字符串"的便捷函数。
//   第一版有过一个 `ratchetFailureText`，它把"债务减少（提示收紧基线）"也拼进同一条信息里，
//   调用方于是写成 `expect(msg).toBe('')` ⇒ **任何改善都会把门打红**，违反"只在新增上 fail"。
//   ⇒ 纪律：**失败与提示必须分开**。调用方分别断言 `added` / `grown`（这两个才是红），
//   把 `shrunk` / `cleared` 仅作 console 提示。
