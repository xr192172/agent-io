/**
 * manage_feature：feature 生命周期统一分发器（路线图序号 2 收敛）
 *
 * 聚合 create_feature / clone_feature / create_from_template / list 为单工具，
 * 通过 action 分发。list 复用 storage.listFeatures。
 *
 * ★★★ T194（2026-10-12）：**入参改为【扁平】**（原先是 `{action, args:{…}}` 嵌套）。
 *   ## 为什么改（★ 三条证据，都不是口味问题）
 *   1. ★★ **它买不到任何东西**：5 个 action、一共只用 **5 个键**（`feature`/`title`/
 *      `source_feature`/`target_feature`/`template_id`）、**单个 action 最多 3 个**、**彼此不撞名**
 *      ⇒ 平铺毫无压力。（对照：`explore_code` 15 个 action / ~60 键 ⇒ 那个嵌套**有理由**、**不动**。）
 *   2. ★★ **本文件 84 行原注释自己记着**：*"调用方**很可能已经在顶层传了** `feature`
 *      （schema 里并没有顶层 `feature`，它必须放进 `args`）⇒ 报错看着自相矛盾"*
 *      —— ★ 2026-10-06（T41 ③）当时的处置是**加一句提示让调用方适应**；
 *      而现在**把形状本身改对** ⇒ ★ **不再让使用者适应设计缺陷**。
 *   3. ★★ **14 个 action 分派型工具里 12 个本来就是扁的**；★ 连本仓 MCP 服务器的引导文案
 *      （`server.ts`）写的都是 `manage_feature(action=create)` = **扁的** ⇒ **schema 才是异类**。
 *
 *   ## 为什么这对 LLM 更友好（★ 本项目就是为 LLM 设计的）
 *   扁的 schema **每个参数都有类型**（工具能逐字自校验）；嵌套的 `args` 是
 *   `z.record(z.string(), z.unknown())` = ★ **一个不透明袋子，校验器一个字都帮不上**。
 *   （★ 后果实测过：T191 的"形状错被静默当没给"。）
 */

// ★ 判据一处：形状错就抛（★ 不再用本文件自带的宽松 `str`）。
import { requireStr, optionalStr } from '../../plumbing.js';
import { createFeature, cloneFeature } from '../dsl_ops/feature_ops.js';
import { createFromTemplate } from './templates.js';
import { listFeatures as listStoredFeatures, deleteFeature } from '../../../infrastructure/storage.js';

export const MANAGE_ACTIONS = ['create', 'clone', 'template', 'list', 'delete'] as const;
export type ManageAction = (typeof MANAGE_ACTIONS)[number];

/**
 * ★ T194：**扁平**入参 —— 每个 action 的参数**与 `action` 平级**（不再塞进 `args`）。
 * ★ 全部可选（各 action 只挑自己要的）；**缺哪个由 `requireStr` 在分发后按 action 抛**，
 *   报错会**点名**缺的是哪个（比"schema 一把全必填"更准）。
 */
export interface ManageFeatureInput {
  action: ManageAction;
  feature?: string;
  title?: string;
  source_feature?: string;
  target_feature?: string;
  template_id?: string;
  /**
   * ★ 仅用于**识别老形状**（见 `rejectLegacyArgs`）—— ★ 它**不是**入参，
   * 传了就**抛**（不静默忽略）。**新调用方不要传这个键。**
   */
  args?: unknown;
}

export interface ManageFeatureResult {
  message: string;
  data?: unknown;
}

export function manageFeature(input: ManageFeatureInput): ManageFeatureResult {
  const { action } = input;
  // ★ T194：三个取值都从 `plumbing` 来（★ 判据一处）——
  //   `requireStr`：必填，缺/空串则抛（报错点名 key）；`optionalStr`：给了就必须是字符串，**形状错就抛**。
  const str = (k: string): string | undefined => optionalStr(input as unknown as Record<string, unknown>, k);

  rejectLegacyArgs(); // ★ 先拦"老形状"：看见 `args` 就抛（绝不静默丢值）

  switch (action) {
    case 'create': {
      const feature = req('feature');
      const r = createFeature({ feature, title: str('title') });
      return { message: r.message };
    }
    case 'clone': {
      const r = cloneFeature({
        source_feature: req('source_feature'),
        target_feature: req('target_feature'),
        title: str('title'),
      });
      return { message: r.message };
    }
    case 'template': {
      const r = createFromTemplate({
        template_id: req('template_id'),
        feature: req('feature'),
        title: str('title'),
      });
      return { message: r.message };
    }
    case 'list': {
      const dsls = listStoredFeatures();
      if (dsls.length === 0) return { message: '尚无已设计的 feature', data: [] };
      const lines = dsls.map((d, i) => {
        const fileCount = d.semantic?.files?.length ?? 0;
        const invariantCount = d.semantic?.multi_file_invariants?.length ?? 0;
        const status = d.status ?? 'draft';
        return `${i + 1}. ${d.feature} (${status}, ${fileCount} 文件, ${invariantCount} 不变式) [${d.id}]`;
      });
      return {
        message: ['已设计的 feature：', ...lines].join('\n'),
        data: dsls.map((d) => ({ id: d.id, feature: d.feature, status: d.status })),
      };
    }
    case 'delete': {
      const feature = req('feature');
      deleteFeature(feature);
      return { message: `已删除 feature: ${feature}（设计存档 + 实际快照 + 活态视图）`, data: { feature } };
    }
    default: {
      const exhaustive: never = action;
      throw new Error(`未知 manage_feature action: ${exhaustive as string}`);
    }
  }

  // ★ T194：**删掉了这里原先的 `req()`** —— 它的报错文案是
  //   `（★ 参数需放在 args 子对象里：{"action":"…","args":{"…":…}}）`，
  //   ★ 那是一句【给旧形状打的补丁】（2026-10-06 T41 ③ 加的）。形状改扁之后，**这句话本身就不该存在**。
  //   ⇒ 现在统一走 `plumbing.requireStr`（★ 判据一处），报错点名缺的是哪个键。
  function req(k: string): string {
    return requireStr(input as unknown as Record<string, unknown>, k);
  }

  /**
   * ★★★ T194：**老形状（`args` 子对象）的迁移提示** —— 契约变更**必须告诉老调用方改了什么**。
   *
   * ## 为什么不能"静默忽略 `args`"
   * 形状改扁之后，`{action, args:{feature:'x'}}` 里的 `args` **不再是入参** ⇒ 会被丢掉
   * ⇒ 调用方只会收到 `缺参数 "feature"`，而**他自己明明传了**（就在 `args` 里）
   * ⇒ ★ **"值被静默丢弃"**（§2.3 最坏的那一类：他以为传了，工具说没传）。
   * ⇒ 所以：**只要看见 `args` 就抛**，并把新形状写清楚（★ 与 T41 当年那句提示**方向相反** ——
   *   那句是"请把参数放进 args"；这句是"**args 已经不要了，提到顶层来**"）。
   */
  function rejectLegacyArgs(): void {
    if (input.args === undefined) return;
    throw new Error(
      'manage_feature 的入参**已改为扁平**（2026-10-12 T194）：参数**不再放进 `args`**，' +
        `请把它提到顶层 —— 例：{"action":"${action}","feature":"…"}。` +
        '★ 理由：本工具 5 个 action 一共只用 5 个键、彼此不撞名（嵌套买不到东西），' +
        '而扁平形状**每个参数都有类型**、工具能逐字自校验。',
    );
  }
}