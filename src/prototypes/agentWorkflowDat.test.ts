import { describe, expect, it } from 'vitest';
import {
  applyAgentWorkflow,
  chooseAgentWorkflowInput,
  compareAgentWorkflows,
  createAgentWorkflow,
  summarizeAgentWorkflow,
} from './agentWorkflowDat';

const rows = compareAgentWorkflows('DAT-probe');
function result(
  workload: 'routine' | 'coupled',
  mode: 'companion' | 'asynchronous',
  approvalPolicy: 'each-step' | 'preauthorized',
) {
  return rows.find(
    (row) =>
      row.workload === workload && row.mode === mode && row.approvalPolicy === approvalPolicy,
  )!.result;
}

describe('非同期/伴走型エージェントのAuthor/Reviewer DAT', () => {
  it('非同期・事前許可は1回の指示でPRを作るが、レビュー前に完了扱いしない', () => {
    const fresh = createAgentWorkflow('DAT-probe', 'routine', 'asynchronous', 'preauthorized');
    const original = structuredClone(fresh);
    expect(applyAgentWorkflow(fresh, { type: 'review' })).toBe(fresh);
    const started = applyAgentWorkflow(fresh, { type: 'start' });
    expect(fresh).toEqual(original);
    expect(started.stage).toBe('review');
    expect(started.events).toContain('pr:created');
    expect(summarizeAgentWorkflow(started)).toMatchObject({
      prCreated: true,
      completedTasks: 0,
      authorDat: 6,
      reviewerDat: 0,
      approvalCount: 0,
      humanTouchesBeforePr: 1,
      agentRuntimeMinutes: 18,
    });
    const finished = applyAgentWorkflow(started, { type: 'review' });
    expect(summarizeAgentWorkflow(finished)).toMatchObject({
      completedTasks: 1,
      totalHumanDat: 22,
      tasksPerHumanHour: 2.73,
    });
    expect(applyAgentWorkflow(finished, { type: 'start' })).toBe(finished);
    expect(applyAgentWorkflow(finished, { type: 'review' })).toBe(finished);
  });

  it('逐次承認は各工程を止め、承認時間と監督時間だけAuthor DATへ加える', () => {
    let state = applyAgentWorkflow(
      createAgentWorkflow('DAT-probe', 'routine', 'companion', 'each-step'),
      { type: 'start' },
    );
    expect(state.stage).toBe('coding');
    expect(state.stepIndex).toBe(0);
    for (let i = 1; i <= 3; i += 1) {
      const previous = state;
      expect(applyAgentWorkflow(state, { type: 'continue' })).toBe(state);
      state = applyAgentWorkflow(state, { type: 'approve' });
      expect(previous.stepIndex).toBe(i - 1);
      expect(state.stepIndex).toBe(i);
      expect(state.approvalCount).toBe(i);
    }
    expect(summarizeAgentWorkflow(state)).toMatchObject({
      prCreated: true,
      completedTasks: 0,
      humanTouchesBeforePr: 4,
      authorDat: 18,
      reviewerDat: 0,
      agentRuntimeMinutes: 18,
    });
    state = applyAgentWorkflow(state, { type: 'review' });
    expect(summarizeAgentWorkflow(state).totalHumanDat).toBe(30);
  });

  it('実行形態と承認方式を分けて比較し、非同期を上位互換にしない', () => {
    expect(result('routine', 'companion', 'each-step')).toMatchObject({
      authorDat: 18,
      reviewerDat: 12,
      totalHumanDat: 30,
    });
    expect(result('routine', 'asynchronous', 'preauthorized')).toMatchObject({
      authorDat: 6,
      reviewerDat: 16,
      totalHumanDat: 22,
    });
    expect(result('routine', 'companion', 'preauthorized')).toMatchObject({
      approvalCount: 0,
      totalHumanDat: 21,
    });
    expect(result('routine', 'asynchronous', 'each-step')).toMatchObject({
      approvalCount: 3,
      totalHumanDat: 31,
    });
    for (const row of rows) {
      expect(row.result.completedTasks).toBe(1);
      expect(row.result.prCreated).toBe(true);
      expect(row.result.agentRuntimeMinutes).toBe(18);
    }
  });

  it('密結合では手戻りがレビュー後に発生し、非同期の総DATが逆転する', () => {
    let state = applyAgentWorkflow(
      createAgentWorkflow('DAT-probe', 'coupled', 'asynchronous', 'preauthorized'),
      { type: 'start' },
    );
    state = applyAgentWorkflow(state, { type: 'review' });
    expect(state.stage).toBe('rework');
    expect(summarizeAgentWorkflow(state)).toMatchObject({
      completedTasks: 0,
      reviewerDat: 32,
      reworkRounds: 1,
    });
    expect(applyAgentWorkflow(state, { type: 'review' })).toBe(state);
    state = applyAgentWorkflow(state, { type: 'fix' });
    expect(state.stage).toBe('rereview');
    expect(state.authorDat).toBe(41);
    state = applyAgentWorkflow(state, { type: 'review' });
    expect(summarizeAgentWorkflow(state)).toMatchObject({
      completedTasks: 1,
      authorDat: 41,
      reviewerDat: 46,
      totalHumanDat: 87,
    });
    expect(result('coupled', 'companion', 'each-step').totalHumanDat).toBe(42);
  });

  it('レビュー文脈・手戻りをゼロにすると非同期が優位になりうる', () => {
    let state = createAgentWorkflow('sensitivity', 'coupled', 'asynchronous', 'preauthorized', {
      asynchronousReviewContextMinutes: 0,
      asynchronousReworkAuthorMinutes: 0,
      asynchronousReworkReviewMinutes: 0,
    });
    while (state.stage !== 'done') {
      state = applyAgentWorkflow(state, chooseAgentWorkflowInput(state));
    }
    expect(summarizeAgentWorkflow(state)).toMatchObject({
      authorDat: 6,
      reviewerDat: 24,
      totalHumanDat: 30,
      reworkRounds: 0,
    });
    expect(() =>
      createAgentWorkflow('bad', 'routine', 'companion', 'each-step', {
        approvalMinutesPerStep: -1,
      }),
    ).toThrow();
    expect(() =>
      createAgentWorkflow('bad', 'routine', 'companion', 'each-step', {
        approvalMinutesPerStep: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
  });

  it('各入力のJSON保存再開とリプレイが一致し、表示だけでは進まない', () => {
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      let state = row.initial;
      let restored = JSON.parse(JSON.stringify(state));
      for (const input of row.inputs) {
        expect(chooseAgentWorkflowInput(state)).toEqual(input);
        const before = structuredClone(state);
        expect(applyAgentWorkflow(state, { type: 'view' })).toBe(state);
        const next = applyAgentWorkflow(state, input);
        restored = applyAgentWorkflow(JSON.parse(JSON.stringify(restored)), input);
        expect(state).toEqual(before);
        expect(next).not.toBe(state);
        expect(restored).toEqual(next);
        state = next;
      }
      expect(summarizeAgentWorkflow(state)).toEqual(row.result);
      expect(state.inputs).toEqual(row.inputs);
      expect(state.events.filter((event) => event === 'pr:created')).toHaveLength(1);
      expect(state.events.filter((event) => event === 'review:accepted')).toHaveLength(1);
    }
  });

  it('ログは入力オブジェクトをコピーし、呼び出し元の変更でリプレイが壊れない', () => {
    const input: { type: 'start' | 'review' } = { type: 'start' };
    const first = createAgentWorkflow('log-snapshot', 'routine', 'asynchronous', 'preauthorized');
    const started = applyAgentWorkflow(first, input);
    input.type = 'review';
    expect(started.inputs).toEqual([{ type: 'start' }]);
    expect(first.inputs).toEqual([]);
    const replayed = applyAgentWorkflow(first, started.inputs[0]!);
    expect(replayed).toEqual(started);
  });

  it('DATゼロの完了は、処理能力0と区別できるJSON-safeな未定義値を返す', () => {
    const zero = createAgentWorkflow('zero-dat', 'routine', 'asynchronous', 'preauthorized', {
      instructionMinutes: 0,
      supervisionMinutesPerStep: 0,
      approvalMinutesPerStep: 0,
      agentMinutesPerStep: 0,
      baseReviewMinutes: 0,
      asynchronousReviewContextMinutes: 0,
      asynchronousReworkAuthorMinutes: 0,
      asynchronousReworkReviewMinutes: 0,
    });
    expect(summarizeAgentWorkflow(zero).tasksPerHumanHour).toBeNull();
    const created = applyAgentWorkflow(zero, { type: 'start' });
    expect(summarizeAgentWorkflow(created)).toMatchObject({
      prCreated: true,
      completedTasks: 0,
      tasksPerHumanHour: null,
    });
    const done = applyAgentWorkflow(created, { type: 'review' });
    expect(summarizeAgentWorkflow(done)).toMatchObject({
      completedTasks: 1,
      totalHumanDat: 0,
      tasksPerHumanHour: null,
    });
    expect(JSON.parse(JSON.stringify(summarizeAgentWorkflow(done))).tasksPerHumanHour).toBeNull();
  });
});
