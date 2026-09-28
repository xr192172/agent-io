/**
 * vitest 的 globalSetup —— **在所有测试文件之前跑一次**（主进程，单例）。
 *
 * ★ 只做一件事：清掉**上一轮**可能遗留的「门出生证注入物」（`__gate_probe*`）。
 *
 * 为什么必须在**这一层**做（2026-09-29 实测）：
 *   - helper 内部（`runProbe` 开头）也有自清，但**只有用到 helper 的测试才会触发**；
 *     而门的**棘轮断言**（如品牌残留门的「新增旧名出现处 ⇒ 红」）**不用** helper，
 *     它在同文件内**先于**出生证执行 ⇒ 若盘上有上一轮遗留的注入物，它**先看到** ⇒ 假红。
 *   - 实测证据：残留存在时品牌门红（`新增命中：tests/__gate_probe_brand__.txt`）；
 *     手动清掉后**同一条命令**变 11 passed ⇒ 红是残留造成的，不是代码问题。
 *     （排查时被它误导过一轮：差点去改门本身的判据。）
 *   - 放 globalSetup 是**唯一无并发风险**的位置：此时还没有任何测试文件在跑。
 *
 * ★ 为什么会有「上一轮遗留」：`process.on('exit')` 在 worker 被强杀时**不保证触发**
 *   （vitest 用 fork；测试超时 / 进程被中断时，清理路径可能根本跑不到）。
 *   ⇒ 这类"上一轮污染下一轮"的假红，比漏报更坏：**它会训练人忽略门**。
 */
import { sweepProbeResidues } from './gate_probe.js';

export default function globalSetup(): void {
  const removed = sweepProbeResidues();
  if (removed.length > 0) {
    // 只在真的清到东西时说话 —— 否则每轮都刷一行噪音（本仓纪律：不许把提示当噪音刷）
    console.log(`[globalSetup] 清掉上一轮遗留的探针注入物 ${removed.length} 个：${removed.join(', ')}`);
  }
}
