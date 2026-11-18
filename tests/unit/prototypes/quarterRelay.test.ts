import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../../src/game';
import { canonicalizeJson, sha256Hex } from '../../../src/data/balance/canonical';
import { RunEngine } from '../../../src/sim/run/engine';
import { SPRINTS_PER_QUARTER } from '../../../src/sim/run/constants';
import { defaultMeta } from '../../../src/state/meta';
import { MemoryRunStorage, toRunSave, type RunSave } from '../../../src/state/runPersistence';
import { parseRunSaveShare } from '../../../src/state/runSaveShare';
import {
  exportQuarterRelay,
  importQuarterRelay,
  parseQuarterRelay,
  resumeQuarterRelay,
  RELAY_LIMITS,
  type QuarterRelayFile,
  type RelayReceipt,
} from '../../../src/prototypes/quarterRelay';
import {
  advanceRelay,
  finishRelay,
  relayAct,
  relayReviewFixture,
} from '../../../src/prototypes/quarterRelayEvaluation';

function value<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}
let source: RunSave;
let raw: string;
const options = {
  participant: '前任A',
  memo: '品質への投資と残予算を確認してください。',
  adjustment: 'cut_scope' as const,
};
const open = () => value(importQuarterRelay(raw, '後任B'));
const mutate = (fn: (file: QuarterRelayFile) => void) => {
  const file = JSON.parse(raw) as QuarterRelayFile;
  fn(file);
  const { fingerprint: _old, ...payload } = file;
  file.fingerprint = sha256Hex(canonicalizeJson(payload));
  return JSON.stringify(file);
};

beforeAll(() => {
  const fixture = relayReviewFixture();
  expect(fixture.final.quarterReview?.outcome).toBe('missed_adjustable');
  expect(fixture.final.quarterNumber).toBe(1);
  source = fixture.save!;
  raw = value(exportQuarterRelay(JSON.stringify(source), options));
});

describe('RI-300 固定二期リレー', () => {
  it('自然なQ1未達の実セーブから修正直後だけを複製し、明示の担当期・実履歴・残資源を保存する', () => {
    const untouched = structuredClone(source);
    const exported = value(exportQuarterRelay(JSON.stringify(source), options));
    const file = value(parseQuarterRelay(exported));
    const s = file.boundary.state;
    expect(s).toMatchObject({
      phase: 'setup',
      quarterNumber: 2,
      sprintIndexInQuarter: 0,
      sprintsPlayed: SPRINTS_PER_QUARTER,
      quarterReview: null,
      currentSprintId: null,
      lastResult: null,
      sprint: null,
      sprintTick: 0,
      reviewHistory: ['missed_adjustable'],
    });
    expect(file.assignments).toEqual([{ order: 1, quarter: 1, participant: '前任A' }]);
    expect(file.before).toEqual(source);
    expect(file.manifest.before.reviewHistory).toEqual(source.state.reviewHistory);
    expect(file.manifest.after.reviewHistory).toEqual(s.reviewHistory);
    expect(file.manifest.after.resources).toMatchObject({
      budget: s.budget,
      org: s.org,
      roster: s.roster,
      deck: s.deck,
      relics: s.relics,
      evolution: s.evolution,
    });
    expect(file.manifest.after.goal).toEqual(s.quarterGoal);
    const engine = new RunEngine();
    engine.hydratePersistState(source.state);
    engine.chooseGoalAdjustment('cut_scope');
    expect(s).toEqual(engine.exportPersistState());
    expect(source).toEqual(untouched);
    expect(exported).toBe(raw);
  });

  it('同じファイルの複数受領は親共通の別branchで、返却値の編集はセッションに届かない', () => {
    const a = open();
    const b = open();
    expect(a.view().receipt.branchId).not.toBe(b.view().receipt.branchId);
    expect(a.view().receipt.parentFingerprint).toBe(b.view().receipt.parentFingerprint);
    expect(a.view().receipt.assignments).toEqual([
      { order: 1, quarter: 1, participant: '前任A' },
      { order: 2, quarter: 2, participant: '後任B' },
    ]);
    expect(a.view().state).toEqual(b.view().state);
    const before = a.save();
    const view = a.view();
    view.state.budget = 99999;
    view.receipt.assignments[0].participant = '偽名';
    view.manifest.after.resources.budget = 0;
    expect(a.save()).toBe(before);
    expect(Object.keys(a).sort()).toEqual(['act', 'save', 'view']);
  });

  it('未知入力・順序違い・重複・誤フェーズを資源/RNG/履歴の無消費で拒否する', () => {
    const s = open();
    const before = s.save();
    for (const input of [
      null,
      { sequence: 0, type: 'adjust', adjustmentId: 'cut_scope' },
      { sequence: 0, type: 'begin', force: true },
      { sequence: 1, type: 'begin' },
      { sequence: 0, type: 'tick' },
      { sequence: 0, type: 'buyCard', cardId: 'docs' },
      { sequence: 0, type: 'beat', choiceIndex: 999 },
      { sequence: 0, type: 'dispatch', actionId: 'unknown' },
    ]) {
      expect(s.act(JSON.stringify(input)).ok).toBe(false);
      expect(s.save()).toBe(before);
    }
    expect(s.act('{').ok).toBe(false);
    expect(s.save()).toBe(before);
    expect(s.act(JSON.stringify({ sequence: 0, type: 'begin' })).ok).toBe(true);
    const started = s.save();
    expect(s.act(JSON.stringify({ sequence: 0, type: 'begin' })).ok).toBe(false);
    expect(relayAct(s, { type: 'begin' }).ok).toBe(false);
    expect(s.save()).toBe(started);
  });

  it('同入力の実スプリント中JSON再開はRNGと内部状態を保ち、その後の入力も一致する', () => {
    const s = open();
    value(relayAct(s, { type: 'begin' }));
    value(relayAct(s, { type: 'tick' }));
    const saved = s.save();
    expect(JSON.parse(saved).checkpoint.rngState).toEqual(expect.any(Number));
    const resumed = value(resumeQuarterRelay(saved));
    expect(resumed.save()).toBe(saved);
    for (let i = 0; i < 4; i++) {
      expect(advanceRelay(s)).toEqual(advanceRelay(resumed));
      expect(resumed.save()).toBe(s.save());
    }
  });

  it('Q2終了か自然な途中敗北で止まり、通常勝敗を保ちQ3・再受渡し・通常報酬を作らない', () => {
    const s = open();
    const final = finishRelay(s, true);
    expect(final.complete).toBe(true);
    expect(final.state.quarterNumber).toBe(2);
    expect(final.state.sprintsPlayed).toBeLessThanOrEqual(2 * SPRINTS_PER_QUARTER);
    expect(final).toMatchObject({ rewardEligible: false, metaReward: 0, dailyReward: 0 });
    expect(final.state.goalAdjustmentsTaken).toHaveLength(1);
    const saved = s.save();
    expect(value(resumeQuarterRelay(saved)).save()).toBe(saved);
    expect(s.act(JSON.stringify({ sequence: final.acceptedInputs, type: 'begin' }))).toMatchObject({
      ok: false,
      reason: 'complete',
    });
    expect(s.save()).toBe(saved);
    expect(exportQuarterRelay(saved, options).ok).toBe(false);
  });

  it('品質転換の実Q2達成では通常のWinTypeを自動判定し、勝利時にも通常報酬を発生させない', () => {
    const exported = value(
      exportQuarterRelay(JSON.stringify(source), { ...options, adjustment: 'quality_pivot' }),
    );
    const session = value(importQuarterRelay(exported, '後任B'));
    const final = finishRelay(session);
    expect(final.state).toMatchObject({
      quarterNumber: 2,
      phase: 'won',
      status: 'won',
      winType: 'happiness',
    });
    expect(final).toMatchObject({
      complete: true,
      rewardEligible: false,
      metaReward: 0,
      dailyReward: 0,
    });
    expect(value(resumeQuarterRelay(session.save())).view()).toEqual(final);
  });

  it.each([
    [
      '未知形式',
      (f: QuarterRelayFile) => {
        f.version = 99 as 1;
      },
    ],
    [
      '試作ruleset',
      (f: QuarterRelayFile) => {
        f.ruleset.prototype = 'other';
      },
    ],
    [
      'BALANCE指紋',
      (f: QuarterRelayFile) => {
        f.ruleset.balanceFingerprint = 'other';
      },
    ],
    [
      '内部ruleset',
      (f: QuarterRelayFile) => {
        f.boundary.ruleset!.fingerprint = 'other';
      },
    ],
    [
      '旧セーブ',
      (f: QuarterRelayFile) => {
        f.before.schemaVersion = 7 as 8;
      },
    ],
    [
      '非境界',
      (f: QuarterRelayFile) => {
        f.boundary.state.sprintIndexInQuarter = 1;
        f.boundary.summary.sprintIndexInQuarter = 1;
      },
    ],
    [
      '矛盾境界',
      (f: QuarterRelayFile) => {
        f.boundary.state.quarterReview = f.before.state.quarterReview;
      },
    ],
    [
      '別残資源',
      (f: QuarterRelayFile) => {
        f.boundary.state.budget += 1;
      },
    ],
    [
      '破損構造',
      (f: QuarterRelayFile) => {
        f.before.state.roster = null as never;
      },
    ],
    [
      '架空担当',
      (f: QuarterRelayFile) => {
        f.assignments[0].quarter = 0;
      },
    ],
    [
      '架空レビュー',
      (f: QuarterRelayFile) => {
        f.before.state.reviewHistory.push('met');
      },
    ],
    [
      '要約改変',
      (f: QuarterRelayFile) => {
        f.manifest.after.goal.deliveryTarget += 1;
      },
    ],
    [
      'タスク上限',
      (f: QuarterRelayFile) => {
        f.before.state.extras.baseConfig.taskCount = RELAY_LIMITS.tasks + 1;
      },
    ],
    [
      '行列上限',
      (f: QuarterRelayFile) => {
        f.before.state.extras.teams![0].reviewQueue = RELAY_LIMITS.tasks + 1;
      },
    ],
    [
      'tick上限',
      (f: QuarterRelayFile) => {
        f.before.state.extras.baseConfig.maxTicks = RELAY_LIMITS.sprintTicks + 1;
      },
    ],
    [
      '未知試練',
      (f: QuarterRelayFile) => {
        f.before.state.trials = ['unknown'];
        f.before.summary.trials = ['unknown'];
      },
    ],
    [
      'Q1持越し矛盾',
      (f: QuarterRelayFile) => {
        f.before.state.goalCarryoverQuarter = 1;
        f.before.state.goalCarryoverId = 'quality_pivot';
      },
    ],
    [
      'Q1目標矛盾',
      (f: QuarterRelayFile) => {
        f.before.state.quarterReview!.goal.deliveryTarget += 1;
      },
    ],
    [
      'Q1トレンド矛盾',
      (f: QuarterRelayFile) => {
        f.before.state.trendHistory![0].kpis[0].actual += 1;
      },
    ],
  ])('%sは指紋を作り直しても拒否する', (_label, change) => {
    expect(parseQuarterRelay(mutate(change)).ok).toBe(false);
  });

  it('破損JSON・未知キー・指紋・文字列/サイズ/配列/深さの上限を拒否する', () => {
    for (const text of [
      '{',
      'null',
      '[]',
      raw.slice(0, -2),
      JSON.stringify({ ...JSON.parse(raw), extra: true }),
      raw.replace('品質への投資', '品質への変更'),
      ' '.repeat(RELAY_LIMITS.fileChars + 1),
      JSON.stringify({ ...JSON.parse(raw), memo: 'x'.repeat(RELAY_LIMITS.memoChars + 1) }),
      JSON.stringify({ a: Array(RELAY_LIMITS.arrayItems + 1).fill(0) }),
      '['.repeat(RELAY_LIMITS.nesting + 2) + '0' + ']'.repeat(RELAY_LIMITS.nesting + 2),
    ]) {
      expect(parseQuarterRelay(text).ok).toBe(false);
    }
    expect(importQuarterRelay(raw, '').ok).toBe(false);
    expect(importQuarterRelay(raw, 'x'.repeat(RELAY_LIMITS.participantChars + 1)).ok).toBe(false);
    expect(
      exportQuarterRelay(JSON.stringify(source), { ...options, memo: 'x'.repeat(1001) }).ok,
    ).toBe(false);
  });

  it('Q1初期setup・達成・不正修正・Q2既進行は書き出せない', () => {
    const engine = new RunEngine();
    engine.startRun();
    expect(
      exportQuarterRelay(JSON.stringify(toRunSave(engine.exportPersistState()!)), options).ok,
    ).toBe(false);
    const met = structuredClone(source);
    met.state.quarterReview!.outcome = 'met';
    expect(exportQuarterRelay(JSON.stringify(met), options).ok).toBe(false);
    expect(
      exportQuarterRelay(JSON.stringify(source), { ...options, adjustment: 'unknown' as never }).ok,
    ).toBe(false);
    const q2 = JSON.parse(raw).boundary;
    expect(exportQuarterRelay(JSON.stringify(q2), options).ok).toBe(false);
  });

  it('再開で入力改変・重複・受領branch/担当/親指紋・RNG破損を拒否する', () => {
    const s = open();
    relayAct(s, { type: 'begin' });
    relayAct(s, { type: 'tick' });
    const saved = s.save();
    const edits: ((v: {
      inputs: Record<string, unknown>[];
      receipt: RelayReceipt;
      checkpoint: { rngState: number; engineHash: string };
    }) => void)[] = [
      (v) => {
        v.inputs[1].sequence = 0;
      },
      (v) => {
        v.inputs[1].type = 'adjust';
      },
      (v) => {
        v.receipt.branchId = 'not-uuid';
      },
      (v) => {
        v.receipt.parentFingerprint = 'bad';
      },
      (v) => {
        v.receipt.assignments[0].participant = '別人';
      },
      (v) => {
        v.receipt.assignments[1].quarter = 3;
      },
      (v) => {
        v.checkpoint.rngState += 1;
      },
      (v) => {
        v.checkpoint.engineHash = 'bad';
      },
      (v) => {
        v.inputs = Array(RELAY_LIMITS.inputs + 1).fill({ sequence: 0, type: 'tick' });
      },
    ];
    for (const edit of edits) {
      const v = JSON.parse(saved);
      edit(v);
      expect(resumeQuarterRelay(JSON.stringify(v)).ok).toBe(false);
    }
    expect(resumeQuarterRelay(' '.repeat(RELAY_LIMITS.saveChars + 1)).ok).toBe(false);
    expect(s.save()).toBe(saved);
  });

  it('通常セーブ/parser/meta/storage所有権を変更せず専用結果の通常報酬は常にゼロ', async () => {
    const storage = new MemoryRunStorage();
    await storage.save(source);
    const meta = defaultMeta();
    const savedMeta = structuredClone(meta);
    const metaStorage = {
      load: vi.fn(async () => savedMeta),
      save: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const game = createGame({
      initialMeta: meta,
      initialRunSave: source,
      runStorage: storage,
      metaStorage,
    });
    const beforeGame = game.getState();
    const saveSpy = vi.spyOn(storage, 'save');
    const clearSpy = vi.spyOn(storage, 'clear');
    const s = open();
    relayAct(s, { type: 'begin' });
    expect(parseRunSaveShare(raw).ok).toBe(false);
    expect(parseRunSaveShare(s.save()).ok).toBe(false);
    finishRelay(s);
    expect(s.view()).toMatchObject({ rewardEligible: false, metaReward: 0, dailyReward: 0 });
    expect(await storage.load()).toEqual(source);
    expect(game.getState()).toEqual(beforeGame);
    expect(game.getMeta()).toEqual(savedMeta);
    expect(meta).toEqual(savedMeta);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(metaStorage.save).not.toHaveBeenCalled();
  });
});
