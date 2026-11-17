/**
 * ledger_membership —— 「**这个路径在设计册里吗**」的唯一查询住处（P0 保鲜链第 1 环，2026-10-26）。
 *
 * ## 解决什么
 * W0 实测（DSH agent 全量入眼审计）：edit_code op=insert 在盘上**新建**了 7 个测试文件，
 * 它们不在设计册 `semantic.files` 里 ⇒ 判据/对账（`design_line action=judge` 判据批 / `action=drift` 漂移 / 闸覆盖）
 * **全都不会看它们一眼** —— 而这件事当时没有被任何机制报出。
 *
 * ## 行为（有意只警告、不自动入册）
 * 入册必须带 **responsibility 意图**（`file add` 的必填字段）；自动插只会造出
 * 「没有职责说明的空壳文件节点」—— 那比不入册更坏。⇒ 本模块只产出**回执警告段**，
 * 并给出一键入参示例（调用方照抄即可入册）。
 *
 * ## 判据（不另立第二把尺）
 * · 覆盖判定与写闸 `collectGateCoverage` **同款**：`storage#isSameProject`（册住在谁家；不比 `DSL.source_root`）；
 * · 在册判定与 `semantic.files` **同源**：`listDesignSheets()`（设计侧唯一权威）。
 * · 项目根上**没有**任何设计册指向（covering=0）⇒ 返回 null（没有册就谈不上"册外"，
 *   对着无册项目喊"未入册"是噪音 —— 这与写闸 `no-feature-for-root` 合法放行同一立场）。
 *
 * ## ★★★ 2026-11-17（T-#A8A9-CROSS-BOOK 批 0.5）：从「任一条在册即可」升级为**归属三态**
 *
 * 改前的判据是一句话：`if (inLedger) return null` —— **任一条在册即可**。
 * 而实测「三册都"在册"」的文件有 **414 个** ⇒ 那句"可以"就是下一份 414 的生成机制：
 * 同一件事两册各有一个节点，靠"另一侧恰为空"充当引用，谁也说不清该领哪册的卡。
 *
 * ⇒ 现在按**域表**（仓根 `design-books.json`，判据住 `infrastructure/design_books.ts#ownerOf`）分三态：
 *
 * | 态 | 条件 | 回执 |
 * |---|---|---|
 * | `owned` | **恰一册**在册，且域表属主 = 那一册 | 静默（这是正常路径） |
 * | `none` | **0 册**在册 | 警告（保持原行为）+ **点名域表推出的应登记册** |
 * | `multi` | **≥2 册**在册 | ★ **红**：报文点名两册 + 域表属主 + "先收口再入册" |
 * | `undeclared` | 0 册在册 ∧ 域表也**没有**一条覆盖它 | 警告 + "先声明再入册"（判不了，不猜） |
 * | `owner_mismatch` | 恰一册在册，但域表属主是**别的**册（或 `unowned`） | ★ **红**：入册位置与意图表矛盾 |
 *
 * ★ 为什么"≥2 册"必须是**红**而不是警告：`multi` 正是批 0 要根除的那个状态本身
 *   （写端 `saveDSL` 已经在**前置**拒新增重复，这里是**事后**的第二眼：改 `edit_code` 这条链的）。
 * ★ 为什么保留"只警告不自动入册"：入册要带 responsibility 意图，自动插 = 造空壳（原判据不变）。
 */
import path from 'node:path';
import { listDesignSheets, isSameProject } from '../../infrastructure/storage.js';
import { ownerOf, readDesignBooks, type DesignBooksRead, type OwnerHit } from '../../infrastructure/design_books.js';

/** 统一路径口径（\ → /）—— 与 `nodeFilePath`（write_gate）同款，不引它（避免反向依赖应用层） */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** 归属三态（★ `multi` / `owner_mismatch` 是红；`none` / `undeclared` 是警告；`owned` 静默） */
export type LedgerMembershipState = 'owned' | 'none' | 'multi' | 'undeclared' | 'owner_mismatch';

/** {@link newFileLedgerVerdict} 的读数（**可判**：每个态都带得出"为什么"） */
export interface LedgerMembershipVerdict {
  state: LedgerMembershipState;
  /** 该路径**在册**的那几册（`semantic.files` 里点名，按册名排序） */
  holders: string[];
  /** 本项目有几册（分母；0 ⇒ 整套判据不适用） */
  covering: number;
  /** 域表读数（三态原样带出：表不在 ⇒ 下面两个字段是"判不了"） */
  books: DesignBooksRead;
  /** 域表属主判定（表不在时 `null`） */
  owner: OwnerHit | null;
  /** 人话回执（`owned` ⇒ `null`，静默） */
  message: string | null;
}

/**
 * **归属三态判定**（唯一实现）：`newFileLedgerWarning` 只是它的字符串切片。
 *
 * ★ 分成两个导出而不是把字符串塞进一个函数：门/测试要能**判态**（不是靠对文案做正则）。
 */
export function newFileLedgerVerdict(projectRoot: string, relPath: string): LedgerMembershipVerdict {
  const root = path.resolve(projectRoot);
  const rel = toPosix(relPath);
  const books = readDesignBooks(root);
  let covering = 0;
  const holders: string[] = [];
  for (const d of listDesignSheets()) {
    // ★★★ 2026-11-01（第二个 P0）：册身份**只认** `storage#isSameProject`（册住在谁家）——
    //   改前比 `path.resolve(d.source_root) !== root`：换机器恒 false ⇒ `covering` 恒 0 ⇒ 本警告静默消失。
    if (!isSameProject(d, root)) continue;
    covering++;
    const inLedger = (d.semantic?.files ?? []).some((f) => f.path && toPosix(f.path) === rel);
    if (inLedger) holders.push(String(d.feature));
  }
  holders.sort();
  const owner = books.table ? ownerOf(books.table, rel) : null;
  const ownerName = owner ? (owner.matched ? (owner.owner ?? '∅（unowned）') : '判不了（域表没覆盖）') : '判不了（域表不在）';
  const ownerWhy = owner?.why ? `（${owner.why}）` : '';

  // 没有册指向本项目 ⇒ 谈不上"册内/册外"（原立场不变）
  if (covering === 0) return { state: 'owned', holders, covering, books, owner, message: null };

  if (holders.length === 0) {
    const state: LedgerMembershipState = owner && owner.matched && owner.owner === null ? 'undeclared' : owner && !owner.matched ? 'undeclared' : 'none';
    // ★ 首行措辞**保持改前那句**（`新文件未入册：\`<rel>\`` 是既有读端/证言的锚点），
    //   批 0.5 只是在它后面补"归属"这一维（域表推出的应登记册 / 或"判不了"）。
    const headline =
      `⚠ 新文件未入册：\`${rel}\` —— 判据/对账覆盖不到它（它不在本项目 ${covering} 条设计册的 \`semantic.files\` 里）。`;
    const ownerLine =
      owner && owner.matched && owner.owner === null
        ? `  ★ 域表把它声明为 **unowned**（${owner.entry}${ownerWhy}）⇒ 它按约定**不该**入册；若它其实是设计对象，先改 \`design-books.json\`。`
        : owner && owner.matched && owner.owner !== null
          ? `  ★ 域表推出的应登记册：**${ownerName}**${ownerWhy}`
          : `  ★ 归属**判不了**：${books.table ? '域表（design-books.json）**没有一条**覆盖它' : books.error}。\n` +
            `    ⇒ 新增文件的归属只能来自域表（派生不出来）：先在某册的 \`owns[]\` 或 \`unowned[]\` 里加一条。`;
    return {
      state,
      holders,
      covering,
      books,
      owner,
      message:
        `${headline}\n` +
        `${ownerLine}\n` +
        `  本回执**只警告、不自动入册**（入册要带 responsibility 意图，自动插会造空壳节点）。\n` +
        `  入册（一键示例，feature **必须**下一条 —— 别在覆盖本项目的册里随便挑一册）：\n` +
        `    edit_dsl { feature:'${owner && owner.matched ? (owner.owner ?? '<unowned 已声明：先改表>') : '<先按域表声明>' }', reason:'新文件入册', operations:[{ type:'file', op:'add', id:'nodeIdOf(${rel})', data:{ path:'${rel}', responsibility:'<职责一句话>' } }] }\n` +
        `  或增量重建：import_project（会把盘上新文件逐条列进 semantic.files）。`,
    };
  }

  if (holders.length >= 2) {
    const detail = holders.map((f) => `\`${f}\``).join(' + ');
    return {
      state: 'multi',
      holders,
      covering,
      books,
      owner,
      message:
        `✗ 新文件**多册在册**（红）：\`${rel}\` 同时出现在 ${detail} 的 \`semantic.files\` 里。\n` +
        `  ★ 这条是**归属重复**本身（实测全仓 414 个），不是"还差一个人登记" —— 两份册会各给一个节点，` +
        `\`decision:<node_id>#i\` 立刻变成"按名字猜"。\n` +
        `  ★ 域表属主：**${ownerName}**${ownerWhy}\n` +
        `  ⇒ 只许属主册持有它：先在非属主册收口（\`edit_dsl { feature:'${holders.find((h) => h !== owner?.owner) ?? '<非属主册>'}', operations:[{ type:'file', op:'delete', id:'<node_id>' }] }\`），再入册。`,
    };
  }

  // 恰一册在册：位置对不对？
  if (owner && owner.matched && owner.owner !== holders[0]) {
    return {
      state: 'owner_mismatch',
      holders,
      covering,
      books,
      owner,
      message:
        `✗ 入册位置与意图表矛盾（红）：\`${rel}\` 只在 \`${holders[0]}\` 的 \`semantic.files\` 里，` +
        `但域表属主是 **${ownerName}**（命中 \`${owner.entry}\`${ownerWhy}）。\n` +
        `  ⇒ 改它该领 **${ownerName}** 的卡 ⇒ 要么把它迁到属主册，要么改域表（两者取一，别两头都留着）。`,
    };
  }
  if (owner && !owner.matched) {
    return {
      state: 'undeclared',
      holders,
      covering,
      books,
      owner,
      message:
        `⚠ 在册，但**归属判不了**：\`${rel}\` 在 \`${holders[0]}\` 里${books.table ? '，而域表没有一条覆盖它' : `，而${books.error}`}。\n` +
        `  ⇒ 补一条声明（\`design-books.json\` 的 \`owns[]\` 或 \`unowned[]\`）；在那之前"它归谁"没有权威。`,
    };
  }
  return { state: 'owned', holders, covering, books, owner, message: null };
}

/**
 * 新建文件**入册检查**：落盘新文件后调用。
 * · 恰一册在册 ∧ 属主一致 ⇒ 返回 null（静默）；
 * · 0 册在册 / 域表没覆盖 ⇒ 警告段（多行）；
 * · ≥2 册在册 / 与属主矛盾 ⇒ **红**段（多行，点名两册）。
 * ★ 判态的唯一实现是 {@link newFileLedgerVerdict}；本函数只把 `message` 原样交出去。
 */
export function newFileLedgerWarning(projectRoot: string, relPath: string): string | null {
  return newFileLedgerVerdict(projectRoot, relPath).message;
}
