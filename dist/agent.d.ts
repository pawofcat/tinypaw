#!/usr/bin/env node
/**
 * TinyPaw Agent Core
 * 极简 Agent 核心 - LLM 驱动的工具调用 agent
 */
import { SessionStore } from './session-store.js';
import { TokenCounter } from './token-manager.js';
export interface LLMConfig {
    provider: string;
    model: string;
    apiKey: string;
    baseUrl: string;
}
export interface MemoryConfig {
    path: string;
}
export interface Config {
    llm: LLMConfig;
    memory: MemoryConfig;
    system: string;
    tokenLimit?: number;
    retryAttempts?: number;
}
export interface ToolParameter {
    [key: string]: string;
}
export interface Tool {
    description: string;
    parameters: ToolParameter;
    execute: (args: any) => Promise<ToolResult>;
}
export interface ToolResult {
    success: boolean;
    content?: string;
    path?: string;
    stdout?: string;
    stderr?: string;
    results?: Array<{
        title: string;
        url: string;
    } | {
        file: string;
        snippet: string;
    }>;
    error?: string;
    file?: string;
    snippet?: string;
}
export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_call_id?: string;
}
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
export interface LLMResponse {
    content: string | null;
    tool_calls?: ToolCall[];
}
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: {
            type: 'object';
            properties: Record<string, {
                type: string;
            }>;
            required: string[];
        };
    };
}
export interface MemorySearchResult {
    file: string;
    snippet: string;
}
export interface WebSearchResult {
    title: string;
    url: string;
}
export declare function loadConfig(path?: string): Promise<Config>;
export declare function getConfig(): Config;
/**
 * 初始化会话存储
 */
export declare function initializeSessionStore(storagePath?: string): Promise<SessionStore>;
/**
 * 获取会话存储
 */
export declare function getSessionStore(): SessionStore;
/**
 * 获取 token 计数器
 */
export declare function getTokenCounter(): TokenCounter;
export declare function getTools(): Record<string, Tool>;
export declare function callLLM(messages: Message[], tools: Record<string, Tool>): Promise<LLMResponse>;
export declare function agentLoop(userMessage: string, sessionKey?: string): Promise<string>;
export declare function getSession(sessionKey: string): Message[];
export declare function addToSession(sessionKey: string, role: string, content: string): void;
export declare function saveSession(sessionKey: string): Promise<boolean>;
export declare function clearSession(sessionKey: string): boolean;
export declare function listSessions(): import('./session-store.js').SessionMeta[];
//# sourceMappingURL=agent.d.ts.map