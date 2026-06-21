/**
 * 業界ランキングビュー（SPEC 第4.10 / mockups/industry-screen）。
 *
 * シーズン制リーダーボード・リーグ・ランキング種別タブ・HQスカイラインを表示し、
 * 自組織をハイライトする。「見かけの出荷だけ高い組織」は総合では上位でも健全経営
 * では沈む（第13章の良し悪しが順位に出る）。状態は読むだけ（第22.2）。
 */
import { RANKING_KINDS, RANKING_LABEL } from '../sim/orgscale/industry';
import type { IndustryState, RankingKind } from '../sim/orgscale/types';

const TREND_ICON: Record<-1 | 0 | 1, string> = { 1: '▲', 0: '→', [-1]: '▼' };

export interface IndustryScreenProps {
  industry: IndustryState;
  onSetKind: (kind: RankingKind) => void;
}

export function IndustryScreen({ industry, onSetKind }: IndustryScreenProps) {
  const { kind, entries } = industry;
  const maxScore = Math.max(1, ...entries.map((e) => e.org.scores[kind]));
  const skyline = entries.slice(0, 8);

  return (
    <div className="industry-screen" data-testid="industry-screen">
      <header className="industry-head">
        <h2>🌏 業界ランキング</h2>
        <span className="industry-season">シーズン {industry.season}</span>
        <span className="industry-league" data-testid="industry-league">
          {industry.league}
        </span>
        <span className="industry-selfrank" data-testid="industry-selfrank">
          自社 {industry.selfRank} 位 / {industry.total} 組織
        </span>
      </header>

      <div className="industry-tabs" data-testid="industry-tabs" role="tablist">
        {RANKING_KINDS.map((k) => (
          <button
            type="button"
            key={k}
            role="tab"
            aria-selected={k === kind}
            className={`industry-tab${k === kind ? ' active' : ''}`}
            data-testid={`rank-tab-${k}`}
            onClick={() => onSetKind(k)}
          >
            {RANKING_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="industry-skyline" data-testid="industry-skyline" aria-hidden>
        {skyline.map((e) => {
          const h = 30 + Math.round((e.org.scores[kind] / maxScore) * 130);
          return (
            <div className="hq" key={e.org.id} title={`${e.org.name}: ${e.org.scores[kind]}`}>
              <span className="hq-crown">{e.rank === 1 ? '👑' : ''}</span>
              <div className={`hq-bar${e.org.isSelf ? ' is-self' : ''}`} style={{ height: h }} />
              <span className="hq-rank">{e.rank}</span>
            </div>
          );
        })}
      </div>

      <table className="industry-table" data-testid="industry-table">
        <thead>
          <tr>
            <th>順位</th>
            <th>組織</th>
            <th>組織タイプ</th>
            <th>{RANKING_LABEL[kind]}</th>
            <th>健全度</th>
            <th>趨勢</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr
              key={e.org.id}
              className={e.org.isSelf ? 'is-self' : undefined}
              data-testid={e.org.isSelf ? 'industry-self-row' : undefined}
            >
              <td className="rank">{e.rank}</td>
              <td className="name">
                {e.org.isSelf ? '★ ' : ''}
                {e.org.name}
              </td>
              <td className="type">{e.org.orgType}</td>
              <td className="score">{e.org.scores[kind]}</td>
              <td className="health">{e.org.healthRank}</td>
              <td className={`trend trend-${e.org.trend}`}>{TREND_ICON[e.org.trend]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
