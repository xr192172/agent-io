/**
 * 消费者计数的**三档唯一算法**（`contract_page` 的 ④ 只渲染它，不自己数）。
 *
 * ## 它挡的事故
 * 改前 `consumers.count = consumerSites.length`，而 sites 的构造是「每个 importer **只取 `refs[0]` 一个点**」，
 * **整块不读 `definition.refs`** ⇒ **只被同文件使用的符号恒报 0**。
 * 实测：`classifyLayer` 在 `find_references` 是 4 处引用点（定义 1 + 同文件 usage 3），本工具报 **0**。
 *
 * ## 判据
 * 合计 ≡ `find_references` 的 `definition.refs.length + Σ importers[].refs.length`。
 * ⇒ 三档**必须分开报**：只给合计时，跨文件与同文件谁错了看不出来（统计型输出必须带分母）。
 *
 * ★ 纯函数、零 import ⇒ 可被 `behavior-cases` 直喂（`contract_page.ts` 不自包含，金丝雀 harness 跑不起来它）。
 */

/** 一个引用点（口径对齐 `find_references` 的 `ReferenceSite`：file / line / kind）。 */
export interface ConsumerSiteRef {
  /** ★ 唯一的分类变量：`cross-file` = 引用点在对侧文件（importers）；`same-file` = 定义文件内的点 */
  scope: 'cross-file' | 'same-file';
  file: string;
  line: number;
  /** `find_references` 给的 kind **原样**（import / usage / cross-usage / definition / export_list） */
  kind: string;
  /** 展示用片段（如 import 站点的 `import …`）：只透传，不参与计数 */
  snippet?: string;
}

/** 三档计数结果。字段名就是人读文案里的三档名 —— 别在渲染侧另起一套叫法。 */
export interface ConsumerTally {
  /** 跨文件导入方（**文件数**）：importers 的条数（含只有 importSources、拿不到行号的那种） */
  cross_file_importer_files: number;
  /** 跨文件站点数（importers 里逐个引用点） */
  cross_file_sites: number;
  /** 同文件使用点（`definition.refs` 里 kind === 'usage'） */
  same_file_usage: number;
  /** 同文件定义/导出点（`definition.refs` 里非 usage 的那些：definition / export_list） */
  same_file_definition: number;
  /** 合计 = 跨文件站点 + 同文件使用点 + 同文件定义点（**含定义点**，与 find_references 的 definition.refs 口径一致） */
  total: number;
}

/**
 * 数三档。**只有这一处**把引用点归到某一档。
 * @param sites 已经归好 `scope` 的引用点（跨文件来自 importers，同文件来自 definition.refs）
 * @param crossFileImporterFiles importers 的条数（**不等于**有站点的文件数：importSources 有、行号取不到时仍是导入方）
 */
export function tallyConsumers(
  sites: readonly ConsumerSiteRef[],
  crossFileImporterFiles: number,
): ConsumerTally {
  let crossFileSites = 0;
  let sameFileUsage = 0;
  let sameFileDefinition = 0;
  for (const s of sites) {
    if (s.scope === 'cross-file') crossFileSites += 1;
    else if (s.kind === 'usage') sameFileUsage += 1;
    else sameFileDefinition += 1;
  }
  return {
    cross_file_importer_files: crossFileImporterFiles,
    cross_file_sites: crossFileSites,
    same_file_usage: sameFileUsage,
    same_file_definition: sameFileDefinition,
    total: crossFileSites + sameFileUsage + sameFileDefinition,
  };
}
