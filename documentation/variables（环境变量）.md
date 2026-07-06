# 环境变量：中试 AI 助手

## 变量清单

所有变量由 dotenv 从 `pi_agent/.env` 加载，在 server 启动时执行（[server/src/index.ts:27](server/src/index.ts#L27)）。

### AI / LLM 配置

| 变量 | 必填 | 默认值 | 风险 | 轮换策略 | 说明 |
|----------|----------|---------|------------|----------|-------|
| `AI_PROVIDER` | 是 | `deepseek` | 低 | N/A | 供应商标识：deepseek / openai / qwen / anthropic / google |
| `AI_API_KEY` | **是** | — | **高** | 泄露时立即轮换 | LLM API 密钥。缺失时服务启动崩溃 |
| `AI_MODEL` | 否 | `deepseek-v4-flash` | 低 | N/A | 各供应商约定的模型名称 |

### SQL Server 配置

| 变量 | 必填 | 默认值 | 风险 | 轮换策略 | 说明 |
|----------|----------|---------|------------|----------|-------|
| `SQL_HOST` | 真实数据需要 | — | 中 | 服务器变更时 | 内网 IP：`172.18.28.88` |
| `SQL_PORT` | 否 | `1433` | 低 | N/A | SQL Server 标准端口 |
| `SQL_DB` | 真实数据需要 | — | 中 | N/A | 数据库名：`db1` |
| `SQL_USER` | 真实数据需要 | — | **高** | 每季度轮换 | ✅ `comm_plm_prd`（只读账号） |
| `SQL_PASSWORD` | 真实数据需要 | — | **高** | 每季度 + 泄露时 | ✅ 只读账号密码 |

### Server 配置

| 变量 | 必填 | 默认值 | 风险 | 说明 |
|----------|----------|---------|------------|-------|
| `PORT` | 否 | `8000` | 低 | Hono 服务端口 |
| `CORS_ORIGIN` | 否 | （未设置，默认 `*`） | 中 | 生产环境应设置为前端域名 |

### Web（Next.js）配置

| 变量 | 必填 | 默认值 | 风险 | 说明 |
|----------|----------|---------|------------|-------|
| `AI_API_URL` | 否 | `http://localhost:8000` | 低 | 后端服务地址（web → server 代理） |
| `PYTHON_API_URL` | 否 | `http://localhost:8000` | 低 | 旧版别名，向后兼容 |
| `SQL_HOST/PORT/DB/USER/PASSWORD` | 否 | — | 高 | Web 端有自己的 SQL 连接池用于看板查询 |

### 密钥清单

| 密钥 | 存储位置 | 泄露风险 | 缓解措施 |
|--------|---------|---------------|------------|
| `AI_API_KEY` | `pi_agent/.env`（gitignored） | 若提交到 git 或打入 Docker 镜像 | `.gitignore` 检查；`.dockerignore` 检查；Docker secrets |
| `SQL_PASSWORD` | `pi_agent/.env`（gitignored） | 泄露 | 只读账号 `comm_plm_prd`；Docker secrets |
| LLM API 响应 | 内存（AgentSession） | 内存 dump | Session 30min TTL 清理 |

### 部署：Docker

根据 [Dockerfile](Dockerfile) 和 [docker-compose.yml](docker-compose.yml)：

- `.env` 不得被 COPY 进镜像（验证 `.dockerignore`）
- 推荐：通过 docker-compose 的 `env_file` 或 Docker secrets / K8s secrets 注入
- Server 监听 `0.0.0.0:8000` — 确保防火墙/VPC 限制对 8000 端口的外部访问

### 生产上线前必须完成

1. 创建 SQL 只读账号 → 更新 `SQL_USER` / `SQL_PASSWORD`
2. 设置 `CORS_ORIGIN` 为前端域名
3. 从 `.env` 文件迁移到 Docker secrets 或 K8s secrets
4. 将 `AI_API_KEY` 轮换流程加入运维手册
