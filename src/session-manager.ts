#!/usr/bin/env node
/**
 * 会话管理器
 * 负责会话的创建、切换、删除、重置和上下文窗口控制
 */

import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './agent.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface SessionMeta {
  key: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  tokenCount: number;
}

export interface SessionData {
  meta: SessionMeta;
  messages: Message[];
}

export interface SessionManagerConfig {
  storagePath: string;
  maxTokens: number;        // 最大 token 数（上下文窗口）
  reserveTokens: number;    // 预留给 response 的 token
  maxMessages: number;      // 最大消息数（硬限制）
  minMessages: number;      // 最小保留消息数
}

export interface CommandResult {
  isCommand: boolean;
  command?: string;
  output?: string;
  shouldContinue: boolean;  // 命令是否需要继续执行（如 /new 后切换到新会话）
  newSessionKey?: string;   // 新会话 key（用于切换）
}

// ============================================================================
// Token 估算工具函数
// ============================================================================

/**
 * 估算消息的 token 数
 * 简化策略：英文 4 字符/token，中文 1.5 字符/token
 */
export function estimateMessageTokens(message: Message): number {
  const content = message.content || '';
  const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = content.length - chineseChars;
  
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

/**
 * 估算会话总 token 数
 */
export function estimateSessionTokens(messages: Message[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ============================================================================
// SessionManager 类
// ============================================================================

export class SessionManager {
  private config: SessionManagerConfig;
  private sessions: Map<string, SessionData>;
  private currentSessionKey: string;

  constructor(config: Partial<SessionManagerConfig> = {}) {
    this.config = {
      storagePath: config.storagePath || './memory/sessions',
      maxTokens: config.maxTokens || 128000,
      reserveTokens: config.reserveTokens || 4000,
      maxMessages: config.maxMessages || 100,
      minMessages: config.minMessages || 5
    };
    this.sessions = new Map();
    this.currentSessionKey = 'default';
  }

  /**
   * 初始化存储目录并加载现有会话
   */
  async initialize(): Promise<void> {
    // 确保存储目录存在
    await mkdir(this.config.storagePath, { recursive: true }).catch(() => {});
    
    // 加载现有会话
    await this.loadAllSessions();
    
    // 确保 default 会话存在
    if (!this.sessions.has('default')) {
      this.getSession('default');
    }
    
    console.log(`[SessionManager] 已加载 ${this.sessions.size} 个会话，当前会话：${this.currentSessionKey}`);
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(sessionKey: string): string {
    return join(this.config.storagePath, `${sessionKey}.json`);
  }

  /**
   * 加载所有会话
   */
  async loadAllSessions(): Promise<void> {
    try {
      const files = await readdir(this.config.storagePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        const sessionKey = file.replace('.json', '');
        try {
          await this.loadSession(sessionKey);
        } catch (e) {
          console.warn(`[SessionManager] 加载会话 ${sessionKey} 失败：`, (e as Error).message);
        }
      }
    } catch (e) {
      console.warn('[SessionManager] 读取会话目录失败：', (e as Error).message);
    }
  }

  /**
   * 加载单个会话
   */
  async loadSession(sessionKey: string): Promise<SessionData | null> {
    const filePath = this.getSessionFilePath(sessionKey);
    
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as SessionData;
      this.sessions.set(sessionKey, data);
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 获取当前会话 key
   */
  getCurrentSessionKey(): string {
    return this.currentSessionKey;
  }

  /**
   * 设置当前会话 key
   */
  setCurrentSessionKey(key: string): void {
    this.currentSessionKey = key;
  }

  /**
   * 获取会话（如果不存在则创建）
   */
  getSession(sessionKey: string = this.currentSessionKey): Message[] {
    if (!this.sessions.has(sessionKey)) {
      const now = Date.now();
      const sessionData: SessionData = {
        meta: {
          key: sessionKey,
          createdAt: now,
          updatedAt: now,
          messageCount: 0,
          tokenCount: 0
        },
        messages: []
      };
      this.sessions.set(sessionKey, sessionData);
    }
    return this.sessions.get(sessionKey)!.messages;
  }

  /**
   * 获取当前会话
   */
  getCurrentSession(): Message[] {
    return this.getSession(this.currentSessionKey);
  }

  /**
   * 添加消息到会话（带 token 控制）
   */
  addToSession(role: string, content: string, sessionKey: string = this.currentSessionKey): void {
    const session = this.getSession(sessionKey);
    const newMessage: Message = { role: role as Message['role'], content };
    
    session.push(newMessage);
    
    const data = this.sessions.get(sessionKey)!;
    data.meta.updatedAt = Date.now();
    data.meta.messageCount = session.length;
    data.meta.tokenCount = estimateSessionTokens(session);
    
    // 应用上下文窗口控制
    this.enforceContextWindow(sessionKey);
  }

  /**
   * 上下文窗口控制
   * 当 token 数或消息数超过限制时，自动裁剪旧消息
   */
  enforceContextWindow(sessionKey: string = this.currentSessionKey): void {
    const session = this.getSession(sessionKey);
    const data = this.sessions.get(sessionKey)!;
    
    if (session.length === 0) return;

    // 保留 system 消息
    const systemMessage = session.find(m => m.role === 'system');
    const nonSystemMessages = session.filter(m => m.role !== 'system');
    
    // 策略 1：消息数限制
    if (nonSystemMessages.length > this.config.maxMessages) {
      const keepCount = Math.max(this.config.minMessages, Math.floor(this.config.maxMessages * 0.7));
      const trimmed = nonSystemMessages.slice(-keepCount);
      session.length = 0;
      if (systemMessage) session.push(systemMessage);
      session.push(...trimmed);
      console.log(`[SessionManager] 消息数超限，裁剪到 ${trimmed.length} 条`);
    }
    
    // 策略 2：Token 限制
    const currentTokens = estimateSessionTokens(session);
    const targetTokens = this.config.maxTokens - this.config.reserveTokens;
    
    if (currentTokens > targetTokens) {
      // 从旧到新删除，直到 token 数在限制内
      let i = systemMessage ? 1 : 0;
      while (i < session.length && estimateSessionTokens(session.slice(i)) > targetTokens) {
        i++;
      }
      
      if (i > 0) {
        const trimmed = session.slice(i);
        session.length = 0;
        if (systemMessage) session.push(systemMessage);
        session.push(...trimmed);
        console.log(`[SessionManager] Token 超限，裁剪 ${i} 条旧消息`);
      }
    }
    
    // 更新元数据
    data.meta.messageCount = session.length;
    data.meta.tokenCount = estimateSessionTokens(session);
    data.meta.updatedAt = Date.now();
  }

  /**
   * 保存会话到磁盘
   */
  async saveSession(sessionKey: string = this.currentSessionKey): Promise<boolean> {
    const data = this.sessions.get(sessionKey);
    if (!data) {
      return false;
    }

    try {
      const filePath = this.getSessionFilePath(sessionKey);
      const content = JSON.stringify(data, null, 2);
      await writeFile(filePath, content, 'utf-8');
      return true;
    } catch (e) {
      console.error(`[SessionManager] 保存会话 ${sessionKey} 失败：`, (e as Error).message);
      return false;
    }
  }

  /**
   * 保存所有会话
   */
  async saveAllSessions(): Promise<void> {
    const savePromises = Array.from(this.sessions.keys()).map(key => this.saveSession(key));
    await Promise.all(savePromises);
    console.log(`[SessionManager] 已保存 ${this.sessions.size} 个会话`);
  }

  /**
   * 创建新会话
   */
  createSession(sessionKey: string): { success: boolean; error?: string } {
    if (this.sessions.has(sessionKey)) {
      return { success: false, error: `会话 "${sessionKey}" 已存在` };
    }

    const now = Date.now();
    const sessionData: SessionData = {
      meta: {
        key: sessionKey,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        tokenCount: 0
      },
      messages: []
    };
    this.sessions.set(sessionKey, sessionData);
    this.currentSessionKey = sessionKey;
    
    return { success: true };
  }

  /**
   * 切换会话
   */
  switchSession(sessionKey: string): { success: boolean; error?: string } {
    if (!this.sessions.has(sessionKey)) {
      return { success: false, error: `会话 "${sessionKey}" 不存在` };
    }
    
    this.currentSessionKey = sessionKey;
    return { success: true };
  }

  /**
   * 重置会话（清空历史，保留 system）
   */
  resetSession(sessionKey: string = this.currentSessionKey): { success: boolean; error?: string } {
    const data = this.sessions.get(sessionKey);
    if (!data) {
      return { success: false, error: `会话 "${sessionKey}" 不存在` };
    }

    // 保留 system 消息
    const systemMessage = data.messages.find(m => m.role === 'system');
    data.messages = systemMessage ? [systemMessage] : [];
    data.meta.updatedAt = Date.now();
    data.meta.messageCount = data.messages.length;
    data.meta.tokenCount = 0;
    
    return { success: true };
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionKey: string): Promise<{ success: boolean; error?: string }> {
    if (sessionKey === 'default') {
      return { success: false, error: '不能删除 default 会话' };
    }
    
    if (!this.sessions.has(sessionKey)) {
      return { success: false, error: `会话 "${sessionKey}" 不存在` };
    }

    try {
      this.sessions.delete(sessionKey);
      
      // 删除文件
      const filePath = this.getSessionFilePath(sessionKey);
      await rm(filePath, { force: true });
      
      // 如果删除的是当前会话，切换到 default
      if (this.currentSessionKey === sessionKey) {
        this.currentSessionKey = 'default';
      }
      
      return { success: true };
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  /**
   * 列出所有会话
   */
  listSessions(): SessionMeta[] {
    return Array.from(this.sessions.values())
      .map(s => s.meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 获取会话信息
   */
  getSessionInfo(sessionKey: string = this.currentSessionKey): SessionMeta | null {
    const data = this.sessions.get(sessionKey);
    return data ? { ...data.meta } : null;
  }

  /**
   * 解析并执行命令
   */
  async parseCommand(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return { isCommand: false, shouldContinue: false };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (command) {
      case 'new': {
        const sessionKey = args[0] || `session_${Date.now()}`;
        const result = this.createSession(sessionKey);
        if (result.success) {
          await this.saveSession(sessionKey);
          return {
            isCommand: true,
            command: 'new',
            output: `✅ 已创建新会话 "${sessionKey}" 并切换`,
            shouldContinue: true,
            newSessionKey: sessionKey
          };
        } else {
          return {
            isCommand: true,
            command: 'new',
            output: `❌ ${result.error}`,
            shouldContinue: false
          };
        }
      }

      case 'switch':
      case 'sw': {
        const sessionKey = args[0];
        if (!sessionKey) {
          return {
            isCommand: true,
            command: 'switch',
            output: '❌ 用法：/switch <会话名>',
            shouldContinue: false
          };
        }
        const result = this.switchSession(sessionKey);
        if (result.success) {
          return {
            isCommand: true,
            command: 'switch',
            output: `✅ 已切换到会话 "${sessionKey}"`,
            shouldContinue: true,
            newSessionKey: sessionKey
          };
        } else {
          return {
            isCommand: true,
            command: 'switch',
            output: `❌ ${result.error}`,
            shouldContinue: false
          };
        }
      }

      case 'reset': {
        const result = this.resetSession();
        if (result.success) {
          await this.saveSession();
          return {
            isCommand: true,
            command: 'reset',
            output: '✅ 已重置当前会话',
            shouldContinue: false
          };
        } else {
          return {
            isCommand: true,
            command: 'reset',
            output: `❌ ${result.error}`,
            shouldContinue: false
          };
        }
      }

      case 'delete':
      case 'del': {
        const sessionKey = args[0];
        if (!sessionKey) {
          return {
            isCommand: true,
            command: 'delete',
            output: '❌ 用法：/delete <会话名>',
            shouldContinue: false
          };
        }
        const result = await this.deleteSession(sessionKey);
        if (result.success) {
          return {
            isCommand: true,
            command: 'delete',
            output: `✅ 已删除会话 "${sessionKey}"`,
            shouldContinue: false
          };
        } else {
          return {
            isCommand: true,
            command: 'delete',
            output: `❌ ${result.error}`,
            shouldContinue: false
          };
        }
      }

      case 'list':
      case 'ls': {
        const sessions = this.listFiles();
        const current = this.currentSessionKey;
        const output = sessions
          .map(s => {
            const marker = s.key === current ? '👉 ' : '   ';
            const timeAgo = this.formatTimeAgo(s.updatedAt);
            return `${marker}${s.key} (${s.messageCount} 条消息，${s.tokenCount} tokens) - ${timeAgo}`;
          })
          .join('\n');
        return {
          isCommand: true,
          command: 'list',
          output: `📋 会话列表:\n${output}`,
          shouldContinue: false
        };
      }

      case 'info': {
        const info = this.getSessionInfo();
        if (!info) {
          return {
            isCommand: true,
            command: 'info',
            output: '❌ 无法获取会话信息',
            shouldContinue: false
          };
        }
        const timeAgo = this.formatTimeAgo(info.updatedAt);
        const output = [
          `📊 当前会话：${info.key}`,
          `   消息数：${info.messageCount}`,
          `   Token 数：~${info.tokenCount}`,
          `   创建时间：${new Date(info.createdAt).toLocaleString('zh-CN')}`,
          `   最后更新：${timeAgo}`
        ].join('\n');
        return {
          isCommand: true,
          command: 'info',
          output,
          shouldContinue: false
        };
      }

      case 'help':
      case 'h': {
        const output = [
          '📖 可用命令:',
          '  /new <name>      - 创建新会话',
          '  /switch <name>   - 切换会话（可简写 /sw）',
          '  /reset           - 重置当前会话',
          '  /delete <name>   - 删除会话（可简写 /del）',
          '  /list            - 列出所有会话（可简写 /ls）',
          '  /info            - 显示当前会话信息',
          '  /help            - 显示帮助（可简写 /h）',
          '',
          '💡 提示：会话自动保存，上下文窗口自动管理'
        ].join('\n');
        return {
          isCommand: true,
          command: 'help',
          output,
          shouldContinue: false
        };
      }

      default:
        return {
          isCommand: true,
          command: 'unknown',
          output: `❌ 未知命令 "/${command}"，输入 /help 查看可用命令`,
          shouldContinue: false
        };
    }
  }

  /**
   * 列出所有会话（公开方法）
   */
  listFiles(): SessionMeta[] {
    return Array.from(this.sessions.values())
      .map(s => s.meta)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * 格式化时间差
   */
  private formatTimeAgo(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes} 分钟前`;
    if (hours < 24) return `${hours} 小时前`;
    if (days < 7) return `${days} 天前`;
    
    return new Date(timestamp).toLocaleDateString('zh-CN');
  }
}

// 单例实例
let defaultManager: SessionManager | null = null;

export function getDefaultManager(): SessionManager {
  if (!defaultManager) {
    defaultManager = new SessionManager();
  }
  return defaultManager;
}
