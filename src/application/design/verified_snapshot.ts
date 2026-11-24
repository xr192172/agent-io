/**
 * **VerifiedSnapshot —— "上次已验证状态"作为增量验证的基线**。
 *
 * ## 它解决什么
 * 增量入口（`scripts/verify-changed.mjs`）原本只能按「改动集 → `touches:` / 契约 path」**选**要跑什么。
 * 它回答不了另一半：**没选中的那些，凭什么说它们仍然成立？**
 * 本模块把"上次真实验证过的状态"落成一份可复核的快照，让"继承"变成一个**有证据、可失效**的动作。
 *
 * ## 快照四件（缺一件即 `corrupt`，不许当可用）
 * ① `content`：项目内容版本 + 每个文件的 sha256；
 * ② `graph`：事实图 / 影响关系版本（`.agent-io/cache.db` 的 sha256 + 大小）——
 *    ★ 影响闭包由它派生，它一变，"谁受谁影响"就不再有依据；
 * ③ `entries`：每项测试/契约的**实际 verdict + 命令 + 证据时点**；
 * ④ `scope`：本次真实验证范围（跑 / 继承 / 未判定）与各自原因。
 *
 * ## 继承的硬规则（每条都对应一个"假绿"来源）
 * · **未变 + 证据仍有效** 才可继承 ⇒ 否则 `rerun`；
 * · **新增 / 上次失败 / 上次不可判** 一律不得继承为 pass（`rerun` 或 `undetermined`）；
 * · **影响关系不可信**（cache.db 缺失/版本变/快照损坏）⇒ **显式扩大范围**，不默认安全；
 * · **公共底座 / 验证规则 / 共享配置** 变了一样算"影响全仓"⇒ 扩大范围。
 *
 * ## 它**不是**第二套验证框架
 * 本模块不跑任何测试、不判任何判据、不选任何用例。它只做三件事：
 * 读基线 · 算"哪些能继承/哪些必须重跑"（纯函数）· 写回本次的真实结果。
 * "跑"仍然只有一条腿：`scripts/verify-changed.mjs`（内环）与 `scripts/verify.mjs`（全量门）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { intersectsImpact, type ImpactSet } from '../../infrastructure/analysis/facts/impact_set.js';
import { getProjectCacheDb } from '../../infrastructure/index/db.js';

/**
 * ★★ 2026-11-09（基线未判定收口）：从**真实事实**推导一个测试对象的观察面。
 *
 * 为什么需要：`observes` 原先只来自测试文件里的 `touches:` 声明；没写声明的测试
 * ⇒ `observes=[]` ⇒ 每次都被判 `undetermined`（**不是通过，也不是失败**），分母越滚越大。
 * 能补的只有**事实**（它 import 了谁、调了哪个文件的符号）；补不了的（纯 IO / 纯类型测试）
 * 继续 undetermined —— 推导不出 ≠ 通过。
 *
 * @returns 去重后的仓库相对路径合集；空数组 = **推导不出**（调用方必须保持 undetermined）
 */
export function derivedObservesOf(root: string, testFile: string): string[] {
  const rel = testFile.replace(/\\/g, '/');
  const out = new Set<string>();
  try {
    const db = getProjectCacheDb(root);
    // ★★ 第⑬项 Java ②（实测）：**Java 同包引用没有 import 语句**（Java 语义：同包免 import）
    //   ⇒ 索引器的 import 边无从建立 ⇒ 只查 'import' 会得到空观察面。
    //   Java 的跨文件引用实际载体 = **call / type_ref 边**（Java ① 的索引已建）⇒ .java 文件
    //   补查这两类；node 系保持原口径（import + call，不动——type_ref 对 TS 是类型直连，
    //   加入会扩观察面 = 行为变更，不在本步）。
    const isJava = rel.endsWith('.java');
    const importKinds = isJava ? "('import','call','type_ref')" : "('import')";
    const callKinds = isJava ? "('call','type_ref')" : "('call')";
    const imports = db
      .prepare(
        `SELECT DISTINCT t.file_path AS f FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
          WHERE e.kind IN ${importKinds} AND s.file_path = ? AND t.file_path <> ?`,
      )
      .all(rel, rel) as Array<{ f?: string }>;
    for (const r of imports) if (r.f) out.add(String(r.f).replace(/\\/g, '/'));
    const calls = db
      .prepare(
        `SELECT DISTINCT t.file_path AS f FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
          WHERE e.kind IN ${callKinds} AND s.file_path = ? AND t.file_path <> ?`,
      )
      .all(rel, rel) as Array<{ f?: string }>;
    for (const r of calls) if (r.f) out.add(String(r.f).replace(/\\/g, '/'));
    // ★ G-2 mapper_statement 反向观察面：Java 测试经 call/type_ref 到达的接口方法节点，
    //   沿 mapper_statement（target=方法 ⇒ source=XML 语句文件）反向收集对应 mapper XML，
    //   使"改 mapper XML"落在该测试的观察面内（与 diff_impact 正向 XML→方法→调用方互补）。
    if (isJava) {
      const methodIds = db
        .prepare(
          `SELECT DISTINCT t.id AS mid FROM edges e JOIN nodes s ON s.id = e.source JOIN nodes t ON t.id = e.target
            WHERE e.kind IN ('call','type_ref') AND s.file_path = ?`,
        )
        .all(rel) as Array<{ mid: string }>;
      if (methodIds.length > 0) {
        const ph = methodIds.map(() => '?').join(',');
        const xmlRows = db
          .prepare(
            `SELECT DISTINCT x.file_path AS f FROM edges e JOIN nodes x ON x.id = e.source
              WHERE e.kind = 'mapper_statement' AND e.target IN (${ph})`,
          )
          .all(...methodIds.map((m) => m.mid)) as Array<{ f?: string }>;
        for (const r of xmlRows) if (r.f) out.add(String(r.f).replace(/\\/g, '/'));
      }
    }
  } catch {
    return [];
  }
  return [...out];
}

export const SNAPSHOT_SCHEMA = 1 as const;
export const SNAPSHOT_REL = '.agent-io/verified-snapshot.json';

/** 一条验证证据（测试文件 或 契约节点） */
export type SnapshotEntry = {
  /** 稳定标识：`test:tests/x.test.ts` / `contract:<node_id>` */
  id: string;
  kind: 'test' | 'contract';
  /** 上次的**实际** verdict（`unsupported`/`pending` 也照存 —— 不许被当成 pass 继承） */
  verdict: 'pass' | 'fail' | 'unsupported' | 'pending';
  /** 当时跑的**真实命令**（可复核） */
  command: string;
  /** 证据时点（ISO） */
  at: string;
  /** 该证据观察到哪些文件（仓库相对路径；用于比对改动集） */
  observes: string[];
  /** 该证据观察到哪些符号（`qualified_name`；缺省 = 只按文件看） */
  symbols?: string[];
  /**
   * **语义摘要**（`semanticDigest()` 算出来的）：文件内容 + 符号签名 + 观察到的关系。
   * ★ `null`/缺省 = **算不出来** ⇒ 继承时判 `undetermined`（不许当"没变"）。
   * ★★ 它**不含** `cache.db` 的字节、也不含行 id / `updated_at`：索引重算不改源码 ⇒ 摘要不变。
   */
  digest?: string | null;
};

export type SnapshotScope = {
  ran: string[];
  inherited: string[];
  undetermined: { id: string; reason: string }[];
  /**
   * ★ 本次是否**全仓**验证过。`true` = 只验了受影响子集（内环），
   * **不得**被读成"全仓已验证"——局部验证不许冒充全仓。
   */
  partial?: boolean;
  /** 本次实际覆盖到的文件（= 证据观察面的并集），用来画"这次到底盖到哪儿" */
  covered_files?: string[];
  /**
   * ★★ 第⑨项（2026-11-10）：**本份快照里有哪些种类的证据**（缺省 = 不分种类，读端按条目 kind 自判）。
   * 为什么单列：judge-all 写的快照 `partial:false` 是**判据面全量**——它**没有**测试证据；
   * 没有这个字段的话，`partial:false` 会被读成"测试也全过"（错误推断）。
   * 值域 = `SnapshotEntry.kind` 的子集（如 `['contract']` / `['test','contract']`）。
   */
  evidence_kinds?: Array<'test' | 'contract'>;
};

export type VerifiedSnapshot = {
  schema: typeof SNAPSHOT_SCHEMA;
  at: string;
  /** ① 项目内容版本（= 所有纳入文件的哈希指纹） */
  content: { version: string; files: Record<string, string> };
  /** ② 事实图 / 影响关系版本 */
  graph: { version: string; bytes: number; available: boolean };
  /** ③ 每项证据 */
  entries: SnapshotEntry[];
  /** ④ 本次范围 */
  scope: SnapshotScope;
};

export type SnapshotLoad =
  | { status: 'ok'; snapshot: VerifiedSnapshot }
  /** ★ DS-1R：`code` 区分"真的没有"（ENOENT）与"读不到"（EACCES/EISDIR/…）。缺省不填 = 旧行为。 */
  | { status: 'missing'; reason: string; code?: string; unreadable?: boolean }
  | { status: 'corrupt'; reason: string };

/**
 * **内容漂移**：基线里记的逐文件指纹 vs 现在现算的，差在哪。
 *
 * ★ 它存在的唯一理由：**改动集本身可能不可信**（git 读不到 / 只声明了一部分）。
 *   若"声明的改动集"与"真实内容漂移"不一致 ⇒ 空交集**不能**解释为安全。
 *
 * · 只比**代码文件**（`.agent-io/**` 是生成物/册，归 WIDEN 管，不参与这里）；
 * · 新增/删除都算漂移（新增文件可能带来新的依赖关系）。
 */
export function contentDrift(
  baselineFiles: Record<string, string>,
  currentFiles: Record<string, string>,
): { changed: string[]; added: string[]; removed: string[] } {
  const isCode = (f: string): boolean => !f.startsWith('.agent-io/') && /\.(ts|tsx|js|mjs|cjs|jsx|go|py|java|rs|rb|php|cs|kt|swift|c|cc|cpp|h|hpp)$/.test(f);
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [f, h] of Object.entries(currentFiles)) {
    if (!isCode(f)) continue;
    if (!(f in baselineFiles)) added.push(f);
    else if (baselineFiles[f] !== h) changed.push(f);
  }
  for (const f of Object.keys(baselineFiles)) {
    if (!isCode(f)) continue;
    if (!(f in currentFiles)) removed.push(f);
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort() };
}

/** 哪些文件一变就必须**扩大范围**（公共底座 / 验证规则 / 共享配置） */
export const WIDEN_PATTERNS: RegExp[] = [
  /^scripts\/verify\.mjs$/,
  /^scripts\/verify-changed\.mjs$/,
  /^scripts\/run-tests\.mjs$/,
  /^scripts\/judge-all\.mjs$/,
  /^scripts\/mutate\.mjs$/,
  /^scripts\/lib\//,
  /^src\/application\/design\/verified_snapshot\.ts$/,
  /^src\/application\/design\/intent\/expectations\.ts$/,
  // ★ 2026-11-23 第二企划：两个验证器文件此前漏在名单外（改它们不触发扩大）⇒ 补入。
  /^src\/application\/verify\/verify_project\.ts$/,
  /^src\/application\/design\/verifier_proof_pack\.ts$/,
  /^src\/domain\/expectation\.ts$/,
  /^src\/domain\/expectation_kinds\.ts$/,
  // ★ 2026-11-24 G6 / M7（C A7）：选材器与护栏文件此前既不在自证包也不在本名单
  //   ⇒ 改它们走增量漏网（包可能绿而选材/护栏语义已变）。保守方向登记进白名单：
  //   改这些 ⇒ no-evidence/空观察面态强制扩大；对账视图见 verifier_proof_pack#reconcileSelectorGuardrail。
  /^scripts\/incsel-select\.mjs$/,
  /^scripts\/incsel-record\.mjs$/,
  /^src\/infrastructure\/analysis\/facts\/test_coverage\.ts$/,
  /^src\/infrastructure\/analysis\/facts\/impact_set\.ts$/,
  /^scripts\/design-check\.mjs$/,
  // ★ 2026-11-09 移除：`.agent-io/design/*.dsl.json`（原第 11 条）。
  //   规则依据：`WIDEN_PATTERNS` 的定义是"一变就让**已经录下的测试证据**失效"。
  //   册是**判据与设计的住处**：改册只影响**契约证据**，而契约证据本来每次都由
  //   `judge-all` / `design_line action=judge` 现判（它不在快照里、也不在这里复用）。
  //   ⇒ 把册放进本表 = 任何一次"加一条判据 / 改一句 summary"都触发全跑，
  //     等于把日常内环永久关掉（实测：一晚为确认一道册判据连拉 5 次全量，每次 ≈ 13 分钟）。
  //   ★ 反例仍然在：真改了**验证规则**（expectations.ts / expectation*.ts / scripts/lib 等）⇒ 仍全跑。
  /^package\.json$/,
  /^tsconfig(\.\w+)?\.json$/,
];

const sha256 = (buf: Buffer | string): string => crypto.createHash('sha256').update(buf).digest('hex');
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** ① 内容版本：`{rel: sha}` → 一个稳定指纹（排序后拼） */
export function contentVersion(files: Record<string, string>): string {
  const keys = Object.keys(files).sort();
  return sha256(keys.map((k) => `${k}:${files[k]}`).join('\n'));
}

/**
 * ① 项目文件哈希：**只收会改变语义的源码/脚本/设计册/配置**（不含 `dist`、`.git`、`node_modules`、`.agent-io` 的缓存）。
 * ★ 为什么给整份指纹而不是只记改动集：基线要能回答"**这次和上次相比到底变了什么**"，
 *   只记改动集就退化成"上次改过的那几个文件"，隔天换人根本对不上。
 */
/**
 * **测试对象**的形态判据（★ 不认目录名，只认文件名形态）。
 *
 * 为什么不用 `tests/` 前缀：口径一旦钉在目录名上，测试放在 `spec/` 或 `__tests__/` 时
 * `objects_indexed` 会数成 0 ⇒ 把"有证据"误判成"测试未纳入事实"。
 */
// ★ 只认**文件名形态**（`*.test.*` / `*.spec.*`）+ Jest 的 `__tests__/` 目录；
//   不认 `tests/` 这种目录名 —— 那会用"目录里的一切"冒充测试对象（实测把 fixtures 也算进来了）。
// ★★ 第⑬项 Java ②（2026-11-11）：**Java 测试形态**进同一扫描——Maven surefire 约定
//   （`src/test/java/**` 下 `*Test.java` / `*Tests.java` / `*TestCase.java`）。
//   ★ 与 runner 枚举**同源**：detectRunner 的 maven/gradle 支按同一约定把测试文件映射成类名
//   （javaTestClassOf）⇒ 形态扫到但 runner 不跑的 extra 语义保持如实。
export const TEST_OBJECT_RE = /(^|\/)[^/]+\.(test|spec)\.(ts|tsx|mts|js|mjs|cjs|jsx)$|(^|\/)__tests__\//;
export const JAVA_TEST_OBJECT_RE = /(^|\/)src\/test\/java\/.+\/(\w+(Test|Tests|TestCase))\.java$/;

/**
 * 扫出项目里的**测试对象**（仓库相对路径，正斜杠）。
 * 跳过 `node_modules` / `dist` / `.git` / 点目录（生成物与依赖不算"应验证对象"）。
 */
/** 一次读取被跳过的对象（DS-1R：读端必须能报告部分失败，**不许静默消失**） */
export interface ScanSkip {
  path: string;
  why: string;
}

export function scanTestObjects(root: string, skipped?: ScanSkip[]): string[] {
  const out: string[] = [];
  const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
  const walk = (rel: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch (e) {
      // ★ 只报**真失败**（ENOENT = 这个目录本来就不存在）
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        skipped?.push({ path: rel || '.', why: `readdir 失败：${(e as Error).message}` });
      }
      return;
    }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
        walk(r);
        continue;
      }
      if (/\.(ts|tsx|mts|js|mjs|cjs|jsx)$/.test(e.name) && TEST_OBJECT_RE.test(r)) out.push(r);
      // Java 测试（surefire 约定）：`src/test/java/**/*Test.java` 等
      else if (/\.java$/.test(e.name) && JAVA_TEST_OBJECT_RE.test(r)) out.push(r);
    }
  };
  walk('');
  return out.sort();
}

/**
 * 把"应验证对象"的三方对起来：**运行器枚举** · **形态扫描** · **索引可见**。
 *
 * · `objects_on_disk` = **运行器自己会跑的**那些（给了 `opts.onDisk` 就用它）；
 * · `objects_indexed` = 其中在索引里存在的数量（★ 与 on_disk **同一份基准**，不各算一套）；
 * · `missing`  = 基准里索引看不到的（⇒ "测试未纳入事实"的直接证据）；
 * · `extra`    = **形态扫到但运行器不跑**的（例：`tests/fixtures/*.test.ts`）——
 *   ★ 这一项存在的理由：上一版本仓上 113 扫到 vs 112 实跑，差 1 个却**没有任何读数说出来**。
 */
export function testObjectVisibility(
  root: string,
  indexedFiles: readonly string[],
  opts?: { onDisk?: readonly string[] },
): {
  objects_on_disk: number;
  objects_indexed: number;
  missing: string[];
  extra: string[];
  basis: 'runner' | 'scan';
  label: string;
} {
  const n = (f: string): string => String(f).replace(/\\/g, '/');
  const idx = new Set(indexedFiles.map(n));
  const scanned = scanTestObjects(root);
  const basis = opts?.onDisk ? opts.onDisk.map(n) : scanned;
  const basisSet = new Set(basis);
  const missing = basis.filter((f) => !idx.has(f));
  const extra = scanned.filter((f) => !basisSet.has(f));
  return {
    objects_on_disk: basis.length,
    objects_indexed: basis.length - missing.length,
    missing,
    extra,
    basis: opts?.onDisk ? 'runner' : 'scan',
    label: '测试文件',
  };
}

export function hashProjectFiles(root: string, skipped?: ScanSkip[]): Record<string, string> {
  const DIRS = ['src', 'tests', 'scripts', 'certs', '.agent-io/design'];
  const ROOT_FILES = ['package.json', 'tsconfig.json', 'tsconfig.contract.json'];
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    } catch (e) {
      // ★ 只报**真失败**：目录不存在（ENOENT）是常态（不是每个项目都有 certs/），不算部分读数。
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        skipped?.push({ path: dir, why: `readdir 失败：${(e as Error).message}` });
      }
      return;
    }
    for (const e of ents) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
        walk(rel);
      } else if (/\.(ts|mjs|js|json)$/.test(e.name)) {
        try {
          out[rel] = sha256(fs.readFileSync(path.join(root, rel)));
        } catch (err) {
          skipped?.push({ path: rel, why: `读取失败：${(err as Error).message}` });
        }
      }
    }
  };
  for (const d of DIRS) walk(d);
  for (const f of ROOT_FILES) {
    try {
      out[f] = sha256(fs.readFileSync(path.join(root, f)));
    } catch (err) {
      // 根文件"不存在"是常态（不是每个项目都有 tsconfig.contract.json）⇒ 只有非 ENOENT 才记
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') skipped?.push({ path: f, why: `读取失败：${(err as Error).message}` });
    }
  }
  return out;
}

/** ② 事实图版本：`cache.db` 的指纹；不存在 ⇒ `available:false`（**影响关系不可信**） */
export function graphVersion(root: string): { version: string; bytes: number; available: boolean } {
  const p = path.join(root, '.agent-io', 'cache.db');
  try {
    const st = fs.statSync(p);
    const buf = fs.readFileSync(p);
    return { version: sha256(buf), bytes: st.size, available: true };
  } catch {
    return { version: '', bytes: 0, available: false };
  }
}

/** 读基线：**损坏要能说出来**（不许静默当"没有基线 ⇒ 全跑"或反之当"全都有效"） */
export function loadVerifiedSnapshot(root: string, rel: string = SNAPSHOT_REL): SnapshotLoad {
  const p = path.join(root, rel);
  let raw: string;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (e) {
    // ★ DS-1R：**读不到 ≠ 没有**。EACCES/EISDIR/EPERM 若被说成"首次运行"，是最容易被读轻的一句话。
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { status: 'missing', reason: `没有基线文件 ${rel}（首次运行；本次结果将成为基线）`, code };
    return {
      status: 'missing',
      reason: `基线文件 ${rel} **读不到**（${code ?? '未知错误'}：${(e as Error).message}）—— 这不是"首次运行"，不得当作"没有基线"`,
      code: code ?? 'unknown',
      unreadable: true,
    };
  }
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    return { status: 'corrupt', reason: `基线不是合法 JSON：${(e as Error).message}` };
  }
  const s = j as Partial<VerifiedSnapshot>;
  if (s.schema !== SNAPSHOT_SCHEMA) return { status: 'corrupt', reason: `schema 不匹配（要 ${SNAPSHOT_SCHEMA}，实得 ${String(s.schema)}）` };
  if (!s.content || typeof s.content.version !== 'string' || !s.content.files) return { status: 'corrupt', reason: '缺 content.version/files' };
  if (contentVersion(s.content.files) !== s.content.version) return { status: 'corrupt', reason: 'content.version 与 content.files 指纹不符（被改过或写坏）' };
  if (!s.graph || typeof s.graph.version !== 'string') return { status: 'corrupt', reason: '缺 graph.version' };
  if (!Array.isArray(s.entries)) return { status: 'corrupt', reason: '缺 entries' };
  for (const e of s.entries) {
    if (!e || typeof e.id !== 'string' || !e.verdict || typeof e.command !== 'string' || typeof e.at !== 'string') {
      return { status: 'corrupt', reason: `entries 里有不完整项：${JSON.stringify(e).slice(0, 80)}` };
    }
  }
  if (!s.scope || !Array.isArray(s.scope.ran) || !Array.isArray(s.scope.inherited) || !Array.isArray(s.scope.undetermined)) {
    return { status: 'corrupt', reason: '缺 scope.ran/inherited/undetermined' };
  }
  return { status: 'ok', snapshot: s as VerifiedSnapshot };
}

/**
 * 计划状态（★ 必须能分辨，不许都读成"通过"）：
 * · `plan`           —— 逐条判定过（可能含重验/继承/未判定）；
 * · `no-change`      —— 真的没有任何改动 ⇒ 全部继承（唯一允许"全继承"的地方）；
 * · `no-work`        —— **本来就没有应验证的对象**（磁盘上 0 个）⇒ 无活可干，**不是**通过；
 * · `no-evidence`    —— **对象存在但一条证据都没有** ⇒ 未判定 + 显式扩大（**不许**报通过）；
 * · `empty-observes` —— 证据都在，但**观察面全为空** ⇒ 没有任何事实能证明受影响与否 ⇒ 未判定 + 扩大；
 * · `widen`          —— 因公共底座/不可信/无基线而整体扩大。
 */
export type PlanState = 'plan' | 'no-change' | 'no-work' | 'no-evidence' | 'empty-observes' | 'widen';

export type InheritancePlan = {
  /** ★ 本次结论的种类（`no-change` 才允许"全部继承"） */
  state: PlanState;
  /** 人读的一句话补充（例如"测试未纳入事实"） */
  note?: string;
  /** 是否必须**扩大范围**（跑全量 / 不复用）；有值即代表"基线不可作数" */
  widen: { reason: string } | null;
  /** 可继承的条目（未变 + 证据有效 + 影响关系可信） */
  inherit: SnapshotEntry[];
  /** 必须重跑的条目（新增 / 变过 / 上次失败 / 上次不可判） */
  rerun: { id: string; reason: string }[];
  /** 判不了的条目（要显式报，不许并进 pass） */
  undetermined: { id: string; reason: string }[];
};

/**
 * **应验证对象**的可见性事实（由调用方提供；缺省 = 不检查，保持旧调用可用）。
 *
 * ★ 它存在的唯一理由：**"没有证据"与"没有问题"长得一模一样**。
 *   本项目实测（2026-11-08，council-hub 副本）：`import_project` 默认不收测试文件
 *   （`include_tests=false`）⇒ 证据 0 条 ⇒ 旧逻辑"无条目可继承"⇒ 读起来像"全绿"。
 */
export type EvidenceVisibility = {
  /** 磁盘上**应验证对象**的数量（如 `tests/*.test.ts` 的个数） */
  objects_on_disk?: number;
  /** 事实库里**能看到**的同类对象数量（测试文件未被索引时 = 0） */
  objects_indexed?: number;
  /** 人读的名字，缺省"测试/契约对象" */
  label?: string;
};

/**
 * **继承决策（纯函数）** —— 本模块唯一的判据所在。
 *
 * 次序 = 从"最不可信"往"最可信"排，命中即整体降级：
 * 快照损坏 → 事实图不可信/变了 → 公共底座变了 → 逐条比对。
 */
export function planInheritance(input: {
  loaded: SnapshotLoad;
  changed: readonly string[];
  /**
   * ★★ **主锚点（本轮换定）**：改动集的波及集合（`impactOfChanged()` 算出来）。
   * 判定 = **证据观察面 ∩ 波及集合**。优点：`O(改动数)`，不随证据数重复遍历全图，
   * 也不需要"把闭包算到饱和才敢继承"。
   * `null` / `ok:false` ⇒ 影响关系不可信 ⇒ **全部 undetermined**（不许默认安全）。
   */
  impact?: ImpactSet | null;
  /**
   * 语义摘要（**仅用于对照/离线漂移检测**；给了 `impact` 时本项不参与判定）。
   * 返回 `null` = 算不出来 ⇒ 该条 `undetermined`（**不继承**）。
   * 不传 = 本进程拿不到事实（例如无 DB）⇒ 全部条目 `undetermined`。
   */
  digestOf?: (e: SnapshotEntry) => string | null;
  /**
   * ★★ **改动集可信度**（本轮新增；缺省 = 不检查，保持旧调用可用）：
   * · `undefined` ⇒ 不检查（对照/旧测试）；
   * · `null` ⇒ **算不出来**（git 读不到 / 指纹比不了）⇒ 全部 `undetermined`；
   * · 字符串数组 ⇒ 实测到的**代码文件内容漂移**。凡漂移文件**不在** `changed` 里 ⇒
   *   说明**改动集不完整** ⇒ 全部 `undetermined`（**空交集不许当安全**）。
   */
  drift?: string[] | null;
  /**
   * ★★ **应验证对象的可见性**（缺省 = 不检查，保持旧调用可用）。
   * 用途只有一个：把"**没有证据**"与"**没有问题**"分开 —— 二者长得一模一样。
   */
  evidence?: EvidenceVisibility;
  /**
   * ★★ **观察面补全**（缺省 = 不补，保持旧行为）：证据没记 `observes` 时，用它从
   * **真实事实**（import / call 边）推导一次。推导成功 ⇒ 参与"观察面 ∩ 波及集合"判定；
   * 推导不出 ⇒ **仍然 undetermined**（不许猜成 pass，也不许从分母里消失）。
   */
  deriveObserves?: (e: SnapshotEntry) => string[] | null;
  /** 只看这些前缀（便于测试注入） */
  widenPatterns?: readonly RegExp[];
}): InheritancePlan {
  const { loaded, changed } = input;
  const widenPatterns = input.widenPatterns ?? WIDEN_PATTERNS;
  const changedSet = new Set(changed.map(norm));

  if (loaded.status === 'missing') {
    return { state: 'widen', widen: { reason: `无基线（${loaded.reason}）⇒ 本次全跑，结果写入基线` }, inherit: [], rerun: [], undetermined: [] };
  }
  if (loaded.status === 'corrupt') {
    return { state: 'widen', widen: { reason: `基线损坏（${loaded.reason}）⇒ **不得继承**，本次全跑` }, inherit: [], rerun: [], undetermined: [] };
  }
  const snap = loaded.snapshot;

  // ★★ 2026-11-08：**不再**用 cache.db 的字节哈希判失效。
  //   索引重算只是"重新取了一次事实"，不改变任何被观察的事实 ⇒ 基线继续可用。
  //   真正的失效判据下沉到**每条证据自己的语义摘要**（见下）。

  // 公共底座 / 验证规则 / 共享配置：一模一样地影响全仓
  //
  // ★★ 2026-11-09：**再加一条前提 —— 内容必须相对基线变过**。
  //   原来是纯按 git 改动集判：只要某个 widen 文件"跟 HEAD 不同"就全跑。
  //   实测后果（本会话）：改完 `verified_snapshot.ts` 后**每一轮**都是 `widen`，
  //   内环永久退化成全跑 —— 因为**未提交**的改动一直待在 git 改动集里。
  //   ⇒ 判据改成"相对**上次录证据时**的内容也变了才有意义"（`drift` 就是这份读数）：
  //     一旦那次 widen 把新哈希录进基线，这些文件就不再算"变过" ⇒ 下一轮正常继承。
  //   ★ 保守边界不变：`drift === null`（读不到内容指纹）⇒ 退回旧判据（全跑，宁可多跑）。
  const driftSet = input.drift ? new Set(input.drift.map(norm)) : null;
  const widenHit = changed
    .map(norm)
    .find((p) => widenPatterns.some((re) => re.test(p)) && (driftSet === null || driftSet.has(p)));
  if (widenHit) {
    return { state: 'widen', widen: { reason: `改动命中公共底座/验证规则/共享配置（${widenHit}）⇒ 影响面 = 全仓，本次全跑` }, inherit: [], rerun: [], undetermined: [] };
  }

  // ★★ 2026-11-08（改动集可信边界）：**空交集 ≠ 安全**
  //   声明"没改"或"只改了 A"，但内容指纹显示 B 也变了 ⇒ 改动集不完整 ⇒ 谁受影响无从判断。
  if (input.drift !== undefined) {
    if (input.drift === null) {
      const why = '改动集不可信（读不到 git 改动 / 无法比对内容指纹）⇒ 不继承';
      return {
        state: 'widen',
        widen: { reason: '改动集不可信 ⇒ 本次全跑（不许把"读不到改动"当"没改动"）' },
        inherit: [],
        rerun: [],
        undetermined: snap.entries.map((e) => ({ id: e.id, reason: why })),
      };
    }
    const declared = new Set(changed.map(norm));
    const undeclared = input.drift.map(norm).filter((f) => !declared.has(f));
    if (undeclared.length > 0) {
      const why = `改动集不完整：${undeclared.slice(0, 3).join(', ')}${
        undeclared.length > 3 ? ` …（共 ${undeclared.length} 个）` : ''
      } 的内容变了，但没在改动集里`;
      return {
        state: 'widen',
        widen: { reason: `${why} ⇒ 本次全跑（空交集不许当安全）` },
        inherit: [],
        rerun: [],
        undetermined: snap.entries.map((e) => ({ id: e.id, reason: `${why} ⇒ 不知道它受不受影响，不继承` })),
      };
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ★★ 2026-11-08：**"没有证据" ≠ "没有问题"**
  //
  // 真实事故（council-hub 副本实测）：`import_project` 默认不收测试文件
  // （`include_tests=false`）⇒ 基线里 **0 条证据** ⇒ 旧的逐条循环"无条目可判"
  // ⇒ 输出读起来像"全绿"。**检查对象退出检查范围，检查就自动变绿。**
  // ⇒ 这里把三种情况**分开**：真的没活干 / 有对象没证据 / 有证据但观察面空。
  // ══════════════════════════════════════════════════════════════════
  {
    const ev = input.evidence;
    const label = ev?.label ?? '测试/契约对象';
    const onDisk = ev?.objects_on_disk;
    const indexed = ev?.objects_indexed;

    if (snap.entries.length === 0) {
      // ① 真的没有应验证的对象 ⇒ no-work（**不是**通过，只是没活干）
      if (onDisk === 0) {
        return {
          state: 'no-work',
          note: `磁盘上没有任何${label}（0 个）⇒ 本次无活可干；这是"没活"，不是"通过"`,
          widen: null,
          inherit: [],
          rerun: [],
          undetermined: [],
        };
      }
      // ② 对象存在但一条证据都没有 ⇒ no-evidence（**不许**报通过）
      const unseen = indexed === 0 && (onDisk ?? 0) > 0;
      const why =
        `应验证的${label}存在${onDisk != null ? `（磁盘 ${onDisk} 个）` : ''}，` +
        '但基线里**一条证据都没有** ⇒ 无法证明任何东西通过' +
        (unseen ? '；且**测试未纳入事实**（索引里 0 个测试文件，通常是 include_tests=false）' : '');
      return {
        state: 'no-evidence',
        note: unseen ? `测试未纳入事实：索引里 0 个测试文件（include_tests=false）⇒ 本次不能报完整验证` : undefined,
        widen: { reason: `${why} ⇒ 本次全跑，并把证据写进基线` },
        inherit: [],
        rerun: [],
        undetermined: [{ id: '(全部)', reason: why }],
      };
    }

    // ③ 证据都在，但**观察面全为空** ⇒ 没有任何事实能证明受影响与否
    //    ★★ 2026-11-09（收口未判定）：**先试事实推导**再判"全空" ——
    //    旧顺序是"只要有 observes 字段为空就整体判 empty-observes"，导致 `deriveObserves`
    //    永远轮不到被调用（实测：53/56 条其实能从 import/call 边推导出来，却被整体短路掉）。
    //    现在口径：**连推导都拿不到观察面**才算 blank。
    const blank = snap.entries.filter((e) => {
      if ((e.observes?.length ?? 0) > 0 || (e.symbols?.length ?? 0) > 0) return false;
      const d = input.deriveObserves?.(e) ?? [];
      return d.length === 0;
    });
    if (blank.length === snap.entries.length) {
      const why = input.deriveObserves
        ? `全部 ${blank.length} 条证据既没记观察面、**从 import/call 边也推导不出** ⇒ 判不了，**不得**继承为通过`
        : `全部 ${blank.length} 条证据的观察面为空（没记观察到哪些文件/符号）⇒ 判不了，**不得**继承为通过`;
      return {
        state: 'empty-observes',
        note: '证据存在但观察面为空：多半是索引里没有这些文件的 import/调用关系（如测试未入库）',
        widen: { reason: `${why} ⇒ 本次全跑` },
        inherit: [],
        rerun: [],
        undetermined: blank.map((e) => ({ id: e.id, reason: why })),
      };
    }
  }

  const inherit: SnapshotEntry[] = [];
  const rerun: { id: string; reason: string }[] = [];
  const undetermined: { id: string; reason: string }[] = [];

  // ★★ 主锚点：改动集波及集合
  if (input.impact !== undefined) {
    const imp = input.impact;
    if (imp === null || !imp.ok) {
      const why = imp === null ? '没算波及集合' : imp.reason;
      for (const e of snap.entries) {
        undetermined.push({ id: e.id, reason: `影响关系不可信（${why}）⇒ 不知道它受不受影响，不继承` });
      }
      return { state: 'widen', widen: null, inherit, rerun, undetermined };
    }
    for (const e of snap.entries) {
      if (e.verdict !== 'pass') {
        rerun.push({ id: e.id, reason: `上次 verdict=${e.verdict}（不是 pass）⇒ 必须重跑` });
        continue;
      }
      // ★ 先试**事实推导**：只补"它观察到什么"，不改 verdict（verdict 仍是上次真跑的结果）
      // ★ DS-1R：`observes` 记坏（字符串）时旧写法会**逐字符**参与交集 ⇒ 永不命中 ⇒ 假继承。
      const declaredObserves = Array.isArray(e.observes) ? e.observes : [];
      const derived = declaredObserves.length === 0 ? (input.deriveObserves?.(e) ?? []) : [];
      const observes = declaredObserves.length > 0 ? declaredObserves : derived;
      if (observes.length === 0 && (e.symbols?.length ?? 0) === 0) {
        undetermined.push({
          id: e.id,
          reason: input.deriveObserves
            ? '证据没记它观察到什么，且**从 import/call 边也推导不出**（纯 IO / 类型测试）⇒ 无法判断是否受影响（不猜）'
            : '证据没记它观察到什么（文件/符号）⇒ 无法判断是否受影响（不猜）',
        });
        continue;
      }
      const hit = intersectsImpact(observes, e.symbols ?? [], imp);
      if (hit) {
        rerun.push({ id: e.id, reason: `${hit} ⇒ 必须重验` });
        continue;
      }
      inherit.push(e);
    }
    // ★ 只有"确实没有改动 + 指纹也说没变 + 每条都继承"才算 no-change（唯一允许全继承的态）
    const untouched =
      changed.length === 0 &&
      (input.drift === undefined || input.drift.length === 0) &&
      rerun.length === 0 &&
      undetermined.length === 0;
    return { state: untouched ? 'no-change' : 'plan', widen: null, inherit, rerun, undetermined };
  }

  // ── 以下为**旧口径（摘要相等）**：仅在没有波及集合时使用（对照/离线）──
  //   ★ 它需要"闭包算到饱和"才敢下结论（长链文件会永远 undetermined），
  //     所以**主路径不再用它**——只留作对照与离线漂移检测。

  for (const e of snap.entries) {
    if (e.verdict !== 'pass') {
      rerun.push({ id: e.id, reason: `上次 verdict=${e.verdict}（不是 pass）⇒ 必须重跑` });
      continue;
    }
    if ((e.observes?.length ?? 0) === 0 && (e.symbols?.length ?? 0) === 0) {
      undetermined.push({ id: e.id, reason: '证据没记它观察到什么（文件/符号）⇒ 无法判断是否受影响（不猜）' });
      continue;
    }
    if (e.digest === undefined || e.digest === null) {
      undetermined.push({ id: e.id, reason: '证据没有语义摘要（digest 缺失）⇒ 不知道相关事实是否变过，不继承' });
      continue;
    }
    const now = input.digestOf ? input.digestOf(e) : null;
    if (now === null) {
      undetermined.push({ id: e.id, reason: '现在算不出语义摘要（事实库不可用）⇒ 判不了，不继承' });
      continue;
    }
    if (now !== e.digest) {
      rerun.push({ id: e.id, reason: `它观察的源码/符号/关系变了（语义摘要 ${e.digest.slice(0, 10)} → ${now.slice(0, 10)}）⇒ 必须重验` });
      continue;
    }
    const hit = (e.observes ?? []).map(norm).find((f) => changedSet.has(f));
    if (hit) {
      rerun.push({ id: e.id, reason: `它观察的 ${hit} 变了 ⇒ 必须重验` });
      continue;
    }
    inherit.push(e);
  }
  return { state: 'plan', widen: null, inherit, rerun, undetermined };
}

/** 写回本次基线（原子写：先写临时文件再 rename，避免半截文件成为"损坏基线"） */
export function writeVerifiedSnapshot(root: string, snap: VerifiedSnapshot, rel: string = SNAPSHOT_REL): void {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(snap, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

/** 汇总一行（**带分母**；不许只报"全绿"） */
export function summarizeScope(scope: SnapshotScope): string {
  const ran = scope.ran.length;
  const inh = scope.inherited.length;
  const und = scope.undetermined.length;
  const kind = scope.partial === false ? '全仓' : '局部（内环）';
  return `实跑 ${ran} · 继承 ${inh} · 未判定 ${und}（合计 ${ran + inh + und}）· 范围：${kind}`;
}
