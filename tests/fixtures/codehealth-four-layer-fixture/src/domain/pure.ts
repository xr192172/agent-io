/** 四层夹具 · domain 层：最底层，谁也不依赖 */
export interface Pure { id: string }
export function makePure(id: string): Pure {
  return { id };
}
