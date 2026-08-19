/**
 * F-8 / F-9 の合否判定（RI-132）。
 *
 * SPEC 第19.1 に数値閾値は無い。F-10 と同様、意図から定数を先に置き、
 * 実測に合わせて緩めない。判定は `playtest:report` と `playtest:check` が
 * このモジュールだけを見る。
 *
 * 計測可能（それ以外は未計測）:
 * - 既定コホートかつ世代一致
 * - 対象方針の敗北ランに反実仮想フィールド（`effectiveActionsInDanger`）がある
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

/**
 * F-8 の回復余地ギャップ。有効手が一度も無いランは Infinity（詰み確定）。
 * 不完全評価でも `lastEffectiveActionsAt` があれば数値ギャップにする。
 */
export function recoveryGapOf(run) {
  const loseSprints = loseSprintsOf(run);
  if (loseSprints == null) return Number.POSITIVE_INFINITY;
  const last = run.lastEffectiveActionsAt;
  if (last && Array.isArray(last.actions) && last.actions.length > 0) {
    return Math.max(0, loseSprints - last.sprintsPlayed);
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

const F8_LINE_RE =
  /^F-8 受入（RI-132）: 対象方針 .+ \/ p50≤(\d+)（実測 p50=(\S+) n=(\d+)） → (PASS|FAIL)$/;
const F8_UNMEASURED_RE = /^F-8 受入（RI-132）: 未計測 — /;
const F9_LINE_RE =
  /^F-9 受入（RI-132）: 対象方針 .+ \/ 最低種類数≥(\d+) \/ 敗因n≥(\d+)（実測 種類数=(\d+) 資格敗因=(\S+)） → (PASS|FAIL)$/;
const F9_UNMEASURED_RE = /^F-9 受入（RI-132）: 未計測 — /;

/**
 * 所見本文の F-8 / F-9 合否行が実測と一致するか。計測時だけ呼び、未計測では使わない。
 */
export function findingsF8F9Problems(body, result) {
  const problems = [];
  const lines = body.split('\n').map((line) => line.trim());

  if (result.f8.verdict !== '未計測') {
    const line = lines.find((l) => l.startsWith('F-8 受入（RI-132）:'));
    if (!line) {
      problems.push('F-8 受入（RI-132）の合否行が無い');
    } else if (F8_UNMEASURED_RE.test(line)) {
      problems.push(`F-8 受入（RI-132）が未計測と書かれているが実測は ${result.f8.verdict}`);
    } else {
      const m = line.match(F8_LINE_RE);
      if (!m) {
        problems.push(`F-8 受入（RI-132）の合否行が読めない: ${line}`);
      } else {
        const writtenP50 = m[2];
        const writtenN = Number(m[3]);
        const writtenVerdict = m[4];
        const actualP50 = formatGap(result.f8.p50);
        if (writtenP50 !== actualP50) {
          problems.push(`F-8 p50 が ${writtenP50} と書かれているが実測は ${actualP50}`);
        }
        if (writtenN !== result.f8.n) {
          problems.push(`F-8 n が ${writtenN} と書かれているが実測は ${result.f8.n}`);
        }
        if (writtenVerdict !== result.f8.verdict) {
          problems.push(`F-8 合否が ${writtenVerdict} と書かれているが実測は ${result.f8.verdict}`);
        }
      }
    }
  }

  if (result.f9.verdict !== '未計測') {
    const line = lines.find((l) => l.startsWith('F-9 受入（RI-132）:'));
    if (!line) {
      problems.push('F-9 受入（RI-132）の合否行が無い');
    } else if (F9_UNMEASURED_RE.test(line)) {
      problems.push(`F-9 受入（RI-132）が未計測と書かれているが実測は ${result.f9.verdict}`);
    } else {
      const m = line.match(F9_LINE_RE);
      if (!m) {
        problems.push(`F-9 受入（RI-132）の合否行が読めない: ${line}`);
      } else {
        const writtenCount = Number(m[3]);
        const writtenReasons = m[4];
        const writtenVerdict = m[5];
        const actualReasons = result.f9.qualifyingReasons.join(',') || '—';
        if (writtenCount !== result.f9.distinctEffectiveSetCount) {
          problems.push(
            `F-9 種類数が ${writtenCount} と書かれているが実測は ${result.f9.distinctEffectiveSetCount}`,
          );
        }
        if (writtenReasons !== actualReasons) {
          problems.push(`F-9 資格敗因が ${writtenReasons} と書かれているが実測は ${actualReasons}`);
        }
        if (writtenVerdict !== result.f9.verdict) {
          problems.push(`F-9 合否が ${writtenVerdict} と書かれているが実測は ${result.f9.verdict}`);
        }
      }
    }
  }

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

  const gaps = cfLost.map(recoveryGapOf);
  const p50 = quantile(gaps, F8_GAP_QUANTILE);
  const f8Pass = Number.isFinite(p50) && p50 <= F8_MAX_GAP_P50;
  const f8 = {
    verdict: f8Pass ? 'PASS' : 'FAIL',
    reason: null,
    p50,
    n: gaps.length,
  };

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
