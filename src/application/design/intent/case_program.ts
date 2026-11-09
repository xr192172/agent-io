/**
 * touches: src/application/design/intent/expectations.ts
 *
 * **契约形态扩展（cases）的执行核** —— 2026-11-09
 *
 * 旧形态 `behavior-cases` 只能表达"给一次参数 ⇒ 比返回值"。真实文件一旦涉及
 * **多步交互 / 副作用 / 该抛错 / 耗时**，就写不出契约 ⇒ 人被逼回外部测试套件。
 * 本文件补四种形态（**旧语义逐字不变**，这里只多一条路）：
 *
 * ```ts
 * { name?: string
 *   ctor?: unknown[] | false      // 构造实例的参数；false/缺省 ⇒ 调模块级函数
 *   steps?: [{ method?, args?, expect? }]   // 同一实例**按序**调用；每步可比返回值
 *   effects?: [{ writes, mustContain } | { writes, absent } | { handles, equals }]
 *   throws?: { messageContains }  // 期望抛错（没抛 ⇒ fail）
 *   budget?: { ms }               // 本次调用耗时上限，超时 ⇒ **fail**（不是崩溃/unsupported）
 * }
 * ```
 *
 * ## 硬边界（写死在实现里，不靠调用方自觉）
 * - **只支持 node + TS/JS**：其他语言由调用方走旧路径（本文件不做）；
 * - **不做 mock/替身**（`fakes` 是下一步）：`effects` 只断言"真的发生了/没发生"，
 *   不拦截、不替换，所以能覆盖文件系统与**进程内状态**，覆盖不了网络；
 * - **只 await 顶层 thenable**：不做 Promise.then 链与事件循环时序编排；
 * - **budget 只管本次调用**：不含模块加载、实例构造、夹具准备；
 *   ★ 同步死循环拦不住（JS 单线程，没有抢占）—— 这类失败会表现为整进程挂住，
 *   该形态只对"异步悬住 / 慢 await"有效，**如实标注**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type CaseProgramStep = { method?: string; args?: unknown[]; expect?: unknown };

export type CaseEffect =
  | { writes?: string; mustContain?: string; absent?: boolean }
  | { handles?: string; equals?: unknown };

export type CaseProgram = {
  name?: string;
  ctor?: unknown[] | false;
  steps?: CaseProgramStep[];
  effects?: CaseEffect[];
  throws?: { messageContains: string };
  budget?: { ms: number };
};

export type CaseRunStatus = 'pass' | 'fail' | 'unsupported';

export type CaseRunResult = {
  status: CaseRunStatus;
  /** 失败定位：`第 2 步（method=add）` / `effects[0]` / `throws` / `budget` */
  at?: string;
  /** 人读的逐条明细（失败时含期望/实得） */
  detail: string[];
};

/** 该用例是不是**新形态**（有 steps / ctor / effects / budget 任一） */
export function isCaseProgram(c: unknown): boolean {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return o['steps'] !== undefined || o['ctor'] !== undefined || o['effects'] !== undefined || o['budget'] !== undefined;
}

/** 结构化比值的规范化：对象键排序，保证"同 shape 不同键序"不算差异 */
function canon(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = walk(o[k]);
          return acc;
        }, {});
    }
    return x;
  };
  try {
    return JSON.stringify(walk(v));
  } catch {
    return String(v);
  }
}

/** 期望值的两种写法都认：JSON 串（`'{"ok":true}'`）或 JS 值 */
function sameExpect(actual: unknown, expected: unknown): boolean {
  if (typeof expected === 'string') {
    const t = expected.trim();
    if (t.startsWith('{') || t.startsWith('[') || t.startsWith('"') || t === 'true' || t === 'false' || t === 'null') {
      try {
        return canon(actual) === canon(JSON.parse(t));
      } catch {
        /* 不是 JSON ⇒ 按裸串比 */
      }
    }
    return String(actual) === expected;
  }
  return canon(actual) === canon(expected);
}

const isThenable = (v: unknown): v is Promise<unknown> =>
  !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function';

/** 从实例上按 `a.b.c` 取进程内状态（`handles` 用） */
function readPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const k of dotted.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/**
 * 跑一个**新形态**用例。
 *
 * ★ 加载失败（文件不存在 / 语法错 / 非 CJS-ESM 可解析）⇒ `unsupported`（"判不了"不冒充"错"）；
 * ★ 断言不成立 / 没抛预期的错 / budget 超时 ⇒ `fail`，且 `at` 指到具体那一步。
 */
export async function runCaseProgram(input: {
  projectRoot: string;
  file: string;
  symbol: string;
  testCase: CaseProgram;
  /** budget 之外的宽限（毫秒，默认 250）：只用于把"超时"与"真慢"分开报 */
  slackMs?: number;
}): Promise<CaseRunResult> {
  const abs = path.join(input.projectRoot, input.file);
  const detail: string[] = [];
  if (!fs.existsSync(abs)) return { status: 'unsupported', detail: [`${input.file} 不存在`] };

  // ── ① 加载模块（只 await 顶层 import；不做 Promise 链编排）──
  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(abs).href)) as Record<string, unknown>;
  } catch (e) {
    return { status: 'unsupported', detail: [`模块加载失败 ⇒ 判不了：${(e as Error).message}`] };
  }
  const targetSym = mod[input.symbol] ?? (mod['default'] as Record<string, unknown> | undefined)?.[input.symbol];
  if (targetSym === undefined) {
    return { status: 'unsupported', detail: [`${input.file} 里没有导出 ${input.symbol} ⇒ 判不了`] };
  }

  const c = input.testCase;
  const budgetMs = c.budget?.ms;
  const slack = input.slackMs ?? 250;
  const started = Date.now();

  /** 主体：构造 → 逐步调用 → effects 断言 */
  const body = async (): Promise<CaseRunResult> => {
    // ★★ 2026-11-09（实测抓到的假绿）：effects 若只看"文件存在/含子串"，
    //   上一次运行残留的产物会把它**满足掉**（撤掉写盘那行，契约仍然 pass）。
    //   所以断言前先清掉**声明要写**的目标（只碰 effects 里点名的路径；`absent` 的同理）。
    for (const ef of c.effects ?? []) {
      const rel = (ef as Record<string, unknown>)['writes'];
      if (typeof rel !== 'string' || !rel) continue;
      const target = path.isAbsolute(rel) ? rel : path.join(input.projectRoot, rel);
      try {
        fs.rmSync(target, { force: true });
      } catch {
        /* 删不掉就让它按"存在"判 —— 结果是 fail，不会假绿 */
      }
    }

    let instance: unknown;
    try {
      instance = Array.isArray(c.ctor) ? new (targetSym as new (...a: unknown[]) => unknown)(...c.ctor) : targetSym;
    } catch (e) {
      return { status: 'fail', at: 'ctor', detail: [`构造实例抛错：${(e as Error).message}`] };
    }

    let threw: Error | null = null;
    let lastValue: unknown;
    const steps = c.steps ?? [];

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const at = s.method ? `第 ${i + 1} 步（method=${s.method}）` : `第 ${i + 1} 步`;
      const fn =
        s.method === undefined
          ? (instance as (...a: unknown[]) => unknown)
          : (instance as Record<string, unknown>)[s.method];
      if (typeof fn !== 'function') {
        return { status: 'fail', at, detail: [`${at}：目标上没有可调用的 ${String(s.method ?? '(函数本身)')}`] };
      }
      try {
        let out = (fn as (...a: unknown[]) => unknown).apply(instance, s.args ?? []);
        if (isThenable(out)) out = await out; // ★ 异步支持：只 await 顶层
        lastValue = out;
      } catch (e) {
        threw = e as Error;
        // 抛错可能是"预期行为"（throws）⇒ 这里先记下，交给下面判定
        break;
      }
      if (s.expect !== undefined && !sameExpect(lastValue, s.expect)) {
        return {
          status: 'fail',
          at,
          detail: [`${at}：期望 ${canon(s.expect)}，实得 ${canon(lastValue)}`],
        };
      }
    }

    // ── throws：期望抛错却没抛 / 抛了但消息不对 ──
    if (c.throws) {
      if (!threw) {
        return { status: 'fail', at: 'throws', detail: [`期望抛错（消息含 "${c.throws.messageContains}"），实际没有抛`] };
      }
      const msg = String(threw.message ?? '');
      if (!msg.includes(c.throws.messageContains)) {
        return {
          status: 'fail',
          at: 'throws',
          detail: [`抛错消息不含 "${c.throws.messageContains}"，实得："${msg}"`],
        };
      }
      detail.push(`throws ✓ 消息含 "${c.throws.messageContains}"`);
    } else if (threw) {
      return { status: 'fail', at: 'steps', detail: [`未声明 throws，但第 ${steps.length} 步范围内抛错："${threw.message}"`] };
    }

    // ── effects：真发生了吗 / 不该发生的发生了吗 ──
    for (let i = 0; i < (c.effects?.length ?? 0); i++) {
      const e = c.effects![i] as Record<string, unknown>;
      const at = `effects[${i}]`;
      if (typeof e['handles'] === 'string') {
        // 进程内状态：从实例上按路径取
        const actual = readPath(instance, e['handles']);
        if (!sameExpect(actual, e['equals'])) {
          return { status: 'fail', at, detail: [`${at}：${e['handles']} 期望 ${canon(e['equals'])}，实得 ${canon(actual)}`] };
        }
        detail.push(`${at} ✓ handles ${e['handles']} = ${canon(actual)}`);
        continue;
      }
      const rel = String(e['writes'] ?? '');
      if (!rel) return { status: 'unsupported', at, detail: [`${at}：effects 里既没有 writes 也没有 handles`] };
      const fileAbs = path.isAbsolute(rel) ? rel : path.join(input.projectRoot, rel);
      const exists = fs.existsSync(fileAbs);
      if (e['absent'] === true) {
        if (exists) return { status: 'fail', at, detail: [`${at}：不该写 ${rel}，但它存在`] };
        detail.push(`${at} ✓ ${rel} 不存在（符合 absent）`);
        continue;
      }
      if (!exists) return { status: 'fail', at, detail: [`${at}：${rel} 不存在（副作用没发生）`] };
      if (typeof e['mustContain'] === 'string') {
        const text = fs.readFileSync(fileAbs, 'utf-8');
        if (!text.includes(e['mustContain'])) {
          return { status: 'fail', at, detail: [`${at}：${rel} 不含 "${e['mustContain']}"，实得前 120 字：${text.slice(0, 120)}`] };
        }
        detail.push(`${at} ✓ ${rel} 含 "${e['mustContain']}"`);
      } else {
        detail.push(`${at} ✓ ${rel} 已写`);
      }
    }

    return { status: 'pass', detail: [...detail, `耗时 ${Date.now() - started}ms`] };
  };

  // ── ② budget：超时 ⇒ fail（不是崩溃、不是 unsupported）──
  if (typeof budgetMs === 'number' && budgetMs > 0) {
    const timeout = new Promise<CaseRunResult>((resolve) => {
      const t = setTimeout(() => {
        resolve({
          status: 'fail',
          at: 'budget',
          detail: [`budget 超时：本次调用超过 ${budgetMs}ms（宽限 ${slack}ms 只用于区分"真慢"）`],
        });
      }, budgetMs + slack);
      t.unref?.();
    });
    const r = await Promise.race([body(), timeout]);
    if (r.at === 'budget' && r.status === 'fail') return r;
    if (Date.now() - started > budgetMs && r.status === 'pass') {
      return { status: 'fail', at: 'budget', detail: [`budget 超限：实耗 ${Date.now() - started}ms > ${budgetMs}ms`] };
    }
    return r;
  }
  return body();
}
