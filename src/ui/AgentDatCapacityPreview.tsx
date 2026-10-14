/** 同じ人間DAT予算の下で、PR作成量と完成タスク量を分けて見せるR&D比較。 */
import { useState } from 'react';
import { simulateAgentDatPipeline } from '../prototypes/agentDatPipeline';
import type { AgentMode, ApprovalPolicy, Workload } from '../prototypes/agentWorkflowDat';
import styles from './AgentWorkflowDatLab.module.css';

const MODES = [
  { value: 'companion', label: '伴走型' },
  { value: 'asynchronous', label: '非同期型' },
] as const;
const POLICIES = [
  { value: 'each-step', label: '逐次承認' },
  { value: 'preauthorized', label: '事前許可' },
] as const;
const TASK_COUNT = 12;

export function AgentDatCapacityPreview({
  workload,
  mode,
  approvalPolicy,
}: {
  workload: Workload;
  mode: AgentMode;
  approvalPolicy: ApprovalPolicy;
}) {
  const [authorBudget, setAuthorBudget] = useState(120);
  const [reviewerBudget, setReviewerBudget] = useState(60);

  const rows = MODES.flatMap((option) =>
    POLICIES.map((policy) => ({
      mode: option.value,
      approvalPolicy: policy.value,
      result: simulateAgentDatPipeline({
        workload,
        mode: option.value,
        approvalPolicy: policy.value,
        taskCount: TASK_COUNT,
        authorBudgetMinutes: authorBudget,
        reviewerBudgetMinutes: reviewerBudget,
      }),
    })),
  );
  const selected = rows.find(
    (row) => row.mode === mode && row.approvalPolicy === approvalPolicy,
  )!.result;

  return (
    <section className={styles.panel} aria-labelledby="dat-capacity-title">
      <h2 id="dat-capacity-title">4. 12タスクのレビュー渋滞を比較</h2>
      <p className={styles.muted}>
        人間の作業予算を揃え、PR作成とレビュー完了を別々に数えます。 Author
        DATが小さくても、Reviewの処理能力を超えるとPRが滞留します。
      </p>
      <div className={styles.budgetControls}>
        <div className={styles.budgetControl}>
          <label htmlFor="dat-author-budget">
            Author作業予算 <b data-testid="dat-author-budget-value">{authorBudget}分</b>
          </label>
          <input
            type="range"
            id="dat-author-budget"
            data-testid="dat-author-budget"
            min={0}
            max={240}
            step={6}
            value={authorBudget}
            onChange={(event) => setAuthorBudget(Number(event.target.value))}
          />
        </div>
        <div className={styles.budgetControl}>
          <label htmlFor="dat-reviewer-budget">
            Reviewer作業予算 <b data-testid="dat-reviewer-budget-value">{reviewerBudget}分</b>
          </label>
          <input
            type="range"
            id="dat-reviewer-budget"
            data-testid="dat-reviewer-budget"
            min={0}
            max={240}
            step={12}
            value={reviewerBudget}
            onChange={(event) => setReviewerBudget(Number(event.target.value))}
          />
        </div>
      </div>
      <dl className={styles.metrics} aria-live="polite">
        <div>
          <dt>PR作成</dt>
          <dd data-testid="dat-capacity-created">{selected.createdPrs}件</dd>
        </div>
        <div className={styles.total}>
          <dt>レビュー完了</dt>
          <dd data-testid="dat-capacity-completed">{selected.completedTasks}件</dd>
        </div>
        <div>
          <dt>レビュー待ち</dt>
          <dd data-testid="dat-capacity-waiting">{selected.waitingReview}件</dd>
        </div>
        <div>
          <dt>手戻り修正待ち</dt>
          <dd data-testid="dat-capacity-rework">{selected.waitingRework}件</dd>
        </div>
      </dl>
      <div className={styles.tableScroll}>
        <table className={styles.compareTable} data-testid="dat-capacity-table">
          <thead>
            <tr>
              <th scope="col">AI</th>
              <th scope="col">承認</th>
              <th scope="col">PR作成</th>
              <th scope="col">完了</th>
              <th scope="col">Review待ち</th>
              <th scope="col">Rework待ち</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.mode}:${row.approvalPolicy}`}
                data-selected={row.mode === mode && row.approvalPolicy === approvalPolicy}
              >
                <th scope="row">{MODES.find((item) => item.value === row.mode)?.label}</th>
                <td>{POLICIES.find((item) => item.value === row.approvalPolicy)?.label}</td>
                <td>{row.result.createdPrs}</td>
                <td>{row.result.completedTasks}</td>
                <td>{row.result.waitingReview}</td>
                <td>{row.result.waitingRework}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>
        実装を先に進め、残ったReviewer予算でFIFO処理する固定期間の仮定です。
        未着手・作業途中・PR待ち・手戻りは完了に加えません。
        AI実行時間・人間の待ち時間・並列処理の暦時間は予算に含みません。
      </p>
    </section>
  );
}
