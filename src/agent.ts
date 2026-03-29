#!/usr/bin/env node
/**
 * TinyPaw Agent Core
 * 极简 Agent 核心 - LLM 驱动的工具调用 agent
 */

import { readFile } from 'node:fs/promises';
import { platform, release, arch } from 'node:os';
import { SessionManager, getDefaultManager } from './session-manager.js';
import { formatError, withTimeout } from './retry.js';
import { estimateConversationTokens, trimConversation, TokenCounter, getDefaultCounter } from './token-manager.js';
import { SkillLoader, getDefaultLoader, initializeSkills } from './skill-loader.js';
import { createTools, buildToolDefinitions, Tool, ToolResult } from './tools.js';
import { callLLM as callLLMBase, hasToolCalls, Message, LLMResponse, ToolDefinition, ToolCall } from './llm.js';
import {
  decideHeartbeat,
  buildHeartbeatPrompt,
  startHeartbeatTimer,
  stopHeartbeatTimer,
  HeartbeatConfig
} from './heartbeat.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface LLMConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface WorkspaceConfig {
  path: string;
}

export interface Config {
  llm: LLMConfig;
  workspace: WorkspaceConfig;
  heartbeat?: HeartbeatConfig;
  tokenLimit?: number;
  retryAttempts?: number;
}

// 导出类型（供外部使用）
export { Tool, ToolResult } from './tools.js';
export { HeartbeatTasks, HeartbeatConfig } from './heartbeat.js';
export { Message, LLMResponse, ToolCall, ToolDefinition } from './llm.js';

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
  workspace: {
    path: './workspace'
  },
  heartbeat: {
    enabled: true,
    intervalMinutes: 30
  },
  tokenLimit: 128000,
  retryAttempts: 3
};

// 全局会话管理器和 token 计数器
let sessionManager: SessionManager | null = null;
let tokenCounter: TokenCounter | null = null;
let skillLoader: SkillLoader | null = null;
let tools: Record<string, Tool> | null = null;
let isAgentBusy = false;  // 标记 agent 是否正在执行用户对话

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
    // 使用配置中的 workspace path
    const workspacePath = config.workspace?.path || './workspace';
    sessionManager = getDefaultManager({
      storagePath: `${workspacePath}/memory/sessions`,
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

/**
 * 获取工具集
 */
export function getTools(): Record<string, Tool> {
  if (!tools) {
    tools = createTools(() => config.workspace?.path || './workspace');
  }
  return tools;
}

/**
 * 检查 agent 是否正在执行用户对话
 */
export function isAgentBusyNow(): boolean {
  return isAgentBusy;
}

/**
 * 设置 agent 状态（由 CLI 调用）
 */
export function setAgentBusy(busy: boolean): void {
  isAgentBusy = busy;
}

/**
 * 获取 OS 平台信息
 */
export function getOSInfo(): string {
  const p = platform();
  const r = release();
  const a = arch();
  
  // 映射到友好名称
  const osNames: Record<string, string> = {
    'darwin': 'macOS',
    'win32': 'Windows',
    'linux': 'Linux'
  };
  
  const osName = osNames[p] || p;
  
  // 获取时区
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  // Linux 发行版检测
  if (p === 'linux') {
    return `${osName} (${r}) ${a}\nTimezone: ${timezone}`;
  }
  
  return `${osName} ${r} ${a}\nTimezone: ${timezone}`;
}

/**
 * 获取当前时间字符串（使用系统时区）
 */
export function getCurrentTime(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatted = now.toLocaleString('sv-SE', { 
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `${formatted} (${timezone})`;
}

// ============================================================================
// LLM 调用
// ============================================================================

/**
 * Agent 专用 LLM 调用（带 token 管理）
 */
export async function callLLM(messages: Message[], tools: Record<string, Tool>): Promise<LLMResponse> {
  const { llm, tokenLimit = 128000, retryAttempts = 3 } = config;
  
  // Token 管理：裁剪过长的对话
  const trimmedMessages = trimConversation(messages, {
    maxTokens: tokenLimit,
    reserveTokens: 4000,
    minMessages: 5
  });
  
  const tokenUsage = estimateConversationTokens(trimmedMessages);
  console.log(`[Token] 使用 ${tokenUsage} / ${tokenLimit} tokens`);
  
  const toolDefinitions = buildToolDefinitions(tools);
  
  // 调用基础 LLM 函数
  const response = await callLLMBase(
    {
      model: llm.model,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl
    },
    trimmedMessages,
    {
      tools: toolDefinitions,
      toolChoice: 'auto',
      retryAttempts,
      timeoutMs: 60000
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
export async function buildSystemPrompt(): Promise<string> {
  const parts: string[] = [];
  
  // 添加 OS 平台信息
  const osInfo = getOSInfo();
  parts.push(`# Environment

Platform: ${osInfo}`);
  
  // 读取 AGENTS.md 作为基础
  const agentsPath = `${config.workspace.path}/AGENTS.md`;
  try {
    const agentsContent = await readFile(agentsPath, 'utf-8');
    parts.push(agentsContent.trim());
  } catch (e) {
    // AGENTS.md 不存在，使用默认 prompt
    parts.push('# Agent Instructions\n\nYou are a helpful AI assistant. Be concise, accurate, and friendly.');
  }
  
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
  const systemPrompt = await buildSystemPrompt();
  
  // 添加时间信息到用户消息
  const currentTime = getCurrentTime();
  const enrichedMessage = `Current Time: ${currentTime}\n\n${userMessage}`;
  
  // 构建消息数组：system + 会话历史 + 用户消息
  const messages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...sessionMessages,
    { role: 'user', content: enrichedMessage }
  ];

  const tools = getTools();
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

// ============================================================================
// 心跳机制
// ============================================================================

/**
 * 执行心跳任务（两阶段：Decision → Execution）
 */
export async function executeHeartbeat(): Promise<void> {
  // 用户对话中，跳过心跳
  if (isAgentBusy) {
    console.log('[Heartbeat] 用户对话中，跳过');
    return;
  }
  
  const workspacePath = config.workspace?.path || './workspace';
  const heartbeatPath = `${workspacePath}/HEARTBEAT.md`;
  
  // 读取 HEARTBEAT.md 内容
  let heartbeatContent: string;
  try {
    heartbeatContent = await readFile(heartbeatPath, 'utf-8');
  } catch (e) {
    console.log('[Heartbeat] HEARTBEAT.md 不存在或无法读取，跳过');
    return;
  }
  
  console.log('[Heartbeat] 检查任务...');
  
  // Phase 1: Decision - LLM 判断是否需要执行
  const decision = await decideHeartbeat(heartbeatContent, config.llm);
  
  if (decision.action !== 'run') {
    console.log('[Heartbeat] 无需执行，跳过');
    return;
  }
  
  console.log(`[Heartbeat] 执行任务: ${decision.tasks}`);
  
  // Phase 2: Execution - 执行任务
  const taskPrompt = buildHeartbeatPrompt(decision.tasks);
  
  try {
    const heartbeatSessionKey = 'heartbeat';
    const response = await agentLoop(taskPrompt, heartbeatSessionKey);
    console.log('\n[Heartbeat] 结果:', response);
  } catch (e) {
    console.error('[Heartbeat] 执行失败:', (e as Error).message);
  }
}

/**
 * 启动心跳定时器
 */
export function startHeartbeat(): void {
  const heartbeatConfig = config.heartbeat || { enabled: true, intervalMinutes: 30 };
  startHeartbeatTimer(heartbeatConfig, executeHeartbeat);
}

/**
 * 停止心跳定时器
 */
export function stopHeartbeat(): void {
  stopHeartbeatTimer();
}