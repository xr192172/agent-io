/**
 * ts_kernel 公开入口
 */
export {
  parseFile,
  parseFileFull,
  parseFileFullSync,
  parserReadyForFile,
  parseAstRootSync,
  canParseFileSync,
  prewarmKernel,
  // ★ QW-2（2026-11-19）：按需预热 —— 只建这次真会碰到的后缀（`server_registry` 是唯一调用方）
  prewarmExts,
  parseAstRoot,
  isSupported,
  isSupportedFile,
  listSupportedLanguages,
  listSupportedExtensions,
  _reset,
  findLanguageByExt,
  isLanguageInstalled,
  isTypeOnlyModuleStatement,
  childrenOf,
} from './kernel.js';

export type { ParsedSymbol, ParsedImport, ParsedCall, ParsedTypeRef, ParsedFile, LanguageEntry, SyntaxNodeLike } from './kernel.js';
export type { LanguageEntry as LanguageMeta } from './languages.js';

// ★ QW-2（2026-11-19）：已预热的扩展名快照 —— 给"这一轮新建了几个 Parser"的读数用（不参与判定）
export { parserCacheExts } from './loader.js';

// ★ T157（2026-10-11）：类型声明的**成员提取** —— `interface`/`type`/`class` 的字段与方法签名。
//   唯一住处；`contract_page`（字段清单）与 `consistency_check`（契约对拍）**共用这一份**。
export {
  TYPE_DECL_NODES,
  BODY_NODES,
  MEMBER_NODES,
  typeMembersOf,
  memberNamesOf,
  findTypeDeclByName,
  typeDeclFromSignature,
  normalizeMemberType,
} from './type_members.js';
export type { ParsedTypeMember, ParsedTypeDecl, SignatureDeclResult } from './type_members.js';

// ★ v13（2026-10-20）：函数/方法**形参表** —— 与 `type_members` 同族；`node.params` 与
//   `consistency_check` 的对拍**必须是同一份**（不再各拆一次 signature 字符串）。
export { paramsOf, paramsOfNode } from './symbol_params.js';
export type { ParsedParam } from './symbol_params.js';

export { IMPORT_EXTS, INDEX_FILES, importPathCandidates, completionCandidates, resolveImportPath, resolveExistingPath, resolveProjectImport } from './import_resolve.js';
export {
  TS_JS_EXTS,
  OTHER_LANG_EXTS,
  SOURCE_EXTS,
  NODE_RUNNABLE_EXTS,
  isTsJsExt,
  isSourceExt,
  isNodeRunnableExt,
} from './source_exts.js';
export { parseRelativeNamedImportMap } from './import_text.js';
export type { ResolvePathOptions, ProjectImportLayer, ProjectImportHit, ProjectImportOptions } from './import_resolve.js';
