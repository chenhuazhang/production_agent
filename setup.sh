#!/bin/bash
# ============================================================
# 中试 AI 助手 - Linux 服务器一键部署脚本
# 适用：CentOS 7 + docker-ce 26.x + compose v2.x
# 用法：bash setup.sh
# ============================================================
set -uo pipefail

MIRROR="https://docker.m.daocloud.io"
APP_DIR="/opt/production-agent"

echo "==> [1/5] 配置 Registry 镜像加速"
mkdir -p /etc/docker
printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$MIRROR" > /etc/docker/daemon.json
cat /etc/docker/daemon.json
systemctl restart docker
sleep 3
if docker info >/dev/null 2>&1; then
  echo "    docker daemon: OK"
else
  echo "    ERROR: docker 守护进程未运行，请先执行 systemctl enable --now docker"
  exit 1
fi

echo "==> [2/5] 预拉基础镜像（node:22-alpine / node:22-slim）"
docker pull node:22-alpine || { echo "    ERROR: 拉取 node:22-alpine 失败，检查镜像加速是否生效"; exit 1; }
docker pull node:22-slim   || { echo "    ERROR: 拉取 node:22-slim 失败"; exit 1; }

echo "==> [3/5] 准备部署目录与 .env"
if [ ! -f "$APP_DIR/docker-compose.simple.yml" ]; then
  echo "    ERROR: 未在 $APP_DIR 找到项目文件，请先解压部署包"
  exit 1
fi
cd "$APP_DIR"
if [ ! -f deploy/.env ]; then
  cp deploy/.env.production deploy/.env
  chmod 600 deploy/.env
  echo "    已生成 deploy/.env，请编辑后重新运行本脚本："
  echo "      vi $APP_DIR/deploy/.env"
  echo "    必须修改：AI_API_KEY（真实百炼 Key）、OPEN_API_KEY（强密码）"
  exit 0
fi
chmod 600 deploy/.env

echo "==> [4/5] 校验必填项"
FAILED=0
for k in AI_API_KEY OPEN_API_KEY SQL_PASSWORD DATABASE_URL; do
  v=$(grep -E "^${k}=" deploy/.env | head -1 | cut -d= -f2- | tr -d '\r' || true)
  if [ -z "$v" ]; then
    echo "    ERROR: $k 缺失或为空"
    FAILED=1
  elif [ "$k" = "AI_API_KEY" ] && [ "$v" = "sk-your-real-api-key-here" ]; then
    echo "    ERROR: AI_API_KEY 仍是占位值"
    FAILED=1
  elif [ "$k" = "OPEN_API_KEY" ] && [ "$v" = "change-me-open-api-key" ]; then
    echo "    ERROR: OPEN_API_KEY 仍是占位值"
    FAILED=1
  else
    echo "    $k: 已配置"
  fi
done
if [ "$FAILED" -ne 0 ]; then
  echo "    请编辑 $APP_DIR/deploy/.env 后重新运行本脚本"
  exit 1
fi

echo "==> [5/5] 构建并启动（首次约 5-15 分钟，主要在 next build）"
docker compose -f docker-compose.simple.yml up -d --build || { echo "    ERROR: 构建或启动失败，请查看上方日志"; exit 1; }
sleep 10
docker compose -f docker-compose.simple.yml ps

echo ""
echo "==> 验证"
if curl -sf http://localhost:8000/health; then
  echo ""
  echo "    agent 健康检查通过"
else
  echo "    agent 还在启动中，稍等片刻后执行："
  echo "      curl http://localhost:8000/health"
fi
echo ""
echo "完成。查看日志：docker compose -f docker-compose.simple.yml logs -f agent"
