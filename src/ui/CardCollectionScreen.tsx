/**
 * カードコレクション画面（SPEC 第7.3 / RI-65）。
 *
 * ラン外で全カードをレアリティ別に一覧し、解放済み／未解放を区別する。
 * 解放済みはコスト・効果・タグと研修方針トグル、未解放は解放条件を表示する。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CARD_DEFS, RARITY_LABEL } from '../data/cards';
import { getCardUnlockByContentId } from '../data/unlocks';
import {
  ACHIEVEMENT_LABEL,
  MAX_PREFERRED_CARDS,
  unlockedContent,
  type MetaState,
} from '../state/meta';
import type { CardDef, CardRarity } from '../sim/types';
import { CardView } from './CardView';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface CardCollectionScreenProps {
  meta: MetaState;
  onChangePreferred: (preferredCardIds: readonly string[]) => void;
  onClose: () => void;
}

type RarityFilter = 'all' | CardRarity;

const RARITY_ORDER: CardRarity[] = ['common', 'rare', 'legendary'];

const FILTER_OPTIONS: { id: RarityFilter; label: string }[] = [
  { id: 'all', label: 'すべて' },
  { id: 'common', label: RARITY_LABEL.common },
  { id: 'rare', label: RARITY_LABEL.rare },
  { id: 'legendary', label: RARITY_LABEL.legendary },
];

function unlockConditionText(def: CardDef): string {
  const unlock = getCardUnlockByContentId(def.id);
  if (!unlock) return '初期から利用可能';
  const parts = [`メタショップで ${unlock.cost} pt`];
  if (unlock.requires) {
    parts.push(`実績「${ACHIEVEMENT_LABEL[unlock.requires] ?? unlock.requires}」が必要`);
  }
  return parts.join(' / ');
}

export function CardCollectionScreen({
  meta,
  onChangePreferred,
  onClose,
}: CardCollectionScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef, { restoreFocus: true });
  const unlocked = unlockedContent(meta).cards;
  const preferred = new Set(meta.preferredCardIds);
  const unlockedCount = CARD_DEFS.filter((def) => unlocked.has(def.id)).length;

  const [filter, setFilter] = useState<RarityFilter>('all');
  const [selectedId, setSelectedId] = useState<string>(() => CARD_DEFS[0]?.id ?? '');

  const visibleCards = useMemo(() => {
    const filtered =
      filter === 'all' ? CARD_DEFS : CARD_DEFS.filter((def) => def.rarity === filter);
    return [...filtered].sort(
      (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity),
    );
  }, [filter]);

  const sections = useMemo(() => {
    return RARITY_ORDER.map((rarity) => ({
      rarity,
      cards: visibleCards.filter((def) => def.rarity === rarity),
    })).filter((section) => section.cards.length > 0);
  }, [visibleCards]);

  // フィルター変更で選択が消えた場合は先頭へフォールバック（effect で setState しない）。
  const selected = visibleCards.find((def) => def.id === selectedId) ?? visibleCards[0];
  const activeSelectedId = selected?.id ?? '';
  const selectedUnlocked = selected ? unlocked.has(selected.id) : false;
  const selectedPreferred = selected ? preferred.has(selected.id) : false;

  const togglePreferred = (id: string) => {
    if (!unlocked.has(id)) return;
    if (preferred.has(id)) {
      onChangePreferred(meta.preferredCardIds.filter((x) => x !== id));
      return;
    }
    if (meta.preferredCardIds.length >= MAX_PREFERRED_CARDS) return;
    onChangePreferred([...meta.preferredCardIds, id]);
  };

  useEffect(() => {
    const unlockedIds = unlockedContent(meta).cards;
    const preferredIds = new Set(meta.preferredCardIds);
    const onKey = (e: KeyboardEvent) => {
      if (visibleCards.length === 0) return;
      const index = Math.max(
        0,
        visibleCards.findIndex((def) => def.id === activeSelectedId),
      );
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = visibleCards[Math.min(visibleCards.length - 1, index + 1)];
        if (next) setSelectedId(next.id);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const prev = visibleCards[Math.max(0, index - 1)];
        if (prev) setSelectedId(prev.id);
        return;
      }
      if (e.key === 'Enter') {
        // フィルター／詳細トグル／閉じる等に Tab フォーカス中はネイティブ操作を優先する。
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== document.body &&
          !active.closest('[data-testid="card-collection-list"]')
        ) {
          return;
        }
        e.preventDefault();
        const current = visibleCards[index];
        if (!current || !unlockedIds.has(current.id)) return;
        if (preferredIds.has(current.id)) {
          onChangePreferred(meta.preferredCardIds.filter((x) => x !== current.id));
          return;
        }
        if (meta.preferredCardIds.length >= MAX_PREFERRED_CARDS) return;
        onChangePreferred([...meta.preferredCardIds, current.id]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visibleCards, activeSelectedId, meta, onChangePreferred]);

  const atCap =
    selectedUnlocked && !selectedPreferred && meta.preferredCardIds.length >= MAX_PREFERRED_CARDS;

  return (
    <ResultOverlay
      ref={overlayRef}
      data-testid="card-collection"
      role="dialog"
      aria-modal="true"
      aria-label="カードコレクション"
      tabIndex={-1}
    >
      <button
        type="button"
        className="result-overlay-dismiss"
        data-testid="card-collection-backdrop"
        aria-label="カードコレクションを閉じる"
        onClick={onClose}
      />
      <div className="card-collection-panel">
        <div className="result-overlay-body">
          <p className="result-eyebrow">CARD CODEX</p>
          <h2 className="draft-title">
            カードコレクション{' '}
            <b data-testid="card-collection-count">
              {unlockedCount}/{CARD_DEFS.length}
            </b>
          </h2>
          <p className="card-collection-lead">
            全施策カードの解放状況を確認できます。解放済みカードは研修方針（最大{' '}
            {MAX_PREFERRED_CARDS} 枚）にも反映できます。
          </p>

          <div
            className="card-collection-filters"
            role="toolbar"
            aria-label="レアリティフィルター"
            data-testid="card-collection-filters"
          >
            {FILTER_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`card-collection-filter${filter === option.id ? ' active' : ''}`}
                data-testid={`card-collection-filter-${option.id}`}
                aria-pressed={filter === option.id}
                onClick={() => setFilter(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="card-collection-layout">
            <div className="card-collection-list" data-testid="card-collection-list">
              {sections.map((section) => (
                <section
                  key={section.rarity}
                  className="card-collection-section"
                  aria-labelledby={`card-collection-rarity-${section.rarity}`}
                >
                  <h3
                    id={`card-collection-rarity-${section.rarity}`}
                    className="card-collection-section-title"
                  >
                    {RARITY_LABEL[section.rarity]}
                  </h3>
                  <div className="card-collection-grid">
                    {section.cards.map((def) => {
                      const isUnlocked = unlocked.has(def.id);
                      const isSelected = def.id === selected?.id;
                      const isPreferred = preferred.has(def.id);
                      return (
                        <button
                          type="button"
                          key={def.id}
                          className={`card-collection-item${isUnlocked ? ' unlocked' : ' locked'}${
                            isSelected ? ' selected' : ''
                          }${isPreferred ? ' preferred' : ''}`}
                          data-testid={`card-collection-item-${def.id}`}
                          data-unlocked={isUnlocked ? 'true' : 'false'}
                          data-rarity={def.rarity}
                          aria-pressed={isSelected}
                          onClick={() => setSelectedId(def.id)}
                        >
                          {isUnlocked ? (
                            <CardView def={def} compact />
                          ) : (
                            <div className="card-collection-locked-card">
                              <span className="card-collection-lock-icon" aria-hidden="true">
                                🔒
                              </span>
                              <span className="card-collection-locked-name">{def.name}</span>
                              <span className={`card-rarity rarity-${def.rarity}`}>
                                {RARITY_LABEL[def.rarity]}
                              </span>
                            </div>
                          )}
                          {isPreferred && (
                            <span className="card-collection-preferred-badge">優先中</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <aside className="card-collection-detail" data-testid="card-collection-detail">
              {selected ? (
                selectedUnlocked ? (
                  <>
                    <CardView def={selected} />
                    <button
                      type="button"
                      className={`card-collection-prefer-btn${selectedPreferred ? ' selected' : ''}${
                        atCap ? ' capped' : ''
                      }`}
                      data-testid="card-collection-prefer"
                      aria-pressed={selectedPreferred}
                      disabled={atCap}
                      onClick={() => togglePreferred(selected.id)}
                    >
                      {selectedPreferred
                        ? '✓ 研修方針の優先中'
                        : atCap
                          ? '優先は上限に達しています'
                          : '研修方針に加える'}
                    </button>
                    <p
                      className="card-collection-prefer-count"
                      data-testid="card-collection-prefer-count"
                    >
                      優先 {meta.preferredCardIds.length} / {MAX_PREFERRED_CARDS}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="card-collection-locked-detail">
                      <span className="card-collection-lock-icon" aria-hidden="true">
                        🔒
                      </span>
                      <h3 className="card-collection-detail-name">{selected.name}</h3>
                      <span className={`card-rarity rarity-${selected.rarity}`}>
                        {RARITY_LABEL[selected.rarity]}
                      </span>
                    </div>
                    <p
                      className="card-collection-unlock-condition"
                      data-testid="card-collection-unlock-condition"
                    >
                      解放条件: {unlockConditionText(selected)}
                    </p>
                  </>
                )
              ) : (
                <p className="card-collection-empty">表示するカードがありません。</p>
              )}
            </aside>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-secondary result-overlay-close"
          data-testid="card-collection-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
