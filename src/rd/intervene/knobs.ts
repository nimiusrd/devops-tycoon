import type { PeriodActions, SeedId, TeamState } from './types';
import { PERIODS } from './types';

/**
 * 試作ノブ。仮説 H1–H4 を通すための調整はしない。
 * 値を変えたら PROTO.md とこのファイルを同時に更新する。
 */
export const KNOBS = {
  periods: PERIODS,
  skillId: 'throughput',
  skillLabel: '処理能力',
  metricMax: 100,
  incomingBase: 10,
  incomingPressure: 0.32,
  processRate: 0.4,
  crisisFromIncoming: 0.5,
  crisisFromProcess: 0.3,
  pressureFromIncoming: 0.18,
  pressureFromProcess: 0.14,
  outputFromProcess: 1,
  outputCrisisPenalty: 0.18,
  fatigueCarry: 0.82,
  fatigueFromOverload: 0.1,
  rngAmplitude: 3,
  company: {
    outputWeight: 1,
    crisisWeight: 0.4,
    fatigueWeight: 0.2,
  },
  support: {
    processMul: 1.6,
    pressureRelief: 20,
    crisisRelief: 24,
    fatigueAdd: 7,
    nextCapabilityAdd: 0,
    focusCost: 1,
  },
  train: {
    processMul: 0.72,
    pressureRelief: 3,
    crisisRelief: 2,
    fatigueAdd: 2,
    nextCapabilityAdd: 14,
    focusCost: 0,
  },
  delegate: {
    processMul: 1,
    pressureRelief: 0,
    crisisRelief: 0,
    fatigueAdd: 0,
    nextCapabilityAdd: 0,
    focusCost: 0,
  },
  alwaysInterveneTeam: 'alpha',
  trainThenDelegateTrainPeriods: 2,
  situation: {
    crisisSupportThreshold: 38,
    capabilityTrainThreshold: 50,
  },
} as const;

export const DEFAULT_ACTIONS: PeriodActions = {
  alpha: 'delegate',
  bravo: 'delegate',
  charlie: 'delegate',
};

export interface SeedDef {
  readonly id: SeedId;
  readonly label: string;
  readonly summary: string;
  readonly rngSeed: string;
  readonly teams: readonly TeamState[];
}

export const SEED_DEFS: Record<SeedId, SeedDef> = {
  crisis: {
    id: 'crisis',
    label: '逼迫',
    summary: '低成熟・高負荷。チームBの危機が最も大きい。',
    rngSeed: 'rd-intervene-crisis',
    teams: [
      {
        id: 'alpha',
        name: 'チームA',
        pressure: 70,
        capability: 36,
        crisis: 46,
        output: 0,
        fatigue: 22,
      },
      {
        id: 'bravo',
        name: 'チームB',
        pressure: 82,
        capability: 28,
        crisis: 62,
        output: 0,
        fatigue: 30,
      },
      {
        id: 'charlie',
        name: 'チームC',
        pressure: 64,
        capability: 40,
        crisis: 40,
        output: 0,
        fatigue: 18,
      },
    ],
  },
  stable: {
    id: 'stable',
    label: '安定',
    summary: '高成熟・低危機。委任でも回る想定の対照シナリオ。',
    rngSeed: 'rd-intervene-stable',
    teams: [
      {
        id: 'alpha',
        name: 'チームA',
        pressure: 30,
        capability: 74,
        crisis: 8,
        output: 0,
        fatigue: 10,
      },
      {
        id: 'bravo',
        name: 'チームB',
        pressure: 28,
        capability: 70,
        crisis: 6,
        output: 0,
        fatigue: 12,
      },
      {
        id: 'charlie',
        name: 'チームC',
        pressure: 32,
        capability: 72,
        crisis: 10,
        output: 0,
        fatigue: 11,
      },
    ],
  },
};

export const ACTION_LABELS: Record<'support' | 'train' | 'delegate', string> = {
  support: '直接支援',
  train: '育成',
  delegate: '委任',
};

export const ARM_LABELS: Record<
  'always-intervene' | 'train-then-delegate' | 'full-delegate' | 'situation',
  string
> = {
  'always-intervene': '常時1チーム介入',
  'train-then-delegate': '育成して委任',
  'full-delegate': '全委任',
  situation: '状況で選ぶ',
};
