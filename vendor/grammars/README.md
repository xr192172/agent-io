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
