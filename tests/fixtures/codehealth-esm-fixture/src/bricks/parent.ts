// ★ 关键：这里必须写 `.js` 后缀（NodeNext ESM 的真实写法）。
// 若解析器不会剥 `.js` 再试 `.ts`，这条 import 会整条丢失 ⇒ child 被判孤儿。
import { childFn } from './child.js';

/** 中间积木：链路 glue/app.ts → parent.js → child.js */
export function parentFn(): number {
  return childFn() + 1;
}
