# 本仓语言注册表 · 名册与状态（2026-10-08 实测）

> 判据：逐条 `import` 该语言的包 → `new Parser().setLanguage(lang)` → `parse("a")`。
> **不是**"装了没有"、也**不是** registry 元数据 —— 是**真加载**。
> 复跑：`.inspect/roster_status.mjs`（会重写 `.inspect/roster_status.json`）。
> ★ 这是**某一天的事实快照**，不是门、不设棘轮。

## 总账：55 条 → **25 条真能用**

| 档 | 条数 | 含义 |
|---|---|---|
| **A** | 25 | ✅ 真能用（真 import + setLanguage + parse 通过） |
| **B** | 9 | ❌ 装了但载入失败（上游是 NAN 绑定，核心 0.21 只认 N-API） |
| **C** | 4 | · npm 上有、本机没装 |
| **D** | 8 | ★ 无 npm 包，但**有 GitHub 源码**（含 `src/parser.c`） |
| **E** | 9 | ？既没有可用 npm 包，也没有本地源码 |

★ 上游清单是 **440 个解析器条目**（见 `tree-sitter-parsers-census.md`）——本仓只登记 55 条，
  **"上游有多少"和"我们能用多少"是两个数**，别混。

## ✅ 真能用（真 import + setLanguage + parse 通过）（25）

> 本仓现在**就能解析**这些后缀。

| 语言 | 后缀 | 深适配 | 包 / 说明 |
|---|---|---|---|
| `bash` | `.sh .bash` |  | `tree-sitter-bash@0.25.1` |
| `c` | `.c .h` | ★ | `tree-sitter-c@0.24.1` |
| `c_sharp` | `.cs` | ★ | `tree-sitter-c-sharp@0.23.5` |
| `cpp` | `.cpp .cc .cxx .hpp .hh .hxx` | ★ | `tree-sitter-cpp@0.23.4` |
| `css` | `.css` |  | `tree-sitter-css@0.25.0` |
| `elixir` | `.ex .exs` |  | `tree-sitter-elixir@0.3.5` |
| `go` | `.go` | ★ | `tree-sitter-go@0.25.0` |
| `groovy` | `.groovy` | ★ | `tree-sitter-groovy@0.1.2` |
| `haskell` | `.hs` | ★ | `tree-sitter-haskell@0.23.1` |
| `html` | `.html .htm` |  | `tree-sitter-html@0.23.2` |
| `java` | `.java` | ★ | `tree-sitter-java@0.23.5` |
| `javascript` | `.js .mjs .cjs` | ★ | `tree-sitter-javascript@0.25.0` |
| `json` | `.json` |  | `tree-sitter-json@0.24.8` |
| `jsx` | `.jsx` | ★ | （已装，可用） |
| `julia` | `.jl` | ★ | `tree-sitter-julia@0.23.1` |
| `kotlin` | `.kt .kts` | ★ | `tree-sitter-kotlin@0.3.8` |
| `php` | `.php` | ★ | `tree-sitter-php@0.24.2` |
| `python` | `.py` | ★ | `tree-sitter-python@0.25.0` |
| `ruby` | `.rb` |  | `tree-sitter-ruby@0.23.1` |
| `rust` | `.rs` | ★ | `tree-sitter-rust@0.24.0` |
| `scala` | `.scala .sc` | ★ | `tree-sitter-scala@0.24.0` |
| `scss` | `.scss` |  | `tree-sitter-scss@1.0.0` |
| `solidity` | `.sol` |  | `tree-sitter-solidity@1.2.13` |
| `tsx` | `.tsx` | ★ | `tree-sitter-typescript@0.23.2` |
| `typescript` | `.ts .mts .cts` | ★ | `tree-sitter-typescript@0.23.2` |

## ❌ 装了但载入失败（上游是 NAN 绑定，核心 0.21 只认 N-API）（9）

> 这些是**坏账**：不是"没装"，是**装了也没用**。

| 语言 | 后缀 | 深适配 | 包 / 说明 |
|---|---|---|---|
| `cue` | `.cue` |  | `tree-sitter-cue`（NAN 绑定 ⇒ 载入失败） |
| `dart` | `.dart` |  | `tree-sitter-dart`（NAN 绑定 ⇒ 载入失败） |
| `lua` | `.lua` |  | `tree-sitter-lua`（NAN 绑定 ⇒ 载入失败） |
| `markdown` | `.md .markdown` |  | `tree-sitter-markdown`（NAN 绑定 ⇒ 载入失败） |
| `sql` | `.sql` |  | `tree-sitter-sql`（NAN 绑定 ⇒ 载入失败） |
| `toml` | `.toml` |  | `tree-sitter-toml`（NAN 绑定 ⇒ 载入失败） |
| `vue` | `.vue` |  | `tree-sitter-vue`（NAN 绑定 ⇒ 载入失败） |
| `yaml` | `.yaml .yml` |  | `tree-sitter-yaml`（NAN 绑定 ⇒ 载入失败） |
| `zig` | `.zig` |  | `tree-sitter-zig`（NAN 绑定 ⇒ 载入失败） |

## · npm 上有、本机没装（4）

> 可以直接装（装前先 `install-package check <lang>` 看 peer 与模板）。

| 语言 | 后缀 | 深适配 | 包 / 说明 |
|---|---|---|---|
| `fsharp` | `.fs .fsx` |  | `tree-sitter-fsharp`（可装） |
| `ocaml` | `.ml .mli` |  | `tree-sitter-ocaml`（可装） |
| `perl` | `.pl .pm` |  | `tree-sitter-perl`（可装） |
| `powershell` | `.ps1 .psm1` |  | `tree-sitter-powershell`（可装） |

## ★ 无 npm 包，但**有 GitHub 源码**（含 `src/parser.c`）（8）

> 可以自建（写一个通用 N-API 绑定 + 编 parser.c）。

| 语言 | 后缀 | 深适配 | 包 / 说明 |
|---|---|---|---|
| `crystal` | `.cr` |  | 源码 `.inspect/ts-bundle/gh/crystal` |
| `erlang` | `.erl .hrl` |  | 源码 `.inspect/ts-bundle/gh/erlang` |
| `fish` | `.fish` |  | 源码 `.inspect/ts-bundle/gh/fish` |
| `nim` | `.nim` |  | 源码 `.inspect/ts-bundle/gh/nim` |
| `r` | `.r .R` |  | 源码 `.inspect/ts-bundle/gh/r` |
| `rego` | `.rego` |  | 源码 `.inspect/ts-bundle/gh/rego` |
| `tcl` | `.tcl` |  | 源码 `.inspect/ts-bundle/gh/tcl` |
| `vhdl` | `.vhdl .vhd` |  | 源码 `.inspect/ts-bundle/gh/vhdl` |

## ？既没有可用 npm 包，也没有本地源码（9）

> 要么去上游找仓，要么自己开发。

| 语言 | 后缀 | 深适配 | 包 / 说明 |
|---|---|---|---|
| `clojure` | `.clj .cljs` |  | ERR: Cannot find module './build/Release/tree |
| `graphql` | `.graphql .gql` |  | ERR: Cannot find module './build/Release/tree |
| `latex` | `.tex` |  | ERR: Cannot find module './build/Release/tree |
| `less` | `.less` |  | n/a |
| `protobuf` | `.proto` |  | n/a |
| `scheme` | `.scm .ss` |  | ERR: Cannot find module './build/Release/tree |
| `swift` | `.swift` |  | ERR: No native build was found for platform=w |
| `verilog` | `.v .sv` |  | ERR: Cannot find module '../../build/Release/ |
| `xml` | `.xml` |  | ERR: Cannot find module './build/Release/tree |

