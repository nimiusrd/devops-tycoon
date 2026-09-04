import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
    );
  },
}));

// Node で state/ref/effect の再描画だけを代行する。選択・検証・非同期処理は実装を使う。
// 子ダイアログは展開せず、親が渡す公開 callback を検証する。DOM 操作は E2E の担当。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        const next =
          typeof update === 'function'
            ? (update as (value: unknown) => unknown)(slot.value)
            : update;
        if (!Object.is(next, slot.value)) {
          slot.value = next;
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useCallback(callback: unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: callback, dependencies };
    }
    return hooks.slots[index].value;
  },
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (hooks.sameDependencies(previous?.dependencies, dependencies)) return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));
vi.mock('react-dom', () => ({ createPortal: (node: ReactNode) => node }));
vi.mock('../../../src/ui/downloadTextFile', () => ({ downloadTextFile: vi.fn(() => true) }));

import { dailyRunKey, defaultMeta } from '../../../src/state/meta';
import type { ResumeRisk } from '../../../src/state/resumeRisk';
import type { RunSaveSummary } from '../../../src/state/runPersistence';
import { serializeStartRecipe, type StartRecipeInput } from '../../../src/state/startRecipe';
import { downloadTextFile } from '../../../src/ui/downloadTextFile';
import { StartDailyConfirmDialog } from '../../../src/ui/StartDailyConfirmDialog';
import { TitleScreen, type TitleScreenProps } from '../../../src/ui/TitleScreen';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function mountTitle(overrides: Partial<TitleScreenProps> = {}) {
  let props: TitleScreenProps = {
    seed: 'title-seed',
    meta: defaultMeta(),
    onStart: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const targets = new Map<
    string,
    { click: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn> }
  >();
  const flush = () => {
    let renders = 0;
    do {
      if (++renders > 25) throw new Error('TitleScreen の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = TitleScreen(props);
      for (const node of elements(tree)) {
        const id = node.props['data-testid'];
        const ref = node.props.ref as { current: unknown } | undefined;
        if (typeof id !== 'string' || !ref) continue;
        if (!targets.has(id)) targets.set(id, { click: vi.fn(), focus: vi.fn() });
        ref.current = targets.get(id);
      }
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  flush();
  return {
    get tree() {
      return tree;
    },
    get nodes() {
      return elements(tree);
    },
    get props() {
      return props;
    },
    find,
    targets,
    flush,
    update(next: Partial<TitleScreenProps>) {
      props = { ...props, ...next };
      flush();
    },
    click(id: string) {
      const node = find(id);
      expect(node.props.disabled, `${id} が操作可能であること`).not.toBe(true);
      (node.props.onClick as () => void)();
      flush();
    },
    editRecipe(value: string) {
      (find('start-recipe-text').props.onChange as (event: unknown) => void)({ target: { value } });
      flush();
    },
    chooseFile(id: string, file?: { text: () => Promise<string> }) {
      const input = find(id);
      expect(input.props.disabled).not.toBe(true);
      const target = { value: file ? 'selected.json' : '', files: file ? [file] : [] };
      (input.props.onChange as (event: unknown) => void)({ target });
      expect(target.value).toBe('');
      flush();
    },
    async settle() {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      flush();
    },
    dailyDialog() {
      const node = elements(tree).find((item) => item.type === StartDailyConfirmDialog);
      if (!node) throw new Error('デイリー確認がありません');
      return node;
    },
    riskDialog() {
      const node = elements(tree).find((item) => item.props.risk === props.resumeRisk);
      if (!node) throw new Error('危険再開の確認がありません');
      return node;
    },
  };
}

const savedRun: RunSaveSummary = {
  seed: 'saved-seed',
  difficulty: 'normal',
  trials: ['low-focus'],
  runKind: 'normal',
  phase: 'setup',
  quarterNumber: 2,
  sprintIndexInQuarter: 3,
  sprintsPlayed: 8,
  status: 'playing',
};
const recipe: StartRecipeInput = {
  seed: 'shared-seed',
  difficulty: 'normal',
  trials: ['half-budget'],
  scenario: 'copilot',
  preferredCardIds: ['docs'],
};
const dangerousRisk: ResumeRisk = {
  tone: 'danger',
  requiresConfirm: true,
  headline: '燃え尽き寸前のセーブです',
  body: '休息が必要です。',
  seniorHpPct: 12,
  flags: [{ id: 'seniorHp', tone: 'danger', chip: '燃え尽き寸前', detail: '体力低下' }],
};

beforeEach(() => {
  vi.mocked(downloadTextFile).mockReset().mockReturnValue(true);
  vi.stubGlobal('document', { body: {} });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
});

afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('TitleScreen のラン開始条件', () => {
  it('最初の解放済み難易度を選び、試練の追加・解除とシナリオを開始時に渡す', () => {
    const screen = mountTitle({
      meta: { ...defaultMeta(), unlockedDifficulties: ['normal', 'hard'] },
      onStartDaily: vi.fn(),
    });
    expect(screen.find('difficulty-easy').props.disabled).toBe(true);
    expect(screen.find('difficulty-nightmare').props.disabled).toBe(true);
    expect(screen.find('difficulty-normal').props.className).toContain('selected');
    screen.click('difficulty-hard');
    screen.click('trial-low-focus');
    screen.click('trial-half-budget');
    expect(content(screen.find('daily-run-section'))).toContain('×1.32');
    screen.click('trial-low-focus');
    screen.click('scenario-claude-code');
    expect(screen.find('trial-low-focus').props.className).not.toContain(' on');
    expect(screen.find('scenario-claude-code').props.className).toContain(' on');
    expect(content(screen.find('daily-run-section'))).toContain('Hard / 試練 1 / Claude Code');
    expect(content(screen.find('daily-run-section'))).toContain('×1.15');
    screen.click('start-run');
    expect(screen.props.onStart).toHaveBeenCalledExactlyOnceWith(
      'hard',
      ['half-budget'],
      'claude-code',
      undefined,
    );
  });

  it('読み込んだレシピは研修方針を復元し、選択と seed を開始・再書き出しへ反映する', () => {
    const onApplyPreferred = vi.fn();
    const screen = mountTitle({ onApplyPreferred });
    screen.editRecipe(serializeStartRecipe(recipe));
    screen.click('start-recipe-apply');
    expect(onApplyPreferred).toHaveBeenCalledExactlyOnceWith(['docs']);
    expect(content(screen.find('start-recipe-status'))).toBe('開始条件を読み込みました。');
    expect(content(screen.find('seed'))).toBe('seed shared-seed');
    expect(screen.find('difficulty-normal').props.className).toContain('selected');
    expect(screen.find('trial-half-budget').props.className).toContain(' on');
    expect(screen.find('scenario-copilot').props.className).toContain(' on');
    // 親に復元された研修方針が戻る通常の props 更新を再現する。
    screen.update({
      seed: 'new-generated-seed',
      meta: { ...defaultMeta(), preferredCardIds: ['docs'] },
    });
    screen.click('start-run');
    expect(screen.props.onStart).toHaveBeenCalledExactlyOnceWith(
      'normal',
      ['half-budget'],
      'copilot',
      'shared-seed',
    );
    screen.click('start-recipe-export');
    expect(JSON.parse(screen.find('start-recipe-text').props.value as string)).toMatchObject(
      recipe,
    );
    expect(content(screen.find('start-recipe-status'))).toBe('現在の開始条件を書き出しました。');
  });

  it.each([
    ['壊れた JSON', '{bad', '開始レシピが壊れているか、読み取れません。'],
    [
      '未解放の難易度',
      serializeStartRecipe({ ...recipe, difficulty: 'nightmare' }),
      '未解放の難易度が含まれています。',
    ],
  ])('%s を拒否して編集内容と現在の開始条件を保つ', (_label, raw, message) => {
    const screen = mountTitle({ onApplyPreferred: vi.fn() });
    screen.editRecipe(raw);
    screen.click('start-recipe-apply');
    expect(content(screen.find('start-recipe-status'))).toBe(message);
    expect(screen.find('start-recipe-status').props.className).toContain(' error');
    expect(screen.find('start-recipe-text').props.value).toBe(raw);
    screen.click('start-run');
    expect(screen.props.onStart).toHaveBeenCalledExactlyOnceWith('easy', [], 'default', undefined);
    expect(screen.props.onApplyPreferred).not.toHaveBeenCalled();
    screen.click('scenario-devin');
    expect(screen.find('start-recipe-text').props.value).toBe(raw);
    screen.click('start-recipe-export');
    expect(JSON.parse(screen.find('start-recipe-text').props.value as string)).toMatchObject({
      seed: 'title-seed',
      difficulty: 'easy',
      trials: [],
      scenario: 'devin',
    });
    expect(screen.find('start-recipe-status').props.className).not.toContain(' error');
  });

  it('レシピファイルの選択をキャンセルしても状態を変えず、読込成功時には選択を適用する', async () => {
    const screen = mountTitle();
    screen.click('start-recipe-file-button');
    expect(screen.targets.get('start-recipe-file')?.click).toHaveBeenCalledOnce();
    screen.chooseFile('start-recipe-file');
    expect(screen.nodes.some((node) => node.props['data-testid'] === 'start-recipe-status')).toBe(
      false,
    );
    screen.chooseFile('start-recipe-file', { text: async () => serializeStartRecipe(recipe) });
    await screen.settle();
    expect(content(screen.find('start-recipe-status'))).toBe('開始条件を読み込みました。');
    screen.click('start-run');
    expect(screen.props.onStart).toHaveBeenCalledExactlyOnceWith(
      'normal',
      ['half-budget'],
      'copilot',
      'shared-seed',
    );
  });

  it.each([true, false])(
    'レシピ保存の成功=%s を表示し、未適用の編集ではなく現在の条件を保存する',
    (ok) => {
      const screen = mountTitle();
      screen.click('scenario-copilot');
      screen.editRecipe('未適用の編集');
      vi.mocked(downloadTextFile).mockReturnValue(ok);
      screen.click('start-recipe-download');
      const liveText = screen.find('start-recipe-text').props.value as string;
      expect(downloadTextFile).toHaveBeenCalledExactlyOnceWith(
        'devops-tycoon-start-recipe.json',
        liveText,
      );
      expect(JSON.parse(liveText)).toMatchObject({
        seed: 'title-seed',
        difficulty: 'easy',
        scenario: 'copilot',
      });
      expect(content(screen.find('start-recipe-status'))).toBe(
        ok
          ? '開始レシピをファイルに保存しました。'
          : '開始レシピをファイルに保存できませんでした。',
      );
      expect(screen.find('start-recipe-status').props.className).toBe(
        ok ? 'title-recipe-status' : 'title-recipe-status error',
      );
    },
  );
});

describe('TitleScreen の途中セーブ共有', () => {
  it.each([
    ['成功', '{"save":1}', true, '途中セーブをファイルに保存しました。'],
    ['保存失敗', '{"save":1}', false, '途中セーブをファイルに保存できませんでした。'],
    ['セーブ消失', null, true, '書き出せる途中セーブがありません。'],
  ] as const)('途中セーブの書き出し結果（%s）を伝える', (_label, raw, ok, message) => {
    const screen = mountTitle({ resumableSummary: savedRun, onExportRunSave: vi.fn(() => raw) });
    vi.mocked(downloadTextFile).mockReturnValue(ok);
    screen.click('run-save-download');
    expect(screen.props.onExportRunSave).toHaveBeenCalledOnce();
    expect(content(screen.find('run-save-share-status'))).toBe(message);
    if (raw)
      expect(downloadTextFile).toHaveBeenCalledExactlyOnceWith('devops-tycoon-run-save.json', raw);
    else expect(downloadTextFile).not.toHaveBeenCalled();
  });

  it('途中セーブがなければ書き出しを無効にする', () => {
    const screen = mountTitle({ onExportRunSave: vi.fn() });
    expect(screen.find('run-save-download').props.disabled).toBe(true);
    expect(screen.props.onExportRunSave).not.toHaveBeenCalled();
  });

  it('読込中は開始・再開・再読込を無効にし、成功してから操作を戻す', async () => {
    let finishImport!: (result: { ok: boolean; message: string }) => void;
    const onImportRunSave = vi.fn(
      () =>
        new Promise<{ ok: boolean; message: string }>((resolve) => {
          finishImport = resolve;
        }),
    );
    const screen = mountTitle({
      resumableSummary: savedRun,
      onResume: vi.fn(),
      onStartDaily: vi.fn(),
      onImportRunSave,
    });
    screen.click('run-save-file-button');
    expect(screen.targets.get('run-save-file')?.click).toHaveBeenCalledOnce();
    screen.chooseFile('run-save-file');
    expect(onImportRunSave).not.toHaveBeenCalled();
    screen.chooseFile('run-save-file', { text: async () => '{"save":2}' });
    const disabledIds = [
      'start-run',
      'start-daily-run',
      'resume-run',
      'run-save-file-button',
      'run-save-file',
    ];
    for (const id of disabledIds) expect(screen.find(id).props.disabled).toBe(true);
    await screen.settle();
    expect(onImportRunSave).toHaveBeenCalledExactlyOnceWith('{"save":2}');
    expect(screen.props.onStart).not.toHaveBeenCalled();
    expect(screen.props.onResume).not.toHaveBeenCalled();
    finishImport({ ok: true, message: '内部メッセージ' });
    await screen.settle();
    expect(content(screen.find('run-save-share-status'))).toBe(
      '途中セーブを読み込みました。再開できます。',
    );
    for (const id of disabledIds) expect(screen.find(id).props.disabled).toBe(false);
  });

  it.each(['validation', 'read', 'import'] as const)(
    '途中セーブの %s 失敗を表示し、再選択を許可する',
    async (failure) => {
      const onImportRunSave = vi.fn(async () => {
        if (failure === 'import') throw new Error('import failed');
        return { ok: false, message: '保存時のルールセットが異なります。' };
      });
      const screen = mountTitle({ onImportRunSave });
      screen.chooseFile('run-save-file', {
        text: async () => {
          if (failure === 'read') throw new Error('file read failed');
          return 'run-save-json';
        },
      });
      await screen.settle();
      expect(content(screen.find('run-save-share-status'))).toBe(
        failure === 'validation'
          ? '保存時のルールセットが異なります。'
          : '途中セーブが壊れているか、読み取れません。',
      );
      expect(screen.find('run-save-share-status').props.className).toContain(' error');
      expect(screen.find('run-save-file-button').props.disabled).toBe(false);
      expect(screen.find('start-run').props.disabled).toBe(false);
      if (failure === 'read') expect(onImportRunSave).not.toHaveBeenCalled();
      else expect(onImportRunSave).toHaveBeenCalledExactlyOnceWith('run-save-json');
      onImportRunSave.mockResolvedValue({ ok: true, message: '' });
      screen.chooseFile('run-save-file', { text: async () => 'repaired-save' });
      await screen.settle();
      expect(content(screen.find('run-save-share-status'))).toBe(
        '途中セーブを読み込みました。再開できます。',
      );
      expect(screen.find('run-save-share-status').props.className).not.toContain(' error');
    },
  );
});

describe('TitleScreen の再開・デイリー確認', () => {
  it.each([false, true])(
    '今日の記録と報酬受領=%s を表示し、中断ランがなければ直接デイリーを開始する',
    (rewardClaimed) => {
      const screen = mountTitle({
        onStartDaily: vi.fn(),
        meta: {
          ...defaultMeta(),
          dailyRuns: { [dailyRunKey('2026-09-04')]: { bestScore: 123, rewardClaimed } },
        },
      });
      expect(content(screen.find('daily-run-section'))).toContain(
        `UTC 2026-09-04・今日のベスト 123 pt / 報酬${rewardClaimed ? '受領済み' : '未受領'}`,
      );
      screen.click('start-daily-run');
      expect(screen.props.onStartDaily).toHaveBeenCalledOnce();
      expect(screen.nodes.some((node) => node.type === StartDailyConfirmDialog)).toBe(false);
    },
  );

  it.each(['onCancel', 'onResume', 'onDiscardAndStart'] as const)(
    '中断ランのデイリー開始は確認まで保留し、%s だけを実行する',
    (action) => {
      const screen = mountTitle({
        resumableSummary: savedRun,
        onResume: vi.fn(),
        onStartDaily: vi.fn(),
      });
      screen.click('start-daily-run');
      expect(screen.props.onStartDaily).not.toHaveBeenCalled();
      expect(screen.props.onResume).not.toHaveBeenCalled();
      expect(screen.find('start-daily-run').props['aria-expanded']).toBe(true);
      const dialog = screen.dailyDialog();
      expect(dialog.props.summary).toBe(savedRun);
      expect(dialog.props.canResume).toBe(true);
      (dialog.props[action] as () => void)();
      screen.flush();
      expect(screen.nodes.some((node) => node.type === StartDailyConfirmDialog)).toBe(false);
      expect(screen.find('start-daily-run').props['aria-expanded']).toBe(false);
      expect(screen.targets.get('start-daily-run')?.focus).toHaveBeenCalledOnce();
      expect(screen.props.onResume).toHaveBeenCalledTimes(action === 'onResume' ? 1 : 0);
      expect(screen.props.onStartDaily).toHaveBeenCalledTimes(
        action === 'onDiscardAndStart' ? 1 : 0,
      );
    },
  );

  it.each(['ruleset-unknown', 'ruleset-mismatch'] as const)(
    '互換性問題 %s があるセーブは再開・書き出しを無効にし、破棄操作を提供する',
    (kind) => {
      const screen = mountTitle({
        resumableSummary: savedRun,
        onResume: vi.fn(),
        onStartDaily: vi.fn(),
        onDiscardRunSave: vi.fn(),
        onExportRunSave: vi.fn(),
        runSaveIssue: {
          kind,
          summary: savedRun,
          savedRuleset: kind === 'ruleset-unknown' ? null : { version: 1, fingerprint: 'short-id' },
          currentRuleset: { version: 2, fingerprint: 'abcdefghijklmnop' },
        },
      });
      expect(screen.nodes.some((node) => node.props['data-testid'] === 'resume-run')).toBe(false);
      expect(screen.find('run-save-download').props.disabled).toBe(true);
      expect(content(screen.find('incompatible-run-save'))).toContain('現在: v2 / abcdefghijkl…');
      expect(content(screen.find('incompatible-run-save'))).toContain(
        kind === 'ruleset-unknown' ? '保存時: 不明' : '保存時: v1 / short-id',
      );
      expect(content(screen.find('run-save-issue'))).toContain(
        kind === 'ruleset-unknown' ? '情報がない旧セーブ' : 'ルールセットが一致しない',
      );
      screen.click('start-daily-run');
      expect(screen.dailyDialog().props.canResume).toBe(false);
      (screen.dailyDialog().props.onCancel as () => void)();
      screen.flush();
      screen.click('discard-run-save');
      expect(screen.props.onDiscardRunSave).toHaveBeenCalledOnce();
      expect(screen.props.onResume).not.toHaveBeenCalled();
    },
  );

  it('警告不要の中断ランは直接再開する', () => {
    const screen = mountTitle({ resumableSummary: savedRun, onResume: vi.fn() });
    screen.click('resume-run');
    expect(screen.props.onResume).toHaveBeenCalledOnce();
  });

  it.each(['onCancel', 'onConfirm'] as const)(
    '危険なセーブの再開を確認まで保留し、%s の結果を反映する',
    (action) => {
      const screen = mountTitle({
        resumableSummary: savedRun,
        resumeRisk: dangerousRisk,
        onResume: vi.fn(),
      });
      expect(content(screen.find('resume-risk-warning'))).toContain('燃え尽き寸前 12%');
      screen.click('resume-run');
      expect(screen.props.onResume).not.toHaveBeenCalled();
      (screen.riskDialog().props[action] as () => void)();
      screen.flush();
      expect(screen.nodes.some((node) => node.props.risk === dangerousRisk)).toBe(false);
      expect(screen.props.onResume).toHaveBeenCalledTimes(action === 'onConfirm' ? 1 : 0);
      expect(screen.targets.get('resume-run')?.focus).toHaveBeenCalledTimes(
        action === 'onCancel' ? 1 : 0,
      );
    },
  );
});
