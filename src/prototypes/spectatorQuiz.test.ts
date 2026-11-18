import { describe, expect, it, vi } from 'vitest';
import fixture from '../../docs/prototypes/spectator-quiz-replays.json';
import { RunEngine } from '../sim/run/engine';
import { parseReplayShare } from '../state/replayShare';
import { recordSpectatorReplay } from '../../tests/unit/helpers/spectatorQuizFixture';
import { SpectatorQuiz, SPECTATOR_QUIZ_LIMITS } from './spectatorQuiz';

const raw = JSON.stringify(fixture.records[0].replay);
async function open(source = raw, current = 0, next = current + 1) {
  const result = await SpectatorQuiz.open(source, current, next);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
function changed(edit: (v: ReturnType<typeof JSON.parse>) => void) {
  const value = JSON.parse(raw);
  edit(value);
  return JSON.stringify(value);
}

describe('RI-302 保存記録の観戦クイズ', () => {
  it('固定資料は実parserを通り、複数seedで再記録と一致する', () => {
    for (const record of fixture.records) {
      expect(parseReplayShare(JSON.stringify(record.replay)).ok).toBe(true);
      expect(recordSpectatorReplay(record.replay.seed)).toEqual(record);
    }
  });

  it('問題・回答確定・進捗JSONには未来の実数値や表示文字列を混ぜない', async () => {
    const a = await open();
    const modified = changed((v) => {
      v.id = 'future-id';
      v.finishedAt = 987654321;
      v.keyframes[0].label = 'author says future answer';
      v.keyframes[1].label = 'future-marker';
      v.keyframes[1].frame.totals.delivered += 123;
      v.contentSnapshot.companyResult.outcome = 'future-caption';
    });
    const b = await open(modified);
    expect(a.view()).toEqual(b.view());
    expect(a.view()).toEqual({
      stage: 'question',
      question: {
        metric: 'cumulative-delivered-change',
        choices: ['increased', 'unchanged'],
        recordedCurrent: { index: 0, phase: 'setup', sprintsPlayed: 0, delivered: 0 },
      },
      decision: 'unanswered',
    });
    expect(a.reveal()).toEqual({ ok: false, reason: 'answer_or_skip_required' });
    expect(a.answer('increased').ok).toBe(true);
    expect(b.answer('increased').ok).toBe(true);
    expect(a.view()).toEqual(b.view());
    expect(Object.keys(JSON.parse(a.checkpoint())).sort()).toEqual([
      'currentIndex',
      'decision',
      'nextIndex',
      'revealed',
      'sourceSha256',
      'version',
    ]);
    expect(a.checkpoint()).not.toContain('future');
  });

  it('増加/不変の実記録を照合し、不正解とskipを区別する', async () => {
    for (const [index, prediction, correct, actual] of [
      [0, 'increased', true, 'increased'],
      [0, 'unchanged', false, 'increased'],
      [1, 'unchanged', true, 'unchanged'],
      [1, 'increased', false, 'unchanged'],
      [0, 'skip', null, 'increased'],
      [1, 'skip', null, 'unchanged'],
    ] as const) {
      const quiz = await open(raw, index);
      expect(prediction === 'skip' ? quiz.skip().ok : quiz.answer(prediction).ok).toBe(true);
      expect(quiz.view().reveal).toBeUndefined();
      expect(quiz.reveal().ok).toBe(true);
      expect(quiz.view().reveal).toMatchObject({
        actual,
        correct,
        recordedNext: {
          delivered: fixture.records[0].replay.keyframes[index + 1].frame.totals.delivered,
        },
      });
    }
  });

  it('全進捗からJSON再開し、異なる元資料・壊れた進捗を拒否する', async () => {
    const quiz = await open();
    for (const action of [() => {}, () => quiz.skip(), () => quiz.reveal()]) {
      action();
      const resumed = await SpectatorQuiz.resume(raw, quiz.checkpoint());
      expect(resumed.ok && resumed.value.view()).toEqual(quiz.view());
    }
    expect(await SpectatorQuiz.resume(`${raw} `, quiz.checkpoint())).toMatchObject({
      ok: false,
      reason: 'checkpoint_source_mismatch',
    });
    for (const patch of [
      { version: 9 },
      { decision: ['skip'] },
      { decision: 'unanswered', revealed: true },
      { nextIndex: 2 },
      { extra: 1 },
    ]) {
      expect(
        (
          await SpectatorQuiz.resume(
            raw,
            JSON.stringify({ ...JSON.parse(quiz.checkpoint()), ...patch }),
          )
        ).ok,
      ).toBe(false);
    }
  });

  it('旧v1は記録の整数だけで照合し、現行ルールやカード効果を補完しない', async () => {
    const legacy = changed((v) => {
      v.schemaVersion = 1;
      delete v.ruleset;
      delete v.contentSnapshot;
    });
    const quiz = await open(legacy);
    quiz.skip();
    quiz.reveal();
    expect(quiz.view().reveal).toMatchObject({ actual: 'increased', correct: null });
  });

  it('スプリント間の実出荷増加と実終端の隣接境界も記録どおりに読む', async () => {
    const between = await open(raw, 2, 3);
    between.skip();
    between.reveal();
    expect(between.view().reveal).toMatchObject({
      actual: 'increased',
      recordedNext: {
        phase: 'setup',
        sprintsPlayed: 1,
        delivered: 530,
      },
    });
    for (const { replay } of fixture.records) {
      const last = replay.keyframes.length - 1;
      const quiz = await open(JSON.stringify(replay), last - 1, last);
      quiz.skip();
      quiz.reveal();
      expect(quiz.view().reveal?.recordedNext).toMatchObject({
        phase: 'lost',
        delivered: replay.outcome.score,
      });
    }
  });

  it('未知・欠損・矛盾・非隣接・順序逆転を理由付きで拒否する', async () => {
    for (const source of [
      changed((v) => {
        v.schemaVersion = 99;
      }),
      changed((v) => {
        v.schemaVersion = 1;
        delete v.ruleset;
        delete v.contentSnapshot;
        v.outcome.score += 1;
      }),
      changed((v) => {
        delete v.keyframes[1].frame.totals.delivered;
      }),
      changed((v) => {
        v.keyframes[1].frame.totals.delivered = -1;
      }),
      changed((v) => {
        v.keyframes[1].frame.totals.delivered = 0.5;
      }),
      changed((v) => {
        v.keyframes[1].frame.sprintsPlayed += 2;
      }),
      changed((v) => {
        v.keyframes[1].frame.status = 'lost';
      }),
      changed((v) => {
        v.keyframes[2].frame.totals.delivered = 0;
      }),
      changed((v) => {
        v.keyframes.reverse();
      }),
      changed((v) => {
        v.keyframes[1].frame.quarterNumber = null;
      }),
    ]) {
      const result = await SpectatorQuiz.open(source, 0, 1);
      // 3枚目の矛盾はその隣接ペアを選ぶと拒否する。
      const other = await SpectatorQuiz.open(source, 1, 2);
      expect(!result.ok || !other.ok).toBe(true);
    }
    for (const pair of [
      [-1, 0],
      [0, 2],
      [1, 0],
      [0.5, 1.5],
      [999, 1000],
    ])
      expect((await SpectatorQuiz.open(raw, pair[0], pair[1])).ok).toBe(false);
  });

  it('閲覧・無効操作・二重回答・完了後操作は元記録/実ラン/RNG/storageを消費しない', async () => {
    const engine = new RunEngine({ seed: 'RI-302-live' });
    engine.startRun();
    engine.beginSetupSprint();
    engine.step(300);
    const before = engine.exportCounterfactualFrame();
    const storage = vi.fn(() => {
      throw new Error('unexpected storage');
    });
    vi.stubGlobal('localStorage', { getItem: storage, setItem: storage });
    vi.stubGlobal('indexedDB', { open: storage });
    try {
      const quiz = await open();
      const checkpoint = quiz.checkpoint();
      quiz.answer('unknown');
      quiz.reveal();
      expect(quiz.checkpoint()).toBe(checkpoint);
      const view = quiz.view();
      view.question.recordedCurrent.delivered = 99;
      expect(quiz.view().question.recordedCurrent.delivered).toBe(0);
      quiz.skip();
      quiz.reveal();
      const finished = quiz.checkpoint();
      expect(quiz.answer('increased').ok).toBe(false);
      expect(quiz.skip().ok).toBe(false);
      expect(quiz.reveal().ok).toBe(false);
      expect(quiz.checkpoint()).toBe(finished);
      expect(await open()).toBeInstanceOf(SpectatorQuiz);
      expect(engine.exportCounterfactualFrame()).toEqual(before);
      expect(JSON.stringify(fixture.records[0].replay)).toBe(raw);
      expect(storage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parser/hydrate前の入力上限と進捗上限を検証する', async () => {
    for (const source of [
      null,
      '{',
      ' '.repeat(SPECTATOR_QUIZ_LIMITS.replayCharacters + 1),
      changed((v) => {
        v.note = 'x'.repeat(SPECTATOR_QUIZ_LIMITS.stringCharacters + 1);
      }),
      changed((v) => {
        v.keyframes = Array(257).fill(v.keyframes[0]);
      }),
      changed((v) => {
        v.extra = Array(5001).fill(0);
      }),
      changed((v) => {
        let deep: unknown = null;
        for (let i = 0; i < 49; i += 1) deep = [deep];
        v.deep = deep;
      }),
    ])
      expect((await SpectatorQuiz.open(source, 0, 1)).ok).toBe(false);
    expect((await SpectatorQuiz.resume(raw, ' '.repeat(513))).ok).toBe(false);
    expect((await SpectatorQuiz.resume(raw, '{')).ok).toBe(false);
  });
});
