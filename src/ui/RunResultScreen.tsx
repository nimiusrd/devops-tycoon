/**
 * ラン決着画面（勝利 / 敗北 / SPEC 第14章 / 第15章 / 第13章診断）。
 *
 * 勝利種別または敗北理由、組織タイプ診断、ランの累計成果、メタ進行を表示する。
 */
import { useState } from 'react';
import { getBoss } from '../data/bosses';
import { diagnosisTheme } from '../render/diagnosisTheme';
import { loseNextActionView } from '../render/loseNextActionView';
import { quarterFailureTheme } from '../render/quarterFailureTheme';
import { FAILURE_ENCYCLOPEDIA_DEFS, diagnosisView, isFailureDiagnosis } from '../sim/diagnosis';
import { winView } from '../sim/outcome';
import {
  formatRunRuleset,
  serializeRunDiagnosticInfo,
  type RunDiagnosticInfo,
} from '../state/diagnosticInfo';
import {
  getDailyRecord,
  WIN_TITLE_DEFS,
  type MetaState,
  type RunRewardBreakdown,
} from '../state/meta';
import {
  HYPOTHESIS_NOTE_MAX_LENGTH,
  hypothesisNoteForExport,
  hypothesisTextLength,
  type BoundHypothesisNote,
} from '../state/hypothesisNote';
import { formatPersistenceClock } from '../state/persistenceStatus';
import type { RunState } from '../sim/run/types';
import { FINISH_SAVE_BLOCKS_NEW_RUN } from './finishSaveBlock';
import { HYPOTHESIS_NOTE_SAVE_FAILED } from './useHypothesisNote';
import { RewardCeremony } from './JuicyEffects';
import { ReviewHistoryList } from './ReviewHistoryList';
import { copyToClipboard } from './copyToClipboard';
import { useReplayContent } from './replayContent';
import { LOSE_LABEL } from '../render/runOutcomeLabels';
import { buildCompanyResult, type CompanyResult } from '../render/companyResultView';
import { CompanyResultImage } from './CompanyResultImage';
import { VisualIcon } from './VisualIcon';

const REVIEW_BONUS_LABEL: Record<NonNullable<RunRewardBreakdown['reviewBonusKind']>, string> = {
  exceeded: '超過達成',
  met: '達成',
};

export interface RunResultScreenProps {
  state: RunState;
  recordedCompanyResult?: CompanyResult;
  isReplay?: boolean;
  meta: MetaState;
  diagnosticInfo: RunDiagnosticInfo;
  /** 今回ランで付与したメタ進行ポイント内訳。 */
  lastRunReward?: RunRewardBreakdown | null;
  /** 完了保存の失敗中。再試行まで次のランへ進ませない。 */
  newRunBlocked?: boolean;
  onNewRun: () => void;
  /** このランの開始前に書いた仮説（RI-295）。リプレイ閲覧では渡さない。 */
  hypothesisNote?: BoundHypothesisNote | null;
  onHypothesisReflectionChange?: (text: string) => void;
  hypothesisSaveFailed?: boolean;
}

export function RunResultScreen({
  state,
  recordedCompanyResult,
  isReplay = false,
  meta,
  diagnosticInfo,
  lastRunReward = null,
  newRunBlocked = false,
  onNewRun,
  hypothesisNote = null,
  onHypothesisReflectionChange,
  hypothesisSaveFailed = false,
}: RunResultScreenProps) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [includeNoteInDiagnostic, setIncludeNoteInDiagnostic] = useState(false);
  const { resolveRelic, resolveCard, isReplaySnapshot } = useReplayContent();
  const companyResult =
    recordedCompanyResult ??
    buildCompanyResult(
      state,
      (id) => (isReplay && !isReplaySnapshot ? `記録名なし（${id}）` : resolveCard(id).name),
      isReplay,
    );
  const won = state.status === 'won';
  const boss = getBoss(state.bossId);
  const diag = diagnosisView(state.diagnosis);
  const theme = diagnosisTheme(state.diagnosis);
  const win = won && state.winType ? winView(state.winType) : null;
  const failureTheme = !won ? quarterFailureTheme(state.quarterReview?.outcome) : null;
  const collectedTitle = state.winType
    ? WIN_TITLE_DEFS.find((title) => title.id === state.winType)
    : undefined;
  const titleInCollection = !!state.winType && meta.collectedWinTypes.includes(state.winType);
  const failureEntry = isFailureDiagnosis(state.diagnosis)
    ? FAILURE_ENCYCLOPEDIA_DEFS.find((entry) => entry.type === state.diagnosis)
    : undefined;
  const failureInCollection = !!failureEntry && meta.collectedDiagnoses.includes(failureEntry.type);
  const lose = !won && state.loseReason ? LOSE_LABEL[state.loseReason] : null;
  // RI-79: 原因別 loseReason ラベルを優先し、outcome 演出は tone/icon 用に残す。
  const loseLabel = lose?.label ?? failureTheme?.label ?? '敗北';
  const loseDescription = lose?.desc ?? failureTheme?.description;
  const nextAction =
    !won && state.loseReason
      ? loseNextActionView(state.loseReason, {
          quarterOutcome: state.quarterReview?.outcome,
          snapshot: {
            trust: state.quarterReview?.trust,
            budget: state.budget,
            morale: state.org.morale,
            seniorHp: state.org.seniorHp,
            missedKpiCount: state.quarterReview?.progress.filter((p) => p.status === 'missed')
              .length,
            missedKpiIds: state.quarterReview?.progress
              .filter((p) => p.status === 'missed')
              .map((p) => p.id),
            reviewQueuePeak: state.totals.reviewQueuePeak,
            quarterNumber: state.quarterNumber,
          },
        })
      : null;
  const bossRelic = state.bossRelicReward ? resolveRelic(state.bossRelicReward) : undefined;
  const t = state.totals;
  const isDaily = state.runKind === 'daily';
  const dailyRecord =
    isDaily && state.dailyDate && diagnosticInfo.ruleset
      ? getDailyRecord(meta, state.dailyDate, diagnosticInfo.ruleset)
      : undefined;
  const diagnosticJson = serializeRunDiagnosticInfo(
    diagnosticInfo,
    hypothesisNote && includeNoteInDiagnostic ? hypothesisNoteForExport(hypothesisNote) : undefined,
  );
  const reflectionText = hypothesisNote?.reflection?.text ?? '';

  const handleCopyDiagnostic = async () => {
    setCopyStatus((await copyToClipboard(diagnosticJson)) ? 'copied' : 'error');
  };

  return (
    <div
      className={`result-overlay run-end ${won ? 'win' : 'lose'} ${theme.toneClass} diag-${state.diagnosis} ${failureTheme?.toneClass ?? ''}`}
      data-testid="run-result"
      data-status={state.status}
      data-diagnosis={state.diagnosis}
      data-quarter-outcome={failureTheme ? state.quarterReview?.outcome : undefined}
      role="dialog"
      aria-label="Run Result"
    >
      <div className="result-card">
        <p className="result-eyebrow">
          {won ? 'QUARTER CLEARED' : (failureTheme?.eyebrow ?? 'GAME OVER')}
        </p>
        <div className={`run-end-badge ${won ? 'win' : 'lose'}`} data-testid="run-end-status">
          {won ? (
            <>
              <VisualIcon name="victory" size="header" />
              {win?.label ?? '勝利'}
            </>
          ) : (
            <>
              <VisualIcon name={failureTheme?.icon ?? 'defeat'} size="header" />
              {loseLabel}
            </>
          )}
        </div>
        <p className="run-end-desc">{won ? win?.description : loseDescription}</p>
        {nextAction && (
          <div className="result-lose-next-action" data-testid="lose-next-action-section">
            <p className="result-section-label">次の一手</p>
            <p className="result-analysis-tip" data-testid="lose-next-action">
              {nextAction.nextAction}
            </p>
            <p className="result-analysis-tip" data-testid="lose-insight">
              {nextAction.insight}
            </p>
          </div>
        )}
        {won && collectedTitle && (
          <div
            className="result-title result-win-title"
            data-testid="run-win-title"
            data-collected={titleInCollection ? 'true' : 'false'}
          >
            <p className="result-section-label">今回の勝利称号</p>
            <RewardCeremony
              kind="title"
              title={collectedTitle.label}
              detail="あなたの組織に刻まれた称号"
            />
            <p className="result-title-value">
              <VisualIcon name="victory" size="hud" /> {collectedTitle.label}
            </p>
            <p className="result-title-description">
              {titleInCollection
                ? `コレクションに登録済み — ${collectedTitle.description}`
                : collectedTitle.description}
            </p>
          </div>
        )}

        {hypothesisNote && (
          <section className="result-hypothesis" data-testid="hypothesis-review">
            <p className="result-section-label">開始前の仮説</p>
            <p className="result-hypothesis-text" data-testid="hypothesis-before-start">
              {hypothesisNote.beforeStart.text}
            </p>
            <p className="result-hypothesis-meta" data-testid="hypothesis-before-start-time">
              ラン開始前に記入（{formatPersistenceClock(hypothesisNote.beforeStart.writtenAt)}
              ）・開始後は変更できない
            </p>
            {onHypothesisReflectionChange && (
              <>
                <label className="result-hypothesis-label" htmlFor="hypothesis-reflection">
                  終了後の振り返り（任意）
                </label>
                <input
                  id="hypothesis-reflection"
                  type="text"
                  className="result-hypothesis-input"
                  data-testid="hypothesis-reflection-input"
                  aria-describedby="hypothesis-reflection-meta"
                  value={reflectionText}
                  placeholder="仮説を続ける・変えるなら、その理由"
                  onChange={(event) => onHypothesisReflectionChange(event.target.value)}
                />
                <p
                  id="hypothesis-reflection-meta"
                  className="result-hypothesis-meta"
                  data-testid="hypothesis-reflection-meta"
                >
                  {hypothesisTextLength(reflectionText)}/{HYPOTHESIS_NOTE_MAX_LENGTH}
                  文字・決着後の追記として開始前の仮説とは分けて残す
                  {hypothesisNote.reflection
                    ? `（${formatPersistenceClock(hypothesisNote.reflection.writtenAt)} 更新）`
                    : ''}
                </p>
              </>
            )}
            {hypothesisSaveFailed && (
              <p
                className="result-hypothesis-meta error"
                data-testid="hypothesis-note-save-failed"
                role="status"
                aria-live="polite"
              >
                {HYPOTHESIS_NOTE_SAVE_FAILED}
              </p>
            )}
          </section>
        )}

        <ReviewHistoryList
          reviewHistory={state.reviewHistory}
          quarterReview={state.quarterReview}
          showKpis
        />

        <dl className="result-rows">
          <div className="result-row">
            <dt>ボス</dt>
            <dd>★ {boss?.name}</dd>
          </div>
          <div className="result-row">
            <dt>累計出荷</dt>
            <dd data-testid="run-delivered">{t.delivered} pt</dd>
          </div>
          <div className="result-row">
            <dt>スプリント</dt>
            <dd>{state.sprintsPlayed} 回</dd>
          </div>
          <div className="result-row">
            <dt>最大コンボ</dt>
            <dd>x{t.maxCombo}</dd>
          </div>
          <div className="result-row">
            <dt>障害 / 延焼</dt>
            <dd>
              {t.incidents} / {t.spread}
            </dd>
          </div>
        </dl>

        <div className="result-diagnosis">
          <p className="result-section-label">組織タイプ診断</p>
          <p className="diagnosis-type" data-testid="diagnosis">
            <span aria-hidden="true">
              <VisualIcon name={theme.icon} size="hud" />
            </span>{' '}
            {diag.label}
          </p>
          <p>{diag.description}</p>
          {failureEntry && (
            <p
              className="result-title-description"
              data-testid="failure-encyclopedia-registered"
              data-collected={failureInCollection ? 'true' : 'false'}
            >
              {failureInCollection
                ? `AI導入失敗図鑑に登録済み — ${failureEntry.lesson}`
                : `AI導入失敗図鑑の候補: ${failureEntry.hint}`}
            </p>
          )}
        </div>

        <CompanyResultImage key={JSON.stringify(companyResult)} result={companyResult} />

        <section className="result-diagnostic" data-testid="run-diagnostic-info">
          <p className="result-section-label">不具合再現情報</p>
          <dl className="result-rows">
            <div className="result-row">
              <dt>seed</dt>
              <dd data-testid="diagnostic-seed">{diagnosticInfo.seed}</dd>
            </div>
            <div className="result-row">
              <dt>ルールセット</dt>
              <dd
                data-testid="diagnostic-ruleset"
                data-ruleset-known={diagnosticInfo.ruleset ? 'true' : 'false'}
              >
                {formatRunRuleset(diagnosticInfo.ruleset)}
              </dd>
            </div>
          </dl>
          {hypothesisNote && (
            <label className="result-hypothesis-include">
              <input
                type="checkbox"
                data-testid="diagnostic-include-note"
                checked={includeNoteInDiagnostic}
                onChange={(event) => setIncludeNoteInDiagnostic(event.target.checked)}
              />
              仮説メモと振り返りを含める
            </label>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            data-testid="copy-diagnostic-info"
            onClick={() => void handleCopyDiagnostic()}
          >
            再現情報をコピー
          </button>
          <p
            className="result-diagnostic-status"
            data-testid="diagnostic-copy-status"
            aria-live="polite"
          >
            {copyStatus === 'copied'
              ? '再現情報をコピーしました。'
              : copyStatus === 'error'
                ? '自動コピーできませんでした。下のJSONを選択してコピーしてください。'
                : null}
          </p>
          <details className="result-diagnostic-json" open={copyStatus === 'error'}>
            <summary>JSONを表示</summary>
            <textarea
              data-testid="diagnostic-json"
              value={diagnosticJson}
              readOnly
              rows={8}
              aria-label="不具合再現情報JSON"
            />
          </details>
        </section>

        {bossRelic && (
          <div className="result-diagnosis" data-testid="boss-relic-reward">
            <p className="result-section-label">ボス突破報酬</p>
            <RewardCeremony
              kind="relic"
              title={`${bossRelic.name} を獲得`}
              detail="組織に新しい文化が宿った"
            />
            <p className="diagnosis-type">◆ {bossRelic.name}</p>
            <p>{bossRelic.description}</p>
          </div>
        )}

        <div className="result-title">
          <p className="result-section-label">メタ進行</p>
          {lastRunReward && (
            <>
              <p className="result-title-value" data-testid="meta-reward-total">
                {lastRunReward.granted
                  ? `今回 +${lastRunReward.total} pt`
                  : '今回 +0 pt（本日の報酬は受領済み）'}
              </p>
              {lastRunReward.granted && (
                <dl className="result-rows" data-testid="meta-reward-breakdown">
                  <div className="result-row">
                    <dt>基本</dt>
                    <dd>+{lastRunReward.base}</dd>
                  </div>
                  {lastRunReward.learningBonus > 0 && (
                    <div className="result-row" data-testid="meta-reward-learning">
                      <dt>敗北学習</dt>
                      <dd>+{lastRunReward.learningBonus}</dd>
                    </div>
                  )}
                  {lastRunReward.reviewBonus > 0 && lastRunReward.reviewBonusKind && (
                    <div className="result-row" data-testid="meta-reward-review">
                      <dt>{REVIEW_BONUS_LABEL[lastRunReward.reviewBonusKind]}</dt>
                      <dd>+{lastRunReward.reviewBonus}</dd>
                    </div>
                  )}
                </dl>
              )}
            </>
          )}
          <p className="result-title-value">
            メタ進行ポイント {meta.points} pt / 自己ベスト {meta.bestScore} pt
          </p>
          {isDaily && state.dailyDate && (
            <p className="result-daily" data-testid="run-daily-summary">
              デイリー {state.dailyDate} — 今回 {t.delivered} pt
              {dailyRecord ? ` / 今日のベスト ${dailyRecord.bestScore} pt` : ''}
              {dailyRecord?.rewardClaimed ? '（本日の報酬は受領済み）' : ''}
            </p>
          )}
        </div>

        <div className="result-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="new-run"
            disabled={newRunBlocked}
            aria-describedby={newRunBlocked ? 'finish-save-block' : undefined}
            onClick={onNewRun}
          >
            新しいランへ →
          </button>
          {newRunBlocked ? (
            <p
              id="finish-save-block"
              className="title-resume-warning finish-save-block"
              data-testid="finish-save-block"
            >
              {FINISH_SAVE_BLOCKS_NEW_RUN}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
