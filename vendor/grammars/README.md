# vendor/grammars —— 自建的 tree-sitter 语言包

这些包**不是**从 npm 装的，是用**通用 N-API 绑定**从**语法源码**在本机编出来的：
很多上游语言包用的是 NAN 绑定（核心 0.21 只认 N-API）⇒ 装了也载入不了；
但它们的 `src/parser.c` 是好的 ⇒ 补一层 ~20 行的 N-API 绑定就能被核心接受。

**为什么放在仓里**：实测过一次教训 —— 只把包放进 `node_modules`（**不声明**）时，
下一次 `npm install` 会**把它们全清掉**。所以放进仓 + 用 `file:` 声明进 `optionalDependencies`。

⚠ **平台限制**：这里的 `.node` 是**本机编译产物**（当前：win32-x64 / node 22）。
换平台要重建：`.inspect/make_shim.mjs`（或 `scripts/make_grammar_shim.mjs`）。

判据（必须满足其一才不会白编）：语法 `src/parser.c` 的 `#define LANGUAGE_VERSION` **∈ {13,14}**
（对齐核心 0.21 的 `MIN_COMPATIBLE=13` / `LANGUAGE_VERSION=14`）。
