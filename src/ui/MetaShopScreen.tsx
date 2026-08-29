/**
 * メタショップ画面（SPEC 第17章）。
 *
 * ランをまたいで蓄積した points を消費し、カード／レリックを永続解放する。
 * 購入は `GameHandle.purchaseMetaUnlock` 経由（描画は読むだけ。第22.2）。
 */
import { useRef } from 'react';
import { getCard } from '../data/cards';
import { getRelic } from '../data/relics';
import { ACHIEVEMENT_LABEL, type MetaState } from '../state/meta';
import { UNLOCK_DEFS, type UnlockDef } from '../data/unlocks';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface MetaShopScreenProps {
  meta: MetaState;
  onPurchase: (unlockId: string) => void;
  onClose: () => void;
}

function isOwned(meta: MetaState, unlock: UnlockDef): boolean {
  if (unlock.kind === 'card') return meta.unlockedCards.includes(unlock.contentId);
  return meta.unlockedRelics.includes(unlock.contentId);
}

function contentLabel(unlock: UnlockDef): string {
  if (unlock.kind === 'card') return getCard(unlock.contentId)?.name ?? unlock.contentId;
  return getRelic(unlock.contentId)?.name ?? unlock.contentId;
}

export function MetaShopScreen({ meta, onPurchase, onClose }: MetaShopScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(overlayRef, { restoreFocus: true });

  return (
    <div
      ref={overlayRef}
      className="result-overlay"
      data-testid="meta-shop"
      role="dialog"
      aria-modal="true"
      aria-label="Meta shop"
      tabIndex={-1}
    >
      <button
        type="button"
        className="result-overlay-dismiss"
        data-testid="meta-shop-backdrop"
        aria-label="メタショップを閉じる"
        onClick={onClose}
      />
      <div className="meta-shop-panel">
        <p className="result-eyebrow">META SHOP</p>
        <h2 className="draft-title">
          研修費でツール解禁 <b data-testid="meta-shop-points">{meta.points}</b> pt
        </h2>
        <p className="meta-shop-lead">
          永続解放した施策は、次ラン以降のドラフト／ショップに登場します。
        </p>
        <div className="meta-shop-grid">
          {UNLOCK_DEFS.map((unlock) => {
            const owned = isOwned(meta, unlock);
            const needsAchievement =
              unlock.requires && !meta.achievements.includes(unlock.requires);
            const affordable = !owned && !needsAchievement && meta.points >= unlock.cost;
            let status = '購入可能';
            if (owned) status = '購入済み';
            else if (needsAchievement) {
              status = `🔒 実績「${ACHIEVEMENT_LABEL[unlock.requires!] ?? unlock.requires}」が必要`;
            } else if (meta.points < unlock.cost) status = 'ポイント不足';

            return (
              <button
                type="button"
                key={unlock.id}
                className={`meta-shop-item${owned ? ' owned' : ''}${affordable ? ' affordable' : ''}`}
                data-testid={`meta-unlock-${unlock.id}`}
                disabled={!affordable}
                onClick={() => onPurchase(unlock.id)}
              >
                <span className="meta-shop-kind">
                  {unlock.kind === 'card' ? 'カード' : 'レリック'}
                </span>
                <span className="meta-shop-name">{unlock.label}</span>
                <span className="meta-shop-target">{contentLabel(unlock)}</span>
                <p className="meta-shop-desc">{unlock.description}</p>
                <span className="meta-shop-status">
                  {owned ? '✓ 購入済み' : `${unlock.cost} pt — ${status}`}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="meta-shop-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
