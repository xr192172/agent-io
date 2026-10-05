# agent-io 逐工具实测体检报告

> **日期** 2026-10-05 ｜ **模型** Space-Bunny ｜ **方式** 全量真调，不读码断言
> **覆盖** `TOOL_DEFS` **59/59 个工具**，**200 次真实调用**（每次的完整输出都留了档）
> **隔离** `AGENT_IO_HOME` 指向临时目录 + 两个临时夹具项目（fixA: 3 TS + 1 Go + 1 Py + docs + package.json；fixB: 跨仓撞名用）
> **副作用** 我的一次 `refactor_pipeline` 调用误改了本仓 16 个文件，**已 `git checkout` 还原并重建通过**（详见 P0-1，这本身是最重要的发现）

---

## 一、总评

**这个项目最强的地方不是功能，是诚实。**

200 次调用里我没有遇到一次编造的数据或"假装成功"。它的错误信息普遍带着**为什么**和**下一步**，这在 agent 工具里非常罕见。实测摘录：

| 场景 | 实际回执 |
|---|---|
| `mode=type` 少给 file | `缺少必需参数 file：mode=type 需要 file（类型定义文件）。例：{mode:'type', file:'src/application/refactor/find/find_references.ts', symbol:'FindReferencesResult'}` |
| 改 `semantic.files` 无证据 | `…必须**现取**该文件的事实（T20 第 (4) 步）… ★ 为什么：DSL 已不存事实镜像（actual_apis / actual_deps 已移除）⇒ 事实只能**现取**。` |
| LLM 不可用 | `空 key 池：可设 AGNES_KEY_POOL（逗号分隔多 key），或设 AGNES_UPSTREAM_BASE 指向本地 key-pool-proxy` |
| plan 被篡改 | `清单指纹不符：声明 bea04cd0e583c98c，实算 aab6820fa85a75da` |
| 事件缺 `level=effect` | `事件文件中无 level=effect 事件（读 1 个文件）。需用 instrument --effects 重新插桩后运行。` |
| 结构域表齐了 | `⇒ 结构意图与现状一致 ✓（注意：这只说明"**已开垦区**整齐"，不等于"全仓都登记了"）` |
| 语言能力不足 | `非"调用级"语言的引用/影响结论会低估（"零引用/零波及"不可全信）` |
| `replace_text` 没命中 | `四级均未命中（L1 逐字 / L2 空白归一 / L3 缩进弹性 / L4 省略号占位）` |

**最大的系统性风险**：项目里存在四道"**声明了但服务端不强制**"的缝 —— zod `required`、`Touched` 词表、`steps` 形状、`dry_run` 语义。这类缝的共同特征是**不崩溃、也不报错**，而是给你一个**看起来正常的结果**（"全局 通过" / "所有观测值符合契约" / "健康分 30"），让你带着错结论继续走。**这比崩溃危险得多**，也与本仓自己的判据（"掩盖比误报更坏"、"失败要响亮"）直接冲突。

---

## 二、P0 —— 会静默给错结论 / 会静默改盘

### P0-1 ★★★ `refactor_pipeline` 没有 dry-run 档，且"未验证"也报"全局 通过"（我亲身踩到）

**实测**：`refactor_pipeline({project_dir: <本仓>, steps:{dead_imports:{enabled:true}}, verify:false})`

```
确定性重构管线完成：全局 通过，
共 2 步，39 个文件被改写，删除 176 单位
基线=未验证
  [[ts] dead import 移除] not_verifiable——未启用验证，已落盘（改动 39 文件，176 单位）
```

实际后果：
- `src/presentation/mcp/server_registry.ts` **被删掉 129 行 import**（几乎整个工具注册表的依赖面）
- 另外 15 个源文件各被删 1 条 import
- **`changed_files` 里 23 条是 `.inspect/**`** —— 项目自己的探针目录、临时脚本、假根镜像（`.inspect/_fakeroot/src/**`）**全被当成重构目标**

三个独立缺陷：

1. **没有 dry-run 档。** 同族工具的既有约定是「`split_stage` 默认 dry-run、`rules` 两个写 action 默认 `dry_run=true`、`rename_*` 先整体 dry-run、`archive` 明文写"无 dry_run"」—— `refactor_pipeline` 是**唯一破例**的那个：一次调用改 39 个文件。
2. **`outcome: "not_verifiable"` 却输出 `ok:true` + "全局 通过"。** "通过"在没有验证的前提下没有任何含义。这是本仓最讨厌的"silent green"。
3. **作用域没收窄**：`.inspect/**` 这种一次性探针目录没有被排除，与 `node_modules` / `dist` 同级看待。

> 补充：还原后 `tsc --noEmit` **通过**，说明这 176 条 import 确实多数是死的（`server_registry.ts` 的 handler 早已搬进 lane）。所以**删除本身大体正确，风险在于"无声、大范围、无闸"**。

### P0-2 ★★★ `observe_judge` 对不合规事件静默丢弃，然后宣布"全部合规"

`src/infrastructure/analysis/observe/judge_service.ts:54`

```ts
if (typeof r['probe'] !== 'string' || typeof r['fields'] !== 'object' || r['fields'] === null) continue;
```

`continue` 之后事件被丢掉，而函数**返回的 `error` 字段（签名里就有）从不使用**。实测：

```
传 1 条缺 fields 的事件 →
  Observe 判定报告：0 个事件 · 0 ok · 0 偏差
    ✓ 所有观测值符合契约
  DATA: {"total":0,"ok":0,"deviation":0,"entries":[]}
```

**一个裁判工具，因为输入不合法就给出"全部合规"的绿灯。** 这是本仓明令禁止的"静默漏报"，而且落在"判对错"这个最不该错的功能上。

**同一份坏输入，喂 `observe_log` 则是裸崩**：

```
observe_log(events_file=<存在的文件>) → Cannot read properties of undefined (reading 'err')
reconcile_chain(...events_files=[存在的文件]) → Cannot read properties of undefined (reading 'file')
```

⇒ **同一个 judge 的两个入口，一个静默谎报、一个抛裸 TypeError，都不说"你的事件缺 fields"**。
（对照：`split_stage` 已经为同类问题加了漂亮的形状守卫，见 `src/application/design/index.ts:320-331`。这条守卫应该复制到 `normalizeEvents`。）

### P0-3 ★★ `code_health` 的输出完全不截断

真仓库 417 个文件实测：

| 指标 | 数值 |
|---|---|
| message 正文 | 153,515 字符 / **2,205 行** |
| `---DATA---` 块 | 237,524 字符 |
| 合计 | **391,049 字符** |
| issue 条数 | **1,095** |
| 耗时 | 71 秒 |

`top` 参数**只管复杂度 Top 榜**，管不住 issue 清单。MCP 面上这是一次 ~100k token 的返回 —— 客户端会静默截断，agent 拿到半截数据却以为拿全了。

---

## 三、P1 —— 结论"不可全信"，工具自己也承认

### P1-1 ★★★ `code_health` 的 `unused_export` 有两类系统性假阳

**(a) 只经 `new X()` 使用的类**（夹具实测）

`src/app.ts` 有 `import { add, sub, Calc } from './math.js'` 且 `new Calc()`，但 `code_health` 报：

```
· [unused_export] src/math.ts:9 Calc
      顶层符号 Calc 项目内无引用（外部消费者不可见，删除前请确认非公共 API）
```

机制在 `src/infrastructure/analysis/health/index.ts:790-798`：`used` = 函数体内的**调用边** ∪ 跨文件调用边 ∪ 同文件文本。`new Calc()` 既不是调用边，而 import 声明本身也不计入引用。

**(b) Go 的 `_test.go` 测试函数** —— 真仓库 282 条 `unused_export` 里 **102 条（36%）**是 `TestXxx`：

```
· [unused_export] go-observe/internal/instrument/contract_test.go:13 TestPackageFilter
```

`grep TestPackageFilter` 全仓 0 处引用（它由 Go 的 test runner 按名反射调用，**任何调用图都不可能看见**）。

**连带一个判据分叉**：`index_integrity` 把测试文件单列并报「测试 **0/0**」（即不计入），而 `code_health` 把它们当普通源码扫。两个工具对"什么算测试文件"给了不同答案。

> 公平地说：`unused_import` 我抽查了 2 条（`handlers.ts:12 path`、`cross/index.ts:14 wrap`），逐字核实**都是真阳性**。这一维度可信。

### P1-2 ★★★ `derive_chain` / `derive_algorithm` / `derive_anim_flow` 用 cwd 兜底（本仓明令禁止的那种）

三处**逐字相同**的一行：

```
src/application/design/derive/derive_chain.ts:395
src/application/design/derive/derive_algorithm.ts:70
src/application/meta/view/derive_anim_flow.ts:289
  const projectRoot = input.project_root ? path.resolve(input.project_root) : process.cwd();
```

而 `explore_code` 的工具描述教的是「`derive_chain`（给 **feature+node_id**）」「`derive_algorithm`（给 feature+node_id+function）」—— **不教传 `project_root`**。照描述调用必然走 cwd 分支。实测（cwd = 本仓，feature 属于 fixA）：

```
源文件不存在，无法读取: D:\project_develop\design-canvas\src\math.ts
```

⇒ 它去读**另一个项目**。三个函数里都有 `project_root` 参数，只是描述不提；**DSL 里就有权威的 `source_root`**（实测 `import_project` 写了 `"source_root":".../fixA"`），却没用。

**最讽刺的一处**：`derive_anim_flow.ts:499-502` 的注释自己写着

> `project_dir`：**仅调用方显式给 `project_root` 时**才给 —— Core :289 默认走 cwd 的分支**不给**（cwd 是"另一个项目"，不是"更弱的答案"，不许兜底）。

**契约层诚实，核心层不诚实。** 这正是 T19 第 ④ 步删掉 11 处 `?? process.cwd()` 的那类判据，只漏了这三处（它们写成三元表达式，所以 grep `??` 抓不到）。

### P1-3 ★★ "健康分 30（D）"这个数字对本仓没有可验证的分母

```
417 个文件 → 健康分 30（D）
健康度 30 分（D）：0 循环依赖 / 0 分层违规 / 569 高复杂度 / 282 未使用导出 / 197 未使用 import / 47 孤儿文件
```

`code_health` 的分层违规 0、循环依赖 0 —— 这两项是**真干净**（本仓的四层设计确实成立）。但 282 未使用导出里至少 102 条已证伪，569 高复杂度里 `complexity_threshold` 默认 10 而报告里最高只有 2（夹具）/ 不知（本仓）。

⇒ **这个分数是"读数的函数"，不是"质量的度量"**。它把"工具看不见跨仓消费者"、"看不见 test runner"这类**工具的视野边界**记成了**代码的缺陷**。给分应该扣掉已知盲区，否则它会引导人去做无效清理。

---

## 四、P2 —— 形状 / 文案瑕疵

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | **`capability_map` 导航页上 `diagnose` 的一句话是错的** —— 写「诊断能力缺口（多语言矩阵）」，那是 `capability_audit` 的活。`diagnose` 实际是"症状 → 根因 + 证据链 + 影响 + 修复建议"（实测 18 秒、4050 字符的完整报告）。这是**新用户第一站**上的一句错文案，代价是一个 agent 选错工具。 | `capability_map.ts:182` |
| P2-2 | 同一张表里 `scaffold` 仍写着 **`action=backfill`**，而 backfill 已随 T20 整条删除（`docs/todo.md` 明写"scaffold 只剩 generate"）。导航页教了一个不存在的 action。 | `capability_map.ts` design 段 |
| P2-3 | `capability_audit` 那行被截断成 `**能力矩阵自检**（缺口清单；` —— 句子没写完。 | `p0_capability_map.txt:77` |
| P2-4 | **`split_stage` 把原文件的全部 import 复制进新文件**，造出死 import。它自己的 `code_health` 立刻能自证：`! [unused_import] src/dead-code.ts:1 helper` —— `dead-code.ts` 里躺着 `import { helper } from './seed-value'` 而 `neverUsed` 根本不用它。 | `p4_split_apply.txt` 的 `imports_copied` + `p4_code_health_after.txt` |
| P2-5 | `rename_symbols` 的 `dryRun` **三条出口三种形态**：module 成功路径**完全不写这个字段**（类型是 `dryRun?`），阻断路径写 `true`，local 路径写 `false`。调用方无法从 data 顶层判断到底写没写。 | `rename_symbols.ts:121/345/348/415` vs `:507` |
| P2-6 | `remove_dead_imports` 的 `dead[].file` 给**相对路径**时按 **cwd** 解析，然后报 **`输入 dead 清单的文件均非 TS/Go 系`** —— 不存在的文件被报成"不是 TS/Go"，错误指向错的原因。同一调用把 file 换成绝对路径立刻成功。 | `p2_remove_dead.txt` vs `p3_dead_abs.txt` |
| P2-7 | `memory_observe` 的 `target` 在 schema 里是 `.optional()`，但除 `targets` 外**每个 action 都需要它**。 | `schemas.json` vs `p2_memory_status.txt` |
| P2-8 | T34 仍在：`explore_code` 异步 action 外层 message 恒为「异步 action 已完成」（`watch` 那次实测）。真实文本在 `data.message` 里，但模型若不读 `data` 就只看到这三个字。 | `p4_watch.txt` |
| P2-9 | **两套 LLM key 解析路径**：`translate_go_ts fill` 报「空 key 池：可设 `AGNES_KEY_POOL`」，而同一时刻 `gateway_provider` 报告已自动发现一个可用的 `agnes` key、`signal_review` 报 `llm_available: true`、`annotate_functions` 真的写出了带 `@fnhash` 的语义注释。 | `p2_translate_fill.txt` vs `p1_gateway_list.txt` |
| P2-10 | `code_health` 的产物顶层字段叫 **`root`**，而受控词表里这个概念**唯一的名字是 `project_dir`**（`project_root` 已登记为 `debt: true` 的同义异名）。量具 `measure_b_contract.mjs` 报"候选异名 0 个"—— **量具量不到它**（只扫 application/** 的顶层字段名）。 | `p1_code_health.txt` DATA 首字段 + `b_terms.ts:282-288` |

---

## 五、被我真跑验证过的"确实好用"的部分

这些不是读码结论，是有 git diff / 落盘产物 / 机器判据为证的：

**① 跨文件改名真的对**
`rename_symbols(scope=module)` 把 `add` → `plus`：`math.ts` 的定义 + `Calc.sum` 里的同文件引用 + `app.ts` 的 import 子句 + 两处调用，**四处全改**。`git diff` 逐行核对过。

**② T54 那个"零翻译接力"判据成立**
`find_references` 的回执里 `touched.file` = `src/math.ts`、`touched.symbols` = `["sub"]` —— **逐字就是** `rename_symbols` 的 `renames[].file` / `renames[].symbol`。真接上了。

**③ T20(4) 的"先读后改"闸门按设计工作**
- 无证据改 `semantic.files` → **被拒**，且文案解释了原因（事实镜像已摘 ⇒ 只能现取）
- 带 `evidence:[{type:'diff', ref:'src/math.ts'}]` → **通过并真落盘**
- `weight=routine` → **仍然拒**（符合"routine 只跳 L4、不跳 L3"的口径）

**④ `edit_dsl` 批量原子性可信**
第 2 步失败 → `操作 2/2 失败，已回滚全部 1 个已应用变更 / 失败原因: API "不存在的()" 不存在`。非法 op 也给得干净：`node 不支持操作: frobnicate`。

**⑤ `split_stage apply=true`（清单里标"未验"的那一项）真跑通了**
2 个采纳簇真切出来、补了 re-export、过了语法级 + 编译级 + 测试级验收、给了回退指令。**T15 的这个"未验"可以销了。**

**⑥ `plan_refactor` → `apply_refactor_plan` 成对且防篡改**
前者给 plan_id + 可读 diff + 逐字交接说明；后者验指纹，篡改时**同时报出声明值与实算值**。

**⑦ `annotate_functions mode=apply` 真的写了**
在 `math.ts` 上注入了带 `@fnhash` body 指纹的中文语义注释，且 `@fnhash` 落在注释里 —— 过期检测有抓手。

**⑧ 索引保鲜 + 结构化陈旧告警真的在跑**
每次调用前的保鲜（`invokeTool` 单点）+ `STALE_INDEX` 结构化告警块（带 `fix` 字段告诉 agent 下一步做什么）。

**⑨ `cross_repo_symbol_index` 概念分得清**
"同名不同签 = 真冲突" vs "同名同签 = 迁移范围" 两种结论分开给。

**⑩ `import_project` → `get_dsl(query=dsl)` 的产物质量高**
7 文件 → 8 节点 / 12 符号 / 2 依赖边，`expected_apis` 带 `line`/`end_line`/签名全文 —— 这是真能当"设计的意图层"用的数据。

---

## 六、我的建议（按"值不值"排序，不是清单）

1. **`refactor_pipeline` 加 `dry_run` 档（默认 true）**；同时把"未启用验证 ⇒ 不许输出'通过'"钉死。理由：这是全项目唯一"一次调用静默改 39 文件"的工具，而且我确实踩到了。
2. **`normalizeEvents` 的 `continue` 改成回 `error`**（签名已经支持，只差一行）。把 `split_stage` 那段形状守卫的文案照抄过去即可。
3. **`code_health`：① 输出分页/截断（哪怕只给前 200 条 + 总数）；② 排除 `_test.go`；③ `new X()` 计入引用。** 前两条各能砍掉 36% 和 100% 的噪音。
4. **三处 `derive_*` 的 `process.cwd()` → `dsl.source_root`**（顺序：`project_root` 显式入参 → `dsl.source_root` → 响亮抛）。判据现成：`storage.ts` 的 `requireProjectRoot` 就是为这件事写的。
5. **`capability_map` 的 `diagnose` / `scaffold` 两条策展文案**（P2-1、P2-2）。导航页上错一句，代价是一个 agent 选错工具 —— 而导航页正是"工具太多、agent 容易幻觉选错"这个问题的答案本身。
6. **`code_health` 的 `root` → `project_dir`**；顺手让量具能看见 infrastructure 层的结果（否则 T18 的 `touched 30/37` 这个读数会一直让人以为覆盖面够）。

---

## 附：实测方法（可复现）

- 夹具：临时目录 3 个文件（`src/math.ts` 含类与字段、`src/app.ts` 有 import 与调用、`src/util.ts` 有死 import / 死函数 / 短名）+ `main.go` + `calc.py` + `docs/design.md` + `package.json` + `structure.domains.json`
- 隔离：`AGENT_IO_HOME` 指向临时目录 ⇒ 不读写真实数据目录
- 每个写类工具都配了 `git init` 基线，**用 `git diff` 逐条核对"到底改了什么"**，不信工具自述
- 200 次调用的完整 stdout/stderr 全部落盘留档（`$TEMP/aio_probe/out/*.txt`），本文每个引文都能回溯到具体某一条
- 探针产物全部在 `$TEMP`，仓库工作区已确认干净（`git status` 只剩未跟踪的 `.codebuddy/`），`npm run build` 通过
