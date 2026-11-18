# TAILSCALE · 设计册托管网络自服务指南（无密钥入库——密钥类走 QQ/当面）

> 服务于 T-#SHEET-HOST：设计册托管机 = lead 常驻机；其他机器远程写路径走 Tailscale 私网。

## 新机器接入四步

1. 安装：`winget install Tailscale.Tailscale`（或官网下载 MSI）
2. 登录：`tailscale login`（或系统托盘图标）⇒ 浏览器认证——**必须用与托管机相同的账号**（一个 tailnet = 一个账号的机器群）；登录 URL 是一次性的，由执行机现场生成、QQ 传送给能开浏览器的人
3. 验证：`tailscale ip`（得 100.x.x.x）· `tailscale status`（应能看到托管机）
4. 写端连接：`http://<托管机 100.x IP>:<端口>`（端口号与**共享 token** 在引擎 HTTP 端口卡落地时由 lead 经 QQ 发放）

## 安全边界

- tailnet 内才可达；写端另加 token；两层互相独立
- 登录 URL 一次性且会过期——不入库不截图留存
- 共享 token 轮换机制：泄露时 lead 本地翻转即可，不影响其他层
