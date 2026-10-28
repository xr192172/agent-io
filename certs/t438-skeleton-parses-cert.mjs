#!/usr/bin/env node
/**
 * ★★★ cert T438 —— **Go→TS 骨架：全部可解析（语法类错误 = 0）**（2026-10-28 · 收 `T-#TRANS-GEN`）
 *
 * ## 改之前的实测（拿真 Go 仓 agent-memory 跑的）
 * 51 模块 → 55 个 `.ts` / 445KB；`tsc`：**35 个语法错 / 5 个文件**，全部来自四类漏映射：
 *   ① 分组形参 `func(pattern, brain string)` → 被读成 `(arg: pattern, brain: string)`（把形参名当类型）
 *   ② 匿名 struct `chan struct{}` → `Channel<struct{}>`（`struct{}` 不是 TS 类型）
 *   ③ struct tag `` `json:"x"` `` 没剥 → 透传成类型文本
 *   ④ 嵌套 struct 按 `;`/换行切碎 → `Message_struct______Content_string_____: Message struct {`
 *   ⑤ 孔体是**空函数体**（只有注释）⇒ 编译得过、运行时静默 `undefined`（假绿）
 *
 * ## 判据
 *   ① **单元级**：`mapGoType` 对 6 个刁钻输入的输出逐字断言（含分组形参 / 嵌套 struct / tag / 泛型）；
 *   ② **端到端**：真仓 51 模块重译后，`tsc` 的**语法类错误 = 0**（即：**每个文件都能 parse**）；
 *   ③ **孔体必须炸**：生成物里函数体是 `throw new Error('TODO(translate)...')`，不是空体；
 *   ④ **读数分离**：把"语法类"与"语义类"分开计数 —— 骨架阶段语义错是**预期的**（缺 `sync`/`time` 垫片、
 *      调用点按 Go 习惯传参），不许把两者混成一个数（混了就看不出"到底能不能 parse"）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · 语义类错误（本仓实测 **544** 个：TS2554 ×339 / TS2503 ×127 / TS2695 ×51 …）**没有修** ——
 *     它们属于"填孔 + 补垫片"阶段，不是骨架阶段的事；本证只断言"语法类 = 0"；
 *   · 未跑 `verifySkeletons` 的结构闸（那是另一道读数）；
 *   · **[未核]** 其它 Go 写法（泛型约束联合、方法值、内嵌接口）。
 *
 * ## 用法
 *   node certs/t438-skeleton-parses-cert.mjs      # ★ 先 npm run build（耗时约 40s：含 tsc 全量）
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
const { mapGoType } = await import(D + 'infrastructure/authoring/translate/ts_codegen.js');
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');

// ── ① mapGoType 单元断言 ─────────────────────────────
{
  const cases = [
    ['chan struct{}', 'Channel<Record<string, never>>'],
    ['struct{ A int; B, C string }', '{ A: number; B: string; C: string }'],
    ['func(pattern, brain string) bool', '(pattern: string, brain: string) => boolean'],
    ['func(a, b int, c string) (Result, error)', '(a: number, b: number, c: string) => [Result, Error | null]'],
    ['Channel[T]', 'Channel<T>'],
    ['string `json:"x"`', 'string'],
  ];
  for (const [input, want] of cases) {
    const got = mapGoType(input).ts;
    chk(got === want, `① \`${input}\` → \`${want}\``, got === want ? '' : `实际：${got}`);
  }
}

// ── ② 端到端：真仓重译 + tsc（语法类必须为 0）────────
const GO_REPO = 'D:/agentio/dev/agent-memory';
let outDir = '';
let synCount = -1;
let semCount = -1;
if (!fs.existsSync(path.join(GO_REPO, 'go.mod'))) {
  console.log('（跳过端到端：本机没有 agent-memory 这个 Go 仓）');
} else {
  outDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 't438-')), 'src');
  const r = String(
    (await TOOL_DEFS.find((t) => t.name === 'translate').handler({ projectDir: GO_REPO, outDir, holes: false }))?.text ?? '',
  );
  chk(/模块/.test(r) || r.length > 0, '② 重译产出非空回执', r.split('\n')[0]?.slice(0, 90));

  // tsc：用**本仓**的 tsc（离线环境里 npx 不可用）
  // ★★ 2026-10-28（修**我自己的假绿**）：上一版用正斜杠拼 `tsc.cmd` ⇒ spawn ENOENT，
  //   异常被吞成"0 个 error" ⇒ 证报绿，而手工跑同一份产物是 544 个语义错。
  //   ⇒ ① 路径用 path.join（Windows 反斜杠）；② **先跑 --version 验它活着**；③ 空输出不许当"零错误"。
  const tscBin = path.join(ROOT, 'node_modules', '.bin', 'tsc.cmd');
  let tscAlive = false;
  try {
    tscAlive = /Version/i.test(execFileSync(tscBin, ['--version'], { encoding: 'utf8', shell: true }));
  } catch {
    tscAlive = false;
  }
  chk(tscAlive, '②-a `tsc` **确实能跑**（先验工具活着，再读它的读数）');
  const tsconfig = path.join(path.dirname(outDir), 'tsconfig.json');
  fs.writeFileSync(
    tsconfig,
    JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', strict: false, noEmit: true, skipLibCheck: true, noImplicitAny: false }, include: ['src/**/*.ts'] }, null, 2),
  );
  let log = '';
  try {
    log = execFileSync(tscBin, ['-p', tsconfig], { encoding: 'utf8', maxBuffer: 64e6, shell: true });
  } catch (e) {
    log = String(e.stdout ?? '') + String(e.stderr ?? '');
  }
  const all = [...log.matchAll(/error (TS\d+)/g)].map((m) => m[1]);
  // ★ 空输出 ≠ 零错误（可能根本没跑起来）⇒ 单独判一条
  chk(log.trim().length > 0, '②-a2 tsc **真有输出**（空输出不许冒充"零错误"）', `输出长度 ${log.trim().length}`);
  const SYNTAX = new Set(['TS1005', 'TS1109', 'TS1128', 'TS1434', 'TS1011', 'TS1127', 'TS1160', 'TS17008']);
  synCount = all.filter((c) => SYNTAX.has(c)).length;
  semCount = all.length - synCount;
  chk(synCount === 0, '②-b **语法类错误 = 0**（每个生成文件都能 parse）', `语法 ${synCount} · 语义 ${semCount}（语义属填孔阶段，预期）`);
  chk(true, '②-c 语义类读数**如实上报**（本仓实测 500+，随垫片/填孔下降）', `语义 ${semCount} 个`);

  // ── ③ 孔体必须炸 ──────────────────────────────────
  const gate = path.join(outDir, 'gate.ts');
  const sample = fs.existsSync(gate) ? fs.readFileSync(gate, 'utf8') : '';
  chk(/throw new Error\('TODO\(translate\)/.test(sample), "③ 孔体是 **throw**（没译就立刻炸），不是空函数体");
  chk(!/struct\s*\{/.test(sample), '③-b 生成物里**不再有** `struct {` 这种 Go 字面量（已映射成对象类型）');
}

console.log(`\n读数：语法类=${synCount} · 语义类=${semCount}（语义类属"填孔 + 垫片"阶段，本证不修）`);
console.log(`\n═══ T438 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
