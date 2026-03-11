# TinyPaw 架构设计

## 设计目标

1. **极简** - 代码量控制在 2000 行以内
2. **核心** - 保留 OpenClaw 的核心功能
3. **可扩展** - 支持技能和工具扩展
4. **易用** - 开箱即用，配置简单

## 核心组件

### 1. Agent 核心 (`src/agent.js`)

```
┌─────────────────────────────────────────────────────┐
│                    Agent Loop                        │
├─────────────────────────────────────────────────────┤
│  1. 接收用户输入                                     │
│  2. 构建消息历史（system + conversation）            │
│  3. 调用 LLM（支持 tool calling）                    │
│  4. 检查 tool_calls                                  │
│     ├─ 有工具调用 → 执行工具 → 返回结果 → 继续循环   │
│     └─ 无工具调用 → 返回最终回复                     │
│  5. 更新会话历史                                     │
└─────────────────────────────────────────────────────┘
```

**关键特性**:
- 支持多轮工具调用（max 10 次迭代）
- 自动管理会话历史（保留最近 20 条）
- 错误处理和重试

### 2. 工具系统 (`src/agent.js` - tools 对象)

```
工具注册表:
┌──────────────┬──────────────────────────────────────┐
│   工具名     │            功能描述                   │
├──────────────┼──────────────────────────────────────┤
│ read         │ 读取文件内容                          │
│ write        │ 写入文件内容                          │
│ edit         │ 编辑文件（文本替换）                  │
│ exec         │ 执行 shell 命令                       │
│ web_search   │ 网络搜索（DuckDuckGo）                │
│ web_fetch    │ 抓取网页内容                          │
│ memory_search│ 搜索记忆文件                          │
│ memory_get   │ 读取记忆文件                          │
│ memory_append│ 追加记忆内容                          │
└──────────────┴──────────────────────────────────────┘
```

**工具接口**:
```javascript
{
  description: string,      // 工具描述（用于 LLM）
  parameters: {             // 参数定义
    paramName: 'string'
  },
  execute: async (args) => {
    // 执行逻辑
    return { success: true/false, ... }
  }
}
```

### 3. 会话管理

```
会话存储（内存）:
sessions = Map<sessionKey, Message[]>

Message = {
  role: 'system' | 'user' | 'assistant' | 'tool',
  content: string
}

限制:
- 每个会话保留最近 40 条消息
- 防止 token 超限
```

### 4. 配置系统

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-xxx",
    "baseUrl": "https://api.openai.com/v1"
  },
  "memory": {
    "path": "./memory"
  },
  "system": "system prompt"
}
```

**配置优先级**:
1. 命令行参数（未实现，预留）
2. config.json 文件
3. 环境变量
4. 默认值

### 5. 技能系统

```
技能加载流程:
1. 扫描 skills/ 目录
2. 读取每个子目录的 SKILL.md
3. 解析触发条件
4. 根据用户输入匹配合适的技能
5. 执行技能对应的工具组合
```

**技能匹配**（简化版）:
- 关键词匹配
- 默认 fallback 到通用 agent

## 数据流

```
用户输入
   ↓
┌─────────────────┐
│   CLI 接口      │
└────────┬────────┘
         ↓
┌─────────────────┐
│  添加到会话历史  │
└────────┬────────┘
         ↓
┌─────────────────┐
│   Agent Loop    │
│  (callLLM +     │
│   tool execute) │
└────────┬────────┘
         ↓
┌─────────────────┐
│   工具执行      │
│ (read/write/    │
│  exec/search)   │
└────────┬────────┘
         ↓
┌─────────────────┐
│   返回结果      │
└────────┬────────┘
         ↓
用户看到回复
```

## 与 OpenClaw 对比

### 移除的功能
- ❌ Gateway HTTP/WebSocket 服务器
- ❌ 多 Channel 支持（Telegram/WhatsApp 等）
- ❌ Browser 自动化工具（Playwright）
- ❌ 复杂的子 Agent 系统
- ❌ 配置 UI 和热重载
- ❌ 向量记忆检索
- ❌ 工具权限和安全策略
- ❌ 多用户支持

### 保留的功能
- ✅ LLM 驱动的 Agent 核心
- ✅ Tool calling 机制
- ✅ 基础工具集（文件/执行/搜索）
- ✅ 会话管理
- ✅ 技能系统（简化版）
- ✅ 记忆存储（文件系统）

### 简化的功能
- ⚠️ 配置：单 JSON 文件 vs 多层配置
- ⚠️ 记忆：文件存储 vs 向量检索
- ⚠️ 技能：关键词匹配 vs 完整 SDK
- ⚠️ 工具：10 个核心工具 vs 50+ 工具

## 扩展方向

### 添加新工具
在 `tools` 对象中添加：
```javascript
const tools = {
  // ... 现有工具
  myTool: {
    description: '我的工具',
    parameters: { param1: 'string' },
    execute: async ({ param1 }) => {
      // 实现
      return { success: true, result: '...' };
    }
  }
};
```

### 添加新技能
1. 创建 `skills/my-skill/SKILL.md`
2. 定义触发条件和工具
3. 在主循环中添加技能匹配逻辑

### 添加 Channel 支持
参考 OpenClaw 的 channel 实现，添加：
- Telegram bot
- Discord bot
- Web 界面

## 性能考虑

- 单次对话延迟：1-3 秒（LLM 调用）
- 工具执行延迟：取决于具体工具
- 内存占用：< 50MB
- 启动时间：< 1 秒

## 安全考虑

⚠️ **注意**: TinyPaw 是简化版本，安全功能有限：

- exec 工具可执行任意命令 → 需信任用户
- 文件工具可读写任意路径 → 需限制工作目录
- 无输入验证 → 需在生产环境添加
- 无速率限制 → 需在生产环境添加

**建议**:
1. 仅在受信任环境使用
2. 限制工作目录
3. 添加命令白名单
4. 生产环境使用 OpenClaw
