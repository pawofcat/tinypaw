#!/usr/bin/env node
/**
 * TinyPaw LLM Client
 * 统一的 LLM API 调用封装
 */

import fetch from 'node-fetch';
import { withRetry, withTimeout, isNetworkError, isRateLimitError, sleep } from './retry.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface LLMConfig {
  model: string;
  apiKey: string;
  baseUrl: string;
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

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  retryAttempts?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ============================================================================
// LLM Client
// ============================================================================

/**
 * 调用 LLM API（带重试和超时）
 */
export async function callLLM(
  config: LLMConfig,
  messages: Message[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const {
    maxTokens,
    temperature,
    timeoutMs = 60000,
    retryAttempts = 3,
    tools,
    toolChoice = 'auto'
  } = options;

  const payload: any = {
    model: config.model,
    messages
  };

  if (maxTokens) payload.max_tokens = maxTokens;
  if (temperature !== undefined) payload.temperature = temperature;
  if (tools) {
    payload.tools = tools;
    payload.tool_choice = toolChoice;
  }

  const response = await withRetry(
    async () => {
      const res = await withTimeout(
        () => fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs)
        }),
        timeoutMs,
        'LLM API 请求超时'
      );

      if (!res.ok) {
        const errorText = await res.text();
        const error = new Error(`LLM API error: ${res.status} ${errorText}`);
        
        // 检查是否是限流错误
        if (res.status === 429 || isRateLimitError(errorText)) {
          console.warn('[LLM] 触发限流，等待后重试...');
          await sleep(5000);
        }
        
        throw error;
      }

      const data = await res.json() as any;
      return {
        message: data.choices[0]?.message as LLMResponse,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens || 0,
          completionTokens: data.usage.completion_tokens || 0,
          totalTokens: data.usage.total_tokens || 0
        } : undefined
      };
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

  return response.message;
}

/**
 * 解析 tool call 参数
 */
export function parseToolCallArgs(toolCall: ToolCall): Record<string, any> {
  try {
    return JSON.parse(toolCall.function.arguments || '{}');
  } catch {
    return {};
  }
}

/**
 * 获取第一个 tool call 的参数
 */
export function getFirstToolCallArgs(response: LLMResponse): Record<string, any> | null {
  if (!response.tool_calls || response.tool_calls.length === 0) {
    return null;
  }
  return parseToolCallArgs(response.tool_calls[0]);
}

/**
 * 检查响应是否有 tool calls
 */
export function hasToolCalls(response: LLMResponse): boolean {
  return !!response.tool_calls && response.tool_calls.length > 0;
}

// ============================================================================
// 工具定义辅助函数
// ============================================================================

/**
 * 创建简单的工具定义
 */
export function createToolDefinition(
  name: string,
  description: string,
  parameters: Record<string, { type: string; description?: string; enum?: string[] }>,
  required: string[] = []
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: parameters,
        required
      }
    }
  };
}