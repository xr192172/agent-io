/**
 * tailoring/operators.ts —— **制衣领域包**的算子注册数据（七个算子；每个 = 语义名 + 输入契约 + 输出变更 + 判据）。
 *
 * ## v1 的口径（写死，别模糊）
 * 本文件只**登记**算子：语义名 / 输入实体契约 / 输出变更 / 判据。
 * **不实现几何**（`cut` 不出路径、`seam` 不算接合场、`grade` 不重算控制点）。
 * 需要几何才能判的判据一律 `tier:'geometry'` + `blocked_by:'等 v2/v3 几何内核'`
 * ⇒ 它们的出口是 `unsupported`（**不是** pass，见 `semantic_model/validate.ts#g6CriterionVerdict`）。
 *
 * ## 出处（逐算子的原话来源）
 * | 算子 | 出处 |
 * |---|---|
 * | `cut` 裁剪 | `A3.3` 阶段 5（裁片拆解算子/展开/导出制版数据）、`A6.7`（沿纸样裁布） |
 * | `seam` 对接 | `A3.2` 试验闭环（装配算子把袖片接到衣身袖窿端口）、`#41` 端口匹配算子 |
 * | `unseam` 拆解 | `#51`「可用**拆解算子**逆向回到两实体」 |
 * | `grade` 放码 | `A6.3`（自动放码 ≠ 合身）、`A6.4`（一人一版）、`A6.8`（制图公式重算控制点） |
 * | `measure` 量体 | `A6.8`（量 10~15 个尺寸）、`A7.4`（量体误差 + 必须保留一次真人试穿） |
 * | `attach` 附着 | `#63`（两套可选装配端口，互不抢占） |
 * | `name` 命名 | `#24/#25`（动态命名实体：名字任意，身份永久绑定在形体上） |
 * | `checkin` 预约签到 | `docs/todo.md` T-#CLOTH-RESERVATION ⑤⑥⑦⑧（即约即用/签到起算时长/签退回池/候补 FIFO） |
 *
 * ## ★ 一个诚实提醒（给主控）
 * `checkin` 的判据（容量上限、20:00 硬墙、候补 FIFO）**本包判不了** —— 它们要设备池与时钟。
 * 本包只登记它的**契约与判据清单**，出口一律 `unsupported`（`blocked_by:'等设备域落库（卷 A）'`）。
 * 把它硬写成 `declarative` 会让一条没人执行的判据显示成绿色 —— 那正是本仓最贵的那类假绿。
 */

import type { Criterion, OperatorDef, OperatorInput, OperatorOutput } from '../semantic_model/types.js';

/** 几何判据的统一措辞（同一条阻塞原因写一处，报文不会两处漂） */
const GEO = '等 v2/v3 几何内核（v1 只登记契约，不实现几何）';

/** 声明式判据的便捷构造 */
const decl = (id: string, why: string, check: string): Criterion => ({ id, tier: 'declarative', why, check });
/** 几何判据的便捷构造（出口恒 `unsupported`） */
const geo = (id: string, why: string, blocked = GEO): Criterion => ({ id, tier: 'geometry', why, blocked_by: blocked });
/** 输入位 */
const inp = (ref: string, entityKind: string, required = true): OperatorInput => ({ ref, entityKind, required });
/** 输出位 */
const out = (produces: string, mutates: OperatorOutput['mutates']): OperatorOutput => ({ produces, mutates });

/**
 * 七个算子的**注册数据**（顺序 = 业务链路的自然顺序：量体 → 放码 → 命名 → 对接 → 附着 → 拆解 → 裁剪）。
 * ★ 顺序不是契约（按 `name@version` 寻址），但人读目录时它会决定第一屏看到什么。
 */
export function tailoringOperators(): OperatorDef[] {
  return [
    {
      name: 'measure',
      version: 1,
      intent: '量体：把一组实测尺寸登记成一份可溯源的量体档案（带时刻与来源）',
      inputs: [inp('subject', 'body_measurement')],
      outputs: [out('BodyMeasurement', 'derive')],
      criteria: [
        decl('measure.key-registered', '量体的每个键必须已登记，否则公式引用它时无处可查（A6.8 的 10~15 个尺寸）', 'values[].key ∈ MEASURE_KEYS'),
        decl('measure.source-required', '每项尺寸必须写清来源（A7.4：量体数据捕捉不到驼背/高低肩 ⇒ 来源必须可溯）', 'values[].source ∈ MEASURE_SOURCES'),
        decl('measure.unit-closed', '单位只认 cm/inch（闭集）；同一个值混单位是账实不符的源头', 'values[].unit ∈ MEASURE_UNITS'),
        geo('measure.plausible-range', '值必须在人体合理区间内（超出 ⇒ 多半是量错了，不是体型特殊）', GEO),
      ],
      annotations: { reversible: true, idempotent: false },
    },
    {
      name: 'grade',
      version: 1,
      intent: '放码：按放码公式集把款式重算成一人一版（A6.4「调得对不对」是核心，不是「能不能调」）',
      inputs: [inp('spec', 'garment_spec'), inp('constraints', 'constraint_set'), inp('measurements', 'body_measurement')],
      outputs: [out('GradedPieceSet', 'derive')],
      criteria: [
        decl('grade.formula-vars-registered', '公式里的每个变量名必须是已登记的量体键或本集内中间量（A6.8：每条公式来自姑姑制版经验）', 'every var ∈ MEASURE_KEYS ∪ formulas.keys'),
        decl('grade.formula-acyclic', '公式不许成环（A 依赖 A，或 A→B→A）—— 成环就永远算不出来', 'dependency graph is a DAG'),
        decl('grade.measurements-cover', '量体档案必须覆盖公式用到的全部量体键（缺一个 ⇒ 不说 0，直接拒）', 'required MEASURE_KEYS ⊆ measurements.values[].key'),
        geo('grade.still-sewable', '放码后的版片必须仍能缝合（A6.4：软件能保证几何联动不出错，版片还能缝起来）', GEO),
      ],
      annotations: { reversible: true, idempotent: true },
    },
    {
      name: 'name',
      version: 1,
      intent: '命名：随时新建一块语义实体并给它起任意名字（名字永久绑定在这块形体上）',
      // ★ 输入位是**实例**（某个已注册实体），种类取自本包实体——"要新建哪种实体"由 `args[0]` 的那个实例决定
      inputs: [inp('prototype', 'pattern_piece')],
      outputs: [out('Entity', 'declare')],
      criteria: [
        decl('name.id-unique', '新实体 id 必须全局唯一（身份靠 id，不靠名字）', 'id ∉ registered ids'),
        decl('name.free-form', '名字可以任意取（`#25`：命名成 block_xyz 只要声明了融合关系照样执行）', 'semanticName 非空即可，不校验语义'),
      ],
      annotations: { reversible: false, idempotent: false },
    },
    {
      name: 'seam',
      version: 1,
      intent: '对接：把两个缝口按端口协议接起来（袖口端口 ↔ 袖管下口端口）',
      inputs: [inp('a', 'seam_port'), inp('b', 'seam_port')],
      outputs: [out('Seam', 'declare')],
      criteria: [
        decl('seam.mutual', '两端必须互指（a.mated=b 且 b.mated=a），单向指 = 缝了一半', 'a.matedPortId === b.id && b.matedPortId === a.id'),
        decl('seam.type-compatible', '端口类型必须兼容（铰接对铰接、融合对融合；#41 匹配层先校验类型）', 'a.portType === b.portType'),
        decl('seam.no-self', '不许把端口缝到自己身上', 'a.id !== b.id'),
        decl('seam.cross-piece', '跨版片的接缝，两端必须分别属于不同的版片（同一片的两条边不是接缝）', 'a.pieceId !== b.pieceId'),
        geo('seam.no-self-intersect', '接缝曲线不自交、不穿模（A3.3：接缝稳定、不自交是主要坑）', GEO),
      ],
      annotations: { reversible: true, idempotent: false },
    },
    {
      name: 'attach',
      version: 1,
      intent: '附着：把一块修饰版片挂到宿主版片的指定端口上（#63：两套可选端口，互不抢占）',
      inputs: [inp('host', 'pattern_piece'), inp('ornament', 'pattern_piece'), inp('anchorPort', 'seam_port')],
      outputs: [out('Attachment', 'declare')],
      criteria: [
        decl('attach.port-belongs-to-host', '锚点端口必须属于宿主版片（挂别人的端口 = 装配关系错位）', 'anchorPort.pieceId === host.id'),
        decl('attach.no-port-occupy', '不许抢占已占用的端口（#63：两种分支互不抢占端口）', 'anchorPort.matedPortId 为空'),
        geo('attach.no-interpenetrate', '不许穿模（#25 案例2 `no_interpenetrate`）', GEO),
      ],
      annotations: { reversible: true, idempotent: false },
    },
    {
      name: 'unseam',
      version: 1,
      intent: '拆解：断一条已建的接缝，两端口回到未对接（但接缝内化的分区信息保留）',
      inputs: [inp('a', 'seam_port'), inp('b', 'seam_port')],
      outputs: [out('Seam', 'declare')],
      criteria: [
        decl('unseam.was-mated', '只能拆一条**真的**存在的接缝（两端本来就都没对接 ⇒ 没有可拆的）', 'a.matedPortId === b.id'),
        decl('unseam.ports-kept', '拆完两端仍存在，不许连端口一起删（#51：拆解算子逆向回到两实体）', 'a.id ∈ ids && b.id ∈ ids'),
      ],
      annotations: { reversible: true, idempotent: true },
    },
    {
      name: 'cut',
      version: 1,
      intent: '裁剪：把版片变成可下发的裁片（带缝份），原件一个字不改（派生新引用）',
      inputs: [inp('piece', 'pattern_piece'), inp('cutPath', 'constraint_set')],
      outputs: [out('CutPathSet', 'derive')],
      criteria: [
        decl('cut.allowance-nonneg', '缝份不许为负（负缝份不是"裁小一点"，是参数错）', 'seamAllowanceMm >= 0'),
        decl('cut.piece-bijective', '一张版片一份裁片，不许丢片（A3.3 阶段 5：裁片拆解/展开/导出）', 'outputs.length === inputs.length'),
        geo('cut.path-closed', '裁剪路径必须封闭、沿外轮廓走（A4：设备要知道哪段是外轮廓、哪段是袖口接缝）', '等 v3 裁剪路径'),
      ],
      annotations: { reversible: true, idempotent: true },
    },
    {
      name: 'checkin',
      version: 1,
      intent: '预约签到：客人到场后签到起算使用时长（T-#CLOTH-RESERVATION ⑤⑥⑦⑧）',
      // ★ 签到挂在会员身上，而本包没有"会员"实体（会员归 fuint）⇒ 借用 `body_measurement` 的
      //   `subjectId` 作为"这个人"的载体，并在下一条判据里**明写**这是临时口径（不许读成已有会员域）。
      inputs: [inp('subject', 'body_measurement')],
      outputs: [out('CheckinEvent', 'declare')],
      criteria: [
        geo('checkin.capacity', '任意时刻占用缝纫机 ≤4 / 印花机 ≤1（判据底稿 ①）', '等设备域落库（T-#CLOTH-RESERVATION 卷 A）'),
        geo('checkin.duration-from-coupon', '签到起算时长 = 购买套餐 durationHours（1/2/3/全天，不写死；判据底稿 ⑥）', '等设备域落库（卷 C 券化）'),
        geo('checkin.window-2000', '20:00 硬墙：占用/加时/计费全截断（判据底稿 ③）', '等设备域落库（卷 B）'),
      ],
      annotations: { reversible: false, idempotent: false },
    },
  ];
}
