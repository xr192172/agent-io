# DEVELOPMENT.md — 开发、验证、席制与下一卡

## 1. 开发顺序

一个施工项必须从上层目标来：

```text
用户目标 → 项目/功能目标 → 设计变化 → 施工项 → 写权
```

文件级命名、循环写法、局部变量是实现自由度；设计管行为、公共契约、调用接线、允许副作用和必须保留的约束。

## 2. 验证

日常改动：

```bash
npm run verify:changed
```

发布前、用户明确要求、公共底座 / schema / 验证器变更、影响闭包不可信或定时兜底：

```bash
npm run build
npm run verify
```

改判据后：

```bash
npm run design:gen-db
node scripts/judge-all.mjs
```

`verify` 和 `mutate` 等重任务互斥；`verify` 期间不改树。不要手抄几条门代替总门。撞到带编号的既有闸或环境坑时，先查 `docs/PITFALLS.md`；只修当前失效，不把过程故事写回开发指南。

### 收尾三问

1. 修好了哪盏灯，还是它退出了检查范围？
2. 涉及哪张卡（id + 状态变化）？
3. 没销账的欠哪条，记进证据了吗？

## 3. 判据与反例

判据回答"能力通不通"。强度顺序：

```text
behavior-cases / call-exists / run / domain-independent
    > signature-matches / edge-exists
    > file-exists / symbol-exists / source-has
```

每条检测点必须说出：守什么、造什么坏输入会红、没覆盖什么、失败后谁负责。检查对象退出检查范围导致变绿，不算修复。

## 4. 席位协作

- 侦察席：只读，核前提、判据有没有牙、仓里有什么，回报证据。
- 主控：读证据裁定，写施工卡。
- 执行席：第一轮只回报"与事实不符 / 判据是否有牙 / 计划与卡点"；放行后才实现。
- 验收席：只给树与判据，不给过程；不用 DSL 判据当裁判。

写盘永远只有一条腿；子代理不 commit。

## 5. 能力分派

面对"缺能力"：

1. 已有且接线 ⇒ 复用。
2. 有但未接线 ⇒ 只接线。
3. 有但语义错 ⇒ 用当前会红的反例修。
4. 确实没有且真实需要 ⇒ 才新增。
5. 试点仓重复实现 ⇒ 证明旧的能顶上后留证退役。

## 6. 台账当前性

- `ledger` 状态在 `ledger_rows`；事件在 append-only 的 `ledger_events`。
- `close` 用 done/void 翻转状态并写证据；`reopen` 回 active；`supersede` 只写取代指针和事件，旧行仍 active。
- 当前任务视图应只把 `state=active ∧ superseded_by IS NULL` 当 current；历史仍可考古，不删。
- 手改 `docs/todo.md` 后 importer 拒灌回；生成视图用 `npm run ledger:render`，对账用 `npm run ledger:check`。

## 7. 当前下一卡

完成文档基线后，优先做：

1. **官方 DSH 完整源码的独立 checkout** 作为当前外部试点：`import_project → 设计册 → 领卡 → 施工 → 判据验收 → 销账`。首刀限 `packages/boot/plugin-manager` 的 `installBundle` 行为保持分阶段重构，不改公共契约、审批顺序或错误语义。
2. 同时记录改坏次数、返工次数和机制维护时间；若维护成本超过收益，必须据此缩减机制，而不是继续堆叠。
3. 不把试点变成 DSH 专属引擎或插件。通用宿主无关层未成立前，不做 DSH 专属实现，不把任何远端 UI 当第二控制面或第二真相源。

下一卡开工前必须给出：项目路径、目标功能、非目标、保持行为、验收反例、serves 哪个阶段出口。缺任一项先侦察，不施工。
