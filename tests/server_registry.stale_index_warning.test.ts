/**
 * 索引陈旧告警（响应注入层）测试
 *
 * 为什么单测它：这是"不撒谎"不变量的**结构性兜底** —— 一次覆盖全部 60 个工具。
 * 但"注入型"逻辑最容易**静默失效**（永远返回 null 也没人发现），所以必须被测试看见。
 *
 * ★ P-F（§16.6）：产物是**结构化告警** `{code, summary, detail, fix}`（不是 message），
 *   且注入分两级 —— **首次出现给全文（detail+fix），之后给一行摘要（detail/fix = null，
 *   但 summary 仍在，不静默）**。"首次/后续"的判定依据 = `registry/tool_warnings.ts` 的
 *   进程内记账（键 `STALE_INDEX@<项目根>`）。本文件只验**判定 + 该记账的作用**，
 *   分级的通用逻辑另见 tests/registry/tool_warnings.test.ts。
 *
 * 覆盖：
 *   - 无根 / 没有索引 ⇒ null（不误报）
 *   - 索引与磁盘一致 ⇒ null
 *   - 索引落后于磁盘 ⇒ 首次**全文**；同根再调 ⇒ 降级为**一行摘要**（detail/fix 为 null）
 *   - 换一个项目根 ⇒ 该根**各自**算首次（scope 键含根）
 *   - 待消费自写登记 ⇒ 也算"陈旧"（同步工具那条链路的可见性）
 *   - ★ 端到端：经 `registerAllTools` 真实调用 ⇒ 响应末尾带 `---WARNINGS---` 机器块，
 *     且**块里的 JSON 与人类可读段同源**（"可被程序判定"的落点）
 */
import { DATA_DIR_NAME } from '../src/infrastructure/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { importProject } from '../src/infrastructure/graph/import_project.js';
import { openDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db';
import { detectStaleIndex } from '../src/infrastructure/index/index_freshness.js';
import { recordSelfWrite } from '../src/application/observe/write_gate.js';
import { registerAllTools, staleIndexWarning, resetStaleIndexWarningCache } from '../src/presentation/mcp/server_registry.js';
import { emitWarnings, resetWarningDelivery, WARNINGS_MARKER, type WireWarning } from '../src/presentation/mcp/tool_warnings.js';

const roots: string[] = [];

afterAll(() => {
  closeAllProjectCacheDbs(); // Windows：连接池持有 cache.db 句柄 ⇒ 清理前必须先关，否则 EBUSY
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      // Windows 文件占用，留给 OS 清理
    }
  }
});

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

async function makeIndexed(tag: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `staleidx-${tag}-`));
  roots.push(root);
  put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
  put(root, 'src/b.ts', 'export function beta(): number {\n  return 2;\n}\n');
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature: `staleidx_${tag}`, cache_db: db });
  db.close();
  return root;
}

beforeEach(() => {
  // 探测缓存 = 模拟"过了 5s"；投递记账 = 模拟"新进程"。两者分开清（见 resetStaleIndexWarningCache 注释）。
  resetStaleIndexWarningCache();
  resetWarningDelivery();
});

describe('detectStaleIndex（同步、只 stat）', () => {
  it('与磁盘一致 ⇒ stale=0；改一个文件 ⇒ stale≥1 且列出样例', async () => {
    const root = await makeIndexed('probe');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const clean = detectStaleIndex(db, root);
    expect(clean.stale).toBe(0);
    expect(clean.total).toBeGreaterThanOrEqual(2);
    expect(clean.sampled).toBe(false);

    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 42;\n}\n');
    const dirty = detectStaleIndex(db, root);
    expect(dirty.stale).toBeGreaterThanOrEqual(1);
    expect(dirty.sample).toContain('src/a.ts');
    db.close();
  });

  it('待消费的自写登记被计入 selfWritesPending', async () => {
    const root = await makeIndexed('selfw');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    expect(detectStaleIndex(db, root).selfWritesPending).toBe(0);
    recordSelfWrite(root, ['src/a.ts'], 'test');
    expect(detectStaleIndex(db, root).selfWritesPending).toBe(1);
    db.close();
  });

  it('大仓保护：文件多时抽样（sampled=true），不是取前缀', async () => {
    const root = await makeIndexed('sample');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    const p = detectStaleIndex(db, root, { maxScan: 1 });
    expect(p.sampled).toBe(true);
    expect(p.total).toBeGreaterThanOrEqual(2);
    db.close();
  });
});

describe('staleIndexWarning（响应注入层）', () => {
  it('无根 / 没有索引 ⇒ null（不误报）', async () => {
    expect(staleIndexWarning(null)).toBeNull();
    expect(staleIndexWarning('')).toBeNull();
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'staleidx-none-'));
    roots.push(bare);
    put(bare, 'src/a.ts', 'export const a = 1;\n');
    expect(staleIndexWarning(bare)).toBeNull();
  });

  it('一致 ⇒ null；落后 ⇒ 首次**全文**（结构化四字段），同根再调 ⇒ **一行摘要**（不静默）', async () => {
    const root = await makeIndexed('warn');
    expect(staleIndexWarning(root)).toBeNull();

    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 9900;\n}\n');
    // ★ 必须清缓存：探测有 5s TTL（与 staleSourceWarning 同一约定），
    //   否则刚才那次"一致"的结果会被缓存复用到窗口之外 —— 这是**已知盲窗**，不是 bug。
    resetStaleIndexWarningCache();
    // ★ 生产方（staleIndexWarning）只负责"判出来"，**分级在 emitWarnings**（≠ 这里）——
    //   所以这里按 registerAllTools 的真实路径走 emitWarnings。
    const w = staleIndexWarning(root);
    expect(w?.code).toBe('STALE_INDEX');
    expect(w?.summary).toContain('落后于磁盘');
    expect(w?.fix).toContain('refresh:true'); // 必须给可执行下一步
    expect(w?.detail).toBeTruthy();
    const r1 = emitWarnings([w]).warnings;
    expect(r1).toHaveLength(1);
    expect(r1[0].detail).toBeTruthy(); // 首次 = 全文

    // ★ P-F：**不再静默** —— 后续每轮仍给（但降级成一行摘要：detail/fix 为 null）
    const r2 = emitWarnings([staleIndexWarning(root)]).warnings;
    expect(r2).toHaveLength(1);
    expect(r2[0].code).toBe('STALE_INDEX');
    expect(r2[0].summary).toBeTruthy();
    expect(r2[0].detail).toBeNull();
    expect(r2[0].fix).toBeNull();
  });

  it('换一个项目根 ⇒ 该根各自算"首次"（分级键含 scope=根）', async () => {
    const r1 = await makeIndexed('scope1');
    put(r1, 'src/a.ts', 'export function alpha(): number {\n  return 11;\n}\n');
    resetStaleIndexWarningCache();
    expect(emitWarnings([staleIndexWarning(r1)]).warnings[0].detail).toBeTruthy(); // r1 首次全文
    expect(emitWarnings([staleIndexWarning(r1)]).warnings[0].detail).toBeNull(); // r1 之后摘要

    const r2 = await makeIndexed('scope2');
    put(r2, 'src/a.ts', 'export function alpha(): number {\n  return 22;\n}\n');
    resetStaleIndexWarningCache();
    expect(emitWarnings([staleIndexWarning(r2)]).warnings[0].detail).toBeTruthy(); // ★ r2 仍是首次 ⇒ 全文
  });

  it('恢复一致 ⇒ null；再变旧 ⇒ 仍报（但按**粘性**只给摘要，不重发全文）', async () => {
    const root = await makeIndexed('recover');
    // 首次：改旧 + 报一次（★ 改动要**改变文件大小**：本探测只比 size+mtime，
    //   等长改写落在同一毫秒时探测不到 —— 那是已知局限，内容 hash 归异步的 syncFile 管）
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 700;\n}\n');
    expect(emitWarnings([staleIndexWarning(root)]).warnings[0].detail).toBeTruthy();
    // 用保鲜修好（importProject 全量重同步）
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'staleidx_recover2', cache_db: db });
    db.close();
    // 5s 缓存会挡住 → 清掉缓存模拟"下一轮"
    resetStaleIndexWarningCache();
    expect(staleIndexWarning(root)).toBeNull(); // 已恢复一致 ⇒ null
    // 再改旧一次：状态机不卡死 ⇒ 仍能报；但"已投递全文"是粘性的 ⇒ 只有摘要
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 8000;\n}\n');
    resetStaleIndexWarningCache();
    const r = emitWarnings([staleIndexWarning(root)]).warnings;
    expect(r[0].code).toBe('STALE_INDEX');
    expect(r[0].summary).toBeTruthy();
    expect(r[0].detail).toBeNull();
  });

  it('待消费自写登记也算陈旧（同步工具链路的可见性）', async () => {
    const root = await makeIndexed('warnselfw');
    recordSelfWrite(root, ['src/a.ts'], 'test');
    const w = staleIndexWarning(root);
    expect(w?.code).toBe('STALE_INDEX');
    expect(w?.summary).toContain('自写登记待同步');
  });
});

describe('端到端：经 registerAllTools 的响应里带 ---WARNINGS--- 机器块', () => {
  type Cb = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

  function makeRegistry(): Map<string, Cb> {
    const captured = new Map<string, Cb>();
    registerAllTools({
      registerTool: (name: string, _cfg: unknown, cb: Cb) => {
        captured.set(name, cb);
      },
    } as never);
    return captured;
  }

  /** 取响应最末的机器块并解成数组（**程序判定**的落点：不靠正则读业务文本） */
  function warningsOf(text: string): WireWarning[] | null {
    const at = text.lastIndexOf(WARNINGS_MARKER);
    if (at < 0) return null;
    return JSON.parse(text.slice(at + WARNINGS_MARKER.length).trim()) as WireWarning[];
  }

  it('索引陈旧 ⇒ 第 1 轮全文、第 2 轮一行摘要，两轮都带可 JSON.parse 的机器块', async () => {
    const tools = makeRegistry();
    const root = await makeIndexed('e2e');
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 777777;\n}\n'); // 改动大小 ⇒ 探测得到
    resetStaleIndexWarningCache();
    resetWarningDelivery();

    // ★ 用 index_integrity（noAutoFresh）：它**不会**被自动保鲜，陈旧条件才留得住
    const r1 = (await tools.get('index_integrity')!({ project_dir: root, refresh: false })).content[0].text;
    const w1 = warningsOf(r1);
    expect(w1, `响应里没有 ${WARNINGS_MARKER} 块`).not.toBeNull();
    expect(w1!.map((w) => w.code)).toContain('STALE_INDEX');
    const first = w1!.find((w) => w.code === 'STALE_INDEX')!;
    expect(first.detail).toBeTruthy(); // 首次 = 全文
    expect(first.fix).toContain('refresh:true');
    expect(r1).toContain('STALE_INDEX'); // 人类可读段也在

    const r2 = (await tools.get('index_integrity')!({ project_dir: root, refresh: false })).content[0].text;
    const w2 = warningsOf(r2);
    const second = w2!.find((w) => w.code === 'STALE_INDEX')!;
    expect(second.summary).toBe(first.summary); // 摘要稳定
    expect(second.detail).toBeNull(); // ★ 长文本不再重复
    expect(r2).not.toContain(first.detail!); // 也**没**混在人类可读段里
  });
});
