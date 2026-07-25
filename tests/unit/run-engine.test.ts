import { describe, expect, it } from 'vitest';
import { getRelic, RELIC_DEFS } from '../../src/data/relics';
import { canRecruit, RECRUIT_COST, ROSTER_CAP } from '../../src/sim/member';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP, evaluateWinType } from '../../src/sim/outcome';
import { RunEngine, SPRINTS_PER_QUARTER } from '../../src/sim/run/engine';
import { RunPhaseError } from '../../src/sim/run/phases';
import { canAcknowledgeWin } from '../../src/sim/run/quarterReview';
import type { BeatState, RunState } from '../../src/sim/run/types';
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

  it('試練「フロンティアモデル依存」はスプリントごとに依存度と利用コストを増やす', () => {
    const normal = new RunEngine({ seed: 'frontier-dependency', difficulty: 'normal' });
    normal.startRun();
    normal.beginSetupSprint();

    const trial = new RunEngine({
      seed: 'frontier-dependency',
      difficulty: 'normal',
      trials: ['frontier-dependency'],
    });
    trial.startRun();
    trial.beginSetupSprint();

    const normalState = normal.snapshot();
    const trialState = trial.snapshot();
    expect(trialState.org.aiDependency).toBe(normalState.org.aiDependency + 5);
    // Normal の初期 AI依存度 35 に自然増加 5 を足し、ceil(40 × 0.05) の 2 を消費する。
    expect(trialState.budget).toBe(normalState.budget - 2);

    const replay = new RunEngine({
      seed: 'frontier-dependency',
      difficulty: 'normal',
      trials: ['frontier-dependency'],
    });
    replay.startRun();
    replay.beginSetupSprint();
    expect(replay.snapshot()).toEqual(trialState);
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

  it('RI-32: ボス突破時に未所持レリックを決定論的に1つ獲得する', () => {
    let winningSeed: string | undefined;
    let state: RunState | undefined;

    for (let i = 0; i < 30; i += 1) {
      const seed = `ri32-boss-reward-${i}`;
      const engine = new RunEngine({ seed, difficulty: 'easy' });
      engine.startRun();
      const snapshot = playUntil(engine, 'quarterReview', { skilled: true });
      if (snapshot.quarterReview?.bossCleared) {
        winningSeed = seed;
        state = snapshot;
        break;
      }
    }

    expect(winningSeed).toBeDefined();
    expect(state?.bossRelicReward).toBeDefined();
    expect(RELIC_DEFS.map((relic) => relic.id)).toContain(state?.bossRelicReward);
    expect(state?.relics).toContain(state?.bossRelicReward);

    const replay = new RunEngine({ seed: winningSeed!, difficulty: 'easy' });
    replay.startRun();
    const replayState = playUntil(replay, 'quarterReview', { skilled: true });
    expect(replayState.bossRelicReward).toBe(state?.bossRelicReward);
  });

  it('RI-32: ボス報酬は四半期レビュー判定後に付与され KPI を書き換えない', () => {
    let found = false;
    for (let i = 0; i < 40; i += 1) {
      const seed = `ri32-kpi-order-${i}`;
      const engine = new RunEngine({ seed, difficulty: 'easy' });
      engine.startRun();
      const state = playUntil(engine, 'quarterReview', { skilled: true });
      if (!state.quarterReview?.bossCleared || !state.bossRelicReward) continue;

      const reward = getRelic(state.bossRelicReward);
      const qualityAdd = reward?.effects?.qualityAdd ?? 0;
      if (qualityAdd <= 0) continue;

      const qualityKpi = state.quarterReview.progress.find((kpi) => kpi.id === 'quality');
      // 四半期 KPI は全社集約。報酬は全チームへ焼き込むので、集約品質から差分を戻す。
      const companyQuality = Math.round(
        state.teams.reduce((a, t) => a + t.quality, 0) / state.teams.length,
      );
      expect(qualityKpi?.actual).toBe(companyQuality - qualityAdd);
      found = true;
      break;
    }
    expect(found).toBe(true);
  });

  it('RI-32: ボス報酬はショップ解放プール外のレリックも付与できる', () => {
    const shopOnly = new Set(['postmortem', 'small-pr', 'primary-source', 'expectation-mgmt']);
    let foundMetaLocked = false;

    for (let i = 0; i < 80; i += 1) {
      const engine = new RunEngine({
        seed: `ri32-boss-pool-${i}`,
        difficulty: 'easy',
        allowedRelics: shopOnly,
      });
      engine.startRun();
      const state = playUntil(engine, 'quarterReview', { skilled: true });
      if (!state.quarterReview?.bossCleared || !state.bossRelicReward) continue;
      if (!shopOnly.has(state.bossRelicReward)) {
        foundMetaLocked = true;
        expect(state.relics).toContain(state.bossRelicReward);
        break;
      }
    }

    expect(foundMetaLocked).toBe(true);
  });

  it('RI-32: レリック枠が埋まっている場合、ボス報酬は付与されない', () => {
    const engine = new RunEngine({ seed: 'ri32-boss-relic-slots', difficulty: 'easy' });
    const internals = engine as unknown as {
      relics: string[];
      grantBossRelic(): string | undefined;
    };
    internals.relics = RELIC_DEFS.slice(0, 6).map((relic) => relic.id);

    expect(internals.grantBossRelic()).toBeUndefined();
    expect(internals.relics).toHaveLength(6);
  });

  it('RI-32: レリック枠が埋まっている場合、ショップ購入は課金も敗北もしない', () => {
    const engine = new RunEngine({ seed: 'ri32-shop-relic-slots', difficulty: 'nightmare' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      relics: string[];
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean };
      } | null;
    };
    internals.relics = RELIC_DEFS.slice(0, 6).map((relic) => relic.id);
    internals.phase = 'shop';
    internals.budget = 30;
    internals.shop = {
      cards: [],
      relic: { id: 'expectation-mgmt', cost: 30, bought: false },
    };

    engine.buyShopRelic();
    const after = engine.snapshot();
    expect(after.status).toBe('playing');
    expect(after.phase).toBe('shop');
    expect(after.budget).toBe(30);
    expect(after.relics).toHaveLength(6);
    expect(after.shop?.relic?.bought).toBe(false);
  });

  it('RI-32: 勝利種別はボス報酬適用前の org で判定する', () => {
    let verified = false;
    for (let i = 0; i < 80; i += 1) {
      const engine = new RunEngine({ seed: `ri32-win-type-${i}`, difficulty: 'easy' });
      engine.startRun();
      const state = playUntil(engine, 'quarterReview', { skilled: true });
      if (!state.quarterReview || !canAcknowledgeWin(state.quarterReview.outcome)) continue;
      if (!state.bossRelicReward) continue;

      const effects = getRelic(state.bossRelicReward)?.effects ?? {};
      const preRewardOrg = {
        ...state.org,
        quality: Math.max(0, state.org.quality - (effects.qualityAdd ?? 0)),
        testCoverage: Math.max(0, state.org.testCoverage - (effects.testCoverageAdd ?? 0)),
        aiLiteracy: Math.max(0, state.org.aiLiteracy - (effects.aiLiteracyAdd ?? 0)),
        aiDependency: Math.max(0, state.org.aiDependency - (effects.aiDependencyAdd ?? 0)),
      };
      const expected = evaluateWinType({
        org: preRewardOrg,
        totals: state.totals,
        budget: state.budget,
        usedHeavyActions: state.usedHeavyActions,
      });

      engine.acknowledgeQuarterReview();
      const after = engine.snapshot();
      expect(after.status).toBe('won');
      expect(after.winType).toBe(expected);
      verified = true;
      break;
    }
    expect(verified).toBe(true);
  });

  it('RI-32: カード発動で AI 依存上限を超えると即時敗北する', () => {
    const engine = new RunEngine({ seed: 'ri32-card-lose-direct', difficulty: 'nightmare' });
    engine.startRun();
    // 境界状態を直接組み立て、playCard の即時敗北経路を検証する（RI-30: 獲得時は未発動）。
    const internals = engine as unknown as {
      phase: string;
      draft: string[] | null;
      shop: { cards: Array<{ defId: string; cost: number; bought: boolean }> } | null;
      org: { aiDependency: number; aiLiteracy: number };
      budget: number;
      deck: Array<{ defId: string; level: number }>;
      sprint: {
        complete: boolean;
        focus: number;
        cardPiles: { hand: number[]; played: number[]; discard: number[]; drawOrder: number[] };
        cardEffects: unknown;
      } | null;
      sprintPassiveEffects: unknown;
    };
    internals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    internals.phase = 'draft';
    internals.draft = ['copilot'];
    engine.chooseCard('copilot');
    let after = engine.snapshot();
    expect(after.status).toBe('playing');
    expect(after.deck.some((c) => c.defId === 'copilot')).toBe(true);

    // スプリントへ進め、手札の copilot を発動して敗北させる。
    internals.phase = 'setup';
    engine.beginSetupSprint();
    after = engine.snapshot();
    expect(after.phase).toBe('sprint');
    const handDeckIndex = after.sprint!.cardPiles.hand.find(
      (idx) => after.deck[idx]?.defId === 'copilot',
    );
    expect(handDeckIndex).toBeDefined();
    const play = engine.playCard(handDeckIndex!);
    expect(play.ok).toBe(true);
    after = engine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('aiDependency');
    expect(after.phase).toBe('lost');

    const shopEngine = new RunEngine({ seed: 'ri32-shop-lose-direct', difficulty: 'nightmare' });
    shopEngine.startRun();
    const shopInternals = shopEngine as unknown as typeof internals;
    shopInternals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    shopInternals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    shopInternals.budget = 100;
    shopInternals.phase = 'shop';
    shopInternals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };
    shopEngine.buyShopCard('copilot');
    after = shopEngine.snapshot();
    // 購入だけでは未発動のため敗北しない。
    expect(after.status).toBe('playing');
    expect(after.deck.some((c) => c.defId === 'copilot')).toBe(true);

    const budgetEngine = new RunEngine({ seed: 'ri32-budget-exhausted', difficulty: 'nightmare' });
    budgetEngine.startRun();
    const budgetInternals = budgetEngine as unknown as typeof internals;
    budgetInternals.phase = 'shop';
    budgetInternals.budget = 10;
    budgetInternals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };
    budgetEngine.buyShopCard('copilot');
    after = budgetEngine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('budgetExhausted');
  });

  it('RI-32: 採用で予算が尽きても lost フェーズを保持する', () => {
    const engine = new RunEngine({ seed: 'ri32-recruit-budget', difficulty: 'nightmare' });
    engine.startRun();
    const internals = engine as unknown as {
      phase: string;
      budget: number;
    };
    internals.phase = 'rest';
    internals.budget = 25;
    engine.restChoose('recruit');
    const after = engine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('budgetExhausted');
    expect(after.phase).toBe('lost');
  });

  it('RI-32: 全社レバーで予算が尽きると即時敗北する', () => {
    const engine = new RunEngine({ seed: 'ri32-lever-budget', difficulty: 'nightmare' });
    engine.startRun();
    engine.zoomTo('company');
    const before = engine.snapshot();
    expect(before.budget).toBe(25);
    expect(engine.applyOrgLever('aiGuideline')).toBe(true);
    const after = engine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('budgetExhausted');
    expect(after.phase).toBe('lost');
  });

  it('RI-32: スプリント開始時の試練コストで予算が尽きると即時敗北する', () => {
    const engine = new RunEngine({
      seed: 'ri32-sprint-budget',
      difficulty: 'nightmare',
      trials: ['frontier-dependency'],
    });
    engine.startRun();
    const internals = engine as unknown as {
      budget: number;
      org: { aiDependency: number };
    };
    // 依存度 55 + 試練 +5 → 60、ceil(60 * 0.05)=3 を差し引くと予算 0。
    internals.budget = 3;
    internals.org.aiDependency = 55;
    engine.beginSetupSprint();
    const after = engine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('budgetExhausted');
    expect(after.phase).toBe('lost');
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

  it('RI-55: 無介入スプリントの実績は同条件ベースラインと一致する', () => {
    const e = new RunEngine({ seed: 'ri55-no-intervention', difficulty: 'normal' });
    e.startRun();
    e.beginSetupSprint();
    e.step(1_000_000);
    const result = e.snapshot().lastResult!;

    expect(result.baseline).toEqual({
      delivered: result.delivered,
      spread: result.spread,
      maxCombo: result.maxCombo,
    });
  });

  it('RI-55: 介入ありでも無介入ベースラインを添付し、ライブ状態を維持する', () => {
    const e = new RunEngine({ seed: 'ri55-intervention', difficulty: 'normal' });
    e.startRun();
    e.beginSetupSprint();
    expect(e.dispatch('overtime').ok).toBe(true);
    e.step(1_000_000);
    const state = e.snapshot();
    const result = state.lastResult!;

    expect(result.actionCounts.overtime).toBe(1);
    expect(result.baseline).toBeDefined();
    expect(
      result.delivered !== result.baseline!.delivered ||
        result.spread !== result.baseline!.spread ||
        result.maxCombo !== result.baseline!.maxCombo,
    ).toBe(true);
    expect(state.org.deliveryScore).toBeGreaterThanOrEqual(result.delivered);
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
              if (s.shop.recruit) e.buyShopRecruit();
            }
            e.leaveShop();
            break;
          case 'rest':
            e.restChoose(guard % 2 === 0 ? 'repay' : 'upgrade');
            break;
          case 'recruit':
            e.recruitChoose(guard % 2 === 0 ? 'hire' : 'skip');
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

  it('RI-37: 休息のカード強化で指定した位置だけを強化できる', () => {
    let engine: RunEngine | null = null;
    let targetIndex = -1;

    for (const seed of ['ri37-upgrade-a', 'ri37-upgrade-b', 'ri37-upgrade-c', 'ri37-upgrade-d']) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        if (s.phase === 'rest') {
          const index = s.deck.findIndex((card, i) => i > 0 && card.defId !== s.deck[0]?.defId);
          if (index > 0) {
            engine = e;
            targetIndex = index;
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
    const before = engine!.snapshot().deck;
    const targetBefore = before[targetIndex];

    engine!.restChoose('upgrade', targetIndex);
    const after = engine!.snapshot();

    expect(after.deck[targetIndex].level).toBe(targetBefore.level + 1);
    expect(after.deck.filter((_, i) => i !== targetIndex)).toEqual(
      before.filter((_, i) => i !== targetIndex),
    );
    expect(after.phase).toBe('setup');
  });

  it('RI-37: 同一 defId の重複カードでも指定位置だけを強化する', () => {
    let verified = false;
    for (const seed of Array.from({ length: 120 }, (_, i) => `ri37-dup-${i}`)) {
      const e = new RunEngine({ seed, difficulty: 'easy' });
      e.startRun();
      let s = e.snapshot();
      let guard = 0;
      while (s.status === 'playing' && guard < 40_000) {
        guard += 1;
        if (s.phase === 'rest') {
          const dupIndex = s.deck.findIndex((card, index) =>
            s.deck.some((other, j) => j < index && other.defId === card.defId),
          );
          if (dupIndex > 0) {
            const before = s.deck;
            const firstIndex = before.findIndex((card) => card.defId === before[dupIndex].defId);
            e.restChoose('upgrade', dupIndex);
            const after = e.snapshot().deck;
            expect(after[firstIndex].level).toBe(before[firstIndex].level);
            expect(after[dupIndex].level).toBe(before[dupIndex].level + 1);
            verified = true;
            break;
          }
          e.restChoose('heal');
        } else if (s.phase === 'draft' && s.draft && s.draft.length > 0) {
          const existing = new Set(s.deck.map((card) => card.defId));
          const duplicate = s.draft.find((id) => existing.has(id)) ?? s.draft[0];
          e.chooseCard(duplicate);
        } else if (!advance(e, { beatChoice: 0 })) {
          break;
        }
        s = e.snapshot();
      }
      if (verified) break;
    }

    expect(verified).toBe(true);
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
    let boughtIndex = -1;

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
          boughtIndex = s.deck.findIndex((card) => card.defId === bought);
          if (boughtIndex >= 0) {
            engine = e;
            break;
          }
          e.restChoose('heal');
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
    const before = engine!.snapshot().deck[boughtIndex];
    expect(before).toBeDefined();

    engine!.restChoose('upgrade', boughtIndex);
    const after = engine!.snapshot().deck[boughtIndex];
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

  it('sprintTick は sprint 存続中は phase に関わらず最終 tick を保持する（RI-50）', () => {
    const e = new RunEngine({ seed: 'sprint-tick', difficulty: 'easy' });
    e.startRun('easy');
    e.beginSetupSprint();
    let guard = 0;
    while (guard < 8000) {
      e.step(100);
      const s = e.snapshot();
      if (!s.sprint) break;
      if (s.sprint.complete) {
        expect(s.sprintTick).toBeGreaterThan(0);
        expect(s.phase).toBe('result');
        return;
      }
      guard += 1;
    }
    throw new Error('sprint did not complete within guard');
  });
});

describe('RI-26 採用の入口拡張', () => {
  type ShopRecruitInternals = {
    phase: string;
    budget: number;
    shop: {
      cards: Array<{ defId: string; cost: number; bought: boolean }>;
      recruit?: { cost: number; bought: boolean };
    } | null;
    roster: RunState['roster'];
    beat: BeatState | null;
  };

  it('buildShop は採用枠を常に載せる', () => {
    const engine = new RunEngine({ seed: 'ri26-build-shop', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as ShopRecruitInternals & {
      buildShop: () => NonNullable<ShopRecruitInternals['shop']>;
    };
    const shop = internals.buildShop();
    expect(shop.recruit).toEqual({ cost: RECRUIT_COST, bought: false });
  });

  it('ショップ採用は予算を消費しメンバーが増え、ショップに残る', () => {
    const engine = new RunEngine({ seed: 'ri26-shop-hire', difficulty: 'easy' });
    engine.startRun();
    const before = engine.snapshot();
    const internals = engine as unknown as ShopRecruitInternals;
    internals.phase = 'shop';
    internals.budget = 50;
    internals.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: false } };
    engine.buyShopRecruit();
    const after = engine.snapshot();
    expect(after.roster.members.length).toBe(before.roster.members.length + 1);
    expect(after.budget).toBe(50 - RECRUIT_COST);
    expect(after.shop?.recruit?.bought).toBe(true);
    expect(after.phase).toBe('shop');
    expect(after.roster.members.at(-1)?.assignment).toBe('bench');
  });

  it('ショップ採用は予算不足・満員だと no-op', () => {
    const engine = new RunEngine({ seed: 'ri26-shop-noop', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as ShopRecruitInternals;
    internals.phase = 'shop';
    internals.budget = RECRUIT_COST - 1;
    internals.shop = { cards: [], recruit: { cost: RECRUIT_COST, bought: false } };
    const beforeBudget = engine.snapshot();
    engine.buyShopRecruit();
    expect(engine.snapshot().roster.members.length).toBe(beforeBudget.roster.members.length);
    expect(engine.snapshot().budget).toBe(RECRUIT_COST - 1);
    expect(engine.snapshot().shop?.recruit?.bought).toBe(false);

    // 満員でも課金しない。
    const full = structuredClone(beforeBudget.roster);
    while (full.members.length < ROSTER_CAP) {
      const base = full.members[0]!;
      full.members.push({ ...base, id: `fill-${full.members.length}` });
    }
    internals.roster = full;
    internals.budget = 100;
    engine.buyShopRecruit();
    expect(canRecruit(engine.snapshot().roster)).toBe(false);
    expect(engine.snapshot().budget).toBe(100);
    expect(engine.snapshot().shop?.recruit?.bought).toBe(false);
  });

  it('採用フェーズで hire / skip できる', () => {
    const hire = new RunEngine({ seed: 'ri26-phase-hire', difficulty: 'easy' });
    hire.startRun();
    const hireBefore = hire.snapshot();
    const hireInternals = hire as unknown as ShopRecruitInternals;
    hireInternals.phase = 'recruit';
    hireInternals.budget = 40;
    hire.recruitChoose('hire');
    const hired = hire.snapshot();
    expect(hired.roster.members.length).toBe(hireBefore.roster.members.length + 1);
    expect(hired.budget).toBe(40 - RECRUIT_COST);
    expect(hired.phase).toBe('setup');
    // 採用成功時は見送りペナルティを課さない。
    expect(hired.org.morale).toBe(hireBefore.org.morale);

    const skip = new RunEngine({ seed: 'ri26-phase-skip', difficulty: 'easy' });
    skip.startRun();
    const skipBefore = skip.snapshot();
    const skipInternals = skip as unknown as ShopRecruitInternals;
    skipInternals.phase = 'recruit';
    skip.recruitChoose('skip');
    const skipped = skip.snapshot();
    expect(skipped.roster.members.length).toBe(skipBefore.roster.members.length);
    expect(skipped.budget).toBe(skipBefore.budget);
    expect(skipped.phase).toBe('setup');
    // accept→skip が見送り選択を支配しないよう、士気コストを課す。
    expect(skipped.org.morale).toBe(skipBefore.org.morale - 4);
  });

  it('採用フェーズ見送りは moraleDamageMul を通し、士気崩壊なら lost になる', () => {
    const engine = new RunEngine({ seed: 'ri26-skip-morale-lose', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as ShopRecruitInternals & {
      org: { morale: number };
      relics: string[];
    };
    internals.phase = 'recruit';
    internals.org.morale = 3;
    internals.relics = [];
    engine.recruitChoose('skip');
    const after = engine.snapshot();
    expect(after.status).toBe('lost');
    expect(after.loseReason).toBe('moraleCollapse');
    expect(after.phase).toBe('lost');
    expect(after.org.morale).toBe(0);
  });

  it('urgent-hire の grantRecruit で即時採用し、編成へ戻る', () => {
    const engine = new RunEngine({ seed: 'ri26-event-hire', difficulty: 'easy' });
    engine.startRun();
    const before = engine.snapshot();
    const internals = engine as unknown as ShopRecruitInternals;
    internals.phase = 'beat';
    internals.budget = 60;
    internals.beat = { eventId: 'urgent-hire', kind: 'decision' };
    engine.resolveBeat(0);
    const after = engine.snapshot();
    expect(after.roster.members.length).toBe(before.roster.members.length + 1);
    expect(after.budget).toBe(60 - RECRUIT_COST);
    // 即時採用後は編成へ戻り、ベンチの新メンバーを配置できる。
    expect(after.phase).toBe('setup');
    expect(after.roster.members.at(-1)?.assignment).toBe('bench');
    expect(after.stakeholderTrust.team).toBe(before.stakeholderTrust.team);
  });

  it('採用不能時は採用系ビートを抽選しない', () => {
    const engine = new RunEngine({ seed: 'ri26-no-hire-pool', difficulty: 'easy' });
    engine.startRun();
    const internals = engine as unknown as ShopRecruitInternals & {
      advanceBeat: () => void;
      budget: number;
    };
    // 予算不足で採用不能。
    internals.budget = RECRUIT_COST - 1;
    for (let i = 0; i < 40; i += 1) {
      internals.phase = 'evolution';
      internals.advanceBeat();
      const beat = engine.snapshot().beat;
      if (!beat) continue;
      expect(['recruit-offer', 'urgent-hire']).not.toContain(beat.eventId);
    }
  });

  it('urgent-hire の採用失敗は見送り相当の信頼低下を課す', () => {
    const engine = new RunEngine({ seed: 'ri26-event-hire-fail', difficulty: 'easy' });
    engine.startRun();
    const before = engine.snapshot();
    const internals = engine as unknown as ShopRecruitInternals;
    internals.phase = 'beat';
    internals.budget = RECRUIT_COST - 1;
    internals.beat = { eventId: 'urgent-hire', kind: 'decision' };
    engine.resolveBeat(0);
    const after = engine.snapshot();
    expect(after.roster.members.length).toBe(before.roster.members.length);
    expect(after.budget).toBe(RECRUIT_COST - 1);
    expect(after.stakeholderTrust.team).toBe(before.stakeholderTrust.team - 4);
    expect(after.phase).toBe('sprint');
  });

  it('recruit-offer 受諾で採用フェーズへ入り、見送りは士気低下してスプリントへ', () => {
    const accept = new RunEngine({ seed: 'ri26-offer-accept', difficulty: 'easy' });
    accept.startRun();
    const acceptInternals = accept as unknown as ShopRecruitInternals;
    acceptInternals.phase = 'beat';
    acceptInternals.beat = { eventId: 'recruit-offer', kind: 'decision' };
    accept.resolveBeat(0);
    expect(accept.snapshot().phase).toBe('recruit');

    const decline = new RunEngine({ seed: 'ri26-offer-decline', difficulty: 'easy' });
    decline.startRun();
    const moraleBefore = decline.snapshot().org.morale;
    const declineInternals = decline as unknown as ShopRecruitInternals;
    declineInternals.phase = 'beat';
    declineInternals.beat = { eventId: 'recruit-offer', kind: 'decision' };
    decline.resolveBeat(1);
    const declined = decline.snapshot();
    expect(declined.phase).toBe('sprint');
    expect(declined.org.morale).toBe(moraleBefore - 4);
  });
});

describe('フェーズ遷移の検証（setPhase / 遷移表。RI-39）', () => {
  type PhaseInternals = { setPhase(next: RunState['phase']): void };

  it('遷移表に無い遷移は RunPhaseError を投げる', () => {
    const e = new RunEngine({ seed: 'phase-guard', difficulty: 'normal' });
    const internals = e as unknown as PhaseInternals;
    // title からは setup 以外へ進めない。
    expect(() => internals.setPhase('won')).toThrow(RunPhaseError);
    expect(() => internals.setPhase('sprint')).toThrow(RunPhaseError);
    // 表にあるエッジ（title → setup）は通る。
    expect(() => internals.setPhase('setup')).not.toThrow();
    expect(e.snapshot().phase).toBe('setup');
    // setup からの逆行（→ title）は resetPhase の領分で、setPhase では不正。
    expect(() => internals.setPhase('title')).toThrow(RunPhaseError);
  });

  it('タイトル・終端フェーズでは組織レバーが発動しない', () => {
    const title = new RunEngine({ seed: 'lever-title', difficulty: 'normal' });
    expect(title.applyOrgLever('aiGuideline')).toBe(false);
    expect(title.snapshot().phase).toBe('title');

    const finished = new RunEngine({ seed: 'lever-finished', difficulty: 'easy' });
    const s = playRun(finished);
    expect(['won', 'lost']).toContain(s.phase);
    expect(finished.applyOrgLever('aiGuideline')).toBe(false);
    expect(finished.snapshot().phase).toBe(s.phase);
  });
});
