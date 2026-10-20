/**
 * gen_design_db —— 设计 DSL → 设计 DB（工具 `design_line` 的 `action=gen-db`）
 *
 * ## 它生成什么（用户的关键定义，逐字留在注释里）
 * ```
 * certs/design-db/<file>.calls.json   ← 每个文件节点一份（全量）
 * ```
 *
 * ## 为什么必须【全量、和实际 DB 同构】
 * 用户原话（2026-10-19）："一个是渐进式解析，一个是渐入式重写 —— 我们既要重写设计 DSL，
 * 还要重写设计 DB，再最后重写源码。"
 * ```
 * 解析（源码 → 设计）：源码 → 实际 DB → 实际 DSL → 设计 DSL（fork）
 * 重写（设计 → 源码）：设计 DSL → ★ 设计 DB → 源码
 * ⇒ 两条路的三层一一对应：实际 DB ↔ 设计 DB（同构）、实际 DSL ↔ 设计 DSL（同构）
 * ⇒ "重写源码"需要一份【完整的设计 DB】，不是"设计关心的那几条"
 *   —— 那几条只是设计 DB 里的 `requirements[]` 标注。
 * ```
 *
 * ## 每份的形状（与实际 DB 同构）
 * ```
 * { "//"…, "path": <仓库相对路径>, "symbols": […], "imports": […], "calls": […],
 *   "requirements"?: […], "requirements_calls"?: […] }
 * ```
 * ★ `calls` 是**全量镜像**（必然全绿）；`requirements_calls` 才是"设计说必须有"的
 *   —— `contract:calls` 必须读后者，否则契约门在全量之后会失效（用户 2026-10-19 指出过）。
 *
 * ## 搬家纪律（从 scripts/gen-design-db.mjs）
 * **输出必须逐字相同**。所以下面这些格式细节一个都不能"顺手优化"：
 * `JSON.stringify(payload, null, 2) + '\n'`、键的插入顺序、`outNameOf` 的替换规则、
 * 可选字段的"空就不写"。
 *
 * ## 边界（写在代码里，别让调用方以为它全管）
 * - 只处理 `description` 以 `src/` 开头的节点（其他目录不进设计 DB）
 * - `symbols` / `imports` / `calls` 的**事实**取自 `cache.db`（设计 DSL 不存符号级事实）
 * - `check=true` **不写盘**（只报不一致），也不清理陈旧副本
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface GenDesignDbOptions {
  /** 只处理这个 feature（不传 = design/ 下全部） */
  feature?: string;
  /** 只比对不写盘（真写会改 certs/design-db/） */
  check?: boolean;
}

export interface GenDesignDbResult {
  /** 参与生成的 feature 数 */
  features: number;
  /** 处理过的文件节点数 */
  files: number;
  /** 本次写入的副本数 */
  written: number;
  /** 内容未变、跳过的副本数 */
  unchanged: number;
  /** 清理掉的陈旧副本数（check 模式恒 0） */
  pruned: number;
  /** 问题清单（读库失败 / check 模式下的不一致） */
  problems: string[];
  /** 本次是否 check 模式 */
  check: boolean;
}

type AnyNode = {
  description?: string;
  decision?: { expectations?: Array<{ kind?: string; symbol?: string; target?: string; why?: string; path?: string }> };
};

const norm = (s: unknown): string => String(s ?? '').replace(/\\/g, '/');

/** 副本文件名：`src/a/b.ts` → `a-b.calls.json`（★ 与旧脚本逐字一致，别改） */
export const outNameOf = (rel: string): string =>
  rel.replace(/^src\//, '').replace(/[/\\]/g, '-').replace(/\.ts$/, '') + '.calls.json';

/**
 * 生成（或检查）设计 DB。
 * ★ 纯 I/O：读 `design/*.dsl.json` + `cache.db`，写 `certs/design-db/`。
 */
export function genDesignDb(root: string, opts: GenDesignDbOptions = {}): GenDesignDbResult {
  const DESIGN_DIR = path.join(root, '.agent-io', 'design');
  const OUT_DIR = path.join(root, 'certs', 'design-db');
  const CHECK = opts.check === true;

  const result: GenDesignDbResult = { features: 0, files: 0, written: 0, unchanged: 0, pruned: 0, problems: [], check: CHECK };

  if (!fs.existsSync(DESIGN_DIR)) {
    result.problems.push(`找不到 ${DESIGN_DIR}`);
    return result;
  }
  let files = fs.readdirSync(DESIGN_DIR).filter((f) => f.endsWith('.dsl.json'));
  if (opts.feature) files = files.filter((f) => f === `${opts.feature}.dsl.json`);
  result.features = files.length;
  if (!CHECK) fs.mkdirSync(OUT_DIR, { recursive: true });

  const dbPath = path.join(root, '.agent-io', 'cache.db');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const qSymbols = db.prepare(
    // ★ 2026-10-20：带上 members（type/interface 的定义；function 恒为 NULL）
    "SELECT name, kind, start_line, signature, members FROM nodes WHERE file_path = ? AND parent IS NULL AND kind != 'file' ORDER BY start_line",
  );
  const qImports = db.prepare('SELECT source, kind, type_only FROM imports WHERE file_path = ? ORDER BY line');
  const qCallsOut = db.prepare("SELECT source, target FROM edges WHERE kind = 'call' AND source LIKE ? ORDER BY target");
  const qHome = db.prepare(
    'SELECT file_path FROM nodes WHERE name = ? AND parent IS NULL ORDER BY (file_path = ?) DESC LIMIT 1',
  );

  try {
    for (const f of files) {
      const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
      for (const raw of (dsl.geometry?.nodes ?? []) as AnyNode[]) {
        const rel = norm(raw.description);
        if (!rel.startsWith('src/')) continue;
        result.files += 1;

        let symbols: Array<Record<string, unknown>> = [];
        let imports: Array<Record<string, unknown>> = [];
        let calls: Array<Record<string, unknown>> = [];
        try {
          symbols = (qSymbols.all(rel) as Array<{ name: string; kind: string; start_line: number; signature: string | null; members: string | null }>).map(
            (r) => ({
              name: r.name,
              kind: r.kind,
              line: r.start_line,
              ...(r.signature ? { signature: r.signature } : {}),
              // ★ 2026-10-20：类型成员（JSON 里存的是字符串，这里还原成数组）
              ...(r.members ? { members: JSON.parse(String(r.members)) } : {}),
            }),
          );
          imports = (qImports.all(rel) as Array<{ source: string; kind: string; type_only: number | null }>).map((r) => ({
            source: r.source,
            kind: r.kind,
            ...(r.type_only ? { type_only: true } : {}),
          }));
          calls = (qCallsOut.all(rel + '#%') as Array<{ source: string; target: string }>).map((r) => ({
            from: norm(r.source),
            to: norm(r.target),
          }));
        } catch (e) {
          result.problems.push(`${rel}: 读 cache.db 失败（${(e as Error)?.message ?? String(e)}）`);
          continue;
        }

        const exps = raw.decision?.expectations ?? [];
        const requirements = exps
          .filter((e) => e.kind === 'call-exists')
          .map((e) => ({ kind: 'call-exists', symbol: e.symbol, target: e.target, ...(e.why ? { why: e.why } : {}) }));

        // ★ 设计要求单独一个字段：`calls` 是全量镜像（必然全绿），
        //   `requirements_calls` 才是"设计说必须有"的 —— 契约门必须读它。
        const requirementsCalls: Array<Record<string, unknown>> = [];
        for (const e of exps) {
          if (e.kind !== 'call-exists') continue;
          const fromFile = norm(e.path ?? rel);
          const home = qHome.get(e.target ?? '', fromFile) as { file_path?: string } | undefined;
          if (!home) continue;
          requirementsCalls.push({
            from: `${fromFile}#${e.symbol}`,
            to: `${norm(home.file_path)}#${e.target}`,
            ...(e.why ? { why: e.why } : {}),
          });
        }

        const payload = {
          '//': `Design DB —— ${rel}（★ 全量、与实际 DB 同构；从 design/${f} 的节点生成）`,
          '//generated_by': 'scripts/gen-design-db.mjs（★ 不许手改：改了下次生成就冲掉）',
          '//source': `design/${f}`,
          /** 副本自报路径（机器可读；此前只在首行注释里，消费者只能解析注释） */
          path: rel,
          symbols,
          imports,
          calls,
          ...(requirements.length ? { requirements } : {}),
          ...(requirementsCalls.length ? { requirements_calls: requirementsCalls } : {}),
        };
        const outPath = path.join(OUT_DIR, outNameOf(rel));
        const text = JSON.stringify(payload, null, 2) + '\n';
        const old = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : null;
        if (old === text) {
          result.unchanged += 1;
          continue;
        }
        if (CHECK) {
          result.problems.push(`${outNameOf(rel)}: 与当前设计不一致（该重跑生成器）`);
          continue;
        }
        fs.writeFileSync(outPath, text);
        result.written += 1;
      }
    }
  } finally {
    db.close();
  }

  if (!CHECK) {
    const expected = new Set<string>();
    for (const f of files) {
      const dsl = JSON.parse(fs.readFileSync(path.join(DESIGN_DIR, f), 'utf8'));
      for (const raw of (dsl.geometry?.nodes ?? []) as AnyNode[]) {
        const rel = norm(raw.description);
        if (rel.startsWith('src/')) expected.add(outNameOf(rel));
      }
    }
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!expected.has(name)) {
        fs.unlinkSync(path.join(OUT_DIR, name));
        result.pruned += 1;
      }
    }
  }
  return result;
}
