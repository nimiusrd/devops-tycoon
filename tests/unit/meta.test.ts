import { describe, expect, it } from 'vitest';
import {
  applyRunReward,
  defaultMeta,
  loadMeta,
  saveMeta,
  type MetaStorage,
} from '../../src/state/meta';

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
});
