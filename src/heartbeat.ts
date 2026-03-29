#!/usr/bin/env node
/**
 * TinyPaw Heartbeat
 * 两阶段心跳：Decision → Execution
 */

import { readFile } from 'node:fs/promises';
import { callLLM, getFirstToolCallArgs, createToolDefinition, LLMConfig } from './llm.js';

// ============================================================================
// 类型定义
// ============================================================================

export interface HeartbeatTasks {
  recurring: string[];   // 周期性任务（每次心跳都执行）
  oneTime: string[];     // 一次性任务（执行后移动到 Completed）
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface HeartbeatDecision {
  action: 'skip' | 'run';
  tasks: string;  // 任务摘要（run 时必填）
}

// 导出 LLMConfig（从 llm.ts 重新导出，方便外部使用）
export { LLMConfig } from './llm.js';

// ============================================================================
// Decision Tool 定义
// ============================================================================

const DECISION_TOOL = createToolDefinition(
  'heartbeat_decision',
  'Report heartbeat decision after reviewing tasks.',
  {
    action: {
      type: 'string',
      description: 'skip = nothing to do, run = has active tasks',
      enum: ['skip', 'run']
    },
    tasks: {
      type: 'string',
      description: 'Natural-language summary of active tasks (required for run)'
    }
  },
  ['action']
);

// ============================================================================
// 心跳解析
// ============================================================================

/**
 * 解析 HEARTBEAT.md 文件
 */
export async function parseHeartbeatFile(workspacePath: string): Promise<HeartbeatTasks> {
  const heartbeatPath = `${workspacePath}/HEARTBEAT.md`;
  
  try {
    const content = await readFile(heartbeatPath, 'utf-8');
    
    // 解析任务区域
    const recurringMatch = content.match(/## Recurring\s*\n([\s\S]*?)(?=## One-time|## Completed|$)/);
    const oneTimeMatch = content.match(/## One-time\s*\n([\s\S]*?)(?=## Completed|$)/);
    
    const extractTasks = (section: string | undefined): string[] => {
      if (!section) return [];
      return section
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('<!') && !line.startsWith('#'))
        .map(line => line.replace(/^-\s*/, ''));  // 移除列表符号
    };
    
    return {
      recurring: extractTasks(recurringMatch?.[1]),
      oneTime: extractTasks(oneTimeMatch?.[1])
    };
  } catch (e) {
    // HEARTBEAT.md 不存在或无法读取
    return { recurring: [], oneTime: [] };
  }
}

/**
 * 获取当前时间字符串（使用系统时区）
 */
function currentTimeStr(): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const formatted = now.toLocaleString('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  return `${formatted} (${timezone})`;
}

// ============================================================================
// Phase 1: Decision
// ============================================================================

/**
 * 调用 LLM 判断是否需要执行任务
 */
export async function decideHeartbeat(
  heartbeatContent: string,
  llmConfig: LLMConfig
): Promise<HeartbeatDecision> {
  const systemPrompt = 'You are a heartbeat agent. You MUST call the heartbeat_decision tool to report your decision. Do not respond with text, only use the tool.';
  
  const userPrompt = `Current Time: ${currentTimeStr()}

Review the following HEARTBEAT.md and decide whether there are active tasks that should be executed now.

Consider:
- Time-sensitive tasks (should run now?)
- Recurring tasks (due for this interval?)
- One-time tasks (still pending?)

You MUST call the heartbeat_decision tool with your decision.

${heartbeatContent}`;

  try {
    const response = await callLLM(
      llmConfig,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      {
        tools: [DECISION_TOOL],
        toolChoice: 'auto',
        maxTokens: 256,
        temperature: 0,
        timeoutMs: 30000
      }
    );

    const args = getFirstToolCallArgs(response);
    if (!args) {
      console.warn('[Heartbeat] No tool call returned, skipping');
      return { action: 'skip', tasks: '' };
    }

    return {
      action: args.action || 'skip',
      tasks: args.tasks || ''
    };
  } catch (e) {
    console.warn('[Heartbeat] Decision failed:', (e as Error).message);
    return { action: 'skip', tasks: '' };
  }
}

// ============================================================================
// Phase 2: Execution Prompt
// ============================================================================

/**
 * 构建心跳任务执行提示
 */
export function buildHeartbeatPrompt(tasksSummary: string): string {
  return `Execute the following heartbeat tasks:

${tasksSummary}

After completing one-time tasks, use the edit tool to move them from "## One-time" to "## Completed" in HEARTBEAT.md.`;
}

// ============================================================================
// 心跳定时器
// ============================================================================

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动心跳定时器
 */
export function startHeartbeatTimer(
  config: HeartbeatConfig,
  onTick: () => Promise<void>
): void {
  if (!config.enabled) {
    console.log('[Heartbeat] 心跳已禁用');
    return;
  }
  
  const intervalMs = (config.intervalMinutes || 30) * 60 * 1000;
  
  console.log(`[Heartbeat] 启动心跳，间隔 ${config.intervalMinutes || 30} 分钟`);
  
  // 避免重复启动
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  
  heartbeatTimer = setInterval(() => {
    // 异步执行，不阻塞主线程
    onTick().catch(e => {
      console.error('[Heartbeat] 错误:', (e as Error).message);
    });
  }, intervalMs);
}

/**
 * 停止心跳定时器
 */
export function stopHeartbeatTimer(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    console.log('[Heartbeat] 已停止');
  }
}