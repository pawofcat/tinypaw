#!/usr/bin/env node
/**
 * 技能匹配算法测试 - Table Driven
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SkillLoader } from '../../src/skill-loader.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_PATH = './test-skills-match';

describe('matchSkillsByDescription', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  // 关键词匹配
  const keywordCases = [
    { name: 'memory', desc: '记住信息，记录笔记，管理记忆。当用户说记住或记下来时使用。', input: '请记住这件事', match: true, note: '中文匹配' },
    { name: 'deploy', desc: '部署应用，发布到服务器，上线。', input: '删除文件', match: false, note: '不相关' },
    { name: 'search', desc: 'Search files and directories. Use when finding files.', input: 'search for config', match: true, note: '英文匹配' },
    { name: 'pdf', desc: 'Extracts text from PDF files. Use when handling PDFs.', input: 'extract PDF content', match: true, note: 'PDF匹配' },
  ];

  for (const { name, desc, input, match, note } of keywordCases) {
    it(`关键词: ${note}`, async () => {
      const skillDir = join(TEST_PATH, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\nContent`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      
      const matches = loader.matchSkillsByDescription(input);
      if (match) {
        assert.ok(matches.some(m => m.skill.name === name));
      } else {
        assert.ok(!matches.some(m => m.skill.name === name));
      }
    });
  }

  // disableModelInvocation 跳过
  const autoCases = [
    { name: 'auto', disable: false, input: '使用auto', match: true, note: '自动启用' },
    { name: 'manual', disable: true, input: '使用manual', match: false, note: '禁止自动' },
  ];

  for (const { name, disable, input, match, note } of autoCases) {
    it(`自动调用: ${note}`, async () => {
      const skillDir = join(TEST_PATH, name);
      await mkdir(skillDir, { recursive: true });
      const yaml = disable ? 'disable-model-invocation: true' : '';
      await writeFile(join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}技能\n${yaml}\n---\nContent`, 'utf-8');
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      
      const matches = loader.matchSkillsByDescription(input);
      if (match) {
        assert.ok(matches.some(m => m.skill.name === name));
      } else {
        assert.ok(!matches.some(m => m.skill.name === name));
      }
    });
  }

  // 多技能竞争
  it('多技能竞争按置信度排序', async () => {
    const dirs = ['skill-a', 'skill-b'];
    for (const dir of dirs) {
      const skillDir = join(TEST_PATH, dir);
      await mkdir(skillDir, { recursive: true });
    }
    await writeFile(join(TEST_PATH, 'skill-a/SKILL.md'), `---
name: skill-a
description: 记住信息，记忆，记录笔记
---
Content`, 'utf-8');
    await writeFile(join(TEST_PATH, 'skill-b/SKILL.md'), `---
name: skill-b
description: 完全不相关的描述内容
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const matches = loader.matchSkillsByDescription('请记住这件事');
    assert.ok(matches.length >= 1, 'Should have at least one match');
    if (matches.length > 1) {
      assert.strictEqual(matches[0].skill.name, 'skill-a');
    }
  });
});

describe('getBestMatch', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  const bestCases = [
    { skills: [{ n: 'memory', d: '记住信息，记录笔记，管理记忆。当用户说记住时使用。' }, { n: 'deploy', d: '部署应用到服务器。' }], input: '请记住', best: 'memory', note: '选择最佳' },
    { skills: [{ n: 'a', d: '不相关的描述内容' }, { n: 'b', d: '也无关系的内容' }], input: '随便聊聊', best: null, note: '无匹配' },
  ];

  for (const { skills, input, best, note } of bestCases) {
    it(`最佳匹配: ${note}`, async () => {
      for (const s of skills) {
        const dir = join(TEST_PATH, s.n);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'SKILL.md'), `---\nname: ${s.n}\ndescription: ${s.d}\n---\nContent`, 'utf-8');
      }
      
      const loader = new SkillLoader({ skillsPath: TEST_PATH });
      await loader.load();
      
      const match = loader.getBestMatch(input);
      if (best) {
        assert.ok(match !== null);
        assert.strictEqual(match!.skill.name, best);
      } else {
        assert.strictEqual(match, null);
      }
    });
  }
});

describe('SkillMatch 结构', () => {
  it('包含 skill, confidence, reason', async () => {
    const testPath = './test-skills-struct';
    await rm(testPath, { recursive: true, force: true }).catch(() => {});
    await mkdir(testPath, { recursive: true });
    
    const skillDir = join(testPath, 'test-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---\nname: test-skill\ndescription: 测试技能\n---\nContent`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: testPath });
    await loader.load();
    
    const matches = loader.matchSkillsByDescription('测试');
    if (matches.length > 0) {
      const m = matches[0];
      assert.ok(m.skill);
      assert.ok(typeof m.confidence === 'number');
      assert.ok(m.confidence >= 0 && m.confidence <= 1);
      assert.ok(['user-invocation', 'description-match', 'path-match'].includes(m.reason));
    }
    
    await rm(testPath, { recursive: true, force: true }).catch(() => {});
  });
});