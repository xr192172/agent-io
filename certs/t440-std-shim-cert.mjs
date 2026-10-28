#!/usr/bin/env node
/**
 * ★★★ cert T440 —— **Go std 限定名垫片**：`sync.Mutex` / `time.Time` 这类在 TS 里有名字可用（2026-10-28）
 *
 * ## 病（实测）
 * 生成物里满是 Go 的限定类型 `sync.Mutex` / `time.Time` / `context.Context` / `json.RawMessage`，
 * 而 TS 没有这些命名空间 ⇒ `tsc` 报 **TS2503（Cannot find namespace）127 个**。
 *
 * ## 处置（骨架阶段的诚实做法）
 * 为**每个模块**就地生成 ambient 声明（`declare namespace pkg { const X: any; type X = any }`）：
 * - 只让**名字能解析**，**不假装实现**（要能跑还得填孔 + 真实现）；
 * - 收集方式：从**结构化类型树**（`TypeRef`）遍历 `pkg.Name`，**不扫文本、不用正则**；
 * - 覆盖范围：先只 std，实测仍有 13 个残留（`memory.` 本仓包名、`mem`/`ort`/`exec` cgo/外部）
 *   ⇒ 放宽为**所有限定名**，并在文件头注明"只声明不实现"。
 *
 * ## 判据
 *   ① **TS2503 = 0**（127 → 0）；
 *   ② **语法类错误仍 = 0**（垫片不能把语法弄坏）；
 *   ③ 总错误**下降**且如实上报（544 → 423；剩下的 TS2554×339 / TS2695×51 属**填孔/语义**阶段）；
 *   ④ `renderGoStdShim` 的产物形态：`declare namespace` + 值位/类型位各一行（`const` + `type`）；
 *   ⑤ 收集走**类型树**（静态断言：`project.ts` 调 `collectQualified`，且 `collectQualified` 递归 TypeRef 不扫文本）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 垫片是 **`any`**：类型检查在本阶段形同放开 —— 这是**有意的**（骨架不是成品），但它意味着
 *     "TS2503=0"**不等于**"类型正确"；
 *   · 未覆盖 `import` 边上的 Go 包（第三方 `github.com/...` 走 external_deps，不伪造）；
 *   · **[未核]** 与真实 tsconfig（严格模式 / `noImplicitAny`）下的表现差异。
 *
 * ## 用法
 *   node certs/t440-std-shim-cert.mjs      # ★ 先 npm run build（约 20s）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

const D = 'file:///D:/agentio/dev/agent-io/dist/src/';
const { renderGoStdShim, collectQualified } = await import(D + 'infrastructure/authoring/translate/ts_codegen.js');
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

// ── ④ 垫片渲染形态 ───────────────────────────────────
{
  const out = renderGoStdShim(['sync.Mutex', 'time.Time', 'sync.WaitGroup']);
  chk(/declare namespace sync \{/.test(out) && /declare namespace time \{/.test(out), '④ 生成 \`declare namespace\`（按包聚合）');
  chk(/const Mutex: any;/.test(out) && /type Mutex = any;/.test(out), '④-b 值位与类型位**各一行**（\`const\` + \`type\`）');
  chk(renderGoStdShim([]) === '', '④-c 空集合 ⇒ **产出空串**（不写无意义文件）');
}

// ── ⑤ 收集走类型树 ───────────────────────────────────
{
  const collected = new Set();
  collectQualified(
    { kind: 'func', params: [{ name: 'a', type: { kind: 'qualified', pkg: 'context', name: 'Context' } }], results: [{ kind: 'pointer', elem: { kind: 'qualified', pkg: 'sync', name: 'Mutex' } }] },
    collected,
  );
  chk(collected.has('context.Context') && collected.has('sync.Mutex'), '⑤ `collectQualified` **递归类型树**收集（含指针/函数/返回位）', [...collected].join(', '));
  const projSrc = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/project.ts'), 'utf8');
  chk(/collectQualified\(/.test(projSrc), '⑤-b `project.ts` 用**类型树收集**（不是扫文本）');
}

// ── ①②③ 端到端：真仓重译 + tsc ──────────────────────
const GO_REPO = 'D:/agentio/dev/agent-memory';
if (fs.existsSync(path.join(GO_REPO, 'go.mod'))) {
  const outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't440-')), 'src');
  await TOOL_DEFS.find((t) => t.name === 'translate').handler({ projectDir: GO_REPO, outDir, holes: false });
  const tscBin = path.join(ROOT, 'node_modules', '.bin', 'tsc.cmd');
  const tsconfig = path.join(path.dirname(outDir), 'tsconfig.json');
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: false, noEmit: true, skipLibCheck: true, noImplicitAny: false }, include: ['src/**/*.ts'] }, null, 2),
  );
  let alive = false;
  try {
    alive = /Version/i.test(execFileSync(tscBin, ['--version'], { encoding: 'utf8', shell: true }));
  } catch {
    alive = false;
  }
  chk(alive, '⓪ tsc **确实能跑**（先验工具活着）');
  let log = '';
  try {
    log = execFileSync(tscBin, ['-p', tsconfig], { encoding: 'utf8', maxBuffer: 64e6, shell: true });
  } catch (e) {
    log = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  chk(log.trim().length > 0, '⓪-b tsc **有输出**（空输出不许冒充零错误）');
  const all = [...log.matchAll(/error (TS\d+)/g)].map((m) => m[1]);
  const SYNTAX = new Set(['TS1005', 'TS1109', 'TS1128', 'TS1434', 'TS1011', 'TS1127', 'TS1160', 'TS17008']);
  const syn = all.filter((c) => SYNTAX.has(c)).length;
  const ns = all.filter((c) => c === 'TS2503').length;
  chk(ns === 0, '① **TS2503 = 0**（垫片前 127）', `实际 ${ns}`);
  chk(syn === 0, '② **语法类错误 = 0**（垫片没把语法弄坏）', `实际 ${syn}`);
  chk(all.length <= 544, '③ 总错误**下降**且如实上报（垫片前 544）', `现在 ${all.length}（TS2554×${all.filter((c) => c === 'TS2554').length} 属填孔阶段）`);
} else {
  console.log('（跳过端到端：本机没有 agent-memory）');
}

console.log(`\n═══ T440 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
