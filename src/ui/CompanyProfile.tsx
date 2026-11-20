import { companyProfileView, type CompanyProfileState } from '../render/companyProfileView';
import { EffectTagList } from './EffectTagList';
import { useReplayContent } from './replayContent';

export function CompanyProfile({ state }: { state: CompanyProfileState }) {
  const content = useReplayContent();
  const profile = companyProfileView(state, content);

  return (
    <details className="result-details company-profile" data-testid="company-profile">
      <summary data-testid="company-profile-summary">
        <span className="company-profile-overview">
          <span>この会社が築いたもの</span>
          <span className="company-profile-caption">
            <span>
              進化 {profile.unlockedCount}/{profile.evolutionCount}
            </span>
            <span>カード {profile.cards.length}枚</span>
            <span>レリック {profile.relics.length}個</span>
          </span>
        </span>
      </summary>
      <div className="company-profile-body" data-testid="company-profile-body">
        <p className="company-profile-caption">
          このランの成長を表示します。ランをまたぐメタ解放は、カードやレリックの出現候補を広げます。
        </p>
        <section>
          <h3>組織進化と次の目標</h3>
          <p>
            現在の進化ポイント <b data-testid="company-profile-points">{profile.points}</b>
          </p>
          <div className="company-profile-branches">
            {profile.branches.map((branch) => (
              <details
                className="result-details company-profile-branch"
                key={branch.branch}
                data-testid={`company-profile-branch-${branch.branch}`}
              >
                <summary>
                  <span>
                    <span>
                      {branch.label} {branch.unlockedCount}/{branch.nodes.length}
                    </span>
                    <span className="company-profile-next">
                      {branch.next
                        ? `次は ${branch.next.name}（${branch.next.status}）`
                        : 'すべて解放済み'}
                    </span>
                  </span>
                </summary>
                <ul>
                  {branch.nodes.map((node) => (
                    <li key={node.id} data-testid={`company-profile-node-${node.id}`}>
                      <b>{node.name}</b> · {node.status}
                      {!node.unlocked && (
                        <>
                          <p>
                            必要 {node.cost}ポイント
                            {node.shortfall > 0 && `、あと${node.shortfall}ポイント`}
                          </p>
                          <p>
                            前提{' '}
                            {node.prerequisite
                              ? `${node.prerequisite.name}（${node.prerequisite.met ? '達成' : '未達'}）`
                              : 'なし'}
                          </p>
                        </>
                      )}
                      <p>{node.description}</p>
                      <EffectTagList
                        tags={node.tags}
                        testId={`company-profile-effects-${node.id}`}
                      />
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
        <section>
          <h3>支援中チームのメンバー{profile.teamName && ` · ${profile.teamName}`}</h3>
          {profile.members.length === 0 ? (
            <p>編成メンバーがいません</p>
          ) : (
            <ul data-testid="company-profile-members">
              {profile.members.map((member) => (
                <li key={member.id}>
                  <b>{member.name}</b> · {member.rank} Lv.{member.level}
                  {member.onLeave && ' · 休職中'}
                </li>
              ))}
            </ul>
          )}
        </section>
        <details className="result-details">
          <summary>導入済みカード（デッキ {profile.cards.length}枚）</summary>
          {profile.cards.length === 0 ? (
            <p>デッキにカードがありません</p>
          ) : (
            <>
              <p className="company-profile-caption">
                このデッキから手札が配られます。効果欄は、現在のレベルで発動したときの内容です。
              </p>
              <ul>
                {profile.cards.map((card, index) => (
                  <li key={`${card.id}-${index}`}>
                    <b>{card.name}</b> · Lv.{card.level}
                    <p>{card.description}</p>
                    <EffectTagList tags={card.tags} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
        <details className="result-details">
          <summary>所持レリック（{profile.relics.length}個）</summary>
          {profile.relics.length === 0 ? (
            <p>所持レリックはありません</p>
          ) : (
            <ul>
              {profile.relics.map((relic) => (
                <li key={relic.id}>
                  <b>{relic.name}</b>
                  <p>{relic.description}</p>
                  <EffectTagList tags={relic.tags} />
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </details>
  );
}
