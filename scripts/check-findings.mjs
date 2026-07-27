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

const RUNS = 'playtest-out/runs.json';
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

if (problems.length > 0) {
  console.error(`方針別勝利数がドキュメントと実測でずれている（${problems.length}件）:`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `方針別勝利数はドキュメントと実測で一致している（${wins.size}方針 / ${runs.length}ラン）`,
);
