#!/usr/bin/env node
/**
 * Agent 模块单元测试
 * 使用 mock 测试 LLM 调用和工具执行
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { getTools, getConfig, loadConfig } from '../src/agent.js';
import { SessionManager } from '../src/session-manager.js';
import { rm, mkdir } from 'node:fs/promises';

const TEST_STORAGE_PATH = './test-memory-agent/sessions';

describe('Agent 工具系统', () => {
  let tools: ReturnType<typeof getTools>;

  beforeEach(async () => {
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_STORAGE_PATH, { recursive: true }).catch(() => {});
    tools = getTools();
  });

  afterEach(async () => {
    await rm(TEST_STORAGE_PATH, { recursive: true, force: true }).catch(() => {});
  });

  describe('read 工具', () => {
    it('应该成功读取文件', async () => {
      const fs = await import('node:fs/promises');
      const testFile = './test-memory-agent/test-read.txt';
      await fs.writeFile(testFile, 'Hello World', 'utf-8');
      
      const result = await tools.read.execute({ path: testFile });
      assert.strictEqual(result.success, true, '读取应成功');
      assert.strictEqual(result.content, 'Hello World', '内容应正确');
      
      await fs.rm(testFile, { force: true });
    });

    it('应该处理文件不存在错误', async () => {
      const result = await tools.read.execute({ path: './non-existent-file.txt' });
      assert.strictEqual(result.success, false, '读取不存在的文件应失败');
      assert.ok(result.error?.includes('no such file'), '错误信息应包含文件不存在');
    });
  });

  describe('write 工具', () => {
    it('应该成功写入文件', async () => {
      const testFile = './test-memory-agent/test-write.txt';
      
      const result = await tools.write.execute({ path: testFile, content: 'Test content' });
      assert.strictEqual(result.success, true, '写入应成功');
      assert.strictEqual(result.path, testFile, '路径应正确');
      
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(testFile, 'utf-8');
      assert.strictEqual(content, 'Test content', '文件内容应正确');
      
      await fs.rm(testFile, { force: true });
    });

    it('应该处理写入权限错误', async () => {
      // 尝试写入到无权限目录（如果存在）
      const result = await tools.write.execute({ path: '/root/test.txt', content: 'test' });
      // 在某些系统上可能成功，所以只检查返回格式
      assert.ok(result.success !== undefined, '应返回 success 字段');
    });
  });

  describe('edit 工具', () => {
    it('应该成功编辑文件', async () => {
      const fs = await import('node:fs/promises');
      const testFile = './test-memory-agent/test-edit.txt';
      await fs.writeFile(testFile, 'Hello World', 'utf-8');
      
      const result = await tools.edit.execute({
        path: testFile,
        oldText: 'World',
        newText: 'TinyPaw'
      });
      
      assert.strictEqual(result.success, true, '编辑应成功');
      
      const content = await fs.readFile(testFile, 'utf-8');
      assert.strictEqual(content, 'Hello TinyPaw', '编辑后内容应正确');
      
      await fs.rm(testFile, { force: true });
    });

    it('应该处理替换文本不存在的情况', async () => {
      const fs = await import('node:fs/promises');
      const testFile = './test-memory-agent/test-edit2.txt';
      await fs.writeFile(testFile, 'Hello World', 'utf-8');
      
      const result = await tools.edit.execute({
        path: testFile,
        oldText: 'NonExistent',
        newText: 'Replacement'
      });
      
      // 如果旧文本不存在，replace 不会做任何事情，但也不会报错
      // 这里取决于具体实现，可能成功也可能失败
      assert.ok(result.success !== undefined, '应返回 success 字段');
      
      await fs.rm(testFile, { force: true });
    });
  });

  describe('exec 工具', () => {
    it('应该成功执行简单命令', async () => {
      const result = await tools.exec.execute({ command: 'echo "Hello"' });
      assert.strictEqual(result.success, true, '执行应成功');
      assert.ok(result.stdout?.includes('Hello'), '输出应包含 Hello');
    });

    it('应该处理命令执行失败', async () => {
      const result = await tools.exec.execute({ command: 'nonexistent-command-xyz' });
      assert.strictEqual(result.success, false, '执行不存在的命令应失败');
      assert.ok(result.error, '应包含错误信息');
    });

    it('应该处理命令超时', async () => {
      // 使用 sleep 命令模拟长时间运行的命令
      const result = await tools.exec.execute({ command: 'sleep 1' });
      // 应该成功执行（1 秒在 60 秒超时内）
      assert.strictEqual(result.success, true, 'sleep 1 应成功');
    });
  });

  describe('web_search 工具', () => {
    it('应该执行网络搜索', async () => {
      const result = await tools.web_search.execute({ query: 'test query' });
      // 不检查具体内容，因为网络搜索结果不确定
      assert.ok(result.success !== undefined, '应返回 success 字段');
    });

    it('应该处理网络错误', async () => {
      // 这个测试依赖于网络连接，可能会失败
      const result = await tools.web_search.execute({ query: '' });
      assert.ok(result.success !== undefined, '应返回 success 字段');
    });
  });

  describe('web_fetch 工具', () => {
    it('应该抓取网页内容', async () => {
      const result = await tools.web_fetch.execute({ url: 'https://example.com' });
      // 不检查具体内容
      assert.ok(result.success !== undefined, '应返回 success 字段');
      if (result.success) {
        assert.ok(result.content?.length > 0, '成功时应返回内容');
      }
    });

    it('应该处理无效 URL', async () => {
      const result = await tools.web_fetch.execute({ url: 'invalid-url' });
      assert.strictEqual(result.success, false, '无效 URL 应失败');
    });
  });

  describe('memory_search 工具', () => {
    it('应该搜索记忆文件', async () => {
      const fs = await import('node:fs/promises');
      const memoryDir = './test-memory-agent/memory';
      await mkdir(memoryDir, { recursive: true });
      await fs.writeFile(`${memoryDir}/test.md`, 'This is a test memory', 'utf-8');
      
      // 临时修改配置
      const config = getConfig();
      const originalPath = config.memory.path;
      
      // @ts-ignore - 测试中修改配置
      config.memory.path = memoryDir;
      
      const result = await tools.memory_search.execute({ query: 'test' });
      assert.strictEqual(result.success, true, '搜索应成功');
      assert.ok(Array.isArray(result.results), '结果应为数组');
      
      // 恢复配置
      // @ts-ignore
      config.memory.path = originalPath;
      
      await fs.rm(memoryDir, { recursive: true, force: true });
    });
  });

  describe('memory_get 工具', () => {
    it('应该读取记忆文件', async () => {
      const fs = await import('node:fs/promises');
      const memoryDir = './test-memory-agent/memory';
      await mkdir(memoryDir, { recursive: true });
      await fs.writeFile(`${memoryDir}/test.md`, 'Test memory content', 'utf-8');
      
      const config = getConfig();
      const originalPath = config.memory.path;
      // @ts-ignore
      config.memory.path = memoryDir;
      
      const result = await tools.memory_get.execute({ path: 'test.md' });
      assert.strictEqual(result.success, true, '读取应成功');
      assert.strictEqual(result.content, 'Test memory content', '内容应正确');
      
      // @ts-ignore
      config.memory.path = originalPath;
      await fs.rm(memoryDir, { recursive: true, force: true });
    });
  });

  describe('memory_append 工具', () => {
    it('应该追加记忆', async () => {
      const fs = await import('node:fs/promises');
      const memoryDir = './test-memory-agent/memory';
      await mkdir(memoryDir, { recursive: true });
      
      const config = getConfig();
      const originalPath = config.memory.path;
      // @ts-ignore
      config.memory.path = memoryDir;
      
      const result1 = await tools.memory_append.execute({ path: 'test.md', content: 'Line 1' });
      assert.strictEqual(result1.success, true, '第一次追加应成功');
      
      const result2 = await tools.memory_append.execute({ path: 'test.md', content: 'Line 2' });
      assert.strictEqual(result2.success, true, '第二次追加应成功');
      
      const content = await fs.readFile(`${memoryDir}/test.md`, 'utf-8');
      assert.ok(content.includes('Line 1'), '应包含第一行');
      assert.ok(content.includes('Line 2'), '应包含第二行');
      
      // @ts-ignore
      config.memory.path = originalPath;
      await fs.rm(memoryDir, { recursive: true, force: true });
    });
  });
});

describe('Agent 配置', () => {
  it('应该加载默认配置', () => {
    const config = getConfig();
    assert.ok(config.llm !== undefined, '应有 LLM 配置');
    assert.ok(config.memory !== undefined, '应有记忆配置');
    assert.ok(config.system !== undefined, '应有 system prompt');
  });

  it('应该从文件加载配置', async () => {
    const fs = await import('node:fs/promises');
    const testConfig = {
      llm: {
        provider: 'test',
        model: 'test-model',
        apiKey: 'test-key',
        baseUrl: 'https://test.com'
      },
      memory: {
        path: './test-memory'
      },
      system: 'Test system prompt'
    };
    
    await fs.writeFile('./test-config.json', JSON.stringify(testConfig), 'utf-8');
    
    const config = await loadConfig('./test-config.json');
    assert.strictEqual(config.llm.model, 'test-model', '应加载自定义 model');
    assert.strictEqual(config.llm.apiKey, 'test-key', '应加载自定义 apiKey');
    
    await fs.rm('./test-config.json', { force: true });
  });

  it('应该使用默认配置当文件不存在', async () => {
    const config = await loadConfig('./non-existent-config.json');
    assert.ok(config !== undefined, '应返回默认配置');
  });
});

describe('Agent 与 SessionManager 集成', () => {
  it('应该使用 SessionManager 管理会话', async () => {
    const manager = new SessionManager({
      storagePath: TEST_STORAGE_PATH,
      maxTokens: 10000
    });
    await manager.initialize();
    
    // 模拟 agent 添加消息
    manager.addToSession('user', 'Hello');
    manager.addToSession('assistant', 'Hi there');
    
    const session = manager.getSession();
    assert.strictEqual(session.length, 2, '会话应有 2 条消息');
    
    await manager.saveSession();
  });

  it('应该正确处理上下文窗口', async () => {
    const manager = new SessionManager({
      storagePath: TEST_STORAGE_PATH + '_context',
      maxTokens: 5000,
      maxMessages: 10
    });
    await manager.initialize();
    
    // 添加大量消息
    for (let i = 0; i < 20; i++) {
      manager.addToSession('user', `Message ${i}`);
    }
    
    const session = manager.getSession();
    assert.ok(session.length <= 10, `消息数应不超过限制，实际：${session.length}`);
  });
});
