import fs from 'node:fs';
const p = 'docs/DESIGN.md';
let s = fs.readFileSync(p, 'utf8');

const SECTION = `
### ★★★ 工具审计（2026-10-18；用户要求：「结构重构过多次，工具可能是早期遗留，都看看」）

★★ **审计口径**：找一切"指向已退场路径"的东西 —— `features/`（已删）、`agent-io.json`（已停写）、`docs/*.dsl.json`（已移走）。
★ **也包括"工具对用户说的说明"** —— 因为它比代码更能误导人。

| # | 位置 | 问题 | 状态 |
|---|---|---|---|
| **1** | \`stage_registry.ts:46 / :316\` | import 着没用到的 \`getFeatureFile\`；\`note\` 写的是「活态 agent-io.json / 存档 features/」 | ✅ 已修（改成 \`.agent-io/design/<f>.dsl.json\`） |
| **2** | \`board/pool.ts:9\` | **我自己写的注释说「读 features/」**，而实际读 \`getDSL\` = design | ✅ 已修 |
| **3** | \`capability_map.ts:225\` | 对用户说「真相是 \`features/<f>.json\`」 | ✅ 已修 |
| **4** | ★★ \`presentation/http/serve.ts:90\` | \`const LIVE_FILE = getLiveDslFile()\` ⇒ **HTTP 服务读已停写的 agent-io.json** ⇒ **界面看到的是冻结数据**（:244/:248 与 :2675/:2676 两处读它） | ⬜ **待修**（要先看两处的 feature 上下文） |
| **5** | \`dsl_ops/*.ts\`（annotation/api/file/edge/node/feature/status/update_feature） | 全部 \`getDSL\`/\`saveDSL\` —— 这层已随 storage 改为读写 design ✓，但**没验过一条完整的 op** | ⚠️ **待验**（一次 edit_dsl 改字段 ⇒ 看 design 的 sha 变没变） |
| **6** | \`design/intent/detect_drift.ts:83\` | 注释里提 \`getFeatureFile\` | ⬜ 文案（低） |
| **7** | \`meta/explore/query_feature.ts:98\` | 那个 \`features\` 是 **query 名**（不是路径） | ✅ 无问题 |
| **8** | \`refactor/diff_views/diff_views.ts:196\` | 注释里引 \`features/<f>.json\`（历史说明） | ⬜ 文案（低） |

★★ **结论**：**代码层大多已随 \`storage\` 一起指向 design ✓**，但有三处**不是代码错、是"话说错了"**（1/2/3 —— 已修），
而 **4 是功能性 bug**（HTTP 界面冻结），**5 是未知**（没验过）。

★ **这条审计要持续**：以后新增任何"读 DSL"的地方，都必须问一句「**读的是 design 侧吗**」。
`;

if (!s.includes('工具审计（2026-10-18')) {
  s = s.replace(/^## 7 · 文件地图/m, SECTION + '\n## 7 · 文件地图');
  fs.writeFileSync(p, s);
  console.log('★ 审计结果已写进 DESIGN.md（§6 之后、§7 之前）');
} else console.log('★ 已有');
