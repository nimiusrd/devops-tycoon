/** 採用の局所RNGを表示と確定で共有する。ランのRNG・ロスターを変更しない。 */
import { pickRecruitArchetype, recruitMember, type RosterState } from '../member';
import { createRng } from '../rng';

export function recruitPhaseKey(quarterNumber: number, sprintIndexInQuarter: number): string {
  return `recruit-phase:q${quarterNumber}:s${sprintIndexInQuarter + 1}`;
}

export function planRecruitment(seed: string, rngKey: string, roster: RosterState) {
  const rng = createRng(`${seed}:${rngKey}`);
  const archetype = pickRecruitArchetype(rng);
  return { archetype, roster: recruitMember(roster, archetype, rng) };
}
