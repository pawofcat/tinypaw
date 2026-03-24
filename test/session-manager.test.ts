#!/usr/bin/env node
/**
 * SessionManager 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SessionManager, estimateMessageTokens, estimateSessionTokens } from '../src/session-manager.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message } from '../src/agent.js';

const TEST_STORAGE_PATH = './test-memory/sessions';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(async () => {
    // 清理测试目录
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_STORAGE_PATH, { recursive: true }).catch(() => {});
    
    manager = new SessionManager({
      storagePath: TEST_STORAGE_PATH,
      maxTokens: 10000,
      reserveTokens: 1000,
      maxMessages: 20,
      minMessages: 5
    });
    await manager.initialize();
  });

  afterEach(async () => {
    // 清理测试目录
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true }).catch(() => {});
  });

  describe('Token 估算', () => {
    it('应该正确估算英文 token', () => {
      const message: Message = { role: 'user', content: 'Hello world' };
      const tokens = estimateMessageTokens(message);
      assert.ok(tokens > 0 && tokens < 10, `英文 token 估算应在合理范围，实际：${tokens}`);
    });

    it('应该正确估算中文 token', () => {
      const message: Message = { role: 'user', content: '你好世界' };
      const tokens = estimateMessageTokens(message);
      assert.ok(tokens > 0 && tokens < 10, `中文 token 估算应在合理范围，实际：${tokens}`);
    });

    it('应该正确估算混合文本 token', () => {
      const message: Message = { role: 'user', content: 'Hello 你好 world 世界' };
      const tokens = estimateMessageTokens(message);
      assert.ok(tokens > 0, `混合文本 token 估算应大于 0，实际：${tokens}`);
    });

    it('应该正确估算会话总 token', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' }
      ];
      const tokens = estimateSessionTokens(messages);
      const token1 = estimateMessageTokens(messages[0]);
      const token2 = estimateMessageTokens(messages[1]);
      assert.strictEqual(tokens, token1 + token2, '会话 token 应为各消息 token 之和');
    });
  });

  describe('会话基本操作', () => {
    it('应该获取或创建会话', () => {
      const session = manager.getSession('test-session');
      assert.ok(Array.isArray(session), '会话应为数组');
      assert.strictEqual(session.length, 0, '新会话应为空');
    });

    it('应该添加消息到会话', () => {
      manager.addToSession('user', 'Hello');
      manager.addToSession('assistant', 'Hi');
      
      const session = manager.getSession();
      assert.strictEqual(session.length, 2, '会话应有 2 条消息');
      assert.strictEqual(session[0].content, 'Hello');
      assert.strictEqual(session[1].content, 'Hi');
    });

    it('应该更新会话元数据', () => {
      manager.addToSession('user', 'Test message');
      const info = manager.getSessionInfo();
      
      assert.ok(info !== null, '应能获取会话信息');
      assert.strictEqual(info?.messageCount, 1, '消息数应为 1');
      assert.ok(info!.tokenCount > 0, 'token 数应大于 0');
      assert.ok(info!.updatedAt >= info!.createdAt, '更新时间应大于等于创建时间');
    });
  });

  describe('会话管理命令', () => {
    it('应该创建新会话', () => {
      const result = manager.createSession('new-session');
      assert.strictEqual(result.success, true, '创建会话应成功');
      assert.strictEqual(manager.getCurrentSessionKey(), 'new-session', '应自动切换到新会话');
    });

    it('应该拒绝创建已存在的会话', () => {
      manager.createSession('existing');
      const result = manager.createSession('existing');
      assert.strictEqual(result.success, false, '创建已存在会话应失败');
      assert.ok(result.error?.includes('已存在'), '错误信息应提示已存在');
    });

    it('应该切换会话', () => {
      manager.createSession('session-a');
      manager.createSession('session-b');
      
      const result = manager.switchSession('session-a');
      assert.strictEqual(result.success, true, '切换会话应成功');
      assert.strictEqual(manager.getCurrentSessionKey(), 'session-a', '当前会话应为 session-a');
    });

    it('应该拒绝切换到不存在的会话', () => {
      const result = manager.switchSession('non-existent');
      assert.strictEqual(result.success, false, '切换到不存在会话应失败');
      assert.ok(result.error?.includes('不存在'), '错误信息应提示不存在');
    });

    it('应该重置会话', () => {
      manager.addToSession('system', 'System prompt');
      manager.addToSession('user', 'Hello');
      manager.addToSession('assistant', 'Hi');
      
      const result = manager.resetSession();
      assert.strictEqual(result.success, true, '重置会话应成功');
      
      const session = manager.getSession();
      assert.strictEqual(session.length, 1, '重置后应只保留 system 消息');
      assert.strictEqual(session[0].role, 'system', '应保留 system 消息');
    });

    it('应该删除会话', async () => {
      manager.createSession('to-delete');
      await manager.saveSession('to-delete');
      
      const result = await manager.deleteSession('to-delete');
      assert.strictEqual(result.success, true, '删除会话应成功');
      
      const sessions = manager.listFiles();
      assert.ok(!sessions.some(s => s.key === 'to-delete'), '会话应已被删除');
    });

    it('应该拒绝删除 default 会话', async () => {
      const result = await manager.deleteSession('default');
      assert.strictEqual(result.success, false, '删除 default 会话应失败');
    });

    it('应该列出所有会话', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');
      
      const sessions = manager.listFiles();
      assert.ok(sessions.length >= 3, '应至少有 3 个会话（default + 2 个新会话）');
      
      const keys = sessions.map(s => s.key);
      assert.ok(keys.includes('default'), '应包含 default 会话');
      assert.ok(keys.includes('session-1'), '应包含 session-1');
      assert.ok(keys.includes('session-2'), '应包含 session-2');
    });
  });

  describe('上下文窗口控制', () => {
    it('应该在消息数超限时裁剪', () => {
      // 添加超过 maxMessages 的消息
      for (let i = 0; i < 25; i++) {
        manager.addToSession('user', `Message ${i}`);
      }
      
      const session = manager.getSession();
      assert.ok(session.length <= 20, `消息数应不超过 maxMessages(20)，实际：${session.length}`);
    });

    it('应该保留 system 消息', () => {
      manager.addToSession('system', 'System prompt');
      for (let i = 0; i < 25; i++) {
        manager.addToSession('user', `Message ${i}`);
      }
      
      const session = manager.getSession();
      const systemMsg = session.find(m => m.role === 'system');
      assert.ok(systemMsg !== undefined, '应保留 system 消息');
      assert.strictEqual(systemMsg?.content, 'System prompt', 'system 消息内容应正确');
    });

    it('应该在 token 超限时裁剪', () => {
      // 添加大量消息使 token 超限
      for (let i = 0; i < 50; i++) {
        manager.addToSession('user', `This is a longer message number ${i} with more content to increase token count.`);
      }
      
      const info = manager.getSessionInfo();
      assert.ok(info !== null, '应能获取会话信息');
      assert.ok(info!.tokenCount <= 9000, `token 数应不超过限制，实际：${info!.tokenCount}`);
    });

    it('应该保留最小消息数', () => {
      // 设置很小的 maxMessages 来触发裁剪
      const strictManager = new SessionManager({
        storagePath: TEST_STORAGE_PATH + '_strict',
        maxTokens: 100000,
        reserveTokens: 1000,
        maxMessages: 10,
        minMessages: 5
      });
      
      for (let i = 0; i < 20; i++) {
        strictManager.addToSession('user', `Message ${i}`);
      }
      
      const session = strictManager.getSession();
      assert.ok(session.length >= 5, `消息数应不少于 minMessages(5)，实际：${session.length}`);
    });
  });

  describe('命令解析', () => {
    it('应该识别非命令输入', async () => {
      const result = await manager.parseCommand('Hello world');
      assert.strictEqual(result.isCommand, false, '普通文本不应识别为命令');
      assert.strictEqual(result.shouldContinue, false, '非命令不应继续');
    });

    it('应该解析 /new 命令', async () => {
      const result = await manager.parseCommand('/new test-session');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'new', '命令应为 new');
      assert.strictEqual(result.shouldContinue, true, 'new 命令应继续');
      assert.strictEqual(result.newSessionKey, 'test-session', '新会话 key 应正确');
    });

    it('应该解析 /switch 命令', async () => {
      manager.createSession('session-a');
      manager.createSession('session-b');
      
      const result = await manager.parseCommand('/switch session-a');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'switch', '命令应为 switch');
      assert.strictEqual(result.newSessionKey, 'session-a', '切换到的会话 key 应正确');
    });

    it('应该解析 /switch 简写', async () => {
      manager.createSession('session-a');
      const result = await manager.parseCommand('/sw session-a');
      assert.strictEqual(result.command, 'switch', '简写应解析为 switch');
    });

    it('应该解析 /reset 命令', async () => {
      manager.addToSession('user', 'Hello');
      const result = await manager.parseCommand('/reset');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'reset', '命令应为 reset');
      assert.strictEqual(result.shouldContinue, false, 'reset 命令不应继续');
    });

    it('应该解析 /list 命令', async () => {
      manager.createSession('session-1');
      const result = await manager.parseCommand('/list');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'list', '命令应为 list');
      assert.ok(result.output?.includes('session-1'), '输出应包含 session-1');
    });

    it('应该解析 /info 命令', async () => {
      manager.addToSession('user', 'Test');
      const result = await manager.parseCommand('/info');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'info', '命令应为 info');
      assert.ok(result.output?.includes('消息数'), '输出应包含消息数');
      assert.ok(result.output?.includes('Token'), '输出应包含 Token 信息');
    });

    it('应该解析 /help 命令', async () => {
      const result = await manager.parseCommand('/help');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'help', '命令应为 help');
      assert.ok(result.output?.includes('/new'), '帮助应包含 /new 命令');
      assert.ok(result.output?.includes('/switch'), '帮助应包含 /switch 命令');
    });

    it('应该处理未知命令', async () => {
      const result = await manager.parseCommand('/unknown');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.strictEqual(result.command, 'unknown', '命令应为 unknown');
      assert.ok(result.output?.includes('未知命令'), '输出应提示未知命令');
    });

    it('应该处理缺少参数的命令', async () => {
      const result = await manager.parseCommand('/switch');
      assert.strictEqual(result.isCommand, true, '应识别为命令');
      assert.ok(result.output?.includes('用法'), '输出应提示用法');
    });
  });

  describe('会话持久化', () => {
    it('应该保存会话到磁盘', async () => {
      manager.addToSession('user', 'Test message');
      const success = await manager.saveSession();
      assert.strictEqual(success, true, '保存应成功');
    });

    it('应该从磁盘加载会话', async () => {
      manager.addToSession('user', 'Persistent message');
      await manager.saveSession();
      
      // 创建新的 manager 实例
      const newManager = new SessionManager({
        storagePath: TEST_STORAGE_PATH,
        maxTokens: 10000
      });
      await newManager.initialize();
      
      const session = newManager.getSession();
      assert.ok(session.some(m => m.content === 'Persistent message'), '应加载已保存的消息');
    });

    it('应该保存所有会话', async () => {
      manager.createSession('session-1');
      manager.createSession('session-2');
      manager.addToSession('user', 'Message 1');
      manager.switchSession('session-1');
      manager.addToSession('user', 'Message 2');
      
      await manager.saveAllSessions();
      
      // 验证文件存在
      const fs = await import('node:fs/promises');
      const files = await fs.readdir(TEST_STORAGE_PATH);
      assert.ok(files.some(f => f.endsWith('.json')), '应生成 JSON 文件');
    });
  });

  describe('时间格式化', () => {
    it('应该格式化最近的时间', async () => {
      const result = await manager.parseCommand('/info');
      assert.ok(result.output?.includes('刚刚') || result.output?.includes('分钟前'), '应显示相对时间');
    });
  });
});

describe('SessionManager 边缘情况', () => {
  it('应该处理空会话', async () => {
    const manager = new SessionManager({ storagePath: TEST_STORAGE_PATH + '_edge' });
    await manager.initialize();
    
    const session = manager.getSession();
    assert.strictEqual(session.length, 0, '空会话长度应为 0');
    
    manager.enforceContextWindow(); // 不应抛出异常
    assert.strictEqual(session.length, 0, '裁剪空会话后仍应为空');
  });

  it('应该处理只有 system 消息的会话', async () => {
    const manager = new SessionManager({ storagePath: TEST_STORAGE_PATH + '_edge2' });
    await manager.initialize();
    
    manager.addToSession('system', 'System only');
    manager.enforceContextWindow();
    
    const session = manager.getSession();
    assert.strictEqual(session.length, 1, '应保留 system 消息');
  });
});
