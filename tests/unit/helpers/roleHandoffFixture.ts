/** RI-274専用。人間の判断/会話を代用しない、実RunEngineを通る固定入力生成。 */
import { getEvent } from '../../../src/data/events';
import {
  createRoleHandoff,
  resumeRoleHandoff,
  type HandoffAction,
  type HandoffLever,
  type HandoffRequest,
  type RoleHandoff,
} from '../../../src/prototypes/roleHandoff';

export function handoffRequest(
  session: RoleHandoff,
  action: HandoffAction,
  requestId?: string,
): HandoffRequest {
  const view = session.view();
  return {
    requestId: requestId ?? `r${view.revision}`,
    revision: view.revision,
    role: view.role,
    phase: view.state.phase,
    action,
  };
}

export function runRoleHandoffCase(
  seed: string,
  investment: HandoffLever | null = null,
  cards = true,
  restart = false,
) {
  let session = createRoleHandoff(seed);
  const initial = session.view();
  const attempts: { request: HandoffRequest; ok: boolean; reason?: string }[] = [];
  const phases = new Set<string>();
  let resumed = false;
  const send = (action: HandoffAction) => {
    const request = handoffRequest(session, action, `a${attempts.length}`);
    const result = session.dispatch(request);
    attempts.push({ request, ok: result.ok, ...(!result.ok ? { reason: result.reason } : {}) });
    return result.ok;
  };
  for (let guard = 0; guard < 1000 && session.view().state.status === 'playing'; guard += 1) {
    const view = session.view();
    const state = view.state;
    phases.add(state.phase);
    if (restart && !resumed && state.phase === 'sprint' && state.sprintTick > 0) {
      const result = resumeRoleHandoff(session.save());
      if (!result.ok) throw new Error('resume failed');
      session = result.session;
      resumed = true;
    }
    switch (state.phase) {
      case 'setup':
        if (
          investment &&
          state.sprintsPlayed === 0 &&
          !view.reservation &&
          !send({ kind: 'reserve', leverId: investment })
        )
          throw new Error('reserve failed');
        if (!send({ kind: 'handoff' })) throw new Error('setup handoff failed');
        break;
      case 'sprint': {
        if (cards) {
          for (const deckIndex of state.sprint?.cardPiles.hand ?? []) {
            send({ kind: 'play', deckIndex });
            if (session.view().state.status !== 'playing') break;
          }
        }
        if (session.view().state.phase !== 'sprint') break;
        // 全ケース同じ現場方針。失敗した介入もattemptsに残す。
        send({ kind: 'intervene', id: 'pairReview' });
        const tasks = session.view().state.sprint?.tasks ?? [];
        if (tasks.filter((task) => task.lane === 'review').length >= 6)
          send({ kind: 'intervene', id: 'interruptReview' });
        const fires = tasks.filter((task) => task.lane === 'rework' && task.incident);
        if (fires.length >= 2 || fires.some((task) => (task.burnTicksLeft ?? Infinity) <= 15))
          send({ kind: 'intervene', id: 'firefight' });
        if (!send({ kind: 'step', ms: 1000 })) throw new Error('step failed');
        break;
      }
      case 'result':
        send({ kind: view.role === 'field' ? 'handoff' : 'ackResult' });
        break;
      case 'draft':
        send({ kind: 'draft', cardId: state.draft?.[0] ?? null });
        break;
      case 'evolution':
        send({ kind: 'finishEvolution' });
        break;
      case 'beat': {
        const choices = getEvent(state.beat!.eventId)!.choices;
        const choice =
          state.beat!.kind === 'judgment'
            ? 0
            : Math.max(
                0,
                choices.findIndex(
                  (choice) => !choice.outcome.grantRecruit && !choice.outcome.forceLose,
                ),
              );
        send({ kind: 'beat', choice });
        break;
      }
      case 'shop':
        send({ kind: 'leaveShop' });
        break;
      case 'rest':
        send({ kind: 'rest', option: 'heal' });
        break;
      case 'recruit':
        send({ kind: 'recruit', option: 'skip' });
        break;
      case 'quarterReview':
        send({
          kind: 'quarterReview',
          adjustment:
            state.quarterReview?.outcome === 'missed_adjustable'
              ? state.quarterReview.availableAdjustments[0]
              : null,
        });
        break;
      default:
        throw new Error(`unexpected phase ${state.phase}`);
    }
  }
  const final = session.view();
  if (final.state.status === 'playing') throw new Error('fixed policy did not finish naturally');
  return {
    initial,
    attempts,
    receipts: session.history(),
    final,
    phases: [...phases],
    resumed,
    save: session.save(),
  };
}
