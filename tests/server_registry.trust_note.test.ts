/**
 * 行动工具的可信度自动附注 测试（§5-②）
 *
 * 分工：staleIndexWarning（全部工具）覆盖"索引落后于磁盘"（stat 可见的那类旧）；
 * 本附注（trustAnnotated 工具）覆盖**陈旧断言**（resolved 但目标符号已不在索引）
 * —— 索引自身内部不一致，文件内容没变 ⇒ 保鲜路径看不见，唯一线索是这批行本身。
 * 它造成**静默漏报**：查到了但少了，LLM 无从察觉 —— 对行动建议类工具最危险。
 *
 * 覆盖：
 *   - trustAnnotated 标在 4 个行动工具上（结构声明，不是自觉）
 *   - 健康索引 ⇒ impact_analysis 响应**不含** TRUST 注（不刷屏）
 *   - 制造陈旧断言 ⇒ 响应含"陈旧断言" + 可执行修复（index_integrity refresh:true）
 *   - refresh:true 修复后 ⇒ 附注消失（反馈闭环）
 *   - 无索引 ⇒ 不附注（那种"不全"由 firstContactBackfill 标注，分工不混）
 *   - 无缓存：同一份陈旧状态连续两次调用都报（宁可每次查，也不要过期的诚实）
 */
import { DATA_DIR_NAME } from '../src/infrastructure/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { registerAllTools, TOOL_DEFS, trustNoteFor } from '../src/presentation/mcp/server_registry.js';
import { importProject } from '../src/infrastructure/graph/import_project.js';
import { openDb, closeAllProjectCacheDbs } from '../src/infrastructure/index/db';
import { stopBackfill } from '../src/tools/index_backfill';

type Cb = (args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;

function makeRegistry(): Map<string, Cb> {
  const captured = new Map<string, Cb>();
  registerAllTools({
    registerTool: (name: string, _cfg: unknown, cb: Cb) => {
      captured.set(name, cb);
    },
  } as never);
  return captured;
}

const roots: string[] = [];

afterAll(cleanup);
function cleanup(): void {
  for (const r of roots) stopBackfill(r);
  closeAllProjectCacheDbs();
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      /* 句柄未释放留给 OS */
    }
  }
}

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** service.ts 调 auth.login（形成一条 resolved 的跨文件引用） */
async function makeProject(tag: string): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `trust-${tag}-`));
  roots.push(root);
  put(root, 'src/auth.ts', `export function login(user: string): boolean {\n  return user === 'admin';\n}\n`);
  put(root, 'src/service.ts', `import { login } from './auth';\nexport function handle(u: string): boolean {\n  return login(u);\n}\n`);
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  await importProject({ project_dir: root, feature: `trust_${tag}`, cache_db: db });
  db.close();
  return root;
}

/** 模拟"索引自身与磁盘脱节"：删掉 auth.login 节点，FK 级联删边但 service 的 ref 行仍是 resolved */
function corruptByDroppingNode(root: string): void {
  const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
  db.prepare('DELETE FROM nodes WHERE id = $id').run({ id: 'src/auth.ts#login' });
  db.close();
}

describe('行动工具的可信度自动附注（trustAnnotated）', () => {
  it('trustAnnotated 标在 4 个行动工具上（结构声明）', () => {
    for (const name of ['find_references', 'impact_analysis', 'rename_symbols', 'rename_files']) {
      expect(TOOL_DEFS.find((d) => d.name === name)?.trustAnnotated, name).toBe(true);
    }
  });

  it('健康索引 ⇒ impact_analysis 响应不含 TRUST 注', async () => {
    const tools = makeRegistry();
    const root = await makeProject('ok');
    const r = await tools.get('impact_analysis')!({ project_dir: root, hubs: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).not.toContain('TRUST');
  });

  it('陈旧断言 ⇒ 响应自动附"静默漏报"预警 + 可执行修复', async () => {
    const tools = makeRegistry();
    const root = await makeProject('stale');
    corruptByDroppingNode(root);

    // 前置：trustNoteFor 直接可测（导出即为了能被测试看见）
    expect(trustNoteFor(root)).toContain('陈旧断言');
    expect(trustNoteFor(root)).toContain('静默漏报');
    expect(trustNoteFor(root)).toContain('index_integrity({project_dir, refresh:true})');

    const r = await tools.get('impact_analysis')!({ project_dir: root, hubs: true });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toContain('TRUST');
    expect(r.content[0].text).toContain('陈旧断言');

    // 无缓存：同一份陈旧状态连续两次调用都报（不过期的诚实）
    const r2 = await tools.get('impact_analysis')!({ project_dir: root, hubs: true });
    expect(r2.content[0].text).toContain('TRUST');
  });

  it('refresh:true 修复后 ⇒ 附注消失（反馈闭环）', async () => {
    const tools = makeRegistry();
    const root = await makeProject('repair');
    corruptByDroppingNode(root);
    expect((await tools.get('impact_analysis')!({ project_dir: root, hubs: true })).content[0].text).toContain('TRUST');

    await tools.get('index_integrity')!({ project_dir: root, refresh: true });
    expect(trustNoteFor(root)).toBe('');
    const after = await tools.get('impact_analysis')!({ project_dir: root, hubs: true });
    expect(after.content[0].text).not.toContain('TRUST');
  });

  it('无索引 ⇒ 不附注（"不全"由首次接触标注负责，分工不混）', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-bare-'));
    roots.push(bare);
    put(bare, 'src/a.ts', 'export const a = 1;\n');
    expect(trustNoteFor(bare)).toBe('');
  });
});
