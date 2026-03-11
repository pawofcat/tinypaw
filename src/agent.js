#!/usr/bin/env node
/**
 * TinyPaw Agent Core
 * 极简 Agent 核心 - LLM 驱动的工具调用 agent
 */

import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';

const exec = promisify(execCb);

// ============================================================================
// 配置
// ============================================================================

let config = {
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
  },
  memory: {
    path: './memory'
  },
  system: `你是一个 helpful 的 AI 助手。使用提供的工具来完成任务。
思考过程要简洁，直接给出答案和行动。`
};

export async function loadConfig(path = './config.json') {
  try {
    const content = await readFile(path, 'utf-8');
    config = { ...config, ...JSON.parse(content) };
  } catch (e) {
    // 使用默认配置
  }
  return config;
}

// ============================================================================
// 工具系统
// ============================================================================

const tools = {
  read: {
    description: '读取文件内容',
    parameters: { path: 'string' },
    execute: async ({ path }) => {
      try {
        const content = await readFile(path, 'utf-8');
        return { success: true, content: content.slice(0, 50000) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  write: {
    description: '写入文件内容',
    parameters: { path: 'string', content: 'string' },
    execute: async ({ path, content }) => {
      try {
        await writeFile(path, content, 'utf-8');
        return { success: true, path };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  edit: {
    description: '编辑文件（替换文本）',
    parameters: { path: 'string', oldText: 'string', newText: 'string' },
    execute: async ({ path, oldText, newText }) => {
      try {
        const content = await readFile(path, 'utf-8');
        const updated = content.replace(oldText, newText);
        await writeFile(path, updated, 'utf-8');
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  exec: {
    description: '执行 shell 命令',
    parameters: { command: 'string' },
    execute: async ({ command }) => {
      try {
        const { stdout, stderr } = await exec(command, { timeout: 60000 });
        return { success: true, stdout, stderr };
      } catch (e) {
        return { success: false, error: e.message, stdout: e.stdout, stderr: e.stderr };
      }
    }
  },

  web_search: {
    description: '网络搜索',
    parameters: { query: 'string' },
    execute: async ({ query }) => {
      // 简化版：使用 DuckDuckGo HTML 搜索
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const html = await res.text();
        // 简单提取标题和链接
        const results = [];
        const titleRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
        let match;
        while ((match = titleRegex.exec(html)) !== null) {
          results.push({ title: match[2], url: match[1] });
        }
        return { success: true, results: results.slice(0, 10) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  web_fetch: {
    description: '抓取网页内容',
    parameters: { url: 'string' },
    execute: async ({ url }) => {
      try {
        const res = await fetch(url);
        const html = await res.text();
        // 简单提取文本
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { success: true, content: text.slice(0, 50000) };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  memory_search: {
    description: '搜索记忆',
    parameters: { query: 'string' },
    execute: async ({ query }) => {
      try {
        const memoryPath = config.memory.path;
        const { readdir } = await import('node:fs/promises');
        const files = await readdir(memoryPath).catch(() => []);
        const results = [];
        for (const file of files) {
          if (file.endsWith('.md')) {
            const content = await readFile(`${memoryPath}/${file}`, 'utf-8');
            if (content.toLowerCase().includes(query.toLowerCase())) {
              results.push({ file, snippet: content.slice(0, 200) });
            }
          }
        }
        return { success: true, results };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  memory_get: {
    description: '读取记忆文件',
    parameters: { path: 'string' },
    execute: async ({ path }) => {
      try {
        const fullPath = path.startsWith('/') ? path : `${config.memory.path}/${path}`;
        const content = await readFile(fullPath, 'utf-8');
        return { success: true, content };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  },

  memory_append: {
    description: '追加记忆',
    parameters: { path: 'string', content: 'string' },
    execute: async ({ path, content }) => {
      try {
        const fullPath = path.startsWith('/') ? path : `${config.memory.path}/${path}`;
        await appendFile(fullPath, content + '\n', 'utf-8');
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
  }
};

export function getTools() {
  return tools;
}

// ============================================================================
// LLM 调用
// ============================================================================

export async function callLLM(messages, tools) {
  const { llm } = config;
  
  // 构建 tool definitions
  const toolDefinitions = Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([k, v]) => [k, { type: 'string' }])
        ),
        required: Object.keys(tool.parameters)
      }
    }
  }));

  const payload = {
    model: llm.model,
    messages,
    tools: toolDefinitions,
    tool_choice: 'auto'
  };

  const res = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llm.apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`LLM API error: ${res.status} ${error}`);
  }

  const data = await res.json();
  return data.choices[0].message;
}

// ============================================================================
// Agent 主循环
// ============================================================================

export async function agentLoop(userMessage, conversationHistory = []) {
  const messages = [
    { role: 'system', content: config.system },
    ...conversationHistory,
    { role: 'user', content: userMessage }
  ];

  let maxIterations = 10;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    
    // 调用 LLM
    const response = await callLLM(messages, tools);
    
    // 检查是否有工具调用
    if (response.tool_calls && response.tool_calls.length > 0) {
      // 执行工具调用
      const toolResults = [];
      for (const toolCall of response.tool_calls) {
        const { name, arguments: argsStr } = toolCall.function;
        const args = JSON.parse(argsStr || '{}');
        
        console.log(`🔧 使用工具：${name}`, args);
        
        const tool = tools[name];
        if (!tool) {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: Unknown tool "${name}"`
          });
          continue;
        }

        try {
          const result = await tool.execute(args);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result, null, 2)
          });
        } catch (e) {
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${e.message}`
          });
        }
      }

      // 将工具结果添加回对话
      messages.push(response);
      messages.push(...toolResults);
      
      // 继续循环让 LLM 处理工具结果
      continue;
    }

    // 没有工具调用，返回最终回复
    return response.content;
  }

  return '达到最大迭代次数，未能完成任务。';
}

// ============================================================================
// 会话管理
// ============================================================================

const sessions = new Map();

export function getSession(sessionKey) {
  if (!sessions.has(sessionKey)) {
    sessions.set(sessionKey, []);
  }
  return sessions.get(sessionKey);
}

export function addToSession(sessionKey, role, content) {
  const session = getSession(sessionKey);
  session.push({ role, content });
  // 保留最近 20 条消息
  if (session.length > 40) {
    session.splice(0, session.length - 40);
  }
}
