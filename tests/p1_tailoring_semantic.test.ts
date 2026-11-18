/**
 * touches: src/domain/tailoring/{entities,operators,validate,pack}.ts
 *
 * P1 · **制衣领域包**的机器回归 —— 2026-11-18
 *
 * 钉住的东西（每条都能回到需求源一句原话，见 `tailoring/validate.ts` 的表）：
 * ① 包本身装得进核且自洽（`loadTailoringPack`）+ 经核的 JSON 往返无损；
 * ② R1/R2 缝口互指 + 类型兼容；R3 跨版片接缝；
 * ③ R4/R5 公式变量登记 + 不成环；
 * ④ R6–R9 一卷布三段（缸号/卷号唯一、缸号必填、色号两层一致、实测米数、不许拍平）；
 * ⑤ R10 量体（键登记 / 来源必填 / 域内 / 混单位）；R11 关系不许是烘焙结果；
 * ⑥ 七个业务算子的契约完整（判据非空、输入种类都登记、几何判据一律 unsupported）；
 * ⑦ GarmentSpec 组合构造（一件上衣：衣身+双袖+袖口+领片，接缝两端跨片）；
 * ⑧ 核的 G 系列在**真实包**上同样成立（不是玩具域才过）。
 *
 * ★ 每条反例都先断言"正例绿"再断言"反例红" —— 否则一条恒红的判据也能"通过"这条测试。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  auditTailoringEntities,
  loadTailoringPack,
  MEASURE_KEYS,
  MEASURE_RANGES_CM,
  TAILORING_ENTITY_FIELDS,
  TAILORING_PROFILE,
  tailoringEntities,
  tailoringModel,
  tailoringOperators,
  validateTailoring,
  type TailoringGap,
} from '../src/domain/tailoring/index.js';
import { criteriaTally, roundTrip, validateModel, type EntityDef } from '../src/domain/semantic_model/index.js';

/** 便捷构造一个实体（内容住 attrs） */
const ent = (id: string, kind: string, attrs: Record<string, unknown> = {}): EntityDef => ({ id, semanticName: id.split('.').pop() ?? id, kind, attrs });

/** 取某个 rule 的 gap 键（反例点名用） */
const keysOf = (gaps: readonly TailoringGap[], rule: TailoringGap['rule']): string[] => gaps.filter((g) => g.rule === rule).map((g) => g.key);

/**
 * 一件**合法的上衣**（A3.2 的测试载体：衣身 + 双袖 + 袖口 + 领片）。
 * 接缝 = 袖片肩端 ↔ 衣身袖窿端（跨片、同类型），袖口 ↔ 袖下口。全部互指。
 */
function topSpec(): EntityDef[] {
  return [
    ent('piece.bodice', 'pattern_piece', { name: '衣身', kind: 'bodice', seamAllowanceMm: 10, portIds: ['port.armhole.L', 'port.armhole.R', 'port.neck'] }),
    ent('piece.sleeve.L', 'pattern_piece', { name: '左袖', kind: 'sleeve', seamAllowanceMm: 10, portIds: ['port.armL.top', 'port.armL.cuff'] }),
    ent('piece.sleeve.R', 'pattern_piece', { name: '右袖', kind: 'sleeve', seamAllowanceMm: 10, portIds: ['port.armR.top', 'port.armR.cuff'] }),
    ent('piece.cuff.L', 'pattern_piece', { name: '左袖口', kind: 'cuff', seamAllowanceMm: 10, portIds: ['port.cuffL.in'] }),
    ent('piece.collar', 'pattern_piece', { name: '领片', kind: 'collar', seamAllowanceMm: 10, portIds: ['port.collar.base'] }),

    ent('port.armhole.L', 'seam_port', { pieceId: 'piece.bodice', edgeId: 'e.armhole.L', portType: 'fuse', outlineFamily: 'ellipse', matedPortId: 'port.armL.top' }),
    ent('port.armL.top', 'seam_port', { pieceId: 'piece.sleeve.L', edgeId: 'e.sleeve.top', portType: 'fuse', outlineFamily: 'ellipse', matedPortId: 'port.armhole.L' }),
    ent('port.armhole.R', 'seam_port', { pieceId: 'piece.bodice', edgeId: 'e.armhole.R', portType: 'fuse', outlineFamily: 'ellipse', matedPortId: 'port.armR.top' }),
    ent('port.armR.top', 'seam_port', { pieceId: 'piece.sleeve.R', edgeId: 'e.sleeve.top', portType: 'fuse', outlineFamily: 'ellipse', matedPortId: 'port.armhole.R' }),
    ent('port.armL.cuff', 'seam_port', { pieceId: 'piece.sleeve.L', edgeId: 'e.sleeve.cuff', portType: 'fuse', outlineFamily: 'circle', matedPortId: 'port.cuffL.in' }),
    ent('port.cuffL.in', 'seam_port', { pieceId: 'piece.cuff.L', edgeId: 'e.cuff.in', portType: 'fuse', outlineFamily: 'circle', matedPortId: 'port.armL.cuff' }),
    ent('port.neck', 'seam_port', { pieceId: 'piece.bodice', edgeId: 'e.neck', portType: 'hinge', outlineFamily: 'slot' }),
    ent('port.collar.base', 'seam_port', { pieceId: 'piece.collar', edgeId: 'e.collar.base', portType: 'hinge', outlineFamily: 'slot' }),

    ent('spec.top', 'garment_spec', {
      name: '宽松针织上衣',
      tier: 'refined',
      pieceIds: ['piece.bodice', 'piece.sleeve.L', 'piece.sleeve.R', 'piece.cuff.L', 'piece.collar'],
      seamIds: ['port.armhole.L', 'port.armhole.R', 'port.armL.cuff'],
      parameterDomainRef: 'formulas.shirt.v1',
    }),
  ];
}

/** 合法的量体档案（A6.8：10~15 个尺寸） */
function measureFile(): EntityDef {
  const v = (key: string, value: number, source = 'in_store_tape', unit = 'cm') => ({ key, value, unit, source });
  return ent('measure.alice', 'body_measurement', {
    subjectId: 'alice',
    at: '2026-11-18T10:00:00Z',
    basis: 'net',
    values: [v('height', 165), v('bust', 88), v('waist', 70), v('hip', 94), v('shoulderTotal', 39), v('shoulderSmall', 13), v('sleeveLength', 56)],
  });
}

/** 合法的放码公式集（A6.8 的两条原话公式） */
function formulaSet(): EntityDef {
  return ent('formulas.shirt.v1', 'constraint_set', {
    dialect: 'literal',
    formulas: {
      armholeDepth: 'bust / 4 + ease',
      chestWidth: 'bust / 4 - 1.5',
      ease: '8',
    },
    source: '姑姑制版经验（A6.8）',
  });
}

/** 合法的一卷布（三段：主档 → 缸号 → 卷） */
function roll(id: string, lotNo: string, rollNo: string, extra: Record<string, unknown> = {}): EntityDef {
  return ent(id, 'fabric_roll', { masterId: 'master.cottonLinen', lotNo, rollNo, measuredLengthM: 42.5, colorCode: 'C230', ...extra });
}

// ════════════════════════════════════════════════════════════════════
// ① 包装得进核 + 往返无损
// ════════════════════════════════════════════════════════════════════
test('① 制衣包装进核并自洽；经核的 JSON 往返无损', () => {
  const reg = loadTailoringPack();
  assert.equal(reg.profile, TAILORING_PROFILE, `①a profile 必须是 ${TAILORING_PROFILE}`);
  assert.equal(reg.allEntities().length, tailoringEntities().length, `①b 实体条数必须 = 包声明的条数：实测 ${String(reg.allEntities().length)}`);
  assert.equal(reg.allOperators().length, tailoringOperators().length, `①c 算子条数必须 = 包声明的条数：实测 ${String(reg.allOperators().length)}`);
  assert.equal(reg.allOperators().length, 8, `①d v1 的算子是 8 个（measure/grade/name/seam/attach/unseam/cut/checkin）：实测 ${String(reg.allOperators().length)}`);
  assert.deepEqual(validateModel(reg.snapshot()), [], '①e 包本身必须过核体检（G1–G5 全清）');

  // ①f 六个实体种类与字段域都在
  assert.deepEqual(Object.keys(TAILORING_ENTITY_FIELDS).sort(), ['body_measurement', 'constraint_set', 'fabric_roll', 'garment_spec', 'pattern_piece', 'seam_port'], '①f 六个实体种类');

  // ①g 往返无损（包 + 一条调用记录）
  assert.equal(reg.registerEntity(ent('piece.bodice', 'pattern_piece', { name: '衣身', kind: 'bodice', seamAllowanceMm: 10, portIds: [] })).ok, true, '①g registerEntity(piece.bodice) 必须成功');
  assert.equal(reg.registerEntity(ent('piece.collar', 'pattern_piece', { name: '领片', kind: 'collar', seamAllowanceMm: 10, portIds: [] })).ok, true, '①g registerEntity(piece.collar) 必须成功');
  // ★ 包里的 `formulas.shirt.v1` 是**种子样板**（没有 attrs）；这里造一份有公式的实体借同一个 id 之外的名字，
  //   避免"用种子 id 覆盖真实数据"这种坏习惯在测试里先立起来。
  assert.equal(reg.registerEntity(ent('formulas.top', 'constraint_set', { dialect: 'literal', formulas: { ease: '8' } })).ok, true, '①g registerEntity(formulas.top) 必须成功');
  const callOutcome = reg.recordCall({ op: 'cut', version: 1, args: ['piece.bodice', 'formulas.top'], at: '2026-11-18T10:05:00Z' });
  assert.equal(callOutcome.ok, true, `①g recordCall(cut) 必须成功：实测 ${callOutcome.ok ? '' : callOutcome.message}`);
  const before = reg.snapshot();
  const { back } = roundTrip(before);
  assert.deepEqual(back, before, '①g 包 + 调用记录往返后必须逐字段相等');
});

// ════════════════════════════════════════════════════════════════════
// ② 缝口：R1 互指 / R2 类型兼容 / R3 跨版片
// ════════════════════════════════════════════════════════════════════
test('② R1/R2/R3：互指、类型兼容、跨版片接缝（正例绿 + 三条反例红）', () => {
  const ok = topSpec();
  assert.deepEqual(validateTailoring(ok), [], '②0 合法的上衣必须零 gap（否则后面的反例不可归因）');

  // ②a R1 单向对接（只 a 指 b，b 没指回来）
  const oneWay = topSpec();
  (oneWay.find((e) => e.id === 'port.armhole.L')!.attrs as Record<string, unknown>)['matedPortId'] = 'port.armL.top';
  (oneWay.find((e) => e.id === 'port.armL.top')!.attrs as Record<string, unknown>)['matedPortId'] = undefined;
  const oneWayGaps = validateTailoring(oneWay);
  assert.deepEqual(keysOf(oneWayGaps, 'R1'), ['one_way_mate:port.armhole.L'], `②a R1 必须点名单向的那一端：实测 ${keysOf(oneWayGaps, 'R1').join(',')}`);

  // ②b R1 自指
  const selfMate = topSpec();
  (selfMate.find((e) => e.id === 'port.neck')!.attrs as Record<string, unknown>)['matedPortId'] = 'port.neck';
  assert.deepEqual(keysOf(validateTailoring(selfMate), 'R1'), ['self_mated:port.neck'], '②b R1 必须点出自指');

  // ②c R2 类型不兼容（hinge 接 fuse）
  const mismatch = topSpec();
  (mismatch.find((e) => e.id === 'port.neck')!.attrs as Record<string, unknown>)['matedPortId'] = 'port.collar.base';
  (mismatch.find((e) => e.id === 'port.collar.base')!.attrs as Record<string, unknown>)['portType'] = 'fuse';
  const mGaps = validateTailoring(mismatch);
  assert.deepEqual(keysOf(mGaps, 'R2'), ['type_mismatch:port.neck'], `②c R2 必须点名类型不合的那个口：实测 ${keysOf(mGaps, 'R2').join(',')}`);

  // ②d R3 接缝两端在同一片
  // ★ 互指的两端**各报一次**（每条端口都是"接缝的一端"，报两处是诚实的；但反例必须**点名**到这一对）
  const samePiece = topSpec();
  const p = samePiece.find((e) => e.id === 'port.armL.cuff')!.attrs as Record<string, unknown>;
  p['pieceId'] = 'piece.sleeve.L';
  (samePiece.find((e) => e.id === 'port.cuffL.in')!.attrs as Record<string, unknown>)['pieceId'] = 'piece.sleeve.L';
  const dGaps = keysOf(validateTailoring(samePiece), 'R3').sort();
  assert.deepEqual(dGaps, ['same_piece_seam:spec.top:port.armL.cuff', 'same_piece_seam:spec.top:port.cuffL.in'], `②d R3 必须点名"同一片的两条边不是接缝"（两端各一条）：实测 ${dGaps.join(',')}`);

  // ②e R3 接缝有一端挂到款式之外
  const outside = topSpec();
  const spec = outside.find((e) => e.id === 'spec.top')!.attrs as Record<string, unknown>;
  spec['pieceIds'] = ['piece.bodice', 'piece.sleeve.L', 'piece.sleeve.R']; // 把袖口与领片踢出款式
  const oGaps = keysOf(validateTailoring(outside), 'R3');
  assert.ok(oGaps.includes('seam_outside_spec:spec.top:port.armL.cuff'), `②e R3 必须点名挂到款式之外的接缝：实测 ${oGaps.join(',')}`);
});

// ════════════════════════════════════════════════════════════════════
// ③ 公式：R4 变量登记 / R5 不成环
// ════════════════════════════════════════════════════════════════════
test('③ R4/R5：公式变量必须已登记、公式不许成环', () => {
  assert.deepEqual(validateTailoring([formulaSet()]), [], '③0 合法公式集必须零 gap');

  // ③a R4 用了没登记的变量
  const unknownVar = formulaSet();
  (unknownVar.attrs as Record<string, unknown>)['formulas'] = { armholeDepth: 'bust / 4 + sprocketSize' };
  assert.deepEqual(keysOf(validateTailoring([unknownVar]), 'R4'), ['formula_var_unknown:formulas.shirt.v1:armholeDepth:sprocketSize'], '③a R4 必须点名未登记的变量');

  // ③b R4 也认"本集内中间量"（ease 在本集里 ⇒ 合法）
  const withEase = formulaSet();
  (withEase.attrs as Record<string, unknown>)['formulas'] = { armholeDepth: 'bust / 4 + ease', ease: '8' };
  assert.deepEqual(keysOf(validateTailoring([withEase]), 'R4'), [], '③b 本集内中间量不是未登记变量');

  // ③c R5 成环 a→b→a
  const cyclic = formulaSet();
  (cyclic.attrs as Record<string, unknown>)['formulas'] = { a: 'b + 1', b: 'a + 1' };
  const cyc = keysOf(validateTailoring([cyclic]), 'R5');
  assert.equal(cyc.length, 1, `③c R5 必须报一次环：实测 ${String(cyc.length)}`);
  assert.match(cyc[0], /^formula_cycle:formulas\.shirt\.v1:[ab]$/, `③c 环必须点出环上的参数名：实测 ${cyc[0]}`);

  // ③d R5 自环
  const selfCycle = formulaSet();
  (selfCycle.attrs as Record<string, unknown>)['formulas'] = { a: 'a + 1' };
  assert.match(keysOf(validateTailoring([selfCycle]), 'R5')[0] ?? '', /^formula_cycle:.*:a$/, '③d 自环必须红');
});

// ════════════════════════════════════════════════════════════════════
// ④ 一卷布：R6/R7/R7b/R8/R9
// ════════════════════════════════════════════════════════════════════
test('④ 一卷布三段：缸号/卷号唯一、缸号必填、色号两层一致、实测米数、不许拍平', () => {
  const master = ent('master.cottonLinen', 'fabric_master', { masterName: '棉麻平纹', colorCode: 'C230' });
  const good = [master, roll('roll.a', 'D20261105', 'R-001'), roll('roll.b', 'D20261105', 'R-002'), roll('roll.c', 'D20261112', 'R-003')];
  assert.deepEqual(validateTailoring(good), [], '④0 同缸多卷是**合法**的（A6.2 理由④"子类下仍有多卷多缸"）');

  // ④a R6 卷号重复
  const dupRoll = [...good, roll('roll.d', 'D20261112', 'R-001')];
  assert.deepEqual(keysOf(validateTailoring(dupRoll), 'R6'), ['duplicate_roll_no:R-001'], '④a R6 卷号重复必须红');

  // ④b R7 缸号空
  const noLot = [master, roll('roll.e', '', 'R-009')];
  assert.deepEqual(keysOf(validateTailoring(noLot), 'R7'), ['lot_missing:roll.e'], '④b R7 缸号空必须红');

  // ④c R7b 色号两层不一致
  const wrongColor = [master, roll('roll.f', 'D20261105', 'R-010', { colorCode: 'C999' })];
  assert.deepEqual(keysOf(validateTailoring(wrongColor), 'R7'), ['color_mismatch:roll.f'], '④c R7b 色号不一致必须红');

  // ④d R8 只有来料单米数、没有实测
  const inboundOnly = ent('roll.g', 'fabric_roll', { masterId: 'master.cottonLinen', lotNo: 'D20261105', rollNo: 'R-011', inboundLengthM: 45 });
  const g8 = keysOf(validateTailoring([master, inboundOnly]), 'R8');
  assert.deepEqual(g8, ['measured_missing:roll.g'], `④d R8 必须红并点名"只给了来料单米数"：实测 ${g8.join(',')}`);
  assert.match(validateTailoring([master, inboundOnly]).find((g) => g.rule === 'R8')!.message, /来料单米数/, '④d 报文必须点出"只给了来料单米数"');

  // ④e R8 负数 / 非数
  assert.deepEqual(keysOf(validateTailoring([master, roll('roll.h', 'D20261105', 'R-012', { measuredLengthM: -3 })]), 'R8'), ['measured_negative:roll.h'], '④e 负实测米数必须红');
  assert.deepEqual(keysOf(validateTailoring([master, roll('roll.i', 'D20261105', 'R-013', { measuredLengthM: '42.5' })]), 'R8'), ['measured_not_number:roll.i'], '④e 字符串米数必须红（静默转数是账实不符的源头）');

  // ④f R9 三段被拍平：卷没有 masterId
  const flat = ent('roll.j', 'fabric_roll', { lotNo: 'D20261105', rollNo: 'R-014', measuredLengthM: 10 });
  assert.deepEqual(keysOf(validateTailoring([flat]), 'R9'), ['roll_no_master:roll.j'], '④f R9 必须点名"卷没有挂在主档下"');

  // ④g R9 连 lotNo 这一格都没有
  const noLotField = ent('roll.k', 'fabric_roll', { masterId: 'master.cottonLinen', rollNo: 'R-015', measuredLengthM: 10 });
  assert.deepEqual(keysOf(validateTailoring([master, noLotField]), 'R9'), ['roll_no_lot_field:roll.k'], '④g R9 必须点名"批次层被拍平"');
});

// ════════════════════════════════════════════════════════════════════
// ⑤ 量体 R10 + 关系 R11
// ════════════════════════════════════════════════════════════════════
test('⑤ R10 量体（键/来源/域内/混单位）+ R11 关系必须是声明', () => {
  assert.deepEqual(validateTailoring([measureFile()]), [], '⑤0 合法量体档案必须零 gap');

  // ⑤a R10 未登记的键
  const badKey = measureFile();
  (badKey.attrs as Record<string, unknown>)['values'] = [{ key: 'thighCirc', value: 55, unit: 'cm', source: 'in_store_tape' }];
  assert.deepEqual(keysOf(validateTailoring([badKey]), 'R10'), ['measurement_key_unknown:measure.alice:thighCirc'], '⑤a R10 未登记键必须红');

  // ⑤b R10 缺来源（A7.4：来源必须可溯）
  const noSource = measureFile();
  (noSource.attrs as Record<string, unknown>)['values'] = [{ key: 'bust', value: 88, unit: 'cm' }];
  assert.deepEqual(keysOf(validateTailoring([noSource]), 'R10'), ['measurement_source:measure.alice:bust'], '⑤b R10 缺来源必须红');

  // ⑤c R10 超出声明域（胸围 500cm）
  const outOfRange = measureFile();
  (outOfRange.attrs as Record<string, unknown>)['values'] = [{ key: 'bust', value: 500, unit: 'cm', source: 'self_report' }];
  assert.deepEqual(keysOf(validateTailoring([outOfRange]), 'R10'), ['measurement_range:measure.alice:bust'], '⑤c R10 超域必须红');

  // ⑤d R10 cm/inch 混用
  const mixed = measureFile();
  (mixed.attrs as Record<string, unknown>)['values'] = [
    { key: 'bust', value: 88, unit: 'cm', source: 'in_store_tape' },
    { key: 'waist', value: 27.6, unit: 'inch', source: 'in_store_tape' },
  ];
  assert.deepEqual(keysOf(validateTailoring([mixed]), 'R10'), ['measurement_mixed_units:measure.alice'], '⑤d R10 混单位必须红');
  // ★ 混单位时**不**再报 waist 超域（inch 不算 cm 域）：域判据只对 cm 生效
  assert.ok(!keysOf(validateTailoring([mixed]), 'R10').some((k) => k.includes('measurement_range')), '⑤d inch 值不该被 cm 域误判');

  // ⑤e R11 关系带了烘焙几何
  const baked = ent('piece.bodice', 'pattern_piece', { name: '衣身', kind: 'bodice', seamAllowanceMm: 10, relations: [{ kind: 'blend', with: 'piece.collar', bakedMesh: 'v1.bin' }] });
  assert.deepEqual(keysOf(validateTailoring([baked]), 'R11'), ['relation_baked:piece.bodice:0:bakedMesh'], '⑤e R11 烘焙几何必须红（#25）');

  // ⑤f R11 合法声明（只带约束参数）
  const decl = ent('piece.bodice', 'pattern_piece', { name: '衣身', kind: 'bodice', seamAllowanceMm: 10, relations: [{ kind: 'blend', with: 'piece.collar', falloff: 0.3 }] });
  assert.deepEqual(keysOf(validateTailoring([decl]), 'R11'), [], '⑤f 只带参数的声明是合法的');
});

// ════════════════════════════════════════════════════════════════════
// ⑥ 算子契约完整
// ════════════════════════════════════════════════════════════════════
test('⑥ 算子契约：判据非空、输入种类都登记、几何判据一律 unsupported', () => {
  const ops = tailoringOperators();
  const names = ops.map((o) => o.name).sort();
  assert.deepEqual(names, ['attach', 'checkin', 'cut', 'grade', 'measure', 'name', 'seam', 'unseam'], `⑥a 八个算子的语义名：实测 ${names.join(',')}`);

  // ⑥b 每个算子至少一条判据（G3），且 why 非空
  for (const op of ops) {
    assert.ok(op.criteria.length > 0, `⑥b 算子 "${op.name}" 一条判据都没有`);
    for (const c of op.criteria) assert.ok(c.why.length > 0, `⑥b 算子 "${op.name}" 的判据 "${c.id}" 没有 why`);
  }

  // ⑥c 输入种类全部已登记（G5：在真实包上再验一次，不只玩具域）
  const kinds = new Set(tailoringEntities().map((e) => e.kind));
  for (const op of ops) for (const i of op.inputs) assert.ok(kinds.has(i.entityKind), `⑥c 算子 "${op.name}" 的输入位 "${i.ref}" 要的种类 "${i.entityKind}" 没登记`);

  // ⑥d 几何判据**一条都不许**判 pass（否则就是"没判"冒充"通过"）
  const geoCrit = ops.flatMap((o) => o.criteria.filter((c) => c.tier === 'geometry'));
  assert.ok(geoCrit.length > 0, '⑥d 本包必须有几何判据（否则这条测试是空转）');
  for (const op of ops) {
    const t = criteriaTally([op])[`${op.name}@${String(op.version)}`];
    const expectedPass = op.criteria.filter((c) => c.tier === 'declarative' && !c.blocked_by).length;
    assert.equal(t.pass, expectedPass, `⑥d 算子 "${op.name}"：pass 只该数 declarative 且无 blocked_by 的（实测 ${String(t.pass)} / 应为 ${String(expectedPass)}）`);
    assert.equal(t.total, op.criteria.length, `⑥d 算子 "${op.name}"：总账必须数满（带分母）`);
  }
  // ⑥e checkin 的三条容量/时长/硬墙全部 unsupported（等设备域落库）
  const checkin = ops.find((o) => o.name === 'checkin')!;
  const cTally = criteriaTally([checkin])['checkin@1'];
  assert.equal(cTally.unsupported, checkin.criteria.length, `⑥e checkin 的判据今天一条都判不了（等设备域）⇒ 全 unsupported：实测 pass=${String(cTally.pass)} unsupported=${String(cTally.unsupported)}`);

  // ⑥f 动宾语义：cut 必须 mutates=derive（原件不改），seam 必须 declare
  assert.equal(ops.find((o) => o.name === 'cut')!.outputs[0].mutates, 'derive', '⑥f cut 派生新引用，不改原件');
  assert.equal(ops.find((o) => o.name === 'seam')!.outputs[0].mutates, 'declare', '⑥f seam 改的是已有端口上的声明');
});

// ════════════════════════════════════════════════════════════════════
// ⑦ GarmentSpec 组合构造（一件上衣）
// ════════════════════════════════════════════════════════════════════
test('⑦ GarmentSpec 组合构造：版片集合 + 接缝 + 参数域引用（改一处必须红一处）', () => {
  const model = [...topSpec(), formulaSet(), measureFile()];
  const gaps = auditTailoringEntities(model);
  assert.deepEqual(gaps, [], `⑦0 一件完整上衣（版片+接缝+公式集+量体）必须自洽：实测 ${gaps.map((g) => g.key).join(',')}`);

  // ⑦a 款式引用了不存在的版片
  const dangling = topSpec();
  const spec = dangling.find((e) => e.id === 'spec.top')!.attrs as Record<string, unknown>;
  spec['pieceIds'] = [...(spec['pieceIds'] as string[]), 'piece.placket'];
  assert.ok(keysOf(validateTailoring(dangling), 'R3').includes('spec_piece_dangling:spec.top:piece.placket'), '⑦a 款式引用不存在的版片必须红');

  // ⑦b 把袖口从款式里摘掉后，它的接缝就成了"款式之外的接缝"
  const withoutCuff = topSpec();
  const s2 = withoutCuff.find((e) => e.id === 'spec.top')!.attrs as Record<string, unknown>;
  s2['pieceIds'] = (s2['pieceIds'] as string[]).filter((x) => x !== 'piece.cuff.L');
  s2['seamIds'] = (s2['seamIds'] as string[]).filter((x) => x !== 'port.armL.cuff');
  assert.ok(keysOf(validateTailoring(withoutCuff), 'R3').includes('seam_outside_spec:spec.top:port.armL.cuff'), '⑦b 摘掉袖口后，袖口接缝必须被点名');

  // ⑦c 组合体经核的 JSON 往返无损
  const { back } = roundTrip(tailoringModel());
  assert.deepEqual(back, tailoringModel(), '⑦c 包的形状往返必须无损');
});

// ════════════════════════════════════════════════════════════════════
// ⑧ 量体键登记表本身：不留"登记了但没域"与"有域但没登记"的漂移
// ════════════════════════════════════════════════════════════════════
test('⑧ MEASURE_KEYS 与声明域同源（不许一处加了另一处没加）', () => {
  const { MEASURE_RANGES_CM: ranges } = { MEASURE_RANGES_CM };
  const keys = MEASURE_KEYS as readonly string[];
  const ranged = Object.keys(ranges);
  const missingRange = keys.filter((k) => !ranged.includes(k));
  const extraRange = ranged.filter((k) => !keys.includes(k));
  assert.deepEqual(missingRange, [], `⑧a 登记了键却没有声明域：实测 ${missingRange.join(',')}`);
  assert.deepEqual(extraRange, [], `⑧b 有声明域却没登记键：实测 ${extraRange.join(',')}`);
});
