# 先例检索：tree-sitter 多语言聚合包（2026-10-08）

> 触发：用户提议「**fork 出一个自己的仓，把语法全都重建好，挂到 GitHub，叫重制版，也许还能给上游提 PR**」。
> 本仓规矩：**建整座房子之前先查先例**。这份是检索结果 + 据此的结论 —— **结论是：不要自建。**

## 一、查到的（证据分级：**直接读过**）

**`kreuzberg-dev/tree-sitter-language-pack`**（MIT）
- npm：`@kreuzberg/tree-sitter-language-pack`（实测 `1.10.9`，**10 小时前刚发版** ⇒ 极活跃）
- PyPI：`tree-sitter-language-pack`；另有 Rust/Go/Java/C#/Ruby/PHP/Elixir/WASM/Dart/Kotlin/Swift/Zig/C-FFI 绑定（11 种）
- ★ 我**直接读了**它的 `sources/language_definitions.json`（71KB，本机 `.inspect/upstream_languages.json`）：

| 项 | 实测 |
|---|---|
| 语言数 | **372** |
| `generate: true`（**用 CLI 重生成**，绕开 ABI 不合） | **162** |
| `local`（它自己 vendor 的语法，带 `license` 字段） | 8（graphql abnf plantuml promela reason wolfram xquery yul） |
| 带显式 `abi_version` | 129 |
| 带 `ambiguous`（扩展名歧义，如 `h` → cpp/objc） | 8 |
| 每门记录 | `repo` + **`rev`（钉死 commit）** + `extensions` + `generate`/`directory`/`branch`/`c_symbol`/`license` |

另有一份 `sources/grammar_notices.json`（**662KB**）= 逐语法的许可与署名清单。

**同类还有**（二手，只当线索）：`@xberg-io/tree-sitter-language-pack`（371 门，描述文字与上面近乎同源）。

## 二、★ 反向证据优先：**我们今天修的缺陷，它结构上存在吗？**

我们这两天在解的：**逐语言的薄绑定老化成 NAN ⇒ 装上也载入不了；ABI 15/9 超出核心窗口 ⇒ 静默失败**。

在它那里：
- 它**不依赖逐语言的 npm 绑定** —— 自己把 grammar 编成一个包（372 门一起）
- 对 ABI 不合的，它用 **`generate: true` + tree-sitter CLI 重新生成**（162 门！）
⇒ ★★ **这个缺陷结构上不存在**。按本仓的判据（`oss-prior-art-first` §3.6），
  这是**最强的"别造房子"信号**。

## 三、★ 交叉验证：**我们的活没错**（这是免费拿到的独立证据）

拿我们 `SOURCES.json` 里钉的 rev 去对它的 rev：

| 语言 | 我们 | 上游 | 结论 |
|---|---|---|---|
| `fish` | b7f1d682941e | b7f1d682941e | ✅ 一致 |
| `r` | 58a22794466c | 58a22794466c | ✅ 一致 |
| `vhdl` | a3b2d8499052 | a3b2d8499052 | ✅ 一致 |
| `crystal` | 15597b307b18 | 51ad1411de94 | ⚠️ 不一致 —— **不是钉错**：wiki 里 `crystal` 有两个仓（`will/…` 与 `keidax/…`），我们用了前者、它用了后者 |
| ocaml/swift/toml/vue | 按 npm 版本号钉 | 按 git rev 钉 | 不可比（口径不同） |

⇒ 3/3 可比项**逐字一致**；第 4 项是**选了不同的上游仓**。

## 四、我们卡住的 12 门，**它全都有**

`erlang rego tcl nim zig xml clojure scheme latex graphql` + `less` + `proto` ⇒ **12/12 在它清单里**
（其中 `rego tcl latex less proto` 走 `generate` 重生成，其余直接用 rev 的 parser.c）。

## 五、许可证闸门（30 秒，但事后无法补救）

| 项 | 结论 |
|---|---|
| 它的许可 | **MIT** ⇒ 可 adopt、可复用代码 |
| 它收语法的条件 | `CONTRIBUTING.md` 明写：**只收宽松许可（MIT/Apache/BSD/ISC），GPL/AGPL/LGPL/MPL 不收** ⇒ **不会传染** |
| ★ 可借鉴的机制 | 「一份清单（repo+rev+extensions+abi+generate 开关）」= 我们该学的形状 |
| 不可搬运的代码 | 无（MIT）；但**产物**是二进制，只按平台取用，不必进我们仓 |

## 六、结论与动作（**不是只有"用/不用"**）

**⛔ 不做**：fork 400 个仓、自建"重制版"、批量提 400 个 PR。
理由：L1（语言清单）与 L2（分发/按需下载/缓存）**都已被它做完**，而且它有 372 门 × 11 种绑定的维护流水线。
我们自建 ⇒ **一定更差**（我们没有那份每周跟语法的 CI，也没有 662KB 的许可台账）。

**✅ 做**（按价值排序）：
1. **改用它那份清单当我们的"名册"** —— 免费得到 372 门 + rev + extensions + ambiguous + abi 的升级版。
   我们手工攒的那份（`.inspect/parsers_full.json`）立刻降级为"历史存档"。
2. **采纳障碍只有一个**（本笔实测）：本机 `win32-x64` 上它的原生模块**加载失败**
   （`The specified module could not be found` = 缺 DLL 依赖）。**先修这个**再谈 adopt。
3. ★ **真正属于我们、且对所有人有用的那一格**：它那份 372 门的清单**没人逐个验过"真能编出来/真能载入"**
   （正像我们最初 440 门里只有 55 条验过）。**用我们的 `grammar_shim` 流水线去逐门验它**，
   产出一份「上游清单质量报告」 —— 那才是**只有我们能做**、也**值得提 PR/issue** 的东西
   （而不是 400 个绑定 PR）。

## 七、未核实清单（不许当结论用）

- `@xberg-io/...` 与它的关系**未核实**（只说"描述近乎同源"，没有读源码/README 的一手证据）。
- 它 372 门里**每门是否真能编、真能载入**：**未验**（这正是 §6.3 要做的）。
- 它的 `rev` 是否都是**可取的**（有些仓可能已删/改名）：**未验**。
- 我们 adopt 之后与现有 `ts_kernel`（node-tree-sitter 0.21 的 `Parser` API）**兼容性**：
  **未验** —— 它自带 Rust core，API 是 `getParser()`/`process()`，**不一定能拿出一个能喂给
  `node-tree-sitter` 的 Language 对象**。这是 adopt 前必须先答的问题。


---

# 附：**双上游**方案与实测（2026-10-08，同日）

用户的裁定：*「我们做双上游 —— 把它拉下来，再把原上游的没定死的拉下来，做同样的整理。」*
⇒ 这不是"再造一座房子"，而是**补它没覆盖的那一格**（先例检索说的"造格子"）。

## 一、两份上游，各是什么角色

| 上游 | 是什么 | 我们拿它什么 |
|---|---|---|
| **kreuzberg**（372 门，MIT） | **已整理好的**：每门带 `repo` + `rev` + `extensions` + `abi` + `generate` 开关 + `ambiguous` | **直接当基座**（它的 rev 我们不必重做） |
| **官方 wiki `List-of-parsers`**（440 门） | 官方清单（我们最早抓的那份） | 它的**差集** = 我们补整理的那一格 |

## 二、合并结果（`vendor/grammars/roster.merged.json`，实测）

**合并名册 491 门**：

| | 门数 |
|---|---|
| 两边都有 | **321** |
| 只有 kreuzberg | **51**（它收的、官方没收的新语言：`less mojo nushell cython …`） |
| **只有官方**（= 要我们补的） | **119** |

## 三、「只有官方」那 119 门，按**同样规格**整理的成绩

| 项 | 实测 |
|---|---|
| 本地已有克隆可核 | **118 / 119**（只差 `rec` —— 死链，仓库已不存在） |
| **钉到 rev** | **118** |
| **读到 ABI** | **109** |
| ↳ 其中 ABI 13/14（**用我们的 `grammar_shim` 可直接编**） | **61** |
| ↳ 其中需 `tree-sitter generate` 重生成 | **48** |
| 有克隆但**没有 `parser.c`**（对应 wiki 的 `abi=-`） | 10 |

★ 补整理**全程离线**（用早先已克隆的本地仓），只有 42 个例外是联网补拉的（成功 41）。

## 四、缺口的性质（都要如实记账）

- **死链**：`amaanq/tree-sitter-rec` 不存在（wiki 有链接 ≠ 仓还在）
- **无 `parser.c`**：10 门（上游没提交生成物）⇒ 要 `tree-sitter generate`，或视作"只有语法定义"
- **ABI 出界**：48 门（15 太新 / ≤12 太老）⇒ 同样要 `generate`

## 五、可复跑

```bash
npm run roster:merge     # 合并两份上游 -> vendor/grammars/roster.merged.json（离线，用本地克隆补 rev/ABI）
npm run roster:diff      # 官方 440 − 它 372：差集与两侧独有（口径声明见输出）
```
★ 判据口径：**「名字对不上」是实测事实；「真的没有」是更强的话，未逐门验**
（一部分可能是别名/子语法，如 `asciidoc_inline`、`ocaml_type`、`php_only`）。
