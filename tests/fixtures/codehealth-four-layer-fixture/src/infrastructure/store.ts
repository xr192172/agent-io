/** 四层夹具 · infrastructure 层：只向下依赖 domain（合法） */
import { makePure, type Pure } from '../domain/pure.js';
export function save(id: string): Pure {
  return makePure(id);
}
