import { ACTION_LABELS, ARM_LABELS, KNOBS, SEED_DEFS } from './knobs';
import { totalsFromState } from './sim';
import type { ExperimentState } from './types';

export const EXPERIMENT_ID = 'rd-intervene';
export const ISSUE_NUMBER = 538;

export function exportJson(state: ExperimentState): string {
  const seed = SEED_DEFS[state.seedId];
  return `${JSON.stringify(
    {
      experiment: EXPERIMENT_ID,
      issue: ISSUE_NUMBER,
      notForProduction: true,
      seedId: state.seedId,
      seedLabel: seed.label,
      rngSeed: state.rngSeed,
      arm: state.arm,
      armLabel: state.arm === 'manual' ? '手動' : ARM_LABELS[state.arm],
      finished: state.finished,
      periodsTotal: state.periods,
      periods: state.logs,
      currentTeams: state.teams,
      plannedActions: state.plannedActions,
      totals: totalsFromState(state),
      knobs: KNOBS,
      formulas: {
        incoming: 'incomingBase + pressure * incomingPressure + rng(-amp, amp)',
        processed: 'capability * processRate * action.processMul',
        crisis:
          'clamp(crisis + incoming * crisisFromIncoming - processed * crisisFromProcess - action.crisisRelief)',
        pressure:
          'clamp(pressure + incoming * pressureFromIncoming - processed * pressureFromProcess - action.pressureRelief)',
        output: 'max(0, processed - crisis * outputCrisisPenalty)',
        fatigue:
          'clamp(fatigue * fatigueCarry + max(0, pressure + crisis - capability) * fatigueFromOverload + action.fatigueAdd)',
        nextCapability: 'clamp(capability + action.nextCapabilityAdd)  // 今期の処理には使わない',
        companyScore: 'sum(output) - 0.4 * sum(crisis) - 0.2 * sum(fatigue)',
        judgment: '前期と方針が違う期間を +1。維持は 0。閲覧は数えない。初期方針は全委任。',
      },
    },
    null,
    2,
  )}\n`;
}

export function exportTsv(state: ExperimentState): string {
  const header = [
    'seed',
    'arm',
    'period',
    'team',
    'action',
    'output',
    'fatigue',
    'crisis',
    'nextCapability',
    'companyScore',
    'judgmentDelta',
    'judgmentCount',
  ].join('\t');
  const rows = state.logs.flatMap((log) =>
    log.teams.map((team) =>
      [
        state.seedId,
        state.arm,
        String(log.period),
        team.id,
        ACTION_LABELS[team.action],
        String(team.output),
        String(team.fatigue),
        String(team.crisis),
        String(team.nextCapability),
        String(log.companyScore),
        String(log.judgmentDelta),
        String(log.judgmentCount),
      ].join('\t'),
    ),
  );
  const totals = totalsFromState(state);
  rows.push(
    [
      state.seedId,
      state.arm,
      'total',
      'company',
      '',
      String(totals.outputSum),
      String(totals.fatigueSum),
      String(totals.crisisSum),
      String(totals.nextCapabilitySum),
      String(totals.companyScoreSum),
      '',
      String(totals.judgmentCount),
    ].join('\t'),
  );
  return `${[header, ...rows].join('\n')}\n`;
}
