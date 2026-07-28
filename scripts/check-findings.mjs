/**
 * 所見ドキュメントに書かれた方針別勝利数が、最新の `playtest-out/runs.json` と一致するかを検査する。
 *
 * 再計測のたびに手で数値を追うと必ず取りこぼす。実際、方針を1つ足しただけの回で
 * 「概要は更新したが詳細表が旧値のまま」という食い違いを3か所も残し、レビューで指摘された。
 * 表の形が少しでも違うと引っかからない場当たりの grep が原因なので、検査自体を固定する。
 *
 *   node scripts/check-findings.mjs
 *
 * 一致しなければ終了コード1と差分を出す。
 *
 * **検査するのは「方針別の40ラン中の勝利数」だけ**である。敗因件数や分位点まで機械的に
 * 追おうとすると、同じ数字が別の意味で出てくる箇所（F-9 の層別 n / p50 など）を
 * 誤検出して役に立たなくなる。ここは取りこぼしが最も多く、かつ曖昧さなく判定できる一点に絞る。
 */
import { readFileSync, existsSync } from 'node:fs';
import { generationMismatch } from './playtest-generation.mjs';

/**
 * 検査対象。`PT_OUT` と第1引数で差し替えられる。
 *
 * `PT_OUT=/tmp/runs.json npm run playtest` は正式にサポートされた使い方なのに、
 * 既定ファイルだけを読んでいると「成功した計測を無いことにする」か、
 * 「前回の既定ファイルが残っていればそちらを最新として検査する」ことになる。
 */
const RUNS = process.argv[2] ?? process.env.PT_OUT ?? 'playtest-out/runs.json';
const DOCS = ['plan/playtest-findings.md', 'plan/remaining-issues.md'];

/**
 * 訂正履歴は「その修正の直後に観測した値」を意図的に残す節なので検査から外す。
 * 現在値へ揃えてしまうと、各修正がどれだけ動かしたかの記録が消える。
 */
const AS_OF_SECTION = '## 計測方法の訂正';

if (!existsSync(RUNS)) {
  console.error(`${RUNS} が無い。先に \`npm run playtest\` を実行すること。`);
  process.exit(1);
}

const loaded = JSON.parse(readFileSync(RUNS, 'utf8'));
const runs = Array.isArray(loaded) ? loaded : loaded.runs;
const cohort = Array.isArray(loaded) ? null : loaded.cohort;

/**
 * **既定コホートの出力でなければ検査しない。**
 *
 * 所見に書かれた勝利数は「4難易度 × 10 seed × fresh」の40ラン中の値である。
 * 絞り込み実行（`PT_DIFFS=easy` など）の出力をそのまま突き合わせると、
 * 例えば `onlyAndon` の実測が9勝になり、文書の正しい19勝を不一致として報告してしまう。
 * 一致しない条件では「検査した」と言えないので、未計測として明示的に降りる。
 */
/**
 * **測定後にコードが変わっていたら検査せず、失敗として終了する。**
 *
 * 世代が違う出力を突き合わせると、現行コードでは再現しない数値を「一致」と報告するか、
 * 直したはずの値を不一致として報告することになる。どちらも検査の意味が無い。
 *
 * **終了コードは非0にする。** これは検証用スクリプトなので、`&&` で連結した検証や CI が
 * 「何も比較していない」を「検査に通った」として扱うと、古い測定値に基づく所見が
 * そのまま通過する。下のコホート不一致（`exit 0`）とは扱いを変えている理由は、
 * 絞り込み実行は正式にサポートした使い方で「その条件では検査できない」が正常な結果である一方、
 * 世代不一致は**再計測すれば必ず解消する異常**だからである。
 */
const stale = generationMismatch(loaded);
if (stale) {
  console.error(`検査できない: ${stale}`);
  process.exit(1);
}

if (!cohort) {
  console.log('コホート情報の無い出力なので未計測（`npm run playtest` で再生成すること）。');
  process.exit(0);
}
if (!cohort.isDefault) {
  console.log(
    '既定コホートではないため未計測: ' +
      `難易度=${cohort.difficulties.join(',')} / seed=${cohort.seeds.length}件 / ` +
      `方針=${cohort.policies.length}件 / meta=${cohort.meta}`,
  );
  console.log('  所見の数値は4難易度 × 10 seed × fresh の40ラン中の勝利数を前提にしている。');
  process.exit(0);
}

const wins = new Map();
for (const r of runs) {
  const e = wins.get(r.policy) ?? { w: 0, n: 0 };
  e.n += 1;
  if (r.status === 'won') e.w += 1;
  wins.set(r.policy, e);
}

/** 表のヘッダに勝利数の列がありそうか。 */
const isWinTable = (header) => /勝利|40ラン/.test(header);

const problems = [];

for (const file of DOCS) {
  const raw = readFileSync(file, 'utf8');
  const cut = raw.indexOf(AS_OF_SECTION);
  const body = cut >= 0 ? raw.slice(0, cut) : raw;
  const lines = body.split('\n');

  let header = '';
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;

    // 表のヘッダを覚えておく（区切り行 `| --- |` の直前が見出し）。
    if (/^\|\s*-{3,}/.test(line.trim())) header = lines[i - 1] ?? '';
    else if (!line.trim().startsWith('|')) header = '';

    // 1) 散文・表を問わず `\`policy\` ... N/40` の形。
    for (const [policy, { w }] of wins) {
      const re = new RegExp('`' + policy + '`[^\\n|]{0,16}?(\\d{1,3})/40', 'g');
      let m;
      while ((m = re.exec(line))) {
        if (Number(m[1]) !== w) {
          problems.push(`${at}: \`${policy}\` は ${m[1]}/40 と書かれているが実測は ${w}/40`);
        }
      }
    }

    // 2) 勝利数を載せた表の行。
    //
    // **複数方針を1行にまとめた行も検査する。** 順位表には
    // `| **\`skilledNoHire\`** / \`skilledShopBuy\` / ... | **16** |` のように
    // 同じ勝利数の方針を並べた行があり、以前はこれを丸ごと除外していた。そのため
    // グループ内の1方針だけが変化しても旧値のまま検査を通り、この検査を入れた目的
    //（再計測値の取りこぼし防止）が主要な表で働いていなかった。
    //
    // 独立した数値セルが**ちょうど1つ**なら、その値は行内の全方針に共通する勝利数なので、
    // 各方針と個別に照合できる。数値セルが複数ある行（難易度別内訳を併記した表など）は
    // どの数値がどれに対応するか一意に決まらないので、対応が取れる 1) の経路に任せる。
    if (!line.trim().startsWith('|') || !isWinTable(header)) return;
    const named = [...new Set([...line.matchAll(/`(\w+)`/g)].map((m) => m[1]))].filter((p) =>
      wins.has(p),
    );
    if (named.length === 0) return;
    const values = [];
    for (const cell of line.split('|').slice(1, -1)) {
      const m = cell.trim().match(/^\*{0,2}(\d{1,3})\*{0,2}$/);
      if (!m) continue;
      const v = Number(m[1]);
      if (v > 40) continue; // 40ラン中の勝利数ではない
      values.push(v);
    }
    if (values.length !== 1) return;
    const v = values[0];
    for (const policy of named) {
      const want = wins.get(policy).w;
      if (v !== want) {
        problems.push(`${at}: \`${policy}\` の行に ${v} とあるが実測は ${want}`);
      }
    }
  });
}

// --- 難易度別の全方針合計 -----------------------------------------------
//
// `| easy | 72.3%（224/310） | ... |` の形の行を検査する。方針別勝利数だけを見ていたため、
// この表の 225/310・127/310・33/310 という**実測と合わない値**（合計385で、総勝利387と不整合）が
// 検査を通り抜けてレビューで指摘された。難易度ごとの勝敗は曖昧さなく計算できるので機械検査に載せる。
const byDifficulty = new Map();
for (const r of runs) {
  const e = byDifficulty.get(r.difficulty) ?? { w: 0, n: 0 };
  e.n += 1;
  if (r.status === 'won') e.w += 1;
  byDifficulty.set(r.difficulty, e);
}
for (const file of DOCS) {
  const raw = readFileSync(file, 'utf8');
  const cut = raw.indexOf(AS_OF_SECTION);
  const body = cut >= 0 ? raw.slice(0, cut) : raw;
  body.split('\n').forEach((line, i) => {
    const m = line.match(/^\|\s*(easy|normal|hard|nightmare)\s*\|[^|]*?（(\d+)\/(\d+)）/);
    if (!m) return;
    const [, diff, won, total] = m;
    const actual = byDifficulty.get(diff);
    if (!actual) return;
    if (Number(won) !== actual.w || Number(total) !== actual.n) {
      problems.push(
        `${file}:${i + 1}: ${diff} の全方針合計が ${won}/${total} と書かれているが実測は ${actual.w}/${actual.n}`,
      );
    }
  });
}

// --- 総勝利数・総敗北数 ---------------------------------------------------
//
// 勝敗の総数は散文にも表にも繰り返し出る（「1,240ラン中N勝の内訳は…」「全N敗の内訳:」）。
// 方針別と難易度別だけを検査していたため、採用の自滅を直して 387→388 と動いたとき
// 散文側が旧値のまま残り、レビューで指摘された。総数は曖昧さなく計算できる。
const totalWon = runs.filter((r) => r.status === 'won').length;
const totalLost = runs.filter((r) => r.status === 'lost').length;
for (const file of DOCS) {
  const raw = readFileSync(file, 'utf8');
  const cut = raw.indexOf(AS_OF_SECTION);
  const body = cut >= 0 ? raw.slice(0, cut) : raw;
  body.split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    // 「1,240ラン中387勝」形式。ラン数は桁区切りの有無を問わない。
    for (const m of line.matchAll(/([\d,]+)ラン中\s*(\d+)\s*勝/g)) {
      const total = Number(m[1].replace(/,/g, ''));
      if (total !== runs.length) continue; // 別コホートを指す記述は対象外
      if (Number(m[2]) !== totalWon) {
        problems.push(`${at}: 総勝利が ${m[2]} と書かれているが実測は ${totalWon}`);
      }
    }
    // 「全853敗」形式。
    for (const m of line.matchAll(/全\s*(\d+)\s*敗/g)) {
      if (Number(m[1]) !== totalLost) {
        problems.push(`${at}: 総敗北が ${m[1]} と書かれているが実測は ${totalLost}`);
      }
    }
  });
}

// --- 散文の定型表現 -------------------------------------------------------
//
// 所見は同じ量を表と散文の両方へ書く。表だけを検査していたため、
// 「良かった点」節の「熟練の 14/40」「使う14 vs 使わない8」のように
// **方針名を伴わない言い回し**が旧コホートのまま残り、レビューで繰り返し指摘された。
// 汎用の散文解析は不可能だが、この文書で実際に繰り返される言い回しは有限なので、
// 対応表として明示的に持つ。新しい言い回しを増やしたらここへ足すこと。
const winOf = (policy) => wins.get(policy)?.w;
const PROSE_RULES = [
  // 「熟練の 16/40」（方針名を書かずに `skilledNoHire` を指す）
  {
    re: /熟練の\s*(\d{1,3})\/40/g,
    want: () => winOf('skilledNoHire'),
    label: '熟練（skilledNoHire）',
  },
  // 「使う16 vs 使わない8」（カードの寄与）
  {
    re: /使う\s*(\d{1,3})\s*vs\s*使わない\s*(\d{1,3})/g,
    want: () => winOf('skilledNoHire'),
    want2: () => winOf('skilledNoCards'),
    label: 'カード使用（skilledNoHire）',
    label2: 'カード不使用（skilledNoCards）',
  },
];
// 敗因別の件数（実測から求める）。
const ALL_DIAGNOSES = new Set(runs.map((r) => r.diagnosis));
const loseCounts = new Map();
for (const r of runs) {
  if (r.status !== 'lost') continue;
  loseCounts.set(r.loseReason, (loseCounts.get(r.loseReason) ?? 0) + 1);
}
// 方針ごとの診断内訳。
const diagByPolicy = new Map();
for (const r of runs) {
  if (!diagByPolicy.has(r.policy)) diagByPolicy.set(r.policy, new Map());
  const m = diagByPolicy.get(r.policy);
  m.set(r.diagnosis, (m.get(r.diagnosis) ?? 0) + 1);
}

for (const file of DOCS) {
  const raw = readFileSync(file, 'utf8');
  const cut = raw.indexOf(AS_OF_SECTION);
  const body = cut >= 0 ? raw.slice(0, cut) : raw;
  body.split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const rule of PROSE_RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line))) {
        const want = rule.want();
        if (want !== undefined && Number(m[1]) !== want) {
          problems.push(`${at}: ${rule.label} が ${m[1]} と書かれているが実測は ${want}`);
        }
        if (rule.want2) {
          const want2 = rule.want2();
          if (want2 !== undefined && Number(m[2]) !== want2) {
            problems.push(`${at}: ${rule.label2} が ${m[2]} と書かれているが実測は ${want2}`);
          }
        }
      }
    }
    // 「`a` / `b` / `c`（実測合計296件）」— 列挙した敗因の合計。
    for (const m of line.matchAll(/((?:`\w+`\s*\/\s*)+`\w+`)\s*（実測合計\s*(\d+)\s*件）/g)) {
      const names = [...m[1].matchAll(/`(\w+)`/g)].map((x) => x[1]);
      if (!names.every((n) => loseCounts.has(n))) continue;
      const actual = names.reduce((a, n) => a + loseCounts.get(n), 0);
      if (Number(m[2]) !== actual) {
        problems.push(
          `${at}: ${names.join('+')} の合計が ${m[2]} と書かれているが実測は ${actual}`,
        );
      }
    }
    // 方針別の診断件数。散文（「`noAi` は `documentationKingdom` 8 / ...」）と
    // 表の行（「| `noAi` | `documentationKingdom` 8 / ... |」）の両方を拾う。
    // **`は` だけを見ていて表形式を取りこぼしていた**（RI-76 の診断表が旧値のまま残った）。
    for (const pm of line.matchAll(/`(\w+)`\s*(?:は|\|)\s*((?:`\w+`\s*\d+\s*\/?\s*)+)/g)) {
      const policy = pm[1];
      const dm = diagByPolicy.get(policy);
      if (!dm) continue;
      for (const d of pm[2].matchAll(/`(\w+)`\s*(\d+)/g)) {
        if (!dm.has(d[1]) && !ALL_DIAGNOSES.has(d[1])) continue;
        const actual = dm.get(d[1]) ?? 0;
        if (Number(d[2]) !== actual) {
          problems.push(
            `${at}: \`${policy}\` の \`${d[1]}\` が ${d[2]} と書かれているが実測は ${actual}`,
          );
        }
      }
    }
  });
}

if (problems.length > 0) {
  console.error(`方針別勝利数がドキュメントと実測でずれている（${problems.length}件）:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `方針別勝利数はドキュメントと実測で一致している（${wins.size}方針 / ${runs.length}ラン）`,
);
