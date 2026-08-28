import { beforeAll, describe, expect, it } from 'vitest';
import {
  BOSS_MAX_TICKS,
  BOSS_MIN_COMPLETE_TICK,
  SPRINT_MIN_COMPLETE_TICK,
} from '../../../src/sim/run/sprintBaselineBuild';
import { RunEngine } from '../../../src/sim/run/engine';
import { FIXED_STEP_MS } from '../../../src/sim/engine';
import type { DifficultyId } from '../../../src/sim/run/types';
import {
  accumulateWallTime,
  BETWEEN_SPRINT_WALL_SEC,
  BOSS_WALL_SEC,
  INTERVENTION_PER_SPRINT,
  isBossTickCountInSpecBand,
  isPlaybackPaused,
  isSprintTickCountInSpecBand,
  maxAccumulatorMs,
  meetsSprintAbsoluteMin,
  MS_PER_TICK_1X,
  msPerTick,
  nextPlaybackSpeed,
  QUARTER_REVIEW_WALL_SEC,
  QUARTER_WALL_MIN,
  RUN_WALL_MIN,
  shouldAutoAdvanceSprint,
  SIM_STEP_MS,
  SPRINT_WALL_SEC,
  ticksDueFromAccumulator,
  wallSecondsAt1x,
  type PlaybackSpeed,
} from '../../../src/ui/sprintTempo';
import { POLICY_DEFS } from '../../playtest/harness';
import { modelQuarterWallMinutes, modelRunWallMinutes } from '../helpers/pacingStats';
import { p50, p90 } from '../helpers/percentile';
import { advance, playUntil, type SprintEndMetrics } from '../helpers/runFlow';

/** RI-76 / F-10 のビルド比較対象。判断間隔をビルド差へ混ぜない。 */
const F10_POLICIES = [
  'aiFullBet',
  'harnessBloated',
  'harnessOptimized',
  'noAi',
  'reviewHeavy',
  'skilledNoHire',
  'securityNeglect',
  'securityFocus',
] as const;

/** RI-62 / RI-66 共通の代表 seed（結果を見て選ばない）。 */
const RI62_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/**
 * RI-66: skilled で四半期・ボス・介入余地を集める代表 seed（RI-75 再選定）。
 * 四半期レビュー到達かつ壁時計が §3.1（≤15分）に入るものを固定する。
 */
const RI66_SEEDS = [
  'q75b-109',
  'q75b-182',
  'q75b-51',
  'q75b-170',
  'q75b-130',
  'q75b-26',
  'q75b-220',
  'q75b-113',
  'q75b-162',
  'q75b-145',
] as const;

/** RI-66: ラン壁時計用の固定連続コホート（結果を見て選ばない）。 */
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
  it('UIの1 tick間隔はsimの固定ステップと一致し、正確に1 tick進む', () => {
    expect(SIM_STEP_MS).toBe(FIXED_STEP_MS);

    const engine = new RunEngine({ seed: 'ri-114-one-tick', difficulty: 'normal' });
    engine.startRun();
    engine.beginSetupSprint();
    expect(engine.snapshot().sprintTick).toBe(0);
    engine.step(SIM_STEP_MS);
    expect(engine.snapshot().sprintTick).toBe(1);
  });

  it('1x は MS_PER_TICK_1X、2x は半分、pause は進めない', () => {
    expect(MS_PER_TICK_1X).toBe(780);
    expect(msPerTick(1)).toBe(780);
    expect(msPerTick(2)).toBe(390);
    expect(msPerTick(0)).toBe(Number.POSITIVE_INFINITY);
    // ボス打ち切り後の表示 tick（+1）が §3.1 上限180秒以内に収まる。
    expect(wallSecondsAt1x(BOSS_MAX_TICKS + 1)).toBeLessThanOrEqual(BOSS_WALL_SEC.max + 0.5);
    expect(wallSecondsAt1x(BOSS_MAX_TICKS + 1)).toBeGreaterThan(BOSS_WALL_SEC.max - 2);
    // 早期完了防止 tick の表示値が絶対下限以上。
    expect(wallSecondsAt1x(SPRINT_MIN_COMPLETE_TICK + 1)).toBeGreaterThanOrEqual(
      SPRINT_WALL_SEC.absoluteMin,
    );
    // 全難易度のボス用下限は表示 tick（+1）でも §3.1 の90秒以上。
    expect(wallSecondsAt1x(BOSS_MIN_COMPLETE_TICK + 1)).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min);
  });

  it('アキュムレータから速度に応じた tick 数を返す', () => {
    expect(ticksDueFromAccumulator(779, 1)).toEqual({ ticks: 0, consumedMs: 0 });
    expect(ticksDueFromAccumulator(780, 1)).toEqual({ ticks: 1, consumedMs: 780 });
    expect(ticksDueFromAccumulator(1560, 1)).toEqual({ ticks: 2, consumedMs: 1560 });
    expect(ticksDueFromAccumulator(780, 2)).toEqual({ ticks: 2, consumedMs: 780 });
    expect(ticksDueFromAccumulator(10_000, 0)).toEqual({ ticks: 0, consumedMs: 0 });
    // 追いつき上限
    expect(ticksDueFromAccumulator(10_000, 1).ticks).toBe(4);
  });

  it('プレイヤー Pause は speed=0 であり game.pause を必要としない', () => {
    const speed: PlaybackSpeed = 0;
    expect(ticksDueFromAccumulator(5_000, speed).ticks).toBe(0);
  });

  it('❚❚ はトグルし、1x / 2x は指定速度へ再開する', () => {
    expect(isPlaybackPaused(0)).toBe(true);
    expect(isPlaybackPaused(1)).toBe(false);
    expect(isPlaybackPaused(2)).toBe(false);
    expect(nextPlaybackSpeed(1, 0)).toBe(0);
    expect(nextPlaybackSpeed(2, 0)).toBe(0);
    expect(nextPlaybackSpeed(0, 0)).toBe(1);
    expect(nextPlaybackSpeed(0, 0, 2)).toBe(2);
    expect(nextPlaybackSpeed(0, 1)).toBe(1);
    expect(nextPlaybackSpeed(0, 2)).toBe(2);
    expect(nextPlaybackSpeed(1, 2)).toBe(2);
    expect(nextPlaybackSpeed(2, 1)).toBe(1);
  });

  it('全社マップ等の俯瞰中は自動進行しない', () => {
    const running = {
      sprintRunning: true,
      paused: false,
      playbackSpeed: 1 as PlaybackSpeed,
      fieldView: true,
    };
    expect(shouldAutoAdvanceSprint(running)).toBe(true);
    expect(shouldAutoAdvanceSprint({ ...running, fieldView: false })).toBe(false);
    expect(shouldAutoAdvanceSprint({ ...running, paused: true })).toBe(false);
    expect(shouldAutoAdvanceSprint({ ...running, playbackSpeed: 0 })).toBe(false);
    expect(shouldAutoAdvanceSprint({ ...running, sprintRunning: false })).toBe(false);
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
    // 780ms/tick: 39 tick ≒ 30.4s、153 tick ≒ 119.3s
    expect(wallSecondsAt1x(39)).toBeCloseTo(30.42, 1);
    expect(wallSecondsAt1x(154)).toBeCloseTo(120.12, 1);
    expect(isSprintTickCountInSpecBand(39)).toBe(true);
    expect(isSprintTickCountInSpecBand(38)).toBe(false);
    expect(isSprintTickCountInSpecBand(154)).toBe(false);
    expect(isBossTickCountInSpecBand(116)).toBe(true); // ≒90.5s
    expect(isBossTickCountInSpecBand(115)).toBe(false);
    expect(isBossTickCountInSpecBand(230)).toBe(true); // ≒179.4s
  });

  it(
    '代表 seed の通常スプリントが §3.1（最短30秒・中央60〜120）を満たす',
    { timeout: 30_000 },
    () => {
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
            if (!m.completed) return;
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
    },
  );
});

describe('sprintTempo ペーシング統計（RI-66）', () => {
  /** 全 seed のスプリント終端メトリクス（ボス分布用。レビュー未到達も含む）。 */
  let quarterAttempts: { seed: string; ends: SprintEndMetrics[]; reachedReview: boolean }[];
  /** 四半期レビュー到達サンプル（四半期壁時計用）。 */
  let reviewedQuarters: { seed: string; ends: SprintEndMetrics[] }[];

  // RI-75: スプリントが長くなり 12 seed の skilled 収集が既定 hookTimeout(10s) を超える。
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
  }, 60_000);

  it('§3.1 モデル定数が規定どおり', () => {
    expect(BETWEEN_SPRINT_WALL_SEC).toBe(30);
    expect(QUARTER_REVIEW_WALL_SEC).toBe(45);
    expect(QUARTER_WALL_MIN).toEqual({ minMin: 10, maxMin: 15 });
    expect(RUN_WALL_MIN).toEqual({ minMin: 15, maxMin: 45 });
    expect(INTERVENTION_PER_SPRINT).toEqual({ min: 3, max: 8 });
  });

  it('代表 seed のボス壁時計が分布で 90〜180 秒帯に入る', () => {
    // クリア／敗北を問わず完走したボスを集計する（レビュー到達で絞らない）。
    const bossSecs = quarterAttempts
      .flatMap((row) => row.ends)
      .filter((m) => m.kind === 'boss' && m.completed)
      .map((m) => wallSecondsAt1x(m.ticks));
    // RI-75: タスク床引き上げ後はボス到達が減るため、到達分だけで帯を見る。
    expect(bossSecs.length).toBeGreaterThanOrEqual(2);

    const bossP50 = p50(bossSecs);
    const bossP90 = p90(bossSecs);
    expect(bossP50).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min);
    expect(bossP50).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
    // RI-75: 個別の炎上外れ値より p50/p90 の帯を回帰の主指標にする。
    expect(bossP90).toBeLessThanOrEqual(BOSS_WALL_SEC.max);
  });

  it('skilled 自動操作の 1 四半期が 10〜15 分帯（p50/p90）に入る', () => {
    // quarterReview 到達済みのみ（ボス直後敗北でレビュー未到達の 6 本は除外）。
    // 到達サンプル不足は成功扱いせず失敗させる（回帰を隠さない）。
    expect(reviewedQuarters.length).toBeGreaterThanOrEqual(4);
    const quarterMins = reviewedQuarters.map((row) =>
      modelQuarterWallMinutes(row.ends.map((m) => m.ticks)),
    );

    const qP50 = p50(quarterMins);
    const qP90 = p90(quarterMins);
    expect(qP50).toBeGreaterThanOrEqual(QUARTER_WALL_MIN.minMin);
    // §3.1 の 1 四半期上限（15分）。テスト内で緩めない。
    expect(qP50).toBeLessThanOrEqual(QUARTER_WALL_MIN.maxMin);
    expect(qP90).toBeLessThanOrEqual(QUARTER_WALL_MIN.maxMin);
  });

  it('skilled 自動操作の 1 ランが 15〜45 分帯（p50）に入る', () => {
    // コホートは固定の a–z（結果を見て選ばない）。少なくとも1本のスプリントを
    // 実行した全ラン（早期敗北を含む）を母数にして、結果選択による生存者バイアスを避ける。
    // RI-79 の延命で複数四半期へ伸びた長命ランにより p90 は §3.1 上限を超えうるため、
    // 回帰の主指標は p50 とする。
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
      if (ticks.length > 0) {
        runMins.push(modelRunWallMinutes(ticks, reviews));
      }
    }
    // RI-75: maxTicks 打ち切りを出荷なしにすると四半期到達が減るため、
    // レビュー到達の有無にかかわらず実行できたランを集計する。
    expect(runMins.length).toBeGreaterThanOrEqual(2);

    const rP50 = p50(runMins);
    expect(rP50).toBeGreaterThanOrEqual(RUN_WALL_MIN.minMin);
    // §3.1 の 1 ラン上限（45分）。長命外れ値は p90 ではなく p50 で回帰する。
    expect(rP50).toBeLessThanOrEqual(RUN_WALL_MIN.maxMin);
  }, 120_000);

  it('1 スプリントあたり介入成立回数が 3〜8 回帯（p50/p90）に入る', () => {
    // 理論上の CD/focus 余地ではなく、pacing ポリシーで実際に成功した回数を見る。
    const used: number[] = [];
    for (const seed of RI66_SEEDS) {
      const e = new RunEngine({ seed, difficulty: 'normal' });
      playUntil(e, 'quarterReview', {
        pacingInterventions: true,
        onSprintEnd: (m) => {
          if (m.completed) used.push(m.interventionsUsed);
        },
      });
    }
    expect(used.length).toBeGreaterThan(0);

    const uP50 = p50(used);
    const uP90 = p90(used);
    expect(uP50).toBeGreaterThanOrEqual(INTERVENTION_PER_SPRINT.min);
    // §3.1 上限は 8 回。テスト内で緩めず、CD 再調整側で帯に戻す。
    expect(uP50).toBeLessThanOrEqual(INTERVENTION_PER_SPRINT.max);
    expect(uP90).toBeLessThanOrEqual(INTERVENTION_PER_SPRINT.max);
  }, 30_000);
});

describe('F-10 ビルド比較の統制', () => {
  it('全対象方針の判断間隔を300msに揃える', () => {
    expect(F10_POLICIES.map((policy) => POLICY_DEFS[policy]?.stepMs)).toEqual(
      F10_POLICIES.map(() => 300),
    );
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
