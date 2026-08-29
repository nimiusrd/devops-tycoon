/**
 * 研修方針（カードデッキのカスタマイズ）画面（SPEC §23 / RI-34⁗）。
 *
 * ラン外で優先施策を最大 2 枚選び、次ラン以降のドラフト／ショップの出やすさを偏らせる。
 * 初期所持にはしない（RI-24 / §17 と整合）。購入はせずメタへ保存するだけ。
 */
import { useRef } from 'react';
import { CARD_DEFS } from '../data/cards';
import { MAX_PREFERRED_CARDS, unlockedContent, type MetaState } from '../state/meta';
import { CardView } from './CardView';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface DeckPolicyScreenProps {
  meta: MetaState;
  onChange: (preferredCardIds: readonly string[]) => void;
  onClose: () => void;
}

export function DeckPolicyScreen({ meta, onChange, onClose }: DeckPolicyScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef, { restoreFocus: true });
  const unlocked = unlockedContent(meta).cards;
  const preferred = new Set(meta.preferredCardIds);
  const candidates = CARD_DEFS.filter((def) => unlocked.has(def.id));

  const toggle = (id: string) => {
    if (preferred.has(id)) {
      onChange(meta.preferredCardIds.filter((x) => x !== id));
      return;
    }
    if (meta.preferredCardIds.length >= MAX_PREFERRED_CARDS) return;
    onChange([...meta.preferredCardIds, id]);
  };

  return (
    <ResultOverlay
      ref={overlayRef}
      data-testid="deck-policy"
      role="dialog"
      aria-modal="true"
      aria-label="研修方針"
      tabIndex={-1}
    >
      <div className="deck-policy-panel">
        <div className="result-overlay-body">
          <p className="result-eyebrow">TRAINING POLICY</p>
          <h2 className="draft-title">
            研修方針 <b data-testid="deck-policy-count">{meta.preferredCardIds.length}</b> /{' '}
            {MAX_PREFERRED_CARDS}
          </h2>
          <p className="deck-policy-lead">
            優先する施策を選ぶと、次ラン以降のドラフト／ショップに出やすくなります。
            初期デッキには入りません。デイリーランには適用されません。
          </p>
          <div className="deck-policy-grid" data-testid="deck-policy-grid">
            {candidates.map((def) => {
              const selected = preferred.has(def.id);
              const atCap = !selected && meta.preferredCardIds.length >= MAX_PREFERRED_CARDS;
              return (
                <button
                  type="button"
                  key={def.id}
                  className={`deck-policy-item${selected ? ' selected' : ''}${atCap ? ' capped' : ''}`}
                  data-testid={`deck-policy-${def.id}`}
                  aria-pressed={selected}
                  disabled={atCap}
                  onClick={() => toggle(def.id)}
                >
                  <CardView def={def} compact />
                  <span className="deck-policy-status">
                    {selected ? '✓ 優先中' : atCap ? '上限に達しています' : '優先に加える'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="btn btn-secondary result-overlay-close"
          data-testid="deck-policy-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
