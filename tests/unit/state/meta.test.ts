import { describe, expect, it, afterEach, vi } from 'vitest';
import { createGame } from '../../../src/game';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP } from '../../../src/sim/outcome';
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
  MAX_PREFERRED_CARDS,
  normalizeMeta,
  purchaseUnlock,
  sanitizePreferredCardIds,
  unlockedContent,
  utcDateStr,
  withPreferredCardIds,
  type MetaState,
  getDailyRecord,
  parseLegacyMeta,
  type RunRewardInput,
} from '../../../src/state/meta';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../../src/data/unlocks';

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

  it('ラン終了時の失敗診断を図鑑へ収集し、健全系は無視する（RI-34″）', () => {
    const loss = applyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 80,
      scoreMul: 1,
      maxCombo: 3,
      diagnosis: 'reviewHell',
    });
    expect(loss.collectedDiagnoses).toEqual(['reviewHell']);

    const healthy = applyRunReward(loss, {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 300,
      scoreMul: 1,
      maxCombo: 5,
      diagnosis: 'healthyAcceleration',
    });
    expect(healthy.collectedDiagnoses).toEqual(['reviewHell']);

    const again = applyRunReward(healthy, {
      won: false,
      difficulty: 'normal',
      score: 90,
      scoreMul: 1,
      maxCombo: 2,
      diagnosis: 'reviewHell',
    });
    expect(again.collectedDiagnoses).toEqual(['reviewHell']);

    const other = applyRunReward(again, {
      won: true,
      difficulty: 'normal',
      winType: 'chaos',
      bossId: 'big-release',
      score: 310,
      scoreMul: 1,
      maxCombo: 6,
      diagnosis: 'seniorSacrifice',
    });
    expect(other.collectedDiagnoses).toEqual(['reviewHell', 'seniorSacrifice']);
  });

  it('旧セーブに collectedDiagnoses が欠けていても空配列で補完される', () => {
    const raw = JSON.stringify({
      points: 10,
      unlockedDifficulties: ['easy', 'normal'],
      defeatedBosses: [],
      achievements: [],
      collectedWinTypes: [],
      bestScore: 0,
    });
    expect(parseLegacyMeta(raw)?.collectedDiagnoses).toEqual([]);
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

  it('JSON 化して読み戻すと往復する', () => {
    const meta = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      bossId: 'big-release',
      score: 150,
      scoreMul: 1,
      maxCombo: 3,
    });
    expect(parseLegacyMeta(JSON.stringify(meta))).toEqual(meta);
  });

  it('壊れた保存データは null を返す（呼び出し側で初期値へ倒す）', () => {
    expect(parseLegacyMeta('{not json')).toBeNull();
  });

  it('旧セーブに新フィールドが欠けていても既定値で補完される', () => {
    const raw = JSON.stringify({
      points: 42,
      unlockedDifficulties: ['easy', 'normal'],
      defeatedBosses: [],
      achievements: ['first-clear'],
      bestScore: 100,
    });
    const restored = parseLegacyMeta(raw);
    expect(restored).toEqual({
      ...defaultMeta(),
      points: 42,
      achievements: ['first-clear'],
      bestScore: 100,
    });
    expect(restored?.seenTutorial).toBe(false);
    expect(restored?.preferredCardIds).toEqual([]);
  });

  it('研修方針 preferredCardIds を正規化し、未解放・超過を落とす（RI-34⁗）', () => {
    expect(normalizeMeta({ preferredCardIds: ['copilot', 'docs'] }).preferredCardIds).toEqual([
      'copilot',
      'docs',
    ]);
    expect(
      sanitizePreferredCardIds(
        ['copilot', 'copilot', 'docs', 'auto-test'],
        unlockedContent(defaultMeta()).cards,
      ),
    ).toEqual(['copilot', 'docs']);
    expect(sanitizePreferredCardIds(['devin'], unlockedContent(defaultMeta()).cards)).toEqual([]);
    expect(MAX_PREFERRED_CARDS).toBe(2);

    const withLocked = normalizeMeta({
      preferredCardIds: ['devin', 'copilot', 'docs', 'auto-test'],
    });
    expect(withLocked.preferredCardIds).toEqual(['copilot', 'docs']);

    const meta = withPreferredCardIds(defaultMeta(), ['copilot', 'docs', 'auto-test']);
    expect(meta.preferredCardIds).toEqual(['copilot', 'docs']);
    expect(withPreferredCardIds(meta, ['copilot', 'docs'])).toBe(meta);

    const rewarded = applyRunReward(
      { ...meta, preferredCardIds: ['auto-test'] },
      {
        won: false,
        difficulty: 'normal',
        score: 10,
        scoreMul: 1,
        maxCombo: 0,
      },
    );
    expect(rewarded.preferredCardIds).toEqual(['auto-test']);
  });

  it('setPreferredCardIds は解放済みのみ永続化する（RI-34⁗）', async () => {
    let persisted: MetaState | null = null;
    const game = createGame({
      initialMeta: defaultMeta(),
      metaStorage: {
        load: async () => persisted,
        save: async (m) => {
          persisted = m;
        },
      },
    });
    game.setPreferredCardIds(['devin', 'copilot']);
    await Promise.resolve();
    expect(game.getMeta().preferredCardIds).toEqual(['copilot']);
    expect(persisted?.preferredCardIds).toEqual(['copilot']);
  });

  it('seenTutorial は報酬適用後も保持され、markTutorialSeen で永続化する（RI-60 / RI-67）', async () => {
    const rewarded = applyRunReward(
      { ...defaultMeta(), seenTutorial: true, seenTutorialVersion: 2 },
      {
        won: true,
        difficulty: 'normal',
        winType: 'normal',
        bossId: 'big-release',
        score: 200,
        scoreMul: 1,
        maxCombo: 4,
      },
    );
    expect(rewarded.seenTutorial).toBe(true);
    expect(rewarded.seenTutorialVersion).toBe(2);

    let persisted: MetaState | null = null;
    const game = createGame({
      seed: 'tutorial-mark',
      metaStorage: {
        load: async () => persisted,
        save: async (meta) => {
          persisted = meta;
        },
      },
    });
    expect(game.getMeta().seenTutorial).toBe(false);
    expect(game.getMeta().seenTutorialVersion).toBe(0);
    game.markTutorialSeen();
    expect(game.getMeta().seenTutorial).toBe(true);
    expect(game.getMeta().seenTutorialVersion).toBe(5);
    await Promise.resolve();
    expect(persisted?.seenTutorial).toBe(true);
    expect(persisted?.seenTutorialVersion).toBe(5);
  });

  it('旧 seenTutorial:true セーブは版1へ移行し、現行版未満として扱う（RI-67）', () => {
    expect(normalizeMeta({ seenTutorial: true })).toMatchObject({
      seenTutorial: true,
      seenTutorialVersion: 1,
    });
    expect(normalizeMeta({ seenTutorial: true, seenTutorialVersion: 2 })).toMatchObject({
      seenTutorial: true,
      seenTutorialVersion: 2,
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

  it('デイリー再走でも失敗診断を図鑑へ収集する（RI-34″）', () => {
    const dateStr = '2026-06-23';
    const first = applyDailyRunReward(defaultMeta(), {
      won: false,
      difficulty: 'normal',
      score: 70,
      scoreMul: 1,
      maxCombo: 1,
      diagnosis: 'reworkSpiral',
      dateStr,
    });
    expect(first.meta.collectedDiagnoses).toEqual(['reworkSpiral']);

    const rerun = applyDailyRunReward(first.meta, {
      won: false,
      difficulty: 'normal',
      score: 90,
      scoreMul: 1,
      maxCombo: 2,
      diagnosis: 'aiOverproduction',
      dateStr,
    });
    expect(rerun.rewardGranted).toBe(false);
    expect(rerun.meta.collectedDiagnoses).toEqual(['reworkSpiral', 'aiOverproduction']);
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
    const raw = JSON.stringify({
      points: 42,
      unlockedDifficulties: ['easy', 'normal'],
      defeatedBosses: [],
      achievements: ['first-clear'],
      bestScore: 100,
      unlockedCards: [],
      unlockedRelics: [],
    });
    expect(parseLegacyMeta(raw)?.dailyRuns).toEqual({});
  });

  it('旧セーブの unlockedPresets は読み捨てる（RI-25）', () => {
    const raw = JSON.stringify({
      points: 10,
      unlockedDifficulties: ['easy', 'normal'],
      defeatedBosses: [],
      achievements: [],
      bestScore: 0,
      unlockedCards: [],
      unlockedRelics: [],
      unlockedPresets: ['legacy-preset'],
    });
    const meta = parseLegacyMeta(raw);
    expect(meta?.points).toBe(10);
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

  it('RI-72-E7: 報酬内訳の mixed review と勝敗条件を exact に返す', () => {
    expect(
      computeRunRewardBreakdown({
        won: false,
        difficulty: 'normal',
        score: 100,
        scoreMul: 1,
        maxCombo: 4,
        quarterReviews: ['met', 'missed_adjustable'],
      }),
    ).toMatchObject({
      base: 5,
      learningBonus: 3,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 8,
    });

    expect(
      computeRunRewardBreakdown({
        won: false,
        difficulty: 'normal',
        score: 100,
        scoreMul: 1,
        maxCombo: 4,
        quarterReviews: ['met'],
      }),
    ).toMatchObject({
      learningBonus: 0,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 5,
    });

    expect(
      computeRunRewardBreakdown({
        won: true,
        difficulty: 'normal',
        score: 320,
        scoreMul: 1,
        maxCombo: 8,
        quarterReviews: ['met', 'exceeded'],
      }),
    ).toMatchObject({
      base: 20,
      learningBonus: 0,
      reviewBonus: 3,
      reviewBonusKind: 'exceeded',
      total: 23,
    });

    expect(
      computeRunRewardBreakdown({
        won: true,
        difficulty: 'normal',
        score: 320,
        scoreMul: 1,
        maxCombo: 8,
        quarterReviews: ['missed_adjustable'],
      }),
    ).toMatchObject({
      learningBonus: 0,
      reviewBonus: 0,
      reviewBonusKind: null,
      total: 20,
    });
  });

  it('RI-72-E7: 勝利報酬は実績・難易度・ボス条件を exact に反映する', () => {
    const noBoss = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      score: 200,
      scoreMul: 1,
      maxCombo: 19,
    });
    expect(noBoss.defeatedBosses).toEqual([]);
    expect(noBoss.achievements).toEqual(['first-clear']);
    expect(noBoss.collectedWinTypes).toEqual(['normal']);

    const comboBoundary = applyRunReward(defaultMeta(), {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 220,
      scoreMul: 1,
      maxCombo: 20,
    });
    expect(comboBoundary.achievements).toEqual(['first-clear', 'combo-master']);

    const hardClear = applyRunReward(
      { ...defaultMeta(), unlockedDifficulties: ['easy', 'normal', 'hard'] },
      {
        won: true,
        difficulty: 'hard',
        winType: 'normal',
        bossId: 'major-incident',
        score: 260,
        scoreMul: 1,
        maxCombo: 5,
      },
    );
    expect(hardClear.unlockedDifficulties).toEqual(['easy', 'normal', 'hard', 'nightmare']);
    expect(hardClear.achievements).toEqual(['first-clear']);

    const nightmareClear = applyRunReward(
      { ...defaultMeta(), unlockedDifficulties: ['easy', 'normal', 'hard', 'nightmare'] },
      {
        won: true,
        difficulty: 'nightmare',
        winType: 'normal',
        bossId: 'security-audit',
        score: 400,
        scoreMul: 1,
        maxCombo: 5,
      },
    );
    expect(nightmareClear.unlockedDifficulties).toEqual(['easy', 'normal', 'hard', 'nightmare']);
    expect(nightmareClear.achievements).toEqual(['first-clear', 'nightmare-clear']);
  });

  it('RI-72-E7: 勝利報酬は既存配列を保持し、全ボス実績を最後だけ付与する', () => {
    const base: MetaState = {
      ...defaultMeta(),
      unlockedDifficulties: ['easy', 'normal', 'hard'],
      defeatedBosses: ['big-release'],
      achievements: ['first-clear'],
      collectedWinTypes: ['healthy'],
      collectedDiagnoses: ['reviewHell'],
      unlockedCards: ['claude-code'],
      unlockedRelics: ['strong-ci'],
      dailyRuns: {
        '2026-07-01': { bestScore: 100, rewardClaimed: true },
      },
    };

    const loss = applyRunReward(base, {
      won: false,
      difficulty: 'normal',
      score: 80,
      scoreMul: 1,
      maxCombo: 3,
    });
    expect(loss.achievements).toEqual(['first-clear']);
    expect(loss.collectedWinTypes).toEqual(['healthy']);
    expect(loss.unlockedCards).toEqual(['claude-code']);
    expect(loss.unlockedRelics).toEqual(['strong-ci']);
    expect(loss.dailyRuns).toEqual(base.dailyRuns);

    const duplicateHard = applyRunReward(base, {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'major-incident',
      score: 300,
      scoreMul: 1,
      maxCombo: 5,
    });
    expect(duplicateHard.unlockedDifficulties).toEqual(['easy', 'normal', 'hard']);
    expect(duplicateHard.achievements).toEqual(['first-clear']);

    const partial = applyRunReward(
      { ...defaultMeta(), defeatedBosses: ['big-release'] },
      {
        won: true,
        difficulty: 'normal',
        winType: 'normal',
        bossId: 'major-incident',
        score: 300,
        scoreMul: 1,
        maxCombo: 5,
      },
    );
    expect(partial.defeatedBosses).toEqual(['big-release', 'major-incident']);
    expect(partial.achievements).toEqual(['first-clear']);

    const all = applyRunReward(
      {
        ...defaultMeta(),
        defeatedBosses: ['big-release', 'major-incident', 'security-audit'],
      },
      {
        won: true,
        difficulty: 'normal',
        winType: 'normal',
        bossId: 'exec-review',
        score: 300,
        scoreMul: 1,
        maxCombo: 5,
      },
    );
    expect(all.defeatedBosses).toEqual([
      'big-release',
      'major-incident',
      'security-audit',
      'exec-review',
    ]);
    expect(all.achievements).toEqual(['first-clear', 'all-bosses']);
  });

  it('RI-72-E7: preferred card 正規化と更新差分を exact に扱う', () => {
    expect(
      sanitizePreferredCardIds([123, undefined, '', 'copilot', 'copilot', 'docs', 'auto-test']),
    ).toEqual(['copilot', 'docs']);
    expect(sanitizePreferredCardIds(['copilot', 'docs'], undefined, 0)).toEqual([]);
    expect(sanitizePreferredCardIds(['copilot', 'docs'], undefined, 1)).toEqual(['copilot']);
    expect(normalizeMeta({ seenTutorial: true, soundMuted: false })).toMatchObject({
      seenTutorial: true,
      seenTutorialVersion: 1,
      soundMuted: false,
    });
    expect(normalizeMeta(['not-object'])).toEqual(defaultMeta());

    const meta = withPreferredCardIds(defaultMeta(), ['copilot', 'docs', 'auto-test']);
    expect(meta.preferredCardIds).toEqual(['copilot', 'docs']);

    const changed = withPreferredCardIds(meta, ['copilot', 'auto-test']);
    expect(changed).not.toBe(meta);
    expect(changed.preferredCardIds).toEqual(['copilot', 'auto-test']);

    const shortened = withPreferredCardIds(meta, ['copilot']);
    expect(shortened).not.toBe(meta);
    expect(shortened.preferredCardIds).toEqual(['copilot']);
  });

  it('RI-72-E7: purchaseUnlock は unknown・同額・relic 分岐を exact に返す', () => {
    expect(purchaseUnlock(defaultMeta(), 'unlock-missing')).toEqual({
      meta: defaultMeta(),
      ok: false,
      reason: 'unknown',
    });

    const exactCost = purchaseUnlock({ ...defaultMeta(), points: 25 }, 'unlock-claude-code');
    expect(exactCost.ok).toBe(true);
    expect(exactCost.meta.points).toBe(0);
    expect(exactCost.meta.unlockedCards).toEqual(['claude-code']);

    const card = purchaseUnlock(
      {
        ...defaultMeta(),
        points: 100,
        unlockedCards: ['review-bot'],
        unlockedRelics: ['strong-ci'],
      },
      'unlock-claude-code',
    );
    expect(card.ok).toBe(true);
    expect(card.meta.unlockedCards).toEqual(['review-bot', 'claude-code']);
    expect(card.meta.unlockedRelics).toEqual(['strong-ci']);

    const relicAgain = purchaseUnlock(
      { ...defaultMeta(), points: 100, unlockedRelics: ['psych-safety'] },
      'unlock-psych-safety',
    );
    expect(relicAgain.ok).toBe(false);
    expect(relicAgain.reason).toBe('already_owned');

    const relic = purchaseUnlock(
      {
        ...defaultMeta(),
        points: 100,
        unlockedCards: ['claude-code'],
        unlockedRelics: ['strong-ci'],
      },
      'unlock-psych-safety',
    );
    expect(relic.ok).toBe(true);
    expect(relic.meta.points).toBe(65);
    expect(relic.meta.unlockedCards).toEqual(['claude-code']);
    expect(relic.meta.unlockedRelics).toEqual(['strong-ci', 'psych-safety']);
  });
});

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
      // points > 0 でないと `rewarded.points - meta.points` → `+` 置換が生き残る
      const before: MetaState = { ...defaultMeta(), points: 10 };
      const result = applyDailyRunReward(before, {
        ...baseInput({ won: true, score: 200, maxCombo: 5, winType: 'normal' }),
        dateStr: '2026-08-01',
      });
      expect(result.rewardGranted).toBe(true);
      expect(result.pointsGained).toBe(result.breakdown.total);
      expect(result.pointsGained).toBe(result.meta.points - before.points);
      expect(result.meta.points).toBe(10 + result.breakdown.total);
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

    it('nextDifficulty: easy→normal、nightmare / 未知難易度で配列不変', () => {
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

      // indexOf が -1 のとき i >= 0 が効く（true / || 置換で 'easy' が誤解放される）
      const noEasy: MetaState = {
        ...defaultMeta(),
        unlockedDifficulties: ['normal'],
      };
      const unknown = applyRunReward(noEasy, {
        ...baseInput({
          won: true,
          difficulty: 'unknown' as RunRewardInput['difficulty'],
          score: 100,
          maxCombo: 3,
          winType: 'normal',
        }),
      });
      expect(unknown.unlockedDifficulties).toEqual(['normal']);
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
