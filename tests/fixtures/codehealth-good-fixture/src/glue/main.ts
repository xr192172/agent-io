// code_health 有效性门夹具 · 已知好：胶水层入口，消费积木（向下，合法）
// 文件底部模块级自调用 = 真实入口模式（见 codehealth-fixture/src/glue/app.ts 同款注释）
import { normalize } from '../bricks/core.js';

export function run(): number {
  return normalize({ id: 1 });
}

run();
