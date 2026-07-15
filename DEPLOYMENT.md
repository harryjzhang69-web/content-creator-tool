# 内容多面手 · 部署信息

## 线上地址
- 公网访问：https://pleased-membrane-peterson-programs.trycloudflare.com
- 健康检查：https://pleased-membrane-peterson-programs.trycloudflare.com/health

> ⚠️ 注意：2026-07-15 已从 localtunnel 切换到 **Cloudflare Tunnel（quick tunnel）**。
> 原因：localtunnel 打开时会有一个"点击继续"的确认页/IP提示页，陌生访客体验很差；
> Cloudflare quick tunnel 没有这个中间页，任何人点开链接直接进正式页面。
> 当前网络环境 UDP 出方向被拦截，quic 协议连不上 Cloudflare 边缘，已在 `start_lt.sh` 里强制加 `--protocol http2` 才连通。
> 副作用：quick tunnel 是免费临时隧道，没有 SLA 保证；每次 cloudflared 进程重启，网址会变化，
> 需要到 `/data/content-creator-tool/lt.log` 里查看最新地址（watchdog 脚本仍是 `start_lt.sh`，文件名沿用历史命名未改）。

## 架构（v2：文案/配图解耦，解决长请求断连）
- `POST /api/generate`：只做文案 + 配图方案（image prompts），单次 LLM 调用，约 15-20 秒返回
- `POST /api/image`：单张生图，`{prompt, size}` → `{url}`，约 9-13 秒/张
- 前端拿到文案立即渲染，再逐张异步调 `/api/image` 填充画廊，单张失败可点"重试"
- 好处：不再有 60-100 秒的单次长请求，每个请求都短，公网隧道稳定不断连
- 文案模型：GLM-4.7-Flash（`thinking.type=disabled` 关思考提速）；配图：智谱 CogView-3-Flash（账号专属配额，非全平台抢名额）


## 部署位置
- AnyDev 环境：`anybuildInstance-6k6tqsarg0io`（IP: 21.91.155.2）
- 代码路径：`/data/content-creator-tool/`
- 运行方式：tmux 会话
  - `content-tool`：Node 服务进程（`PORT=5001 node server.js`，日志见 `/data/content-creator-tool/server.log`）
  - `content-tool-lt`：localtunnel 公网映射（随机子域名，日志见 `/data/content-creator-tool/lt.log`）
  - `content-tool-watchdog`：看门狗（`start_lt.sh`，每30秒检查一次，进程挂了自动重启）
- Node 环境：nvm 下的 Node 18.20.8（`export NVM_DIR=/root/.nvm && . /root/.nvm/nvm.sh`）

## 查看当前最新公网地址
```bash
tail -5 /data/content-creator-tool/lt.log
# 找最后一行 "your url is: https://xxx.loca.lt"
```


## 待完成：CloudBase AI 密钥配置

服务端 `/api/generate` 需要调用 CloudBase AI（混元生图 + DeepSeek 文案生成），当前尚未配置密钥，请求会返回 `code: -3` 的提示。

需要在服务器上设置两个环境变量后重启进程：
```bash
export TCB_SECRET_ID="<your secretId>"
export TCB_SECRET_KEY="<your secretKey>"
```
获取方式：腾讯云控制台 → 访问管理(CAM) → API密钥管理 → 新建密钥
https://console.cloud.tencent.com/cam/capi

## 常用运维命令
```bash
# 查看服务日志
tmux attach -t content-tool   # Ctrl+B D 退出不中断

# 重启服务
tmux kill-session -t content-tool
tmux new-session -d -s content-tool "export NVM_DIR=/root/.nvm && . /root/.nvm/nvm.sh && cd /data/content-creator-tool && PORT=5001 TCB_SECRET_ID=xxx TCB_SECRET_KEY=xxx node server.js >> /data/content-creator-tool/server.log 2>&1"

# 更新代码后重新部署
# 本地打包 web/ + server.js + package.json 为 deploy.zip，通过 file_upload 上传到
# /data/content-creator-tool/deploy.zip，然后：
cd /data/content-creator-tool && unzip -o deploy.zip
export NVM_DIR=/root/.nvm && . /root/.nvm/nvm.sh && npm install
tmux kill-session -t content-tool
tmux new-session -d -s content-tool "..."
```
