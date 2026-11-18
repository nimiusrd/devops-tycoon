/** RI-300: 実RunEngineでQ1を生成し、公開リレーAPIでQ2を比較する固定方針。 */
import { getEvent } from '../data/events';
import { getGoalAdjustment } from '../data/goalAdjustments';
import { RunEngine } from '../sim/run/engine';
import type { GoalAdjustmentId } from '../sim/run/types';
import { toRunSave } from '../state/runPersistence';
import {
  exportQuarterRelay,
  importQuarterRelay,
  type RelayInput,
  type RelaySession,
} from './quarterRelay';

function eventChoice(eventId: string, kind: string) {
  if (kind === 'judgment') return 0;
  const choices = getEvent(eventId)?.choices ?? [];
  const index = choices.findIndex(({ outcome }) => !outcome.grantRecruit && !outcome.forceLose);
  return Math.max(0, index);
}

/** 状態や履歴を手書きせず通常固定トラックを進む。成功入力・初期資源をすべて残す。 */
export function relayReviewFixture(seed = 'ri134-ma2-52') {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun();
  const initial = engine.exportPersistState()!;
  const inputs: unknown[] = [];
  let guard = 0;
  while (
    engine.snapshot().status === 'playing' &&
    engine.currentPhase() !== 'quarterReview' &&
    guard++ < 200
  ) {
    const s = engine.snapshot();
    switch (s.phase) {
      case 'setup':
        engine.beginSetupSprint();
        inputs.push({ type: 'begin' });
        break;
      case 'sprint': {
        let attempts = 0;
        while (engine.currentPhase() === 'sprint' && attempts++ < 24) {
          const hand = engine.snapshot().sprint?.cardPiles.hand ?? [];
          const played = hand.find((deckIndex) => {
            if (!engine.playCard(deckIndex).ok) return false;
            inputs.push({ type: 'playCard', deckIndex });
            return true;
          });
          if (played === undefined) break;
        }
        if (engine.currentPhase() === 'sprint') {
          engine.step(1_000_000);
          inputs.push({ type: 'tick', ms: 1_000_000 });
        }
        break;
      }
      case 'result':
        engine.acknowledgeResult();
        inputs.push({ type: 'result' });
        break;
      case 'draft':
        if (s.draft?.length) {
          engine.chooseCard(s.draft[0]);
          inputs.push({ type: 'chooseCard', cardId: s.draft[0] });
        } else {
          engine.skipDraft();
          inputs.push({ type: 'skipDraft' });
        }
        break;
      case 'evolution':
        engine.finishEvolution();
        inputs.push({ type: 'finishEvolution' });
        break;
      case 'beat': {
        const choiceIndex = eventChoice(s.beat!.eventId, s.beat!.kind);
        engine.resolveBeat(choiceIndex);
        inputs.push({ type: 'beat', choiceIndex });
        break;
      }
      case 'shop':
        engine.leaveShop();
        inputs.push({ type: 'leaveShop' });
        break;
      case 'rest':
        engine.restChoose('heal');
        inputs.push({ type: 'rest', option: 'heal' });
        break;
      case 'recruit':
        engine.recruitChoose('skip');
        inputs.push({ type: 'recruit', option: 'skip' });
        break;
      default:
        throw new Error(`Q1比較の未対応フェーズ: ${s.phase}`);
    }
  }
  const state = engine.exportPersistState();
  if (!state || state.phase !== 'quarterReview')
    return { initial, inputs, save: null, final: engine.snapshot() };
  return { initial, inputs, save: toRunSave(state, 0), final: engine.snapshot() };
}

type Command = RelayInput extends infer T
  ? T extends RelayInput
    ? Omit<T, 'sequence'>
    : never
  : never;
export function relayAct(session: RelaySession, command: Command) {
  return session.act(JSON.stringify({ ...command, sequence: session.view().acceptedInputs }));
}

export function advanceRelay(session: RelaySession, intervene = false) {
  const s = session.view().state;
  switch (s.phase) {
    case 'setup':
      return relayAct(session, { type: 'begin' });
    case 'sprint': {
      for (const deckIndex of [...(s.sprint?.cardPiles.hand ?? [])])
        relayAct(session, { type: 'playCard', deckIndex });
      if (intervene) relayAct(session, { type: 'dispatch', actionId: 'pairReview' });
      return session.view().complete ? { ok: true as const } : relayAct(session, { type: 'tick' });
    }
    case 'result':
      return relayAct(session, { type: 'result' });
    case 'draft':
      return s.draft?.length
        ? relayAct(session, { type: 'chooseCard', cardId: s.draft[0] })
        : relayAct(session, { type: 'skipDraft' });
    case 'evolution':
      return relayAct(session, { type: 'finishEvolution' });
    case 'beat':
      return relayAct(session, {
        type: 'beat',
        choiceIndex: eventChoice(s.beat!.eventId, s.beat!.kind),
      });
    case 'shop':
      return relayAct(session, { type: 'leaveShop' });
    case 'rest':
      return relayAct(session, { type: 'rest', option: 'heal' });
    case 'recruit':
      return relayAct(session, { type: 'recruit', option: 'skip' });
    default:
      throw new Error(`Q2比較の未対応フェーズ: ${s.phase}`);
  }
}

export function finishRelay(session: RelaySession, intervene = false) {
  let guard = 0;
  while (!session.view().complete && guard++ < 1000) {
    const applied = advanceRelay(session, intervene);
    if (!applied.ok) throw new Error(`Q2比較の入力失敗: ${JSON.stringify(applied)}`);
  }
  if (!session.view().complete) throw new Error('Q2比較上限');
  return session.view();
}

export function evaluateQuarterRelay(seeds = ['ri134-ma2-52', 'ri134-ma2-53', 'ri134-ma2-54']) {
  return seeds.map((seed) => {
    const source = relayReviewFixture(seed);
    if (source.final.quarterReview?.outcome !== 'missed_adjustable' || !source.save)
      return { seed, source, transfers: [] };
    // 既存の修正規則だけを一要因で比較。費用/係数はBALANCEと目標修正定義を変更しない。
    const adjustments: GoalAdjustmentId[] = ['cut_scope', 'quality_pivot'];
    const transfers = adjustments
      .filter((id) => source.final.quarterReview!.availableAdjustments.includes(id))
      .map((adjustment) => {
        const exported = exportQuarterRelay(JSON.stringify(source.save), {
          participant: '担当A',
          memo: 'Q1未達。投資と残余資源を確認してQ2を担当してください。',
          adjustment,
        });
        if (!exported.ok) throw new Error(exported.reason);
        const runs = [false, true].map((intervene) => {
          const opened = importQuarterRelay(exported.value, '担当B');
          if (!opened.ok) throw new Error(opened.reason);
          const final = finishRelay(opened.value, intervene);
          return {
            strategy: intervene ? 'cards-and-pairReview' : 'cards-only',
            result: final.result,
            costs: final.costs,
            budget: final.state.budget,
            org: final.state.org,
            totals: final.state.totals,
            sprints: final.state.sprintsPlayed,
            metaReward: final.metaReward,
            dailyReward: final.dailyReward,
            save: (() => {
              const { file: _file, ...saved } = JSON.parse(opened.value.save());
              return saved as unknown;
            })(),
          };
        });
        return {
          adjustment,
          definition: getGoalAdjustment(adjustment),
          file: JSON.parse(exported.value) as unknown,
          runs,
        };
      });
    return { seed, source, transfers };
  });
}
