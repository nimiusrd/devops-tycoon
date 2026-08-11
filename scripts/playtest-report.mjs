/**
 * `npm run playtest` の出力を SPEC 第19.1 の判定基準ごとに集計する。
 *
 *   node scripts/playtest-report.mjs [runs.json]
 *
 * 集計方針:
 * - 母数は `(メタ解放, 難易度, 方針, seed)` で重複排除する。`PT_META` が違えばドラフト候補が
 *   変わり同一条件ではないため、キーに含めないと片方が静かに消える。
 * - 出荷の散らばりは**同一スプリント番号ごと**に比較する。全スプリントを連結した CV は、
 *   長く生存したランほど標本を多く出し進行段階も混ざるため、ラン長の差が残る。
 * - 介入は「発動した回数」と「発動できなかった理由（対象なし / 集中力 / クールダウン）」を分けて出す。
 * - `trustExhausted` は `missed_crisis` と `shutdown` の両方から作られるので、
 *   それぞれの発火条件へ分解する。
 */
import { readFileSync } from 'node:fs';
import { generationMismatch } from './playtest-generation.mjs';

/**
 * 集計対象。`PT_OUT` と第1引数で差し替えられる（`scripts/check-findings.mjs` と同じ規則）。
 *
 * `PT_OUT=/tmp/runs.json npm run playtest` は正式にサポートした使い方なので、続けて
 * `PT_OUT=... npm run playtest:report` を流したときに既定ファイルだけを読むと、
 * 既定が無ければ失敗し、前回の既定ファイルが残っていれば**今回ではなく古い測定**を集計する。
 */
const file = process.argv[2] ?? process.env.PT_OUT ?? 'playtest-out/runs.json';
const loaded = JSON.parse(readFileSync(file, 'utf8'));
/**
 * 出力は `{ generatedAt, cohort, runs }`。配列だけの旧形式も読めるようにしておく
 * （手元に残った古い出力を渡したときに黙って0件集計にならないように）。
 */
const raw = Array.isArray(loaded) ? loaded : loaded.runs;
const cohort = Array.isArray(loaded) ? null : loaded.cohort;

/**
 * 測定後にコードが変わっていたら**先頭で警告する**。
 *
 * このレポートは `src/ui/sprintTempo.ts` や `src/data/evolution.ts` の定数を実行時に読み直すので、
 * 旧ランと新定数を混ぜた集計になりうる。`playtest:check` と違って集計自体は続ける
 *（過去の出力を読み直す用途があるため）が、値をそのまま所見へ写さないよう明示する。
 */
const STALE = generationMismatch(loaded);

/**
 * テンポ換算は実装（`src/ui/sprintTempo.ts`）の定数から読む。
 * 複製するとゲーム側のテンポ調整に追随できず、秒換算と 30/60秒 判定だけが旧値のまま残る。
 */
function readMsPerTick1x() {
  const src = readFileSync('src/ui/sprintTempo.ts', 'utf8');
  const m = src.match(/export const MS_PER_TICK_1X\s*=\s*(\d+)/);
  if (!m) throw new Error('src/ui/sprintTempo.ts から MS_PER_TICK_1X を読み取れない');
  return Number(m[1]);
}
const MS_PER_TICK_1X = readMsPerTick1x();
const sec = (ticks) => (ticks * MS_PER_TICK_1X) / 1000;

/**
 * 進化ツリーの全ノード数を実装（`src/data/evolution.ts`）から読む。
 *
 * 観測されたログから推定してはいけない。`PT_POLICIES=idle` のような絞り込み実行では
 * 解放イベントが0件になり総数0（p50 が NaN）になるし、一部のノードしか出ない実行では
 * 総数を過小評価して「Q1 で取り切ったラン」を誤判定する。総数は入力ランに依存しない。
 */
function readEvolutionTree() {
  const src = readFileSync('src/data/evolution.ts', 'utf8');
  const body = src.split('export const EVOLUTION_NODES')[1];
  if (!body) throw new Error('src/data/evolution.ts から EVOLUTION_NODES を読み取れない');
  const nodes = (body.match(/^\s{4}id: '/gm) ?? []).length;
  const costs = [...body.matchAll(/^\s{4}cost: (\d+)/gm)].map((m) => Number(m[1]));
  if (nodes === 0 || costs.length === 0) {
    throw new Error('src/data/evolution.ts からノード数・コストを読み取れない');
  }
  return { nodes, totalCost: costs.reduce((a, b) => a + b, 0) };
}
const EVOLUTION_TREE = readEvolutionTree();

/**
 * 進化ポイント式の定数。`src/sim/run/constants.ts` と同期する（パース失敗時はここで落とす）。
 * RI-86: 分母 100 / ツリー総コスト 46 で Q1 全解放を防ぐ。
 */
function readEvoPointsFormula() {
  const src = readFileSync('src/sim/run/constants.ts', 'utf8');
  const base = Number(src.match(/EVO_POINTS_BASE = (\d+)/)?.[1]);
  const divisor = Number(src.match(/EVO_POINTS_DELIVERED_DIVISOR = (\d+)/)?.[1]);
  const elite = Number(src.match(/EVO_POINTS_ELITE_BONUS = (\d+)/)?.[1]);
  if (![base, divisor, elite].every((n) => Number.isFinite(n) && n > 0)) {
    throw new Error('src/sim/run/constants.ts から進化ポイント定数を読み取れない');
  }
  return { base, divisor, elite };
}
const EVO_POINTS = readEvoPointsFormula();

/**
 * 1スプリントで得る進化ポイント。`RunEngine.evoPointsFor` と同じ式。
 *
 * **ボススプリントは 0**。`resolveSprint()` のボス分岐は四半期レビューへ遷移して
 * `return` するため、通常スプリント用のポイント加算へ到達しない。含めると
 * 実際には得られないポイントを F-11 の「Q1 で入手する総ポイント」へ足してしまう。
 */
const evoPointsForSprint = (s) =>
  s.kind === 'boss'
    ? 0
    : EVO_POINTS.base +
      Math.floor((s.delivered ?? 0) / EVO_POINTS.divisor) +
      (s.kind === 'elite' ? EVO_POINTS.elite : 0);

/**
 * ランが Q1 中に**実際に入手した**進化ポイントの合計。
 *
 * `resolveSprint()` は結果を記録して `sprintsPlayed` を増やしたあとに敗北判定をし、
 * 敗北ならポイント加算の前に `return` する。つまりスプリント終了時に敗北したランの
 * 最後のスプリントはポイントを与えない。ログには結果が残っているので、除外しないと
 * 実際には得ていないぶんを足してしまう（とくに第1スプリント敗北の多い nightmare）。
 */
const q1EvoPoints = (r) => {
  const sprints = (r.sprints ?? []).filter((s) => s.completed !== false);
  const lostAtSprintEnd = r.lostPhase === 'sprint' && r.lostSprintCompleted !== false;
  const earning = lostAtSprintEnd ? sprints.slice(0, -1) : sprints;
  return earning.filter((s) => s.quarter === 1).reduce((a, s) => a + evoPointsForSprint(s), 0);
};
/** 完走スプリントだけを使う既存 KPI 用。未完走終端スプリントの計測値は別途 RI-78 で残す。 */
const isCompletedSprint = (s) => s.completed !== false;
const completedSprintsOf = (run) => (run.sprints ?? []).filter(isCompletedSprint);
const r1 = (n) => Math.round(n * 10) / 10;
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : '—');
const quantile = (arr, p) => {
  if (!arr.length) return NaN;
  const b = [...arr].sort((x, y) => x - y);
  return b[Math.round((b.length - 1) * p)];
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
/** 標本が2件未満なら分散を推定できない。0 を返すと「完全に安定」と誤読されるため NaN。 */
const cv = (a) => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  if (!m) return NaN;
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2))) / m;
};
const fmtCv = (a) => (Number.isNaN(cv(a)) ? '未計測' : pct(cv(a), 1));

// --- 母数（重複排除） -------------------------------------------------------
const byKey = new Map();
for (const run of raw) {
  byKey.set(`${run.meta ?? 'fresh'}|${run.difficulty}|${run.policy}|${run.seed}`, run);
}
const runs = [...byKey.values()];
const metaProfiles = [...new Set(runs.map((r) => r.meta ?? 'fresh'))];
console.log(`## 母数\n`);
if (STALE) console.log(`> **警告**: ${STALE}\n`);
console.log(`延べ実行 ${raw.length} / ユニーク ${runs.length} / 重複 ${raw.length - runs.length}`);
if (cohort) {
  console.log(
    `コホート: 難易度=${cohort.difficulties.join(',')} / seed=${cohort.seeds.length}件 / ` +
      `方針=${cohort.policies.length}件 / meta=${cohort.meta}` +
      (cohort.isDefault ? '' : '（**既定コホートではない。所見の数値と直接は比較できない**）'),
  );
} else {
  console.log('  ※ コホート情報の無い旧形式。どの条件で回した出力か確認できない。');
}
console.log(`メタ解放プロファイル: ${metaProfiles.join(', ')}`);
if (metaProfiles.length > 1) {
  console.log('  ※ 複数プロファイルが混在している。以下の全体集計はプロファイルを跨いだ値なので、');
  console.log('     条件別に見るときはプロファイルごとに分けて実行すること。');
}
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

/**
 * 固定標本の指標が使えるかを検査する。
 *
 * `PT_POLICIES` での絞り込み実行は正式にサポートしているので、代表方針が揃わない結果でも
 * レポートは動く。しかしそのまま「代表N方針（固定）」と表示して成立判定へ使うと、
 * 実際には1方針だけの値を固定標本と誤認する。欠けている方針を明示して未計測にする。
 */
const missingPolicies = (required) => required.filter((p) => !runs.some((r) => r.policy === p));
const sampleGuard = (label, required) => {
  const missing = missingPolicies(required);
  if (missing.length === 0) {
    console.log(`**${label}: ${required.join(' / ')}（固定）**`);
    return true;
  }
  console.log(
    `**${label}: 未計測** — 代表方針 ${missing.join(' / ')} がこの実行に含まれていない` +
      `（必要: ${required.join(' / ')}）。参考値のみ表示する。`,
  );
  return false;
};

// --- F-7 勝率 ---------------------------------------------------------------
console.log(`\n## F-7 難易度 × 方針の勝率\n`);
/**
 * F-7 の成立判定に使う方針。
 *
 * F-7 は「初見の初勝利が5ラン前後＝勝率20%前後」を見る基準なので、**初見相当の方針**で
 * 判定する。全方針の平均は使わない。`adj*` の統制群や `onlyXxx` のような実験用方針を
 * 足し引きするだけで、ゲームも初見プレイも変わっていないのに平均が動いてしまうためである
 * （実際 `skilledBase` の複製である `adj*` を7本足したときに easy の平均が動いた）。
 */
const FIRST_PLAY_POLICY = 'naive';
/**
 * F-7 は「初見の初勝利カーブ」なので、メタ解放も初見相当（`fresh`）に限る。
 * `PT_META=full` の結果を初見の勝率として出すと、全カード・レリック解放済みで
 * ドラフト候補も結果も変わった値を初勝利カーブと誤読する。
 */
const freshRuns = runs.filter((r) => (r.meta ?? 'fresh') === 'fresh');
console.log(`**成立判定に使う初見相当の方針: ${FIRST_PLAY_POLICY}（メタ解放 fresh のみ）**`);
// **`naive` のランがあるかまで見る。** `freshRuns` が空でないことだけを確認していると、
// `PT_POLICIES=skilledNoHire` のように `naive` だけを外した実行で未計測メッセージが出ず、
// 直後のループも何も出さないため「成立判定に使う方針: naive」という見出しだけが残り、
// F-7 を計測済みと誤認させる。
const firstPlayRuns = freshRuns.filter((r) => r.policy === FIRST_PLAY_POLICY);
if (freshRuns.length === 0) {
  console.log('  fresh のランが無いため F-7 は未計測（PT_META=fresh で実行すること）');
} else if (firstPlayRuns.length === 0) {
  console.log(
    `  ${FIRST_PLAY_POLICY} のランが無いため F-7 は未計測` +
      `（PT_POLICIES で ${FIRST_PLAY_POLICY} を含めて実行すること）`,
  );
}
for (const d of [...new Set(freshRuns.map((r) => r.difficulty))]) {
  const arr = freshRuns.filter((r) => r.difficulty === d && r.policy === FIRST_PLAY_POLICY);
  if (!arr.length) continue;
  const won = arr.filter((r) => r.status === 'won').length;
  console.log(`  ${d}/${FIRST_PLAY_POLICY}: ${won}/${arr.length} (${pct(won, arr.length)})`);
}
console.log('\n参考: 方針別の内訳（実験用統制群を含むため、これらの平均は成立判定に使わない）:');
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const won = arr.filter((r) => r.status === 'won').length;
  console.log(`${k}: ${won}/${arr.length} (${pct(won, arr.length)})`);
}

// --- F-4 ペーシング ---------------------------------------------------------
console.log(`\n## F-4 スプリント長（1x 換算・秒）\n`);
// SPEC 第3.1: 通常 60〜120秒（絶対下限30秒）、ボス 90〜180秒。
// elite（高負荷）は「スプリント1本」の目標が同じく必要なので通常帯で判定する。
/**
 * 規定帯は実装（`src/ui/sprintTempo.ts`）の `SPRINT_WALL_SEC` / `BOSS_WALL_SEC` から読む。
 * ここで複製すると、テンポ調整で共有定数を変えたとき秒換算だけが追随して帯判定が
 * 旧値のまま残り、正常を違反・違反を正常として報告してしまう。
 */
function readSprintBands() {
  const src = readFileSync('src/ui/sprintTempo.ts', 'utf8');
  const num = (constName, field) => {
    const m = src.match(
      new RegExp(`export const ${constName}\\s*=\\s*\\{[^}]*?\\b${field}:\\s*(\\d+)`, 's'),
    );
    if (!m) throw new Error(`src/ui/sprintTempo.ts から ${constName}.${field} を読み取れない`);
    return Number(m[1]);
  };
  const typical = {
    min: num('SPRINT_WALL_SEC', 'minTypical'),
    max: num('SPRINT_WALL_SEC', 'maxTypical'),
    absoluteMin: num('SPRINT_WALL_SEC', 'absoluteMin'),
  };
  return {
    normal: typical,
    // elite（高負荷）も「スプリント1本」の目標が同じく必要なので通常帯で判定する。
    elite: typical,
    boss: { min: num('BOSS_WALL_SEC', 'min'), max: num('BOSS_WALL_SEC', 'max') },
  };
}
const SPRINT_BANDS = readSprintBands();
/**
 * F-4 の成立判定に使う代表方針（固定）。
 *
 * 難易度内の全方針を連結すると、方針の構成と生存長がそのまま規定帯の割合の重みになる。
 * 同じ `skilledBase` の複製（`adj*` など）を足すだけでそのテンポが多重計上され、
 * 長く生存する方針ほど後半スプリントを多く供給するので、ゲームを変えていないのに
 * 「下回り97.6%」のような値が動いてしまう。標本を固定して方針数から独立させる。
 *
 * 初見・熟練・無介入の3点を採り、テンポの速い側と遅い側の両方を含める。
 */
const F4_SAMPLE_POLICIES = ['naive', 'skilledNoHire', 'noInterventionCtl'];
const pacingRows = (arr, kind) =>
  arr.flatMap((r) => completedSprintsOf(r).filter((s) => s.kind === kind)).map((s) => sec(s.ticks));
const printPacing = (label, xs, kind) => {
  const band = SPRINT_BANDS[kind];
  const below = xs.filter((x) => x < band.min).length;
  const above = xs.filter((x) => x > band.max).length;
  const p50v = quantile(xs, 0.5);
  const inBand = p50v >= band.min && p50v <= band.max;
  const absMin =
    band.absoluteMin === undefined
      ? ''
      : ` 絶対下限${band.absoluteMin}s未満=${pct(xs.filter((x) => x < band.absoluteMin).length, xs.length)}`;
  console.log(
    `${label}: n=${xs.length} p10=${r1(quantile(xs, 0.1))} p50=${r1(p50v)} p90=${r1(quantile(xs, 0.9))} | 規定${band.min}〜${band.max}s: p50 ${inBand ? '帯内' : '帯外'} 下回り=${pct(below, xs.length)} 上回り=${pct(above, xs.length)}${absMin}`,
  );
};
if (sampleGuard('成立判定に使う代表方針', F4_SAMPLE_POLICIES)) {
  for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
    const arr = runs.filter((r) => r.difficulty === d && F4_SAMPLE_POLICIES.includes(r.policy));
    for (const kind of ['normal', 'elite', 'boss']) {
      const xs = pacingRows(arr, kind);
      if (!xs.length) continue;
      printPacing(`  ${d}/${kind}`, xs, kind);
    }
  }
}
console.log('\n参考: 全方針を連結した値（方針構成に依存するため成立判定に使わない）:');
for (const [d, arr] of group((r) => r.difficulty)) {
  for (const kind of ['normal', 'elite', 'boss']) {
    const xs = pacingRows(arr, kind);
    if (!xs.length) continue;
    printPacing(`${d}/${kind}`, xs, kind);
  }
}

// --- F-4 / RI-78 介入の発動と、できなかった理由 -----------------------------
console.log(`\n## RI-78 介入の発動回数と、発動できなかった理由\n`);
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

// --- RI-78 アクション別の対象不足 -------------------------------------------
console.log(`\n## RI-78 アクション別の対象不足（単一介入方針。順序バイアスなし）\n`);
const SINGLE = {
  onlyFirefight: 'firefight',
  onlyInterrupt: 'interruptReview',
  onlyOvertime: 'overtime',
  onlyAndon: 'andon',
  onlyAssign: 'assignTask',
  onlySplit: 'splitPr',
  onlyPair: 'pairReview',
  onlyThrottle: 'aiThrottle',
};
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  const cells = [];
  for (const [policy, action] of Object.entries(SINGLE)) {
    const policyRuns = runs.filter((r) => r.difficulty === d && r.policy === policy);
    // **方針が未実行のセルは「0回」ではなく未計測と書く。** `PT_POLICIES` で単一介入方針を
    // 除外した絞り込み実行でも、空の集計結果は `ok=0/no-target=0(—)` として出てしまい、
    // 「実行していない」のか「実行したが対象が一度も無かった」のかを区別できない。
    if (policyRuns.length === 0) {
      cells.push(`${action} 未計測(${policy} 未実行)`);
      continue;
    }
    const sprints = policyRuns.flatMap((r) => r.sprints);
    let ok = 0;
    let noTarget = 0;
    for (const s of sprints) {
      ok += s.attempts?.[action]?.ok ?? 0;
      noTarget += s.attempts?.[action]?.['no-target'] ?? 0;
    }
    const total = ok + noTarget;
    cells.push(`${action} ok=${ok}/no-target=${noTarget}(${pct(noTarget, total)})`);
  }
  console.log(`${d}: ${cells.join(' | ')}`);
}

// --- RI-78 スプリント間投資の共通機会 ---------------------------------------
console.log(`\n## RI-78 スプリント間投資（共通機会・次スプリント KPI）\n`);
const runIdentity = (r) => `${r.meta ?? 'fresh'}|${r.difficulty}|${r.seed}`;
const sprintIdentity = (s) => `${s.quarter}|${s.index}`;
const sprintAfterInvestment = (run, event) =>
  (run.sprints ?? []).find((s) => s.quarter === event.quarter && s.index === event.index) ?? null;
const investmentOutcome = (run, sprint) => {
  if (sprint && isCompletedSprint(sprint)) return '完走';
  if (run.status === 'lost') return `敗北(${run.loseReason ?? 'unknown'})`;
  return '未完走';
};
const investmentOutcomeSummary = (rows, side) => {
  const counts = new Map();
  for (const row of rows) {
    const run = row[`${side}Run`];
    const sprint = row[`${side}Sprint`];
    const outcome = investmentOutcome(run, sprint);
    counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
  }
  return [...counts.entries()].map(([outcome, count]) => `${outcome} ${count}`).join(' / ');
};
const completedInvestmentRows = (rows) =>
  rows.filter(
    (row) =>
      row.treatmentSprint &&
      row.controlSprint &&
      isCompletedSprint(row.treatmentSprint) &&
      isCompletedSprint(row.controlSprint),
  );
const pairedInvestmentRows = (policy, control, kind, predicate) => {
  const treatmentRuns = new Map(
    runs.filter((r) => r.policy === policy).map((r) => [runIdentity(r), r]),
  );
  const controlRuns = new Map(
    runs.filter((r) => r.policy === control).map((r) => [runIdentity(r), r]),
  );
  const rows = [];
  for (const [identity, treatment] of treatmentRuns) {
    const ctl = controlRuns.get(identity);
    if (!ctl) continue;
    const controlEvents = new Map(
      (ctl.investments ?? [])
        .filter((event) => event.kind === kind)
        .map((event) => [sprintIdentity(event), event]),
    );
    for (const event of (treatment.investments ?? []).filter(
      (candidate) =>
        candidate.kind === kind &&
        predicate(candidate, controlEvents.get(sprintIdentity(candidate))),
    )) {
      const controlEvent = controlEvents.get(sprintIdentity(event));
      const treatmentSprint = sprintAfterInvestment(treatment, event);
      const controlSprint = controlEvent ? sprintAfterInvestment(ctl, controlEvent) : null;
      if (controlEvent) {
        // 次スプリントを完走できなかった側も共通投資機会の母数へ残す。
        // ここで落とすと、投資が敗北を招いたケースほど KPI 比較から消える。
        rows.push({
          event,
          controlEvent,
          treatmentRun: treatment,
          controlRun: ctl,
          treatmentSprint,
          controlSprint,
        });
      }
    }
  }
  return rows;
};
const meanField = (rows, side, field) => mean(rows.map((row) => row[side][field] ?? 0));
const printInvestmentPair = (label, rows, fields) => {
  if (!rows.length) {
    console.log(`${label}: 共通機会なし（未計測）`);
    return;
  }
  const completed = completedInvestmentRows(rows);
  const outcomes =
    `共通機会 n=${rows.length}（投資側: ${investmentOutcomeSummary(rows, 'treatment')}; ` +
    `統制: ${investmentOutcomeSummary(rows, 'control')}）`;
  // KPI は次スプリントを完走した側にしか存在しないため平均値は完走ペアで比較する。
  // 一方、完走できなかった機会は上の outcome 集計と共通機会 n に残し、生存者だけを
  // 共通機会の母数として扱わない。
  if (!completed.length) {
    console.log(`${label}: ${outcomes} | KPI比較なし`);
    return;
  }
  const deltas = fields.map(({ label: fieldLabel, field, lowerIsBetter = false }) => {
    const treatment = meanField(completed, 'treatmentSprint', field);
    const control = meanField(completed, 'controlSprint', field);
    const delta = treatment - control;
    const better = lowerIsBetter ? delta < 0 : delta > 0;
    return `${fieldLabel} ${r1(treatment)} vs ${r1(control)} (${delta >= 0 ? '+' : ''}${r1(delta)})${better ? ' 改善' : ''}`;
  });
  console.log(`${label}: ${outcomes}、完走ペア n=${completed.length} | ${deltas.join(' / ')}`);
};

const repayRows = pairedInvestmentRows(
  'skilledRestRepay',
  'skilledNoHire',
  'rest',
  (event, controlEvent) => event.choice === 'repay' && controlEvent?.choice === 'heal',
);
printInvestmentPair('返済 vs 回復', repayRows, [
  { label: 'Rework', field: 'rework', lowerIsBetter: true },
  { label: 'Tech Debt', field: 'techDebtAfter', lowerIsBetter: true },
]);

const upgradeRows = pairedInvestmentRows(
  'skilledRestUpgrade',
  'skilledNoHire',
  'rest',
  (event, controlEvent) => event.choice === 'upgrade' && controlEvent?.choice === 'heal',
);
printInvestmentPair('強化 vs 回復', upgradeRows, [
  { label: 'カード発動数', field: 'cardsPlayed' },
  { label: '集中力上限', field: 'focusMax' },
  { label: '出荷', field: 'delivered' },
]);

const shopRows = pairedInvestmentRows(
  'skilledShopBuy',
  // RI-78: カード発動を preferDelivery で揃えた統制。旧 skilledNoHire 比較は発動方針差が混ざる。
  'skilledShopCtl',
  'shop',
  (event, controlEvent) =>
    Boolean((event.shopCardsBought ?? 0) > 0 || event.shopRelicBought) &&
    controlEvent !== undefined,
);
if (shopRows.length) {
  const completedShopRows = completedInvestmentRows(shopRows);
  const comparableShopCount = completedShopRows.length;
  const incompleteShopCount = shopRows.length - comparableShopCount;
  // ショップ購入の純効用は「次スプリント出荷 − 実際に支払った購入費」とする。
  // 4 KPI の OR ではなく、事前に固定した単一の主要 KPI として判定し、予算消費を含める。
  const netDelivery = (sprint, event) =>
    sprint.delivered - Math.max(0, Number(event.purchaseCost ?? 0));
  // 改善率も平均値と同じく、両側に次スプリント KPI がある完走ペアだけで比較する。
  const improved = completedShopRows.filter(
    ({ event, controlEvent, treatmentSprint: t, controlSprint: c }) =>
      netDelivery(t, event) > netDelivery(c, controlEvent),
  ).length;
  const treatmentNetDelivery = comparableShopCount
    ? mean(
        completedShopRows.map(({ event, treatmentSprint }) => netDelivery(treatmentSprint, event)),
      )
    : null;
  const controlNetDelivery = comparableShopCount
    ? mean(
        completedShopRows.map(({ controlEvent, controlSprint }) =>
          netDelivery(controlSprint, controlEvent),
        ),
      )
    : null;
  console.log(
    `ショップ購入 vs 統制: 共通機会 n=${shopRows.length}（投資側: ${investmentOutcomeSummary(shopRows, 'treatment')}; ` +
      `統制: ${investmentOutcomeSummary(shopRows, 'control')}） | ` +
      `純出荷（出荷−購入費）改善=${improved}/${comparableShopCount} (${pct(improved, comparableShopCount)})、` +
      `完走ペアの純出荷平均=${treatmentNetDelivery === null ? '—' : r1(treatmentNetDelivery)} vs ${controlNetDelivery === null ? '—' : r1(controlNetDelivery)}、` +
      `完走ペア=${comparableShopCount}、比較不能=${incompleteShopCount}`,
  );
  printInvestmentPair('  ショップ購入詳細', shopRows, [
    { label: '出荷', field: 'delivered' },
    { label: 'Rework', field: 'rework', lowerIsBetter: true },
    { label: 'Reviewピーク', field: 'reviewQueueMax', lowerIsBetter: true },
    { label: 'HP', field: 'seniorHpAfter' },
  ]);
} else {
  console.log('ショップ購入 vs 統制: 共通の実購入機会なし（未計測）');
}

const cardsPair = (() => {
  const treatment = new Map(
    runs.filter((r) => r.policy === 'skilledSelectiveCards').map((r) => [runIdentity(r), r]),
  );
  const control = new Map(
    runs.filter((r) => r.policy === 'skilledNoCards').map((r) => [runIdentity(r), r]),
  );
  const rows = [];
  for (const [identity, t] of treatment) {
    const c = control.get(identity);
    if (!c) continue;
    rows.push({ t, c });
  }
  return rows;
})();
if (cardsPair.length) {
  const cardPairLine = (rows) => {
    const tWins = rows.filter(({ t }) => t.status === 'won').length;
    const cWins = rows.filter(({ c }) => c.status === 'won').length;
    // 未完走終端の cardsPlayed も保存済み計測値として含める。生存数は RunState の値を使う。
    const tPlayed = mean(
      rows.map(({ t }) => (t.sprints ?? []).reduce((n, s) => n + (s.cardsPlayed ?? 0), 0)),
    );
    const cPlayed = mean(
      rows.map(({ c }) => (c.sprints ?? []).reduce((n, s) => n + (s.cardsPlayed ?? 0), 0)),
    );
    const tCardFocus = mean(
      rows.map(({ t }) => (t.sprints ?? []).reduce((n, s) => n + (s.cardFocusSpent ?? 0), 0)),
    );
    const cCardFocus = mean(
      rows.map(({ c }) => (c.sprints ?? []).reduce((n, s) => n + (s.cardFocusSpent ?? 0), 0)),
    );
    const tInterventionFocus = mean(
      rows.map(({ t }) =>
        (t.sprints ?? []).reduce((n, s) => n + (s.interventionFocusSpent ?? 0), 0),
      ),
    );
    const cInterventionFocus = mean(
      rows.map(({ c }) =>
        (c.sprints ?? []).reduce((n, s) => n + (s.interventionFocusSpent ?? 0), 0),
      ),
    );
    const tSurvive = mean(rows.map(({ t }) => t.sprintsPlayed));
    const cSurvive = mean(rows.map(({ c }) => c.sprintsPlayed));
    return `共通ラン n=${rows.length} | 勝利 ${tWins} vs ${cWins} | 生存スプリント平均 ${r1(tSurvive)} vs ${r1(cSurvive)} | 発動カード平均 ${r1(tPlayed)} vs ${r1(cPlayed)} | 集中力消費（カード/介入） ${r1(tCardFocus)}/${r1(tInterventionFocus)} vs ${r1(cCardFocus)}/${r1(cInterventionFocus)}`;
  };
  console.log(`選択カード vs 無カード（全体）: ${cardPairLine(cardsPair)}`);
  for (const difficulty of [...new Set(cardsPair.map(({ t }) => t.difficulty))]) {
    console.log(
      `  ${difficulty}: ${cardPairLine(cardsPair.filter(({ t }) => t.difficulty === difficulty))}`,
    );
  }
} else {
  console.log('選択カード vs 無カード: 共通ランなし（未計測）');
}

const opportunityPolicies = [
  { policy: 'onlyAssign', action: 'assignTask' },
  { policy: 'onlyFirefight', action: 'firefight' },
  { policy: 'onlyInterrupt', action: 'interruptReview' },
  { policy: 'onlySplit', action: 'splitPr' },
];
for (const { policy, action } of opportunityPolicies) {
  const rows = runs.filter((r) => r.policy === policy).flatMap((r) => r.sprints ?? []);
  if (!rows.length) {
    console.log(`${action} 対象あり区間: 未計測（${policy} 未実行）`);
    continue;
  }
  const relevant =
    action === 'assignTask'
      ? rows.filter((s) => s.codingSlotAvailable)
      : action === 'firefight'
        ? rows.filter((s) => s.incidents > 0)
        : rows;
  const withWindow = relevant.filter((s) => (s.opportunityWindows?.[action] ?? 0) > 0).length;
  const initial = relevant.filter((s) => Boolean(s.initialOpportunity?.[action])).length;
  const completedRelevant = relevant.filter(isCompletedSprint);
  const completedWithWindow = completedRelevant.filter(
    (s) => (s.opportunityWindows?.[action] ?? 0) > 0,
  ).length;
  console.log(
    `${action} 対象あり区間: 条件該当 ${withWindow}/${relevant.length} (${pct(withWindow, relevant.length)}) | 初回対象あり=${pct(initial, relevant.length)} | 完走分=${completedWithWindow}/${completedRelevant.length} (${pct(completedWithWindow, completedRelevant.length)})`,
  );
}

// --- F-5 分散（同一スプリント番号で比較） ----------------------------------
console.log(`\n## F-5 出荷の散らばり（同一スプリント番号で比較）\n`);
// 全スプリントを連結した CV は、長く生存したランほど標本を多く出し進行段階も混ざるため使わない。
// 各スプリント番号ごとに、そこへ到達したランだけで CV を出す。
const CV_SPRINT_INDEXES = [1, 2, 3, 5];

// RI-84 の方針間比較は**介入以外を揃えたペアの共通コホート**で出す。
// naive は asListed / firstChoice、skilledNoHire は reviewFirst / stateAware なので、
// 1つの無介入方針を両方へ使うと進化・ビート選択の差が CV へ混ざる。
const CV_COMPARE_PAIRS = [
  { policy: 'naive', control: 'naiveNoInterventionCtl' },
  { policy: 'skilledNoHire', control: 'noInterventionCtl' },
];
const CV_COMPARE_POLICIES = [
  ...new Set(CV_COMPARE_PAIRS.flatMap(({ policy, control }) => [policy, control])),
];
// **メタプロファイルごとに分ける。** キーに `meta` を含めて対応は取れていても、CV は
// 対応差ではなく周辺分布の分散なので、fresh と full を同じ配列へ入れるとメタ解放による
// 平均・分散の差が介入効果へ混入する。
if (sampleGuard('F-5 の統制ペア', CV_COMPARE_POLICIES)) {
  console.log(
    'RI-84 の方針間比較（同一メタ・難易度・seed で各ペアが到達したスプリントのみ。メタ別）:',
  );
  for (const meta of metaProfiles) {
    for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
      const cells = CV_SPRINT_INDEXES.map((n) => {
        const bySeed = (policy) => {
          const m = new Map();
          const pool = runs.filter(
            (x) => (x.meta ?? 'fresh') === meta && x.difficulty === d && x.policy === policy,
          );
          for (const r of pool) {
            const sprints = completedSprintsOf(r);
            if (sprints.length >= n) m.set(r.seed, sprints[n - 1].delivered);
          }
          return m;
        };
        const pairParts = CV_COMPARE_PAIRS.map(({ policy, control }) => {
          const policyBySeed = bySeed(policy);
          const controlBySeed = bySeed(control);
          const shared = [...policyBySeed.keys()].filter((k) => controlBySeed.has(k));
          if (shared.length === 0) return `${policy}/${control}: 共通到達なし`;
          const policyCv = fmtCv(shared.map((k) => policyBySeed.get(k)));
          const controlCv = fmtCv(shared.map((k) => controlBySeed.get(k)));
          return `${policy}=${policyCv} vs ${control}=${controlCv}(共通 n=${shared.length})`;
        });
        return `S${n}: ${pairParts.join(' / ')}`;
      });
      console.log(`  [${meta}] ${d}: ${cells.join(' | ')}`);
    }
  }
}

console.log('\n参考: 方針別（各方針の到達ランで独立に集計。方針間の比較には使わない）:');
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const cells = CV_SPRINT_INDEXES.map((n) => {
    const xs = arr
      .map((r) => completedSprintsOf(r))
      .filter((sprints) => sprints.length >= n)
      .map((sprints) => sprints[n - 1].delivered);
    if (xs.length === 0) return `S${n}: 未到達`;
    const reach = xs.length === arr.length ? '' : `(到達 ${xs.length}/${arr.length})`;
    return `S${n}: 平均=${r1(mean(xs))} CV=${fmtCv(xs)}${reach}`;
  });
  console.log(`${k}: ${cells.join(' | ')}`);
}

// --- F-10 勝利種別（方針別） ------------------------------------------------
console.log(`\n## F-10 勝利種別 / 組織診断\n`);
const winTypes = {};
const diagnoses = {};
for (const run of runs) {
  if (run.winType) winTypes[run.winType] = (winTypes[run.winType] ?? 0) + 1;
  diagnoses[run.diagnosis] = (diagnoses[run.diagnosis] ?? 0) + 1;
}
console.log('全体 勝利種別:', JSON.stringify(winTypes));
console.log('全体 組織診断:', JSON.stringify(diagnoses));
/**
 * F-10 のビルド差分方針（`tests/playtest/harness.ts` の「ビルド差分（F-10）」節）。
 * 固定介入検出や目標修正比較の方針は、勝ち筋のビルド分岐判定に混ぜない。
 */
const F10_BUILD_POLICIES = new Set([
  'aiFullBet',
  'harnessBloated',
  'harnessOptimized',
  'noAi',
  'reviewHeavy',
]);
/** 方針別 modal に入れる最低勝利数（偶然の1勝で第3種を作らない）。 */
const F10_MIN_WINS_FOR_MODAL = 2;

// F-10 は「方針を変えると勝ち筋が変わるか」なので、方針別の分布を出す。
console.log('\n方針別（勝利があった方針のみ。勝利種別 / 診断）:');
for (const [policy, arr] of group((r) => r.policy)) {
  const wt = {};
  const dg = {};
  for (const r of arr) {
    if (r.winType) wt[r.winType] = (wt[r.winType] ?? 0) + 1;
    dg[r.diagnosis] = (dg[r.diagnosis] ?? 0) + 1;
  }
  if (Object.keys(wt).length === 0) continue;
  console.log(`  ${policy}: ${JSON.stringify(wt)} / ${JSON.stringify(dg)}`);
}

/** 同率首位は modal にせず除外する（辞書順タイブレークを使わない）。 */
function uniqueModalWinType(wt) {
  const ranked = Object.entries(wt).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return null;
  return ranked[0][0];
}

const f10ModalWinTypes = new Set();
/** modal 集計に採用した方針（標本不足・同率は含めない）。 */
const f10AdoptedPolicies = new Set();
const f10ModalPolicies = [];
const f10TiePolicies = [];
const f10SparsePolicies = [];
for (const [policy, arr] of group((r) => r.policy)) {
  if (!F10_BUILD_POLICIES.has(policy)) continue;
  const wt = {};
  for (const r of arr) {
    if (r.winType) wt[r.winType] = (wt[r.winType] ?? 0) + 1;
  }
  const wins = Object.values(wt).reduce((a, b) => a + b, 0);
  if (wins === 0) continue;
  if (wins < F10_MIN_WINS_FOR_MODAL) {
    f10SparsePolicies.push(`${policy}(n=${wins})`);
    continue;
  }
  const modal = uniqueModalWinType(wt);
  if (!modal) {
    f10TiePolicies.push(policy);
    continue;
  }
  f10ModalWinTypes.add(modal);
  f10AdoptedPolicies.add(policy);
  f10ModalPolicies.push(`${policy}=${modal}`);
}

/**
 * 同一 meta/難易度/seed で、採用 modal 方針どうしの勝利種別が分かれるか。
 * 標本不足・同率除外の方針は見ない（疎な2方針だけの分岐で PASS にしない）。
 */
let f10CommonSeedDivergence = false;
const f10CommonSeedTypes = new Set();
const f10WinsByCohort = new Map();
for (const r of runs) {
  if (!f10AdoptedPolicies.has(r.policy) || !r.winType) continue;
  const key = `${r.meta ?? 'fresh'}|${r.difficulty}|${r.seed}`;
  if (!f10WinsByCohort.has(key)) f10WinsByCohort.set(key, new Map());
  f10WinsByCohort.get(key).set(r.policy, r.winType);
}
for (const [, byPolicy] of f10WinsByCohort) {
  const types = new Set(byPolicy.values());
  if (types.size < 2) continue;
  f10CommonSeedDivergence = true;
  for (const t of types) f10CommonSeedTypes.add(t);
}
/**
 * 共通 seed 上で観測した勝利種別が、採用 modal 集合の分岐を支えているか。
 * 疎方針を混ぜず、採用 modal 方針だけで2種以上が同一コホートに現れることを要求する。
 */
const f10CommonSeedSupportsModals =
  f10CommonSeedDivergence &&
  f10CommonSeedTypes.size >= 2 &&
  [...f10CommonSeedTypes].every((t) => f10ModalWinTypes.has(t));

const overallWinTypeCount = Object.keys(winTypes).length;
const f10ModalCount = f10ModalWinTypes.size;
const f10Measurable = !STALE && cohort?.isDefault === true;
const f10Pass =
  f10Measurable && overallWinTypeCount >= 3 && f10ModalCount >= 3 && f10CommonSeedSupportsModals;
const f10Verdict = !f10Measurable ? '未計測' : f10Pass ? 'PASS' : 'FAIL';
console.log(
  `\nF-10 受入（RI-76）: 全体勝利種別 ${overallWinTypeCount} 種 / ` +
    `F-10ビルド modal ${f10ModalCount} 種（minWins=${F10_MIN_WINS_FOR_MODAL}・同率除外） / ` +
    `採用方針の共通seed分岐=${f10CommonSeedSupportsModals ? 'yes' : 'no'} → ${f10Verdict}`,
);
console.log(`  F-10 modal: ${JSON.stringify([...f10ModalWinTypes].sort())}`);
console.log(`  採用方針: ${f10ModalPolicies.join(', ') || '（なし）'}`);
console.log(`  共通seed種別（採用方針のみ）: ${JSON.stringify([...f10CommonSeedTypes].sort())}`);
if (f10TiePolicies.length > 0) console.log(`  同率除外: ${f10TiePolicies.join(', ')}`);
if (f10SparsePolicies.length > 0) console.log(`  標本不足: ${f10SparsePolicies.join(', ')}`);
if (STALE) console.log('  理由: 世代不一致（STALE）。PASS/FAIL を出さない');
if (cohort && cohort.isDefault !== true) {
  console.log('  理由: 既定コホートではない。PASS/FAIL を出さない');
}

// --- F-9 敗因ごとの手触り（難易度で層別化） ---------------------------------
console.log(`\n## F-9 敗因ごとの進行と予兆\n`);
// 敗因と実験条件は相関する（例: aiDependency はほぼ Nightmare の第1スプリント）。
// 全体を一つに潰すと難易度差が p50 に混入するため、難易度で層別化する。
/**
 * 敗北直前の状態を取る。
 *
 * ハーネスが記録する `lostPrevState` は**敗北を確定させた処理へ入る直前**の組織状態
 * （そのスプリントの開始時点、あるいはそのビート・ショップ・休息の直前）である。
 * これがあるときは常にこちらを使う。
 *
 * 旧経路（スプリントログからの推定）は、末尾が敗北スプリントかどうかで参照先を変えるが、
 * **どちらに転んでも「あるスプリントの終了時点」しか返せない**。スプリント終了と敗北の間には
 * ビート・ショップ・休息・setup が挟まり、そこでの増減が丸ごと落ちる。休息で回復した直後に
 * ビートで負けたランでは、回復前の低い値が「直前」として出ていた。`lostPrevState` を持たない
 * 旧い出力のためだけに残す。
 */
const prevStateOf = (run) => {
  if (run.lostPrevState) {
    const p = run.lostPrevState;
    // `aiDepAfter` まで引き継ぐ。既定行列の Nightmare 主要敗因は `aiDependency`（255件）で、
    // 依存度を落とすとその敗因の「直前」から**敗因そのものの指標**が消える。
    return {
      seniorHpAfter: p.seniorHp,
      moraleAfter: p.morale,
      techDebtAfter: p.techDebt,
      budgetAfter: p.budget,
      aiDepAfter: p.aiDependency,
      minTrustAfter: p.minTrust,
    };
  }
  if (run.sprints.length === 0) return undefined;
  const lostAtSprintEnd = run.lostPhase === 'sprint' && run.lostSprintCompleted !== false;
  const idx = lostAtSprintEnd ? run.sprints.length - 2 : run.sprints.length - 1;
  return idx >= 0 ? run.sprints[idx] : undefined;
};
/** 敗北を確定させたビートのイベントID内訳（上位3件）。 */
const beatEventsOf = (arr) => {
  const ev = {};
  for (const r of arr) {
    if (!r.lostBeat) continue;
    const k = `${r.lostBeat.eventId}(${r.lostBeat.kind})`;
    ev[k] = (ev[k] ?? 0) + 1;
  }
  const top = Object.entries(ev)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return top.length
    ? ` | 敗北を確定させたビート ${top.map(([k, n]) => `${k}=${n}`).join(', ')}`
    : '';
};

const fmtGroup = (arr) => {
  const sprintsToLose = arr.map((r) => r.sprintsPlayed);
  const prev = arr.map(prevStateOf).filter((x) => x !== undefined);
  const f = (xs, fn) => (xs.length ? r1(mean(xs.map(fn))) : '—');
  const phases = {};
  for (const r of arr) {
    // ビート敗北は judgment（選択不能）と decision（プレイヤーが選べる）で意味が違う。
    // まとめると「操作の余地がない画面で敗北」かどうかを判定できない。
    const key =
      r.lostPhase === 'beat' && r.lostBeat ? `beat:${r.lostBeat.kind}` : (r.lostPhase ?? 'unknown');
    phases[key] = (phases[key] ?? 0) + 1;
  }
  return `n=${arr.length} p50=${quantile(sprintsToLose, 0.5)} | 直前 hp=${f(prev, (s) => s.seniorHpAfter)} morale=${f(prev, (s) => s.moraleAfter)} debt=${f(prev, (s) => s.techDebtAfter)} budget=${f(prev, (s) => s.budgetAfter)} aiDep=${f(prev, (s) => s.aiDepAfter)} 最小信頼=${f(prev, (s) => s.minTrustAfter)}（直前状態あり ${prev.length}/${arr.length}）| 敗北フェーズ ${JSON.stringify(phases)}${beatEventsOf(arr)}`;
};
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  console.log(`\n### ${d}`);
  const lost = runs.filter((r) => r.difficulty === d && r.loseReason);
  const byReason = new Map();
  for (const r of lost) {
    if (!byReason.has(r.loseReason)) byReason.set(r.loseReason, []);
    byReason.get(r.loseReason).push(r);
  }
  for (const [reason, arr] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${reason}: ${fmtGroup(arr)}`);
  }
}

// 難易度だけでは方針差が残る（例: onlyFirefight と idle では生存長が違う）。
// 敗北の多い代表方針の中でも比較して、敗因固有の進行速度が方針に依らないことを確認する。
const F9_POLICIES = ['naive', 'skilledNoHire', 'onlyFirefight', 'noInterventionCtl'];

// RI-89: 同一難易度・同一方針内で敗因別の「危険域で打てた介入集合」を出す。
// 発動可能集合は方針の集中力消費・クールダウンに依存するため、層別化しないと比較が汚染される。
console.log(`\n### 敗因別・危険域で打てた介入（RI-89・同一難易度/方針）\n`);
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  for (const policy of F9_POLICIES) {
    const lost = runs.filter((r) => r.difficulty === d && r.policy === policy && r.loseReason);
    if (lost.length === 0) continue;
    const byReason = new Map();
    for (const r of lost) {
      if (!byReason.has(r.loseReason)) byReason.set(r.loseReason, []);
      byReason.get(r.loseReason).push(r);
    }
    console.log(`  ${d}/${policy}:`);
    const sets = [];
    for (const [reason, arr] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const freq = new Map();
      let withSample = 0;
      let emptySample = 0;
      const gaps = [];
      const neverHadHandsGaps = [];
      for (const r of arr) {
        // 未観測（フィールドなし）と「観測したが空集合」を区別する。
        if (!Object.prototype.hasOwnProperty.call(r, 'availableActionsInDanger')) continue;
        const avail = r.availableActionsInDanger;
        if (!Array.isArray(avail)) continue;
        withSample += 1;
        if (avail.length === 0) emptySample += 1;
        for (const id of avail) freq.set(id, (freq.get(id) ?? 0) + 1);
        // 機械的発動可能手が消えた／最初から無かった時点→敗北までのスプリント差。
        // サンプルは完了加算前。未完了スプリント内の即時敗北だけ加算後と一致するので除かない。
        if (typeof r.sprintsPlayed !== 'number') continue;
        const midSprintInstantLose = r.lostPhase === 'sprint' && r.lostSprintCompleted === false;
        let loseSprints = r.sprintsPlayed;
        if (!midSprintInstantLose) {
          loseSprints = Math.max(0, r.sprintsPlayed - 1);
        }
        const lastNonEmpty = r.availableActionsInDangerLastNonEmpty;
        const firstSample = r.availableActionsInDangerFirstSample;
        if (lastNonEmpty) {
          gaps.push(Math.max(0, loseSprints - lastNonEmpty.sprintsPlayed));
        } else if (firstSample) {
          // 危険域では一度も非空手なし＝最も強い早期詰み候補。別群として集計する。
          neverHadHandsGaps.push(Math.max(0, loseSprints - firstSample.sprintsPlayed));
        }
      }
      const ranked = [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([id, n]) => `${id}:${n}`);
      // 空集合サンプルだけの敗因も比較対象に残す。
      const setKey = withSample > 0 ? [...freq.keys()].sort().join(',') : null;
      if (setKey !== null) sets.push(setKey);
      const gapNote =
        gaps.length > 0 ? ` | 非空手→敗北差 p50=${quantile(gaps, 0.5)} (n=${gaps.length})` : '';
      const neverNote =
        neverHadHandsGaps.length > 0
          ? ` | 常時空集合→敗北差 p50=${quantile(neverHadHandsGaps, 0.5)} (n=${neverHadHandsGaps.length})`
          : '';
      console.log(
        `    ${reason}: n=${arr.length} 危険域サンプル ${withSample}/${arr.length}（空集合 ${emptySample}）| 集合 {${ranked.join(', ') || '—'}}${gapNote}${neverNote}`,
      );
    }
    const distinct = new Set(sets);
    console.log(`    敗因間で集合が違う種類数: ${distinct.size}。F-9 の「打てた手」比較用。`);
  }
}

console.log('\n### 同一難易度・同一方針内（代表方針・進行速度）');
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  for (const policy of F9_POLICIES) {
    const lost = runs.filter((r) => r.difficulty === d && r.policy === policy && r.loseReason);
    if (lost.length === 0) continue;
    const byReason = new Map();
    for (const r of lost) {
      if (!byReason.has(r.loseReason)) byReason.set(r.loseReason, []);
      byReason.get(r.loseReason).push(r);
    }
    const cells = [...byReason.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([reason, arr]) =>
          `${reason} n=${arr.length} p50=${quantile(
            arr.map((r) => r.sprintsPlayed),
            0.5,
          )}`,
      );
    console.log(`  ${d}/${policy}: ${cells.join(' | ')}`);
  }
}

console.log('\n全体（難易度・方針を跨ぐため参考値）:');
{
  const byReason = new Map();
  for (const r of runs.filter((r) => r.loseReason)) {
    if (!byReason.has(r.loseReason)) byReason.set(r.loseReason, []);
    byReason.get(r.loseReason).push(r);
  }
  for (const [reason, arr] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${reason}: ${fmtGroup(arr)}`);
  }
}

// --- RI-79 trustExhausted の発火要因分解 ------------------------------------
console.log(`\n## RI-79 四半期 outcome の発火要因\n`);
const crisisTrig = {};
const shutdownTrig = {};
const outcomeCounts = {};
for (const run of runs) {
  for (const q of run.quarters ?? []) {
    outcomeCounts[q.outcome] = (outcomeCounts[q.outcome] ?? 0) + 1;
    const key = (list) => (list?.length ? list.join('+') : 'none');
    // missed_crisis は信頼・予算・未達数のほか、安全性フィルタで修正候補が空のときにも発火する。
    // 後者も loseReason は trustExhausted（「選択肢を使い切った」とは区別する）。
    if (q.outcome === 'missed_crisis') {
      crisisTrig[key(q.crisisTriggers)] = (crisisTrig[key(q.crisisTriggers)] ?? 0) + 1;
    }
    if (q.outcome === 'shutdown')
      shutdownTrig[key(q.shutdownTriggers)] = (shutdownTrig[key(q.shutdownTriggers)] ?? 0) + 1;
  }
}
console.log('四半期 outcome:', JSON.stringify(outcomeCounts));
console.log('missed_crisis の発火条件:', JSON.stringify(crisisTrig));
console.log('shutdown の発火条件:', JSON.stringify(shutdownTrig));
console.log(
  '  ※ shutdown の判定入力は再現できている。companyOrgFromTeams は morale / seniorHp だけ',
);
console.log('     平均を取らず選択中チームの値をそのまま使い、trust / budget はラン単位のため。');

// --- F-2 第4層: 目標修正の選択別の後続 --------------------------------------
console.log(`\n## F-2 第4層 目標修正\n`);
const withAdj = runs.filter((r) => r.goalAdjustments.length > 0);
console.log(
  `目標修正を1回以上経験: ${withAdj.length}/${runs.length} (${pct(withAdj.length, runs.length)})`,
);
// 統制比較は、目標修正だけを固定した adj* 方針に限る。
// 他の方針は提示順の先頭（多くは cut_scope）を選ぶため、混ぜると比較にならない。
const ADJ_POLICIES = {
  adjCutScope: 'cut_scope',
  adjExtendDeadline: 'extend_deadline',
  adjQualityPivot: 'quality_pivot',
  adjRequestBudget: 'request_budget',
  adjPauseAiRollout: 'pause_ai_rollout',
  adjReorgTeams: 'reorg_teams',
  adjStakeholderCare: 'stakeholder_care',
};
/**
 * 各ランで最初にその方針の修正が適用された四半期。無ければ null。
 *
 * adj* 7方針は `goalAdjustment` 以外すべて同一なので、**最初の修正までは同一 seed の
 * 7ランが完全に同じ経過をたどる**。したがって最初の修正時点の事前状態と提示候補も同一で、
 * ここを揃えれば選択効果だけを取り出せる。
 */
const firstAppliedQuarter = (r, label) =>
  (r.quarters ?? []).find((q) => q.chosenAdjustment === label)?.quarter ?? null;

// `availableAdjustments` は各選択肢の適用後状態で候補を絞るため、方針ごとに
// 「提示され選べたラン」が異なる。そのまま勝率を並べると選択効果と選抜条件を分離できない。
// そこで同一メタ・難易度・seed で 7方針すべてが同じ四半期に自分の修正を適用できた組だけを残す。
// キーに `meta` を含めないと fresh と full の同一 seed が衝突し、片方の適用四半期で
// コホート成立が決まったうえに両プロファイルのランが勝率へ混入する（冒頭の重複排除と同じ理由）。
const cohortKeyOf = (r) => `${r.meta ?? 'fresh'}|${r.difficulty}|${r.seed}`;
const adjEntries = Object.entries(ADJ_POLICIES);
const cohortKeys = (() => {
  const perPolicy = adjEntries.map(([policy, label]) => {
    const m = new Map();
    for (const r of runs.filter((x) => x.policy === policy)) {
      const q = firstAppliedQuarter(r, label);
      if (q !== null) m.set(cohortKeyOf(r), q);
    }
    return m;
  });
  if (perPolicy.length === 0) return new Set();
  const [head, ...rest] = perPolicy;
  const keys = new Set();
  for (const [k, q] of head) {
    if (rest.every((m) => m.get(k) === q)) keys.add(k);
  }
  return keys;
})();

console.log('統制比較（adj* 方針のみ。他方針は提示順の先頭を選ぶため除外）:');
console.log(
  `  共通コホート: 全7方針が同一メタ・難易度・seed・四半期で自分の修正を適用できた組 = ${cohortKeys.size}組`,
);
if (cohortKeys.size === 0) {
  console.log('  ※ 共通コホートが0組のため、選択効果は未計測');
}
/**
 * 初回修正の**直後1四半期**の結果。
 *
 * 最終勝率は初回選択の効果ではない。共通コホートで揃うのは最初の修正までで、その後の修正は
 * 方針間で統制されていない（同じ seed でも、ある方針は `request_budget` を2回選んだ後に
 * `cut_scope` を3回選び、別の方針は1回で終わる）。ラン全体の勝敗・総スプリントには
 * その後続選択がすべて乗るので、初回選択へ帰属できない。
 *
 * 初回修正の四半期を Q とすると、Q+1 の四半期レビューまでに何が起きたかを見る。
 * この範囲なら後続の修正はまだ1回しか挟まらない。
 */
const afterFirstAdjustment = (r, label) => {
  const q = firstAppliedQuarter(r, label);
  if (q === null) return null;
  const qs = r.quarters ?? [];
  const next = qs.find((x) => x.quarter === q + 1);
  return {
    // Q+1 へ到達したか（＝初回修正の直後を生き延びたか）
    survived: next !== undefined || r.status === 'won',
    nextOutcome: next?.outcome ?? (r.status === 'won' ? 'won' : 'lost'),
  };
};

for (const [policy, label] of adjEntries) {
  const arr = runs.filter((r) => r.policy === policy);
  if (!arr.length) continue;
  const applied = arr.filter((r) => firstAppliedQuarter(r, label) !== null);
  const cohort = arr.filter((r) => cohortKeys.has(cohortKeyOf(r)));
  const won = cohort.filter((r) => r.status === 'won').length;
  const after = cohort.map((r) => afterFirstAdjustment(r, label)).filter((x) => x !== null);
  const survived = after.filter((x) => x.survived).length;
  console.log(
    `  ${policy}(${label}): 参考[提示され選べたラン=${applied.length}/${arr.length}] ` +
      `共通コホート n=${cohort.length} | ` +
      `**初回修正の次四半期まで生存=${pct(survived, after.length)}** | ` +
      `参考[ラン全体の勝率=${pct(won, cohort.length)} 総スプリント 平均=${r1(mean(cohort.map((r) => r.sprintsPlayed)))}]`,
  );
}
console.log(
  '  ※ ラン全体の勝率・総スプリントは後続の目標修正が統制されていないため参考値。' +
    '初回選択の効果は「次四半期まで生存」で見る。',
);

// --- スプリント評価の分布（RI-80。F-6 の判定には使わない） -------------------
//
// **これは F-6 の根拠ではない。** SPEC 第19.1 F-6 は「敗北画面・リザルト・組織診断から
// 具体的な次の一手と現場への示唆が読み取れるか」を要求する基準で、スプリント評価の
// 中央値とは別物である。無介入と熟練の評価が一致しても敗北時の説明品質は分からないし、
// 分かれても F-6 の成立は確認できない。F-6 は敗北時に実際に表示される診断・助言を
// 記録して評価する必要があり、それは RI-82 で扱う。
//
// ここで見るのは「操作の巧拙がスプリント評価に反映されるか」（RI-80）だけである。
console.log(`\n## RI-80 スプリント評価の分布（F-6 の判定には使わない）\n`);
const GRADE_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4 };
const RANK_GRADE = ['D', 'C', 'B', 'A', 'S'];
const gradeStats = (sprints) => {
  const dist = {};
  const ranks = [];
  for (const s of sprints) {
    if (!s.grade) continue;
    dist[s.grade] = (dist[s.grade] ?? 0) + 1;
    ranks.push(GRADE_RANK[s.grade] ?? 0);
  }
  if (!ranks.length) return null;
  return { dist, n: ranks.length, median: RANK_GRADE[quantile(ranks, 0.5)] };
};
const overall = gradeStats(runs.flatMap((r) => completedSprintsOf(r)));
if (overall) {
  console.log(
    `全体 n=${overall.n} 中央値=${overall.median}`,
    Object.entries(overall.dist)
      .sort()
      .map(([g, n]) => `${g}=${n}(${pct(n, overall.n)})`)
      .join(' '),
  );
}
// RI-80 の受入条件は「無介入の評価中央値が熟練方針より低いこと」なので、
// 同一難易度・同一スプリント番号で無介入と熟練を並べる。
//
// **両方針が到達した seed だけで比べる**。到達率が違うまま生存ランを独立に集めると、
// 早期敗北した低評価 seed が片方からだけ脱落し、生存者バイアスで中央値の優劣が反転しうる
// （実際に劣っていても生存者の中央値は同じか高く出る）。未到達は別途件数で示す。
//
// **無介入側は `noInterventionCtl` を使う。** `passive` は介入だけでなく進化を `none`、
// ビート判断を `firstChoice` にしているため、`skilledNoHire` との差へ進化効果と
// イベント選択の巧拙まで混ざり、評価差を「操作の巧拙」へ帰属できない。
// `noInterventionCtl` はカード・進化・採用・ビート条件を `skilledNoHire` と揃えたうえで
// 介入だけを外した統制条件である。
console.log(
  '\n無介入(noInterventionCtl) vs 熟練(skilledNoHire) — 同一メタ・難易度・seed で両方が到達したスプリントのみ:',
);
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  for (const n of [1, 2, 3]) {
    const bySeed = (policy) => {
      const m = new Map();
      for (const r of runs.filter((x) => x.difficulty === d && x.policy === policy)) {
        const sprints = completedSprintsOf(r);
        if (sprints.length >= n) m.set(`${r.meta ?? 'fresh'}|${r.seed}`, sprints[n - 1]);
      }
      return m;
    };
    const pa = bySeed('noInterventionCtl');
    const pb = bySeed('skilledNoHire');
    const shared = [...pa.keys()].filter((k) => pb.has(k));
    const a = gradeStats(shared.map((k) => pa.get(k)));
    const b = gradeStats(shared.map((k) => pb.get(k)));
    const dropped = Math.max(pa.size, pb.size) - shared.length;
    if (!a || !b) {
      console.log(`  ${d} S${n}: 両方が到達した seed が無いため未計測`);
      continue;
    }
    const note = dropped > 0 ? ` ※片方のみ到達 ${dropped}件を除外` : '';
    console.log(
      `  ${d} S${n}: 共通 n=${shared.length} | noInterventionCtl 中央値=${a.median} ${JSON.stringify(a.dist)} | skilledNoHire 中央値=${b.median} ${JSON.stringify(b.dist)}${note}`,
    );
  }
}

// --- F-11 ビルドの方向が決まる時期 ------------------------------------------
console.log(`\n## F-11 Q1 でビルドの方向が決まるか\n`);
// 母数は全ラン（進化に到達しないランも含める）。
// 分子は「Q1 の解放が特定ブランチへ寄っている」ランに限る。1件だけ取った状態や、
// 複数ブランチへ均等に投資した状態は「方向が決まった」とは数えない。
const BRANCH_COMMIT_MIN_NODES = 2; // 同一ブランチで2ノード以上
const BRANCH_COMMIT_SHARE = 0.5; // かつ その時点までの解放の過半がそのブランチ
const F11_DIRECTION_SAMPLE_SIZE = 40;
const F11_DIRECTION_ACCEPTANCE_RATE = 0.5;
const F11_DIRECTION_ACCEPTANCE_MIN_BRANCHES = 2;
const F11_EXPECTED_META = 'fresh';
const F11_EXPECTED_DIFFICULTIES = ['easy', 'normal', 'hard', 'nightmare'];
const F11_EXPECTED_SEEDS = Array.from({ length: 10 }, (_, i) => `pt-${i + 1}`);
/**
 * Q1 中に「方向が確定した時点」があったかを判定する。
 *
 * F-11 は「方向が Q1 の途中で見え、以降はその方向を伸ばすか曲げるかの判断になる」を求める。
 * つまり**確定後に曲げること自体は要件を満たす**。Q1 の解放をまとめて最終構成比だけで見ると、
 * 序盤に同一ブランチへ寄せて方向を出したあと同じ Q1 中に他ブランチへ広げたランが
 * 「分散」へ落ちてしまう。そこで解放を順に走査し、**一度でも条件を満たした時点**があれば
 * 確定と数える。順序は記録済みの `sprintIndex`（同点なら記録順）による。
 *
 * さらに、同一進化フェーズ（同一 `sprintIndex`）での連続取得だけでは確定としない。
 * ポイントが余っていると盤面が変わらないまま同ブランチを2段買えてしまい、
 * 「別フェーズでの継続選択」という F-11 の意図を測れないためである。
 */
const commitInQ1 = (run) => {
  const q1 = (run.evolutionUnlocks ?? [])
    .filter((u) => u.quarter === 1)
    .map((u, i) => ({ ...u, order: i }))
    .sort((a, b) => (a.sprintIndex ?? 0) - (b.sprintIndex ?? 0) || a.order - b.order);
  if (q1.length === 0) return null;
  const byBranch = {};
  const sprintsByBranch = {};
  const top = () => Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0];
  for (let i = 0; i < q1.length; i += 1) {
    const b = q1[i].id.split('-')[0];
    byBranch[b] = (byBranch[b] ?? 0) + 1;
    if (!sprintsByBranch[b]) sprintsByBranch[b] = new Set();
    sprintsByBranch[b].add(q1[i].sprintIndex ?? 0);
    const [topBranch, topN] = top();
    const multiPhase = (sprintsByBranch[topBranch]?.size ?? 0) >= 2;
    if (topN >= BRANCH_COMMIT_MIN_NODES && topN / (i + 1) > BRANCH_COMMIT_SHARE && multiPhase) {
      return { committed: true, topBranch, topN, total: q1.length, atSprint: q1[i].sprintIndex };
    }
  }
  const [topBranch, topN] = top();
  return { committed: false, topBranch, topN, total: q1.length };
};
// F-11 の主要指標。
//
// 方向の確定（ブランチの偏り）は、このハーネスからは測れない。解放順が方針の `evolve` で
// 固定されているためである（下の参考値を参照）。代わりに「Q1 で木を取り切れてしまうか」を見る。
// 取り切れるなら、そもそも選ぶ対象が無く方向は生まれない。
//
// 標本は**固定した代表方針**に限る。全ランを標本にすると、`evolve: 'none'` の方針や
// `skilledBase` の複製（`adj*` など）を増減するだけで、ゲームを変えなくても分位点が動く。
const F11_SAMPLE_POLICIES = ['naive', 'skilledNoHire', 'aiFullBet', 'noAi'];
{
  const { nodes: totalNodes, totalCost } = EVOLUTION_TREE;
  console.log('**構造的事実（ランに依存しない）: ツリーの規模とポイントの入手速度**');
  console.log(`  進化ツリー: ${totalNodes}ノード / 総コスト ${totalCost}（src/data/evolution.ts）`);
  console.log(
    `  1スプリントの入手ポイント: ${EVO_POINTS.base} + floor(出荷/${EVO_POINTS.divisor})` +
      `（高負荷は +${EVO_POINTS.elite}）` +
      '（`RunEngine.evoPointsFor`）',
  );

  const sample = runs.filter((r) => F11_SAMPLE_POLICIES.includes(r.policy));
  const f11Missing = missingPolicies(F11_SAMPLE_POLICIES);
  console.log('');
  if (f11Missing.length > 0) {
    console.log(
      `**実測: 未計測** — 代表方針 ${f11Missing.join(' / ')} がこの実行に含まれていない` +
        `（必要: ${F11_SAMPLE_POLICIES.join(' / ')}）。以下は参考値。`,
    );
  } else {
    console.log(
      `**実測（代表方針 ${F11_SAMPLE_POLICIES.join(' / ')} に固定。n=${sample.length}）**`,
    );
  }
  // **0点のランを落とした分布と、全ランの分布を両方出す。**
  // 条件付き分布（>0）だけを `n=160` の実測として書くと標本を取り違える。
  // 0点になるのは Q1 の第1スプリントで敗北したラン（実測ではすべて nightmare）で、
  // そもそも「方向を選ぶ」局面に到達していない。どちらを根拠にするかは本文で明示する。
  const q1All = sample.map(q1EvoPoints);
  const q1Points = q1All.filter((n) => n > 0);
  const zeros = q1All.length - q1Points.length;
  if (q1All.length > 0) {
    console.log(
      `  Q1 で入手する総ポイント（全 n=${q1All.length}）: ` +
        `p10=${quantile(q1All, 0.1)} p50=${quantile(q1All, 0.5)} ` +
        `p90=${quantile(q1All, 0.9)}（ツリー総コスト ${totalCost} に対して）`,
    );
  }
  if (q1Points.length > 0) {
    console.log(
      `  うち1点以上得たラン（n=${q1Points.length} / 0点は${zeros}件）: ` +
        `p10=${quantile(q1Points, 0.1)} p50=${quantile(q1Points, 0.5)} ` +
        `p90=${quantile(q1Points, 0.9)}`,
    );
    const zeroDiffs = {};
    for (const r of sample) {
      if (q1EvoPoints(r) > 0) continue;
      zeroDiffs[r.difficulty] = (zeroDiffs[r.difficulty] ?? 0) + 1;
    }
    console.log(`    0点ランの難易度内訳: ${JSON.stringify(zeroDiffs)}`);
  }
  const q1Counts = sample
    .map((r) => (r.evolutionUnlocks ?? []).filter((u) => u.quarter === 1).length)
    .filter((n) => n > 0);
  const full = q1Counts.filter((n) => n >= totalNodes).length;
  if (q1Counts.length === 0) {
    console.log('  Q1 解放数: 解放のあるランが無いため未計測');
  } else {
    console.log(
      `  Q1 解放数（解放ありのラン n=${q1Counts.length}）: p10=${quantile(q1Counts, 0.1)} ` +
        `p50=${quantile(q1Counts, 0.5)} p90=${quantile(q1Counts, 0.9)}`,
    );
  }
  console.log(
    `  Q1 中にツリーを取り切ったラン: ${full}/${sample.length} (${pct(full, sample.length)})`,
  );
  console.log('  ※ Q1 で全ノードを取れるなら、どのブランチへ寄せるかという選択自体が発生しない。');
}
console.log(
  `\n参考: Q1 の解放を順に見て、同一ブランチ ${BRANCH_COMMIT_MIN_NODES} ノード以上かつ` +
    `その時点までの解放の ${BRANCH_COMMIT_SHARE * 100}% を超えて占め、` +
    `かつそのブランチの解放が複数スプリントにまたがる時点が一度でもあるか`,
);
console.log(
  '（同一フェーズの連続取得だけでは確定としない。確定後に他ブランチへ広げるのは F-11 が許容するため、最終構成比では判定しない）',
);
console.log(
  '  ※ 固定順方針（`reviewFirst` 等）の値は成立判定に使えない。解放順が方針で固定されており、',
);
console.log(
  '     同一フェーズで同ブランチを連続取得しやすい。方向の確定時期は `skilledStateEvolve`（`evolve: stateAware`）で測る。',
);
const F11_DIRECTION_POLICY = 'skilledStateEvolve';
{
  const arr = runs.filter((r) => r.policy === F11_DIRECTION_POLICY);
  if (arr.length === 0) {
    console.log(
      `\n**方向確定（${F11_DIRECTION_POLICY}）: 未計測** — PT_POLICIES に含めて実行すること。`,
    );
  } else {
    const results = arr.map(commitInQ1);
    const committed = results.filter((x) => x?.committed);
    const spread = results.filter((x) => x && !x.committed).length;
    const never = results.filter((x) => x === null).length;
    const branches = {};
    const atSprint = [];
    for (const c of committed) {
      branches[c.topBranch] = (branches[c.topBranch] ?? 0) + 1;
      if (c.atSprint != null) atSprint.push(c.atSprint);
    }
    console.log(`\n**方向確定（${F11_DIRECTION_POLICY}、盤面依存ブランチ選択。n=${arr.length}）**`);
    console.log(
      `  Q1で方向確定 ${committed.length}/${arr.length} (${pct(committed.length, arr.length)})` +
        ` / 解放ありだが分散 ${spread} / Q1解放なし ${never}`,
    );
    console.log(`  確定ブランチ分布: ${JSON.stringify(branches)}`);
    const sameSet = (actual, expected) => {
      const values = new Set(actual ?? []);
      return (
        (actual ?? []).length === expected.length &&
        values.size === expected.length &&
        expected.every((value) => values.has(value))
      );
    };
    const expectedSampleKeys = new Set(
      F11_EXPECTED_DIFFICULTIES.flatMap((difficulty) =>
        F11_EXPECTED_SEEDS.map((seed) => `${difficulty}|${seed}`),
      ),
    );
    const actualSampleKeys = new Set(arr.map((run) => `${run.difficulty}|${run.seed}`));
    const sampleCompositionAccepted = Boolean(
      cohort &&
      cohort.isDefault === true &&
      cohort.meta === F11_EXPECTED_META &&
      sameSet(cohort.difficulties, F11_EXPECTED_DIFFICULTIES) &&
      sameSet(cohort.seeds, F11_EXPECTED_SEEDS) &&
      arr.length === F11_DIRECTION_SAMPLE_SIZE &&
      arr.every((run) => run.meta === F11_EXPECTED_META) &&
      actualSampleKeys.size === expectedSampleKeys.size &&
      [...expectedSampleKeys].every((key) => actualSampleKeys.has(key)),
    );
    console.log(
      `  標本構成: ${sampleCompositionAccepted ? 'fresh × 4難易度 × pt-1〜pt-10（受入判定対象）' : '前提外のため受入判定は未計測'}`,
    );
    const minCommitted = Math.ceil(F11_DIRECTION_SAMPLE_SIZE * F11_DIRECTION_ACCEPTANCE_RATE);
    const sampleSizeAccepted = arr.length === F11_DIRECTION_SAMPLE_SIZE;
    const branchDiversityAccepted =
      Object.keys(branches).length >= F11_DIRECTION_ACCEPTANCE_MIN_BRANCHES;
    const directionAccepted =
      sampleCompositionAccepted &&
      sampleSizeAccepted &&
      committed.length >= minCommitted &&
      branchDiversityAccepted;
    console.log(
      `  受入判定: ${sampleCompositionAccepted ? (directionAccepted ? '充足' : '未充足') : '未計測'}（標本 n=${arr.length}/${F11_DIRECTION_SAMPLE_SIZE}` +
        `、方向確定 ${committed.length}/${minCommitted} 以上` +
        `、確定ブランチ ${Object.keys(branches).length}/${F11_DIRECTION_ACCEPTANCE_MIN_BRANCHES} 以上）`,
    );
    if (atSprint.length > 0) {
      console.log(
        `  確定スプリント（四半期内 index）: p10=${quantile(atSprint, 0.1)}` +
          ` p50=${quantile(atSprint, 0.5)} p90=${quantile(atSprint, 0.9)}`,
      );
    }
  }
}
console.log('\n方針別（進化を使う方針のみ・参考）:');
for (const [policy, arr] of group((r) => r.policy)) {
  const results = arr.map(commitInQ1);
  if (results.every((x) => x === null)) {
    console.log(`  ${policy}: 進化を使わない方針（Q1解放0 / ${arr.length}ラン）`);
    continue;
  }
  const committed = results.filter((x) => x?.committed);
  const branches = {};
  for (const c of committed) branches[c.topBranch] = (branches[c.topBranch] ?? 0) + 1;
  console.log(
    `  ${policy}: 方向確定 ${committed.length}/${arr.length}(${pct(committed.length, arr.length)}) 確定ブランチ=${JSON.stringify(branches)}`,
  );
}

// --- AI 依存度 --------------------------------------------------------------
console.log(`\n## RI-74 / RI-77 AI 依存度と利用率\n`);

// AI の因果は `noAiCtl`（`skilledNoHire` から AI 配布だけを外す）で見る。
// ビルド差分の `noAi` は andon の有無・進化ブランチ・ドラフト選好・採用まで同時に違うため、
// 出荷や勝率の差を AI へ帰属できない。
//
// 出荷は**同一 seed の同一スプリント番号**で対応を取る。方針ごとに到達スプリント数が違うので、
// 到達スプリントを平均するだけだと生存者の構成差が出荷差に化ける。
const AI_CTL = ['skilledNoHire', 'noAiCtl'];
console.log('AI 配布だけを外した統制比較（同一 seed・同一スプリント番号で両方が到達した分のみ）:');
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  const cells = [1, 2, 3].map((n) => {
    const bySeed = (policy) => {
      const m = new Map();
      for (const r of runs.filter((x) => x.difficulty === d && x.policy === policy)) {
        const sprints = completedSprintsOf(r);
        if (sprints.length >= n) m.set(`${r.meta ?? 'fresh'}|${r.seed}`, sprints[n - 1].delivered);
      }
      return m;
    };
    const maps = AI_CTL.map(bySeed);
    const shared = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k)));
    if (!shared.length) return `S${n}: 共通到達なし`;
    const parts = AI_CTL.map(
      (policy, i) => `${policy}=${r1(mean(shared.map((k) => maps[i].get(k))))}`,
    );
    return `S${n}(共通 n=${shared.length}): ${parts.join(' / ')}`;
  });
  console.log(`  ${d} 出荷: ${cells.join(' | ')}`);
}
for (const policy of AI_CTL) {
  const arr = runs.filter((r) => r.policy === policy);
  if (!arr.length) continue;
  const sp = arr.flatMap((r) => completedSprintsOf(r));
  console.log(
    `  ${policy}: 勝利=${arr.filter((r) => r.status === 'won').length}/${arr.length} ` +
      `AI利用率 平均=${r1(mean(sp.map((s) => s.aiPct)))} ` +
      `最終AI依存度 平均=${r1(mean(arr.map((r) => r.finalOrg.aiDependency)))}`,
  );
}
if (!runs.some((r) => r.policy === 'noAiCtl')) {
  console.log('  ※ noAiCtl が標本に無いため、AI の因果は未計測');
}

console.log('\n参考: 難易度 × 方針の内訳:');
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const sprints = arr.flatMap((r) => completedSprintsOf(r));
  if (!sprints.length) continue;
  console.log(
    `${k}: 最終AI依存度 平均=${r1(mean(arr.map((r) => r.finalOrg.aiDependency)))} AI利用率 平均=${r1(mean(sprints.map((s) => s.aiPct)))}`,
  );
}
