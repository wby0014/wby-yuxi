#!/bin/bash
# Yuxi 一键部署脚本（私有二开仓库用）
# 用法：
#   bash scripts/deploy.sh                 # 首次部署或增量启动
#   WDTrip_API_KEY=sk-xxx bash scripts/deploy.sh   # 指定模型网关 key（可选）
#   PROXY=http://127.0.0.1:7890 bash scripts/deploy.sh  # 指定代理（拉被墙镜像用）
#
# 流程：生成 .env（已存在则跳过）→ 拉镜像 → build → up → 探活 → 提示配 provider
# 说明：模型 provider（wdtrip 网关 / DeepSeek / 硅基流动）默认在 Web UI 登录后手动配，
#       本脚本只负责把服务跑起来 + 把模型 key 写入 .env 供后端读取。

set -euo pipefail
cd "$(dirname "$0")/.."

umask 077

PROXY="${PROXY:-}"
export https_proxy="${PROXY:-$https_proxy}"
export http_proxy="${PROXY:-$http_proxy}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

gen_hex() { openssl rand -hex "${1:-32}"; }

# 0. 前置检查
command -v docker >/dev/null 2>&1 || die "未找到 docker，请先安装 Docker Desktop"
command -v openssl >/dev/null 2>&1 || die "未找到 openssl"

# 1. 生成 .env（已存在则不动，避免覆盖已有密钥）
if [ ! -f .env ]; then
  log "未找到 .env，正在生成…"
  MODEL_KEY="${WDTrip_API_KEY:-${DEEPSEEK_API_KEY:-${OPENAI_API_KEY:-}}}"
  cat > .env <<EOF
# === 模型（默认接 wdtrip 网关，OpenAI 兼容；embedding/rerank 需另配硅基流动/DashScope） ===
OPENAI_API_KEY=${MODEL_KEY}
OPENAI_API_BASE=https://ai-gateway.wdtrip.com/v1
DEEPSEEK_API_KEY=${MODEL_KEY}
SILICONFLOW_API_KEY=

# 联网搜索（可选，先跳过）
WEB_SEARCH_PROVIDER=

# === 身份安全 ===
YUXI_ENV=development
JWT_SECRET_KEY=$(gen_hex 32)
API_KEY_DERIVATION_SECRET=$(gen_hex 32)
YUXI_INSTANCE_ID=instance-$(gen_hex 4)

# === 中间件凭据 ===
POSTGRES_PASSWORD=$(gen_hex 16)
MINIO_ACCESS_KEY=$(gen_hex 16)
MINIO_SECRET_KEY=$(gen_hex 16)
NEO4J_PASSWORD=$(gen_hex 16)

# === 沙盒 ===
SANDBOX_PROVISIONER_TOKEN=$(gen_hex 32)
EOF
  chmod 600 .env
  log "✅ .env 已生成（模型 key 用环境变量注入，未提供则为空，需在 Web UI 补）"
else
  log ".env 已存在，跳过生成"
fi

# 校验 security env（复用官方脚本，不改动其逻辑）
if [ -f scripts/init.sh ]; then
  bash scripts/init.sh --validate-security-env || die "security env 校验失败，请检查 .env"
fi

# 2. 拉镜像（走仓库内置 daocloud 镜像加速 + 代理兜底）
log "拉取基础镜像…"
for img in \
  "python:3.13-slim" "node:24-slim" "node:24-alpine" \
  "milvusdb/milvus:v2.5.6" "neo4j:5.26.29" "ghcr.io/astral-sh/uv:0.12.6" \
  "nginx:alpine" "quay.io/coreos/etcd:v3.5.5" "postgres:16" "redis:7.4.10-alpine"; do
  if docker image inspect "$img" >/dev/null 2>&1; then
    continue
  fi
  log "拉取 $img"
  # 优先走 daocloud 镜像（scripts/pull_image.sh），失败则代理直拉
  if ! bash scripts/pull_image.sh "$img" >/dev/null 2>&1; then
    warn "daocloud 拉取失败，尝试直拉（代理=$PROXY）"
    docker pull "$img" || die "拉取 $img 失败，请检查网络/代理"
  fi
done

# 3. build（minio 的 alpine 基础镜像需要能访问 docker.io，走代理）
log "构建应用镜像（首次较慢，含 pip/pnpm 依赖）…"
docker compose build || die "build 失败，请把报错发出来排查"

# 4. 启动
log "启动服务…"
docker compose up -d || die "up 失败"

# 5. 探活
log "等待 API 就绪…"
for i in $(seq 1 60); do
  if curl -sf -m 3 http://localhost:5050/api/system/ready >/dev/null 2>&1; then
    log "✅ API 已就绪"
    break
  fi
  if [ "$i" -eq 60 ]; then
    warn "API 60s 内未就绪，请检查：docker compose logs api worker"
  fi
  sleep 2
done

echo
log "================ 部署完成 ================"
log "Web 前端:   http://localhost:5173"
log "API 文档:   http://localhost:5050/docs"
log "Neo4j:      http://localhost:7474"
log "MinIO:      http://localhost:9001"
echo
warn "下一步（手动）:"
warn "  1. 登录 Web UI 初始化/用已有超管账号"
warn "  2. 在「模型供应商」里启用并配置 wdtrip 网关（base_url=https://ai-gateway.wdtrip.com/v1）"
warn "  3. 或直接调 API 配 provider（参考：PUT /api/system/model-providers/deepseek）"
