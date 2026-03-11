# TinyPaw 快速开始指南

## 1. 推送到 GitHub

项目已推送到 GitHub：https://github.com/pawofcat/tinypaw

如需更新，执行：

```bash
cd /home/liu/.openclaw/workspace/tinypaw

# 使用推送脚本
./push.sh

# 或手动推送
git add -A
git commit -m "your message"
git push
```

## 2. 安装依赖

```bash
cd tinypaw
pnpm install
# 或
npm install
```

## 3. 配置 LLM

```bash
cp config.example.json config.json
```

编辑 `config.json`，填入你的 LLM API 密钥：

```json
{
  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-your-api-key-here",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

**支持的 LLM 提供商**:
- OpenAI (api.openai.com)
- Azure OpenAI
- 任何 OpenAI 兼容 API（Claude Code API、本地 LLM 等）

## 4. 运行

```bash
pnpm start
# 或
node src/cli.js
```

## 5. 使用示例

```
🦎 TinyPaw v0.1.0 - 极简 Agent 框架

🦎> 帮我创建一个待办事项文件

🤔 思考中...

🔧 使用工具：write { path: 'todo.md', content: '# TODO\n\n- [ ] 任务 1\n- [ ] 任务 2' }

💬 已创建 todo.md 文件，包含待办事项列表。

🦎> 记住明天下午 3 点开会

🤔 思考中...

🔧 使用工具：memory_append { path: '2026-03-11.md', content: '## 提醒\n\n- 明天下午 3 点开会' }

💬 好的，已记录到今日记忆中。
```

## 6. 可用工具（9 个）

| 工具 | 功能 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 写入文件内容 |
| `edit` | 编辑文件（文本替换） |
| `exec` | 执行 shell 命令 |
| `web_search` | 网络搜索（DuckDuckGo） |
| `web_fetch` | 抓取网页内容 |
| `memory_search` | 搜索记忆文件 |
| `memory_get` | 读取记忆文件 |
| `memory_append` | 追加记忆内容 |

## 7. 开发技能

在 `skills/` 目录下创建新技能：

```bash
mkdir -p skills/my-skill
cat > skills/my-skill/SKILL.md
```

参考 `skills/memory/SKILL.md` 示例。

## 8. 项目结构

```
tinypaw/
├── src/
│   ├── agent.js        # Agent 核心（LLM + tool calling）
│   └── cli.js          # CLI 接口
├── skills/
│   ├── README.md       # 技能系统说明
│   └── memory/
│       └── SKILL.md    # 记忆技能定义
├── memory/             # 记忆存储（运行时创建）
├── config.example.json # 配置模板
├── package.json
├── README.md           # 项目介绍
├── ARCHITECTURE.md     # 架构设计
├── SETUP.md            # 快速开始指南
└── push.sh             # 推送脚本
```

**代码统计**:
- `agent.js`: ~300 行
- `cli.js`: ~80 行
- 总计：~400 行（核心代码）

## 9. 故障排查

### SSH 推送失败

如果使用 SSH 推送失败，尝试：

```bash
# 使用 HTTPS 代替 SSH
git remote set-url origin https://github.com/pawofcat/tinypaw.git
git push -u origin main

# 或配置 SSH
ssh-add ~/.ssh/id_ed25519
```

### LLM API 错误

检查：
1. API key 是否正确
2. 网络连接是否正常
3. 账户余额是否充足

### 工具执行失败

检查：
1. 文件路径是否正确
2. 权限是否足够
3. 命令是否合法

## 10. 下一步

**优先级高**:
- [ ] 修复 web_search（DuckDuckGo HTML 解析不稳定）
- [ ] 实现技能自动加载和匹配
- [ ] 添加更多工具（browser、tts 等）
- [ ] 添加测试用例

**优先级中**:
- [ ] 实现完整的技能匹配系统
- [ ] 添加 Channel 支持（Telegram、Discord）
- [ ] 实现 Web 界面
- [ ] 添加 sessions_spawn（子任务）支持

---

**项目地址**: https://github.com/pawofcat/tinypaw
