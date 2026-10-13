/**
 * Isolated copy of the #730 review-bot lane model for #573 Phase 1.
 * No imports from src/sim, src/data, or src/prototypes.
 */

import { FROZEN, compositionKinds, falsePositiveRateList } from './params.mjs';

export { FROZEN, compositionKinds, falsePositiveRateList };

/** Isolated copy of src/sim/rng.ts hashSeed / mulberry32. */
export function hashSeed(seed) {
  if (typeof seed === 'number') return seed >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  return mulberry32(hashSeed(seed));
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function createJob(id, kind, mode, falsePositive) {
  const spec = FROZEN.job[kind];
  const botRoute = mode === 'dedicated' && kind === FROZEN.botEligibleKind;
  return {
    id,
    kind,
    value: spec.value,
    stage: botRoute ? 'bot' : 'human',
    humanLeft: spec.humanLeft,
    botLeft: spec.botLeft,
    falsePositive,
    route: botRoute ? 'bot' : 'human',
    humanQueuedAt: botRoute ? null : 0,
    reviewEligibleTick: 0,
    stintStarted: false,
    queueWaitTicks: 0,
  };
}

export function createReviewLaneState(seed, kinds, mode, falsePositiveRate, overrides = {}) {
  const rng = createRng(seed);
  return {
    version: 1,
    tick: 0,
    deadline: overrides.deadline ?? FROZEN.deadline,
    mode,
    coefficient: FROZEN.coefficient,
    jobs: kinds.map((kind, id) => createJob(id, kind, mode, rng() < falsePositiveRate)),
    humanSpent: 0,
    botSpent: 0,
    triageSpent: 0,
    falsePositives: 0,
  };
}

function recordQueueWait(job, firstWorkTick) {
  if (job.stintStarted) return;
  job.queueWaitTicks += Math.max(0, firstWorkTick - job.reviewEligibleTick - 1);
  job.stintStarted = true;
}

/** #730 tick rules plus per-stint review queue wait. */
export function tickReviewLane(state) {
  if (state.tick >= state.deadline) return state;
  const next = {
    ...state,
    tick: state.tick + 1,
    jobs: state.jobs.map((job) => ({ ...job })),
  };
  let human = state.mode === 'dedicated' ? FROZEN.humanEffortPerTickDedicated : FROZEN.staffSlots;
  if (state.mode === 'coefficient') human *= state.coefficient;
  let bot = state.mode === 'dedicated' ? FROZEN.botEffortPerTickDedicated : 0;
  let verification = FROZEN.verificationPerTick;
  if (state.mode === 'dedicated' && state.tick === 0) {
    next.humanSpent += human;
    human = 0;
  }
  const indexed = state.jobs.map((job, index) => ({ job, index }));
  const processingOrder = [
    ...indexed.filter(({ job }) => job.stage === 'bot'),
    ...indexed
      .filter(({ job }) => job.stage === 'human')
      .sort((a, b) => a.job.humanQueuedAt - b.job.humanQueuedAt || a.job.id - b.job.id),
    ...indexed.filter(({ job }) => job.stage === 'verification'),
  ];
  for (const { index } of processingOrder) {
    const before = state.jobs[index];
    const job = next.jobs[index];
    if (before.stage === 'bot') {
      const work = Math.min(bot, before.botLeft);
      if (work > 0) recordQueueWait(job, next.tick);
      job.botLeft -= work;
      bot -= work;
      next.botSpent += work;
      if (job.botLeft === 0) {
        if (job.falsePositive) {
          job.stage = 'human';
          job.route = 'fallback';
          job.humanLeft += FROZEN.rework.triageEffort;
          job.humanQueuedAt = next.tick;
          job.reviewEligibleTick = next.tick;
          job.stintStarted = false;
          next.falsePositives += 1;
        } else {
          job.stage = 'verification';
        }
      }
    } else if (before.stage === 'human') {
      const work = Math.min(human, before.humanLeft);
      if (work > 0) recordQueueWait(job, next.tick);
      if (before.route === 'fallback' && before.humanLeft > FROZEN.job.routine.humanLeft) {
        next.triageSpent += Math.min(work, before.humanLeft - FROZEN.job.routine.humanLeft);
      }
      job.humanLeft = Math.max(0, before.humanLeft - work);
      if (job.humanLeft < 1e-9) job.humanLeft = 0;
      human -= work;
      next.humanSpent += work;
      if (job.humanLeft === 0) job.stage = 'verification';
    } else if (before.stage === 'verification' && verification > 0) {
      job.stage = 'done';
      verification -= 1;
    }
  }
  return next;
}

export function runUntilDeadline(state) {
  let current = state;
  while (current.tick < current.deadline) current = tickReviewLane(current);
  return current;
}

export function summarizeLane(state) {
  const shipped = state.jobs.filter((job) => job.stage === 'done');
  return {
    shippedCount: shipped.length,
    medianReviewWaitTicks: median(shipped.map((job) => job.queueWaitTicks)),
    deliveredValue: shipped.reduce((total, job) => total + job.value, 0),
    pending: state.jobs.length - shipped.length,
    falsePositives: state.falsePositives,
    triageSpent: state.triageSpent,
    humanSpent: Math.round(state.humanSpent * 100) / 100,
    botSpent: state.botSpent,
  };
}

export function runCell({ seed, composition, fpRate, arm, ...overrides }) {
  const kinds =
    overrides.kinds ?? compositionKinds(composition, overrides.itemCount ?? FROZEN.itemCount);
  let state = createReviewLaneState(seed, kinds, arm, fpRate, overrides);
  if (overrides.forceFalsePositive !== undefined) {
    state = {
      ...state,
      jobs: state.jobs.map((job) => ({ ...job, falsePositive: overrides.forceFalsePositive })),
    };
  }
  const finished = runUntilDeadline(state);
  return {
    seed,
    composition,
    fpRate,
    arm,
    ...summarizeLane(finished),
  };
}

export function runMatrix() {
  const results = [];
  for (const seed of FROZEN.seeds) {
    for (const composition of FROZEN.compositions) {
      for (const fpRate of falsePositiveRateList()) {
        for (const arm of FROZEN.arms) {
          results.push(runCell({ seed, composition, fpRate, arm }));
        }
      }
    }
  }
  return results;
}

/** Trivial 1-job / 4-tick case. Not part of the frozen comparison matrix. */
export function runSmoke() {
  return runCell({
    seed: 'smoke-573',
    composition: 'routine-heavy',
    fpRate: 0,
    arm: 'dedicated',
    kinds: ['routine'],
    itemCount: 1,
    deadline: 4,
    forceFalsePositive: false,
  });
}

export function formatComparisonTable(rows) {
  const headers = ['seed', 'composition', 'fpRate', 'arm', 'shippedCount', 'medianReviewWaitTicks'];
  const align = {
    seed: '---',
    composition: '---',
    fpRate: '---:',
    arm: '---',
    shippedCount: '---:',
    medianReviewWaitTicks: '---:',
  };
  const lines = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map((header) => align[header]).join(' | ')} |`,
  ];
  for (const row of rows) {
    const wait = row.medianReviewWaitTicks === null ? 'null' : String(row.medianReviewWaitTicks);
    lines.push(
      `| ${row.seed} | ${row.composition} | ${row.fpRate} | ${row.arm} | ${row.shippedCount} | ${wait} |`,
    );
  }
  return lines.join('\n');
}

export function comparisonPayload(rows) {
  return {
    frozen: FROZEN,
    cellCount: rows.length,
    results: rows.map((row) => ({
      seed: row.seed,
      composition: row.composition,
      fpRate: row.fpRate,
      arm: row.arm,
      shippedCount: row.shippedCount,
      medianReviewWaitTicks: row.medianReviewWaitTicks,
    })),
  };
}
