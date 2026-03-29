#!/usr/bin/env node
/**
 * TinyPaw Agent Core
 * 极简 Agent 核心 - LLM 驱动的工具调用 agent
 */

import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';
import { SessionManager, getDefaultManager } from './session-manager.js';
import { withRetry, withTimeout, isNetworkError, isRateLimitError, formatError, sleep } from './retry.js';
import { estimateConversationTokens, trimConversation, TokenCounter, getDefaultCounter } from './token-manager.js';
import { SkillLoader, getDefaultLoader, initializeSkills } from './skill-loader.js';

const exec = promisify(execCb);

// ============================================================================
// 类型定义
// ============================================================================

export interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface MemoryConfig {
  path: string;
}

export interface Config {
  llm: LLMConfig;
  memory: MemoryConfig;
  system: string;
  tokenLimit?: number;  // 最大 token 数（默认 128000）
  retryAttempts?: number;  // 重试次数（默认 3）
}

export interface ToolParameter {
  [key: string]: string;
}

export interface Tool {
  description: string;
  parameters: ToolParameter;
  execute: (args: any) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  content?: string;
  path?: string;
  stdout?: string;
  stderr?: string;
  results?: Array<{ title: string; url: string } | { file: string; snippet: string }>;
  error?: string;
  file?: string;
  snippet?: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string }>;
      required: string[];
    };
  };
}

export interface MemorySearchResult {
  file: string;
  snippet: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
}

// ============================================================================
// 配置
// ============================================================================

let config: Config = {
  llm: {
    provider: 'openai',
    model: 'qwen3.5-plus',
    apiKey: process.env.LLM_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1'
  },
  memory: {
    path: './workspace/memory'
  },
  system: `你是一个 helpful 的 AI 助手。使用提供的工具来完成任务。
思考过程要简洁，直接给出答案和行动。`,
  tokenLimit: 128000,
  retryAttempts: 3
};

// 全局会话管理器和 token 计数器
let sessionManager: SessionManager | null = null;
let tokenCounter: TokenCounter | null = null;
let skillLoader: SkillLoader | null = null;

export async function loadConfig(path = './config.json'): Promise<Config> {
  try {
    const content = await readFile(path, 'utf-8');
    config = { ...config, ...JSON.parse(content) };
  } catch (e) {
    // 使用默认配置
  }
  return config;
}

export function getConfig(): Config {
  return config;
}

/**
 * 设置会话管理器（由 CLI 初始化）
 */
export function setSessionManager(manager: SessionManager): void {
  sessionManager = manager;
}

/**
 * 初始化会话管理器
 */
export async function initializeSessionStore(storagePath?: string): Promise<SessionManager> {
  if (!sessionManager) {
    sessionManager = new SessionManager(storagePath ? { storagePath } : undefined);
    await sessionManager.initialize();
  }
  return sessionManager;
}

/**
 * 获取会话管理器
 */
export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    // 使用配置中的 memory path
    const memoryPath = config.memory?.path || './workspace/memory';
    sessionManager = getDefaultManager({
      storagePath: `${memoryPath}/sessions`,
      maxTokens: config.tokenLimit || 128000
    });
  }
  return sessionManager;
}

/**
 * 获取 token 计数器
 */
export function getTokenCounter(): TokenCounter {
  if (!tokenCounter) {
    tokenCounter = getDefaultCounter();
  }
  return tokenCounter;
}

/**
 * 设置技能加载器（由 CLI 初始化）
 */
export function setSkillLoader(loader: SkillLoader): void {
  skillLoader = loader;
}

/**
 * 初始化技能加载器
 */
export async function initializeSkillLoader(skillsPath?: string): Promise<SkillLoader> {
  if (!skillLoader) {
    skillLoader = await initializeSkills(skillsPath);
  }
  return skillLoader;
}

/**
 * 获取技能加载器
 */
export function getSkillLoader(): SkillLoader {
  if (!skillLoader) {
    skillLoader = getDefaultLoader();
  }
  return skillLoader;
}

// ============================================================================
// 工具系统
// ============================================================================

const tools: Record<string, Tool> = {
  read: {
    description: '读取文件内容',
    parameters: { path: 'string' },
    execute: async ({ path }: { path: string }): Promise<ToolResult> => {
      try {
        const content = await readFile(path, 'utf-8');
        return { success: true, content: content.slice(0, 50000) };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  write: {
    description: '写入文件内容',
    parameters: { path: 'string', content: 'string' },
    execute: async ({ path, content }: { path: string; content: string }): Promise<ToolResult> => {
      try {
        await writeFile(path, content, 'utf-8');
        return { success: true, path };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  edit: {
    description: '编辑文件（替换文本）',
    parameters: { path: 'string', oldText: 'string', newText: 'string' },
    execute: async ({ path, oldText, newText }: { path: string; oldText: string; newText: string }): Promise<ToolResult> => {
      try {
        const content = await readFile(path, 'utf-8');
        const updated = content.replace(oldText, newText);
        await writeFile(path, updated, 'utf-8');
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  exec: {
    description: '执行 shell 命令',
    parameters: { command: 'string' },
    execute: async ({ command }: { command: string }): Promise<ToolResult> => {
      try {
        const { stdout, stderr } = await exec(command, { timeout: 60000 });
        return { success: true, stdout, stderr };
      } catch (e) {
        const error = e as Error & { stdout?: string; stderr?: string };
        return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
      }
    }
  },

  web_search: {
    description: '网络搜索',
    parameters: { query: 'string' },
    execute: async ({ query }: { query: string }): Promise<ToolResult> => {
      try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const res = await fetch(url);
        const html = await res.text();
        const results: WebSearchResult[] = [];
        const titleRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
        let match;
        while ((match = titleRegex.exec(html)) !== null) {
          results.push({ title: match[2], url: match[1] });
        }
        return { success: true, results: results.slice(0, 10) };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  web_fetch: {
    description: '抓取网页内容',
    parameters: { url: 'string' },
    execute: async ({ url }: { url: string }): Promise<ToolResult> => {
      try {
        const res = await fetch(url);
        const html = await res.text();
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return { success: true, content: text.slice(0, 50000) };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  memory_search: {
    description: '搜索记忆',
    parameters: { query: 'string' },
    execute: async ({ query }: { query: string }): Promise<ToolResult> => {
      try {
        const memoryPath = config.memory.path;
        const files = await readdir(memoryPath).catch(() => []);
        const results: MemorySearchResult[] = [];
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
        return { success: false, error: (e as Error).message };
      }
    }
  },

  memory_get: {
    description: '读取记忆文件',
    parameters: { path: 'string' },
    execute: async ({ path }: { path: string }): Promise<ToolResult> => {
      try {
        const fullPath = path.startsWith('/') ? path : `${config.memory.path}/${path}`;
        const content = await readFile(fullPath, 'utf-8');
        return { success: true, content };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  },

  memory_append: {
    description: '追加记忆',
    parameters: { path: 'string', content: 'string' },
    execute: async ({ path, content }: { path: string; content: string }): Promise<ToolResult> => {
      try {
        const fullPath = path.startsWith('/') ? path : `${config.memory.path}/${path}`;
        await appendFile(fullPath, content + '\n', 'utf-8');
        return { success: true };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    }
  }
};

export function getTools(): Record<string, Tool> {
  return tools;
}

// ============================================================================
// LLM 调用
// ============================================================================

export async function callLLM(messages: Message[], tools: Record<string, Tool>): Promise<LLMResponse> {
  const { llm, tokenLimit = 128000, retryAttempts = 3 } = config;
  
  // Token 管理：裁剪过长的对话
  const trimmedMessages = trimConversation(messages, {
    maxTokens: tokenLimit,
    reserveTokens: 4000,  // 预留给 response
    minMessages: 5
  });

  // console.debug("trimmedMessages===>", trimmedMessages);
  
  const tokenUsage = estimateConversationTokens(trimmedMessages);
  console.log(`[Token] 使用 ${tokenUsage} / ${tokenLimit} tokens`);
  
  const toolDefinitions: ToolDefinition[] = Object.entries(tools).map(([name, tool]) => ({
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
    messages: trimmedMessages,
    tools: toolDefinitions,
    tool_choice: 'auto' as const
  };

  // 带重试的 API 调用
  const response = await withRetry(
    async () => {
      const res = await withTimeout(
        () => fetch(`${llm.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${llm.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(60000)  // 60 秒超时
        }),
        60000,
        'LLM API 请求超时'
      );

      if (!res.ok) {
        const errorText = await res.text();
        const error = new Error(`LLM API error: ${res.status} ${errorText}`);
        
        // 检查是否是限流错误
        if (res.status === 429 || isRateLimitError(errorText)) {
          console.warn('[LLM] 触发限流，等待后重试...');
          await sleep(5000);  // 限流时等待 5 秒
        }
        
        throw error;
      }

      const data = await res.json() as any;
      const message = data.choices[0].message as LLMResponse;
      
      // 记录 token 使用
      const usage = data.usage;
      if (usage) {
        getTokenCounter().recordUsage(usage.prompt_tokens || 0, usage.completion_tokens || 0);
      }
      
      return message;
    },
    {
      maxRetries: retryAttempts,
      initialDelay: 1000,
      maxDelay: 30000,
      factor: 2,
      onRetry: (error, attempt) => {
        if (isNetworkError(error)) {
          console.log(`[LLM] 网络错误，第 ${attempt} 次重试...`);
        }
      }
    }
  );

  return response;
}

// ============================================================================
// Agent 主循环
// ============================================================================

/**
 * 构建分层的 System Prompt（渐进式披露）
 */
export function buildSystemPrompt(): string {
  const parts: string[] = [config.system];
  
  if (!skillLoader) {
    return parts.join('\n\n---\n\n');
  }
  
  // Level 1: 加载 always 技能的完整内容（用 XML 标签包裹）
  const alwaysContent = skillLoader.loadAlwaysSkillsContent();
  if (alwaysContent) {
    parts.push(`# Active Skills

The following skills are always loaded into your context:

${alwaysContent}`);
  }
  
  // Level 2: 其他技能只加载摘要 (JSON 格式，排除 always 技能)
  const summary = skillLoader.buildSkillsSummary(true);
  if (summary && summary !== '{"skills":[]}') {
    parts.push(`# Available Skills

The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read tool.
Skills with available=false need dependencies installed first.

\`\`\`json
${summary}
\`\`\``);
  }
  
  return parts.join('\n\n---\n\n');
}

export async function agentLoop(
  userMessage: string,
  sessionKey?: string
): Promise<string> {
  const manager = getSessionManager();
  const currentSessionKey = sessionKey || manager.getCurrentSessionKey();
  
  // 获取当前会话消息（不包含 system）
  const sessionMessages = manager.getSession(currentSessionKey);
  
  // 构建分层 system prompt（渐进式披露）
  const systemPrompt = buildSystemPrompt();
  
  // 构建消息数组：system + 会话历史 + 用户消息
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...sessionMessages,
    { role: 'user', content: userMessage }
  ];

  const maxIterations = 10;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    
    try {
      const response = await callLLM(messages, tools);
      
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolResults: Message[] = [];
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
            const result = await withTimeout(
              () => tool.execute(args),
              30000,  // 工具执行 30 秒超时
              `工具 ${name} 执行超时`
            );
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result, null, 2).slice(0, 10000)  // 限制结果长度
            });
          } catch (e) {
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${formatError(e)}`
            });
          }
        }

        messages.push(response as Message);
        messages.push(...toolResults);
        continue;
      }

      const reply = response.content || '无回复';
      
      // 保存会话到管理器
      manager.addToSession('user', userMessage, currentSessionKey);
      manager.addToSession('assistant', reply, currentSessionKey);
      await manager.saveSession(currentSessionKey);
      
      return reply;
    } catch (e) {
      const errorMsg = formatError(e);
      console.error('[Agent] 错误:', errorMsg);
      
      // 保存错误到会话
      manager.addToSession('user', userMessage, currentSessionKey);
      manager.addToSession('assistant', `❌ 错误：${errorMsg}`, currentSessionKey);
      await manager.saveSession(currentSessionKey);
      
      return `❌ 处理请求时出错：${errorMsg}`;
    }
  }

  return '达到最大迭代次数，未能完成任务。';
}

// ============================================================================
// 会话管理兼容函数（已迁移到 session-manager.ts）
// ============================================================================
// 使用 SessionManager 替代 SessionStore
// 导出兼容函数以便向后兼容

export function getSession(sessionKey?: string): Message[] {
  const manager = getSessionManager();
  return manager.getSession(sessionKey);
}

export function addToSession(role: string, content: string, sessionKey?: string): void {
  const manager = getSessionManager();
  manager.addToSession(role, content, sessionKey);
}

export async function saveSession(sessionKey?: string): Promise<boolean> {
  const manager = getSessionManager();
  return manager.saveSession(sessionKey);
}

export function clearSession(sessionKey?: string): boolean {
  const manager = getSessionManager();
  return manager.resetSession(sessionKey).success;
}

export function listSessions(): import('./session-manager.js').SessionMeta[] {
  const manager = getSessionManager();
  return manager.listFiles();
}
