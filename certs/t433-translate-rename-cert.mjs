#!/usr/bin/env node
/**
 * ★★★ cert T433 —— **`translate_go_ts` 改名 `translate`，语言对变成参数**（2026-10-28）
 *
 * ## 为什么改（用户的判断，代码事实支持它）
 * 本仓翻译架构本来就是「**映射表 + 通用翻译器**」：
 *   `translate/pairs.ts` 注释原话：「全语言泛化的壳：新 (src,dst) 语义映射**只在这里挂一张表**
 *   （extractor + codegen），核心零改动」。册子（`book.ts`）从**同一个 `cache.db`** 派生，
 *   与 `<f>.dsl.json` 平行的 `<f>.translate.json` —— **与实际侧同构**；术语靠人写的 `types`（映射表）驱动，
 *   `blockedByTerm` 就是"术语表覆盖不到的名字"。
 *
 * 而旧工具名 `translate_go_ts` 把**语言对写死在工具名里** ⇒ 加一对就得加一个工具名，
 * 等于把注册表降级成"工具名枚举"。更要紧的是：`book`（重算翻译册）**语言无关**（只认 `target_language`），
 * 上一笔却把它塞进这个 pair 专属名字底下 —— **放错了家**。
 *
 * ## 判据（每条亲手跑）
 *   ① `translate` **在注册表**；`translate_go_ts` / `translate_book` **都不在**；工具数不变（改名不增不减）；
 *   ② **缺省语言对仍是 go→ts**：最小 `.go` 夹具能萃取出单元并出骨架（不回归）；
 *   ③ **不支持的语言对响亮报错**：列出已注册对 + 说明"加一对 = 在 `pairs.ts` 挂一张表"（不静默降级）；
 *   ④ **`book` 不吃语言对**（语言无关的证据）：`book=true` 时即使 `from/to` 是不支持的对，报的也是
 *      "翻译册不存在"，**不是**"语言对不支持"；
 *   ⑤ **注册表仍是唯一注册点**：`TRANSLATE_PAIRS` 在 `pairs.ts`，目前仅 `go-ts` 一对（静态断言）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **[未核] 骨架翻译的"准确度"**：本仓是 TS 项目，**没有 Go 语料** ⇒ 只能证"能萃取、能出骨架、结构闸有结论"，
 *     不能证"翻得像"。要读准确度得拿真 Go 项目跑（`verifySkeletons` 的 issues 才是质量读数）；
 *   · **[未核]** 新增一对（如 `py-ts`）的完整路径：`pairs.ts` 有表，但管道仍只有 `translateGoToTs` 一条
 *     ⇒ 挂表之后还要接管道，这一步没有实现也没有证；
 *   · `fill` / `holes` / `verify` 三个 flag 的语义未在本证覆盖（与改名无关，行为未动）。
 *
 * ## 用法
 *   node certs/t433-translate-rename-cert.mjs      # ★ 先 npm run build
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
const { TOOL_DEFS } = await import(D + 'application/tool_registry.js');
const tr = TOOL_DEFS.find((t) => t.name === 'translate');

const txt = async (args) => {
  try {
    const r = await tr.handler(args);
    return String(r?.text ?? r?.message ?? JSON.stringify(r));
  } catch (e) {
    return String((e && e.message) || e);
  }
};

// ── ① 名字 ────────────────────────────────────────────
{
  const names = TOOL_DEFS.map((t) => t.name);
  chk(!!tr, '① `translate` **在注册表**');
  chk(!names.includes('translate_go_ts'), '①-b `translate_go_ts` **已不在**（语言对不再写进工具名）');
  chk(!names.includes('translate_book'), '①-c `translate_book` **已不在**');
  chk(names.length === 44, '①-d 工具数 **不变**（44；改名不是增删）', `实际 ${names.length}`);
}

// ── ② 缺省语言对仍工作 ────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trfx-'));
  fs.writeFileSync(path.join(dir, 'a.go'), 'package main\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n');
  const msg = await txt({ file: path.join(dir, 'a.go') });
  chk(/萃取\s*\d+\s*个单元/.test(msg), '② 缺省 `from=go to=ts` 仍能**萃取单元并出骨架**（不回归）', msg.split('\n')[0]?.slice(0, 110));
  chk(/验证/.test(msg), '②-b 骨架回执带**验证闸读数**（不是只给一段代码）', msg.split('\n').find((l) => /验证/.test(l))?.slice(0, 110));
}

// ── ③ 不支持的语言对响亮报错 ──────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trfx2-'));
  fs.writeFileSync(path.join(dir, 'a.go'), 'package main\n');
  const msg = await txt({ file: path.join(dir, 'a.go'), from: 'py', to: 'ts' });
  chk(/不支持的语言对\s*py→ts/.test(msg), '③ 不支持的语言对**响亮报错**（不静默降级成 go→ts）', msg.split('\n')[0]?.slice(0, 110));
  chk(/已注册：go-ts/.test(msg), '③-b 报错**列出已注册对**（读数可查）', msg.split('\n')[0]?.slice(0, 140));
  chk(/pairs\.ts/.test(msg) && /核心零改动/.test(msg), '③-c 报错**说清怎么加一对**（挂一张表，核心零改动）');
}

// ── ④ book 与语言对无关 ───────────────────────────────
{
  const msg = await txt({ book: true, project_dir: ROOT, feature: 'agent-io', dry_run: true, from: 'py', to: 'rust' });
  chk(/翻译册不存在/.test(msg), '④ `book=true` 报的是"**翻译册不存在**"而非"语言对不支持"（证明它语言无关）', msg.split('\n')[0]?.slice(0, 120));
  chk(!/不支持的语言对/.test(msg), '④-b `book` 形态**不吃** `from/to` 的对检查');
}

// ── ⑤ 注册表仍是唯一注册点 ────────────────────────────
{
  const pairs = fs.readFileSync(path.join(ROOT, 'src/infrastructure/authoring/translate/pairs.ts'), 'utf8');
  chk(/export const TRANSLATE_PAIRS/.test(pairs), '⑤ `TRANSLATE_PAIRS` 仍在 `pairs.ts`（唯一注册点）');
  chk(/'go-ts':\s*\{/.test(pairs), '⑤-b 目前只注册了 `go-ts` **一对**（诚实读数，不夸大支持面）');
  const idx = fs.readFileSync(path.join(ROOT, 'src/application/cross/index.ts'), 'utf8');
  chk(/translatePair\(/.test(idx), '⑤-c 工具层**通过表查询**语言对（不是自己 if 判断写死）');
}

console.log(`\n═══ T433 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
