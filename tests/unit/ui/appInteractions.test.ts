import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => {
  type Slot = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void };
  const frame = () => ({
    cursor: 0,
    dirty: false,
    slots: [] as Slot[],
    effects: [] as (() => void)[],
  });
  return {
    frame,
    current: frame(),
    frames: [] as ReturnType<typeof frame>[],
    loaders: [] as (() => Promise<void>)[],
    sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
      return (
        previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
      );
    },
    effect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
      const frame = harness.current;
      const index = frame.cursor++;
      const previous = frame.slots[index];
      if (harness.sameDependencies(previous?.dependencies, dependencies)) return;
      const slot: Slot = { dependencies };
      frame.slots[index] = slot;
      frame.effects.push(() => {
        previous?.cleanup?.();
        slot.cleanup = effect() ?? undefined;
      });
    },
  };
});

// Node 上では App の hooks と公開 callback を検証する。lazy は子画面の識別名を
// 解決するだけで、Suspense の待機・DOM の描画・React の reconciliation は再実装しない。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  lazy(load: () => Promise<{ default: { name: string } }>) {
    const boundary = Object.assign(() => null, { displayName: '' });
    harness.loaders.push(async () => {
      boundary.displayName = (await load()).default.name;
    });
    return boundary;
  },
  useState(initial: unknown) {
    const frame = harness.current;
    const index = frame.cursor++;
    frame.slots[index] ??= {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    };
    const slot = frame.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        const next =
          typeof update === 'function'
            ? (update as (value: unknown) => unknown)(slot.value)
            : update;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          frame.dirty = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const frame = harness.current;
    const index = frame.cursor++;
    frame.slots[index] ??= { value: { current: initial } };
    return frame.slots[index].value;
  },
  useCallback(callback: unknown, dependencies: readonly unknown[]) {
    const frame = harness.current;
    const index = frame.cursor++;
    if (!harness.sameDependencies(frame.slots[index]?.dependencies, dependencies)) {
      frame.slots[index] = { value: callback, dependencies };
    }
    return frame.slots[index].value;
  },
  useEffect: harness.effect,
  useLayoutEffect: harness.effect,
}));
vi.mock('../../../src/ui/useRun', () => ({ useRun: vi.fn() }));
vi.mock('../../../src/audio/useAudio', () => ({ useAudio: vi.fn() }));
vi.mock('../../../src/ui/responsiveMode', () => ({
  ResponsiveModeProvider: function ResponsiveModeProvider() {
    return null;
  },
  useResponsiveMode: () => ({ width: 'wide', height: 'tall' }),
}));
vi.mock('../../../src/ui/replayContent', () => ({
  ReplayContentProvider: function ReplayContentProvider() {
    return null;
  },
}));
vi.mock('../../../src/ui/resetWindowScroll', () => ({
  resetWindowScroll: vi.fn(),
  SceneScrollReset: function SceneScrollReset() {
    return null;
  },
}));
vi.mock('../../../src/ui/viewportScroll', () => ({ resetViewportScroll: vi.fn() }));
vi.mock('../../../src/ui/replayBannerOffset', () => ({
  observeReplayBannerHeight: vi.fn(() => vi.fn()),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));
vi.mock('../../../src/ui/ResultOverlay', () => ({
  ResultOverlay: function ResultOverlay() {
    return null;
  },
}));
vi.mock('../../../src/ui/TitleScreen', () => ({
  TitleScreen: function TitleScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/Hud', () => ({
  Hud: function Hud() {
    return null;
  },
}));
vi.mock('../../../src/ui/RunBar', () => ({
  RunBar: function RunBar() {
    return null;
  },
}));
vi.mock('../../../src/ui/Breadcrumb', () => ({
  Breadcrumb: function Breadcrumb() {
    return null;
  },
}));
vi.mock('../../../src/ui/AchievementCollectionScreen', () => ({
  AchievementCollectionScreen: function AchievementCollectionScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/HowToPlayScreen', () => ({
  HowToPlayScreen: function HowToPlayScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/BeatScreen', () => ({
  BeatScreen: function BeatScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/DeptScreen', () => ({
  DeptScreen: function DeptScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/DraftScreen', () => ({
  DraftScreen: function DraftScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/EvolutionScreen', () => ({
  EvolutionScreen: function EvolutionScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/FormationScreen', () => ({
  FormationScreen: function FormationScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/IndustryScreen', () => ({
  IndustryScreen: function IndustryScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/MetaShopScreen', () => ({
  MetaShopScreen: function MetaShopScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/DeckPolicyScreen', () => ({
  DeckPolicyScreen: function DeckPolicyScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/CardCollectionScreen', () => ({
  CardCollectionScreen: function CardCollectionScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/ReplayListScreen', () => ({
  ReplayListScreen: function ReplayListScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/OrgScreen', () => ({
  OrgScreen: function OrgScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/QuarterReviewScreen', () => ({
  QuarterReviewScreen: function QuarterReviewScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/RecruitScreen', () => ({
  RecruitScreen: function RecruitScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/RestScreen', () => ({
  RestScreen: function RestScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/RunResultScreen', () => ({
  RunResultScreen: function RunResultScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/SetupScreen', () => ({
  SetupScreen: function SetupScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/ShopScreen', () => ({
  ShopScreen: function ShopScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/SprintResultScreen', () => ({
  SprintResultScreen: function SprintResultScreen() {
    return null;
  },
}));
vi.mock('../../../src/ui/SprintScreen', () => ({
  SprintScreen: function SprintScreen() {
    return null;
  },
}));

import App from '../../../src/App';
import { useAudio } from '../../../src/audio/useAudio';
import type { GameHandle } from '../../../src/game';
import type { HudMetricSnapshot, RunMetricSnapshot } from '../../../src/render/status';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { createRunDiagnosticInfo } from '../../../src/state/diagnosticInfo';
import { defaultMeta } from '../../../src/state/meta';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { REPLAY_DRAFT_MISSING_HINT } from '../../../src/state/replayJump';
import { toRunSave } from '../../../src/state/runPersistence';
import { observeReplayBannerHeight } from '../../../src/ui/replayBannerOffset';
import { resetWindowScroll } from '../../../src/ui/resetWindowScroll';
import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';
import { useRun, type UseRun } from '../../../src/ui/useRun';
import { resetViewportScroll } from '../../../src/ui/viewportScroll';
import { makeSprint } from '../helpers/sprintFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };
type Component = ((props: Props) => ReactNode) & { displayName?: string };
const componentName = (node: ReactElement<Props>) =>
  typeof node.type === 'function' ? (node.type as Component).displayName || node.type.name : '';

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  const children = Children.toArray(node.props.children);
  if (node.props.header) children.push(node.props.header as ReactElement);
  return [node, ...children.flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function makeState(overrides: Partial<RunState> = {}): RunState {
  const engine = new RunEngine({ seed: 'app-interactions', difficulty: 'easy' });
  engine.startRun();
  const state = engine.snapshot();
  return { ...state, phase: 'title', zoom: { ...state.zoom, level: 'team' }, ...overrides };
}

function makeZoomState(): Pick<RunState, 'orgScale' | 'industry'> {
  const engine = new RunEngine({ seed: 'app-zoom', difficulty: 'easy' });
  engine.startRun();
  engine.zoomTo('industry');
  const { orgScale, industry } = engine.snapshot();
  return { orgScale, industry };
}

function makeSharedRecords() {
  const engine = new RunEngine({ seed: 'app-import', difficulty: 'easy' });
  engine.startRun();
  const state = engine.exportPersistState();
  const frame = engine.exportReplayFrame();
  if (!state || !frame) throw new Error('共有データの初期状態を作成できませんでした');
  const save = toRunSave(state, 1234);
  const keyframes: ReplayBlob['keyframes'] = [{ phase: 'setup', frame }];
  const replay: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'app-import',
    seed: state.seed,
    difficulty: 'easy',
    trials: [],
    finishedAt: 1234,
    outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10 },
    keyframes,
    ruleset: save.ruleset,
    contentSnapshot: snapshotReplayContent(keyframes),
  };
  return { save, replay };
}

function makeRun(overrides: Partial<UseRun> = {}): UseRun {
  const state = makeState();
  return {
    state,
    meta: defaultMeta(),
    diagnosticInfo: createRunDiagnosticInfo(state, null),
    lastRunReward: null,
    runSaveSummary: null,
    resumeRisk: null,
    runSaveIssue: null,
    runEpoch: 1,
    playbackSpeed: 1,
    setPlaybackSpeed: vi.fn(),
    startRun: vi.fn(),
    startDailyRun: vi.fn(),
    resumeRun: vi.fn(),
    beginSetupSprint: vi.fn(),
    resolveBeat: vi.fn(),
    dispatch: vi.fn(() => ({ ok: false, reason: 'complete' as const })),
    playCard: vi.fn(() => ({ ok: false, reason: 'complete' as const })),
    getSprintSnapshot: vi.fn(() => null),
    pauseBriefly: vi.fn(() => vi.fn()),
    acknowledgeResult: vi.fn(),
    chooseCard: vi.fn(),
    skipDraft: vi.fn(),
    mulliganDraft: vi.fn(),
    unlockEvolution: vi.fn(),
    finishEvolution: vi.fn(),
    buyShopCard: vi.fn(),
    buyShopRelic: vi.fn(),
    buyShopRecruit: vi.fn(),
    leaveShop: vi.fn(),
    restChoose: vi.fn(),
    recruitChoose: vi.fn(),
    assignMember: vi.fn(),
    setMemberAi: vi.fn(),
    zoomTo: vi.fn(),
    focusDept: vi.fn(),
    focusTeam: vi.fn(),
    enterTeam: vi.fn(),
    setRankingKind: vi.fn(),
    applyOrgLever: vi.fn(),
    acknowledgeQuarterReview: vi.fn(),
    chooseGoalAdjustment: vi.fn(),
    newRun: vi.fn(),
    clearRunSave: vi.fn(),
    exportRunSaveText: vi.fn(() => 'save-json'),
    importRunSaveText: vi.fn(),
    exportReplayText: vi.fn(() => 'replay-json'),
    importReplayText: vi.fn(),
    replays: [],
    isReplayMode: false,
    activeReplayDiagnosis: null,
    activeReplayInfo: null,
    openReplay: vi.fn(() => true),
    jumpReplayToPhase: vi.fn(),
    findReplayJumpIndex: vi.fn(() => 2),
    exitReplay: vi.fn(),
    purchaseMetaUnlock: vi.fn(() => ({ ok: true })),
    setSoundMuted: vi.fn(),
    setPreferredCardIds: vi.fn(),
    markTutorialSeen: vi.fn(),
    ...overrides,
  };
}

function makeGame() {
  let paused = false;
  let epoch = 0;
  return {
    isPaused: vi.fn(() => paused),
    getPauseEpoch: vi.fn(() => epoch),
    pause: vi.fn(() => {
      paused = true;
      epoch += 1;
    }),
    resume: vi.fn(() => {
      paused = false;
    }),
  };
}

function cleanup(frame: ReturnType<typeof harness.frame>) {
  for (const slot of frame.slots) {
    slot.cleanup?.();
    slot.cleanup = undefined;
  }
}

function mountApp(overrides: Partial<UseRun> = {}) {
  let run = makeRun(overrides);
  const game = makeGame();
  const frame = harness.frame();
  harness.frames.push(frame);
  let tree: ReactNode;
  let provider: ReactElement<Props>;
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 20) throw new Error('App の更新が収束しませんでした');
      harness.current = frame;
      frame.cursor = 0;
      frame.dirty = false;
      vi.mocked(useRun).mockReturnValue(run);
      const root = App({ game: game as unknown as GameHandle });
      const appContent = root.props.children as ReactElement<Props>;
      provider = (appContent.type as Component)(appContent.props) as ReactElement<Props>;
      const view = provider.props.children as ReactElement<Props>;
      tree = (view.type as Component)(view.props);
      for (const effect of frame.effects.splice(0)) effect();
    } while (frame.dirty);
  };
  const child = (name: string) => {
    const node = elements(tree).find((item) => componentName(item) === name);
    if (!node) throw new Error(`子画面がありません: ${name}`);
    return node.props;
  };
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  flush();
  return {
    game,
    child,
    find,
    flush,
    get run() {
      return run;
    },
    get tree() {
      return tree;
    },
    get provider() {
      return provider;
    },
    has(name: string) {
      return elements(tree).some((node) => componentName(node) === name);
    },
    invoke(name: string, callback: string, ...args: unknown[]) {
      const result = (child(name)[callback] as (...args: unknown[]) => unknown)(...args);
      flush();
      return result;
    },
    update(next: Partial<UseRun>) {
      run = { ...run, ...next };
      flush();
    },
    phase(phase: RunState['phase'], extra: Partial<RunState> = {}) {
      run = { ...run, state: { ...run.state, phase, ...extra } };
      flush();
    },
    key(key: string) {
      const event = Object.assign(new Event('keydown', { cancelable: true }), { key });
      window.dispatchEvent(event);
      flush();
      return event;
    },
    mountLocal(name: string) {
      const nodes = elements(tree);
      const fallbackNodes = nodes.flatMap((node) => elements(node.props.fallback as ReactNode));
      const node = [...nodes, ...fallbackNodes].find((item) => componentName(item) === name);
      if (!node) throw new Error(`App 内のコンポーネントがありません: ${name}`);
      const localFrame = harness.frame();
      harness.frames.push(localFrame);
      harness.current = localFrame;
      const rendered = (node.type as Component)(node.props);
      for (const effect of localFrame.effects.splice(0)) effect();
      return { tree: rendered, unmount: () => cleanup(localFrame) };
    },
    unmount: () => cleanup(frame),
  };
}

const audio = {
  unlock: vi.fn(),
  setMuted: vi.fn(),
  setBgmOff: vi.fn(),
  setBgmFromDiagnosis: vi.fn(),
};
beforeAll(async () => {
  await Promise.all(harness.loaders.map((load) => load()));
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAudio).mockReturnValue(audio as unknown as ReturnType<typeof useAudio>);
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { search: '' } }));
  vi.stubGlobal('Element', class Element {});
  vi.stubGlobal('document', { querySelector: vi.fn(() => null) });
});
afterEach(async () => {
  try {
    for (const frame of harness.frames) cleanup(frame);
  } finally {
    try {
      // phase effect の先読みと依存 import を、globals とテスト環境の破棄前に完了させる。
      await vi.dynamicImportSettled();
    } finally {
      harness.frames = [];
      vi.unstubAllGlobals();
    }
  }
});

describe('App のタイトル操作', () => {
  it.each([
    ['onOpenHelp', 'HowToPlayScreen'],
    ['onOpenMetaShop', 'MetaShopScreen'],
    ['onOpenDeckPolicy', 'DeckPolicyScreen'],
    ['onOpenCardCollection', 'CardCollectionScreen'],
    ['onOpenAchievements', 'AchievementCollectionScreen'],
    ['onOpenReplays', 'ReplayListScreen'],
  ])('%s はほかのモーダルを閉じ、%s の close でタイトルへ戻る', (open, name) => {
    const screen = mountApp();
    screen.invoke('TitleScreen', 'onOpenHelp');
    screen.invoke('TitleScreen', open);
    expect(screen.has(name)).toBe(true);
    if (name !== 'HowToPlayScreen') expect(screen.has('HowToPlayScreen')).toBe(false);
    screen.invoke(name, 'onClose');
    expect(screen.has(name)).toBe(false);
    expect(screen.has('TitleScreen')).toBe(true);
  });

  it.each([
    ['onOpenMetaShop', 'MetaShopScreen'],
    ['onOpenCardCollection', 'CardCollectionScreen'],
    ['onOpenHelp', 'HowToPlayScreen'],
  ])('%s は Escape で閉じ、他のキーと閉じた後の Escape を消費しない', (open, name) => {
    const screen = mountApp();
    screen.invoke('TitleScreen', open);
    expect(screen.key('Enter').defaultPrevented).toBe(false);
    expect(screen.has(name)).toBe(true);
    expect(screen.key('Escape').defaultPrevented).toBe(true);
    expect(screen.has(name)).toBe(false);
    expect(screen.key('Escape').defaultPrevented).toBe(false);
  });

  it('help クエリの初期モーダルと読込中の閉じる操作を提供する', () => {
    window.location.search = '?tutorial=help';
    const screen = mountApp();
    expect(screen.has('HowToPlayScreen')).toBe(true);
    const fallback = screen.mountLocal('TitleModalLoadingFallback');
    const overlay = elements(fallback.tree).find(
      (node) => node.props['data-testid'] === 'title-modal-loading',
    )!;
    expect(overlay.props).toMatchObject({
      role: 'status',
      'aria-busy': 'true',
      'aria-label': '読み込み中',
    });
    expect(useDialogOverlayLock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ restoreFocus: true }),
    );
    const dismiss = elements(fallback.tree).find(
      (node) => node.props['data-testid'] === 'title-modal-loading-dismiss',
    )!;
    (dismiss.props.onClick as () => void)();
    screen.flush();
    expect(screen.has('HowToPlayScreen')).toBe(false);
    screen.invoke('TitleScreen', 'onOpenAchievements');
    const loading = screen.mountLocal('TitleModalLoadingFallback');
    const close = elements(loading.tree).find(
      (node) => node.props['data-testid'] === 'title-modal-loading-dismiss',
    )!;
    (close.props.onClick as () => void)();
    screen.flush();
    expect(screen.has('AchievementCollectionScreen')).toBe(false);
  });

  it.each(['onStart', 'onStartDaily', 'onResume'])(
    '%s は音声を解禁し、モーダルと前ランのメトリクスをクリアする',
    (action) => {
      const screen = mountApp();
      screen.phase('setup');
      const hud = {
        deliveryScore: 10,
        seniorHpPct: 20,
        aiDependencyPct: 30,
        techDebt: 40,
        morale: 50,
        securityLevel: 60,
      } satisfies HudMetricSnapshot;
      const metrics = {
        budget: 7,
        trustManagement: 8,
        trustCustomers: 9,
        trustTeam: 10,
      } satisfies RunMetricSnapshot;
      screen.invoke('Hud', 'onSnapshotCaptured', hud, 'team');
      screen.invoke('Hud', 'onSnapshotCaptured', { ...hud, techDebt: 1 }, 'orgScale');
      screen.invoke('RunBar', 'onSnapshotCaptured', metrics);
      expect(screen.invoke('Hud', 'getInitialPreviousSnapshot', 'team')).toEqual(hud);
      expect(screen.invoke('Hud', 'getInitialPreviousSnapshot', 'orgScale')).toMatchObject({
        techDebt: 1,
      });
      expect(screen.invoke('RunBar', 'getInitialPreviousSnapshot')).toEqual(metrics);
      screen.phase('title');
      screen.invoke('TitleScreen', 'onOpenHelp');
      const args = action === 'onStart' ? ['hard', ['half-budget'], 'copilot', 'shared-seed'] : [];
      screen.invoke('TitleScreen', action, ...args);
      const method =
        action === 'onStart'
          ? 'startRun'
          : action === 'onStartDaily'
            ? 'startDailyRun'
            : 'resumeRun';
      expect(screen.run[method]).toHaveBeenCalledExactlyOnceWith(...args);
      expect(audio.unlock).toHaveBeenCalledOnce();
      expect(screen.has('HowToPlayScreen')).toBe(false);
      screen.phase('setup');
      expect(screen.invoke('Hud', 'getInitialPreviousSnapshot', 'team')).toBeNull();
      expect(screen.invoke('Hud', 'getInitialPreviousSnapshot', 'orgScale')).toBeNull();
      expect(screen.invoke('RunBar', 'getInitialPreviousSnapshot')).toBeNull();
    },
  );

  it('購入・研修方針・セーブ破棄・サウンド設定を対応するラン操作へ渡す', () => {
    const screen = mountApp();
    screen.invoke('TitleScreen', 'onOpenMetaShop');
    expect(screen.invoke('MetaShopScreen', 'onPurchase', 'unlock-1')).toEqual({ ok: true });
    expect(screen.run.purchaseMetaUnlock).toHaveBeenCalledExactlyOnceWith('unlock-1');
    screen.invoke('TitleScreen', 'onOpenDeckPolicy');
    screen.invoke('DeckPolicyScreen', 'onChange', ['docs']);
    screen.invoke('TitleScreen', 'onOpenCardCollection');
    screen.invoke('CardCollectionScreen', 'onChangePreferred', ['pair-review']);
    expect(screen.run.setPreferredCardIds).toHaveBeenNthCalledWith(1, ['docs']);
    expect(screen.run.setPreferredCardIds).toHaveBeenNthCalledWith(2, ['pair-review']);
    screen.invoke('TitleScreen', 'onDiscardRunSave');
    expect(screen.run.clearRunSave).toHaveBeenCalledOnce();
    expect(screen.has('CardCollectionScreen')).toBe(false);
    screen.invoke('TitleScreen', 'onToggleSoundMuted');
    expect(screen.run.setSoundMuted).toHaveBeenLastCalledWith(!screen.run.meta.soundMuted);
    screen.update({ meta: { ...screen.run.meta, soundMuted: true } });
    screen.invoke('TitleScreen', 'onToggleSoundMuted');
    expect(screen.run.setSoundMuted).toHaveBeenLastCalledWith(false);
    expect(audio.unlock).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])(
    '途中セーブとリプレイの読込結果 ok=%s を画面用の結果へ変換する',
    async (ok) => {
      const screen = mountApp();
      const { save, replay } = makeSharedRecords();
      vi.mocked(screen.run.importRunSaveText).mockResolvedValue(
        ok ? { ok: true, save } : { ok: false, reason: 'corrupt', message: '読込理由' },
      );
      vi.mocked(screen.run.importReplayText).mockResolvedValue(
        ok ? { ok: true, replay } : { ok: false, reason: 'corrupt', message: '読込理由' },
      );
      expect(await screen.invoke('TitleScreen', 'onImportRunSave', 'save')).toEqual({
        ok,
        message: ok ? '' : '読込理由',
      });
      expect(screen.run.importRunSaveText).toHaveBeenCalledExactlyOnceWith('save');
      screen.invoke('TitleScreen', 'onOpenReplays');
      expect(await screen.invoke('ReplayListScreen', 'onImportReplay', 'replay')).toEqual({
        ok,
        message: ok ? '' : '読込理由',
      });
      expect(screen.run.importReplayText).toHaveBeenCalledExactlyOnceWith('replay');
      expect(screen.invoke('TitleScreen', 'onExportRunSave')).toBe('save-json');
      expect(screen.invoke('ReplayListScreen', 'onExportReplay', 'replay-id')).toBe('replay-json');
      expect(screen.run.exportReplayText).toHaveBeenCalledWith('replay-id');
    },
  );

  it.each([true, false])('リプレイを開く成功=%s に応じて一覧とスクロールを更新する', (ok) => {
    const screen = mountApp({ openReplay: vi.fn(() => ok) });
    screen.invoke('TitleScreen', 'onOpenReplays');
    screen.invoke('ReplayListScreen', 'onOpen', 'recorded-id', 3);
    expect(screen.run.openReplay).toHaveBeenCalledExactlyOnceWith('recorded-id', 3);
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(screen.has('ReplayListScreen')).toBe(!ok);
    expect(resetViewportScroll).toHaveBeenCalledTimes(ok ? 1 : 0);
  });
});

describe('App のフェーズとオーバーレイ', () => {
  it.each([
    ['setup', 'SetupScreen', 'onBegin', 'beginSetupSprint'],
    ['beat', 'BeatScreen', 'onResolve', 'resolveBeat'],
    ['shop', 'ShopScreen', 'onLeave', 'leaveShop'],
    ['rest', 'RestScreen', 'onChoose', 'restChoose'],
    ['recruit', 'RecruitScreen', 'onChoose', 'recruitChoose'],
    ['evolution', 'EvolutionScreen', 'onFinish', 'finishEvolution'],
    ['quarterReview', 'QuarterReviewScreen', 'onAcknowledge', 'acknowledgeQuarterReview'],
  ] as const)('%s は %s に状態と操作を渡す', (phase, name, callback, method) => {
    const screen = mountApp();
    screen.phase(phase);
    expect(screen.has('TitleScreen')).toBe(false);
    expect(screen.child(name).state).toBe(screen.run.state);
    screen.invoke(name, callback);
    expect(screen.run[method]).toHaveBeenCalledOnce();
    expect(screen.has('SprintScreen')).toBe(false);
    expect(resetWindowScroll).toHaveBeenCalledTimes(2);
    expect(audio.setBgmOff).toHaveBeenCalledOnce();
    expect(audio.setBgmFromDiagnosis).toHaveBeenLastCalledWith(screen.run.state.diagnosis);
  });

  it.each(['won', 'lost'] as const)('%s の結果から通常ランを終了してタイトルへ戻る', (phase) => {
    const screen = mountApp();
    screen.phase(phase);
    expect(screen.child('RunResultScreen')).toMatchObject({
      state: screen.run.state,
      meta: screen.run.meta,
      diagnosticInfo: screen.run.diagnosticInfo,
    });
    screen.invoke('RunResultScreen', 'onNewRun');
    expect(screen.run.newRun).toHaveBeenCalledOnce();
    expect(screen.run.exitReplay).not.toHaveBeenCalled();
  });

  it('編成の開閉、HUD 展開とチュートリアルのラン世代ごとの終了を保持する', () => {
    const screen = mountApp();
    screen.phase('sprint', { sprint: makeSprint(screen.run.state.org, []) });
    expect(screen.child('SprintScreen').showTutorial).toBe(true);
    expect(screen.child('Hud')).toMatchObject({ expanded: false, preferCompact: true });
    screen.invoke('Hud', 'onExpandedChange', true);
    expect(screen.child('Hud').expanded).toBe(true);
    screen.invoke('RunBar', 'onOpenFormation');
    expect(screen.child('FormationScreen').state).toBe(screen.run.state);
    screen.invoke('FormationScreen', 'onClose');
    expect(screen.has('FormationScreen')).toBe(false);
    screen.invoke('SprintScreen', 'onTutorialDismiss');
    expect(screen.run.markTutorialSeen).toHaveBeenCalledOnce();
    expect(screen.child('SprintScreen').showTutorial).toBe(false);
    screen.phase('setup');
    screen.phase('sprint');
    expect(screen.child('SprintScreen').showTutorial).toBe(false);
    screen.update({ runEpoch: 2 });
    expect(screen.child('SprintScreen').showTutorial).toBe(true);
  });

  it('全社から現場へ Escape で戻し、接続された起点ボタンへフォーカスを返す', () => {
    const screen = mountApp();
    screen.phase('setup');
    const opener = { isConnected: true, disabled: false, focus: vi.fn() };
    screen.invoke('RunBar', 'onOpenOrg', opener);
    expect(screen.run.zoomTo).toHaveBeenLastCalledWith('company');
    screen.phase('setup', {
      ...makeZoomState(),
      zoom: { level: 'company', deptId: null, teamId: null },
    });
    expect(screen.has('OrgScreen')).toBe(true);
    expect(screen.find('zoom-overlay').props['data-level']).toBe('company');
    expect(screen.key('Enter').defaultPrevented).toBe(false);
    expect(screen.key('Escape').defaultPrevented).toBe(true);
    expect(screen.run.zoomTo).toHaveBeenLastCalledWith('team');
    screen.phase('setup', { zoom: { level: 'team', deptId: null, teamId: null } });
    expect(opener.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(screen.has('OrgScreen')).toBe(false);
    expect(screen.key('Escape').defaultPrevented).toBe(false);
  });

  it.each(['disconnected', 'disabled'] as const)(
    '起点が %s なら現場へ戻ってもフォーカスしない',
    (reason) => {
      const screen = mountApp();
      screen.phase('setup');
      const opener = {
        isConnected: reason !== 'disconnected',
        disabled: reason === 'disabled',
        focus: vi.fn(),
      };
      screen.invoke('RunBar', 'onOpenOrg', opener);
      screen.phase('setup', { zoom: { level: 'company', deptId: null, teamId: null } });
      screen.phase('setup', { zoom: { level: 'team', deptId: null, teamId: null } });
      expect(opener.focus).not.toHaveBeenCalled();
    },
  );

  it('指定部門と欠落時の先頭部門を表示し、業界へも切り替える', () => {
    const screen = mountApp();
    const zoomState = makeZoomState();
    const departments = zoomState.orgScale!.departments;
    const selected = departments[1];
    screen.phase('setup', {
      ...zoomState,
      zoom: { level: 'department', deptId: selected.def.id, teamId: 'selected-team' },
    });
    expect(screen.child('DeptScreen')).toMatchObject({
      dept: selected,
      selectedTeamId: 'selected-team',
    });
    screen.phase('setup', { zoom: { level: 'department', deptId: 'missing', teamId: null } });
    expect(screen.child('DeptScreen')).toMatchObject({
      dept: departments[0],
      selectedTeamId: screen.run.state.activeTeamId,
    });
    screen.phase('setup', { zoom: { level: 'industry', deptId: null, teamId: null } });
    expect(screen.child('IndustryScreen').industry).toBe(screen.run.state.industry);
    screen.phase('setup', {
      zoom: { level: 'department', deptId: null, teamId: null },
      orgScale: null,
    });
    expect(screen.has('DeptScreen')).toBe(false);
    expect(screen.child('Hud').snapshotScope).toBe('team');
  });
});

describe('App のリプレイ表示', () => {
  it.each([true, false])(
    '結果画面は draft 記録の存在=%s に応じて次へ進む操作を制御する',
    (hasDraft) => {
      const screen = mountApp({
        isReplayMode: true,
        activeReplayDiagnosis: 'reviewHell',
        findReplayJumpIndex: vi.fn(() => (hasDraft ? 2 : null)),
        activeReplayInfo: {
          ruleset: { version: 3, fingerprint: 'saved-fingerprint' },
          contentSnapshot: null,
        },
      });
      screen.phase('result', {
        sprint: makeSprint(screen.run.state.org, []),
        lastResult: {
          done: 1,
          delivered: 2,
          maxCombo: 3,
          aiAssistedPct: 4,
          reviewQueueMax: 5,
          rework: 0,
          incidents: 0,
          contained: 0,
          spread: 0,
          seniorHpDelta: 0,
          actionCounts: {},
          grade: 'A',
          title: '安定運用',
          diagnosis: '順調',
          timeline: [],
          events: [],
          fireEvents: [],
          focusRemaining: 8,
          focusMax: 10,
          autoContainCount: 0,
        },
      });
      expect(screen.has('SprintScreen')).toBe(true);
      expect(screen.child('SprintResultScreen')).toMatchObject({
        continueDisabled: !hasDraft,
        replayMode: true,
        diagnosis: 'reviewHell',
      });
      expect(screen.child('SprintResultScreen').continueDisabledReason).toBe(
        hasDraft ? undefined : REPLAY_DRAFT_MISSING_HINT,
      );
      expect(content(screen.find('replay-mode-banner'))).toContain('レビュー地獄リプレイ閲覧中');
      expect(content(screen.find('replay-recorded-ruleset'))).toContain('v3 / saved-fingerprint');
      expect(content(screen.find('replay-seed'))).toContain(screen.run.state.seed);
      if (hasDraft) {
        screen.invoke('SprintResultScreen', 'onContinue');
        expect(screen.run.jumpReplayToPhase).toHaveBeenCalledExactlyOnceWith('draft');
      }
      screen.invoke('SprintResultScreen', 'onAbandon');
      expect(screen.run.exitReplay).toHaveBeenCalledOnce();
      expect(screen.run.newRun).not.toHaveBeenCalled();
      expect(screen.run.acknowledgeResult).not.toHaveBeenCalled();
    },
  );

  it('ドラフト・セットアップ・編成を読取専用にし、終了では通常ランを変更しない', () => {
    const screen = mountApp({ isReplayMode: true });
    screen.phase('draft', { draft: ['docs'], sprint: makeSprint(screen.run.state.org, []) });
    expect(screen.child('DraftScreen')).toMatchObject({ readOnly: true, options: ['docs'] });
    expect(screen.has('SprintScreen')).toBe(true);
    screen.invoke('DraftScreen', 'onClose');
    expect(screen.run.exitReplay).toHaveBeenCalledOnce();
    screen.phase('setup');
    expect(screen.child('SetupScreen').readOnly).toBe(true);
    expect(screen.child('RunBar').readOnly).toBe(true);
    screen.invoke('RunBar', 'onOpenFormation');
    expect(screen.child('FormationScreen').readOnly).toBe(true);
    (screen.find('exit-replay').props.onClick as () => void)();
    screen.flush();
    expect(screen.has('FormationScreen')).toBe(false);
    screen.phase('won');
    screen.invoke('RunResultScreen', 'onNewRun');
    expect(screen.run.exitReplay).toHaveBeenCalledTimes(3);
    expect(screen.run.newRun).not.toHaveBeenCalled();
    expect(content(screen.find('replay-mode-banner'))).toContain('リプレイ閲覧中（操作は無効）');
    expect(screen.find('replay-mode-banner').props['data-review-hell']).toBeUndefined();
  });

  it('通常のドラフトと結果にはリプレイの終了・ジャンプ操作を出さない', () => {
    const screen = mountApp();
    screen.phase('draft', { draft: ['docs'], draftMulliganUsed: true, whatIfStatus: 'computing' });
    expect(screen.child('DraftScreen')).toMatchObject({
      readOnly: false,
      onClose: undefined,
      mulliganUsed: true,
      whatIfComputing: true,
    });
    screen.invoke('DraftScreen', 'onPick', 'docs');
    screen.invoke('DraftScreen', 'onSkip');
    screen.invoke('DraftScreen', 'onMulligan');
    expect(screen.run.chooseCard).toHaveBeenCalledExactlyOnceWith('docs');
    expect(screen.run.skipDraft).toHaveBeenCalledOnce();
    expect(screen.run.mulliganDraft).toHaveBeenCalledOnce();
    screen.phase('result');
    expect(screen.has('SprintResultScreen')).toBe(false);
    screen.phase('draft', { draft: null });
    expect(screen.has('DraftScreen')).toBe(false);
    expect(screen.provider.props.contentSnapshot).toBeNull();
  });

  it('フェーズ変更時にバナー監視を入れ替え、アンマウント時に監視を解除する', () => {
    const banner = new Element();
    vi.mocked(document.querySelector).mockReturnValue(banner);
    const screen = mountApp({ isReplayMode: true });
    const firstCleanup = vi.mocked(observeReplayBannerHeight).mock.results[0].value;
    expect(observeReplayBannerHeight).toHaveBeenLastCalledWith(banner);
    screen.phase('setup');
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(resetViewportScroll).toHaveBeenCalledTimes(2);
    const lastCleanup = vi.mocked(observeReplayBannerHeight).mock.results.at(-1)!.value;
    screen.unmount();
    expect(lastCleanup).toHaveBeenCalledOnce();
  });
});

describe.each(['EvolutionSimPause', 'SprintSuspendFallback'])(
  'App の %s の pause 所有権',
  (name) => {
    it.each(['own', 'already-paused', 'external-pause'] as const)(
      '%s のとき自分の pause だけを cleanup で解除する',
      (mode) => {
        const screen = mountApp();
        screen.phase('evolution', { sprint: makeSprint(screen.run.state.org, []) });
        if (mode === 'already-paused') screen.game.pause();
        const local = screen.mountLocal(name);
        expect(screen.game.isPaused()).toBe(true);
        expect(screen.game.pause).toHaveBeenCalledOnce();
        if (name === 'SprintSuspendFallback') {
          expect(elements(local.tree).some((node) => componentName(node) === 'Hud')).toBe(true);
          expect((local.tree as ReactElement<Props>).props).toMatchObject({
            'data-responsive-width': 'wide',
            'data-responsive-height': 'tall',
          });
        }
        if (mode === 'external-pause') screen.game.pause();
        local.unmount();
        expect(screen.game.resume).toHaveBeenCalledTimes(mode === 'own' ? 1 : 0);
        expect(screen.game.isPaused()).toBe(mode !== 'own');
      },
    );
  },
);
