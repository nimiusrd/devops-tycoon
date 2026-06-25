import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { runMachine, type RunEvent } from '../../src/state/runMachine';

/** マシンを初期状態から一連のイベントで駆動し、最終状態値を返す。 */
function drive(events: RunEvent['type'][]): string {
  const actor = createActor(runMachine).start();
  for (const type of events) actor.send({ type } as RunEvent);
  return actor.getSnapshot().value as string;
}

describe('ランフェーズマシン（XState / 第3章）', () => {
  it('タイトル → マップ → スプリント → リザルト → ドラフト → 進化 → マップ の周回', () => {
    expect(drive(['START'])).toBe('map');
    expect(drive(['START', 'ENTER_SPRINT'])).toBe('sprint');
    expect(drive(['START', 'ENTER_SPRINT', 'SPRINT_DONE'])).toBe('result');
    expect(drive(['START', 'ENTER_SPRINT', 'SPRINT_DONE', 'ACK'])).toBe('draft');
    expect(drive(['START', 'ENTER_SPRINT', 'SPRINT_DONE', 'ACK', 'NEXT'])).toBe('evolution');
    expect(drive(['START', 'ENTER_SPRINT', 'SPRINT_DONE', 'ACK', 'NEXT', 'FINISH'])).toBe('map');
  });

  it('イベント/ショップ/休息ノードはマップへ戻る', () => {
    expect(drive(['START', 'ENTER_EVENT', 'RESOLVE'])).toBe('map');
    expect(drive(['START', 'ENTER_SHOP', 'RESOLVE'])).toBe('map');
    expect(drive(['START', 'ENTER_REST', 'RESOLVE'])).toBe('map');
  });

  it('ボス完了で四半期レビューへ、承認で won / 修正で map / 終了で lost', () => {
    expect(drive(['START', 'ENTER_SPRINT', 'BOSS_REVIEW'])).toBe('quarterReview');
    expect(drive(['START', 'ENTER_SPRINT', 'BOSS_REVIEW', 'REVIEW_WON'])).toBe('won');
    expect(drive(['START', 'ENTER_SPRINT', 'BOSS_REVIEW', 'REVIEW_CONTINUE'])).toBe('map');
    expect(drive(['START', 'ENTER_SPRINT', 'BOSS_REVIEW', 'REVIEW_LOST'])).toBe('lost');
    expect(drive(['START', 'ENTER_SPRINT', 'LOST'])).toBe('lost');
  });

  it('不正なイベントでは状態が変わらない', () => {
    expect(drive(['ENTER_SPRINT'])).toBe('title');
  });
});
