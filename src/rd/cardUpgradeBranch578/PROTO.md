# #578 R&D 試作: カード強化の分岐（本番マージしない）

Issue [#578](https://github.com/nimiusrd/devops-tycoon/issues/578) の隔離プロトタイプ。
本番のカード強化・バランスデータ・出荷 UI は変更していない。

同じカード「現場支援プレイブック」を、休息の強化で **A 普段使いを安くする** か **B 特定仕事へ強くする** へ分岐させる案を、固定 seed で測る。

## 仮説（数値を合わせて通さない）

- H1 どちらの分岐も、両状況で厳密に上位ではない
- H2 どちらが良いかは状況で入れ替わる
- H3 選ばなかった分岐の損失が指標に残る

採否（Adopt / Iterate / Kill）はこの文書では書かない。

## 動かし方

同じ seed `ri182-578`、同じ初期資源（ticks=30 / focus=12 / capacity=1 / jobs=20）で、4 セルを一度に出す。

```bash
npm run rd:578
```

個別セルも同じ seed で再現できる。`src/rd/cardUpgradeBranch578/experiment.ts` の `runCell` を使う。

```ts
import { runCell } from './experiment';

runCell('A', 'volume');
runCell('B', 'volume');
runCell('A', 'bottleneck');
runCell('B', 'bottleneck');
```

読む数字:

- 量の状況 `volume` の主指標: `shippedCount`（出荷した仕事数）
- ボトルネック状況 `bottleneck` の主指標: `specialShippedCount`（特定仕事を処理した数）
- 費用: `focusSpent` / `unusedFocus` / `plays`
- 副作用: `opsBurden`（運営負担） / `leftoverJobs` / `leftoverEffort`
- 機会費用: 各状況の `foregoneIfPickA` と `foregoneIfPickB`（選ばなかった分岐の主指標差。負は、選んだ側が主指標で上回ったことを示す。消さない）

## 生の比較（seed `ri182-578`）

初回実行の生値。後からノブは動かしていない。

### volume / 日常の量（主指標 `shippedCount`）

| 分岐 | shippedCount | everyday | special | leftoverJobs | leftoverEffort | focusSpent | unusedFocus | plays | opsBurden |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 8 | 7 | 1 | 12 | 51 | 2 | 10 | 1 | 1 |
| B | 7 | 6 | 1 | 13 | 56 | 4 | 8 | 1 | 3 |

- primaryDelta B-A = -1
- foregoneIfPickA = -1
- foregoneIfPickB = 1

### bottleneck / 特定仕事がボトルネック（主指標 `specialShippedCount`）

| 分岐 | specialShippedCount | shippedCount | everyday | leftoverJobs | leftoverEffort | focusSpent | unusedFocus | plays | opsBurden |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 8 | 8 | 0 | 12 | 50.92 | 2 | 10 | 1 | 1 |
| B | 11 | 11 | 0 | 9 | 35.92 | 4 | 8 | 1 | 3 |

- primaryDelta B-A = 3
- foregoneIfPickA = 3
- foregoneIfPickB = -3
