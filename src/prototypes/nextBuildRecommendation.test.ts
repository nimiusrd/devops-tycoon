import { beforeAll, describe, expect, it } from 'vitest';
import { advance } from '../../tests/unit/helpers/runFlow';
import { getCardUnlockByContentId } from '../data/unlocks';
import { RunEngine } from '../sim/run/engine';
import { defaultMeta, purchaseUnlock } from '../state/meta';
import { REPLAY_SCHEMA_VERSION, snapshotReplayContent, type ReplayBlob } from '../state/replay';
import { CURRENT_RUN_RULESET } from '../state/runPersistence';
import { summarizeBuild } from './buildHistory';
import { recommendNextBuild } from './nextBuildRecommendation';

const QUALITY = ['auto-test', 'static-analysis'];
const REVIEW = ['pr-size-limit', 'review-bot'];
const CARDS = new Set([...QUALITY, ...REVIEW]);

/** 同じ初期条件で、指定したカードを最初に候補へ出た時だけ実ドラフトで取得する。 */
function recordReplay(id: string, wanted: readonly string[]): ReplayBlob {
  const seed = 'g1';
  const engine = new RunEngine({ seed, difficulty: 'normal', allowedCards: CARDS });
  engine.startRun();
  const start = engine.exportReplayFrame();
  const remaining = new Set(wanted);

  for (let guard = 0; engine.snapshot().status === 'playing' && guard < 1000; guard += 1) {
    const state = engine.snapshot();
    if (state.phase === 'draft') {
      const pick = state.draft?.find((cardId) => remaining.has(cardId));
      if (pick) {
        engine.chooseCard(pick);
        remaining.delete(pick);
      } else {
        engine.skipDraft();
      }
    } else if (!advance(engine)) {
      throw new Error('固定方針の進行が止まりました');
    }
  }
  const end = engine.exportReplayFrame();
  const final = engine.snapshot();
  if (!start || !end || final.status === 'playing' || remaining.size > 0) {
    throw new Error(`取得・決着の条件を満たしていません: ${id}`);
  }
  const keyframes = [
    { phase: start.phase, frame: start },
    { phase: end.phase, frame: end },
  ];
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id,
    seed,
    difficulty: 'normal',
    trials: [],
    finishedAt: 1000,
    outcome: {
      status: final.status,
      winType: final.winType,
      loseReason: final.loseReason,
      diagnosis: final.diagnosis,
      score: final.totals.delivered,
    },
    keyframes,
    ruleset: { ...CURRENT_RUN_RULESET },
    contentSnapshot: snapshotReplayContent(keyframes),
  };
}

let quality: ReplayBlob;
let review: ReplayBlob;

beforeAll(() => {
  quality = recordReplay('quality', QUALITY);
  review = recordReplay('review', REVIEW);
});

describe('RI-296 次に試す運営方針', () => {
  it('履歴なし、別ランで1枚ずつ取得、解放と研修方針のみの記録は一般候補になる', () => {
    const meta = {
      ...defaultMeta(),
      unlockedCards: ['review-bot'],
      preferredCardIds: [...REVIEW],
    };
    const separateRuns = [
      recordReplay('test-only', ['auto-test']),
      recordReplay('analysis-only', ['static-analysis']),
    ];
    const general = recommendNextBuild([], meta);
    expect(general).toMatchObject({
      template: { id: 'quality-investment', cardIds: QUALITY },
      basis: { kind: 'general' },
      unlocks: [],
    });
    expect(recommendNextBuild(separateRuns, meta)).toEqual(general);
  });

  it('同じ決着デッキの取得実績から別の1案と現行メタで必要な取得条件を返す', () => {
    expect(summarizeBuild(quality)?.cards.map((card) => card.defId)).toEqual(QUALITY);
    const unlock = getCardUnlockByContentId('review-bot')!;
    const meta = { ...defaultMeta(), points: unlock.cost };
    expect(recommendNextBuild([quality], meta)).toMatchObject({
      template: { id: 'small-pr-review', cardIds: REVIEW },
      basis: {
        kind: 'recorded-alternative',
        recordedCardIds: QUALITY,
        replayIds: [quality.id],
      },
      unlocks: [unlock],
    });
    const purchase = purchaseUnlock(meta, unlock.id);
    expect(purchase.ok).toBe(true);
    expect(recommendNextBuild([quality], purchase.meta)?.unlocks).toEqual([]);
  });

  it('履歴に応じて提案先が反転し、両方の組み合わせが揃ったら提案しない', () => {
    expect(summarizeBuild(review)?.cards.map((card) => card.defId)).toEqual(REVIEW);
    expect(recommendNextBuild([review], defaultMeta())).toMatchObject({
      template: { id: 'quality-investment', cardIds: QUALITY },
      basis: {
        kind: 'recorded-alternative',
        recordedCardIds: REVIEW,
        replayIds: [review.id],
      },
      unlocks: [],
    });
    expect(recommendNextBuild([review, quality], defaultMeta())).toBeNull();
  });

  it('旧版、異なる指紋、決着なし、不一致の結果を取得実績に数えない', () => {
    const meta = defaultMeta();
    const legacy = { ...quality, ruleset: null, contentSnapshot: null };
    const mismatch = {
      ...quality,
      ruleset: { ...CURRENT_RUN_RULESET, fingerprint: 'other-fingerprint' },
    };
    const incomplete = { ...quality, keyframes: quality.keyframes.slice(0, 1) };
    const falseOutcome: ReplayBlob = {
      ...quality,
      outcome: {
        ...quality.outcome,
        status: quality.outcome.status === 'won' ? 'lost' : 'won',
      },
    };
    expect(recommendNextBuild([legacy, mismatch, incomplete, falseOutcome], meta)).toEqual(
      recommendNextBuild([], meta),
    );
  });

  it('入力順と重複で提案が変わらず、メタや元の記録を更新しない', () => {
    const another = { ...quality, id: 'another-quality' };
    const records = [quality, another, quality];
    const meta = defaultMeta();
    const originalRecords = structuredClone(records);
    const originalMeta = structuredClone(meta);
    const proposed = recommendNextBuild(records, meta);
    expect(proposed?.basis).toMatchObject({ replayIds: [another.id, quality.id] });
    expect(recommendNextBuild([another, quality], meta)).toEqual(proposed);
    expect(meta).toEqual(originalMeta);
    expect(records).toEqual(originalRecords);
  });
});
