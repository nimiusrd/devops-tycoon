import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_DEFS,
  ACHIEVEMENT_LABEL,
  applyDailyRunReward,
  applyRunReward,
  dailySeed,
  defaultMeta,
  loadMeta,
  purchaseUnlock,
  saveMeta,
  unlockedContent,
  utcDateStr,
  type MetaStorage,
} from '../../src/state/meta';
import { defaultUnlockedCardIds, defaultUnlockedRelicIds } from '../../src/data/unlocks';

/** メモリ上のストレージ（localStorage 互換）。 */
function memStorage(): MetaStorage & { data: Map<string, string> } {
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
    const poor = purchaseUnlock({ ...defaultMeta(), points: 10 }, 'unlock-devin');
    expect(poor.ok).toBe(false);
    expect(poor.reason).toBe('insufficient_points');

    const rich = purchaseUnlock({ ...defaultMeta(), points: 100 }, 'unlock-devin');
    expect(rich.ok).toBe(true);
    expect(rich.meta.points).toBe(50);
    expect(rich.meta.unlockedCards).toContain('devin');

    const again = purchaseUnlock(rich.meta, 'unlock-devin');
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('already_owned');
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
    expect(first.meta.dailyRuns[dateStr]?.rewardClaimed).toBe(true);
    expect(first.meta.dailyRuns[dateStr]?.bestScore).toBe(120);

    const second = applyDailyRunReward(first.meta, {
      won: true,
      difficulty: 'normal',
      score: 200,
      scoreMul: 1,
      maxCombo: 10,
      dateStr,
    });
    expect(second.rewardGranted).toBe(false);
    expect(second.pointsGained).toBe(0);
    expect(second.meta.points).toBe(first.meta.points);
    expect(second.meta.dailyRuns[dateStr]?.bestScore).toBe(200);
    expect(second.dailyBestUpdated).toBe(true);
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
        unlockedPresets: [],
      }),
    );
    expect(loadMeta(storage).dailyRuns).toEqual({});
  });
});
