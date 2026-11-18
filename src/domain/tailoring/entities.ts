/**
 * tailoring/entities.ts —— **制衣领域包**的实体形状（第一个领域包；纯注册数据 + 领域常量）。
 *
 * ## 它引谁
 * 只引 `../semantic_model/types.js` 的**类型**（形状权威住核里）。反向引用**不存在**：
 * 核一个字节都不知道制衣是什么（判据见 `tests/p0_semantic_model.test.ts` 的 ①）。
 *
 * ## 每个字段从哪来（需求源逐条可回查）
 * | 实体 | 出处 |
 * |---|---|
 * | 量体 BodyMeasurement | 桌面归档 `A6.8`（量 10~15 个尺寸）、`A6.4`（肩宽拆总肩宽+小肩宽+肩斜角）、`A7.4`（量体数据捕捉不到驼背/高低肩/左右不对称） |
 * | 一卷布 FabricRoll | `A6.1` 五层（主档→批次与卷属性→库存与流转→成本与补货→余料）+ `A6.2` 三层（布料名称做主档，批次做属性，卷做库存单元） |
 * | 版片 PatternPiece | `A3.4` 语义帧（局部坐标系/绑定端口/装配契约/层级归属）、`A6.8`（缝份 1cm / 纱向线 / 对位记号） |
 * | 缝口 SeamPort | `A3.4` **装配端口五要素**（`#41`）、`#45`（端口是**参数轮廓族**而非固定曲线） |
 * | 放码公式集 ConstraintSet | `A6.8`「每个款式预存一套**制图公式**（袖窿深 = 胸围/4 + 松量、前胸宽 = 胸围/4 - 1.5cm）」 |
 * | 款式 GarmentSpec | `A3.2`（一件上衣：衣身/袖子/袖口/领片）、`A7.4` 三档（DIY/精工/高定） |
 *
 * ## ★ v1 的边界（明确不进来）
 * 几何（控制点/多边形/DXF）、库存流水（入库/领用/退料/在途）、报表 —— 前者是 v2/v3 适配器，
 * 后两者归 fuint 侧（`docs/todo.md` 的 T-#CLOTH-DECOMPOSE 领地：物料库存按米/物料 BOM/工序工单）。
 */

import type { EntityDef, FieldSpec } from '../semantic_model/types.js';

/**
 * **布料主档的唯一键 = 布料名称 + 色号**（主控 2026-11-18 裁定）。
 *
 * ## 两处来源对撞过，这里记下裁定理由（别在别处再拍一次）
 * · `A6.1`：「同一种布，**颜色或成分不同即视为不同记录**，因为价格和补货行为不同」⇒ 色号属于**主档**；
 * · `A6.2`：「按**布料名称**汇总，批次展开，按卷扣减」⇒ 看起来像"名称即键"。
 *
 * 裁定（主控）：**A6.1 胜出**。理由 = 拣货校验是 `色号+缸号+卷号`（`A6.2` 原话），
 * 若色号不在主档层有意义，"色号要一致"这条校验就无处可比；且同布不同色的裁剪色差会直接进成品
 * ——业务上它们就是不同物料。`A6.2` 的"按名称汇总"降级为**报表聚合口径（视图层）**，不是存储键。
 *
 * ★ 这是一条**可改常量**：真要改口径，改这里 + 一处注释，别散落在校验函数里。
 */
export const FABRIC_MASTER_KEY_FIELDS = ['masterName', 'colorCode'] as const;

/** 主档键的人读说明（报文/回执用同一句，避免两处措辞漂移） */
export const FABRIC_MASTER_KEY_NOTE =
  '布料主档唯一键 = 名称+色号（A6.1 胜出：拣货校验"色号+缸号+卷号"要求色号在主档层有意义；A6.2 的按名称汇总降级为报表口径）';

/** 量体的**单位闭集**（cm 为主；inch 留给进口尺） */
export const MEASURE_UNITS = ['cm', 'inch'] as const;
/** 量体来源（`A7.4`：量体数据捕捉不到驼背/高低肩 ⇒ 来源必须可溯，不许"不知道哪来的数"） */
export const MEASURE_SOURCES = ['self_report', 'in_store_tape', 'photo_scan'] as const;
/** 量体基准（净体/成衣）—— 同一件衣服用哪个基准量，直接决定版型松量 */
export const MEASURE_BASIS = ['net', 'garment'] as const;

/** 版片种类（`A3.2` 测试载体那件上衣的最小集：衣身/袖子/袖口/领片，另加通用的前后片） */
export const PIECE_KINDS = ['bodice', 'front', 'back', 'sleeve', 'cuff', 'collar', 'placket', 'other'] as const;
/** 纱向（`A6.8`：程序自动画纱向线） */
export const GRAIN_DIRECTIONS = ['lengthwise', 'crosswise', 'bias'] as const;
/** 端口类型（`A3.4` `#41`：类型标记 = **铰接装配口** vs **固定融合口**） */
export const PORT_TYPES = ['hinge', 'fuse'] as const;
/** 端口轮廓族（`#45`：端口是**参数轮廓族**，不是固定曲线） */
export const OUTLINE_FAMILIES = ['circle', 'ellipse', 'slot', 'polyline'] as const;
/** 款式档位（`A7.4` 三层：DIY 基础档 / 精工档 / 高定档） */
export const GARMENT_TIERS = ['diy', 'refined', 'couture'] as const;
/** 公式方言（`dialect`；`seamly2d` 只是**预留**——v1 不解析，v2 适配器才做导入） */
export const FORMULA_DIALECTS = ['literal', 'seamly2d'] as const;

/** 便捷构造：`f(name, 'string', { required: true })` */
const f = (name: string, type: FieldSpec['type'], more: Omit<FieldSpec, 'name' | 'type'> = {}): FieldSpec => ({ name, type, ...more });

/**
 * 六个实体的**字段域**（形状语言 = 核的 `FieldSpec`；这里只写"声明"，不写判定）。
 * ★ 每个实体一种 `kind`，算子的 `inputs[].entityKind` 就引这些字符串。
 */
export const TAILORING_ENTITY_FIELDS: Record<string, readonly FieldSpec[]> = {
  /** 量体档案（一个人的一组实测尺寸） */
  body_measurement: [
    f('subjectId', 'string', { required: true, desc: '被量的人（会员/顾客 id；与 fuint 会员同名会由适配层桥接，v1 不建桥）' }),
    f('at', 'string', { required: true, desc: '量体时刻（ISO 串）' }),
    f('basis', 'string', { values: MEASURE_BASIS, desc: '净体 or 成衣基准' }),
    f('values', 'object[]', { required: true, minItems: 1, desc: '每项 {key,value,unit,source}；键必须登记在 MEASURE_KEYS' }),
  ],
  /** 一卷布（主档 → 批次[缸号+实测] → 卷层；A6.2 的三段结构 **不许拍平**） */
  fabric_roll: [
    f('masterId', 'string', { required: true, desc: '所属布料主档 id（名称+色号那条记录）' }),
    f('lotNo', 'string', { required: true, desc: '缸号（A6.1：必备、不许空串、不许只写在备注里）' }),
    f('rollNo', 'string', { required: true, desc: '匹号/卷号（A6.1：每一卷的唯一编号）' }),
    f('measuredLengthM', 'number', { required: true, desc: '实测米数（A6.1：扣库存按实测米数，不按标签米数）' }),
    f('inboundLengthM', 'number', { desc: '来料单米数（比对索赔用；与实测并列**不是替代**）' }),
    f('measuredWeightKg', 'number', { desc: '实测公斤数（按公斤结算时过磅）' }),
    f('binCode', 'string', { desc: '库位（作坊用 F2-03 简码）' }),
    f('allocatedLengthM', 'number', { desc: '已分配/已锁定米数（被订单预占但未裁剪）' }),
    f('appearanceGrade', 'string', { values: ['ok', 'derated', 'pending', 'frozen'], desc: '外观等级' }),
    f('defects', 'object[]', { desc: '疵点记录 {type,atLength,lengthM}' }),
    f('remainingNo', 'string', { desc: '余料编号（独立于原卷号）' }),
  ],
  /** 版片 */
  pattern_piece: [
    f('name', 'string', { required: true }),
    f('kind', 'string', { required: true, values: PIECE_KINDS }),
    f('grain', 'string', { values: GRAIN_DIRECTIONS, desc: '纱向（A6.8：程序自动画纱向线）' }),
    f('seamAllowanceMm', 'number', { required: true, desc: '缝份（A6.8：如 1cm ⇒ 传 10）' }),
    f('portIds', 'string[]', { desc: '本片上的端口 id（引用）' }),
    f('geometryRef', 'string', { desc: '几何引用（v1 恒空；v3 才填 DXF/SVG 路径）' }),
  ],
  /** 缝口/装配端口 */
  seam_port: [
    f('pieceId', 'string', { required: true, desc: '所属版片 id（引用）' }),
    f('edgeId', 'string', { required: true, desc: '边标识（哪条边上的口）' }),
    f('portType', 'string', { required: true, values: PORT_TYPES, desc: '铰接口 or 固定融合口' }),
    f('outlineFamily', 'string', { required: true, values: OUTLINE_FAMILIES, desc: '轮廓族（参数轮廓，不是固定曲线）' }),
    f('outlineParams', 'object', { desc: '轮廓参数（基准形态 + 比例控制参数；尺寸以 mm 记）' }),
    f('matedPortId', 'string', { desc: '对接端口（未对接 = 合法的"还没有"）' }),
    f('swingRangeDeg', 'object', { desc: '约束元：摆动范围 {min,max}' }),
    f('thicknessBoundMm', 'number', { desc: '约束元：厚度边界' }),
    f('blendRadiusMm', 'number', { desc: '约束元：过渡区半径' }),
    f('pointsRef', 'string', { desc: '轮廓点列引用（v1 恒空；几何后置）' }),
  ],
  /** 放码公式集 */
  constraint_set: [
    f('dialect', 'string', { required: true, values: FORMULA_DIALECTS }),
    f('formulas', 'object', { required: true, desc: '参数名 → 表达式串（v1 只登记，不求值）' }),
    f('source', 'string', { desc: '公式出处（姑姑的制版经验 / 翻译自 Seamly2D）' }),
  ],
  /** 款式 */
  garment_spec: [
    f('name', 'string', { required: true }),
    f('tier', 'string', { required: true, values: GARMENT_TIERS, desc: 'DIY 基础档 / 精工档 / 高定档（A7.4）' }),
    f('pieceIds', 'string[]', { required: true, minItems: 1, desc: '版片集合（引用）' }),
    f('seamIds', 'string[]', { desc: '装配关系（引用；本 v1 里装配关系就是成对的 matedPort）' }),
    f('parameterDomainRef', 'string', { required: true, desc: '参数域引用（量体档案 id 或放码公式集 id）' }),
  ],
};

/**
 * 实体**种子的注册数据**：`[id, semanticName, kind]`。
 * ★ 这些是**形状样板**（每个种类各一条），真实业务实例由 fuint 侧落库后按同一 `kind` 注册进来
 *   —— 本包只负责"这个领域有哪些种类、每种长什么样"。
 */
export const TAILORING_ENTITY_SEEDS: readonly (readonly [string, string, string])[] = [
  ['tailoring.body_measurement', '量体档案', 'body_measurement'],
  ['tailoring.fabric_roll', '一卷布', 'fabric_roll'],
  ['tailoring.pattern_piece', '版片', 'pattern_piece'],
  ['tailoring.seam_port', '缝口', 'seam_port'],
  ['tailoring.constraint_set', '放码公式集', 'constraint_set'],
  ['tailoring.garment_spec', '款式', 'garment_spec'],
];

/** 造出本包的实体定义（`EntityDef[]`，字段域已挂好） */
export function tailoringEntities(): EntityDef[] {
  return TAILORING_ENTITY_SEEDS.map(([id, semanticName, kind]) => ({
    id,
    semanticName,
    kind,
    fields: TAILORING_ENTITY_FIELDS[kind] ?? [],
  }));
}
