/**
 * gate_probe.ts 的**自身出生证** —— 证明这个 helper 不是哑的。
 *
 * 为什么必须有：helper 自己也可能变成「恒真的空门」。
 *   若 `expectGateGoesRed` 无论门红不红都不报错，那它给所有门盖的"出生证"都是假章 ——
 *   比没有 helper 更糟（虚假安全感）。所以这里逐个钉：
 *     ① 门**没**变红 ⇒ **必须报错**（这是 helper 存在的全部意义）；
 *     ② 门**确实**变红 ⇒ **不许**报错（否则 helper 是个"永远抛错"的废物）；
 *     ③ 注入失败 / 跑门抛错 / 断言失败 ⇒ **仍然还原**（不然一次失败污染工作区）；
 *     ④ 还原失败 ⇒ 最响地报（工作区被污染比"门没红"更严重）；
 *     ⑤ 对照项（expectGateStaysGreen）：门误伤 ⇒ 报错；门正确放过 ⇒ 通过。
 */

import { describe, it, expect } from 'vitest';
import { expectGateGoesRed, expectGateStaysGreen } from './gate_probe.js';

describe('gate_probe · 自身出生证（它不是哑的）', () => {
  it('① 门**没有**变红 ⇒ 报错（核心：它会当场戳穿恒真的空门）', () => {
    expect(() =>
      expectGateGoesRed<{ red: boolean }>({
        name: '假门（恒绿）',
        mutate: () => {},
        run: () => ({ red: false }),
        isRed: (r) => r.red,
        restore: () => {},
      }),
    ).toThrow(/没有变红/);
  });

  it('② 门**确实**变红 ⇒ 不报错（否则 helper 是"永远抛错"的废物）', () => {
    expect(() =>
      expectGateGoesRed<{ red: boolean }>({
        name: '假门（会红）',
        mutate: () => {},
        run: () => ({ red: true }),
        isRed: (r) => r.red,
        restore: () => {},
      }),
    ).not.toThrow();
  });

  it('③a 跑门抛错（无法判定）⇒ 报错，且**仍然还原**', () => {
    let restored = 0;
    expect(() =>
      expectGateGoesRed<never>({
        name: '跑门会炸的假门',
        mutate: () => {},
        run: () => {
          throw new Error('读盘炸了');
        },
        isRed: () => true,
        restore: () => {
          restored += 1;
        },
      }),
    ).toThrow(/跑门本身抛异常/);
    expect(restored, '跑门抛错后也必须还原').toBe(1);
  });

  it('③b 断言失败（门没红）⇒ 仍**仍然还原**', () => {
    let restored = 0;
    expect(() =>
      expectGateGoesRed<{ red: boolean }>({
        name: '恒绿假门',
        mutate: () => {},
        run: () => ({ red: false }),
        isRed: (r) => r.red,
        restore: () => {
          restored += 1;
        },
      }),
    ).toThrow(/没有变红/);
    expect(restored, '断言失败后也必须还原（否则污染工作区）').toBe(1);
  });

  it('③c 注入本身抛错 ⇒ 报错，且**仍然还原**（注入可能已改了半个状态）', () => {
    let restored = 0;
    expect(() =>
      expectGateGoesRed<{ red: boolean }>({
        name: '注入会炸的假门',
        mutate: () => {
          throw new Error('写盘失败');
        },
        run: () => ({ red: true }),
        isRed: (r) => r.red,
        restore: () => {
          restored += 1;
        },
      }),
    ).toThrow(/注入失败/);
    expect(restored, '注入失败后也必须还原').toBe(1);
  });

  it('④ 还原失败 ⇒ 报"还原失败"（最严重），且优先于"门没红"之类的报告', () => {
    expect(() =>
      expectGateGoesRed<{ red: boolean }>({
        name: '还原会炸的假门',
        mutate: () => {},
        run: () => ({ red: false }), // 门没红 —— 但"还原失败"应优先报出
        isRed: (r) => r.red,
        restore: () => {
          throw new Error('删不掉注入物');
        },
      }),
    ).toThrow(/还原失败/);
  });

  it('⑤ 对照项：门**误伤**（本不该抓却抓了）⇒ 报错', () => {
    expect(() =>
      expectGateStaysGreen<{ red: boolean }>({
        name: '判据过宽的假门',
        mutate: () => {},
        run: () => ({ red: true }),
        isRed: (r) => r.red,
        restore: () => {},
      }),
    ).toThrow(/本不该/);
  });

  it('⑤b 对照项：门正确放过 ⇒ 通过，且**仍然还原**', () => {
    let restored = 0;
    expect(() =>
      expectGateStaysGreen<{ red: boolean }>({
        name: '判据正常的假门',
        mutate: () => {},
        run: () => ({ red: false }),
        isRed: (r) => r.red,
        restore: () => {
          restored += 1;
        },
      }),
    ).not.toThrow();
    expect(restored, '对照项通过后也必须还原').toBe(1);
  });
});
