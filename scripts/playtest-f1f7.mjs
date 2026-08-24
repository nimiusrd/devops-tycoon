/** F-1 の比較対象。単一介入は方針一覧の8種をすべて含める。 */
export const F1_COMPOSITE_POLICY = 'skilledNoHire';
export const F1_SINGLE_POLICIES = [
  'onlyFirefight',
  'onlyInterrupt',
  'onlyOvertime',
  'onlyAndon',
  'onlyAssign',
  'onlySplit',
  'onlyPair',
  'onlyThrottle',
];

export const F1_DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'];
export const F1_SEEDS_PER_CELL = 10;

/**
 * 固定強手を検出する。各難易度で単一介入の勝利数が熟練複合方針を上回らないことを要求する。
 */
export function evaluateF1(runs) {
  const policies = [F1_COMPOSITE_POLICY, ...F1_SINGLE_POLICIES];
  const cells = [];
  const violations = [];
  let sampleOk = true;

  for (const difficulty of F1_DIFFICULTIES) {
    const wins = new Map();
    for (const policy of policies) {
      const sample = runs.filter(
        (run) =>
          run.difficulty === difficulty &&
          run.policy === policy &&
          (run.meta ?? 'fresh') === 'fresh',
      );
      if (sample.length !== F1_SEEDS_PER_CELL) sampleOk = false;
      wins.set(policy, sample.filter((run) => run.status === 'won').length);
    }
    const compositeWins = wins.get(F1_COMPOSITE_POLICY) ?? 0;
    for (const policy of F1_SINGLE_POLICIES) {
      const singleWins = wins.get(policy) ?? 0;
      if (singleWins > compositeWins) {
        violations.push({ difficulty, policy, singleWins, compositeWins });
      }
    }
    cells.push({ difficulty, compositeWins, wins: Object.fromEntries(wins) });
  }

  return { sampleOk, accepted: sampleOk && violations.length === 0, cells, violations };
}

export const F7_POLICY = 'naive';
export const F7_DIFFICULTY = 'easy';
export const F7_SAMPLE_SIZE = 10;
/** 10 seed の離散標本で「5ラン前後」を 2〜3勝として固定する。 */
export const F7_MIN_WINS = 2;
export const F7_MAX_WINS = 3;

export function evaluateF7(runs) {
  const sample = runs.filter(
    (run) =>
      run.difficulty === F7_DIFFICULTY &&
      run.policy === F7_POLICY &&
      (run.meta ?? 'fresh') === 'fresh',
  );
  const wins = sample.filter((run) => run.status === 'won').length;
  const sampleOk = sample.length === F7_SAMPLE_SIZE;
  return {
    sampleOk,
    wins,
    total: sample.length,
    accepted: sampleOk && wins >= F7_MIN_WINS && wins <= F7_MAX_WINS,
  };
}
