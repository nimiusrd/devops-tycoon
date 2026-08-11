/**
 * ショップ画面（SPEC 第4.4 の $ノード）。
 *
 * 予算でカード購入・レリック購入・採用を行う。予算は四半期の有限資源（第4.7）。
 */
import { getCard, RARITY_LABEL } from '../data/cards';
import { getRelic } from '../data/relics';
import { canRecruit } from '../sim/member';
import { playCost } from '../sim/cards';
import {
  formatCardDefTags,
  formatRelicDefTags,
  formatRestOptionTags,
} from '../render/eventOutcomeView';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';

export interface ShopScreenProps {
  state: RunState;
  onBuyCard: (defId: string) => void;
  onBuyRelic: () => void;
  onBuyRecruit: () => void;
  onLeave: () => void;
}

export function ShopScreen({
  state,
  onBuyCard,
  onBuyRelic,
  onBuyRecruit,
  onLeave,
}: ShopScreenProps) {
  const shop = state.shop;
  if (!shop) return null;
  const relic = shop.relic ? getRelic(shop.relic.id) : undefined;
  const recruit = shop.recruit;
  const rosterHasRoom = canRecruit(state.roster);
  const canAffordRecruit = recruit ? state.budget >= recruit.cost : false;
  const canHire = !!recruit && !recruit.bought && rosterHasRoom && canAffordRecruit;
  return (
    <div className="result-overlay" data-testid="shop" role="dialog" aria-label="Shop">
      <div className="shop-panel">
        <p className="result-eyebrow">SHOP</p>
        <h2 className="draft-title">
          予算 <b data-testid="shop-budget">💰{state.budget}</b> で施策を仕入れる
        </h2>
        <div className="shop-grid">
          {shop.cards.map((offer) => {
            const def = getCard(offer.defId);
            if (!def) return null;
            const affordable = !offer.bought && state.budget >= offer.cost;
            return (
              <button
                type="button"
                key={offer.defId}
                className={`shop-card rarity-${def.rarity}${offer.bought ? ' bought' : ''}`}
                data-testid={`shop-card-${offer.defId}`}
                disabled={!affordable}
                onClick={() => onBuyCard(offer.defId)}
              >
                <span className="shop-card-rarity">{RARITY_LABEL[def.rarity]}</span>
                <span className="shop-card-name">{def.name}</span>
                <EffectTagList
                  tags={formatCardDefTags(def)}
                  testId={`shop-card-effect-tags-${def.id}`}
                />
                <ul className="shop-card-desc">
                  {def.description.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
                <span className="shop-card-cost">
                  {offer.bought ? '購入済み' : `💰${offer.cost}`}
                  <span className="shop-card-focus-cost">
                    {' '}
                    / 発動 ⚡{playCost(def.focusCost, 1)}
                    {offer.bought ? '' : ' / 次スプ手札・導入支援'}
                  </span>
                </span>
              </button>
            );
          })}
          {relic && shop.relic && (
            <button
              type="button"
              className={`shop-card shop-relic${shop.relic.bought ? ' bought' : ''}`}
              data-testid={`shop-relic-${shop.relic.id}`}
              disabled={shop.relic.bought || state.budget < shop.relic.cost}
              onClick={onBuyRelic}
            >
              <span className="shop-card-rarity">レリック</span>
              <span className="shop-card-name">🏛 {relic.name}</span>
              <EffectTagList
                tags={formatRelicDefTags(relic)}
                testId={`shop-relic-effect-tags-${relic.id}`}
              />
              <p className="shop-card-desc">{relic.description}</p>
              <span className="shop-card-cost">
                {shop.relic.bought ? '購入済み' : `💰${shop.relic.cost}`}
              </span>
            </button>
          )}
          {recruit && (
            <button
              type="button"
              className={`shop-card shop-recruit${recruit.bought ? ' bought' : ''}`}
              data-testid="shop-recruit"
              disabled={!canHire}
              onClick={onBuyRecruit}
            >
              <span className="shop-card-rarity">採用</span>
              <span className="shop-card-name">🙋 メンバーを採用</span>
              <EffectTagList
                tags={formatRestOptionTags('recruit')}
                testId="shop-recruit-effect-tags"
              />
              <p className="shop-card-desc">
                {recruit.bought
                  ? '採用済み'
                  : !rosterHasRoom
                    ? 'ロスターが満員です'
                    : !canAffordRecruit
                      ? `予算が足りません（💰${recruit.cost} 必要）`
                      : '未来の主力候補を1人迎える（ベンチに加わる）'}
              </p>
              <span className="shop-card-cost">
                {recruit.bought ? '購入済み' : `💰${recruit.cost}`}
              </span>
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="shop-leave"
          onClick={onLeave}
        >
          ショップを出る →
        </button>
      </div>
    </div>
  );
}
