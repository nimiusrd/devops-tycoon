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
    expect(content(screen.find(`failure-entry-${failure.type}`))).toContain(
      diagnosisTheme(failure.type).icon,
    );
    expect(content(screen.find(`failure-entry-hint-${failure.type}`))).toBe(
      `${failure.description} ${failure.lesson}`,
    );
    expect(screen.find(`achievement-${ACHIEVEMENT_DEFS[1].id}`).props['data-unlocked']).toBe(
      'false',
    );
    expect(meta.achievements).toEqual([achievement.id, achievement.id, 'unknown-achievement']);
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
