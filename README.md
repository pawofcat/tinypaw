# TinyPaw - 极简 Agent 框架

🦎 一个极简的类似 OpenClaw 的 agent 框架，保留核心功能，每部分选择性简化。

**当前版本**: v0.3.0 (会话管理增强)

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
│   └── cli.ts            # 命令行接口
├── dist/                 # 编译输出（自动生成）
├── skills/               # 技能插件目录
│   └── memory/
│       └── SKILL.md
├── memory/               # 记忆存储（运行时创建）
├── config.json           # 配置文件
├── tsconfig.json         # TypeScript 配置
└── package.json
```

## 与 OpenClaw 的对比

| 功能 | OpenClaw | TinyPaw v0.3.0 | 简化说明 |
|------|----------|---------|----------|
| Gateway 服务器 | ✅ 完整 HTTP/WebSocket | ❌ 移除 | 仅保留 CLI |
| 多 Channel 支持 | ✅ Telegram/WhatsApp/Discord 等 | ❌ 移除 | 仅 CLI 交互 |
| Browser 工具 | ✅ Playwright 完整支持 | ❌ 移除 | 预留 web_search/web_fetch |
| 子 Agent | ✅ sessions_spawn/subagents | ❌ 移除 | 预留扩展 |
| 技能系统 | ✅ 完整 SDK | ⚠️ 简化 | SKILL.md 约定（未实现自动加载） |
| 记忆系统 | ✅ MEMORY.md + 向量检索 | ✅ 保留 | 文件存储 + 持久化 |
| **会话管理** | ✅ 完整 | ✅ **增强** | **上下文窗口控制 + `/` 命令** |
| 配置系统 | ✅ 多层配置 + UI | ✅ 简化 | 单 JSON 文件 |
| 工具数量 | ✅ 50+ 工具 | ✅ 简化 | 核心 9 工具 |
| 代码行数 | ~100k TS | ~2170 TS | 精简 97.8% |
| 语言 | TypeScript | TypeScript | 100% TS |
| 错误处理 | ✅ 完善 | ✅ 基础 | 重试 + 超时 |
| Token 管理 | ✅ 完善 | ✅ 基础 | 估算 + 裁剪 |
| **单元测试** | ✅ 完善 | ✅ **56 个测试** | **核心功能覆盖** |

## 核心工具（已实现 9 个）

1. **read** - 读取文件
2. **write** - 写入文件
3. **edit** - 编辑文件（文本替换）
4. **exec** - 执行 shell 命令
5. **web_search** - 网络搜索（DuckDuckGo）
6. **web_fetch** - 抓取网页
7. **memory_search** - 记忆检索
8. **memory_get** - 记忆读取
9. **memory_append** - 追加记忆

**预留扩展**：sessions_spawn（子任务）、message（消息发送）、browser（浏览器自动化）

## 快速开始

```bash
# 安装
git clone https://github.com/pawofcat/tinypaw
cd tinypaw
npm install

# 配置
cp config.example.json config.json
# 编辑 config.json 填入 LLM API key

# 构建
npm run build

# 运行
npm start
```

## 会话管理命令

TinyPaw v0.3.0 支持 `/` 前缀的会话管理命令：

| 命令 | 简写 | 描述 |
|------|------|------|
| `/new <name>` | - | 创建新会话并切换 |
| `/switch <name>` | `/sw` | 切换到已有会话 |
| `/reset` | - | 重置当前会话（清空历史） |
| `/delete <name>` | `/del` | 删除会话 |
| `/list` | `/ls` | 列出所有会话 |
| `/info` | - | 显示当前会话信息 |
| `/help` | `/h` | 显示帮助 |

**示例**:
```bash
🦎 [default]> /new project-a
✅ 已创建新会话 "project-a" 并切换

🦎 [project-a]> /ls
📋 会话列表:
   👉 project-a (0 条消息，0 tokens) - 刚刚
      default (15 条消息，2340 tokens) - 5 分钟前

🦎 [project-a]> /info
📊 当前会话：project-a
   消息数：0
   Token 数：~0
   创建时间：2026/3/24 22:30:00
   最后更新：刚刚
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
