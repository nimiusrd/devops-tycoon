/**
 * ラン決着画面（勝利 / 敗北 / SPEC 第14章 / 第15章 / 第13章診断）。
 *
 * 勝利種別または敗北理由、組織タイプ診断、ランの累計成果、メタ進行を表示する。
 */
import { getBoss } from '../data/bosses';
import { diagnosisView } from '../sim/diagnosis';
import { winView } from '../sim/outcome';
import { getDailyRecord, type MetaState } from '../state/meta';
import type { LoseReason, RunState } from '../sim/run/types';

const LOSE_LABEL: Record<LoseReason, { label: string; desc: string }> = {
  seniorBurnout: { label: 'シニア燃え尽き', desc: 'レビューがシニアに集中し、体力が尽きました。' },
  techDebt: { label: '技術的負債の崩壊', desc: '負債が上限を超え、開発が立ち行かなくなりました。' },
  moraleCollapse: { label: 'チーム崩壊', desc: '士気が尽き、チームが機能しなくなりました。' },
  reviewFreeze: { label: 'PR 凍結', desc: 'レビュー待ちが限界を超え、出荷が止まりました。' },
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
  onNewRun: () => void;
}

export function RunResultScreen({ state, meta, onNewRun }: RunResultScreenProps) {
  const won = state.status === 'won';
  const boss = getBoss(state.bossId);
  const diag = diagnosisView(state.diagnosis);
  const win = won && state.winType ? winView(state.winType) : null;
  const lose = !won && state.loseReason ? LOSE_LABEL[state.loseReason] : null;
  const t = state.totals;
  const isDaily = state.runKind === 'daily';
  const dailyRecord =
    isDaily && state.dailyDate ? getDailyRecord(meta, state.dailyDate) : undefined;

  return (
    <div
      className={`result-overlay run-end ${won ? 'win' : 'lose'}`}
      data-testid="run-result"
      data-status={state.status}
      role="dialog"
      aria-label="Run Result"
    >
      <div className="result-card">
        <p className="result-eyebrow">{won ? 'QUARTER CLEARED' : 'GAME OVER'}</p>
        <div className={`run-end-badge ${won ? 'win' : 'lose'}`} data-testid="run-end-status">
          {won ? '🏆 ' + (win?.label ?? '勝利') : '💥 ' + (lose?.label ?? '敗北')}
        </div>
        <p className="run-end-desc">{won ? win?.description : lose?.desc}</p>

        <dl className="result-rows">
          <div className="result-row">
            <dt>ボス</dt>
            <dd>★ {boss?.name}</dd>
          </div>
          <div className="result-row">
            <dt>累計出荷</dt>
            <dd data-testid="run-delivered">{state.org.deliveryScore} pt</dd>
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
            {diag.label}
          </p>
          <p>{diag.description}</p>
        </div>

        <div className="result-title">
          <p className="result-section-label">メタ進行</p>
          <p className="result-title-value">
            メタ進行ポイント {meta.points} pt / 自己ベスト {meta.bestScore} pt
          </p>
          {isDaily && state.dailyDate && (
            <p className="result-daily" data-testid="run-daily-summary">
              デイリー {state.dailyDate} — 今回 {state.org.deliveryScore} pt
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
