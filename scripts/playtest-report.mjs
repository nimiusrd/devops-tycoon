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
for (const [d, arr] of group((r) => r.difficulty)) {
  for (const kind of ['normal', 'elite', 'boss']) {
    const xs = arr
      .flatMap((r) => r.sprints.filter((s) => s.kind === kind))
      .map((s) => sec(s.ticks));
    if (!xs.length) continue;
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
      `${d}/${kind}: n=${xs.length} p10=${r1(quantile(xs, 0.1))} p50=${r1(p50v)} p90=${r1(quantile(xs, 0.9))} | 規定${band.min}〜${band.max}s: p50 ${inBand ? '帯内' : '帯外'} 下回り=${pct(below, xs.length)} 上回り=${pct(above, xs.length)}${absMin}`,
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
 * 敗北直前の状態を取る。
 * スプリント終了時に負けたランは最後のスプリントが敗北そのものなので1つ前を見るが、
 * 採用・カード・ビートなどスプリント間で負けたランは最後の完了スプリントが直前状態になる。
 */
const prevStateOf = (run) => {
  if (run.sprints.length === 0) return undefined;
  const betweenSprints = run.lostPhase !== undefined && run.lostPhase !== 'sprint';
  const idx = betweenSprints ? run.sprints.length - 1 : run.sprints.length - 2;
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
  '  ※ shutdown はエンジン側が全社集約値で判定するが、ログは選択中チームの値から復元している。',
);
console.log('  ※ 復元できなかったものは none として出る。');

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
console.log('統制比較（adj* 方針のみ。他方針は提示順の先頭を選ぶため除外）:');
for (const [policy, label] of Object.entries(ADJ_POLICIES)) {
  const arr = runs.filter((r) => r.policy === policy);
  if (!arr.length) continue;
  // 実際にその修正を選べたラン（提示されなかったランはフォールバックしている）
  const applied = arr.filter((r) => (r.quarters ?? []).some((q) => q.chosenAdjustment === label));
  const won = applied.filter((r) => r.status === 'won').length;
  // 「到達四半期」は終端の quarterNumber ではなく、修正を選んだ四半期を使う。
  // 終端値は後続ラン長の差を表してしまい、統制条件の事前状態にならない。
  const chosenAt = applied.flatMap((r) =>
    (r.quarters ?? []).filter((q) => q.chosenAdjustment === label).map((q) => q.quarter),
  );
  const finalQ = applied.map((r) => r.quarterNumber);
  console.log(
    `  ${policy}(${label}): 提示され選べたラン=${applied.length}/${arr.length} 勝率=${pct(won, applied.length)} 修正を選んだ四半期 平均=${r1(mean(chosenAt))} 最終到達四半期 平均=${r1(mean(finalQ))} 総スプリント 平均=${r1(mean(applied.map((r) => r.sprintsPlayed)))}`,
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
console.log('\n無介入(passive) vs 熟練(skilledNoHire) — 同一難易度・同一スプリント番号:');
for (const d of [...new Set(runs.map((r) => r.difficulty))]) {
  for (const n of [1, 2, 3]) {
    const at = (policy) =>
      runs
        .filter((r) => r.difficulty === d && r.policy === policy && r.sprints.length >= n)
        .map((r) => r.sprints[n - 1]);
    const a = gradeStats(at('passive'));
    const b = gradeStats(at('skilledNoHire'));
    if (!a || !b) continue;
    console.log(
      `  ${d} S${n}: passive 中央値=${a.median}(n=${a.n}) ${JSON.stringify(a.dist)} | skilledNoHire 中央値=${b.median}(n=${b.n}) ${JSON.stringify(b.dist)}`,
    );
  }
}

// --- F-11 ビルドの方向が決まる時期 ------------------------------------------
console.log(`\n## F-11 Q1 でビルドの方向が決まるか\n`);
// 母数は全ラン（進化に到達しないランも含める）。
// 分子は「Q1 の解放が特定ブランチへ寄っている」ランに限る。1件だけ取った状態や、
// 複数ブランチへ均等に投資した状態は「方向が決まった」とは数えない。
const BRANCH_COMMIT_MIN_NODES = 2; // 同一ブランチで2ノード以上
const BRANCH_COMMIT_SHARE = 0.5; // かつ Q1 解放の過半がそのブランチ
const commitInQ1 = (run) => {
  const q1 = (run.evolutionUnlocks ?? []).filter((u) => u.quarter === 1);
  if (q1.length === 0) return null;
  const byBranch = {};
  for (const u of q1) {
    const b = u.id.split('-')[0];
    byBranch[b] = (byBranch[b] ?? 0) + 1;
  }
  const [topBranch, topN] = Object.entries(byBranch).sort((a, b) => b[1] - a[1])[0];
  const committed = topN >= BRANCH_COMMIT_MIN_NODES && topN / q1.length >= BRANCH_COMMIT_SHARE;
  return { committed, topBranch, topN, total: q1.length };
};
console.log(
  `判定: Q1 の解放が同一ブランチ ${BRANCH_COMMIT_MIN_NODES} ノード以上かつ Q1 解放の ${BRANCH_COMMIT_SHARE * 100}% 以上を占める`,
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
