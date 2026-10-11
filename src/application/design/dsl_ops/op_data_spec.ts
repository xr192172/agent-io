/**
 * `edit_dsl` 各 `type`/`op` 的 **data 契约表**（唯一判据）。
 *
 * ## 为什么要有它（★ 2026-10-11 T170 —— 有【代价读数】的缺口）
 * 黑盒实验（一个**不许读源码**的子代理走完整工作流）实测：
 * **24 次调用里 8 次失败/被拒（33%）**，而它们**全是"试形状"** ——
 * 它原话：*"我按 describe 猜…… → 空参试跑被回执一句 `insert 需要 code（新代码）` 直接点名。
 * **也是回执救的场。**"*
 * ⇒ 根因：**"某个 `type`/`op` 需要哪些 `data` 字段"此前只以【散落的命令式 throw】存在**
 *   （`update_feature.ts` 里 19 处 `if (!op.data?.X) throw`）⇒ ★ **LLM 看不见**，
 *   只能**故意发一个残缺请求、读报错**来发现字段 —— 每次一个字段，一次调用。
 *
 * ## 判据一处（照本仓头号纪律）
 * 本表是**唯一来源**，两个出口都从它派生：
 *   1. **`checkOpSpec(op)`** —— `applyOperation` 的入口校验（**CLI 面也走这里**，见 `plumbing` 的说明：
 *      "CLI 不做 zod 校验" ⇒ 所以守卫必须在 [B]，不能只放在 zod schema 里）；
 *   2. **`renderOpSpecs()`** —— 渲染进 `edit_dsl` 的 `description`（**LLM 一定会看到的地方**）。
 * ★ **不许**再在别处写"某 type 需要某字段"的第二份清单（那正是本仓头号病根）。
 *
 * ## 范围（★ 说清不做什么，免得读端以为"全在这"）
 * · 本表管**形状**（该给哪些键、哪个键必须非空）——
 *   ★ **不管语义**（"这个 node_id 存在吗" / "这个 status 值合法吗" 仍在各自的 `[B]` 里）。
 * · ★★ **不管"可选字段字典"**：`node.add` 的领域字段（`label`/`type`/`status`/`decision`/`shapes`…）
 *   大多**可选** ⇒ 它们的问题不是"必需"而是"**有哪些**" ⇒ ★ 那一半**本表没覆盖**，
 *   记为下一笔（见 `docs/todo.md` T170）。本表在 `note` 里给出**指路**。
 */

/** 一条 `(type, op)` 的 data 契约。 */
export interface OpSpec {
  /** `operations[].type` */
  type: string;
  /** 该 type **合法**的 `op` 全集（★ 一处；替代原先散落的 `if (op.op !== 'x') throw`） */
  ops: string[];
  /** 是否必须给 `operations[].id` */
  idRequired: boolean;
  /**
   * ★ `id` **到底填什么**（只在该 type 特殊时写）。
   * ★★ 为什么要它（T171 实测）：「`id` 是节点 id 还是路径」**各 type 不一样** ——
   *   我一度在报错里写死成「文件节点 id **或**仓库相对路径」，而那是照 `decision` 的说明抄的通用句
   *   ⇒ **`api` 并不吃路径** ⇒ 黑盒实验里 agent 照它填了路径 ⇒ `文件 "src/mathutil.ts" 不存在` ✗
   *   ⇒ 现在**按 type 各自声明**，报错文案**从本字段派生**（仍是判据一处）。
   */
  idNote?: string;
  /** 【按 op 细分】的必需 data 键：`op → 键名清单`（未列出的 op ⇒ 无必需键） */
  required: Record<string, string[]>;
  /** 【按 op 细分】的"至少给一组"：`op → 若干组，每组内全部要给` */
  anyOf?: Record<string, string[][]>;
  /** 人读补充（进描述；★ 只写本表管不了的那部分，别写成第二份判据） */
  note?: string;
}

/**
 * ★ **唯一判据表**。改这里 = 改判据（校验与描述同时跟着变）。
 * 每条的 `required` 逐条对照过改动前的 `if (!op.data?.X) throw`（见提交信息里的对照表）。
 */
export const OP_SPECS: readonly OpSpec[] = [
  {
    type: 'node',
    ops: ['add', 'update', 'delete', 'move'],
    idRequired: true,
    required: { move: [] },
    note: 'add/update 的**领域字段**（label / type / status / description / decision / shapes / x,y,width,height…）**大多可选** —— 见 `add_node` 的字段表（★ 那一半本表不覆盖）',
  },
  { type: 'edge', ops: ['add', 'update', 'delete'], idRequired: true, required: { add: ['from', 'to'] } },
  { type: 'file', ops: ['add', 'update', 'delete'], idRequired: true, required: { add: ['path', 'responsibility'] } },
  {
    type: 'api',
    ops: ['add', 'update', 'delete'],
    idRequired: true,
    idNote: '所属 `file` 节点的 id（★ **不是路径** —— 实测填路径会报「文件不存在」）',
    required: { add: ['signature'], delete: ['signature'] },
    anyOf: { update: [['expected_apis'], ['signature']] },
    note: '`update` 二选一：① **整块重写** `data.expected_apis=[{signature,notes?},…]`（**推荐**，不看旧串）；② 单条改 `data.signature`=**原签名串逐字**',
  },
  { type: 'binding', ops: ['update'], idRequired: true, required: { update: ['file_id'] } },
  { type: 'status', ops: ['update'], idRequired: true, required: { update: ['status'] } },
  {
    type: 'annotation',
    ops: ['add', 'resolve'],
    idRequired: false,
    required: { add: ['text'], resolve: ['annotation_id'] },
  },
  {
    type: 'approval',
    ops: ['submit', 'review'],
    idRequired: false,
    required: { submit: ['annotation_id'], review: ['annotation_id', 'decision', 'reviewer'] },
  },
  {
    type: 'snapshot',
    ops: ['save', 'rollback', 'delete'],
    idRequired: false,
    required: { save: ['label'], rollback: ['snapshot_id'], delete: ['snapshot_id'] },
  },
  {
    type: 'layout',
    ops: ['apply'],
    idRequired: false,
    required: {},
    note: '`data.algo` 可选（dag | force | grid，缺省 dag）；另有 direction / h_gap / v_gap 可选',
  },
  { type: 'simulation', ops: ['reset'], idRequired: false, required: {} },
  { type: 'tag', ops: ['add', 'delete'], idRequired: false, required: { add: ['tag'], delete: ['tag'] } },
  {
    type: 'decision',
    ops: ['update'],
    idRequired: true,
    idNote: '文件/文档节点 id **或**仓库相对路径（`resolveDecisionTarget` 两种都认）',
    required: { update: ['summary'] },
    note:
      '★ **`data` 各字段的形状（2026-10-11 T174 从实现逐个读出 —— 照填）**：' +
      '`rationale` / `consequences` / **`acceptance`** / `thread` = **字符串**（★ **不是数组**）· ' +
      '`votes` = 数字 · `evidence_source` / `tags` = **字符串数组** · ' +
      '`status` = `active`｜`superseded`｜`draft` · `author` = `human`｜`llm` · ' +
      '`dissent` / `alternatives` = 对象数组（`alternatives` 每项要 `rejected_because`：它是"**被否掉的方案 + 原因**"，没裁定的分歧请放 `dissent`）',
  },
];

const BY_TYPE = new Map(OP_SPECS.map((s) => [s.type, s]));

/**
 * ★ **校验通过后的 op**（2026-10-11 T170）——
 * 与传入时的唯一区别：**`data` 一定存在**（校验保证了形状 ⇒ 规范化成 `Record`）。
 *
 * ★ 为什么用**泛型**（而不是一个固定 interface）：调用方的 `op` 有**联合类型**（`FeatureOperation['op']`
 *   是 `'add' | 'update' | …`）；固定 interface 会把它们**拉宽成 `string`** ⇒ 调用方拿到它反而**丢类型**。
 *   ⇒ 泛型能**原样保留调用方的形状**，只在上面补一个"`data` 必有" ✓
 *
 * ★ 为什么要这个"必有 data"的类型：原先那些 `if (!op.data?.X) throw` **同时兼任两职** ——
 *   ① 运行时守卫；② **TS 的类型收窄**（`if (!data.signature) throw` 之后 TS 知道它是 `string`）。
 *   把它们收进本表后 ② 就丢了 ⇒ ★ 别在 15 处各写 `as`，而是**让校验函数返回这个窄类型** ✓
 * ★ `id` **不在这里承诺必有**：`idRequired:false` 的 type（annotation / approval / snapshot / layout /
 *   simulation / tag）本来就不用 id ⇒ ★ 声明成必有会是**撒谎**（本仓反对的"过度断言"）。
 */
export type CheckedOperation<T extends FeatureOperationLike> = T & { data: Record<string, unknown> };

/** 只取校验需要的四个字段（避免让 `op_data_spec` 依赖 `FeatureOperation` 的全部形状）。 */
export interface FeatureOperationLike {
  type: string;
  op: string;
  id?: string;
  data?: Record<string, unknown>;
}

/**
 * 校验一条 operation 的 `type`/`op`/`id`/`data` 形状。**不合法就抛**（失败就是失败，不降级）。
 * ★ 报错里**点名该给哪些键**（照黑盒实验里"回执救场"的经验：错误信息就是最好的文档）。
 * ★ 通过 ⇒ 返回 {@link CheckedOperation}（`data` 已规范化成必有；**其余形状原样保留**）。
 */
export function checkOpSpec<T extends FeatureOperationLike>(op: T): CheckedOperation<T> {
  const type = String(op.type ?? '');
  const spec = BY_TYPE.get(type);
  if (!spec) {
    throw new Error(
      `未知操作类型: "${type}"。合法值（${OP_SPECS.length}）: ${OP_SPECS.map((s) => s.type).join(' / ')}`,
    );
  }
  const o = String(op.op ?? '');
  if (!spec.ops.includes(o)) {
    throw new Error(
      `${type} 不支持操作 "${o}" —— 它只支持: ${spec.ops.join(' / ')}` +
        (spec.note ? `\n★ ${type} 补充：${spec.note}` : ''),
    );
  }
  if (spec.idRequired && !op.id) {
    throw new Error(`${type}.${o} 需要 id${spec.idNote ? `（${spec.idNote}）` : ''}`);
  }
  const data = (op.data ?? {}) as Record<string, unknown>;
  const missing = (spec.required[o] ?? []).filter((k) => {
    const v = data[k];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (missing.length > 0) {
    throw new Error(`${type}.${o} 需要 data.${missing.join(' 和 data.')}（★ 该 type 的完整字段表见 edit_dsl 描述里的「data 契约」段）`);
  }
  const groups = spec.anyOf?.[o];
  if (groups && !groups.some((g) => g.every((k) => data[k] !== undefined && data[k] !== null))) {
    throw new Error(
      `${type}.${o} 需要**至少给一组**：${groups.map((g) => g.map((k) => `data.${k}`).join(' + ')).join('　或　')}` +
        (spec.note ? `\n★ ${type} 补充：${spec.note}` : ''),
    );
  }
  // ★ 校验通过 ⇒ 交给调用方的 op **`data` 已规范化成必有**（类型也随之收窄，见 CheckedOperation）
  return { ...op, data };
}

/**
 * 把整张表渲染成**给人/LLM 读的一段**（进 `edit_dsl` 的 `description`）——
 * ★ 判据仍是上面那张表（这里只渲染，不新增规则）。
 */
export function renderOpSpecs(): string {
  const lines: string[] = [];
  for (const s of OP_SPECS) {
    const parts = s.ops.map((o) => {
      const req = s.required[o] ?? [];
      const any = s.anyOf?.[o];
      const bits: string[] = [];
      if (s.idRequired) bits.push('id');
      if (req.length) bits.push(`data.${req.join(' + data.')}`);
      if (any) bits.push(any.map((g) => `data.${g.join(' + data.')}`).join(' 或 '));
      return bits.length ? `${o}（需 ${bits.join('；')}）` : `${o}（无必需字段）`;
    });
    lines.push(`  · ${s.type}: ${parts.join(' ｜ ')}`);
    // ★ `id` 的语义**按 type 说一次**（不在每个 op 里重复 —— 那会把描述撑肿）
    if (s.idRequired && s.idNote) lines.push(`      ★ id = ${s.idNote}`);
    if (s.note) lines.push(`      ★ ${s.note}`);
  }
  return lines.join('\n');
}
