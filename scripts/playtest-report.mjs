/**
 * `npm run playtest` の出力を SPEC 第19.1 の判定基準ごとに集計する。
 *
 *   node scripts/playtest-report.mjs [runs.json]
 *
 * 集計方針:
 * - 母数は `(難易度, 方針, seed)` で重複排除する（同一条件は決定論により必ず一致するため）。
 * - 出荷の散らばりは、ラン長の差が混入しないよう**1スプリントあたり出荷**と
 *   **全方針が到達する固定区間（第1四半期の最初の N スプリント）**の両方で見る。
 * - 介入は「発動した回数」と「発動できなかった理由（対象なし / 集中力 / クールダウン）」を分けて出す。
 * - `trustExhausted` は `missed_crisis` の別名なので、発火条件（信頼 / 予算 / KPI未達件数）へ分解する。
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'playtest-out/runs.json';
const raw = JSON.parse(readFileSync(file, 'utf8'));

/** MS_PER_TICK_1X（src/ui/sprintTempo.ts）。 */
const MS_PER_TICK_1X = 680;
const sec = (ticks) => (ticks * MS_PER_TICK_1X) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');
const quantile = (arr, p) => {
  if (!arr.length) return NaN;
  const b = [...arr].sort((x, y) => x - y);
  return b[Math.round((b.length - 1) * p)];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const cv = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  if (!m) return 0;
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m;
};

// --- 母数（重複排除） -------------------------------------------------------
const byKey = new Map();
for (const run of raw) {
  byKey.set(`${run.difficulty}|${run.policy}|${run.seed}`, run);
}
const runs = [...byKey.values()];
console.log(`## 母数\n`);
console.log(`延べ実行 ${raw.length} / ユニーク ${runs.length} / 重複 ${raw.length - runs.length}`);
const policiesPerDiff = new Map();
for (const run of runs) {
  if (!policiesPerDiff.has(run.difficulty)) policiesPerDiff.set(run.difficulty, new Set());
  policiesPerDiff.get(run.difficulty).add(run.policy);
}
for (const [d, set] of policiesPerDiff) {
  console.log(
    `- ${d}: ${set.size}方針 × ${runs.filter((r) => r.difficulty === d).length / set.size}seed`,
  );
}

const group = (keyFn) => {
  const m = new Map();
  for (const run of runs) {
    const k = keyFn(run);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(run);
  }
  return m;
};

// --- F-7 勝率 ---------------------------------------------------------------
console.log(`\n## F-7 難易度 × 方針の勝率\n`);
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const won = arr.filter((r) => r.status === 'won').length;
  console.log(`${k}: ${won}/${arr.length} (${pct(won, arr.length)})`);
}

// --- F-4 ペーシング ---------------------------------------------------------
console.log(`\n## F-4 スプリント長（1x 換算・秒）\n`);
for (const [d, arr] of group((r) => r.difficulty)) {
  for (const kind of ['normal', 'boss']) {
    const xs = arr
      .flatMap((r) => r.sprints.filter((s) => s.kind === kind))
      .map((s) => sec(s.ticks));
    if (!xs.length) continue;
    const under30 = xs.filter((x) => x < 30).length;
    const under60 = xs.filter((x) => x < 60).length;
    console.log(
      `${d}/${kind}: n=${xs.length} p10=${r1(quantile(xs, 0.1))} p50=${r1(quantile(xs, 0.5))} p90=${r1(quantile(xs, 0.9))} <30s=${pct(under30, xs.length)} <60s=${pct(under60, xs.length)}`,
    );
  }
}

// --- F-4 / RI-77 介入の発動と、できなかった理由 -----------------------------
console.log(`\n## RI-77 介入の発動回数と、発動できなかった理由\n`);
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const sprints = arr.flatMap((r) => r.sprints);
  if (!sprints.length) continue;
  const used = sprints.map((s) => s.interventions);
  const totals = {};
  for (const s of sprints) {
    for (const [id, byReason] of Object.entries(s.attempts ?? {})) {
      for (const [reason, n] of Object.entries(byReason)) {
        totals[reason] = (totals[reason] ?? 0) + n;
        totals[`${id}:${reason}`] = (totals[`${id}:${reason}`] ?? 0) + n;
      }
    }
  }
  const summary = ['ok', 'no-target', 'no-focus', 'cooldown']
    .map((x) => `${x}=${totals[x] ?? 0}`)
    .join(' ');
  console.log(
    `${k}: 成立 p50=${quantile(used, 0.5)} p90=${quantile(used, 0.9)} 平均=${r1(mean(used))} | 試行内訳 ${summary} | focus残 平均=${r1(mean(sprints.map((s) => s.focusRemaining)))}/${r1(mean(sprints.map((s) => s.focusMax)))}`,
  );
}

// --- F-5 分散（ラン長を揃える） --------------------------------------------
console.log(`\n## F-5 出荷の散らばり（ラン長の差を除く）\n`);
const FIXED_WINDOW = 3; // 全方針が到達する第1四半期の先頭スプリント数
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const perSprint = arr.flatMap((r) => r.sprints.map((s) => s.delivered));
  const windowed = arr
    .filter((r) => r.sprints.length >= FIXED_WINDOW)
    .map((r) => r.sprints.slice(0, FIXED_WINDOW).reduce((a, s) => a + s.delivered, 0));
  console.log(
    `${k}: 1スプリント出荷 平均=${r1(mean(perSprint))} CV=${pct(cv(perSprint), 1)} | 先頭${FIXED_WINDOW}スプリント累計 n=${windowed.length} 平均=${r1(mean(windowed))} CV=${pct(cv(windowed), 1)} | 累計出荷CV=${pct(cv(arr.map((r) => r.totalDelivered)), 1)}`,
  );
}

// --- F-10 勝利種別 ----------------------------------------------------------
console.log(`\n## F-10 勝利種別 / 組織診断\n`);
const winTypes = {};
const diagnoses = {};
for (const run of runs) {
  if (run.winType) winTypes[run.winType] = (winTypes[run.winType] ?? 0) + 1;
  diagnoses[run.diagnosis] = (diagnoses[run.diagnosis] ?? 0) + 1;
}
console.log('勝利種別:', JSON.stringify(winTypes));
console.log('組織診断:', JSON.stringify(diagnoses));

// --- F-9 敗因ごとの手触り ---------------------------------------------------
console.log(`\n## F-9 敗因ごとの進行と予兆\n`);
const loseGroups = group((r) => r.loseReason ?? '');
for (const [reason, arr] of loseGroups) {
  if (!reason) continue;
  const sprintsToLose = arr.map((r) => r.sprints.length);
  const prev = arr.filter((r) => r.sprints.length >= 2).map((r) => r.sprints[r.sprints.length - 2]);
  const last = arr.filter((r) => r.sprints.length >= 1).map((r) => r.sprints[r.sprints.length - 1]);
  const fmt = (xs, f) => (xs.length ? r1(mean(xs.map(f))) : '—');
  console.log(
    `${reason}: n=${arr.length} 敗北までのスプリント数 p50=${quantile(sprintsToLose, 0.5)} | 1つ前 hp=${fmt(prev, (s) => s.seniorHpAfter)} morale=${fmt(prev, (s) => s.moraleAfter)} debt=${fmt(prev, (s) => s.techDebtAfter)} budget=${fmt(prev, (s) => s.budgetAfter)} rq=${fmt(prev, (s) => s.reviewQueueMax)} | 最終 hp=${fmt(last, (s) => s.seniorHpAfter)} budget=${fmt(last, (s) => s.budgetAfter)}`,
  );
}

// --- RI-78 trustExhausted の発火要因分解 ------------------------------------
console.log(`\n## RI-78 四半期 outcome の発火要因（missed_crisis / reorg_required）\n`);
const triggerCounts = {};
const outcomeCounts = {};
for (const run of runs) {
  for (const q of run.quarters ?? []) {
    outcomeCounts[q.outcome] = (outcomeCounts[q.outcome] ?? 0) + 1;
    if (q.outcome !== 'missed_crisis') continue;
    const key = q.crisisTriggers.length ? q.crisisTriggers.join('+') : 'none';
    triggerCounts[key] = (triggerCounts[key] ?? 0) + 1;
  }
}
console.log('四半期 outcome:', JSON.stringify(outcomeCounts));
console.log('missed_crisis の発火条件:', JSON.stringify(triggerCounts));

// --- F-2 第4層: 目標修正の選択別の後続 --------------------------------------
console.log(`\n## F-2 第4層 目標修正\n`);
const withAdj = runs.filter((r) => r.goalAdjustments.length > 0);
console.log(
  `目標修正を1回以上経験: ${withAdj.length}/${runs.length} (${pct(withAdj.length, runs.length)})`,
);
const adjFirst = group((r) => r.goalAdjustments[0] ?? '');
for (const [adj, arr] of adjFirst) {
  if (!adj) continue;
  const won = arr.filter((r) => r.status === 'won').length;
  console.log(
    `初回選択=${adj}: n=${arr.length} 勝率=${pct(won, arr.length)} 到達四半期 平均=${r1(mean(arr.map((r) => r.quarterNumber)))} 総スプリント 平均=${r1(mean(arr.map((r) => r.sprintsPlayed)))}`,
  );
}

// --- F-6 評価分布 -----------------------------------------------------------
console.log(`\n## F-6 スプリント評価の分布\n`);
const grades = {};
let gradeTotal = 0;
for (const run of runs) {
  for (const s of run.sprints) {
    if (!s.grade) continue;
    grades[s.grade] = (grades[s.grade] ?? 0) + 1;
    gradeTotal += 1;
  }
}
console.log(
  `n=${gradeTotal}`,
  Object.entries(grades)
    .sort()
    .map(([g, n]) => `${g}=${n}(${pct(n, gradeTotal)})`)
    .join(' '),
);
const passiveGrades = {};
for (const run of runs.filter((r) => r.policy === 'passive')) {
  for (const s of run.sprints) passiveGrades[s.grade] = (passiveGrades[s.grade] ?? 0) + 1;
}
console.log('無介入(passive)のみ:', JSON.stringify(passiveGrades));

// --- AI 依存度 --------------------------------------------------------------
console.log(`\n## RI-73 / RI-76 AI 依存度と利用率\n`);
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const sprints = arr.flatMap((r) => r.sprints);
  if (!sprints.length) continue;
  console.log(
    `${k}: 最終AI依存度 平均=${r1(mean(arr.map((r) => r.finalOrg.aiDependency)))} AI利用率 平均=${r1(mean(sprints.map((s) => s.aiPct)))}`,
  );
}
