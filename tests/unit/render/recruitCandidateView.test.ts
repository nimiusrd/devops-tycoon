import { describe, expect, it } from 'vitest';
import { RECRUIT_ARCHETYPES } from '../../../src/data/members';
import {
  recruitCandidateView,
  RECRUIT_WORK_SAMPLES,
} from '../../../src/render/recruitCandidateView';
import { RECRUIT_COST, ROSTER_CAP } from '../../../src/sim/member';
import { createRng } from '../../../src/sim/rng';
import { pickRecruitArchetype, recruitMember } from '../../../src/sim/member';
import { RunEngine } from '../../../src/sim/run/engine';

function recruiting(seed: string, budget = 100) {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun();
  const frame = engine.exportPersistState()!;
  frame.phase = 'recruit';
  frame.budget = budget;
  engine.hydratePersistState(frame);
  return engine;
}

describe('採用候補と仕事の例', () => {
  it('4アーキタイプに各1件の例があり、複数seedの実採用とプレビューが完全一致する', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 32; index += 1) {
      const engine = recruiting(`ri209-${index}`);
      const state = engine.snapshot();
      const preview = recruitCandidateView(state)!;
      const rng = createRng(`${state.seed}:recruit-phase:q1:s1`);
      const archetype = pickRecruitArchetype(rng);
      const oldResult = recruitMember(state.roster, archetype, rng);
      seen.add(archetype.id);
      expect(preview.sample).toBe(RECRUIT_WORK_SAMPLES[archetype.id]);
      expect(preview.member.stats).toEqual(archetype.stats);
      expect(preview.member.traits).toEqual(archetype.traits);
      engine.recruitChoose('hire');
      expect(engine.snapshot().roster).toEqual(oldResult);
      expect(engine.snapshot().roster.members.at(-1)).toEqual(preview.member);
      expect(engine.snapshot().budget).toBe(100 - RECRUIT_COST);
    }
    expect([...seen].sort()).toEqual(RECRUIT_ARCHETYPES.map((item) => item.id).sort());
    expect(Object.keys(RECRUIT_WORK_SAMPLES).sort()).toEqual([...seen].sort());
  });

  it('再描画・JSON保存再開でも候補が変わらず、ランの状態とRNGを消費しない', () => {
    const engine = recruiting('ri209-resume');
    const frame = engine.exportCounterfactualFrame();
    const preview = recruitCandidateView(engine.snapshot());
    expect(recruitCandidateView(engine.snapshot())).toEqual(preview);
    expect(engine.exportCounterfactualFrame()).toEqual(frame);
    const resumed = recruiting('different-seed');
    resumed.hydratePersistState(JSON.parse(JSON.stringify(engine.exportPersistState())));
    expect(recruitCandidateView(resumed.snapshot())).toEqual(preview);
    resumed.recruitChoose('hire');
    engine.recruitChoose('hire');
    expect(resumed.snapshot().roster).toEqual(engine.snapshot().roster);
  });

  it('四半期・スプリントと既存名の重複を含め、実際の採用経路と一致する', () => {
    const engine = recruiting('ri209-duplicate');
    const frame = engine.exportPersistState()!;
    frame.quarterNumber = 3;
    frame.sprintIndexInQuarter = 2;
    const rng = createRng(`${frame.seed}:recruit-phase:q3:s3`);
    const expected = recruitMember(frame.roster, pickRecruitArchetype(rng), rng).members.at(-1)!;
    frame.roster.members[0].name = expected.name;
    engine.hydratePersistState(frame);
    const preview = recruitCandidateView(engine.snapshot())!;
    expect(preview.member.name).not.toBe(expected.name);
    engine.recruitChoose('hire');
    expect(engine.snapshot().roster.members.at(-1)).toEqual(preview.member);
  });

  it('予算ちょうどでも同じ候補を採用してから敗北し、満員では候補を捏造しない', () => {
    const engine = recruiting('ri209-exact', RECRUIT_COST);
    const preview = recruitCandidateView(engine.snapshot())!;
    engine.recruitChoose('hire');
    expect(engine.snapshot().status).toBe('lost');
    expect(engine.snapshot().roster.members.at(-1)).toEqual(preview.member);
    const state = recruiting('ri209-full').snapshot();
    state.roster.members = Array.from({ length: ROSTER_CAP }, () => state.roster.members[0]);
    expect(recruitCandidateView(state)).toBeNull();
  });
});
