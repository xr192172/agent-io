/**
 * P2-R1 · **deriveFeatureTree 写授权 scope 漏包**把守（2026-11-25）
 *
 * ## 钉的是什么（一句话，可判真假）
 * `persistFeatureTree` 落 `feature_tree` 必须在**函数自己身上**包
 * `runDslWriteScope({via:'derived', who:'feature_tree'})` —— 不靠"假设外层 invokeTool 包了我"。
 * rebuild_feature.mjs 脚本裸调链没有外层 tool scope ⇒ 不包就被 saveDSL 写闸拦（"没有写授权"），
 * feature_tree 写不回设计册。
 *
 * ## 为什么在这个文件守
 * 静态量具在 `p0_dsl_write_ends.test.ts#WRITE_ENDS`（本文件内 scope 包住落盘）；本文件补**行为**守：
 * 真跑 `deriveFeatureTree` 裸调链（无外层 tool scope），断言：
 *   ① 不被写闸拦抛错；② `feature_tree` 真写回设计册；③ `_sync.via` 留痕 `derived:feature_tree`；
 *   ④ 派生写不丢册里手写意图（decision / 手写 responsibility 原样还在）。
 *
 * ## 突变牙（摘 scope ⇒ 红）
 * 把 `persistFeatureTree` 里的 `runDslWriteScope(...)` 摘回裸 `saveDSL(...)`：本测试在
 * `AGENT_IO_SANDBOX=0`（临时 home 当真册根，不假借沙盒放行）下跑 ⇒ saveDSL 无授权抛
 * "没有写授权" ⇒ 用例①红。还原后复跑绿。
 *
 * ## 夹具口径
 * 临时 home（mkdtemp os.tmpdir）+ 显式 `AGENT_IO_SANDBOX=0`：数据仓虽在临时区，但当真册根判，
 * 写闸按真册口径要 scope（与 write_ends ③ 的默认沙盒放行不同 —— 那条验留痕，本条验闸拦鉴别力）。
 * 不写真册：所有落点都在临时 home，退出即 rmRf。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { deriveFeatureTree } from '../src/infrastructure/analysis/structure/derive_feature_tree.js';
import { getDesignSheet } from '../src/infrastructure/storage.js';
import type { DesignDSL } from '../src/domain/types.js';
import { makeTempHome, rmRf } from './helpers/i1_fixture.js';

/** 落一份带手写意图 + 语义文件的册（design + live 两份，source_root 指临时 home 供候选链读到） */
function seedBook(home: string, feature: string): void {
  const sheet: DesignDSL = {
    feature,
    title: feature,
    source_root: home,
    geometry: {
      nodes: [
        { id: 'file_src_domain_a_ts', type: 'file', path: 'src/domain/a.ts', label: 'a', x: 0, y: 0 },
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
      files: [{ id: 'file_src_domain_a_ts', path: 'src/domain/a.ts', responsibility: '人手写的职责' }],
    },
    todos: [],
  } as unknown as DesignDSL;
  const designDir = path.join(home, '.agent-io', 'design');
  const liveDir = path.join(home, '.agent-io', 'live');
  fs.mkdirSync(designDir, { recursive: true });
  fs.mkdirSync(liveDir, { recursive: true });
  const raw = JSON.stringify(sheet, null, 2);
  fs.writeFileSync(path.join(designDir, `${feature}.dsl.json`), raw, 'utf-8');
  fs.writeFileSync(path.join(liveDir, `${feature}.dsl.json`), raw, 'utf-8');
}

/** 落盘后的 `_sync.via`（从文件读 —— 内存那份是调用方自己设的） */
function viaOnDisk(home: string, feature: string): string | undefined {
  const file = path.join(home, '.agent-io', 'design', `${feature}.dsl.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as { _sync?: { via?: string } };
  return raw._sync?.via;
}

test('R1 · deriveFeatureTree 裸调链写回 feature_tree：有 derived 授权、不被闸拦、不丢意图', async () => {
  const feature = `__ft_scope_${process.pid}`;
  const home = makeTempHome();
  const prevHome = process.env.AGENT_IO_HOME;
  const prevSandbox = process.env.AGENT_IO_SANDBOX;
  process.env.AGENT_IO_HOME = home;
  process.env.AGENT_IO_SANDBOX = '0'; // 临时 home 当真册根：写闸按真册口径要 scope，不假借沙盒放行
  try {
    seedBook(home, feature);

    // 裸调：无外层 tool/import scope（复刻 rebuild_feature.mjs 脚本链）。project_dir=home（空临时目录，
    // 无 cache.db ⇒ analyzeMonolith 空社区回落目录分组；落盘只依赖册内 semantic.files）。
    const ft = await deriveFeatureTree({ project_dir: home, feature });

    assert.ok(ft.feature === feature, '返回 feature 应回传');
    const d = getDesignSheet(feature) as unknown as DesignDSL;
    assert.ok(d.feature_tree, 'feature_tree 必须写回设计册');
    assert.ok(Array.isArray(d.feature_tree?.features), 'feature_tree.features 必须是数组');

    assert.equal(
      viaOnDisk(home, feature),
      'derived:feature_tree',
      '写端必须自己声明自己（derived:feature_tree）；摘 scope 会退成无授权抛错或 sandbox 留痕',
    );

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
  } finally {
    if (prevHome === undefined) delete process.env.AGENT_IO_HOME;
    else process.env.AGENT_IO_HOME = prevHome;
    if (prevSandbox === undefined) delete process.env.AGENT_IO_SANDBOX;
    else process.env.AGENT_IO_SANDBOX = prevSandbox;
    rmRf(home);
  }
});
