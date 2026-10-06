import { useEffect, useMemo, useState } from 'react';
import { getAction } from '../../data/actions';
import { splitPrCandidates } from '../../sim/assignTask';
import { rdExperimentPath, type RdExperimentRef } from '../resolveRdExperiment';
import {
  cancelReservedMove,
  createIssue735Experiment,
  enqueueReservedMove,
  INTENDED_STRATEGY,
  ISSUE_735_ACTIONS,
  moveReserved,
  pauseIssue735,
  previewReservedQueue,
  recordIssue735Plan,
  requestIssue735Action,
  resumeIssue735,
  setIssue735Feel,
  startIssue735,
  summarizeIssue735,
  tickIssue735,
  type ExperimentState,
  type Issue735ActionId,
} from './experiment';
import { actionLabel } from './scripted';
import styles from './ExperimentApp.module.css';

const TICK_MS = 400;

function statusClass(status: string): string {
  if (status === 'success' || status === 'queued') return styles.statusOk;
  if (status === 'fail' || status === 'paused') return styles.statusWarn;
  return styles.statusBad;
}

function laneLabel(lane: string): string {
  if (lane === 'backlog') return 'Backlog';
  if (lane === 'coding') return 'Coding';
  if (lane === 'review') return 'Review';
  if (lane === 'rework') return 'Rework';
  return 'Done';
}

export function Issue735ExperimentApp({ rd }: { rd: RdExperimentRef }) {
  const [state, setState] = useState<ExperimentState>(() =>
    createIssue735Experiment(rd.arm, rd.seed),
  );
  const [planMoves, setPlanMoves] = useState(
    INTENDED_STRATEGY.map((move) => actionLabel(move.actionId)).join(' → '),
  );
  const [planPredicted, setPlanPredicted] = useState(
    '分割した巨大PRがレビューに通り、完了と出荷が増える',
  );
  const [splitTarget, setSplitTarget] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const summary = summarizeIssue735(state);
  const ended = summary.ended && state.started;
  const preview = useMemo(() => previewReservedQueue(state), [state]);
  const splitTargets = splitPrCandidates(state.sprint);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state.started || state.paused || ended) return;
    const id = window.setInterval(() => {
      setState((current) => tickIssue735(current, Date.now()));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [state.started, state.paused, ended]);

  const wallClockMs =
    state.wallClockStartedAtMs == null
      ? null
      : (state.wallClockEndedAtMs ?? nowMs) - state.wallClockStartedAtMs;

  const startRun = () => {
    let next = recordIssue735Plan(state, { moves: planMoves, predicted: planPredicted });
    if (!next.plan?.moves || !next.plan.predicted) return;
    next = startIssue735(next, Date.now());
    setState(next);
  };

  const requestAction = (actionId: Issue735ActionId) => {
    const target = actionId === 'splitPr' ? splitTarget : undefined;
    setState((current) =>
      current.paused && current.arm === 'reserve'
        ? enqueueReservedMove(current, actionId, target)
        : requestIssue735Action(current, actionId, target),
    );
  };

  return (
    <main className={styles.page} data-testid="rd-735" data-arm={rd.arm} data-seed={rd.seed}>
      <header className={styles.banner}>
        <div>
          <p className={styles.hint}>R&amp;D throwaway / issue #735 / 本番ではない</p>
          <h1>停止中の最大2手予約</h1>
          <p>
            腕: <strong>{rd.arm === 'reserve' ? '予約あり' : '予約なし'}</strong> / seed{' '}
            <code>{rd.seed}</code>
          </p>
          <p className={styles.hint}>
            意図方針は両腕とも「PR分割(タスク0) → ペアレビュー」。入力の出し方だけが違う。
          </p>
        </div>
        <nav className={styles.actions} aria-label="実験の腕">
          <a className="btn btn-secondary" href={rdExperimentPath('none', rd.seed)}>
            予約なし
          </a>
          <a className="btn btn-secondary" href={rdExperimentPath('reserve', rd.seed)}>
            予約あり
          </a>
          <a className="btn" href="/">
            通常プレイへ戻る
          </a>
        </nav>
      </header>

      {!state.started ? (
        <section className={styles.panel} aria-labelledby="rd-735-plan">
          <h2 id="rd-735-plan">開始前の計画と予測（H1）</h2>
          <p className={styles.hint}>
            打ちたい手と、スプリント後に起きると予測する結果を書いてから開始する。
          </p>
          <label className={styles.field}>
            予定した手
            <textarea
              data-testid="rd-735-plan-moves"
              value={planMoves}
              onChange={(event) => setPlanMoves(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            予測した成果
            <textarea
              data-testid="rd-735-plan-predicted"
              value={planPredicted}
              onChange={(event) => setPlanPredicted(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="rd-735-start"
            onClick={startRun}
          >
            この腕を開始（停止した状態）
          </button>
        </section>
      ) : null}

      {state.started ? (
        <div className={styles.grid}>
          <section className={styles.panel} aria-labelledby="rd-735-board">
            <div className={styles.inline}>
              <h2 id="rd-735-board">1スプリント</h2>
              <span className="pill">{state.paused ? '停止中' : ended ? '終了' : '再生中'}</span>
              <span className="pill">tick {state.tick}</span>
              <span className="pill">
                待ち時間 {wallClockMs == null ? '—' : `${(wallClockMs / 1000).toFixed(1)}s`}
                （停止含む）
              </span>
            </div>
            <dl className={styles.metrics}>
              <div>
                <dt>集中力</dt>
                <dd>
                  {state.sprint.focus}/{state.sprint.config.focusMax}
                </dd>
              </div>
              <div>
                <dt>出荷</dt>
                <dd>{summary.delivered}</dd>
              </div>
              <div>
                <dt>完了</dt>
                <dd>{summary.doneCount}</dd>
              </div>
              <div>
                <dt>士気 / HP</dt>
                <dd>
                  {summary.morale} / {summary.seniorHp}
                </dd>
              </div>
            </dl>
            <table className={styles.board}>
              <caption className={styles.hint}>
                レーンは状態の要約。操作は下の介入ボタンから行う。
              </caption>
              <tbody>
                {(['backlog', 'coding', 'review', 'rework', 'done'] as const).map((lane) => (
                  <tr key={lane}>
                    <th scope="row">{laneLabel(lane)}</th>
                    <td>
                      {state.sprint.tasks
                        .filter((task) => task.lane === lane)
                        .map((task) => (
                          <span key={task.id} className={`${styles.task} pill`}>
                            T{task.id} {task.kind}
                            {task.split ? ' 分割済' : ''}
                          </span>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.actions}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={ended}
                aria-pressed={!state.paused}
                data-testid="rd-735-toggle"
                onClick={() =>
                  setState((current) =>
                    current.paused ? resumeIssue735(current) : pauseIssue735(current),
                  )
                }
              >
                {state.paused ? '再生' : '停止'}
              </button>
              {ISSUE_735_ACTIONS.map((actionId) => {
                const def = getAction(actionId);
                const pausedBlock = state.paused && state.arm === 'none';
                return (
                  <button
                    key={actionId}
                    type="button"
                    className="btn"
                    disabled={ended || pausedBlock}
                    data-testid={`rd-735-action-${actionId}`}
                    onClick={() => requestAction(actionId)}
                  >
                    {actionLabel(actionId)}
                    {def ? ` / ⚡${def.cost} CD${def.cooldownTicks}` : ''}
                    {state.paused && state.arm === 'reserve' ? '（予約）' : ''}
                  </button>
                );
              })}
              <label className={styles.field}>
                PR分割の対象
                <select
                  data-testid="rd-735-split-target"
                  value={splitTarget}
                  onChange={(event) => setSplitTarget(Number(event.target.value))}
                >
                  {splitTargets.length === 0 ? <option value={splitTarget}>対象なし</option> : null}
                  {splitTargets.map((task) => (
                    <option key={task.id} value={task.id}>
                      T{task.id} {laneLabel(task.lane)} {task.kind}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {state.arm === 'none' && state.paused ? (
              <p className={styles.hint}>
                予約なし腕では停止中に介入できない。再生してから手を打つ。
              </p>
            ) : null}
          </section>

          <aside className={styles.panel}>
            {state.arm === 'reserve' ? (
              <>
                <h2>予約キュー（最大2）</h2>
                {preview.length === 0 ? (
                  <p className={styles.hint}>停止中に介入を押すと予約される。</p>
                ) : null}
                <ol className={styles.queue}>
                  {preview.map((item, index) => (
                    <li key={item.id}>
                      <div>
                        {index + 1}. {actionLabel(item.actionId)}
                        {item.targetTaskId != null ? ` T${item.targetTaskId}` : ''}
                        <div className={styles.hint}>
                          ⚡{item.focusCost} / 対象{item.targetOk ? 'あり' : 'なし'} / 見込み{' '}
                          <span className={statusClass(item.predicted)}>{item.predicted}</span>
                          {item.reason ? ` (${item.reason})` : ''}
                        </div>
                      </div>
                      <div className={styles.inline}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-label="上へ"
                          disabled={index === 0}
                          onClick={() => setState((current) => moveReserved(current, item.id, -1))}
                        >
                          上へ
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-label="下へ"
                          disabled={index === preview.length - 1}
                          onClick={() => setState((current) => moveReserved(current, item.id, 1))}
                        >
                          下へ
                        </button>
                        <button
                          type="button"
                          className="btn"
                          onClick={() =>
                            setState((current) => cancelReservedMove(current, item.id))
                          }
                        >
                          取消
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <h2>予約なし</h2>
            )}
            <h2>実行ログ</h2>
            <ol className={styles.log} data-testid="rd-735-log">
              {state.logs.map((entry, index) => (
                <li key={`${entry.tick}-${index}`} className={statusClass(entry.result)}>
                  t{entry.tick} {entry.source}
                  {entry.actionId ? ` ${actionLabel(entry.actionId)}` : ''}
                  {entry.targetTaskId != null ? ` T${entry.targetTaskId}` : ''} {entry.result}
                  {entry.reason ? ` (${entry.reason})` : ''}
                </li>
              ))}
            </ol>
          </aside>
        </div>
      ) : null}

      {ended ? (
        <section
          className={styles.panel}
          aria-labelledby="rd-735-result"
          data-testid="rd-735-result"
        >
          <h2 id="rd-735-result">実績と手応え</h2>
          <p>
            計画: {state.plan?.moves || '（未記入）'} / 予測:{' '}
            {state.plan?.predicted || '（未記入）'}
          </p>
          <p>
            実績: 出荷 {summary.delivered} / 完了 {summary.doneCount} / 介入{' '}
            {summary.interventionsUsed} / 集中力消費 {summary.focusSpent} / 士気 {summary.morale} /
            待ち時間{' '}
            {summary.wallClockMs == null ? '—' : `${(summary.wallClockMs / 1000).toFixed(1)}s`}
          </p>
          <ul>
            {summary.reserved.map((move) => (
              <li key={move.id} className={statusClass(move.status)}>
                {actionLabel(move.actionId)}
                {move.targetTaskId != null ? ` T${move.targetTaskId}` : ''}: {move.status}
                {move.failReason ? ` (${move.failReason})` : ''}
                {move.cancelReason ? ` (${move.cancelReason})` : ''}
              </li>
            ))}
          </ul>
          <fieldset className={styles.feel}>
            <legend>手応え（H2, 1=弱い 5=強い）</legend>
            {([1, 2, 3, 4, 5] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={state.feel === value ? 'btn btn-primary' : 'btn'}
                aria-pressed={state.feel === value}
                data-testid={`rd-735-feel-${value}`}
                onClick={() => setState((current) => setIssue735Feel(current, value))}
              >
                {value}
              </button>
            ))}
          </fieldset>
          {state.feel != null ? (
            <p data-testid="rd-735-feel-value">記録した手応え: {state.feel}</p>
          ) : (
            <p className={styles.hint}>
              数字は研究者が控える。この試作は Adopt/Iterate/Kill を決めない。
            </p>
          )}
        </section>
      ) : null}
    </main>
  );
}
