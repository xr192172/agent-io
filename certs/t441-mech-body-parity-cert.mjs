#!/usr/bin/env node
/**
 * ★★★ cert T441 —— **机械翻的每条规则都拿 Go 与 TS 同批输入对拍**（2026-10-29）
 *
 * ## 为什么用夹具而不是真仓
 * 真仓（agent-memory）里机械可翻的函数**几乎都是小写未导出函数**，而 Go 侧执行核是
 * 「把源文件放进独立包 `x/x.go` + main 调用」⇒ **只能调导出函数**（Go 包边界）。
 * 真仓里"机械可翻 + 导出 + 纯基本类型 + 无包内类型"的候选 = **0 个**。
 * ⇒ 对拍只能落在**夹具**上：每条机械规则一个自包含导出函数，逐条比输出。
 *
 * ## 判据
 *   ① 每条规则的夹具：`translateGoBodyMech` 能翻（非 null）；
 *   ② 翻出来的 TS 与 Go **行为一致**（`checkTranslationParity` verdict = same，逐 case）；
 *   ③ **反向控制**：故意把某个函数体改成错的 ⇒ verdict 必须变 `diff`（证明这不是恒绿的空证）；
 *   ④ 真仓覆盖率 ≥ 80%（机械翻没被改退），并如实打印剩余阻碍。
 *
 * ## 覆盖边界（诚实清单 · [未核]）
 *   · `defer → try/finally` 只验了**结构**（生成形状对、LIFO 反序）；**执行时机**要可观副作用才能对拍，
 *     本证不覆盖 ⇒ `[未核]`；
 *   · 只覆盖基本类型（int/float/string/bool 及切片）：指针、map、struct 语义差距本证不判；
 *   · 真仓覆盖率依赖外部仓存在（没有则跳过并说明）。
 *
 * ## 用法
 *   npm run build && node certs/t441-mech-body-parity-cert.mjs     # 约 30s（每条要跑一次 go run）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const D = 'file:///' + path.join(ROOT, 'dist/src').replace(/\\/g, '/') + '/';

const { parseAstRoot } = await import(D + 'infrastructure/parse/index.js');
const mech = await import(D + 'infrastructure/authoring/translate/body_mech.js');
const { checkTranslationParity } = await import(D + 'infrastructure/authoring/translate/verify_behavior.js');

let P = 0;
let F = 0;
const chk = (ok, label, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? `\n     ${extra}` : ''}`);
  ok ? P++ : F++;
};

/** 夹具：每条对应 body_mech 的一条规则；导出 + 只用基本类型（Go harness 要求） */
const FIXTURES = [
  {
    rule: '三式 for → for(;;)',
    name: 'SumTo',
    params: [{ name: 'n', type: 'int' }],
    ret: 'int',
    go: `func SumTo(n int) int {
	s := 0
	for i := 0; i < n; i++ {
		s += i
	}
	return s
}`,
  },
  {
    rule: 'if / else if / 兜底',
    name: 'Sign',
    params: [{ name: 'n', type: 'int' }],
    ret: 'int',
    go: `func Sign(n int) int {
	if n > 0 {
		return 1
	} else if n < 0 {
		return -1
	}
	return 0
}`,
  },
  {
    rule: '表达式 switch → switch',
    name: 'KindOf',
    params: [{ name: 'n', type: 'int' }],
    ret: 'string',
    go: `func KindOf(n int) string {
	switch n {
	case 1:
		return "one"
	case 2:
		return "two"
	default:
		return "other"
	}
}`,
  },
  {
    rule: '内建转换 float64(x) 与 len(s) → .length',
    name: 'LenAsFloat',
    params: [{ name: 's', type: 'string' }],
    ret: 'float64',
    go: `func LenAsFloat(s string) float64 {
	return float64(len(s))
}`,
  },
  {
    rule: '条件 for → while（不含除法：整除语义缺类型环境，已改为交 LLM）',
    name: 'CountDownTo',
    params: [{ name: 'n', type: 'int' }],
    ret: 'int',
    go: `func CountDownTo(n int) int {
	c := 0
	for n > 1 {
		n = n - 1
		c++
	}
	return c
}`,
  },
  {
    rule: '一元 ! 与逻辑运算；\`:=\` 后自增',
    name: 'CountDown',
    params: [{ name: 'n', type: 'int' }],
    ret: 'int',
    go: `func CountDown(n int) int {
	c := 0
	for n > 0 {
		if !(n < 0) && n != 3 {
			c++
		}
		n--
	}
	return c
}`,
  },
];

const TS_TYPE = { int: 'number', float64: 'number', string: 'string', bool: 'boolean', '[]int': 'number[]' };

/** 从 Go 源码里取出函数体 block 节点 */
async function blockOf(goSrc) {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? '/tmp', 't441-'));
  const f = path.join(dir, 'x.go');
  fs.writeFileSync(f, `package x\n\n${goSrc}\n`);
  const { root } = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
  const all = [];
  const w = (n) => {
    all.push(n);
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i);
      if (c) w(c);
    }
  };
  w(root);
  const fn = all.find((n) => n.type === 'function_declaration');
  let block = null;
  for (let i = 0; i < fn.childCount; i++) {
    const c = fn.child(i);
    if (c && c.type === 'block') block = c;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return block;
}

let sameCount = 0;
let diffCount = 0;
for (const fx of FIXTURES) {
  const block = await blockOf(fx.go);
  const body = mech.translateGoBodyMech(block);
  chk(body !== null, `① [${fx.rule}] 机械翻得出`, body === null ? '翻不动（规则没覆盖）' : body.split('\n')[0].trim().slice(0, 70));
  if (body === null) continue;

  const tsOut = `export function ${fx.name}(${fx.params.map((p) => `${p.name}: ${TS_TYPE[p.type]}`).join(', ')}): ${TS_TYPE[fx.ret]} {\n${body}\n}\n`;
  let verdict;
  let msg = '';
  try {
    const r = checkTranslationParity({ goSource: `${fx.go}\n`, tsOutput: tsOut, funcName: fx.name, params: fx.params });
    verdict = r.verdict.verdict;
    msg = r.verdict.message ?? '';
  } catch (e) {
    verdict = 'error';
    msg = String(e?.message ?? e).slice(0, 120);
  }
  chk(verdict === 'same', `② [${fx.rule}] 对拍 same（Go 与 TS 同批输入一致）`, `${verdict}${msg ? ' · ' + msg.slice(0, 80) : ''}`);
  if (verdict === 'same') sameCount++;
  else diffCount++;
}

// ③ 反向控制：故意写错一个，必须 diff
{
  // ★ 2026-10-29：反向控制原来用 `SumTo`（样例 0/1/-1/5 ⇒ 全都返回 0），**错的实现也是 0** ⇒ 空转恒绿。
  //   换成 `Sign`（1 / -1 / 0 三种输出）⇒ 错的实现必被抓住。教训：反向控制的对象**自己必须非退化**。
  const fx = FIXTURES.find((f) => f.name === 'Sign');
  const badTs = `export function ${fx.name}(n: number): number {\n  return 0;\n}\n`;
  let verdict;
  try {
    verdict = checkTranslationParity({ goSource: `${fx.go}\n`, tsOutput: badTs, funcName: fx.name, params: fx.params }).verdict.verdict;
  } catch {
    verdict = 'error';
  }
  chk(verdict === 'diff', '③ **反向控制**：故意写错的函数体必须判 diff（证不是恒绿）', `实际 ${verdict}`);
}

// ④ 真仓覆盖率没退
{
  const repo = 'D:/agentio/dev/agent-memory';
  if (!fs.existsSync(path.join(repo, 'go.mod'))) {
    console.log('（跳过 ④：本机没有 agent-memory）');
  } else {
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (!/node_modules|\.git$/.test(p)) walk(p);
        } else if (e.name.endsWith('.go') && !e.name.endsWith('_test.go')) files.push(p);
      }
    };
    walk(repo);
    let total = 0;
    let ok = 0;
    const blockers = new Map();
    for (const f of files) {
      let parsed;
      try {
        parsed = await parseAstRoot(f, fs.readFileSync(f, 'utf8'));
      } catch {
        continue;
      }
      if (!parsed?.root) continue;
      const all = [];
      const w = (n) => {
        all.push(n);
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i);
          if (c) w(c);
        }
      };
      w(parsed.root);
      for (const fn of all.filter((n) => n.type === 'function_declaration' || n.type === 'method_declaration')) {
        let block = null;
        for (let i = 0; i < fn.childCount; i++) {
          const c = fn.child(i);
          if (c && c.type === 'block') block = c;
        }
        if (!block) continue;
        total++;
        const b = mech.mechBlocker(block);
        if (!b) ok++;
        else blockers.set(b.type, (blockers.get(b.type) ?? 0) + 1);
      }
    }
    const rate = total ? (ok / total) * 100 : 0;
    chk(rate >= 80, `④ 真仓机械覆盖率 ≥ 80%（当前 ${rate.toFixed(1)}%，${ok}/${total}）`);
    console.log('     剩余阻碍：' + [...blockers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}×${v}`).join(' · '));
  }
}

console.log(`\n对拍小计：same=${sameCount} · 非 same=${diffCount}`);
console.log(`\n═══ T441 读数：PASS=${P} FAIL=${F} ═══`);
console.log(`════ 汇总：PASS=${P}  FAIL=${F}`);
process.exit(F === 0 ? 0 : 1);
