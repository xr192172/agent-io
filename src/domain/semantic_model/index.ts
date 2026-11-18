/**
 * semantic_model/index.ts —— 通用语义建模核的**域内汇总**（domain 层，**零 import**）。
 *
 * ★ 只汇总**本目录**的东西：`types` / `serialize` / `registry` / `validate`。
 *   外部（含领域包）既可以按文件引（`semantic_model/registry.js`），也可以按本文件引；
 *   两种用法指向**同一份实现**，没有第二份。
 *
 * ★ 本文件**不许**再导出任何领域包的内容 —— 那会让"核"在 import 图上把领域包吞进来，
 *   于是"删掉领域包核仍自洽"这件事从结构上就不成立了。
 */

export type {
  Criterion,
  CriterionTier,
  EntityDef,
  FieldSpec,
  FieldType,
  OperatorCall,
  OperatorDef,
  OperatorInput,
  OperatorOutput,
  SemanticModel,
} from './types.js';

export { fromJSON, isSemanticShapeError, roundTrip, SemanticShapeError, toJSON } from './serialize.js';

export { DuplicateOnRebuild, operatorKey, SemanticRegistry } from './registry.js';
export type { RegisterOutcome, RejectReason } from './registry.js';

export {
  criteriaTally,
  g1EntityIdentity,
  g2EntityRefs,
  g3CriteriaPresent,
  g4VersionChain,
  g5InputKinds,
  g6CriterionVerdict,
  isModelConsistent,
  validateModel,
} from './validate.js';
export type { CriteriaTally, CriterionVerdict, Gap } from './validate.js';
