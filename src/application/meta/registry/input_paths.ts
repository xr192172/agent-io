/**
 * `inputSchema` 的**深层入参路径表**（纯函数，零 import）—— `next_hop_args` / `first_hop_args` /
 * `renderHandoffPanel` / `server_registry` 的接续段共用这一把尺。
 *
 * ★ 2026-11-19（延迟簇 A · 元数据/实现分家）：原先住 `capability_map.ts`。搬到零依赖叶子后，
 *   `meta/index.ts`（`renderHandoffPanel` 是**同步**导出函数，不能 await 动态 import）才不必在模块求值期
 *   拖进 `capability_map → scan_authorities → storage` 那条 400 ms 的实现图。口径**一个字节都没改**
 *   （整段原样搬移），`capability_map` 仍 re-export（公开 API 不动）。
 */
/**
 * ★★★ 一个 [B] 声明入参的**深层路径**表（含**必填与否** + **容器与否** + **下游自己的说明**）。
 *
 * ## 为什么需要它（`collectInputKeys` / `collectRequiredKeys` 不够用）
 * 那两个只给**扁平名字**与**顶层必填**：`rename_symbols` 得到 `renames`（一个**容器**名），
 * 而"`renames[]` 里的 `to` 是不是必填"这件事**丢了** ⇒ 无法据此拼出一个**可跑的入参 JSON**
 * （`next_hop_args` 的职责：能填的填、意图位**显式留空并标注** —— 见
 * `application/meta/explore/next_hop_args.ts`）。
 * ★ 路径形态**刻意与 `CHAIN_EDGES.toPath` 同形**（数组元素用 `[]`）⇒ 两边能**逐字比对**，
 *   不必在这里再定一套"路径怎么写"（本仓头号病：一处判断住两处）。
 *
 * ## 与 `collectInputKeys` 同一套遍历口径（v3 与 v4 取并集）
 *   · v4：`_def.type` 是**类型名字符串**，数组元素在 `_def.element`、对象体在 `_def.shape`；
 *   · v3：`_def.typeName` 是 `ZodArray` / `ZodObject`，数组元素在 `_def.type`、`shape` 可能是函数。
 *   ★ **取不到的形态直接跳过**（宁可少收，也不猜）—— 与 `collectInputKeys` 同款纪律。
 *
 * ## 必填口径**复用** {@link collectRequiredKeys} 的那一条
 * `isOptional()` 取不到 ⇒ **当作可选**（宁可少报"必填"，不凭空报必填 —— 那会逼调用方填一个不必填的字段）。
 */
export interface InputPath {
  /** 点路径；数组元素用 `[]`（如 `renames[].file`）。★ 与 `CHAIN_EDGES.toPath` **同形**。 */
  path: string;
  /** 是否必填。★ `isOptional()` 取不到 ⇒ `false`（当可选）。 */
  required: boolean;
  /** 是否是**容器**（对象 / 数组的元素对象）—— 容器本身不是"要填的槽位"，其叶子才是。 */
  container: boolean;
  /** 下游自己的说明（zod `.describe` 原样）；取不到 = 空串。 */
  description: string;
}

export function collectInputPaths(schema: unknown): InputPath[] {
  if (!schema || typeof schema !== 'object') return [];
  const out: InputPath[] = [];
  const optionalOf = (n: unknown): boolean => {
    const probe = (n as { isOptional?: () => boolean } | null)?.isOptional;
    return typeof probe === 'function' ? (n as { isOptional: () => boolean }).isOptional() : true;
  };
  const descOf = (n: unknown): string => {
    const d = (n as { description?: unknown } | null)?.description;
    return typeof d === 'string' ? d : '';
  };
  const dget = (n: unknown): Record<string, unknown> | undefined =>
    (n as { _def?: Record<string, unknown> } | null)?._def;
  const visit = (node: unknown, path: string, required: boolean, inheritedDesc: string): void => {
    let cur = node;
    let desc = descOf(cur) || inheritedDesc;
    for (let i = 0; i < 8; i++) {
      const def = dget(cur);
      if (!def) break;
      const t = def.type;
      const typeName = def.typeName;
      const isArray = t === 'array' || typeName === 'ZodArray';
      const isObject = t === 'object' || typeName === 'ZodObject';
      if (isArray) {
        // v4 元素在 `element`；v3 的 `type` 就是元素节点（与 `collectInputKeys` 同款并集）
        const el = def.element ?? (typeof t === 'object' ? t : undefined);
        const elDef = dget(el);
        const shape = elDef && (elDef.type === 'object' || elDef.typeName === 'ZodObject') ? elDef.shape : undefined;
        const shapeObj = typeof shape === 'function' ? (shape as () => unknown)() : shape;
        if (elDef && shapeObj && typeof shapeObj === 'object') {
          out.push({ path: path + '[]', required, container: true, description: desc });
          for (const [k, v] of Object.entries(shapeObj as Record<string, unknown>)) {
            visit(v, path + '[].' + k, !optionalOf(v), '');
          }
        } else if (el !== undefined && el !== null) {
          visit(el, path + '[]', required, desc);
        } else {
          out.push({ path: path + '[]', required, container: false, description: desc });
        }
        return;
      }
      if (isObject) {
        const rawShape = def.shape;
        const shapeObj = typeof rawShape === 'function' ? (rawShape as () => unknown)() : rawShape;
        if (shapeObj && typeof shapeObj === 'object') {
          out.push({ path, required, container: true, description: desc });
          for (const [k, v] of Object.entries(shapeObj as Record<string, unknown>)) {
            visit(v, path + '.' + k, !optionalOf(v), '');
          }
          return;
        }
      }
      const inner = def.innerType;
      if (inner !== undefined && inner !== null) {
        if (!desc) desc = descOf(inner);
        cur = inner;
        continue;
      }
      break;
    }
    out.push({ path, required, container: false, description: desc });
  };
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) visit(v, k, !optionalOf(v), '');
  return out;
}

/**
 * ★★★ 该路径表里**必填的槽位叶子**（容器剔除）—— 取**两种"必填"来源的并**：
 *   ① **schema 必填**（`isOptional()===false`，即 {@link collectRequiredKeys} 的口径）—— 如 `rename_symbols.renames[].to`；
 *   ② **下游自己在 `.describe` 里显式写「必填」** —— 覆盖 **zod 表达不了的模式相关必填**。
 *
 * ## 为什么必须补 ②（实测，T140，2026-10-11；这是本笔的核心）
 * `find_references` 的 `file` / `symbol` 是 **`mode=symbol` 必填**，而 **zod 里只能写成 `.optional()`**
 * （模式相关 ⇒ schema 表达不了；下游自己在 `.describe` 写「mode=symbol 必填」、并在 [B] 体里前置校验 —— 见
 * `refactor/index.ts` 该工具的两个字段说明 + `find/find_references.ts` 的 `reqStr`）。
 * ⇒ 只按 ① 判 ⇒ `find_references` **一个必填都收不到** ⇒ `next_hop_args` 报 **"意图位 0"**，
 *   而拿它的产出**真跑**却报 **"缺少必需参数 symbol"** ⇒ ★★★ **「看着备好了，其实没备好」**
 *   —— **比"没备"更坏**（没备你会去备，"备好了"你不会，而它给的是**假的信心**）。
 *
 * ## 这是"读下游自己的说明"，不是本工具凭空判必填
 * 下游在自己文本里声明"必填" ⇒ 与"意图位提示语**逐字取下游 `.describe`**"**同源**，**不新增第二份必填清单**。
 *
 * ## 已知代价（如实记，不静默）
 * `find_references.field`（`mode=field 必填`）**也会被列出** —— 因为**本函数不替你判 `mode`**。
 * ★ 这是**故意的**：本仓的坏形态是**漏列**（漏了 `symbol` ⇒ 跑不起来）；**多列一格**只是让你忽略它，
 *   而且每格的 `note` **逐字带着下游自己的条件**（"mode=field 必填：…"），调用方一眼能看出它不适用于当前 mode。
 *   ★ 与 `applyChainEdge` 在 `pick` 上**不替人选下标**是同一条立论。
 */
export function declaredRequiredMembersOf(paths: readonly InputPath[]): InputPath[] {
  return paths.filter((p) => !p.container && (p.required || /必填/.test(p.description)));
}
