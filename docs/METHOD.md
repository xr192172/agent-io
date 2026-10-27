# 方法论：本仓的六条判据

> 环境坑见 `PITFALLS.md`（那张表只管现状）。这里管**判断方式**。
> 每条都来自**实测**，不是道理；括号里是它被验证的那次。

---

## 判据一：收益看**问题种类数**，不看条数

**错的做法**（我自己犯过）：发现 CJS `require` 在本仓只有 ~3 条 ⇒ 判"不值得修"。

**为什么错**：CJS `require` 在真实 JS 项目里是**主流形态**。3 条是**本仓**的读数，
不是**这类问题**的规模。按条数判 ⇒ 类级盲区永远押后 ⇒ **换个项目大面积漏**。

**判据**：问「**这类问题会不会在别的项目大量出现**」，而不是「本仓有几条」。

> 反例的代价：我因此把「动态 import 只对 `.mjs` 有效」当成**能力边界**登记进注释，
> 那是**把错误固化**（后来发现真因是 `import_nodes` 含 `export_statement`）。

---

## 判据二：先读**配置 / DSL / DB**，再写探针

**事实**：同一个 bug（TS 的动态 import 抽不出来）我**试错了 4 轮** ——
类型判据 → 文本判据 → 字段兜底 → 给 dist 打日志 → dump AST，**全没找到**。

**真因只在一行数据里**：

```ts
// src/infrastructure/parse/languages.ts
typescript.import_nodes = ['import_statement', 'export_statement']
```

`export async function f() { … }` **也是 `export_statement`** ⇒ 遍历里那句无条件 `return`
⇒ **整个函数体被跳过** ⇒ 函数体内的 `await import(…)` 永远看不到。

**判据**：动手写探针之前，先查 **语言表 / DSL 的决策卡 / cache.db 的实际行**。
试错看起来"在干活"，其实是**把地雷埋得更深**。

---

## 判据三：每张 `*_BUILTIN_*` 表都要问一句 ——「它是不是在掩盖一个缺失的解析能力？」

**已应验三次**：

| 表 | 掩盖的缺失 | 处置 |
|---|---|---|
| `BUILTIN_TYPES` 的 tail 名（`ServerResponse` / `Dirent` …） | `type_ref` **丢 receiver**（`http.ServerResponse` 只记 `ServerResponse`） | 修解析器（T-#77）⇒ 表项删（T-#78） |
| `GO_BUILTIN_TYPES` 的 stdlib 名（`Ident` / `Stmt` / `Mutex` …） | 同上 | 同上 |
| `JAVA_BUILTIN_TYPES`（`String` / `Map` / `IOException` …） | **Java 根本没有 `resolveImport`** | 补解析器（T-#80）⇒ 表删 |

**为什么危险**：化石**让真洞看不见**，而且**换个项目就漏**。

**删化石的正确姿势**：删 → **量**（`failed` 涨了是好事，那是暴露）→ **修洞** → 再量（归位）。
实测一轮：删表后 `failed` 14 → **30**（暴露 `DatabaseSync` 8 · `Dirent` 2 …）
⇒ 查出真因是 **`pkgSrc` 只在 `call` 路径查、`type_ref` 路径从来没查**
⇒ 修完 `failed` **30 → 14**，**行为不变，但代码少了 100+ 个硬编码名字**。

---

## 判据四：「**解析不了**」≠「**不存在**」

`const { saveDSL } = await import(pathToFileURL(STORAGE_JS).href)`
- **能知道的**：这个文件动态加载了一个模块，并从它取 `saveDSL`
- **不能知道的**：加载的是**哪个文件**

我第一版把整行**丢了** ⇒ `dep_edges` / `dead_deps` / `impact_analysis` **少一条依赖边**。

**判据**：数据层必须**分开表达**这两件事 ——
`kind: 'computed'`（有事实、路径算不出来）· `bindings`（绑定是真的）· 不进跨文件查找（不制造假解析）。
实测：`imports +67`（computed），`failed` **不变** ⇒ **事实回来了，假解析没增加**。

---

## 判据五：两套判定必须**幂等**

本仓有两条判引用状态的路径：
- `syncFile`（**有 AST**）—— 判得出"这是函数的参数/局部 const"
- `resolveCrossFileCalls`（**只有 DB 行**）—— 判不出

⇒ 同一批引用**走哪条路得到不同答案** ⇒ 实测全量重判后 `failed` **24 → 100**（全是假 failed）。
⇒ **这就是整个会话里数字一直漂（4049 → 4088 → 4094 → 3855 → 4103）的根因。**

**判据**：允许"重判"的前提是**幂等**。
`candidates` 里记下**上一次的结论与来源**；**AST 独有的事实**（`local-binding`）标 `source:'ast'` 不可推翻，
**AST 判不准的**（`suspect`）**必须允许被纠正**。

> 边界很重要：我第一版把**所有** AST 判定都锁死 ⇒ `failed` 暴涨到 **11322**。
> 「不可推翻」只对「**只有这一层能看见的事实**」成立，对「**这一层也看不准**」用它 = **把瞎猜固化成不可修复的错误**。

**配套量具**：`CrossFileResolveStats.overrides` 给出 `上一次判定 → 本次` 的分布
（实测：`suspect→external 331` · `suspect→resolved 40` · `suspect→failed 24` ⇒ **`suspect` 94% 被推翻**）。

---

## 判据六：**数字变差 ≠ 数据变差**

| 场景 | 数字 | 真相 |
|---|---|---|
| 删掉 59 条「计算路径」的假 import source | `imports −59` · `failed +4` | **删掉假数据，换来诚实失败** |
| 删掉 100+ 补偿表项 | `failed 14 → 30`（中间态） | **暴露真洞**，修完归位 14 |
| 带点类型记全名 | `resolved −5` | 裸尾名不再**误匹配**仓内同名符号 |

**判据**：看数字前先问「**这个数是变好了，还是变诚实了**」。
一个**不可复现**的读数，无论多好看都不能当卖点。

---

## 附：当前的能力边界（**别当成"已支持"**）

### 导入解析：26 个语言，**只有 3 个**能解析

| 有 `resolveImport` | 说明 |
|---|---|
| `go` | 本仓 module 前缀 → 目录 → 该目录所有 `.go` |
| `java` | `a.b.C` → 路径以 `a/b/C.java` 结尾（目录=包，语言强制） |
| `python` | `a.b` → `a/b.py` / `a/b/__init__.py`；`.` 前缀按点数上溯 |
| （`typescript` 走默认相对路径逻辑） | |

⇒ 其余 23 个（rust · c_sharp · c · cpp · ruby · kotlin · php · scala · groovy · julia ·
haskell · elixir · bash · fish · ocaml · solidity · crystal · swift …）
**跨文件引用一条都解析不到**。

★ 本仓每种只有 0-4 个文件 ⇒ **完全不可测量**；换个项目就是**大面积漏**。
加语言时见 `parse/kernel.ts#LANG_ADAPTERS` 的 **§7 必填项**。

### 引用解析率：两个口径，别混用

| 口径 | 算法 | 当前值 | 用途 |
|---|---|---|---|
| **本仓解析率** | `resolved / (resolved + failed)` —— **排除 external** | **99.7%** | 卖点。回答"**仓内**引用我们认得多少" |
| 全体占比 | `resolved / 全部引用` | ~14% | **会误导**：`external`（标准库/第三方）本来就不该解析 |

★ 还有一类**结构上不可能解析**：`kind:'computed'`（`import(pathToFileURL(X).href)`）——
它们被正确记为**依赖事实**，但路径算不出来。当前 67 条。
