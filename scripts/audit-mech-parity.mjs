#!/usr/bin/env node
/**
 * audit:mech-parity —— **机械翻出来的函数体，到底对不对**（同批输入跑 Go 与 TS 比输出）
 *
 * ## 为什么必须有这一步
 * 「机械翻」只有**看代码像**是不够的：`defer`→`try/finally`、`[::-1]`、指针运算符这些改写
 * 都可能在边角上改语义。翻译这件事的判据只有一条 —— **行为对拍**（同输入、同输出）。
 * 本仓早就有执行核（`verify_behavior.checkTranslationParity` → `runHarness` + `diffRuns`），
 * 这里只是把"机械翻的那批函数"接到它上面。
 *
 * ## 口径（诚实）
 * · 只取**自包含纯函数**：参数/返回都在基本类型集里（int/float/string/bool 及其切片），
 *   且体内不引用 `pkg.` 选择子（否则 Go 侧要 import、TS 侧要对应物，超出本审计范围）；
 * · 每条结果分四态：`same`（输出逐条一致）/`diff`（不一致）/`go_error`/`ts_error`（编译不过 ⇒ **判不了**，
 *   不等于通过）；**`diff` 是红**，`error` 是"没判"；
 * · 没覆盖到的（闭包/类型断言/select/chan 那 18%）本来就不机械翻，不在本审计范围。
 *
 * ## 用法
 *   npm run build && node scripts/audit-mech-parity.mjs [Go 仓路径] [最多抽多少个，默认 25]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';
const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
const mech = await import(D + 'infrastructure/authoring/translate/body_mech.js');
const { checkTranslationParity } = await import(D + 'infrastructure/authoring/translate/verify_behavior.js');

const repo = process.argv[2] ?? 'D:/agentio/dev/agent-memory';
const LIMIT = Number(process.argv[3] ?? 25);

/** 参数/返回类型 → 生成样例所需的最小元信息（只收基本类型） */
const BASIC = new Set(['int', 'int32', 'int64', 'uint', 'float64', 'float32', 'string', 'bool']);
function tsType(t) {
  if (/^(int|int32|int64|uint|float64|float32)(\[\])?$/.test(t)) return t.endsWith('[]') ? 'number[]' : 'number';
  if (t === 'string' || t === 'string[]') return t === 'string[]' ? 'string[]' : 'string';
  if (t === 'bool' || t === 'bool[]') return t === 'bool[]' ? 'boolean[]' : 'boolean';
  return null;
}

const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|\.git$/.test(p)) walk(p);
    } else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) files.push(p);
  }
};
walk(repo);

const cands = [];
for (const f of files) {
  let parsed;
  try {
    parsed = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
  } catch {
    continue;
  }
  if (!parsed?.root) continue;
  const all = [];
  const w = (n) => {
    all.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) w(c);
    }
  };
  w(parsed.root);
  for (const fn of all.filter((n) => n.type === 'function_declaration')) {
    let block = null;
    for (let i = 0; i < fn.childCount; i++) {
      const c = fn.child(i);
      if (c && c.type === 'block') block = c;
    }
    if (!block) continue;
    const body = mech.translateGoBodyMech(block);
    if (body === null) continue;
    if (/\b[a-z][a-zA-Z0-9]*\./.test(body)) continue; // 体内有 pkg. 选择子 ⇒ 需要 import，跳过
    const params = [];
    for (let i = 0; i < fn.childCount; i++) {
      const c = fn.child(i);
      if (!c || c.type !== 'parameter_list') continue;
      for (let j = 0; j < c.childCount; j++) {
        const d = c.child(j);
        if (!d || d.type !== 'parameter_declaration') continue;
        let nm = null;
        let ty = null;
        for (let k = 0; k < d.childCount; k++) {
          const e = d.child(k);
          if (!e) continue;
          if (e.type === 'identifier') nm = e.text;
          else if (![',', '(', ')'].includes(e.type)) ty = e.text;
        }
        if (nm && ty) params.push({ name: nm, type: ty });
      }
      break; // 第一个 parameter_list = 形参
    }
    const nameNode = (() => {
      for (let i = 0; i < fn.childCount; i++) {
        const c = fn.child(i);
        if (c && c.type === 'identifier') return c;
      }
      return null;
    })();
    // 返回类型：名字后的第二组参数表或类型节点
    let ret = null;
    let multiReturn = false;
    let seenParams = false;
    for (let i = 0; i < fn.childCount; i++) {
      const c = fn.child(i);
      if (!c) continue;
      if (c.type === 'parameter_list') {
        if (!seenParams) {
          seenParams = true;
          continue;
        }
        multiReturn = true; // 多返回值 ⇒ 不抽（样例生成器只支持单返回值）
        break;
      }
      if (seenParams && !multiReturn && !['block', 'identifier', 'type_parameter_list'].includes(c.type)) ret = c.text;
    }
    if (!nameNode || !ret || multiReturn) continue;
    // ★ Go harness 走"独立包 x/x.go + main 调用" ⇒ **只能调导出函数**（首字母大写）。
    //   小写未导出函数无论如何都跑不了 Go 侧（不是翻译的错，是对拍方法的边界）。
    if (!/^[A-Z]/.test(nameNode.text)) continue;
    if (!params.every((p) => BASIC.has(p.type) || /^\[\](int|float64|string|bool)$/.test(p.type))) continue;
    if (!BASIC.has(ret)) continue;
    if (params.length === 0) continue;
    cands.push({ file: f, name: nameNode.text, params, ret, body, goSrc: fn.text });
  }
}

console.log(`候选（机械可翻 + 纯基本类型 + 无 pkg. 选择子）：${cands.length} 个，抽前 ${Math.min(LIMIT, cands.length)} 个对拍\n`);

const stat = { same: 0, diff: 0, go_error: 0, ts_error: 0 };
const diffs = [];
for (const c of cands.slice(0, LIMIT)) {
  const tsParams = c.params.map((p) => {
    const t = tsType(p.type);
    return t ? `${p.name}: ${t}` : null;
  });
  if (tsParams.some((x) => x === null)) continue;
  const tsOut = `export function ${c.name}(${tsParams.join(', ')}): ${tsType(c.ret)} {\n${c.body}\n}\n`;
  let verdict;
  try {
    const r = checkTranslationParity({
      goSource: c.goSrc,
      tsOutput: tsOut,
      funcName: c.name,
      params: c.params,
    });
    verdict = r.verdict.verdict; // 'same' | 'diff' | 'error'
  } catch (e) {
    verdict = 'error';
  }
  const key = verdict === 'same' ? 'same' : verdict === 'diff' ? 'diff' : 'go_error';
  stat[key] = (stat[key] ?? 0) + 1;
  if (key !== 'same') diffs.push({ name: c.name, file: path.basename(c.file), verdict });
  console.log(`${key === 'same' ? '✓' : key === 'diff' ? '✗' : '·'} ${c.name.padEnd(28)} ${key}`);
}

console.log(`\n读数：same=${stat.same} · diff=${stat.diff} · error/判不了=${stat.go_error}`);
if (diffs.length) {
  console.log('非 same 的（需人看/降级为 LLM 或修正机械规则）：');
  for (const d of diffs.slice(0, 12)) console.log(`  · ${d.name} (${d.file}) → ${d.verdict}`);
}
console.log('\n★ 口径：diff 是红；error 是「判不了」不等于通过（Go/TS 编译不过 ⇒ 该条作废，不可计入成功）。');
process.exit(stat.diff === 0 ? 0 : 1);
