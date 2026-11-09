/**
 * verify_py —— go→py 骨架的**语法闸**（第⑩项的最小验证档）。
 *
 * ## 诚实边界（lead 裁定 2026-11-10）
 * TS 侧的验证链是「tree-sitter 语法 + tsc 结构闸 + 行为对拍」；Python 侧**只有语法闸**
 * （`ast.parse`，标准库零依赖）。结构闸（类型一致性）与行为对拍**没有等价物** ⇒ **不做且如实
 * 标 unsupported**——比没有强，不如 tsc 强，消费方（capability_map / receipt）按此口径标注。
 *
 * ## 实现
 * `spawnSync python -c "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())"`：
 * 退出码 0 = 全部骨架可解析；非 0 = 语法错（stderr 带 ast 的行列定位，原样透传）。
 * ★ 跨单元拼成**一份文件**再 parse（import 头只加一次；单元间循环引用在骨架阶段不存在——
 *   骨架只有签名没有调用体）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { TransUnit } from './unit.js';
import type { VerifyIssue } from './verify.js';

const PY = process.platform === 'win32' ? 'python' : 'python3';

export function pythonToolchainIssue(): string | null {
  const r = spawnSync(PY, ['--version'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (r.error) return `${PY} 不可用：${r.error.message}`;
  if (r.status !== 0) return `${PY} --version 退出码 ${r.status}`;
  return null;
}

/** 全部单元的骨架拼一份 .py 文件过 ast.parse；问题按单元归因（用偏移量切割定位） */
export function verifyPySkeletons(units: TransUnit[]): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  const body = units.map((u) => u.skeleton).join('\n\n');
  if (!body.trim()) return [{ id: '(all)', gate: 'structure', detail: '骨架为空（未生成）' }];
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pygate-')), 'skeleton.py');
  try {
    fs.writeFileSync(tmp, body, 'utf-8');
    const parseCode = "import ast,sys; ast.parse(open(sys.argv[1],encoding='utf-8').read())";
    let r = spawnSync(PY, ['-c', parseCode, tmp], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    // ★★ 受限沙箱回退（与 case_program_fakes 的 spawn 双通道同模式）：pipe stdio 的 spawn 一律 EPERM
    //   ⇒ 降级为 cmd 批处理重定向（python 把诊断写进 err.txt，退出码仍是判定）。
    if (r.error && (r.error as NodeJS.ErrnoException).code === 'EPERM') {
      const errFile = path.join(path.dirname(tmp), 'err.txt');
      const bat = path.join(path.dirname(tmp), 'run.cmd');
      fs.writeFileSync(bat, `"${PY}" -c "${parseCode.replace(/"/g, '\\"')}" %1 > nul 2> "${errFile}"\r\n`, 'utf-8');
      r = spawnSync('cmd.exe', ['/d', '/c', bat, tmp], { encoding: 'utf8', timeout: 30_000, windowsHide: true, stdio: 'ignore' });
      if (r.status !== 0 && fs.existsSync(errFile)) {
        const txt = fs.readFileSync(errFile, 'utf-8');
        (r as { stderr?: string }).stderr = txt;
      }
      try {
        fs.rmSync(bat, { force: true });
      } catch {
        /* best effort */
      }
    }
    if (r.status !== 0) {
      const msg = (r.stderr || r.stdout || '').trim().split('\n').slice(-4).join(' | ');
      // 按偏移归因到单元：从错误消息里的 `<unknown>:LINE` 找行号 → 落在哪个单元的范围里
      const lineMatch = /File "<unknown>", line (\d+)/.exec(msg);
      let id = '(all)';
      if (lineMatch) {
        const errLine = Number(lineMatch[1]);
        let acc = 1;
        for (const u of units) {
          const n = u.skeleton.split('\n').length + 1; // +1 = 单元间空行
          if (errLine >= acc && errLine < acc + n) { id = u.id; break; }
          acc += n;
        }
      }
      issues.push({ id, gate: 'syntax', detail: `Python ast.parse 失败：${msg}` });
    }
  } catch (e) {
    issues.push({ id: '(all)', gate: 'syntax', detail: `Python 工具链跑不了：${(e as Error).message}` });
  } finally {
    try {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    } catch {
      /* Windows 留给 OS */
    }
  }
  return issues;
}
