/**
 * ★★★ F1b —— **语义层事实填充**（fields / signatures / contracts）
 *
 * ## 为什么住在这里
 * 事实由 `import_project` 的索引内核触发就够，**不新增工具面**（AGENTS 收敛原则）。
 * 抽取器本身在 `./gofacts/`（仓内 Go 程序），因为它要 type checker；
 * 本文件只负责：**调它 → 降级判定 → 落库**（事务与表结构只在这一处）。
 *
 * ## 三层语义（不许越界）
 *   ① 本项目能 type-check  ⇒ 精确事实（字段账 / 签名账 / 接口契约账）
 *   ② 不能（缺依赖/无 go.mod）⇒ **不产出**，回执里写 `syntax-only` 与原因，**不猜**
 *   ③ 非 Go 语言          ⇒ 本步跳过（TS 侧未来用 tsc Checker 填同一批表）
 *
 * ## 幂等
 * 每次**全量刷新**这几张派生表（先 DELETE 再插）：这样"事实过期"不会累积；
 * 语义层失败时**不清空**已有行（失败路径根本走不到那几句 DELETE）。
 *
 * ## 已下线的表（v18 · R11）
 * `occurrences` 已删（建表 / 写入端 / 计数读数一起删）：它记的"某符号出现在哪"与 `identifiers` 表
 * **重复**，而列更少（只有 line/col，**没有** start_index/end_index）⇒ 填满它也帮不了 `edit_code`
 * （它要**精确偏移**）。同一事实的第二处住处、且比第一处更弱 ⇒ 删第二处（AGENTS 0.9.1 方向 A）。
 * 它原本独有的 `role` / `symbol_id` 属语义层，本仓 TS 侧不生产 ⇒ 挂账（docs/todo.md R11）。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './db.js';

/** ESM 下没有 __dirname ⇒ 用 import.meta.url 定位（本文件编译后位于 dist/src/infrastructure/index/） */
const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface SemanticFactsResult {
  ok: boolean;
  reason?: string;
  packages: number;
  files: number;
  typeErrors: number;
  fields: number;
  signatures: number;
  /** 二进制来源：缓存命中 / 本次构建 / go run 兜底 */
  via: 'cached' | 'built' | 'go-run' | 'none';
}
interface RawField {
  /** ★ 出处文件（相对路径）：build tag 互斥变体的同名结构体靠它区分，缺了就会并集 */
  file: string;
  structure: string;
  name: string;
  ordinal: number;
  type: string;
  jsonTag: string;
  embedded: boolean;
}
interface RawParam {
  name: string;
  type: string;
}
interface RawFunc {
  file: string;
  recv: string;
  name: string;
  params: RawParam[];
  results: string[];
}
interface RawIface {
  file: string;
  name: string;
  methods: string[];
  impls: string[];
}
/**
 * 抽取器的 JSON 形状。
 * ★ 2026-11-05（R11 · v18）：`occurrences` 字段**不再读**（表已删）。Go 侧 `gofacts/main.go`
 *   仍会 emit 它 —— 那是**跨语言契约的残留**：本仓今天**零读者**，本卡不动 Go 源码，只在此声明。
 *   要删它 = 改 `src/infrastructure/index/gofacts/main.go` 的 `Out.Occurrences` 字段与它的采集循环。
 */
interface RawOut {
  ok: boolean;
  reason?: string;
  packages: number;
  files: number;
  typeErrors: number;
  fields: RawField[];
  funcs: RawFunc[];
  ifaces?: RawIface[];
}

// ★ 抽取器是 **Go 源码**（dist 里没有 .go）⇒ 优先查找编译产物同级，回落仓库源码目录
const HELPER_DIR =
  [path.join(HERE, 'gofacts'), path.join(HERE, '../../../../src/infrastructure/index/gofacts')].find((p) => fs.existsSync(p)) ??
  path.join(HERE, 'gofacts');
const GO_TIMEOUT_MS = 120_000;

/** go 是否可用（不可用 ⇒ 直接降级，不去撞 exec 错误） */
function goAvailable(): boolean {
  try {
    execFileSync('go', ['version'], { timeout: 15_000, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 拿到可执行的抽取器：优先用缓存二进制（`.agent-io/tools/gofacts.exe`），
 * 没有就 `go build` 一次；再不行退 `go run`（慢但能跑）。
 */
function helperBinary(projectRoot: string): { file: string; args: string[]; via: SemanticFactsResult['via'] } | null {
  const toolsDir = path.join(projectRoot, '.agent-io', 'tools');
  const exe = path.join(toolsDir, process.platform === 'win32' ? 'gofacts.exe' : 'gofacts');
  try {
    const src = path.join(HELPER_DIR, 'main.go');
    const needBuild = !fs.existsSync(exe) || fs.statSync(exe).mtimeMs < fs.statSync(src).mtimeMs;
    if (needBuild) {
      fs.mkdirSync(toolsDir, { recursive: true });
      execFileSync('go', ['build', '-o', exe, '.'], {
        cwd: HELPER_DIR,
        timeout: GO_TIMEOUT_MS,
        stdio: 'ignore',
        env: { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOSUMDB: 'off' },
      });
      return { file: exe, args: [], via: 'built' };
    }
    return { file: exe, args: [], via: 'cached' };
  } catch {
    // 构建失败（如 x/tools 不在缓存）⇒ 退 go run
    return { file: 'go', args: ['run', '.'], via: 'go-run' };
  }
}

/** 抽取并落库；返回结构化读数（失败也返回读数，让调用方记账，不静默） */
export function fillSemanticFacts(db: Database, projectRoot: string): SemanticFactsResult {
  const empty: SemanticFactsResult = {
    ok: false,
    packages: 0,
    files: 0,
    typeErrors: 0,
    fields: 0,
    signatures: 0,
    via: 'none',
  };
  if (!goAvailable()) return { ...empty, reason: 'go 工具链不可用 ⇒ 事实标 syntax-only' };

  const bin = helperBinary(projectRoot);
  if (!bin) return { ...empty, reason: '抽取器构建失败 ⇒ 事实标 syntax-only' };

  let raw: RawOut;
  try {
    const out = execFileSync(bin.file, [...bin.args, projectRoot], {
      cwd: bin.via === 'go-run' ? HELPER_DIR : projectRoot,
      timeout: GO_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, GOFLAGS: '-mod=mod', GOPROXY: 'off', GOSUMDB: 'off' },
    });
    raw = JSON.parse(String(out).trim().split('\n').pop() ?? '{}') as RawOut;
  } catch (e) {
    return { ...empty, via: bin.via, reason: `抽取器执行失败：${String((e as Error).message).slice(0, 200)}` };
  }
  if (!raw.ok) return { ...empty, via: bin.via, reason: raw.reason ?? '抽取器返回 ok=false' };

  const insField = db.prepare(
    'INSERT OR REPLACE INTO fields (file, structure, name, ordinal, type, json_tag, embedded) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insSig = db.prepare(
    'INSERT OR REPLACE INTO signatures (file, structure, name, kind, ordinal, param_name, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  let fieldN = 0;
  let sigN = 0;
  db.exec('BEGIN');
  try {
    // ★ **全量刷新**语义事实（fields / signatures / contracts 都是派生数据，一次 import 重算一遍）：
    //   只 INSERT OR REPLACE 会留下**已删除符号的陈旧行**（改名/删字段后越积越多）；
    //   走到这里说明语义层成功，全删再插是安全的（失败路径不会执行到这里，不会把精确事实清空）。
    //   代价：被 build tag 排除的文件其旧行也会消失 —— 这是**正确**的（它们不在本次构建里）。
    // ★★★ 2026-11-05（R11 · v18）：occurrences 表已删 ⇒ 这里不再清它、不再插它（见文件头「已下线的表」）。
    db.exec('DELETE FROM fields');
    db.exec('DELETE FROM signatures');
    db.exec('DELETE FROM contracts');
    for (const f of raw.fields ?? []) {
      insField.run(f.file ?? '', f.structure, f.name, f.ordinal, f.type ?? null, f.jsonTag ?? null, f.embedded ? 1 : 0);
      fieldN++;
    }
    // 签名账：形参与返回值逐位一行（结构体 receiver 的 4 段唯一键 ⇒ 天然幂等）
    for (const fn of raw.funcs ?? []) {
      const recv = fn.recv ?? '';
      (fn.params ?? []).forEach((p, i) => {
        insSig.run(fn.file ?? '', recv, fn.name, 'param', i, p.name ?? null, p.type ?? null);
        sigN++;
      });
      (fn.results ?? []).forEach((t, i) => {
        insSig.run(fn.file ?? '', recv, fn.name, 'result', i, null, t ?? null);
        sigN++;
      });
      // ★★★ 零形参 + 零返回值的函数必须留一行『存在』足迹（kind='decl'）。
      //   否则它**一行都不插** ⇒ 整个签名从库里消失 ⇒ 对拍报 missing-func。
      //   实测踩坑：`func (gw *GraphWriter) Stop()`、`func main()`、`func Vocabulary()` 全都“凭空消失”，
      //   而 gofacts 的 JSON 里明明有（633 个 funcs / 3 个 Stop）⇒ 问题在**落库**不在抽取。
      if ((fn.params ?? []).length === 0 && (fn.results ?? []).length === 0) {
        insSig.run(fn.file ?? '', recv, fn.name, 'decl', 0, null, null);
        sigN++;
      }
    }
    // 接口契约账（方法集 + 实现者）
    const insIface = db.prepare(
      'INSERT OR REPLACE INTO contracts (file, name, methods, impls) VALUES (?, ?, ?, ?)',
    );
    for (const it of raw.ifaces ?? []) {
      insIface.run(it.file ?? '', it.name, JSON.stringify(it.methods ?? []), JSON.stringify(it.impls ?? []));
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return { ...empty, via: bin.via, reason: `落库失败：${String((e as Error).message).slice(0, 200)}` };
  }

  return {
    ok: true,
    packages: raw.packages,
    files: raw.files,
    typeErrors: raw.typeErrors ?? 0,
    fields: fieldN,
    signatures: sigN,
    via: bin.via,
  };
}
