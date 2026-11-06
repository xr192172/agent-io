/**
 * P0 · **派生写端**的定性（2026-11-02 普查 ③–⑥）
 *
 * ## 它钉的是什么（一句话，可判真假）
 * 这四个入口（`import_project` / `sync_contracts` / `opl` / `arch_layer`）**都调 `saveDSL`**
 * —— 物理上都在写设计册（`design/<f>.dsl.json`）。但它们写的是**可从别处重算的投影**
 * （扫描产物 / MCP 注册表 / opl 状态 / 路径启发式），**不是"人改意图"**。
 * ⇒ 判据不是"把它们塞进 `edit_dsl`"，而是钉住两条不变量：
 *   ① **谁写谁声明**：落盘必须被**本文件内**的 `runDslWriteScope({via,who})` **包住**
 *      （`via` 是 `import`/`derived`/`tool`，**不是** `edit_dsl`）—— 不靠"假设外层包了我"；
 *   ② **派生写不许丢意图**：读-改-写之后，别人写进册里的 `decision` / 手写节点必须**原样还在**。
 *
 * ## 为什么必须是一条判据（而不是注释）
 * 2026-11-02 的只读普查把 `saveDSL` 调用点当成"绕开 `edit_dsl` 的写入口"列了 12 个，
 * 其中 **3 个是注释里的 `saveDSL(...)`**（③ `import_project.ts:256/1159/1160` 全是注释，
 * 真实调用只有 `:1378` 一处）—— 量具把"提到"当"做了"，一次就虚报 3 个。
 * ⇒ 本文件同时钉住**量具口径**（注释不算，见下面 `realSaveDslSites` 的正/反例）。
 *
 * ## 定性表（改代码前先读这张表；四行都是 **C 必须独立**，没有一行是"收进 edit_dsl"）
 * | 入口 | 写什么（关键行） | 为什么不能走 edit_dsl |
 * |---|---|---|
 * | `import_project` | 整本册从扫描 fork/重建（`import_project.ts:1378`，`via:'import'`） | 640 个节点的扫描产物，**没有一条 op 能表达**；且它要保住 overlay 里的人工意图（`mergeDesignLayer`） |
 * | `sync_contracts` | `semantic.files[].expected_apis`（`sync_contracts.ts:166`） | 内容是 **zod 注册表的投影**（注册表 = 契约的唯一事实源）；`edit_dsl` 的 `type=api` 要 T20 现取 + L1–L4 理由，而 `include_all` 补新文件时还得**编一条 file-exists 期望**才过闸 —— 那是"为流程服务的假证据" |
 * | `opl` | 新增 `semantic.files` 条目 + `status:'done'` + `feature_tree` 接线（`opl.ts:403`，`via:'derived'`） | 内容是 **opl 状态文件的投影**（`accepted` 来自真 DSL 比较）；实现体在 `impl_root`（不在索引里）⇒ 走 `type=file/add` 会被 T20 拒 |
 * | `arch_layer` | 节点 `arch_layer` + `layers`（`arch_layer.ts:245`，`via:'derived'`，仅 `persist=true`） | 内容是**路径启发式的投影**，重算即得；`persist` 默认 `false` |
 *
 * ## 覆盖边界（诚实清单）
 * · 只钉这 4 个（其余写点属于别的卡：`derive_*` / `monolith` / `snapshot` / `dag_layout` / `reconcile`）。
 * · ② 只验 `decision` + 手写节点存活；`todos` 不验（`saveDSL` 落盘时**本来就不写** `todos`，见 `withoutTodos`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { saveDSL, getDesignSheet } from '../src/infrastructure/storage.js';
import { archLayer } from '../src/infrastructure/analysis/structure/arch_layer.js';
import { syncContracts } from '../src/application/meta/registry/sync_contracts.js';
import { bindToolDefs } from '../src/application/meta/registry/capability_map.js';
import type { ToolDef } from '../src/application/types.js';
import type { DesignDSL } from '../src/domain/types.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';
// ★★ R6（2026-11-06）：**剥注释没有第二份** —— 有 filePath 走整文件权威，没有走片段权威（0.9.1④）。
//   ★ 为什么测试能用整文件权威（而不像 `scripts/*.mjs` 只能用片段）：测试由 `node --import tsx --test` 起，
//     tsx 把 `comments.js` 解析到 `comments.ts` ⇒ 不依赖 dist；而 `scripts/*.mjs` 走纯 node，那个 `./kernel.js`
//     说明符解不到 `.ts`（实测 Cannot find module）⇒ 两边结论不同，判据是**运行环境**而不是“测试不重要”。
import { stripCommentsSync } from '../src/infrastructure/parse/comments.js';
import { stripComments } from '../src/domain/text_strip.js';
import { prewarmKernel } from '../src/infrastructure/parse/kernel.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 整文件权威需要 parser 预热（未预热 ⇒ `null` = 没查成）⇒ 模块级预热一次，各用例直接用。
await prewarmKernel();

/** 真实 `saveDSL(...)` 调用点的行号（**注释里的不算** —— 见文件头的虚报 3 个） */
function realSaveDslSites(src: string): number[] {
  const out: number[] = [];
  src.split('\n').forEach((line, i) => {
    if (!/\bsaveDSL\s*\(/.test(line)) return;
    const head = line.trimStart();
    // 行首是 `//` `*` `/*` ⇒ 它在注释里（`stat-raw-writes.mjs` 同一口径）
    if (head.startsWith('//') || head.startsWith('*') || head.startsWith('/*')) return;
    if (/function\s+saveDSL\s*\(/.test(line)) return; // 声明本身不是调用
    out.push(i + 1);
  });
  return out;
}

/**
 * ★★ R6（2026-11-06，0.9.1④）：**剥注释没有第二份**。
 * 判据落在函数签名上：**有 filePath ⇒ 整文件权威**（`parse/comments.ts#stripCommentsSync`，AST 注释区间）；
 * **没有 filePath ⇒ 片段权威**（`domain/text_strip.ts#stripComments`）。
 * 本文件两种输入都有：仓库真文件（有路径）与第 ①个用例的一条**合成 snippet**（没有路径）。
 * ★ 返回 null = **没查成**（parser 未预热 / 扩展名不支持）⇒ 当场红，不当“没有注释”（0.9.4 第 1 行）。
 */
function stripFor(code: string, filePath?: string): string {
  if (!filePath) return stripComments(code);
  const out = stripCommentsSync(filePath, code);
  assert.ok(out !== null, `${filePath}：整文件权威返回 null（判不了 ≠ 通过）`);
  return out as string;
}

/** 本文件内有没有一条 `runDslWriteScope({via,who})` **包住**落盘（同行，或块体形态的紧随 3 行内） */
function declarationWrapsCall(src: string, via: string, who: string, filePath?: string): boolean {
  const lines = stripFor(src, filePath).split('\n');
  const decl = new RegExp(
    `runDslWriteScope\\s*\\(\\s*\\{\\s*via\\s*:\\s*['"]${via}['"]\\s*,\\s*who\\s*:\\s*['"]${who}['"]`,
  );
  for (let i = 0; i < lines.length; i++) {
    if (!decl.test(lines[i])) continue;
    if (/\bsaveDSL\s*\(/.test(lines[i])) return true;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (/\bsaveDSL\s*\(/.test(lines[j])) return true;
    }
  }
  return false;
}

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), 'utf-8');

/** 四个入口的登记表（新增派生写端 ⇒ 在这里加一行，否则本判据看不见它） */
const WRITE_ENDS: Array<{ file: string; via: string; who: string }> = [
  { file: 'src/infrastructure/graph/import_project.ts', via: 'import', who: 'import_project' },
  { file: 'src/application/meta/registry/sync_contracts.ts', via: 'tool', who: 'sync_contracts' },
  { file: 'src/application/design/derive/opl.ts', via: 'derived', who: 'opl' },
  { file: 'src/infrastructure/analysis/structure/arch_layer.ts', via: 'derived', who: 'arch_layer' },
];

test('派生写端 ① · 量具口径：注释里的 saveDSL( 不是调用点（正/反例双向）', () => {
  // 反例（异义必不命中）：注释形态两行都不许被数到
  // 正例（同义必命中）：真调用必须被数到
  const snippet = [
    '// saveDSL(x) —— 行注释里提到，不是调用',
    ' * saveDSL(x) —— 块注释里提到，不是调用',
    "runDslWriteScope({ via: 'derived', who: 'w' }, () => saveDSL(x, 'mcp'));",
  ].join('\n');
  assert.deepEqual(realSaveDslSites(snippet), [3], '注释被数进来了 ⇒ 普查会虚报（2026-11-02 实测虚报 3 个）');

  // 真文件：③ 的 4 个"命中行"里只有 1 个是真调用
  const sites = realSaveDslSites(read('src/infrastructure/graph/import_project.ts'));
  assert.equal(
    sites.length,
    1,
    `import_project.ts 的真实 saveDSL 调用点必须恰好 1 处（实际 ${sites.join(', ')}）—— ` +
      '普查把 256/1159/1160 三行**注释**也算成了写入口',
  );
  assert.ok(sites[0] > 1300, `真实调用点应在末尾落盘块（实际第 ${sites[0]} 行）`);
});

test('派生写端 ② · 四个入口都在**本文件内**声明自己，且声明包住落盘（不靠外层包装）', () => {
  const missing: string[] = [];
  for (const d of WRITE_ENDS) {
    const src = read(d.file);
    const sites = realSaveDslSites(src);
    if (sites.length === 0) {
      missing.push(`${d.file}：找不到真实 saveDSL 调用点（判据自己失效了，别当成通过）`);
      continue;
    }
    if (!declarationWrapsCall(src, d.via, d.who, path.join(REPO, d.file))) {
      missing.push(`${d.file}：缺 \`runDslWriteScope({ via: '${d.via}', who: '${d.who}' }, …)\` 包住落盘`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    '这些派生写端没有在**写点自己身上**声明"我是谁" ⇒ 只能靠"假设外层 invokeTool 包了我"，' +
      '而 `serve.ts` 直连的写点根本没有外层（`dsl_write_scope.ts` 头注已写明这条不变量）：\n  ' + missing.join('\n  '),
  );
});

/** 一本带**人工意图**的册（decision + 手写节点 + 手写职责）—— 派生写之后它们必须还在 */
function seedSheet(home: string, feature: string, extraFiles: string[] = []): void {
  const sheet = {
    feature,
    source_root: home,
    geometry: {
      nodes: [
        { id: 'file_src_domain_a_ts', type: 'file', path: 'src/domain/a.ts', label: 'a', x: 0, y: 0 },
        { id: 'file_src_presentation_b_ts', type: 'file', path: 'src/presentation/b.ts', label: 'b', x: 10, y: 0 },
        {
          id: 'svc_hand',
          type: 'service',
          label: '人手加的节点',
          x: 20,
          y: 0,
          decision: { summary: '人手写的决策，扫描产不出来' },
        },
      ],
      edges: [],
    },
    semantic: {
      files: [
        { id: 'file_src_domain_a_ts', path: 'src/domain/a.ts', responsibility: '人手写的职责' },
        ...extraFiles.map((p, i) => ({ id: `f_extra_${i}`, path: p, responsibility: '已有职责' })),
      ],
    },
  };
  saveDSL(sheet as unknown as DesignDSL, 'mcp');
}

/** 落盘后的 `_sync.via`（**从文件读** —— 内存那份是调用方自己设的） */
function viaOnDisk(home: string, feature: string): string | undefined {
  const file = path.join(home, '.agent-io', 'design', `${feature}.dsl.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { _sync?: { via?: string } };
  return raw._sync?.via;
}

/** 在临时数据仓里跑一段（`AGENT_IO_HOME` 是唯一的落点声明 ⇒ 写闸按沙盒放行） */
function inSandbox(fn: (home: string) => void | Promise<void>): Promise<void> {
  const home = makeTempHome();
  const prev = process.env.AGENT_IO_HOME;
  process.env.AGENT_IO_HOME = home;
  const done = async (): Promise<void> => {
    if (prev === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prev;
    rmRf(home);
  };
  return Promise.resolve()
    .then(() => fn(home))
    .then(done, (e: unknown) => {
      void done();
      throw e;
    });
}

test('派生写端 ③ · arch_layer 的 persist 写：记的是自己（derived:arch_layer），且不丢意图', async () => {
  const feature = `__writend_arch_${process.pid}`;
  await inSandbox(async (home) => {
    seedSheet(home, feature);
    const r = await archLayer({ feature, persist: true, check_violations: false, no_cache: true });
    assert.equal(r.persisted, true, 'persist=true 必须真落盘');

    assert.equal(
      viaOnDisk(home, feature),
      'derived:arch_layer',
      '写端必须自己声明自己（`_sync.via` 是留痕的唯一读数）',
    );

    const d = getDesignSheet(feature) as unknown as DesignDSL;
    const fileNode = d.geometry.nodes.find((n) => n.id === 'file_src_domain_a_ts');
    assert.ok(fileNode, '派生写把文件节点写没了');
    assert.equal(typeof (fileNode as { arch_layer?: string }).arch_layer, 'string', '分层结果没写进节点');
    assert.ok((d.layers ?? []).length > 0, '`layers` 没写回');

    // 不变量：派生写不许丢别人写进册里的意图
    const hand = d.geometry.nodes.find((n) => n.id === 'svc_hand') as
      | { decision?: { summary?: string } }
      | undefined;
    assert.equal(hand?.decision?.summary, '人手写的决策，扫描产不出来', '派生写把决策卡冲掉了');
    const sem = d.semantic.files.find((f) => f.id === 'file_src_domain_a_ts');
    assert.ok(
      String(sem?.responsibility ?? '').includes('人手写的职责'),
      '派生写把手写的 responsibility 覆盖掉了',
    );
  });
});

test('派生写端 ④ · arch_layer 不 persist 时一个字节都不写', async () => {
  const feature = `__writend_nopersist_${process.pid}`;
  await inSandbox(async (home) => {
    seedSheet(home, feature);
    const file = path.join(home, '.agent-io', 'design', `${feature}.dsl.json`);
    const before = fs.readFileSync(file, 'utf-8');
    const r = await archLayer({ feature, check_violations: false, no_cache: true });
    assert.equal(r.persisted, false, 'persist 缺省必须是 false');
    assert.equal(fs.readFileSync(file, 'utf-8'), before, 'persist=false 时册被改了（默认路径不许写盘）');
  });
});

test('派生写端 ⑤ · sync_contracts 回填 expected_apis：记的是自己（tool:sync_contracts），且不丢意图', async () => {
  const feature = `__writend_sync_${process.pid}`;
  const implPath = 'src/infrastructure/analysis/structure/arch_layer.ts';
  // 注入一份**最小**工具目录（真注册表在测试进程里没接线；`listToolDefs` 未注入会抛）
  bindToolDefs([
    {
      name: 'arch_layer',
      title: '架构分层',
      description: '',
      inputSchema: {},
      handler: async () => ({ text: '' }),
    } as unknown as ToolDef,
  ]);
  await inSandbox(async (home) => {
    seedSheet(home, feature, [implPath]);
    const r = syncContracts({ feature });
    assert.deepEqual(r.updated_files, [implPath], `应只回填 ${implPath}（实际 ${r.updated_files.join(', ')}）`);

    assert.equal(
      viaOnDisk(home, feature),
      'tool:sync_contracts',
      '回填写端必须自己声明自己 —— 只靠 `invokeTool` 外层授权时，serve/脚本直调就没有留痕',
    );

    const d = getDesignSheet(feature) as unknown as DesignDSL;
    const f = d.semantic.files.find((x) => x.path === implPath);
    const sigs = (f?.expected_apis ?? []).map((a) => a.signature);
    assert.ok(
      sigs.some((s) => s.startsWith('arch_layer(')),
      `回填的签名没进册（实际 ${JSON.stringify(sigs)}）`,
    );
    const hand = d.geometry.nodes.find((n) => n.id === 'svc_hand') as
      | { decision?: { summary?: string } }
      | undefined;
    assert.equal(hand?.decision?.summary, '人手写的决策，扫描产不出来', '回填把决策卡冲掉了');
  });
});
