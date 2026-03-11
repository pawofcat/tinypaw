#!/usr/bin/env node
/**
 * TinyPaw CLI
 * 命令行交互接口
 */

import { loadConfig, agentLoop, addToSession, getSession } from './agent.js';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';

async function main() {
  console.log('🦎 TinyPaw v0.1.0 - 极简 Agent 框架');
  console.log('输入 "exit" 或 Ctrl+C 退出\n');

  // 加载配置
  await loadConfig();
  
  // 确保记忆目录存在
  await mkdir('./memory', { recursive: true }).catch(() => {});

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const sessionKey = 'default';
  
  // 加载历史记忆
  const today = new Date().toISOString().split('T')[0];
  try {
    const { readFile } = await import('node:fs/promises');
    const memoryContent = await readFile(`./memory/${today}.md', 'utf-8').catch(() => '');
    if (memoryContent) {
      addToSession(sessionKey, 'system', `今日记忆：${memoryContent.slice(0, 500)}`);
    }
  } catch (e) {
    // 忽略
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
        rl.close();
        return;
      }

      // 添加到会话历史
      addToSession(sessionKey, 'user', trimmed);

      try {
        console.log('\n🤔 思考中...\n');
        
        const history = getSession(sessionKey);
        const response = await agentLoop(trimmed, history.slice(-10));
        
        console.log('\n💬', response || '(无回复)');
        
        // 添加回复到历史
        if (response) {
          addToSession(sessionKey, 'assistant', response);
        }
      } catch (e) {
        console.error('❌ 错误:', e.message);
        console.error('提示：请检查 config.json 中的 LLM API 配置');
      }

      console.log();
      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
