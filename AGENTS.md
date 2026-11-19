# AGENTS.md — AgentIO 开发纪律

## 0. 上位目标

唯一产品定义见 `docs/PROJECT-DESIGN.md`。每轮开工先问：

1. 服务哪个阶段出口（PROJECT-DESIGN 的阶段 A/B/C/D）？
2. 服务哪条分工（理解 / 设计 / 改造 / 对账）？
3. 哪些现有行为必须保持？
4. 为什么不是只处理当前症状？

答不出 ⇒ 侦察或立项，不开施工卡。工具数、判据数、字段填充率不是成功指标。

## 1. 写权层级

```text
根目标 → 项目/功能目标 → 设计变化 → 文件/符号级施工项
```

只有最底层、主体/目标/范围/验收都明确的施工项能改源码。根目标或设计任务没有天然源码写权。

合法小修：当前卡范围内的实现偏离正确设计 ⇒ 直接修 + 行为反例，挂当前卡，不新建设计。超出范围、改公共行为、推翻约束 ⇒ 正式设计变更。

源码主链：`edit_dsl` 写判据 → `design_line action=plan` → 真实节点 `claim` → `edit_code` → `judge` → `complete`。无设计节点的文件走现行 nodeless 通道并留痕；不得伪造卡、绕写闸或手改生成视图。

## 2. 侦察席与执行席

- 侦察席只读：查卡的前提、判据有没有牙、仓里有什么；回报证据，不实现。
- 执行席第一轮只回报三件事：卡里与事实不符处、判据会不会红、打算怎么做/卡在哪。
- 主控裁定后才放行执行。侦察与执行可并行，但写盘只有一条腿。
- 子代理不 commit；主控 commit。

## 3. 判据纪律

写"能力通不通"，不写数字。判据必须能回答通过/不通过，并能说出什么坏输入会让它红。

- `file-exists` / `symbol-exists` / `signature-matches` 发现不了逻辑错；能用 `behavior-cases` / `call-exists` / `run` / `domain-independent` 就不用弱判据。
- 读数是日志，不是判据。
- "有测试" ≠ "有裁判"；唯一证据是打断实现后门确实红。
- 改册后重跑 `npm run design:gen-db`；需要时用 `node scripts/judge-all.mjs` 现判。

## 4. 能力处理顺序

面对"缺能力"的判断，先问：

1. 已有且已接线？复用。
2. 有但未接线？只接线。
3. 有但语义错？用会红的反例修，不扩字段绕过。
4. 确实没有且真实需要？才新增，并说清真实消费者与新反例。
5. 试点仓重复实现？证明旧仓能顶上后留证退役。

禁止用扩字段掩盖语义错；禁止把注册、写入、建字段说成能力成立。

## 5. 验证

日常内环：

```bash
npm run verify:changed
```

全量只在发布前、用户明确要求、公共底座/schema/验证器变更、影响闭包不可信或定时兜底时跑：

```bash
npm run build
npm run verify
```

`verify` 占 `heavy.lock`，期间不改树。改了 `src/` 先 build；`STALE_BUILD` 表示工具仍读旧产物，必须重建。不要手抄少数门代替总门；完整测试入口是 `npm test`，改册后同步 `npm run design:gen-db` 与 `npm run cognition`。

在途子代理需要续作时用 `send_message`，不要因重启重复派席。

收尾三问：

1. 修好了哪盏灯，还是它退出了检查范围？
2. 涉及哪张卡（id + 状态变化）？
3. 没销账的欠哪条，记进证据了吗？

## 6. 环境与路径

- 开工前 `npm run env:check`。
- 路径身份只用 `scripts/lib/path_identity.mjs#samePath`，不手写 `path.resolve(a) === path.resolve(b)`。
- 工具跑 `dist/`；改 `src/` 后先 build。
- PowerShell 写 JSON 用 `[IO.File]::WriteAllText(path, text, UTF8Encoding($false))`，再用 `--input <文件>`。
- `docs/todo.md` 是生成物，不手改；改账走 ledger 工具，再 `npm run ledger:render`。

## 7. 退役与事实

- `docs/RETIRED.md` 是当前仍有效的一票否决；已退役的不许复活。
- 用户愿景原话只在 `docs/VISION-ORIGINAL.md`；转述不能替代原文。
- 同一事实只有一个可写权威；事实、意图、事件与历史分账。

## 8. 当前下一卡

当前方向见 `docs/DEVELOPMENT.md`：在官方 DSH 完整源码的独立 checkout 上完成全链闭环，并测量机制收益与维护成本；试点不等于做 DSH 专属引擎或插件。
