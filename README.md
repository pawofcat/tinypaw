# TinyPaw - 极简 Agent 框架

🦎 一个极简的类似 OpenClaw 的 agent 框架，保留核心功能，每部分选择性简化。

## 项目定位

TinyPaw 是 OpenClaw 的轻量级版本，专注于核心功能：
- **Agent 核心** - LLM 驱动的 agent，支持 tool calling
- **工具系统** - 基础工具集（文件、执行、网络搜索）
- **会话管理** - 简单的对话记忆
- **技能系统** - 可扩展的技能插件
- **CLI 接口** - 命令行交互

## 核心架构

```
tinypaw/
├── src/
│   ├── agent.ts          # Agent 核心（LLM 调用 + tool calling）
│   ├── tools.ts          # 工具注册与执行
│   ├── session.ts        # 会话管理
│   ├── skills.ts         # 技能系统
│   ├── config.ts         # 配置管理
│   └── cli.ts            # 命令行接口
├── skills/               # 技能插件目录
│   └── example/
│       └── SKILL.md
├── memory/               # 记忆存储
├── config.json           # 配置文件
└── package.json
```

## 与 OpenClaw 的对比

| 功能 | OpenClaw | TinyPaw | 简化说明 |
|------|----------|---------|----------|
| Gateway 服务器 | ✅ 完整 HTTP/WebSocket | ❌ 移除 | 仅保留 CLI |
| 多 Channel 支持 | ✅ Telegram/WhatsApp/Discord 等 | ❌ 移除 | 仅 CLI 交互 |
| Browser 工具 | ✅ Playwright 完整支持 | ⚠️ 简化 | 仅 web_search/web_fetch |
| 子 Agent | ✅ sessions_spawn/subagents | ⚠️ 简化 | 基础子任务支持 |
| 技能系统 | ✅ 完整 SDK | ✅ 保留 | 简化为 SKILL.md 约定 |
| 记忆系统 | ✅ MEMORY.md + 向量检索 | ✅ 保留 | 简化为文件存储 |
| 配置系统 | ✅ 多层配置 + UI | ⚠️ 简化 | 单 JSON 文件 |
| 工具数量 | ✅ 50+ 工具 | ⚠️ 简化 | 核心 10 工具 |
| 代码行数 | ~100k | ~2k | 精简 98% |

## 核心工具

1. **read** - 读取文件
2. **write** - 写入文件
3. **edit** - 编辑文件
4. **exec** - 执行 shell 命令
5. **web_search** - 网络搜索
6. **web_fetch** - 抓取网页
7. **memory_search** - 记忆检索
8. **memory_get** - 记忆读取
9. **sessions_spawn** - 生成子任务
10. **message** - 消息发送（预留）

## 快速开始

```bash
# 安装
git clone https://github.com/pawofcat/tinypaw
cd tinypaw
pnpm install

# 配置
cp config.example.json config.json
# 编辑 config.json 填入 LLM API key

# 运行
pnpm start
```

## 技能开发

在 `skills/` 目录下创建技能文件夹，包含 `SKILL.md`：

```markdown
# Skill Name

## Description
技能描述

## Tools
技能使用的工具

## Examples
使用示例
```

## License

MIT
