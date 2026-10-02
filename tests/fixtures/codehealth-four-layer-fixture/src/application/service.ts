/** 四层夹具 · application 层：向下依赖 infrastructure（合法） */
import { save } from '../infrastructure/store.js';
export function run(id: string): string {
  return save(id).id;
}
