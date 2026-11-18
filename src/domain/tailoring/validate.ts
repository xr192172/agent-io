/**
 * tailoring/validate.ts —— **制衣领域规则**（R 系列，**零 import**，只依赖核的形状类型）。
 *
 * ## 与核的 G 系列分工
 * 核判的是**任何领域都成立**的自洽性（id 唯一 / 引用可解析 / 判据非空 / 版本链 / 种类已登记）。
 * 本文件判的是**制衣才成立**的规则 —— 每一条都能回到需求源的一句原话（见下）。
 *
 * | # | 规则 | 原话出处 |
 * |---|---|---|
 * | R1 | 缝口必须**互指**（a.mated=b ⟺ b.mated=a），禁自指 | `A3.2`「袖口端口 ↔ 袖管下口端口」+ `#41` 匹配层 |
 * | R2 | 缝口类型必须兼容才可对接 | `#41`「匹配层（**校验端口类型兼容**…）」 |
 * | R3 | 跨版片的接缝两端必须属同一款式的不同版片 | `A3.2` 闭环「装配算子把袖片接到**衣身袖窿端口**」 |
 * | R4 | 公式变量必须是已登记量体键或本集内中间量 | `A6.8`「每个款式预存一套**制图公式**…每条来自姑姑制版经验」 |
 * | R5 | 公式**不许成环**（v1 只查环、不求值） | `A6.8`「尺寸一进，所有裁片控制点坐标自动重算」⇒ 必须是 DAG |
 * | R6 | 同一主档下**缸号唯一**；**卷号全局唯一** | `A6.1`「**匹号/卷号** 每一卷的**唯一编号**」 |
 * | R7 | **缸号必填、不许空串**；色号在主档与批次两层必须一致 | `A6.1`「**缸号字段本身不能省略**…否则**混缸配料的错误无法被拦住**」 |
 * | R8 | 卷必须带**实测米数**，且不许只带来料单米数 | `A6.1`「当前可用米数：**按实测米数扣减，而非标签米数**」 |
 * | R9 | 主档 → 批次 → 卷**三段不许拍平**（一卷必须挂在某个批次上） | `A6.2`「**布料名称做主档，批次做属性/层级，卷做库存单元**」 |
 * | R10 | 量体键必须登记、值在声明域内、**来源必填** | `A7.4`「量体数据捕捉不到**驼背、高低肩、左右不对称**」 |
 * | R11 | 关系必须是**可重算的声明**（不许把烘焙结果当关系存） | `#25`「"**平滑融合"本身是一条独立的语义约束，不是一次性的几何烘焙结果**」 |
 *
 * ## 输入收 `unknown`（**故意的**）
 * 这些实体的内容来自 JSON（fuint 侧落库后再序列化过来）⇒ **形状校验本身就是本文件的活**，
 * 不借类型系统假装"外面已经对了"（`behavior_contract.ts:12-13` 同一条纪律）。
 */

import type { EntityDef } from '../semantic_model/types.js';
import { FABRIC_MASTER_KEY_NOTE } from './entities.js';

/** 一条领域 gap（`key` 稳定，不含被指向方的名字 —— `validator.ts:32-47` 的口径） */
export interface TailoringGap {
  key: string;
  rule:
    | 'R1'
    | 'R2'
    | 'R3'
    | 'R4'
    | 'R5'
    | 'R6'
    | 'R7'
    | 'R8'
    | 'R9'
    | 'R10'
    | 'R11';
  message: string;
}

/** 量体键的登记表（`A6.8`：量取 10~15 个尺寸；`A6.4`：肩宽拆成三格、胸围与背宽解耦） */
export const MEASURE_KEYS: readonly string[] = [
  'height',
  'bust', // 胸围
  'waist', // 腰围
  'hip', // 臀围
  'shoulderTotal', // 总肩宽
  'shoulderSmall', // 小肩宽（A6.4：把"肩宽"拆成 总肩宽+小肩宽+肩斜角）
  'shoulderSlopeDeg', // 肩斜角
  'backWidth', // 后背宽（A6.4：胸围与后背宽/前胸宽解耦）
  'chestWidth', // 前胸宽
  'neckCirc', // 领围
  'sleeveLength', // 袖长
  'garmentLength', // 衣长
  'armholeDepth', // 袖窿深（A6.8 公式里的左值）
  'bicep', // 臂围
  'wristCirc', // 腕围
  'cuffCirc', // 袖口围
];

/** 量体键的**声明域**（cm；超出即多半量错。inch 输入由适配层换算，本判据只对 cm 生效） */
export const MEASURE_RANGES_CM: Readonly<Record<string, readonly [number, number]>> = {
  height: [80, 230],
  bust: [50, 180],
  waist: [40, 180],
  hip: [50, 190],
  shoulderTotal: [20, 60],
  shoulderSmall: [5, 25],
  shoulderSlopeDeg: [0, 60],
  backWidth: [20, 60],
  chestWidth: [20, 60],
  neckCirc: [20, 60],
  sleeveLength: [20, 90],
  garmentLength: [30, 160],
  armholeDepth: [15, 45],
  bicep: [18, 70],
  wristCirc: [10, 30],
  cuffCirc: [10, 45],
};

/** 量体来源闭集（与 `entities.ts#MEASURE_SOURCES` 同源；这里再导出一次是为了"一条口径一个入口"） */
export const MEASURE_SOURCES_ALLOWED: readonly string[] = ['self_report', 'in_store_tape', 'photo_scan'];
/** 单位闭集 */
export const MEASURE_UNITS_ALLOWED: readonly string[] = ['cm', 'inch'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** 有限数的**唯一**判定（`NaN` / `Infinity` / 字符串数字都**不算**数 —— 静默转数正是账实不符的源头） */
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 从实体里取一个 attrs 键（本包的实体内容住 `attrs`；缺 ⇒ `undefined`） */
function attr(e: EntityDef, k: string): unknown {
  const a = e?.attrs as Record<string, unknown> | undefined;
  return a ? a[k] : undefined;
}

/** 按 kind 分组（保注册序） */
function byKind(entities: readonly EntityDef[], kind: string): EntityDef[] {
  return entities.filter((e) => e?.kind === kind);
}

// ─────────────────────────────────────────────────────────────
// R1 / R2：缝口互指 + 类型兼容
// ─────────────────────────────────────────────────────────────

/**
 * **R1** 互指：`a.matedPortId === b.id` ⟺ `b.matedPortId === a.id`；禁自指。
 * ★ 单向指 = "缝了一半"：读的人看到 a 说缝了、b 说没缝，**两边都自认为对**。
 */
export function r1MutualMating(ports: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  const index = new Map<string, EntityDef>();
  for (const p of ports) if (str(p?.id)) index.set(str(p.id), p);

  for (const p of ports) {
    const id = str(p?.id);
    if (!id) continue;
    const mateId = str(attr(p, 'matedPortId'));
    if (!mateId) continue;
    if (mateId === id) {
      out.push({ key: `self_mated:${id}`, rule: 'R1', message: `缝口 "${id}" 对接到了自己 —— 接缝必须有两个端点` });
      continue;
    }
    const mate = index.get(mateId);
    if (!mate) {
      out.push({ key: `mated_missing:${id}`, rule: 'R1', message: `缝口 "${id}" 声称对接到 "${mateId}"，而本款里没有这个缝口` });
      continue;
    }
    if (str(attr(mate, 'matedPortId')) !== id) {
      out.push({
        key: `one_way_mate:${id}`,
        rule: 'R1',
        message: `缝口 "${id}" 指向 "${mateId}"，而对方没有指回来（单向对接 = 缝了一半；两端必须互指）`,
      });
    }
  }
  return out;
}

/**
 * **R2** 类型兼容：`hinge` 只接 `hinge`、`fuse` 只接 `fuse`。
 * 出处：`#41` 匹配层「**校验端口类型兼容**」—— 类型不合还硬接，就是"硬拉伸"，接缝必炸。
 */
export function r2TypeCompatible(ports: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  const index = new Map<string, EntityDef>();
  for (const p of ports) if (str(p?.id)) index.set(str(p.id), p);
  for (const p of ports) {
    const id = str(p?.id);
    const mateId = str(attr(p, 'matedPortId'));
    if (!id || !mateId || mateId === id) continue;
    const mate = index.get(mateId);
    if (!mate) continue; // R1 已点名
    const a = str(attr(p, 'portType'));
    const b = str(attr(mate, 'portType'));
    if (a && b && a !== b) {
      out.push({ key: `type_mismatch:${id}`, rule: 'R2', message: `缝口 "${id}" 是 ${a} 口，对接的 "${mateId}" 是 ${b} 口 —— 类型不兼容（铰接只接铰接、融合只接融合）` });
    }
  }
  return out;
}

/**
 * **R3** 跨版片的接缝：两端必须属于**同一款式里的不同版片**。
 * 判据要三样东西：端口集合、版片集合、款式的 `pieceIds`/`seamIds`。缺任何一样 ⇒ 报一条"判不了"
 * （**不许**当成"没问题"—— `behavior_contract.ts:14-15`）。
 */
export function r3CrossPiece(
  ports: readonly EntityDef[],
  pieces: readonly EntityDef[],
  specs: readonly EntityDef[],
): TailoringGap[] {
  const out: TailoringGap[] = [];
  const portById = new Map<string, EntityDef>();
  for (const p of ports) if (str(p?.id)) portById.set(str(p.id), p);
  const pieceIds = new Set(pieces.map((p) => str(p?.id)).filter(Boolean));

  for (const spec of specs) {
    const sid = str(spec?.id) || '(缺 id 的款式)';
    const declared = (attr(spec, 'pieceIds') as unknown) ?? [];
    if (!Array.isArray(declared)) {
      out.push({ key: `spec_no_pieces:${sid}`, rule: 'R3', message: `款式 "${sid}" 没有 pieceIds —— 判不了它的接缝两端属不属于自己` });
      continue;
    }
    const own = new Set(declared.map(str));
    for (const pid of own) {
      if (!pieceIds.has(pid)) out.push({ key: `spec_piece_dangling:${sid}:${pid}`, rule: 'R3', message: `款式 "${sid}" 引用的版片 "${pid}" 不存在` });
    }
    for (const pid of own) {
      const piece = pieces.find((p) => str(p?.id) === pid);
      if (!piece) continue; // 上面已点名 spec_piece_dangling
      const portIdsRaw = attr(piece, 'portIds');
      const portIds = Array.isArray(portIdsRaw) ? portIdsRaw.map(str) : [];
      for (const portId of portIds) {
        const port = portById.get(portId);
        if (!port) continue; // R1 的 mated_missing 会点名"指了个不存在的口"
        const mateId = str(attr(port, 'matedPortId'));
        if (!mateId) continue;
        const matePort = portById.get(mateId);
        if (!matePort) continue; // R1 已点名
        const a = str(attr(port, 'pieceId'));
        const b = str(attr(matePort, 'pieceId'));
        if (a && b) {
          if (a === b) {
            out.push({ key: `same_piece_seam:${sid}:${portId}`, rule: 'R3', message: `款式 "${sid}" 的接缝 "${portId}" 两端都在版片 "${a}" 上 —— 同一片的两条边不是接缝` });
          } else if (!own.has(a) || !own.has(b)) {
            out.push({ key: `seam_outside_spec:${sid}:${portId}`, rule: 'R3', message: `款式 "${sid}" 的接缝 "${portId}" 有一端挂在款式之外的版片上（"${a}" / "${b}"）` });
          }
        }
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// R4 / R5：公式变量登记 + 不成环
// ─────────────────────────────────────────────────────────────

/** 从表达式串里抽出**标识符**（v1 不做真正的词法分析，只认 `[A-Za-z_][A-Za-z0-9_]*`） */
export function formulaVars(expr: string): string[] {
  const out: string[] = [];
  for (const m of str(expr).matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) out.push(m[0]);
  return out;
}

/**
 * **R4**：公式里的每个变量必须是「已登记量体键」或「本集内已定义的参数」。
 * ★ 缺变量**不许当 0**（那会让一件衣服悄悄按"胸围 0"算出来）—— 必须拒绝。
 */
export function r4FormulaVarsRegistered(sets: readonly EntityDef[], extraKeys: readonly string[] = []): TailoringGap[] {
  const out: TailoringGap[] = [];
  const known = new Set<string>([...MEASURE_KEYS, ...extraKeys]);
  for (const s of sets) {
    const sid = str(s?.id) || '(缺 id 的公式集)';
    const formulas = attr(s, 'formulas');
    if (!formulas || typeof formulas !== 'object' || Array.isArray(formulas)) {
      out.push({ key: `formulas_missing:${sid}`, rule: 'R4', message: `公式集 "${sid}" 没有 formulas（参数名→表达式）` });
      continue;
    }
    const local = new Set(Object.keys(formulas));
    for (const [param, expr] of Object.entries(formulas)) {
      if (typeof expr !== 'string' || expr.length === 0) {
        out.push({ key: `formula_empty:${sid}:${param}`, rule: 'R4', message: `公式集 "${sid}" 的参数 "${param}" 表达式为空` });
        continue;
      }
      for (const v of formulaVars(expr)) {
        if (!known.has(v) && !local.has(v)) {
          out.push({ key: `formula_var_unknown:${sid}:${param}:${v}`, rule: 'R4', message: `公式集 "${sid}" 的参数 "${param}" 用了未登记的变量 "${v}"（不是量体键、也不是本集参数）—— 不许当 0 处理` });
        }
      }
    }
  }
  return out;
}

/**
 * **R5**：公式**不许成环**（A 依赖 A，或 A→B→A）。v1 **只查环、不求值**。
 * 算法：三色 DFS（`0` 未访问 / `1` 在栈上 / `2` 已定）—— 撞到"在栈上"的节点就是环。
 * ★ 报环时报**环上出现的参数名**（不是整条链的重复）：一串重复参数读不出"从哪开始断的"。
 */
export function r5FormulaAcyclic(sets: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const s of sets) {
    const sid = str(s?.id) || '(缺 id 的公式集)';
    const formulas = attr(s, 'formulas');
    if (!formulas || typeof formulas !== 'object' || Array.isArray(formulas)) continue;
    const keys = Object.keys(formulas);
    const local = new Set(keys);
    const color = new Map<string, 0 | 1 | 2>(keys.map((k) => [k, 0]));
    const stack: string[] = [];

    const visit = (node: string): boolean => {
      color.set(node, 1);
      stack.push(node);
      const expr = str((formulas as Record<string, unknown>)[node]);
      for (const dep of formulaVars(expr)) {
        if (!local.has(dep)) continue; // 外部量体键不是图上的节点（R4 管它们）
        const c = color.get(dep) ?? 0;
        if (c === 1) {
          const start = stack.indexOf(dep);
          const cycle = stack.slice(start >= 0 ? start : 0).concat(dep);
          out.push({ key: `formula_cycle:${sid}:${dep}`, rule: 'R5', message: `公式集 "${sid}" 成环：${cycle.join(' → ')}（成环就永远算不出来）` });
          stack.pop();
          color.set(node, 2);
          return true;
        }
        if (c === 0 && visit(dep)) {
          stack.pop();
          color.set(node, 2);
          return true;
        }
      }
      stack.pop();
      color.set(node, 2);
      return false;
    };

    for (const k of keys) if ((color.get(k) ?? 0) === 0) visit(k);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// R6 / R7 / R8 / R9：一卷布的三段结构
// ─────────────────────────────────────────────────────────────

/** 一卷布的最小读形：`{masterId, lotNo, rollNo, measuredLengthM, inboundLengthM?, colorCode?}` */
interface RollView {
  id: string;
  masterId: string;
  lotNo: string;
  rollNo: string;
  colorCode: string;
  measuredLengthM: unknown;
  inboundLengthM: unknown;
  hasLotField: boolean;
}

function rollView(e: EntityDef): RollView {
  const id = str(e?.id);
  const a = (e?.attrs ?? {}) as Record<string, unknown>;
  return {
    id,
    masterId: str(a['masterId']),
    lotNo: str(a['lotNo']),
    rollNo: str(a['rollNo']),
    colorCode: str(a['colorCode']),
    measuredLengthM: a['measuredLengthM'],
    inboundLengthM: a['inboundLengthM'],
    hasLotField: 'lotNo' in a,
  };
}

/** **R9** 三段不许拍平：卷必须挂在**某个批次（缸号）**上；批次必须挂在**某个主档**上 */
export function r9ThreeLevels(rolls: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const r of rolls) {
    const v = rollView(r);
    if (!v.id) continue;
    if (!v.masterId) {
      out.push({ key: `roll_no_master:${v.id}`, rule: 'R9', message: `卷 "${v.id}" 没有 masterId —— 卷是库存单元，必须挂在主档下（A6.2 三段结构不许拍平）` });
    }
    if (!v.hasLotField) {
      out.push({ key: `roll_no_lot_field:${v.id}`, rule: 'R9', message: `卷 "${v.id}" 连 lotNo 这一格都没有 —— 批次层被拍平掉了（A6.2：批次做属性/层级）` });
    }
  }
  return out;
}

/**
 * **R6** 缸号唯一（同一主档下）+ 卷号全局唯一。
 * ★ 报"第二次出现的那一条"，不报第一次 —— 否则读的人会以为第一条是新加的。
 */
export function r6Uniqueness(rolls: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  const rollSeen = new Set<string>();
  const lotSeen = new Set<string>();
  for (const r of rolls) {
    const v = rollView(r);
    if (!v.id) continue;
    if (v.rollNo) {
      if (rollSeen.has(v.rollNo)) out.push({ key: `duplicate_roll_no:${v.rollNo}`, rule: 'R6', message: `卷号 "${v.rollNo}" 重复（A6.1：匹号/卷号是每一卷的唯一编号）` });
      rollSeen.add(v.rollNo);
    }
    if (v.masterId && v.lotNo) {
      const lotKey = `${v.masterId}::${v.lotNo}`;
      if (lotSeen.has(lotKey)) {
        // ★ 同缸多卷是**合法**的（A6.2 理由④"子类下仍有多卷多缸"）—— 这里只在"缸号重复且无法归并"时报。
        //   归并口径：同主档的同名缸号 = 同一批次，允许多卷；故本判据**不因多卷而报**。
        void lotKey;
      }
      lotSeen.add(lotKey);
    }
  }
  return out;
}

/**
 * **R7** 缸号必填、不许空串；**色号在主档与批次两层必须一致**。
 *
 * ★ 为什么缸号是"必填"而不是"推荐"：`A6.1` 原话「缸号字段本身不能省略，也不能只写在备注里，
 *   否则拣货时无法校验，**混缸配料的错误无法被拦住**」。
 */
export function r7LotRequired(rolls: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const r of rolls) {
    const v = rollView(r);
    if (!v.id) continue;
    if (!v.lotNo) {
      out.push({ key: `lot_missing:${v.id}`, rule: 'R7', message: `卷 "${v.id}" 的缸号是空的 —— 混缸配料的错误将无法被拦住（A6.1：缸号不能省略、不能只写在备注里）` });
    }
  }
  return out;
}

/**
 * **R7b** 色号两层一致：卷上写了 `colorCode` 就必须与所属主档一致（主档缺 ⇒ 由 `r8` / 上层桥接负责）。
 * ★ 拆成单独函数是为了"一个判据一个出口"（主控要逐个点名反例）。
 */
export function r7bColorConsistent(rolls: readonly EntityDef[], masters: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  const masterColor = new Map<string, string>();
  for (const m of masters) {
    const id = str(m?.id);
    if (id) masterColor.set(id, str(attr(m, 'colorCode')));
  }
  for (const r of rolls) {
    const v = rollView(r);
    if (!v.id || !v.colorCode || !v.masterId) continue;
    const want = masterColor.get(v.masterId);
    if (want !== undefined && want !== '' && want !== v.colorCode) {
      out.push({ key: `color_mismatch:${v.id}`, rule: 'R7', message: `卷 "${v.id}" 的色号 "${v.colorCode}" 与主档 "${v.masterId}" 的 "${want}" 不一致（A6.1：库存粒度落到"色号+缸号"）` });
    }
  }
  return out;
}

/**
 * **R8** 实测米数：必须给、必须是有限数、不许为负；**不许只带来料单米数**。
 * 出处：`A6.1`「当前可用米数：**按实测米数扣减，而非标签米数**」。
 */
export function r8MeasuredLength(rolls: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const r of rolls) {
    const v = rollView(r);
    if (!v.id) continue;
    if (v.measuredLengthM === undefined || v.measuredLengthM === null) {
      const hint = v.inboundLengthM !== undefined ? '（只给了来料单米数）' : '';
      out.push({ key: `measured_missing:${v.id}`, rule: 'R8', message: `卷 "${v.id}" 没有实测米数${hint} —— 扣库存按实测米数，不按标签米数（A6.1）` });
      continue;
    }
    if (!isNum(v.measuredLengthM)) {
      out.push({ key: `measured_not_number:${v.id}`, rule: 'R8', message: `卷 "${v.id}" 的实测米数不是有限数（实测 ${JSON.stringify(v.measuredLengthM)}）` });
      continue;
    }
    if (v.measuredLengthM < 0) {
      out.push({ key: `measured_negative:${v.id}`, rule: 'R8', message: `卷 "${v.id}" 的实测米数是负数（${String(v.measuredLengthM)}）` });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// R10：量体档案
// ─────────────────────────────────────────────────────────────

/**
 * **R10**：每个 `values[]` 项的键必须登记、值在声明域内、`source` 必填且在闭集内、`unit` 在闭集内。
 * ★ 混单位（cm/inch）在同一份档案里出现 ⇒ 单独点名：账实不符的第一来源就是"一个 60 一个 23.6"。
 */
export function r10Measurements(measurements: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const m of measurements) {
    const id = str(m?.id) || '(缺 id 的量体档案)';
    const values = attr(m, 'values');
    if (!Array.isArray(values) || values.length === 0) {
      out.push({ key: `measurement_empty:${id}`, rule: 'R10', message: `量体档案 "${id}" 没有任何尺寸项（A6.8：至少要量 10~15 个尺寸）` });
      continue;
    }
    const units = new Set<string>();
    values.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') {
        out.push({ key: `measurement_item:${id}:${String(i)}`, rule: 'R10', message: `量体档案 "${id}" 的第 ${i + 1} 项不是对象` });
        return;
      }
      const v = raw as Record<string, unknown>;
      const key = str(v['key']);
      const unit = str(v['unit']);
      const source = str(v['source']);
      if (!key) {
        out.push({ key: `measurement_key:${id}:${String(i)}`, rule: 'R10', message: `量体档案 "${id}" 的第 ${i + 1} 项没有 key` });
        return;
      }
      if (!MEASURE_KEYS.includes(key)) {
        out.push({ key: `measurement_key_unknown:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" 没有登记 —— 公式引用它时无处可查（登记表见 MEASURE_KEYS）` });
      }
      if (!source) {
        out.push({ key: `measurement_source:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" 没有来源 —— 量体数据捕捉不到驼背/高低肩，来源必须可溯（A7.4）` });
      } else if (!MEASURE_SOURCES_ALLOWED.includes(source)) {
        out.push({ key: `measurement_source_unknown:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" 的来源 "${source}" 不在闭集内` });
      }
      if (!unit || !MEASURE_UNITS_ALLOWED.includes(unit)) {
        out.push({ key: `measurement_unit:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" 的单位 "${unit || '(空)'}" 不在闭集 cm/inch 内` });
      } else {
        units.add(unit);
      }
      const num = v['value'];
      if (!isNum(num)) {
        out.push({ key: `measurement_value:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" 的值不是有限数（实测 ${JSON.stringify(num)}）` });
      } else if (unit === 'cm') {
        const range = MEASURE_RANGES_CM[key];
        if (range && (num < range[0] || num > range[1])) {
          out.push({ key: `measurement_range:${id}:${key}`, rule: 'R10', message: `量体键 "${key}" = ${String(num)}cm 超出声明域 [${String(range[0])}, ${String(range[1])}] —— 多半是量错了，不是体型特殊` });
        }
      }
    });
    if (units.size > 1) {
      out.push({ key: `measurement_mixed_units:${id}`, rule: 'R10', message: `量体档案 "${id}" 里 cm 与 inch 混用 —— 账实不符的第一来源` });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// R11：关系必须是可重算的声明
// ─────────────────────────────────────────────────────────────

/**
 * **R11**：实体上声明的关系，必须是 `{kind, ...}` 的**声明**，不许是烘焙结果。
 *
 * 判据（可机械判的那一半）：
 * ① 关系的 `kind` 必须在闭集里（`bind`/`blend`/`attach`/`follow`/`seam`/`no_interpenetrate`）；
 * ② 关系**不许**带几何快照字段（`mesh`/`vertices`/`triangles`/`baked`）——
 *    那正是 `#25` 说的"把平滑融合当成一次性的几何烘焙结果"。
 * ★ 判不了的那一半（过渡区梯度连续、无尖刺）⇒ 登记为 `geometry` 判据，出口 `unsupported`。
 */
export const RELATION_KINDS: readonly string[] = ['bind', 'blend', 'attach', 'follow', 'seam', 'no_interpenetrate'];
/** 一旦出现就是"烘焙结果"的字段名（`#25`：融合是一条独立约束，不是烘焙产物） */
export const BAKED_GEOMETRY_KEYS: readonly string[] = ['mesh', 'vertices', 'triangles', 'baked', 'bakedMesh'];

export function r11RelationsDeclarative(entities: readonly EntityDef[]): TailoringGap[] {
  const out: TailoringGap[] = [];
  for (const e of entities) {
    const id = str(e?.id);
    if (!id) continue;
    const rels = attr(e, 'relations');
    if (rels === undefined) continue;
    if (!Array.isArray(rels)) {
      out.push({ key: `relations_not_array:${id}`, rule: 'R11', message: `实体 "${id}" 的 relations 不是数组` });
      continue;
    }
    rels.forEach((raw, i) => {
      if (!raw || typeof raw !== 'object') {
        out.push({ key: `relation_item:${id}:${String(i)}`, rule: 'R11', message: `实体 "${id}" 的第 ${i + 1} 条关系不是对象` });
        return;
      }
      const r = raw as Record<string, unknown>;
      const kind = str(r['kind']);
      if (!kind || !RELATION_KINDS.includes(kind)) {
        out.push({ key: `relation_kind:${id}:${String(i)}`, rule: 'R11', message: `实体 "${id}" 的第 ${i + 1} 条关系 kind "${kind || '(空)'}" 不在闭集内（${RELATION_KINDS.join('/')}）` });
      }
      for (const k of BAKED_GEOMETRY_KEYS) {
        if (k in r) {
          out.push({ key: `relation_baked:${id}:${String(i)}:${k}`, rule: 'R11', message: `实体 "${id}" 的关系里带了烘焙几何字段 "${k}" —— 关系必须是可重算的声明，不是烘焙结果（#25）` });
        }
      }
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────

/**
 * **制衣域全量体检**：按种类分组，跑 R1–R11，去重保序。
 * ★ 顺序固定（R1→R11）：反例逐条点名时要靠它（"第几条红"必须是稳定的）。
 */
export function validateTailoring(entities: readonly EntityDef[], extraMeasureKeys: readonly string[] = []): TailoringGap[] {
  const ports = byKind(entities, 'seam_port');
  const pieces = byKind(entities, 'pattern_piece');
  const specs = byKind(entities, 'garment_spec');
  const sets = byKind(entities, 'constraint_set');
  const rolls = byKind(entities, 'fabric_roll');
  const masters = byKind(entities, 'fabric_master');
  const measures = byKind(entities, 'body_measurement');

  const gaps: TailoringGap[] = [
    ...r1MutualMating(ports),
    ...r2TypeCompatible(ports),
    ...r3CrossPiece(ports, pieces, specs),
    ...r4FormulaVarsRegistered(sets, extraMeasureKeys),
    ...r5FormulaAcyclic(sets),
    ...r6Uniqueness(rolls),
    ...r7LotRequired(rolls),
    ...r7bColorConsistent(rolls, masters),
    ...r8MeasuredLength(rolls),
    ...r9ThreeLevels(rolls),
    ...r10Measurements(measures),
    ...r11RelationsDeclarative(entities),
  ];
  const seen = new Set<string>();
  return gaps.filter((g) => (seen.has(g.key) ? false : (seen.add(g.key), true)));
}

/** 制衣域是否自洽（唯一的对外布尔） */
export function isTailoringConsistent(entities: readonly EntityDef[]): boolean {
  return validateTailoring(entities).length === 0;
}

/** 主档键的人读说明（再导出一次：报文里措辞只有一处来源） */
export const TAILORING_MASTER_KEY_NOTE = FABRIC_MASTER_KEY_NOTE;
