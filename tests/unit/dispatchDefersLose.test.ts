/**
 * 介入の発動（`RunEngine.dispatch`）は敗北判定をしない、という規則を固定する。
 *
 * プレイテスト・ハーネスへ「シニアHPが敗北閾値を跨ぐ介入は撃たない」というガードを
 * 入れてしまい、1,240ラン中258ランの挙動と集計値を動かしたことがある。実際には
 * `dispatch()` は `applyImmediateLose()` を呼ばず（`playCard()` は呼ぶ）、
 * `evaluateLose` は `resolveSprint()` まで延期される。その間 `stepSprint()` は
 * 毎 tick シニアHPを自然回復させるので、一時的に1へ落ちても生存し得る。
 *
 * **つまりゲームに「介入で即死する」規則は無い。** ハーネスがそれを仮定すると、
 * 実在しない規則の下での勝率を測ることになる。この差は読むだけでは気づきにくく、
 * レビューでも2回続けて逆に判断された（「即時敗北する」という前提で修正を求められ、
 * 次の回にその前提自体が誤りだと指摘された）ので、実行可能な形で残す。
 */
import { describe, it, expect } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import { FIREFIGHT_HP_COST } from '../../src/sim/actions';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP } from '../../src/sim/outcome';

/** 炎上タスクが出るまでスプリントを進める。出なければ undefined。 */
function advanceToBurning(e: RunEngine): boolean {
  for (let i = 0; i < 2000; i += 1) {
    const s = e.snapshot();
    if (s.phase !== 'sprint') return false;
    if (s.sprint?.tasks.some((t) => t.lane === 'rework' && t.incident)) return true;
    e.step(100);
  }
  return false;
}

describe('dispatch は敗北判定をスプリント終了まで延期する', () => {
  it('シニアHPが1以下になる介入を撃ってもその場では敗北しない', () => {
    const e = new RunEngine({ seed: 'pt-1', difficulty: 'normal' });
    e.startRun();
    e.beginSetupSprint();
    expect(e.snapshot().phase).toBe('sprint');
    expect(advanceToBurning(e)).toBe(true);

    // 敗北閾値（seniorHp <= 1）を跨ぐ手前の値へ寄せる。
    // `snapshot()` は複製を返すので、エンジンが持つ実体へ直接触る必要がある。
    const internal = e as unknown as { org: { seniorHp: number } };
    internal.org.seniorHp = FIREFIGHT_HP_COST + 1;

    const outcome = e.dispatch('firefight');
    expect(outcome.ok).toBe(true);

    const after = e.snapshot();
    expect(after.org.seniorHp).toBeLessThanOrEqual(1);
    // 本題: HP が敗北閾値まで落ちても、この時点では負けていない。
    expect(after.status).toBe('playing');
    expect(after.phase).toBe('sprint');

    // firefight で Review に戻したタスクが直後に処理され HP が一時的に下がることがある。
    // 自然回復で数 tick 以内に閾値を上回り、なお playing のままであること。
    let recovered = false;
    for (let i = 0; i < 20; i += 1) {
      e.step(100);
      const s = e.snapshot();
      expect(s.status).toBe('playing');
      if (s.org.seniorHp > 1) {
        recovered = true;
        break;
      }
    }
    expect(recovered).toBe(true);
  });

  it('カード発動は逆に即時敗北判定を行う（対比）', () => {
    const e = new RunEngine({ seed: 'pt-card-immediate-lose', difficulty: 'nightmare' });
    e.startRun();
    const internal = e as unknown as {
      phase: string;
      draft: string[] | null;
      org: { aiDependency: number; aiLiteracy: number };
    };
    internal.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internal.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;
    internal.phase = 'draft';
    internal.draft = ['copilot'];
    e.chooseCard('copilot');
    internal.phase = 'setup';
    e.beginSetupSprint();

    const before = e.snapshot();
    const copilot = before.sprint!.cardPiles.hand.find(
      (idx) => before.deck[idx]?.defId === 'copilot',
    );
    expect(copilot).toBeDefined();
    expect(e.playCard(copilot!).ok).toBe(true);

    const after = e.snapshot();
    expect(after.status).toBe('lost');
    expect(after.phase).toBe('lost');
    expect(after.loseReason).toBe('aiDependency');
  });
});
