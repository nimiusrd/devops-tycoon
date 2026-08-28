/**
 * 組織進化ツリー画面（SPEC 第4.5 / 第11章）。
 *
 * スプリントで得た進化ポイントを 5 ブランチに割り振る。前提・コストを満たす
 * ノードのみ解放できる。ビルドの個性（どの会社になるか）がここで決まる。
 */
import { useState } from 'react';
import { BRANCH_LABEL, EVOLUTION_NODES, type EvolutionBranch } from '../data/evolution';
import { formatEvolutionNodeTags } from '../render/eventOutcomeView';
import { canUnlock, isUnlocked } from '../sim/run/evolution';
import type { RunState } from '../sim/run/types';
import { EffectTagList } from './EffectTagList';
import { RewardCeremony } from './JuicyEffects';

const BRANCH_ORDER: EvolutionBranch[] = ['dev', 'review', 'quality', 'ai', 'culture'];

export interface EvolutionScreenProps {
  state: RunState;
  onUnlock: (id: string) => void;
  onFinish: () => void;
}

export function EvolutionScreen({ state, onUnlock, onFinish }: EvolutionScreenProps) {
  const evo = state.evolution;
  const [unlockedNode, setUnlockedNode] = useState<string | null>(null);
  const unlockedNodeName = unlockedNode
    ? EVOLUTION_NODES.find((node) => node.id === unlockedNode)?.name
    : undefined;
  return (
    <div
      className="result-overlay evolution-overlay"
      data-testid="evolution"
      role="dialog"
      aria-label="Evolution Tree"
    >
      <div className="evolution-panel" data-testid="evolution-panel">
        <header className="evolution-head">
          <p className="result-eyebrow">ORGANIZATION EVOLUTION</p>
          <h2 className="draft-title">
            進化ポイント <b data-testid="evo-points">{evo.points}</b> を割り振る
          </h2>
        </header>
        {unlockedNodeName && (
          <RewardCeremony
            kind="evolution"
            title={`${unlockedNodeName} を解放`}
            detail="組織の新しい枝が伸びた"
          />
        )}
        <div className="evolution-branches" data-testid="evolution-branches">
          {BRANCH_ORDER.map((branch) => (
            <div className="evolution-branch" key={branch}>
              <h3 className="branch-label">{BRANCH_LABEL[branch]}</h3>
              {EVOLUTION_NODES.filter((n) => n.branch === branch).map((node) => {
                const unlocked = isUnlocked(evo, node.id);
                const can = canUnlock(evo, node.id);
                return (
                  <button
                    type="button"
                    key={node.id}
                    className={`evo-node${unlocked ? ' unlocked' : ''}${can ? ' can' : ''}`}
                    data-testid={`evo-${node.id}`}
                    disabled={!can}
                    onClick={() => {
                      setUnlockedNode(node.id);
                      onUnlock(node.id);
                    }}
                  >
                    <span className="evo-name">{node.name}</span>
                    <EffectTagList
                      tags={formatEvolutionNodeTags(node)}
                      testId={`evo-effect-tags-${node.id}`}
                    />
                    <span className="evo-desc">{node.description}</span>
                    <span className="evo-cost">{unlocked ? '解放済み' : `⭐${node.cost}`}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="evolution-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="evolution-done"
            onClick={onFinish}
          >
            マップへ戻る →
          </button>
        </div>
      </div>
    </div>
  );
}
