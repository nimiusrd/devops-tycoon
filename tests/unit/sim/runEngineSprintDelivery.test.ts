/**
 * RunEngine の sprint resolve / delivery まわりのミューテーション回帰テスト。
 * Stryker の Survived mutation を exact 断言で潰す（旧 RI-91-A3）。
 */
import { describe, expect, it } from 'vitest';
import type { GrowthOutcome, RosterState } from '../../../src/sim/member';
import { RunEngine } from '../../../src/sim/run/engine';
import type {
  BeatState,
  QuarterReview,
  RunState,
  RunTotals,
  StakeholderTrust,
} from '../../../src/sim/run/types';
import type { OrgState, SprintMetrics, SprintResult, SprintState } from '../../../src/sim/types';
import {
  adjustableReview,
  completeSprint as completeSprintWith,
  makeOrg,
  zeroTotals,
} from '../helpers/runEngineFixtures';

type A3Internals = {
  beat: BeatState | null;
  budget: number;
  currentSprintId: string | null;
  currentSprintKind: RunState['currentSprintKind'];
  evolution: RunState['evolution'];
  lastGrowth: GrowthOutcome | null;
  org: OrgState;
  pendingSprintKind: RunState['pendingSprintKind'];
  phase: RunState['phase'];
  quarterGoal: RunState['quarterGoal'];
  quarterReview: QuarterReview | null;
  quarterTotals: RunTotals;
  roster: RosterState;
  sprint: SprintState | null;
  sprintBaselineInput: unknown;
  sprintIndexInQuarter: number;
  stakeholderTrust: StakeholderTrust;
  status: RunState['status'];
  totals: RunTotals;
  accumulateTotals(result: SprintResult): void;
  applyGrowth(result: { delivered: number; done: number }): void;
  applyTrust(delta: Partial<StakeholderTrust>): void;
  resolveSprint(): void;
  startNextQuarter(): void;
};

const asInternals = (engine: RunEngine): A3Internals => engine as unknown as A3Internals;

/** このファイル固定 seed を束ねた共通フィクスチャの別名。 */
const completeSprint = (org: OrgState, metrics: Partial<SprintMetrics> = {}): SprintState =>
  completeSprintWith('ri-91-a3-fixed-sprint', org, metrics);

const sprintResult = (overrides: Partial<SprintResult> = {}): SprintResult =>
  ({
    done: 0,
    delivered: 0,
    maxCombo: 0,
    aiAssistedPct: 0,
    reviewQueueMax: 0,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    seniorHpDelta: 0,
    actionCounts: {},
    grade: 'C',
    title: '',
    diagnosis: '',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 0,
    focusMax: 3,
    autoContainCount: 0,
    ...overrides,
  }) as SprintResult;

const arrangeSprint = (
  engine: RunEngine,
  options: {
    metrics?: Partial<SprintMetrics>;
    kind?: RunState['currentSprintKind'];
    org?: Partial<OrgState>;
  } = {},
): A3Internals => {
  engine.startRun('easy', [], 'ri-91-a3-arrange');
  const i = asInternals(engine);
  const org = makeOrg(options.org);
  i.phase = 'sprint';
  i.status = 'playing';
  i.currentSprintKind = options.kind ?? 'normal';
  i.currentSprintId = 'q1-s1';
  i.org = org;
  i.totals = zeroTotals();
  i.quarterTotals = zeroTotals();
  i.sprint = completeSprint(org, options.metrics);
  i.sprintBaselineInput = null;
  i.budget = 100;
  return i;
};

describe('RI-91-A3 RunEngine sprint resolve / delivery', () => {
  describe('applyGrowth / documentation', () => {
    it('sprint または currentSprintId 欠落では documentation と roster を変えない', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-growth-guard', difficulty: 'easy' });
      const i = arrangeSprint(engine);
      i.roster = {
        nextId: 1,
        members: [
          {
            ...i.roster.members[0]!,
            id: 'doc-1',
            traits: ['docMaster'],
            onLeave: false,
            assignment: 'coding',
          },
        ],
      };
      const beforeDoc = i.org.documentation;
      const beforeRoster = structuredClone(i.roster);

      i.sprint = null;
      i.currentSprintId = 'q1-s1';
      i.applyGrowth({ delivered: 50, done: 10 });
      expect(i.org.documentation).toBe(beforeDoc);
      expect(i.roster).toEqual(beforeRoster);
      expect(i.lastGrowth).toBeNull();

      i.sprint = completeSprint(i.org);
      i.currentSprintId = null;
      i.applyGrowth({ delivered: 50, done: 10 });
      expect(i.org.documentation).toBe(beforeDoc);
      expect(i.roster).toEqual(beforeRoster);
    });

    it('docGain が 0 のとき documentation へ代入しない', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-doc-zero', difficulty: 'easy' });
      const i = arrangeSprint(engine, { org: { documentation: 40 } });
      // ドキュメント魔なし → docGain 0。>0→>=0 / true でも 40+0=40 なので、代入回数で観測する。
      i.roster = {
        nextId: 1,
        members: [
          {
            ...i.roster.members[0]!,
            id: 'plain-1',
            traits: [],
            onLeave: false,
            assignment: 'coding',
            stamina: 80,
            xp: 0,
          },
        ],
      };
      let docValue = 40;
      let writeCount = 0;
      Object.defineProperty(i.org, 'documentation', {
        configurable: true,
        enumerable: true,
        get: () => docValue,
        set: (next: number) => {
          writeCount += 1;
          docValue = next;
        },
      });

      i.applyGrowth({ delivered: 10, done: 10 });
      expect(i.lastGrowth?.docGain).toBe(0);
      expect(writeCount).toBe(0);
      expect(i.org.documentation).toBe(40);
    });

    it('docGain > 0 のとき documentation を加算し 100 で clamp する', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-doc-add', difficulty: 'easy' });
      const i = arrangeSprint(engine, { org: { documentation: 30 } });
      i.roster = {
        nextId: 2,
        members: [
          {
            ...i.roster.members[0]!,
            id: 'doc-a',
            traits: ['docMaster'],
            onLeave: false,
            assignment: 'coding',
            stamina: 80,
            xp: 0,
          },
          {
            ...i.roster.members[0]!,
            id: 'doc-b',
            traits: ['docMaster'],
            onLeave: false,
            assignment: 'bench',
            stamina: 80,
            xp: 0,
          },
        ],
      };
      // docMaster は非休職なら assignment に関係なく +3。2人で +6。+ → - だと 24。
      i.applyGrowth({ delivered: 10, done: 10 });
      expect(i.lastGrowth?.docGain).toBe(6);
      expect(i.org.documentation).toBe(36);

      i.org.documentation = 98;
      i.applyGrowth({ delivered: 10, done: 10 });
      expect(i.org.documentation).toBe(100);
    });
  });

  describe('evoPointsFor via resolveSprint', () => {
    // 1 + floor(出荷/40)、elite +1（`EVO_POINTS_*` in constants.ts）
    it.each([
      { delivered: 0, kind: 'normal' as const, expectedGain: 1 },
      { delivered: 39, kind: 'normal' as const, expectedGain: 1 },
      { delivered: 40, kind: 'normal' as const, expectedGain: 2 },
      { delivered: 79, kind: 'normal' as const, expectedGain: 2 },
      { delivered: 80, kind: 'normal' as const, expectedGain: 3 },
      { delivered: 40, kind: 'elite' as const, expectedGain: 3 },
      { delivered: 0, kind: 'elite' as const, expectedGain: 2 },
    ])(
      'delivered=$delivered kind=$kind なら evolution.points が +$expectedGain',
      ({ delivered, kind, expectedGain }) => {
        const engine = new RunEngine({
          seed: `ri-91-a3-evo-${kind}-${delivered}`,
          difficulty: 'easy',
        });
        const i = arrangeSprint(engine, {
          kind,
          metrics: { delivered, doneCount: 1, completedCount: 1 },
        });
        // 成長の副作用を抑えてポイント差分だけ見る。
        i.applyGrowth = () => {
          i.lastGrowth = {
            promotions: [],
            leveledUp: [],
            wentOnLeave: [],
            docGain: 0,
          };
        };
        const before = i.evolution.points;
        i.resolveSprint();
        expect(engine.snapshot().phase).toBe('result');
        expect(i.evolution.points).toBe(before + expectedGain);
      },
    );
  });

  describe('accumulateTotals', () => {
    it('sprint 欠落では totals / quarterTotals を変えない', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-acc-guard', difficulty: 'easy' });
      const i = arrangeSprint(engine);
      i.totals = { ...zeroTotals(), delivered: 10, done: 3 };
      i.quarterTotals = { ...zeroTotals(), delivered: 7, done: 2 };
      const beforeTotals = structuredClone(i.totals);
      const beforeQuarter = structuredClone(i.quarterTotals);
      i.sprint = null;
      i.accumulateTotals(
        sprintResult({
          delivered: 50,
          done: 9,
          rework: 1,
          incidents: 2,
        }),
      );
      expect(i.totals).toEqual(beforeTotals);
      expect(i.quarterTotals).toEqual(beforeQuarter);
    });

    it('正常時は delivered を totals と quarterTotals の両方へ exact 加算する', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-acc-add', difficulty: 'easy' });
      const i = arrangeSprint(engine, {
        metrics: {
          delivered: 12,
          doneCount: 4,
          reworkCount: 1,
          incidentCount: 2,
          contained: 3,
          spread: 0,
          completedCount: 6,
          aiAssistedCompleted: 2,
          maxCombo: 5,
          reviewQueueMax: 4,
        },
      });
      i.totals = { ...zeroTotals(), delivered: 100, done: 10, completed: 5, aiAssisted: 1 };
      i.quarterTotals = { ...zeroTotals(), delivered: 20, done: 2 };
      i.accumulateTotals(
        sprintResult({
          delivered: 12,
          done: 4,
          rework: 1,
          incidents: 2,
          contained: 3,
          spread: 0,
          maxCombo: 5,
          reviewQueueMax: 4,
        }),
      );
      // += → -= だと delivered が減る。
      expect(i.totals).toMatchObject({
        delivered: 112,
        done: 14,
        rework: 1,
        incidents: 2,
        contained: 3,
        completed: 11,
        aiAssisted: 3,
        maxCombo: 5,
        reviewQueuePeak: 4,
        consecutiveIncidentSprints: 0,
      });
      expect(i.quarterTotals).toMatchObject({
        delivered: 32,
        done: 6,
        rework: 1,
        incidents: 2,
        contained: 3,
        completed: 6,
        aiAssisted: 2,
        maxCombo: 5,
        reviewQueuePeak: 4,
        consecutiveIncidentSprints: 0,
      });
    });
  });

  describe('chooseGoalAdjustment deliveryScoreMul', () => {
    it('quality_pivot は totals と quarterTotals の delivered に 0.9 を掛ける', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-quality-mul', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-quality-mul');
      const i = asInternals(engine);
      i.phase = 'quarterReview';
      i.quarterReview = adjustableReview(['quality_pivot']);
      i.quarterGoal = i.quarterReview.goal;
      i.stakeholderTrust = { management: 60, customers: 60, team: 60 };
      i.budget = 100;
      i.totals = { ...zeroTotals(), delivered: 200 };
      i.quarterTotals = { ...zeroTotals(), delivered: 140 };
      i.org = { ...i.org, deliveryScore: 200, techDebt: 40, morale: 50, seniorHp: 45 };
      // startNextQuarter が quarterTotals を空にするため、適用結果だけ観測する。
      i.startNextQuarter = () => undefined;

      engine.chooseGoalAdjustment('quality_pivot');

      expect(i.totals.delivered).toBe(180);
      expect(i.quarterTotals.delivered).toBe(126);
      // * → / だと 200/0.9≈222、140/0.9≈156。
      expect(i.totals.delivered).not.toBe(Math.round(200 / 0.9));
      expect(i.quarterTotals.delivered).not.toBe(Math.round(140 / 0.9));
    });
  });

  describe('resolveBeat delivery / trust / elite', () => {
    it('res.delivered ありなら totals と quarterTotals に加算する', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-beat-delivered', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-beat-delivered');
      const i = asInternals(engine);
      i.phase = 'beat';
      i.beat = { eventId: 'urgent-demo', kind: 'decision' };
      i.sprintIndexInQuarter = 1;
      i.totals = { ...zeroTotals(), delivered: 50 };
      i.quarterTotals = { ...zeroTotals(), delivered: 20 };
      i.budget = 100;

      engine.resolveBeat(0); // delivered: 30

      expect(i.totals.delivered).toBe(80);
      expect(i.quarterTotals.delivered).toBe(50);
      expect(engine.snapshot().org.deliveryScore).toBe(30);
    });

    it('res.delivered が無い選択では totals / quarterTotals を変えない', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-beat-no-delivered', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-beat-no-delivered');
      const i = asInternals(engine);
      i.phase = 'beat';
      i.beat = { eventId: 'urgent-demo', kind: 'decision' };
      i.sprintIndexInQuarter = 1;
      i.totals = { ...zeroTotals(), delivered: 50 };
      i.quarterTotals = { ...zeroTotals(), delivered: 20 };
      i.stakeholderTrust = { management: 60, customers: 60, team: 60 };
      i.budget = 100;

      engine.resolveBeat(2); // trust only

      expect(i.totals.delivered).toBe(50);
      expect(i.quarterTotals.delivered).toBe(20);
      expect(i.stakeholderTrust.management).toBe(52);
    });

    it('applyTrust は management を加算し、未指定フィールドは触らない', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-apply-trust', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-apply-trust');
      const i = asInternals(engine);
      i.stakeholderTrust = { management: 40, customers: 55, team: 70 };
      i.applyTrust({ management: 12 });
      // + → - だと 28。
      expect(i.stakeholderTrust).toEqual({ management: 52, customers: 55, team: 70 });

      i.applyTrust({ management: -8, customers: 5 });
      expect(i.stakeholderTrust).toEqual({ management: 44, customers: 60, team: 70 });
    });

    it('applyTrust は team 単独差分でも加算し、他フィールドは不変', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-apply-trust-team', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-apply-trust-team');
      const i = asInternals(engine);
      i.stakeholderTrust = { management: 40, customers: 55, team: 70 };
      // 採用イベント相当の { team: -4 }。management ガード常時実行だと NaN 汚染する。
      i.applyTrust({ team: -4 });
      expect(i.stakeholderTrust).toEqual({ management: 40, customers: 55, team: 66 });
    });

    it('leadsTo sprint-elite は pending を elite にして currentSprintKind を elite にする', () => {
      const engine = new RunEngine({ seed: 'ri-91-a3-sprint-elite', difficulty: 'easy' });
      engine.startRun('easy', [], 'ri-91-a3-sprint-elite');
      const i = asInternals(engine);
      i.phase = 'beat';
      i.beat = { eventId: 'elite-offer', kind: 'decision' };
      i.sprintIndexInQuarter = 1;
      i.pendingSprintKind = 'normal';
      i.budget = 100;

      engine.resolveBeat(0);

      // Block 空化だと pending が elite にならず current も normal のまま。
      expect(engine.snapshot().phase).toBe('sprint');
      expect(i.currentSprintKind).toBe('elite');
      expect(i.pendingSprintKind).toBe('normal');
    });
  });
});
