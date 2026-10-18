import fs from 'node:fs';
const p = 'src/domain/expectation.ts';
let s = fs.readFileSync(p, 'utf8');
const before = s;
const log = [];

// ① PHASE_BY_KIND 加 run
s = s.replace(
  "const PHASE_BY_KIND: Record<Expectation['kind'], ExpectationPhase> = {\n  'file-exists': 'post',",
  "const PHASE_BY_KIND: Record<Expectation['kind'], ExpectationPhase> = {\n  // ★ run 是"跑起来看结果" ⇒ 必然属【后态】（跑之前谈不上"结果"）\n  run: 'post',\n  'file-exists': 'post',",
);
log.push('PHASE_BY_KIND 加 run:post');

// ② describeExpectation 加 case
s = s.replace(
  "    case 'call-exists': return `call-exists  ${normPath(e.path)} :: ${e.symbol}() → ${e.target}()`;",
  "    case 'call-exists': return `call-exists  ${normPath(e.path)} :: ${e.symbol}() → ${e.target}()`;\n    case 'run': return `run  ${String(e.expect).slice(0, 70)}`;",
);
log.push('describeExpectation 加 run');

// ③ expectationSubjectPath：run 无主体
s = s.replace(
  "export function expectationSubjectPath(e: Expectation): string {\n  return normPath(e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path);\n}",
  "export function expectationSubjectPath(e: Expectation): string {\n  // ★ run 没有\"主体文件\" —— 它验的是\"跑起来\"，不是\"某个文件\" ⇒ 返回空串（不硬凑一个文件）\n  if (e.kind === 'run') return '';\n  return normPath(e.kind === 'edge-exists' || e.kind === 'edge-absent' ? e.from : e.path);\n}",
);
log.push('expectationSubjectPath: run → ""');

// ④ expectationPaths：run 无路径
s = s.replace(
  "export function expectationPaths(e: Expectation): string[] {\n  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [normPath(e.from), normPath(e.to)] : [normPath(e.path)];\n}",
  "export function expectationPaths(e: Expectation): string[] {\n  // ★ run 无路径（同 subjectPath 的理由）\n  if (e.kind === 'run') return [];\n  return e.kind === 'edge-exists' || e.kind === 'edge-absent' ? [normPath(e.from), normPath(e.to)] : [normPath(e.path)];\n}",
);
log.push('expectationPaths: run → []');

fs.writeFileSync(p, s);
console.log(before === s ? '★ 没变' : '✓ ' + log.join(' · '));
