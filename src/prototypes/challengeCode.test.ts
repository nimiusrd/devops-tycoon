import { describe, expect, it, vi } from 'vitest';
import { RunEngine } from '../sim/run/engine';
import { CARD_DEFS } from '../data/cards';
import { normalizeReplay } from '../state/replay';
import { parseStartRecipe } from '../state/startRecipe';
import {
  CHALLENGE_LIMITS,
  openChallenge,
  parseChallengeCode,
  resumeChallenge,
  type ChallengeSession,
} from './challengeCode';
import {
  advanceChallenge,
  challengeAct,
  challengeFixture,
  finishChallenge,
} from './challengeCodeEvaluation';

function opened(seed = 'ri298-1', minimum = 5): ChallengeSession {
  const result = openChallenge(JSON.stringify(challengeFixture(seed, minimum)));
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function resumed(session: ChallengeSession): ChallengeSession {
  const result = resumeChallenge(session.save());
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('RI-298 挑戦コードの読取境界', () => {
  it('既存StartRecipeを利用し、研修方針と発動禁止の重複は所持禁止と誤認しない', () => {
    const code = challengeFixture('seed');
    expect(parseStartRecipe(JSON.stringify(code.recipe)).ok).toBe(true);
    expect(parseChallengeCode(JSON.stringify(code)).ok).toBe(true);
    expect(parseStartRecipe(JSON.stringify(code)).ok).toBe(false);
    expect(normalizeReplay(code)).toBeNull();
    expect(normalizeReplay(JSON.parse(opened().save()))).toBeNull();
  });

  it.each([
    [
      'unknown-card',
      (c: Record<string, unknown>) => {
        c.restrictions = [{ kind: 'forbid-activation', cardIds: ['not-a-card'] }];
      },
    ],
    [
      'conflicting-restrictions',
      (c: Record<string, unknown>) => {
        c.restrictions = [
          { kind: 'forbid-activation', cardIds: ['copilot'] },
          { kind: 'allow-activation', cardIds: ['copilot'] },
        ];
      },
    ],
    [
      'duplicate-card-rule',
      (c: Record<string, unknown>) => {
        c.restrictions = [{ kind: 'forbid-activation', cardIds: ['copilot', 'copilot'] }];
      },
    ],
    [
      'unsupported-objective',
      (c: Record<string, unknown>) => {
        c.objective = { kind: 'custom-win', minimum: 1 };
      },
    ],
    [
      'ruleset-mismatch',
      (c: Record<string, unknown>) => {
        c.ruleset = { ...challengeFixture('s').ruleset, prototype: 'old' };
      },
    ],
    [
      'invalid-objective-minimum',
      (c: Record<string, unknown>) => {
        c.objective = { kind: 'successful-interventions', minimum: 0 };
      },
    ],
    [
      'seed-too-long',
      (c: Record<string, unknown>) => {
        c.recipe = { ...challengeFixture('s').recipe, seed: 'a'.repeat(129) };
      },
    ],
    [
      'recipe:unknown_card',
      (c: Record<string, unknown>) => {
        c.recipe = { ...challengeFixture('s').recipe, preferredCardIds: ['unknown'] };
      },
    ],
  ])('%sを理由付きで拒否する', (reason, change) => {
    const code = JSON.parse(JSON.stringify(challengeFixture('s'))) as Record<string, unknown>;
    change(code);
    expect(parseChallengeCode(JSON.stringify(code))).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it('過大・未知形状・不正JSONを拒否する', () => {
    for (const raw of [
      '{',
      'null',
      '[]',
      ' '.repeat(CHALLENGE_LIMITS.codeChars + 1),
      JSON.stringify({ ...challengeFixture('s'), dailyDate: '2026-11-18' }),
    ]) {
      expect(openChallenge(raw).ok).toBe(false);
    }
    expect(openChallenge('['.repeat(20) + '0' + ']'.repeat(20))).toEqual({
      ok: false,
      reason: 'json-too-deep',
    });
    expect(resumeChallenge(' '.repeat(CHALLENGE_LIMITS.saveChars + 1)).ok).toBe(false);
    const save = JSON.parse(opened().save());
    save.inputs = Array.from({ length: CHALLENGE_LIMITS.inputs + 1 }, () => ({ type: 'tick' }));
    expect(resumeChallenge(JSON.stringify(save))).toEqual({ ok: false, reason: 'input-limit' });
  });
});

describe('RI-298 実RunEngineの操作強制と実測', () => {
  it('成功介入だけを数え、無効入力・二重開始は費用/履歴/RNGを消費しない', () => {
    const session = opened();
    const before = session.save();
    for (const input of [
      { type: 'tick' },
      { type: 'dispatch', actionId: 'pairReview' },
      { type: 'playCard', deckIndex: -1 },
      { type: 'dispatch', actionId: 'playCard', deckIndex: 0 },
      { type: 'startRun' },
      { type: 'playCard', deckIndex: 0.5 },
      { type: 'begin', engine: {} },
    ])
      expect(session.act(JSON.stringify(input)).ok).toBe(false);
    expect(session.save()).toBe(before);
    expect(challengeAct(session, { type: 'begin' }).ok).toBe(true);
    const started = session.save();
    expect(challengeAct(session, { type: 'begin' }).ok).toBe(false);
    expect(session.save()).toBe(started);
    const outcome = challengeAct(session, { type: 'dispatch', actionId: 'pairReview' });
    expect(outcome.ok).toBe(true);
    expect(session.view().objective.measured).toBe(1);
    const dispatched = session.save();
    expect(challengeAct(session, { type: 'dispatch', actionId: 'pairReview' }).ok).toBe(false);
    expect(session.save()).toBe(dispatched);
    expect(resumed(session).save()).toBe(session.save());
  });

  it('公開APIと返却値に可変エンジンを漏らさず、入力の別名/配列/状態編集から発動できない', () => {
    const session = opened();
    expect(Object.keys(session).sort()).toEqual(['act', 'save', 'view']);
    expect(Object.isFrozen(session)).toBe(true);
    const before = session.save();
    const view = session.view();
    view.objective.measured = 999;
    view.state.budget = 999999;
    view.state.deck.push({ defId: 'copilot', level: 1 });
    view.ruleset.prototype = 'fake';
    for (const raw of [
      '[{"type":"playCard","deckIndex":0}]',
      '{"type":"playCard","deckIndex":"0"}',
      '{"type":"rest","option":["heal"]}',
      '{"type":"dispatch","actionId":["pairReview"]}',
      '{"type":"chooseCard","cardId":["ai-guideline"]}',
      '{"type":"hydrateReplayFrame"}',
      '{}',
    ]) {
      expect(session.act(raw).ok).toBe(false);
    }
    expect(session.save()).toBe(before);
  });

  it('イベントで実際に獲得した禁止札も、再開/交換/反復index指定後も発動を拒否する', () => {
    // 通常抽選を実行する既知seed。イベント・engineを差替えない。
    const session = opened('event-0');
    let found = false;
    for (let guard = 0; guard < 2000 && session.view().state.status === 'playing'; guard++) {
      const s = session.view().state;
      if (s.phase === 'beat' && s.beat?.eventId === 'junior-awaken') {
        const count = s.deck.length;
        expect(challengeAct(session, { type: 'beat', choiceIndex: 1 }).ok).toBe(true);
        expect(session.view().state.deck[count].defId).toBe('ai-guideline');
        expect(challengeAct(session, { type: 'begin' }).ok).toBe(true);
        const current = resumed(session);
        const indices = current
          .view()
          .state.deck.flatMap((card, i) => (card.defId === 'ai-guideline' ? [i] : []));
        expect(current.view().state.sprint?.cardPiles.hand).toContain(count);
        for (const deckIndex of indices) {
          const before = current.save();
          expect(challengeAct(current, { type: 'playCard', deckIndex })).toEqual({
            ok: false,
            reason: 'forbidden-card-activation',
          });
          expect(current.save()).toBe(before);
          challengeAct(current, { type: 'exchangeCard', deckIndex });
          const exchanged = current.save();
          expect(challengeAct(current, { type: 'playCard', deckIndex }).ok).toBe(false);
          expect(current.save()).toBe(exchanged);
        }
        found = true;
        break;
      }
      advanceChallenge(session, true);
    }
    expect(found).toBe(true);
  });

  it('実エンジンと同じ入力で通常勝敗を維持し、課題達成をWinTypeにしない', () => {
    const session = opened('ri298-1', 1);
    const final = finishChallenge(session, true);
    const saved = JSON.parse(session.save());
    const engine = new RunEngine({ seed: saved.code.recipe.seed, difficulty: 'easy' });
    engine.setPreferredCards(saved.code.recipe.preferredCardIds);
    engine.startRun('easy', [], saved.code.recipe.seed, { scenario: 'default' });
    let measured = 0;
    for (const input of saved.inputs) {
      switch (input.type) {
        case 'begin':
          engine.beginSetupSprint();
          break;
        case 'tick':
          engine.step(1000);
          break;
        case 'dispatch':
          if (engine.dispatch(input.actionId).ok) measured++;
          break;
        case 'playCard':
          engine.playCard(input.deckIndex);
          break;
        case 'result':
          engine.acknowledgeResult();
          break;
        case 'chooseCard':
          engine.chooseCard(input.cardId);
          break;
        case 'skipDraft':
          engine.skipDraft();
          break;
        case 'finishEvolution':
          engine.finishEvolution();
          break;
        case 'beat':
          engine.resolveBeat(input.choiceIndex);
          break;
        case 'rest':
          engine.restChoose(input.option);
          break;
        case 'recruit':
          engine.recruitChoose(input.option);
          break;
        case 'leaveShop':
          engine.leaveShop();
          break;
        case 'review':
          engine.acknowledgeQuarterReview();
          break;
        case 'adjust':
          engine.chooseGoalAdjustment(input.adjustmentId);
          break;
        default:
          throw new Error(input.type);
      }
    }
    const { runKind: _kind, dailyDate: _date, ...actual } = engine.snapshot();
    expect(final.state).toEqual(actual);
    expect(final.objective.measured).toBe(measured);
    expect(final.objective.achieved).toBe(true);
    expect(final.state.status).toBe('lost');
    expect(final.result).toMatchObject({ rewardEligible: false, metaReward: 0, dailyReward: 0 });
    expect(resumed(session).view()).toEqual(final);
    const before = session.save();
    expect(challengeAct(session, { type: 'tick' })).toEqual({ ok: false, reason: 'complete' });
    expect(challengeAct(session, { type: 'begin' }).ok).toBe(false);
    expect(session.save()).toBe(before);
  });

  it('禁止札のdraft/shop取得は許可し、購入の二重課金と発動を拒否する', () => {
    const code = challengeFixture('ri298-2');
    code.restrictions[0].cardIds = CARD_DEFS.map(({ id }) => id);
    const result = openChallenge(JSON.stringify(code));
    if (!result.ok) throw new Error(result.reason);
    const session = result.value;
    let found = false;
    for (let guard = 0; guard < 2000 && session.view().state.status === 'playing'; guard++) {
      const s = session.view().state;
      if (s.phase === 'draft') {
        const count = s.deck.length;
        expect(challengeAct(session, { type: 'chooseCard', cardId: s.draft![0] }).ok).toBe(true);
        expect(session.view().state.deck).toHaveLength(count + 1);
      } else if (s.phase === 'shop' && s.shop?.cards.some((c) => c.cost <= s.budget)) {
        const card = s.shop.cards.find((c) => c.cost <= s.budget)!;
        const deckIndex = s.deck.length;
        expect(challengeAct(session, { type: 'buyCard', cardId: card.defId }).ok).toBe(true);
        expect(session.view().state.budget).toBe(s.budget - card.cost);
        const bought = session.save();
        expect(challengeAct(session, { type: 'buyCard', cardId: card.defId }).ok).toBe(false);
        expect(session.save()).toBe(bought);
        challengeAct(session, { type: 'leaveShop' });
        challengeAct(session, { type: 'begin' });
        expect(session.view().state.sprint?.cardPiles.hand).toContain(deckIndex);
        const before = session.save();
        expect(challengeAct(session, { type: 'playCard', deckIndex })).toEqual({
          ok: false,
          reason: 'forbidden-card-activation',
        });
        expect(session.save()).toBe(before);
        expect(resumed(session).save()).toBe(before);
        found = true;
        break;
      } else advanceChallenge(session, true);
    }
    expect(found).toBe(true);
  });

  it('準備・実tick途中・フェーズ境界をJSON再開して同じ続きを再現する', () => {
    const session = opened('ri298-2');
    expect(resumed(session).view()).toEqual(session.view());
    for (let i = 0; i < 65; i++) {
      advanceChallenge(session, true);
      if (i % 10 === 0) expect(resumed(session).save()).toBe(session.save());
    }
    const other = resumed(session);
    expect(finishChallenge(other, true)).toEqual(finishChallenge(session, true));
    expect(other.save()).toBe(session.save());
  });

  it('ruleset/入力/RNG/実測値の改ざんを拒否し、通常storageへ書き込まない', () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn() };
    vi.stubGlobal('localStorage', storage);
    try {
      const session = opened();
      advanceChallenge(session, true);
      advanceChallenge(session, true);
      const original = session.save();
      for (const modify of [
        (s: ReturnType<typeof JSON.parse>) => {
          s.code.ruleset.balanceVersion++;
        },
        (s: ReturnType<typeof JSON.parse>) => {
          s.checkpoint.rngState++;
        },
        (s: ReturnType<typeof JSON.parse>) => {
          s.checkpoint.stateHash = 'fake';
        },
        (s: ReturnType<typeof JSON.parse>) => {
          s.inputs.unshift({ type: 'playCard', deckIndex: 0 });
        },
        (s: ReturnType<typeof JSON.parse>) => {
          s.inputs.push({ type: 'begin' });
        },
      ]) {
        const changed = JSON.parse(original);
        modify(changed);
        expect(resumeChallenge(JSON.stringify(changed)).ok).toBe(false);
      }
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(session.save()).toBe(original);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
