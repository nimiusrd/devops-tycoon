/**
 * Issue #660 隔離シミュレーション。
 * #732 の盤面・介入費用・救済条件を複製する。本番の applyAction / stepSprint は import しない。
 *
 * 進行は期限と圧力の加算モデル。無介入の基準値は #732 実測、滞留×2 / 流入×2 は倍率だけを掛ける。
 */
import {
  ACTIONS,
  BOARDS,
  COPIED_FROM_732,
  DELTAS,
  PARAMS,
  REPRESENTATIVE_ORDERS,
  RESCUE_RULE,
  UNATTENDED,
} from './params.mjs';
import { createRng } from './rng.mjs';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createDraws(rng) {
  const draws = [];
  for (let i = 0; i < PARAMS.reviewDrawCount; i += 1) {
    draws.push(
      Object.freeze({
        incident: rng() < PARAMS.incidentProbability,
        rework: rng() < PARAMS.reworkProbability,
      }),
    );
  }
  return Object.freeze(draws);
}

function applyBoardLayout(tasks, board) {
  for (const task of tasks) {
    if (task.id < 6) {
      task.kind = 'complex';
      task.lane = 'review';
      task.aiAssisted = true;
    } else if (task.id < 8) {
      task.lane = 'rework';
      task.incident = true;
      task.burnTicksLeft = task.id === 6 ? 50 : 70;
    }
  }
  if (board.id === 'review-stall-x2') {
    for (const task of tasks) {
      if (task.id >= 8 && task.id < 14) task.lane = 'review';
    }
  }
}

export function reviewCountAt(boardId, tick, prior) {
  const board = BOARDS[boardId];
  const intake = Math.min(board.backlog, Math.floor(tick * DELTAS.intakePerTick[boardId]));
  let stopped = 0;
  if (prior.andonTick !== undefined) {
    const haltUntil = prior.andonTick + COPIED_FROM_732.andon.durationTicks;
    const blocked = Math.max(0, Math.min(tick, haltUntil) - prior.andonTick);
    stopped = Math.min(board.backlog, Math.floor(blocked * DELTAS.intakePerTick[boardId]));
  }
  return board.reviewWaiting + intake - stopped - prior.reviewed;
}

function firefightHpCost(priorUses, urgent) {
  if (!urgent) return COPIED_FROM_732.firefight.lightHpCost;
  return Math.min(
    COPIED_FROM_732.firefight.hpCostMax,
    COPIED_FROM_732.firefight.hpCost + priorUses * COPIED_FROM_732.firefight.hpEscalation,
  );
}

export function createBoard(boardId, seed = PARAMS.seed) {
  const board = BOARDS[boardId];
  if (!board) throw new Error(`unknown board: ${boardId}`);
  const rng = createRng(seed);
  const tasks = [];
  for (let id = 0; id < PARAMS.taskCount; id += 1) {
    rng();
    rng();
    tasks.push({
      id,
      kind: id < 6 ? 'complex' : 'normal',
      highValue: false,
      aiAssisted: id < 6,
      lane: 'backlog',
      incident: false,
      burnTicksLeft: undefined,
    });
  }
  applyBoardLayout(tasks, board);
  const unattended = UNATTENDED[board.id];
  return {
    boardId: board.id,
    seed,
    tick: 0,
    limit: PARAMS.limitTicks,
    seniorHp: unattended.seniorHp,
    focus: PARAMS.focusMax,
    delivered: unattended.delivered,
    spread: unattended.spread,
    burning: unattended.burning,
    reviewWaiting: board.reviewWaiting,
    codingSlots: board.codingSlots,
    tasks,
    draws: createDraws(rng),
    drawIndex: 0,
    cooldowns: { interruptReview: 0, andon: 0, firefight: 0 },
    firefightUses: 0,
    interventions: 0,
    focusSpent: 0,
    reviewed: 0,
    andonTick: undefined,
    containedDeadlines: [],
    inputs: [],
  };
}

function nextLiveDeadline(state, tick) {
  return COPIED_FROM_732.burnDeadlines.find(
    (deadline) => deadline > tick && !state.containedDeadlines.includes(deadline),
  );
}

function applyAction(state, action) {
  if (!ACTIONS.includes(action)) throw new Error(`この課題では使えない介入: ${action}`);
  if (state.interventions >= PARAMS.maxSuccessfulInterventions) {
    return { ok: false, reason: 'intervention-limit' };
  }
  if ((state.cooldowns[action] ?? 0) > 0) return { ok: false, reason: 'cooldown' };

  const spec =
    action === 'interruptReview'
      ? COPIED_FROM_732.interruptReview
      : action === 'andon'
        ? COPIED_FROM_732.andon
        : COPIED_FROM_732.firefight;
  if (state.focus < spec.focusCost) return { ok: false, reason: 'no-focus' };

  if (action === 'interruptReview') {
    const queue = reviewCountAt(state.boardId, state.tick, state);
    if (queue < 1) return { ok: false, reason: 'no-target' };
    const cleared = Math.min(spec.reviewCount, queue);
    const bonus =
      cleared < spec.reviewCount
        ? cleared * 4
        : state.boardId === 'review-stall-x2'
          ? DELTAS.reviewDeliveredStall
          : DELTAS.reviewDelivered;
    state.delivered += bonus;
    state.seniorHp = clamp(state.seniorHp - spec.hpCost, 0, 100);
    state.reviewed += cleared;
    state.focus -= spec.focusCost;
    state.focusSpent += spec.focusCost;
    state.cooldowns.interruptReview = spec.cooldownTicks;
    state.interventions += 1;
    return {
      ok: true,
      effect: { actionId: action, cleared, delivered: bonus, hpCost: spec.hpCost },
    };
  }

  if (action === 'andon') {
    const queue = reviewCountAt(state.boardId, state.tick, state);
    const congested = queue >= spec.congestedReviewMin;
    if (!congested) {
      state.seniorHp = clamp(state.seniorHp - spec.thinHpCost, 0, 100);
      state.delivered += DELTAS.andonThinDelivered;
    } else {
      state.delivered += DELTAS.andonCongestedDelivered;
    }
    if (state.boardId === 'inflow-x2' && state.tick <= DELTAS.andonInflowRescueUntilTick) {
      state.delivered += DELTAS.andonInflowRescueDelivered;
      state.burning = Math.max(0, state.burning - 1);
      state.spread = Math.max(0, state.spread - 1);
    }
    state.andonTick = state.tick;
    state.focus -= spec.focusCost;
    state.focusSpent += spec.focusCost;
    state.cooldowns.andon = spec.cooldownTicks;
    state.interventions += 1;
    return { ok: true, effect: { actionId: action, congested, queue } };
  }

  const deadline = nextLiveDeadline(state, state.tick);
  if (deadline === undefined) return { ok: false, reason: 'no-target' };
  const remaining = COPIED_FROM_732.burnDeadlines.filter(
    (item) => item > state.tick && !state.containedDeadlines.includes(item),
  ).length;
  const urgent =
    remaining >= COPIED_FROM_732.firefight.urgentMinimumBurning ||
    deadline - state.tick <= COPIED_FROM_732.firefight.urgentBurnTicks;
  const hpCost = firefightHpCost(state.firefightUses, urgent);
  state.containedDeadlines.push(deadline);
  state.burning = Math.max(0, state.burning - 1);
  state.spread = Math.max(0, state.spread - 1);
  state.delivered += DELTAS.fireDelivered;
  state.seniorHp = clamp(state.seniorHp - hpCost + COPIED_FROM_732.autoContainHpCost, 0, 100);
  state.focus -= spec.focusCost;
  state.focusSpent += spec.focusCost;
  state.cooldowns.firefight = spec.cooldownTicks;
  state.firefightUses += 1;
  state.interventions += 1;
  return { ok: true, effect: { actionId: action, deadline, hpCost, urgent } };
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function tickBoard(state, action) {
  if (state.tick >= state.limit) return state;
  const next = cloneState(state);
  if (action !== undefined) {
    const outcome = applyAction(next, action);
    next.inputs.push({ tick: state.tick, action, outcome });
  }
  next.tick += 1;
  for (const key of ACTIONS) {
    if (next.cooldowns[key] > 0) next.cooldowns[key] -= 1;
  }
  return next;
}

export function summarize(state) {
  const ended = state.tick >= state.limit;
  const seniorHp = Math.round(state.seniorHp * 100) / 100;
  return {
    ended,
    rescued:
      ended &&
      state.delivered >= RESCUE_RULE.deliveredMin &&
      state.spread <= RESCUE_RULE.spreadMax &&
      seniorHp >= RESCUE_RULE.seniorHpMin &&
      state.burning === RESCUE_RULE.burningMax,
    delivered: Math.round(state.delivered * 100) / 100,
    spread: state.spread,
    burning: state.burning,
    seniorHp,
    interventions: state.interventions,
    focusSpent: state.focusSpent,
    tick: state.tick,
    drawsFingerprint: state.draws
      .map((draw) => `${draw.incident ? 'I' : '-'}${draw.rework ? 'R' : '-'}`)
      .join(''),
  };
}

export function runOrder(boardId, inputs, seed = PARAMS.seed) {
  let state = createBoard(boardId, seed);
  const plan = inputs ?? [];
  while (state.tick < state.limit) {
    const action = plan.find((input) => input.tick === state.tick)?.action;
    state = tickBoard(state, action);
  }
  return { boardId, seed, inputs: state.inputs, draws: state.draws, ...summarize(state) };
}

export function representativeResult(boardId, orderId, seed = PARAMS.seed) {
  return runOrder(boardId, REPRESENTATIVE_ORDERS[orderId], seed);
}

export function sharedDrawsFor(boardId, seed = PARAMS.seed) {
  return createBoard(boardId, seed).draws;
}

export function layoutOf(boardId, seed = PARAMS.seed) {
  const state = createBoard(boardId, seed);
  return {
    boardId,
    reviewWaiting: state.tasks.filter((task) => task.lane === 'review').length,
    burning: state.tasks.filter((task) => task.incident).length,
    backlog: state.tasks.filter((task) => task.lane === 'backlog').length,
    codingSlots: state.codingSlots,
    drawsFingerprint: summarize(state).drawsFingerprint,
  };
}
