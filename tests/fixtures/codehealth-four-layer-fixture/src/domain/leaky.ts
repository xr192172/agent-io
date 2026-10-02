// ★ 故意违规：domain（最底层）向上 import application 层 —— 应被 code_health 报 layer_violation
import { run } from '../application/service.js';
export function leaky(): string {
  return run('x');
}
