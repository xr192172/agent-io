#!/usr/bin/env node
/**
 * ★★★ cert T367 —— **Go 的两处"结构上抽不到/判不了"修补**（2026-10-27 · T-#95b / T-#95c）
 *
 * ## 本笔新增的方向（新方向 ⇒ 必须新增一条打它的证）
 *   ① T-#95b：**"变量持有函数类型"也是函数符号**（Go `var X func(...)`，含 `var ( … )` 块形态）
 *      —— 数据在 `LANG_ADAPTERS.go.typedFuncSymbol`，抽取在 `kernel.ts#typedFuncSpecs`；
 *   ② T-#95c：**同包同名但 build tag 互斥**的两个文件，按"默认构建上下文"择一
 *      —— 实现在 `index/symbols.ts#findGoSamePackageTarget` + `goBuildVerdictOf`。
 *
 * ## 判据（每条亲手跑，读数见 stdout）
 *   ① **函数类型变量成符号**：`var Hook func(name string) error` ⇒ 节点 kind=function、
 *      形参抽得到、签名带返回类型；边 `CallHook → Hook` 建上；
 *   ② **var 块里多个 spec 全收**：`var ( Before func(); After func() )` ⇒ 两个符号 + 两条边
 *      （★ 块形态多一层 `var_spec_list`，少了它一条都抽不出来 —— 本证盯的就是这一层）；
 *   ③ **自定义 tag 互斥 ⇒ 能定到唯一那份**：`!special` / `special` 二选一 ⇒ `pick` 解析到 `base.go`；
 *   ④ **平台 tag ⇒ 判不了就仍然不猜**：`linux` / `windows` 二选一 ⇒ `dup` **不建边**、落 `failed`
 *      （★ 这一条是"别为了指标变绿而猜"的护栏：宁可缺边，不误连）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · **不写真仓**：`AGENT_IO_HOME` = 临时 home（`mkdtempSync`），代码根 = 临时根；
 *   · **[未核] `// +build` 旧式约束**：本证的夹具都用 `//go:build`；旧式只在实现里兼容，
 *     没有拿真仓样本打过（近十年的 Go 仓基本已迁移）；
 *   · **[未核] `var a, b func()` 多名字形态**：实现取不到 `name` 字段 ⇒ 按"宁漏不错"不收，本证不覆盖。
 *
 * ## 用法
 *   node certs/t367-go-var-func-buildtag-cert.mjs      # ★ 先 npm run build（本证只读 dist/）
 *
 * touches: src/infrastructure/parse/kernel.ts, src/infrastructure/index/symbols.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// ★ 夹具用 `mkdtempSync`（每次新目录、不删旧目录）：宿主有"每回合 50 次删除"的闸，
//   `rmSync` 会让本证在批量跑里崩成假红（与 t355 同口径）。
const TMP = fs.mkdtempSync(path.join(HERE, '.work/tmp367gofn-'));
const HOME = path.join(TMP, 'home');
const ROOT = path.join(TMP, 'root');
fs.mkdirSync(HOME, { recursive: true });
for (const d of ['a', 'b', 'c']) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
process.env.AGENT_IO_HOME = HOME; // ★ 必须在任何模块读它之前

const w = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text, 'utf-8');
w('go.mod', 'module example.com/t367\n\ngo 1.21\n');

// ① T-#95b 单行形态
w('c/hook.go', `package c

// Hook 是「持有函数类型」的包级变量
var Hook func(name string) error

var (
	// 同一个 var 块里的两个 spec（gin binding 的形态）
	Before func(route string)
	After  func(route string)
)

func CallHook() error { return Hook("x") }

func CallPair() { Before("a"); After("b") }
`);

// ② T-#95c：自定义 tag 互斥（默认上下文能定唯一）
w('b/base.go', '//go:build !special\n\npackage b\n\nfunc pick() int { return 10 }\n');
w('b/special.go', '//go:build special\n\npackage b\n\nfunc pick() int { return 20 }\n');
w('b/caller.go', 'package b\n\nfunc UsePick() int { return pick() }\n');

// ③ 平台 tag 互斥（判不了 ⇒ 必须仍然不猜）
w('a/plat_linux.go', '//go:build linux\n\npackage a\n\nfunc dup() int { return 1 }\n');
w('a/plat_windows.go', '//go:build windows\n\npackage a\n\nfunc dup() int { return 2 }\n');
w('a/caller.go', 'package a\n\nfunc UseDup() int { return dup() }\n');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

const { importProject } = await import('../dist/src/infrastructure/graph/import_project.js');
const FEAT = 't367gofn';
await importProject({ project_dir: ROOT, feature: FEAT });

const db = new DatabaseSync(path.join(ROOT, '.agent-io/cache.db'), { readOnly: true });
const all = (s) => db.prepare(s).all();
const one = (s) => db.prepare(s).get();

// ── ① 函数类型变量成符号 ─────────────────────────────────
const hook = one("SELECT name, kind, params, signature FROM nodes WHERE name = 'Hook' AND file_path = 'c/hook.go'");
chk(!!hook, '①-a `var Hook func(name string) error` 成了符号', hook ? `kind=${hook.kind}` : '（没有这个节点）');
chk(hook?.kind === 'function', '①-b kind = function（不是 const / variable）', `kind=${hook?.kind}`);
chk(String(hook?.params ?? '').includes('name'), '①-c 形参抽到了', `params=${hook?.params}`);
chk(String(hook?.signature ?? '').includes('error'), '①-d 签名带返回类型', `sig=${hook?.signature}`);

// ── ② var 块里多个 spec 全收 ────────────────────────────
const blockSyms = all(
  "SELECT name, kind FROM nodes WHERE file_path = 'c/hook.go' AND name IN ('Before','After') ORDER BY name",
);
chk(blockSyms.length === 2, '②-a `var ( … )` 块里两个 spec 都成了符号', `拿到 ${blockSyms.map((s) => s.name).join(' / ') || '（无）'}`);
const hookEdges = all(
  `SELECT s.name AS src, t.name AS dst
     FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
    WHERE s.name IN ('CallHook','CallPair')`,
);
chk(
  hookEdges.some((e) => e.src === 'CallHook' && e.dst === 'Hook'),
  '②-b `CallHook` → `Hook` 边建上了',
);
const pairEdges = hookEdges.filter((e) => e.src === 'CallPair').map((e) => e.dst).sort();
chk(pairEdges.length === 2, '②-c `CallPair` → Before / After 两条边都建上了', `实际 ${pairEdges.join(' / ') || '（无）'}`);

// ── ③ 自定义 tag 互斥 ⇒ 定到唯一那份 ─────────────────────
const pickEdge = one(
  `SELECT t.file_path AS tfile
     FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
    WHERE s.name = 'UsePick' AND t.name = 'pick'`,
);
chk(String(pickEdge?.tfile ?? '').endsWith('b/base.go'), '③ 自定义 tag 互斥 ⇒ `pick` 定到 `!special` 那份', `target=${pickEdge?.tfile ?? '（无）'}`);

// ── ④ 平台 tag 判不了 ⇒ 仍然不猜 ─────────────────────────
const dupEdge = one(
  `SELECT t.file_path AS tfile
     FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
    WHERE s.name = 'UseDup' AND t.name = 'dup'`,
);
chk(!dupEdge, '④-a 平台 tag（linux/windows）判不了 ⇒ `dup` **不建**边（宁可缺，不误连）', `target=${dupEdge?.tfile ?? '（无边，正确）'}`);
const statuses = all("SELECT reference_name, status FROM unresolved_refs WHERE reference_name IN ('pick','dup')");
chk(
  statuses.some((s) => s.reference_name === 'dup' && s.status === 'failed'),
  '④-b `dup` 落 failed（能证明才建边）',
  `状态=${statuses.map((s) => `${s.reference_name}=${s.status}`).join(' ')}`,
);
chk(
  statuses.some((s) => s.reference_name === 'pick' && s.status === 'resolved'),
  '④-c `pick` 是 resolved',
);
const failedTotal = one("SELECT COUNT(*) n FROM unresolved_refs WHERE status='failed'").n;
chk(failedTotal === 1, '④-d 该夹具 failed 只剩 dup 这 1 条', `实际 ${failedTotal}`);

db.close();

console.log(`\n═══ T367 读数：PASS=${P} FAIL=${F} ═══`);
// ★ 这行是**机器读的那行**（`scripts/verify-changed.mjs` 只认 `汇总：PASS=n FAIL=m`）
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
