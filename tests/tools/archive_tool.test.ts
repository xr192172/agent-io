/**
 * `archive` 单入口的工具层测试（node / list）
 *
 * ★ 2026-09-29（**面收敛第二批**）：原「归档下线节点」+「列下线库条目」两个**注册入口**
 *   收敛为 **1 个入口 `archive` + action 枚举**。
 *   判据（`docs/tool-convergence.md` §2.0）：**按「操作对象」聚合** —— 两者操作的是**同一个对象**
 *   「某 feature 的下线库归档条目」（住在 `<live_dir>/.agent-io/archive/<feature>/`），
 *   共用同一锚点参数 `feature`，动作互补 = **写**（node）+ **读**（list）——
 *   与第一批的 `snapshot`（list / rollback）**同型**。
 *
 * 为什么这层测试值得单写（判据要落成机器可判的）：
 *   ① 收敛**不许丢能力**：归档即"存档完整 DSL 快照 + 从设计 DSL 移除文件/节点/边"、
 *      合并场景写目标 `lifecycle.merged_from`、"重复归档被拒" —— 三条都要有断言；
 *   ② 新入口自己的**前置校验**：缺 action / 缺 feature / node 缺 file_path|retire_reason
 *      ⇒ 明确报错（而不是拿 `undefined` 当 feature 名去 `getDSL`）；
 *   ③ ★ 本笔**没有**给 node 加 dry_run（语义与旧入口逐字相同），这条"没改"也要被钉住：
 *      description 必须写明"不可逆 / 立即落盘 / 无 dry_run"，回执必须给出 `removed_from_dsl`。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TOOL_DEFS } from '../../src/server_registry';
import { clearAllFeatures, deleteFeature, getDSL, listArchiveEntries, saveDSL } from '../../src/storage';
import type { DesignDSL, SemanticFile } from '../../src/domain/types';

const def = (name: string) => {
  const d = TOOL_DEFS.find((t) => t.name === name);
  if (!d) throw new Error(`工具 ${name} 未注册`);
  return d as unknown as {
    handler: (a: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>;
  };
};

/** 调用工具并拆开 MCP 文本（`message\n---DATA---\n<json>`）——见 wrapData 契约 */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<{ message: string; data: Record<string, unknown>; isError: boolean }> {
  const r = await def(name).handler(args);
  const [message, dataRaw] = r.text.split('\n---DATA---\n');
  return {
    message: message ?? '',
    data: dataRaw ? (JSON.parse(dataRaw) as Record<string, unknown>) : {},
    isError: r.isError === true,
  };
}

function file(pathName: string): SemanticFile {
  return {
    id: 'f_' + pathName.replace(/[^a-zA-Z0-9]/g, '_'),
    path: pathName,
    responsibility: '测试文件',
    lines: 5,
  };
}

/** 最小 DSL：文件级决策卡挂在同 id 的 geometry node 上（归档卡取的就是它） */
function dsl(feature: string, files: SemanticFile[], withEdge = false): DesignDSL {
  return {
    id: feature,
    type: 'feature_diagram',
    feature,
    version: '1.0',
    title: feature,
    status: 'done',
    geometry: {
      layout: 'free',
      width: 800,
      height: 400,
      nodes: files.map((f) => ({ id: f.id, label: f.path, decision: { summary: `文件决策：${f.path}` } })),
      edges: withEdge
        ? [{ id: 'e1', from: files[0]!.id, to: files[1]!.id, label: 'calls' }]
        : [],
    },
    semantic: { files },
  } as DesignDSL;
}

const done: string[] = [];
function track(feature: string): string {
  done.push(feature);
  return feature;
}

describe('archive 单入口', () => {
  beforeEach(() => {
    clearAllFeatures();
  });
  afterEach(() => {
    for (const f of done) {
      try {
        deleteFeature(f);
      } catch {
        /* ignore */
      }
    }
    done.length = 0;
  });

  it('archive 已注册，description 写明两个 action + 「不可逆 / 立即落盘 / 无 dry_run」+ 重复归档被拒', () => {
    const d = TOOL_DEFS.find((t) => t.name === 'archive');
    expect(d).toBeTruthy();
    const desc = (d as { description: string }).description;
    expect(desc.length).toBeGreaterThan(80);
    for (const k of ['action=node', 'action=list', '不可逆', '没有 dry_run', '重复归档']) {
      expect(desc, `description 少了「${k}」`).toContain(k);
    }
    // ★ 旧名不出现在本文件里（`contract_docs_gate` 会把旧名的任何字符串/注释判成"改名残留"）。
    //   "旧入口已消失"由 **G1 快照基线**的 `removed` 差集机器证明（tests/fixtures/tool_set_snapshot.json）
    //   与本门的 58 条一致性断言互补 —— 不在这里重抄旧名（抄了反而把门打红）。
    expect(TOOL_DEFS).toHaveLength(58);
  });

  it('★ 前置校验：缺 action / 缺 feature / node 缺 file_path|retire_reason ⇒ 明确报错', async () => {
    const noAction = await call('archive', { feature: 'x' });
    expect(noAction.isError).toBe(true);
    expect(noAction.message).toContain('action');

    const noFeature = await call('archive', { action: 'list' });
    expect(noFeature.isError).toBe(true);
    expect(noFeature.message).toContain('feature');

    const noFile = await call('archive', { action: 'node', feature: track('ar_pre'), retire_reason: 'r' });
    expect(noFile.isError).toBe(true);
    expect(noFile.message).toContain('file_path');

    const noReason = await call('archive', { action: 'node', feature: track('ar_pre'), file_path: 'src/a.ts' });
    expect(noReason.isError).toBe(true);
    expect(noReason.message).toContain('retire_reason');
  });

  it('list：无归档时如实说明（不报假成功），data.entries 为空数组', async () => {
    const f = track('ar_empty');
    const r = await call('archive', { action: 'list', feature: f });
    expect(r.isError).toBe(false);
    expect(r.message).toContain('共 0 条归档');
    expect(r.message).toContain('尚无节点下线');
    expect(r.data.entries).toEqual([]);
  });

  it('★ node（孤立归档）：存档条目 + 从 DSL 移除文件/节点/边 + 回执给出 archive_id 与 removed_from_dsl', async () => {
    const f = track('ar_node');
    saveDSL(dsl(f, [file('src/a.ts'), file('src/b.ts')], true));

    const r = await call('archive', {
      action: 'node',
      feature: f,
      file_path: 'src/a.ts',
      retire_reason: '废弃模块清理',
    });
    expect(r.isError).toBe(false);
    expect(r.data.removed_from_dsl).toBe(true);
    expect(typeof r.data.archive_id).toBe('string');
    // ★ 回执编排：结构化产物（条目 id + 是否已移除）必须出现在 message 里
    expect(r.message).toContain(String(r.data.archive_id));
    expect(r.message).toContain('已从设计 DSL 移除：true');

    // 能力①：条目落进下线库，且带原因与完整 DSL 快照
    const entries = listArchiveEntries(f);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.file_path).toBe('src/a.ts');
    expect(entries[0]!.retire_reason).toBe('废弃模块清理');
    expect(entries[0]!.dsl.semantic?.files.map((x) => x.path)).toEqual(['src/a.ts', 'src/b.ts']);

    // 能力②：从设计 DSL 移除文件/节点/边（"不再参与周边联系"）
    const after = getDSL(f)!;
    expect(after.semantic?.files.map((x) => x.path)).toEqual(['src/b.ts']);
    expect(after.geometry.nodes?.map((n) => n.id)).toEqual(['f_src_b_ts']);
    expect(after.geometry.edges ?? []).toHaveLength(0);
  });

  it('node（合并归档）：目标文件 lifecycle.merged_from 记上来源，回执写明"合并到"', async () => {
    const f = track('ar_merge');
    saveDSL(dsl(f, [file('src/a.ts'), file('src/b.ts')]));

    const r = await call('archive', {
      action: 'node',
      feature: f,
      file_path: 'src/a.ts',
      retire_reason: '两文件合一',
      merged_into: 'src/b.ts',
    });
    expect(r.isError).toBe(false);
    expect(r.message).toContain('合并到');
    const target = getDSL(f)!.semantic!.files.find((x) => x.path === 'src/b.ts')!;
    expect(target.lifecycle?.merged_from).toEqual(['src/a.ts']);
  });

  it('★ 重复归档被拒（旧入口的防御原样保留）', async () => {
    const f = track('ar_dup');
    saveDSL(dsl(f, [file('src/a.ts'), file('src/b.ts')]));
    const first = await call('archive', { action: 'node', feature: f, file_path: 'src/a.ts', retire_reason: 'r' });
    expect(first.isError).toBe(false);

    // 同一文件二次归档：设计 DSL 里已无该文件 ⇒ 必须报错，不许静默成功
    const again = await call('archive', { action: 'node', feature: f, file_path: 'src/a.ts', retire_reason: 'r' });
    expect(again.isError).toBe(true);
    expect(again.message).toContain('已归档过');
  });

  it('node：设计 DSL 里不存在的文件 ⇒ 如实报错', async () => {
    const f = track('ar_missing');
    saveDSL(dsl(f, [file('src/a.ts')]));
    const r = await call('archive', { action: 'node', feature: f, file_path: 'src/nope.ts', retire_reason: 'r' });
    expect(r.isError).toBe(true);
    expect(r.message).toContain('设计 DSL 中不存在文件');
  });

  it('★ node⇒list 是一条链：归档后立刻能在同入口的 list 里查到（两个 action 同一操作对象）', async () => {
    const f = track('ar_chain');
    saveDSL(dsl(f, [file('src/a.ts')]));
    await call('archive', { action: 'node', feature: f, file_path: 'src/a.ts', retire_reason: '清理' });

    const r = await call('archive', { action: 'list', feature: f });
    expect(r.isError).toBe(false);
    expect(r.message).toContain('共 1 条归档');
    expect(r.message).toContain('src/a.ts');
    expect(r.message).toContain('清理');
  });
});
