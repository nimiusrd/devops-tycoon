/**
 * F-8 / F-9 の合否判定（RI-132）。
 *
 * SPEC 第19.1 に数値閾値は無い。F-10 と同様、意図から定数を先に置き、
 * 実測に合わせて緩めない。判定は `playtest:report` と `playtest:check` が
 * このモジュールだけを見る。
 *
 * 計測可能（それ以外は未計測）:
 * - 既定コホートかつ世代一致
 * - 対象方針の敗北ラン**すべて**に反実仮想フィールド（`effectiveActionsInDanger`）がある
 * - F-8 のギャップ標本は、不完全かつ有効手なしと自然回復を除いた残りのラン
 */
import { generationMismatch } from './playtest-generation.mjs';

/** F-8 / F-9 合否の対象方針。診断出力の代表方針と同じ。 */
export const F9_POLICIES = ['naive', 'skilledNoHire', 'onlyFirefight', 'noInterventionCtl'];

/** F-8 が使う分位点。 */
export const F8_GAP_QUANTILE = 0.5;
/** F-8 PASS: 回復余地ギャップの p50 がこのスプリント数以下。 */
export const F8_MAX_GAP_P50 = 1;
/** F-9: 難易度横断でプールしたとき、敗因ごとに必要な complete CF 件数。 */
export const F9_MIN_REASON_N = 10;
/** F-9 PASS: 資格敗因の有効手集合が何種類以上違うか。 */
export const F9_MIN_DISTINCT_SETS = 2;

/**
 * F-9 集計用の安定キー。デッキ位置やスプリント内 task ID を落とし、
 * カード定義・介入種別・担当など意味的な属性だけを残す。
 * `src/sim/run/counterfactual.ts` の `stableEffectiveActionId` と同ロジック。
 */
export function stableEffectiveActionId(id) {
  return String(id)
    .split('+')
    .map((raw) => {
      const part = raw.replace(/@\d+$/, '');
      const card = /^card:([^:]+)(?::\d+)?$/.exec(part);
      if (card) return `card:${card[1]}`;
      const assign = /^assignTask:[^:]+:(ai|senior)$/.exec(part);
      if (assign) return `assignTask:${assign[1]}`;
      const split = /^splitPr:[^:]+$/.exec(part);
      if (split) return 'splitPr';
      const restUp = /^rest:upgrade:(?:([^:]+):)?\d+$/.exec(part);
      if (restUp) return restUp[1] ? `rest:upgrade:${restUp[1]}` : 'rest:upgrade';
      const setupAssign = /^setup:assign:[^:]+:([^:]+)$/.exec(part);
      if (setupAssign) return `setup:assign:${setupAssign[1]}`;
      const setupAi = /^setup:ai:[^:]+:(on|off)$/.exec(part);
      if (setupAi) return `setup:ai:${setupAi[1]}`;
      return part;
    })
    .join('+');
}

export function quantile(arr, p) {
  if (!arr.length) return NaN;
  const b = [...arr].sort((x, y) => {
    if (x === y) return 0;
    if (!Number.isFinite(x)) return 1;
    if (!Number.isFinite(y)) return -1;
    return x - y;
  });
  return b[Math.round((b.length - 1) * p)];
}

/** ギャップ計算の敗北スプリント。未完了スプリント内の即時敗北だけ加算後と一致する。 */
export function loseSprintsOf(run) {
  if (typeof run.sprintsPlayed !== 'number') return null;
  const midSprintInstantLose = run.lostPhase === 'sprint' && run.lostSprintCompleted === false;
  return midSprintInstantLose ? run.sprintsPlayed : Math.max(0, run.sprintsPlayed - 1);
}

function hasLastEffectiveActions(run) {
  const last = run.lastEffectiveActionsAt;
  return !!(last && Array.isArray(last.actions) && last.actions.length > 0);
}

/**
 * F-8 の回復余地ギャップ。完全評価で有効手が一度も無いランは Infinity（詰み確定）。
 * 不完全評価でも `lastEffectiveActionsAt` があれば数値ギャップにする。
 * 集計では不完全かつ有効手なし、および自然回復を標本から除外する。
 */
export function recoveryGapOf(run) {
  const loseSprints = loseSprintsOf(run);
  if (loseSprints == null) return Number.POSITIVE_INFINITY;
  if (hasLastEffectiveActions(run)) {
    return Math.max(0, loseSprints - run.lastEffectiveActionsAt.sprintsPlayed);
  }
  return Number.POSITIVE_INFINITY;
}

function hasCfField(run) {
  return Object.prototype.hasOwnProperty.call(run, 'effectiveActionsInDanger');
}

function uniqueRuns(raw) {
  const byKey = new Map();
  for (const run of raw) {
    byKey.set(`${run.meta ?? 'fresh'}|${run.difficulty}|${run.policy}|${run.seed}`, run);
  }
  return [...byKey.values()];
}

function formatGap(value) {
  if (!Number.isFinite(value)) return 'Inf';
  return String(value);
}

export function formatF8AcceptanceLine(result) {
  if (result.f8.verdict === '未計測') {
    return `F-8 受入（RI-132）: 未計測 — ${result.f8.reason}`;
  }
  return (
    `F-8 受入（RI-132）: 対象方針 ${F9_POLICIES.join(' / ')} / ` +
    `p50≤${F8_MAX_GAP_P50}（実測 p50=${formatGap(result.f8.p50)} n=${result.f8.n}） → ${result.f8.verdict}`
  );
}

export function formatF9AcceptanceLine(result) {
  if (result.f9.verdict === '未計測') {
    return `F-9 受入（RI-132）: 未計測 — ${result.f9.reason}`;
  }
  return (
    `F-9 受入（RI-132）: 対象方針 ${F9_POLICIES.join(' / ')} / ` +
    `最低種類数≥${F9_MIN_DISTINCT_SETS} / 敗因n≥${F9_MIN_REASON_N}` +
    `（実測 種類数=${result.f9.distinctEffectiveSetCount} 資格敗因=${result.f9.qualifyingReasons.join(',') || '—'}）` +
    ` → ${result.f9.verdict}`
  );
}

/**
 * 所見本文の F-8 / F-9 合否行が実測と一致するか。
 * 判定可能な既定コホートでは、未計測側も固定行（閾値定数を含む）を照合する。
 */
export function findingsF8F9Problems(body, result) {
  const problems = [];
  const lines = body.split('\n').map((line) => line.replace(/^\s*[-*]\s+/, '').trim());

  const check = (label, expected) => {
    const prefix = `${label} 受入（RI-132）:`;
    const line = lines.find((l) => l.startsWith(prefix));
    if (!line) {
      problems.push(`${label} 受入（RI-132）の合否行が無い`);
      return;
    }
    if (line !== expected) {
      problems.push(`${label} 受入行が実測と違う: 文書「${line}」 / 期待「${expected}」`);
    }
  };

  check('F-8', formatF8AcceptanceLine(result));
  check('F-9', formatF9AcceptanceLine(result));
  return problems;
}

/**
 * @param {object} loaded `runs.json` のオブジェクトまたは配列
 * @param {{ stale?: boolean | string | null }} [options]
 *   `stale` を渡せば世代検査を再利用する。省略時は `generationMismatch` を呼ぶ。
 */
export function evaluateF8F9(loaded, options = {}) {
  const raw = Array.isArray(loaded) ? loaded : (loaded.runs ?? []);
  const cohort = Array.isArray(loaded) ? null : loaded.cohort;
  const stale =
    options.stale !== undefined
      ? options.stale
      : generationMismatch(Array.isArray(loaded) ? {} : loaded);
  const runs = uniqueRuns(raw);

  const unmeasured = (reason) => ({
    measurable: false,
    f8: { verdict: '未計測', reason, p50: null, n: 0 },
    f9: {
      verdict: '未計測',
      reason,
      distinctEffectiveSetCount: null,
      qualifyingReasons: [],
      byReason: {},
    },
  });

  if (stale) {
    return unmeasured(typeof stale === 'string' ? stale : '世代不一致（STALE）');
  }
  if (!cohort) {
    return unmeasured('コホート情報の無い出力');
  }
  if (cohort.isDefault !== true) {
    return unmeasured('既定コホートではない');
  }
  if (cohort.partial === true || loaded.partial === true) {
    return unmeasured('測定が完了していない（partial）');
  }

  const targetLost = runs.filter((r) => F9_POLICIES.includes(r.policy) && r.loseReason);
  const cfLost = targetLost.filter(hasCfField);
  if (cfLost.length === 0) {
    return unmeasured('反実仮想評価が無い');
  }
  if (cfLost.length !== targetLost.length) {
    return unmeasured(
      `反実仮想評価が対象敗北の一部にしか無い（${cfLost.length}/${targetLost.length}）`,
    );
  }

  const gaps = [];
  let recoveredOnly = 0;
  let incompleteEmpty = 0;
  for (const r of cfLost) {
    if (r.counterfactualBaselineRecovered) {
      recoveredOnly += 1;
      continue;
    }
    if (r.counterfactualIncomplete && !hasLastEffectiveActions(r)) {
      incompleteEmpty += 1;
      continue;
    }
    gaps.push(recoveryGapOf(r));
  }

  let f8;
  if (gaps.length === 0) {
    let reason = '不完全評価の空結果と自然回復を除くとギャップ標本が無い';
    if (incompleteEmpty === cfLost.length) {
      reason = '不完全評価で有効手を確認できない';
    } else if (recoveredOnly === cfLost.length) {
      reason = '自然回復のみで詰み標本が無い';
    }
    f8 = { verdict: '未計測', reason, p50: null, n: 0 };
  } else {
    const p50 = quantile(gaps, F8_GAP_QUANTILE);
    f8 = {
      verdict: Number.isFinite(p50) && p50 <= F8_MAX_GAP_P50 ? 'PASS' : 'FAIL',
      reason: null,
      p50,
      n: gaps.length,
    };
  }

  const complete = cfLost.filter((r) => !r.counterfactualIncomplete);
  const byReason = new Map();
  for (const r of complete) {
    if (!byReason.has(r.loseReason)) byReason.set(r.loseReason, []);
    byReason.get(r.loseReason).push(r);
  }
  const qualifying = [...byReason.entries()]
    .filter(([, arr]) => arr.length >= F9_MIN_REASON_N)
    .sort(([a], [b]) => a.localeCompare(b));

  if (qualifying.length < 2) {
    return {
      measurable: true,
      f8,
      f9: {
        verdict: '未計測',
        reason: `資格敗因が${qualifying.length}種（必要≥2、敗因n≥${F9_MIN_REASON_N}）`,
        distinctEffectiveSetCount: null,
        qualifyingReasons: qualifying.map(([reason]) => reason),
        byReason: Object.fromEntries(
          qualifying.map(([reason, arr]) => [
            reason,
            [
              ...new Set(
                arr.flatMap((r) => (r.effectiveActionsInDanger ?? []).map(stableEffectiveActionId)),
              ),
            ].sort(),
          ]),
        ),
      },
    };
  }

  const f9ByReason = {};
  const setKeys = [];
  for (const [reason, arr] of qualifying) {
    const union = new Set();
    for (const r of arr) {
      for (const id of r.effectiveActionsInDanger ?? []) union.add(stableEffectiveActionId(id));
    }
    const actions = [...union].sort();
    f9ByReason[reason] = actions;
    setKeys.push(actions.join(','));
  }
  const distinctEffectiveSetCount = new Set(setKeys).size;
  const f9Pass = distinctEffectiveSetCount >= F9_MIN_DISTINCT_SETS;

  return {
    measurable: true,
    f8,
    f9: {
      verdict: f9Pass ? 'PASS' : 'FAIL',
      reason: null,
      distinctEffectiveSetCount,
      qualifyingReasons: qualifying.map(([reason]) => reason),
      byReason: f9ByReason,
    },
  };
}
