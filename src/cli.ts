#!/usr/bin/env node
/**
 * TinyPaw CLI
 * 命令行交互接口 - 支持会话管理命令
 */

import { loadConfig, agentLoop, initializeSessionStore, getTokenCounter, getConfig, setSessionManager } from './agent.js';
import { SessionManager, getDefaultManager } from './session-manager.js';
import { createInterface } from 'node:readline';
import { mkdir, readFile } from 'node:fs/promises';

async function main(): Promise<void> {
  console.log('🦎 TinyPaw v0.3.0 - 极简 Agent 框架 (TypeScript)');
  console.log('输入 "exit" 或 Ctrl+C 退出，输入 "/help" 查看会话命令\n');

  await loadConfig();
  await mkdir('./memory', { recursive: true }).catch(() => {});
  
  // 初始化会话管理器（替代 SessionStore）
  const sessionManager = getDefaultManager();
  await sessionManager.initialize();
  
  // 将 sessionManager 传递给 agent 模块
  setSessionManager(sessionManager);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // 显示会话统计
  const counter = getTokenCounter();
  const stats = counter.getStats();
  if (stats.requestCount > 0) {
    console.log(`📊 Token 使用：${stats.totalTokens} tokens (${stats.requestCount} 次请求)`);
  }
  
  console.log(`📁 当前会话：${sessionManager.getCurrentSessionKey()}\n`);

  const prompt = () => {
    const sessionKey = sessionManager.getCurrentSessionKey();
    rl.question(`🦎 [${sessionKey}]> `, async (input) => {
      const trimmed = input.trim();
      
      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log('👋 再见！');
        
        // 保存所有会话
        await sessionManager.saveAllSessions();
        
        // 显示最终统计
        const finalStats = getTokenCounter().getStats();
        if (finalStats.requestCount > 0) {
          console.log(`\n📊 本次会话：${finalStats.totalTokens} tokens, ${finalStats.requestCount} 次请求`);
        }
        
        rl.close();
        return;
      }

      // 检查是否是命令
      const commandResult = await sessionManager.parseCommand(trimmed);
      
      if (commandResult.isCommand) {
        console.log('\n' + commandResult.output);
        console.log();
        
        // 如果命令需要切换会话（如 /new, /switch）
        if (commandResult.shouldContinue && commandResult.newSessionKey) {
          console.log(`📁 当前会话：${commandResult.newSessionKey}\n`);
        }
        
        prompt();
        return;
      }

      try {
        console.log('\n🤔 思考中...\n');
        
        const response = await agentLoop(trimmed);
        
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
