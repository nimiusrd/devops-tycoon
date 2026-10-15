/**
 * 非同期エージェントの承認・DAT仮説を操作で検証する隔離R&D画面。
 * 通常ランには接続しない。選択はランやブラウザ保存データを変更しない。
 */
import { useEffect, useState } from 'react';
import {
  applyAgentWorkflow,
  chooseAgentWorkflowInput,
  compareAgentWorkflows,
  createAgentWorkflow,
  summarizeAgentWorkflow,
  type AgentMode,
  type ApprovalPolicy,
  type WorkflowInput,
  type Workload,
} from '../prototypes/agentWorkflowDat';
import styles from './AgentWorkflowDatLab.module.css';
import { AgentDatCapacityPreview } from './AgentDatCapacityPreview';

const SEED = 'DAT-lab';
const WORKLOAD_OPTIONS: ReadonlyArray<{ value: Workload; label: string }> = [
  { value: 'routine', label: '定型タスク' },
  { value: 'coupled', label: '密結合タスク' },
];
const MODE_OPTIONS: ReadonlyArray<{ value: AgentMode; label: string }> = [
  { value: 'companion', label: '伴走型' },
  { value: 'asynchronous', label: '非同期型' },
];
const APPROVAL_OPTIONS: ReadonlyArray<{ value: ApprovalPolicy; label: string }> = [
  { value: 'each-step', label: '逐次承認' },
  { value: 'preauthorized', label: '事前許可' },
];
const STAGE_LABEL: Record<string, string> = {
  ready: '未着手',
  coding: '実装中・承認待ち',
  review: 'PR作成済み・レビュー待ち',
  rework: 'レビュー差戻し・手戻り',
  rereview: '再レビュー待ち',
  done: 'タスク完了',
};
const EVENT_LABEL: Record<string, string> = {
  instruction: '人間がタスクの初回指示を作成',
  'edit:complete': 'AIがファイルを編集',
  'test:complete': 'AIがテストを実行',
  'pr:complete': 'AIがPR作成工程を実行',
  'pr:created': 'PR作成（まだタスク完了ではない）',
  'human:approve': '人間が工程の承認を判断',
  'human:continue': '人間が伴走・次工程を指示',
  'review:changes-requested': 'レビューで手戻りを要求',
  'human:rework': '人間が指摘に対応して修正',
  'review:accepted': 'レビュー承認・タスク完了',
};
const STEP_LABEL = ['ファイル編集', 'テスト', 'PR作成'] as const;

interface ChoiceGroupProps<T extends string> {
  title: string;
  name: string;
  current: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChoose: (choice: T) => void;
}

function ChoiceGroup<T extends string>({
  title,
  name,
  current,
  options,
  onChoose,
}: ChoiceGroupProps<T>) {
  return (
    <fieldset className={styles.choiceGroup}>
      <legend>{title}</legend>
      <div className={styles.choiceRow}>
        {options.map((option) => (
          <label
            className={styles.choice}
            data-selected={current === option.value}
            key={option.value}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={current === option.value}
              onChange={() => onChoose(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function actionLabel(input: WorkflowInput, index: number): string {
  switch (input.type) {
    case 'start':
      return '実装を指示';
    case 'approve':
      return `${STEP_LABEL[index] ?? '工程'}を承認`;
    case 'continue':
      return `${STEP_LABEL[index] ?? '工程'}を指揮`;
    case 'review':
      return 'PRをレビュー';
    case 'fix':
      return '指摘を修正';
    case 'view':
      return 'タスク完了';
  }
}

export function AgentWorkflowDatLab() {
  const [workload, setWorkload] = useState<Workload>('routine');
  const [mode, setMode] = useState<AgentMode>('companion');
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>('each-step');
  const [resetNotice, setResetNotice] = useState<{ message: string; revision: number } | null>(null);
  const [state, setState] = useState(() =>
    createAgentWorkflow(SEED, 'routine', 'companion', 'each-step'),
  );

  const summary = summarizeAgentWorkflow(state);
  const input = chooseAgentWorkflowInput(state);
  const compareRows = compareAgentWorkflows(SEED).filter((row) => row.workload === workload);

  // 破棄した実験の作業量を明示し、条件変更による値のゼロ戻りを誤認させない。
  const restartForChoice = (
    nextWorkload: Workload,
    nextMode: AgentMode,
    nextApproval: ApprovalPolicy,
  ) => {
    if (state.inputs.length > 0) {
      // 未着手状態で追加の条件を選んでも直前の通知は消さず、
      // 新しい作業を再度破棄したときだけ同じ文面でもタイマーを再起動する。
      setResetNotice((previous) => ({
        message: `条件変更で進行をリセットしました（完了工程 ${state.stepIndex}/3、Author DAT ${summary.authorDat}分・Reviewer DAT ${summary.reviewerDat}分 → 0分）。`,
        revision: (previous?.revision ?? 0) + 1,
      }));
    }
    setState(createAgentWorkflow(SEED, nextWorkload, nextMode, nextApproval));
  };
  const selectWorkload = (choice: Workload) => {
    if (choice === workload) return;
    setWorkload(choice);
    restartForChoice(choice, mode, approvalPolicy);
  };
  const selectMode = (choice: AgentMode) => {
    if (choice === mode) return;
    setMode(choice);
    restartForChoice(workload, choice, approvalPolicy);
  };
  const selectApproval = (choice: ApprovalPolicy) => {
    if (choice === approvalPolicy) return;
    setApprovalPolicy(choice);
    restartForChoice(workload, mode, choice);
  };
  const reset = () => {
    setResetNotice(null);
    setState(createAgentWorkflow(SEED, workload, mode, approvalPolicy));
  };
  const advance = () => {
    setState((previous) => applyAgentWorkflow(previous, chooseAgentWorkflowInput(previous)));
  };
  useEffect(() => {
    if (!resetNotice) return;
    const timeout = window.setTimeout(() => setResetNotice(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [resetNotice]);

  return (
    <main className={`app ${styles.lab}`} data-testid="agent-dat-lab">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>DEVOPS TYCOON / R&D</p>
          <h1>AIエージェントのDAT実験室</h1>
          <p className={styles.intro}>
            実行形態と承認方式を選び、PR作成までの介入回数とレビューへの負荷転嫁を比較します。
          </p>
        </div>
        <a className={styles.backLink} href="?">
          通常ゲームへ戻る
        </a>
      </header>

      <p className={styles.notice}>
        これは固定した仮定値による実験です。実測の生産性・品質や通常ゲームのランには反映しません。
        DATは人間のアクティブ作業時間であり、AI処理中の待機時間は含みません。
      </p>

      <section className={styles.panel} aria-labelledby="dat-setup-title">
        <h2 id="dat-setup-title">1. 開発フローを選ぶ</h2>
        <p className={styles.muted}>条件を変更すると実験の進行をリセットします。</p>
        <div className={styles.choices}>
          <ChoiceGroup
            title="タスク構造"
            name="dat-workload"
            current={workload}
            options={WORKLOAD_OPTIONS}
            onChoose={selectWorkload}
          />
          <ChoiceGroup
            title="AIの実行形態"
            name="dat-mode"
            current={mode}
            options={MODE_OPTIONS}
            onChoose={selectMode}
          />
          <ChoiceGroup
            title="承認ポリシー"
            name="dat-approval"
            current={approvalPolicy}
            options={APPROVAL_OPTIONS}
            onChoose={selectApproval}
          />
        </div>
        {resetNotice ? (
          <p className={styles.resetNotice} role="status" data-testid="dat-reset-notice">
            {resetNotice.message}
          </p>
        ) : null}
      </section>

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="dat-flow-title">
          <h2 id="dat-flow-title">2. 仕事を進める</h2>
          <p className={styles.muted}>
            非同期型＋事前許可なら初回指示だけでPR作成まで進みます。ただしレビューは必要です。
          </p>
          <div className={styles.flowState}>
            <span className="pill" data-testid="dat-stage">
              {STAGE_LABEL[state.stage]}
            </span>
            <span className="pill" data-testid="dat-pr-created">
              {summary.prCreated ? 'PR作成済み' : 'PR未作成'}
            </span>
            <span className="pill" data-testid="dat-task-completed">
              {summary.completedTasks === 1 ? 'タスク完了' : 'タスク未完了'}
            </span>
          </div>
          <div className={styles.steps} aria-label="実装工程">
            {STEP_LABEL.map((step, index) => (
              <span className="pill" key={step} data-testid={`dat-step-${index}`}>
                {state.stepIndex > index ? '✓' : '·'} {step}
              </span>
            ))}
          </div>
          <div className={styles.actions}>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="dat-advance"
              disabled={input.type === 'view'}
              onClick={advance}
            >
              {actionLabel(input, state.stepIndex)}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="dat-reset"
              onClick={reset}
            >
              同条件でやり直す
            </button>
          </div>
          <h3 className={styles.subheading}>工程ログ</h3>
          {state.events.length === 0 ? (
            <p className={styles.muted} data-testid="dat-empty-log">
              まだ作業は始まっていません。
            </p>
          ) : (
            <ol className={styles.log} data-testid="dat-events">
              {state.events.map((event, index) => (
                <li key={index}>{EVENT_LABEL[event] ?? event}</li>
              ))}
            </ol>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="dat-metrics-title">
          <h2 id="dat-metrics-title">3. 人間の負荷を見る</h2>
          <dl className={styles.metrics} aria-live="polite">
            <div>
              <dt>Author DAT</dt>
              <dd data-testid="dat-author">{summary.authorDat}分</dd>
            </div>
            <div>
              <dt>Reviewer DAT</dt>
              <dd data-testid="dat-reviewer">{summary.reviewerDat}分</dd>
            </div>
            <div className={styles.total}>
              <dt>Total Human DAT</dt>
              <dd data-testid="dat-total">{summary.totalHumanDat}分</dd>
            </div>
            <div>
              <dt>PRまでの人間介入</dt>
              <dd data-testid="dat-touches">{summary.humanTouchesBeforePr}回</dd>
            </div>
            <div>
              <dt>承認回数</dt>
              <dd data-testid="dat-approvals">{summary.approvalCount}回</dd>
            </div>
            <div>
              <dt>手戻り</dt>
              <dd data-testid="dat-reworks">{summary.reworkRounds}回</dd>
            </div>
            <div>
              <dt>AI処理時間（DAT外）</dt>
              <dd data-testid="dat-agent-runtime">{summary.agentRuntimeMinutes}分</dd>
            </div>
            <div>
              <dt>完了タスク / 人時（参考）</dt>
              <dd data-testid="dat-throughput">
                {summary.tasksPerHumanHour === null
                  ? '―（未算定）'
                  : `${summary.tasksPerHumanHour}件`}
              </dd>
            </div>
          </dl>
          <p className={styles.muted}>
            承認判断はAuthor側、PRレビューはReviewer側にのみ加算します。
            PR作成だけでは完了件数を増やしません。
          </p>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="dat-compare-title">
        <h2 id="dat-compare-title">同じタスクの固定比較</h2>
        <p className={styles.muted}>
          設定を揃えると、実行形態だけ・承認方式だけを分けて比較できます。
          数値はこの試作の係数に基づき、品質・待ち時間・並行実行は別評価です。
        </p>
        <div className={styles.tableScroll}>
          <table className={styles.compareTable} data-testid="dat-compare">
            <thead>
              <tr>
                <th scope="col">AI</th>
                <th scope="col">承認</th>
                <th scope="col">介入</th>
                <th scope="col">Author</th>
                <th scope="col">Review</th>
                <th scope="col">合計</th>
              </tr>
            </thead>
            <tbody>
              {compareRows.map((row) => (
                <tr
                  key={`${row.mode}:${row.approvalPolicy}`}
                  data-selected={row.mode === mode && row.approvalPolicy === approvalPolicy}
                >
                  <th scope="row">
                    {MODE_OPTIONS.find((option) => option.value === row.mode)?.label}
                    {row.mode === mode && row.approvalPolicy === approvalPolicy ? '（選択中）' : ''}
                  </th>
                  <td>
                    {APPROVAL_OPTIONS.find((option) => option.value === row.approvalPolicy)?.label}
                  </td>
                  <td>{row.result.humanTouchesBeforePr}回</td>
                  <td>{row.result.authorDat}分</td>
                  <td>{row.result.reviewerDat}分</td>
                  <td>{row.result.totalHumanDat}分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.muted}>
          密結合タスクの非同期型には手戻りを1回仮定しています。
          これは比較用の仮定であり、非同期型の必然的な失敗を意味しません。
        </p>
      </section>
      <AgentDatCapacityPreview workload={workload} mode={mode} approvalPolicy={approvalPolicy} />
    </main>
  );
}
