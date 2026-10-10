/**
 * アプリのルート（SPEC 第3章 のラン入れ子をフェーズで切り替える）。
 *
 * タイトル → マップ → スプリント → リザルト → ドラフト → 進化 → … → ボス →
 * 勝敗 を `RunState.phase` でルーティングする。スプリント系のフェーズでは盤面を
 * 背景に残し、リザルト/ドラフト/進化をオーバーレイで重ねる。状態は読むだけ（第22.2）。
 *
 * RI-12: 非タイトル画面は動的 import（React.lazy）でチャンク分割する。
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAudio } from './audio/useAudio';
import { diagnosisTheme } from './render/diagnosisTheme';
import { displayedQuarterSprintIndex } from './render/sprintProgressView';
import {
  reviewFreezeWarningPeak,
  type HudMetricSnapshot,
  type RunMetricSnapshot,
} from './render/status';
import { Breadcrumb } from './ui/Breadcrumb';
import { Hud, type HudSnapshotScope } from './ui/Hud';
import { RunBar } from './ui/RunBar';
import { ResponsiveModeProvider, useResponsiveMode } from './ui/responsiveMode';
import { ResultOverlay } from './ui/ResultOverlay';
import { resetWindowScroll, SceneScrollReset } from './ui/resetWindowScroll';
import { TitleScreen } from './ui/TitleScreen';
import { frontmostTitleModal } from './ui/titleModalStack';
import { useDialogOverlayLock } from './ui/useDialogOverlayLock';
import {
  resolveTutorialFromLocation,
  shouldShowTutorialGuide,
  type TutorialQuery,
} from './ui/tutorial';
import { observeReplayBannerHeight } from './ui/replayBannerOffset';
import { ReplayContentProvider } from './ui/replayContent';
import { formatReplayRuleset } from './ui/replayRuleset';
import { useRun, type UseRun } from './ui/useRun';
import { HYPOTHESIS_NOTE_SAVE_FAILED, useHypothesisNote } from './ui/useHypothesisNote';
import {
  HYPOTHESIS_START_SAVE_TIMEOUT_MS,
  HYPOTHESIS_START_UNRECORDED,
} from './state/hypothesisNote';
import { resetViewportScroll } from './ui/viewportScroll';
import { isOverlayDismissKey } from './ui/overlayDismiss';
import sprintLayoutStyles from './ui/SprintLayout.module.css';
import type { GameHandle } from './game';
import { serializePersistenceBackup } from './state/persistenceBackup';
import {
  bindHypothesisToRun,
  detachHypothesisNote,
  newHypothesisStartId,
  undoAbandonedBind,
  editHypothesisDraft,
  hypothesisForRun,
  hypothesisRunKey,
  writeHypothesisReflection,
} from './state/hypothesisNote';
import { hypothesisNoteStore } from './state/hypothesisNotePersistence';
import { DAILY_RUN_DIFFICULTY, DAILY_RUN_TRIALS, dailySeed, utcDateStr } from './state/meta';
import { DEFAULT_SCENARIO, resolveScenarioId } from './sim/scenarios';
import { REPLAY_DRAFT_MISSING_HINT } from './state/replayJump';
import {
  downloadTextFile,
  persistenceExportMessage,
  persistenceExportMessages,
} from './ui/downloadTextFile';
import { PersistenceNotice, PersistenceQuietChip } from './ui/PersistenceNotice';
import { WebglStatusOverlay } from './ui/WebglStatusOverlay';

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
 * 進化オーバーレイ表示中は自動進行を止める（#386）。
 * TutorialGuide / SprintSuspendFallback と同じ pause epoch 所有。
 * lazy 読込中も Suspense 外でマウントし、チャンク到着を待たずに止める。
 */
function EvolutionSimPause({ game }: { game: GameHandle }) {
  useEffect(() => {
    if (game.isPaused()) return;
    game.pause();
    const epoch = game.getPauseEpoch();
    return () => {
      if (game.getPauseEpoch() === epoch) game.resume();
    };
  }, [game]);
  return null;
}

/**
 * ラン中の遊び方を開いている間、自動進行だけを止める（RI-148）。
 * 再生速度（手動停止 / 1x / 2x）は変えず、WebGL 未準備も触らない。
 * pause epoch とは独立した保持なので、pauseBriefly や読込中フォールバックが
 * resume しても、遊び方を閉じるまで進行は止まっている。
 * 既にある pause() は解放では解除しない。
 */
function RunHelpSimPause({ game }: { game: GameHandle }) {
  useEffect(() => {
    game.acquirePauseHold();
    return () => {
      game.releasePauseHold();
    };
  }, [game]);
  return null;
}

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

/** タイトル上の lazy モーダル読込中に下のボタン操作を塞ぐ。閉じる操作は DS-08 の名前付き button。 */
function TitleModalLoadingFallback({ onDismiss }: { onDismiss: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef, { restoreFocus: true, onDismiss });

  return (
    <ResultOverlay
      ref={overlayRef}
      data-testid="title-modal-loading"
      role="status"
      aria-busy="true"
      aria-label="読み込み中"
      tabIndex={-1}
    >
      <button
        type="button"
        className="result-overlay-dismiss"
        data-testid="title-modal-loading-dismiss"
        aria-label="閉じる"
        onClick={onDismiss}
      />
    </ResultOverlay>
  );
}

export interface AppProps {
  game: GameHandle;
}

export default function App(props: AppProps) {
  return (
    <ResponsiveModeProvider>
      <AppContent {...props} />
      <WebglStatusOverlay />
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
  const {
    state,
    meta,
    diagnosticInfo,
    lastRunReward,
    runSaveSummary,
    resumeRisk,
    runSaveIssue,
    zoomTo,
  } = run;
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
  const [eventTickerExpanded, setEventTickerExpanded] = useState(false);
  const [tutorialMode] = useState<TutorialQuery>(() => resolveTutorialFromLocation());
  const [helpOpen, setHelpOpen] = useState(() => resolveTutorialFromLocation() === 'help');
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const persistenceState = run.persistenceStatus.state;
  const previousPersistenceState = useRef(persistenceState);
  useEffect(() => {
    const previous = previousPersistenceState.current;
    const blocking = persistenceState === 'failed' || persistenceState === 'session';
    const wasBlocking = previous === 'failed' || previous === 'session';
    if (wasBlocking && !blocking) setExportMessage(null);
    previousPersistenceState.current = persistenceState;
  }, [persistenceState]);
  const hypothesisNote = useHypothesisNote();
  const hypothesisKey = hypothesisRunKey(state);
  const canBeginRun = !run.isReplayMode && !run.finishSaveBlocksNewRun;
  const beginGuard = useRef(false);
  const launchEpoch = useRef(0);
  const [hypothesisUnrecorded, setHypothesisUnrecorded] = useState(false);
  const [runLaunchPending, setRunLaunchPending] = useState(false);
  const [trackedPhase, setTrackedPhase] = useState(phase);
  if (trackedPhase !== phase) {
    setTrackedPhase(phase);
    if (phase === 'title') {
      setHypothesisUnrecorded(false);
      setRunLaunchPending(false);
    }
  }
  useEffect(() => {
    if (phase === 'title') beginGuard.current = false;
  }, [phase]);
  /** ガイドを閉じたラン世代。`runEpoch` は startRun ごとに増える（sprintId 再利用に依存しない）。 */
  const [tutorialDismissedEpoch, setTutorialDismissedEpoch] = useState<number | null>(null);
  const lastHudSnapshot = useRef<Record<HudSnapshotScope, HudMetricSnapshot | null>>({
    team: null,
    orgScale: null,
  });
  const lastRunMetricSnapshot = useRef<RunMetricSnapshot | null>(null);
  const zoomOpenerRef = useRef<HTMLButtonElement | null>(null);
  const previousZoomLevelRef = useRef(state.zoom.level);
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

  // シーン切替の paint 前に window スクロールを捨てる（#368）。
  useLayoutEffect(() => {
    resetWindowScroll();
  }, [phase]);

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
  const cancelPendingLaunch = () => {
    launchEpoch.current += 1;
  };
  const launchAfterHypothesis = (
    bind: Parameters<typeof hypothesisNoteStore.applyCommitted>[0],
    intendedStartId: string,
    start: (hypothesisStartId: string | null) => void,
  ) => {
    if (!canBeginRun) {
      start(null);
      return;
    }
    if (beginGuard.current) return;
    beginGuard.current = true;
    const ticket = ++launchEpoch.current;
    const epoch = game.getRunEpoch();
    setRunLaunchPending(true);
    const before = hypothesisNoteStore.getSnapshot().record;
    return (async () => {
      let timeoutId = 0;
      const savePromise = hypothesisNoteStore.applyCommitted(bind);
      const saved = await Promise.race([
        savePromise,
        new Promise<'timeout'>((resolve) => {
          timeoutId = setTimeout(() => resolve('timeout'), HYPOTHESIS_START_SAVE_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timeoutId);
      const superseded =
        launchEpoch.current !== ticket ||
        game.phase() !== 'title' ||
        game.isReplayMode() ||
        game.getRunEpoch() !== epoch ||
        game.finishSaveBlocksNewRun();
      if (superseded) {
        if (saved === 'timeout') {
          hypothesisNoteStore.revertAbandonedStart(before);
        } else {
          const settled = await savePromise;
          if (settled !== 'unchanged') {
            const clearedEmptyStart =
              hypothesisNoteStore.getSnapshot().record.bound == null && before.bound != null;
            await hypothesisNoteStore.applyCommitted(
              (record) => undoAbandonedBind(record, before, intendedStartId),
              clearedEmptyStart ? { restoreBound: true } : undefined,
            );
          }
        }
        beginGuard.current = false;
        setRunLaunchPending(false);
        return;
      }
      if (saved === 'timeout') {
        hypothesisNoteStore.revertAbandonedStart(before);
        setHypothesisUnrecorded(true);
      } else if (saved === 'failed') {
        hypothesisNoteStore.abandonUnpersistedStart();
        setHypothesisUnrecorded(true);
      } else {
        setHypothesisUnrecorded(false);
      }
      const boundStartId = hypothesisNoteStore.getSnapshot().record.bound?.startId ?? null;
      const linked =
        saved === 'timeout' || saved === 'failed' || boundStartId !== intendedStartId
          ? null
          : intendedStartId;
      start(linked);
    })();
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
    const startId = newHypothesisStartId();
    return launchAfterHypothesis(
      (record) =>
        bindHypothesisToRun(
          record,
          hypothesisRunKey({
            runKind: 'normal',
            seed: seed ?? state.seed,
            difficulty,
            trials,
            scenario: resolveScenarioId(scenario),
          }),
          startId,
        ),
      startId,
      (hypothesisStartId) => run.startRun(difficulty, trials, scenario, seed, hypothesisStartId),
    );
  };
  const startDailyRun = () => {
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    const day = utcDateStr();
    const startId = newHypothesisStartId();
    return launchAfterHypothesis(
      (record) =>
        bindHypothesisToRun(
          record,
          hypothesisRunKey({
            runKind: 'daily',
            dailyDate: day,
            seed: dailySeed(day),
            difficulty: DAILY_RUN_DIFFICULTY,
            trials: [...DAILY_RUN_TRIALS],
            scenario: DEFAULT_SCENARIO,
          }),
          startId,
        ),
      startId,
      (hypothesisStartId) => run.startDailyRun(day, hypothesisStartId),
    );
  };
  const resumeRun = () => {
    cancelPendingLaunch();
    audio.unlock();
    closeTitleModals();
    clearHudSnapshot();
    void hypothesisNoteStore.load();
    run.resumeRun();
  };
  const discardRunSave = () => {
    closeTitleModals();
    run.clearRunSave();
  };
  const openReplay = (id: string, keyframeIndex: number) => {
    cancelPendingLaunch();
    audio.unlock();
    if (!run.openReplay(id, keyframeIndex)) return;
    closeTitleModals();
    clearHudSnapshot();
    resetViewportScroll(document);
  };

  // キーフレーム画面のコミット後に、タイトル／一覧から引き継いだスクロールを捨てる。
  useLayoutEffect(() => {
    if (!run.isReplayMode) return;
    resetViewportScroll(document);
  }, [run.isReplayMode, phase]);
  // リプレイバナーの高さだけオーバーレイ上端を下げ、先頭の見出し／カードを覆わない（DS-06）。
  useLayoutEffect(() => {
    const banner = document.querySelector('[data-testid="replay-mode-banner"]');
    return observeReplayBannerHeight(banner instanceof Element ? banner : null);
  }, [run.isReplayMode, phase]);
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

  const closeMetaShop = useCallback(() => setMetaShopOpen(false), []);
  const closeCardCollection = useCallback(() => setCardCollectionOpen(false), []);
  const closeHelp = useCallback(() => setHelpOpen(false), []);
  const openOrg = useCallback(
    (trigger: HTMLButtonElement) => {
      zoomOpenerRef.current = trigger;
      zoomTo('company');
    },
    [zoomTo],
  );
  const closeNonHelpTitleModals = useCallback(() => {
    setMetaShopOpen(false);
    setDeckPolicyOpen(false);
    setCardCollectionOpen(false);
    setAchievementsOpen(false);
    setReplayListOpen(false);
  }, []);
  const openExclusiveTitleModal = (open: () => void) => {
    closeTitleModals();
    open();
  };
  const titleModalOpen = {
    help: helpOpen,
    metaShop: metaShopOpen,
    deckPolicy: deckPolicyOpen,
    cardCollection: cardCollectionOpen,
    achievements: achievementsOpen,
    replayList: replayListOpen,
  };
  const frontmost = phase === 'title' ? frontmostTitleModal(titleModalOpen) : null;

  useEffect(() => {
    if (frontmost !== 'metaShop' && frontmost !== 'cardCollection') return;
    const onKey = (event: KeyboardEvent) => {
      if (!isOverlayDismissKey(event.key)) return;
      event.preventDefault();
      if (frontmost === 'metaShop') closeMetaShop();
      else closeCardCollection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [frontmost, closeMetaShop, closeCardCollection]);
  const helpIsFrontmost =
    phase === 'title' &&
    frontmostTitleModal({
      help: helpOpen,
      metaShop: metaShopOpen,
      deckPolicy: deckPolicyOpen,
      cardCollection: cardCollectionOpen,
      achievements: achievementsOpen,
      replayList: replayListOpen,
    }) === 'help';

  useEffect(() => {
    if (!helpIsFrontmost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      closeHelp();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpIsFrontmost, closeHelp]);

  useLayoutEffect(() => {
    if (state.zoom.level === 'team') return;
    const onKey = (event: KeyboardEvent) => {
      if (!isOverlayDismissKey(event.key)) return;
      event.preventDefault();
      zoomTo('team');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomTo, state.zoom.level]);

  useLayoutEffect(() => {
    const previousLevel = previousZoomLevelRef.current;
    previousZoomLevelRef.current = state.zoom.level;
    if (previousLevel === 'team' || state.zoom.level !== 'team') return;

    const opener = zoomOpenerRef.current;
    zoomOpenerRef.current = null;
    if (opener?.isConnected && !opener.disabled) {
      opener.focus({ preventScroll: true });
    }
  }, [state.zoom.level]);

  const quietInline =
    phase !== 'title' && phase !== 'won' && phase !== 'lost' && phase !== 'quarterReview';
  const persistenceNotice = (
    <PersistenceNotice
      notice={run.persistenceStatus}
      quietPlacement={quietInline ? 'inline' : 'overlay'}
      exportMessage={exportMessage}
      tabConflict={run.tabConflict}
      onTakeOver={run.takeOverForeignTab}
      onRetry={() => {
        setExportMessage(null);
        void run.retryPersistence();
      }}
      onExport={() => {
        const runText = run.exportRunSaveText();
        const replays = run.exportPendingReplayFiles();
        if (!runText && replays.length === 0) {
          setExportMessage(persistenceExportMessage(null, false));
          return;
        }
        if (runText && replays.length === 0) {
          setExportMessage(
            persistenceExportMessage(
              runText,
              downloadTextFile('devops-tycoon-run-save.json', runText),
              'run',
            ),
          );
          return;
        }
        if (!runText && replays.length === 1) {
          const file = replays[0];
          if (!file) return;
          setExportMessage(
            persistenceExportMessage(
              file.text,
              downloadTextFile(file.filename, file.text),
              'replay',
            ),
          );
          return;
        }
        const backup = serializePersistenceBackup({
          runSave: runText,
          replays: replays.map((file) => file.text),
        });
        const downloaded = downloadTextFile('devops-tycoon-persistence-backup.json', backup);
        const included = [
          ...(runText ? [{ text: runText, downloaded, kind: 'run' as const }] : []),
          ...(replays.length > 0
            ? [{ text: replays[0]?.text ?? '', downloaded, kind: 'replay' as const }]
            : []),
        ];
        setExportMessage(persistenceExportMessages(included));
      }}
    />
  );

  let phaseBody: ReactNode;
  if (phase === 'title') {
    phaseBody = (
      <>
        <SceneScrollReset>
          <TitleScreen
            seed={state.seed}
            meta={meta}
            onStart={startRun}
            onStartDaily={startDailyRun}
            onResume={resumeRun}
            resumableSummary={runSaveSummary}
            resumeRisk={resumeRisk}
            runSaveIssue={runSaveIssue}
            onDiscardRunSave={discardRunSave}
            onOpenReplays={() => openExclusiveTitleModal(() => setReplayListOpen(true))}
            onOpenMetaShop={() => openExclusiveTitleModal(() => setMetaShopOpen(true))}
            onOpenDeckPolicy={() => openExclusiveTitleModal(() => setDeckPolicyOpen(true))}
            onOpenCardCollection={() => openExclusiveTitleModal(() => setCardCollectionOpen(true))}
            onOpenAchievements={() => openExclusiveTitleModal(() => setAchievementsOpen(true))}
            onToggleSoundMuted={() => {
              audio.unlock();
              run.setSoundMuted(!meta.soundMuted);
            }}
            onOpenHelp={() => openExclusiveTitleModal(() => setHelpOpen(true))}
            onApplyPreferred={run.setPreferredCardIds}
            onExportRunSave={run.exportRunSaveText}
            newRunBlocked={run.finishSaveBlocksNewRun}
            hypothesisDraft={hypothesisNote.record.draft?.text ?? ''}
            onHypothesisDraftChange={(text) => {
              const writtenAt = Date.now();
              hypothesisNoteStore.update((record) => editHypothesisDraft(record, text, writtenAt));
            }}
            hypothesisSaveFailed={hypothesisNote.saveFailed}
            hypothesisUnrecorded={hypothesisUnrecorded}
            runLaunchPending={runLaunchPending}
            onImportRunSave={async (raw) => {
              cancelPendingLaunch();
              const hypothesisStartIdAtImport =
                hypothesisNoteStore.getSnapshot().record.bound?.startId ?? null;
              const result = await run.importRunSaveText(raw);
              if (result.ok) {
                const beforeHypothesis = hypothesisNoteStore.getSnapshot().record;
                const detached = await hypothesisNoteStore.applyCommitted((record) =>
                  (record.bound?.startId ?? null) === hypothesisStartIdAtImport
                    ? detachHypothesisNote(record)
                    : record,
                );
                if (detached === 'failed') {
                  await game.rollbackRunImport();
                  await hypothesisNoteStore.restoreBoundIfDetached(beforeHypothesis.bound);
                  return { ok: false, message: HYPOTHESIS_NOTE_SAVE_FAILED };
                }
              }
              return {
                ok: result.ok,
                message: result.ok ? '' : result.message,
                restored: result.ok ? result.restored : undefined,
              };
            }}
          />
        </SceneScrollReset>
        {helpOpen && (
          <Suspense fallback={<TitleModalLoadingFallback onDismiss={closeHelp} />}>
            <HowToPlayScreen onClose={closeHelp} />
          </Suspense>
        )}
        <Suspense fallback={<TitleModalLoadingFallback onDismiss={closeNonHelpTitleModals} />}>
          {metaShopOpen && (
            <MetaShopScreen
              meta={meta}
              onPurchase={(id) => run.purchaseMetaUnlock(id)}
              onClose={closeMetaShop}
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
              onClose={closeCardCollection}
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
              onExportReplay={run.exportReplayText}
              onImportReplay={async (raw) => {
                const result = await run.importReplayText(raw);
                return {
                  ok: result.ok,
                  message: result.ok ? '' : result.message,
                  restored: result.ok ? result.restored : undefined,
                };
              }}
            />
          )}
        </Suspense>
      </>
    );
  }

  // 終端診断（ReplayBlob.outcome）で判定する。キーフレーム時点の state.diagnosis とは別。
  const reviewHellReplay = run.isReplayMode && run.activeReplayDiagnosis === 'reviewHell';
  const replayDraftMissing = run.isReplayMode && run.findReplayJumpIndex('draft') === null;
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
      <span className="replay-mode-banner-ruleset" data-testid="replay-recorded-ruleset">
        記録時ルールセット: {formatReplayRuleset(run.activeReplayInfo?.ruleset ?? null)}
      </span>
      <button type="button" data-testid="exit-replay" onClick={exitReplay}>
        タイトルへ戻る
      </button>
    </div>
  ) : null;

  if (phase === 'won' || phase === 'lost') {
    phaseBody = (
      <>
        {replayBanner}
        <Suspense fallback={null}>
          <SceneScrollReset>
            <RunResultScreen
              state={state}
              meta={meta}
              diagnosticInfo={diagnosticInfo}
              recordedCompanyResult={run.activeReplayInfo?.contentSnapshot?.companyResult}
              isReplay={run.isReplayMode}
              lastRunReward={lastRunReward}
              newRunBlocked={run.finishSaveBlocksNewRun}
              onNewRun={run.isReplayMode ? exitReplay : newRun}
              hypothesisNote={
                run.isReplayMode
                  ? null
                  : hypothesisForRun(hypothesisNote.record, hypothesisKey, game.hypothesisStartId())
              }
              onHypothesisReflectionChange={(text) => {
                const writtenAt = Date.now();
                hypothesisNoteStore.update((record) =>
                  writeHypothesisReflection(record, hypothesisKey, text, writtenAt),
                );
              }}
              hypothesisSaveFailed={run.isReplayMode ? false : hypothesisNote.saveFailed}
            />
          </SceneScrollReset>
        </Suspense>
      </>
    );
  }
  if (phase === 'quarterReview') {
    phaseBody = (
      <>
        {replayBanner}
        <Suspense fallback={null}>
          <SceneScrollReset>
            <QuarterReviewScreen
              state={state}
              onAcknowledge={run.acknowledgeQuarterReview}
              onChooseAdjustment={run.chooseGoalAdjustment}
            />
          </SceneScrollReset>
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
      <PersistenceQuietChip notice={run.persistenceStatus} active={quietInline} />
      <RunBar
        state={state}
        onOpenFormation={() => setFormationOpen(true)}
        onOpenOrg={openOrg}
        readOnly={run.isReplayMode}
        getInitialPreviousSnapshot={getLastRunMetricSnapshot}
        onSnapshotCaptured={rememberRunMetricSnapshot}
        compact={sprintLayout}
        soundMuted={meta.soundMuted}
        onOpenHelp={() => setHelpOpen(true)}
        onToggleSoundMuted={() => {
          audio.unlock();
          run.setSoundMuted(!meta.soundMuted);
        }}
      />
    </>
  );

  if (phase !== 'title' && phase !== 'won' && phase !== 'lost' && phase !== 'quarterReview') {
    phaseBody = (
      <div
        className={`app ${diagnosisTone}${sprintLayout ? ` app-sprint-layout ${sprintLayoutStyles.appShell}` : ''}`}
        data-phase={phase}
        data-diagnosis={state.diagnosis}
        data-responsive-width={responsiveMode.width}
        data-responsive-height={responsiveMode.height}
      >
        <div className="app-background">
          {replayBanner}
          {!sprintLayout && sprintHeader}

          {/*
        各 lazy 画面を別 Suspense に分ける。
        1 つの境界だと編成/ズーム等の初回ロードで SprintScreen まで null に消える。
      */}
          <Suspense fallback={null}>
            {phase === 'setup' && (
              <SceneScrollReset>
                <SetupScreen
                  state={state}
                  onAssign={run.assignMember}
                  onToggleAi={run.setMemberAi}
                  onBegin={run.beginSetupSprint}
                  readOnly={run.isReplayMode}
                />
              </SceneScrollReset>
            )}
          </Suspense>
          <Suspense fallback={<SprintSuspendFallback game={game} header={sprintHeader} />}>
            {showSprint && (
              <SceneScrollReset>
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
                  eventTickerExpanded={eventTickerExpanded}
                  onEventTickerExpandedChange={setEventTickerExpanded}
                />
              </SceneScrollReset>
            )}
          </Suspense>

          <Suspense fallback={null}>
            {phase === 'beat' && (
              <SceneScrollReset>
                <BeatScreen state={state} onResolve={run.resolveBeat} />
              </SceneScrollReset>
            )}
          </Suspense>
          <Suspense fallback={null}>
            {phase === 'shop' && (
              <SceneScrollReset>
                <ShopScreen
                  state={state}
                  onBuyCard={run.buyShopCard}
                  onBuyRelic={run.buyShopRelic}
                  onBuyRecruit={run.buyShopRecruit}
                  onLeave={run.leaveShop}
                />
              </SceneScrollReset>
            )}
          </Suspense>
          <Suspense fallback={null}>
            {phase === 'rest' && (
              <SceneScrollReset>
                <RestScreen state={state} onChoose={run.restChoose} />
              </SceneScrollReset>
            )}
          </Suspense>
          <Suspense fallback={null}>
            {phase === 'recruit' && (
              <SceneScrollReset>
                <RecruitScreen state={state} onChoose={run.recruitChoose} />
              </SceneScrollReset>
            )}
          </Suspense>

          <Suspense fallback={null}>
            {phase === 'result' && state.lastResult && (
              <SceneScrollReset>
                <SprintResultScreen
                  result={state.lastResult}
                  growth={state.lastGrowth}
                  onContinue={
                    run.isReplayMode ? () => run.jumpReplayToPhase('draft') : run.acknowledgeResult
                  }
                  onAbandon={run.isReplayMode ? exitReplay : newRun}
                  continueDisabled={replayDraftMissing}
                  continueDisabledReason={
                    replayDraftMissing ? REPLAY_DRAFT_MISSING_HINT : undefined
                  }
                  replayMode={run.isReplayMode}
                  diagnosis={run.activeReplayDiagnosis ?? state.diagnosis}
                />
              </SceneScrollReset>
            )}
          </Suspense>
          <Suspense fallback={null}>
            {phase === 'draft' && state.draft && (
              <SceneScrollReset>
                <DraftScreen
                  options={state.draft}
                  companyState={state}
                  sprintNumber={displayedQuarterSprintIndex(state)}
                  budget={state.budget}
                  mulliganUsed={state.draftMulliganUsed}
                  previews={state.whatIf?.draftCandidates ?? {}}
                  skipPreview={state.whatIf?.current}
                  whatIfComputing={state.whatIfStatus === 'computing'}
                  onPick={run.chooseCard}
                  onSkip={run.skipDraft}
                  onMulligan={run.mulliganDraft}
                  readOnly={run.isReplayMode}
                  onClose={run.isReplayMode ? exitReplay : undefined}
                />
              </SceneScrollReset>
            )}
          </Suspense>
          {phase === 'evolution' && <EvolutionSimPause game={game} />}
          <Suspense fallback={null}>
            {phase === 'evolution' && (
              <SceneScrollReset>
                <EvolutionScreen
                  state={state}
                  onUnlock={run.unlockEvolution}
                  onFinish={run.finishEvolution}
                />
              </SceneScrollReset>
            )}
          </Suspense>

          {/*
        現場へ戻したら overlay は即 unmount する。
        AnimatePresence の opacity/scale exit は WebGL canvas をコンポジタ層に残し、
        閉じた全社マップが盤面へゴースト表示される（#376）。入場のフェードは CSS。
      */}
          {zoom.level !== 'team' && (
            <div
              key={zoom.level}
              className="zoom-overlay"
              data-testid="zoom-overlay"
              data-level={zoom.level}
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
            </div>
          )}
        </div>
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
        {helpOpen && <RunHelpSimPause game={game} />}
        {helpOpen && (
          <Suspense fallback={<TitleModalLoadingFallback onDismiss={closeHelp} />}>
            <HowToPlayScreen onClose={closeHelp} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <>
      {persistenceNotice}
      {hypothesisUnrecorded && phase !== 'title' ? (
        <p
          className="hypothesis-start-unrecorded"
          role="status"
          data-testid="hypothesis-start-unrecorded"
        >
          {HYPOTHESIS_START_UNRECORDED}
        </p>
      ) : null}
      {phaseBody}
    </>
  );
}
