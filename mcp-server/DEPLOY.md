# 公网 / 域名部署（供企微智能机器人插件调用）

企微要求插件 URL **必须是公网可达的 HTTPS 域名**，不支持 `localhost` / 内网 IP。
本服务当前在本地 `127.0.0.1:3100`，需要经由「域名 + 公网 IP + 反向代理 + SSL」暴露出去。

> 插件 URL 最终形态：`https://mcp.你的域名.com/sse`

---

## 方案 A：自有服务器 + 域名（推荐，长期稳定）

适用于你有一台带公网 IP 的服务器（云主机 / 本机有公网 IP 并做端口映射），且拥有域名。

### 1. 部署 mcp-server 到该服务器
```bash
# 把 mcp-server 目录传上去后
cd mcp-server
cp .env.example .env          # 确认 AGENT_API_BASE 指向可达的 production_agent 地址
npm install
npm run build
# 用 pm2 / systemd / nssm 守护（见文末）
```

### 2. 域名解析
在 DNS 后台添加 A 记录：`mcp.你的域名.com` → 服务器公网 IP。

### 3. Nginx 反向代理（支持 SSE 长连接 + HTTPS）
`/etc/nginx/sites-available/mcp.yourdomain.com`：

```nginx
server {
    listen 443 ssl;
    server_name mcp.你的域名.com;

    ssl_certificate     /etc/letsencrypt/live/mcp.你的域名.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mcp.你的域名.com/privkey.pem;

    # SSE 长连接：务必调大超时，否则流式响应会被 nginx 截断
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding on;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # 透传企微注入的 userid 头（如有）
        proxy_set_header X-WeCom-Userid $http_x_wecom_userid;
    }
}
```

申请证书：
```bash
sudo certbot --nginx -d mcp.你的域名.com
sudo nginx -t && sudo systemctl reload nginx
```

### 4. 企微插件填
- 插件 URL：`https://mcp.你的域名.com/sse`
- 授权方式：`Service token / API key` → 位置 `Parameter name` → 参数名 `api_key` → 值 `prod-mcp-2026`
- 传输协议：`SSE`

---

## 方案 B：Cloudflare Tunnel（无需公网 IP / 服务器，最快拿到公网域名）

适合「服务在本机跑，想立刻给企微一个公网 HTTPS 地址测试」。

```bash
# 1) 安装 cloudflared（Windows 用 scoop/winget，或官网下载）
# 2) 一键临时隧道，把本机 3100 暴露成公网 HTTPS 域名：
cloudflared tunnel --url http://localhost:3100
# 终端会输出类似：https://xxxx.trycloudflare.com  ← 这就是你的插件 URL 前缀
```

- 临时域名每次重启会变；企微填 `https://xxxx.trycloudflare.com/sse`。
- 想要固定自定义域名：登录 Cloudflare，添加站点并把 `mcp.你的域名.com` 的 CNAME 指向隧道，用命名隧道（`cloudflared tunnel create` + `cloudflared tunnel route dns`）。

> 同样可用 ngrok：`ngrok http 3100`（需注册拿 authtoken），得到 `https://xxxx.ngrok-free.app`。

---

## 守护进程（让服务持续运行）

- **Linux (systemd)**：见 `deploy/mcp-server.service`，`systemctl enable --now mcp-server`
- **Windows (nssm)**：`nssm install mcp-server "node" "D:\...\mcp-server\dist\index.js"`
- **通用 (pm2)**：`pm2 start dist/index.js --name mcp-server`

---

## 排错
- 企微连不上：确认 443 端口放通、证书有效、Nginx 反代 `/sse` 与 `/messages` 都可访问。
- `401`：企微填的 `api_key` 与服务器 `.env` 的 `MCP_API_KEY` 不一致。
- userid 一直 `anonymous`：插件 URL 必须是**企业域名**（方案 A/B 满足），且确认企微实际注入的头名，必要时改 `.env` 的 `USERID_HEADER`。
- 流式被截断：Nginx 的 `proxy_read_timeout` / `proxy_buffering` 已按上面配置即可。
