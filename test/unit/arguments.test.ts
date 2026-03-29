#!/usr/bin/env node
/**
 * 参数处理测试 - Table Driven
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { processArguments } from '../../src/skill-loader.js';

describe('processArguments', () => {
  // $ARGUMENTS 替换
  const argsCases = [
    { tpl: 'Fix issue $ARGUMENTS now', args: ['123'], exp: 'Fix issue 123 now', note: '单参数' },
    { tpl: 'Search for $ARGUMENTS', args: ['hello', 'world'], exp: 'Search for hello world', note: '多参数' },
    { tpl: 'Process $ARGUMENTS', args: [], exp: 'Process ', note: '空参数' },
    { tpl: '$ARGUMENTS', args: ['arg1', 'arg2'], exp: 'arg1 arg2', note: '仅占位符' },
  ];

  for (const { tpl, args, exp, note } of argsCases) {
    it(`$ARGUMENTS: ${note}`, () => {
      assert.strictEqual(processArguments(tpl, args), exp);
    });
  }

  // $ARGUMENTS[N] 索引
  const indexCases = [
    { tpl: 'First: $ARGUMENTS[0]', args: ['one', 'two', 'three'], exp: 'First: one', note: '索引0' },
    { tpl: 'Third: $ARGUMENTS[2]', args: ['a', 'b', 'c'], exp: 'Third: c', note: '索引2' },
    { tpl: '$ARGUMENTS[0] and $ARGUMENTS[1]', args: ['first', 'second'], exp: 'first and second', note: '多个索引' },
  ];

  for (const { tpl, args, exp, note } of indexCases) {
    it(`$ARGUMENTS[N]: ${note}`, () => {
      assert.strictEqual(processArguments(tpl, args), exp);
    });
  }

  // $N 简写
  const shorthandCases = [
    { tpl: 'First: $0, Second: $1', args: ['apple', 'banana'], exp: 'First: apple, Second: banana', note: '基本' },
    { tpl: '$0 is first', args: ['test'], exp: 'test is first', note: '单参数' },
    { tpl: '$0 $1 $2', args: ['a', 'b', 'c'], exp: 'a b c', note: '连续' },
  ];

  for (const { tpl, args, exp, note } of shorthandCases) {
    it(`$N简写: ${note}`, () => {
      assert.strictEqual(processArguments(tpl, args), exp);
    });
  }

  // 混合使用
  const mixedCases = [
    { tpl: '$ARGUMENTS[0] and $ARGUMENTS', args: ['x', 'y'], exp: 'x and x y', note: '索引+整体' },
    { tpl: '$0 is part of $ARGUMENTS', args: ['first', 'second'], exp: 'first is part of first second', note: '简写+整体' },
  ];

  for (const { tpl, args, exp, note } of mixedCases) {
    it(`混合: ${note}`, () => {
      assert.strictEqual(processArguments(tpl, args), exp);
    });
  }

  // 无占位符追加
  const appendCases = [
    { tpl: 'Do something', args: ['with', 'args'], append: true, note: '应追加' },
    { tpl: 'Just content', args: ['single'], append: true, note: '单参数追加' },
    { tpl: 'Empty args', args: [], append: false, note: '空参数不追加' },
    { tpl: 'Used $ARGUMENTS[0]', args: ['x'], append: false, note: '已用索引不追加' },
    { tpl: 'Used $0', args: ['x'], append: false, note: '已用简写不追加' },
  ];

  for (const { tpl, args, append, note } of appendCases) {
    it(`追加行为: ${note}`, () => {
      const result = processArguments(tpl, args);
      if (append && args.length > 0) {
        assert.ok(result.includes('ARGUMENTS:'));
      } else if (!append) {
        assert.strictEqual(result.includes('\n\nARGUMENTS:'), false);
      }
    });
  }

  // 重复占位符
  it('重复占位符', () => {
    assert.strictEqual(
      processArguments('$ARGUMENTS[0], $ARGUMENTS[0], $ARGUMENTS[0]', ['same']),
      'same, same, same'
    );
  });

  it('$ARGUMENTS多次出现', () => {
    assert.strictEqual(
      processArguments('$ARGUMENTS - $ARGUMENTS - $ARGUMENTS', ['a', 'b']),
      'a b - a b - a b'
    );
  });
});

describe('processArguments - 实际场景', () => {
  const scenarios = [
    { tpl: 'Fix GitHub issue $ARGUMENTS.', args: ['123'], note: 'Issue处理' },
    { tpl: 'Create PR for $ARGUMENTS[0] targeting $ARGUMENTS[1]', args: ['feature', 'main'], note: 'PR创建' },
    { tpl: 'Review file $0', args: ['src/agent.ts'], note: '文件审查' },
  ];

  for (const { tpl, args, note } of scenarios) {
    it(`场景: ${note}`, () => {
      const result = processArguments(tpl, args);
      for (const arg of args) {
        assert.ok(result.includes(arg));
      }
      assert.ok(!result.includes('$ARGUMENTS'));
      assert.ok(!result.match(/\$\d/));
    });
  }
});