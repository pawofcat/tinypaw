#!/usr/bin/env node
/**
 * Token 管理工具
 * 用于计算和管理对话 token 数量
 */

import type { Message } from './agent.js';

/**
 * 估算文本的 token 数量
 * 简化算法：英文每 4 字符 1 token，中文每 1.5 字符 1 token
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  const englishChars = (text.match(/[a-zA-Z0-9\s]/g) || []).length;
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - englishChars - chineseChars;
  
  // 英文约 4 字符/token，中文约 1.5 字符/token
  return Math.ceil(englishChars / 4 + chineseChars / 1.5 + otherChars / 2);
}

/**
 * 估算消息的 token 数量
 */
export function estimateMessageTokens(message: Message): number {
  let tokens = 0;
  
  // role 消耗
  tokens += estimateTokens(message.role);
  
  // content 消耗
  tokens += estimateTokens(message.content);
  
  // tool_call_id 消耗（如果有）
  if (message.tool_call_id) {
    tokens += estimateTokens(message.tool_call_id);
  }
  
  // 额外开销（OpenAI 格式）
  tokens += 4;
  
  return tokens;
}

/**
 * 估算对话历史的总 token 数量
 */
export function estimateConversationTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export interface TokenLimitOptions {
  maxTokens: number;
  reserveTokens: number;  // 预留给 response 的 token
  minMessages: number;    // 最少保留的消息数
}

/**
 * 裁剪对话历史以适应 token 限制
 * 保留 system prompt 和最近的消息
 */
export function trimConversation(
  messages: Message[],
  options: TokenLimitOptions
): Message[] {
  const { maxTokens, reserveTokens, minMessages = 2 } = options;
  const targetMaxTokens = maxTokens - reserveTokens;
  
  if (messages.length === 0) {
    return messages;
  }
  
  // 分离 system prompt 和其他消息
  const systemMessages = messages.filter(m => m.role === 'system');
  const otherMessages = messages.filter(m => m.role !== 'system');
  
  // 如果 system + 最少消息已经超限，返回精简版
  const systemTokens = estimateConversationTokens(systemMessages);
  const minMessagesSlice = otherMessages.slice(-minMessages);
  const minTotalTokens = systemTokens + estimateConversationTokens(minMessagesSlice);
  
  if (minTotalTokens <= targetMaxTokens) {
    // 从后往前累加，直到接近限制
    let tokens = systemTokens;
    const result = [...systemMessages];
    
    for (let i = otherMessages.length - 1; i >= 0; i--) {
      const msg = otherMessages[i];
      const msgTokens = estimateMessageTokens(msg);
      
      if (tokens + msgTokens <= targetMaxTokens) {
        result.splice(systemMessages.length, 0, msg);
        tokens += msgTokens;
      } else {
        break;
      }
    }
    
    return result;
  }
  
  // 如果最少消息也超限，返回 system + 最后一条
  return [...systemMessages, otherMessages[otherMessages.length - 1]].filter(Boolean);
}

/**
 * Token 计数器类
 */
export class TokenCounter {
  private totalTokens: number = 0;
  private requestCount: number = 0;
  
  /**
   * 记录一次请求的 token 使用
   */
  recordUsage(promptTokens: number, completionTokens: number): void {
    this.totalTokens += promptTokens + completionTokens;
    this.requestCount++;
  }
  
  /**
   * 获取总 token 使用量
   */
  getTotalTokens(): number {
    return this.totalTokens;
  }
  
  /**
   * 获取请求次数
   */
  getRequestCount(): number {
    return this.requestCount;
  }
  
  /**
   * 重置计数
   */
  reset(): void {
    this.totalTokens = 0;
    this.requestCount = 0;
  }
  
  /**
   * 获取使用统计
   */
  getStats(): {
    totalTokens: number;
    requestCount: number;
    avgTokensPerRequest: number;
  } {
    return {
      totalTokens: this.totalTokens,
      requestCount: this.requestCount,
      avgTokensPerRequest: this.requestCount > 0 
        ? Math.round(this.totalTokens / this.requestCount) 
        : 0
    };
  }
}

// 默认计数器
const defaultCounter = new TokenCounter();

export function getDefaultCounter(): TokenCounter {
  return defaultCounter;
}
