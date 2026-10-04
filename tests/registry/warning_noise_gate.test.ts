/**
 * 门 · 告警长文本**不得跨轮重复**（P-F，规划书 §16.6 / §16.8）
 *
 * 判据（§16.8 原话）：**结构化 warnings 可被程序判定**。
 * ⇒ 本门**就**用那条结构化通道来判：把若干轮响应里的 `---WARNINGS---` 机器块解出来，
 *   同一个 `code` 的 `detail`（长文本）**不得出现在多于一轮**里（那就是"每轮附整段长文本"的重复噪音）。
 *   ★ 全程**没有正则解析业务文本** —— 这正是"结构化"相对"字符串"的价值。
 *
 * ★ 本门的边界（诚实标注）：
 *   - 它验的是"**已投递**的告警不重复长文本"，**不验**探测是否及时发现陈旧（那是
 *     `detectStaleIndex` / `newestMtime` 的职责，另有测试）。
 *   - 它按"块的形状"判定：若机器块被删掉（结构化通道消失），`rounds` 里就没有块 ⇒ 门会**变绿**
 *     （抓不到）。这一条由**另一条结构断言**兜：`server_registry` 的注入点必须走 `emitWarnings`。
 *
 * ★ 自证方式（2026-10-04 改）：**直接断言**，不经任何 helper。
 *   「注入一个错 ⇒ 断言门红」这件事，在这个门里注入物是**内存里的轮次数组**，
 *   连写盘都没有 —— 用普通 `expect` 一行就说清，不需要"必定还原"那套文件兜底。
 */
import { DATA_DIR_NAME } from '../../src/infrastructure/data_dir.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';
import { WARNINGS_MARKER, warningBlock, emitWarnings, resetWarningDelivery, type WireWarning } from '../../src/presentation/mcp/tool_warnings.js';
import { staleIndexWarning, resetStaleIndexWarningCache } from '../../src/presentation/mcp/server_registry.js';
import { importProject } from '../../src/infrastructure/graph/import_project.js';
import { openDb, closeAllProjectCacheDbs } from '../../src/infrastructure/index/db';

/**
 * 门判定：跨轮扫描结构化告警，报"同一 code 的 detail 出现在多轮"。
 * 返回违规列表（空 = 绿）。
 */
export function detectRepeatedWarningDetail(rounds: readonly string[]): string[] {
  const seen = new Map<string, number>(); // code → 首次带 detail 的轮号
  const bad: string[] = [];
  rounds.forEach((text, i) => {
    const at = text.lastIndexOf(WARNINGS_MARKER);
    if (at < 0) return; // 该轮无告警块
    let ws: WireWarning[];
    try {
      ws = JSON.parse(text.slice(at + WARNINGS_MARKER.length).trim()) as WireWarning[];
    } catch (e) {
      bad.push(`第 ${i} 轮的 ${WARNINGS_MARKER} 块不是合法 JSON（${(e as Error).message}）`);
      return;
    }
    for (const w of ws) {
      if (!w.detail) continue;
      const prev = seen.get(w.code);
      if (prev === undefined) seen.set(w.code, i);
      else bad.push(`code=${w.code} 的长文本在第 ${prev} 轮与第 ${i} 轮**重复出现**（应是"首次全文/后续摘要"）`);
    }
  });
  return bad;
}

/** 一轮响应的形状 = 文本（含机器块在最末）—— 与 registerAllTools 的注入顺序一致 */
function roundWith(warnings: WireWarning[]): string {
  return `工具回执正文\n⚠️ 人类可读段\n${warningBlock(warnings)}`;
}

const roots: string[] = [];
let gateRoot: string | null = null;

afterAll(() => {
  closeAllProjectCacheDbs();
  for (const r of roots) {
    try {
      fs.rmSync(r, { recursive: true, force: true });
    } catch {
      /* 句柄未释放留给 OS */
    }
  }
  resetWarningDelivery();
  resetStaleIndexWarningCache();
});

function put(root: string, rel: string, content: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('门 · 告警长文本不得跨轮重复（结构化判定，无正则）', () => {
  it('检测器自身有效（防"空转绿"）：正常两轮 ⇒ 无违规；真重复 ⇒ 有违规', () => {
    const full: WireWarning = { code: 'X', summary: 'S', detail: 'D', fix: 'F' };
    const brief: WireWarning = { code: 'X', summary: 'S', detail: null, fix: null };
    expect(detectRepeatedWarningDetail([roundWith([full]), roundWith([brief])])).toEqual([]);
    expect(detectRepeatedWarningDetail([roundWith([full]), roundWith([full])]).length).toBe(1);
  });

  it('★ 真实链路：真 stale 项目连调两轮 ⇒ 不得重复带长文本', async () => {
    // 真实陈旧条件：建好索引 → 绕过写闸改文件（只比 size+mtime ⇒ 必须改大小）
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'warnnoise-'));
    roots.push(root);
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 1;\n}\n');
    const db = openDb(path.join(root, DATA_DIR_NAME, 'cache.db'));
    await importProject({ project_dir: root, feature: 'warnnoise', cache_db: db });
    db.close();
    put(root, 'src/a.ts', 'export function alpha(): number {\n  return 123456;\n}\n');
    gateRoot = root;
    resetStaleIndexWarningCache();
    resetWarningDelivery();

    // 两轮**真实**调用（走 registerAllTools 同一条路径：生产方 → emitWarnings）：
    // 第 1 轮应全文、第 2 轮应只剩摘要
    const rounds: string[] = [];
    for (let i = 0; i < 2; i++) {
      const e = emitWarnings([staleIndexWarning(gateRoot)]);
      rounds.push(roundWith(e.warnings));
    }
    // ★ 先证"下面那条断言不是空转"：确实产出了告警块。否则 rounds 全无块 ⇒ detect 必然返回 []
    //   ⇒ 断言恒真（这正是本仓踩过的"同义反复不是门"）。
    expect(rounds.some((t) => t.includes(WARNINGS_MARKER)), '两轮都没产出告警块 ⇒ 后面那条断言是空转的').toBe(true);
    const bad = detectRepeatedWarningDetail(rounds);
    expect(bad, `真实链路报出重复长文本：${JSON.stringify(bad)}`).toEqual([]);
  });

  it('★ 结构断言：注入点必须走 emitWarnings（防"结构化通道被绕过、退回字符串拼接"）', () => {
    const here = path.dirname(fileURLToPath(import.meta.url)); // tests/registry
    const src = fs.readFileSync(path.join(here, '..', '..', 'src', 'presentation', 'mcp', 'server_registry.ts'), 'utf8');
    expect(src, '注入点没调 emitWarnings ⇒ 分级与机器块都被绕过').toContain('emitWarnings([');
    expect(src, '机器块没进响应（emission.block 未使用）').toContain('emission.block');
    // 反面：三个 stale 生产方不得再返回字符串（用 `+ staleSourceWarning()` 这种拼接回归即红）
    expect(/staleSourceWarning\(\)\s*\+/.test(src), 'stale 告警又变回字符串拼接').toBe(false);
  });
});
