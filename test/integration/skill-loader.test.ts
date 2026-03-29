#!/usr/bin/env node
/**
 * 技能加载集成测试 - Table Driven
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SkillLoader } from '../../src/skill-loader.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_PATH = './test-skills-integration';

describe('SkillLoader 集成测试', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  describe('目录结构加载', () => {
    const structureCases = [
      { dirs: ['valid'], count: 1, names: ['valid'], note: '单个技能' },
      { dirs: ['skill-a', 'skill-b'], count: 2, names: ['skill-a', 'skill-b'], note: '多个技能' },
    ];

    for (const { dirs, count, names, note } of structureCases) {
      it(`目录结构: ${note}`, async () => {
        for (const dir of dirs) {
          const skillDir = join(TEST_PATH, dir);
          await mkdir(skillDir, { recursive: true });
          await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${dir}\ndescription: ${dir} skill\n---\nContent`, 'utf-8');
        }
        
        const loader = new SkillLoader({ skillsPath: TEST_PATH });
        await loader.load();
        
        assert.strictEqual(loader.getSkills().length, count);
        for (const name of names) {
          assert.ok(loader.hasSkill(name));
        }
      });
    }

    it('含scripts目录', async () => {
      const skillDir = join(TEST_PATH, 'with-scripts');
      await mkdir(join(skillDir, 'scripts'), { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---\nname: with-scripts\ndescription: With scripts\n---\nContent`, 'utf-8');
      await writeFile(join(skillDir, 'scripts/run.sh'), '#!/bin/bash', 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      
      const skill = loader.getSkill('with-scripts');
      assert.ok(skill !== undefined);
      assert.ok(skill!.supportingFiles.length >= 1);
    });
  });

  describe('无效技能跳过', () => {
    const invalidCases = [
      { valid: ['ok'], invalid: ['no-md'], skipReason: '无SKILL.md', note: '跳过无md' },
      { valid: ['ok'], invalid: ['Invalid-Name'], skipReason: '大写名称', note: '跳过无效名' },
      { valid: ['ok'], invalid: ['mismatch'], skipReason: '名称不匹配', note: '跳过不匹配' },
    ];

    for (const { valid, invalid, skipReason, note } of invalidCases) {
      it(`无效跳过: ${note}`, async () => {
        // 创建有效技能
        for (const name of valid) {
          const dir = join(TEST_PATH, name);
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Valid\n---\nContent`, 'utf-8');
        }
        
        // 创建无效技能
        for (const name of invalid) {
          const dir = join(TEST_PATH, name);
          await mkdir(dir, { recursive: true });
          
          if (skipReason === '无SKILL.md') {
            await writeFile(join(dir, 'README.md'), 'No skill', 'utf-8');
          } else if (skipReason === '大写名称') {
            await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Invalid\n---\nContent`, 'utf-8');
          } else if (skipReason === '名称不匹配') {
            await writeFile(join(dir, 'SKILL.md'), `---\nname: different-name\ndescription: Mismatch\n---\nContent`, 'utf-8');
          }
        }
        
        const loader = new SkillLoader({ skillsPath: TEST_PATH });
        await loader.load();
        
        assert.strictEqual(loader.getSkills().length, valid.length);
        for (const name of invalid) {
          assert.strictEqual(loader.hasSkill(name), false);
        }
      });
    }
  });

  describe('热重载', () => {
    it('reload清空并重新加载', async () => {
      const dir1 = join(TEST_PATH, 'initial');
      await mkdir(dir1, { recursive: true });
      await writeFile(join(dir1, 'SKILL.md'), `---\nname: initial\ndescription: Initial\n---\nContent`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      assert.strictEqual(loader.getSkills().length, 1);
      
      // 添加新技能
      const dir2 = join(TEST_PATH, 'new');
      await mkdir(dir2, { recursive: true });
      await writeFile(join(dir2, 'SKILL.md'), `---\nname: new\ndescription: New\n---\nContent`, 'utf-8');
      
      await loader.reload();
      assert.strictEqual(loader.getSkills().length, 2);
      assert.ok(loader.hasSkill('new'));
    });

    it('reload更新已修改技能', async () => {
      const dir = join(TEST_PATH, 'update');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), `---\nname: update\ndescription: Original\n---\nContent`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      assert.strictEqual(loader.getSkill('update')?.description, 'Original');
      
      await writeFile(join(dir, 'SKILL.md'), `---\nname: update\ndescription: Updated\n---\nContent`, 'utf-8');
      await loader.reload();
      assert.strictEqual(loader.getSkill('update')?.description, 'Updated');
    });
  });

  describe('技能调用', () => {
    it('invokeSkill处理参数', async () => {
      const dir = join(TEST_PATH, 'fix');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), `---\nname: fix\ndescription: Fix issues\n---\nFix issue $ARGUMENTS now`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      
      const result = await loader.invokeSkill('fix', ['123']);
      assert.ok(result !== null);
      assert.ok(result.includes('Fix issue 123 now'));
    });

    it('不存在技能返回null', async () => {
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      assert.strictEqual(await loader.invokeSkill('nonexistent', []), null);
    });
  });

  describe('用户可调用技能', () => {
    const invocableCases = [
      { name: 'public', invocable: true, inList: true, note: '显式true' },
      { name: 'default', invocable: undefined, inList: true, note: '默认true' },
      { name: 'hidden', invocable: false, inList: false, note: '显式false' },
    ];

    for (const { name, invocable, inList, note } of invocableCases) {
      it(`用户可调用: ${note}`, async () => {
        const dir = join(TEST_PATH, name);
        await mkdir(dir, { recursive: true });
        const yaml = invocable !== undefined ? `user-invocable: ${invocable}` : '';
        await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test\n${yaml}\n---\nContent`, 'utf-8');
        
        const loader = new SkillLoader({ skillsPath: TEST_PATH });
        await loader.load();
        
        const list = loader.getUserInvocableSkills();
        if (inList) {
          assert.ok(list.includes(name));
          assert.strictEqual(loader.isUserInvocable(name), true);
        } else {
          assert.ok(!list.includes(name));
          assert.strictEqual(loader.isUserInvocable(name), false);
        }
      });
    }
  });
});