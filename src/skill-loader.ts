#!/usr/bin/env node
/**
 * 技能系统
 * 自动扫描和加载 skills/ 目录下的技能
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// ============================================================================
// 类型定义
// ============================================================================

export interface SkillTrigger {
  type: 'keyword' | 'regex' | 'intent';
  value: string;
  priority?: number;  // 优先级，越高越优先匹配
}

export interface Skill {
  name: string;
  description: string;
  triggers: SkillTrigger[];
  tools: string[];  // 推荐使用的工具
  systemPrompt?: string;  // 技能相关的 system prompt 补充
  examples?: string;  // 使用示例
  path: string;  // 技能文件路径
}

export interface SkillMatch {
  skill: Skill;
  matchedTrigger: SkillTrigger;
  confidence: number;  // 匹置信度 0-1
}

export interface SkillLoaderConfig {
  skillsPath: string;
  autoReload?: boolean;
}

// ============================================================================
// SkillLoader 类
// ============================================================================

export class SkillLoader {
  private config: SkillLoaderConfig;
  private skills: Map<string, Skill> = new Map();
  private loaded: boolean = false;

  constructor(config: Partial<SkillLoaderConfig> = {}) {
    this.config = {
      skillsPath: config.skillsPath || './skills',
      autoReload: config.autoReload || false
    };
  }

  /**
   * 扫描并加载所有技能
   */
  async load(): Promise<void> {
    try {
      const dirs = await readdir(this.config.skillsPath);
      
      for (const dir of dirs) {
        const skillPath = join(this.config.skillsPath, dir);
        const skillFile = join(skillPath, 'SKILL.md');
        
        try {
          const content = await readFile(skillFile, 'utf-8');
          const skill = this.parseSkillMarkdown(content, dir, skillFile);
          
          if (skill) {
            this.skills.set(skill.name, skill);
            console.log(`[SkillLoader] 加载技能 "${skill.name}"，触发条件：${skill.triggers.length} 个`);
          }
        } catch (e) {
          // 目录中没有 SKILL.md，跳过
          console.warn(`[SkillLoader] 跳过 "${dir}"：缺少 SKILL.md`);
        }
      }
      
      this.loaded = true;
      console.log(`[SkillLoader] 已加载 ${this.skills.size} 个技能`);
    } catch (e) {
      console.warn('[SkillLoader] 扫描技能目录失败：', (e as Error).message);
      this.loaded = true;  // 标记为已加载，避免重复尝试
    }
  }

  /**
   * 解析 SKILL.md 文件
   */
  private parseSkillMarkdown(content: string, name: string, path: string): Skill | null {
    try {
      const sections = this.parseSections(content);
      
      // 解析触发条件
      const triggers: SkillTrigger[] = [];
      const triggerSection = sections.get('触发条件') || sections.get('triggers') || '';
      
      // 解析关键词触发
      const keywordLines = triggerSection.split('\n').filter(l => l.trim());
      for (const line of keywordLines) {
        // 支持格式：- "关键词" 或 - 关键词
        const match = line.match(/[-*]\s*["']?([^"'\n]+)["']?/);
        if (match) {
          const keyword = match[1].trim();
          // 判断是正则还是关键词
          if (keyword.startsWith('/') && keyword.endsWith('/')) {
            triggers.push({
              type: 'regex',
              value: keyword.slice(1, -1),
              priority: 2
            });
          } else {
            triggers.push({
              type: 'keyword',
              value: keyword.toLowerCase(),
              priority: 1
            });
          }
        }
      }
      
      // 解析工具列表
      const toolsSection = sections.get('工具') || sections.get('tools') || '';
      const tools = toolsSection
        .split('\n')
        .filter(l => l.trim())
        .map(l => l.replace(/[-*`\s]/g, '').trim())
        .filter(l => l.length > 0);
      
      // 获取描述
      const description = sections.get('描述') || sections.get('description') || name;
      
      // 获取 system prompt（可选）
      const systemPrompt = sections.get('system prompt') || sections.get('prompt');
      
      // 获取示例
      const examples = sections.get('示例') || sections.get('examples');
      
      return {
        name,
        description: description.trim(),
        triggers,
        tools,
        systemPrompt: systemPrompt?.trim(),
        examples: examples?.trim(),
        path
      };
    } catch (e) {
      console.warn(`[SkillLoader] 解析技能 "${name}" 失败：`, (e as Error).message);
      return null;
    }
  }

  /**
   * 解析 Markdown 的章节
   */
  private parseSections(content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = content.split('\n');
    
    let currentSection = '';
    let currentContent: string[] = [];
    
    for (const line of lines) {
      // 匹配 ## 标题
      const headingMatch = line.match(/^##\s+(.+)/);
      
      if (headingMatch) {
        // 保存上一个章节
        if (currentSection) {
          sections.set(currentSection, currentContent.join('\n').trim());
        }
        
        currentSection = headingMatch[1].trim().toLowerCase();
        currentContent = [];
      } else if (currentSection) {
        currentContent.push(line);
      }
    }
    
    // 保存最后一个章节
    if (currentSection) {
      sections.set(currentSection, currentContent.join('\n').trim());
    }
    
    return sections;
  }

  /**
   * 根据用户输入匹配技能
   */
  matchSkills(userInput: string): SkillMatch[] {
    if (!this.loaded) {
      console.warn('[SkillLoader] 技能未加载，无法匹配');
      return [];
    }
    
    const inputLower = userInput.toLowerCase();
    const matches: SkillMatch[] = [];
    
    for (const skill of this.skills.values()) {
      for (const trigger of skill.triggers) {
        let matched = false;
        let confidence = 0;
        
        if (trigger.type === 'keyword') {
          // 关键词匹配
          if (inputLower.includes(trigger.value)) {
            matched = true;
            confidence = 0.8;
          }
        } else if (trigger.type === 'regex') {
          // 正则匹配
          try {
            const regex = new RegExp(trigger.value, 'i');
            if (regex.test(userInput)) {
              matched = true;
              confidence = 0.9;
            }
          } catch (e) {
            console.warn(`[SkillLoader] 正则表达式无效：${trigger.value}`);
          }
        } else if (trigger.type === 'intent') {
          // 意图匹配（简化版：直接字符串匹配）
          if (inputLower.includes(trigger.value)) {
            matched = true;
            confidence = 0.7;
          }
        }
        
        if (matched) {
          matches.push({
            skill,
            matchedTrigger: trigger,
            confidence
          });
        }
      }
    }
    
    // 按置信度和优先级排序
    matches.sort((a, b) => {
      const priorityDiff = (b.matchedTrigger.priority || 1) - (a.matchedTrigger.priority || 1);
      if (priorityDiff !== 0) return priorityDiff;
      return b.confidence - a.confidence;
    });
    
    return matches;
  }

  /**
   * 获取匹配度最高的技能
   */
  getBestMatch(userInput: string): SkillMatch | null {
    const matches = this.matchSkills(userInput);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * 获取所有已加载的技能
   */
  getSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取指定技能
   */
  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 生成技能相关的 system prompt 补充
   */
  generateSkillPrompt(userInput: string): string | null {
    const match = this.getBestMatch(userInput);
    
    if (!match) {
      return null;
    }
    
    const { skill } = match;
    
    let prompt = `\n[技能激活：${skill.name}]\n${skill.description}`;
    
    if (skill.tools.length > 0) {
      prompt += `\n推荐工具：${skill.tools.join(', ')}`;
    }
    
    if (skill.systemPrompt) {
      prompt += `\n${skill.systemPrompt}`;
    }
    
    return prompt;
  }

  /**
   * 重新加载技能（用于热更新）
   */
  async reload(): Promise<void> {
    this.skills.clear();
    this.loaded = false;
    await this.load();
  }
}

// ============================================================================
// 默认实例和导出
// ============================================================================

let defaultLoader: SkillLoader | null = null;

export function getDefaultLoader(): SkillLoader {
  if (!defaultLoader) {
    defaultLoader = new SkillLoader();
  }
  return defaultLoader;
}

export async function initializeSkills(skillsPath?: string): Promise<SkillLoader> {
  const loader = skillsPath ? new SkillLoader({ skillsPath }) : getDefaultLoader();
  await loader.load();
  return loader;
}