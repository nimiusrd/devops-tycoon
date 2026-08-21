/**
 * アプリのルート（SPEC 第3章 のラン入れ子をフェーズで切り替える）。
 *
 * タイトル → マップ → スプリント → リザルト → ドラフト → 進化 → … → ボス →
 * 勝敗 を `RunState.phase` でルーティングする。スプリント系のフェーズでは盤面を
 * 背景に残し、リザルト/ドラフト/進化をオーバーレイで重ねる。状態は読むだけ（第22.2）。
 *
 * RI-12: 非タイトル画面は動的 import（React.lazy）でチャンク分割する。
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAudio } from './audio/useAudio';
import { diagnosisTheme } from './render/diagnosisTheme';
import {
  reviewFreezeWarningPeak,
  type HudMetricSnapshot,
  type RunMetricSnapshot,
} from './render/status';
import { Breadcrumb } from './ui/Breadcrumb';
import { Hud, type HudSnapshotScope } from './ui/Hud';
import { RunBar } from './ui/RunBar';
import { ResponsiveModeProvider, useResponsiveMode } from './ui/responsiveMode';
import { TitleScreen } from './ui/TitleScreen';
import {
  resolveTutorialFromLocation,
  shouldShowTutorialGuide,
  type TutorialQuery,
} from './ui/tutorial';
import { ReplayContentProvider } from './ui/replayContent';
import { formatReplayRuleset } from './ui/replayRuleset';
import { useRun, type UseRun } from './ui/useRun';
import sprintLayoutStyles from './ui/SprintLayout.module.css';
import type { GameHandle } from './game';

const AchievementCollectionScreen = lazy(() =>
  import('./ui/AchievementCollectionScreen').then((m) => ({
    default: m.AchievementCollectionScreen,
  })),
);
const HowToPlayScreen = lazy(() =>
  import('./ui/HowToPlayScreen').then((m) => ({ default: m.HowToPlayScreen })),
);
const BeatScreen = lazy(() => import('./ui/BeatScreen').then((m) => ({ default: m.BeatScreen })));
const DeptScreen = lazy(() => import('./ui/DeptScreen').then((m) => ({ default: m.DeptScreen })));
const DraftScreen = lazy(() =>
  import('./ui/DraftScreen').then((m) => ({ default: m.DraftScreen })),
);
const EvolutionScreen = lazy(() =>
  import('./ui/EvolutionScreen').then((m) => ({ default: m.EvolutionScreen })),
);
const FormationScreen = lazy(() =>
  import('./ui/FormationScreen').then((m) => ({ default: m.FormationScreen })),
);
const IndustryScreen = lazy(() =>
  import('./ui/IndustryScreen').then((m) => ({ default: m.IndustryScreen })),
);
const MetaShopScreen = lazy(() =>
  import('./ui/MetaShopScreen').then((m) => ({ default: m.MetaShopScreen })),
);
const DeckPolicyScreen = lazy(() =>
  import('./ui/DeckPolicyScreen').then((m) => ({ default: m.DeckPolicyScreen })),
);
const CardCollectionScreen = lazy(() =>
  import('./ui/CardCollectionScreen').then((m) => ({ default: m.CardCollectionScreen })),
);
const ReplayListScreen = lazy(() =>
  import('./ui/ReplayListScreen').then((m) => ({ default: m.ReplayListScreen })),
);
const OrgScreen = lazy(() => import('./ui/OrgScreen').then((m) => ({ default: m.OrgScreen })));
const QuarterReviewScreen = lazy(() =>
  import('./ui/QuarterReviewScreen').then((m) => ({ default: m.QuarterReviewScreen })),
);
const RecruitScreen = lazy(() =>
  import('./ui/RecruitScreen').then((m) => ({ default: m.RecruitScreen })),
);
const RestScreen = lazy(() => import('./ui/RestScreen').then((m) => ({ default: m.RestScreen })));
const RunResultScreen = lazy(() =>
  import('./ui/RunResultScreen').then((m) => ({ default: m.RunResultScreen })),
);
const SetupScreen = lazy(() =>
  import('./ui/SetupScreen').then((m) => ({ default: m.SetupScreen })),
);
const ShopScreen = lazy(() => import('./ui/ShopScreen').then((m) => ({ default: m.ShopScreen })));
const SprintResultScreen = lazy(() =>
  import('./ui/SprintResultScreen').then((m) => ({ default: m.SprintResultScreen })),
);
const loadSprintScreen = () => import('./ui/SprintScreen');
const SprintScreen = lazy(() => loadSprintScreen().then((m) => ({ default: m.SprintScreen })));

/**
 * SprintScreen チャンク読込中は自動進行を止める。
 * 既に E2E 等で pause 済みなら触らず、自分が止めた epoch のままなら resume する。
 * （読込中に外部が再 pause したら epoch が進むので誤 resume しない。）
 */
function SprintSuspendFallback({ game, header }: { game: GameHandle; header: ReactNode }) {
  const responsiveMode = useResponsiveMode();

  useEffect(() => {
    if (game.isPaused()) return;
    game.pause();
    const epoch = game.getPauseEpoch();
    return () => {
      if (game.getPauseEpoch() === epoch) game.resume();
    };
  }, [game]);
  return (
    <div
      className={`sprint-layout sprint-layout-fallback ${sprintLayoutStyles.root} ${sprintLayoutStyles.fallback}`}
      data-responsive-width={responsiveMode.width}
      data-responsive-height={responsiveMode.height}
    >
      {header}
    </div>
  );
}

/** タイトル上の lazy モーダル読込中に下のボタン操作を塞ぐ。 */
function TitleModalLoadingFallback() {
  return (
    <div
      className="result-overlay"
      data-testid="title-modal-loading"
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
    />
  );
}

export interface AppProps {
  game: GameHandle;
}

export default function App(props: AppProps) {
  return (
    <ResponsiveModeProvider>
      <AppContent {...props} />
    </ResponsiveModeProvider>
  );
}

function AppContent({ game }: AppProps) {
  const run = useRun(game);
  return (
    <ReplayContentProvider contentSnapshot={run.activeReplayInfo?.contentSnapshot ?? null}>
      <AppContentView game={game} run={run} />
    </ReplayContentProvider>
  );
}

function AppContentView({ game, run }: { game: GameHandle; run: UseRun }) {
  const { state, meta, lastRunReward, runSaveSummary, runSaveIssue } = run;
  const phase = state.phase;
  const responsiveMode = useResponsiveMode();
  const audio = useAudio();
  const [formationOpen, setFormationOpen] = useState(false);
  const [metaShopOpen, setMetaShopOpen] = useState(false);
  const [deckPolicyOpen, setDeckPolicyOpen] = useState(false);
  const [cardCollectionOpen, setCardCollectionOpen] = useState(false);
  const [achievementsOpen, setAchievementsOpen] = useState(false);
  const [replayListOpen, setReplayListOpen] = useState(false);
  const [hudExpanded, setHudExpanded] = useState(false);
  const [tutorialMode] = useState<TutorialQuery>(() => resolveTutorialFromLocation());
  const [helpOpen, setHelpOpen] = useState(() => resolveTutorialFromLocation() === 'help');
  /** ガイドを閉じたラン世代。`runEpoch` は startRun ごとに増える（sprintId 再利用に依存しない）。 */
  const [tutorialDismissedEpoch, setTutorialDismissedEpoch] = useState<number | null>(null);
  const lastHudSnapshot = useRef<Record<HudSnapshotScope, HudMetricSnapshot | null>>({
    team: null,
    orgScale: null,
  });
  const lastRunMetricSnapshot = useRef<RunMetricSnapshot | null>(null);
  const clearHudSnapshot = useCallback(() => {
    lastHudSnapshot.current = { team: null, orgScale: null };
    lastRunMetricSnapshot.current = null;
  }, []);
  const rememberHudSnapshot = useCallback(
    (snapshot: HudMetricSnapshot, scope: HudSnapshotScope) => {
      lastHudSnapshot.current[scope] = snapshot;
    },
    [],
  );
  const getLastHudSnapshot = useCallback((scope: HudSnapshotScope) => {
    return lastHudSnapshot.current[scope];
  }, []);
  const rememberRunMetricSnapshot = useCallback((snapshot: RunMetricSnapshot) => {
    lastRunMetricSnapshot.current = snapshot;
  }, []);
  const getLastRunMetricSnapshot = useCallback(() => {
    return lastRunMetricSnapshot.current;
  }, []);

  // setup / shop / rest など次スプリント手前でチャンクを先読みする。
  useEffect(() => {
    if (
      phase === 'setup' ||
      phase === 'shop' ||
      phase === 'rest' ||
      phase === 'beat' ||
      phase === 'draft' ||
      phase === 'evolution' ||
      phase === 'result'
    ) {
      void loadSprintScreen();
    }
  }, [phase]);

  // RI-59: ミュート設定と診断連動 BGM。
  useEffect(() => {
    audio.setMuted(meta.soundMuted);
  }, [audio, meta.soundMuted]);

  useEffect(() => {
    if (phase === 'title') {
      audio.setBgmOff();
      return;
    }
    audio.setBgmFromDiagnosis(state.diagnosis);
  }, [audio, phase, state.diagnosis]);

  // 新しいランへ移る操作では編成モーダルを閉じ、状態を次のランへ持ち越さない
  // （ボススプリント中に開いたまま決着→再開すると勝手に開いて見える問題を防ぐ）。
  const closeTitleModals = () => {
    setFormationOpen(false);
    setMetaShopOpen(false);
    setDeckPolicyOpen(false);
    setCardCollectionOpen(false);
    setAchievementsOpen(false);
    setHelpOpen(false);
    setReplayListOpen(false);
  };
  const startRun = (
    difficulty: Parameters<typeof run.startRun>[0],
    trials: string[],
    scenario?: Parameters<typeof run.startRun>[2],
    seed?: Parameters<typeof run.startRun>[3],
  ) => {
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    run.startRun(difficulty, trials, scenario, seed);
  };
  const startDailyRun = () => {
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    run.startDailyRun();
  };
  const resumeRun = () => {
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    run.resumeRun();
  };
  const discardRunSave = () => {
    closeTitleModals();
    run.clearRunSave();
  };
  const openReplay = (id: string, keyframeIndex: number) => {
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    run.openReplay(id, keyframeIndex);
  };
  const exitReplay = () => {
    closeTitleModals();
    clearHudSnapshot();
    run.exitReplay();
  };
  const newRun = () => {
    closeTitleModals();
    clearHudSnapshot();
    run.newRun();
  };
  const dismissTutorial = () => {
    setTutorialDismissedEpoch(run.runEpoch);
    run.markTutorialSeen();
  };
  const tutorialActive =
    phase === 'sprint' &&
    tutorialDismissedEpoch !== run.runEpoch &&
    shouldShowTutorialGuide(meta.seenTutorialVersion, tutorialMode);

  if (phase === 'title') {
    return (
      <>
        <TitleScreen
          seed={state.seed}
          meta={meta}
          onStart={startRun}
          onStartDaily={startDailyRun}
          onResume={resumeRun}
          resumableSummary={runSaveSummary}
          runSaveIssue={runSaveIssue}
          onDiscardRunSave={discardRunSave}
          onOpenReplays={() => setReplayListOpen(true)}
          onOpenMetaShop={() => setMetaShopOpen(true)}
          onOpenDeckPolicy={() => setDeckPolicyOpen(true)}
          onOpenCardCollection={() => setCardCollectionOpen(true)}
          onOpenAchievements={() => setAchievementsOpen(true)}
          onToggleSoundMuted={() => {
            audio.unlock();
            run.setSoundMuted(!meta.soundMuted);
          }}
          onOpenHelp={() => setHelpOpen(true)}
          onApplyPreferred={run.setPreferredCardIds}
        />
        <Suspense fallback={<TitleModalLoadingFallback />}>
          {helpOpen && <HowToPlayScreen onClose={() => setHelpOpen(false)} />}
          {metaShopOpen && (
            <MetaShopScreen
              meta={meta}
              onPurchase={(id) => run.purchaseMetaUnlock(id)}
              onClose={() => setMetaShopOpen(false)}
            />
          )}
          {deckPolicyOpen && (
            <DeckPolicyScreen
              meta={meta}
              onChange={(ids) => run.setPreferredCardIds(ids)}
              onClose={() => setDeckPolicyOpen(false)}
            />
          )}
          {cardCollectionOpen && (
            <CardCollectionScreen
              meta={meta}
              onChangePreferred={(ids) => run.setPreferredCardIds(ids)}
              onClose={() => setCardCollectionOpen(false)}
            />
          )}
          {achievementsOpen && (
            <AchievementCollectionScreen meta={meta} onClose={() => setAchievementsOpen(false)} />
          )}
          {replayListOpen && (
            <ReplayListScreen
              replays={run.replays}
              onOpen={openReplay}
              onClose={() => setReplayListOpen(false)}
            />
          )}
        </Suspense>
      </>
    );
  }

  // 終端診断（ReplayBlob.outcome）で判定する。キーフレーム時点の state.diagnosis とは別。
  const reviewHellReplay = run.isReplayMode && run.activeReplayDiagnosis === 'reviewHell';
  const replayBanner = run.isReplayMode ? (
    <div
      className={`replay-mode-banner${reviewHellReplay ? ' replay-mode-banner-review-hell' : ''}`}
      data-testid="replay-mode-banner"
      data-review-hell={reviewHellReplay ? 'true' : undefined}
    >
      <span>
        {reviewHellReplay
          ? 'レビュー地獄リプレイ閲覧中（操作は無効）'
          : 'リプレイ閲覧中（操作は無効）'}
      </span>
      <span data-testid="replay-seed">seed: {state.seed}</span>
      <span data-testid="replay-recorded-ruleset">
        記録時ルールセット: {formatReplayRuleset(run.activeReplayInfo?.ruleset ?? null)}
      </span>
      <button type="button" data-testid="exit-replay" onClick={exitReplay}>
        タイトルへ戻る
      </button>
    </div>
  ) : null;

  if (phase === 'won' || phase === 'lost') {
    return (
      <>
        {replayBanner}
        <Suspense fallback={null}>
          <RunResultScreen
            state={state}
            meta={meta}
            lastRunReward={lastRunReward}
            onNewRun={run.isReplayMode ? exitReplay : newRun}
          />
        </Suspense>
      </>
    );
  }
  if (phase === 'quarterReview') {
    return (
      <>
        {replayBanner}
        <Suspense fallback={null}>
          <QuarterReviewScreen
            state={state}
            onAcknowledge={run.acknowledgeQuarterReview}
            onChooseAdjustment={run.chooseGoalAdjustment}
          />
        </Suspense>
      </>
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

  const sprintLayout = showSprint;
  const diagnosisTone = diagnosisTheme(state.diagnosis).toneClass;
  const sprintHeader = (
    <>
      <Hud
        org={state.org}
        orgScale={state.orgScale}
        tasks={tasks}
        // 通算 peak は単調増加で解消後も警告が残るため使わない。
        // 詳細スプリント peak + 全チーム現在キュー（非選択チーム / スプリント外の持ち越し含む）。
        // 選択中盤面の現在キュー長は deriveHudMetrics 側で畳み込む。
        reviewQueuePeak={reviewFreezeWarningPeak(
          state.sprint?.metrics.reviewQueueMax ?? 0,
          state.teams.map((team) => team.reviewQueue),
        )}
        snapshotScope={hudSnapshotScope}
        getInitialPreviousSnapshot={getLastHudSnapshot}
        onSnapshotCaptured={rememberHudSnapshot}
        expanded={hudExpanded}
        onExpandedChange={setHudExpanded}
      />
      <RunBar
        state={state}
        onOpenFormation={() => setFormationOpen(true)}
        onOpenOrg={() => run.zoomTo('company')}
        readOnly={run.isReplayMode}
        getInitialPreviousSnapshot={getLastRunMetricSnapshot}
        onSnapshotCaptured={rememberRunMetricSnapshot}
      />
    </>
  );

  return (
    <div
      className={`app ${diagnosisTone}${sprintLayout ? ` app-sprint-layout ${sprintLayoutStyles.appShell}` : ''}`}
      data-phase={phase}
      data-diagnosis={state.diagnosis}
      data-responsive-width={responsiveMode.width}
      data-responsive-height={responsiveMode.height}
    >
      {replayBanner}
      {!sprintLayout && sprintHeader}

      {/*
        各 lazy 画面を別 Suspense に分ける。
        1 つの境界だと編成/ズーム等の初回ロードで SprintScreen まで null に消える。
      */}
      <Suspense fallback={null}>
        {phase === 'setup' && (
          <SetupScreen
            state={state}
            onAssign={run.assignMember}
            onToggleAi={run.setMemberAi}
            onBegin={run.beginSetupSprint}
            readOnly={run.isReplayMode}
          />
        )}
      </Suspense>
      <Suspense fallback={<SprintSuspendFallback game={game} header={sprintHeader} />}>
        {showSprint && (
          <SprintScreen
            state={state}
            header={sprintHeader}
            onDispatch={run.dispatch}
            onPlayCard={run.playCard}
            getSprintSnapshot={run.getSprintSnapshot}
            pauseBriefly={run.pauseBriefly}
            playbackSpeed={run.playbackSpeed}
            setPlaybackSpeed={run.setPlaybackSpeed}
            showTutorial={tutorialActive}
            onTutorialDismiss={dismissTutorial}
            game={game}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {phase === 'beat' && <BeatScreen state={state} onResolve={run.resolveBeat} />}
      </Suspense>
      <Suspense fallback={null}>
        {phase === 'shop' && (
          <ShopScreen
            state={state}
            onBuyCard={run.buyShopCard}
            onBuyRelic={run.buyShopRelic}
            onBuyRecruit={run.buyShopRecruit}
            onLeave={run.leaveShop}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {phase === 'rest' && <RestScreen state={state} onChoose={run.restChoose} />}
      </Suspense>
      <Suspense fallback={null}>
        {phase === 'recruit' && <RecruitScreen state={state} onChoose={run.recruitChoose} />}
      </Suspense>

      <Suspense fallback={null}>
        {phase === 'result' && state.lastResult && (
          <SprintResultScreen
            result={state.lastResult}
            growth={state.lastGrowth}
            onContinue={run.acknowledgeResult}
            onAbandon={newRun}
            replayMode={run.isReplayMode}
            diagnosis={run.activeReplayDiagnosis ?? state.diagnosis}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {phase === 'draft' && state.draft && (
          <DraftScreen
            options={state.draft}
            sprintNumber={state.sprintsPlayed + 1}
            budget={state.budget}
            mulliganUsed={state.draftMulliganUsed}
            previews={state.whatIf?.draftCandidates ?? {}}
            skipPreview={state.whatIf?.current}
            whatIfComputing={state.whatIfStatus === 'computing'}
            onPick={run.chooseCard}
            onSkip={run.skipDraft}
            onMulligan={run.mulliganDraft}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {phase === 'evolution' && (
          <EvolutionScreen
            state={state}
            onUnlock={run.unlockEvolution}
            onFinish={run.finishEvolution}
          />
        )}
      </Suspense>

      <Suspense fallback={null}>
        {formationOpen && (
          <FormationScreen
            state={state}
            onAssign={run.assignMember}
            onToggleAi={run.setMemberAi}
            onClose={() => setFormationOpen(false)}
            readOnly={run.isReplayMode}
          />
        )}
      </Suspense>

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
            <Breadcrumb
              level={zoom.level}
              onNavigate={run.zoomTo}
              enterLocked={state.sprintsPlayed < state.teamLockUntilSprint}
            />
            <Suspense fallback={null}>
              {zoom.level === 'industry' && state.industry && (
                <IndustryScreen
                  industry={state.industry}
                  meta={meta}
                  onSetKind={run.setRankingKind}
                />
              )}
              {zoom.level === 'company' && state.orgScale && (
                <OrgScreen
                  org={state.orgScale}
                  budget={state.budget}
                  zoom={zoom}
                  trendHistory={state.trendHistory}
                  onFocusDept={run.focusDept}
                  onFocusTeam={run.focusTeam}
                  onApplyLever={run.applyOrgLever}
                />
              )}
              {zoom.level === 'department' && focusedDept && (
                <DeptScreen
                  dept={focusedDept}
                  budget={state.budget}
                  selectedTeamId={zoom.teamId ?? state.activeTeamId}
                  activeTeamId={state.activeTeamId}
                  teamLockUntilSprint={state.teamLockUntilSprint}
                  sprintsPlayed={state.sprintsPlayed}
                  phase={state.phase}
                  onFocusTeam={run.focusTeam}
                  onEnterTeam={run.enterTeam}
                  onApplyLever={run.applyOrgLever}
                />
              )}
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
