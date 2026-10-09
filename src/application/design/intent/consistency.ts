/**
 * 设计一致性检查器
 *
 * 对比 DSL 定义的 expected_apis 与实际代码中的 API 实现，自动检测不一致。
 *
 * 功能：
 *   1. 解析实际代码文件中的函数/方法签名（支持 Go/TypeScript/Python/JavaScript）
 *   2. 对比 DSL 中定义的 expected_apis
 *   3. 生成差异报告：
 *      - ✅ 已实现（green）：expected 与 actual 匹配
 *      - ❌ 缺失（red）：expected 中有，但代码中没有
 *      - ⚠️ 签名不匹配（yellow）：函数存在但参数/返回值不一致
 *      - 🆕 代码新增（blue）：代码中有，但 DSL expected_apis 中没有
 *   4. 支持注释标记定位（<!-- agent-io:node_id -->）
 *   5. 验证跨文件不变式（multi_file_invariants）
 *
 * 与 scaffold(action=backfill) 的区别：
 *   - （2026-10-01 起该路径已剔除）：原先的 scaffold(action=backfill) 会把代码提取的 API **镜像回填**进 DSL；
 *     现在事实的唯一权威是解析数据 cache.db（`infrastructure/index/file_facts`）。
 *   - consistency：只读检查，生成报告，不修改 DSL
 *
 * 职责归属（对账语义，与三方对比/基线一致）：
 *   - expected_apis 只由设计侧产生（import 设计模式 / scaffold / edit_dsl 决策），
 *     本工具只读不写
 *   - actual 以实际代码为事实源；报告把「预期缺失」（red）与「实现新增」（blue）
 *     分开，LLM 据此裁决：预期缺失 → 补实现；实现新增 → 回填设计或登记决策卡
 */

import fs from 'node:fs';
import path from 'node:path';
import type { DesignDSL, SemanticFile } from '../../../domain/types.js';
import { getDSL, getBaselineFacts } from '../../../infrastructure/storage.js';
// ★ T85/D3：线 1 的"现取事实"入口 —— 与 `import_project` 锚基线事实时**用的是同一个 accessor**（同源）
import { fileFacts } from '../../../infrastructure/index/file_facts.js';
import { parseFileSymbols, ParsedSymbol, isSupportedFile } from '../../../infrastructure/parse/ast_parser.js';

/**
 * ★★★ **线 1：代码相对基线的变更**（2026-10-09，T85/D3）。
 *
 * ## 它回答的问题（与线 2 **不同**）
 *   · **线 1（本类型）**：`基线事实`（fork 那一刻） vs `现取事实` ⇒ 「**代码相对基线变了没有**」
 *   · **线 2（`fileResults`）**：`DSL.expected_apis`（**人写的意图**） vs `现取事实` ⇒ 「**设计与实现的差距**」
 * ★ 在此之前**只有线 2，而它的"期望侧"是 fork 时从事实复制来的** ⇒ **自己跟自己比**。
 *   用户原话：*"怎么可能对拍还放在同一个里面？**那这算什么对拍？自己测自己吗？**"*
 */
export interface BaselineDrift {
  /** 比了几个文件 */
  compared: number;
  /** 逐文件：现取相对基线**新增/消失**的 API（签名，与 `expected_apis[].signature` 同形） */
  files: Array<{ path: string; added: string[]; removed: string[] }>;
  /** ★ 说明（**不许静默**：没基线 / 索引取不到，都要写在这儿） */
  notes: string[];
}

/**
 * 跑**线 1**：基线事实 vs 现取事实。★ 纯读，不写任何东西。
 * ★ 没有基线事实 ⇒ **明说"这条线判不了"**（老 feature 就是这种）—— 不冒充"没变化"。
 */
export function checkBaselineDrift(feature: string, codeDir: string): BaselineDrift {
  const notes: string[] = [];
  const baseline = getBaselineFacts(feature);
  if (!baseline) {
    return {
      compared: 0,
      files: [],
      notes: [
        '本 feature **没有基线事实**（`baseline/<feature>.facts.json` 不存在 —— 多半是 D2 之前导入的）' +
          '⇒ **线 1（代码相对基线的变更）判不了**。★ 重新 `import_project` 即可锚定（若设计已存在，先删掉该 feature 的 `.facts.json` 才会重建）。',
      ],
    };
  }
  const files: BaselineDrift['files'] = [];
  for (const [rel, base] of Object.entries(baseline.files)) {
    let now: readonly string[];
    try {
      const f = fileFacts(codeDir, rel);
      now = (f.apis ?? []).map((a) => a.signature ?? a.name);
    } catch (e) {
      // ★ 取不到事实**不许静默**：那会让"变化"看起来是"没变化"
      notes.push(`${rel}: 现取事实失败（${(e as Error).message.slice(0, 80)}）⇒ 该文件本轮**没比**`);
      continue;
    }
    const added = now.filter((s) => !base.apis.includes(s));
    const removed = base.apis.filter((s) => !now.includes(s));
    if (added.length || removed.length) files.push({ path: rel, added, removed });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { compared: Object.keys(baseline.files).length, files, notes };
}

/** 渲染线 1 的小节（给 `checkConsistency` 的消息用） */
function renderBaselineDriftSection(d: BaselineDrift): string {
  const L: string[] = [
    '',
    '── 线 1 · 代码相对**基线**的变更（★ 基线 = **fork 那一刻的事实**；★ 与下面"设计 vs 实现"**不是一回事**）──',
  ];
  if (d.compared === 0 && d.files.length === 0) {
    L.push('  （**判不了**）');
  } else {
    const nAdd = d.files.reduce((a, f) => a + f.added.length, 0);
    const nDel = d.files.reduce((a, f) => a + f.removed.length, 0);
    if (nAdd === 0 && nDel === 0) {
      L.push(`  ✓ **相对基线无变化**（比了 ${d.compared} 个文件）—— ★ 源码没动过就是它；**这不是"没跑"**。`);
    } else {
      L.push(`  有变化：${d.files.length} 个文件（新增 API ${nAdd} · 消失 API ${nDel}）`);
      for (const f of d.files.slice(0, 10)) {
        L.push(`    ${f.path}`);
        for (const s of f.added.slice(0, 3)) L.push(`      ＋ ${s}`);
        for (const s of f.removed.slice(0, 3)) L.push(`      － ${s}`);
      }
      if (d.files.length > 10) L.push(`    …另有 ${d.files.length - 10} 个文件`);
    }
  }
  for (const n of d.notes) L.push(`  ★ ${n}`);
  return L.join('\n');
}

export interface ConsistencyResult {
  message: string;
  fileResults: FileConsistency[];
  invariantResults: InvariantResult[];
  /**
   * ★★★ **线 1：代码相对基线的变更**（2026-10-09，T85/D3）—— **与 `fileResults`（线 2）是两件事，绝不许混**：
   *   · **本项（线 1）** = `baseline/<f>.facts.json`（**fork 那一刻的事实**） vs **现取事实**（`fileFacts`）
   *     ⇒ 回答「**代码相对基线变了没有**」。★ **同窗口内（源码未动）应为 0**。
   *   · **`fileResults`（线 2）** = DSL 里的 `expected_apis`（**人写的意图**） vs 现取事实
   *     ⇒ 回答「**设计与实现的差距**」。
   * ★ 用户原话：*"怎么可能对拍还放在同一个里面？**那这算什么对拍？自己测自己吗？**"*
   *   ⇒ 两条线**各有各的对手**，混着比就是假差异（**这就是 T85 的病根**）。
   */
  baselineDrift?: BaselineDrift;
  summary: {
    total_files: number;
    matched: number;
    missing: number;
    mismatched: number;
    unexpected: number;
    invariant_passed: number;
    invariant_failed: number;
  };
}

export interface FileConsistency {
  file: SemanticFile;
  file_path: string;
  exists: boolean;
  apis: ApiMatch[];
}

export interface ApiMatch {
  expected_signature: string;
  expected_notes?: string;
  actual_signature?: string;
  actual_location?: string;
  status: 'matched' | 'missing' | 'mismatched' | 'unexpected';
  match_score: number;
  reason?: string;
}

export interface InvariantResult {
  invariant: string;
  status: 'passed' | 'failed';
  reason?: string;
}

export interface ConsistencyInput {
  feature: string;
  /** 代码根目录，默认 <cwd>/scaffold/<feature>/ */
  code_dir?: string;
}

// ─────────────────────────────────────────────────────────────
// 代码解析器（已迁移到 ast_parser.ts，使用 tree-sitter）
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// API 匹配算法
// ─────────────────────────────────────────────────────────────

interface ParsedApi {
  signature: string;
  name: string;
  start_line: number;
  end_line?: number;
  kind: string;
}

function extractFuncName(sig: string): string {
  const match = sig.match(/(?:func\s+)?(?:\([^)]+\)\s+)?(\w+)\s*[\(\<]/);
  return match ? match[1] : sig.split(/\s*\(/)[0];
}

function normalizeSignature(sig: string): string {
  return sig.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * 按顶层逗号切分参数列表（跳过 ()[]{}<> 嵌套）。
 * 避免把对象字面量 {file, symbol?, ...} 或泛型 Record<string, ...> 里的逗号误当成参数分隔符。
 */
function splitTopLevelArgs(argsStr: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of argsStr) {
    if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** 参数名：从 'name: type' / 'name = default' / '?name' / 裸 'name' 中提取标识符 */
function argName(arg: string): string {
  const m = arg.trim().match(/^[?]?\s*([\w$]+)/);
  return m ? m[1] : arg.trim();
}

function compareSignatures(expected: string, actual: string): { score: number; reason?: string } {
  const expectedName = extractFuncName(expected);
  const actualName = extractFuncName(actual);

  if (expectedName !== actualName) {
    return { score: 0, reason: '函数名不匹配' };
  }

  const expectedNorm = normalizeSignature(expected);
  const actualNorm = normalizeSignature(actual);

  if (expectedNorm === actualNorm) {
    return { score: 100 };
  }

  const expectedArgs = expected.match(/\(([^)]*)\)/)?.[1] || '';
  const actualArgs = actual.match(/\(([^)]*)\)/)?.[1] || '';
  const expectedArgList = splitTopLevelArgs(expectedArgs);
  const actualArgList = splitTopLevelArgs(actualArgs);

  if (expectedArgList.length !== actualArgList.length) {
    return { score: 70, reason: `参数数量不匹配：期望 ${expectedArgList.length} 个，实际 ${actualArgList.length} 个` };
  }

  // 参数名对齐：语义契约的形参名应与实现一致（如都叫 args）
  const expNames = expectedArgList.map(argName);
  const actNames = actualArgList.map(argName);
  const nameAligned = expNames.every((n, i) => n === actNames[i]);

  if (nameAligned) {
    // 对象形参契约：期望为对象字面量时，实现应为对象/Record/任意，而非标量
    const expHasObj = /:\s*\{/.test(expectedArgs);
    const actIsObj = /:\s*(\{\s*\}|\{\s*\[|Record\s*<|object)/i.test(actualArgs);
    if (expHasObj && !actIsObj) {
      return { score: 80, reason: `形参类型不匹配：期望对象形参，实际 ${actualArgs}` };
    }

    // 返回类型：仅当两侧都是具体类型（不含语义省略号 ...）时才严格比对
    const expectedRet = expected.split(')')[1]?.trim() || '';
    const actualRet = actual.split(')')[1]?.trim() || '';
    const expConcrete = !!expectedRet && !expectedRet.includes('...');
    const actConcrete = !!actualRet && !actualRet.includes('...');
    const retCompatible =
      !expConcrete ||
      !actConcrete ||
      expectedRet.toLowerCase().includes(actualRet.toLowerCase()) ||
      actualRet.toLowerCase().includes(expectedRet.toLowerCase());
    if (!retCompatible) {
      return { score: 80, reason: `返回类型不匹配：期望 ${expectedRet}，实际 ${actualRet}` };
    }

    // 参数名一致且返回兼容 → 契约满足（即使类型措辞不同）
    return { score: 100 };
  }

  return { score: 90, reason: '签名不完全一致' };
}

// ─────────────────────────────────────────────────────────────
// 不变式验证
// ─────────────────────────────────────────────────────────────

function checkInvariants(dsl: DesignDSL, codeDir: string): InvariantResult[] {
  const results: InvariantResult[] = [];
  const invariants = dsl.semantic?.multi_file_invariants || [];

  for (const invariant of invariants) {
    let passed = true;
    let reason: string | undefined;

    const fileRefMatch = invariant.match(/file:([^\s]+)/);
    if (fileRefMatch) {
      const filePath = path.join(codeDir, fileRefMatch[1]);
      if (!fs.existsSync(filePath)) {
        passed = false;
        reason = `文件不存在: ${filePath}`;
      }
    }

    const funcRefMatch = invariant.match(/func:([^\s]+)/);
    if (funcRefMatch && passed) {
      const funcName = funcRefMatch[1];
      let found = false;
      for (const file of dsl.semantic?.files || []) {
        const fullPath = path.join(codeDir, file.path);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (content.includes(funcName)) {
            found = true;
            break;
          }
        }
      }
      if (!found) {
        passed = false;
        reason = `函数不存在: ${funcName}`;
      }
    }

    results.push({
      invariant,
      status: passed ? 'passed' : 'failed',
      reason,
    });
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// 主函数
// ─────────────────────────────────────────────────────────────

export async function checkConsistency(input: ConsistencyInput): Promise<ConsistencyResult> {
  const { feature, code_dir } = input;

  const dsl = getDSL(feature);
  if (!dsl) {
    throw new Error(`feature "${feature}" 不存在`);
  }

  if (!dsl.semantic || !dsl.semantic.files || dsl.semantic.files.length === 0) {
    throw new Error(`feature "${feature}" 没有 semantic.files，无法检查一致性`);
  }

  // 摩擦 G 修复：未显式传 code_dir 时，自动用 DSL 记录的 source_root（import_project
  // 已把 project_dir 写入 source_root）作为代码根，外部项目无需每次手传 code_dir；
  // 仍无 source_root（手工建的 DSL）才回退到默认 scaffold/<feature>。
  const codeDir = code_dir
    ? path.resolve(code_dir)
    : dsl.source_root
      ? path.resolve(dsl.source_root)
      : path.join(process.cwd(), 'scaffold', feature);

  const fileResults: FileConsistency[] = [];
  let matchedCount = 0;
  let missingCount = 0;
  let mismatchedCount = 0;
  let unexpectedCount = 0;

  for (const file of dsl.semantic.files) {
    const fullPath = path.join(codeDir, file.path);
    const exists = fs.existsSync(fullPath);

    const apiMatches: ApiMatch[] = [];
    const expectedApis = file.expected_apis || [];
    const actualApis: ParsedApi[] = [];

    if (exists) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (isSupportedFile(file.path)) {
        const symbols: ParsedSymbol[] = await parseFileSymbols(file.path, content);
        for (const s of symbols) {
          if (s.kind === 'function' || s.kind === 'method') {
            actualApis.push({
              signature: s.signature,
              name: s.name,
              start_line: s.start_line,
              end_line: s.end_line,
              kind: s.kind,
            });
          }
        }
      }
    }

    const matchedNames = new Set<string>();

    for (const expected of expectedApis) {
      const expectedName = extractFuncName(expected.signature);
      const actual = actualApis.find(a => a.name === expectedName);

      if (actual) {
        const comparison = compareSignatures(expected.signature, actual.signature);
        matchedNames.add(expectedName);

        if (comparison.score >= 90) {
          apiMatches.push({
            expected_signature: expected.signature,
            expected_notes: expected.notes,
            actual_signature: actual.signature,
            actual_location: `${file.path}:${actual.start_line}`,
            status: comparison.score === 100 ? 'matched' : 'mismatched',
            match_score: comparison.score,
            reason: comparison.reason,
          });
          if (comparison.score === 100) {
            matchedCount++;
          } else {
            mismatchedCount++;
          }
        } else {
          apiMatches.push({
            expected_signature: expected.signature,
            expected_notes: expected.notes,
            actual_signature: actual.signature,
            actual_location: `${file.path}:${actual.start_line}`,
            status: 'mismatched',
            match_score: comparison.score,
            reason: comparison.reason,
          });
          mismatchedCount++;
        }
      } else {
        apiMatches.push({
          expected_signature: expected.signature,
          expected_notes: expected.notes,
          status: 'missing',
          match_score: 0,
          reason: '代码中未找到该函数',
        });
        missingCount++;
      }
    }

    for (const actual of actualApis) {
      if (!matchedNames.has(actual.name)) {
        apiMatches.push({
          expected_signature: '',
          actual_signature: actual.signature,
          actual_location: `${file.path}:${actual.start_line}`,
          status: 'unexpected',
          match_score: 0,
          reason: 'DSL 中未定义此 API',
        });
        unexpectedCount++;
      }
    }

    fileResults.push({
      file,
      file_path: fullPath,
      exists,
      apis: apiMatches,
    });
  }

  const invariantResults = checkInvariants(dsl, codeDir);
  const invariantPassed = invariantResults.filter(r => r.status === 'passed').length;
  const invariantFailed = invariantResults.filter(r => r.status === 'failed').length;

  // 构建报告消息
  const lines: string[] = [];
  lines.push(`=== 设计一致性检查报告 - ${feature} ===`);
  lines.push('');
  lines.push('【摘要】');
  lines.push(`  文件数: ${fileResults.length}`);
  lines.push(`  ✅ 已实现: ${matchedCount}`);
  lines.push(`  ❌ 缺失: ${missingCount}`);
  lines.push(`  ⚠️ 签名不匹配: ${mismatchedCount}`);
  lines.push(`  🆕 代码新增: ${unexpectedCount}`);
  lines.push(`  不变式通过: ${invariantPassed}/${invariantResults.length}`);
  lines.push('');

  for (const fr of fileResults) {
    lines.push(`【文件】${fr.file.path}`);
    lines.push(`  状态: ${fr.exists ? '存在' : '❌ 不存在'}`);
    if (!fr.exists) continue;

    const matched = fr.apis.filter(a => a.status === 'matched');
    const missing = fr.apis.filter(a => a.status === 'missing');
    const mismatched = fr.apis.filter(a => a.status === 'mismatched');
    const unexpected = fr.apis.filter(a => a.status === 'unexpected');

    if (matched.length > 0) {
      lines.push(`  ✅ 已实现 (${matched.length}):`);
      for (const a of matched) {
        lines.push(`    - ${a.expected_signature}`);
      }
    }

    if (missing.length > 0) {
      lines.push(`  ❌ 缺失 (${missing.length}):`);
      for (const a of missing) {
        lines.push(`    - ${a.expected_signature}${a.expected_notes ? ' (' + a.expected_notes + ')' : ''}`);
      }
    }

    if (mismatched.length > 0) {
      lines.push(`  ⚠️ 签名不匹配 (${mismatched.length}):`);
      for (const a of mismatched) {
        lines.push(`    - 期望: ${a.expected_signature}`);
        lines.push(`      实际: ${a.actual_signature} (${a.actual_location})`);
        if (a.reason) lines.push(`      原因: ${a.reason}`);
      }
    }

    if (unexpected.length > 0) {
      lines.push(`  🆕 代码新增 (${unexpected.length}):`);
      for (const a of unexpected) {
        lines.push(`    - ${a.actual_signature} (${a.actual_location})`);
      }
    }

    lines.push('');
  }

  if (invariantResults.length > 0) {
    lines.push('【跨文件不变式】');
    for (const ir of invariantResults) {
      lines.push(`  ${ir.status === 'passed' ? '✅' : '❌'} ${ir.invariant}`);
      if (ir.reason) lines.push(`    原因: ${ir.reason}`);
    }
    lines.push('');
  }

  lines.push('【建议】');
  if (missingCount > 0) lines.push('  - 实现缺失的 API');
  if (mismatchedCount > 0) lines.push('  - 修正签名不匹配的函数');
  if (unexpectedCount > 0) lines.push('  - 考虑将代码新增的 API 添加到 DSL expected_apis');
  if (invariantFailed > 0) lines.push('  - 修复失败的不变式');
  lines.push('');

  // ★★★ 2026-10-09（T85/D3）：**线 1 与线 2 分开报**。
  //   上面那些 `missing/mismatched/unexpected` 是**线 2**：`DSL.expected_apis`（人写的**意图**）vs 现取事实。
  //   本节是**线 1**：`基线事实`（fork 那一刻）vs 现取事实 ⇒ 「**代码相对基线变了没有**」。
  //   ★ 用户原话：*"怎么可能对拍还放在同一个里面？那这算什么对拍？**自己测自己吗？**"*
  //   ★ 两条线**各有各的对手**；混着看就会**分不清"代码变了"还是"设计改了"**（T85 的病根）。
  const baselineDrift = checkBaselineDrift(feature, codeDir);
  lines.push(renderBaselineDriftSection(baselineDrift));

  return {
    message: lines.join('\n'),
    fileResults,
    baselineDrift,
    invariantResults,
    summary: {
      total_files: fileResults.length,
      matched: matchedCount,
      missing: missingCount,
      mismatched: mismatchedCount,
      unexpected: unexpectedCount,
      invariant_passed: invariantPassed,
      invariant_failed: invariantFailed,
    },
  };
}
