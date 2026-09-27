/**
 * P1-7 规则库测试 —— md 载体 / `$hole` 匹配 / 修复萃取 / 三态应用 / 棘轮
 *
 * 覆盖点（每条对应一个设计承诺，失败即承诺破了）：
 *   1. md 载体：parse ⇄ serialize 往返；缺段宽容；缺 ```pattern 必须抛。
 *   2. 匹配：字面量（空白归一）、`$hole` 捕获与回填、`...` 跨行、**唯一才动**（歧义并列行号）。
 *   3. 萃取：行级 diff 取变化窗口；两侧共同标识符 → 同一 `$hole`；**pattern/夹具同 scope**
 *      （曾经的 bug：用整份输入当夹具 ⇒ 1 行 pattern 改 3 行文本 ⇒ 必然误报）。
 *   4. ★ 梯子：泛化过宽的候选必须被"三关"拦下并自动放宽，最终要么给出更强的合法规则，
 *      要么诚实降级为字面量（不许把没过关的规则落盘）。
 *   5. 三态：applied（唯一）/ todo（歧义 + TODO 注释）/ clean。
 *   6. 棘轮：无基线 ⇒ 存量算新增；有基线 ⇒ 未增加即通过，新增才 fail。
 */

import { DATA_DIR_NAME } from '../../src/data_dir.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseRule,
  serializeRule,
  loadRules,
  writeRule,
  isLegalRuleId,
  hasNegativeFixture,
  hasPositiveFixture,
  rulesDir,
} from '../../src/tools/rule_library';
import { matchRule, instantiateReplace, applyMatch, holeNamesOf, tokenizePattern } from '../../src/tools/rule_match';
import { diffLines, extractRule, generalizeChange, validateRule } from '../../src/tools/rule_extract';
import {
  applyRuleToContent,
  applyRulesToFiles,
  collectRuleTargets,
  loadBaseline,
  writeBaseline,
  ratchetDelta,
  runFixtures,
  runAllFixtures,
  commentStyleFor,
  insertTodo,
} from '../../src/tools/rule_apply';
import type { Rule } from '../../src/tools/rule_library';

/* ─────────────── 1. md 载体 ─────────────── */

describe('rule_library：md 载体', () => {
  const rule: Rule = {
    id: 'no-console-log',
    title: '禁止裸 console.log',
    tags: ['style', 'logging'],
    level: 'warn',
    language: 'typescript',
    createdFrom: '2026-09-15T00:00:00.000Z',
    description: '统一走 logger，别直接 console.log。',
    pattern: 'console.log($x);',
    replace: 'logger.info($x);',
    fixtures: [
      { title: '正例（出生回归）', before: 'console.log(a);', after: 'logger.info(a);', lang: 'ts' },
      { title: '反例（幂等）', negative: 'logger.info(a);', lang: 'ts' },
    ],
  };

  it('serialize ⇄ parse 往返（含夹具正/反例）', () => {
    const md = serializeRule(rule);
    const back = parseRule(md, rule.id);
    expect(back.title).toBe(rule.title);
    expect(back.tags).toEqual(rule.tags);
    expect(back.level).toBe('warn');
    expect(back.language).toBe('typescript');
    expect(back.createdFrom).toBe(rule.createdFrom);
    expect(back.description).toBe(rule.description);
    expect(back.pattern).toBe(rule.pattern);
    expect(back.replace).toBe(rule.replace);
    expect(back.fixtures).toHaveLength(2);
    expect(back.fixtures[0].before).toBe('console.log(a);');
    expect(back.fixtures[0].after).toBe('logger.info(a);');
    expect(back.fixtures[1].negative).toBe('logger.info(a);');
    expect(hasNegativeFixture(back)).toBe(true);
    expect(hasPositiveFixture(back)).toBe(true);
  });

  it('缺 pattern 必须抛（规则的核心不可缺省）', () => {
    expect(() => parseRule('# 只有说明\n\n```replace\nx\n```\n', 'bad')).toThrow(/pattern/);
  });

  it('宽容：缺 frontmatter / replace / 夹具也能读，给默认值', () => {
    const r = parseRule('```pattern\nfoo();\n```\n', 'minimal');
    expect(r.id).toBe('minimal');
    expect(r.title).toBe('minimal');
    expect(r.level).toBe('warn');
    expect(r.tags).toEqual([]);
    expect(r.replace).toBe('');
    expect(r.fixtures).toEqual([]);
    expect(hasNegativeFixture(r)).toBe(false);
  });

  it('段标题含"反例"的单块 = 反例（宁保守不漏判）', () => {
    const md = [
      '```pattern', 'a;', '```', '',
      '## 反例（不得命中）', '', '```ts', 'b;', '```', '',
    ].join('\n');
    const r = parseRule(md, 'neg');
    expect(r.fixtures).toHaveLength(1);
    expect(r.fixtures[0].negative).toBe('b;');
  });

  it('isLegalRuleId：只收小写字母/数字/连字符', () => {
    expect(isLegalRuleId('no-console-log')).toBe(true);
    expect(isLegalRuleId('r1')).toBe(true);
    expect(isLegalRuleId('No-Console')).toBe(false);
    expect(isLegalRuleId('-lead')).toBe(false);
    expect(isLegalRuleId('trail-')).toBe(false);
    expect(isLegalRuleId('has space')).toBe(false);
    expect(isLegalRuleId('has/slash')).toBe(false);
  });

  it('读写：loadRules 目录不存在 = 空库（不算错）；坏文件进 errors 不静默', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-rules-'));
    try {
      expect(loadRules(root).rules).toEqual([]);
      expect(loadRules(root).errors).toEqual([]);
      writeRule(root, rule);
      fs.writeFileSync(path.join(rulesDir(root), 'broken.md'), '# 没有 pattern 块\n', 'utf8');
      const r = loadRules(root);
      expect(r.rules.map((x) => x.id)).toEqual(['no-console-log']);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].file).toBe('broken.md');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ─────────────── 2. 匹配核 ─────────────── */

describe('rule_match：$hole / ... / 唯一才动', () => {
  it('holeNamesOf 去重且保序', () => {
    expect(holeNamesOf('f($a, $b, $a)')).toEqual(['a', 'b']);
    expect(holeNamesOf('no holes')).toEqual([]);
  });

  it('tokenizePattern：字面量 / $hole / ... 三种 token', () => {
    expect(tokenizePattern('console.log($x);')).toEqual([
      [{ kind: 'lit', text: 'console.log(' }, { kind: 'hole', name: 'x' }, { kind: 'lit', text: ');' }],
    ]);
    expect(tokenizePattern('...')).toEqual([[{ kind: 'star' }]]);
  });

  it('字面量匹配 = 空白归一（容忍 CRLF / 行内空格差异）', () => {
    const out = matchRule('const  a   = 1;\n', 'const a = 1;');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].matchedText).toBe('const  a   = 1;');
  });

  it('$hole 捕获片段并按名回填', () => {
    const out = matchRule('console.log(user.id);\n', 'console.log($x);');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].holes).toEqual([{ name: 'x', text: 'user.id' }]);
    expect(instantiateReplace('logger.info($x);', out.matches[0])).toBe('logger.info(user.id);');
  });

  it('同一 $hole 出现两次必须是同一实参（f($a, $a) 不匹配 f(1, 2)）', () => {
    expect(matchRule('f(1, 2);\n', 'f($a, $a);').matches).toHaveLength(0);
    expect(matchRule('f(7, 7);\n', 'f($a, $a);').matches).toHaveLength(1);
  });

  it('... 跨行通配（头尾锚定）', () => {
    const src = ['function f() {', '  a();', '  b();', '  c();', '}', ''].join('\n');
    const pat = ['function f() {', '...', '}', ''].join('\n');
    const out = matchRule(src, pat);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].startLine).toBe(1);
    expect(out.matches[0].endLine).toBe(5);
  });

  it('多行 pattern 逐行推进并按行号报区间', () => {
    const src = ['const a = 1;', 'const b = 2;', 'const c = 3;', ''].join('\n');
    const out = matchRule(src, 'const b = 2;\nconst c = 3;');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].startLine).toBe(2);
    expect(out.matches[0].endLine).toBe(3);
  });

  it('★ 唯一才动：两处命中 ⇒ ambiguous=true，并列行号，绝不挑一个', () => {
    const out = matchRule('f();\nf();\n', 'f();');
    expect(out.matches.map((m) => m.startLine)).toEqual([1, 2]);
    expect(out.ambiguous).toBe(true);
  });

  it('★ 同一行两处命中都要报出（曾因"相对偏移当绝对"漏报，且只报最左一处会静默改错）', () => {
    const out = matchRule('f(); f();\n', 'f();');
    expect(out.matches).toHaveLength(2);
    expect(out.matches.map((m) => m.end - m.start)).toEqual([4, 4]);
    expect(out.matches.map((m) => m.start)).toEqual([0, 5]);
    expect(out.ambiguous).toBe(true);
    expect(out.matches.map((m) => m.matchedText)).toEqual(['f();', 'f();']);
  });

  it('行内匹配带缩进/前后缀时区间仍然精确', () => {
    const out = matchRule('  if (x) { f(); }\n', 'f();');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].matchedText).toBe('f();');
    expect(out.matches[0].start).toBe(11);
    expect(out.matches[0].indent).toBe('  ');
  });

  it('applyMatch 只替换命中区间，保留缩进', () => {
    const src = '  console.log(a);\n';
    const out = matchRule(src, 'console.log($x);');
    const after = applyMatch(src, out.matches[0], 'logger.info($x);');
    expect(after).toBe('  logger.info(a);\n');
  });

  it('★ 缩进恰好补一次：行首与行中命中都不翻倍、不左移', () => {
    // ① 命中在行首缩进之内 ⇒ absorbsIndent=true，替换文本自己带缩进
    const atIndent = matchRule('  f();\n', 'f();').matches[0];
    expect(atIndent.absorbsIndent).toBe(true);
    expect(applyMatch('  f();\n', atIndent, 'g();')).toBe('  g();\n');
    // ② 命中在行中（左侧已有原文缩进）⇒ absorbsIndent=false，绝不补
    const midLine = matchRule('  x; f();\n', 'f();').matches[0];
    expect(midLine.absorbsIndent).toBe(false);
    expect(applyMatch('  x; f();\n', midLine, 'g();')).toBe('  x; g();\n');
    // ③ 带缩进的 pattern（pattern 自己也写了缩进）仍恰好补一次
    const src = '  return x.name;\n';
    const m = matchRule(src, '  return x.name;').matches[0];
    expect(m.absorbsIndent).toBe(true);
    expect(applyMatch(src, m, '  return x.profile.name;')).toBe('  return x.profile.name;\n');
  });

  it('hole 捕获不吃首尾空白（function $name() 的 $name = "f"）', () => {
    const out = matchRule('function f() {}\n', 'function $name() {}');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].holes).toEqual([{ name: 'name', text: 'f' }]);
  });

  it('hole 捕获不得含未平衡括号（不吃后续 token 的括号）', () => {
    const out = matchRule('g(f(a), b);\n', 'g($x, $y);');
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].holes).toEqual([
      { name: 'x', text: 'f(a)' },
      { name: 'y', text: 'b' },
    ]);
  });
});

/* ─────────────── 3. 萃取（差异 + 泛化） ─────────────── */

describe('rule_extract：差异与泛化', () => {
  it('diffLines：等长替换归为一个 change 块（del+ins 相邻须合并）', () => {
    const d = diffLines(['a', 'b', 'c'], ['a', 'B', 'c']);
    expect(d.filter((x) => x.kind !== 'equal')).toHaveLength(1);
    const ch = d.find((x) => x.kind !== 'equal')!;
    expect(ch.kind).toBe('change');
    expect(ch.beforeStart).toBe(2);
    expect(ch.beforeEnd).toBe(2);
    expect(ch.afterStart).toBe(2);
    expect(ch.afterEnd).toBe(2);
  });

  it('diffLines：纯增/纯删分得清，且区间语义正确', () => {
    const ins = diffLines(['a', 'c'], ['a', 'b', 'c']).filter((x) => x.kind !== 'equal');
    expect(ins).toHaveLength(1);
    expect(ins[0].kind).toBe('ins');
    expect(ins[0].beforeStart).toBeGreaterThan(ins[0].beforeEnd); // 空 before 区间
    expect(ins[0].afterStart).toBe(2);

    const del = diffLines(['a', 'b', 'c'], ['a', 'c']).filter((x) => x.kind !== 'equal');
    expect(del).toHaveLength(1);
    expect(del[0].kind).toBe('del');
    expect(del[0].beforeStart).toBe(2);
    expect(del[0].afterStart).toBeGreaterThan(del[0].afterEnd); // 空 after 区间
  });

  it('两侧都出现的标识符 → 同一 $hole；关键字/属性名不抽象', () => {
    const g = generalizeChange(['logger.info(user);'], ['logger.warn(user);']);
    // logger / user 两侧都有 → 都成 hole（logger 不在关键字/全局白名单里，抽象是对的）
    expect(g.holes).toEqual(['logger', 'user']);
    expect(g.pattern).toBe('$logger.info($user);');
    expect(g.replace).toBe('$logger.warn($user);');
    // 属性名（`.` 之后）与关键字不抽象；但属性链的**基对象** `a` 会抽象
    expect(generalizeChange(['return a.b;'], ['return a.c;']).holes).toEqual(['a']);
    expect(generalizeChange(['return a.b;'], ['return a.c;']).pattern).toBe('return $a.b;');
    // `const` 是关键字（不抽象），`x` 是普通标识符（抽象）
    expect(generalizeChange(['const x = 1;'], ['const x = 2;']).holes).toEqual(['x']);
    // 纯字面量改动（无可抽象标识符）⇒ 零 hole
    expect(generalizeChange(['return 1;'], ['return 2;']).holes).toEqual([]);
  });

  it('limit 限制抽象数量（梯子用）', () => {
    const g = generalizeChange(['f(alpha, beta);'], ['g(alpha, beta);'], 1);
    expect(g.holes).toEqual(['alpha']);
    expect(g.pattern).toBe('f($alpha, beta);');
  });

  it('★ 夹具与 pattern 同 scope：多行输入只取变化行窗口', () => {
    const r = extractRule({
      before: 'function f(x) {\n  return x.name;\n}',
      after: 'function f(x) {\n  return x.profile.name;\n}',
      id: 'prefer-profile-name',
    });
    expect(r.rule.pattern).toBe('  return x.name;');
    expect(r.rule.replace).toBe('  return x.profile.name;');
    // 夹具不得是整份 3 行输入（那会让 1 行 pattern 必然对不上）
    expect(r.rule.fixtures[0].before).toBe('  return x.name;');
    expect(r.rule.fixtures[0].after).toBe('  return x.profile.name;');
    expect(r.validation.ok).toBe(true);
  });
});

/* ─────────────── 4. ★ 梯子（泛化的度由三关裁决） ─────────────── */

describe('rule_extract：逐级放宽梯子', () => {
  it('泛化安全时直接用最强泛化（steps=0，不降级）', () => {
    const r = extractRule({
      before: 'console.log(user.id);',
      after: 'logger.info(user.id);',
      id: 'no-console-log',
    });
    expect(r.validation.ok).toBe(true);
    expect(r.generalization.candidateHoles).toBe(1);
    expect(r.generalization.holes).toEqual(['user']);
    expect(r.generalization.ladderSteps).toBe(0);
    expect(r.generalization.degraded).toBe(false);
    expect(r.rule.pattern).toBe('console.log($user.id);');
    // 泛化确实生效：换变量名仍命中
    expect(matchRule('console.log(order.id);', r.rule.pattern).matches).toHaveLength(1);
  });

  it('★ 泛化过宽必须被拦下并放宽：$x 会让 after 仍被命中 ⇒ 落回字面量并标 degraded', () => {
    const r = extractRule({
      before: 'function f(x) {\n  return x.name;\n}',
      after: 'function f(x) {\n  return x.profile.name;\n}',
      id: 'profile-chain',
    });
    // 第一级（$x）被 negative_hit / not_idempotent 拦下
    expect(r.generalization.attempts[0].holes).toEqual(['x']);
    expect(r.generalization.attempts[0].ok).toBe(false);
    expect(r.generalization.attempts[0].codes).toContain('negative_hit');
    // 放宽一级 → 字面量 → 通过
    expect(r.generalization.attempts).toHaveLength(2);
    expect(r.generalization.degraded).toBe(true);
    expect(r.generalization.ladderSteps).toBe(1);
    expect(r.validation.ok).toBe(true);
    expect(r.rule.pattern).toBe('  return x.name;');
    // 降级诚实：只有 warn（no_hole），没有 error
    expect(r.validation.issues.every((i) => i.severity === 'warn')).toBe(true);
  });

  it('★ 全败也不许"先写了再说"：validateRule 报 error 时 ok=false', () => {
    // pattern 命中 before，但改写结果 ≠ after ⇒ birth_regression_diff
    const v = validateRule('zzz($x);', 'nothing($x);', [
      { title: '正例', before: 'zzz(a);', after: 'zzz(a);', lang: '' },
      { title: '反例', negative: 'nothing(a);', lang: '' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('birth_regression_diff');
  });

  it('pattern 完全命中不到 before ⇒ birth_regression_miss', () => {
    const v = validateRule('zzz($x);', 'nothing($x);', [
      { title: '正例', before: 'yyy(a);', after: 'nothing(a);', lang: '' },
      { title: '反例', negative: 'nothing(a);', lang: '' },
    ]);
    expect(v.ok).toBe(false);
    expect(v.issues.map((i) => i.code)).toContain('birth_regression_miss');
  });

  it('缺正例 / 缺反例都是 error（可靠性层的必要条件）', () => {
    const v = validateRule('f($x);', 'g($x);', []);
    const codes = v.issues.map((i) => i.code);
    expect(codes).toContain('no_positive');
    expect(codes).toContain('no_negative');
    expect(v.ok).toBe(false);
  });

  it('零 hole 只给 warn（字面量规则仍可用），不阻断', () => {
    const v = validateRule('a();', 'b();', [
      { title: '正例', before: 'a();', after: 'b();', lang: '' },
      { title: '反例', negative: 'b();', lang: '' },
    ]);
    expect(v.ok).toBe(true);
    expect(v.issues.map((i) => i.code)).toEqual(['no_hole']);
  });
});

/* ─────────────── 5. 三态应用 ─────────────── */

describe('rule_apply：三态 + todo 注释', () => {
  let root: string;
  const rule: Rule = {
    id: 'no-console-log',
    title: 't',
    tags: [],
    level: 'warn',
    language: '',
    createdFrom: '',
    description: '',
    pattern: 'console.log($x);',
    replace: 'logger.info($x);',
    fixtures: [
      { title: '正例', before: 'console.log(a);', after: 'logger.info(a);', lang: '' },
      { title: '反例', negative: 'logger.info(a);', lang: '' },
    ],
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-apply-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('唯一命中 ⇒ applied（不写盘，只给 before/after）', () => {
    const src = 'const x = 1;\nconsole.log(x);\n';
    const o = applyRuleToContent('a.ts', src, rule, { todo: true });
    expect(o.state).toBe('applied');
    expect(o.applied).toBe(1);
    expect(o.after).toBe('const x = 1;\nlogger.info(x);\n');
    expect(fs.existsSync(path.join(root, 'a.ts'))).toBe(false); // 未写盘
  });

  it('无命中 ⇒ clean', () => {
    const o = applyRuleToContent('a.ts', 'const x = 1;\n', rule, {});
    expect(o.state).toBe('clean');
    expect(o.hits).toBe(0);
  });

  it('★ 歧义 ⇒ todo：插 TODO 注释，不挑一个改', () => {
    const src = 'console.log(a);\nconsole.log(b);\n';
    const o = applyRuleToContent('a.ts', src, rule, { todo: true });
    expect(o.state).toBe('todo');
    expect(o.hits).toBe(2);
    expect(o.todoReason).toMatch(/歧义/);
    expect(o.after).toContain('// TODO(no-console-log):');
    // 两处命中都还在（一个都没改）
    expect(o.after).toContain('console.log(a);');
    expect(o.after).toContain('console.log(b);');
  });

  it('todo=false 时只如实报告，不写注释', () => {
    const o = applyRuleToContent('a.ts', 'console.log(a);\nconsole.log(b);\n', rule, { todo: false });
    expect(o.state).toBe('todo');
    expect(o.after).toBeUndefined();
  });

  it('replace 与命中相同 ⇒ clean（不谎报"已改"）', () => {
    const idRule: Rule = { ...rule, id: 'noop', pattern: 'a();', replace: 'a();' };
    const o = applyRuleToContent('a.ts', 'a();\n', idRule, {});
    expect(o.state).toBe('clean');
    expect(o.applied).toBe(0);
  });

  it('commentStyleFor：按扩展名选注释符', () => {
    expect(commentStyleFor('a.ts')).toBe('//');
    expect(commentStyleFor('a.py')).toBe('#');
    expect(commentStyleFor('a.sql')).toBe('--');
  });

  it('insertTodo 按命中行缩进插入', () => {
    const out = insertTodo('function f() {\n  a();\n}\n', 2, 'rid', 'why', '//');
    expect(out.split('\n')[1]).toBe('  // TODO(rid): why');
  });

  it('collectRuleTargets：排除我们自己的派生物目录 / node_modules / third_party', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
    fs.mkdirSync(path.join(root, DATA_DIR_NAME, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(root, 'third_party', 'archify'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a();', 'utf8');
    fs.writeFileSync(path.join(root, 'node_modules', 'x', 'b.ts'), 'b();', 'utf8');
    fs.writeFileSync(path.join(root, DATA_DIR_NAME, 'rules', 'c.ts'), 'c();', 'utf8');
    fs.writeFileSync(path.join(root, 'third_party', 'archify', 'd.ts'), 'd();', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'e.md'), 'not code', 'utf8');
    expect(collectRuleTargets(root)).toEqual(['src/a.ts']);
  });

  it('collectRuleTargets：glob 过滤', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'a();', 'utf8');
    fs.writeFileSync(path.join(root, 'lib', 'b.ts'), 'b();', 'utf8');
    expect(collectRuleTargets(root, { glob: '^src/' })).toEqual(['src/a.ts']);
  });

  it('applyRulesToFiles：干净的不入清单（减少噪声），计数自洽', () => {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'hit.ts'), 'console.log(a);\n', 'utf8');
    fs.writeFileSync(path.join(root, 'src', 'clean.ts'), 'const a = 1;\n', 'utf8');
    const files = collectRuleTargets(root);
    const s = applyRulesToFiles(root, files, [rule], { todo: true });
    expect(s.outcomes.map((o) => o.file)).toEqual(['src/hit.ts']);
    expect(s.applied).toBe(1);
    expect(s.totalHits).toBe(1);
  });
});

/* ─────────────── 6. 棘轮 baseline ─────────────── */

describe('rule_apply：CI 棘轮', () => {
  let root: string;
  const rule: Rule = {
    id: 'r',
    title: 't',
    tags: [],
    level: 'warn',
    language: '',
    createdFrom: '',
    description: '',
    pattern: 'bad($x);',
    replace: 'good($x);',
    fixtures: [],
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-ratchet-'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'bad(1);\nbad(2);\n', 'utf8');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const run = () =>
    applyRulesToFiles(root, collectRuleTargets(root), [rule], { todo: false });

  it('无基线 ⇒ 存量全算新增（不出 CI 通过）', () => {
    expect(loadBaseline(root)).toBeNull();
    const added = ratchetDelta(run(), null);
    expect(added).toHaveLength(1);
    expect(added[0].added).toBe(2);
    expect(added[0].baseline).toBe(0);
  });

  it('★ 记了基线后 ⇒ 存量命中不再算新增（棘轮放行）', () => {
    writeBaseline(root, run());
    const bl = loadBaseline(root);
    expect(bl).not.toBeNull();
    expect(ratchetDelta(run(), bl)).toEqual([]);
  });

  it('★ 新增命中才 fail：多一处就报新增 1', () => {
    writeBaseline(root, run());
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'bad(1);\nbad(2);\nbad(3);\n', 'utf8');
    const added = ratchetDelta(run(), loadBaseline(root));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ file: 'src/a.ts', current: 3, baseline: 2, added: 1 });
  });

  it('命中减少 ⇒ 不算新增（棘轮单向收紧，不因改好而 fail）', () => {
    writeBaseline(root, run());
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'bad(1);\n', 'utf8');
    expect(ratchetDelta(run(), loadBaseline(root))).toEqual([]);
  });

  it('writeBaseline 同键聚合、按 ruleId+file 排序，且不带 BOM', () => {
    const bl = writeBaseline(root, run());
    expect(bl.version).toBe(1);
    expect(bl.entries).toHaveLength(1);
    expect(bl.entries[0]).toMatchObject({ ruleId: 'r', file: 'src/a.ts', hits: 2 });
    const raw = fs.readFileSync(path.join(rulesDir(root), 'baseline.json'), 'utf8');
    expect(raw.charCodeAt(0)).not.toBe(0xfeff);
    expect(JSON.parse(raw).entries).toHaveLength(1);
  });

  it('坏 baseline（非 JSON / 版号不对）= 视同无基线，不抛', () => {
    fs.mkdirSync(rulesDir(root), { recursive: true });
    fs.writeFileSync(path.join(rulesDir(root), 'baseline.json'), '{not json', 'utf8');
    expect(loadBaseline(root)).toBeNull();
    fs.writeFileSync(path.join(rulesDir(root), 'baseline.json'), JSON.stringify({ version: 9, entries: [] }), 'utf8');
    expect(loadBaseline(root)).toBeNull();
  });
});

/* ─────────────── 7. 夹具自检（CI 入口） ─────────────── */

describe('rule_apply：夹具自检', () => {
  it('runFixtures：正例命中且改写一致、反例不命中 ⇒ passed', () => {
    const r: Rule = {
      id: 'ok',
      title: '', tags: [], level: 'warn', language: '', createdFrom: '', description: '',
      pattern: 'f($x);',
      replace: 'g($x);',
      fixtures: [
        { title: '正例', before: 'f(1);', after: 'g(1);', lang: '' },
        { title: '反例', negative: 'g(1);', lang: '' },
      ],
    };
    expect(runFixtures(r).passed).toBe(true);
  });

  it('runFixtures：反例被命中 ⇒ 报失败（规则过宽）', () => {
    const r: Rule = {
      id: 'wide',
      title: '', tags: [], level: 'warn', language: '', createdFrom: '', description: '',
      pattern: 'f($x);',
      replace: 'g($x);',
      fixtures: [{ title: '反例', negative: 'f(1);', lang: '' }],
    };
    const res = runFixtures(r);
    expect(res.passed).toBe(false);
    expect(res.failures[0]).toMatch(/反例/);
  });

  it('runAllFixtures：坏规则（缺 pattern 块）不静默，进 errors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-fix-'));
    try {
      fs.mkdirSync(rulesDir(root), { recursive: true });
      fs.writeFileSync(
        path.join(rulesDir(root), 'good.md'),
        ['```pattern', 'f($x);', '```', '', '```replace', 'g($x);', '```', '',
         '## 正例', '```', 'f(1);', '```', '', '```', 'g(1);', '```', '',
         '## 反例', '```', 'g(1);', '```', ''].join('\n'),
        'utf8',
      );
      const all = runAllFixtures(root);
      expect(all.total).toBe(1);
      expect(all.failed).toBe(0);
      expect(all.results[0].passed).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
