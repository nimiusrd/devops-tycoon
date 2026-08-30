import { describe, expect, it } from 'vitest';
import {
  SCHEDULED_MUTATION_FILE_LIMIT,
  planScheduledMutation,
} from '../../../scripts/scheduled-mutation-targets.mjs';

describe('scheduled mutation targets', () => {
  it('変更されたコア実装だけを重複なく対象にする', () => {
    const plan = planScheduledMutation([
      'src/sim/rng.ts',
      './src/sim/rng.ts',
      'src/state/meta.ts',
      'src/sim/types.ts',
      'src/state/index.ts',
      'src/sim/rng.test.ts',
      'src/ui/App.tsx',
      '',
    ]);

    expect(plan.changed).toEqual(['src/sim/rng.ts', 'src/state/meta.ts']);
    expect(plan.targets).toEqual(['src/sim/rng.ts', 'src/state/meta.ts']);
    expect(plan.mutate).toBe('src/sim/rng.ts,src/state/meta.ts');
    expect(plan.cache).toMatch(/^[0-9a-f]{12}$/);
    expect(plan.needsAttention).toBe(false);
  });

  it('60分枠を超える重い対象は自動実行しない', () => {
    const plan = planScheduledMutation([
      'src/sim/run/engine.ts',
      'src/sim/sprint.ts',
      'src/sim/rng.ts',
    ]);

    expect(plan.heavy).toEqual(['src/sim/run/engine.ts', 'src/sim/sprint.ts']);
    expect(plan.targets).toEqual(['src/sim/rng.ts']);
    expect(plan.mutate).toBe('src/sim/rng.ts');
    expect(plan.cache).not.toBe('');
    expect(plan.needsAttention).toBe(true);
  });

  it('対象が上限を超えた場合は自動実行せず要確認にする', () => {
    const files = Array.from(
      { length: SCHEDULED_MUTATION_FILE_LIMIT + 1 },
      (_, index) => `src/sim/generated-${index}.ts`,
    );
    const plan = planScheduledMutation(files);

    expect(plan.tooLarge).toBe(true);
    expect(plan.targets).toEqual([]);
    expect(plan.mutate).toBe('');
    expect(plan.cache).toBe('');
    expect(plan.needsAttention).toBe(true);
  });
});
