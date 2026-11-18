/** RI-259: 架空サービス停止の独立試作。通常sim・UI・保存・rulesetには接続しない。 */
export type OutageFeatureId = 'notifications' | 'reports';
export type OutageRoute = 'alternative' | 'reduced';
export type OutageStrategy = 'none' | OutageRoute;
export type OutageInput =
  | { type: 'view' }
  | { type: 'respond'; feature: OutageFeatureId; route: OutageRoute }
  | { type: 'resume'; feature: OutageFeatureId }
  | { type: 'advance' };

interface OutageFeature {
  id: OutageFeatureId;
  dependency: 'relay-cloud';
  job: string;
  fullValue: number;
  reducedValue: number;
  alternativeWork: number;
  reductionWork: number;
  verificationWork: number;
  reconnectWork: number;
  maintenanceWork: number;
  route: OutageRoute | null;
  respondedAt: number | null;
  implementationLeft: number;
  verificationLeft: number;
  readyAt: number | null;
  resumeRequested: boolean;
  reconnectLeft: number;
  resumedAt: number | null;
}

type FeatureMode = 'native' | 'stopped' | OutageRoute;
interface OutagePeriod {
  tick: number;
  provider: 'up' | 'down';
  providerEvent: 'stopped' | 'recovered' | null;
  implementation: number;
  verification: number;
  reconnect: number;
  unrelatedWork: number;
  normalWork: number;
  features: { id: OutageFeatureId; mode: FeatureMode; value: number }[];
}

/** version 1 は信頼済み試作JSON専用。通常セーブの読込形式ではない。 */
export interface ServiceOutageState {
  version: 1;
  seed: string;
  tick: number;
  activeTicks: number;
  capacity: number;
  outageAt: number;
  recoveryAt: number;
  unrelatedJob: { id: 'catalog'; dependency: null; workPerTick: number };
  features: OutageFeature[];
  periods: OutagePeriod[];
  inputs: OutageInput[];
}

export function createServiceOutageBoss(seed = 'RI-259', outageTicks = 5): ServiceOutageState {
  if (!Number.isInteger(outageTicks) || outageTicks < 1 || outageTicks > 7) {
    throw new RangeError('停止期間は1〜7tick');
  }
  return {
    version: 1,
    seed,
    tick: 0,
    activeTicks: 8,
    capacity: 4,
    outageAt: 2,
    recoveryAt: 2 + outageTicks,
    unrelatedJob: { id: 'catalog', dependency: null, workPerTick: 1 },
    features: (['notifications', 'reports'] as const).map((id) => ({
      id,
      dependency: 'relay-cloud',
      job: id === 'notifications' ? 'delivery' : 'aggregation',
      fullValue: id === 'notifications' ? 6 : 4,
      reducedValue: id === 'notifications' ? 3 : 2,
      alternativeWork: 5,
      reductionWork: 1,
      verificationWork: 1,
      reconnectWork: 2,
      maintenanceWork: 3,
      route: null,
      respondedAt: null,
      implementationLeft: 0,
      verificationLeft: 0,
      readyAt: null,
      resumeRequested: false,
      reconnectLeft: 0,
      resumedAt: null,
    })),
    periods: [],
    inputs: [],
  };
}

function phaseOf(state: ServiceOutageState) {
  if (state.tick === 0) return 'prepare';
  if (state.tick > state.activeTicks) return 'result';
  return state.tick < state.outageAt ? 'start' : 'peak';
}

function providerDown(state: ServiceOutageState) {
  return state.tick >= state.outageAt && state.tick < state.recoveryAt;
}

function modeOf(state: ServiceOutageState, feature: OutageFeature): FeatureMode {
  if (feature.readyAt !== null) {
    if (feature.route === 'alternative') return 'alternative';
    if (feature.resumedAt === null) return 'reduced';
  }
  return providerDown(state) ? 'stopped' : 'native';
}

function canResume(state: ServiceOutageState, feature: OutageFeature) {
  return (
    state.tick >= state.recoveryAt &&
    state.tick <= state.activeTicks &&
    feature.route === 'reduced' &&
    feature.readyAt !== null &&
    !feature.resumeRequested
  );
}

export function applyServiceOutageBoss(
  state: ServiceOutageState,
  input: OutageInput,
): ServiceOutageState {
  if (input.type === 'view' || phaseOf(state) === 'result') return state;
  if (input.type === 'respond') {
    const feature = state.features.find((item) => item.id === input.feature);
    if (
      !providerDown(state) ||
      !feature ||
      feature.route !== null ||
      !(['alternative', 'reduced'] as const).includes(input.route)
    )
      return state;
  }
  if (input.type === 'resume') {
    const feature = state.features.find((item) => item.id === input.feature);
    if (!feature || !canResume(state, feature)) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'respond') {
    const feature = next.features.find((item) => item.id === input.feature)!;
    feature.route = input.route;
    feature.respondedAt = next.tick;
    feature.implementationLeft =
      input.route === 'alternative' ? feature.alternativeWork : feature.reductionWork;
    feature.verificationLeft = feature.verificationWork;
    feature.reconnectLeft = input.route === 'reduced' ? feature.reconnectWork : 0;
  } else if (input.type === 'resume') {
    next.features.find((item) => item.id === input.feature)!.resumeRequested = true;
  } else if (next.tick === 0) {
    next.tick = 1;
  } else {
    const period: OutagePeriod = {
      tick: next.tick,
      provider: providerDown(next) ? 'down' : 'up',
      providerEvent:
        next.tick === next.outageAt
          ? 'stopped'
          : next.tick === next.recoveryAt
            ? 'recovered'
            : null,
      implementation: 0,
      verification: 0,
      reconnect: 0,
      unrelatedWork: next.unrelatedJob.workPerTick,
      normalWork: 0,
      features: [],
    };
    // 無関係なcatalog作業を先に確保。残り3枠を通知→集計の固定順に配分する。
    let room = next.capacity - period.unrelatedWork;
    for (const feature of next.features) {
      if (feature.route === null) continue;
      const implementation = Math.min(room, feature.implementationLeft);
      feature.implementationLeft -= implementation;
      period.implementation += implementation;
      room -= implementation;
      if (feature.implementationLeft === 0) {
        const verification = Math.min(room, feature.verificationLeft);
        feature.verificationLeft -= verification;
        period.verification += verification;
        room -= verification;
        if (feature.verificationLeft === 0 && feature.readyAt === null) {
          feature.readyAt = next.tick;
        }
      }
      if (feature.readyAt !== null && feature.resumeRequested && !providerDown(next)) {
        const reconnect = Math.min(room, feature.reconnectLeft);
        feature.reconnectLeft -= reconnect;
        period.reconnect += reconnect;
        room -= reconnect;
        if (feature.reconnectLeft === 0 && feature.resumedAt === null) {
          feature.resumedAt = next.tick;
        }
      }
    }
    period.normalWork = room;
    // 当該tickの検証完了を反映してから価値を計上する。実装だけでは復旧しない。
    period.features = next.features.map((feature) => {
      const mode = modeOf(next, feature);
      return {
        id: feature.id,
        mode,
        value:
          mode === 'stopped' ? 0 : mode === 'reduced' ? feature.reducedValue : feature.fullValue,
      };
    });
    next.periods.push(period);
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}

export function summarizeServiceOutageBoss(state: ServiceOutageState, carryCost = 2) {
  const featureValue = state.periods.reduce(
    (sum, period) => sum + period.features.reduce((value, feature) => value + feature.value, 0),
    0,
  );
  const normalWork = state.periods.reduce((sum, period) => sum + period.normalWork, 0);
  const unrelatedWork = state.periods.reduce((sum, period) => sum + period.unrelatedWork, 0);
  const features = state.features.map((feature) => {
    const observations = state.periods.filter((period) => period.tick >= state.outageAt);
    const firstFull = observations.find((period) => {
      const mode = period.features.find((item) => item.id === feature.id)!.mode;
      return mode === 'native' || mode === 'alternative';
    });
    const modes = observations.map(
      (period) => period.features.find((item) => item.id === feature.id)!.mode,
    );
    return {
      id: feature.id,
      route: feature.route,
      respondedAt: feature.respondedAt,
      readyAt: feature.readyAt,
      resumedAt: feature.resumedAt,
      fullRestoredAt: firstFull?.tick ?? null,
      stoppedTicks: modes.filter((mode) => mode === 'stopped').length,
      reducedTicks: modes.filter((mode) => mode === 'reduced').length,
      implementationLeft: feature.implementationLeft,
      verificationLeft: feature.verificationLeft,
      reconnectLeft: feature.reconnectLeft,
      maintenanceWork: feature.route === 'alternative' ? feature.maintenanceWork : 0,
    };
  });
  const implementation = state.periods.reduce((sum, period) => sum + period.implementation, 0);
  const verification = state.periods.reduce((sum, period) => sum + period.verification, 0);
  const reconnect = state.periods.reduce((sum, period) => sum + period.reconnect, 0);
  const remainingResponseWork = features.reduce(
    (sum, feature) =>
      sum + feature.implementationLeft + feature.verificationLeft + feature.reconnectLeft,
    0,
  );
  const maintenanceWork = features.reduce((sum, feature) => sum + feature.maintenanceWork, 0);
  const carryoverWork = remainingResponseWork + maintenanceWork;
  return {
    completed: phaseOf(state) === 'result',
    featureValue,
    implementation,
    verification,
    reconnect,
    responseWork: implementation + verification + reconnect,
    unrelatedWork,
    normalWork,
    features,
    remainingResponseWork,
    maintenanceWork,
    carryoverWork,
    providerRecoveryPending: state.recoveryAt > state.activeTicks,
    carryCost,
    developmentValuePerWork: 2,
    comparisonValue: featureValue + (normalWork + unrelatedWork) * 2 - carryoverWork * carryCost,
    continued: true,
  };
}

export function viewServiceOutageBoss(state: ServiceOutageState) {
  const lastPeriod =
    phaseOf(state) === 'result' ? state.periods[state.periods.length - 1] : undefined;
  return {
    phase: phaseOf(state),
    tick: state.tick,
    activeTicks: state.activeTicks,
    capacity: state.capacity,
    outageAt: state.outageAt,
    recoveryAt: state.recoveryAt,
    provider: lastPeriod?.provider ?? (providerDown(state) ? 'down' : 'up'),
    unrelatedJob: structuredClone(state.unrelatedJob),
    features: state.features.map((feature) => ({
      ...structuredClone(feature),
      mode:
        lastPeriod?.features.find((item) => item.id === feature.id)?.mode ?? modeOf(state, feature),
      canRespond: providerDown(state) && state.tick <= state.activeTicks && feature.route === null,
      canResume: canResume(state, feature),
    })),
    periods: structuredClone(state.periods),
    result: phaseOf(state) === 'result' ? summarizeServiceOutageBoss(state) : null,
  };
}

/** 固定方針。初回対応tickと停止期間は全方針で共通、縮小は復旧後すぐ再開指示。 */
export function compareServiceOutageBoss(outageTicks = 5, responseAt = 2) {
  return (['none', 'alternative', 'reduced'] as const).map((strategy) => {
    const initial = createServiceOutageBoss('RI-259', outageTicks);
    let state = initial;
    while (phaseOf(state) !== 'result') {
      const view = viewServiceOutageBoss(state);
      const respond = view.features.find(
        (feature) => feature.canRespond && view.tick >= responseAt,
      );
      const resume = view.features.find((feature) => feature.canResume);
      const input: OutageInput =
        strategy !== 'none' && respond
          ? { type: 'respond', feature: respond.id, route: strategy }
          : strategy === 'reduced' && resume
            ? { type: 'resume', feature: resume.id }
            : { type: 'advance' };
      state = applyServiceOutageBoss(state, input);
    }
    return {
      strategy,
      responseAt,
      initial,
      inputs: state.inputs,
      periods: state.periods,
      result: summarizeServiceOutageBoss(state),
      sensitivity: [0, 6].map((cost) => summarizeServiceOutageBoss(state, cost)),
    };
  });
}
