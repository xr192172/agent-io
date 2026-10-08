const REPO = 'D:/project_develop/design-canvas';
const tc = await import('file://' + REPO + '/dist/src/infrastructure/packages/template_compat.js');

// 旧公式（从重写前的代码逐字抄回）
const OLD = (usesNan, install, built) =>
  usesNan === true ? 'incompatible'
  : built === true ? 'ok'
  : install === 'node-gyp-build' ? 'ok' : 'incompatible';

// ★ `--json`：吐**事实 → 代际 → verdict** 的全组合（供快照观测）
if (process.argv.includes('--json')) {
  const out = [];
  for (const un of [true, false, null]) for (const ins of ['node-gyp-build', 'other-script', null]) for (const b of [true, false, null])
    out.push({ usesNan: un, installScript: ins, hasBuiltBinding: b, gen: tc.bindingGenerationOf({ usesNan: un, installScript: ins, hasBuiltBinding: b }), verdict: tc.bindingVerdictOf(tc.bindingGenerationOf({ usesNan: un, installScript: ins, hasBuiltBinding: b })) });
  console.log(JSON.stringify(out));
  process.exit(0);
}
const V = [true, false, null];
const S = ['node-gyp-build', 'other-script', null];
const B = [true, false, null];
let diff = 0, n = 0;
const rows = [];
for (const un of V) for (const ins of S) for (const b of B) {
  n++;
  const o = OLD(un, ins, b);
  const gen = tc.bindingGenerationOf({ usesNan: un, installScript: ins, hasBuiltBinding: b });
  const v = tc.bindingVerdictOf(gen);
  if (o !== v) { diff++; rows.push({ un, ins, b, o, v, gen }); }
}
console.log(`逐点对照：${n} 种组合，**行为不一致 ${diff} 处**`);
for (const r of rows) console.log(`  usesNan=${r.un} install=${r.ins} built=${r.b}  旧=${r.o} 新=${r.v}（代际=${r.gen}）`);
if (!diff) console.log('✅ 新判据与旧判据在**全部组合**上一致 ⇒ 是**等价重写**（不是行为改动）');
// 另：入口层的 unknown 仍然保留
console.log('入口层：templateCompatFromPkgJson(null) =', tc.templateCompatFromPkgJson(null));
console.log('代际抽样：', JSON.stringify([
  ['nan', tc.bindingGenerationOf({ usesNan: true, installScript: null, hasBuiltBinding: null })],
  ['自建', tc.bindingGenerationOf({ usesNan: false, installScript: null, hasBuiltBinding: true })],
  ['模板', tc.bindingGenerationOf({ usesNan: false, installScript: 'node-gyp-build', hasBuiltBinding: null })],
  ['皆非', tc.bindingGenerationOf({ usesNan: false, installScript: null, hasBuiltBinding: null })],
]));
console.log('判词抽样：');
for (const [label, args] of [['自建', ['ok', false, 'self-built']], ['皆非', ['incompatible', false, 'no-napi-export']], ['nan', ['incompatible', true, 'nan']]])
  console.log(`  ${label}: ${tc.templateCompatReason(...args)}`);
