# NanoClaw 操作指南

## 服务管理

### macOS (launchd)

```bash
# 启动服务
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist

# 停止服务
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist

# 重启服务（推荐）
launchctl kickstart -k gui/$(id -u)/com.nanoclaw

# 查看服务状态
launchctl list | grep nanoclaw
```

### Linux (systemd)

```bash
# 启动服务
systemctl --user start nanoclaw

# 停止服务
systemctl --user stop nanoclaw

# 重启服务
systemctl --user restart nanoclaw

# 查看状态
systemctl --user status nanoclaw
```

### 手动运行

```bash
# 开发模式（热重载）
npm run dev

# 生产模式
npm run build && npm start
```

## 配置文件

### .env 文件

主配置文件位于项目根目录 `.env`：

```bash
# 频道配置（根据启用的频道填写）
FEISHU_APP_ID=cli_xxx
FEISHU_APP_SECRET=xxx

WHATSAPP_SESSION_PATH=/path/to/session

TELEGRAM_BOT_TOKEN=xxx

SLACK_BOT_TOKEN=xoxb-xxx
SLACK_APP_TOKEN=xapp-xxx

# API 配置（必须）
ANTHROPIC_BASE_URL=https://api.anthropic.com  # 或兼容端点
ANTHROPIC_API_KEY=sk-ant-xxx
ANTHROPIC_MODEL=claude-sonnet-4-6  # 可选，默认使用 SDK 默认模型

# 兼容 API 示例

# MiniMax Token Plan
# ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic
# ANTHROPIC_API_KEY=sk-cp-xxx
# ANTHROPIC_MODEL=MiniMax-M2.7

# 智谱 GLM
# ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
# ANTHROPIC_API_KEY=xxx
# ANTHROPIC_MODEL=glm-4-flash
```

### 兼容 API 端点注意事项

使用第三方 Anthropic 兼容 API 时，`ANTHROPIC_BASE_URL` 应包含完整路径前缀：

```bash
# 正确：包含 /anthropic 路径
ANTHROPIC_BASE_URL=https://api.minimaxi.com/anthropic

# 错误：缺少路径
ANTHROPIC_BASE_URL=https://api.minimaxi.com
```

Credential proxy 会将请求路径与 base URL 路径拼接：
- Base: `https://api.minimaxi.com/anthropic`
- 请求: `/v1/messages`
- 实际: `https://api.minimaxi.com/anthropic/v1/messages`

### 容器配置文件

每个群组的配置存储在 `data/sessions/{group}/.claude/settings.json`：

```json
{
  "model": "MiniMax-M2.7",
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1",
    "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD": "1",
    "CLAUDE_CODE_DISABLE_AUTO_MEMORY": "0"
  }
}
```

**重要**：修改 `.env` 中的模型后，需要删除旧的 settings.json 才能生效：

```bash
# 删除后重启，会自动用新配置重新生成
rm data/sessions/{group}/.claude/settings.json
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## 容器架构

### 挂载点

| 宿主机路径 | 容器路径 | 权限 | 说明 |
|-----------|---------|------|------|
| `{project_root}` | `/workspace/project` | 只读 | 主群组可访问项目代码 |
| `groups/{folder}` | `/workspace/group` | 读写 | 群组专属目录 |
| `data/sessions/{folder}/.claude` | `/home/node/.claude` | 读写 | Claude 会话和配置 |
| `data/ipc/{folder}` | `/workspace/ipc` | 读写 | 进程间通信 |
| `data/sessions/{folder}/agent-runner-src` | `/app/src` | 读写 | Agent 源码 |

### 请求流程

```
消息 → NanoClaw 主进程 → 容器 (docker run)
                              ↓
                          Credential Proxy (localhost:3001)
                              ↓
                          API 服务 (ANTHROPIC_BASE_URL)
```

Credential proxy 注入真实的 API 密钥，容器内只看到 `placeholder`。

## 调试命令

### 查看运行状态

```bash
# 查看主进程
ps aux | grep nanoclaw

# 查看运行中的容器
docker ps | grep nanoclaw

# 查看 credential proxy 端口
lsof -i :3001
```

### 日志查看

```bash
# 容器日志（按时间排序）
ls -lt groups/{group}/logs/

# 查看最新日志
cat $(ls -t groups/{group}/logs/*.log | head -1)

# 实时查看（开发模式）
LOG_LEVEL=debug npm run dev
```

### 直接测试 API

```bash
# 测试 credential proxy
curl -s -X POST "http://localhost:3001/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: test" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "your-model", "max_tokens": 20, "messages": [{"role": "user", "content": "hi"}]}'

# 直接测试 API 端点
curl -s -X POST "https://api.example.com/anthropic/v1/messages" \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "your-model", "max_tokens": 20, "messages": [{"role": "user", "content": "hi"}]}'
```

### 手动运行容器

```bash
# 查看容器启动命令（从日志中获取）
ps aux | grep "docker run" | grep nanoclaw

# 手动进入容器调试
docker run -it --rm \
  -e ANTHROPIC_BASE_URL=http://host.docker.internal:3001 \
  -e ANTHROPIC_API_KEY=placeholder \
  -v /path/to/group:/workspace/group \
  nanoclaw-agent:latest \
  /bin/bash
```

## 常见问题

### 模型不存在或无权限

错误：`There's an issue with the selected model (xxx). It may not exist or you may not have access to it.`

原因：
1. 模型名称错误
2. API 不支持该模型
3. settings.json 中有旧配置

解决：
```bash
# 1. 验证 API 是否支持该模型
curl -X POST "https://api.example.com/anthropic/v1/messages" \
  -H "x-api-key: your-key" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model": "model-name", "max_tokens": 10, "messages": [{"role": "user", "content": "hi"}]}'

# 2. 删除旧配置并重启
rm data/sessions/{group}/.claude/settings.json
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

### API 余额不足

错误：`insufficient balance`

解决：充值或切换到其他 API 服务。

### Credential proxy 404 错误

原因：`ANTHROPIC_BASE_URL` 路径配置不正确

解决：确保 base URL 包含完整路径前缀，如 `https://api.minimaxi.com/anthropic`

### 容器超时

错误：`Container timed out after xxx ms`

原因：
1. API 响应慢
2. 模型思考时间长
3. 网络问题

解决：
```bash
# 查看容器日志了解详情
cat groups/{group}/logs/*.log
```

## 重建容器镜像

```bash
# 标准重建
./container/build.sh

# 强制清除缓存重建
docker builder prune -f && ./container/build.sh
```

## 相关文档

- [DEBUG_CHECKLIST.md](./DEBUG_CHECKLIST.md) - 详细调试步骤
- [REQUIREMENTS.md](./REQUIREMENTS.md) - 架构决策
- [SECURITY.md](./SECURITY.md) - 安全模型
