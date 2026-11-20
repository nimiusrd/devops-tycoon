import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import {
  createOfficeBuildStart,
  officeReviewHelp,
  prepareOfficeBuild,
} from '../prototypes/officeBuild';
import { Board } from '../render/Board';
import { BOARD_VIEW } from '../render/boardScene';
import { getWebglStatus, subscribeWebglStatus } from '../render/webglStatus';
import { assignMember, rankLabel, setAiAssigned } from '../sim/member';
import type { RunState, WhatIfPreview as Preview } from '../sim/run/types';
import { requestWhatIfState } from '../sim/run/whatIfClient';
import type { WhatIfComputeInput } from '../sim/run/whatIfState';
import { AspectStage } from './AspectStage';
import styles from './OfficeBuildLab.module.css';
import { ResponsiveModeProvider } from './responsiveMode';
import { WebglStatusOverlay } from './WebglStatusOverlay';
import { WhatIfPreview } from './WhatIfPreview';

const STATIONS = [
  { lane: 'coding', title: 'Coding', description: '実装・AI配布' },
  { lane: 'review', title: 'Review', description: 'レビュー・応援' },
  { lane: 'bench', title: '控え', description: 'このスプリントは待機' },
] as const;
const BOARD_RATIO = BOARD_VIEW.w / BOARD_VIEW.h;
const reviewHelp = officeReviewHelp();
const REVIEW_EFFECT = {
  label: reviewHelp.name,
  targetLanes: ['review'] as const,
};

function focusSection(section: HTMLHeadingElement | null) {
  section?.focus();
}

function Forecast({ input, label }: { input: WhatIfComputeInput; label: string }) {
  const [result, setResult] = useState<{ input: WhatIfComputeInput; preview: Preview | null }>();
  useEffect(() => {
    let active = true;
    const settle = (preview: Preview | null) => {
      if (active) setResult({ input, preview });
    };
    void requestWhatIfState(input).then(
      (estimate) => settle(estimate?.current ?? null),
      () => settle(null),
    );
    return () => {
      active = false;
    };
  }, [input]);

  const computing = result?.input !== input;
  return (
    <div aria-live="polite" aria-busy={computing}>
      {computing || result.preview ? (
        <WhatIfPreview
          preview={computing ? null : result.preview}
          computing={computing}
          label={label}
          compact
        />
      ) : (
        <p>{label}を試算できませんでした。</p>
      )}
    </div>
  );
}

function OfficeBuildTrial() {
  const [start] = useState(createOfficeBuildStart);
  const [roster, setRoster] = useState(start.roster);
  const [requestHelp, setRequestHelp] = useState(false);
  const [selectedId, setSelectedId] = useState(start.roster.members[0]?.id);
  const [playback, setPlayback] = useState<{
    plan: ReturnType<typeof prepareOfficeBuild>;
    state: RunState;
  } | null>(null);

  const initial = useMemo(() => prepareOfficeBuild(start, start.roster, false), [start]);
  const changed =
    requestHelp ||
    roster.members.some((member, index) => {
      const original = start.roster.members[index];
      return member.assignment !== original.assignment || member.aiAssigned !== original.aiAssigned;
    });
  const candidate = useMemo(
    () => (changed ? prepareOfficeBuild(start, roster, requestHelp) : initial),
    [changed, initial, requestHelp, roster, start],
  );
  const plan = playback?.plan ?? candidate;
  const view = playback?.state ?? candidate.launch;
  const sprint = view.sprint;
  const result = playback?.state.lastResult;
  const editing = playback === null;
  const officeHeading = useRef<HTMLHeadingElement>(null);
  const assignmentHeading = useRef<HTMLHeadingElement>(null);
  const returnToOffice = useRef(false);
  useEffect(() => {
    if (editing && returnToOffice.current) {
      returnToOffice.current = false;
      officeHeading.current?.focus();
    }
  }, [editing]);
  const helpStatus = !requestHelp
    ? 'inactive'
    : !plan.reviewHelpApplied
      ? 'unavailable'
      : editing
        ? 'candidate'
        : 'applied';
  const selected = roster.members.find((member) => member.id === selectedId);
  const aiAllowed = selected?.assignment === 'coding' && !selected.onLeave;
  const canStart = !!sprint && (!requestHelp || candidate.reviewHelpApplied);
  const activeIncidents = sprint?.tasks.filter((task) => task.incident).length ?? 0;
  const canCode = roster.members.some(
    (member) => member.assignment === 'coding' && !member.onLeave,
  );
  const webglStatus = useSyncExternalStore(subscribeWebglStatus, getWebglStatus, () => 'loading');

  const resetDraft = () => {
    setRoster(start.roster);
    setRequestHelp(false);
  };
  const startSprint = () => {
    if (!canStart || getWebglStatus() !== 'ready') return;
    // 試算用の読み取り専用コピーと同じ入力から実測用のエンジンを起動する。
    const plan = prepareOfficeBuild(start, roster, requestHelp);
    setPlayback({ plan, state: plan.launch });
  };
  const step = (finish: boolean) => {
    if (!playback || !sprint || getWebglStatus() !== 'ready') return;
    const ticks = finish ? sprint.config.maxTicks + 1 - view.sprintTick : 1;
    playback.plan.engine.step(ticks * FIXED_STEP_MS);
    setPlayback({ ...playback, state: playback.plan.engine.snapshot() });
  };
  const resetTrial = () => {
    returnToOffice.current = true;
    resetDraft();
    setSelectedId(start.roster.members[0]?.id);
    setPlayback(null);
  };

  return (
    <main className={`app ${styles.lab}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.context}>編成UIの試作・1チーム</p>
          <h1>オフィスで編成を決める</h1>
        </div>
        <a className="btn" href="?">
          通常ゲームへ戻る
        </a>
      </header>

      <section aria-labelledby="office-build-office">
        <h2 id="office-build-office" ref={officeHeading} tabIndex={-1}>
          {editing ? '準備中のオフィス' : result ? '試走後のオフィス' : '試走中のオフィス'}
        </h2>
        <p className={styles.context}>
          {editing
            ? changed
              ? '変更案で始める場合の盤面です。'
              : '担当とレビュー応援を選んで開始時の盤面を確認できます。'
            : result
              ? 'このスプリントの終了時点です。'
              : '適用したプランでスプリントを進めます。'}
        </p>
        {sprint && (
          <div className={styles.boardFrame} style={{ aspectRatio: BOARD_RATIO }}>
            <AspectStage ratio={BOARD_RATIO} data-testid="office-build-stage">
              <Board
                tasks={sprint.tasks}
                roster={view.roster}
                sprintTick={view.sprintTick}
                actionInspection={requestHelp ? REVIEW_EFFECT : undefined}
                animationsPaused={editing || sprint.complete}
              />
            </AspectStage>
          </div>
        )}
        <p className={styles.context} data-testid="office-incidents">
          炎上中 {activeIncidents} 件
        </p>
        <div className={styles.stations}>
          {STATIONS.map(({ lane, title, description }) => {
            const members = roster.members.filter((member) => member.assignment === lane);
            return (
              <section key={lane} className={styles.panel} aria-labelledby={`office-build-${lane}`}>
                <h3 id={`office-build-${lane}`}>{title}</h3>
                <p className={styles.context}>{description}</p>
                {members.length ? (
                  <ul className={styles.members}>
                    {members.map((member) => (
                      <li key={member.id}>
                        {editing && !member.onLeave ? (
                          <button
                            type="button"
                            data-testid={`office-member-${member.id}`}
                            className="btn"
                            aria-pressed={member.id === selectedId}
                            aria-label={`${member.name}を選択${member.aiAssigned ? '（AI配布中）' : ''}`}
                            onClick={() => {
                              setSelectedId(member.id);
                              assignmentHeading.current?.focus();
                            }}
                          >
                            {member.name}
                            {member.aiAssigned && <span className="pill">AI配布中</span>}
                          </button>
                        ) : (
                          <span>
                            {member.name}
                            {member.onLeave
                              ? '（休職中）'
                              : member.aiAssigned
                                ? '（AI配布中）'
                                : ''}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>配置メンバーなし</p>
                )}
                {lane === 'review' && (
                  <div className={styles.equipment}>
                    <strong>{reviewHelp.name}</strong>
                    <p
                      className={styles.equipmentStatus}
                      data-state={helpStatus}
                      data-testid="office-review-help-status"
                    >
                      {
                        {
                          inactive: '未適用',
                          unavailable: '予算不足',
                          candidate: '適用候補',
                          applied: '適用済み',
                        }[helpStatus]
                      }
                    </p>
                    <p id="office-review-help-effect">
                      Review待ちを最大 {Math.abs(reviewHelp.effect.reviewQueueDelta ?? 0)}{' '}
                      件減らします。費用 {reviewHelp.cost}
                    </p>
                    {editing && (
                      <button
                        type="button"
                        className="btn"
                        aria-pressed={requestHelp}
                        aria-describedby="office-review-help-effect"
                        onClick={() => setRequestHelp(!requestHelp)}
                      >
                        レビュー応援を選ぶ
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </section>

      <div className={styles.workspace}>
        {editing && selected && (
          <section className={styles.panel} aria-labelledby="office-build-assignment">
            <h2 id="office-build-assignment" ref={assignmentHeading} tabIndex={-1}>
              担当とAI配布
            </h2>
            <p>
              <strong>{selected.name}</strong> ・ {rankLabel(selected.rank)} ・ 実装力{' '}
              {Math.round(selected.stats.implementation)} ・ レビュー力{' '}
              {Math.round(selected.stats.review)} ・ AI習熟 {Math.round(selected.stats.aiMastery)}
            </p>
            <div className={styles.controls} role="group" aria-label={`${selected.name}の配置先`}>
              {STATIONS.map(({ lane, title }) => (
                <button
                  key={lane}
                  type="button"
                  className="btn"
                  aria-pressed={selected.assignment === lane}
                  disabled={selected.onLeave}
                  onClick={() => setRoster((previous) => assignMember(previous, selected.id, lane))}
                >
                  {title}に配置
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn"
              aria-pressed={selected.aiAssigned}
              aria-describedby="office-build-ai-help"
              disabled={!aiAllowed}
              onClick={() =>
                setRoster((previous) => setAiAssigned(previous, selected.id, !selected.aiAssigned))
              }
            >
              AIを配る
            </button>
            <p id="office-build-ai-help" className={styles.context}>
              Coding担当にAIを配ると実装の速度や手戻りのリスクが変わります。Reviewや控えへ移すとAIは外れます。
            </p>
            {!canCode && <p role="status">Codingの担当者がいないため、実装が進みません。</p>}
          </section>
        )}

        <section className={styles.panel} aria-labelledby="office-build-forecast">
          <h2 id="office-build-forecast">
            {editing ? '開始時の変化と見込み' : '試走前のプランと見込み'}
          </h2>
          <p role="status" data-testid="office-build-balances">
            予算 {initial.forecast.budget} → {plan.forecast.budget} ・ Reviewの引き継ぎ{' '}
            {initial.forecast.teamReviewQueue} → {plan.forecast.teamReviewQueue} 件
          </p>
          <Forecast input={initial.forecast} label="初期プランの見込み" />
          {changed && (
            <Forecast
              input={plan.forecast}
              label={editing ? '変更案の見込み' : '適用プランの見込み'}
            />
          )}
          <p className={styles.context}>出荷と延焼は、複数の乱数条件で試した範囲です。</p>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="office-build-run">
        {editing ? (
          <h2 id="office-build-run">プランを試す</h2>
        ) : (
          <h2
            key={result ? 'result' : 'playing'}
            ref={focusSection}
            tabIndex={-1}
            id="office-build-run"
          >
            {result ? 'スプリントの実測' : 'スプリントを進める'}
          </h2>
        )}
        {result && (
          <p data-testid="office-build-result">
            出荷 {result.delivered} ・ 延焼 {result.spread} ・ Review待ち最大{' '}
            {result.reviewQueueMax} 件 ・ AI利用 {result.aiAssistedPct}%
          </p>
        )}
        {!editing && !result && <p role="status">経過 {view.sprintTick} tick</p>}
        <div className={styles.controls}>
          {editing ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canStart || webglStatus !== 'ready'}
                onClick={startSprint}
              >
                プランを適用して試走
              </button>
              <button type="button" className="btn" onClick={resetDraft}>
                変更を取り消す
              </button>
            </>
          ) : result ? (
            <button type="button" className="btn btn-primary" onClick={resetTrial}>
              同じ条件でやり直す
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                disabled={webglStatus !== 'ready'}
                onClick={() => step(false)}
              >
                1 tick進める
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={webglStatus !== 'ready'}
                onClick={() => step(true)}
              >
                最後まで進める
              </button>
            </>
          )}
        </div>
      </section>
      <WebglStatusOverlay reloadMessage="再読み込みすると試作のプランと結果は初期状態に戻ります。" />
    </main>
  );
}

export function OfficeBuildLab() {
  return (
    <ResponsiveModeProvider>
      <OfficeBuildTrial />
    </ResponsiveModeProvider>
  );
}
