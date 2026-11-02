/**
 * 产物注册表（G0）：统一管理 <output> 下的生成产物
 *
 * 背景：此前每个 feature 各生成各的 HTML，散落在 output/ 且互无索引、无语义化。
 * 本模块提供一个 .registry.json 作为"产物目录"：
 *   - 生成产物时自动注册（get_dsl query=render 写文件后挂钩）
 *   - 人工可打标记/编辑（tags / note / title / status）
 *   - 供 Hub 首页动态渲染产物总览，也为后续跨产物导览（G1）铺路
 *
 * 存储：<dataHome>/output/.registry.json —— 产物是派生物，registory 同样可随时重建，
 * 因此不做保留式迁移（版本落后即整体重写，与 cache.db 策略一致）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataHome } from '../storage.js';

/** 单条产物记录 */
export interface ArtifactEntry {
  /** 相对 output/ 的 posix 路径，如 "self_analyze.html"（唯一键） */
  path: string;
  /** 所属 feature */
  feature?: string;
  /** 标题（生成时自动摘 DSL title，人工可改） */
  title?: string;
  /** 产物类型：feature_diagram / report / example / ... */
  type?: string;
  /** 主要语言：ts / go / py / js / ... */
  language?: string;
  /** 状态：done / in_progress / draft */
  status?: string;
  /** 人工打的标签 */
  tags?: string[];
  /** 人工备注 */
  note?: string;
  created_at?: string;
  updated_at?: string;
}

/** 注册表 JSON 文件路径：<dataHome>/output/.registry.json */
export function registryFilePath(): string {
  return path.join(getDataHome(), 'output', '.registry.json');
}

/** 从文件扩展名推断语言 */
export function inferLanguageFromPath(p: string): string | undefined {
  const map: Record<string, string> = {
    '.ts': 'ts', '.tsx': 'ts', '.js': 'js', '.jsx': 'js',
    '.go': 'go', '.py': 'py', '.vue': 'vue', '.html': 'html', '.css': 'css',
  };
  const ext = path.extname(p).toLowerCase();
  return map[ext];
}

/** 注册表文本的判定结果：**读得出**与**读不出**必须分得开（0.12） */
export type RegistryParse =
  | { ok: true; entries: ArtifactEntry[] }
  | { ok: false; reason: string; firstLine: string };

/**
 * 注册表文本 → 判定（纯函数、零 IO）。
 *
 * 不变量（改动别写回去）：**JSON 坏 / 根不是数组 / 元素形状不对 ⇒ `ok:false`**。
 * ★ 曾经这里是 `try { … } catch { return [] }` ⇒ 「读不出」与「一条都没注册」同形，
 *   而写端是「读全量 → upsert → 整份写回」⇒ 一次注册把其余条目**整份抹掉**且没有任何报错。
 * ★ 做成纯函数是为了让判据能直接喂输入（不必造出真实的坏文件）。
 */
export function parseRegistryText(raw: string): RegistryParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: `JSON 解析失败：${msg.replace(/\s+/g, ' ').trim()}`, firstLine: msg.split('\n')[0] };
  }
  if (!Array.isArray(parsed)) {
    const got = parsed === null ? 'null' : typeof parsed;
    return { ok: false, reason: `根必须是数组（实得 ${got}）`, firstLine: '' };
  }
  for (let i = 0; i < parsed.length; i++) {
    const el: unknown = parsed[i];
    if (el === null || typeof el !== 'object' || Array.isArray(el)) {
      const got = el === null ? 'null' : Array.isArray(el) ? 'array' : typeof el;
      return { ok: false, reason: `第 ${i + 1} 条不是对象（实得 ${got}）`, firstLine: '' };
    }
    const p = (el as { path?: unknown }).path;
    if (typeof p !== 'string' || !p.trim()) {
      const got = p === undefined ? 'undefined' : typeof p === 'string' ? '空串' : typeof p;
      return { ok: false, reason: `第 ${i + 1} 条缺非空字符串 path（实得 ${got}）`, firstLine: '' };
    }
  }
  return { ok: true, entries: parsed as ArtifactEntry[] };
}

/** 一行错误（压平折行 + 截断）：`JSON.parse` 的原文常带换行，报文里只需一行 */
function oneLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * 注册表**不可读**的唯一报文：点名文件 + 错因 + JSON 错误首行。
 * ★ 三档语义：**不存在** = 首次使用（合法 ⇒ 空数组）；**存在但读不出** = 抛（本函数）。
 */
function registryBrokenMessage(file: string, r: { reason: string; firstLine?: string }): string {
  return (
    '[registry] 产物注册表**不可读**（这是「读失败」，不是「一条都没注册」）：\n' +
    `  文件：${file}\n` +
    `  错因：${r.reason}\n` +
    (r.firstLine ? `  JSON 错误首行：${r.firstLine}\n` : '') +
    '★ 为什么抛而不当空：写端是「读全量 → upsert → 整份写回」⇒ 把读失败当空列表会**抹掉其余条目**。\n' +
    '★ 处置（任选一条，都不依赖 agent-io 自身）：① 从 git 取回该文件；② 手工修 JSON（最小合法形状是 []）；' +
    '③ **你自己**显式删掉它（= 放弃既有条目清单）。'
  );
}

/**
 * ★★ 读注册表的**唯一实现**（`file` 缺省 = `<dataHome>/output/.registry.json`）。
 *
 * 不变量：文件**不存在** ⇒ `[]`（首次使用，**不是**错误 —— 首次注册必须仍能成功）；
 * 文件**在但读不出** ⇒ **抛**（见 {@link registryBrokenMessage}），绝不当空数组。
 * ★ 原先 `readFileEntries(file)` 与本函数逐字同体（只差路径来源）⇒ 已收成这一处。
 */
export function readRegistry(file: string = registryFilePath()): ArtifactEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new Error(registryBrokenMessage(file, { reason: `读取失败：${oneLine(e)}` }));
  }
  const parsed = parseRegistryText(raw);
  if (!parsed.ok) throw new Error(registryBrokenMessage(file, parsed));
  return parsed.entries;
}

// ★ 本函数 2 处裸调（tmp 写 + rename）留在此处（**不搬**，2026-10-22 分类收口）：落点 = 传入的 file
//   （缺省的 `<dataHome>/output/.registry.json` ⇒ classifyWriteSubject = product ⇒ 不过闸）。
/** 写回注册表（原子：先写临时文件再 rename）；`file` 必填 —— 唯一写实现（原先 `writeFileEntries` 与它逐字同体） */
function writeRegistry(file: string, entries: ArtifactEntry[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

/** 注册/更新一条产物（按 path upsert；已存在则覆盖自动字段、保留人工字段） */
export function registerArtifact(entry: Partial<ArtifactEntry>): ArtifactEntry {
  return registerArtifactTo(registryFilePath(), entry);
}

/**
 * 向指定注册表文件注册/更新一条产物（供隔离目录脚本如 self_analyze 显式写入 cwd/output）。
 * ★ 注册表**不可读** ⇒ `readRegistry` 抛 ⇒ 本函数一个字节都不写（不许拿「空 + 新条目」整份覆盖）。
 */
export function registerArtifactTo(file: string, entry: Partial<ArtifactEntry>): ArtifactEntry {
  const entries = readRegistry(file);
  const now = new Date().toISOString();
  const idx = entries.findIndex((e) => e.path === entry.path);
  if (idx === -1) {
    const created: ArtifactEntry = {
      path: entry.path as string,
      ...entry,
      created_at: now,
      updated_at: now,
    };
    entries.push(created);
    writeRegistry(file, entries);
    return created;
  }
  // 已存在：覆盖自动来源字段，但保留人工字段（tags/note/title 若人工改过则保留）
  const prev = entries[idx];
  const merged: ArtifactEntry = {
    ...prev,
    ...entry,
    // 人工字段：新 entry 未显式提供时保留原值
    tags: entry.tags ?? prev.tags,
    note: entry.note ?? prev.note,
    title: entry.title ?? prev.title,
    status: entry.status ?? prev.status,
    updated_at: now,
  };
  entries[idx] = merged;
  writeRegistry(file, entries);
  return merged;
}

/**
 * 局部更新一条产物（人工打标记/编辑）；返回更新后的条目，不存在返回 null。
 * ★ 注册表**不可读** ⇒ `readRegistry` 抛（不静默当「没有这条」）。
 */
export function updateArtifact(relPath: string, patch: Partial<ArtifactEntry>): ArtifactEntry | null {
  const entries = readRegistry();
  const idx = entries.findIndex((e) => e.path === relPath);
  if (idx === -1) return null;
  const now = new Date().toISOString();
  entries[idx] = { ...entries[idx], ...patch, updated_at: now };
  writeRegistry(registryFilePath(), entries);
  return entries[idx];
}
