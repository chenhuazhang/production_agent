# Docker 部署经验总结

**项目**: 中试 AI 助手
**日期**: 2026-07-06
**环境**: Windows Server + Docker Desktop → Linux 容器 (node:22-alpine / node:22-slim)

---

## 一、基础镜像选型

### 问题

Alpine (musl libc) 和 Debian (glibc) 对预编译原生模块不兼容。`lightningcss`、`@tailwindcss/oxide` 等 Tailwind CSS v4 依赖的平台二进制在 Alpine 上找不到，`npm rebuild` 对它无效（它是预编译二进制，不是 C++ addon）。

### 教训

| 镜像 | 适用场景 | 不适用场景 |
|------|---------|-----------|
| `node:22-alpine` | 纯 JS 项目、无 native 依赖 | 含 `lightningcss`、`better-sqlite3` 等需编译/预编译原生模块的项目 |
| `node:22-slim` (Debian) | 一切项目 | 镜像较大 (~300MB vs ~150MB)，但零兼容问题 |

**本次选择**: agent（纯 JS + mssql）用 Alpine ✅；web（Tailwind v4 + Prisma + better-sqlite3）用 Debian Slim ✅。

### 结论

遇到原生二进制报错 `Cannot find module '*.linux-x64-musl.node'` / `*.linux-x64-gnu.node'`，不要折腾 patch，直接换 `node:22-slim`。

---

## 二、package-lock.json 跨平台陷阱

### 问题

`package-lock.json` 在 Windows 上生成，`optionalDependencies` 锁定了 Windows 平台的原生二进制（如 `lightningcss-win32-x64-msvc`）。`npm ci` 严格按 lockfile 安装，Linux 容器里永远缺 Linux 版二进制。

### 教训

- `npm ci` 不补装 lockfile 中缺失的 optionalDependencies
- `npm install` 会补装，但 `--workspace` 模式下对嵌套 optionalDeps 也可能跳过
- 终极方案：删 lockfile 用 `npm install` 重新生成，或者在 Dockerfile 里 `npm install --no-save 包名` 单独重装含原生二进制的包

**本次方案**: web 用 `npm install` 替代 `npm ci`，再加 `npm install --no-save lightningcss @tailwindcss/oxide` 兜底。

### 结论

跨平台部署时，在 Dockerfile 里用 `npm install` 而非 `npm ci`，或准备 Linux 环境生成的 lockfile。

---

## 三、.dockerignore 的隐蔽影响

### 问题 1: `.env` 被全局排除

```dockerignore
.env      # 匹配所有目录的 .env
.env.*
```

导致 `pi_agent/.env` 无法 COPY 进容器。虽然镜像不吃这个文件（env 来自 docker-compose），但 server 启动时 dotenv 的 `config()` 会报 warning。

**修复**: 加 `!pi_agent/.env` 例外。

### 问题 2: `*.db` 被排除

```dockerignore
*.db      # 匹配所有目录的 .db
```

构建阶段 `prisma migrate deploy` 生成的 SQLite 数据库文件符合 `*.db` 规则。但 `COPY --from=builder`（跨阶段复制）不受 `.dockerignore` 影响，所以这个不算真正的问题。如果是 `COPY . .` 则会丢失。

### 结论

- `.dockerignore` 的规则匹配所有目录，不像 `.gitignore` 需要 `/` 前缀才会锚定根目录
- `COPY --from=<stage>` 不受 `.dockerignore` 限制
- 检查每个通配符规则，考虑是不是需要 `!` 例外

---

## 四、健康检查的命令依赖

### 问题

Dockerfile 里 `HEALTHCHECK CMD wget ...` 在 Alpine 和 Debian Slim 基础镜像上都不存在 `wget`。两个容器都因为健康检查失败被标记为 `unhealthy`，导致 web 在 `depends_on: condition: service_healthy` 条件下无法启动。

### 教训

- Alpine: 没有 `wget`，没有 `curl`
- Debian Slim: 也没有 `wget` 和 `curl`
- `docker-compose.yml` 的 `healthcheck` 会**覆盖** Dockerfile 里的 `HEALTHCHECK`

### 解决方案

用 Node.js 实现健康检查，零外部依赖：

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000',r=>{process.exit(r.statusCode===200?0:1)})"]
```

### 结论

永远不要在健康检查里依赖 `wget`/`curl`，用 Node.js 或直接读 `/dev/tcp`。

---

## 五、Docker 缓存中毒

### 问题

一个构建步骤失败但不报错（如 `npm install` 安装完成但缺失 optionalDeps），Docker 会缓存这一层。后续构建直接复用有问题的缓存层，改多少次 Dockerfile 都没用，除非改那层之前的指令。

### 教训

- 已缓存的坏层不会自动修复
- 改 Dockerfile 的后续指令无效——缓存键是从第一条**变化的**指令开始失效
- 破缓存方法：
  - `docker compose build --no-cache <service>`
  - 或者在要破的那层前面加一行 `ARG CACHEBUST=1`，构建时 `--build-arg CACHEBUST=$(date +%s)`

### 结论

确认某层缓存有问题时，直接 `--no-cache`，不要反复修改 Dockerfile 试图绕过。

---

## 六、docker-compose 配置重载边界

### 问题 1: `restart` 不重读 `env_file`

`docker compose restart` 只是重启进程，不重新读取 `env_file`。改了 `deploy/.env` 后 `restart` 无效。

**解决**: `docker compose up -d --force-recreate agent`

### 问题 2: `docker-compose.yml` 的 healthcheck 覆盖 Dockerfile

docker-compose 中定义的 `healthcheck` 会**完全覆盖** Dockerfile 中的。两边都改才生效。

### 问题 3: `depends_on` + `condition: service_healthy` 级联失败

一个容器 unhealthy 会阻止依赖它的容器启动。排查顺序：先看 agent → 再看 web。

### 结论

配置变更后用 `--force-recreate`，不要用 `restart`。两边（Dockerfile + compose）的健康检查保持一致。

---

## 七、Next.js 生产构建

### 问题 1: rewrites 拦截内部 API 路由

```typescript
rewrites: [{ source: "/api/:path*", destination: "http://agent:8000/api/:path*" }]
```

这个规则把 `/api/dashboard`、`/api/bases`、`/api/capacity` 也转发给 agent 了。Agent 不认识这些路由，返回 404。

**修复**: 只转发 `/api/chat/:path*` 和 `/api/sessions/:path*`，其他 API 路由由 Next.js 自己处理。

### 问题 2: 浏览器 fetch vs 服务端 fetch

`process.env.AI_API_URL` 在 Next.js 浏览器端不可用（没有 `NEXT_PUBLIC_` 前缀）。浏览器里 fetch `http://agent:8000/api/chat` 会失败——`agent` 是 Docker 内网主机名。

**修复**: 浏览器端用相对路径 `""`，通过 rewrites 走 Next.js 代理；服务端用 `http://agent:8000` 走 Docker 内网。

```typescript
const AI_API_URL =
  typeof window === "undefined"
    ? (process.env.AI_API_URL || "http://localhost:8000")
    : "";
```

### 结论

- rewrites 规则要精准，不要用 `*` 通配所有 API 路由
- 浏览器端永远不用 Docker 内网主机名
- 前端请求走 Next.js rewrites 代理是正确模式

---

## 八、git archive 只打包已跟踪文件

### 问题

`git archive --format=zip HEAD` 只包含 git 已提交的文件。所有新建的部署文件（Dockerfile、docker-compose、deploy/、documentation/、reports/ 等）都不在包里，服务器解压后缺文件。

### 教训

- 新增的部署配置文件必须在 git commit 之后才能被 archive 包含
- 密钥文件（`.env`）被 `.gitignore` 排除，需要单独传输
- 全量部署时用 `robocopy` 或 `Compress-Archive` 配合排除规则，不要依赖 git archive

### 结论

项目部署用 `robocopy` + `Compress-Archive`（排除 `node_modules`、`.git`），或者先 `git add . && git commit` 再用 `git archive`。

---

## 九、自定义 LLM Provider 配置迁移

### 问题

用户在本地 `~/.pi/agent/models.json` 中定义了百炼 (`bailian`) provider 和 `glm-5.2` 模型。pi-ai 框架自动读取该文件。Docker 容器里没有这个文件，导致 `无法找到模型 bailian/glm-5.2`。

### 教训

- pi-ai 的用户级配置在 `~/.pi/agent/` 目录（models.json、auth.json）
- Docker 容器内对应路径是 `/root/.pi/agent/`
- docker-compose 已挂载 volume `agent-sessions:/root/.pi`，直接用 `docker cp` 拷进去就行

### 解决方案

1. 把 `models.json` 放入项目 `deploy/` 目录
2. 用 `docker cp` 拷进容器: `docker cp deploy/models.json <容器>:/root/.pi/agent/models.json`

### 结论

用户级 LLM 配置也需要容器化，不能假设框架会自动发现。

---

## 十、网络与性能

### 问题 1: 公司网络不稳定

Docker Desktop 拉镜像和 npm 下载依赖频繁超时（`ECONNRESET`、`EIDLETIMEOUT`）。

**缓解措施**:
- Dockerfile 里 `npm ci/npm install` 前加 `RUN npm config set registry https://registry.npmmirror.com`（国内镜像）
- 预拉基础镜像: `docker pull node:22-alpine node:22-slim`
- 本机构建镜像 → `docker save` → `docker load` 离线传输（终极方案）

### 问题 2: 构建时间

全量构建约 8-12 分钟（含 `npm ci`）。后续只改业务代码不碰 `package.json`，构建 <30 秒（只重编译 Next.js）。

### 结论

- 把 `npm ci` 层放在 Dockerfile 最前面，最大化缓存
- 日常只重建变更的服务: `docker compose up -d --build web`

---

## 十一、最终部署检查清单

| # | 检查项 | 状态 |
|---|--------|------|
| 1 | Node 版本匹配 `package.json` engines 要求（22.x） | ✅ |
| 2 | 基础镜像选型（Alpine 或 Debian）已测试 | ✅ |
| 3 | Dockerfile 中 `npm ci` 层最靠前（缓存最充分） | ✅ |
| 4 | `.dockerignore` 无过度排除关键文件 | ✅ |
| 5 | 健康检查不依赖 `wget`/`curl` | ✅ |
| 6 | `docker-compose.yml` env_file 正确指向 `deploy/.env` | ✅ |
| 7 | Next.js rewrites 不拦截内部 API 路由 | ✅ |
| 8 | 浏览器端 fetch 使用相对路径 | ✅ |
| 9 | 自定义 LLM 配置 (`models.json`) 已容器化 | ✅ |
| 10 | Prisma `DATABASE_URL` 在 Docker 中已设置 | ✅ |
| 11 | 密钥（`deploy/.env`）不入镜像、不入 git | ✅ |
| 12 | 数据持久化（volumes）配置正确 | ✅ |

---

## 十二、日常运维速查

```powershell
# 构建
docker compose up -d --build              # 全量
docker compose up -d --build web          # 只重建前端
docker compose up -d --build agent        # 只重建后端

# 强制重建（破缓存）
docker compose build --no-cache web

# 重启（配置变更必须 --force-recreate）
docker compose up -d --force-recreate agent

# 查看状态
docker compose ps
docker compose logs agent --tail 20

# 进入容器调试
docker exec -it production-agent-server sh
docker exec -it production-agent-web sh

# 清理垃圾
docker system prune -a
```
