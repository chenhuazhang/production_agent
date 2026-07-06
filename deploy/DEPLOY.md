# 中试 AI 助手 — 无头部署指南

## 架构总览

```
用户浏览器
    │  http://your-server:80
    ▼
┌─────────────────────────────┐
│  Nginx (:80)                │  ← 反代 + 安全头 + (未来 SSL)
│  /api/*  → agent:8000       │
│  /*      → web:3000         │
└──────────┬──────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
┌─────────┐  ┌──────────┐
│ Server  │  │  Web     │
│ :8000   │  │  :3000   │
│ Hono +  │  │ Next.js  │
│ pi-agent│  │ 前端     │
│ + SQL   │  │ + Prisma │
│ Server  │  │ SQLite   │
└─────────┘  └──────────┘
    │
    ▼
┌─────────────┐     ┌─────────────┐
│ SQL Server  │     │ DeepSeek    │
│ (内网ERP)   │     │ API (外部)  │
└─────────────┘     └─────────────┘
```

---

## 一、发布前检查清单

### 🔴 必须在部署前完成

| # | 检查项 | 操作 | 责任人 |
|---|--------|------|--------|
| 1 | **SQL 只读账号** | 联系 DBA 创建 `db_datareader` 账号，替换 sa | DBA |
| 2 | **ANON_USER 降级** | `server/src/routes/chat.ts:27` 将 `role: "supervisor"` 改为 `role: "sales"` | 后端 |
| 3 | **CORS 限制** | `server/src/index.ts:43` 将 `origin: "*"` 改为实际域名 | 后端 |
| 4 | **.env 不入库** | 确认 `.gitignore` 含 `.env`，所有密钥不提交 | 后端 |
| 5 | **Docker 密钥管理** | 密钥通过 `deploy/.env` 注入，不写入镜像 | DevOps |

### 🟡 建议在上线前完成

| # | 检查项 | 操作 |
|---|--------|------|
| 6 | Rate limiting | server 端添加 per-session 限流（20 req/min） |
| 7 | 错误消息净化 | 生产环境不返回 SQL 错误原文 |
| 8 | 日志持久化 | 确认 `agent-traces` volume 正常工作 |
| 9 | 磁盘空间 | 确保 `/var/lib/docker/volumes` 有充足空间（建议 ≥ 10GB） |

### ✅ 验证项（首次部署后检查）

| # | 验证项 | 命令 |
|---|--------|------|
| 10 | Server 健康检查 | `curl http://your-server:8000/health` |
| 11 | Nginx 代理正常 | `curl http://your-server/api/chat/test -X POST -H "Content-Type: application/json" -d '{"text":"你好"}'` |
| 12 | Web 前端可访问 | 浏览器打开 `http://your-server` |
| 13 | Session 持久化 | 创建会话 → 重启容器 → 会话历史仍存在 |

---

## 二、服务器要求

| 项目 | 最低配置 | 推荐配置 |
|------|---------|---------|
| OS | Linux (Ubuntu 22.04 / CentOS 8+) | Ubuntu 22.04 LTS |
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 40 GB SSD |
| 网络 | 可访问 SQL Server 内网 + 外网（LLM API） | 内网千兆 |
| Docker | 24.0+ | 最新稳定版 |
| Docker Compose | v2.20+ | 最新稳定版 |

---

## 三、部署步骤

### 3.1 在本地开发机：打包项目

```bash
# 1. 确保所有代码已提交（.env 和 node_modules 不入库）
cd d:/AIAgent/production_agent
git status

# 2. 打包源码（不含 node_modules / .env / .next / 构建产物）
git archive --format=tar.gz --output=production-agent.tar.gz HEAD

# 或者直接 git clone 到服务器（推荐）
```

### 3.2 在服务器上：首次部署

```bash
# 1. 登录服务器
ssh user@your-server-ip

# 2. 创建部署目录
mkdir -p /opt/production-agent
cd /opt/production-agent

# 3. 拉取代码（或 scp 上传 tar.gz 解压）
git clone https://github.com/chenhuazhang/production_agent.git .
# 或: scp production-agent.tar.gz user@server:/opt/production-agent/
#     tar -xzf production-agent.tar.gz

# 4. ⚠️ 关键：创建生产环境变量文件
cp deploy/.env.production deploy/.env
vim deploy/.env   # 填入真实的 API Key 和 SQL 密码
chmod 600 deploy/.env  # 锁定权限，仅 root 可读

# 5. 确认 .env 不会被提交
cat .gitignore | grep ".env"   # 应该看到 .env 和 .env*.local
```

### 3.3 构建并启动

```bash
# 6. 构建镜像
docker compose build

# 如果构建过程中 web 的 Prisma generate 报错：
#   确保 web/prisma/schema.prisma 文件存在
#   确保 web/package.json 中 prisma 在 dependencies 中

# 7. 启动所有服务（后台运行）
docker compose up -d

# 8. 查看启动日志
docker compose logs -f

# 9. 等待健康检查通过
docker compose ps
# 确认所有容器的 STATUS 都是 "healthy"
```

### 3.4 验证部署

```bash
# Health check
curl http://localhost:8000/health
# 应返回: {"status":"ok","service":"production-agent"}

# Web 可访问
curl -I http://localhost:3000
# 应返回: HTTP/1.1 200 OK

# 通过 Nginx 访问
curl -I http://localhost
# 应返回: HTTP/1.1 200 OK

# 测试 SSE 对话（发送一个简单请求）
curl -N http://localhost/api/chat/test-deploy \
  -H "Content-Type: application/json" \
  -d '{"text":"你好，请介绍一下你的功能"}'
# 应看到 SSE 流式输出: event: text_delta ... event: done
```

---

## 四、常用运维命令

```bash
# 查看所有容器状态
docker compose ps

# 查看日志（实时跟踪）
docker compose logs -f agent       # server 日志
docker compose logs -f web         # web 日志
docker compose logs -f nginx       # nginx 日志

# 查看最近 100 行日志
docker compose logs --tail=100 agent

# 重启某个服务
docker compose restart agent
docker compose restart web

# 重启全部
docker compose restart

# 停止全部
docker compose down

# 停止并清理 volumes（⚠️ 会丢失会话历史！）
docker compose down -v

# 更新代码后重新构建并部署
git pull
docker compose build          # 重新构建变更的镜像
docker compose up -d          # 滚动更新（停止旧的，启动新的）

# 查看资源占用
docker stats

# 进入容器调试
docker exec -it production-agent-server sh
docker exec -it production-agent-web sh
```

---

## 五、防火墙配置

服务器只需开放两个端口：

```bash
# 仅开放 80（HTTP）和 22（SSH）
ufw allow 22/tcp
ufw allow 80/tcp
ufw enable

# 8000 和 3000 不对外开放 — Nginx 在容器内部转发
# 如果使用 SSL，额外开放 443
# ufw allow 443/tcp
```

---

## 六、SSL 证书配置（可选但推荐）

```bash
# 方案 A：Let's Encrypt 免费证书（需要公网域名）
apt install certbot
certbot certonly --standalone -d agent.yourcompany.com
# 证书路径：/etc/letsencrypt/live/agent.yourcompany.com/

# 将证书复制到 deploy/ssl/
mkdir -p deploy/ssl
cp /etc/letsencrypt/live/agent.yourcompany.com/fullchain.pem deploy/ssl/
cp /etc/letsencrypt/live/agent.yourcompany.com/privkey.pem deploy/ssl/

# 方案 B：内网部署 → 使用公司 CA 签发的证书
# 将 .pem 文件放到 deploy/ssl/ 目录

# 启用 nginx SSL：
# 编辑 docker-compose.yml，取消注释 443 端口和 ssl volume 挂载
# 编辑 deploy/nginx.conf，取消注释 SSL server 块

# 重新加载 nginx
docker compose restart nginx
```

---

## 七、监控与告警

### 7.1 基础健康监控

```bash
# 添加 crontab 定时检查
# 每 5 分钟检查一次，失败时写日志
*/5 * * * * curl -sf http://localhost/health || echo "$(date): Health check FAILED" >> /var/log/agent-monitor.log
```

### 7.2 日志轮转

nginx 日志需要轮转避免占满磁盘：

```bash
# /etc/logrotate.d/agent-nginx
/var/log/nginx/agent_*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        docker exec production-agent-nginx nginx -s reload
    endscript
}
```

### 7.3 磁盘空间监控

```bash
# 定期检查 Docker 占用
docker system df
# 清理无用镜像和构建缓存
docker system prune -a --filter "until=24h"
```

---

## 八、回滚方案

如果部署后发现严重问题：

```bash
# 1. 停止当前版本
docker compose down

# 2. 回退到上一个可用的 commit
git log --oneline -5   # 找到上一个稳定版本的 commit hash
git checkout <stable-commit-hash>

# 3. 重新构建并启动
docker compose build
docker compose up -d

# 4. 验证
curl http://localhost/health
```

---

## 九、故障排查

| 症状 | 可能原因 | 检查命令 |
|------|---------|----------|
| agent 容器启动后立即退出 | AI_API_KEY 未配置或错误 | `docker compose logs agent` |
| web 构建失败 | Prisma schema 问题 | `docker compose logs web` — 查看构建日志 |
| SSE 连接频繁断开 | nginx proxy_read_timeout 太短 | 检查 `deploy/nginx.conf` → `proxy_read_timeout 300s` |
| 订单查询返回 mock 数据 | SQL Server 不可达 | `docker exec production-agent-server wget -qO- http://172.18.28.88:1433` (确认网络通) |
| 磁盘空间不足 | JSONL 日志积累 | `du -sh /var/lib/docker/volumes/agent-traces/` |
| 502 Bad Gateway | agent 或 web 容器挂了 | `docker compose ps` → 看 STATUS 列 |

---

## 十、安全提醒

1. **deploy/.env** 包含所有密钥，权限已设为 600（仅 root 可读），定期轮换 AI_API_KEY 和 SQL_PASSWORD
2. **ANON_USER** 当前仍是 supervisor — 如果开启了外网访问，需紧急修复（改 server/src/routes/chat.ts 第 27 行）
3. **CORS** 当前仍是 `*` — 有域名后立刻改为具体值
4. **SQL 账号** 务必使用只读账号，当前用 sa 是严重风险
5. **定期备份** `agent-sessions` 和 `agent-traces` 两个 Docker volume
