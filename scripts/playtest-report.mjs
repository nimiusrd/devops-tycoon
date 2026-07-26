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

const file = process.argv[2] ?? 'playtest-out/runs.json';
const raw = JSON.parse(readFileSync(file, 'utf8'));

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
 * 1スプリントで得る進化ポイント。`RunEngine.evoPointsFor` と同じ式。
 * 複製しているので、実装が変わったらここも直す（`src/sim/run/engine.ts`）。
 *
 * **ボススプリントは 0**。`resolveSprint()` のボス分岐は四半期レビューへ遷移して
 * `return` するため、通常スプリント用のポイント加算へ到達しない。含めると
 * 実際には得られないポイントを F-11 の「Q1 で入手する総ポイント」へ足してしまう。
 */
const evoPointsForSprint = (s) =>
  s.kind === 'boss' ? 0 : 1 + Math.floor((s.delivered ?? 0) / 40) + (s.kind === 'elite');

/**
 * ランが Q1 中に**実際に入手した**進化ポイントの合計。
 *
 * `resolveSprint()` は結果を記録して `sprintsPlayed` を増やしたあとに敗北判定をし、
 * 敗北ならポイント加算の前に `return` する。つまりスプリント終了時に敗北したランの
 * 最後のスプリントはポイントを与えない。ログには結果が残っているので、除外しないと
 * 実際には得ていないぶんを足してしまう（とくに第1スプリント敗北の多い nightmare）。
 */
const q1EvoPoints = (r) => {
  const sprints = r.sprints ?? [];
  const lostAtSprintEnd = r.lostPhase === 'sprint' && r.lostSprintCompleted !== false;
  const earning = lostAtSprintEnd ? sprints.slice(0, -1) : sprints;
  return earning.filter((s) => s.quarter === 1).reduce((a, s) => a + evoPointsForSprint(s), 0);
};
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
console.log(`延べ実行 ${raw.length} / ユニーク ${runs.length} / 重複 ${raw.length - runs.length}`);
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

// --- F-7 勝率 ---------------------------------------------------------------
console.log(`\n## F-7 難易度 × 方針の勝率\n`);
/**
 * F-7 の成立判定に使う方針。
 *
 * F-7 は「初見の初勝利が5ラン前後＝勝率20%前後」を見る基準なので、**初見相当の方針**で
 * 判定する。全方針の平均は使わない。`adj*` の統制群や `onlyXxx` のような実験用方針を
 * 足し引きするだけで、ゲームも初見プレイも変わっていないのに平均が動いてしまうためである
 * （実際 `skilledBase` の複製である `adj*` を6本足したときに easy の平均が動いた）。
 */
const FIRST_PLAY_POLICY = 'naive';
/**
 * F-7 は「初見の初勝利カーブ」なので、メタ解放も初見相当（`fresh`）に限る。
 * `PT_META=full` の結果を初見の勝率として出すと、全カード・レリック解放済みで
 * ドラフト候補も結果も変わった値を初勝利カーブと誤読する。
 */
const freshRuns = runs.filter((r) => (r.meta ?? 'fresh') === 'fresh');
console.log(`**成立判定に使う初見相当の方針: ${FIRST_PLAY_POLICY}（メタ解放 fresh のみ）**`);
if (freshRuns.length === 0) {
  console.log('  fresh のランが無いため F-7 は未計測（PT_META=fresh で実行すること）');
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
const SPRINT_BANDS = {
  normal: { min: 60, max: 120, absoluteMin: 30 },
  elite: { min: 60, max: 120, absoluteMin: 30 },
  boss: { min: 90, max: 180 },
};
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
  arr.flatMap((r) => r.sprints.filter((s) => s.kind === kind)).map((s) => sec(s.ticks));
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
console.log(`**成立判定に使う代表方針: ${F4_SAMPLE_POLICIES.join(' / ')}（固定）**`);
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  const arr = runs.filter((r) => r.difficulty === d && F4_SAMPLE_POLICIES.includes(r.policy));
  for (const kind of ['normal', 'elite', 'boss']) {
    const xs = pacingRows(arr, kind);
    if (!xs.length) continue;
    printPacing(`  ${d}/${kind}`, xs, kind);
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

// --- RI-77 アクション別の対象不足 -------------------------------------------
console.log(`\n## RI-77 アクション別の対象不足（単一介入方針。順序バイアスなし）\n`);
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
    const sprints = runs
      .filter((r) => r.difficulty === d && r.policy === policy)
      .flatMap((r) => r.sprints);
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

// --- F-5 分散（同一スプリント番号で比較） ----------------------------------
console.log(`\n## F-5 出荷の散らばり（同一スプリント番号で比較）\n`);
// 全スプリントを連結した CV は、長く生存したランほど標本を多く出し進行段階も混ざるため使わない。
// 各スプリント番号ごとに、そこへ到達したランだけで CV を出す。
const CV_SPRINT_INDEXES = [1, 2, 3, 5];

// RI-83 の方針間比較は**共通コホート**で出す。
// 方針ごとに到達率が違うまま生存ランを別々に母集団にすると、CV 差へ介入効果だけでなく
// seed の選抜差が混ざる（実際 hard/S5 では到達 seed 数が方針で倍以上違う）。
const CV_COMPARE_POLICIES = ['noInterventionCtl', 'naive', 'skilledNoHire'];
console.log('RI-83 の方針間比較（同一メタ・難易度・seed で全方針が到達したスプリントのみ）:');
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  const cells = CV_SPRINT_INDEXES.map((n) => {
    const bySeed = (policy) => {
      const m = new Map();
      for (const r of runs.filter((x) => x.difficulty === d && x.policy === policy)) {
        if (r.sprints.length >= n)
          m.set(`${r.meta ?? 'fresh'}|${r.seed}`, r.sprints[n - 1].delivered);
      }
      return m;
    };
    const maps = CV_COMPARE_POLICIES.map(bySeed);
    const shared = [...maps[0].keys()].filter((k) => maps.every((m) => m.has(k)));
    if (shared.length === 0) return `S${n}: 共通到達なし`;
    const parts = CV_COMPARE_POLICIES.map((policy, i) => {
      const xs = shared.map((k) => maps[i].get(k));
      return `${policy}=${fmtCv(xs)}`;
    });
    return `S${n}(共通 n=${shared.length}): ${parts.join(' / ')}`;
  });
  console.log(`  ${d}: ${cells.join(' | ')}`);
}

console.log('\n参考: 方針別（各方針の到達ランで独立に集計。方針間の比較には使わない）:');
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const cells = CV_SPRINT_INDEXES.map((n) => {
    const xs = arr.filter((r) => r.sprints.length >= n).map((r) => r.sprints[n - 1].delivered);
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

// --- F-9 敗因ごとの手触り（難易度で層別化） ---------------------------------
console.log(`\n## F-9 敗因ごとの進行と予兆\n`);
// 敗因と実験条件は相関する（例: aiDependency はほぼ Nightmare の第1スプリント）。
// 全体を一つに潰すと難易度差が p50 に混入するため、難易度で層別化する。
/**
 * 敗北直前の状態を取る。ログの末尾が敗北スプリントそのものかどうかで参照先が変わる。
 *
 * - スプリントを完走して結果が敗北条件を満たした（`lostSprintCompleted === true`）
 *   → 末尾が敗北スプリントなので1つ前が直前状態
 * - スプリント中に結果を残さず即時敗北した（`lostSprintCompleted === false`）
 *   → 敗北スプリントはログに無く、末尾が最後の完了スプリント＝直前状態
 * - 採用・カード・ビートなどスプリント間で敗北 → 末尾が直前状態
 *
 * ハーネスは `sprintsPlayed` が増えたスプリントしかログへ push しないため、
 * `lostPhase === 'sprint'` だけで1つ前を選ぶと即時敗北のケースで直前状態を落とす。
 */
const prevStateOf = (run) => {
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
  const sprintsToLose = arr.map((r) => r.sprints.length);
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
  return `n=${arr.length} p50=${quantile(sprintsToLose, 0.5)} | 直前 hp=${f(prev, (s) => s.seniorHpAfter)} morale=${f(prev, (s) => s.moraleAfter)} debt=${f(prev, (s) => s.techDebtAfter)} budget=${f(prev, (s) => s.budgetAfter)}（直前状態あり ${prev.length}/${arr.length}）| 敗北フェーズ ${JSON.stringify(phases)}${beatEventsOf(arr)}`;
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
console.log('\n### 同一難易度・同一方針内（代表方針）');
const F9_POLICIES = ['naive', 'skilledNoHire', 'onlyFirefight', 'noInterventionCtl'];
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
            arr.map((r) => r.sprints.length),
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

// --- RI-78 trustExhausted の発火要因分解 ------------------------------------
console.log(`\n## RI-78 四半期 outcome の発火要因\n`);
const crisisTrig = {};
const shutdownTrig = {};
const outcomeCounts = {};
for (const run of runs) {
  for (const q of run.quarters ?? []) {
    outcomeCounts[q.outcome] = (outcomeCounts[q.outcome] ?? 0) + 1;
    const key = (list) => (list?.length ? list.join('+') : 'none');
    // missed_crisis / shutdown はどちらも loseReasonForOutcome で trustExhausted になる。
    if (q.outcome === 'missed_crisis')
      crisisTrig[key(q.crisisTriggers)] = (crisisTrig[key(q.crisisTriggers)] ?? 0) + 1;
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
};
/**
 * 各ランで最初にその方針の修正が適用された四半期。無ければ null。
 *
 * adj* 6方針は `goalAdjustment` 以外すべて同一なので、**最初の修正までは同一 seed の
 * 6ランが完全に同じ経過をたどる**。したがって最初の修正時点の事前状態と提示候補も同一で、
 * ここを揃えれば選択効果だけを取り出せる。
 */
const firstAppliedQuarter = (r, label) =>
  (r.quarters ?? []).find((q) => q.chosenAdjustment === label)?.quarter ?? null;

// `availableAdjustments` は各選択肢の適用後状態で候補を絞るため、方針ごとに
// 「提示され選べたラン」が異なる。そのまま勝率を並べると選択効果と選抜条件を分離できない。
// そこで同一メタ・難易度・seed で 6方針すべてが同じ四半期に自分の修正を適用できた組だけを残す。
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
  `  共通コホート: 全6方針が同一メタ・難易度・seed・四半期で自分の修正を適用できた組 = ${cohortKeys.size}組`,
);
if (cohortKeys.size === 0) {
  console.log('  ※ 共通コホートが0組のため、選択効果は未計測');
}
for (const [policy, label] of adjEntries) {
  const arr = runs.filter((r) => r.policy === policy);
  if (!arr.length) continue;
  const applied = arr.filter((r) => firstAppliedQuarter(r, label) !== null);
  const cohort = arr.filter((r) => cohortKeys.has(cohortKeyOf(r)));
  const won = cohort.filter((r) => r.status === 'won').length;
  // 「到達四半期」は終端の quarterNumber ではなく、修正を選んだ四半期を使う。
  // 終端値は後続ラン長の差を表してしまい、統制条件の事前状態にならない。
  const chosenAt = cohort.map((r) => firstAppliedQuarter(r, label)).filter((q) => q !== null);
  console.log(
    `  ${policy}(${label}): 参考[提示され選べたラン=${applied.length}/${arr.length}] ` +
      `共通コホート n=${cohort.length} 勝率=${pct(won, cohort.length)} ` +
      `修正を選んだ四半期 平均=${r1(mean(chosenAt))} ` +
      `総スプリント 平均=${r1(mean(cohort.map((r) => r.sprintsPlayed)))}`,
  );
}

// --- F-6 評価分布（方針比較） -----------------------------------------------
console.log(`\n## F-6 スプリント評価の分布\n`);
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
const overall = gradeStats(runs.flatMap((r) => r.sprints));
if (overall) {
  console.log(
    `全体 n=${overall.n} 中央値=${overall.median}`,
    Object.entries(overall.dist)
      .sort()
      .map(([g, n]) => `${g}=${n}(${pct(n, overall.n)})`)
      .join(' '),
  );
}
// RI-79 の受入条件は「無介入の評価中央値が熟練方針より低いこと」なので、
// 同一難易度・同一スプリント番号で無介入と熟練を並べる。
//
// **両方針が到達した seed だけで比べる**。到達率が違うまま生存ランを独立に集めると、
// 早期敗北した低評価 seed が片方からだけ脱落し、生存者バイアスで中央値の優劣が反転しうる
// （実際に劣っていても生存者の中央値は同じか高く出る）。未到達は別途件数で示す。
console.log(
  '\n無介入(passive) vs 熟練(skilledNoHire) — 同一メタ・難易度・seed で両方が到達したスプリントのみ:',
);
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  for (const n of [1, 2, 3]) {
    const bySeed = (policy) => {
      const m = new Map();
      for (const r of runs.filter((x) => x.difficulty === d && x.policy === policy)) {
        if (r.sprints.length >= n) m.set(`${r.meta ?? 'fresh'}|${r.seed}`, r.sprints[n - 1]);
      }
      return m;
    };
    const pa = bySeed('passive');
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
      `  ${d} S${n}: 共通 n=${shared.length} | passive 中央値=${a.median} ${JSON.stringify(a.dist)} | skilledNoHire 中央値=${b.median} ${JSON.stringify(b.dist)}${note}`,
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
/**
 * Q1 中に「方向が確定した時点」があったかを判定する。
 *
 * F-11 は「方向が Q1 の途中で見え、以降はその方向を伸ばすか曲げるかの判断になる」を求める。
 * つまり**確定後に曲げること自体は要件を満たす**。Q1 の解放をまとめて最終構成比だけで見ると、
 * 序盤に同一ブランチへ寄せて方向を出したあと同じ Q1 中に他ブランチへ広げたランが
 * 「分散」へ落ちてしまう。そこで解放を順に走査し、**一度でも条件を満たした時点**があれば
 * 確定と数える。順序は記録済みの `sprintIndex`（同点なら記録順）による。
 */
const commitInQ1 = (run) => {
  const q1 = (run.evolutionUnlocks ?? [])
    .filter((u) => u.quarter === 1)
    .map((u, i) => ({ ...u, order: i }))
    .sort((a, b) => (a.sprintIndex ?? 0) - (b.sprintIndex ?? 0) || a.order - b.order);
  if (q1.length === 0) return null;
  const byBranch = {};
  const top = () => Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0];
  for (let i = 0; i < q1.length; i += 1) {
    const b = q1[i].id.split('-')[0];
    byBranch[b] = (byBranch[b] ?? 0) + 1;
    const [topBranch, topN] = top();
    if (topN >= BRANCH_COMMIT_MIN_NODES && topN / (i + 1) >= BRANCH_COMMIT_SHARE) {
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
    '  1スプリントの入手ポイント: 1 + floor(出荷/40)（高負荷は +1）' +
      '（`RunEngine.evoPointsFor`）',
  );

  const sample = runs.filter((r) => F11_SAMPLE_POLICIES.includes(r.policy));
  console.log(
    `\n**実測（代表方針 ${F11_SAMPLE_POLICIES.join(' / ')} に固定。n=${sample.length}）**`,
  );
  const q1Points = sample.map(q1EvoPoints).filter((n) => n > 0);
  if (q1Points.length > 0) {
    console.log(
      `  Q1 で入手する総ポイント（1点以上得たラン n=${q1Points.length}）: ` +
        `p10=${quantile(q1Points, 0.1)} p50=${quantile(q1Points, 0.5)} ` +
        `p90=${quantile(q1Points, 0.9)}（ツリー総コスト ${totalCost} に対して）`,
    );
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
    `その時点までの解放の ${BRANCH_COMMIT_SHARE * 100}% 以上を占める時点が一度でもあるか`,
);
console.log('（確定後に他ブランチへ広げるのは F-11 が許容するため、最終構成比では判定しない）');
console.log('  ※ この値は成立判定に使えない。ハーネスの解放順は方針の `evolve` で固定されており、');
console.log(
  '     全方針で最初の2ノードが必ず同一ブランチになる。盤面に応じて方向を選ぶ挙動ではない。',
);
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  const arr = runs.filter((r) => r.difficulty === d);
  const results = arr.map(commitInQ1);
  const committed = results.filter((x) => x?.committed).length;
  const spread = results.filter((x) => x && !x.committed).length;
  const never = results.filter((x) => x === null).length;
  console.log(
    `${d}: Q1で方向確定 ${committed}/${arr.length} (${pct(committed, arr.length)}) / Q1解放ありだが分散 ${spread} / Q1解放なし ${never}`,
  );
}
console.log('\n方針別（進化を使う方針のみ）:');
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
console.log(`\n## RI-73 / RI-76 AI 依存度と利用率\n`);
for (const [k, arr] of group((r) => `${r.difficulty}/${r.policy}`)) {
  const sprints = arr.flatMap((r) => r.sprints);
  if (!sprints.length) continue;
  console.log(
    `${k}: 最終AI依存度 平均=${r1(mean(arr.map((r) => r.finalOrg.aiDependency)))} AI利用率 平均=${r1(mean(sprints.map((s) => s.aiPct)))}`,
  );
}
