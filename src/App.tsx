/**
 * アプリのルート（SPEC 第3章 のラン入れ子をフェーズで切り替える）。
 *
 * タイトル → マップ → スプリント → リザルト → ドラフト → 進化 → … → ボス →
 * 勝敗 を `RunState.phase` でルーティングする。スプリント系のフェーズでは盤面を
 * 背景に残し、リザルト/ドラフト/進化をオーバーレイで重ねる。状態は読むだけ（第22.2）。
 */
import { useState } from 'react';
import { Hud } from './ui/Hud';
import {
  DraftScreen,
  EventScreen,
  EvolutionScreen,
  FormationScreen,
  RestScreen,
  RunBar,
  RunMapScreen,
  RunResultScreen,
  ShopScreen,
  SprintResultScreen,
  SprintScreen,
  TitleScreen,
  useRun,
} from './ui';
import type { GameHandle } from './game';

export interface AppProps {
  game: GameHandle;
}

/** 組織状態に応じた画面トーン（第18.3 の画面ステート）。 */
function screenTone(state: ReturnType<GameHandle['getState']>): string {
  if (state.diagnosis === 'reviewHell' || state.diagnosis === 'reworkSpiral') return 'tone-hell';
  if (state.diagnosis === 'seniorSacrifice' || state.diagnosis === 'aiOverproduction') {
    return 'tone-cloudy';
  }
  return 'tone-day';
}

export default function App({ game }: AppProps) {
  const run = useRun(game);
  const { state, meta } = run;
  const phase = state.phase;
  const [formationOpen, setFormationOpen] = useState(false);

  if (phase === 'title') {
    return <TitleScreen seed={state.seed} meta={meta} onStart={run.startRun} />;
  }
  if (phase === 'won' || phase === 'lost') {
    return <RunResultScreen state={state} meta={meta} onNewRun={run.newRun} />;
  }

  const tasks = state.sprint?.tasks ?? [];
  const showSprint =
    state.sprint !== null &&
    (phase === 'sprint' || phase === 'result' || phase === 'draft' || phase === 'evolution');

  return (
    <div className={`app ${screenTone(state)}`}>
      <Hud org={state.org} tasks={tasks} />
      <RunBar state={state} onOpenFormation={() => setFormationOpen(true)} />

      {phase === 'map' && <RunMapScreen state={state} onEnter={run.enterNode} />}
      {showSprint && <SprintScreen state={state} onDispatch={run.dispatch} />}

      {phase === 'event' && <EventScreen state={state} onChoose={run.chooseEvent} />}
      {phase === 'shop' && (
        <ShopScreen
          state={state}
          onBuyCard={run.buyShopCard}
          onBuyRelic={run.buyShopRelic}
          onLeave={run.leaveShop}
        />
      )}
      {phase === 'rest' && <RestScreen state={state} onChoose={run.restChoose} />}

      {phase === 'result' && state.lastResult && (
        <SprintResultScreen
          result={state.lastResult}
          growth={state.lastGrowth}
          onContinue={run.acknowledgeResult}
          onAbandon={run.newRun}
        />
      )}
      {phase === 'draft' && state.draft && (
        <DraftScreen
          options={state.draft}
          sprintNumber={state.sprintsPlayed + 1}
          onPick={run.chooseCard}
          onSkip={run.skipDraft}
        />
      )}
      {phase === 'evolution' && (
        <EvolutionScreen
          state={state}
          onUnlock={run.unlockEvolution}
          onFinish={run.finishEvolution}
        />
      )}

      {formationOpen && (
        <FormationScreen
          state={state}
          onAssign={run.assignMember}
          onToggleAi={run.setMemberAi}
          onClose={() => setFormationOpen(false)}
        />
      )}
    </div>
  );
}
