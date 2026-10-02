// ★ 故意成环：a → b → a（应被报 circular_dependency）
import { fromB } from './b.js';
export function fromA(): string {
  return fromB() + 'a';
}
