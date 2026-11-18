/** RI-302。game.ts と同じ連続同phase置換で実RunEngineの全保存境界を記録する。 */
import { RunEngine } from '../../../src/sim/run/engine';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { CURRENT_RUN_RULESET } from '../../../src/state/runPersistence';
import { advance } from './runFlow';

export function recordSpectatorReplay(seed: string) {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed);
  const initial = engine.exportReplayFrame();
  const keyframes: ReplayBlob['keyframes'] = [];
  const capture = () => {
    const frame = engine.exportReplayFrame();
    if (!frame) return;
    const entry = { phase: frame.phase, frame };
    if (keyframes[keyframes.length - 1]?.phase === frame.phase)
      keyframes[keyframes.length - 1] = entry;
    else keyframes.push(entry);
  };
  capture();
  let advances = 0;
  while (engine.snapshot().status === 'playing' && advances < 40_000) {
    if (!advance(engine)) throw new Error('autoplay stopped');
    advances += 1;
    capture();
  }
  const final = engine.snapshot();
  if (final.status === 'playing') throw new Error('autoplay limit');
  const replay: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: `RI-302:${seed}`,
    seed,
    difficulty: 'normal',
    trials: [],
    finishedAt: 0,
    outcome: {
      status: final.status,
      winType: final.winType,
      loseReason: final.loseReason,
      diagnosis: final.diagnosis,
      score: final.totals.delivered,
    },
    keyframes,
    ruleset: { ...CURRENT_RUN_RULESET },
    contentSnapshot: snapshotReplayContent(keyframes),
  };
  return { replay, initial, policy: 'runFlow.advance defaults (plain)', advances };
}
