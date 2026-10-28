/**
 * ★★★ 2026-10-28（T-#SURFACE-2 · 用户裁定"效果可替代就替代，接口形状不是约束"）：
 * `observe_proposals` 的**执行核**从 `meta/index.ts` 的内联 handler 抽到这里 ——
 * 因为它的注册已并进 `observe { action: 'proposals', op } `。
 *
 * ★ **抽出来而不是复制**：本次目的正是消灭"同一件事两处实现"；若这里贴一份、那边留一份，就白做了。
 * ★ 行为**一个字没改**（原样搬运），等价性由 `certs/t407` 逐字段比对兜底。
 */
import { wrapData } from '../../plumbing.js';
import { ProposalStore } from '../../../infrastructure/analysis/observe/proposal_store.js';
import { approveGated } from '../../../infrastructure/analysis/observe/approve_gated.js';
import { DesignDSLStore, defaultDSLDir } from '../../../infrastructure/analysis/observe/dsl_store.js';
import { getDSL, requireProjectRoot } from '../../../infrastructure/storage.js';
import { validateProjectRoot } from '../../../infrastructure/dictionary.js';

export const observeProposalsHandler = wrapData(async (a) => {
      const action = (a.action as 'list' | 'show' | 'approve' | 'reject' | undefined) ?? 'list';
      // ★ 定位：project_dir 优先，否则由 feature 的 source_root 推（与 `design_intent` 同口径）
      let projectRoot = typeof a.project_dir === 'string' && a.project_dir.trim() ? a.project_dir.trim() : '';
      if (!projectRoot) {
        const feature = typeof a.feature === 'string' && a.feature.trim() ? a.feature.trim() : '';
        if (!feature) throw new Error('缺少定位：给 `project_dir`，或给 `feature`（按它的 source_root 推）');
        projectRoot = requireProjectRoot({ 'dsl.source_root': getDSL(feature)?.source_root });
      }
      // ★ 复用仓储层的**同一个**判据与目录推导（★ 不在这里再写一遍 `defaultDSLDir` 的逻辑）
      const dir = defaultDSLDir(validateProjectRoot(projectRoot, 'observe_proposals project_dir'));
      const ps = new ProposalStore(dir);

      const needId = (): string => {
        const id = typeof a.id === 'string' && a.id.trim() ? a.id.trim() : '';
        if (!id) throw new Error(`action=${action} 需要 id（先 action=list 拿）`);
        return id;
      };
      const needAgent = (): string => {
        const g = typeof a.agent === 'string' && a.agent.trim() ? a.agent.trim() : '';
        if (!g) throw new Error(`action=${action} 需要 agent（你的身份：会话 id / Agent 编号 / 系统名）`);
        return g;
      };

      if (action === 'list') {
        const all = ps.list();
        const lines = [`observe 提案：${all.length} 条（★ 0 条 ≠ "都没问题"，只代表没人提过）`, `  库：${dir}`];
        for (const p of all) {
          lines.push(`  · [${p.id}] ${p.status} · source=${p.source} · ${p.decls?.length ?? 0} 条声明`);
          lines.push(`      ${p.reason}`);
          if (p.reviewer) lines.push(`      审批人：${p.reviewer}${p.verified_by ? ` · ${p.verified_by}` : ''}`);
        }
        if (all.length) lines.push('  ★ 下一步：`action=show`（id=…）看全文；确认/驳回**都要署名**（`agent`）。');
        return { message: lines.join('\n'), data: { action, dir, count: all.length, proposals: all } };
      }

      if (action === 'show') {
        const id = needId();
        const p = ps.get(id);
        if (!p) throw new Error(`提案不存在：${id}`);
        const lines = [
          `提案 ${id} · ${p.status} · source=${p.source}`,
          `  提出于：${p.created_at}`,
          `  理由：${p.reason}`,
          `  声明集（${p.decls?.length ?? 0} 条）：`,
          ...(p.decls ?? []).slice(0, 20).map((d) => `    - ${JSON.stringify(d).slice(0, 160)}`),
          ...(p.reviewed_at ? [`  审批于：${p.reviewed_at}（${p.reviewer ?? '未署名'}）`] : []),
          ...(p.verified_by ? [`  ★ 验证门证据：${p.verified_by}`] : []),
          ...(p.verification ? [`  详情：${p.verification}`] : []),
        ];
        return { message: lines.join('\n'), data: { action, dir, proposal: p } };
      }

      // approve / reject —— 都要署名
      const id = needId();
      const agent = needAgent();
      // ★★ 如实交代"不许自批"这条在这侧判得了多少（★ 别假装判过）
      const p0 = ps.get(id);
      if (!p0) throw new Error(`提案不存在：${id}`);
      const selfReviewNote =
        p0.source === 'loop'
          ? '★ "不许自批"**已判**：本提案的 `source="loop"`（机器回路提出）⇒ 确认人不是提出方 ✓'
          : `⚠ ★ "不许自批"**判不了**：本提案 \`source="${p0.source}"\`，而 \`Proposal\` **没有 \`submitter\` 字段** ` +
            '⇒ 无从知道提出人是不是你。★ 若这案是你提的，请换人/换会话确认。';

      if (action === 'reject') {
        const note = typeof a.note === 'string' ? a.note.trim() : '';
        ps.reject(id, agent); // ★ 权威 DSL 完全不动
        return {
          message: [
            `提案 ${id} 已驳回（确认人 ${agent}）—— ★ 权威 DSL **一字未动**`,
            selfReviewNote,
            ...(note ? [`  理由：${note}`] : []),
          ].join('\n'),
          data: { action, dir, id, agent, rejected: true, proposal: ps.get(id) },
        };
      }

      // approve：走四层门。★ `use_llm` 不默认开（与 HTTP 面同款）
      const useLlm = a.use_llm === true;
      let r: Awaited<ReturnType<typeof approveGated>>;
      try {
        r = await approveGated(ps, new DesignDSLStore(dir), id, agent, useLlm);
      } catch (e) {
        // ★★ 与 T186 同款：**失败必须抛**（否则机器通道 isError=false，人读文字说失败 ⇒ 判据分叉）
        throw new Error(`提案 ${id} approve **未成功**（确认人 ${agent}）：${(e as Error).message}\n  ★ 未改动任何东西。`);
      }
      // ★★★ **`frozen` 必须一眼看见**（它是"门判定不许落"，不是出错、更不是通过）
      const head = r.frozen
        ? `提案 ${id} **被门冻结**（frozen，★ 不是通过）：${r.reason ?? ''}`
        : `提案 ${id} **已定稿**（确认人 ${agent}，DSL version ${r.version}）`;
      const lines = [head, selfReviewNote];
      if (r.frozen) {
        lines.push(
          '  ★ 冻结 = 提案置 `rejected`、**权威 DSL 一个字不动**（四层门任一层不过都走这里）。',
          ...(useLlm ? [] : ['  ★ 本次 `use_llm` 未开（缺省 false）⇒ 含**无谓词声明**的提案会在此冻结；确需 LLM 复核请显式 `use_llm: true`。']),
        );
      }
      return { message: lines.join('\n'), data: { action, dir, id, agent, version: r.version, frozen: r.frozen, reason: r.reason, proposal: r.proposal } };
    });
