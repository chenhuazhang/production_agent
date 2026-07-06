# ===== Production Dockerfile =====
# 使用 tsx 运行（pi-agent workspace 的模块引用依赖 TS 源码）
FROM node:20-alpine
WORKDIR /app

# 复制 workspace 配置并安装依赖
COPY package.json package-lock.json ./
COPY pi_agent/agent/package.json pi_agent/agent/
COPY server/package.json server/
RUN npm ci --omit=dev --workspaces --include-workspace-root 2>/dev/null; \
    npm ci --workspaces --include-workspace-root

# 复制源码（Skills + Data 文件在运行时被直接读取）
COPY . .

# 运行时环境变量由 docker-compose / k8s 注入
ENV NODE_ENV=production
ENV PORT=8000

EXPOSE 8000

# pi_agent/agent/skills/*.md 和 pi_agent/data/*.ts 在运行时被 tsx 直接加载
CMD ["npx", "tsx", "server/src/index.ts"]
