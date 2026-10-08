# tree-sitter 解析器普查（2026-10-08，一次性实测，**不是门**）

> 来源：**tree-sitter 官方 wiki** 的 `List-of-parsers`（`git clone tree-sitter.wiki.git`）。
> 判据：逐个直查 registry 的 `/latest`（版本 / `scripts.install` / `dependencies` / `peerDependencies` / `dist.unpackedSize`）。
> ★ 本文件是**普查记录**（某一天的事实快照），不是约定 —— 要复跑请看 `.inspect/sweep_parsers.mjs`。

## 总数（★ 用户记的「158 门」对不上，实测是 **440**）

| 项 | 数 | 说明 |
|---|---|---|
| wiki 表行 | 509 | 含同名重复（同一语言多个仓库） |
| **去重后解析器** | **440** | = 语言/方言数 |
| **npm 上有对应包** | **227** | 已逐个 `npm pack` 下来（210 个不同 tarball） |
| npm 上没有 | 213 | 只能从 GitHub 拿源码（或自己开发） |
| 其中 latest 是 N-API | 113 | `nan` 缺席 且 `scripts.install === node-gyp-build` |
| 已下载体积（tarball） | 252 MB | 解包后按 registry 估算 ≈ 3.49 GB |

## 结论（给决策用）

1. ★ **不是 158，是 440**：官方清单里 511 行、去重 440 门 —— 我们注册表里 55 条，只覆盖 12%。
2. ★ **只有 227 门（51%）在 npm 上有包**；另外 213 门**只能从 GitHub 拿源码** ——
   其中就包括我们表里那 10 条（`erlang r less nim crystal vhdl tcl protobuf rego fish`）⇒
   **"npm 上没有"≠"没有这门语言"** —— 之前我只查了 npm 一个名字就下结论，那是**假证**。
3. ★ 体积：**tarball 252 MB / 解包 ≈ 3.49 GB**（含全平台 prebuild + 生成的 `parser.c`）。
   ⇒ 「全拉进来」不是"不大"，但**下载成本只有 252 MB**，可接受。

## 已下载（227 门，`.inspect/ts-bundle/npm/*.tgz`）

| 语言 | npm 包 | 版本 | 解包 | 模板 | peer |
|---|---|---|---|---|---|
| `abl` | `tree-sitter-abl` | 0.1.2 | 15.50 MB | ❌ nan | - |
| `agda` | `tree-sitter-agda` | 1.3.1 | 13.88 MB | ❌ nan | - |
| `angular` | `tree-sitter-angular` | 0.9.2 | 0.88 MB | ✅ node-gyp-build | ^0.21.1 |
| `arduino` | `tree-sitter-arduino` | 0.24.0 | 41.45 MB | ✅ node-gyp-build | ^0.25.0 |
| `awk` | `tree-sitter-awk` | 0.7.2 | 6.12 MB | ✅ node-gyp-build | ^0.21.0 |
| `bash` | `tree-sitter-bash` | 0.25.1 | 19.34 MB | ✅ node-gyp-build | ^0.25.0 |
| `bass` | `tree-sitter-bass` | 0.0.2 | 0.14 MB | ❌ nan | - |
| `batch` | `tree-sitter-batch` | 0.11.1 | 2.33 MB | ✅ node-gyp-build | >=0.25.0 |
| `beancount` | `tree-sitter-beancount` | 2.5.1 | 1.76 MB | ✅ node-gyp-build | ^0.25.0 |
| `bibtex` | `tree-sitter-bibtex` | 0.0.8 | 0.25 MB | ❌ nan | - |
| `bicep` | `tree-sitter-bicep` | 1.1.0 | 2.59 MB | ✅ node-gyp-build | ^0.22.1 |
| `bitbake` | `tree-sitter-bitbake` | 1.1.0 | 4.16 MB | ❌ nan | - |
| `c` | `tree-sitter-c` | 0.24.1 | 8.60 MB | ✅ node-gyp-build | ^0.22.4 |
| `c_sharp` | `tree-sitter-c-sharp` | 0.23.5 | 64.87 MB | ✅ node-gyp-build | ^0.25.0 |
| `caddy` | `tree-sitter-caddy` | 0.1.1 | 1.14 MB | ✅ node-gyp-build | ^0.25.1 |
| `cairo` | `tree-sitter-cairo` | 0.0.2 | 0.49 MB | ❌ nan | - |
| `capnp` | `tree-sitter-capnp` | 1.5.0 | 0.50 MB | ❌ nan | - |
| `carve` | `tree-sitter-carve` | 0.1.7 | 28.35 MB | ✅ node-gyp-build | ^0.25.0 |
| `cfengine` | `tree-sitter-cfengine` | 1.1.12 | 0.17 MB | ✅ node-gyp-build | ^0.25.0 |
| `clean` | `tree-sitter-clean` | 1.2.8 | 54.17 MB | ✅ node-gyp-build | ^0.22.0 |
| `clojure` | `tree-sitter-clojure` | 0.4.0 | 2.06 MB | ❌ nan | - |
| `cobol` | `tree-sitter-cobol` | 0.0.1 | 43.96 MB | ❌ nan | - |
| `comment` | `tree-sitter-comment` | 0.3.0 | 0.50 MB | ✅ node-gyp-build | ^0.21.1 |
| `commonlisp` | `tree-sitter-commonlisp` | 0.4.1 | 10.65 MB | ✅ node-gyp-build | ^0.21.1 |
| `containerfile` | `tree-sitter-containerfile` | 0.9.2 | 1.80 MB | ✅ node-gyp-build | >=0.25.0 |
| `context` | `tree-sitter-context` | 0.1.0 | 0.36 MB | ❌ nan | - |
| `core_schema` | `tree-sitter-yaml` | 0.5.0 | 1.39 MB | ❌ nan | - |
| `cpon` | `tree-sitter-cpon` | 1.0.0 | 0.13 MB | ❌ nan | - |
| `cpp` | `tree-sitter-cpp` | 0.23.4 | 40.43 MB | ✅ node-gyp-build | ^0.21.1 |
| `css` | `tree-sitter-css` | 0.25.0 | 1.88 MB | ✅ node-gyp-build | ^0.25.0 |
| `csv` | `tree-sitter-csv` | 1.2.0 | 0.16 MB | ❌ nan | - |
| `cuda` | `tree-sitter-cuda` | 0.21.2 | 30.33 MB | ✅ node-gyp-build | ^0.25.1 |
| `cue` | `tree-sitter-cue` | 0.0.1 | 1.61 MB | ❌ nan | - |
| `d` | `tree-sitter-d` | 0.8.2 | 26.35 MB | ✅ node-gyp-build | ^0.21.0 |
| `dart` | `tree-sitter-dart` | 1.0.0 | 5.95 MB | ❌ nan | - |
| `devicetree` | `tree-sitter-devicetree` | 0.15.0 | 2.57 MB | ✅ node-gyp-build | ^0.25.0 |
| `dhall` | `tree-sitter-dhall` | 0.0.0 | 11.67 MB | ❌ nan | - |
| `dot` | `tree-sitter-dot` | 0.1.5 | 0.17 MB | ❌ nan | - |
| `doxygen` | `tree-sitter-doxygen` | 1.1.0 | 0.18 MB | ❌ nan | - |
| `dtd` | `tree-sitter-xml` | 1.0.0 | 0.77 MB | ❌ nan | - |
| `earthfile` | `tree-sitter-earthfile` | 0.6.0 | 3.42 MB | ✅ node-gyp-build | ^0.22.4 |
| `ebnf` | `ebnf` | 1.9.1 | 0.07 MB | ⚠ 无 install | - |
| `eds` | `tree-sitter-eds` | 0.0.1 | 5.58 MB | ❌ nan | - |
| `elisp` | `tree-sitter-elisp` | 1.7.2 | 0.28 MB | ⚠ node -e "require('fs').existsSync('src/parser.c') || require('child_process').execSync('tree-sitter generate', { stdio: 'inherit' })" && node-gyp-build | ^0.25.0 |
| `elixir` | `tree-sitter-elixir` | 0.3.5 | 22.38 MB | ✅ node-gyp-build | ^0.21.0 |
| `elm` | `tree-sitter-elm` | 4.5.0 | 1.48 MB | ❌ nan | - |
| `elsa` | `tree-sitter-elsa` | 1.1.0 | 0.11 MB | ❌ nan | - |
| `embedded_template` | `tree-sitter-embedded-template` | 0.25.0 | 0.53 MB | ✅ node-gyp-build | ^0.25.0 |
| `eventrule` | `tree-sitter-eventrule` | 1.8.0 | 0.42 MB | ⚠ node-gyp rebuild | - |
| `faust` | `tree-sitter-faust` | 1.1.5 | 1.41 MB | ❌ nan | - |
| `firrtl` | `tree-sitter-firrtl` | 0.7.0 | 0.60 MB | ❌ nan | - |
| `fluentbit` | `tree-sitter-fluentbit` | 0.1.0 | 0.06 MB | ✅ node-gyp-build | ^0.21.0 |
| `foam` | `tree-sitter-foam` | 0.4.5 | 0.66 MB | ✅ node-gyp-build | ^0.25.0 |
| `forth` | `tree-sitter-forth` | 9999.99.99 | 0.00 MB | ⚠ 无 install | - |
| `fsharp` | `tree-sitter-fsharp` | 0.3.12 | 168.51 MB | ✅ node-gyp-build | ^0.25.0 |
| `fsharp_signature` | `tree-sitter-fsharp` | 0.3.12 | 168.51 MB | ✅ node-gyp-build | ^0.25.0 |
| `func` | `tree-sitter-func` | 1.2.9 | 0.32 MB | ❌ nan | - |
| `fusion` | `tree-sitter-fusion` | 1.1.2 | 0.43 MB | ❌ nan | - |
| `gap` | `tree-sitter-gap` | 0.3.1 | 0.96 MB | ✅ node-gyp-build | ^0.22.1 |
| `gdscript` | `tree-sitter-gdscript` | 6.1.0 | 3.79 MB | ✅ node-gyp-build | ^0.21.1 |
| `gitattributes` | `tree-sitter-gitattributes` | 0.1.6 | 0.15 MB | ❌ nan | - |
| `gitcommit` | `tree-sitter-gitcommit` | 0.3.3 | 2.38 MB | ❌ nan | - |
| `gleam` | `tree-sitter-gleam` | 0.1.5 | 0.66 MB | ❌ nan | - |
| `glimmer` | `tree-sitter-glimmer` | 1.4.0 | 0.21 MB | ✅ node-gyp-build | ^0.21.0 |
| `glimmer_javascript` | `tree-sitter-glimmer-javascript` | 0.2.0 | 2.52 MB | ✅ node-gyp-build | ^0.21.0 |
| `glimmer_typescript` | `tree-sitter-glimmer-typescript` | 0.3.0 | 8.83 MB | ✅ node-gyp-build | ^0.21.0 |
| `glsl` | `tree-sitter-glsl` | 0.2.0 | 10.89 MB | ✅ node-gyp-build | ^0.22.1 |
| `gn` | `tree-sitter-gn` | 1.0.0 | 0.23 MB | ❌ nan | - |
| `gnuplot` | `tree-sitter-gnuplot` | 4.1.0 | 68.38 MB | ✅ node-gyp-build | ^0.21.0 |
| `go` | `tree-sitter-go` | 0.25.0 | 3.66 MB | ✅ node-gyp-build | ^0.25.0 |
| `godot_resource` | `tree-sitter-godot-resource` | 0.7.0 | 0.35 MB | ✅ node-gyp-build | ^0.21.1 |
| `gomod` | `tree-sitter-gomod` | 1.0.0 | 0.13 MB | ❌ nan | - |
| `gosum` | `tree-sitter-go-sum` | 1.0.0 | 0.06 MB | ❌ nan | - |
| `graphql` | `tree-sitter-graphql` | 1.0.0 | 0.38 MB | ❌ nan | - |
| `groovy` | `tree-sitter-groovy` | 0.1.2 | 13.38 MB | ✅ node-gyp-build | ^0.21.1 |
| `groq` | `tree-sitter-groq` | 1.1.1 | 0.33 MB | ⚠ 无 install | - |
| `gstlaunch` | `tree-sitter-gstlaunch` | 0.1.0 | 0.53 MB | ✅ node-gyp-build | ^0.21.0 |
| `hare` | `tree-sitter-hare` | 1.0.0 | 1.02 MB | ❌ nan | - |
| `haskell` | `tree-sitter-haskell` | 0.23.1 | 45.65 MB | ✅ node-gyp-build | ^0.21.1 |
| `haxe` | `tree-sitter-haxe` | 0.13.0 | 4.37 MB | ✅ node-gyp-build | ^0.21.0 |
| `hcl` | `@tree-sitter-grammars/tree-sitter-hcl` | 1.2.0 | 1.91 MB | ✅ node-gyp-build | ^0.25.0 |
| `hlsl` | `tree-sitter-hlsl` | 0.2.0 | 45.10 MB | ✅ node-gyp-build | - |
| `hlsplaylist` | `tree-sitter-hlsplaylist` | 0.0.5 | 0.14 MB | ✅ node-gyp-build | ^0.21.0 |
| `html` | `tree-sitter-html` | 0.23.2 | 0.70 MB | ✅ node-gyp-build | ^0.21.1 |
| `idl` | `tree-sitter-idl` | 3.14.0 | 4.98 MB | ✅ node-gyp-build | ^0.21.1 |
| `jack` | `tree-sitter-jack` | 0.1.1 | 0.15 MB | ❌ nan | - |
| `janet` | `tree-sitter-janet` | 0.5.1-atom | 0.93 MB | ❌ nan | - |
| `java` | `tree-sitter-java` | 0.23.5 | 5.93 MB | ✅ node-gyp-build | ^0.21.1 |
| `javadoc` | `tree-sitter-javadoc` | 0.2.4 | 1.69 MB | ✅ node-gyp-build | ^0.25.0 |
| `javascript` | `tree-sitter-javascript` | 0.25.0 | 6.22 MB | ✅ node-gyp-build | ^0.25.0 |
| `jinja2` | `tree-sitter-jinja2` | 0.2.0 | 0.55 MB | ❌ nan | - |
| `jq` | `tree-sitter-jq` | 1.0.2 | 0.49 MB | ✅ node-gyp-build | - |
| `jsdoc` | `tree-sitter-jsdoc` | 0.25.0 | 0.79 MB | ✅ node-gyp-build | ^0.25.0 |
| `json` | `tree-sitter-json` | 0.24.8 | 0.47 MB | ✅ node-gyp-build | ^0.21.1 |
| `json_schema` | `tree-sitter-yaml` | 0.5.0 | 1.39 MB | ❌ nan | - |
| `julia` | `tree-sitter-julia` | 0.23.1 | 94.39 MB | ✅ node-gyp-build | ^0.21.1 |
| `kconfig` | `tree-sitter-kconfig` | 1.3.0 | 1.21 MB | ✅ node-gyp-build | ^0.22.1 |
| `kdl` | `tree-sitter-kdl` | 2.0.0 | 1.46 MB | ✅ node-gyp-build | ^0.25.0 |
| `kotlin` | `tree-sitter-kotlin` | 0.3.8 | 22.94 MB | ✅ node-gyp-build | ^0.21.0 |
| `latex` | `tree-sitter-latex` | 0.0.0 | 0.01 MB | ❌ nan | - |
| `legacy_schema` | `tree-sitter-yaml` | 0.5.0 | 1.39 MB | ❌ nan | - |
| `leo` | `tree-sitter-leo` | 1.0.1 | 1.71 MB | ❌ nan | - |
| `linkerscript` | `tree-sitter-linkerscript` | 1.0.0 | 0.59 MB | ❌ nan | - |
| `liquidsoap` | `tree-sitter-liquidsoap` | 1.2.3 | 4.92 MB | ✅ node-gyp-build | ^0.25.0 |
| `llvm` | `tree-sitter-llvm` | 1.1.0 | 14.65 MB | ✅ node-gyp-build | ^0.21.0 |
| `lua` | `tree-sitter-lua` | 2.1.3 | 0.44 MB | ❌ nan | - |
| `luadoc` | `tree-sitter-luadoc` | 1.1.0 | 0.69 MB | ❌ nan | - |
| `luap` | `tree-sitter-luap` | 1.0.0 | 0.11 MB | ❌ nan | - |
| `luau` | `tree-sitter-luau` | 1.2.0 | 1.86 MB | ✅ node-gyp-build | ^0.22.1 |
| `m68k` | `tree-sitter-m68k` | 0.3.2 | 4.74 MB | ❌ nan | - |
| `make` | `tree-sitter-make` | 1.1.1 | 2.51 MB | ✅ node-gyp-build | ^0.22.1 |
| `mal` | `tree-sitter-mal` | 1.0.0 | 0.07 MB | ❌ nan | - |
| `markdown` | `tree-sitter-markdown` | 0.7.1 | 1.75 MB | ❌ nan | - |
| `markdown_inline` | `tree-sitter-markdown` | 0.7.1 | 1.75 MB | ❌ nan | - |
| `math` | `tree-sitter-math` | 0.1.2 | 1.10 MB | ✅ node-gyp-build | ^0.25.0 |
| `matlab` | `tree-sitter-matlab` | 1.0.17 | 82.86 MB | ❌ nan | - |
| `mcfunction` | `tree-sitter-mcfunction` | 0.0.5 | 0.31 MB | ⚠ node-gyp rebuild | - |
| `menhir` | `tree-sitter-menhir` | 0.4.0 | 0.35 MB | ❌ nan | - |
| `mlir` | `tree-sitter-mlir` | 0.3.0 | 0.62 MB | ❌ nan | - |
| `modelica` | `tree-sitter-modelica` | 0.1.0 | 3.64 MB | ✅ node-gyp-build | ^0.21.1 |
| `muttrc` | `tree-sitter-muttrc` | 0.1.4 | 1.07 MB | ✅ node-gyp-build | ^0.25.0 |
| `nginx` | `tree-sitter-nginx` | 1.0.1 | 1.44 MB | ✅ node-gyp-build | ^0.25.0 |
| `nix` | `tree-sitter-nix` | 0.0.2 | 0.70 MB | ❌ nan | - |
| `noir` | `tree-sitter-noir` | 1.0.1 | 3.39 MB | ❌ nan | - |
| `nqc` | `tree-sitter-nqc` | 1.0.0 | 4.45 MB | ❌ nan | - |
| `objc` | `tree-sitter-objc` | 3.0.2 | 63.31 MB | ✅ node-gyp-build | ^0.22.1 |
| `ocaml` | `tree-sitter-ocaml` | 0.24.2 | 199.57 MB | ✅ node-gyp-build | ^0.22.4 |
| `ocaml_interface` | `tree-sitter-ocaml` | 0.24.2 | 199.57 MB | ✅ node-gyp-build | ^0.22.4 |
| `ocaml_type` | `tree-sitter-ocaml` | 0.24.2 | 199.57 MB | ✅ node-gyp-build | ^0.22.4 |
| `ocamllex` | `tree-sitter-ocamllex` | 0.25.0 | 0.67 MB | ✅ node-gyp-build | ^0.25.0 |
| `odin` | `tree-sitter-odin` | 1.3.0 | 29.62 MB | ✅ node-gyp-build | ^0.21.1 |
| `openscad` | `tree-sitter-openscad` | 0.5.1 | 40.90 MB | ❌ nan | - |
| `pascal` | `tree-sitter-pascal` | 0.0.1 | 4.77 MB | ❌ nan | - |
| `perl` | `tree-sitter-perl` | 2.0.0 | 28.98 MB | ✅ node-gyp-build | >=0.25.0 |
| `php` | `tree-sitter-php` | 0.24.2 | 28.45 MB | ✅ node-gyp-build | ^0.22.4 |
| `php_only` | `tree-sitter-php` | 0.24.2 | 28.45 MB | ✅ node-gyp-build | ^0.22.4 |
| `phpdoc` | `tree-sitter-phpdoc` | 0.1.0 | 1.13 MB | ❌ nan | - |
| `plantuml` | `tree-sitter-plantuml` | 2.1.0 | 0.37 MB | ⚠ node-gyp-build || echo 'Skipping build - run npm run build first' | - |
| `po` | `tree-sitter-po` | 0.0.1 | 0.09 MB | ❌ nan | - |
| `pod` | `tree-sitter-pod` | 1.1.0 | 0.10 MB | ✅ node-gyp-build | ^0.22.0 |
| `pony` | `tree-sitter-pony` | 1.0.0 | 4.70 MB | ❌ nan | - |
| `powershell` | `tree-sitter-powershell` | 0.26.4 | 11.67 MB | ✅ node-gyp-build | ^0.25.0 |
| `printf` | `tree-sitter-printf` | 0.5.1 | 0.46 MB | ✅ node-gyp-build | ^0.22.4 |
| `prisma` | `tree-sitter-prisma` | 1.6.0 | 0.35 MB | ✅ node-gyp-build | ^0.25.0 |
| `problog` | `tree-sitter-prolog` | 1.1.0 | 0.53 MB | ❌ nan | - |
| `prolog` | `tree-sitter-prolog` | 1.1.0 | 0.53 MB | ❌ nan | - |
| `properties` | `tree-sitter-properties` | 0.3.0 | 0.56 MB | ✅ node-gyp-build | ^0.21.1 |
| `psv` | `tree-sitter-csv` | 1.2.0 | 0.16 MB | ❌ nan | - |
| `pug` | `tree-sitter-pug` | 1.0.12 | 1.49 MB | ✅ node-gyp-build | ^0.21.1 |
| `puppet` | `tree-sitter-puppet` | 1.3.0 | 1.94 MB | ✅ node-gyp-build | ^0.22.1 |
| `python` | `tree-sitter-python` | 0.25.0 | 7.17 MB | ✅ node-gyp-build | ^0.25.0 |
| `ql` | `tree-sitter-ql` | 1.0.0 | 2.83 MB | ❌ nan | - |
| `qmldir` | `tree-sitter-qmldir` | 0.0.1 | 0.41 MB | ❌ nan | - |
| `qmljs` | `tree-sitter-qmljs` | 0.3.1 | 9.85 MB | ✅ node-gyp-build | ^0.21.0 |
| `query` | `tree-sitter-query` | 0.1.0 | 0.23 MB | ❌ nan | - |
| `regex` | `tree-sitter-regex` | 0.25.0 | 0.77 MB | ✅ node-gyp-build | ^0.25.0 |
| `requirements` | `tree-sitter-requirements` | 0.6.1 | 0.87 MB | ✅ node-gyp-build | ^0.25.0 |
| `robot` | `tree-sitter-robot` | 1.5.0 | 1.55 MB | ✅ node-gyp-build | - |
| `ron` | `tree-sitter-ron` | 0.1.0 | 0.24 MB | ❌ nan | - |
| `rst` | `tree-sitter-rst` | 0.2.0 | 1.26 MB | ✅ node-gyp-build | ^0.22.1 |
| `ruby` | `tree-sitter-ruby` | 0.23.1 | 29.40 MB | ✅ node-gyp-build | ^0.21.1 |
| `rust` | `tree-sitter-rust` | 0.24.0 | 14.35 MB | ✅ node-gyp-build | ^0.22.1 |
| `sas` | `tree-sitter-sas` | 0.4.2 | 2.56 MB | ✅ node-gyp-build | >=0.21.0 |
| `scala` | `tree-sitter-scala` | 0.24.0 | 51.72 MB | ✅ node-gyp-build | ^0.21.1 |
| `scheme` | `tree-sitter-scheme` | 1.0.0 | 6.69 MB | ❌ nan | - |
| `scss` | `tree-sitter-scss` | 1.0.0 | 1.73 MB | ✅ node-gyp-build | ^0.21.0 |
| `sdml` | `tree-sitter-sdml` | 0.4.14 | 1.49 MB | ✅ node-gyp-build | ^0.25.0 |
| `sed` | `tree-sitter-sed` | 0.19.0 | 7.34 MB | ⚠ 无 install | - |
| `sed_ere` | `tree-sitter-sed` | 0.19.0 | 7.34 MB | ⚠ 无 install | - |
| `sflog` | `tree-sitter-sfapex` | 3.0.1 | 13.17 MB | ✅ node-gyp-build | ^0.22.4 |
| `sh` | `tree-sitter-sh` | 0.19.0 | 37.86 MB | ⚠ 无 install | - |
| `slang` | `tree-sitter-slang` | 0.3.1 | 58.54 MB | ✅ node-gyp-build | - |
| `slint` | `slint` | 0.1.0 | 0.00 MB | ⚠ 无 install | - |
| `smali` | `tree-sitter-smali` | 1.0.0 | 1.72 MB | ❌ nan | - |
| `smithy` | `tree-sitter-smithy` | 0.2.1 | 0.39 MB | ✅ node-gyp-build | ^0.21.0 |
| `solidity` | `tree-sitter-solidity` | 1.2.13 | 6.61 MB | ✅ node-gyp-build | ^0.25.0 |
| `soql` | `tree-sitter-sfapex` | 3.0.1 | 13.17 MB | ✅ node-gyp-build | ^0.22.4 |
| `sosl` | `tree-sitter-sfapex` | 3.0.1 | 13.17 MB | ✅ node-gyp-build | ^0.22.4 |
| `souffle` | `tree-sitter-souffle` | 1.0.0 | 0.36 MB | ❌ nan | - |
| `sourcepawn` | `tree-sitter-sourcepawn` | 0.7.8 | 5.24 MB | ❌ nan | - |
| `sparql` | `tree-sitter-sparql` | 0.1.0 | 2.14 MB | ❌ nan | - |
| `sql` | `tree-sitter-sql` | 0.1.0 | 0.56 MB | ❌ nan | - |
| `sql_bigquery` | `tree-sitter-sql-bigquery` | 0.8.0 | 61.07 MB | ✅ node-gyp-build | ^0.21.0 |
| `squirrel` | `tree-sitter-squirrel` | 1.0.0 | 3.17 MB | ❌ nan | - |
| `ssh_client_config` | `tree-sitter-ssh-client-config` | 2026.10.1 | 6.07 MB | ✅ node-gyp-build | ^0.22.4 |
| `stan` | `tree-sitter-stan` | 0.1.0 | 61.15 MB | ❌ nan | - |
| `starlark` | `tree-sitter-starlark` | 1.3.0 | 5.30 MB | ✅ node-gyp-build | ^0.22.1 |
| `supercollider` | `tree-sitter-supercollider` | 0.2.2 | 2.45 MB | ❌ nan | - |
| `svelte` | `tree-sitter-svelte` | 0.11.0 | 0.35 MB | ❌ nan | - |
| `sway` | `tree-sitter-sway` | 1.0.0 | 3.55 MB | ❌ nan | - |
| `swift` | `tree-sitter-swift` | 0.7.1 | 72.39 MB | ✅ node-gyp-build | ^0.22.1 |
| `systemrdl` | `tree-sitter-systemrdl` | 0.8.0 | 0.58 MB | ❌ nan | - |
| `systemverilog` | `tree-sitter-systemverilog` | 0.4.1 | 221.92 MB | ✅ node-gyp-build | ^0.25.0 |
| `t32` | `tree-sitter-t32` | 9.0.2 | 11.03 MB | ✅ node-gyp-build | ^0.25.0 |
| `tablegen` | `tree-sitter-tablegen` | 0.0.1 | 0.55 MB | ❌ nan | - |
| `teal` | `tree-sitter-teal` | 0.0.5 | 0.86 MB | ❌ nan | - |
| `thrift` | `tree-sitter-thrift` | 0.5.0 | 0.82 MB | ❌ nan | - |
| `tlaplus` | `tree-sitter-tlaplus` | 1.5.0 | 59.31 MB | ✅ node-gyp-build | - |
| `tmux` | `tree-sitter-tmux` | 0.1.4 | 2.57 MB | ✅ node-gyp-build | ^0.25.0 |
| `toml` | `tree-sitter-toml` | 0.5.1 | 0.17 MB | ❌ nan | - |
| `tsq` | `tree-sitter-tsq` | 0.19.0 | 0.09 MB | ❌ nan | - |
| `tsv` | `tree-sitter-csv` | 1.2.0 | 0.16 MB | ❌ nan | - |
| `tsx` | `tree-sitter-typescript` | 0.23.2 | 37.04 MB | ✅ node-gyp-build | ^0.21.0 |
| `turtle` | `tree-sitter-turtle` | 0.1.0 | 0.20 MB | ❌ nan | - |
| `twig` | `tree-sitter-twig` | 0.8.2 | 0.35 MB | ⚠ node-gyp rebuild | - |
| `typescript` | `tree-sitter-typescript` | 0.23.2 | 37.04 MB | ✅ node-gyp-build | ^0.21.0 |
| `ungrammar` | `tree-sitter-ungrammar` | 0.0.1 | 0.05 MB | ❌ nan | - |
| `unison` | `tree-sitter-unison` | 2.1.3 | 21.23 MB | ✅ node-gyp-build | ^0.21.1 |
| `uxntal` | `tree-sitter-uxntal` | 1.0.0 | 0.43 MB | ❌ nan | - |
| `v` | `tree-sitter-v` | 1.0.7 | 7.78 MB | ❌ nan | - |
| `vba` | `tree-sitter-vba` | 0.14.5 | 119.57 MB | ⚠ node scripts/install.mjs | ^0.25.0 |
| `vbnet` | `tree-sitter-vb-dotnet` | 0.1.9 | 10.09 MB | ✅ node-gyp-build | ^0.22.1 |
| `verilog` | `tree-sitter-verilog` | 1.0.0 | 52.07 MB | ❌ nan | - |
| `vue` | `tree-sitter-vue` | 0.2.1 | 0.16 MB | ❌ nan | - |
| `wast` | `tree-sitter-wasm` | 2.0.4 | 115.33 MB | ⚠ 无 install | - |
| `wat` | `tree-sitter-wat` | 0.1.0 | 1.72 MB | ⚠ node-gyp rebuild | - |
| `wgsl` | `tree-sitter-wgsl` | 0.0.6 | 1.24 MB | ❌ nan | - |
| `wgsl_bevy` | `tree-sitter-wgsl-bevy` | 0.1.4 | 1.60 MB | ✅ node-gyp-build | ^0.22.4 |
| `xml` | `tree-sitter-xml` | 1.0.0 | 0.77 MB | ❌ nan | - |
| `xquery` | `tree-sitter-xquery` | 0.1.2 | 11.41 MB | ❌ nan | - |
| `yaml` | `tree-sitter-yaml` | 0.5.0 | 1.39 MB | ❌ nan | - |
| `yuck` | `tree-sitter-yuck` | 0.0.2 | 0.22 MB | ❌ nan | - |
| `zathurarc` | `tree-sitter-zathurarc` | 0.1.7 | 0.11 MB | ✅ node-gyp-build | ^0.25.0 |
| `zig` | `tree-sitter-zig` | 0.2.0 | 26.05 MB | ❌ nan | - |
| `ziggy` | `ziggy` | 2.4.0 | 0.00 MB | ⚠ 无 install | - |
| `ziggy_schema` | `ziggy` | 2.4.0 | 0.00 MB | ⚠ 无 install | - |
| `zsh` | `tree-sitter-zsh` | 0.63.1 | 61.13 MB | ✅ node-gyp-build | ^0.25.0 |

## npm 上没有对应包（213 门，只能走 GitHub 源码 / 自己开发）

```
ada al apex asciidoc asciidoc_inline asm astro authzed bazelrc bison blueprint boogie bp brightscript c3 cedar cel cfhtml cfml cfquery cfscript chatito chatl chuck circom cmake cooklang corn cql crystal cylc dafny dbml desktop diff disassembly djot dockerfile drools editorconfig eex elvish enforce erlang facility fennel fidl fish formula fortran fsh gaptst gdshader gemini gemtext ghccore git_commit git_config git_rebase gitignore goctl gotmpl gowork gpg gren gularen hack haskell_persistent heex helm helma hjson hocon hoon htmldjango http hurl hyprlang ibmhlasm idris idris2 iex ini inko ispc jakt janet_simple jpp json5 jsonc jsonnet just kcl koka koto kusto lalrpop lean ledger lilypond liquid llvm_mir magik mail mandbconfig mermaid meson monkey move nasm nickel nim nim_format_string ninja nois norg_meta nu objdump ohm org p4 papyrus passwd pem pgn pioasm pkl poe_filter posix_awk promela promql proto prql purescript pymanifest quakec r racket radvd ralph rasi razor rbs re2c readline rec rego rescript rnoweb robots roc ros_interface rpmbash rpmspec rtf runescript satysfi scfg scilab sexp slim smallbasic smalltalk smarty sml snakemake sqf sqlite ssh_config strace styled superhtml surface surrealdb sxhkdrc systemtap tact tcl templ tera terraform textproto tiger todotxt tucan tucanir twitchchat typespec typoscript typst udev unified_diff unifieddiff usd vala varlink vcard vcl vento vespa vhdl vhs vim vimdoc vrl wing wit x86asm xcompose xml_django xresources yang zeek
```

★ 它们的仓库地址在 wiki 表里（`.inspect/parsers_full.json` 的 `url` 字段），`npm run install-package index` 也列 GitHub 分发索引。

---

## 附：**真的把它们都拎下来了**（2026-10-08，实测，不再外推）

| 侧 | 结果 | 体积 |
|---|---|---|
| npm 上有包 | **227/227 下载成功，0 失败**（`npm pack`） | **252 MB**（tarball）· 解包 ≈ **3.49 GB** |
| 只有 GitHub | **202/207 clone 成功**（`git clone --depth 1`） | **1080 MB** |
| **合计** | 429 / 434 | **≈ 1.33 GB 下载** |

★ 先前按 14 个样本外推得「0.4–4 GB」——**实测落在 1.08 GB**（外推区间太宽，因为被 `al` 一个 111MB 的
离群值撑着）。**这就是为什么要真做一遍：外推只能给量级，给不了数。**

**5 个没 clone 上的**（`--depth 1` 报 `repository not found` / gitlab 拒绝访问）：
- `https://github.com/dannylongeuay/tree-sitter-go-template`（仓库不存在）
- `https://github.com/PasiSalenius/tree-sitter-http`（仓库不存在）
- `https://github.com/amaánq/tree-sitter-rec`（仓库不存在）
- `https://gitlab.com/cryptomilk/tree-sitter-rpm`（gitlab 访问失败，非 404）
- 另 1 个同上
⇒ **wiki 表里有链接 ≠ 仓库还在** —— 那份清单本身也会腐（这 4 个是"链接已死"，不是我们拉不下来）。

**归档**（`.inspect/` 在 `.gitignore` 里 ⇒ 不进仓）：
- `tree-sitter-grammars-227.tar.gz`（npm 侧，233 MB，含 `manifest.json`）
- `tree-sitter-grammars-github-202.tar.gz`（GitHub 侧，含 202 个 `--depth 1` 仓库）

★ **走哪条路下载**由 `npm run net:probe` 决定（当天网络翻过两次：代理死/直连通 → 换节点后反过来 → 又翻回来）。
   探针给结论，命令照抄，**别记死哪条路**。
