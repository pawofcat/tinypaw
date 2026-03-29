#!/usr/bin/env node
/**
 * 渐进式披露测试 - Table Driven
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { SkillLoader } from '../../src/skill-loader.js';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_PATH = './test-skills-progressive';

describe('buildSkillsSummary (JSON 格式)', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('生成有效的 JSON 摘要', async () => {
    const skillDir = join(TEST_PATH, 'test-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: test-skill
description: A test skill for testing
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const summary = loader.buildSkillsSummary();
    const parsed = JSON.parse(summary);
    
    assert.ok(parsed.skills);
    assert.strictEqual(parsed.skills.length, 1);
    assert.strictEqual(parsed.skills[0].name, 'test-skill');
    assert.strictEqual(parsed.skills[0].description, 'A test skill for testing');
    assert.strictEqual(parsed.skills[0].available, true);
  });

  it('多技能摘要', async () => {
    for (const name of ['skill-a', 'skill-b', 'skill-c']) {
      const skillDir = join(TEST_PATH, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: ${name}
description: ${name} description
---
Content`, 'utf-8');
    }
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const summary = loader.buildSkillsSummary();
    const parsed = JSON.parse(summary);
    
    assert.strictEqual(parsed.skills.length, 3);
    const names = parsed.skills.map((s: any) => s.name);
    assert.ok(names.includes('skill-a'));
    assert.ok(names.includes('skill-b'));
    assert.ok(names.includes('skill-c'));
  });

  it('包含 location 路径', async () => {
    const skillDir = join(TEST_PATH, 'path-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: path-skill
description: Test
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const summary = loader.buildSkillsSummary();
    const parsed = JSON.parse(summary);
    
    assert.ok(parsed.skills[0].location);
    assert.ok(parsed.skills[0].location.includes('path-skill'));
    assert.ok(parsed.skills[0].location.includes('SKILL.md'));
  });

  it('excludeAlways=true 排除 always 技能', async () => {
    // 创建 always 技能
    const alwaysDir = join(TEST_PATH, 'always-skill');
    await mkdir(alwaysDir, { recursive: true });
    await writeFile(join(alwaysDir, 'SKILL.md'), `---
name: always-skill
description: Always loaded
always: true
---
Content`, 'utf-8');
    
    // 创建普通技能
    const normalDir = join(TEST_PATH, 'normal-skill');
    await mkdir(normalDir, { recursive: true });
    await writeFile(join(normalDir, 'SKILL.md'), `---
name: normal-skill
description: Normal skill
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    // excludeAlways=true（默认）
    const summaryExclude = loader.buildSkillsSummary(true);
    const parsedExclude = JSON.parse(summaryExclude);
    assert.strictEqual(parsedExclude.skills.length, 1);
    assert.strictEqual(parsedExclude.skills[0].name, 'normal-skill');
    
    // excludeAlways=false
    const summaryAll = loader.buildSkillsSummary(false);
    const parsedAll = JSON.parse(summaryAll);
    assert.strictEqual(parsedAll.skills.length, 2);
  });
});

describe('checkRequirements', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('无依赖时返回 true', async () => {
    const skillDir = join(TEST_PATH, 'no-deps');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: no-deps
description: No dependencies
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const skill = loader.getSkill('no-deps');
    assert.ok(skill);
    assert.strictEqual(loader.checkRequirements(skill!), true);
  });

  it('有环境变量依赖时检查', async () => {
    const skillDir = join(TEST_PATH, 'env-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: env-skill
description: Needs env var
requires:
  env:
    - TINYPAW_TEST_VAR_12345
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const skill = loader.getSkill('env-skill');
    assert.ok(skill);
    // 没有设置这个变量，应该是 false
    assert.strictEqual(loader.checkRequirements(skill!), false);
  });

  it('环境变量存在时返回 true', async () => {
    process.env.TINYPAW_TEST_VAR_EXISTS = 'yes';
    
    const skillDir = join(TEST_PATH, 'env-exists');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: env-exists
description: Has env var
requires:
  env:
    - TINYPAW_TEST_VAR_EXISTS
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const skill = loader.getSkill('env-exists');
    assert.ok(skill);
    assert.strictEqual(loader.checkRequirements(skill!), true);
    
    delete process.env.TINYPAW_TEST_VAR_EXISTS;
  });
});

describe('getMissingRequirements', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('无缺失时返回空字符串', async () => {
    const skillDir = join(TEST_PATH, 'no-missing');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: no-missing
description: Test
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const skill = loader.getSkill('no-missing');
    assert.ok(skill);
    assert.strictEqual(loader.getMissingRequirements(skill!), '');
  });

  it('缺失环境变量时显示 ENV', async () => {
    const skillDir = join(TEST_PATH, 'missing-env');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: missing-env
description: Test
requires:
  env:
    - MISSING_VAR_XYZ
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const skill = loader.getSkill('missing-env');
    assert.ok(skill);
    const missing = loader.getMissingRequirements(skill!);
    assert.ok(missing.includes('ENV:'));
    assert.ok(missing.includes('MISSING_VAR_XYZ'));
  });

  it('摘要中显示缺失依赖', async () => {
    const skillDir = join(TEST_PATH, 'with-requires');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: with-requires
description: Test
requires:
  env:
    - MISSING_VAR_ABC
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const summary = loader.buildSkillsSummary();
    const parsed = JSON.parse(summary);
    
    assert.strictEqual(parsed.skills[0].available, false);
    assert.ok(parsed.skills[0].requires);
    assert.ok(parsed.skills[0].requires.includes('ENV:'));
  });
});

describe('getAlwaysSkills', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('筛选 always=true 的技能', async () => {
    // 创建 always 技能
    const alwaysDir = join(TEST_PATH, 'always-skill');
    await mkdir(alwaysDir, { recursive: true });
    await writeFile(join(alwaysDir, 'SKILL.md'), `---
name: always-skill
description: Always loaded
always: true
---
Always content`, 'utf-8');
    
    // 创建普通技能
    const normalDir = join(TEST_PATH, 'normal-skill');
    await mkdir(normalDir, { recursive: true });
    await writeFile(join(normalDir, 'SKILL.md'), `---
name: normal-skill
description: Normal skill
---
Normal content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const alwaysSkills = loader.getAlwaysSkills();
    assert.strictEqual(alwaysSkills.length, 1);
    assert.strictEqual(alwaysSkills[0].name, 'always-skill');
  });

  it('无 always 技能时返回空数组', async () => {
    const skillDir = join(TEST_PATH, 'no-always');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: no-always
description: Test
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const alwaysSkills = loader.getAlwaysSkills();
    assert.strictEqual(alwaysSkills.length, 0);
  });
});

describe('loadAlwaysSkillsContent', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('加载所有 always 技能内容（XML 标签包裹）', async () => {
    const alwaysDir = join(TEST_PATH, 'always-one');
    await mkdir(alwaysDir, { recursive: true });
    await writeFile(join(alwaysDir, 'SKILL.md'), `---
name: always-one
description: First always
always: true
---
First always content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const content = loader.loadAlwaysSkillsContent();
    assert.ok(content.includes('<skill name="always-one">'));
    assert.ok(content.includes('</skill>'));
    assert.ok(content.includes('First always content'));
  });

  it('多个 always 技能分别包裹', async () => {
    for (const name of ['always-a', 'always-b']) {
      const skillDir = join(TEST_PATH, name);
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), `---
name: ${name}
description: ${name}
always: true
---
${name} content`, 'utf-8');
    }
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const content = loader.loadAlwaysSkillsContent();
    assert.ok(content.includes('<skill name="always-a">'));
    assert.ok(content.includes('<skill name="always-b">'));
    // 每个技能独立包裹
    const openTags = (content.match(/<skill name="/g) || []).length;
    const closeTags = (content.match(/<\/skill>/g) || []).length;
    assert.strictEqual(openTags, 2);
    assert.strictEqual(closeTags, 2);
  });

  it('无 always 技能时返回空字符串', async () => {
    const skillDir = join(TEST_PATH, 'normal');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: normal
description: Normal
---
Content`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const content = loader.loadAlwaysSkillsContent();
    assert.strictEqual(content, '');
  });
});

describe('loadSkillContent', () => {
  beforeEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEST_PATH, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_PATH, { recursive: true, force: true }).catch(() => {});
  });

  it('加载技能内容（不含 frontmatter）', async () => {
    const skillDir = join(TEST_PATH, 'content-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), `---
name: content-skill
description: Test
---
# Real Content

This is the body.`, 'utf-8');
    
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const content = loader.loadSkillContent('content-skill');
    assert.ok(content !== null);
    assert.ok(!content.includes('---'));
    assert.ok(content.includes('Real Content'));
    assert.ok(content.includes('This is the body'));
  });

  it('不存在技能返回 null', async () => {
    const loader = new SkillLoader({ skillsPath: TEST_PATH });
    await loader.load();
    
    const content = loader.loadSkillContent('nonexistent');
    assert.strictEqual(content, null);
  });
});