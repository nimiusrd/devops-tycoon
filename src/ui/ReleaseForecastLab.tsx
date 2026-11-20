import { useEffect, useState } from 'react';
import {
  createReleasePrototype,
  tickReleasePrototype,
  type ReleaseState,
} from '../prototypes/release';
import { releaseForecastView } from '../render/releaseForecastView';
import styles from './ReleaseForecastLab.module.css';

const TICK_MS = 2000;
const SPEED_OPTIONS = [
  { value: 0, label: '一時停止' },
  { value: 1, label: '1倍速' },
  { value: 2, label: '2倍速' },
] as const;
const PHASE_LABEL = {
  add: '機能追加',
  verify: '変更凍結・検証',
  release: '公開判定',
};

interface Playback {
  state: ReleaseState;
  speed: (typeof SPEED_OPTIONS)[number]['value'];
  freezeRequested: boolean;
}

function newTrial(): Playback {
  return {
    state: createReleasePrototype('RI-252', {
      deadline: 12,
      implementation: 3,
      review: 3,
      verification: 1,
    }),
    speed: 0,
    freezeRequested: false,
  };
}

function advance(playback: Playback): Playback {
  const state = tickReleasePrototype(playback.state, playback.freezeRequested);
  return {
    state,
    speed: state.tick === state.config.deadline ? 0 : playback.speed,
    freezeRequested: false,
  };
}

function freezeTiming(view: ReturnType<typeof releaseForecastView>, freezeRequested: boolean) {
  if (view.frozenAt !== null) {
    return `tick ${view.frozenAt} に${view.automaticFreeze ? '自動' : '手動'}凍結`;
  }
  if (freezeRequested) return '手動凍結を予約済み。次のtick処理で凍結';
  if (view.ticksUntilFreeze === 0) return '手動で凍結しなければ次のtick処理で自動凍結';
  return `手動で凍結しなければ tick ${view.freezeTick} の開始時に自動凍結（残り ${view.ticksUntilFreeze} tick）`;
}

export function ReleaseForecastLab() {
  const [playback, setPlayback] = useState(newTrial);
  const { state, speed, freezeRequested } = playback;
  const view = releaseForecastView(state);
  const finished = view.phase === 'release';
  const canFreeze = view.phase === 'add' && !freezeRequested;
  const next = view.phase === 'add' ? '変更凍結' : '公開判定';

  useEffect(() => {
    if (speed === 0) return;
    const interval = window.setInterval(() => {
      setPlayback((previous) => (previous.speed === speed ? advance(previous) : previous));
    }, TICK_MS / speed);
    return () => window.clearInterval(interval);
  }, [speed]);

  return (
    <main className={`app ${styles.lab}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.context}>四半期末ボスの固定シナリオ</p>
          <h1>大型リリースの危機予告</h1>
        </div>
        <a className="btn" href="?">
          通常ゲームへ戻る
        </a>
      </header>

      <section className={styles.panel} aria-labelledby="release-timeline-title">
        <h2 id="release-timeline-title">リリース予定</h2>
        <p>公開期限までに、レビューと最終検証を通した機能を出荷する。</p>
        <div className={styles.bands}>
          <span className="pill" role="status">
            現在 <b>{PHASE_LABEL[view.phase]}</b>
          </span>
          {!finished && (
            <span className="pill">
              次の予定 <b>{next}</b>
            </span>
          )}
          <span className="pill">
            公開まで <b>残り {view.remaining} tick</b>
          </span>
          <span className="pill">
            経過 <b>{state.tick} tick</b>
          </span>
        </div>
        <ol className={styles.timeline} role="list" aria-label="リリースの段階">
          <li aria-current={view.phase === 'add' ? 'step' : undefined}>
            <strong>機能追加</strong>
            <span>新しい機能に着手</span>
          </li>
          <li
            aria-current={view.phase === 'verify' ? 'step' : undefined}
            data-conditional={canFreeze}
          >
            <strong aria-live="polite">
              {canFreeze ? '条件付き予定' : freezeRequested ? '手動凍結の予約' : '変更凍結'}
            </strong>
            <span>{freezeTiming(view, freezeRequested)}</span>
          </li>
          <li aria-current={finished ? 'step' : undefined}>
            <strong>{finished ? '公開判定済み' : '確定予定'}</strong>
            <span>tick {state.config.deadline} 到達時に公開判定</span>
          </li>
        </ol>
      </section>

      <section className={styles.panel} aria-labelledby="release-gate-title">
        <h2 id="release-gate-title">出荷ゲート</h2>
        {!finished && (
          <p className={styles.risk}>
            <span className="pill">
              <b>リスク不明</b>
            </span>
            手戻りや公開時に残る未検証件数は未推定です。下の件数は進行に応じて更新します。
          </p>
        )}
        <dl className={styles.gates}>
          <div>
            <dt>未検証（実装済み）</dt>
            <dd>{view.unverified} 件</dd>
          </div>
          <div>
            <dt>レビュー未通過</dt>
            <dd>{view.awaitingReview} 件</dd>
          </div>
          <div>
            <dt>最終検証未通過</dt>
            <dd>{view.awaitingVerification} 件</dd>
          </div>
          <div>
            <dt>{finished ? '出荷価値' : '出荷可能な価値'}</dt>
            <dd>{view.delivered} pt</dd>
          </div>
        </dl>
        <p>
          実装中 {view.unfinished} 件・{view.frozenAt === null ? '未着手' : '延期'} {view.deferred}{' '}
          件。
          {finished && '未検証の機能は出荷対象外です。'}
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="release-controls-title">
        <h2 id="release-controls-title">介入と進行</h2>
        <p id="release-freeze-detail">
          変更凍結で新規着手を止め、実装能力1枠を最終検証に回します。着手済みの機能は続行します。
        </p>
        <div className={styles.controls}>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!canFreeze}
            aria-describedby="release-freeze-detail"
            onClick={() =>
              setPlayback((previous) =>
                previous.state.frozenAt === null
                  ? { ...previous, freezeRequested: true }
                  : previous,
              )
            }
          >
            {freezeRequested ? '凍結を予約済み' : '次のtickで変更凍結'}
          </button>
          <div className={styles.speed} role="group" aria-label="進行速度">
            {SPEED_OPTIONS.map(({ value, label }) => (
              <button
                className="btn"
                type="button"
                key={value}
                disabled={finished}
                aria-pressed={speed === value}
                onClick={() => setPlayback((previous) => ({ ...previous, speed: value }))}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn"
            type="button"
            disabled={speed !== 0 || finished}
            onClick={() =>
              setPlayback((previous) => (previous.speed === 0 ? advance(previous) : previous))
            }
          >
            1 tick 進める
          </button>
          <button className="btn" type="button" onClick={() => setPlayback(newTrial())}>
            最初から
          </button>
        </div>
      </section>
    </main>
  );
}
