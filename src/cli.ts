#!/usr/bin/env node
/**
 * TinyPaw CLI
 * 命令行交互接口
 */

import { loadConfig, agentLoop, initializeSessionStore, getTokenCounter, getConfig } from './agent.js';
import { createInterface } from 'node:readline';
import { mkdir, readFile } from 'node:fs/promises';

async function main(): Promise<void> {
  console.log('🦎 TinyPaw v0.2.0 - 极简 Agent 框架 (TypeScript)');
  console.log('输入 "exit" 或 Ctrl+C 退出\n');

  await loadConfig();
  await mkdir('./memory', { recursive: true }).catch(() => {});
  
  // 初始化会话存储
  await initializeSessionStore();

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const sessionKey = 'default';
  
  // 加载今日记忆
  const today = new Date().toISOString().split('T')[0];
  try {
    const memoryContent = await readFile(`./memory/${today}.md`, 'utf-8').catch(() => '');
    if (memoryContent) {
      console.log(`📖 已加载今日记忆 (${today})`);
    }
  } catch (e) {
    // 忽略
  }

  // 显示会话统计
  const counter = getTokenCounter();
  const stats = counter.getStats();
  if (stats.requestCount > 0) {
    console.log(`📊 Token 使用：${stats.totalTokens} tokens (${stats.requestCount} 次请求)`);
  }

  const prompt = () => {
    rl.question('🦎> ', async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('👋 再见！');
        
        // 显示最终统计
        const finalStats = getTokenCounter().getStats();
        if (finalStats.requestCount > 0) {
          console.log(`\n📊 本次会话：${finalStats.totalTokens} tokens, ${finalStats.requestCount} 次请求`);
        }
        
        rl.close();
        return;
      }

      try {
        console.log('\n🤔 思考中...\n');
        
        const response = await agentLoop(trimmed, sessionKey);
        
        console.log('\n💬', response);
      } catch (e) {
        console.error('❌ 错误:', (e as Error).message);
        console.error('提示：请检查 config.json 中的 LLM API 配置');
      }

      console.log();
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
