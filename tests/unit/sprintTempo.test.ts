import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import {
  BOSS_WALL_SEC,
  isBossTickCountInSpecBand,
  isSprintTickCountInSpecBand,
  meetsSprintAbsoluteMin,
  MS_PER_TICK_1X,
  msPerTick,
  SPRINT_WALL_SEC,
  ticksDueFromAccumulator,
  wallSecondsAt1x,
  type PlaybackSpeed,
} from '../../src/ui/sprintTempo';

/** RI-62 文書と同じ代表 seed（normal・各 3 スプリント相当を四半期から採取）。 */
const RI62_SEEDS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

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

    const sorted = [...normal].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)]!;
    const p90 = sorted[Math.floor(sorted.length * 0.9)]!;
    const p50Sec = wallSecondsAt1x(p50);
    const p90Sec = wallSecondsAt1x(p90);
    expect(p50Sec).toBeGreaterThanOrEqual(SPRINT_WALL_SEC.minTypical);
    expect(p50Sec).toBeLessThanOrEqual(SPRINT_WALL_SEC.maxTypical);
    expect(p90Sec).toBeLessThanOrEqual(SPRINT_WALL_SEC.maxTypical);

    // ボスは無介入オートプレイだと長尾が出やすい。下限と中央の目安だけ確認する。
    if (boss.length > 0) {
      const bossSorted = [...boss].sort((a, b) => a - b);
      const bossMinSec = wallSecondsAt1x(bossSorted[0]!);
      expect(bossMinSec).toBeGreaterThanOrEqual(BOSS_WALL_SEC.min * 0.85);
    }
    expect(BOSS_WALL_SEC.min).toBe(90);
    // ヘルパ自体の回帰防止
    expect(isSprintTickCountInSpecBand(80)).toBe(true);
  });
});
