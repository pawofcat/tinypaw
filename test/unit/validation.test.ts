#!/usr/bin/env node
/**
 * 字段验证测试 - Table Driven
 * 基于 skill-specification.mdx 规范
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  validateSkillName,
  validateDescription,
  validateCompatibility,
  validateSkillContent
} from '../../src/skill-loader.js';

describe('validateSkillName', () => {
  // 有效名称测试
  const validNames = [
    { name: 'pdf-processing', dir: 'pdf-processing', desc: '标准技能名' },
    { name: 'data-analysis', dir: 'data-analysis', desc: '多个连字符' },
    { name: 'code-review', dir: 'code-review', desc: '两个单词' },
    { name: 'a', dir: 'a', desc: '单字符名称' },
    { name: 'skill123', dir: 'skill123', desc: '含数字' },
    { name: 'abc-def-ghi', dir: 'abc-def-ghi', desc: '三段连字符' },
    { name: 'x-y-z', dir: 'x-y-z', desc: '单字符间连字符' },
  ];

  for (const { name, dir, desc } of validNames) {
    it(`有效: ${desc} (${name})`, () => {
      const result = validateSkillName(name, dir);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
      assert.strictEqual(result.errors.length, 0);
    });
  }

  // 无效名称 - 长度
  const invalidLength = [
    { name: '', dir: '', err: 'at least 1 character' },
    { name: 'a'.repeat(65), dir: 'a'.repeat(65), err: 'at most 64 characters' },
  ];

  for (const { name, dir, err } of invalidLength) {
    it(`无效长度: "${name.slice(0, 20)}..."`, () => {
      const result = validateSkillName(name, dir);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes(err)));
    });
  }

  // 无效名称 - 字符
  const invalidChars = [
    { name: 'PDF-Processing', dir: 'PDF-Processing', err: 'lowercase' },
    { name: 'skill_name', dir: 'skill_name', err: 'hyphens' },
    { name: 'skill.name', dir: 'skill.name', err: 'hyphens' },
    { name: 'skill name', dir: 'skill name', err: 'hyphens' },
    { name: '技能名称', dir: '技能名称', err: 'hyphens' },
  ];

  for (const { name, dir, err } of invalidChars) {
    it(`无效字符: "${name}"`, () => {
      const result = validateSkillName(name, dir);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes(err)));
    });
  }

  // 无效名称 - 连字符位置
  const invalidHyphen = [
    { name: '-pdf', dir: '-pdf', err: 'start with a hyphen' },
    { name: 'pdf-', dir: 'pdf-', err: 'end with a hyphen' },
    { name: '-skill-', dir: '-skill-', err: 'start with a hyphen' },
    { name: 'pdf--processing', dir: 'pdf--processing', err: 'consecutive hyphens' },
    { name: 'a--b--c', dir: 'a--b--c', err: 'consecutive hyphens' },
  ];

  for (const { name, dir, err } of invalidHyphen) {
    it(`无效连字符: "${name}"`, () => {
      const result = validateSkillName(name, dir);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes(err)));
    });
  }

  // 名称与目录不匹配
  const mismatches = [
    { name: 'skill-a', dir: 'skill-b' },
    { name: 'pdf', dir: 'pdf-processing' },
    { name: 'correct-name', dir: 'wrong-name' },
  ];

  for (const { name, dir } of mismatches) {
    it(`不匹配目录: "${name}" vs "${dir}"`, () => {
      const result = validateSkillName(name, dir);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('must match parent directory')));
    });
  }

  // 多错误组合
  it('多个错误同时违反多条规则', () => {
    const result = validateSkillName('-Invalid-Name-', '-Invalid-Name-');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length >= 2);
    assert.ok(result.errors.some(e => e.includes('start')));
    assert.ok(result.errors.some(e => e.includes('end')));
    assert.ok(result.errors.some(e => e.includes('lowercase')));
  });
});

describe('validateDescription', () => {
  // 有效描述
  const validDescs = [
    { desc: 'Extracts text from PDF files. Use when working with PDFs.', note: '规范示例' },
    { desc: '记住信息，记录笔记。当用户说记住时使用。', note: '中文描述' },
    { desc: 'A', note: '最小长度' },
    { desc: 'a'.repeat(1024), note: '最大长度' },
    { desc: 'Deploy applications. Use when deploying.', note: '良好描述' },
  ];

  for (const { desc, note } of validDescs) {
    it(`有效: ${note}`, () => {
      const result = validateDescription(desc);
      assert.strictEqual(result.valid, true, `Errors: ${result.errors.join(', ')}`);
    });
  }

  // 无效描述
  const invalidDescs = [
    { desc: '', err: 'non-empty' },
    { desc: '   ', err: 'non-empty' },
    { desc: '\n\t', err: 'non-empty' },
    { desc: 'a'.repeat(1025), err: 'at most 1024' },
  ];

  for (const { desc, err } of invalidDescs) {
    it(`无效: "${desc.slice(0, 30)}..."`, () => {
      const result = validateDescription(desc);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes(err)));
    });
  }

  // 警告（非错误）
  const warningDescs = [
    { desc: 'Short', warn: 'more descriptive' },
    { desc: 'This is a skill description without usage hint.', warn: 'when to use' },
  ];

  for (const { desc, warn } of warningDescs) {
    it(`警告: "${desc.slice(0, 30)}..."`, () => {
      const result = validateDescription(desc);
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.some(w => w.includes(warn)));
    });
  }

  it('良好描述无警告', () => {
    const result = validateDescription('Extracts text from PDFs. Use when user mentions PDFs.');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.warnings.length, 0);
  });
});

describe('validateCompatibility', () => {
  const compatCases = [
    { compat: 'Requires git, docker, jq', valid: true, note: '标准格式' },
    { compat: 'Designed for Claude Code', valid: true, note: '产品说明' },
    { compat: 'Requires Python 3.14+', valid: true, note: '版本要求' },
    { compat: '', valid: true, note: '空字符串' },
    { compat: 'a'.repeat(500), valid: true, note: '最大500字符' },
    { compat: 'a'.repeat(501), valid: false, note: '超过500字符' },
  ];

  for (const { compat, valid, note } of compatCases) {
    it(`${valid ? '有效' : '无效'}: ${note}`, () => {
      const result = validateCompatibility(compat);
      assert.strictEqual(result.valid, valid);
    });
  }
});

describe('validateSkillContent', () => {
  const contentCases = [
    { lines: 100, warns: [] },
    { lines: 300, warns: [] },
    { lines: 501, warns: ['500 lines'] },
    { lines: 600, warns: ['500 lines', '5000 tokens'] },
  ];

  for (const { lines, warns } of contentCases) {
    it(`${lines}行 → ${warns.length}警告`, () => {
      const lineContent = 'This is a test line with content.\n';
      const content = lineContent.repeat(lines);
      const result = validateSkillContent(content);
      assert.strictEqual(result.valid, true);
      for (const w of warns) {
        assert.ok(result.warnings.some(r => r.includes(w)), `Should warn: ${w}`);
      }
    });
  }

  it('空内容无警告', () => {
    const result = validateSkillContent('');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.warnings.length, 0);
  });
});

describe('ValidationResult 结构', () => {
  it('有效结果空错误数组', () => {
    const result = validateSkillName('valid-name', 'valid-name');
    assert.deepStrictEqual(result.errors, []);
    assert.deepStrictEqual(result.warnings, []);
  });

  it('无效结果有错误', () => {
    const result = validateSkillName('-invalid-', '-invalid-');
    assert.ok(result.errors.length > 0);
    assert.strictEqual(result.valid, false);
  });

  it('警告不影响valid状态', () => {
    const result = validateDescription('short');
    assert.strictEqual(result.valid, true);
    assert.ok(result.warnings.length > 0);
  });
});