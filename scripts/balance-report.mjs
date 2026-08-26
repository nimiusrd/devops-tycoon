/**
 * 2つの `npm run playtest` 出力を同一コホート・同一 seed で比較する。
 *
 *   npm run balance:report -- \
 *     --before /tmp/before/runs.json \
 *     --after /tmp/after/runs.json \
 *     --before-root /tmp/before \
 *     --after-root /tmp/after \
 *     --out-dir /tmp/balance-report
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { summarizeNumeric } from './playtest-statistics.mjs';

export const BALANCE_REPORT_SCHEMA_VERSION = 1;
export const DEFAULT_BALANCE_REPORT_DIR = 'playtest-out/balance-report';

const METRICS = [
  { id: 'delivery', label: 'Delivery' },
  { id: 'incident', label: 'Incident' },
  { id: 'rework', label: 'Rework' },
];

export class BalanceReportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BalanceReportError';
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BalanceReportError(`${label}のJSONを読み込めない: ${path} (${reason})`);
  }
}

function assertStringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new BalanceReportError(`${label}は空でない文字列配列でなければならない`);
  }
  if (value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new BalanceReportError(`${label}に空文字列または文字列以外がある`);
  }
  if (new Set(value).size !== value.length) {
    throw new BalanceReportError(`${label}に重複がある`);
  }
  return [...value];
}

function sameSet(left, right) {
  return (
    left.length === right.length &&
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.every((entry) => right.includes(entry))
  );
}

function normalizeCohort(cohort, label) {
  if (!isObject(cohort)) {
    throw new BalanceReportError(`${label}にコホート情報がない`);
  }
  const normalized = {
    difficulties: assertStringList(cohort.difficulties, `${label}.difficulties`),
    policies: assertStringList(cohort.policies, `${label}.policies`),
    seeds: assertStringList(cohort.seeds, `${label}.seeds`),
    meta: cohort.meta,
    counterfactual: cohort.counterfactual ?? false,
    counterfactualPolicies: cohort.counterfactualPolicies ?? [],
    isDefault: cohort.isDefault === true,
  };
  if (normalized.meta !== 'fresh' && normalized.meta !== 'full') {
    throw new BalanceReportError(`${label}.metaはfreshまたはfullでなければならない`);
  }
  if (typeof normalized.counterfactual !== 'boolean') {
    throw new BalanceReportError(`${label}.counterfactualはbooleanでなければならない`);
  }
  normalized.counterfactualPolicies = assertStringList(
    normalized.counterfactualPolicies,
    `${label}.counterfactualPolicies`,
    { allowEmpty: true },
  );
  if (!normalized.counterfactual && normalized.counterfactualPolicies.length > 0) {
    throw new BalanceReportError(
      `${label}.counterfactualPoliciesはcounterfactual=falseでは空でなければならない`,
    );
  }
  return normalized;
}

function expectedRunKeys(cohort) {
  const keys = [];
  for (const difficulty of cohort.difficulties) {
    for (const policy of cohort.policies) {
      for (const seed of cohort.seeds) {
        keys.push(`${cohort.meta}|${difficulty}|${policy}|${seed}`);
      }
    }
  }
  return keys;
}

function runKey(run, meta) {
  if (!isObject(run)) throw new BalanceReportError('ラン記録がオブジェクトではない');
  const runMeta = run.meta ?? meta;
  if (
    typeof runMeta !== 'string' ||
    typeof run.difficulty !== 'string' ||
    typeof run.policy !== 'string' ||
    typeof run.seed !== 'string'
  ) {
    throw new BalanceReportError('ラン記録のmeta/difficulty/policy/seedが不正');
  }
  return `${runMeta}|${run.difficulty}|${run.policy}|${run.seed}`;
}

function indexRuns(runs, cohort, label) {
  if (!Array.isArray(runs)) {
    throw new BalanceReportError(`${label}.runsが配列ではない`);
  }
  const expected = new Set(expectedRunKeys(cohort));
  const indexed = new Map();
  for (const run of runs) {
    const key = runKey(run, cohort.meta);
    if (!expected.has(key)) {
      throw new BalanceReportError(`${label}にコホート外のランがある: ${key}`);
    }
    if (indexed.has(key)) {
      throw new BalanceReportError(`${label}に重複ランがある: ${key}`);
    }
    if (run.status !== 'won' && run.status !== 'lost') {
      throw new BalanceReportError(`${label}に未終端ランがある: ${key}`);
    }
    indexed.set(key, run);
  }
  return {
    runs,
    indexed,
    missing: [...expected].filter((key) => !indexed.has(key)),
  };
}

function normalizeRegistry(registry, label) {
  if (!isObject(registry) || !Array.isArray(registry.values) || !isObject(registry.sequences)) {
    throw new BalanceReportError(`${label}.registryが不正`);
  }
  const values = registry.values.map((entry) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !Number.isFinite(entry.value)) {
      throw new BalanceReportError(`${label}.registry.valuesに不正な値がある`);
    }
    return { id: entry.id, value: entry.value };
  });
  if (new Set(values.map((entry) => entry.id)).size !== values.length) {
    throw new BalanceReportError(`${label}.registry.valuesに重複IDがある`);
  }
  const sequences = {};
  for (const [id, sequence] of Object.entries(registry.sequences)) {
    sequences[id] = assertStringList(sequence, `${label}.registry.sequences.${id}`, {
      allowEmpty: true,
    });
  }
  return { values, sequences };
}

function normalizeParameters(parameters, label) {
  if (!Array.isArray(parameters)) {
    throw new BalanceReportError(`${label}.parametersが配列ではない`);
  }
  const normalized = parameters.map((entry) => {
    if (
      !isObject(entry) ||
      typeof entry.id !== 'string' ||
      !Number.isFinite(entry.value) ||
      typeof entry.unit !== 'string' ||
      !Array.isArray(entry.tags) ||
      entry.tags.some((tag) => typeof tag !== 'string')
    ) {
      throw new BalanceReportError(`${label}.parametersに不正な値がある`);
    }
    return { id: entry.id, value: entry.value, unit: entry.unit, tags: [...entry.tags] };
  });
  if (new Set(normalized.map((entry) => entry.id)).size !== normalized.length) {
    throw new BalanceReportError(`${label}.parametersに重複IDがある`);
  }
  return normalized;
}

function normalizeCatalog(catalog, label) {
  if (!isObject(catalog)) {
    throw new BalanceReportError(`${label}.catalogが不正`);
  }
  try {
    const serialized = JSON.stringify(catalog);
    if (serialized === undefined) throw new Error('JSON化できない');
    return JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new BalanceReportError(`${label}.catalogがJSON化できない: ${reason}`);
  }
}

function validateRuleset(ruleset, label) {
  if (!isObject(ruleset)) throw new BalanceReportError(`${label}.rulesetがない`);
  if (!Number.isInteger(ruleset.version) || ruleset.version < 1) {
    throw new BalanceReportError(`${label}.ruleset.versionが不正`);
  }
  if (typeof ruleset.fingerprint !== 'string' || !/^[0-9a-f]{64}$/i.test(ruleset.fingerprint)) {
    throw new BalanceReportError(`${label}.ruleset.fingerprintが不正`);
  }
  if (!Number.isInteger(ruleset.fingerprintScheme) || ruleset.fingerprintScheme < 1) {
    throw new BalanceReportError(`${label}.ruleset.fingerprintSchemeが不正`);
  }
  if (
    typeof ruleset.catalogFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(ruleset.catalogFingerprint)
  ) {
    throw new BalanceReportError(`${label}.ruleset.catalogFingerprintが不正`);
  }
  return {
    version: ruleset.version,
    fingerprint: ruleset.fingerprint,
    fingerprintScheme: ruleset.fingerprintScheme,
    registry: normalizeRegistry(ruleset.registry, `${label}.ruleset`),
    parameters: normalizeParameters(ruleset.parameters, `${label}.ruleset`),
    catalog: normalizeCatalog(ruleset.catalog, `${label}.ruleset`),
    catalogFingerprint: ruleset.catalogFingerprint,
  };
}

async function rulesetFromRoot(root, label) {
  if (!root) return null;
  const server = await createServer({ root: resolve(root), appType: 'custom', logLevel: 'error' });
  try {
    const balance = await server.ssrLoadModule('/src/data/balance/index.ts');
    const registry = balance.projectBalanceRegistry(balance.BALANCE_REGISTRY);
    const runtimeIds = new Set(registry.values.map((entry) => entry.id));
    const parameters = balance
      .flattenBalanceEntries(balance.BALANCE_REGISTRY)
      .filter((entry) => runtimeIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        value: entry.value,
        unit: entry.unit,
        tags: [...entry.tags],
      }));
    const catalog = balance.CONTENT_CATALOG;
    return validateRuleset(
      {
        version: balance.BALANCE_RULESET_VERSION,
        fingerprint: balance.BALANCE_RULESET_FINGERPRINT,
        fingerprintScheme: balance.BALANCE_RULESET_FINGERPRINT_SCHEME,
        registry,
        parameters,
        catalog,
        catalogFingerprint: balance.sha256Hex(balance.canonicalizeJson(catalog)),
      },
      `${label} root`,
    );
  } catch (error) {
    if (error instanceof BalanceReportError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new BalanceReportError(`${label} rootからルールセットを読めない: ${reason}`);
  } finally {
    await server.close();
  }
}

function mergeRuleset(recorded, fallback, label) {
  if (recorded && fallback) {
    for (const field of ['version', 'fingerprint', 'fingerprintScheme', 'catalogFingerprint']) {
      if (recorded[field] !== undefined && recorded[field] !== fallback[field]) {
        throw new BalanceReportError(`${label}の記録ルールセットとrootのルールセットが不一致`);
      }
    }
  }
  return validateRuleset(
    {
      ...(fallback ?? {}),
      ...(recorded ?? {}),
      registry: recorded?.registry ?? fallback?.registry,
      parameters: recorded?.parameters ?? fallback?.parameters,
      catalog: recorded?.catalog ?? fallback?.catalog,
      catalogFingerprint: recorded?.catalogFingerprint ?? fallback?.catalogFingerprint,
    },
    label,
  );
}

/** 出力JSONを比較用の検証済み測定へ正規化する。 */
export async function loadMeasurement(path, label, root) {
  const raw = readJson(path, label);
  if (Array.isArray(raw)) {
    throw new BalanceReportError(`${label}は旧配列形式で、コホート条件を復元できない`);
  }
  if (!isObject(raw)) throw new BalanceReportError(`${label}がオブジェクトではない`);
  if (raw.partial === true || raw.cohort?.partial === true) {
    throw new BalanceReportError(`${label}はpartialで、測定が完了していない`);
  }
  const cohort = normalizeCohort(raw.cohort, label);
  const indexed = indexRuns(raw.runs, cohort, label);
  const fallback = await rulesetFromRoot(root, label);
  const ruleset = mergeRuleset(raw.ruleset, fallback, label);
  return {
    path,
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : null,
    generation: typeof raw.generation === 'string' ? raw.generation : null,
    cohort,
    ruleset,
    ...indexed,
  };
}

function compareCohorts(before, after) {
  for (const field of ['difficulties', 'policies', 'seeds']) {
    if (!sameSet(before[field], after[field])) {
      throw new BalanceReportError(`変更前後のコホート.${field}が不一致`);
    }
  }
  for (const field of ['meta', 'counterfactual']) {
    if (before[field] !== after[field]) {
      throw new BalanceReportError(`変更前後のコホート.${field}が不一致`);
    }
  }
  if (!sameSet(before.counterfactualPolicies, after.counterfactualPolicies)) {
    throw new BalanceReportError('変更前後のコホート.counterfactualPoliciesが不一致');
  }
  return {
    difficulties: [...before.difficulties],
    policies: [...before.policies],
    seeds: [...before.seeds],
    meta: before.meta,
    counterfactual: before.counterfactual,
    counterfactualPolicies: [...before.counterfactualPolicies],
    isDefault: { before: before.isDefault, after: after.isDefault },
  };
}

function valueMap(registry) {
  return new Map(registry.values.map((entry) => [entry.id, entry.value]));
}

function parameterMap(parameters) {
  return new Map(parameters.map((entry) => [entry.id, entry]));
}

function relativeDelta(before, delta) {
  return before === null || before === 0 ? null : delta / before;
}

function diffRulesets(before, after) {
  const beforeValues = valueMap(before.registry);
  const afterValues = valueMap(after.registry);
  const beforeParameters = parameterMap(before.parameters);
  const afterParameters = parameterMap(after.parameters);
  const valueIds = [...new Set([...beforeValues.keys(), ...afterValues.keys()])].sort();
  const valueChanges = [];
  for (const id of valueIds) {
    const beforeValue = beforeValues.has(id) ? beforeValues.get(id) : null;
    const afterValue = afterValues.has(id) ? afterValues.get(id) : null;
    if (beforeValue === afterValue) continue;
    const parameter = afterParameters.get(id) ?? beforeParameters.get(id);
    const delta = beforeValue === null || afterValue === null ? null : afterValue - beforeValue;
    valueChanges.push({
      kind: 'value',
      id,
      unit: parameter?.unit ?? null,
      tags: parameter?.tags ?? [],
      before: beforeValue,
      after: afterValue,
      delta,
      relativeDelta: relativeDelta(beforeValue, delta),
    });
  }

  const sequenceIds = [
    ...new Set([
      ...Object.keys(before.registry.sequences),
      ...Object.keys(after.registry.sequences),
    ]),
  ].sort();
  const sequenceChanges = [];
  for (const id of sequenceIds) {
    const beforeSequence = before.registry.sequences[id] ?? null;
    const afterSequence = after.registry.sequences[id] ?? null;
    if (JSON.stringify(beforeSequence) === JSON.stringify(afterSequence)) continue;
    sequenceChanges.push({
      kind: 'sequence',
      id,
      unit: null,
      tags: [],
      before: beforeSequence,
      after: afterSequence,
      delta: null,
      relativeDelta: null,
    });
  }

  const catalogChanged = before.catalogFingerprint !== after.catalogFingerprint;
  const catalogChanges = catalogChanged
    ? [
        {
          kind: 'catalog',
          id: 'contentCatalog',
          unit: 'projection-sha256',
          tags: ['content', 'fingerprint-input'],
          before: before.catalogFingerprint,
          after: after.catalogFingerprint,
          delta: null,
          relativeDelta: null,
        },
      ]
    : [];

  return {
    before: {
      version: before.version,
      fingerprint: before.fingerprint,
      fingerprintScheme: before.fingerprintScheme,
      catalogFingerprint: before.catalogFingerprint,
    },
    after: {
      version: after.version,
      fingerprint: after.fingerprint,
      fingerprintScheme: after.fingerprintScheme,
      catalogFingerprint: after.catalogFingerprint,
    },
    fingerprintChanged: before.fingerprint !== after.fingerprint,
    versionChanged: before.version !== after.version,
    catalogChanged,
    catalogChanges,
    sequenceChanges,
    valueChanges,
    changes: [...valueChanges, ...sequenceChanges, ...catalogChanges],
  };
}

function metricValue(run, metric) {
  const totals = isObject(run.totals) ? run.totals : {};
  const values = {
    delivery: totals.delivered ?? run.totalDelivered,
    incident: totals.incidents,
    rework: totals.rework,
  };
  const value = values[metric.id];
  if (!Number.isFinite(value)) {
    throw new BalanceReportError(
      `ラン ${run.seed}/${run.policy}/${run.difficulty} の${metric.label}が数値ではない`,
    );
  }
  return value;
}

/** ラン集合から勝率と結果分布を作る。既存playtestの合否判定は呼び出さない。 */
export function summarizeRuns(runs) {
  const wins = runs.filter((run) => run.status === 'won').length;
  const metrics = {};
  for (const metric of METRICS) {
    metrics[metric.id] = summarizeNumeric(runs.map((run) => metricValue(run, metric)));
  }
  return {
    n: runs.length,
    wins,
    losses: runs.length - wins,
    winRate: runs.length === 0 ? null : wins / runs.length,
    metrics,
  };
}

function difference(before, after) {
  if (before === null || after === null) return null;
  return after - before;
}

function distributionDifference(before, after) {
  return {
    n: { before: before.n, after: after.n, delta: after.n - before.n },
    mean: difference(before.mean, after.mean),
    p10: difference(before.p10, after.p10),
    p50: difference(before.p50, after.p50),
    p90: difference(before.p90, after.p90),
  };
}

function metricCountDelta(value) {
  return isObject(value) && Number.isFinite(value.delta) ? value.delta : value;
}

function compareSummary(beforeRuns, afterRuns) {
  const before = summarizeRuns(beforeRuns);
  const after = summarizeRuns(afterRuns);
  const metrics = {};
  for (const metric of METRICS) {
    metrics[metric.id] = {
      before: before.metrics[metric.id],
      after: after.metrics[metric.id],
      delta: distributionDifference(before.metrics[metric.id], after.metrics[metric.id]),
    };
  }
  return {
    n: { before: before.n, after: after.n, delta: after.n - before.n },
    wins: { before: before.wins, after: after.wins, delta: after.wins - before.wins },
    losses: { before: before.losses, after: after.losses, delta: after.losses - before.losses },
    winRate: {
      before: before.winRate,
      after: after.winRate,
      delta: difference(before.winRate, after.winRate),
    },
    metrics,
  };
}

function observedDelta(summary) {
  return {
    winRate: summary.winRate.delta,
    delivery: summary.metrics.delivery.delta,
    incident: summary.metrics.incident.delta,
    rework: summary.metrics.rework.delta,
  };
}

/** 2つの検証済み測定を比較し、JSON出力用の構造を返す。 */
export function compareMeasurements(before, after) {
  const cohort = compareCohorts(before.cohort, after.cohort);
  const expected = expectedRunKeys(before.cohort);
  const pairedKeys = expected.filter((key) => before.indexed.has(key) && after.indexed.has(key));
  const beforeRuns = pairedKeys.map((key) => before.indexed.get(key));
  const afterRuns = pairedKeys.map((key) => after.indexed.get(key));
  const pairs = pairedKeys.map((key, index) => ({
    key,
    before: beforeRuns[index],
    after: afterRuns[index],
  }));

  const overall = compareSummary(beforeRuns, afterRuns);
  const cells = [];
  for (const difficulty of before.cohort.difficulties) {
    for (const policy of before.cohort.policies) {
      const cell = pairs.filter(
        ({ before: run }) => run.difficulty === difficulty && run.policy === policy,
      );
      cells.push({
        difficulty,
        policy,
        result: compareSummary(
          cell.map(({ before: run }) => run),
          cell.map(({ after: run }) => run),
        ),
      });
    }
  }

  const configuration = diffRulesets(before.ruleset, after.ruleset);
  const interpretation =
    configuration.changes.length > 1
      ? '複数の設定変更が同時に含まれるため、感度は因果分離されていない観測値である。'
      : '感度は同一seedペアで観測した差分であり、因果を保証する係数ではない。';
  const sensitivity = configuration.changes.map((change) => ({
    ...change,
    observedDelta: observedDelta(overall),
  }));

  const sample = {
    expected: expected.length,
    before: before.runs.length,
    after: after.runs.length,
    paired: pairedKeys.length,
    missingBefore: before.missing,
    missingAfter: after.missing,
    complete: before.missing.length === 0 && after.missing.length === 0,
  };

  return {
    schemaVersion: BALANCE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    comparison: {
      before: {
        path: before.path,
        generatedAt: before.generatedAt,
        generation: before.generation,
        ruleset: before.ruleset,
      },
      after: {
        path: after.path,
        generatedAt: after.generatedAt,
        generation: after.generation,
        ruleset: after.ruleset,
      },
    },
    cohort,
    sample,
    configuration,
    results: { overall, cells },
    sensitivity: { interpretation, changes: sensitivity },
  };
}

function display(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (typeof value === 'number') return String(Math.round(value * 10_000) / 10_000);
  if (Array.isArray(value)) return displayList(value);
  if (typeof value === 'object') {
    throw new BalanceReportError('Markdownにオブジェクトを埋め込めない');
  }
  return String(value);
}

function displayPercent(value) {
  return value === null || value === undefined ? '—' : `${display(value * 100)}%`;
}

function displayList(values) {
  return values.length === 0 ? '—' : values.join(', ');
}

function renderRulesetTable(report) {
  const rows = ['| | generation | version | fingerprint |', '| --- | --- | ---: | --- |'];
  for (const side of ['before', 'after']) {
    const entry = report.comparison[side];
    rows.push(
      `| ${side} | ${display(entry.generation)} | ${entry.ruleset.version} | \`${entry.ruleset.fingerprint}\` |`,
    );
  }
  return rows.join('\n');
}

function renderSummaryTable(result) {
  const lines = [
    '| 指標 | before | after | 差分 |',
    '| --- | ---: | ---: | ---: |',
    `| n | ${display(result.n.before)} | ${display(result.n.after)} | ${display(result.n.delta)} |`,
    `| 勝率 | ${displayPercent(result.winRate.before)} | ${displayPercent(result.winRate.after)} | ${displayPercent(result.winRate.delta)} |`,
  ];
  for (const metric of METRICS) {
    const summary = result.metrics[metric.id];
    lines.push(
      `| ${metric.label} n | ${display(summary.before.n)} | ${display(summary.after.n)} | ${display(metricCountDelta(summary.delta.n))} |`,
      `| ${metric.label} 平均 | ${display(summary.before.mean)} | ${display(summary.after.mean)} | ${display(summary.delta.mean)} |`,
      `| ${metric.label} p10 | ${display(summary.before.p10)} | ${display(summary.after.p10)} | ${display(summary.delta.p10)} |`,
      `| ${metric.label} p50 | ${display(summary.before.p50)} | ${display(summary.after.p50)} | ${display(summary.delta.p50)} |`,
      `| ${metric.label} p90 | ${display(summary.before.p90)} | ${display(summary.after.p90)} | ${display(summary.delta.p90)} |`,
    );
  }
  return lines.join('\n');
}

/** 比較結果をレビュー用Markdownへ変換する。 */
export function renderMarkdown(report) {
  const lines = [
    '# バランス差分レポート',
    '',
    `生成日時: ${report.generatedAt}`,
    '',
    '## 比較対象',
    '',
    renderRulesetTable(report),
    '',
    `- ルールセット指紋変更: ${report.configuration.fingerprintChanged ? 'あり' : 'なし'}`,
    `- 世代: ${display(report.comparison.before.generation)} → ${display(report.comparison.after.generation)}`,
    '',
    '## コホート',
    '',
    `- 難易度: ${displayList(report.cohort.difficulties)}`,
    `- 方針: ${displayList(report.cohort.policies)}`,
    `- seed: ${report.cohort.seeds.length}件（${displayList(report.cohort.seeds)}）`,
    `- meta: ${report.cohort.meta}`,
    `- 反実仮想: ${report.cohort.counterfactual ? `有効（${displayList(report.cohort.counterfactualPolicies)}）` : '無効'}`,
    '',
    '## サンプル',
    '',
    `- 期待 ${report.sample.expected} / before ${report.sample.before} / after ${report.sample.after} / ペア ${report.sample.paired}`,
    `- 完全: ${report.sample.complete ? 'はい' : 'いいえ'}`,
    `- before欠損: ${displayList(report.sample.missingBefore)}`,
    `- after欠損: ${displayList(report.sample.missingAfter)}`,
    '',
    '## 設定値の差分',
    '',
    '| 種別 | ID | before | after | 差分 | 相対差分 | 単位 | タグ |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  if (report.configuration.changes.length === 0) {
    lines.push('| — | — | — | — | — | — | — | 変更なし |');
  } else {
    for (const change of report.configuration.changes) {
      lines.push(
        `| ${change.kind} | \`${change.id}\` | ${display(change.before)} | ${display(change.after)} | ${display(change.delta)} | ${display(change.relativeDelta)} | ${display(change.unit)} | ${displayList(change.tags)} |`,
      );
    }
  }
  lines.push(
    '',
    '## 結果分布の差分',
    '',
    '### 全体',
    '',
    renderSummaryTable(report.results.overall),
    '',
  );
  lines.push('### 難易度 × 方針', '');
  for (const cell of report.results.cells) {
    lines.push(`#### ${cell.difficulty} × ${cell.policy}`, '', renderSummaryTable(cell.result), '');
  }
  lines.push(
    '',
    '## 感度（観測値）',
    '',
    `- ${report.sensitivity.interpretation}`,
    '',
    '| ID | 値の相対差分 | 勝率差分 | Delivery平均差分 | Incident平均差分 | Rework平均差分 |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  );
  if (report.sensitivity.changes.length === 0) {
    lines.push('| — | — | — | — | — | — |');
  } else {
    for (const change of report.sensitivity.changes) {
      lines.push(
        `| \`${change.id}\` | ${display(change.relativeDelta)} | ${displayPercent(change.observedDelta.winRate)} | ${display(change.observedDelta.delivery.mean)} | ${display(change.observedDelta.incident.mean)} | ${display(change.observedDelta.rework.mean)} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

export function writeReport(report, outDir) {
  const directory = resolve(outDir);
  mkdirSync(directory, { recursive: true });
  const jsonPath = resolve(directory, 'balance-report.json');
  const markdownPath = resolve(directory, 'balance-report.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}

export function parseArgs(argv) {
  const options = { out_dir: DEFAULT_BALANCE_REPORT_DIR, help: false };
  const valueOptions = new Set(['before', 'after', 'before-root', 'after-root', 'out-dir']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (!argument.startsWith('--')) throw new BalanceReportError(`未知の引数: ${argument}`);
    const name = argument.slice(2);
    if (!valueOptions.has(name)) throw new BalanceReportError(`未知のオプション: --${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new BalanceReportError(`値がない: --${name}`);
    options[name.replaceAll('-', '_')] = value;
    index += 1;
  }
  if (!options.help && (!options.before || !options.after)) {
    throw new BalanceReportError('--beforeと--afterは必須');
  }
  return options;
}

function usage() {
  return [
    'Usage: npm run balance:report -- --before <runs.json> --after <runs.json> [options]',
    '',
    'Options:',
    '  --before-root <dir>  before側のソースroot（旧出力のルールセット補完用）',
    '  --after-root <dir>   after側のソースroot（旧出力のルールセット補完用）',
    `  --out-dir <dir>      出力先（既定: ${DEFAULT_BALANCE_REPORT_DIR}）`,
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const before = await loadMeasurement(options.before, 'before', options.before_root);
  const after = await loadMeasurement(options.after, 'after', options.after_root);
  const report = compareMeasurements(before, after);
  const paths = writeReport(report, options.out_dir);
  console.log(`JSON: ${paths.jsonPath}`);
  console.log(`Markdown: ${paths.markdownPath}`);
  if (!report.sample.complete) {
    process.exitCode = 1;
    console.error('欠損ランがあるため、比較レポートは未完了です。');
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
