// ★ 故意成环的另一半
import { fromA } from './a.js';
export function fromB(): string {
  return fromA() + 'b';
}
