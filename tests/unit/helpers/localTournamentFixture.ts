/** RI-299専用。公開RunEngine操作と既存の固定方針で実際に終端まで走らせる。 */
import { RunEngine } from '../../../src/sim/run/engine';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { CURRENT_RUN_RULESET } from '../../../src/state/runPersistence';
import { advance } from './runFlow';

export function recordTournamentReplay(seed: string, skilled: boolean): ReplayBlob {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun('normal', [], seed);
  const start = engine.exportReplayFrame();
  if (!start) throw new Error('missing start');
  let steps = 0;
  while (engine.snapshot().status === 'playing' && steps < 40_000) {
    if (!advance(engine, { skilled })) throw new Error('autoplay stopped');
    steps += 1;
  }
  const state = engine.snapshot();
  if (state.status === 'playing') throw new Error('autoplay limit');
  const end = engine.exportReplayFrame();
  if (!end) throw new Error('missing terminal');
  // 比較用に開始・終端だけを残す。途中経過の比較は主張しない。
  const keyframes: ReplayBlob['keyframes'] = [
    { phase: start.phase, frame: start },
    { phase: end.phase, frame: end },
  ];
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: `${seed}:${skilled ? 'skilled' : 'plain'}`,
    seed,
    difficulty: 'normal',
    trials: [],
    finishedAt: 0,
    outcome: {
      status: state.status,
      winType: state.winType,
      loseReason: state.loseReason,
      diagnosis: state.diagnosis,
      score: state.totals.delivered,
    },
    keyframes,
    ruleset: { ...CURRENT_RUN_RULESET },
    contentSnapshot: snapshotReplayContent(keyframes),
  };
}
