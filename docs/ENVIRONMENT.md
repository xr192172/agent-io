# 开发环境守则（ENVIRONMENT）

> **这份文档的读者是"人"和"接手的模型"**：换机器、重装系统、接手别人电脑时，按它做，不要靠猜。
> **唯一体检入口**：`npm run env:check`（= `node scripts/env-check.mjs`；一条命令、一张表、每条带修法；退出码 0/1/2 三态）。
>
> **两个体检的分工（别混）**：
> - `npm run env:check` —— **本机开发工具链**：node/git/jdk/mvn/go、PATH、路径形态、数据根可写、残留锁。
> - `npm run doctor`（`scripts/setup.mjs --doctor`）—— **目标项目就绪度**：skills 安装、MCP 配置、插桩/事件是否就绪。
>
> 立档原因：2026-11-16 一次**硬盘/系统重装**之后，D 盘上的程序全在（node/git/jdk/maven/go 都在
> `D:\Program Files\*`），但 **PATH 是空的**——于是 `npm` 不可用、Go 两门 SKIP、更坏的是
> `node scripts/verify.mjs` 因为**软链路径身份不一致而静默 exit 0**（假绿）。这份守则是那次事故的产物。

---

## 一、仓的"身份"：路径与软链

| 概念 | 值（本机） | 说明 |
|---|---|---|
| 仓根（真实） | `D:\Projects\ai\agentio\dev\agent-io` | **物理路径**；`import.meta.url` 解析出来的就是它 |
| 便利入口（软链） | `D:\agentio` → `D:\Projects\ai\agentio` | junction；`D:\agentio\dev\agent-io` 也是软链形态 |
| 册（设计册） | `.agent-io/design/*.dsl.json` | 本仓 3 册：`agent-io` / `agent-io-toolface` / `task-system-plan` |
| 数据根 | `.agent-io/`（项目内）· 注册表 `projects.json` | 写账 / 基线 / 快照 / 锁都落这里 |

### 硬规则

1. **两种路径形态都合法，但"是不是同一处"只准用物理路径判** —— 唯一实现
   `scripts/lib/path_identity.mjs#pathIdentity / samePath`（realpath 归一 + 正斜杠 + 小写）。
   **不许**在自己脚本里手抄 `path.resolve(a) === path.resolve(b)`：软链下它恒 false。
   > 反例（真实事故）：`verify.mjs` / `audit-script-tiers.mjs` / `mutate.mjs` 的入口守卫、
   > `judge-all.mjs` 的册身份守卫，都曾因为字面比较而**静默不动 / 假红**。
2. **一次会话里固定用同一个形态工作**（推荐直接 `cd D:\Projects\ai\agentio\dev\agent-io`）。
   混用会让"报错里的路径"和"你 cd 的路径"对不上，读日志时多一层心算。
3. **别在软链目录里建第二个 git / 第二个 `.agent-io`**：软链是指向，不是副本。

---

## 二、工具清单（必需 / 可选）

| 工具 | 本机实测版本 | 路径 | 必需性 | 用来干什么 |
|---|---|---|---|---|
| **node** | v22.18.0 | `D:\Program Files\nodejs` | **必需**（>=22.5：`node:sqlite`） | 跑一切（引擎、脚本、测试） |
| **npm** | 10.9.3 | 随 node 同目录 | **必需** | `npm run build` / `verify` / `ci` |
| **git** | 2.45.2.windows.1 | `D:\Program Files\Git\cmd` | **必需** | 变更集（内环靠它读 diff）、提交、回滚 |
| **JDK** | 17.0.12 | `D:\Program Files\Java\jdk-17` | 可选（Java 卡必需） | Java 夹具 / MyBatis 契约 |
| **Maven** | 3.9.9 | `D:\Program Files\maven\apache-maven-3.9.9-bin\apache-maven-3.9.9` | 可选（Java 卡必需） | Java 测试对象（surefire） |
| **Go** | 1.26.4 | `D:\Program Files\Go\bin` | 可选（Go 两门必需） | 「Go 编译」「Go 静态检查」两门 |
| Python | **无**（只有 Store 存根） | — | 可选 | 仅 `scripts/*.py` 辅助脚本用；`npm run verify` 不依赖它 |

### 需要设置的环境变量（**用户级**，本次已持久化）

```powershell
# PATH（用户级，顺序无关；四个目录都要在）
D:\Program Files\nodejs
D:\Program Files\Git\cmd
D:\Program Files\Java\jdk-17\bin
D:\Program Files\maven\apache-maven-3.9.9-bin\apache-maven-3.9.9\bin
D:\Program Files\Go\bin

JAVA_HOME = D:\Program Files\Java\jdk-17
GOROOT    = D:\Program Files\Go          # 可选（go 能从自身位置推断，显式更稳）
```

> ★ **持久化 ≠ 本会话生效**：DSH/终端宿主进程在启动时就把环境快照下来了。
> 改完用户环境变量后，**当前会话仍需在命令行里手工前缀 PATH**，新开的会话才会自动带上。
> 这就是"明明设了 PATH，还是说找不到 npm"的原因。

---

## 三、换机器 / 重装系统：从零到能跑

```powershell
# 0) 体检（第一步永远是它——它告诉你缺什么、怎么修）
node scripts/env-check.mjs

# 1) 装工具（缺什么装什么；本机都在 D:\Program Files\*）
#    node 22 LTS / Git / JDK 17 / Maven / Go
#    装完设用户级 PATH + JAVA_HOME（见上）

# 2) 拿代码（二选一）
git clone ssh://git@ssh.github.com:443/xr192172/agent-io.git D:\Projects\ai\agentio\dev\agent-io
#   或从离线备份恢复（桌面 agentio.7z）：解到目标目录后再做第 4 步校验

# 3) 装依赖 + 构建
cd D:\Projects\ai\agentio\dev\agent-io
npm ci
npm run build

# 4) 确认身份与数据（换机器最容易烂的一环）
node scripts/env-check.mjs          # 看「设计册 N 册」「数据根可写」「重活锁」
node scripts/verify.mjs             # 全量（门表以它自己打印的为准；必须看到门表，不只是退出码）

# 5) 提交前再体检一次（避免"环境问题"混进 diff）
node scripts/env-check.mjs
```

### git 远端与认证（换机器后必做）

远端：`ssh://git@ssh.github.com:443/xr192172/agent-io.git`（**443 端口**，不是 22——过防火墙用）

- 本机实测：`git ls-remote origin` ⇒ **`Host key verification failed` / `Could not read from remote`**
  原因是重装后 `%USERPROFILE%\.ssh` 整个没了（连 `known_hosts` 都没有）。
- **修法（二选一）**：
  - SSH：`ssh-keygen -t ed25519 -C "<你的标识>"` → 把 `~/.ssh/id_ed25519.pub` 加到 GitHub →
    `ssh -T -p 443 git@ssh.github.com` 见到 "successfully authenticated" 才算通；
  - HTTPS + token：`git remote set-url origin https://<token>@github.com/xr192172/agent-io.git`。
- ★ **认证没通不影响本地开发**（提交能落本地），但**拉不到/推不上**——体检里 `git 远端` 只到 WARN，
  因为"远端暂时不通"不等于"环境坏了"。**能推的时候要尽早推**（见第六节）。

---

## 四、日常命令（别记错入口）

| 你要做什么 | 命令 | 说明 |
|---|---|---|
| 环境体检 | `node scripts/env-check.mjs` | 一条命令，带修法 |
| **开发内环**（默认） | `npm run verify:changed` | 只验本次改动及其影响闭包（秒级~分钟级） |
| **全量验收** | `npm run verify` | 跑全部门（门清单 = `scripts/verify.mjs#GATES`，实测十余分钟）；只在 §三.B 五种情形用 |
| 判据全量 | `node scripts/judge-all.mjs` | 三册 816 条；改册后跑它，**不是**全量 |
| 构建 | `npm run build` | dist 必须新于 src（否则门用旧产物判） |
| 测试 | `npm test` | 130 文件 / 768 用例 |
| 插桩观测 | `npm run observe:collect -- <命令>` | 引擎侧观测入口 |

★ **顺序纪律**：改 `src/` ⇒ `npm run build` ⇒ 再跑门。门的读数是"按 dist 判的"。

---

## 五、故障速查（都来自真实事故）

| 症状 | 真因 | 修法 |
|---|---|---|
| `npm 不是内部或外部命令` | PATH 没配 / 本会话环境是旧快照 | 前缀 PATH；或新开会话 |
| `node scripts/verify.mjs` **不打印就 exit 0** | 入口守卫字面比较 + 软链 ⇒ `main()` 没执行 | 已修：统一走 `path_identity.mjs`。复现则查该文件 |
| 判据门「册不重合 ⇒ 不算数」 | 同上（册身份守卫字面比较） | 已修：`judge-all.mjs` 用 `samePath` |
| `Go 编译 / Go 静态检查` SKIP | Go 不在 PATH | PATH 加 `<Go>\bin` |
| 门假红「已有重活在跑」 | `heavy.lock` 残留（持有进程已死） | 体检会点名 pid；确认已死后删锁 |
| `Unexpected token '﻿'` / `不是合法 JSON` | PowerShell 写文件带 BOM | 用 `[IO.File]::WriteAllText(path, text, UTF8Encoding($false))` |
| `--json '{...}'` 报"入参不是合法 JSON" | PowerShell 吃引号 | 写 JSON 到文件 + `--input <文件>` |
| `spawn EPERM`（子进程/管道） | 沙箱/ACL 限制 | 见 skill `diagnose-windows-sandbox-acl`；或改用文件重定向 |
| 夹具测试报 `mvn 不在 PATH` | Maven/JAVA_HOME 缺 | 见第二节 |

---

## 六、备份与恢复（血泪条）

- **离线备份**：桌面 `agentio.7z`（≈2.0 GB，含 `.agent-io/` 数据与 `node_modules`）。
- **恢复后必须核对的三件事**（少一件就会出现"看起来在跑，其实在骗你"）：
  1. `git log -1` 与记忆/远端对得上（本次：`0ad36b56`）；
  2. `git status` 干净（或差异你认得）；
  3. `node scripts/env-check.mjs` 与 `node scripts/verify.mjs` **都真的打印出表/门**。
- **推远端的纪律**：本仓 commit 数已 2435+；**本地提交不等于备份**。
  远端能连时就推（`git push origin main`），连不上时至少有 7z。
- ★ **`.agent-io/` 是活的**（cache.db 100+ MB、baseline、verified-snapshot、写账）：
  它**不进 git**（见 .gitignore），所以"恢复"必须包含它——只 clone 代码会得到"没有判据证据的空壳"。

---

## 七、禁止事项

1. **不许**为了"让门变绿"改 PATH/版本/环境变量口径（环境问题要修环境，不是修门）。
2. **不许**并行跑 `verify` / `judge-all` / `mutate`（它们共用 `heavy.lock` 与 dist）。
3. **不许**在软链形态与真实形态之间来回切换着跑门（一次会话固定一种）。
4. **不许**把 `.agent-io/`、`dist/`、`node_modules/` 提交进 git（已在 .gitignore）。
5. **不许**在认证没通时假设"备份已完成"——本地提交不是备份。
