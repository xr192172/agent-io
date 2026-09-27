// code_health 可达根门夹具 · 入口文件（package.json scripts 按路径调起）
// 它**天然没有项目内消费者** ⇒ 旧逻辑当 brick ⇒ 报 orphan_file + 与 server.js 的假分层违规。
// 它 import 的 server.js 命中了 GLUE_HINTS 的 /server(\.|$)/ ⇒ glue，故 brick→glue = 违规。
import { helper } from './server.js';

export function main(): number {
  return helper();
}

main();
