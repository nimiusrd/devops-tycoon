/**
 * RI-91-B5: src/state/meta.ts の Survived / NoCoverage mutation を潰す。
 * 共有の meta.test.ts は触らず、単位専用ファイルで exact 断言する。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyDailyRunReward,
  applyRunReward,
  browserStorage,
  computeRunRewardBreakdown,
  defaultMeta,
  getDailyRecord,
  loadMeta,
  normalizeMeta,
  parseLegacyMeta,
  saveMeta,
  type LegacyMetaStorage,
  type MetaState,
  type RunRewardInput,
} from '../../src/state/meta';

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseInput = (overrides: Partial<RunRewardInput> = {}): RunRewardInput => ({
  won: false,
  difficulty: 'normal',
  score: 100,
  scoreMul: 1,
  maxCombo: 4,
  ...overrides,
});

describe('RI-91-B5 meta survived mutants', () => {
  describe('computeRunRewardBreakdown 加算項の1フラグ差分', () => {
    it('敗北・reviews なしは base のみ', () => {
      expect(computeRunRewardBreakdown(baseInput())).toEqual({
        base: 5,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 5,
        granted: true,
      });
    });

    it('+learning のみ（missed_adjustable×1）', () => {
      expect(
        computeRunRewardBreakdown(baseInput({ quarterReviews: ['missed_adjustable'] })),
      ).toEqual({
        base: 5,
        learningBonus: 3,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 8,
        granted: true,
      });
    });

    it('learningBonus は Math.min(5, …) で頭打ち', () => {
      expect(
        computeRunRewardBreakdown(
          baseInput({
            quarterReviews: ['missed_adjustable', 'missed_adjustable', 'missed_adjustable'],
          }),
        ),
      ).toEqual({
        base: 5,
        learningBonus: 5,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 10,
        granted: true,
      });
      expect(
        computeRunRewardBreakdown(
          baseInput({
            quarterReviews: [
              'missed_adjustable',
              'missed_adjustable',
              'missed_adjustable',
              'missed_adjustable',
            ],
          }),
        ).learningBonus,
      ).toBe(5);
    });

    it('+met のみ', () => {
      expect(
        computeRunRewardBreakdown(
          baseInput({
            won: true,
            score: 320,
            maxCombo: 8,
            quarterReviews: ['met'],
          }),
        ),
      ).toEqual({
        base: 20,
        learningBonus: 0,
        reviewBonus: 1,
        reviewBonusKind: 'met',
        total: 21,
        granted: true,
      });
    });

    it('+exceeded のみ', () => {
      expect(
        computeRunRewardBreakdown(
          baseInput({
            won: true,
            score: 320,
            maxCombo: 8,
            quarterReviews: ['exceeded'],
          }),
        ),
      ).toEqual({
        base: 20,
        learningBonus: 0,
        reviewBonus: 3,
        reviewBonusKind: 'exceeded',
        total: 23,
        granted: true,
      });
    });

    it('勝利・ボーナスなしは base 20 のみ', () => {
      expect(
        computeRunRewardBreakdown(
          baseInput({ won: true, score: 320, maxCombo: 8, quarterReviews: [] }),
        ),
      ).toEqual({
        base: 20,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 20,
        granted: true,
      });
    });

    it('quarterReviews 省略と [] は同一結果（?? [] 殺し）', () => {
      const omitted = computeRunRewardBreakdown(baseInput({ won: true, score: 320, maxCombo: 8 }));
      const empty = computeRunRewardBreakdown(
        baseInput({ won: true, score: 320, maxCombo: 8, quarterReviews: [] }),
      );
      expect(omitted).toEqual(empty);
      expect(omitted).toEqual({
        base: 20,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 20,
        granted: true,
      });
    });

    it('scoreMul < 1 は Math.max(1, …) で床になり base は据え置き', () => {
      expect(computeRunRewardBreakdown(baseInput({ scoreMul: 0.5 }))).toEqual({
        base: 5,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 5,
        granted: true,
      });
      expect(
        computeRunRewardBreakdown(baseInput({ won: true, score: 320, maxCombo: 8, scoreMul: 0.5 })),
      ).toEqual({
        base: 20,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 20,
        granted: true,
      });
    });

    it('勝利 scoreMul:2・reviews なしは base 倍率のみ', () => {
      expect(
        computeRunRewardBreakdown(baseInput({ won: true, score: 320, maxCombo: 8, scoreMul: 2 })),
      ).toEqual({
        base: 40,
        learningBonus: 0,
        reviewBonus: 0,
        reviewBonusKind: null,
        total: 40,
        granted: true,
      });
    });
  });

  describe('parseLegacyMeta 失敗枝', () => {
    it.each([
      ['null', 'null'],
      ['number', '42'],
      ['string', '"str"'],
      ['array', '[]'],
      ['boolean', 'true'],
    ] as const)('%s は null', (_label, raw) => {
      expect(parseLegacyMeta(raw)).toBeNull();
    });

    it('壊れた JSON は catch で null', () => {
      expect(parseLegacyMeta('{not json')).toBeNull();
      expect(parseLegacyMeta('')).toBeNull();
    });

    it('正常オブジェクトは normalizeMeta 相当', () => {
      const raw = JSON.stringify({ points: 17, unlockedDifficulties: ['easy'] });
      expect(parseLegacyMeta(raw)).toEqual(
        normalizeMeta({ points: 17, unlockedDifficulties: ['easy'] }),
      );
    });
  });

  describe('browserStorage / loadMeta / saveMeta NoCoverage', () => {
    it('window.localStorage ありなら同一参照を返す', () => {
      const fake: LegacyMetaStorage = {
        getItem: () => null,
        setItem: () => undefined,
      };
      vi.stubGlobal('window', { localStorage: fake });
      expect(browserStorage()).toBe(fake);
    });

    it('localStorage 欠落・falsy なら null', () => {
      vi.stubGlobal('window', {});
      expect(browserStorage()).toBeNull();
      vi.stubGlobal('window', { localStorage: null });
      expect(browserStorage()).toBeNull();
      vi.stubGlobal('window', { localStorage: undefined });
      expect(browserStorage()).toBeNull();
    });

    it('localStorage getter が throw したら catch で null', () => {
      vi.stubGlobal('window', {
        get localStorage(): LegacyMetaStorage {
          throw new Error('SecurityError');
        },
      });
      expect(browserStorage()).toBeNull();
    });

    it('loadMeta(null) は defaultMeta を返す', () => {
      expect(loadMeta(null)).toEqual({
        points: 0,
        unlockedDifficulties: ['easy', 'normal'],
        defeatedBosses: [],
        achievements: [],
        collectedWinTypes: [],
        collectedDiagnoses: [],
        bestScore: 0,
        unlockedCards: [],
        unlockedRelics: [],
        preferredCardIds: [],
        dailyRuns: {},
        soundMuted: true,
        seenTutorial: false,
      });
    });

    it('saveMeta(_, null) は throw しない', () => {
      expect(() => saveMeta(defaultMeta(), null)).not.toThrow();
    });

    it('storage getItem が throw したら defaultMeta', () => {
      const storage: LegacyMetaStorage = {
        getItem: () => {
          throw new Error('quota');
        },
        setItem: () => undefined,
      };
      expect(loadMeta(storage)).toEqual(defaultMeta());
    });

    it('saveMeta の setItem throw は握りつぶす', () => {
      const storage: LegacyMetaStorage = {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
      };
      expect(() => saveMeta(defaultMeta(), storage)).not.toThrow();
    });
  });

  describe('getDailyRecord', () => {
    it('hit / miss を返す', () => {
      const meta: MetaState = {
        ...defaultMeta(),
        dailyRuns: {
          '2026-08-01': { bestScore: 420, rewardClaimed: true },
        },
      };
      expect(getDailyRecord(meta, '2026-08-01')).toEqual({
        bestScore: 420,
        rewardClaimed: true,
      });
      expect(getDailyRecord(meta, '2026-08-02')).toBeUndefined();
    });
  });

  describe('applyDailyRunReward / nextDifficulty 周辺 Survived', () => {
    it('初回デイリーは pointsGained === breakdown.total で差分と一致', () => {
      const before = defaultMeta();
      const result = applyDailyRunReward(before, {
        ...baseInput({ won: true, score: 200, maxCombo: 5, winType: 'normal' }),
        dateStr: '2026-08-01',
      });
      expect(result.rewardGranted).toBe(true);
      expect(result.pointsGained).toBe(result.breakdown.total);
      expect(result.meta.points - before.points).toBe(result.pointsGained);
      expect(result.dailyBestUpdated).toBe(true);
    });

    it('dailyBestUpdated は同点で false、+1 で true（初回）', () => {
      const withPrior: MetaState = {
        ...defaultMeta(),
        dailyRuns: {
          '2026-08-01': { bestScore: 200, rewardClaimed: false },
        },
      };
      const tie = applyDailyRunReward(withPrior, {
        ...baseInput({ won: false, score: 200 }),
        dateStr: '2026-08-01',
      });
      expect(tie.dailyBestUpdated).toBe(false);
      expect(tie.meta.dailyRuns['2026-08-01']?.bestScore).toBe(200);

      const bump = applyDailyRunReward(withPrior, {
        ...baseInput({ won: false, score: 201 }),
        dateStr: '2026-08-01',
      });
      expect(bump.dailyBestUpdated).toBe(true);
      expect(bump.meta.dailyRuns['2026-08-01']?.bestScore).toBe(201);
    });

    it('再走で同点は dailyBestUpdated false、+1 は true', () => {
      const claimed: MetaState = {
        ...defaultMeta(),
        bestScore: 300,
        dailyRuns: {
          '2026-08-01': { bestScore: 250, rewardClaimed: true },
        },
      };
      const tie = applyDailyRunReward(claimed, {
        ...baseInput({ won: false, score: 250 }),
        dateStr: '2026-08-01',
      });
      expect(tie.rewardGranted).toBe(false);
      expect(tie.pointsGained).toBe(0);
      expect(tie.dailyBestUpdated).toBe(false);

      const bump = applyDailyRunReward(claimed, {
        ...baseInput({ won: false, score: 251 }),
        dateStr: '2026-08-01',
      });
      expect(bump.dailyBestUpdated).toBe(true);
      expect(bump.meta.dailyRuns['2026-08-01']?.bestScore).toBe(251);
    });

    it('再走で勝利だが winType なしなら称号配列は不変', () => {
      const claimed: MetaState = {
        ...defaultMeta(),
        collectedWinTypes: ['normal'],
        dailyRuns: {
          '2026-08-01': { bestScore: 100, rewardClaimed: true },
        },
      };
      const result = applyDailyRunReward(claimed, {
        ...baseInput({ won: true, score: 150, maxCombo: 5 }),
        dateStr: '2026-08-01',
      });
      expect(result.meta.collectedWinTypes).toEqual(['normal']);
      expect(result.meta.collectedWinTypes).not.toBe(claimed.collectedWinTypes);
    });

    it('再走で meta.bestScore は下がらない（Math.max）', () => {
      const claimed: MetaState = {
        ...defaultMeta(),
        bestScore: 500,
        dailyRuns: {
          '2026-08-01': { bestScore: 400, rewardClaimed: true },
        },
      };
      const result = applyDailyRunReward(claimed, {
        ...baseInput({ won: false, score: 50 }),
        dateStr: '2026-08-01',
      });
      expect(result.meta.bestScore).toBe(500);
      expect(result.meta.dailyRuns['2026-08-01']?.bestScore).toBe(400);
    });

    it('nextDifficulty: easy→normal、nightmare で難易度配列不変', () => {
      const fromEasy = applyRunReward(defaultMeta(), {
        ...baseInput({ won: true, difficulty: 'easy', score: 100, maxCombo: 3, winType: 'normal' }),
      });
      // default は既に normal 解放済みなので配列は変化なし（includes で弾く）
      expect(fromEasy.unlockedDifficulties).toEqual(['easy', 'normal']);

      const onlyEasy: MetaState = {
        ...defaultMeta(),
        unlockedDifficulties: ['easy'],
      };
      const unlockNormal = applyRunReward(onlyEasy, {
        ...baseInput({ won: true, difficulty: 'easy', score: 100, maxCombo: 3, winType: 'normal' }),
      });
      expect(unlockNormal.unlockedDifficulties).toEqual(['easy', 'normal']);

      const nightmare: MetaState = {
        ...defaultMeta(),
        unlockedDifficulties: ['easy', 'normal', 'hard', 'nightmare'],
      };
      const stay = applyRunReward(nightmare, {
        ...baseInput({
          won: true,
          difficulty: 'nightmare',
          score: 100,
          maxCombo: 3,
          winType: 'normal',
        }),
      });
      expect(stay.unlockedDifficulties).toEqual(['easy', 'normal', 'hard', 'nightmare']);
    });

    it('defaultMeta の空配列フィールドはリテラル [] と一致', () => {
      const meta = defaultMeta();
      expect(meta.defeatedBosses).toEqual([]);
      expect(meta.achievements).toEqual([]);
      expect(meta.collectedWinTypes).toEqual([]);
      expect(meta.collectedDiagnoses).toEqual([]);
      expect(meta.unlockedCards).toEqual([]);
      expect(meta.unlockedRelics).toEqual([]);
      expect(meta.preferredCardIds).toEqual([]);
    });
  });
});
