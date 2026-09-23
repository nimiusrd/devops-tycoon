import { useMemo, useState } from 'react';
import { copyToClipboard } from '../../ui/copyToClipboard';
import { downloadTextFile } from '../../ui/downloadTextFile';
import { Stat } from '../../ui/Stat';
import { exportJson, exportTsv } from './exportLog';
import { ACTION_LABELS, ARM_LABELS, KNOBS, SEED_DEFS } from './knobs';
import { resolveRdScenario } from './query';
import styles from './RdInterveneApp.module.css';
import {
  advancePeriod,
  applyArm,
  countSupport,
  createInitialState,
  peekTeam,
  resetExperiment,
  runRemaining,
  setTeamAction,
  totalsFromState,
} from './sim';
import type { ExperimentState, SeedId, TeamId } from './types';
import { ACTION_IDS, ARM_IDS, PERIODS, TEAM_IDS } from './types';

function crisisTone(crisis: number): 'good' | 'warn' | 'bad' {
  if (crisis >= KNOBS.situation.crisisSupportThreshold) return 'bad';
  if (crisis >= 20) return 'warn';
  return 'good';
}

function replaceScenarioParam(seedId: SeedId): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.set('rd', 'intervene');
  url.searchParams.set('scenario', seedId);
  window.history.replaceState(null, '', url);
}

function initialSeed(): SeedId {
  return typeof window === 'undefined' ? 'crisis' : resolveRdScenario(window.location.search);
}

export function RdInterveneApp() {
  const [state, setState] = useState<ExperimentState>(() => createInitialState(initialSeed()));
  const [viewedTeamId, setViewedTeamId] = useState<TeamId>('alpha');
  const [copyStatus, setCopyStatus] = useState('');
  const viewed = peekTeam(state, viewedTeamId);
  const totals = useMemo(() => totalsFromState(state), [state]);
  const supportUsed = countSupport(state.plannedActions) === 1;
  const seed = SEED_DEFS[state.seedId];

  const switchSeed = (seedId: SeedId) => {
    replaceScenarioParam(seedId);
    setState(resetExperiment(seedId));
    setViewedTeamId('alpha');
    setCopyStatus('');
  };

  const handleCopyJson = async () => {
    const ok = await copyToClipboard(exportJson(state));
    setCopyStatus(
      ok ? 'JSON をコピーしました。' : 'コピーできませんでした。TSV ダウンロードを使ってください。',
    );
  };

  return (
    <div className={`${styles.root} app`} data-testid="rd-intervene-app">
      <header className={styles.banner}>
        <p className="pill">R&D / 本番マージ禁止</p>
        <h1 className={styles.bannerTitle}>介入・育成・委任プロトタイプ</h1>
        <p className={styles.bannerNote}>
          Issue #538 の捨て実験。本番の進行・勝敗・保存・#537 成長 UI
          には接続していません。閲覧は消費しません。
        </p>
      </header>

      <div className={styles.toolbar}>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>シード</legend>
          <p className={styles.hint}>{seed.summary}</p>
          {(Object.keys(SEED_DEFS) as SeedId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={state.seedId === id ? 'btn btn-primary' : 'btn'}
              data-testid={`rd-seed-${id}`}
              aria-pressed={state.seedId === id}
              onClick={() => switchSeed(id)}
            >
              {SEED_DEFS[id].label}
            </button>
          ))}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>方針アーム</legend>
          <p className={styles.hint}>同じシードで比較する。適用するだけで期間は進まない。</p>
          {ARM_IDS.map((arm) => (
            <button
              key={arm}
              type="button"
              className={state.arm === arm ? 'btn btn-primary' : 'btn'}
              data-testid={`rd-arm-${arm}`}
              aria-pressed={state.arm === arm}
              disabled={state.finished}
              onClick={() => setState(applyArm(state, arm))}
            >
              {ARM_LABELS[arm]}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-primary"
            data-testid="rd-run-remaining"
            disabled={state.finished || state.arm === 'manual'}
            onClick={() => setState(runRemaining(state))}
          >
            この方針で残り期間を一括実行
          </button>
        </fieldset>
      </div>

      <p className={styles.live} aria-live="polite">
        {state.finished
          ? `4期間終了。会社成果合計 ${totals.companyScoreSum} / 判断 ${totals.judgmentCount} 回`
          : `期間 ${state.period} / ${PERIODS} ・直接支援枠は ${supportUsed ? '使用中（最大1）' : '空き'} ・方針は維持できます`}
      </p>

      <dl className={styles.metrics}>
        <Stat label="会社成果 累計" value={totals.companyScoreSum} testid="rd-company-score" />
        <Stat label="短期出荷 累計" value={totals.outputSum} testid="rd-output-sum" />
        <Stat
          label="今期の未解決危機"
          value={totals.lastCrisisSum}
          tone={crisisTone(totals.lastCrisisSum / TEAM_IDS.length)}
          testid="rd-crisis-sum"
        />
        <Stat label="今期の消耗" value={totals.lastFatigueSum} testid="rd-fatigue-sum" />
        <Stat label="次期能力 合計" value={totals.lastCapabilitySum} testid="rd-capability-sum" />
        <Stat label="判断回数" value={totals.judgmentCount} testid="rd-judgment-count" />
      </dl>

      <section
        className={styles.teamGrid}
        aria-label="チーム状態。閲覧しても資源も乱数も動きません"
      >
        {TEAM_IDS.map((id) => {
          const team = peekTeam(state, id);
          const action = state.plannedActions[id];
          return (
            <article
              key={id}
              className={styles.teamCard}
              data-testid={`rd-team-${id}`}
              data-viewed={viewedTeamId === id}
              data-crisis={crisisTone(team.crisis)}
            >
              <button
                type="button"
                className={styles.teamHeader}
                onClick={() => setViewedTeamId(id)}
                aria-pressed={viewedTeamId === id}
              >
                <h2 className={styles.teamName}>{team.name}</h2>
                <p className={styles.teamMeta}>
                  負荷 {team.pressure} / {KNOBS.skillLabel} {team.capability} / 危機 {team.crisis} /
                  出荷 {team.output} / 消耗 {team.fatigue}
                </p>
              </button>
              <div className={styles.actions} role="group" aria-label={`${team.name} の今期方針`}>
                {ACTION_IDS.map((actionId) => (
                  <button
                    key={actionId}
                    type="button"
                    className={styles.actionBtn}
                    data-kind={actionId}
                    data-selected={action === actionId}
                    data-testid={`rd-action-${id}-${actionId}`}
                    disabled={state.finished}
                    onClick={() => setState(setTeamAction(state, id, actionId))}
                  >
                    {ACTION_LABELS[actionId]}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <p className={styles.hint}>
        閲覧中: {viewed.name}（状態の確認だけで、集中力・予算・乱数は消費しません）
      </p>

      <div className={styles.advanceRow}>
        <button
          type="button"
          className="btn btn-primary"
          data-testid="rd-advance-period"
          disabled={state.finished}
          onClick={() => setState(advancePeriod(state))}
        >
          この期間を進める
        </button>
        <button
          type="button"
          className="btn"
          data-testid="rd-reset"
          onClick={() => switchSeed(state.seedId)}
        >
          同じシードでやり直す
        </button>
      </div>

      <section className={styles.logWrap} aria-label="期間ログ">
        <h2 className={styles.teamName}>期間ログ</h2>
        <table className={styles.logTable} data-testid="rd-log">
          <thead>
            <tr>
              <th>期</th>
              <th>チーム</th>
              <th>判断</th>
              <th>短期出荷</th>
              <th>消耗</th>
              <th>未解決危機</th>
              <th>次期能力</th>
              <th>会社成果</th>
              <th>判断回数</th>
            </tr>
          </thead>
          <tbody>
            {state.logs.flatMap((log) =>
              log.teams.map((team) => (
                <tr key={`${log.period}-${team.id}`}>
                  <td>{log.period}</td>
                  <td>{SEED_DEFS[state.seedId].teams.find((item) => item.id === team.id)?.name}</td>
                  <td>{ACTION_LABELS[team.action]}</td>
                  <td>{team.output}</td>
                  <td>{team.fatigue}</td>
                  <td>{team.crisis}</td>
                  <td>{team.nextCapability}</td>
                  <td>{log.companyScore}</td>
                  <td>{log.judgmentCount}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <div className={styles.exportRow}>
          <button
            type="button"
            className="btn"
            data-testid="rd-export-json"
            onClick={() => void handleCopyJson()}
          >
            JSON をコピー
          </button>
          <button
            type="button"
            className="btn"
            data-testid="rd-export-tsv"
            onClick={() =>
              downloadTextFile(
                `rd-intervene-${state.seedId}-${state.arm}.tsv`,
                exportTsv(state),
                'text/tab-separated-values',
              )
            }
          >
            TSV を保存
          </button>
          <span className={styles.live} aria-live="polite">
            {copyStatus}
          </span>
        </div>
      </section>
    </div>
  );
}
