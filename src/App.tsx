/**
 * アプリのルート（SPEC 第3章 のラン入れ子をフェーズで切り替える）。
 *
 * タイトル → マップ → スプリント → リザルト → ドラフト → 進化 → … → ボス →
 * 勝敗 を `RunState.phase` でルーティングする。スプリント系のフェーズでは盤面を
 * 背景に残し、リザルト/ドラフト/進化をオーバーレイで重ねる。状態は読むだけ（第22.2）。
 */
import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { HudMetricSnapshot } from './render/status';
import { Hud, type HudSnapshotScope } from './ui/Hud';
import {
  Breadcrumb,
  AchievementCollectionScreen,
  BeatScreen,
  DeptScreen,
  DraftScreen,
  EvolutionScreen,
  FormationScreen,
  IndustryScreen,
  MetaShopScreen,
  OrgScreen,
  RestScreen,
  RunBar,
  RunResultScreen,
  QuarterReviewScreen,
  SetupScreen,
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
  const [metaShopOpen, setMetaShopOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const lastHudSnapshot = useRef<{
    snapshot: HudMetricSnapshot;
    scope: HudSnapshotScope;
  } | null>(null);
  const clearHudSnapshot = useCallback(() => {
    lastHudSnapshot.current = null;
  }, []);
  const rememberHudSnapshot = useCallback(
    (snapshot: HudMetricSnapshot, scope: HudSnapshotScope) => {
      lastHudSnapshot.current = { snapshot, scope };
    },
    [],
  );
  const getLastHudSnapshot = useCallback((scope: HudSnapshotScope) => {
    return lastHudSnapshot.current?.scope === scope ? lastHudSnapshot.current.snapshot : null;
  }, []);

  // 新しいランへ移る操作では編成モーダルを閉じ、状態を次のランへ持ち越さない
  // （ボススプリント中に開いたまま決着→再開すると勝手に開いて見える問題を防ぐ）。
  const startRun = (difficulty: Parameters<typeof run.startRun>[0], trials: string[]) => {
    setFormationOpen(false);
    clearHudSnapshot();
    run.startRun(difficulty, trials);
  };
  const startDailyRun = () => {
    setFormationOpen(false);
    clearHudSnapshot();
    run.startDailyRun();
  };
  const newRun = () => {
    setFormationOpen(false);
    clearHudSnapshot();
    run.newRun();
  };

  if (phase === 'title') {
    return (
      <>
        <TitleScreen
          seed={state.seed}
          meta={meta}
          onStart={startRun}
          onStartDaily={startDailyRun}
          onOpenMetaShop={() => setMetaShopOpen(true)}
          onOpenAchievements={() => setAchievementsOpen(true)}
        />
        {metaShopOpen && (
          <MetaShopScreen
            meta={meta}
            onPurchase={(id) => run.purchaseMetaUnlock(id)}
            onClose={() => setMetaShopOpen(false)}
          />
        )}
        {achievementsOpen && (
          <AchievementCollectionScreen meta={meta} onClose={() => setAchievementsOpen(false)} />
        )}
      </>
    );
  }
  if (phase === 'won' || phase === 'lost') {
    return <RunResultScreen state={state} meta={meta} onNewRun={newRun} />;
  }
  if (phase === 'quarterReview') {
    return (
      <QuarterReviewScreen
        state={state}
        onAcknowledge={run.acknowledgeQuarterReview}
        onChooseAdjustment={run.chooseGoalAdjustment}
      />
    );
  }

  const tasks = state.sprint?.tasks ?? [];
  const showSprint =
    state.sprint !== null &&
    (phase === 'sprint' || phase === 'result' || phase === 'draft' || phase === 'evolution');

  // ズーム階層（第4.7〜4.11）。現場以外を見ているときはオーバーレイで重ねる。
  const zoom = state.zoom;
  const focusedDept =
    state.orgScale?.departments.find((d) => d.def.id === zoom.deptId) ??
    state.orgScale?.departments[0] ??
    null;
  const hudSnapshotScope: HudSnapshotScope = state.orgScale ? 'orgScale' : 'team';

  return (
    <div className={`app ${screenTone(state)}`}>
      <Hud
        org={state.org}
        orgScale={state.orgScale}
        tasks={tasks}
        snapshotScope={hudSnapshotScope}
        getInitialPreviousSnapshot={getLastHudSnapshot}
        onSnapshotCaptured={rememberHudSnapshot}
      />
      <RunBar
        state={state}
        onOpenFormation={() => setFormationOpen(true)}
        onOpenOrg={() => run.zoomTo('company')}
      />

      {phase === 'setup' && (
        <SetupScreen
          state={state}
          onAssign={run.assignMember}
          onToggleAi={run.setMemberAi}
          onBegin={run.beginSetupSprint}
        />
      )}
      {showSprint && <SprintScreen state={state} onDispatch={run.dispatch} />}

      {phase === 'beat' && <BeatScreen state={state} onResolve={run.resolveBeat} />}
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
          onAbandon={newRun}
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

      <AnimatePresence>
        {zoom.level !== 'team' && (
          <motion.div
            key={zoom.level}
            className="zoom-overlay"
            data-testid="zoom-overlay"
            data-level={zoom.level}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            <Breadcrumb level={zoom.level} onNavigate={run.zoomTo} />
            {zoom.level === 'industry' && state.industry && (
              <IndustryScreen industry={state.industry} onSetKind={run.setRankingKind} />
            )}
            {zoom.level === 'company' && state.orgScale && (
              <OrgScreen
                org={state.orgScale}
                budget={state.budget}
                zoom={zoom}
                onFocusDept={run.focusDept}
                onFocusTeam={run.focusTeam}
                onApplyLever={run.applyOrgLever}
              />
            )}
            {zoom.level === 'department' && focusedDept && (
              <DeptScreen
                dept={focusedDept}
                budget={state.budget}
                onFocusTeam={run.focusTeam}
                onApplyLever={run.applyOrgLever}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
