/**
 * 从 API **签名串**中提取函数名。
 *
 * ★★★ 唯一住处（2026-10-10，AB-double-name「判据分叉」修复）：
 *   此前 `lifecycle/scaffold.ts` 与 `intent/consistency.ts` **各有一份**正则，且**已经不一致**：
 *     · scaffold 版   `/(?:func\s+)?(\w+)\s*[\(\<]/`
 *     · consistency 版 `/(?:func\s+)?(?:\([^)]+\)\s+)?(\w+)\s*[\(\<]/`  ← 本函数采用（更全）
 *   后者多一个可选的「(接收者/参数前缀) 」⇒ 对 `func (s *Server) Handle()` 取到 `Handle`
 *   而不是 `func`。★ 同一语义、两份实现、已经分叉 = 病根；此处收口成**唯一一处**。
 *
 * ★ 为什么输入是**签名串**而不是直接用 AST 的 `symbol.name`：
 *   本函数的入参是**设计态契约**（`expected_apis[].signature` —— 人写 / 导入的**意图**），
 *   `expected_apis` **不再镜像代码事实**（T85/D1 起摘掉）⇒ **代码 AST 里没有同一份**
 *   ⇒ 从签名串推名字是**合理的营生**。
 *   ★ 而**实际实现侧**的名字**一律取 AST 权威名**（`ParsedSymbol.name`），
 *     **不得**再拿本函数对 `actual` 的签名重取（见 `consistency.ts` 的 `compareSignatures`）。
 */
export function extractFuncName(sig: string): string {
  const match = sig.match(/(?:func\s+)?(?:\([^)]+\)\s+)?(\w+)\s*[\(\<]/);
  return match ? match[1] : sig.split(/\s*\(/)[0];
}
