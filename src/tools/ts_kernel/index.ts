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
} from './kernel.js';

export type { ParsedSymbol, ParsedImport, ParsedCall, ParsedTypeRef, ParsedFile, LanguageEntry, SyntaxNodeLike } from './kernel.js';
export type { LanguageEntry as LanguageMeta } from './languages.js';

export { IMPORT_EXTS, INDEX_FILES, importPathCandidates, resolveImportPath } from './import_resolve.js';
export type { ResolvePathOptions } from './import_resolve.js';
