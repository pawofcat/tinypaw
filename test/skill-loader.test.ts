#!/usr/bin/env node
/**
 * SkillLoader 单元测试
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SkillLoader, initializeSkills } from '../src/skill-loader.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_SKILLS_PATH = './test-skills';

describe('SkillLoader', () => {
  beforeEach(async () => {
    // 清理并创建测试技能目录
    await rm(TEST_SKILLS_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_SKILLS_PATH, { recursive: true }).catch(() => {});
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_PATH, { recursive: true, force: true }).catch(() => {});
  });

  describe('技能加载', () => {
    it('应该加载有 SKILL.md 的技能目录', async () => {
      // 创建测试技能
      const skillDir = join(TEST_SKILLS_PATH, 'test-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `
# Test Skill

## 描述
这是一个测试技能

## 触发条件
- "测试"
- "test"

## 工具
- read
- write
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skills = loader.getSkills();
      assert.ok(skills.length >= 1, '应至少加载 1 个技能');
      
      const skill = loader.getSkill('test-skill');
      assert.ok(skill !== undefined, '应能获取 test-skill');
      assert.strictEqual(skill?.name, 'test-skill', '技能名称应正确');
      assert.ok(skill?.triggers.length >= 2, '应解析出触发条件');
    });

    it('应该跳过没有 SKILL.md 的目录', async () => {
      // 创建没有 SKILL.md 的目录
      const emptyDir = join(TEST_SKILLS_PATH, 'empty-dir');
      await mkdir(emptyDir, { recursive: true });
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skills = loader.getSkills();
      assert.strictEqual(skills.length, 0, '不应加载空目录');
    });

    it('应该处理空技能目录', async () => {
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skills = loader.getSkills();
      assert.strictEqual(skills.length, 0, '空目录应返回 0 个技能');
    });
  });

  describe('技能匹配', () => {
    it('应该匹配关键词触发', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'keyword-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `
# Keyword Skill

## 描述
关键词匹配测试

## 触发条件
- "记住"
- "记下来"
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const matches = loader.matchSkills('请记住这件事');
      assert.ok(matches.length > 0, '应匹配到技能');
      assert.strictEqual(matches[0].skill.name, 'keyword-skill', '匹配的技能应正确');
    });

    it('应该匹配正则触发', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'regex-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `
# Regex Skill

## 描述
正则匹配测试

## 触发条件
- /记住.*事项/
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const matches = loader.matchSkills('请记住明天的事项');
      assert.ok(matches.length > 0, '正则应匹配成功');
    });

    it('应该返回最佳匹配', async () => {
      const skillDir1 = join(TEST_SKILLS_PATH, 'skill-a');
      const skillDir2 = join(TEST_SKILLS_PATH, 'skill-b');
      await mkdir(skillDir1, { recursive: true });
      await mkdir(skillDir2, { recursive: true });
      
      await writeFile(join(skillDir1, 'SKILL.md'), `
# Skill A
## 描述
技能 A
## 触发条件
- "测试"
`, 'utf-8');
      
      await writeFile(join(skillDir2, 'SKILL.md'), `
# Skill B
## 描述
技能 B
## 触发条件
- "测试技能"
`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const bestMatch = loader.getBestMatch('这是一个测试技能');
      assert.ok(bestMatch !== null, '应有匹配');
      // 更长的关键词应该优先匹配（因为 regex 类型优先级更高，但这里都是 keyword）
    });

    it('不应该匹配不相关的输入', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'memory-skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(join(skillDir, 'SKILL.md'), `
# Memory Skill
## 描述
记忆技能
## 触发条件
- "记住"
`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const matches = loader.matchSkills('今天天气怎么样');
      assert.strictEqual(matches.length, 0, '不相关输入不应匹配');
    });
  });

  describe('技能 Prompt 生成', () => {
    it('应该生成技能相关的 prompt', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'prompt-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `
# Prompt Skill

## 描述
Prompt 测试技能

## 触发条件
- "prompt"

## 工具
- read

## System Prompt
这是额外的系统提示。
`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const prompt = loader.generateSkillPrompt('请使用 prompt');
      assert.ok(prompt !== null, '应生成 prompt');
      assert.ok(prompt?.includes('prompt-skill'), '应包含技能名称');
      assert.ok(prompt?.includes('read'), '应包含推荐工具');
    });

    it('不匹配时应返回 null', async () => {
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const prompt = loader.generateSkillPrompt('随便说的话');
      assert.strictEqual(prompt, null, '不匹配应返回 null');
    });
  });

  describe('技能重新加载', () => {
    it('应该支持重新加载', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'reload-skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(join(skillDir, 'SKILL.md'), `
# Reload Skill
## 描述
初始版本
## 触发条件
- "reload"
`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      assert.strictEqual(loader.getSkills().length, 1, '初始应加载 1 个');
      
      // 修改技能文件
      await writeFile(join(skillDir, 'SKILL.md'), `
# Reload Skill
## 描述
更新版本
## 触发条件
- "reload"
- "重新加载"
`, 'utf-8');
      
      await loader.reload();
      
      const skill = loader.getSkill('reload-skill');
      assert.ok(skill?.triggers.length >= 2, '重新加载后应有更多触发条件');
    });
  });
});

describe('initializeSkills 函数', () => {
  it('应该初始化并返回 SkillLoader', async () => {
    const loader = await initializeSkills(TEST_SKILLS_PATH);
    assert.ok(loader !== undefined, '应返回 SkillLoader');
  });
});