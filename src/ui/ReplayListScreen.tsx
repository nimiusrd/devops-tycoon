/**
 * リプレイ一覧・キーフレーム選択（RI-61 / RI-34‴）。
 *
 * 保存済みリプレイからキーフレームを選び、read-only で盤面を開く。
 * reviewHell 診断時は「レビュー地獄リプレイ」専用パネルを重ねる。
 */
import { useState } from 'react';
import { diagnosisView } from '../sim/diagnosis';
import { planReviewHellReplay } from '../render/reviewHellReplayView';
import type { ReplayBlob } from '../state/replay';

export interface ReplayListScreenProps {
  replays: ReplayBlob[];
  onOpen: (id: string, keyframeIndex: number) => void;
  onClose: () => void;
}

function formatFinishedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleString('ja-JP', { hour12: false });
  } catch {
    return String(ms);
  }
}

function outcomeLabel(replay: ReplayBlob): string {
  if (replay.outcome.status === 'won') {
    return `勝利${replay.outcome.winType ? ` (${replay.outcome.winType})` : ''}`;
  }
  return `敗北${replay.outcome.loseReason ? ` (${replay.outcome.loseReason})` : ''}`;
}

export function ReplayListScreen({ replays, onOpen, onClose }: ReplayListScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(replays[0]?.id ?? null);
  const selected = replays.find((r) => r.id === selectedId) ?? null;
  const hellView = selected ? planReviewHellReplay(selected) : null;

  return (
    <div className="result-overlay" data-testid="replay-list" role="dialog" aria-label="Replays">
      <div className="meta-shop-panel replay-list-panel">
        <p className="result-eyebrow">REPLAY</p>
        <h2 className="draft-title">保存済みランの閲覧</h2>
        <p className="meta-shop-lead">
          キーフレームを選んで、当時の盤面を読み取り専用で確認します。
        </p>

        {replays.length === 0 ? (
          <p className="replay-list-empty" data-testid="replay-list-empty">
            まだリプレイがありません。ランを完了するとここに保存されます。
          </p>
        ) : (
          <div className="replay-list-body">
            <ul className="replay-list-items">
              {replays.map((replay) => {
                const isHell = replay.outcome.diagnosis === 'reviewHell';
                return (
                  <li key={replay.id}>
                    <button
                      type="button"
                      className={`${replay.id === selectedId ? 'selected' : ''}${isHell ? ' replay-item-review-hell' : ''}`}
                      data-testid={`replay-item-${replay.id}`}
                      data-diagnosis={replay.outcome.diagnosis}
                      onClick={() => setSelectedId(replay.id)}
                    >
                      <b>{replay.seed}</b>
                      <span>
                        {replay.difficulty} · {outcomeLabel(replay)} · {replay.outcome.score} pt
                      </span>
                      <span className="replay-item-diagnosis">
                        {diagnosisView(replay.outcome.diagnosis).label}
                        {isHell ? (
                          <em
                            className="replay-review-hell-badge"
                            data-testid="replay-review-hell-badge"
                          >
                            レビュー地獄
                          </em>
                        ) : null}
                      </span>
                      <small>{formatFinishedAt(replay.finishedAt)}</small>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="replay-list-keyframes">
              <h3>キーフレーム</h3>
              {selected ? (
                <>
                  {hellView?.show ? (
                    <div
                      className="replay-review-hell-panel tone-review-hell"
                      data-testid="replay-review-hell-panel"
                    >
                      <p className="result-section-label">{hellView.title}</p>
                      <p className="replay-review-hell-lead">{hellView.lead}</p>
                      <p className="replay-review-hell-peak" data-testid="replay-review-hell-peak">
                        Review peak {hellView.reviewQueuePeak}
                      </p>
                      {hellView.burnHeadline ? (
                        <p className="replay-review-hell-burn">{hellView.burnHeadline}</p>
                      ) : null}
                      <p
                        className="replay-review-hell-lesson"
                        data-testid="replay-review-hell-lesson"
                      >
                        {hellView.lesson}
                      </p>
                      <button
                        type="button"
                        className="btn"
                        data-testid="replay-review-hell-open"
                        onClick={() => onOpen(selected.id, hellView.preferredKeyframeIndex)}
                      >
                        レビュー地獄を開く →
                      </button>
                    </div>
                  ) : null}
                  <ul>
                    {selected.keyframes.map((frame, index) => (
                      <li key={`${selected.id}-${index}`}>
                        <button
                          type="button"
                          data-testid={`replay-keyframe-${index}`}
                          onClick={() => onOpen(selected.id, index)}
                        >
                          <b>{frame.phase}</b>
                          {frame.label ? <span>{frame.label}</span> : null}
                          <i>開く →</i>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>リプレイを選択してください。</p>
              )}
            </div>
          </div>
        )}

        <button type="button" className="btn" data-testid="replay-list-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}
