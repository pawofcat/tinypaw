# TinyPaw 技能系统

## 技能目录结构

```
skills/
└── <skill-name>/
    ├── SKILL.md        # 技能定义（必需）
    ├── index.js        # 技能实现（可选）
    └── README.md       # 使用说明（可选）
```

## SKILL.md 格式

```markdown
# 技能名称

## 描述
简要描述技能的功能和用途。

## 触发条件
什么情况下应该使用这个技能。

## 工具
技能使用的工具列表。

## 示例
使用示例。
```

## 内置技能

### memory
记忆管理技能，用于记录和检索信息。

**触发**: 用户提到"记住"、"记忆"、"笔记"等关键词

**工具**: memory_search, memory_get, memory_append

### web-research
网络研究技能，用于搜索和收集信息。

**触发**: 用户要求搜索、查找信息、研究某话题

**工具**: web_search, web_fetch

### file-ops
文件操作技能，用于读写和编辑文件。

**触发**: 用户要求创建、修改、读取文件

**工具**: read, write, edit, exec

## 创建自定义技能

1. 在 `skills/` 目录下创建文件夹
2. 添加 `SKILL.md` 定义技能
3. （可选）添加 `index.js` 实现自定义逻辑
4. 在主 agent 中注册技能

## 技能加载

启动时自动扫描 `skills/` 目录，读取所有 `SKILL.md` 文件，
根据触发条件动态选择合适的技能。
