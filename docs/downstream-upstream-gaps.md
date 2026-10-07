# 下游声称的上游：缺口清单（2026-10-07）

> **方法来自用户的一次纠正**：「要看**每个工具自己的入参**（它**需要**什么），然后**往上溯源**，
> 而不是看产物、评判'这个东西是否真的有'。**真有需求是从下游往上看出来的。**」
>
> ★ 而这**正是本仓立仓时的做法**：`Touched` 那几个键的立论依据就是
> 「**入参侧 18 个 [B]**、产物侧 12 个已用」（见 `src/domain/b_terms.ts`）。

---

## 1. 为什么要单独立一份（上游视角的结构性盲区）

**从上游往下看**（枚举"谁产了什么 → 谁能接"）**永远发现不了**这一类缺口：
**一个被下游声称、却根本没有门的能力** —— 因为它不在任何名单里，你枚举产物时**不会想起它**。

★ 而"从下游往上看"只要问一句就出来了：**这个工具的入参，谁给？**

## 2. 机检（可复跑）

**判据 = 标识符 vs 注册表**（★ **不是判散文语义** —— 那正是今早刚修的坑）：

```
把每个工具 description 里所有 snake_case 标识符抽出来
  → 排掉【已注册的 61 个工具名】
  → 排掉【所有已知入参名（含深层，collectInputKeys）】
  → 剩下的**交人读**（机器只提名，不下结论）
```

实测提名 **68 个** —— ★ 但**其中大部分是产物字段名**（`expected_apis` / `fell_back` / `call_count` …）。
⇒ ★★ **这本身是个发现：描述里混着"字段名"和"工具名"，机器分不开。**
⇒ 所以这一层**必须人读**；而这也说明**"描述里提到的工具名"最好有个显式写法**（见 §5）。

## 3. 人读后的高信号清单（3 条）

| 标识符 | 谁在引用它 | 真相 |
|---|---|---|
| **`dead_deps`** | `deprecate_offline` · `remove_dead_imports` · `refactor_pipeline` | ★ **能力模块在**（`src/infrastructure/graph/dead_deps.ts`，含 `DeadDepCandidate` 类型），**但没有门**（不在 MCP 面、也不在 CLI 面） |
| **`detect_dead_imports`** | `refactor_pipeline`（描述写"未给 dead 清单时**自动调用**它"） | 不在注册表 |
| **`render_dsl`** | `rename_symbols` · `find_references` | ★ 像**旧名**（现名 `render_design`）⇒ **过期引用** |

★ 其余提名多是 **action 名**（`explore_code` 的 `check_monolith` / `guided_tour` / `derive_*`）、
**op 名**（`edit_code` 的 `replace_text`）、**产物字段名** —— 不算缺口。

## 4. 逐条溯源（"差什么"）

### 4.1 `remove_dead_imports` 差什么（最卡人的一条）

它的入参是硬的：

```ts
dead: z.array(z.object({
  source: string,                                  // 死三方源
  files: z.array(z.string()),                      // 导入该源的闭包文件
  reason?: 'no_reference' | 'unreachable_only',
})).describe('dead_deps 报告的 DeadDepCandidate 列表')
```

⇒ **要用它，你必须先手写这个数组** —— 而**没有任何工具产它**。

**溯源（候选上游 `code_health`，它在扫 `unused_import`）** —— 真跑后看产物：

| | `code_health` 产物 | `remove_dead_imports` 要的 |
|---|---|---|
| 形态 | `issues[] = {kind, severity, file, message}` | `dead[] = {source, files[], reason?}` |
| 粒度 | ★ **点态**（"**这个文件**有个问题"） | ★ **簇态**（"**这个死源**被哪些文件导入"） |

⇒ ★ **不是①名字没对齐，也不是②容器没对上，而是"粒度/语义不同"** ——
从"点"到"簇"中间缺**一步按 `source` 反查导入者**（那是 `find_references` 干的事）。

### 4.2 而 `dead_deps` 这个模块的形态**逐字**就是下游要的

`DeadDepCandidate` = `{ source, files, reason? }` —— 与 `remove_dead_imports.dead[]` **完全一致**。
⇒ ★★ **所以这不是"能力缺失"，是"能力没有门"**：实现与类型都在，只是**没注册成工具**
（⇒ MCP 面看不到、CLI 面也调不到 —— CLI 同样从 `TOOL_DEFS` 找 def）。

## 5. 结论与建议（按"值不值"排）

1. ★★ **给 `dead_deps` 开门**（注册成工具，走 7 处登记面）—— 一次改动同时**坐实三个下游的引用**
   （`remove_dead_imports` / `refactor_pipeline` / `deprecate_offline`），且**形态零翻译**（类型现成）。
2. **修掉 `render_dsl` 这个过期引用**（现名 `render_design`）—— 纯文档卫生，但它是**会误导 LLM 的名字**。
3. ★ **让"描述里提到的工具名"有显式写法**（如统一写 `工具名`）—— 否则 §2 那层永远只能人读，做不成机检。
   ★ 而一旦有显式写法，**这条就能变成门**：「描述里声称的工具名必须在注册表里」。
4. **`detect_dead_imports`**：与 1 是同一族问题（都是"死 import"上游），开门时**一并定名**。

## 6. 未核实清单

| 项 | 状态 |
|---|---|
| 68 个提名里的分类 | ⚠️ **由我人读判定**（可能漏判/误判）—— 机器只提名 |
| `dead_deps` 模块是否**可直接**包装成工具 | ❌ **未读它的导出面**（只知道 `DeadDepCandidate` 类型 + 若干解析函数被 import） |
| `detect_dead_imports` 是否**真的不存在**（还是某个 action） | ❌ 只查了工具名与模块名，**未查 action 表** |
| 是否还有**别的**"能力在、门没有"的模块 | ❌ **完全没查**（本文件只覆盖"描述里被提到"的那些；没被提到的根本不在提名里） |
