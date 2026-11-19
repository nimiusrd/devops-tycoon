/**
 * リプレイ一覧・キーフレーム選択（RI-61 / RI-34‴）。
 *
 * 保存済みリプレイからキーフレームを選び、read-only で盤面を開く。
 * reviewHell 診断時は「レビュー地獄リプレイ」専用パネルを重ねる。
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { diagnosisView } from '../sim/diagnosis';
import {
  formatReplayKeyframeLabel,
  planReviewHellReplay,
  reviewQueuePeakCountLabel,
} from '../render/reviewHellReplayView';
import { formatReplayRuleset } from './replayRuleset';
import { resolveSelectedReplayId } from './replayListSelection';
import { ResultOverlay } from './ResultOverlay';
import { PERSISTENCE_BACKUP_RESTORED_MESSAGE } from '../state/persistenceBackup';
import { REPLAY_ANNOTATION_MAX_LENGTH, type ReplayBlob } from '../state/replay';
import { downloadTextFile } from './downloadTextFile';
import { useDialogOverlayLock } from './useDialogOverlayLock';

export interface ReplayListScreenProps {
  replays: ReplayBlob[];
  onOpen: (id: string, keyframeIndex: number) => void;
  onClose: () => void;
  /** 選択中リプレイを JSON にする（無い場合は null。RI-133）。 */
  onExportReplay?: (id: string) => string | null;
  /** JSON からリプレイを読み込む。 */
  onImportReplay?: (raw: string) => Promise<{ ok: boolean; message: string; restored?: 'both' }>;
  onSaveAnnotation?: (
    expected: ReplayBlob,
    index: number,
    text: string,
  ) => Promise<{ ok: boolean; message: string; replay?: ReplayBlob }>;
  onGetAnnotationRecovery?: (id: string) => { previous: ReplayBlob; replay: ReplayBlob } | null;
}

function ReplayAnnotationEditor({
  replay,
  onSave,
  disabled,
  onBusy,
  recovery,
}: {
  replay: ReplayBlob;
  onSave: NonNullable<ReplayListScreenProps['onSaveAnnotation']>;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  recovery: { previous: ReplayBlob; replay: ReplayBlob } | null;
}) {
  // 編集中の基準を固定する。一覧更新で別タブの変更を承認したことにしない。
  const [baseline, setBaseline] = useState(replay);
  const initialDraft = recovery?.replay ?? replay;
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      initialDraft.keyframes.findIndex((frame) => frame.id === initialDraft.annotation?.keyframeId),
    ),
  );
  const [text, setText] = useState(initialDraft.annotation?.text ?? '');
  const [status, setStatus] = useState('');
  const [failed, setFailed] = useState(false);
  // 共通バナーが自分の失敗した書込みを完了したときだけ基準を進める。
  // 再試行中に入力した新しい下書きは消さず、別タブの別内容は承認しない。
  if (
    recovery &&
    JSON.stringify(baseline) === JSON.stringify(recovery.previous) &&
    JSON.stringify(replay) === JSON.stringify(recovery.replay) &&
    JSON.stringify(replay) !== JSON.stringify(baseline)
  ) {
    const matchesDraft =
      text === (recovery.replay.annotation?.text ?? '') &&
      (!recovery.replay.annotation ||
        recovery.replay.keyframes[index]?.id === recovery.replay.annotation.keyframeId);
    setBaseline(replay);
    setFailed(false);
    setStatus(matchesDraft ? '注釈を保存しました。' : '未保存の変更があります。');
  }
  return (
    <form
      className="replay-annotation-editor"
      data-testid="replay-annotation-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) return;
        onBusy(true);
        setStatus('保存中…');
        void onSave(baseline, index, text)
          .then((result) => {
            setStatus(result.message);
            setFailed(!result.ok);
            if (result.ok && result.replay) {
              setBaseline(result.replay);
            }
          })
          .catch(() => {
            setFailed(true);
            setStatus('注釈を保存できませんでした。再試行できます。');
          })
          .finally(() => onBusy(false));
      }}
    >
      <h3>作者の理由</h3>
      <p id="replay-annotation-help">
        注釈は1リプレイにつき1場面です。記録済みのフェーズ境界だけを選べます。任意の時刻や連続ハイライトには対応していません。作者の説明は、実測結果や因果を保証するものではありません。
      </p>
      <label className="result-hypothesis-label" htmlFor="replay-annotation-scene">
        注釈を付ける場面
      </label>
      <select
        id="replay-annotation-scene"
        className="replay-annotation-scene"
        data-testid="replay-annotation-scene"
        value={index}
        disabled={disabled}
        onChange={(event) => {
          setIndex(Number(event.target.value));
          setStatus('未保存の変更があります。');
          setFailed(false);
        }}
      >
        {baseline.keyframes.map((frame, i) => (
          <option key={frame.id ?? i} value={i}>
            {i + 1}. {formatReplayKeyframeLabel(frame.label ?? frame.phase)}
          </option>
        ))}
      </select>
      <label className="result-hypothesis-label" htmlFor="replay-annotation-text">
        この判断を選んだ理由（{REPLAY_ANNOTATION_MAX_LENGTH}文字まで）
      </label>
      <textarea
        id="replay-annotation-text"
        className="result-hypothesis-input"
        data-testid="replay-annotation-text"
        aria-describedby="replay-annotation-help"
        maxLength={REPLAY_ANNOTATION_MAX_LENGTH}
        value={text}
        disabled={disabled}
        onChange={(event) => {
          setText(event.target.value);
          setStatus('未保存の変更があります。');
          setFailed(false);
        }}
      />
      <p>
        空欄で保存すると注釈を削除します。{text.length}/{REPLAY_ANNOTATION_MAX_LENGTH}
      </p>
      <button
        className="btn btn-primary"
        type="submit"
        data-testid="replay-annotation-save"
        disabled={disabled}
      >
        注釈を保存
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`replay-share-status${failed ? ' error' : ''}`}
        data-testid="replay-annotation-status"
      >
        {status}
      </p>
    </form>
  );
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

export function ReplayListScreen({
  replays,
  onOpen,
  onClose,
  onExportReplay,
  onImportReplay,
  onSaveAnnotation,
  onGetAnnotationRecovery,
}: ReplayListScreenProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(replays[0]?.id ?? null);
  const resolvedSelectedId = resolveSelectedReplayId(replays, selectedId);
  const selected = replays.find((r) => r.id === resolvedSelectedId) ?? null;
  const hellView = selected ? planReviewHellReplay(selected) : null;
  const replayFileRef = useRef<HTMLInputElement>(null);
  const replayImportGen = useRef(0);
  const [replayImporting, setReplayImporting] = useState(false);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const busy = replayImporting || annotationSaving;
  useDialogOverlayLock(overlayRef, {
    restoreFocus: true,
    onDismiss: busy ? undefined : onClose,
  });
  const [shareStatus, setShareStatus] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });

  const downloadSelected = () => {
    if (!onExportReplay || !selected) {
      setShareStatus({ kind: 'error', message: '書き出せるリプレイがありません。' });
      return;
    }
    const text = onExportReplay(selected.id);
    if (!text) {
      setShareStatus({ kind: 'error', message: '書き出せるリプレイがありません。' });
      return;
    }
    if (downloadTextFile('devops-tycoon-replay.json', text)) {
      setShareStatus({ kind: 'ok', message: 'リプレイをファイルに保存しました。' });
      return;
    }
    setShareStatus({
      kind: 'error',
      message: 'リプレイをファイルに保存できませんでした。',
    });
  };

  const onReplayFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportReplay) return;
    const requestId = ++replayImportGen.current;
    setReplayImporting(true);
    void file
      .text()
      .then(async (raw) => {
        if (requestId !== replayImportGen.current) return;
        const result = await onImportReplay(raw);
        if (requestId !== replayImportGen.current) return;
        if (result.ok) setEditorGeneration((generation) => generation + 1);
        setShareStatus({
          kind: result.ok ? 'ok' : 'error',
          message: result.ok
            ? result.restored === 'both'
              ? PERSISTENCE_BACKUP_RESTORED_MESSAGE
              : 'リプレイを読み込みました。'
            : result.message,
        });
      })
      .catch(() => {
        if (requestId !== replayImportGen.current) return;
        setShareStatus({
          kind: 'error',
          message: 'リプレイが壊れているか、読み取れません。',
        });
      })
      .finally(() => {
        if (requestId !== replayImportGen.current) return;
        setReplayImporting(false);
      });
  };

  return (
    <ResultOverlay
      ref={overlayRef}
      data-testid="replay-list"
      role="dialog"
      aria-modal="true"
      aria-label="リプレイ"
      tabIndex={-1}
    >
      <div className="meta-shop-panel replay-list-panel">
        <div className="result-overlay-body" tabIndex={0}>
          <p className="result-eyebrow">リプレイ</p>
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
                        className={`${replay.id === resolvedSelectedId ? 'selected' : ''}${isHell ? ' replay-item-review-hell' : ''}`}
                        data-testid={`replay-item-${replay.id}`}
                        data-diagnosis={replay.outcome.diagnosis}
                        disabled={busy}
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
                        <span
                          className="replay-item-ruleset"
                          data-testid="replay-ruleset"
                          data-ruleset-known={replay.ruleset ? 'true' : 'false'}
                        >
                          記録時ルールセット: {formatReplayRuleset(replay.ruleset)}
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
                        <p
                          className="replay-review-hell-peak"
                          data-testid="replay-review-hell-peak"
                        >
                          {reviewQueuePeakCountLabel(hellView.reviewQueuePeak)}
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
                          disabled={busy}
                          onClick={() => onOpen(selected.id, hellView.preferredKeyframeIndex)}
                        >
                          レビュー地獄を開く →
                        </button>
                      </div>
                    ) : null}
                    <ul>
                      {selected.keyframes.map((frame, index) => (
                        <li key={`${selected.id}-${frame.id ?? index}`}>
                          <button
                            type="button"
                            data-testid={`replay-keyframe-${index}`}
                            disabled={busy}
                            onClick={() => onOpen(selected.id, index)}
                          >
                            <b>{frame.phase}</b>
                            {frame.label ? (
                              <span>{formatReplayKeyframeLabel(frame.label)}</span>
                            ) : null}
                            <i>開く →</i>
                            {selected.annotation?.keyframeId === frame.id && selected.annotation ? (
                              <span className="pill">作者の理由あり</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                    {onSaveAnnotation ? (
                      <ReplayAnnotationEditor
                        key={`${selected.id}-${editorGeneration}`}
                        replay={selected}
                        onSave={onSaveAnnotation}
                        disabled={busy}
                        onBusy={setAnnotationSaving}
                        recovery={onGetAnnotationRecovery?.(selected.id) ?? null}
                      />
                    ) : null}
                  </>
                ) : (
                  <p>リプレイを選択してください。</p>
                )}
              </div>
            </div>
          )}

          {onExportReplay || onImportReplay ? (
            <div className="replay-share" data-testid="replay-share">
              <div className="replay-share-actions">
                {onExportReplay ? (
                  <button
                    type="button"
                    className="btn"
                    data-testid="replay-download"
                    disabled={!selected || busy}
                    onClick={downloadSelected}
                  >
                    ファイルで保存
                  </button>
                ) : null}
                {onImportReplay ? (
                  <>
                    <button
                      type="button"
                      className="btn"
                      data-testid="replay-file-button"
                      disabled={busy}
                      onClick={() => replayFileRef.current?.click()}
                    >
                      ファイルを開く
                    </button>
                    <input
                      ref={replayFileRef}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      data-testid="replay-file"
                      disabled={busy}
                      onChange={onReplayFile}
                    />
                  </>
                ) : null}
              </div>
              {replayImporting || shareStatus.message ? (
                <p
                  className={`replay-share-status${
                    !replayImporting && shareStatus.kind === 'error' ? ' error' : ''
                  }`}
                  data-testid="replay-share-status"
                  role="status"
                  aria-live="polite"
                >
                  {replayImporting ? '読み込み中…' : shareStatus.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="btn result-overlay-close"
          data-testid="replay-list-close"
          disabled={busy}
          title={busy ? '保存・読み込み中は閉じられません' : undefined}
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
