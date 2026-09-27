// 胶水层入口（豁免孤儿判定）：通过 `.js` 后缀 import 消费中间积木。
import { parentFn } from '../bricks/parent.js';

const result: number = parentFn();

export { result };
