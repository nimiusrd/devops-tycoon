import { describe, expect, it } from 'vitest';
import { createGame } from '../../src/game';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP } from '../../src/sim/outcome';
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_LABEL,
  WIN_TITLE_DEFS,
  applyDailyRunReward,
  applyRunReward,
  computeRunRewardBreakdown,
  dailyLeaderboardEntries,
  dailySeed,
  defaultMeta,
  loadMeta,
  purchaseUnlock,
  saveMeta,
  unlockedContent,
  utcDateStr,
  type LegacyMetaStorage,
} from '../../src/state/meta';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';

/** メモリ上のストレージ（localStorage 互換）。 */
function memStorage(): LegacyMetaStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('メタ進行とアンロック（第17章）', () => {
  it('初期状態では easy/normal だけ解放されている', () => {
    const meta = defaultMeta();
    expect(meta.unlockedDifficulties).toEqual(['easy', 'normal']);
    expect(meta.points).toBe(0);
  });

  it('勝利でメタ進行ポイント・次難易度・実績が増える', () => {
    const next = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
    });
    expect(next.points).toBeGreaterThan(0);
    expect(next.unlockedDifficulties).toContain('hard');
    expect(next.defeatedBosses).toContain('big-release');
    expect(next.achievements).toContain('first-clear');
    expect(next.bestScore).toBe(320);
  });

  it('ノーダメージ勝利・高コンボで対応する実績が付く', () => {
    const next = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'noDamage',
      bossId: 'exec-review',
      score: 200,
      scoreMul: 1.3,
      maxCombo: 21,
    });
    expect(next.achievements).toEqual(expect.arrayContaining(['no-damage', 'combo-master']));
  });

  it('勝利称号を重複なく永続コレクションへ記録する', () => {
    const first = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'healthy',
      bossId: 'big-release',
      score: 200,
      scoreMul: 1,
      maxCombo: 5,
    });
    const second = applyRunReward(first, {
      won: true,
      difficulty: 'hard',
      winType: 'healthy',
      bossId: 'exec-review',
      score: 300,
      scoreMul: 1,
      maxCombo: 5,
    });
    const third = applyRunReward(second, {
      won: true,
      difficulty: 'hard',
      winType: 'aiSuccess',
      bossId: 'major-incident',
      score: 350,
      scoreMul: 1,
      maxCombo: 5,
    });

    expect(third.collectedWinTypes).toEqual(['healthy', 'aiSuccess']);
  });

  it('敗北でも四半期修正経験で学習ボーナスが入る', () => {
    const base = applyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
    });
    const withReview = applyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
      quarterReviews: ['missed_adjustable'],
    });
    expect(withReview.points).toBeGreaterThan(base.points);
  });

  it('超過達成レビューで勝利ボーナスが入る', () => {
    const normal = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
      quarterReviews: ['met'],
    });
    const exceeded = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
      quarterReviews: ['exceeded'],
    });
    expect(exceeded.points).toBeGreaterThan(normal.points);
  });

  it('RI-28″: 勝利時のレビュー outcome で実績を付与する', () => {
    const exceeded = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
      quarterReviews: ['exceeded'],
    });
    expect(exceeded.achievements).toContain('review-exceeded');
    expect(exceeded.achievements).not.toContain('review-survivor');

    const survivor = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
      quarterReviews: ['missed_adjustable', 'met'],
    });
    expect(survivor.achievements).toContain('review-survivor');
    expect(survivor.achievements).not.toContain('review-exceeded');

    const loss = applyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
      quarterReviews: ['exceeded', 'missed_adjustable'],
    });
    expect(loss.achievements).not.toContain('review-exceeded');
    expect(loss.achievements).not.toContain('review-survivor');
  });

  it('RI-28′: computeRunRewardBreakdown が基本・学習・レビュー内訳を返す', () => {
    const lossBase = computeRunRewardBreakdown({
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
    });
    expect(lossBase).toEqual({
      base: 5,
      learningBonus: 0,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 5,
      granted: true,
    });

    const learning = computeRunRewardBreakdown({
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
      quarterReviews: ['missed_adjustable', 'missed_adjustable'],
    });
    expect(learning.base).toBe(5);
    expect(learning.learningBonus).toBe(4);
    expect(learning.reviewBonus).toBe(0);
    expect(learning.total).toBe(9);

    const met = computeRunRewardBreakdown({
      won: true,
      difficulty: 'normal',
      score: 320,
      scoreMul: 1,
      maxCombo: 8,
      quarterReviews: ['met'],
    });
    expect(met).toMatchObject({
      base: 20,
      learningBonus: 0,
      reviewBonus: 1,
      reviewBonusKind: 'met',
      total: 21,
      granted: true,
    });

    const exceeded = computeRunRewardBreakdown({
      won: true,
      difficulty: 'normal',
      score: 320,
      scoreMul: 2,
      maxCombo: 8,
      quarterReviews: ['exceeded'],
    });
    expect(exceeded).toMatchObject({
      base: 40,
      learningBonus: 0,
      reviewBonus: 3,
      reviewBonusKind: 'exceeded',
      total: 43,
      granted: true,
    });
  });

  it('敗北では難易度解放は進まないがポイントは少し入る', () => {
    const next = applyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 4,
    });
    expect(next.unlockedDifficulties).toEqual(['easy', 'normal']);
    expect(next.points).toBeGreaterThan(0);
  });

  it('保存して読み込むと往復する（差し替えストレージ）', () => {
    const storage = memStorage();
    const meta = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      bossId: 'big-release',
      score: 150,
      scoreMul: 1,
      maxCombo: 3,
    });
    saveMeta(meta, storage);
    expect(loadMeta(storage)).toEqual(meta);
  });

  it('壊れた保存データは初期値へフォールバックする', () => {
    const storage = memStorage();
    storage.data.set('devops-tycoon:meta:v1', '{not json');
    expect(loadMeta(storage)).toEqual(defaultMeta());
  });

  it('旧セーブに新フィールドが欠けていても既定値で補完される', () => {
    const storage = memStorage();
    storage.data.set(
      'devops-tycoon:meta:v1',
      JSON.stringify({
        points: 42,
        unlockedDifficulties: ['easy', 'normal'],
        defeatedBosses: [],
        achievements: ['first-clear'],
        bestScore: 100,
      }),
    );
    expect(loadMeta(storage)).toEqual({
      ...defaultMeta(),
      points: 42,
      achievements: ['first-clear'],
      bestScore: 100,
    });
  });

  it('デイリー記録をスコア順・同点時は新しい日付順の順位表にする', () => {
    const entries = dailyLeaderboardEntries({
      ...defaultMeta(),
      dailyRuns: {
        '2026-07-09': { bestScore: 800, rewardClaimed: true },
        '2026-07-10': { bestScore: 1200, rewardClaimed: true },
        '2026-07-11': { bestScore: 1200, rewardClaimed: false },
      },
    });

    expect(entries).toEqual([
      { dateStr: '2026-07-11', bestScore: 1200, rewardClaimed: false, rank: 1 },
      { dateStr: '2026-07-10', bestScore: 1200, rewardClaimed: true, rank: 2 },
      { dateStr: '2026-07-09', bestScore: 800, rewardClaimed: true, rank: 3 },
    ]);
  });

  it('デイリー記録がなければ空の順位表にする', () => {
    expect(dailyLeaderboardEntries(defaultMeta())).toEqual([]);
  });

  it('unlockedContent は既定解放 ∪ 購入済みを返す', () => {
    const meta = { ...defaultMeta(), unlockedCards: ['devin'], unlockedRelics: ['strong-ci'] };
    const content = unlockedContent(meta);
    expect(content.cards.has('devin')).toBe(true);
    expect(content.cards.has('copilot')).toBe(true);
    expect(content.cards.has('claude-code')).toBe(false);
    expect(content.relics.has('strong-ci')).toBe(true);
    expect(content.relics.has('postmortem')).toBe(true);
    expect(content.relics.has('psych-safety')).toBe(false);
  });

  it('purchaseUnlock は残高不足・二重購入・成功を判定する', () => {
    const poor = purchaseUnlock({ ...defaultMeta(), points: 10 }, 'unlock-claude-code');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe('insufficient_points');

    const rich = purchaseUnlock({ ...defaultMeta(), points: 100 }, 'unlock-claude-code');
    expect(rich.ok).toBe(true);
    expect(rich.meta.points).toBe(75);
    expect(rich.meta.unlockedCards).toContain('claude-code');

    const again = purchaseUnlock(rich.meta, 'unlock-claude-code');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_owned');
  });

  it('RI-28″: purchaseUnlock は前提実績未達を拒否する', () => {
    const locked = purchaseUnlock({ ...defaultMeta(), points: 100 }, 'unlock-devin');
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe('requires');

    const unlocked = purchaseUnlock(
      { ...defaultMeta(), points: 100, achievements: ['review-exceeded'] },
      'unlock-devin',
    );
    expect(unlocked.ok).toBe(true);
    expect(unlocked.meta.unlockedCards).toContain('devin');

    const hireLocked = purchaseUnlock({ ...defaultMeta(), points: 100 }, 'unlock-hire-senior');
    expect(hireLocked.ok).toBe(false);
    expect(hireLocked.reason).toBe('requires');

    const hireOk = purchaseUnlock(
      { ...defaultMeta(), points: 100, achievements: ['review-survivor'] },
      'unlock-hire-senior',
    );
    expect(hireOk.ok).toBe(true);
    expect(hireOk.meta.unlockedCards).toContain('hire-senior');
  });

  it('unlockedContent の既定プールはメタロック対象を含まない', () => {
    const cards = defaultUnlockedCardIds();
    const relics = defaultUnlockedRelicIds();
    expect(cards.has('devin')).toBe(false);
    expect(cards.has('ai-guideline')).toBe(true);
    expect(relics.has('psych-safety')).toBe(false);
    expect(relics.has('postmortem')).toBe(true);
  });

  it('ACHIEVEMENT_DEFS は applyRunReward が付与する実績 ID を網羅する', () => {
    const definedIds = new Set(ACHIEVEMENT_DEFS.map((a) => a.id));
    const earnable = new Set<string>();

    earnable.add('first-clear');

    const noDamage = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'noDamage',
      bossId: 'big-release',
      score: 200,
      scoreMul: 1,
      maxCombo: 5,
    });
    for (const id of noDamage.achievements) earnable.add(id);

    const combo = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'exec-review',
      score: 200,
      scoreMul: 1,
      maxCombo: 21,
    });
    for (const id of combo.achievements) earnable.add(id);

    const nightmare = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'nightmare',
      winType: 'normal',
      bossId: 'big-release',
      score: 400,
      scoreMul: 1,
      maxCombo: 3,
    });
    for (const id of nightmare.achievements) earnable.add(id);

    const allBossesMeta = {
      ...defaultMeta(),
      defeatedBosses: ['big-release', 'major-incident', 'security-audit'],
    };
    const allBosses = applyRunReward(allBossesMeta, {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'exec-review',
      score: 300,
      scoreMul: 1,
      maxCombo: 3,
    });
    for (const id of allBosses.achievements) earnable.add(id);

    const reviewExceeded = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 300,
      scoreMul: 1,
      maxCombo: 3,
      quarterReviews: ['exceeded'],
    });
    for (const id of reviewExceeded.achievements) earnable.add(id);

    const reviewSurvivor = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 300,
      scoreMul: 1,
      maxCombo: 3,
      quarterReviews: ['missed_adjustable', 'met'],
    });
    for (const id of reviewSurvivor.achievements) earnable.add(id);

    for (const id of earnable) {
      expect(definedIds.has(id)).toBe(true);
    }
    expect(definedIds.size).toBe(earnable.size);
  });

  it('ACHIEVEMENT_LABEL は ACHIEVEMENT_DEFS から派生する', () => {
    for (const def of ACHIEVEMENT_DEFS) {
      expect(ACHIEVEMENT_LABEL[def.id]).toBe(def.label);
    }
  });

  it('WIN_TITLE_DEFS はすべての WinType を表示・ヒント付きで定義する', () => {
    expect(WIN_TITLE_DEFS.map((title) => title.id)).toEqual([
      'normal',
      'healthy',
      'aiSuccess',
      'management',
      'happiness',
      'chaos',
      'noDamage',
    ]);
    for (const title of WIN_TITLE_DEFS) {
      expect(title.label).not.toBe('');
      expect(title.description).not.toBe('');
      expect(title.hint).not.toBe('');
    }
  });

  it('dailySeed は同一日付で決定論的', () => {
    expect(dailySeed('2026-06-20')).toBe('daily-2026-06-20');
    expect(dailySeed('2026-06-20')).toBe(dailySeed('2026-06-20'));
    expect(dailySeed('2026-06-21')).not.toBe(dailySeed('2026-06-20'));
  });

  it('utcDateStr は UTC の YYYY-MM-DD を返す', () => {
    expect(utcDateStr(new Date('2026-06-20T15:30:00.000Z'))).toBe('2026-06-20');
  });

  it('applyDailyRunReward は初回のみ points を付与する', () => {
    const dateStr = '2026-06-20';
    const base = defaultMeta();
    const first = applyDailyRunReward(base, {
      won: false,
      difficulty: 'normal',
      score: 120,
      scoreMul: 1,
      maxCombo: 3,
      dateStr,
    });
    expect(first.rewardGranted).toBe(true);
    expect(first.pointsGained).toBeGreaterThan(0);
    expect(first.breakdown.granted).toBe(true);
    expect(first.breakdown.total).toBe(first.pointsGained);
    expect(first.meta.dailyRuns[dateStr]?.rewardClaimed).toBe(true);
    expect(first.meta.dailyRuns[dateStr]?.bestScore).toBe(120);

    const second = applyDailyRunReward(first.meta, {
      won: true,
      difficulty: 'normal',
      winType: 'healthy',
      score: 200,
      scoreMul: 1,
      maxCombo: 10,
      dateStr,
    });
    expect(second.rewardGranted).toBe(false);
    expect(second.pointsGained).toBe(0);
    expect(second.breakdown).toEqual({
      base: 0,
      learningBonus: 0,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 0,
      granted: false,
    });
    expect(second.meta.points).toBe(first.meta.points);
    expect(second.meta.dailyRuns[dateStr]?.bestScore).toBe(200);
    expect(second.dailyBestUpdated).toBe(true);
    expect(second.meta.collectedWinTypes).toEqual(['healthy']);
  });

  it('デイリー再走の勝利でも points なしで称号だけ収集する', () => {
    const dateStr = '2026-06-22';
    const afterLoss = applyDailyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 80,
      scoreMul: 1,
      maxCombo: 2,
      dateStr,
    });
    expect(afterLoss.meta.collectedWinTypes).toEqual([]);

    const afterWin = applyDailyRunReward(afterLoss.meta, {
      won: true,
      difficulty: 'normal',
      winType: 'aiSuccess',
      score: 240,
      scoreMul: 1,
      maxCombo: 8,
      dateStr,
    });
    expect(afterWin.rewardGranted).toBe(false);
    expect(afterWin.pointsGained).toBe(0);
    expect(afterWin.meta.points).toBe(afterLoss.meta.points);
    expect(afterWin.meta.collectedWinTypes).toEqual(['aiSuccess']);
  });

  it('applyDailyRunReward の再走はベスト未更新時も points を付与しない', () => {
    const dateStr = '2026-06-21';
    const afterFirst = applyDailyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 150,
      scoreMul: 1,
      maxCombo: 2,
      dateStr,
    });
    const rerun = applyDailyRunReward(afterFirst.meta, {
      won: false,
      difficulty: 'normal',
      score: 100,
      scoreMul: 1,
      maxCombo: 1,
      dateStr,
    });
    expect(rerun.pointsGained).toBe(0);
    expect(rerun.dailyBestUpdated).toBe(false);
    expect(rerun.meta.dailyRuns[dateStr]?.bestScore).toBe(150);
  });

  it('旧セーブに dailyRuns が欠けていても既定値で補完される', () => {
    const storage = memStorage();
    storage.data.set(
      'devops-tycoon:meta:v1',
      JSON.stringify({
        points: 42,
        unlockedDifficulties: ['easy', 'normal'],
        defeatedBosses: [],
        achievements: ['first-clear'],
        bestScore: 100,
        unlockedCards: [],
        unlockedRelics: [],
      }),
    );
    expect(loadMeta(storage).dailyRuns).toEqual({});
  });

  it('旧セーブの unlockedPresets は読み捨てる（RI-25）', () => {
    const storage = memStorage();
    storage.data.set(
      'devops-tycoon:meta:v1',
      JSON.stringify({
        points: 10,
        unlockedDifficulties: ['easy', 'normal'],
        defeatedBosses: [],
        achievements: [],
        bestScore: 0,
        unlockedCards: [],
        unlockedRelics: [],
        unlockedPresets: ['legacy-preset'],
      }),
    );
    const meta = loadMeta(storage);
    expect(meta.points).toBe(10);
    expect(meta).not.toHaveProperty('unlockedPresets');
  });

  it('RI-32: カード発動の即時敗北でもメタ報酬を記録する', () => {
    const game = createGame({ seed: 'ri32-meta-card-lose', difficulty: 'nightmare' });
    game.startRun('nightmare');
    const before = game.getMeta().points;

    const internals = game.engine as unknown as {
      phase: string;
      draft: string[] | null;
      shop: { cards: Array<{ defId: string; cost: number; bought: boolean }> } | null;
      org: { aiDependency: number; aiLiteracy: number };
      budget: number;
    };
    internals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    internals.phase = 'draft';
    internals.draft = ['copilot'];

    game.chooseCard('copilot');
    expect(game.getState().status).toBe('playing');

    internals.phase = 'setup';
    game.beginSetupSprint();
    const sprintState = game.getState();
    const handDeckIndex = sprintState.sprint!.cardPiles.hand.find(
      (idx) => sprintState.deck[idx]?.defId === 'copilot',
    );
    expect(handDeckIndex).toBeDefined();
    game.playCard(handDeckIndex!);
    const state = game.getState();
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('aiDependency');
    expect(game.getMeta().points).toBeGreaterThan(before);
    const lastReward = game.getLastRunReward();
    expect(lastReward).not.toBeNull();
    expect(lastReward!.granted).toBe(true);
    expect(lastReward!.total).toBe(game.getMeta().points - before);

    const shopGame = createGame({ seed: 'ri32-meta-shop-lose', difficulty: 'nightmare' });
    shopGame.startRun('nightmare');
    const shopBefore = shopGame.getMeta().points;
    const shopInternals = shopGame.engine as unknown as typeof internals;
    shopInternals.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    shopInternals.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    shopInternals.budget = 100;
    shopInternals.phase = 'shop';
    shopInternals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };

    const shopState = shopGame.buyShopCard('copilot');
    // 購入だけでは未発動。メタ報酬も増えない。
    expect(shopState.status).toBe('playing');
    expect(shopGame.getMeta().points).toBe(shopBefore);
  });

  it('RI-32: レリック購入の予算枯渇でもメタ報酬を記録する', () => {
    const game = createGame({ seed: 'ri32-meta-relic-lose', difficulty: 'nightmare' });
    game.startRun('nightmare');
    const before = game.getMeta().points;
    const internals = game.engine as unknown as {
      phase: string;
      budget: number;
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic: { id: string; cost: number; bought: boolean };
      } | null;
    };
    internals.phase = 'shop';
    internals.budget = 30;
    internals.shop = {
      cards: [],
      relic: { id: 'postmortem', cost: 30, bought: false },
    };

    const state = game.buyShopRelic();
    expect(state.status).toBe('lost');
    expect(state.loseReason).toBe('budgetExhausted');
    expect(game.getMeta().points).toBeGreaterThan(before);
  });
});
