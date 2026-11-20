/**
 * 顶层符号冻结指纹的零依赖编码核。
 *
 * `fps_at_freeze` 仍是 Record<symbolName, string>：单个 body_hash 保持旧值，
 * 同名多行编码为排序后的多重集。这样不改 plans.fps_json 的存储形状，
 * 也不让 SQL 行序决定哪一个同名体“胜出”。
 *
 * 这不是 occurrence 身份：plannedAnchors 仍按名字豁免。旧重复名画布已经
 * 丢失其它行，必须显式重冻结；不得用“旧 hash 命中任一行”猜测放行。
 */
export function symbolBodyFingerprint(bodyHashes: readonly string[]): string | null {
  if (bodyHashes.length === 0) return null;
  if (bodyHashes.length === 1) return bodyHashes[0];
  // 不用 Set：两个相同 hash 仍代表两个索引行，增删其中一行必须可检测。
  // 默认 sort 是确定性的字符串排序，不依赖 locale，也不修改调用方数组。
  return `multiset:${JSON.stringify([...bodyHashes].sort())}`;
}
