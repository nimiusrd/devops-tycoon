import { describe, expect, it } from 'vitest';
import { officeActorMotion, officeLight } from '../../../src/render/officeAtmosphere';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

describe('オフィスの稼働感', () => {
  const working = { lane: 'coding', count: 3, mood: 'neutral' } as const;
  it('通常の稼働灯より疲労時は暗く、混乱時は危険色、出荷は健全色になる', () => {
    expect(officeLight({ ...working, count: 0 }).alpha).toBeLessThan(officeLight(working).alpha);
    expect(officeLight({ ...working, mood: 'exhausted' }).alpha).toBeLessThan(
      officeLight(working).alpha,
    );
    expect(officeLight({ ...working, mood: 'panic' }).color).toBe(
      VISUAL_TOKENS.colors.health.reviewHell,
    );
    expect(officeLight({ ...working, lane: 'done' }).color).toBe(
      VISUAL_TOKENS.colors.health.healthy,
    );
  });
  it('作業中は手元へ動き、疲弊や待機時には作業動作を止め、静止位相では全員停止する', () => {
    expect(officeActorMotion(working, 600).x).toBeGreaterThan(0);
    expect(officeActorMotion({ ...working, count: 0 }, 600).x).toBe(0);
    for (const mood of ['neutral', 'tired', 'exhausted', 'panic', 'cheer'] as const) {
      expect(officeActorMotion({ ...working, mood }, 0)).toEqual({ x: 0, y: 0, rotation: 0 });
    }
    expect(officeActorMotion({ ...working, mood: 'exhausted' }, 600).rotation).toBe(0);
  });
});
