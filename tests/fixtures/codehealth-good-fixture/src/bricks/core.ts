// code_health 有效性门夹具 · 已知好：积木层，依赖契约层（向下，合法）
import type { Item } from '../contracts/types.js';

export function normalize(item: Item): number {
  return item.id * 2;
}
