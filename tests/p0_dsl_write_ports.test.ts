/**
 * P0 回归 · **册的写口只有一个** —— presentation 面（http / daemon / mcp）不得直连写核。
 *
 * ## 它钉的是什么（一句话，可判真假）
 * `src/presentation/{http,daemon,mcp}/**` 里**没有任何文件** import 写核
 * （`update_feature.ts#updateFeature` / `storage.ts#saveDSL·saveDesignSheet` /
 *  `set_design_intent.ts#setDesignIntent` / `archive_node.ts#archiveNode`）。
 * ⇒ 想改册只有一条路：`application/design/handlers.ts#editDslHandler`（L1–L4 变更原因闸 /
 *   T20 现取事实 / `view=live` 护栏 / 顶层孤儿键拒绝 / `checkOpSpec` 键闸 / `validateDSL` 结构闸 / 乐观锁
 *   **全部住在那一个函数里**，见 `update_feature.ts:671` 与 `op_data_spec.ts:355` 的自述）。
 *
 * ## 为什么它必须是一条判据而不是一句注释
 * 本仓已经**两次**在"写口"上翻车（2026-11-01 外部审计 P0：`saveDesignSheet` 不推进 rev ⇒ 乐观锁对 12 个
 * 写端失效；2026-10-22：41 次 DSL 改动全走 `saveDSL` 直写 ⇒ `edit_dsl` 一次没用）。
 * 两次的**形状完全一样**：写核是 `export` 的，谁 import 谁就能绕开闸；而绕开**没有声音**
 * （写成功、回执照旧、`_sync.via` 记的是 `edit_dsl`）。⇒ 只能靠"结构上不许 import"来守。
 *
 * ## ★ 本卡的实测背景（改前红在哪）
 * `presentation/daemon/daemon.ts` 直接 `import { updateFeature }` 并调它 —— 那是 **HTTP 面
 * （`POST /api/dsl`）绕过 `editDslHandler` 的唯一路径**：`curl` 一条 `{feature, ops}` 就能改册，
 * L1–L4 / T20 / `view=live` / 孤儿键**一道都不过**。本卡把它改成走 `editDslHandler`（同一道闸），
 * 并在 `dispatch.ts` 加"写宿主不自我转发"（否则 daemon 内 `postDsl` 转发给自己 ⇒ 同 feature 串行桶自锁死）。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 * · 判据是**静态 import 级**，不是调用图可达性：它证明"没人直接 import 写核"，不证明
 *   "没有别的模块替它 import 再转手"（`via` 闭集 `edit_dsl|import|tool|derived` 与
 *   `saveDSL` 的 `assertDslWriteAllowed` 管那一层）。`[未核]` 三层以上的转手链未逐一枚举。
 * · 只扫 `.ts`；`src/presentation` 下没有 `.mjs`/`.js` 源文件（有的话本文件会**数不到**它们 ⇒
 *   下面的分母断言会先红，不会静默放过）。
 * · 注释先剥再匹配（本仓注释里大量出现 `saveDSL` / `import(...)` 字样，不剥会把注释判成违规）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
// ★★ R6（2026-11-06）：**剥注释没有第二份** —— 本文件每个输入都有 filePath ⇒ 走整文件权威（0.9.1④）。
import { stripCommentsSync } from '../src/infrastructure/parse/comments.js';
import { prewarmKernel } from '../src/infrastructure/parse/kernel.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 整文件权威需要 parser 预热（未预热 ⇒ `null` = 没查成）⇒ 模块级预热一次。
await prewarmKernel();
const PRESENTATION = path.join(REPO, 'src', 'presentation');
/** 被框定的三个面（`cli` 不在框内：它是开发期入口，不是"对外写口"） */
const SCAN_DIRS = ['http', 'daemon', 'mcp'] as const;

/** 写核（模块 → 为什么它是写核）。★ 新增写核 = 在这里登记一行，否则本判据看不见它。 */
const WRITE_CORES: Array<{ module: string; why: string; onlyNamed?: string[] }> = [
  { module: 'src/application/design/dsl_ops/update_feature.ts', why: 'updateFeature 是 edit_dsl 的写实现（各 dsl_ops 的 saveDSL 都在它下面）' },
  { module: 'src/application/design/intent/set_design_intent.ts', why: 'setDesignIntent 直写 overlay + apply 回 base + saveDSL' },
  { module: 'src/application/meta/archive/archive_node.ts', why: 'archiveNode 改册（移出 DSL + 归档库）' },
  {
    module: 'src/infrastructure/storage.ts',
    why: 'saveDSL / saveDesignSheet 是落盘口本身',
    onlyNamed: ['saveDSL', 'saveDesignSheet'],
  },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.isFile() && p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 剥注释：**整文件权威**（`parse/comments.ts#stripCommentsSync`，AST 注释区间）—— R6 收归，不再自写正则。
 * 本仓注释里 `saveDSL` 出现几十次；不剥会把注释判成违规。
 * ★ 返回 null = **没查成** ⇒ 当场红，不当“没有注释”。
 */
function stripFor(fileAbs: string, src: string): string {
  const out = stripCommentsSync(fileAbs, src);
  assert.ok(out !== null, `${fileAbs}：整文件权威返回 null（判不了 ≠ 通过）`);
  return out as string;
}

/** 一条 import：来源说明符 + 具名导入（`{a, b as c}` 里的原名；`*` 与 default 记空）。 */
interface ImportRec {
  spec: string;
  names: string[];
}
function importsOf(fileAbs: string, src: string): ImportRec[] {
  const out: ImportRec[] = [];
  const re = /import\s+(?:type\s+)?(?:([\w$*,\s{}]+?)\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of stripFor(fileAbs, src).matchAll(re)) {
    const clause = m[1] ?? '';
    const names: string[] = [];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const orig = part.trim().split(/\s+as\s+/)[0]?.trim();
        if (orig) names.push(orig);
      }
    }
    out.push({ spec: m[2], names });
  }
  return out;
}

/** 说明符 → 仓库相对 posix 路径（`./x.js` 解析成 `src/.../x.ts`） */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(fromFile), spec);
  const ts = abs.endsWith('.js') ? abs.slice(0, -3) + '.ts' : abs;
  return path.relative(REPO, ts).split(path.sep).join('/');
}

const scanned = SCAN_DIRS.flatMap((d) => tsFiles(path.join(PRESENTATION, d)));

test('P0-写口 ① · presentation 面（http/daemon/mcp）没有任何文件直接 import 写核', () => {
  // 分母（0.12：只给分子等于没验）：三个面各自必须有文件，总数必须等于逐面之和
  assert.equal(scanned.length, SCAN_DIRS.reduce((n, d) => n + tsFiles(path.join(PRESENTATION, d)).length, 0));
  for (const d of SCAN_DIRS) {
    const n = tsFiles(path.join(PRESENTATION, d)).length;
    assert.ok(n > 0, `扫描分母为 0：src/presentation/${d} 下一个 .ts 都没有 ⇒ 本判据什么都没验（不是"通过"）`);
  }
  assert.ok(scanned.length >= 10, `扫描分母异常小：只扫到 ${scanned.length} 个文件`);

  const violations: string[] = [];
  for (const f of scanned) {
    const rel = path.relative(REPO, f).split(path.sep).join('/');
    for (const imp of importsOf(f, fs.readFileSync(f, 'utf-8'))) {
      const target = resolveSpec(f, imp.spec);
      if (!target) continue;
      const core = WRITE_CORES.find((c) => c.module === target);
      if (!core) continue;
      const named = core.onlyNamed;
      const hit = named ? imp.names.filter((n) => named.includes(n)) : ['(整模块)'];
      if (hit.length === 0) continue; // 同一模块的**只读**导出（getDSL / getDesignSheet …）不算违规
      violations.push(`${rel} → ${target} 的 ${hit.join(' / ')}（${core.why}）`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    '这些 presentation 文件直连写核 ⇒ 改册可以绕过 editDslHandler 的 L1–L4 / T20 / view=live / 孤儿键闸。' +
      `\n要改册请走 application/design/handlers.ts#editDslHandler（MCP 与 daemon 共用同一个写端）：\n  ${violations.join('\n  ')}`,
  );

  // 正对照：同一条规则对**真违规形状**会命中（否则"0 违规"可能只是正则没命中过）
  const handlerFile = path.join(REPO, 'src', 'application', 'design', 'handlers.ts');
  const control = importsOf(handlerFile, fs.readFileSync(handlerFile, 'utf-8'))
    .map((i) => resolveSpec(handlerFile, i.spec))
    .filter((t) => t !== null);
  assert.ok(
    control.includes('src/application/design/dsl_ops/update_feature.ts'),
    '正对照失败：handlers.ts 明明 import 了 update_feature，本文件却没解析出来 ⇒ 解析器坏了，"0 违规"不作数',
  );
});

test('P0-写口 ② · daemon 的写入口就是 edit_dsl 的写端（不是它自己另开一条）', () => {
  const daemonFile = path.join(PRESENTATION, 'daemon', 'daemon.ts');
  const recs = importsOf(daemonFile, fs.readFileSync(daemonFile, 'utf-8'));
  const toHandlers = recs.filter((r) => resolveSpec(daemonFile, r.spec) === 'src/application/design/handlers.ts');
  assert.equal(toHandlers.length, 1, `src/presentation/daemon/daemon.ts 必须 import application/design/handlers（实际 ${toHandlers.length} 处）`);
  assert.ok(
    toHandlers[0].names.includes('editDslHandler'),
    `daemon 的写入口必须是 editDslHandler（实际导入：${toHandlers[0].names.join(', ')}）—— ` +
      '换成任何别的函数都意味着 `POST /api/dsl` 能绕过 L1–L4 改册',
  );
});

test('P0-写口 ③ · 写宿主（daemon 进程）不自我转发：本地执行，一个 /api/dsl 请求都不再发', async () => {
  const mod = (await import('../src/application/dispatch.js')) as unknown as {
    dispatchDslEdit: (
      input: Record<string, unknown>,
      localRun: (i: Record<string, unknown>) => { message: string; feature: string },
    ) => Promise<{ result: { message: string; feature: string }; viaDaemon: boolean }>;
    invalidateDaemonCache: () => void;
    markDslWriteHost?: () => void;
  };

  // 假 daemon：/api/health 回 ok（探针会认为 daemon 活着）、/api/dsl 只记数
  let dslHits = 0;
  const srv = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, name: 'fake-daemon', pid: 1, port: 0, started_at: '', watches: [] }));
      return;
    }
    if (req.url === '/api/dsl') {
      dslHits++;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rev: 7, message: '假 daemon 写的' }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as AddressInfo).port;
  const prevPort = process.env.AGENT_IO_DAEMON_PORT;
  process.env.AGENT_IO_DAEMON_PORT = String(port);
  try {
    // 正对照：没有"写宿主"身份时**必须真的转发** —— 证明假 daemon 可达、探针不是死的
    mod.invalidateDaemonCache();
    let localCalls = 0;
    const localRun = () => {
      localCalls++;
      return { message: '本地写的', feature: 'f' };
    };
    const forwarded = await mod.dispatchDslEdit({ feature: 'f' }, localRun);
    assert.equal(forwarded.viaDaemon, true, '正对照：daemon 活着时 MCP 侧必须转发（否则本用例下面测的"不转发"没有意义）');
    assert.equal(dslHits, 1, `正对照：转发必须真的打到 /api/dsl（实际 ${dslHits} 次）`);
    assert.equal(localCalls, 0, '正对照：转发路径不许同时本地写一遍');

    // ★ 红线：写宿主身份下，一个字节都不许再转发
    assert.equal(typeof mod.markDslWriteHost, 'function', '缺 markDslWriteHost：daemon 无法声明"我是写宿主" ⇒ 它执行 edit_dsl 时会 postDsl 转发给自己 ⇒ 同 feature 串行桶自锁死（外层 await 内层，内层排在外层之后）');
    mod.markDslWriteHost!();
    mod.invalidateDaemonCache();
    localCalls = 0;
    const local = await mod.dispatchDslEdit({ feature: 'f' }, localRun);
    assert.equal(local.viaDaemon, false, '写宿主必须走本地（viaDaemon=false）');
    assert.equal(localCalls, 1, '写宿主必须真的调用 localRun（否则那次写入消失了）');
    assert.equal(dslHits, 1, `写宿主不自我转发：/api/dsl 请求数必须停在 1（实际 ${dslHits} ⇒ 转发了一次 = 自锁死）`);
    assert.equal(local.result.message, '本地写的', '回执必须来自本地那次写');
  } finally {
    if (prevPort === undefined) delete process.env.AGENT_IO_DAEMON_PORT;
    else process.env.AGENT_IO_DAEMON_PORT = prevPort;
    mod.invalidateDaemonCache();
    await new Promise<void>((r) => srv.close(() => r()));
  }
});
