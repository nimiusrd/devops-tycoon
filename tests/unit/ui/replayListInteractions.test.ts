import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ cursor: 0, slots: [] as { value: unknown }[] }));

// Node 環境で再描画を跨ぐ state/ref と file input の接続だけを代行する。
// 選択・共有処理と、それらの結果を表示する JSX は実装をそのまま実行する。
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
        slot.value =
          typeof update === 'function'
            ? (update as (previous: unknown) => unknown)(slot.value)
            : update;
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
}));

// フォーカスロックとダウンロードのブラウザ依存部分は各ユニットのテストで扱う。
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));
vi.mock('../../../src/ui/downloadTextFile', () => ({ downloadTextFile: vi.fn() }));

import { RunEngine } from '../../../src/sim/run/engine';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../../src/state/replay';
import { downloadTextFile } from '../../../src/ui/downloadTextFile';
import { ReplayListScreen, type ReplayListScreenProps } from '../../../src/ui/ReplayListScreen';

type ElementProps = Record<string, unknown> & { children?: ReactNode };
type ImportResult = Awaited<ReturnType<NonNullable<ReplayListScreenProps['onImportReplay']>>>;

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

function makeReplay(id: string, overrides: Partial<ReplayBlob> = {}): ReplayBlob {
  const engine = new RunEngine({ seed: id, difficulty: 'easy' });
  engine.startRun('easy', [], id);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('リプレイのテスト用フレームを作成できませんでした');
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id,
    seed: `seed-${id}`,
    difficulty: 'easy',
    trials: [],
    finishedAt: 1_000,
    outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10 },
    keyframes: [
      { phase: 'setup', label: `編成-${id}`, frame },
      { phase: 'won', frame: { ...frame, phase: 'won', status: 'won' } },
    ],
    ruleset: { version: 2, fingerprint: 'recorded-rules' },
    contentSnapshot: null,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountReplayList(initial: Partial<ReplayListScreenProps> = {}) {
  let props: ReplayListScreenProps = {
    replays: [makeReplay('first'), makeReplay('second')],
    onOpen: vi.fn(),
    onClose: vi.fn(),
    ...initial,
  };
  let nodes: ReactElement<ElementProps>[] = [];
  const fileInput = { click: vi.fn() };
  const query = (id: string) => nodes.find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const render = () => {
    hooks.cursor = 0;
    nodes = elements(ReplayListScreen(props));
    const file = query('replay-file');
    if (file) (file.props.ref as { current: unknown }).current = fileInput;
  };
  render();
  return {
    find,
    query,
    fileInput,
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      render();
    },
    chooseFile(file?: { text: () => Promise<string> }) {
      const node = find('replay-file');
      const target = { value: 'C:\\fakepath\\replay.json', files: file ? [file] : [] };
      if (!node.props.disabled) {
        (node.props.onChange as (event: unknown) => void)({ target });
      }
      render();
      return target;
    },
    replaceReplays(replays: ReplayBlob[]) {
      props = { ...props, replays };
      render();
    },
    async settle() {
      // file.text → import → catch/finally の microtask をすべて完了させて再描画する。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      render();
    },
  };
}

beforeEach(() => {
  vi.mocked(downloadTextFile).mockReset().mockReturnValue(true);
});

afterEach(() => {
  hooks.cursor = 0;
  hooks.slots = [];
  vi.restoreAllMocks();
});

describe('ReplayListScreen の選択と閲覧', () => {
  it('選択したランのキーフレームを開き、一覧の追加・並べ替え後も選択を保つ', () => {
    const first = makeReplay('first');
    const second = makeReplay('second');
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const screen = mountReplayList({ replays: [first, second], onOpen, onClose });

    expect(screen.find('replay-item-first').props.className).toBe('selected');
    expect(screen.query('replay-share')).toBeUndefined();
    screen.click('replay-keyframe-0');
    expect(onOpen).toHaveBeenLastCalledWith('first', 0);

    screen.click('replay-item-second');
    expect(screen.find('replay-item-first').props.className).toBe('');
    expect(screen.find('replay-item-second').props.className).toBe('selected');
    expect(content(screen.find('replay-keyframe-0'))).toBe('setup編成-second開く →');
    expect(content(screen.find('replay-keyframe-1'))).toBe('won開く →');
    screen.replaceReplays([makeReplay('newest'), second, first]);
    screen.click('replay-keyframe-1');
    expect(onOpen).toHaveBeenLastCalledWith('second', 1);
    screen.click('replay-list-close');
    expect(onClose).toHaveBeenCalledExactlyOnceWith();
  });

  it('選択中のランが一覧から消えたら残った先頭を開き、空になったら保存を無効にする', () => {
    const first = makeReplay('first');
    const onOpen = vi.fn();
    const onExportReplay = vi.fn(() => '{}');
    const screen = mountReplayList({ onOpen, onExportReplay });
    screen.click('replay-item-second');

    screen.replaceReplays([first]);
    expect(screen.find('replay-item-first').props.className).toBe('selected');
    screen.click('replay-keyframe-1');
    expect(onOpen).toHaveBeenLastCalledWith('first', 1);
    screen.click('replay-download');
    expect(onExportReplay).toHaveBeenCalledExactlyOnceWith('first');

    screen.replaceReplays([]);
    expect(screen.query('replay-list-empty')).toBeDefined();
    expect(screen.query('replay-keyframe-0')).toBeUndefined();
    expect(screen.find('replay-download').props.disabled).toBe(true);
    screen.click('replay-download');
    expect(onExportReplay).toHaveBeenCalledTimes(1);
  });

  it('空の一覧にもファイルを読み込め、追加された先頭を選択する', () => {
    const onImportReplay = vi.fn();
    const onOpen = vi.fn();
    const screen = mountReplayList({ replays: [], onImportReplay, onOpen });

    expect(screen.query('replay-list-empty')).toBeDefined();
    expect(screen.query('replay-download')).toBeUndefined();
    expect(screen.find('replay-file-button').props.disabled).toBe(false);
    expect(screen.find('replay-file').props).toMatchObject({
      type: 'file',
      accept: 'application/json,.json',
      hidden: true,
      disabled: false,
    });
    screen.click('replay-file-button');
    expect(screen.fileInput.click).toHaveBeenCalledExactlyOnceWith();

    screen.replaceReplays([makeReplay('imported')]);
    expect(screen.query('replay-list-empty')).toBeUndefined();
    expect(screen.find('replay-item-imported').props.className).toBe('selected');
    screen.click('replay-keyframe-0');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('imported', 0);
  });

  it('勝敗の詳細と記録時のルールセットを表示する', () => {
    const screen = mountReplayList({
      replays: [
        makeReplay('healthy', {
          outcome: {
            status: 'won',
            winType: 'healthy',
            diagnosis: 'healthyAcceleration',
            score: 42,
          },
        }),
        makeReplay('lost', {
          outcome: { status: 'lost', diagnosis: 'reworkSpiral', score: 3 },
          ruleset: null,
        }),
      ],
    });

    expect(content(screen.find('replay-item-healthy'))).toContain('easy · 勝利 (healthy) · 42 pt');
    expect(content(screen.find('replay-item-healthy'))).toContain('v2 / recorded-rules');
    expect(content(screen.find('replay-item-lost'))).toContain('easy · 敗北 · 3 pt');
    expect(content(screen.find('replay-item-lost'))).toContain('ルールセット不明');
  });

  it('レビュー地獄の専用パネルから、選択したランの終端キーフレームを開く', () => {
    const replay = makeReplay('review-hell');
    const terminal = replay.keyframes[1].frame;
    replay.outcome = {
      status: 'lost',
      loseReason: 'reviewFreeze',
      diagnosis: 'reviewHell',
      score: 12,
    };
    replay.keyframes[1] = {
      phase: 'lost',
      label: 'レビュー凍結',
      frame: {
        ...terminal,
        phase: 'lost',
        status: 'lost',
        totals: { ...terminal.totals, reviewQueuePeak: 17 },
      },
    };
    const onOpen = vi.fn();
    const screen = mountReplayList({ replays: [makeReplay('normal'), replay], onOpen });
    expect(screen.query('replay-review-hell-panel')).toBeUndefined();

    screen.click('replay-item-review-hell');
    expect(screen.find('replay-item-review-hell').props.className).toBe(
      'selected replay-item-review-hell',
    );
    expect(content(screen.find('replay-item-review-hell'))).toContain('敗北 (reviewFreeze)');
    expect(content(screen.find('replay-review-hell-badge'))).toBe('レビュー地獄');
    expect(content(screen.find('replay-review-hell-peak'))).toBe('Review peak 17');
    expect(content(screen.find('replay-review-hell-lesson'))).not.toBe('');
    screen.click('replay-review-hell-open');
    expect(onOpen).toHaveBeenCalledExactlyOnceWith('review-hell', 1);

    screen.click('replay-item-normal');
    expect(screen.query('replay-review-hell-panel')).toBeUndefined();
  });
});

describe('ReplayListScreen のファイル共有', () => {
  it.each([
    {
      text: '{"id":"second"}',
      downloaded: true,
      error: false,
      message: 'リプレイをファイルに保存しました。',
    },
    { text: null, downloaded: true, error: true, message: '書き出せるリプレイがありません。' },
    {
      text: '{"id":"second"}',
      downloaded: false,
      error: true,
      message: 'リプレイをファイルに保存できませんでした。',
    },
  ])('保存結果に応じて「$message」を表示する', ({ text, downloaded, error, message }) => {
    const onExportReplay = vi.fn(() => text);
    vi.mocked(downloadTextFile).mockReturnValue(downloaded);
    const screen = mountReplayList({ onExportReplay });
    expect(screen.query('replay-file')).toBeUndefined();
    screen.click('replay-item-second');
    screen.click('replay-download');

    expect(onExportReplay).toHaveBeenCalledExactlyOnceWith('second');
    if (text) {
      expect(downloadTextFile).toHaveBeenCalledExactlyOnceWith('devops-tycoon-replay.json', text);
    } else {
      expect(downloadTextFile).not.toHaveBeenCalled();
    }
    const status = screen.find('replay-share-status');
    expect(content(status)).toBe(message);
    expect(status.props.className).toBe(`replay-share-status${error ? ' error' : ''}`);
    expect(status.props).toMatchObject({ role: 'status', 'aria-live': 'polite' });
  });

  it('ファイル選択をキャンセルしたら状態を変えず、同じファイルを再選択できるよう入力を空にする', () => {
    const onImportReplay = vi.fn();
    const screen = mountReplayList({ onImportReplay });

    expect(screen.chooseFile().value).toBe('');
    expect(onImportReplay).not.toHaveBeenCalled();
    expect(screen.query('replay-share-status')).toBeUndefined();
    expect(screen.find('replay-file').props.disabled).toBe(false);
  });

  it('ファイル読込と取り込みの完了まで重複入力を止め、成功後に再び入力できる', async () => {
    const read = deferred<string>();
    const imported = deferred<ImportResult>();
    const onImportReplay = vi.fn(() => imported.promise);
    const screen = mountReplayList({ replays: [], onImportReplay });
    const file = { text: vi.fn(() => read.promise) };

    expect(screen.chooseFile(file).value).toBe('');
    expect(file.text).toHaveBeenCalledExactlyOnceWith();
    expect(onImportReplay).not.toHaveBeenCalled();
    expect(screen.find('replay-file').props.disabled).toBe(true);
    expect(screen.find('replay-file-button').props.disabled).toBe(true);
    screen.click('replay-file-button');
    expect(screen.fileInput.click).not.toHaveBeenCalled();

    read.resolve('{"id":"imported"}');
    await screen.settle();
    expect(onImportReplay).toHaveBeenCalledExactlyOnceWith('{"id":"imported"}');
    expect(screen.find('replay-file').props.disabled).toBe(true);
    expect(screen.query('replay-share-status')).toBeUndefined();

    imported.resolve({ ok: true, message: '内部向けの結果' });
    await screen.settle();
    expect(content(screen.find('replay-share-status'))).toBe('リプレイを読み込みました。');
    expect(screen.find('replay-share-status').props.className).toBe('replay-share-status');
    expect(screen.find('replay-file').props.disabled).toBe(false);
    expect(screen.find('replay-file-button').props.disabled).toBe(false);
    screen.click('replay-file-button');
    expect(screen.fileInput.click).toHaveBeenCalledExactlyOnceWith();
  });

  it('取り込み拒否の理由を表示し、再試行で成功するとエラー表示を解除する', async () => {
    const onImportReplay = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: '未対応のリプレイ形式です。' })
      .mockResolvedValueOnce({ ok: true, message: '' });
    const screen = mountReplayList({ onImportReplay });
    screen.chooseFile({ text: async () => 'unsupported' });
    await screen.settle();

    expect(content(screen.find('replay-share-status'))).toBe('未対応のリプレイ形式です。');
    expect(screen.find('replay-share-status').props.className).toBe('replay-share-status error');
    expect(screen.find('replay-file').props.disabled).toBe(false);
    screen.chooseFile({ text: async () => 'supported' });
    await screen.settle();

    expect(onImportReplay.mock.calls).toEqual([['unsupported'], ['supported']]);
    expect(content(screen.find('replay-share-status'))).toBe('リプレイを読み込みました。');
    expect(screen.find('replay-share-status').props.className).toBe('replay-share-status');
  });

  it.each(['read', 'import'] as const)(
    '%s が失敗したら破損・読込エラーを表示して操作を再開する',
    async (failure) => {
      const onImportReplay = vi.fn(async () => {
        if (failure === 'import') throw new Error('取り込み失敗');
        return { ok: true, message: '' };
      });
      const screen = mountReplayList({ onImportReplay });
      screen.chooseFile({
        text: async () => {
          if (failure === 'read') throw new Error('ファイル読込失敗');
          return 'raw-replay';
        },
      });
      await screen.settle();

      expect(onImportReplay).toHaveBeenCalledTimes(failure === 'read' ? 0 : 1);
      if (failure === 'import') expect(onImportReplay).toHaveBeenCalledWith('raw-replay');
      expect(content(screen.find('replay-share-status'))).toBe(
        'リプレイが壊れているか、読み取れません。',
      );
      expect(screen.find('replay-share-status').props.className).toBe('replay-share-status error');
      expect(screen.find('replay-file').props.disabled).toBe(false);
      expect(screen.find('replay-file-button').props.disabled).toBe(false);
    },
  );
});
