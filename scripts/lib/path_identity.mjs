/**
 * 路径身份（"这两个字符串指的是不是同一处"）—— **唯一实现**。
 *
 * ## 为什么需要它（2026-11-16 恢复事故的直接产物）
 *
 * 换机器后 `D:\agentio` 成了指向 `D:\Projects\ai\agentio` 的软链（junction）。于是同一台机器上
 * 同一份文件有两个合法路径形态：
 *
 * ```
 * 软链形态   D:\agentio\dev\agent-io\scripts\verify.mjs            ← process.cwd() / argv[1] 保留它
 * 真实形态   D:\Projects\ai\agentio\dev\agent-io\scripts\verify.mjs ← import.meta.url 被 Node realpath 过
 * ```
 *
 * 两者**字符串不等但物理同一**，于是所有"按字符串比对路径"的守卫都误判：
 *
 * · **入口守卫**（`verify.mjs` / `audit-script-tiers.mjs` / `mutate.mjs`）判 false ⇒ `main()` 从不执行
 *   ⇒ 脚本**静默 exit 0**（假绿）。实测：`node scripts/verify.mjs` 不打印任何门就退 0。
 * · **册身份守卫**（`judge-all.mjs`：CLI 回执的 `sheet` vs 本脚本的 `wantSheet`）判不等
 *   ⇒ 报「册不重合 ⇒ 这册的读数不算数」（假红），判据门判 0 条。
 *
 * ## 口径
 *
 * 比"是不是同一处"：两边都 **realpath 到物理路径**，再正斜杠 + 小写归一（Windows 不区分大小写）。
 * `realpath` 失败（不存在/无权限）⇒ 退化为 `path.resolve`（按字面比）：**物理不可知就不假装相等**，
 * 宁可假红不许假绿（0.12：失败必须与"没有"可区分）。
 *
 * ★ 不许在每个脚本里手抄（"两把尺"教训）：要么 import 这里，要么写清为什么这个面不能用它。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 归一成"物理同一处"的可比串：file URL → 路径 → realpath（失败则 resolve）→ 正斜杠 → 小写。 */
export function pathIdentity(p) {
  const raw = String(p ?? '');
  if (!raw) return '';
  let abs = raw;
  if (raw.startsWith('file:')) {
    try {
      abs = fileURLToPath(raw);
    } catch {
      return raw.toLowerCase();
    }
  }
  try {
    abs = fs.realpathSync.native ? fs.realpathSync.native(abs) : fs.realpathSync(abs);
  } catch {
    abs = path.resolve(abs);
  }
  return abs.replace(/\\/g, '/').toLowerCase();
}

/** 两个路径（路径或 `file://` URL）是否指向同一处。 */
export function samePath(a, b) {
  return pathIdentity(a) === pathIdentity(b);
}
