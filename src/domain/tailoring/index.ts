/**
 * tailoring/index.ts —— 制衣领域包的**域内汇总**。
 *
 * ★ 单向依赖：本目录 import `../semantic_model/*`，核**从不** import 本目录。
 *   这条方向由 `tests/p0_semantic_model.test.ts` ① 用源码正则钉住（不是靠纪律）。
 */

export {
  FABRIC_MASTER_KEY_FIELDS,
  FABRIC_MASTER_KEY_NOTE,
  FORMULA_DIALECTS,
  GARMENT_TIERS,
  GRAIN_DIRECTIONS,
  MEASURE_BASIS,
  MEASURE_SOURCES,
  MEASURE_UNITS,
  OUTLINE_FAMILIES,
  PIECE_KINDS,
  PORT_TYPES,
  TAILORING_ENTITY_FIELDS,
  TAILORING_ENTITY_SEEDS,
  tailoringEntities,
} from './entities.js';

export { tailoringOperators } from './operators.js';

export {
  BAKED_GEOMETRY_KEYS,
  formulaVars,
  isTailoringConsistent,
  MEASURE_KEYS,
  MEASURE_RANGES_CM,
  MEASURE_SOURCES_ALLOWED,
  MEASURE_UNITS_ALLOWED,
  r10Measurements,
  r11RelationsDeclarative,
  r1MutualMating,
  r2TypeCompatible,
  r3CrossPiece,
  r4FormulaVarsRegistered,
  r5FormulaAcyclic,
  r6Uniqueness,
  r7bColorConsistent,
  r7LotRequired,
  r8MeasuredLength,
  r9ThreeLevels,
  RELATION_KINDS,
  validateTailoring,
} from './validate.js';
export type { TailoringGap } from './validate.js';

export { auditTailoringEntities, loadTailoringPack, TAILORING_PROFILE, tailoringModel, TailoringPackError } from './pack.js';
