#!/usr/bin/env node
/**
 * SkillLoader 单元测试 - Claude Code Skills 规范兼容
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SkillLoader, initializeSkills, parseFrontmatter, processArguments } from '../src/skill-loader.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_SKILLS_PATH = './test-skills';

describe('SkillLoader (Claude Code 规范)', () => {
  beforeEach(async () => {
    await rm(TEST_SKILLS_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_SKILLS_PATH, { recursive: true }).catch(() => {});
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_PATH, { recursive: true, force: true }).catch(() => {});
  });

  describe('YAML Frontmatter 解析', () => {
    it('应该解析基本 frontmatter', () => {
      const content = `---
name: test-skill
description: 测试技能描述
---
# Test Skill
内容`;
      
      const result = parseFrontmatter(content);
      assert.ok(result !== null);
      assert.strictEqual(result!.frontmatter.name, 'test-skill');
      assert.strictEqual(result!.frontmatter.description, '测试技能描述');
      assert.strictEqual(result!.body, '# Test Skill\n内容');
    });

    it('应该解析布尔值字段', () => {
      const content = `---
name: deploy
disable-model-invocation: true
user-invocable: false
---
Deploy content`;
      
      const result = parseFrontmatter(content);
      assert.ok(result !== null);
      assert.strictEqual(result!.frontmatter.disableModelInvocation, true);
      assert.strictEqual(result!.frontmatter.userInvocable, false);
    });

    it('应该解析数组字段', () => {
      const content = `---
name: memory
allowed-tools:
  - memory_search
  - memory_get
---
Memory content`;
      
      const result = parseFrontmatter(content);
      assert.ok(result !== null);
      assert.ok(Array.isArray(result!.frontmatter.allowedTools));
      assert.strictEqual(result!.frontmatter.allowedTools!.length, 2);
      assert.ok(result!.frontmatter.allowedTools!.includes('memory_search'));
    });

    it('应该处理没有 frontmatter 的内容', () => {
      const content = `# Skill without frontmatter
Just content here`;
      
      const result = parseFrontmatter(content);
      assert.ok(result !== null);
      assert.strictEqual(result!.frontmatter.name, undefined);
      assert.strictEqual(result!.body, '# Skill without frontmatter\nJust content here');
    });
  });

  describe('参数处理', () => {
    it('应该替换 $ARGUMENTS', () => {
      const content = 'Fix issue $ARGUMENTS please';
      const result = processArguments(content, ['123', 'urgent']);
      assert.strictEqual(result, 'Fix issue 123 urgent please');
    });

    it('应该替换 $ARGUMENTS[N]', () => {
      const content = 'Migrate $ARGUMENTS[0] from $ARGUMENTS[1] to $ARGUMENTS[2]';
      const result = processArguments(content, ['Button', 'React', 'Vue']);
      assert.strictEqual(result, 'Migrate Button from React to Vue');
    });

    it('应该替换 $N 简写', () => {
      const content = 'First: $0, Second: $1';
      const result = processArguments(content, ['apple', 'banana']);
      assert.strictEqual(result, 'First: apple, Second: banana');
    });

    it('没有 $ARGUMENTS 时应追加参数', () => {
      const content = 'Do something';
      const result = processArguments(content, ['with', 'args']);
      assert.ok(result.includes('ARGUMENTS: with args'));
    });
  });

  describe('技能加载', () => {
    it('应该加载有 SKILL.md 的技能目录', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'test-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
name: test-skill
description: 测试技能
---
# Test
Content here`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skill = loader.getSkill('test-skill');
      assert.ok(skill !== undefined);
      assert.strictEqual(skill!.name, 'test-skill');
      assert.strictEqual(skill!.description, '测试技能');
    });

    it('应该使用目录名作为默认名称', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'my-skill');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
description: 没有名称字段
---
Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skill = loader.getSkill('my-skill');
      assert.ok(skill !== undefined);
    });

    it('应该跳过没有 SKILL.md 的目录', async () => {
      const emptyDir = join(TEST_SKILLS_PATH, 'empty-dir');
      await mkdir(emptyDir, { recursive: true });
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      assert.strictEqual(loader.getSkills().length, 0);
    });
  });

  describe('技能匹配', () => {
    it('应该通过 description 语义匹配', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'memory');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
name: memory
description: 记住信息，记录笔记，管理记忆
---
Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const matches = loader.matchSkillsByDescription('请记住这件事');
      assert.ok(matches.length > 0);
      assert.strictEqual(matches[0].skill.name, 'memory');
    });

    it('应该跳过 disable-model-invocation 的技能', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'deploy');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
name: deploy
description: 部署应用
disable-model-invocation: true
---
Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const matches = loader.matchSkillsByDescription('部署到生产环境');
      assert.strictEqual(matches.length, 0);  // 被跳过
    });

    it('getBestMatch 应返回最高置信度匹配', async () => {
      const skillDir1 = join(TEST_SKILLS_PATH, 'skill-a');
      const skillDir2 = join(TEST_SKILLS_PATH, 'skill-b');
      await mkdir(skillDir1, { recursive: true });
      await mkdir(skillDir2, { recursive: true });
      
      await writeFile(join(skillDir1, 'SKILL.md'), `---
name: skill-a
description: 记住信息
---\nContent`, 'utf-8');
      
      await writeFile(join(skillDir2, 'SKILL.md'), `---
name: skill-b
description: 完全不相关
---\nContent`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const match = loader.getBestMatch('请记住这件事');
      assert.ok(match !== null);
      assert.strictEqual(match!.skill.name, 'skill-a');
    });
  });

  describe('用户调用技能', () => {
    it('invokeSkill 应处理参数', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'fix');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
name: fix
description: 修复问题
---
Fix issue $ARGUMENTS now`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const result = await loader.invokeSkill('fix', ['123']);
      assert.ok(result !== null);
      assert.ok(result!.includes('Fix issue 123 now'));
    });

    it('isUserInvocable 应检查 user-invocable 字段', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'hidden');
      await mkdir(skillDir, { recursive: true });
      
      const skillContent = `---
name: hidden
description: 隐藏技能
user-invocable: false
---
Content`;
      await writeFile(join(skillDir, 'SKILL.md'), skillContent, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      assert.strictEqual(loader.isUserInvocable('hidden'), false);
    });

    it('getUserInvocableSkills 应列出可调用技能', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'public');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: public
description: 公开技能
---
Content`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      const skills = loader.getUserInvocableSkills();
      assert.ok(skills.includes('public'));
    });
  });

  describe('技能重新加载', () => {
    it('reload 应清空并重新加载', async () => {
      const skillDir = join(TEST_SKILLS_PATH, 'reload-test');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: reload-test
description: 初始
---
Content`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_SKILLS_PATH });
      await loader.load();
      
      assert.strictEqual(loader.getSkills().length, 1);
      
      // 添加新技能
      const newSkillDir = join(TEST_SKILLS_PATH, 'new-skill');
      await mkdir(newSkillDir, { recursive: true });
      await writeFile(join(newSkillDir, 'SKILL.md'), `---
name: new-skill
description: 新技能
---
Content`, 'utf-8');
      
      await loader.reload();
      assert.strictEqual(loader.getSkills().length, 2);
    });
  });
});

describe('initializeSkills 函数', () => {
  it('应初始化并返回 SkillLoader', async () => {
    const loader = await initializeSkills(TEST_SKILLS_PATH);
    assert.ok(loader instanceof SkillLoader);
  });
});