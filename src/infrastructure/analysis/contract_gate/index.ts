/**
 * contract_gate —— 契约对账闸门（重构吸后预拦 "符号失配"）
 *
 * 背景（一次重构事故归纳）："v2 提级重构"把 vault_test.go 里正确的
 * `v2.Get`（v2 = 测试局部变量）机械替换成 `agent.Get`（vault 包内不存在的符号）。
 * 该错误只藏在 *_test.go → `go build` 不编测试 → 默认构建放行 → 静默掉线。
 *
 * 本模块在"编译/测试"之外补一道**契约层闸门**：重构落盘后，扫描被改动文件，
 * 判定每个 `X.` 形式的"包/接收者引用"的裸标识符是否有定义来源
 * （本文件声明 ∪ import 别名 ∪ 本文件局部变量 ∪ TS 全局白名单）。
 * 未定义 → 记为契约失配（danger）。vault 场景 `agent` 没有任何声明来源 → 命中。
 *
 * 定位：轻量"飞刀"，只查"`.` 左侧裸标识符"这一类跨引用失配（改名/提级/move
 * 最常打断它），**不是** tsc/vet 那样完整的类型检查——它负责"改写吸后立刻给出
 * 结构化 diff 清单"，把失配显式标出来，再由 go test / tsc 权威兜底。
 *
 * 设计纪律（低误报优先）：
 *   - 只检查 `X.` 形式的接收者/包引用，不检查自由变量 → 避免作用域误报。
 *   - 定义来源采用"宁可多收不漏收"并集：声明 ∪ 别名 ∪ 局部名 ∪ 全局白名单，
 *     让 `agent` 这类"全仓从未声明"的名字突出，而普通局部变量不误报。
 *   - 声明/局部名使用文件级并集（非精确作用域）——牺牲一丝精度换取近零误报，
 *     对 vault 完美命中，且不会把闭包捕获误判。
 *   - 每种语言各接一个"定义来源"适配器，快照/diff/报告编排全复用。
 *
 * ★ 2026-10-01（拆分，同族第 2 例，照 `rename_symbol`）：
 *   原单文件 596 行按语言拆成——
 *   - `core.ts`：语言无关骨架（编排 + 清洗/枚举/扫描公共步骤），只查表零语言知识
 *   - `parts.ts`：语言无关接线层（共享类型 + `scanDotRefs` + `CgLangPackage` 契约）
 *   - `languages/{registry,ts,go,py,java,cs,c}.ts`：语言包与注册表
 *   本 `index.ts` 对外再导出**与拆分前逐字相同**的 API。
 */
export { scanContracts, renderContractSkips, diffContracts, contractGate } from './core.js';
export type {
  UndefinedRef,
  FileScan,
  SkippedFile,
  ContractSnapshot,
  ContractDiff,
  ScanContractsOptions,
  ContractGateResult,
} from './core.js';
export type { Lang } from './parts.js';
