#!/usr/bin/env node
/**
 * 测试辅助工具：创建测试技能
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SkillBuilderOptions {
  name: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  body?: string;
  scripts?: Array<{ name: string; content: string }>;
  references?: Array<{ name: string; content: string }>;
  assets?: Array<{ name: string; content: string }>;
}

/**
 * 创建测试技能目录
 */
export async function createSkill(
  basePath: string,
  options: SkillBuilderOptions
): Promise<string> {
  const skillDir = join(basePath, options.name);
  await mkdir(skillDir, { recursive: true });

  // 构建 YAML frontmatter
  const yamlParts: string[] = [];
  yamlParts.push(`name: ${options.name}`);
  
  if (options.description) {
    yamlParts.push(`description: ${options.description}`);
  }
  
  if (options.license) {
    yamlParts.push(`license: ${options.license}`);
  }
  
  if (options.compatibility) {
    yamlParts.push(`compatibility: ${options.compatibility}`);
  }
  
  if (options.metadata) {
    yamlParts.push('metadata:');
    for (const [key, value] of Object.entries(options.metadata)) {
      yamlParts.push(`  ${key}: "${value}"`);
    }
  }
  
  if (options.allowedTools && options.allowedTools.length > 0) {
    yamlParts.push('allowed-tools:');
    for (const tool of options.allowedTools) {
      yamlParts.push(`  - ${tool}`);
    }
  }
  
  if (options.disableModelInvocation !== undefined) {
    yamlParts.push(`disable-model-invocation: ${options.disableModelInvocation}`);
  }
  
  if (options.userInvocable !== undefined) {
    yamlParts.push(`user-invocable: ${options.userInvocable}`);
  }

  const yaml = yamlParts.join('\n');
  const body = options.body || 'Default skill content.';
  const skillContent = `---\n${yaml}\n---\n${body}`;

  await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');

  // 创建 scripts
  if (options.scripts) {
    const scriptsDir = join(skillDir, 'scripts');
    await mkdir(scriptsDir, { recursive: true });
    for (const script of options.scripts) {
      await writeFile(join(scriptsDir, script.name), script.content, 'utf-8');
    }
  }

  // 创建 references
  if (options.references) {
    const refsDir = join(skillDir, 'references');
    await mkdir(refsDir, { recursive: true });
    for (const ref of options.references) {
      await writeFile(join(refsDir, ref.name), ref.content, 'utf-8');
    }
  }

  // 创建 assets
  if (options.assets) {
    const assetsDir = join(skillDir, 'assets');
    await mkdir(assetsDir, { recursive: true });
    for (const asset of options.assets) {
      await writeFile(join(assetsDir, asset.name), asset.content, 'utf-8');
    }
  }

  return skillDir;
}

/**
 * 创建多个测试技能
 */
export async function createSkills(
  basePath: string,
  skills: SkillBuilderOptions[]
): Promise<string[]> {
  const dirs: string[] = [];
  for (const skill of skills) {
    const dir = await createSkill(basePath, skill);
    dirs.push(dir);
  }
  return dirs;
}

/**
 * 清理测试目录
 */
export async function cleanupTestDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {});
}

/**
 * 创建临时测试环境
 */
export async function setupTestEnv(basePath: string): Promise<void> {
  await mkdir(basePath, { recursive: true });
}

/**
 * 快捷方法：创建有效技能
 */
export function validSkill(name: string = 'test-skill'): SkillBuilderOptions {
  return {
    name,
    description: `A valid skill named ${name}. Use when testing.`,
    body: `# ${name}\n\nThis is a test skill.`
  };
}

/**
 * 快捷方法：创建无效名称技能
 */
export function invalidNameSkill(): SkillBuilderOptions {
  return {
    name: 'Invalid-Name',
    description: 'Skill with uppercase name',
    body: 'Content'
  };
}

/**
 * 快捷方法：创建隐藏技能
 */
export function hiddenSkill(name: string = 'hidden-skill'): SkillBuilderOptions {
  return {
    name,
    description: 'A hidden skill',
    userInvocable: false,
    body: 'Hidden content'
  };
}

/**
 * 快捷方法：创建禁用自动调用技能
 */
export function manualOnlySkill(name: string = 'manual-skill'): SkillBuilderOptions {
  return {
    name,
    description: 'Manual invocation only',
    disableModelInvocation: true,
    body: 'Manual only content'
  };
}