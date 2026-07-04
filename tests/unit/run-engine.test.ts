import { describe, expect, it } from 'vitest';
import { RunEngine, SPRINTS_PER_QUARTER } from '../../src/sim/run/engine';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../src/sim/run/quarterReviewSeeds';
import { advance, playRun, playUntil } from './helpers/runFlow';

describe('RunEngine 通しプレイ（DoD: 固定トラック→ボス→決着）', () => {
  it('タイトルから開始すると編成（setup）が提示される', () => {
    const e = new RunEngine({ seed: 'run-a', difficulty: 'normal' });
    expect(e.snapshot().phase).toBe('title');
    e.startRun();
    const s = e.snapshot();
    expect(s.phase).toBe('setup');
    expect(s.sprintsPerQuarter).toBe(SPRINTS_PER_QUARTER);
    expect(s.sprintIndexInQuarter).toBe(0);
    expect(s.bossId).toBeTruthy();
  });

  it('最後まで自動プレイすると勝利か敗北で必ず決着する', () => {
    const e = new RunEngine({ seed: 'run-finish', difficulty: 'easy' });
    const s = playRun(e);
    expect(['won', 'lost']).toContain(s.status);
    expect(['won', 'lost']).toContain(s.phase);
    expect(s.sprintsPlayed).toBeGreaterThanOrEqual(2);
  });

  it('ボス到達後は四半期レビューフェーズになる', () => {
    const e = new RunEngine({ seed: 'boss-seek-0', difficulty: 'easy' });
    e.startRun();
    const s = playUntil(e, 'quarterReview', { skilled: true });
    expect(s.phase).toBe('quarterReview');
    expect(s.quarterReview).not.toBeNull();
  });

  it('目標修正後は次四半期（quarterNumber=2）へ進める', () => {
    const e = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    e.startRun();
    let s = playUntil(e, 'quarterReview');
    if (s.quarterReview?.outcome === 'missed_adjustable') {
      e.chooseGoalAdjustment('cut_scope');
      s = e.snapshot();
      expect(s.quarterNumber).toBe(2);
      expect(s.phase).toBe('setup');
    }
  });

  it('介入で捌くプレイならボススプリントへ到達して決着する（DoD: トラック→ボス）', () => {
    const e = new RunEngine({ seed: 'boss-seek-0', difficulty: 'easy' });
    const s = playRun(e, { skilled: true });
    // 1 四半期は SPRINTS_PER_QUARTER 本（最終がボス）。最低限ボスまで到達している。
    expect(s.sprintsPlayed).toBeGreaterThanOrEqual(SPRINTS_PER_QUARTER);
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
    e.beginSetupSprint();
    e.step(1_000_000);
    let s = e.snapshot();
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
          case 'setup':
            e.beginSetupSprint();
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
          case 'beat':
            // 選択イベントは index 1（多くが見送り/別分岐）を選び、判定は自動適用。
            e.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 1);
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
          case 'quarterReview':
            if (s.quarterReview?.outcome === 'missed_adjustable') {
              e.chooseGoalAdjustment(s.quarterReview.availableAdjustments[0] ?? 'cut_scope');
            } else {
              e.acknowledgeQuarterReview();
            }
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

  it('RI-37: 休息のカード強化で指定したカードだけを強化できる', () => {
    let engine: RunEngine | null = null;
    let targetDefId = '';

    for (const seed of ['ri37-upgrade-a', 'ri37-upgrade-b', 'ri37-upgrade-c', 'ri37-upgrade-d']) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        if (s.phase === 'rest') {
          const first = s.deck[0];
          const target = s.deck.find((card, index) => index > 0 && card.defId !== first?.defId);
          if (first && target) {
            engine = e;
            targetDefId = target.defId;
            break;
          }
          e.restChoose('heal');
        } else if (!advance(e, { beatChoice: 0 })) {
          break;
        }
        s = e.snapshot();
      }
      if (engine) break;
    }

    expect(engine).not.toBeNull();
    const before = engine!.snapshot();
    const firstBefore = before.deck[0];
    const targetBefore = before.deck.find((card) => card.defId === targetDefId)!;

    engine!.restChoose('upgrade', targetDefId);
    const after = engine!.snapshot();

    expect(after.deck[0]).toEqual(firstBefore);
    expect(after.deck.find((card) => card.defId === targetDefId)?.level).toBe(
      targetBefore.level + 1,
    );
    expect(after.phase).toBe('setup');
  });

  it('RI-37: 対象未指定の休息強化は既存互換で先頭カードを強化する', () => {
    let engine: RunEngine | null = null;
    for (const seed of Array.from({ length: 80 }, (_, i) => `ri37-legacy-${i}`)) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      const s = playUntil(e, 'rest', { beatChoice: 0 }, 40_000);
      if (s.phase === 'rest' && s.deck.length > 0) {
        engine = e;
        break;
      }
    }

    expect(engine).not.toBeNull();

    const before = engine!.snapshot().deck;
    engine!.restChoose('upgrade');
    const after = engine!.snapshot().deck;

    expect(after[0].level).toBe(before[0].level + 1);
    expect(after.slice(1)).toEqual(before.slice(1));
  });

  it('RI-37: ショップ購入カードも休息強化の対象にできる', () => {
    let engine: RunEngine | null = null;
    let boughtDefId = '';

    for (const seed of Array.from({ length: 160 }, (_, i) => `ri37-shop-${i}`)) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      let bought = '';
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        if (s.phase === 'shop' && s.shop && !bought) {
          const offer = s.shop.cards.find((card) => s.budget >= card.cost);
          if (offer) {
            bought = offer.defId;
            e.buyShopCard(offer.defId);
          }
          e.leaveShop();
        } else if (s.phase === 'rest' && bought) {
          engine = e;
          boughtDefId = bought;
          break;
        } else if (s.phase === 'rest') {
          e.restChoose('heal');
        } else if (!advance(e, { beatChoice: 0 })) {
          break;
        }
        s = e.snapshot();
      }
      if (engine) break;
    }

    expect(engine).not.toBeNull();
    const before = engine!.snapshot().deck.find((card) => card.defId === boughtDefId);
    expect(before).toBeDefined();

    engine!.restChoose('upgrade', boughtDefId);
    const after = engine!.snapshot().deck.find((card) => card.defId === boughtDefId);
    expect(after?.level).toBe(before!.level + 1);
  });

  it('介入アクション（割り込みレビュー）でレビュー渋滞が減る', () => {
    const e = new RunEngine({ seed: 'intervene', difficulty: 'normal' });
    e.startRun();
    e.beginSetupSprint();
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
