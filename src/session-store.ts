#!/usr/bin/env node
/**
 * 会话持久化管理
 * 负责会话的保存、加载、列表管理
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from './agent.js';

export interface SessionMeta {
  key: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface SessionData {
  meta: SessionMeta;
  messages: Message[];
}

export class SessionStore {
  private storagePath: string;
  private sessions: Map<string, SessionData>;

  constructor(storagePath: string = './memory/sessions') {
    this.storagePath = storagePath;
    this.sessions = new Map();
  }

  /**
   * 初始化存储目录并加载现有会话
   */
  async initialize(): Promise<void> {
    // 确保存储目录存在
    await mkdir(this.storagePath, { recursive: true }).catch(() => {});
    
    // 加载现有会话
    await this.loadAllSessions();
  }

  /**
   * 获取会话文件路径
   */
  private getSessionFilePath(sessionKey: string): string {
    return join(this.storagePath, `${sessionKey}.json`);
  }

  /**
   * 加载所有会话元数据
   */
  async loadAllSessions(): Promise<void> {
    try {
      const files = await readdir(this.storagePath);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        const sessionKey = file.replace('.json', '');
        try {
          await this.loadSession(sessionKey);
        } catch (e) {
          console.warn(`[SessionStore] 加载会话 ${sessionKey} 失败：`, (e as Error).message);
        }
      }
      
      console.log(`[SessionStore] 已加载 ${this.sessions.size} 个会话`);
    } catch (e) {
      console.warn('[SessionStore] 读取会话目录失败：', (e as Error).message);
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
   * 获取会话（如果不存在则创建）
   */
  getSession(sessionKey: string): Message[] {
    if (!this.sessions.has(sessionKey)) {
      const now = Date.now();
      const sessionData: SessionData = {
        meta: {
          key: sessionKey,
          createdAt: now,
          updatedAt: now,
          messageCount: 0
        },
        messages: []
      };
      this.sessions.set(sessionKey, sessionData);
    }
    return this.sessions.get(sessionKey)!.messages;
  }

  /**
   * 添加消息到会话
   */
  addToSession(sessionKey: string, role: string, content: string): void {
    const session = this.getSession(sessionKey);
    session.push({ role: role as Message['role'], content });
    
    const data = this.sessions.get(sessionKey)!;
    data.meta.updatedAt = Date.now();
    data.meta.messageCount = session.length;
    
    // 保留最近 40 条消息
    if (session.length > 40) {
      session.splice(0, session.length - 40);
      data.meta.messageCount = session.length;
    }
  }

  /**
   * 保存会话到磁盘
   */
  async saveSession(sessionKey: string): Promise<boolean> {
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
      console.error(`[SessionStore] 保存会话 ${sessionKey} 失败：`, (e as Error).message);
      return false;
    }
  }

  /**
   * 保存所有会话
   */
  async saveAllSessions(): Promise<void> {
    const savePromises = Array.from(this.sessions.keys()).map(key => this.saveSession(key));
    await Promise.all(savePromises);
    console.log(`[SessionStore] 已保存 ${this.sessions.size} 个会话`);
  }

  /**
   * 列出所有会话
   */
  listSessions(): SessionMeta[] {
    return Array.from(this.sessions.values()).map(s => s.meta);
  }

  /**
   * 删除会话
   */
  async deleteSession(sessionKey: string): Promise<boolean> {
    if (!this.sessions.has(sessionKey)) {
      return false;
    }

    try {
      const filePath = this.getSessionFilePath(sessionKey);
      await this.sessions.delete(sessionKey);
      // 注意：这里不实际删除文件，避免误操作
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 清空会话（保留文件）
   */
  clearSession(sessionKey: string): boolean {
    const data = this.sessions.get(sessionKey);
    if (!data) {
      return false;
    }

    data.messages = [];
    data.meta.updatedAt = Date.now();
    data.meta.messageCount = 0;
    return true;
  }
}

// 单例实例
let defaultStore: SessionStore | null = null;

export function getDefaultStore(): SessionStore {
  if (!defaultStore) {
    defaultStore = new SessionStore();
  }
  return defaultStore;
}
