#!/usr/bin/env node
/**
 * TinyPaw Tools
 * 工具定义和执行
 */

import { readFile, writeFile, appendFile, readdir } from 'node:fs/promises';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import fetch from 'node-fetch';

const exec = promisify(execCb);

// ============================================================================
// 类型定义
// ============================================================================

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
  results?: Array<{ title: string; url: string } | { file: string; snippet: string }>;
  error?: string;
  file?: string;
  snippet?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string }>;
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

// ============================================================================
// 工具定义
// ============================================================================

/**
 * 创建工具集（依赖外部 config 获取 workspace path）
 */
export function createTools(getWorkspacePath: () => string): Record<string, Tool> {
  return {
    read: {
      description: '读取文件内容',
      parameters: { path: 'string' },
      execute: async ({ path }: { path: string }): Promise<ToolResult> => {
        try {
          const content = await readFile(path, 'utf-8');
          return { success: true, content: content.slice(0, 50000) };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    write: {
      description: '写入文件内容',
      parameters: { path: 'string', content: 'string' },
      execute: async ({ path, content }: { path: string; content: string }): Promise<ToolResult> => {
        try {
          await writeFile(path, content, 'utf-8');
          return { success: true, path };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    edit: {
      description: '编辑文件（替换文本）',
      parameters: { path: 'string', oldText: 'string', newText: 'string' },
      execute: async ({ path, oldText, newText }: { path: string; oldText: string; newText: string }): Promise<ToolResult> => {
        try {
          const content = await readFile(path, 'utf-8');
          const updated = content.replace(oldText, newText);
          await writeFile(path, updated, 'utf-8');
          return { success: true };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    exec: {
      description: '执行 shell 命令',
      parameters: { command: 'string' },
      execute: async ({ command }: { command: string }): Promise<ToolResult> => {
        try {
          const { stdout, stderr } = await exec(command, { timeout: 60000 });
          return { success: true, stdout, stderr };
        } catch (e) {
          const error = e as Error & { stdout?: string; stderr?: string };
          return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
        }
      }
    },

    web_search: {
      description: '网络搜索',
      parameters: { query: 'string' },
      execute: async ({ query }: { query: string }): Promise<ToolResult> => {
        try {
          const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
          const res = await fetch(url);
          const html = await res.text();
          const results: WebSearchResult[] = [];
          const titleRegex = /<a class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
          let match;
          while ((match = titleRegex.exec(html)) !== null) {
            results.push({ title: match[2], url: match[1] });
          }
          return { success: true, results: results.slice(0, 10) };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    web_fetch: {
      description: '抓取网页内容',
      parameters: { url: 'string' },
      execute: async ({ url }: { url: string }): Promise<ToolResult> => {
        try {
          const res = await fetch(url);
          const html = await res.text();
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          return { success: true, content: text.slice(0, 50000) };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    memory_search: {
      description: '搜索记忆',
      parameters: { query: 'string' },
      execute: async ({ query }: { query: string }): Promise<ToolResult> => {
        try {
          const memoryPath = `${getWorkspacePath()}/memory`;
          const files = await readdir(memoryPath).catch(() => []);
          const results: MemorySearchResult[] = [];
          for (const file of files) {
            if (file.endsWith('.md')) {
              const content = await readFile(`${memoryPath}/${file}`, 'utf-8');
              if (content.toLowerCase().includes(query.toLowerCase())) {
                results.push({ file, snippet: content.slice(0, 200) });
              }
            }
          }
          return { success: true, results };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    memory_get: {
      description: '读取记忆文件',
      parameters: { path: 'string' },
      execute: async ({ path }: { path: string }): Promise<ToolResult> => {
        try {
          const memoryPath = `${getWorkspacePath()}/memory`;
          const fullPath = path.startsWith('/') ? path : `${memoryPath}/${path}`;
          const content = await readFile(fullPath, 'utf-8');
          return { success: true, content };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    },

    memory_append: {
      description: '追加记忆',
      parameters: { path: 'string', content: 'string' },
      execute: async ({ path, content }: { path: string; content: string }): Promise<ToolResult> => {
        try {
          const memoryPath = `${getWorkspacePath()}/memory`;
          const fullPath = path.startsWith('/') ? path : `${memoryPath}/${path}`;
          await appendFile(fullPath, content + '\n', 'utf-8');
          return { success: true };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }
    }
  };
}

/**
 * 生成工具定义（供 LLM API 使用）
 */
export function buildToolDefinitions(tools: Record<string, Tool>): ToolDefinition[] {
  return Object.entries(tools).map(([name, tool]) => ({
    type: 'function',
    function: {
      name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([k, v]) => [k, { type: 'string' }])
        ),
        required: Object.keys(tool.parameters)
      }
    }
  }));
}