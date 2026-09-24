/**
 * ショップ画面（SPEC 第4.4 の $ノード）。
 *
 * 予算でカード購入・レリック購入・採用を行う。予算は四半期の有限資源（第4.7）。
 * 支払後に予算枯渇する操作は確定してから実行する（RI-147）。
 */
import { useState } from 'react';
import { RARITY_LABEL } from '../data/cards';
import { canRecruit } from '../sim/member';
import { playCost } from '../sim/cards';
import {
  formatCardDefTags,
  formatRelicDefTags,
  formatRestOptionTags,
} from '../render/eventOutcomeView';
import { spendRiskView, spendStatusText, type SpendRiskView } from '../render/spendRiskView';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { SpendConfirm } from './SpendConfirm';
import { useReplayContent } from './replayContent';

type PendingSpend = { id: string; subject: string; risk: SpendRiskView };

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
  const { resolveCard, resolveRelic } = useReplayContent();
  const [pending, setPending] = useState<PendingSpend | null>(null);
  const shop = state.shop;
  if (!shop) return null;
  const relic = shop.relic ? resolveRelic(shop.relic.id) : undefined;
  const recruit = shop.recruit;
  const rosterHasRoom = canRecruit(state.roster);
  const relicRisk = shop.relic
    ? spendRiskView({
        budget: state.budget,
        cost: shop.relic.cost,
        bought: shop.relic.bought,
      })
    : null;
  const recruitRisk = recruit
    ? spendRiskView({
        budget: state.budget,
        cost: recruit.cost,
        bought: recruit.bought,
        rosterFull: !rosterHasRoom,
      })
    : null;
  const canHire = recruitRisk?.blocked === null;
  const requestSpend = (next: PendingSpend, run: () => void) => {
    if (next.risk.blocked) return;
    if (next.risk.requiresConfirm) {
      setPending(next);
      return;
    }
    setPending(null);
    run();
  };
  return (
    <div className="result-overlay" data-testid="shop" role="dialog" aria-label="Shop">
      <div className="shop-panel">
        <p className="result-eyebrow">SHOP</p>
        <h2 className="draft-title">
          予算 <b data-testid="shop-budget">💰{state.budget}</b> で施策を仕入れる
        </h2>
        {pending ? (
          <SpendConfirm
            subject={pending.subject}
            balanceAfter={pending.risk.balanceAfter}
            onConfirm={() => {
              const current = pending;
              setPending(null);
              if (current.id.startsWith('card:')) onBuyCard(current.id.slice('card:'.length));
              else if (current.id === 'relic') onBuyRelic();
              else if (current.id === 'recruit') onBuyRecruit();
            }}
            onCancel={() => setPending(null)}
          />
        ) : null}
        <div className="shop-grid">
          {shop.cards.map((offer) => {
            const def = resolveCard(offer.defId);
            const risk = spendRiskView({
              budget: state.budget,
              cost: offer.cost,
              bought: offer.bought,
            });
            return (
              <button
                type="button"
                key={offer.defId}
                className={`shop-card rarity-${def.rarity}${offer.bought ? ' bought' : ''}${risk.endsRun ? ' is-spend-risk' : ''}`}
                data-testid={`shop-card-${offer.defId}`}
                disabled={risk.blocked !== null}
                onClick={() =>
                  requestSpend({ id: `card:${offer.defId}`, subject: def.name, risk }, () =>
                    onBuyCard(offer.defId),
                  )
                }
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
                  {risk.balanceLabel ? (
                    <span className="spend-risk-note">{risk.balanceLabel}</span>
                  ) : null}
                  {risk.warningLabel ? (
                    <span className="spend-risk-warning">{risk.warningLabel}</span>
                  ) : null}
                  <span className="shop-card-focus-cost">
                    {' '}
                    / 発動 ⚡{playCost(def.focusCost, 1)}
                    {offer.bought
                      ? ''
                      : shop.introSupportGranted
                        ? ' / 次スプ手札'
                        : ' / 次スプ手札・導入支援'}
                  </span>
                </span>
              </button>
            );
          })}
          {relic && shop.relic && relicRisk && (
            <button
              type="button"
              className={`shop-card shop-relic${shop.relic.bought ? ' bought' : ''}${
                relicRisk.endsRun ? ' is-spend-risk' : ''
              }`}
              data-testid={`shop-relic-${shop.relic.id}`}
              disabled={relicRisk.blocked !== null}
              onClick={() =>
                requestSpend({ id: 'relic', subject: relic.name, risk: relicRisk }, onBuyRelic)
              }
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
                {relicRisk.balanceLabel ? (
                  <span className="spend-risk-note">{relicRisk.balanceLabel}</span>
                ) : null}
                {relicRisk.warningLabel ? (
                  <span className="spend-risk-warning">{relicRisk.warningLabel}</span>
                ) : null}
              </span>
            </button>
          )}
          {recruit && recruitRisk && (
            <button
              type="button"
              className={`shop-card shop-recruit${recruit.bought ? ' bought' : ''}${
                recruitRisk.endsRun ? ' is-spend-risk' : ''
              }`}
              data-testid="shop-recruit"
              disabled={!canHire}
              onClick={() =>
                requestSpend(
                  { id: 'recruit', subject: 'メンバーの採用', risk: recruitRisk },
                  onBuyRecruit,
                )
              }
            >
              <span className="shop-card-rarity">採用</span>
              <span className="shop-card-name">🙋 メンバーを採用</span>
              <EffectTagList
                tags={formatRestOptionTags('recruit')}
                testId="shop-recruit-effect-tags"
              />
              <p className="shop-card-desc">
                {spendStatusText(
                  recruitRisk,
                  '未来の主力候補を1人迎える（ベンチに加わる）',
                  recruit.bought ? '採用済み' : 'ロスターが満員です',
                )}
              </p>
              <span className="shop-card-cost">
                {recruit.bought ? '購入済み' : `💰${recruit.cost}`}
                {recruitRisk.balanceLabel ? (
                  <span className="spend-risk-note">{recruitRisk.balanceLabel}</span>
                ) : null}
                {recruitRisk.warningLabel ? (
                  <span className="spend-risk-warning">{recruitRisk.warningLabel}</span>
                ) : null}
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
