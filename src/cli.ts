#!/usr/bin/env node
/**
 * TinyPaw CLI
 * 命令行交互接口 - 支持会话管理 + 技能命令
 */

import { loadConfig, agentLoop, getTokenCounter, setSessionManager, setSkillLoader, getConfig } from './agent.js';
import { getDefaultManager } from './session-manager.js';
import { initializeSkills } from './skill-loader.js';
import { createInterface } from 'node:readline';
import { mkdir } from 'node:fs/promises';

async function main(): Promise<void> {
  console.log('🦎 TinyPaw v0.4.0 - 极简 Agent 框架 (技能系统)');
  console.log('输入 "exit" 退出，"/help" 查看命令，"/skills" 查看技能\n');

  await loadConfig();
  const config = getConfig();
  
  // 根据配置创建 memory 目录
  const memoryPath = config.memory?.path || './workspace/memory';
  await mkdir(memoryPath, { recursive: true }).catch(() => {});
  
  // 初始化会话管理器（传入配置）
  const sessionsPath = `${memoryPath}/sessions`;
  const sessionManager = getDefaultManager({
    storagePath: sessionsPath,
    maxTokens: config.tokenLimit || 128000
  });
  await sessionManager.initialize();
  setSessionManager(sessionManager);
  
  // 初始化技能加载器
  const skillLoader = await initializeSkills('./skills');
  setSkillLoader(skillLoader);

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
  
  // 显示可用技能
  const invocableSkills = skillLoader.getUserInvocableSkills();
  if (invocableSkills.length > 0) {
    console.log(`🎯 可用技能: ${invocableSkills.map(s => `/${s}`).join(', ')}`);
  }
  
  console.log(`📁 当前会话：${sessionManager.getCurrentSessionKey()}\n`);

  /**
   * 解析并执行命令
   */
  async function parseCommand(input: string): Promise<{ handled: boolean; output?: string; skillContent?: string }> {
    const trimmed = input.trim();
    
    if (!trimmed.startsWith('/')) {
      return { handled: false };
    }
    
    const parts = trimmed.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    // 会话管理命令
    const sessionResult = await sessionManager.parseCommand(trimmed);
    if (sessionResult.isCommand) {
      return {
        handled: true,
        output: sessionResult.output
      };
    }
    
    // 技能命令
    if (skillLoader.hasSkill(command) && skillLoader.isUserInvocable(command)) {
      const skillContent = await skillLoader.invokeSkill(command, args);
      if (skillContent) {
        return {
          handled: true,
          skillContent,
          output: `🎯 执行技能: ${command}${args.length > 0 ? ` (${args.join(' ')})` : ''}`
        };
      } else {
        return {
          handled: true,
          output: `❌ 技能 "${command}" 调用失败`
        };
      }
    }
    
    // /skills 命令 - 列出所有技能
    if (command === 'skills' || command === 'sk') {
      const skills = skillLoader.getSkills();
      if (skills.length === 0) {
        return { handled: true, output: '📋 暂无可用技能' };
      }
      
      const output = skills
        .map(s => {
          const invocable = s.frontmatter.userInvocable ?? true;
          const auto = !s.frontmatter.disableModelInvocation;
          const hint = s.frontmatter.argumentHint || '';
          return `  ${invocable ? '/' : '  '}${s.name}${hint} - ${s.description.slice(0, 60)}${s.description.length > 60 ? '...' : ''} (${auto ? '自动' : '手动'})`;
        })
        .join('\n');
      
      return {
        handled: true,
        output: `📋 技能列表 (${skills.length} 个):\n${output}`
      };
    }
    
    // /reload 命令 - 重新加载技能
    if (command === 'reload') {
      await skillLoader.reload();
      return {
        handled: true,
        output: `✅ 已重新加载 ${skillLoader.getSkills().length} 个技能`
      };
    }
    
    return {
      handled: true,
      output: `❌ 未知命令 "/${command}"，输入 /help 查看可用命令`
    };
  }

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
        await sessionManager.saveAllSessions();
        
        const finalStats = getTokenCounter().getStats();
        if (finalStats.requestCount > 0) {
          console.log(`\n📊 本次会话：${finalStats.totalTokens} tokens, ${finalStats.requestCount} 次请求`);
        }
        
        rl.close();
        return;
      }

      // 解析命令
      const cmdResult = await parseCommand(trimmed);
      
      if (cmdResult.handled) {
        if (cmdResult.output) {
          console.log('\n' + cmdResult.output);
        }
        
        // 如果是技能调用，执行技能内容
        if (cmdResult.skillContent) {
          console.log('\n🤔 执行技能...\n');
          try {
            const response = await agentLoop(cmdResult.skillContent);
            console.log('\n💬', response);
          } catch (e) {
            console.error('❌ 技能执行错误:', (e as Error).message);
          }
        }
        
        console.log();
        prompt();
        return;
      }

      // 普通对话
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