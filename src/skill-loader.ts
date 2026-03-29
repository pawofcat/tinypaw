#!/usr/bin/env node
/**
 * 技能系统 - Claude Code Skills 规范兼容
 * 参考：https://code.claude.com/docs/en/skills
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';

// ============================================================================
// 类型定义
// ============================================================================

export interface SkillFrontmatter {
  // 规范字段
  name?: string;                    // 技能名称，1-64 字符，小写字母数字连字符
  description?: string;             // 描述，1-1024 字符
  license?: string;                 // 许可证
  compatibility?: string;           // 环境要求，最多 500 字符
  metadata?: Record<string, string>; // 任意元数据
  allowedTools?: string[];         // 允许的工具列表

  // 扩展字段
  always?: boolean;                 // 始终加载完整内容
  requires?: SkillRequirements;     // 依赖检查
  disableModelInvocation?: boolean; // 禁止 Claude 自动调用
  userInvocable?: boolean;          // 是否在 / 菜单显示（默认 true）
  model?: string;                   // 使用的模型
  effort?: 'low' | 'medium' | 'high' | 'max';  // effort 级别
  context?: 'fork';                 // 在子 agent 中运行
  agent?: string;                   // 子 agent 类型
  paths?: string | string[];        // 限制激活的文件路径模式
  argumentHint?: string;            // 参数提示（如 [issue-number]）
}

export interface SkillRequirements {
  bins?: string[];   // CLI 工具依赖
  env?: string[];    // 环境变量依赖
}

export interface SkillSummary {
  name: string;
  description: string;
  location: string;
  available: boolean;
  requires?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface Skill {
  name: string;
  description: string;
  frontmatter: SkillFrontmatter;
  content: string;                  // Markdown 内容（不含 frontmatter）
  path: string;                     // SKILL.md 文件路径
  dir: string;                      // 技能目录路径
  supportingFiles: string[];        // 支持文件列表
}

export interface SkillMatch {
  skill: Skill;
  confidence: number;  // 匹置信度 0-1
  reason: 'user-invocation' | 'description-match' | 'path-match';
}

export interface SkillLoaderConfig {
  skillsPath: string;
  autoReload?: boolean;
}

// ============================================================================
// 字段验证（规范要求）
// ============================================================================

/**
 * 验证技能名称
 * 规范：1-64 字符，小写字母/数字/连字符，不能以连字符开头/结尾，不能有连续连字符
 */
export function validateSkillName(name: string, dirName: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 长度检查
  if (name.length < 1) {
    errors.push('name must be at least 1 character');
  }
  if (name.length > 64) {
    errors.push(`name must be at most 64 characters, got ${name.length}`);
  }

  // 字符检查
  if (!/^[a-z0-9-]+$/.test(name)) {
    errors.push('name must contain only lowercase letters, numbers, and hyphens');
  }

  // 连字符位置检查
  if (name.startsWith('-')) {
    errors.push('name must not start with a hyphen');
  }
  if (name.endsWith('-')) {
    errors.push('name must not end with a hyphen');
  }

  // 连续连字符检查
  if (name.includes('--')) {
    errors.push('name must not contain consecutive hyphens');
  }

  // 目录名匹配检查（规范要求）
  if (name !== dirName) {
    errors.push(`name "${name}" must match parent directory name "${dirName}"`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证技能描述
 * 规范：1-1024 字符，非空
 */
export function validateDescription(description: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const trimmed = description.trim();

  // 非空检查
  if (trimmed.length === 0) {
    errors.push('description must be non-empty');
  }

  // 长度检查
  if (trimmed.length > 1024) {
    errors.push(`description must be at most 1024 characters, got ${trimmed.length}`);
  }

  // 质量警告（建议）
  if (trimmed.length < 20) {
    warnings.push('description should be more descriptive (recommend > 20 characters)');
  }
  if (!trimmed.includes('Use when') && !trimmed.includes('用于') && !trimmed.includes('当')) {
    warnings.push('description should indicate when to use the skill');
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证 compatibility 字段
 * 规范：最多 500 字符
 */
export function validateCompatibility(compatibility: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (compatibility.length > 500) {
    errors.push(`compatibility must be at most 500 characters, got ${compatibility.length}`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 验证 SKILL.md 内容长度（Progressive Disclosure 建议）
 */
export function validateSkillContent(content: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const lines = content.split('\n').length;

  // 规范建议：SKILL.md 保持在 500 行以内
  if (lines > 500) {
    warnings.push(`SKILL.md has ${lines} lines, recommend keeping under 500 lines (split to references/)`);
  }

  // 规范建议：body < 5000 tokens
  const estimatedTokens = estimateContentTokens(content);
  if (estimatedTokens > 5000) {
    warnings.push(`SKILL.md body estimated ~${estimatedTokens} tokens, recommend < 5000 tokens`);
  }

  return { valid: true, errors, warnings };
}

/**
 * 估算内容 token 数
 */
function estimateContentTokens(content: string): number {
  const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = content.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

// ============================================================================
// YAML Frontmatter 解析
// ============================================================================

/**
 * 简化的 YAML frontmatter 解析器
 * 支持 basic key: value 格式和嵌套对象
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } | null {
  // 查找 --- 分隔符
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) {
    // 没有 frontmatter，整个内容作为 body
    return {
      frontmatter: {},
      body: content.trim()
    };
  }
  
  const yamlContent = match[1];
  const body = match[2].trim();
  
  const frontmatter: any = {};
  
  // 简化解析：逐行处理
  const lines = yamlContent.split('\n');
  let currentKey: string | null = null;
  let currentArray: string[] | null = null;
  let inNestedObject = false;  // 是否在嵌套对象中
  let nestedObject: any = {};
  let currentNestedKey: string | null = null;
  let currentNestedArray: string[] | null = null;
  
  for (const line of lines) {
    // 嵌套对象下的数组项 (如 requires.env: 下的 - VAR，4空格缩进)
    const nestedArrayMatch = line.match(/^    - (.+)$/);
    if (nestedArrayMatch && inNestedObject && currentNestedArray !== null) {
      currentNestedArray.push(nestedArrayMatch[1].trim());
      continue;
    }
    
    // 嵌套对象的键值对 (如 env:，2空格缩进)
    const nestedKvMatch = line.match(/^  ([a-zA-Z-]+):\s*(.*)$/);
    if (nestedKvMatch && inNestedObject) {
      // 保存之前的嵌套数组
      if (currentNestedKey && currentNestedArray !== null) {
        nestedObject[currentNestedKey] = currentNestedArray;
        currentNestedArray = null;
        currentNestedKey = null;
      }
      
      const subKey = nestedKvMatch[1];
      const subValue = nestedKvMatch[2].trim();
      
      if (subValue === '') {
        // 数组开始
        currentNestedKey = subKey;
        currentNestedArray = [];
      } else {
        nestedObject[subKey] = subValue;
      }
      continue;
    }
    
    // 如果在嵌套对象中但遇到了顶层键，结束嵌套对象
    if (inNestedObject && currentKey) {
      // 保存最后的嵌套数组
      if (currentNestedKey && currentNestedArray !== null) {
        nestedObject[currentNestedKey] = currentNestedArray;
        currentNestedArray = null;
        currentNestedKey = null;
      }
      // 保存嵌套对象
      frontmatter[currentKey] = nestedObject;
      nestedObject = {};
      inNestedObject = false;
    }
    
    // 顶层数组项 (2空格缩进)
    const arrayMatch = line.match(/^  - (.+)$/);
    if (arrayMatch && currentKey && currentArray !== null && !inNestedObject) {
      currentArray.push(arrayMatch[1].trim());
      continue;
    }
    
    // 顶层键值对
    const kvMatch = line.match(/^([a-zA-Z-]+):\s*(.*)$/);
    if (kvMatch) {
      // 保存之前的数组
      if (currentKey && currentArray !== null && currentArray.length > 0 && !inNestedObject) {
        frontmatter[currentKey] = currentArray;
        currentArray = null;
      }
      
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      
      // 处理不同类型
      if (value === '') {
        // 可能是数组或嵌套对象开始
        // 先假设是嵌套对象，如果下一行是 2空格缩进的键，则是嵌套对象
        // 否则是数组
        currentArray = [];
        inNestedObject = false;  // 暂时设为 false，后面会判断
      } else if (value === 'true' || value === 'false') {
        frontmatter[currentKey] = value === 'true';
        currentKey = null;
      } else if (/^\d+$/.test(value)) {
        frontmatter[currentKey] = parseInt(value);
        currentKey = null;
      } else {
        // 字符串，去除引号
        frontmatter[currentKey] = value.replace(/^["']|["']$/g, '');
        currentKey = null;
      }
      
      // 检查下一行判断是嵌套对象还是数组
      const nextLineIdx = lines.indexOf(line) + 1;
      if (nextLineIdx < lines.length && currentKey) {
        const nextLine = lines[nextLineIdx];
        const nextNestedKv = nextLine.match(/^  ([a-zA-Z-]+):/);
        const nextArray = nextLine.match(/^  - /);
        if (nextNestedKv && !nextArray) {
          // 下一行是嵌套对象的键
          inNestedObject = true;
          nestedObject = {};
          currentArray = null;
        }
      }
      continue;
    }
  }
  
  // 保存最后的数组
  if (currentKey && currentArray !== null && currentArray.length > 0) {
    frontmatter[currentKey] = currentArray;
  }
  // 保存最后的嵌套对象
  if (inNestedObject && currentKey) {
    if (currentNestedKey && currentNestedArray !== null) {
      nestedObject[currentNestedKey] = currentNestedArray;
    }
    frontmatter[currentKey] = nestedObject;
  }
  
  // 转换字段名（YAML 用 kebab-case，我们用 camelCase）
  const normalized: SkillFrontmatter = {
    // 规范字段
    name: frontmatter.name,
    description: frontmatter.description,
    license: frontmatter.license,
    compatibility: frontmatter.compatibility,
    metadata: frontmatter.metadata,
    allowedTools: frontmatter['allowed-tools'] || frontmatter.allowedTools,
    
    // 扩展字段
    always: frontmatter.always,
    requires: frontmatter.requires,
    disableModelInvocation: frontmatter['disable-model-invocation'],
    userInvocable: frontmatter['user-invocable'] ?? true,
    model: frontmatter.model,
    effort: frontmatter.effort,
    context: frontmatter.context,
    agent: frontmatter.agent,
    paths: frontmatter.paths,
    argumentHint: frontmatter['argument-hint']
  };
  
  return { frontmatter: normalized, body };
}

/**
 * 解析 $ARGUMENTS 和 $N 占位符
 */
function processArguments(content: string, args: string[]): string {
  let result = content;
  
  // 先替换 $ARGUMENTS[N]（更具体的模式）
  args.forEach((arg, index) => {
    result = result.replace(new RegExp(`\\$ARGUMENTS\\[${index}\\]`, 'g'), arg);
  });
  
  // 再替换 $N 简写（注意：只匹配独立的 $数字）
  args.forEach((arg, index) => {
    result = result.replace(new RegExp(`\\$${index}(?![0-9])`, 'g'), arg);
  });
  
  // 最后替换 $ARGUMENTS（所有参数）
  if (result.includes('$ARGUMENTS')) {
    result = result.replace(/\$ARGUMENTS/g, args.join(' '));
  } else if (args.length > 0) {
    // 如果内容没有 $ARGUMENTS 且没有使用任何 $N，追加参数
    const usedPlaceholders = args.some((_, i) => content.includes(`$${i}`) || content.includes(`$ARGUMENTS[${i}]`));
    if (!usedPlaceholders) {
      result += `\n\nARGUMENTS: ${args.join(' ')}`;
    }
  }
  
  return result;
}

/**
 * 解析 !`command` 动态注入语法
 */
async function processDynamicInjection(content: string): Promise<string> {
  const regex = /!`([^`]+)`/g;
  const matches = [...content.matchAll(regex)];
  
  if (matches.length === 0) {
    return content;
  }
  
  let result = content;
  
  for (const match of matches) {
    const command = match[1];
    try {
      // 使用 exec 工具执行命令
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(command, { timeout: 10000 });
      result = result.replace(match[0], stdout.trim());
    } catch (e) {
      console.warn(`[SkillLoader] 命令执行失败：${command}`, (e as Error).message);
      result = result.replace(match[0], `[命令执行失败: ${command}]`);
    }
  }
  
  return result;
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
        const skillDir = join(this.config.skillsPath, dir);
        const skillFile = join(skillDir, 'SKILL.md');
        
        try {
          // 检查是否是目录
          const dirStat = await stat(skillDir);
          if (!dirStat.isDirectory()) continue;
          
          const content = await readFile(skillFile, 'utf-8');
          const parsed = parseFrontmatter(content);
          
          if (!parsed) continue;
          
          // 验证 name 字段（规范要求）
          const skillName = parsed.frontmatter.name || dir;
          const nameValidation = validateSkillName(skillName, dir);
          if (!nameValidation.valid) {
            console.warn(`[SkillLoader] 跳过 "${dir}"：name 字段无效 - ${nameValidation.errors.join(', ')}`);
            continue;
          }
          
          // 验证 description 字段（规范要求）
          const skillDescription = parsed.frontmatter.description || this.extractDescription(parsed.body) || '';
          const descValidation = validateDescription(skillDescription);
          if (!descValidation.valid) {
            console.warn(`[SkillLoader] 跳过 "${dir}"：description 字段无效 - ${descValidation.errors.join(', ')}`);
            continue;
          }
          
          // 验证 compatibility 字段（如果有）
          if (parsed.frontmatter.compatibility) {
            const compatValidation = validateCompatibility(parsed.frontmatter.compatibility);
            if (!compatValidation.valid) {
              console.warn(`[SkillLoader] 跳过 "${dir}"：compatibility 字段无效 - ${compatValidation.errors.join(', ')}`);
              continue;
            }
          }
          
          // Progressive Disclosure 建议（仅警告）
          const contentValidation = validateSkillContent(content);
          for (const warning of contentValidation.warnings) {
            console.warn(`[SkillLoader] 技能 "${skillName}" 建议：${warning}`);
          }
          for (const warning of descValidation.warnings) {
            console.warn(`[SkillLoader] 技能 "${skillName}" 建议：${warning}`);
          }
          
          // 获取支持文件列表
          const supportingFiles = await this.getSupportingFiles(skillDir);
          
          const skill: Skill = {
            name: skillName,
            description: skillDescription,
            frontmatter: parsed.frontmatter,
            content: parsed.body,
            path: skillFile,
            dir: skillDir,
            supportingFiles
          };
          
          this.skills.set(skill.name, skill);
          
          const invocation = parsed.frontmatter.disableModelInvocation ? '手动调用' : '自动';
          console.log(`[SkillLoader] 加载技能 "${skill.name}" (${invocation})`);
        } catch (e) {
          console.warn(`[SkillLoader] 跳过 "${dir}"：缺少 SKILL.md 或解析失败`);
        }
      }
      
      this.loaded = true;
      console.log(`[SkillLoader] 已加载 ${this.skills.size} 个技能`);
    } catch (e) {
      console.warn('[SkillLoader] 扫描技能目录失败：', (e as Error).message);
      this.loaded = true;
    }
  }

  /**
   * 获取支持文件列表
   */
  private async getSupportingFiles(skillDir: string): Promise<string[]> {
    try {
      const files = await readdir(skillDir);
      return files
        .filter(f => f !== 'SKILL.md' && !f.startsWith('.'))
        .map(f => join(skillDir, f));
    } catch {
      return [];
    }
  }

  /**
   * 从内容中提取描述（如果没有 frontmatter description）
   */
  private extractDescription(content: string): string | null {
    // 取第一个段落
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
        return trimmed.slice(0, 250);  // 限制 250 字符
      }
    }
    return null;
  }

  /**
   * 根据用户输入匹配技能（语义匹配 description）
   */
  matchSkillsByDescription(userInput: string): SkillMatch[] {
    if (!this.loaded) return [];
    
    const inputLower = userInput.toLowerCase();
    const matches: SkillMatch[] = [];
    
    for (const skill of this.skills.values()) {
      // 跳过禁止自动调用的技能
      if (skill.frontmatter.disableModelInvocation) continue;
      
      // 语义匹配 description
      const descLower = skill.description.toLowerCase();
      
      // 简化的语义匹配：检查关键词是否在输入中出现
      // 支持中文和英文
      const extractKeywords = (text: string): string[] => {
        const keywords: string[] = [];
        // 提取中文词组（2-4个字的组合）
        const chineseMatches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
        keywords.push(...chineseMatches);
        // 提取2字中文词（更细粒度）
        const twoCharMatches = text.match(/[\u4e00-\u9fa5]{2}/g) || [];
        keywords.push(...twoCharMatches);
        // 提取英文单词
        const englishWords = text.match(/[a-zA-Z]{2,}/g) || [];
        keywords.push(...englishWords.map(w => w.toLowerCase()));
        return keywords;
      };
      
      const descKeywords = extractKeywords(descLower);
      
      // 检查描述中的关键词是否在用户输入中出现
      let overlapCount = 0;
      for (const keyword of descKeywords) {
        // 检查关键词是否出现在用户输入中（子串匹配）
        if (inputLower.includes(keyword)) {
          overlapCount++;
        }
      }
      
      // 同时检查用户输入中的关键词是否在描述中
      const inputKeywords = extractKeywords(inputLower);
      for (const keyword of inputKeywords) {
        if (descLower.includes(keyword)) {
          overlapCount++;
        }
      }
      
      if (overlapCount > 0) {
        const confidence = Math.min(overlapCount / Math.max(descKeywords.length, 1), 1);
        matches.push({
          skill,
          confidence: Math.max(confidence, 0.3),
          reason: 'description-match'
        });
      }
    }
    
    // 按置信度排序
    matches.sort((a, b) => b.confidence - a.confidence);
    
    return matches;
  }

  /**
   * 用户手动调用技能（/skill-name）
   */
  async invokeSkill(skillName: string, args: string[]): Promise<string | null> {
    const skill = this.skills.get(skillName);
    
    if (!skill) {
      console.warn(`[SkillLoader] 技能 "${skillName}" 不存在`);
      return null;
    }
    
    // 处理参数
    let content = processArguments(skill.content, args);
    
    // 处理动态注入
    content = await processDynamicInjection(content);
    
    return content;
  }

  /**
   * 检查技能是否可被用户调用
   */
  isUserInvocable(skillName: string): boolean {
    const skill = this.skills.get(skillName);
    return skill ? (skill.frontmatter.userInvocable ?? true) : false;
  }

  /**
   * 获取所有用户可调用的技能名称（用于 / 菜单）
   */
  getUserInvocableSkills(): string[] {
    return Array.from(this.skills.values())
      .filter(s => s.frontmatter.userInvocable ?? true)
      .map(s => s.name);
  }

  /**
   * 获取最佳匹配技能
   */
  getBestMatch(userInput: string): SkillMatch | null {
    const matches = this.matchSkillsByDescription(userInput);
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * 生成技能相关的 system prompt
   */
  generateSkillPrompt(userInput: string): string | null {
    const match = this.getBestMatch(userInput);
    
    if (!match) return null;
    
    const { skill, confidence } = match;
    
    let prompt = `\n[技能: ${skill.name}]\n`;
    prompt += `${skill.description}\n`;
    
    if (skill.frontmatter.allowedTools && skill.frontmatter.allowedTools.length > 0) {
      prompt += `推荐工具: ${skill.frontmatter.allowedTools.join(', ')}\n`;
    }
    
    prompt += `置信度: ${Math.round(confidence * 100)}%`;
    
    return prompt;
  }

  // =========================================================================
  // 渐进式披露 (Progressive Disclosure)
  // =========================================================================

  /**
   * Level 1: 生成技能摘要 (JSON 格式，始终在上下文中)
   * @param excludeAlways 是否排除 always 技能（默认 true，避免与 Active Skills 重复）
   */
  buildSkillsSummary(excludeAlways: boolean = true): string {
    let skills = this.getSkills();
    
    // 排除 always 技能（已在 Active Skills 中加载）
    if (excludeAlways) {
      skills = skills.filter(s => s.frontmatter.always !== true);
    }
    
    const summary: { skills: SkillSummary[] } = {
      skills: skills.map(skill => {
        const available = this.checkRequirements(skill);
        const entry: SkillSummary = {
          name: skill.name,
          description: skill.description,
          location: skill.path,
          available
        };
        if (!available) {
          entry.requires = this.getMissingRequirements(skill);
        }
        return entry;
      })
    };
    return JSON.stringify(summary, null, 2);
  }

  /**
   * Level 2: 加载技能完整内容（去除 frontmatter）
   */
  loadSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) return null;
    return skill.content;
  }

  /**
   * 获取 always 技能（始终加载完整内容）
   */
  getAlwaysSkills(): Skill[] {
    return this.getSkills().filter(s => s.frontmatter.always === true);
  }

  /**
   * 加载所有 always 技能的内容
   * 使用 XML 标签包裹，避免内容干扰 prompt 结构
   */
  loadAlwaysSkillsContent(): string {
    const alwaysSkills = this.getAlwaysSkills();
    if (alwaysSkills.length === 0) return '';
    
    return alwaysSkills
      .map(s => `<skill name="${s.name}">\n${this.loadSkillContent(s.name)}\n</skill>`)
      .join('\n\n');
  }

  /**
   * 检查技能依赖是否满足
   */
  checkRequirements(skill: Skill): boolean {
    const requires = skill.frontmatter.requires;
    if (!requires) return true;
    
    // 检查 CLI 工具
    if (requires.bins && requires.bins.length > 0) {
      for (const bin of requires.bins) {
        if (!this.checkBinAvailable(bin)) return false;
      }
    }
    
    // 检查环境变量
    if (requires.env && requires.env.length > 0) {
      for (const env of requires.env) {
        if (!process.env[env]) return false;
      }
    }
    
    return true;
  }

  /**
   * 获取缺失的依赖描述
   */
  getMissingRequirements(skill: Skill): string {
    const missing: string[] = [];
    const requires = skill.frontmatter.requires;
    
    if (!requires) return '';
    
    if (requires.bins) {
      for (const bin of requires.bins) {
        if (!this.checkBinAvailable(bin)) {
          missing.push(`CLI: ${bin}`);
        }
      }
    }
    
    if (requires.env) {
      for (const env of requires.env) {
        if (!process.env[env]) {
          missing.push(`ENV: ${env}`);
        }
      }
    }
    
    return missing.join(', ');
  }

  /**
   * 检查 CLI 工具是否可用
   */
  private checkBinAvailable(bin: string): boolean {
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? `where ${bin}` : `which ${bin}`;
      execSync(cmd, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
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
   * 检查技能是否存在
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 重新加载技能
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

// 导出辅助函数供外部使用
export { parseFrontmatter, processArguments, processDynamicInjection };