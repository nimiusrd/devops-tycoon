/**
 * リプレイ一覧・キーフレーム選択（RI-61）。
 *
 * 保存済みリプレイからキーフレームを選び、read-only で盤面を開く。
 */
import { useState } from 'react';
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
              {replays.map((replay) => (
                <li key={replay.id}>
                  <button
                    type="button"
                    className={replay.id === selectedId ? 'selected' : ''}
                    data-testid={`replay-item-${replay.id}`}
                    onClick={() => setSelectedId(replay.id)}
                  >
                    <b>{replay.seed}</b>
                    <span>
                      {replay.difficulty} · {outcomeLabel(replay)} · {replay.outcome.score} pt
                    </span>
                    <small>{formatFinishedAt(replay.finishedAt)}</small>
                  </button>
                </li>
              ))}
            </ul>
            <div className="replay-list-keyframes">
              <h3>キーフレーム</h3>
              {selected ? (
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
