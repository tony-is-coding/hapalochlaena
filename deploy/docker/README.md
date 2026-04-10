# Docker 部署指南

cc_ee 项目的 Docker 容器化部署配置和启动指南。

## 快速启动

### 前置要求
- Docker 20.10+
- Docker Compose 2.0+
- 8GB+ 可用内存

### 一键启动
```bash
cd deploy/docker
docker-compose up -d
```

服务启动后访问：
- **前端**: http://localhost:3000
- **后端 API**: http://localhost:8080
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## 服务架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   cc_ee_webui   │    │     cc_ee       │    │   PostgreSQL    │
│   (Frontend)    │◄──►│   (Backend)     │◄──►│   (Database)    │
│   Port: 3000    │    │   Port: 8080    │    │   Port: 5432    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │      Redis      │
                       │    (Cache)      │
                       │   Port: 6379    │
                       └─────────────────┘
```

## 环境配置

### 环境变量文件
复制并配置环境变量：
```bash
cp .env.example .env
```

### 关键配置项
```bash
# 数据库配置
DATABASE_URL=postgresql://cc_ee:password@postgres:5432/cc_ee
REDIS_URL=redis://redis:6379

# JWT 配置（生产环境必须修改）
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Claude API 配置
ANTHROPIC_API_KEY=your-anthropic-api-key

# 服务端口
BACKEND_PORT=8080
FRONTEND_PORT=3000

# 日志级别
LOG_LEVEL=info
NODE_ENV=production
```

## 容器服务详情

### cc_ee (后端服务)
- **镜像**: `node:20-alpine`
- **端口**: 8080
- **依赖**: PostgreSQL, Redis
- **健康检查**: `GET /api/health`
- **启动时间**: ~30秒

### cc_ee_webui (前端服务)
- **镜像**: `nginx:alpine`
- **端口**: 3000
- **构建**: Vite 生产构建
- **静态文件**: `/usr/share/nginx/html`
- **启动时间**: ~10秒

### postgres (数据库)
- **镜像**: `postgres:15-alpine`
- **端口**: 5432
- **数据卷**: `postgres_data`
- **初始化**: 自动创建数据库和用户
- **备份**: 每日自动备份到 `./backups/`

### redis (缓存)
- **镜像**: `redis:7-alpine`
- **端口**: 6379
- **持久化**: AOF + RDB
- **内存限制**: 512MB

## 开发模式

### 本地开发启动
```bash
# 仅启动基础设施（数据库、缓存）
docker-compose -f docker-compose.dev.yml up -d

# 本地运行后端
cd ../../cc_ee
npm install
npm run dev

# 本地运行前端（新终端）
cd ../../cc_ee_webui
npm install
npm run dev
```

### 热重载配置
开发模式支持：
- 后端代码热重载（tsx watch）
- 前端 HMR（Vite）
- 数据库迁移自动应用
- 实时日志输出

## 生产部署

### 安全配置
```bash
# 1. 修改默认密码
sed -i 's/password/$(openssl rand -base64 32)/' .env

# 2. 生成 JWT 密钥
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

# 3. 配置 HTTPS（推荐使用 Nginx 反向代理）
# 4. 启用防火墙，仅开放必要端口
```

### 性能优化
```bash
# 启用生产优化配置
docker-compose -f docker-compose.prod.yml up -d

# 配置包括：
# - 多副本负载均衡
# - Redis 集群模式
# - PostgreSQL 连接池优化
# - Nginx 缓存和压缩
```

## 监控和日志

### 日志查看
```bash
# 查看所有服务日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f cc_ee
docker-compose logs -f postgres

# 查看错误日志
docker-compose logs --tail=100 cc_ee | grep ERROR
```

### 健康检查
```bash
# 检查服务状态
docker-compose ps

# 健康检查端点
curl http://localhost:8080/api/health
curl http://localhost:3000/health
```

### 性能监控
- **后端指标**: http://localhost:8080/api/metrics
- **数据库监控**: 使用 pgAdmin 或 Grafana
- **Redis 监控**: `redis-cli info`

## 数据管理

### 数据库迁移
```bash
# 运行迁移
docker-compose exec cc_ee npm run db:migrate

# 回滚迁移
docker-compose exec cc_ee npm run db:rollback

# 重置数据库（开发环境）
docker-compose exec cc_ee npm run db:reset
```

### 数据备份
```bash
# 手动备份
docker-compose exec postgres pg_dump -U cc_ee cc_ee > backup_$(date +%Y%m%d).sql

# 恢复备份
docker-compose exec -T postgres psql -U cc_ee cc_ee < backup_20260410.sql
```

### 数据卷管理
```bash
# 查看数据卷
docker volume ls | grep cc_ee

# 备份数据卷
docker run --rm -v cc_ee_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_backup.tar.gz /data

# 恢复数据卷
docker run --rm -v cc_ee_postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/postgres_backup.tar.gz -C /
```

## 故障排除

### 常见问题

**1. 端口冲突**
```bash
# 检查端口占用
lsof -i :8080
lsof -i :3000

# 修改端口配置
vim .env  # 修改 BACKEND_PORT 和 FRONTEND_PORT
```

**2. 数据库连接失败**
```bash
# 检查数据库状态
docker-compose exec postgres pg_isready -U cc_ee

# 重置数据库连接
docker-compose restart postgres
docker-compose restart cc_ee
```

**3. 内存不足**
```bash
# 检查容器资源使用
docker stats

# 增加 Docker 内存限制
# Docker Desktop: Settings > Resources > Memory
```

**4. 构建失败**
```bash
# 清理 Docker 缓存
docker system prune -a

# 重新构建镜像
docker-compose build --no-cache
```

### 调试模式
```bash
# 启用调试日志
export DEBUG=cc_ee:*
docker-compose up

# 进入容器调试
docker-compose exec cc_ee sh
docker-compose exec postgres psql -U cc_ee
```

## 扩展配置

### 负载均衡
```yaml
# docker-compose.scale.yml
services:
  cc_ee:
    deploy:
      replicas: 3
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    depends_on:
      - cc_ee
```

### 集群部署
```bash
# Docker Swarm 模式
docker swarm init
docker stack deploy -c docker-compose.swarm.yml cc_ee_stack

# Kubernetes 部署
kubectl apply -f k8s/
```

## 安全最佳实践

1. **定期更新镜像**：使用最新的安全补丁
2. **最小权限原则**：容器以非 root 用户运行
3. **网络隔离**：使用 Docker 网络分离服务
4. **密钥管理**：使用 Docker Secrets 或外部密钥管理
5. **日志审计**：启用详细的访问和操作日志
6. **备份策略**：定期备份数据和配置

---

**更多配置选项**: 参见 `docker-compose.yml` 和 `.env.example` 文件
**技术支持**: 参见项目根目录 `CLAUDE.md` 文件