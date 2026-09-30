/**
 * feature_map（可视化地基）测试 —— 把设计画布 src 当狗食现场验证"功能→前端/后端→相似→废弃"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildFeatureMap, featureIdOf, sideOfLayer } from '../../src/tools/feature_map';

const SRC = path.join(process.cwd(), 'src');

describe('feature_map 顶层约定', () => {
  it('功能 = source_root 下首层目录段；根文件归 root', () => {
    expect(featureIdOf('renderer/html_renderer.ts')).toBe('renderer');
    expect(featureIdOf('tools/detect_dead_imports.ts')).toBe('tools');
    expect(featureIdOf('server.ts')).toBe('root');
  });

  it('层 → 前端/后端/通用', () => {
    expect(sideOfLayer('ui')).toBe('frontend');
    expect(sideOfLayer('api')).toBe('backend');
    expect(sideOfLayer('service')).toBe('backend');
    expect(sideOfLayer('data')).toBe('backend');
    expect(sideOfLayer('utility')).toBe('shared');
    expect(sideOfLayer('core')).toBe('shared');
  });
});

describe('feature_map 在 agent-io src 上的真实结果', () => {
  it('能切出 src/ 下每个顶层目录（★ 与目录名解耦，不写死任一族）', () => {
    const { features, scannedFiles } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    expect(scannedFiles).toBeGreaterThan(100);
    const fns = features.map((f) => f.id);
    // ★★ 2026-09-30（搬 `dsl → domain` 时红）：原先这里写死 `renderer` / `tools` / `dsl` **三个目录名**
    //   ⇒ **每搬一族就要改一次测试**（本仓正在按 §44 逐族搬迁）。改为**从盘上读**：
    //   `src/` 下每个顶层目录都应被切成一个 feature。这样断言仍然具体（漏切某族就红），但**不随搬迁漂移**。
    const topDirs = fs
      .readdirSync(SRC, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(topDirs.length, 'src/ 顶层目录数异常（是不是盘上有空目录残留？）').toBeGreaterThan(5);
    for (const d of topDirs) expect(fns, `顶层目录 ${d} 没被切成 feature`).toContain(d);
    expect(fns).toContain('root'); // 根文件归 root
    // 分层识别的有效性：**至少有一族**命中前端或 shared 文件 —— 同样不写死是哪一族
    const withFrontend = features.filter((f) => f.frontend.length + f.shared.length > 0);
    expect(withFrontend.length, '没有任何一族命中前端/shared ⇒ 分层识别失效').toBeGreaterThan(0);
  });

  it('每组 proven 的 features 都带数组型 frontend/backend/shared（可渲染）', () => {
    const { features } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    for (const f of features) {
      expect(Array.isArray(f.frontend)).toBe(true);
      expect(Array.isArray(f.backend)).toBe(true);
      expect(Array.isArray(f.shared)).toBe(true);
      expect(f.similar).toBeInstanceOf(Array);
      expect(f.deprecation).toHaveProperty('deadImportSources');
      expect(f.deprecation).toHaveProperty('deadSources');
    }
  });

  it('★ 相似功能链接的**机制**：受控输入下必须产出 link，且 score/镜像都对', () => {
    // ★ 2026-09-30 改：原断言是「**真仓**里 `withSimilar.length > 0`」——
    //   那是在**赌目录布局**，不是测机制：搬 ⑥（`src/daemon/`→`presentation/daemon/`、
    //   `src/api/contract.ts`→`presentation/http/`）之后，它**合法地**变成 0：
    //   · `score = |共享 basename| / min(|A|, |B|)` ⇒ **族越大越难命中**；
    //   · 1 文件的 `api` 并进 10+ 文件的 `presentation` ⇒ 分母变大 ⇒ 落到 0.2 阈值下。
    //   （实测搬迁前 9 族 / 5 对 → 搬迁后 7 族 / 0 对。**信号其实还在**：三处 contract.ts
    //     依旧共存，只是这条启发式看不见了 —— 这是**量具灵敏度**问题，不是代码问题。）
    //   ⇒ 改成**受控输入**钉机制：这比"希望真仓恰好有一对"**更强**，且与布局无关。
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-similar-'));
    try {
      for (const [dir, files] of [['alpha', ['a', 'b', 'c']], ['beta', ['a', 'd']]] as const) {
        fs.mkdirSync(path.join(tmp, 'src', dir), { recursive: true });
        for (const f of files) fs.writeFileSync(path.join(tmp, 'src', dir, `${f}.ts`), `export const ${f} = 1;\n`);
      }
      const { features } = buildFeatureMap({ project_dir: tmp, source_root: path.join(tmp, 'src') });
      const alpha = features.find((f) => f.id === 'alpha');
      const beta = features.find((f) => f.id === 'beta');
      expect(alpha, 'alpha 应被切成独立 feature').toBeDefined();
      expect(beta, 'beta 应被切成独立 feature').toBeDefined();
      // 共享 a.ts：|∩|=1，min(|alpha|=3, |beta|=2)=2 ⇒ score=0.5
      expect(alpha!.similar).toEqual([{ featureId: 'beta', score: 0.5, sharedBasenames: ['a.ts'] }]);
      // 镜像性：a→b 存在 ⇒ b→a 必须存在
      expect(beta!.similar).toEqual([{ featureId: 'alpha', score: 0.5, sharedBasenames: ['a.ts'] }]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('相似链接的不变式：真仓里凡是报出来的，必须镜像对称', () => {
    // 只钉不变式（与"真仓有几对"无关）—— 数量是布局的函数，不变式才是契约
    const { features } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    for (const a of features) {
      for (const link of a.similar) {
        const b = features.find((f) => f.id === link.featureId);
        expect(b, `similar 指向了不存在的 feature：${link.featureId}`).toBeDefined();
        expect(b!.similar.some((x) => x.featureId === a.id), `a→b 存在但 b→a 不存在：${a.id}↔${link.featureId}`).toBe(true);
        expect(link.score).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it('tools 功能被抓出 derive 平行实现家族（重复实现屎山症状）', () => {
    const { features } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    const tools = features.find((f) => f.id === 'tools');
    expect(tools).toBeDefined();
    const derive = tools?.repeatedFamilies.find((r) => r.root === 'derive');
    // derive_* 系列（algorithm/chain/anim_flow/feature_tree/mind_map/reasoning/split）自成一线
    expect(derive?.files.length).toBeGreaterThanOrEqual(6);
  });

  it('file_map 给出文件级明细（file/feature_id/side/layer/dead_sources），是唯一真相源', () => {
    const { file_map, scannedFiles } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    expect(file_map.length).toBe(scannedFiles);
    expect(file_map.length).toBeGreaterThan(100);
    // 每一条都带侧别与分层，且与功能聚合自洽：file_map 与 features 的划分一致
    for (const e of file_map) {
      expect(typeof e.file).toBe('string');
      expect(['frontend', 'backend', 'shared']).toContain(e.side);
      expect(typeof e.layer).toBe('string');
      expect(Array.isArray(e.dead_sources)).toBe(true);
    }
    // renderer 下应有前端文件
    expect(file_map.some((e) => e.feature_id === 'renderer' && e.side === 'frontend')).toBe(true);
  });

  it('meta 携带 project_dir/source_root/langs（前端窗口据此定位与说明）', () => {
    const { meta } = buildFeatureMap({ project_dir: path.join(process.cwd()), source_root: SRC });
    expect(meta.features).toBeGreaterThan(0);
    expect(meta.source_root.endsWith('src')).toBe(true);
    expect(meta.langs).toContain('ts');
    expect(meta.langs.length).toBeGreaterThan(0);
  });
});