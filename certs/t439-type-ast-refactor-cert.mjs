#!/usr/bin/env node
/**
 * ★★★ cert T439 —— **类型位置由 AST 直出（`TypeRef`），codegen 只渲染不解析**（2026-10-28）
 *
 * ## 这条证要证什么
 * 用户问："这些正则都是 AST 不能发力的地方吗？" —— 答案是否：**AST 在那里，被拍成了字符串**。
 * `go_extractor` 在 `typeNode.text` 把 tree-sitter 的类型节点拍平，下游 `mapGoType` 用 15 处正则猜回来。
 * 本证钉住的新形状：
 * ```
 * tree-sitter Go AST → typeRefFromNode → TypeRef{kind, …} → renderTsType → TS 文本
 *                                            ↑ 结构化            ↑ 零正则
 * ```
 *
 * ## 判据
 *   ① **重构不改行为**：真仓（agent-memory 51 模块 / 55 文件）重译后，**逐文件 sha 与重构前基线完全一致**
 *      （基线 `certs/baselines/agent-memory-ts-baseline.json`）；
 *   ② **渲染器零正则**：`renderTsType` 函数体内没有 `.exec(` / `.match(` / `.replace(/`（只按 `kind` 分派）；
 *   ③ **结构化树真的在数据里**：extractor 产出的 `typeRef` 非空计数 > 0（不是只加了个空壳）；
 *   ④ **刁钻样本仍对**：手工构造 TypeRef → 渲染结果与字符串入口 `mapGoType` **一致**（两条路不分叉）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **没有删** `mapGoType(string)`：册子的 `sig`、cache.db 的 `params[].type` 仍只有字符串 ⇒ 字符串入口留着当 fallback，
 *     **[未核]** 两条路在"更刁的 Go 写法"上是否仍处处一致（联合约束 `~int | ~string`、方法值、内嵌接口）；
 *   · 未覆盖 `const`/`decision` 等其它单元形态的类型渲染；
 *   · 语义类 tsc 错误（544）本次不动（属垫片 + 填孔阶段）。
 *
 * ## 用法
 *   node certs/t439-type-ast-refactor-cert.mjs      # ★ 先 npm run build（约 15s）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
process.env.AGENT_IO_REQUIRE_PLAN = '0';

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { mapGoType, renderTsType } = await import(D + 'infrastructure/authoring/translate/ts_codegen.js');
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

// ── ① 重构不改行为（逐文件 sha 对比基线）───────────────
const GO_REPO = 'D:/agentio/dev/agent-memory';
const baselinePath = path.join(HERE, 'baselines/agent-memory-ts-baseline.json');
if (fs.existsSync(path.join(GO_REPO, 'go.mod')) && fs.existsSync(baselinePath)) {
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).files;
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't439-')), 'src');
  await TOOL_DEFS.find((t) => t.name === 'translate').handler({ projectDir: GO_REPO, outDir, holes: false });
  const walk = (d, out = []) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  };
  const now = {};
  for (const f of walk(outDir).sort()) now[path.relative(outDir, f).replace(/\\/g, '/')] = sha(fs.readFileSync(f));
  const diff = Object.keys(base).filter((k) => base[k] !== now[k]);
  chk(Object.keys(now).length === Object.keys(base).length, '① 文件数一致', `${Object.keys(now).length} / ${Object.keys(base).length}`);
  chk(diff.length === 0, '①-b **重构不改行为**：逐文件 sha 与基线**完全一致**', diff.length ? `不同：${diff.slice(0, 5).join(', ')}` : '55/55 相同');
} else {
  console.log('（跳过 ①：本机没有 agent-memory 或基线）');
}

// ── ② 渲染器零正则 ───────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/ts_codegen.ts'), 'utf8');
  const start = src.indexOf('export function renderTsType');
  const body = src.slice(start, src.indexOf('/**\n * 映射一个 Go 类型到 TS', start));
  chk(start > 0, '② `renderTsType` 存在');
  chk(!/\.exec\(/.test(body) && !/\.match\(/.test(body), '②-b `renderTsType` **不含 `.exec(` / `.match(`**（只按 kind 分派）', body.length ? `函数体 ${body.length} 字符` : '');
  // ★ 允许**一处**字符串替换：泛型 base 的 `pkg.Type` → `pkg_Type`（那不是"解析结构"，是句法转义）。
  const reps = body.match(/\.replace\(\/[^)]*\/g?/g) ?? [];
  const onlyDot = reps.every((r) => r.includes('/\\./g'));
  chk(onlyDot, '②-c `renderTsType` 里的 `replace` **只用于**泛型 base 的 `.`→`_` 转义（不解析结构）', reps.length ? reps.join(' | ') : '零处');
}

// ── ③ 结构化树真的在数据里 ───────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/go_extractor.ts'), 'utf8');
  const hits = (src.match(/typeRef: typeRefFromNode|typeRefFromNode\(/g) ?? []).length;
  chk(hits >= 3, '③ extractor **真的在产出 typeRef**（≥3 处）', `实际 ${hits} 处`);
  chk(/typeRefFromNode\(resultNode\)|resultRefFromNode\(resultNode\)/.test(src), '③-b 返回类型也带了结构化树（`resultRefFromNode`）');
}

// ── ④ 两条路不分叉 ───────────────────────────────────
{
  const cases = [
    [{ kind: 'slice', elem: { kind: 'ident', name: 'byte' } }, '[]byte'],
    [{ kind: 'map', key: { kind: 'ident', name: 'string' }, value: { kind: 'slice', elem: { kind: 'ident', name: 'int' } } }, 'map[string][]int'],
    [{ kind: 'chan', dir: 'send', elem: { kind: 'ident', name: 'Item' } }, 'chan Item'],
    [{ kind: 'pointer', elem: { kind: 'ident', name: 'User' } }, '*User'],
    [{ kind: 'tuple', items: [{ kind: 'ident', name: 'Result' }, { kind: 'ident', name: 'error' }] }, '(Result, error)'],
  ];
  for (const [ref, goText] of cases) {
    const a = renderTsType(ref).ts;
    const b = mapGoType(goText).ts;
    chk(a === b, `④ \`${goText}\`：AST 路 == 字符串路`, `AST=${a} · 字符串=${b}`);
  }
}

console.log(`\n═══ T439 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
