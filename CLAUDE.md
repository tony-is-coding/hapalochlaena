# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在此仓库中的工作指南。

## 项目概述

**cc_ee** (Claude Code Enterprise Edition) 是企业级多租户平台，通过后端 API 和前端 UI 包装 Claude Code (cc_core)。

**核心架构：**
- **后端 (cc_ee/)**: Fastify + TypeScript + PostgreSQL，进程内集成 cc_core
- **前端 (cc_ee_webui/)**: React + TypeScript + Vite，通过 REST API 和 WebSocket 连接
- **集成方式**: cc_core 使用 AsyncLocalStorage 实现 per-session 隔离

## 仓库结构

### 总体结构
```
.
├── cc_ee/                      # 后端实现
│   └── cc_core/                # Claude Code 核心源码（子模块）
├── cc_ee_webui/                # 前端实现
├── cc_ee_design/               # 技术设计文档
├── docs/superpowers/plans/     # 分阶段实施计划
└── deploy/docker/              # 部署配置
```

### cc_ee/ 后端目录
```
cc_ee/
├── cc_core/                    # Claude Code 核心源码
├── src/
│   ├── config/                 # 环境配置、数据库、JWT 配置
│   ├── core/                   # cc_core 集成层（会话管理）
│   ├── api/routes/             # Fastify 路由处理器
│   ├── services/               # 业务逻辑层
│   ├── repositories/           # 数据访问层
│   ├── models/                 # TypeScript 类型定义
│   ├── utils/                  # 工具函数
│   └── websocket/              # WebSocket 实时通信
├── migrations/                 # 数据库迁移脚本
├── tests/                      # 测试文件
└── deploy/                     # 部署配置
```

### cc_ee_webui/ 前端目录
```
cc_ee_webui/
├── src/
│   ├── pages/                  # 页面级组件
│   ├── components/             # 可复用 UI 组件
│   ├── hooks/                  # 自定义 React Hooks
│   ├── store/                  # Redux Toolkit 状态管理
│   ├── services/               # API 客户端和 WebSocket 服务
│   ├── types/                  # TypeScript 类型定义
│   ├── utils/                  # 前端工具函数
│   └── styles/                 # 样式文件
├── public/                     # 静态资源
└── tests/                      # 前端测试
```

## 服务启动逻辑

### 快速本地启动
```bash
# 后端启动
cd cc_ee
npm install
npm run dev

# 前端启动（新终端）
cd cc_ee_webui
npm install
npm run dev
```

### Docker 启动
```bash
# 完整服务栈启动
cd deploy/docker
docker-compose up -d
```

**详细启动配置和初始化指南：** 参见 `./deploy/docker/README.md`

## 基础工作流

### 需求分析管理
1. **需求收集**: 在 GitHub Issues 中创建需求，使用中文描述
2. **技术分析**: 评估技术可行性，确定实现方案
3. **任务分解**: 将需求分解为具体的开发任务
4. **优先级排序**: 根据业务价值和技术依赖确定开发顺序

!注意：不要使用gitwork tree,  单个分支开发, 正常我不会同时开始多个功能

### 代码编写
1. **TDD 开发**: 先写测试，再写实现
2. **编译验证**: 每次代码变更后运行 `tsc --noEmit` (TypeScript) 
3. **增量提交**: 小步快跑，频繁提交，保持代码库稳定
4. **分支管理**: 使用 `feature/功能描述` 或 `fix/问题编号` 命名分支

### Review 流程
1. **自我审查**: 提交前自行检查代码质量和测试覆盖
2. **创建 PR**: 使用中文标题和描述，关联相关 Issues
3. **代码审查**: 团队成员进行代码审查，关注安全性和架构合理性
4. **修复反馈**: 根据审查意见修复问题，直到通过审查

### 测试验证
1. **单元测试**: 使用 Vitest 进行单元测试，确保核心逻辑正确
2. **集成测试**: 测试 API 端点和数据库操作
3. **E2E 测试**: 使用 Playwright 测试完整用户流程
4. **性能测试**: 验证并发会话处理能力

### 问题修复
1. **问题定位**: 使用日志和调试工具快速定位问题根因
2. **修复实现**: 编写最小化修复代码，避免过度工程
3. **回归测试**: 确保修复不引入新问题
4. **文档更新**: 更新相关文档和注释

## Claude Code + Codex 联合审查工作流

### 三层反馈机制
1. **Layer 1 (正向反馈)**: LGTM 正向反馈作为 commit 评论
2. **Layer 2 (弱建议反馈)**: P2 级别改进建议作为 PR 评论（非阻塞）
3. **Layer 3 (强建议/异常反馈)**: P1 级别关键问题创建 GitHub Issues，需要修复 PR

### 工作流循环
```
PR 创建 → Codex 审查 → 三层反馈分发 → P1 问题修复 → 安全审查 → 合并
```

### 实施步骤
1. **Codex 审查**: 运行 `codex review --base main` 获取结构化输出
2. **反馈分发**:
   - LGTM 反馈 → Commit 评论
   - P2 建议 → PR 评论
   - P1 关键问题 → GitHub Issues
3. **修复实施**: 为所有 P1 问题创建修复分支
4. **安全验证**: 系统性修复认证、租户隔离、类型安全问题
5. **集成合并**: 关联修复 PR 到所有 P1 Issues

### 关键约束
- **多租户安全**: 所有数据库查询必须包含 tenantId 过滤
- **编译验证**: 代码变更后必须通过 TypeScript/Java 编译检查
- **原子操作**: Token 计费使用原子 UPDATE 操作，避免事务锁
- **会话隔离**: 使用 AsyncLocalStorage 确保 cc_core 会话隔离

## 开发约束

### 技术限制
- **禁用 ORM**: 使用原生 SQL 和 node-postgres 确保性能
- **禁用 SDK 认证**: 微服务间使用 Redis 认证，避免 SDK 复杂性
- **禁用中间件层**: 保持架构扁平，避免不必要抽象
- **强制类型安全**: 移除所有 @ts-nocheck，修复类型错误

### 环境适配
- **中国环境**: 使用阿里云或 DaoCloud 镜像源
- **网络超时**: 为外部 API 调用设置合理超时
- **加密模块**: 浏览器环境避免 Node.js crypto，使用 Web Crypto API

### 常见陷阱
1. **不要使用 cc_core 服务器模式** - 它是存根，使用直接 `query()` API
2. **不要从 PostToolUse hook 读取 token 使用量** - 使用 AssistantMessage.usage
3. **不要为 token 更新使用事务** - 使用原子 UPDATE 操作
4. **不要忘记 AsyncLocalStorage 上下文** - 始终用 runWithCwdOverride() 包装

## 测试策略

- **单元测试**: Vitest 测试服务和工具函数
- **集成测试**: 测试数据库操作和 API 端点
- **E2E 测试**: Playwright 测试前端用户流程
- **负载测试**: 验证并发会话处理能力

---

**技术选型详情**: 参见 `.claude/rules` 文件中的完整技术栈说明
**部署指南**: 参见 `./deploy/docker/README.md` 完整部署文档