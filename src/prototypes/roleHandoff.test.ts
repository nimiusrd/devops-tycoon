import { describe, expect, it } from 'vitest';
import { getLever } from '../data/levers';
import { RunEngine } from '../sim/run/engine';
import {
  createRoleHandoff,
  resumeRoleHandoff,
  ROLE_HANDOFF_LIMITS,
  type HandoffAction,
} from './roleHandoff';
import { handoffRequest, runRoleHandoffCase } from '../../tests/unit/helpers/roleHandoffFixture';

describe('RI-274 一台交代制の単一所有API', () => {
  it('通常RunEngineの初期資源を使い、編成は投資担当だけが変えられる', () => {
    const session = createRoleHandoff('g1');
    const engine = new RunEngine({ seed: 'g1', difficulty: 'normal' });
    engine.startRun();
    expect(session.view().state).toEqual(engine.snapshot());
    const member = session.view().state.roster.members[0];
    const lane = member.assignment === 'bench' ? 'coding' : 'bench';
    const request = handoffRequest(session, { kind: 'assign', memberId: member.id, lane });
    const before = session.save();
    expect(session.dispatch({ ...request, role: 'field' }).ok).toBe(false);
    expect(session.save()).toBe(before);
    expect(session.dispatch(request).ok).toBe(true);
    expect(session.view().state.roster.members[0].assignment).toBe(lane);
    if (lane !== 'coding') {
      expect(
        session.dispatch(
          handoffRequest(session, { kind: 'assign', memberId: member.id, lane: 'coding' }),
        ).ok,
      ).toBe(true);
    }
    expect(
      session.dispatch(
        handoffRequest(session, { kind: 'ai', memberId: member.id, on: !member.aiAssigned }),
      ).ok,
    ).toBe(true);
  });

  it.each(['review', 'bench'] as const)(
    '%s担当へのAI配布は実ルールに合わせて無消費拒否する',
    (lane) => {
      const session = createRoleHandoff('g1');
      const member = session
        .view()
        .state.roster.members.find((member) => member.assignment === 'coding')!;
      expect(
        session.dispatch(handoffRequest(session, { kind: 'assign', memberId: member.id, lane })).ok,
      ).toBe(true);
      const request = handoffRequest(session, { kind: 'ai', memberId: member.id, on: true });
      const before = session.save();
      expect(session.dispatch(request)).toEqual({ ok: false, reason: 'invalid-ai-assignment' });
      expect(session.dispatch({ ...request, requestId: 'retry' }).ok).toBe(false);
      expect(session.save()).toBe(before);
      // 拒否したIDも消費していないため、同じIDを有効な配置へ使える。
      expect(
        session.dispatch({
          ...request,
          action: { kind: 'assign', memberId: member.id, lane: 'coding' },
        }).ok,
      ).toBe(true);
      expect(
        session.view().state.roster.members.find((item) => item.id === member.id)?.assignment,
      ).toBe('coding');
    },
  );

  it('予約は効果/現金を先取りせず、引渡しで一度だけ支払い、RNG付きJSONで保つ', () => {
    const session = createRoleHandoff('g1');
    const initial = session.view();
    expect(
      session.dispatch(handoffRequest(session, { kind: 'reserve', leverId: 'standardize' })).ok,
    ).toBe(true);
    expect(session.view().state).toEqual(initial.state);
    expect(session.view().resources).toMatchObject({
      budget: 45,
      reservedBudget: 30,
      availableBudget: 15,
    });
    const saved = session.save();
    const result = resumeRoleHandoff(saved);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const request = handoffRequest(session, { kind: 'handoff' });
    const handoff = session.dispatch(request);
    expect(handoff.ok).toBe(true);
    expect(result.session.dispatch(request)).toEqual(handoff);
    expect(result.session.save()).toBe(session.save());
    const engine = new RunEngine({ seed: 'g1' });
    engine.startRun();
    engine.applyOrgLever('standardize');
    engine.beginSetupSprint();
    expect(session.view().state).toEqual(engine.snapshot());
    expect(session.view()).toMatchObject({ role: 'field', reservation: null });
    if (handoff.ok) expect(handoff.receipt.activatedReservation).toBe('standardize');
    const after = session.save();
    expect(session.dispatch(request).ok).toBe(false);
    expect(session.dispatch({ ...request, revision: session.view().revision }).ok).toBe(false);
    expect(session.save()).toBe(after);
  });

  it('予約の二重作成/予算横取りを拒否し、取消は無料で一度だけ行う', () => {
    const session = createRoleHandoff('g1');
    const send = (action: HandoffAction) => session.dispatch(handoffRequest(session, action));
    expect(send({ kind: 'reserve', leverId: 'standardize' }).ok).toBe(true);
    const before = session.save();
    expect(send({ kind: 'reserve', leverId: 'prSizeLimit' }).ok).toBe(false);
    expect(send({ kind: 'lever', leverId: 'standardize' }).ok).toBe(false);
    expect(session.save()).toBe(before);
    expect(send({ kind: 'cancelReservation' }).ok).toBe(true);
    expect(session.view().resources).toMatchObject({
      budget: 45,
      reservedBudget: 0,
      availableBudget: 45,
    });
    expect(send({ kind: 'cancelReservation' }).ok).toBe(false);
    expect(send({ kind: 'lever', leverId: 'standardize' }).ok).toBe(true);
    expect(send({ kind: 'reserve', leverId: 'standardize' }).ok).toBe(false);
  });

  it('古い編成、別フェーズ、未知/矛盾した入力、二重開始を無消費で拒否する', () => {
    const session = createRoleHandoff('g1');
    const request = handoffRequest(session, { kind: 'handoff' });
    for (const input of [
      null,
      {},
      { ...request, action: { kind: 'start' } },
      { ...request, revision: -1 },
      { ...request, revision: NaN },
      { ...request, requestId: 'x'.repeat(65) },
      { ...request, phase: 'unknown' },
      { ...request, extra: true },
      Object.assign(Object.create({ action: request.action }), {
        requestId: 'inherited',
        revision: 0,
        role: 'investment',
        phase: 'setup',
        extra: true,
      }),
      { ...request, action: { kind: 'handoff', cost: 0 } },
      { ...request, action: { kind: 'reserve', leverId: 'reorg' } },
      { ...request, action: { kind: 'assign', memberId: 'missing', lane: 'review' } },
      { ...request, action: { kind: 'assign', memberId: 'missing', lane: {} } },
      { ...request, action: { kind: 'intervene', id: 'unknown' } },
    ]) {
      const before = session.save();
      expect(session.dispatch(input).ok).toBe(false);
      expect(session.save()).toBe(before);
    }
    expect(session.dispatch(request).ok).toBe(true);
    const before = session.save();
    for (const action of [
      { kind: 'assign', memberId: session.view().state.roster.members[0].id, lane: 'bench' },
      { kind: 'lever', leverId: 'standardize' },
      { kind: 'handoff' },
      { kind: 'play', deckIndex: 4999 },
      { kind: 'step', ms: Infinity },
      { kind: 'step', ms: 5001 },
      { kind: 'step', ms: 0 },
      { kind: 'step', ms: -1 },
    ])
      expect(
        session.dispatch({ ...handoffRequest(session, { kind: 'step', ms: 1 }), action }).ok,
      ).toBe(false);
    expect(session.save()).toBe(before);
    expect(session.dispatch({ ...request, requestId: 'fresh' }).ok).toBe(false);
    expect(session.save()).toBe(before);
  });

  it('現場のカード/介入重複や失敗もRNG・集中力・履歴を消費しない', () => {
    const session = createRoleHandoff('g1');
    // 初期デッキは空。実ドラフトで取得した後の最初の成功発動まで進む。
    const recording = runRoleHandoffCase('g1');
    for (const { request } of recording.receipts) {
      if (request.action.kind === 'play') break;
      expect(session.dispatch(request).ok).toBe(true);
    }
    let played = false;
    for (const deckIndex of session.view().state.sprint!.cardPiles.hand) {
      const request = handoffRequest(session, { kind: 'play', deckIndex });
      if (!session.dispatch(request).ok) continue;
      const after = session.save();
      expect(session.dispatch(request).ok).toBe(false);
      expect(session.dispatch(handoffRequest(session, { kind: 'play', deckIndex })).ok).toBe(false);
      expect(session.save()).toBe(after);
      played = true;
      break;
    }
    expect(played).toBe(true);
    const field = createRoleHandoff('g1');
    field.dispatch(handoffRequest(field, { kind: 'handoff' }));
    const intervention = handoffRequest(field, { kind: 'intervene', id: 'overtime' });
    expect(field.dispatch(intervention).ok).toBe(true);
    const after = field.save();
    expect(field.dispatch({ ...intervention, revision: field.view().revision }).ok).toBe(false);
    expect(field.dispatch(handoffRequest(field, { kind: 'intervene', id: 'overtime' })).ok).toBe(
      false,
    );
    expect(field.save()).toBe(after);
  });

  it('view/応答/履歴の変更からengineや入力ログを書き換えられない', () => {
    const session = createRoleHandoff('g1');
    const view = session.view();
    const initial = session.save();
    view.state.budget = 99999;
    view.state.roster.members.length = 0;
    expect(session.save()).toBe(initial);
    const request = handoffRequest(session, { kind: 'reserve', leverId: 'prSizeLimit' });
    const result = session.dispatch(request);
    expect(result.ok).toBe(true);
    const after = session.save();
    request.requestId = 'mutated';
    request.action.kind = 'handoff';
    if (result.ok) result.receipt.after.resources.budget = 99999;
    session.history()[0].request.requestId = 'mutated';
    expect(session.save()).toBe(after);
    expect(Object.keys(session).sort()).toEqual(['dispatch', 'history', 'save', 'view']);
  });

  it.each(['g1', 'g2', 'g3'])(
    '%s: 同じ入力列で自然な終端に到達し、途中のRNG位置付き再開と一致する',
    (seed) => {
      const uninterrupted = runRoleHandoffCase(seed, 'teamAiThrottle');
      const restarted = runRoleHandoffCase(seed, 'teamAiThrottle', true, true);
      expect(restarted.resumed).toBe(true);
      expect(restarted.attempts).toEqual(uninterrupted.attempts);
      expect(restarted.save).toBe(uninterrupted.save);
      expect(restarted.final).toEqual(uninterrupted.final);
      const session = createRoleHandoff(seed);
      const inspected = new Set<string>();
      for (const { request } of uninterrupted.receipts) {
        expect(session.dispatch(request).ok).toBe(true);
        const view = session.view();
        const key = `${view.role}:${view.state.phase}`;
        if (!inspected.has(key)) {
          inspected.add(key);
          const result = resumeRoleHandoff(session.save());
          expect(result.ok, key).toBe(true);
          if (result.ok) expect(result.session.view()).toEqual(view);
        }
      }
      expect(inspected.has('field:result')).toBe(true);
      expect(inspected.has('investment:draft')).toBe(true);
      expect(inspected.has('investment:beat')).toBe(true);
      expect(session.view().state.status).not.toBe('playing');
      const terminal = session.save();
      for (const action of [
        { kind: 'handoff' },
        { kind: 'step', ms: 1000 },
        { kind: 'ackResult' },
      ] as const) {
        expect(session.dispatch(handoffRequest(session, action))).toEqual({
          ok: false,
          reason: 'complete',
        });
      }
      expect(session.save()).toBe(terminal);
      expect(session.view().allowed).toEqual([]);
      expect(resumeRoleHandoff(terminal).ok).toBe(true);
    },
    30_000,
  );

  it('中間フェーズの未知選択/目標修正と、resultの二重返却を無消費で拒否する', () => {
    const run = runRoleHandoffCase('g1');
    const session = createRoleHandoff('g1');
    for (const { request } of run.receipts) {
      const view = session.view();
      const invalid: HandoffAction | null =
        view.state.phase === 'draft'
          ? { kind: 'draft', cardId: 'unknown' }
          : view.state.phase === 'evolution'
            ? { kind: 'evolve', nodeId: 'unknown' }
            : view.state.phase === 'beat'
              ? { kind: 'beat', choice: 32 }
              : view.state.phase === 'quarterReview'
                ? { kind: 'quarterReview', adjustment: 'unknown' }
                : view.state.phase === 'result' && view.role === 'investment'
                  ? { kind: 'handoff' }
                  : null;
      if (invalid) {
        const before = session.save();
        expect(session.dispatch(handoffRequest(session, invalid, 'invalid')).ok).toBe(false);
        expect(session.save()).toBe(before);
      }
      expect(session.dispatch(request).ok).toBe(true);
    }
    expect(session.view().state).toEqual(run.final.state);
  });

  it('JSONの改ざん/RNG位置不一致/未知schema/上限超過を拒否する', () => {
    const session = createRoleHandoff('g1');
    session.dispatch(handoffRequest(session, { kind: 'handoff' }));
    session.dispatch(handoffRequest(session, { kind: 'step', ms: 1234 }));
    const json = session.save();
    const raw = JSON.parse(json);
    expect(raw.checkpoint.frame.sprintRngState).toEqual(expect.any(Number));
    expect(raw.checkpoint.frame.accumulatorMs).toBeGreaterThan(0);
    for (const value of [
      { ...raw, version: 2 },
      { ...raw, seed: '' },
      { ...raw, extra: true },
      { ...raw, inputs: [...raw.inputs, raw.inputs[0]] },
      { ...raw, checkpoint: { ...raw.checkpoint, role: 'investment' } },
      {
        ...raw,
        checkpoint: {
          ...raw.checkpoint,
          frame: {
            ...raw.checkpoint.frame,
            sprintRngState: raw.checkpoint.frame.sprintRngState + 1,
          },
        },
      },
      { ...raw, inputs: Array(ROLE_HANDOFF_LIMITS.operations + 1).fill(raw.inputs[0]) },
    ])
      expect(resumeRoleHandoff(JSON.stringify(value))).toEqual({ ok: false });
    expect(resumeRoleHandoff('x'.repeat(ROLE_HANDOFF_LIMITS.jsonCharacters + 1))).toEqual({
      ok: false,
    });
    expect(resumeRoleHandoff('{')).toEqual({ ok: false });
    expect(resumeRoleHandoff(null)).toEqual({ ok: false });
    expect(session.save()).toBe(json);
    const result = resumeRoleHandoff(json);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const next = handoffRequest(session, { kind: 'step', ms: 1234 });
      expect(result.session.dispatch(next)).toEqual(session.dispatch(next));
      expect(result.session.save()).toBe(session.save());
    }
  });

  it('無投資g3は実目標を満たして自動WinTypeで勝利し、全中間フェーズを通る', () => {
    const run = runRoleHandoffCase('g3');
    expect(run.final.state).toMatchObject({
      status: 'won',
      phase: 'won',
      winType: 'happiness',
      sprintsPlayed: 24,
    });
    expect(run.phases).toEqual(
      expect.arrayContaining(['shop', 'rest', 'recruit', 'quarterReview']),
    );
    const session = createRoleHandoff('g3');
    for (const { request } of run.receipts) {
      expect(session.dispatch(request).ok).toBe(true);
    }
    const before = session.save();
    expect(
      session.dispatch(handoffRequest(session, { kind: 'quarterReview', adjustment: null })).ok,
    ).toBe(false);
    expect(session.save()).toBe(before);
  });

  it('操作数の上限に達しても架空の終端/再開始/報酬を作らない', () => {
    const session = createRoleHandoff('limit');
    const member = session.view().state.roster.members[0];
    for (let i = 0; i < ROLE_HANDOFF_LIMITS.operations; i += 1) {
      expect(
        session.dispatch(
          handoffRequest(session, {
            kind: 'ai',
            memberId: member.id,
            on: i % 2 === 0 ? !member.aiAssigned : member.aiAssigned,
          }),
        ).ok,
      ).toBe(true);
    }
    const before = session.save();
    expect(before.length).toBeLessThan(ROLE_HANDOFF_LIMITS.jsonCharacters);
    expect(session.dispatch(handoffRequest(session, { kind: 'handoff' }))).toEqual({
      ok: false,
      reason: 'operation-limit',
    });
    expect(session.save()).toBe(before);
    expect(session.view().state.status).toBe('playing');
    expect(resumeRoleHandoff(before).ok).toBe(true);
    expect(() => createRoleHandoff('x'.repeat(81))).toThrow();
    expect(getLever('teamAiThrottle')!.cost).toBe(5);
  }, 30_000);
});
