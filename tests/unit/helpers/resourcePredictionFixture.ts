/** RI-277固定方針。人間の予想/適応/学習を代用しない。 */
import {
  ResourcePredictionPractice,
  type ResourceCommand,
} from '../../../src/prototypes/resourcePrediction';

export function resourceSend(session: ResourcePredictionPractice, command: ResourceCommand) {
  return session.apply({ revision: session.view().revision, command });
}

export function runResourcePractice(seed: string, pairReview = false, skip = false) {
  const session = new ResourcePredictionPractice(seed);
  const initial = session.view();
  const attempts: { revision: number; command: ResourceCommand; ok: boolean }[] = [];
  const send = (command: ResourceCommand) => {
    const revision = session.view().revision;
    const ok = session.apply({ revision, command });
    attempts.push({ revision, command, ok });
    return ok;
  };
  send(skip ? { type: 'skip' } : { type: 'predict', choice: 'reviewQueue', source: 'self' });
  send({ type: 'begin' });
  for (let guard = 0; guard < 1600 && session.view().phase === 'running'; guard += 1) {
    if (pairReview) send({ type: 'intervene', id: 'pairReview' });
    if (!send({ type: 'step' })) throw new Error('practice cannot progress');
  }
  if (session.view().phase !== 'complete') throw new Error('practice did not finish');
  if (ResourcePredictionPractice.restore(session.save())?.save() !== session.save())
    throw new Error('practice replay mismatch');
  return { session, initial, attempts };
}
