import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import type { RunState } from '../../src/sim/run/types';

/**
 * ランを最後（ボス＝won/lost）まで自動プレイするヘルパ。
 * マップでは常に先頭の分岐を選び、各フェーズを既定の選択で消化する。
 */
function playRun(
  e: RunEngine,
  opts: { unlockEvolution?: boolean; skilled?: boolean } = {},
  guardMax = 40_000,
): RunState {
  let s = e.snapshot();
  let guard = 0;
  while (s.status === 'playing' && guard < guardMax) {
    guard += 1;
    switch (s.phase) {
      case 'title':
        e.startRun();
        break;
      case 'map':
        e.enterNode(s.available[0]);
        break;
      case 'sprint':
        if (opts.skilled) {
          // プレイヤーを模す: 渋滞は割り込みレビュー、炎上は緊急対応で捌く。
          const sp = s.sprint;
          if (sp && !sp.complete) {
            if (sp.tasks.filter((t) => t.lane === 'review').length >= 6) {
              e.dispatch('interruptReview');
            }
            if (sp.tasks.some((t) => t.lane === 'rework' && t.incident)) {
              e.dispatch('firefight');
            }
          }
          e.step(300);
        } else {
          e.step(1_000_000);
        }
        break;
      case 'result':
        e.acknowledgeResult();
        break;
      case 'draft':
        if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]);
        else e.skipDraft();
        break;
      case 'evolution':
        if (opts.unlockEvolution && s.evolution.points > 0) {
          e.unlockEvolution('review-1');
        }
        e.finishEvolution();
        break;
      case 'event':
        e.chooseEvent(0);
        break;
      case 'shop':
        e.leaveShop();
        break;
      case 'rest':
        e.restChoose('heal');
        break;
      default:
        guard = guardMax;
        break;
    }
    s = e.snapshot();
  }
  return s;
}

describe('RunEngine 通しプレイ（DoD: マップ→ボス→決着）', () => {
  it('タイトルから開始するとマップが提示される', () => {
    const e = new RunEngine({ seed: 'run-a', difficulty: 'normal' });
    expect(e.snapshot().phase).toBe('title');
    e.startRun();
    const s = e.snapshot();
    expect(s.phase).toBe('map');
    expect(s.available.length).toBeGreaterThanOrEqual(2);
    expect(s.bossId).toBeTruthy();
  });

  it('最後まで自動プレイすると勝利か敗北で必ず決着する', () => {
    const e = new RunEngine({ seed: 'run-finish', difficulty: 'easy' });
    const s = playRun(e);
    expect(['won', 'lost']).toContain(s.status);
    expect(['won', 'lost']).toContain(s.phase);
    expect(s.visited.length).toBeGreaterThanOrEqual(2);
  });

  it('介入で捌くプレイならボスへ到達して決着する（DoD: マップ→ボス）', () => {
    const e = new RunEngine({ seed: 'reach-boss', difficulty: 'easy' });
    const s = playRun(e, { skilled: true });
    const boss = s.map.nodes.find((n) => n.type === 'boss')!;
    expect(s.visited).toContain(boss.id);
    expect(['won', 'lost']).toContain(s.status);
  });

  it('同一 seed・同一選択なら完全再現する（決定論）', () => {
    const a = playRun(new RunEngine({ seed: 'determinism', difficulty: 'normal' }));
    const b = playRun(new RunEngine({ seed: 'determinism', difficulty: 'normal' }));
    expect(a.status).toBe(b.status);
    expect(a.org.deliveryScore).toBe(b.org.deliveryScore);
    expect(a.totals).toEqual(b.totals);
    expect(a.diagnosis).toBe(b.diagnosis);
  });

  it('スプリント完了で進化ポイントが付与され、組織状態が引き継がれる', () => {
    const e = new RunEngine({ seed: 'carry', difficulty: 'normal' });
    e.startRun();
    let s = e.snapshot();
    const firstNode = s.available[0];
    e.enterNode(firstNode);
    e.step(1_000_000);
    s = e.snapshot();
    expect(s.phase).toBe('result');
    expect(s.sprintsPlayed).toBe(1);
    e.acknowledgeResult();
    s = e.snapshot();
    expect(s.phase).toBe('draft');
    expect(s.evolution.points).toBeGreaterThan(0);
  });

  it('Easy と Nightmare では同一 seed でも結果が変わる（難易度が効く）', () => {
    const easy = playRun(new RunEngine({ seed: 'diff-cmp', difficulty: 'easy' }));
    const nightmare = playRun(new RunEngine({ seed: 'diff-cmp', difficulty: 'nightmare' }));
    const differs =
      easy.status !== nightmare.status ||
      easy.org.deliveryScore !== nightmare.org.deliveryScore ||
      easy.totals.rework !== nightmare.totals.rework;
    expect(differs).toBe(true);
  });

  it('ショップ購入・休息・進化・イベント付与を行うプレイでもクラッシュせず決着する', () => {
    for (const seed of ['shop-a', 'shop-b', 'shop-c', 'shop-d', 'shop-e']) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        switch (s.phase) {
          case 'map':
            e.enterNode(s.available[0]);
            break;
          case 'sprint': {
            const sp = s.sprint;
            if (sp && !sp.complete && sp.tasks.filter((t) => t.lane === 'review').length >= 6) {
              e.dispatch('interruptReview');
            }
            e.step(300);
            break;
          }
          case 'result':
            e.acknowledgeResult();
            break;
          case 'draft':
            if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]);
            else e.skipDraft();
            break;
          case 'evolution':
            if (s.evolution.points > 0) {
              e.unlockEvolution('review-1');
              e.unlockEvolution('quality-1');
            }
            e.finishEvolution();
            break;
          case 'event':
            // index 1（多くがレリック/カード付与の分岐）を選ぶ。
            e.chooseEvent(1);
            break;
          case 'shop':
            if (s.shop) {
              for (const c of s.shop.cards) e.buyShopCard(c.defId);
              e.buyShopRelic();
            }
            e.leaveShop();
            break;
          case 'rest':
            e.restChoose(guard % 2 === 0 ? 'repay' : 'upgrade');
            break;
          default:
            guard = 40_000;
            break;
        }
        s = e.snapshot();
      }
      expect(['won', 'lost']).toContain(s.status);
    }
  });

  it('介入アクション（割り込みレビュー）でレビュー渋滞が減る', () => {
    const e = new RunEngine({ seed: 'intervene', difficulty: 'normal' });
    e.startRun();
    e.enterNode(e.snapshot().available[0]);
    // Review にタスクが溜まるまで小刻みに進める。
    let guard = 0;
    let queue = 0;
    while (guard < 4000) {
      e.step(100);
      const s = e.snapshot();
      if (!s.sprint || s.sprint.complete) break;
      queue = s.sprint.tasks.filter((t) => t.lane === 'review').length;
      if (queue >= 4) break;
      guard += 1;
    }
    const before = e.snapshot();
    if (before.sprint && !before.sprint.complete && queue >= 4) {
      const outcome = e.dispatch('interruptReview');
      expect(outcome.ok).toBe(true);
      const after = e.snapshot();
      const afterQueue = after.sprint!.tasks.filter((t) => t.lane === 'review').length;
      expect(afterQueue).toBeLessThan(queue);
    }
  });
});
