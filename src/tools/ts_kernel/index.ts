/**
 * ts_kernel 公开入口
 */
export {
  parseFile,
  parseFileFull,
  parseFileFullSync,
  parserReadyForFile,
  canParseFileSync,
  prewarmKernel,
  parseAstRoot,
  isSupported,
  listSupportedLanguages,
  listSupportedExtensions,
  _reset,
  findLanguageByExt,
  isLanguageInstalled,
  isTypeOnlyModuleStatement,
} from './kernel.js';

export type { ParsedSymbol, ParsedImport, ParsedCall, ParsedTypeRef, ParsedFile, LanguageEntry, SyntaxNodeLike } from './kernel.js';
export type { LanguageEntry as LanguageMeta } from './languages.js';

export { IMPORT_EXTS, INDEX_FILES, importPathCandidates, completionCandidates, resolveImportPath, resolveExistingPath } from './import_resolve.js';
export {
  TS_JS_EXTS,
  OTHER_LANG_EXTS,
  SOURCE_EXTS,
  NODE_RUNNABLE_EXTS,
  isTsJsExt,
  isSourceExt,
  isNodeRunnableExt,
} from './source_exts.js';
export type { ResolvePathOptions } from './import_resolve.js';
