# P4 步骤 5 设计：`ApproveGated` 与两个验证门

> 目标：把 Go `proposal.go:161-226`（`ApproveGated`）+ `:271-298`（两个验证门）+ `:391-418`
> （`finalizeDecls`）+ `:257-267`（`freeze`）搬到 TS，搬完 Go 的 `approve` 子命令即可删。
>
> **本笔只出设计，不动代码。** 其中四层里三层可机械照搬，一层必须先拍板。

## 一、风险分层（先说清哪层能搬、哪层不能）

`ApproveGated` 是四层编排，逐层风险不同：

| 层 | 内容 | 能否照搬 | 依据 |
|---|---|---|---|
| **L1 规则回归门** | `VerifyRuleRegression`（`:354-370`） | ✅ **可以，且已就绪** | 判据唯一来源 = 谓词表；P1 已把它提到模块级 `OBSERVE_RULE_TABLE`（`judge.ts`）。纯集合运算、零 I/O |
| **L2 decl 级 LLM 复核** | `gate.LLMReview`（`:183`） | ❌ **不能照搬 —— 必须新建** | **Go 生产代码零实现**（只有 `proposal_test.go:179/269/296` 的桩）⇒ 语义在 Go 里是**未定义**的 |
| **L3 覆盖校验** | `verifyLLMCoverage`（`:271-288`） | ✅ 可以 | 纯集合运算：只看"有没有结论" |
| **L4 半放行 + 冻结** | `finalizeDecls`（`:391`）/ `freeze`（`:257`） | ⚠ 可以搬，但**含一个需拍板的语义** | 见 §三 |

⇒ **四层里三层可机械照搬，一层靠"抄"抄不来** —— 那正是必须拍板的地方。

## 二、L1 + L3 可以直接照搬（先钉住，免得下笔时又改主意）

### L1 规则回归门

```
VerifyRuleRegression(decls) → { checked, covered, uncovered[] }
  checked   = decls.length（★ 不去重，Go :356 就是这么算的）
  covered   = 有确定性谓词的声明数
  uncovered = 无谓词的 rule 名（★ 去重 + 字典序，Go :368 sort.Strings）
```

- 判据唯一来源：`judge.ts` 的 `OBSERVE_RULE_IDS`（P1 立的那张表）。
- `Summary()` 证据串：`rule-regression: %d/%d 声明可确定性判定`
- `Describe()`：全部有谓词 ⇒ `全部规则有确定性谓词，可规则秒判`；否则列出需复核的 rule
- ⚠ **`VerifyRuleRegression` 自己不拒绝任何东西** —— 无谓词声明只进 `uncovered`。拒不拒是 `ApproveGated` 的事。

### L3 覆盖校验（★ 它的判据比名字暗示的弱得多）

```
verifyLLMCoverage(uncovered, verdicts):
  covered = { v.rule | v.rule != "" }        ← 只看"有没有结论"
  missing = uncovered \ covered
  missing 非空 → 报错（缺复核: …）
```

★ **它不看结论内容**：`result:"deviation"` 的结论**也算覆盖（通过）**。
⇒ 与 L4 的半放行机制绑在一起，见 §三。

## 三、★ 需拍板：LLM 判为"不可靠"的声明，要不要进权威 `dsl.json`？

### 现状（Go 的真实行为，非注释所述）

Go `:178-190` 的分支：`uncovered` 非空时，LLM 不可用 / 调用失败 / 覆盖不全 ⇒ **freeze**
（提案 rejected、`dsl.json` **完全不动**、判定继续用旧版）。

但如果 LLM **成功**覆盖了全部 `uncovered`，就进 `:192 finalizeDecls`。而 `finalizeDecls`（`:391-418`）：

```
llmOK = { v.rule | v.rule != "" && v.result == "ok" }     ← ★ 只有 ok 才算通过

每条声明：
  有谓词            → verified_by="rule-regression",  status="verified"
  llmOK[rule]       → verified_by="llm-review",        status="verified"
  其余              → verified_by="needs-llm-review",  status="proposed"（原 status 非空则保留）
```

⇒ **推论（重要）**：LLM 对某条声明给出 `deviation` 结论时，该声明**会带着
`needs-llm-review` / `proposed` 标记进入权威 `dsl.json`**。这是**半放行**：
提案整体被批准，个别声明标记为"待复核"。

### ★ 而 Go 的注释把这个语义写错了

Go `:388` 写「无谓词且**未过** LLM 复核 → needs-llm-review」。
但代码路径实际是「LLM 复核**给了非 ok 结论**」——
"未过复核"这个说法更像"复核没通过"，而代码里 `result:"deviation"`（复核**判定它不可靠**）
也会落到同一分支。**注释与实现不符**，且这个差别正是该不该进权威的关键。

### 三个选项

| 选项 | 行为 | 代价 |
|---|---|---|
| **A 照搬** | LLM 判 deviation 的声明**照进**权威，打 `needs-llm-review` | 与 Go 逐字一致、跨语言无分叉；但**一条被复核者判为不可靠的契约进了权威真相源**，且后续 `judge` 会真的按它判 |
| **B 收紧** | LLM 判 deviation ⇒ **freeze**（提案 rejected，权威不动） | 语义更安全；但 **TS 与 Go 行为分叉**，且需明确"LLM 判 deviation"到底指什么（见 §四） |
| **C 分级** | 照搬 A 的标记，但 `judge` 侧遇到 `status:"proposed"` 的声明**不参与判定** | 保留信息又不污染判定；代价是判定侧要加一条过滤（**又一处"声明式的东西要落地"**） |

**我的建议：B。** 理由：权威 `dsl.json` 的定义是"行为级判定的**权威真相源**"
（Go `dsl_store.go:6-7` 自己的话）。一条被复核判为不可靠的声明进了它，就等于"权威"自己承认不可靠。
而 A 的代价是静默 —— 它不会报错，只在字段里留个标记，**没人会去看 `needs-llm-review`**。

⚠ 选 B 会让 TS/Go 分叉，**必须显式登记**（本仓的老教训：分叉要写出来，不靠自觉）。

## 四、★ 需拍板：decl 级复核的判据是什么？

Go 侧 `LLMVerdict{Result, Rule, Reason}`（`llm_judge.go:57-61`）与 TS 的
`JudgeEntryWithLLM.llm = {result, rule, reason}`（`judge_service.ts:32`）**字段完全同构**
⇒ 适配只需 `entries.filter(e => e.llm).map(e => e.llm)`。

**但语义是空的**，因为 Go 从没实现过。要能写 prompt，必须先答：

**Q：LLM 拿到一条声明（`rule` + `expect` + `constraint`），判什么？**

| 判据 | `ok` 意味着 | `deviation` 意味着 | 后果 |
|---|---|---|---|
| **① 声明自洽性** | 声明本身写得对（expect 可判定、rule 名副其实） | 声明畸形 / 不可判定 | 畸形声明不该进权威 |
| **② 声明 vs 观测** | 声明与实际事件一致 | 声明与现实矛盾 | 矛盾的是**代码**，不该改声明 |
| **③ 声明 vs 代码** | 声明描述了代码的真实行为 | 代码违反了声明 | 矛盾的是**代码** |

⚠ **②③ 都不是"声明该不该进权威"的问题，是"代码要不要改"的问题** ——
若选 ②③，LLM 判 deviation 时正确反应是**改代码 / 提 issue**，不是把声明打标记或冻结。

**我的建议：选 ①，且 prompt 明确"只判声明自身，不判代码"** ——
因为这个门的职责是"能不能把这条声明写进权威真相源"，不是"代码对不对"。
代码对不对由 `judge`（事件判定）与 `reconcile`（链路对账）负责，职责不重叠。

⚠ 选 ① 的一个后果：**LLM 只判声明，等于没人在审批时看代码**。
若要"这个声明确实描述了当前代码"，那是 ②/③ 的活，属另一个门。

## 五、L2 的形状（选定后即可实现）

```
reviewDeclsWithLLM(decls: TSDLDecl[], opts): Promise<{ok, llm?, error?}>
  · 只对**无谓词**的 rule 逐条问（照搬 Go `:183` 的粒度：整批 decls 传进去，
    但只有 uncovered 的那些会被判）
  · prompt：buildDeclReviewPrompt(decl) —— 形状照 `judge_service.ts:121 buildLLMPrompt`，
    但**入参从 (event, rule) 换成 (decl)**；★ 这是**新写**的函数，Go 侧无对应物可抄
  · LLM 不可用（`loadLlmConfig()` 失败）⇒ 返回 {ok:false, error} ⇒ 上层 freeze（照搬 Go 行为）
```

现有可复用件：`llm_focus.ts` 的 `callChat` + `loadLlmConfig`（`judge_service.ts:20` 已用）。
**已核实：全仓没有 decl 级复核入口**（`llmOk` 的命中全是砖块 / 工具分类器，无关）。

## 六、缺 LLM 时的行为：建议照搬 Go（响亮失败）

Go `:179-182`：`gate.LLMReview == nil` ⇒ freeze，错误文案
`LLM 复核不可用，存在无确定性谓词的声明，定稿冻结（判定继续用旧版 dsl.json）`。

**照搬，理由充分**：
- 这是本仓少见的**正确**失败模式 —— 不静默、不假装通过、明确说"判定继续用旧版"
- 与 §三 的 B 方案同向（都倾向"权威不动"）
- 冻结是**可恢复**的（提案可重新提交），比"放行"安全

## 七、待你拍板的三件

1. **§三**：LLM 判 deviation 的声明 → **A 照搬进权威** / **B 冻结**（我建议 B）/ **C 标记但不参与判定**
2. **§四**：decl 复核判据 → **① 声明自洽性**（我建议）/ ② 声明 vs 观测 / ③ 声明 vs 代码
3. **§六**：缺 LLM ⇒ freeze —— 照搬 Go，**我建议照搬**，除非另有想法

拍板后的实现顺序：
1. `verifyRuleRegression` + `regressionEvidence`（纯搬运，`OBSERVE_RULE_IDS` 已就位）
2. `finalizeDecls` + `freeze`（纯搬运）
3. `mergeLoopDecls`（按键覆盖，见附录）
4. `reviewDeclsWithLLM` + `buildDeclReviewPrompt`（**新写**，依赖 §四 拍板）
5. `approveGated` 编排 + 跨语言实测（提案 JSON 与 `dsl.history.jsonl` 两边互读）

## 附：`mergeLoopDecls` 的两个既有行为（照搬，但需知情）

- **按键覆盖，不是并集**：键 = `rule + "|" + probe`（known-spread 另加 `| constraint.source`）；
  键存在则**整条替换**（非字段级 merge），键不存在则追加；**冲突无告警、无记录**
- ⚠ **一个疑似 bug，照搬未修**：`:239-242` 先扫当前集建键索引，若当前集内**同键重复**，
  只有**最后一条**进索引，**前面那些永远不会被覆盖**。
  **不修的理由**：修它会改变现有 `dsl.json` 的合并结果，属行为变更；且当前 `dsl.json`
  由种子 + 审批生成，同键重复本不该出现。**已在案上登记**。

## 附：另一个需要知晓的既有不一致（不在本笔范围）

`HistoryEntry.action` 的声明词表是 `seed|save|approve|rollback`，但 **`rollback` 永不出现**
（Go `:171` 的 `Rollback` 把 `"rollback"` 传给了 `source` 形参，而 `Save` 恒用 `Action:"save"`）
—— 详见清单 T57 的 P4 步骤 3 条目。**本笔不动它**（属 `dsl_store` 侧，且会让两侧审计口径一起变）。
