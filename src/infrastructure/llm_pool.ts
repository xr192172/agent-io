/**
 * llm_pool —— 多 key 轮换池的**共享实现**（状态机：轮转指针 + 每把 key 的冷却窗口）。
 *
 * 原住在 `authoring/translate/llm.ts`（fork 自 dsh-brain key-pool-proxy 的客户端内联版）。
 * 2026-10-10 抽出为共享模块：**翻译线**（translate/llm）与**会话线**（llm_focus.callChat）
 * 共用**同一份**「选 key / 冷却 blockedUntil / 换 key 重试」的状态机，不再各写一份。
 *
 * ★ 本模块只放**与具体上游/协议无关**的池机制；上游地址、模型、读哪个 env 由调用方
 *   （`llm_focus` 的 `resolveAgnes*`）决定 —— 这样"上游/key池/模型"仍只有**一处**解析。
 */

/** 多 key 轮换池（round-robin + 冷却窗口） */
export class KeyPool {
  private ptr = 0;
  private blockedUntil: number[];
  constructor(readonly keys: string[]) {
    this.blockedUntil = new Array(keys.length).fill(0);
  }
  get length(): number {
    return this.keys.length;
  }
  /** 取一个未冷却的 key 下标；全冷却返回 -1 */
  pick(now: number): number {
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.ptr + i) % this.keys.length;
      if (this.blockedUntil[idx] <= now) {
        this.ptr = (idx + 1) % this.keys.length;
        return idx;
      }
    }
    return -1;
  }
  hasAvailable(now: number): boolean {
    return this.blockedUntil.some((t) => t <= now);
  }
  cooldown(idx: number, now: number, ms: number): void {
    this.blockedUntil[idx] = now + ms;
  }
}

/**
 * 从主池 env + 回退 env 读取去重 key 列表。
 * env 名由调用方给（如 `AGNES_KEY_POOL` / `AGNES_API_KEY`）—— 本模块不写死任何具体 env 名。
 */
export function loadKeys(poolEnv: string, fallbackEnvs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string): void => {
    for (const raw of value.split(',')) {
      const k = raw.trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  };
  const main = process.env[poolEnv];
  if (main) add(main);
  for (const e of fallbackEnvs) {
    const v = process.env[e];
    if (v) add(v);
  }
  return out;
}
