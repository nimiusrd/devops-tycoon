import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// ref の作成のみ代行し、表示内容は実際のコンポーネントを評価する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import { diagnosisTheme } from '../../../src/render/diagnosisTheme';
import { FAILURE_ENCYCLOPEDIA_DEFS } from '../../../src/sim/diagnosis';
import {
  ACHIEVEMENT_DEFS,
  defaultMeta,
  WIN_TITLE_DEFS,
  type MetaState,
} from '../../../src/state/meta';
import { AchievementCollectionScreen } from '../../../src/ui/AchievementCollectionScreen';
import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';

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

function mountCollection(meta: MetaState = defaultMeta()) {
  const onClose = vi.fn();
  const nodes = elements(AchievementCollectionScreen({ meta, onClose }));
  return {
    onClose,
    find(id: string) {
      const node = nodes.find((item) => item.props['data-testid'] === id);
      if (!node) throw new Error(`要素がありません: ${id}`);
      return node;
    },
  };
}

describe('実績・勝利称号・失敗図鑑のコレクション', () => {
  it('未取得の全項目にはロックと獲得ヒントを表示する', () => {
    const screen = mountCollection();
    expect(content(screen.find('achievement-count'))).toBe(`0/${ACHIEVEMENT_DEFS.length}`);
    expect(content(screen.find('win-title-count'))).toBe(`0/${WIN_TITLE_DEFS.length}`);
    expect(content(screen.find('failure-encyclopedia-count'))).toBe(
      `0/${FAILURE_ENCYCLOPEDIA_DEFS.length}`,
    );
    for (const def of ACHIEVEMENT_DEFS) {
      expect(screen.find(`achievement-${def.id}`).props['data-unlocked']).toBe('false');
      expect(content(screen.find(`achievement-${def.id}`))).toContain(`🔒${def.label}`);
      expect(content(screen.find(`achievement-hint-${def.id}`))).toBe(def.hint);
    }
    for (const def of WIN_TITLE_DEFS) {
      expect(screen.find(`win-title-${def.id}`).props['data-unlocked']).toBe('false');
      expect(content(screen.find(`win-title-${def.id}`))).toContain(`🔒${def.label}`);
      expect(content(screen.find(`win-title-hint-${def.id}`))).toBe(def.hint);
    }
    for (const def of FAILURE_ENCYCLOPEDIA_DEFS) {
      expect(screen.find(`failure-entry-${def.type}`).props['data-unlocked']).toBe('false');
      expect(content(screen.find(`failure-entry-${def.type}`))).toContain(`🔒${def.label}`);
      expect(content(screen.find(`failure-entry-hint-${def.type}`))).toBe(def.hint);
    }
  });

  it('取得済み項目だけを数え、実績は達成済み、称号は説明、失敗図鑑は教訓を表示する', () => {
    const achievement = ACHIEVEMENT_DEFS[0];
    const title = WIN_TITLE_DEFS[0];
    const failure = FAILURE_ENCYCLOPEDIA_DEFS[0];
    const meta: MetaState = {
      ...defaultMeta(),
      achievements: [achievement.id, achievement.id, 'unknown-achievement'],
      collectedWinTypes: [title.id, title.id],
      collectedDiagnoses: [failure.type, failure.type, 'healthyAcceleration'],
    };
    const screen = mountCollection(meta);
    expect(content(screen.find('achievement-count'))).toBe(`1/${ACHIEVEMENT_DEFS.length}`);
    expect(content(screen.find('win-title-count'))).toBe(`1/${WIN_TITLE_DEFS.length}`);
    expect(content(screen.find('failure-encyclopedia-count'))).toBe(
      `1/${FAILURE_ENCYCLOPEDIA_DEFS.length}`,
    );
    expect(screen.find(`achievement-${achievement.id}`).props['data-unlocked']).toBe('true');
    expect(content(screen.find(`achievement-${achievement.id}`))).toContain('🏅');
    expect(content(screen.find(`achievement-hint-${achievement.id}`))).toBe('達成済み');
    expect(screen.find(`win-title-${title.id}`).props['data-unlocked']).toBe('true');
    expect(content(screen.find(`win-title-${title.id}`))).toContain('🏆');
    expect(content(screen.find(`win-title-hint-${title.id}`))).toBe(title.description);
    expect(screen.find(`failure-entry-${failure.type}`).props['data-unlocked']).toBe('true');
    expect(
      elements(screen.find(`failure-entry-${failure.type}`)).some(
        (node) => node.props.name === diagnosisTheme(failure.type).icon,
      ),
    ).toBe(true);
    expect(content(screen.find(`failure-entry-hint-${failure.type}`))).toBe(
      `${failure.description} ${failure.lesson}`,
    );
    expect(screen.find(`achievement-${ACHIEVEMENT_DEFS[1].id}`).props['data-unlocked']).toBe(
      'false',
    );
    expect(meta.achievements).toEqual([achievement.id, achievement.id, 'unknown-achievement']);
  });

  it('難易度別の勝ち方は達成の印・未解放の鍵を示し、未達の2件を次の目標にする', () => {
    const empty = mountCollection();
    expect(content(empty.find('win-combo-count'))).toBe(`0/${4 * WIN_TITLE_DEFS.length}`);
    for (const title of WIN_TITLE_DEFS.slice(0, 2)) {
      expect(content(empty.find('win-combo-next'))).toContain(title.label);
    }
    const title = WIN_TITLE_DEFS[1];
    const screen = mountCollection({
      ...defaultMeta(),
      collectedWinTypes: [title.id],
      collectedWinCombos: [`normal:${title.id}`],
    });
    expect(content(screen.find('win-combo-count'))).toBe(`1/${4 * WIN_TITLE_DEFS.length}`);
    const achieved = screen.find(`win-combo-normal-${title.id}`);
    expect(achieved.props['data-achieved']).toBe('true');
    expect(achieved.props['data-next-goal']).toBe('false');
    expect(content(achieved)).toBe(`✓ ${title.label}`);
    const easy = screen.find(`win-combo-easy-${title.id}`);
    expect(easy.props['data-achieved']).toBe('false');
    expect(content(easy)).toBe(title.label);
    expect(easy.props['data-next-goal']).toBe('false');
    expect(screen.find('win-combo-row-normal').props['data-unlocked']).toBe('true');
    expect(content(screen.find('win-combo-row-normal'))).toContain(`1/${WIN_TITLE_DEFS.length}`);
    const hard = screen.find('win-combo-row-hard');
    expect(hard.props['data-unlocked']).toBe('false');
    expect(
      elements(hard).some(
        (node) => node.props.role === 'img' && node.props['aria-label'] === '難易度未解放',
      ),
    ).toBe(true);
    expect(content(hard).match(/前の難易度でボスを突破すると解放/g)).toHaveLength(1);
    expect(() => screen.find(`win-combo-hard-${title.id}`)).toThrow();
    const goals = WIN_TITLE_DEFS.filter((item) => item.id !== title.id).slice(0, 2);
    for (const goal of goals) {
      expect(content(screen.find('win-combo-next'))).toContain(goal.label);
      expect(screen.find(`win-combo-normal-${goal.id}`).props['data-next-goal']).toBe('true');
    }
    expect(content(screen.find('win-combo-next'))).not.toContain(title.label);
    expect(screen.find('win-combo-row-normal').props.className).toContain('is-next-goal');
  });

  it('未達が1件だけならその勝ち方だけを次の目標にする', () => {
    const last = WIN_TITLE_DEFS[WIN_TITLE_DEFS.length - 1];
    const screen = mountCollection({
      ...defaultMeta(),
      collectedWinCombos: WIN_TITLE_DEFS.slice(0, -1).map((title) => `normal:${title.id}`),
    });
    expect(content(screen.find('win-combo-next'))).toContain(last.label);
    expect(content(screen.find('win-combo-next'))).not.toContain(WIN_TITLE_DEFS[0].label);
    expect(screen.find(`win-combo-normal-${last.id}`).props['data-next-goal']).toBe('true');
  });

  it('解放済みの組み合わせをすべて達成したら次の目標を強調しない', () => {
    const meta = defaultMeta();
    const screen = mountCollection({
      ...meta,
      collectedWinCombos: meta.unlockedDifficulties.flatMap((difficulty) =>
        WIN_TITLE_DEFS.map((title) => `${difficulty}:${title.id}`),
      ),
    });
    expect(content(screen.find('win-combo-next'))).toBe(
      '解放済みの難易度で、すべての勝ち方を達成しました。',
    );
    for (const difficulty of meta.unlockedDifficulties) {
      expect(screen.find(`win-combo-row-${difficulty}`).props.className).not.toContain(
        'is-next-goal',
      );
      for (const title of WIN_TITLE_DEFS) {
        expect(screen.find(`win-combo-${difficulty}-${title.id}`).props['data-next-goal']).toBe(
          'false',
        );
      }
    }
  });

  it('閉じるボタンとダイアログの dismiss に同じ終了操作を接続する', () => {
    const screen = mountCollection();
    (screen.find('achievement-collection-close').props.onClick as () => void)();
    expect(screen.onClose).toHaveBeenCalledExactlyOnceWith();
    expect(useDialogOverlayLock).toHaveBeenLastCalledWith(
      { current: null },
      { restoreFocus: true, onDismiss: screen.onClose },
    );
    expect(screen.find('achievement-collection').props.role).toBe('dialog');
    expect(screen.find('achievement-collection').props['aria-modal']).toBe('true');
  });
});
