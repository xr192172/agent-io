# vendor/grammars —— 自建的 tree-sitter 语言包

这些包**不是**从 npm 装的，是用**通用 N-API 绑定**从**语法源码**在本机编出来的：
很多上游语言包用的是 NAN 绑定（核心 0.21 只认 N-API）⇒ 装了也载入不了；
但它们的 `src/parser.c` 是好的 ⇒ 补一层 ~20 行的 N-API 绑定就能被核心接受。

**为什么放在仓里**：实测过一次教训 —— 只把包放进 `node_modules`（**不声明**）时，
下一次 `npm install` 会**把它们全清掉**。所以放进仓 + 用 `file:` 声明进 `optionalDependencies`。

⚠ **平台限制**：这里的 `.node` 是**本机编译产物**（当前：win32-x64 / node 22）。
换平台要重建：`node scripts/grammar_shim.mjs build <lang>`（来源表见同目录 `SOURCES.json`）。

判据（必须满足其一才不会白编）：语法 `src/parser.c` 的 `#define LANGUAGE_VERSION` **∈ {13,14}**
（对齐核心 0.21 的 `MIN_COMPATIBLE=13` / `LANGUAGE_VERSION=14`）。

## 怎么重建（这是我们自己维护的那一层）

```bash
npm run grammar:list              # 看来源表：每门语言从哪取源（npm tarball / git 仓）+ 备注
npm run grammar:build -- fish     # 取源 → 生成绑定 → 编译 → **真加载验证**（一门一子进程）
npm run grammar:build-all         # 表里所有
```

**一份绑定模板**在 `scripts/grammar_shim.mjs` 里（只有那一处）：
把语法的 `tree_sitter_<lang>()` 指针包成 External、打上核心要的 `LANGUAGE_TYPE_TAG`。

★ 它**只认 ABI 13/14**（核心 0.21 的窗口）。低于 13（太老）或高于 14（太新）
⇒ 必须先 `tree-sitter generate` 重生成，本脚本帮不了 —— 它会**如实报出来**，不假装成功。

★★ 上游把"绑定"这层交给 400+ 个语言包各自维护（一半老化成 NAN）；
我们把它**收回来只写一份** ⇒ 上游将来把 ABI 从 14 推到 15 时，我们**只重编一次**，
而不是等 400 个包各自决定要不要迁移。

## 撤掉的（建得出来，但**不能发**）

| 语言 | 原因 |
|---|---|
| `erlang` `rego` `tcl` | parser.c 是 **ABI 15** > 核心的 14 ⇒ **载入必失败**。不能用就不声明。 |
| `lua` | parser.c 是 ABI 13、**单独跑 2ms 通过**；但**进程里已有别的原生模块时会把进程挂死**（实测：同进程第 3 个加载就挂；且重建后照旧 ⇒ 是语法侧的问题，不是构建残留）⇒ **撤下**。一个能把宿主弄挂的包，比一个"载入失败"的包更坏。 |

（文件都挪到 `.inspect/napi-unusable/` 留档，没删。）

## 在册的 8 个

`crystal` `fish` `ocaml` `r` `swift` `toml` `vhdl` `vue`

★ `ocaml` 用的是**实现**那份语法（`grammars/ocaml`，`.ml` 用）；包里的 interface 那份（`.mli`）**没用上**
—— 我们的表项只有一个 spec，**`.mli` 会解析不佳**（已知局限）。

## 来源是**钉住 revision** 的

`SOURCES.json` 里 git 来源的都带 `rev`（commit hash）—— 取源时按它 `fetch --depth 1` 再 checkout，
**取完当场校验 HEAD 必须等于钉的那个 hash**，不等就报错。
（不钉的话，"重建"只是"拉 default 分支最新"，哪天上游一动，重编出来就不是同一份东西了。）

npm 来源的按**版本号**钉（`from.pkg@from.version`），`rev` 记为 `null` —— 不许拿别的仓的 HEAD 冒充。

## ★ 我们自己的冻结副本（上游改了也不慌）

`vendor/grammars/sources/<lang>.tar.gz` —— 每门在册语法的**构建必需件冻结副本**（合计约 **2.8 MB**）。

里面只放**编译器真正会读到的**文件：`parser.c`、`scanner.*`、以及它们 `#include` 到的**本地**头
（含语法自带的 `src/tree_sitter/*.h`，以及像 `../common/scanner.h` 这种跨目录引用），
再加 `grammar.json` + `LICENSE`，外加一份 `PROVENANCE.json`
（repo / rev / ABI / 符号 / `grammarPath` / 每个文件的 sha256）。

★ **为什么只冻这 8 门**：全部 244 个仓的源码树 = **1433 MB**（仅 `parser.c` 就 812 MB），进仓不现实。
  清单里另外 483 门**继续用 rev 钉**；上游删仓才会痛，那时按需冻即可。

```bash
npm run grammar:freeze          # 重新冻结（按 include 闭包收集，不靠手写清单）
npm run grammar:verify-frozen   # ★ 验收：**只用冻结件**重建全部在册语法 + 真加载
```

### ★★ 这道验收不是形式 —— 它当场逼出三个真缺陷

1. 只冻 `parser.c` ⇒ 报 `cannot open include file 'tree_sitter/parser.h'`（**8/8 全挂**）
2. 补上运行时头之后，`vue`（引 `./tree_sitter_html/scanner.cc`）与 `ocaml`（引 `../../../common/scanner.h`）
   仍然失败 ⇒ **归档根必须取"能覆盖全部所需文件的最小公共目录"**，否则路径带 `..`，tar 直接拒绝
   （`Member name contains '..'`）⇒ 解都解不出来
3. `crystal` 用的是**尖括号**形式 `#include <tree_sitter/parser.h>` ⇒ 只跟引号形式会**漏掉头文件**

⇒ 所以冻结脚本**照 include 图走，不靠手写清单**；
而"这份副本到底能不能独立重建"由 `grammar:verify-frozen` **每次实跑**（当前 8/8 通过）。
