/**
 * todo_chain.ts —— **跑环继任链**（todo 的 `follows`）：怎么读、怎么判、怎么显示。
 *
 * ## 它回答的问题（用户 2026-10-21 原话）
 * 「有些任务要不要设计成**跑环任务**？完成一环、完成二环、完成三环。
 *   就是说**做完了之后发现还有新的，那就直接再在这个下面登记第二步、第三步、第四步**。」
 *
 * ★ 立本文件之前的事实（实测，不是推测）：`todo.link` 的 `data.node_id` 只把 todo 挂到
 *   【设计节点】（`TaskSpec.node_id`），`task.reopen/relaunch` 是「重开**同一张**卡」——
 *   ⇒ **没有任何字段能表达 todo → todo 的继任关系**。当时的替代品是人在 `summary` 里手写
 *   「取代 xxx」，而 2026-10-21 真的因此立了三张**方向互相矛盾**的卡。
 *
 * ## 形状：**一条链，不是一棵树**（`follows` = 父 todo 的 **id 单指针**）
 * 单指针 ⇒ 「上一环是谁」只有一个答案 ⇒ 「第几环」也只有一个答案。
 * ★ **但允许一个父有多个子环**（做完一环发现两个新问题，是常态）：多子环不会让环次含糊
 *   （`depth` 只看**自己那条父指针**），含糊的只是「哪条是主线」—— 那由 `mainChain` 一处定义。
 *
 * ## ★ 主链为什么是**派生**的（而不是落一个 `main: true`）
 * **主链 = 每一环取【册上最早登记】的那个子环**（`todos[]` 的数组顺序 = `add` 顺序）。
 * ★ 落 `main` 标志 = 第二份权威：父改了子、子又改父，两边必然打架；而「最早登记的那条」
 *   是**从册上现算**的（`buildTodoChains`），改不了、也不用对账。
 *
 * ## ★★★ 无环（本仓 `docs/GUIDE-GATE.md §4.8`：自写门只留给编译器查不了的 —— 图的**无环**正是其一）
 * `follows` 一旦成环（A→B→C→A），**每条环都有一个爹、谁也不在顶上** ⇒ 「第几环」永远算不出来。
 * ⇒ 写端**拒**（`assertFollowsTarget` 的唯一判据），读端**兜底标出来**（`TodoChains.cycles`，
 *   只可能是手改 JSON 造成 —— 写端本该拦住，但读端不许「假装没这回事」）。
 *
 * ## ★ 链断了：`void` 不等于 `done`
 * 中间一环作废（`void`）后，**后面的环仍在册、仍然有效**（★ **不级联作废** —— 那会杀掉
 * 可能仍然有效的活），只是展示里标一句「上一环已作废」。判据 = 最近的 `void` **祖先**（`broken`）。
 * ★ 与 `done` 的差别：`done` 是正常走过的环，链照常往下走，不算断。
 *
 * ## 边界（它**不**做什么）
 * · 不改卡、不判可领性、不判证据 —— 只做**读侧的链位置计算**与**写侧的入口校验**；
 * · 不把链位置落盘（`depth` / `total` / `children` 全是现算 ⇒ 没有第二份真相）。
 */
import type { TaskSpec, TaskState } from './task_schema.js';

/** 算链只需要卡的这几个字段（★ 用结构类型，别把整张 TaskSpec 拖进来）。 */
export type ChainCard = Pick<TaskSpec, 'id' | 'summary' | 'state' | 'follows'> &
  Pick<Partial<TaskSpec>, 'retire_reason'>;

/**
 * 一张卡在链上的**位置**（全部现算，不落盘）。
 * ★ 四个问号各有一格：① `parent` ② `children` ③ `depth`/`total` ④ `broken`。
 */
export interface ChainPlace {
  id: string;
  /** ① 上一环（= 卡上的 `follows`；链根 ⇒ 缺省） */
  parent?: string;
  /** ② 直接下一环（★ 册上顺序；`children[0]` = 主链那一环，其余 = 支环） */
  children: string[];
  /** ③ 本环序号（1 起；根 = 1） */
  depth: number;
  /** ③ 主链总环数（从根沿 `children[0]` 走到头；支环的 depth 可能 > total，那说明它在支线上） */
  total: number;
  /** ③ 链根 id（没有 follows 的那一环） */
  root: string;
  /** ③ 自己是不是**支环**（父有多个子环，而自己不是最早那个） */
  branch: boolean;
  /** ④ 最近的**作废祖先**（`void`）—— 有值 = 这条链在**上面**断了，但本环仍成立 */
  broken?: { id: string; hops: number; reason?: string };
  /** ④ `follows` 指向册上不存在的 id（只可能来自手改 JSON ⇒ 读端如实标，不当成根） */
  dangling?: string;
  /** ④ 本卡落在一条**环**上（写端本该拦住；手改 JSON 才会出现） */
  cycle?: boolean;
}

/** 一整册 todo 的链索引（`buildTodoChains` 的产物，读端唯一入口）。 */
export interface TodoChains {
  /** id → 位置（★ 每张卡都有，孤立卡 = depth 1 / total 1 / children []） */
  places: Map<string, ChainPlace>;
  /** 链根 id → 这条链上的**全部**卡（主链在前，按 depth 升序；同深按册上顺序） */
  chains: Map<string, string[]>;
  /** 册上真的成环的那些圈（每项 = 环上 id 依次 + 回到起点） */
  cycles: string[][];
  /** `follows` 指向不存在的 id 的卡（悬挂引用） */
  dangling: Array<{ id: string; follows: string }>;
}

/**
 * 给一整册 todo 算链索引。
 *
 * ★ **纯函数**：同一册两次调用结果逐字相同（节点顺序只看 `cards` 的数组顺序）⇒
 *   可以作读端（`query=todo`）与写端（`complete` 提示）**共用的那把尺**，而不是各算一遍。
 * ★ 复杂度 O(n·h)：每张卡沿父指针走到根（h = 链长）；没有邻接矩阵、没有递归全景扫描。
 */
export function buildTodoChains(cards: readonly ChainCard[]): TodoChains {
  const byId = new Map<string, ChainCard>(cards.map((c) => [c.id, c]));
  const order = new Map<string, number>(cards.map((c, i) => [c.id, i]));

  /** ② 父 → 子（★ 只收**册上真有**的父；悬挂引用进 `dangling`，不凭空造一个根节点出来） */
  const children = new Map<string, string[]>();
  for (const c of cards) children.set(c.id, []);
  const dangling: Array<{ id: string; follows: string }> = [];
  for (const c of cards) {
    if (!c.follows) continue;
    if (!byId.has(c.follows)) {
      dangling.push({ id: c.id, follows: c.follows });
      continue;
    }
    children.get(c.follows)!.push(c.id);
  }

  // ③ 环次：沿父指针向上走（★ memo 化，避免 O(n²)）；同时**认出环**。
  const depthOf = new Map<string, number>();
  const rootOf = new Map<string, string>();
  const cyclic = new Set<string>();
  const cycles: string[][] = [];
  const stack: string[] = [];

  const visit = (id: string): { depth: number; root: string } => {
    const memo = depthOf.get(id);
    if (memo !== undefined) return { depth: memo, root: rootOf.get(id)! };
    const card = byId.get(id)!;
    const parentId = card.follows && byId.has(card.follows) ? card.follows : undefined;
    if (!parentId) {
      depthOf.set(id, 1);
      rootOf.set(id, id);
      return { depth: 1, root: id };
    }
    // ★ 成环：父在这一趟的栈上（或父本身已被判进过环）⇒ 环圈出来，环上的卡**拿不到环次**
    const at = stack.indexOf(parentId);
    if (at >= 0 || cyclic.has(parentId)) {
      const ring = at >= 0 ? stack.slice(at) : [parentId];
      for (const x of [...ring, id]) cyclic.add(x);
      if (at >= 0) cycles.push([...ring, id, ring[0]]);
      depthOf.set(id, 1);
      rootOf.set(id, id);
      return { depth: 1, root: id };
    }
    stack.push(id);
    const up = visit(parentId);
    stack.pop();
    depthOf.set(id, up.depth + 1);
    rootOf.set(id, up.root);
    return { depth: up.depth + 1, root: up.root };
  };
  for (const c of cards) visit(c.id);

  // ③ 主链总长：从根沿 `children[0]` 走到头（★ 环上卡不参与 —— 它们没有可靠的根）
  const totalOf = (root: string): number => {
    let cur = root;
    let n = 1;
    const seen = new Set<string>([root]);
    for (;;) {
      const next = (children.get(cur) ?? [])[0];
      if (!next || seen.has(next)) break;
      seen.add(next);
      cur = next;
      n++;
    }
    return n;
  };
  const totals = new Map<string, number>();

  const places = new Map<string, ChainPlace>();
  for (const c of cards) {
    const root = rootOf.get(c.id)!;
    if (!totals.has(root)) totals.set(root, totalOf(root));
    const kids = children.get(c.id) ?? [];
    const parent = c.follows && byId.has(c.follows) ? c.follows : undefined;
    const rank = parent ? (children.get(parent) ?? []).indexOf(c.id) : 0;

    // ④ 最近的作废祖先（★ 只认 `void`；`done` 是正常走过的环，不算断链）
    let broken: ChainPlace['broken'];
    let p = parent;
    let hops = 1;
    const seen = new Set<string>([c.id]);
    while (p && byId.has(p) && !seen.has(p)) {
      seen.add(p);
      const pc = byId.get(p)!;
      if (pc.state === 'void') {
        broken = { id: p, hops, ...(pc.retire_reason ? { reason: pc.retire_reason } : {}) };
        break;
      }
      p = pc.follows;
      hops++;
    }

    places.set(c.id, {
      id: c.id,
      ...(parent ? { parent } : {}),
      children: kids,
      depth: depthOf.get(c.id)!,
      total: totals.get(root)!,
      root,
      branch: rank > 0,
      ...(broken ? { broken } : {}),
      ...(c.follows && !byId.has(c.follows) ? { dangling: c.follows } : {}),
      ...(cyclic.has(c.id) ? { cycle: true } : {}),
    });
  }

  // 分组：链根 → 卡（主链在前：depth 升序，同深按册上顺序 —— ★ 顺序由数组下标决定，不靠字符串比大小）
  const chains = new Map<string, string[]>();
  for (const c of cards) {
    const root = rootOf.get(c.id)!;
    const arr = chains.get(root) ?? [];
    arr.push(c.id);
    chains.set(root, arr);
  }
  for (const [root, ids] of chains) {
    ids.sort((a, b) => {
      const da = places.get(a)!.depth;
      const db = places.get(b)!.depth;
      if (da !== db) return da - db;
      return (order.get(a) ?? 0) - (order.get(b) ?? 0);
    });
    // ★ 根排最前（环上的卡 depth 也被压成 1，靠册上顺序会把根挤到中间）
    const at = ids.indexOf(root);
    if (at > 0) {
      ids.splice(at, 1);
      ids.unshift(root);
    }
  }

  return { places, chains, cycles, dangling };
}

/**
 * 一行链位置徽标 —— ★ **只有这一处**拼「第几环」（`complete` 的提示与 `query=todo` 共用）。
 *
 * 形态：
 * · 主链上的环 ⇒ `环 2/3`；
 * · 支环　　　 ⇒ `环 2 · 支环（主链 1/3 分出的）`；
 * · 链在**上面**断了 ⇒ 追加 ` ⚠ 上一环已作废(todo_x)`（★ 不级联作废，只标）。
 */
export function chainBadge(place: ChainPlace): string {
  if (place.cycle) return `环 ?（成环：${place.id} 的父链回到自己）`;
  if (place.dangling) return `环 1 · 悬挂（follows=${place.dangling} 不在册上）`;
  const head = place.branch ? `环 ${place.depth} · 支环` : `环 ${place.depth}/${place.total}`;
  const broken = place.broken ? ` ⚠ 上一环已作废(${place.broken.id}${place.broken.hops > 1 ? `，隔 ${place.broken.hops} 跳` : ''})` : '';
  return head + broken;
}

/**
 * **写端入口校验**（`todo.add data.follows` 与 `todo.follows` 的唯一判据）。
 *
 * 四条，任一不过就抛（★ 不降级成「先建了再说」—— 那会让册上出现一批解释不了的链）：
 * 1. **自指**：`follows === 自己` ⇒ 拒（第一步就没有「上一环」）；
 * 2. **悬挂**：父 id 不在册上 ⇒ 拒（G）；
 * 3. **接到作废的卡下面** ⇒ 拒（那条链已经断了；要接就接在它**还活着的前一环**）；
 * 4. **成环**：沿父指针向上能走回自己 ⇒ 拒（H；环会让「第几环」永远算不出来）。
 *
 * ★ 为什么不做「自动挂到最近的活祖先」这种聪明事：那会让调用方**以为**自己接的是 X，
 *   实际接的是 Y —— 链的位置必须由人明说，工具只负责判它成不成立。
 */
export function assertFollowsTarget(
  cards: readonly ChainCard[],
  childId: string,
  parentId: string,
): void {
  const byId = new Map<string, ChainCard>(cards.map((c) => [c.id, c]));
  if (parentId === childId) {
    throw new Error(
      `follows 被拒：${childId} **不能跟着自己** —— 自指会让「第几环」从第一步就没有答案。\n` +
        `★ 第一环不要给 follows（它就是链根）；要给就指向**上一环的 id**。`,
    );
  }
  const target = byId.get(parentId);
  if (!target) {
    throw new Error(
      `follows 被拒：册上没有 \"${parentId}\"（悬挂引用）—— 链只能接在**册上真有的卡**下面。\n` +
        `★ 两条常见来路：① id 记错 ⇒ get_dsl query=todo state=all 拿一遍当前 id；\n` +
        `  ② 它刚被 todo.delete 物理删 ⇒ 册上**故意**没有它了（墓碑在 <feature>.journal.jsonl）。`,
    );
  }
  if (target.state === 'void') {
    throw new Error(
      `follows 被拒：上一环 \"${parentId}\" **已作废**（state=void` +
        (target.retire_reason ? `：${target.retire_reason}` : '') +
        `）—— 不能在作废的卡下面接新环，那条链已经断了。\n` +
        `★ 两条正路：① 接在它**还活着的前一环**（${target.follows ?? '（它自己就是链根）'}）；\n` +
        `  ② 这确实是一件新活 ⇒ 不给 follows，另起一条链。`,
    );
  }
  // ★ 成环：沿父指针向上走到 childId ⇒ 拒。★ 同时防「册上本来就有环」时死循环（seen）。
  const trail: string[] = [parentId];
  const seen = new Set<string>([parentId]);
  let cur = target.follows;
  while (cur) {
    if (cur === childId) {
      throw new Error(
        `follows 被拒：会**成环** —— ${childId} → ${parentId} → … → ${childId}` +
          `（现路径：${[...trail].reverse().join(' ← ')} ← ${childId}）。\n` +
          `★ 为什么必须拒：链上一旦成环，每一环都有一个上一环、**谁也不在顶上** ⇒ 「第几环」永远算不出来。\n` +
          `  （依据 docs/GUIDE-GATE.md §4.8：自写门只留给编译器查不了的 —— 图的**无环**正是其一。）`,
      );
    }
    if (seen.has(cur)) break;
    seen.add(cur);
    trail.push(cur);
    cur = byId.get(cur)?.follows;
  }
}
