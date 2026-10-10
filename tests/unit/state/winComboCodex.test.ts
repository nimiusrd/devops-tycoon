import { describe, expect, it } from 'vitest';
import {
  applyDailyRunReward,
  applyRunReward,
  buildWinComboCodex,
  defaultMeta,
  normalizeMeta,
  WIN_TITLE_DEFS,
  winComboKey,
  type MetaState,
  type RunRewardInput,
} from '../../../src/state/meta';

const win = (overrides: Partial<RunRewardInput> = {}): RunRewardInput => ({
  won: true,
  difficulty: 'normal',
  winType: 'healthy',
  score: 100,
  scoreMul: 1,
  maxCombo: 0,
  ...overrides,
});

describe('難易度×勝利種別の図鑑（RI-294）', () => {
  it('勝利時だけ難易度と自動判定の勝利種別の組を記録し、敗北や種別なしは記録しない', () => {
    let meta = applyRunReward(defaultMeta(), win());
    expect(meta.collectedWinCombos).toEqual(['normal:healthy']);
    meta = applyRunReward(meta, win({ won: false, winType: undefined }));
    meta = applyRunReward(meta, win({ winType: undefined }));
    meta = applyRunReward(meta, win({ won: false, winType: 'chaos' }));
    expect(meta.collectedWinCombos).toEqual(['normal:healthy']);
    meta = applyRunReward(meta, win({ difficulty: 'easy' }));
    expect(meta.collectedWinCombos).toEqual(['normal:healthy', 'easy:healthy']);
  });

  it('同じ組の再達成は重複行を作らず、ポイントは通常の勝利報酬だけ増える', () => {
    const first = applyRunReward(defaultMeta(), win());
    const again = applyRunReward(first, win());
    const plain = applyRunReward(first, win({ winType: undefined }));
    expect(again.collectedWinCombos).toEqual(['normal:healthy']);
    expect(again.points - first.points).toBe(plain.points - first.points);
    expect(buildWinComboCodex(again).achievedCount).toBe(1);
  });

  it('デイリーの初回・再走でも組を記録し、日次報酬は二重に付与しない', () => {
    const first = applyDailyRunReward(defaultMeta(), { ...win(), dateStr: '2026-10-10' });
    expect(first.meta.collectedWinCombos).toEqual(['normal:healthy']);
    const rerun = applyDailyRunReward(first.meta, {
      ...win({ winType: 'chaos' }),
      dateStr: '2026-10-10',
    });
    expect(rerun.pointsGained).toBe(0);
    expect(rerun.meta.collectedWinCombos).toEqual(['normal:healthy', 'normal:chaos']);
  });

  it('旧保存は既存の勝利称号から難易度を推測せず、壊れた値と重複を落とす', () => {
    const legacy = normalizeMeta({
      ...defaultMeta(),
      collectedWinTypes: ['healthy', 'chaos'],
      collectedWinCombos: undefined,
    });
    expect(legacy.collectedWinTypes).toEqual(['healthy', 'chaos']);
    expect(legacy.collectedWinCombos).toEqual([]);
    expect(buildWinComboCodex(legacy).achievedCount).toBe(0);
    const broken = normalizeMeta({
      ...defaultMeta(),
      collectedWinCombos: [
        'normal:healthy',
        'normal:healthy',
        'expert:healthy',
        'normal:legend',
        'normal:healthy:extra',
        42,
      ],
    });
    expect(broken.collectedWinCombos).toEqual(['normal:healthy']);
    expect(normalizeMeta({ ...defaultMeta(), collectedWinCombos: 'x' }).collectedWinCombos).toEqual(
      [],
    );
  });

  it('未達と解放前の難易度を区別し、解放済みの最上位難易度の未達を次の目標にする', () => {
    const meta: MetaState = {
      ...defaultMeta(),
      collectedWinCombos: [winComboKey('easy', 'healthy'), winComboKey('normal', 'chaos')],
    };
    const codex = buildWinComboCodex(meta);
    expect(codex.total).toBe(4 * WIN_TITLE_DEFS.length);
    expect(codex.achievedCount).toBe(2);
    expect(codex.rows.map((row) => [row.difficulty, row.unlocked, row.achievedCount])).toEqual([
      ['easy', true, 1],
      ['normal', true, 1],
      ['hard', false, 0],
      ['nightmare', false, 0],
    ]);
    const normal = codex.rows[1];
    expect(normal.cells.map((cell) => cell.label)).toEqual(WIN_TITLE_DEFS.map((def) => def.label));
    expect(normal.cells.find((cell) => cell.winType === 'chaos')!.achieved).toBe(true);
    expect(codex.nextGoal).toEqual({
      difficulty: 'normal',
      label: normal.label,
      remaining: WIN_TITLE_DEFS.map((def) => def.id).filter((id) => id !== 'chaos'),
    });
  });

  it('解放済みの難易度をすべて達成すると次の目標は無くなる', () => {
    const meta: MetaState = {
      ...defaultMeta(),
      collectedWinCombos: ['easy', 'normal'].flatMap((difficulty) =>
        WIN_TITLE_DEFS.map((def) => winComboKey(difficulty as 'easy' | 'normal', def.id)),
      ),
    };
    expect(buildWinComboCodex(meta).nextGoal).toBeNull();
    const hard = buildWinComboCodex({
      ...meta,
      unlockedDifficulties: [...meta.unlockedDifficulties, 'hard'],
    });
    expect(hard.nextGoal?.difficulty).toBe('hard');
    expect(hard.nextGoal?.remaining).toHaveLength(WIN_TITLE_DEFS.length);
  });
});
