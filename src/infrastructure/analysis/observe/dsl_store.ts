/**
 * dsl_store —— 设计 DSL 的**版本化持久化仓库**（2026-10-05，P4 步骤 3）
 *
 * 搬迁自 `go-observe/probe/dsl_store.go`（236 行）。**跨语言逐字兼容是硬要求**：
 * Go 侧 `llm_judge.go:91 LLMJudge.LoadDSL` 至今仍在读同一份 `dsl.json`（`probe` 是插桩后
 * 编译进被测 Go 进程内的采集 runtime，它在运行时读声明）⇒ 本文件产出的**目录、文件名、
 * JSON 字段名、时间格式**必须与 Go 侧完全一致，否则 Go 插桩过的工程会读不到声明。
 * 这也是 P4 唯一真正的跨语言必需项（其余都能靠删 Go 代码收拢）。
 *
 * 目录（照搬 Go `:57-60`）：
 *   {dir}/dsl.json            当前生效版本（权威）
 *   {dir}/dsl.history.jsonl   快照式审计历史（append-only，逐行 JSON）
 *
 * 工程化目标（照搬 Go 头注 `:5-15`）：
 *   · 版本化 + **快照式**审计历史（不是 diff 式 —— 避免重建代价，任何版本都能回滚）
 *   · **原子写**：临时文件 + rename，崩溃不产生半写文件
 *   · **提案权与写盘权分离**：本 store 只负责"定稿写入/回滚"；修订提案要过验证门才落盘
 *
 * ★ 与 Go 的三处**有意分歧**（均已核实，不是不一致而是修正）：
 *
 * ① **原子写的 unlink 重试是防御性兜底，不是 bug 修复** —— Go `dsl_store.go:213` 直接
 *    `os.Rename(tmp, dst)`。我曾断言"Windows 的 rename 不覆盖"并据此加 unlink，**该断言被实测推翻**
 *    （见下方 `writeAtomic` 的注释）⇒ 与 Go 的实现差异只是多一层兜底，行为等价。
 *
 * ② **`Load` 抛错而非返回 null**（`load()` 返回 `T | null`，`loadOrThrow()` 抛）——
 *    Go 返回 `os.ErrNotExist` 由调用方决定是否 seed；TS 侧保留同样自由度：
 *    `loadOrThrow` 用于"必须存在"的路径（对照 `TSComparator.loadDesign` 返回 null 的旧形状）。
 *
 * ③ **`updated_at` / `at` 用 ISO 字符串**（Go 是 `time.Time`，其 JSON 形态是 RFC3339 带纳秒）。
 *    `Date.prototype.toISOString()` 同为 UTC RFC3339 ⇒ **格式兼容**；
 *    差别只在纳秒精度（JS 毫秒），对"审计时间"这个用途无影响。
 */

import fs from 'node:fs';
import path from 'node:path';
import { GO_OBSERVE_DIR_NAME } from '../../data_dir.js';
import type { TSDLDecl, TSDesignDSLDoc } from './contract.js';

export type { TSDLDecl, TSDesignDSLDoc };

/** 权威 DSL 文档（字段名与 Go `DesignDSLDoc` 逐字一致，跨语言兼容硬要求）。 */
export interface DSLDoc extends TSDesignDSLDoc {}

/** 一次定稿/回滚的审计记录。**快照式**：`decls` 存完整快照，可任意回滚。 */
export interface HistoryEntry {
  version: number;
  at: string;
  /** 变更原因（人类可读） */
  reason: string;
  /** 来源：seed / manual / llm-revise / loop / rollback */
  source: string;
  /** 本版本的完整 DSL 快照 */
  decls: TSDLDecl[];
  /**
   * `seed | save | approve | rollback`。
   * ★ 实测发现（2026-10-05）：**`rollback` 永远不会出现**。Go `dsl_store.go:171` 的 `Rollback` 调的是
   *   `Save(decls, reason, "rollback")` —— 那个 `"rollback"` 落在 **source** 形参上，而 `Save`
   *   (Go `:114`) 恒以 `SaveMeta{Action:"save"}` 调用 ⇒ 回滚落盘实为 `action=save, source=rollback`。
   *   本实现**照搬了这个行为**（未"顺手修正"）：Go 侧 `HistoryEntry.Action` 的注释声明四态，
   *   但 `rollback` 无任何写入路径 —— 声明与实际不符，与本仓"声明式的东西不落地"是同一类。
   *   **留在案上，不在本笔改**（改它要动 Go 侧同名字段，且会让 TS/Go 审计口径一起变）。
   */
  action?: 'seed' | 'save' | 'approve' | 'rollback';
  /** 变更前版本（0 = 初始）。`omitempty` ⇒ 0 时不写字段。 */
  from_version?: number;
  /** 验证门证据摘要（如 `rule-regression: 2/2 可判定`） */
  verification?: string;
}

export interface SaveMeta {
  action?: HistoryEntry['action'];
  verification?: string;
}

/** 种子声明（照搬 Go `llm_judge.go:111-120`）。★ `status:'locked'` 是刻意值，见下。 */
export function silentErrorDiscardDSL(): TSDLDecl {
  return {
    rule: 'design:silent-error-discard',
    probe: '',
    expect: '在本来会静默丢弃错误的位置，捕获到的 err 必须为 nil 或可证明是良性的（benign）',
    constraint:
      'op=writefile/save/mkdirall 时任何错误都不可良性（父目录缺失的 ENOENT 也算非良性，因为数据未持久化）；op=remove/cleanup 仅 os.IsNotExist 良性',
    origin: 'seed',
    // ★ locked：种子声明是 v1 内建、被视为**定稿锁定**，不许走提案修订。
    //   这与 P4 步骤 5 的 `ApproveGated` 有关 —— 它对 locked 声明不应重复审批。
    status: 'locked',
  };
}

// ─────────────────────────────────────────────────────────────
// 原子写
// ─────────────────────────────────────────────────────────────

/**
 * 原子写：临时文件 + rename（照搬 Go `dsl_store.go:201-214` 的纪律）。
 *
 * ★ **一条被实测推翻的声称，留此记录以免再犯**（2026-10-05）：
 *   我最初在这里写"Windows 的 `os.Rename` 不会覆盖已存在文件，故需先 unlink"。
 *   **实测不成立**：本机上 Node 的 `fs.renameSync` 与 Go 的 `os.Rename` **都能成功覆盖**
 *   （把 A 改名到已存在的 B 上，B 的内容变成 A，err = nil）。
 *   ⇒ 下面的 unlink 重试**不是**对已确认 bug 的修复，而是**防御性兜底**：
 *     真遇到 rename 失败（文件被占用、跨卷等）时，至少不会把 tmp 留在盘上。
 *   ⇒ 判据纪律：本条与 `data_dir.ts:20``storage.ts:86``derive_anim_flow.ts:500` 同类 ——
 *     那几处把判据写在了出事的地方，而本处**曾把未验证的判据写成了事实**。改前先测。
 */
function writeAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    // 目标已存在（Windows rename 不覆盖）⇒ 删掉再试一次
    try {
      fs.rmSync(file, { force: true });
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}

/** 追加一行 JSON（append-only 审计）。 */
function appendLine(file: string, obj: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, 'utf8');
}

/** 读 JSONL；坏行**跳过**（照搬 Go `proposal.go` 的 List 语义：单个坏文件不该让整份列表读不出来）。 */
function readJsonl<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s) as T);
    } catch {
      // 坏行跳过（append-only 文件可能被一次崩溃截断出半行）
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// store
// ─────────────────────────────────────────────────────────────

/** 设计 DSL 仓库。`dir` 缺省取 **Go 侧同一目录**（`.agent/observe`）—— 跨语言兼容硬要求。 */
export class DesignDSLStore {
  private readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? defaultDSLDir();
  }

  dslPath(): string {
    return path.join(this.dir, 'dsl.json');
  }

  histPath(): string {
    return path.join(this.dir, 'dsl.history.jsonl');
  }

  /** 读当前 DSL。文件不存在返回 null（调用方决定是否 seed）。 */
  load(): DSLDoc | null {
    const p = this.dslPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    try {
      return JSON.parse(raw) as DSLDoc;
    } catch (e) {
      throw new Error(`design-dsl: 解析 ${p} 失败：${(e as Error).message}`);
    }
  }

  /** 读当前 DSL；不存在即抛（"必须存在"路径用）。 */
  loadOrThrow(): DSLDoc {
    const d = this.load();
    if (!d) throw new Error(`design-dsl: ${this.dslPath()} 不存在（先跑 seedDefault）`);
    return d;
  }

  /**
   * `dsl.json` 不存在时写入 v1 种子；已存在则**幂等跳过**。
   * @returns 是否真的播种了（false = 已有文件，未改动）
   */
  seedDefault(): boolean {
    if (fs.existsSync(this.dslPath())) return false;
    const doc: DSLDoc = { version: 1, updated_at: new Date().toISOString(), decls: [silentErrorDiscardDSL()] };
    this.writeDoc(doc);
    this.appendHistory({
      version: doc.version,
      at: doc.updated_at,
      reason: 'initial seed: silent-error-discard 契约',
      source: 'seed',
      action: 'seed',
      decls: doc.decls,
    });
    return true;
  }

  /** 定稿写入新版本（version +1），完整快照追加历史。返回新版本号。 */
  save(decls: TSDLDecl[] | null, reason: string, source: string, meta: SaveMeta = {}): number {
    const cur = this.load();
    let next = (cur?.version ?? 0) + 1;
    if (next < 1) next = 1;
    // decls 为 null ⇒ 沿用当前声明的裸拷贝（纯 reason/source 更新场景）
    const eff = decls ?? (cur?.decls ?? []).map((d) => ({ ...d }));
    if (eff.length === 0) throw new Error('save: 声明集为空，至少需要 1 条声明');
    const doc: DSLDoc = { version: next, updated_at: new Date().toISOString(), decls: eff };
    this.appendHistory({
      version: doc.version,
      at: doc.updated_at,
      reason,
      source,
      action: meta.action ?? 'save',
      // ★ Go 用 `omitempty`，0 不落字段 ⇒ 这里只在 >0 时给 undefined
      from_version: cur?.version && cur.version > 0 ? cur.version : undefined,
      verification: meta.verification,
      decls: doc.decls,
    });
    this.writeDoc(doc);
    return next;
  }

  /**
   * 回滚到指定历史版本。**回滚本身也是一次新版本写入**（version 单调递增）⇒ 审计链不被破坏。
   * 目标版本不在历史里即抛，错误里带**可用版本列表**（照搬 Go `:174-175` 的可用性提示）。
   */
  rollback(targetVersion: number): number {
    const hist = this.history();
    const hit = hist.find((h) => h.version === targetVersion);
    if (!hit) {
      const avail = hist.map((h) => String(h.version)).join(', ');
      throw new Error(`design-dsl: 历史里没有版本 ${targetVersion}（可用：${avail || '(空)'}）`);
    }
    return this.save(hit.decls, `rollback to v${targetVersion}`, 'rollback');
  }

  /** 全部审计历史，按版本号升序（Go `:240+` 末尾 `sort.Slice`）。 */
  history(): HistoryEntry[] {
    const raw = readJsonl<HistoryEntry>(this.histPath());
    return raw.sort((a, b) => a.version - b.version);
  }

  private writeDoc(doc: DSLDoc): void {
    // Go 用 MarshalIndent(doc, "", "  ") ⇒ 两空格缩进，保持一致以便 diff 对照
    writeAtomic(this.dslPath(), `${JSON.stringify(doc, null, 2)}\n`);
  }

  private appendHistory(h: HistoryEntry): void {
    appendLine(this.histPath(), h);
  }
}

/**
 * DSL 仓库目录 = `<projectRoot>/.agent/observe`。
 * ★ 必须与 Go `cmd/observe-dsl/main.go:30,34` 逐字一致 —— 那是插桩后被测进程读声明的地方。
 *   `daemon.ts:218` 也用 `GO_OBSERVE_DIR_NAME` 拼同一路径 ⇒ 三处同源，不新造字面量。
 */
export function defaultDSLDir(projectRoot = process.cwd()): string {
  return path.join(projectRoot, GO_OBSERVE_DIR_NAME, 'observe');
}
