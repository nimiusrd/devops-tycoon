/**
 * ラン決着画面（勝利 / 敗北 / SPEC 第14章 / 第15章 / 第13章診断）。
 *
 * 勝利種別または敗北理由、組織タイプ診断、ランの累計成果、メタ進行を表示する。
 */
import { getBoss } from '../data/bosses';
import { getRelic } from '../data/relics';
import { diagnosisTheme } from '../render/diagnosisTheme';
import { quarterFailureTheme } from '../render/quarterFailureTheme';
import { FAILURE_ENCYCLOPEDIA_DEFS, diagnosisView, isFailureDiagnosis } from '../sim/diagnosis';
import { winView } from '../sim/outcome';
import {
  getDailyRecord,
  WIN_TITLE_DEFS,
  type MetaState,
  type RunRewardBreakdown,
} from '../state/meta';
import type { LoseReason, RunState } from '../sim/run/types';
import { RewardCeremony } from './JuicyEffects';

const REVIEW_BONUS_LABEL: Record<NonNullable<RunRewardBreakdown['reviewBonusKind']>, string> = {
  exceeded: '超過達成',
  met: '達成',
};

const LOSE_LABEL: Record<LoseReason, { label: string; desc: string }> = {
  seniorBurnout: { label: 'シニア燃え尽き', desc: 'レビューがシニアに集中し、体力が尽きました。' },
  techDebt: { label: '技術的負債の崩壊', desc: '負債が上限を超え、開発が立ち行かなくなりました。' },
  moraleCollapse: { label: 'チーム崩壊', desc: '士気が尽き、チームが機能しなくなりました。' },
  reviewFreeze: { label: 'PR 凍結', desc: 'レビュー待ちが限界を超え、出荷が止まりました。' },
  incidentCascade: {
    label: '障害連鎖によるリリース停止',
    desc: '障害が連続し、安定したリリースを継続できなくなりました。',
  },
  aiDependency: {
    label: 'AI 依存の限界',
    desc: 'AI 依存が高まりすぎて、チームが仕様を説明・検証できなくなりました。',
  },
  budgetExhausted: {
    label: '予算枯渇',
    desc: '予算が尽き、AI ツールを維持できなくなりました。',
  },
  bossFailed: { label: 'ボス突破失敗', desc: '四半期末の試練を突破できませんでした。' },
  trustExhausted: {
    label: '信頼枯渇',
    desc: 'ステークホルダーの信頼が尽き、プロジェクトを継続できませんでした。',
  },
  reorgRequired: {
    label: '組織再編',
    desc: '目標未達が重なり、大規模再編としてプロジェクトが終了しました。',
  },
};

export interface RunResultScreenProps {
  state: RunState;
  meta: MetaState;
  /** 今回ランで付与したメタ進行ポイント内訳。 */
  lastRunReward?: RunRewardBreakdown | null;
  onNewRun: () => void;
}

export function RunResultScreen({
  state,
  meta,
  lastRunReward = null,
  onNewRun,
}: RunResultScreenProps) {
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
  const loseLabel = failureTheme?.label ?? lose?.label ?? '敗北';
  const loseDescription = failureTheme?.description ?? lose?.desc;
  const bossRelic = state.bossRelicReward ? getRelic(state.bossRelicReward) : undefined;
  const t = state.totals;
  const isDaily = state.runKind === 'daily';
  const dailyRecord =
    isDaily && state.dailyDate ? getDailyRecord(meta, state.dailyDate) : undefined;

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
          {won ? '🏆 ' + (win?.label ?? '勝利') : `${failureTheme?.icon ?? '💥'} ${loseLabel}`}
        </div>
        <p className="run-end-desc">{won ? win?.description : loseDescription}</p>
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
            <p className="result-title-value">🏆 {collectedTitle.label}</p>
            <p className="result-title-description">
              {titleInCollection
                ? `コレクションに登録済み — ${collectedTitle.description}`
                : collectedTitle.description}
            </p>
          </div>
        )}

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
            <span aria-hidden="true">{theme.icon}</span> {diag.label}
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
            onClick={onNewRun}
          >
            新しいランへ →
          </button>
        </div>
      </div>
    </div>
  );
}
