# 本仓语言注册表 · 名册与状态（2026-10-08 实测）

> 判据：**每门语言单独起一个子进程**，`import` 该语言的包 → `setLanguage` → `parse`。
> **不是**"装了没有"，也**不是** registry 元数据 —— 是**真加载**。
> ★ 为什么一门一进程：同进程连加载 40+ 个原生模块会让进程**无声猝死**（实测），单独跑却正常。
> 复跑：`.inspect/roster_isolated.mjs`。**这不是门、不设棘轮**，是某一天的事实快照。

## 总账：55 条 → **31 条真能用**

| 档 | 条数 | 含义 |
|---|---|---|
| **A** | 31 | ✅ 真能用（真 import + setLanguage + parse 通过） |
| **B** | 7 | ❌ 装了但载入失败 |
| **C** | 10 | · npm 上有包、本机没装 |
| **D** | 4 | ★ 无可用 npm 包，但**本机有语法源码** |
| **E** | 2 | ？既没有可用 npm 包，也没有本机源码 |
| **X** | 1 | ⚠ 进程异常（判不出） |

★ 上游清单是 **440 个解析器条目**（见 `tree-sitter-parsers-census.md`）——本仓只登记 55 条，
  **"上游有多少"和"我们能用多少"是两个数**。

## ✅ 真能用（真 import + setLanguage + parse 通过）（31）

> 本仓**现在就能解析**这些后缀。★ 标「自建」的是用**通用 N-API 绑定**从语法源码在本机编出来的。

| 语言 | 包 / 说明 |
|---|---|
| `bash` | `tree-sitter-bash` |
| `c` | `tree-sitter-c` |
| `c_sharp` | `tree-sitter-c-sharp` |
| `cpp` | `tree-sitter-cpp` |
| `crystal` | `agent-io-grammar-crystal` **自建**（通用 N-API 绑定） |
| `css` | `tree-sitter-css` |
| `elixir` | `tree-sitter-elixir` |
| `fish` | `agent-io-grammar-fish` **自建**（通用 N-API 绑定） |
| `go` | `tree-sitter-go` |
| `groovy` | `tree-sitter-groovy` |
| `haskell` | `tree-sitter-haskell` |
| `html` | `tree-sitter-html` |
| `java` | `tree-sitter-java` |
| `javascript` | `tree-sitter-javascript` |
| `json` | `tree-sitter-json` |
| `jsx` | `tree-sitter-javascript` |
| `julia` | `tree-sitter-julia` |
| `kotlin` | `tree-sitter-kotlin` |
| `php` | `tree-sitter-php` |
| `python` | `tree-sitter-python` |
| `r` | `agent-io-grammar-r` **自建**（通用 N-API 绑定） |
| `ruby` | `tree-sitter-ruby` |
| `rust` | `tree-sitter-rust` |
| `scala` | `tree-sitter-scala` |
| `scss` | `tree-sitter-scss` |
| `solidity` | `tree-sitter-solidity` |
| `toml` | `agent-io-grammar-toml` **自建**（通用 N-API 绑定） |
| `tsx` | `tree-sitter-typescript` |
| `typescript` | `tree-sitter-typescript` |
| `vhdl` | `agent-io-grammar-vhdl` **自建**（通用 N-API 绑定） |
| `vue` | `agent-io-grammar-vue` **自建**（通用 N-API 绑定） |

## ❌ 装了但载入失败（7）

> 上游是 NAN 绑定，或本机没有可用 prebuild / 现场编译失败。

| 语言 | 包 / 说明 |
|---|---|
| `cue` | `tree-sitter-cue` —— BAD Invalid language object |
| `dart` | `tree-sitter-dart` —— BAD Invalid language object |
| `markdown` | `tree-sitter-markdown` —— BAD Invalid language object |
| `sql` | `tree-sitter-sql` —— BAD Invalid language object |
| `swift` | `tree-sitter-swift` —— BAD No native build was found for platform=win32 arch=x64 ru |
| `yaml` | `tree-sitter-yaml` —— BAD Invalid language object |
| `zig` | `tree-sitter-zig` —— BAD Invalid language object |

## · npm 上有包、本机没装（10）

> 可以装（装前先 `install-package check <lang>` 看 peer 与模板）。

| 语言 | 包 / 说明 |
|---|---|
| `clojure` | `tree-sitter-clojure` |
| `fsharp` | `tree-sitter-fsharp` |
| `graphql` | `tree-sitter-graphql` |
| `latex` | `tree-sitter-latex` |
| `ocaml` | `tree-sitter-ocaml` |
| `perl` | `tree-sitter-perl` |
| `powershell` | `tree-sitter-powershell` |
| `scheme` | `tree-sitter-scheme` |
| `verilog` | `tree-sitter-verilog` |
| `xml` | `tree-sitter-xml` |

## ★ 无可用 npm 包，但**本机有语法源码**（4）

> 可用通用 N-API 绑定自建（ABI 必须 13/14）。

| 语言 | 包 / 说明 |
|---|---|
| `erlang` | `（无）` |
| `nim` | `（无）` |
| `rego` | `（无）` |
| `tcl` | `（无）` |

## ？既没有可用 npm 包，也没有本机源码（2）

> 要么去上游找仓，要么自己开发。

| 语言 | 包 / 说明 |
|---|---|
| `less` | `（无）` |
| `protobuf` | `（无）` |

## ⚠ 进程异常（判不出）（1）

> 多半是**量具/环境**问题，不是这门语言的问题 —— 单独复跑确认。

| 语言 | 包 / 说明 |
|---|---|
| `lua` | `agent-io-grammar-lua` |

