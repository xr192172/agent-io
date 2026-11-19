# GUIDE-USAGE.md — 安装、使用与安全边界

## 1. 安装

```bash
git clone https://github.com/xr192172/agent-io.git
cd agent-io
npm install
npm run build
npm run env:check
```

`env:check` 查本机工具链（node/git/jdk/mvn/go、PATH、路径形态、数据根、残留锁）；`doctor` 查目标项目是否就绪。两者不互换。

## 2. 接入 MCP 宿主

任何支持 MCP 的 Agent 都可接入；工具描述以 `ToolDef.description` 为准，工具数不写在文档里。

```json
{
  "mcpServers": {
    "agent-io": {
      "command": "node",
      "args": ["/path/to/agent-io/dist/src/presentation/mcp/server.js"],
      "env": { "AGENT_IO_HOME": "/path/to/data-dir" }
    }
  }
}
```

首次熟悉可用 `AGENT_IO_FIRST_RUN=1`：任务闸与画布闸只点名不拦；每次回执都会提示，且真实损坏类闸（owner、租约、前置依赖）照拦。熟悉后取消。

## 3. 最短使用路径

```text
import_project → get_dsl → design_line → edit_dsl → edit_code → design_line judge → complete
```

| 步骤 | 目的 |
|---|---|
| `import_project {project_dir, feature}` | 建索引与事实侧，不改源码 |
| `get_dsl {feature, query:'files'}` | 看文件、符号家底 |
| `get_dsl {feature, query:'node', node_id:...}` | 下钻某节点的设计与判据 |
| `design_line action=diff|report|compile|judge` | 看差异、读设计、编译契约、真跑判据 |
| `edit_dsl {type:'task', op:...}` | 立卡、领卡、收口、重开 |
| `edit_code` / `rename_symbols` / `rename_files` | 过写闸改源码 |
| `ledger` | 挂账、批注、销账、裁定、取代、读队列 |

CLI 入参三形态不可混用：`k=v`、`--json '{...}'`、`--input file.json`。查单个工具 schema 用 `cli.js <tool> --schema`。

## 4. 典型流程

### 改一个函数

```text
edit_dsl 写 decision/判据 → design_line action=plan（apply:true）
→ edit_dsl claim → edit_code → design_line action=judge
→ design_line action=plan（sync_status:true）→ edit_dsl complete
```

### 改已完成卡的判据

```text
edit_dsl reopen → 改 decision → edit_dsl publish(data.reason)
```

重开后没有新证据或真正换判据，不能收口。

### 任务出口别混

- `done`：干完了，判据全过且有证据。
- `release`：放回去，活还在，别人能领。
- `void`：不做了，理由必填；可 `relaunch` 重新立卡。

不要用 `void` 收尾。

### 台账

```text
ledger hang → ledger annotate/verdict → ledger close
```

`annotate` 只追加事件，不改 state；`close` 才翻转状态；`reopen` 留痕回 active；`supersede` 是关系，不是状态。

## 5. 写闸与直写边界

- 写闸只装在本仓写工具上：`edit_code` / `rename_symbols` / `rename_files` / `move_symbol` / `apply_refactor_plan`。
- 普通编辑器、shell、脚本直写绕过写闸；只能事后被巡检/对账发现。
- 新文件先入设计节点，再写盘；否则会留下不可回滚的无卡写账。
- `decision.update` 的 `expectations` 是整块替换；只改一条时优先用元素级操作，避免静默吞判据。

## 6. Tailscale 与远程安全边界

### 远程续聊当前 DSH 会话

可用 Tailscale 的安全代理把当前 DSH Web GUI 的回环地址发布为仅 tailnet 可访问的 HTTPS 入口，例如 `tailscale serve --bg http://127.0.0.1:<DSH 本地端口>`。另一台机器加入同一 tailnet 后，用该入口和 DSH 原有访问凭据打开同一个会话。Tailscale 只提供网络，不替代 DSH 认证；访问 URL 与令牌属于凭据，不写入仓库。

### AgentIO 设计册远程写端（尚未启用）

目标是让设计册托管机常驻一处，其他机器经 tailnet 访问同一写端，避免多份权威副本。当前这只是计划，不是已交付能力：

1. 远程写端必须另有共享 token 鉴权；tailnet 可达本身不是授权。
2. 在鉴权与远程验收完成前，不要把 AgentIO HTTP 写端绑定到非回环地址，也不要用公网域名或端口转发暴露它。
3. Tailscale 登录 URL 一次性且会过期；登录 URL、共享 token 和配对链接都不入库、不写入交接文档。

当前不做 DSH 专属插件；通用宿主无关层未成立前，不把任何远端 UI 当第二真相源。
