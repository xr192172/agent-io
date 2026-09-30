/**
 * P10 解析能力自述 测试
 *
 * 分层依据（与 kernel 实现对齐）：LANG_ADAPTERS 有 callNode ⇒ 调用级（call）；
 * 注册表有 symbol_nodes 但无适配 ⇒ 仅符号级（symbol）；解析器未装/不在注册表 ⇒ 不解析（none）。
 * 本机装了 ts/js/go/python/java/c/c#/rust/php（全为 call 级）；symbol 级用**纯函数**
 * tierForLanguage 判定（不依赖环境装没装某个解析器）。
 *
 * 覆盖：
 *   - .ts ⇒ call 级；.xyz ⇒ none（不在支持列表）；.css ⇒ none（注册表有但解析器不可用）
 *   - symbol 级判定（纯函数）：swift 装了解析器 ⇒ symbol（有符号无适配）；未装 ⇒ none
 *     （2026-09-29：cpp/kotlin/ruby 已接 LANG_ADAPTERS ⇒ 由 symbol 升为 call，本用例换 swift）
 *   - renderGranularityNote：全 call ⇒ 空串（健康不刷屏）；有非 call ⇒ 诚实标注 + 工具口味
 *   - impact_analysis 集成：.css 变更点 ⇒ 响应带"解析粒度"（闭包结论会低估）；.ts ⇒ 不带
 *   - index_integrity 自带语言能力自述一节
 */
import { DATA_DIR_NAME } from '../../src/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import {
  parseCapabilityForFile,
  renderGranularityNote,
  summarizeLanguagesByTier,
  tierForLanguage,
} from '../../src/tools/parse_capability';
import { findLanguageByExt } from '../../src/infrastructure/parse/languages.js';
import { registerAllTools } from '../../src/presentation/mcp/server_registry.js';
import { importProject } from '../../src/infrastructure/graph/import_project.js';
import { openDb, closeAllProjectCacheDbs } from '../../src/infrastructure/index/db';
import { stopBackfill } from '../../src/tools/index_backfill';

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

describe('parse_capability · 分层判定', () => {
  it('.ts ⇒ call 级（本机已装且为深适配语言）', () => {
    const cap = parseCapabilityForFile('src/a.ts');
    expect(cap.tier).toBe('call');
    expect(cap.lang).toBe('typescript');
    expect(cap.granularity).toContain('调用');
    expect(cap.zeroTrustworthy).toBe(true);
  });

  it('.xyz ⇒ none（不在支持列表）', () => {
    const cap = parseCapabilityForFile('src/data.xyz');
    expect(cap.tier).toBe('none');
    expect(cap.lang).toBeNull();
    expect(cap.granularity).toContain('不在支持列表');
  });

  it('.css ⇒ none（注册表有该语言但解析器不可用）', () => {
    const cap = parseCapabilityForFile('src/style.css');
    // ★ 注册表里**有**这条语言（故不是"不在支持列表"），但 tree-sitter-css 是老 nan.h 模板、
    //   载入必失败 ⇒ probe 的真筛子判不可用（包在盘上也没用）。断言本身不变。
    expect(findLanguageByExt('.css')).toBeDefined(); // 注册表里有
    expect(cap.tier).toBe('none');
    expect(cap.granularity).toContain('解析器未安装');
  });

  it('symbol 级判定（纯函数，不依赖环境）：swift 有注册表无适配 ⇒ 装了解析器就是 symbol；未装 ⇒ none', () => {
    const swift = findLanguageByExt('.swift');
    expect(swift).toBeDefined();
    expect(tierForLanguage(swift, true)).toBe('symbol');
    expect(tierForLanguage(swift, false)).toBe('none');
    expect(tierForLanguage(undefined, true)).toBe('none');
    // 2026-09-29：cpp 已接 LANG_ADAPTERS（call_expression）⇒ 反例换位，另断 cpp 升为 call 级
    expect(tierForLanguage(findLanguageByExt('.cpp'), true)).toBe('call');
  });
});

describe('parse_capability · 粒度标注', () => {
  it('全是 call 级 ⇒ 空串（健康不刷屏）', () => {
    expect(renderGranularityNote(['src/a.ts', 'src/b.ts'], 'refs')).toBe('');
    expect(renderGranularityNote([], 'impact')).toBe('');
    expect(renderGranularityNote([undefined], 'impact')).toBe('');
  });

  it('有非 call 级 ⇒ 诚实标注；refs 口味说"文本级"，impact 口味说"零波及不可信"；同语言去重', () => {
    const refs = renderGranularityNote(['src/style.css'], 'refs');
    expect(refs).toContain('解析粒度');
    expect(refs).toContain('文本级');
    const impact = renderGranularityNote(['src/style.css', 'docs/x.css'], 'impact');
    expect(impact).toContain('零波及');
    expect(impact.match(/解析粒度/g)?.length).toBe(1); // 同语言去重
  });

  it('summarizeLanguagesByTier：按语言分组、文件数降序', () => {
    const s = summarizeLanguagesByTier(['src/a.ts', 'src/b.ts', 'README.md']);
    expect(s[0]).toMatchObject({ lang: 'typescript', tier: 'call', files: 2 });
    const md = s.find((x) => x.lang === 'markdown');
    expect(md?.tier).toBe('none');
  });
});

describe('parse_capability · 注册表集成', () => {
  it('impact_analysis：.css 变更点 ⇒ 响应带"解析粒度"预警；.ts 变更点 ⇒ 不带', async () => {
    const tools = makeRegistry();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gran-'));
    roots.push(root);
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'gran', cache_db: db });
    db.close();

    const bad = await tools.get('impact_analysis')!({ project_dir: root, change_points: [{ file: 'src/style.css' }] });
    expect(bad.isError).toBeFalsy();
    expect(bad.content[0].text).toContain('解析粒度');
    expect(bad.content[0].text).toContain('不可信');

    const good = await tools.get('impact_analysis')!({ project_dir: root, change_points: [{ file: 'src/a.ts' }] });
    expect(good.isError).toBeFalsy();
    expect(good.content[0].text).not.toContain('解析粒度');
  });

  it('index_integrity 报告自带"语言能力自述"一节', async () => {
    const tools = makeRegistry();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gran-integ-'));
    roots.push(root);
    put(root, 'src/a.ts', 'export const a = 1;\n');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'gran_integ', cache_db: db });
    db.close();
    const r = await tools.get('index_integrity')!({ project_dir: root, refresh: false });
    expect(r.content[0].text).toContain('语言能力自述');
    expect(r.content[0].text).toContain('typescript=调用级');
  });
});
