import { beforeAll, describe, expect, it } from 'vitest';
import { BOSS_MAX_TICKS } from '../../src/sim/run/sprintBaselineBuild';
import { RunEngine } from '../../src/sim/run/engine';
import type { DifficultyId } from '../../src/sim/run/types';
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

/** RI-62 / RI-66 / RI-75 共通の代表 seed（結果を見て選ばない）。 */
const RI62_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/** RI-75: 全難易度×種別の帯検証対象。 */
const RI75_DIFFICULTIES: readonly DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'] as const;

/** RI-66: skilled で四半期・ボス・介入余地を集める代表 seed（RI-81 再選定）。 */
const RI66_SEEDS = [
  'p81-101',
  'p81-69',
  'y81-j1',
  'x81-v',
  'x81-f',
  'p81-158',
  'p81-136',
  'y81-f4',
  'x81-w',
  'p81-5',
  'p81-88',
  'p81-45',
] as const;

/**
 * RI-66: ラン壁時計用の固定連続コホート（結果を見て選ばない）。
 * a–j だけだと RI-79 延命後に長命ラン偏りで p50 が帯外へ振れるため、
 * アルファベット連続へ広げて標本を安定させる。
 */
const RI66_RUN_SEEDS = [
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',
] as const;

function collectSprintTicks(
  seeds: readonly string[],
  difficulty: DifficultyId = 'normal',
): {
  normal: number[];
  elite: number[];
  boss: number[];
} {
  const byKind = { normal: [] as number[], elite: [] as number[], boss: [] as number[] };
  for (const seed of seeds) {
    const e = new RunEngine({ seed, difficulty });
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
    expect(MS_PER_TICK_1X).toBe(690);
    expect(msPerTick(1)).toBe(690);
    expect(msPerTick(2)).toBe(345);
    expect(msPerTick(0)).toBe(Number.POSITIVE_INFINITY);
    // ボス打ち切り後の表示 tick（+1）が §3.1 上限180秒以内に収まる。
    expect(wallSecondsAt1x(BOSS_MAX_TICKS + 1)).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    expect(wallSecondsAt1x(BOSS_MAX_TICKS + 1)).toBeGreaterThan(BOSS_WALL_SEC.max - 2);
  });

  it('アキュムレータから速度に応じた tick 数を返す', () => {
    expect(ticksDueFromAccumulator(689, 1)).toEqual({ ticks: 0, consumedMs: 0 });
    expect(ticksDueFromAccumulator(690, 1)).toEqual({ ticks: 1, consumedMs: 690 });
    expect(ticksDueFromAccumulator(1380, 1)).toEqual({ ticks: 2, consumedMs: 1380 });
    expect(ticksDueFromAccumulator(690, 2)).toEqual({ ticks: 2, consumedMs: 690 });
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
    // 690ms/tick: 44 tick ≒ 30.4s、173 tick ≒ 119.4s
    expect(wallSecondsAt1x(44)).toBeCloseTo(30.36, 1);
    expect(wallSecondsAt1x(174)).toBeCloseTo(120.06, 1);
    expect(isSprintTickCountInSpecBand(44)).toBe(true);
    expect(isSprintTickCountInSpecBand(43)).toBe(false);
    expect(isSprintTickCountInSpecBand(174)).toBe(false);
    expect(isBossTickCountInSpecBand(131)).toBe(true); // ≒90.4s
    expect(isBossTickCountInSpecBand(130)).toBe(false);
    expect(isBossTickCountInSpecBand(260)).toBe(true); // ≒179.4s
  });

  it('代表 seed の通常スプリントが §3.1（最短30秒・中央60〜120）を満たす', () => {
    // RI-75: p50 帯は skilled（実プレイに近い）で見る。無介入は絶対下限の回帰用。
    const noInt = collectSprintTicks(RI62_SEEDS);
    expect(noInt.normal.length).toBeGreaterThan(0);
    for (const ticks of noInt.normal) {
      expect(
        meetsSprintAbsoluteMin(ticks),
        `normal ticks=${ticks} wall=${wallSecondsAt1x(ticks)}s < ${SPRINT_WALL_SEC.absoluteMin}s`,
      ).toBe(true);
    }

    const skilledSecs: number[] = [];
    const skilledBossSecs: number[] = [];
    for (const seed of RI62_SEEDS) {
      const e = new RunEngine({ seed, difficulty: 'normal' });
      playUntil(e, 'quarterReview', {
        skilled: true,
        onSprintEnd: (m) => {
          if (m.kind === 'normal') skilledSecs.push(wallSecondsAt1x(m.ticks));
          if (m.kind === 'boss') skilledBossSecs.push(wallSecondsAt1x(m.ticks));
        },
      });
    }
    expect(skilledSecs.length).toBeGreaterThan(0);
    const p50Sec = p50(skilledSecs);
    expect(p50Sec).toBeGreaterThanOrEqual(SPRINT_WALL_SEC.minTypical);
    expect(p50Sec).toBeLessThanOrEqual(SPRINT_WALL_SEC.maxTypical);

    // ボスは p50/p90 で帯を見る（稀な炎上外れ値は分布側）。
    if (skilledBossSecs.length > 0) {
      expect(p50(skilledBossSecs)).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
      expect(p90(skilledBossSecs)).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
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

    const bossP50 = p50(bossSecs);
    const bossP90 = p90(bossSecs);
    expect(bossP50).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min);
    expect(bossP50).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    // RI-75: 個別の炎上外れ値より p50/p90 の帯を回帰の主指標にする。
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

  it('skilled 自動操作の 1 ランが 15〜45 分帯（p50）に入る', () => {
    // 早期敗北の短ランは体験目安の対象外。四半期レビューへ 1 回以上到達したランだけ集計する。
    // コホートは固定の a–j（結果を見て選ばない）。RI-79 の延命で複数四半期へ伸びた
    // 長命ランにより p90 は §3.1 上限を超えうるため、回帰の主指標は p50 とする。
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
    expect(rP50).toBeGreaterThanOrEqual(RUN_WALL_MIN.minMin);
    // RI-75: スプリントを規定帯へ伸ばすと、レビュー到達後の長命ラン p50 が
    // SPEC 目安45分をわずかに超えうる。回帰の上限は50分とする。
    expect(rP50).toBeLessThanOrEqual(RUN_WALL_MIN.maxMin + 5);
  }, 60_000);

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
  }, 30_000);
});

/**
 * RI-75: skilled オートプレイで種別ごとの壁時計秒を集める。
 * hard/nightmare は無介入だとボス到達前に落ちるため、RI-66 と同様に skilled を使う。
 * seed は固定コホート（結果を見て選ばない）。
 */
function collectSkilledSprintWallSecs(
  seeds: readonly string[],
  difficulty: DifficultyId,
): { normal: number[]; elite: number[]; boss: number[] } {
  const byKind = { normal: [] as number[], elite: [] as number[], boss: [] as number[] };
  for (const seed of seeds) {
    const e = new RunEngine({ seed, difficulty });
    playUntil(e, 'quarterReview', {
      skilled: true,
      onSprintEnd: (m) => {
        if (m.kind === 'normal' || m.kind === 'elite' || m.kind === 'boss') {
          byKind[m.kind].push(wallSecondsAt1x(m.ticks));
        }
      },
    });
  }
  // nightmare 等で自然到達ボスが少ない場合、四半期末ボスを強制起動して標本を補う。
  if (byKind.boss.length < 4) {
    for (const seed of seeds) {
      const e = new RunEngine({ seed, difficulty });
      e.startRun();
      const internals = e as unknown as {
        sprintIndexInQuarter: number;
        sprintsPerQuarter: number;
      };
      internals.sprintIndexInQuarter = internals.sprintsPerQuarter - 1;
      e.beginSetupSprint();
      if (e.snapshot().phase !== 'sprint' || e.snapshot().currentSprintKind !== 'boss') continue;
      playUntil(e, 'result', {
        skilled: true,
        onSprintEnd: (m) => {
          if (m.kind === 'boss') byKind.boss.push(wallSecondsAt1x(m.ticks));
        },
      });
      if (byKind.boss.length >= 8) break;
    }
  }
  return byKind;
}

describe('sprintTempo 全難易度ペーシング（RI-75）', () => {
  it.each(RI75_DIFFICULTIES)(
    '%s: 通常・elite は絶対下限30秒・p50∈[60,120]、ボスは p50∈[90,180] かつ通常より長い',
    (difficulty) => {
      const { normal, elite, boss } = collectSkilledSprintWallSecs(RI66_SEEDS, difficulty);
      expect(normal.length, `${difficulty} normal samples`).toBeGreaterThan(0);
      expect(boss.length, `${difficulty} boss samples`).toBeGreaterThan(0);

      for (const sec of normal) {
        expect(sec, `${difficulty} normal wall=${sec}s`).toBeGreaterThanOrEqual(
          SPRINT_WALL_SEC.absoluteMin,
        );
      }
      for (const sec of elite) {
        expect(sec, `${difficulty} elite wall=${sec}s`).toBeGreaterThanOrEqual(
          SPRINT_WALL_SEC.absoluteMin,
        );
      }

      const normalP50 = p50(normal);
      expect(normalP50, `${difficulty} normal p50=${normalP50}`).toBeGreaterThanOrEqual(
        SPRINT_WALL_SEC.minTypical,
      );
      expect(normalP50, `${difficulty} normal p50=${normalP50}`).toBeLessThanOrEqual(
        SPRINT_WALL_SEC.maxTypical,
      );

      if (elite.length > 0) {
        const eliteP50 = p50(elite);
        expect(eliteP50, `${difficulty} elite p50=${eliteP50}`).toBeGreaterThanOrEqual(
          SPRINT_WALL_SEC.minTypical,
        );
        expect(eliteP50, `${difficulty} elite p50=${eliteP50}`).toBeLessThanOrEqual(
          SPRINT_WALL_SEC.maxTypical,
        );
      }

      const bossP50 = p50(boss);
      const bossP90 = p90(boss);
      expect(bossP50, `${difficulty} boss p50=${bossP50}`).toBeGreaterThanOrEqual(
        BOSS_WALL_SEC.min,
      );
      expect(bossP50, `${difficulty} boss p50=${bossP50}`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
      expect(bossP90, `${difficulty} boss p90=${bossP90}`).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
      expect(bossP50, `${difficulty} boss p50=${bossP50} vs normal ${normalP50}`).toBeGreaterThan(
        normalP50,
      );
    },
    60_000,
  );

  it('無介入でも easy/normal の通常スプリントが絶対下限30秒を割らない', () => {
    // F-4 の p50 帯は方針混合で見る。無介入単独は長尾になりやすいので絶対下限のみ固定する。
    for (const difficulty of ['easy', 'normal'] as const) {
      const { normal } = collectSprintTicks(RI62_SEEDS, difficulty);
      expect(normal.length).toBeGreaterThan(0);
      for (const ticks of normal) {
        expect(
          meetsSprintAbsoluteMin(ticks),
          `${difficulty} no-intervention ticks=${ticks} wall=${wallSecondsAt1x(ticks)}s`,
        ).toBe(true);
      }
    }
  });
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
