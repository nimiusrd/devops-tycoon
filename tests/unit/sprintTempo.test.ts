import { beforeAll, describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import {
  accumulateWallTime,
  BETWEEN_SPRINT_WALL_SEC,
  BOSS_WALL_SEC,
  INTERVENTION_PER_SPRINT,
  isBossTickCountInSpecBand,
  isSprintTickCountInSpecBand,
  maxAccumulatorMs,
  meetsSprintAbsoluteMin,
  MS_PER_TICK_1X,
  msPerTick,
  QUARTER_REVIEW_WALL_SEC,
  QUARTER_WALL_MIN,
  RUN_WALL_MIN,
  SPRINT_WALL_SEC,
  ticksDueFromAccumulator,
  wallSecondsAt1x,
  type PlaybackSpeed,
} from '../../src/ui/sprintTempo';
import { modelQuarterWallMinutes, modelRunWallMinutes } from './helpers/pacingStats';
import { p50, p90 } from './helpers/percentile';
import { advance, playUntil, type SprintEndMetrics } from './helpers/runFlow';

/** RI-62 / RI-66 共通の代表 seed。 */
const RI62_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** RI-66: skilled で四半期・ボス・介入余地を集める代表 seed。 */
const RI66_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'] as const;

/** RI-66: ラン全体は重いので seed を絞る（タイムアウト回避）。 */
const RI66_RUN_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] as const;

function collectSprintTicks(seeds: readonly string[]): {
  normal: number[];
  elite: number[];
  boss: number[];
} {
  const byKind = { normal: [] as number[], elite: [] as number[], boss: [] as number[] };
  for (const seed of seeds) {
    const e = new RunEngine({ seed, difficulty: 'normal' });
    e.startRun();
    let sprints = 0;
    let guard = 0;
    while (sprints < 6 && guard < 5000) {
      guard += 1;
      const s = e.snapshot();
      if (s.phase === 'setup') {
        e.beginSetupSprint();
        continue;
      }
      if (s.phase === 'sprint') {
        const kind = s.currentSprintKind;
        while (e.snapshot().phase === 'sprint') e.step(1000);
        const ticks = e.snapshot().sprintTick;
        if (kind === 'normal' || kind === 'elite' || kind === 'boss') byKind[kind].push(ticks);
        sprints += 1;
        continue;
      }
      if (s.phase === 'result') {
        e.acknowledgeResult();
        continue;
      }
      if (s.phase === 'draft') {
        if (s.draft && s.draft.length > 0) e.chooseCard(s.draft[0]!);
        else e.skipDraft();
        continue;
      }
      if (s.phase === 'evolution') {
        e.finishEvolution();
        continue;
      }
      if (s.phase === 'beat') {
        e.resolveBeat(0);
        continue;
      }
      if (s.phase === 'shop') {
        e.leaveShop();
        continue;
      }
      if (s.phase === 'rest') {
        e.restChoose('heal');
        continue;
      }
      if (s.phase === 'recruit') {
        e.recruitChoose('skip');
        continue;
      }
      if (s.phase === 'quarterReview') {
        e.acknowledgeQuarterReview();
        continue;
      }
      break;
    }
  }
  return byKind;
}

describe('sprintTempo（RI-62）', () => {
  it('1x は MS_PER_TICK_1X、2x は半分、pause は進めない', () => {
    expect(MS_PER_TICK_1X).toBe(680);
    expect(msPerTick(1)).toBe(680);
    expect(msPerTick(2)).toBe(340);
    expect(msPerTick(0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('アキュムレータから速度に応じた tick 数を返す', () => {
    expect(ticksDueFromAccumulator(679, 1)).toEqual({ ticks: 0, consumedMs: 0 });
    expect(ticksDueFromAccumulator(680, 1)).toEqual({ ticks: 1, consumedMs: 680 });
    expect(ticksDueFromAccumulator(1360, 1)).toEqual({ ticks: 2, consumedMs: 1360 });
    expect(ticksDueFromAccumulator(680, 2)).toEqual({ ticks: 2, consumedMs: 680 });
    expect(ticksDueFromAccumulator(10_000, 0)).toEqual({ ticks: 0, consumedMs: 0 });
    // 追いつき上限
    expect(ticksDueFromAccumulator(10_000, 1).ticks).toBe(4);
  });

  it('プレイヤー Pause は speed=0 であり game.pause を必要としない', () => {
    const speed: PlaybackSpeed = 0;
    expect(ticksDueFromAccumulator(5_000, speed).ticks).toBe(0);
  });

  it('タブ復帰など大きな delta はアキュムレータ上限で切り捨てる', () => {
    const capped = accumulateWallTime(0, 60_000, 1);
    expect(capped).toBe(maxAccumulatorMs(1));
    expect(capped).toBe(MS_PER_TICK_1X * 4);
    // 上限分だけ進み、残高を何フレームも引きずらない。
    const { ticks, consumedMs } = ticksDueFromAccumulator(capped, 1);
    expect(ticks).toBe(4);
    expect(consumedMs).toBe(capped);
  });

  it('§3.1 帯判定ヘルパが壁時計換算と一致する', () => {
    // 680ms/tick: 45 tick ≒ 30.6s、176 tick ≒ 119.7s
    expect(wallSecondsAt1x(45)).toBeCloseTo(30.6, 1);
    expect(wallSecondsAt1x(177)).toBeCloseTo(120.36, 1);
    expect(isSprintTickCountInSpecBand(45)).toBe(true);
    expect(isSprintTickCountInSpecBand(44)).toBe(false);
    expect(isSprintTickCountInSpecBand(177)).toBe(false);
    expect(isBossTickCountInSpecBand(133)).toBe(true); // ≒90.4s
    expect(isBossTickCountInSpecBand(132)).toBe(false);
    expect(isBossTickCountInSpecBand(264)).toBe(true); // ≒179.5s
  });

  it('代表 seed の通常スプリントが §3.1（最短30秒・中央60〜120・p90≤120）を満たす', () => {
    const { normal, boss } = collectSprintTicks(RI62_SEEDS);
    expect(normal.length).toBeGreaterThan(0);

    for (const ticks of normal) {
      expect(
        meetsSprintAbsoluteMin(ticks),
        `normal ticks=${ticks} wall=${wallSecondsAt1x(ticks)}s < ${SPRINT_WALL_SEC.absoluteMin}s`,
      ).toBe(true);
    }

    const p50Sec = wallSecondsAt1x(p50(normal));
    const p90Sec = wallSecondsAt1x(p90(normal));
    expect(p50Sec).toBeGreaterThanOrEqual(SPRINT_WALL_SEC.minTypical);
    expect(p50Sec).toBeLessThanOrEqual(SPRINT_WALL_SEC.maxTypical);
    expect(p90Sec).toBeLessThanOrEqual(SPRINT_WALL_SEC.maxTypical);

    // ボス上限は無介入サンプルでも超えない（下限の分布検証は RI-66）。
    for (const ticks of boss) {
      const sec = wallSecondsAt1x(ticks);
      expect(sec, `boss ticks=${ticks} wall=${sec}s`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    }
    expect(BOSS_WALL_SEC.min).toBe(90);
    // ヘルパ自体の回帰防止
    expect(isSprintTickCountInSpecBand(80)).toBe(true);
    expect(isBossTickCountInSpecBand(200)).toBe(true);
  });
});

describe('sprintTempo ペーシング統計（RI-66）', () => {
  /** 全 seed のスプリント完了メトリクス（ボス分布用。レビュー未到達も含む）。 */
  let quarterAttempts: { seed: string; ends: SprintEndMetrics[]; reachedReview: boolean }[];
  /** 四半期レビュー到達サンプル（四半期壁時計用）。 */
  let reviewedQuarters: { seed: string; ends: SprintEndMetrics[] }[];

  beforeAll(() => {
    quarterAttempts = [];
    reviewedQuarters = [];
    for (const seed of RI66_SEEDS) {
      const e = new RunEngine({ seed, difficulty: 'normal' });
      const ends: SprintEndMetrics[] = [];
      playUntil(e, 'quarterReview', {
        skilled: true,
        onSprintEnd: (m) => {
          ends.push(m);
        },
      });
      const reachedReview = e.snapshot().phase === 'quarterReview' && ends.length === 6;
      quarterAttempts.push({ seed, ends, reachedReview });
      if (reachedReview) {
        reviewedQuarters.push({ seed, ends });
      }
    }
  });

  it('§3.1 モデル定数が規定どおり', () => {
    expect(BETWEEN_SPRINT_WALL_SEC).toBe(35);
    expect(QUARTER_REVIEW_WALL_SEC).toBe(45);
    expect(QUARTER_WALL_MIN).toEqual({ minMin: 10, maxMin: 15 });
    expect(RUN_WALL_MIN).toEqual({ minMin: 15, maxMin: 45 });
    expect(INTERVENTION_PER_SPRINT).toEqual({ min: 3, max: 8 });
  });

  it('代表 seed のボス壁時計が分布で 90〜180 秒帯に入る', () => {
    // クリア／敗北を問わず完了したボスを集計する（レビュー到達で絞らない）。
    const bossSecs = quarterAttempts
      .flatMap((row) => row.ends)
      .filter((m) => m.kind === 'boss')
      .map((m) => wallSecondsAt1x(m.ticks));
    expect(bossSecs.length).toBeGreaterThanOrEqual(4);

    for (const sec of bossSecs) {
      expect(sec, `boss wall=${sec}s`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    }

    const bossP50 = p50(bossSecs);
    const bossP90 = p90(bossSecs);
    expect(bossP50).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min);
    expect(bossP50).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    expect(bossP90).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
  });

  it('skilled 自動操作の 1 四半期が 10〜15 分帯（p50/p90）に入る', () => {
    // quarterReview 到達済みのみ（ボス直後敗北でレビュー未到達の 6 本は除外）。
    expect(reviewedQuarters.length).toBeGreaterThanOrEqual(4);
    const quarterMins = reviewedQuarters.map((row) =>
      modelQuarterWallMinutes(row.ends.map((m) => m.ticks)),
    );

    const qP50 = p50(quarterMins);
    const qP90 = p90(quarterMins);
    expect(qP50).toBeGreaterThanOrEqual(QUARTER_WALL_MIN.minMin);
    expect(qP50).toBeLessThanOrEqual(QUARTER_WALL_MIN.maxMin);
    expect(qP90).toBeLessThanOrEqual(QUARTER_WALL_MIN.maxMin);
  });

  it('skilled 自動操作の 1 ランが 15〜45 分帯（p50/p90）に入る', () => {
    // 早期敗北の短ランは体験目安の対象外。四半期レビューへ 1 回以上到達したランだけ集計する。
    const runMins: number[] = [];
    for (const seed of RI66_RUN_SEEDS) {
      const e = new RunEngine({ seed, difficulty: 'normal' });
      const ticks: number[] = [];
      let reviews = 0;
      let guard = 0;
      while (e.snapshot().status === 'playing' && guard < 40_000) {
        guard += 1;
        const before = e.snapshot().phase;
        if (
          !advance(e, {
            skilled: true,
            onSprintEnd: (m) => {
              ticks.push(m.ticks);
            },
          })
        ) {
          break;
        }
        const after = e.snapshot().phase;
        if (before !== 'quarterReview' && after === 'quarterReview') {
          reviews += 1;
        }
      }
      if (reviews >= 1) {
        runMins.push(modelRunWallMinutes(ticks, reviews));
      }
    }
    expect(runMins.length).toBeGreaterThanOrEqual(4);

    const rP50 = p50(runMins);
    const rP90 = p90(runMins);
    expect(rP50).toBeGreaterThanOrEqual(RUN_WALL_MIN.minMin);
    expect(rP50).toBeLessThanOrEqual(RUN_WALL_MIN.maxMin);
    expect(rP90).toBeLessThanOrEqual(RUN_WALL_MIN.maxMin);
  }, 15_000);

  it('1 スプリントあたり介入成立回数が 3〜8 回帯（p50/p90）に入る', () => {
    // 理論上の CD/focus 余地ではなく、pacing ポリシーで実際に成功した回数を見る。
    const used: number[] = [];
    for (const seed of RI66_SEEDS) {
      const e = new RunEngine({ seed, difficulty: 'normal' });
      playUntil(e, 'quarterReview', {
        pacingInterventions: true,
        onSprintEnd: (m) => {
          used.push(m.interventionsUsed);
        },
      });
    }
    expect(used.length).toBeGreaterThan(0);

    const uP50 = p50(used);
    const uP90 = p90(used);
    expect(uP50).toBeGreaterThanOrEqual(INTERVENTION_PER_SPRINT.min);
    expect(uP50).toBeLessThanOrEqual(INTERVENTION_PER_SPRINT.max);
    expect(uP90).toBeLessThanOrEqual(INTERVENTION_PER_SPRINT.max);
  }, 15_000);
});

describe('percentile ヘルパ', () => {
  it('nearest-rank（ceil(n*p) 番目）で p50/p90 を返す', () => {
    // n=6, p50 → ceil(3)=3 番目、p90 → ceil(5.4)=6 番目
    expect(p50([1, 2, 3, 4, 5, 6])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6])).toBe(6);
    // n=10, p50 → 5 番目、p90 → 9 番目
    expect(p50([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(5);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
    expect(p50([])).toBe(0);
    expect(p90([])).toBe(0);
  });
});
